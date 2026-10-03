from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import subprocess
from unittest.mock import patch


SCRIPT = Path(__file__).with_name('release-qlo2.py')
SPEC = importlib.util.spec_from_file_location('release_qlo2', SCRIPT)
assert SPEC and SPEC.loader
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)


class ReleasePipelineTests(unittest.TestCase):
    def test_large_vault_sync_keeps_a_bounded_longer_timeout_and_requires_completion(self) -> None:
        with patch.object(release, 'run', return_value=subprocess.CompletedProcess([], 0, 'Fully synced\n')) as command:
            self.assertEqual(release.sync_release(), [])
            self.assertEqual(command.call_args.kwargs, {'capture': True, 'timeout': 1800})
        with patch.object(release, 'run', return_value=subprocess.CompletedProcess([], 0, 'Uploading file other-project/file\n')):
            with self.assertRaises(SystemExit):
                release.sync_release()

    def test_json_smoke_evidence_survives_receipt_creation_and_retry(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            plugin = root / 'plugin'
            plugin.mkdir()
            (plugin / 'manifest.json').write_text('{"version":"3.4.5"}')
            (plugin / 'main.js').write_bytes(b'bundle')
            for name in release.RELEASE_FILES:
                if not (plugin / name).exists(): (plugin / name).write_bytes(name.encode())
            receipts = root / 'releases'
            deployed = receipts / '3.4.5'
            deployed.mkdir(parents=True)
            (deployed / 'deployment.json').write_text(json.dumps({'version':'3.4.5','status':'awaiting-live-smoke','releaseFileSha256':{name:release.sha256_file(plugin / name) for name in release.RELEASE_FILES}}))
            evidence = root / 'live.json'
            original = b'{"realClient":"QLO2","verified":true}'
            evidence.write_bytes(original)
            with patch.object(release, 'canonical_root_required'), patch.object(release, 'RECEIPTS', receipts), patch.object(release, 'QLO2_PLUGIN', plugin), patch.object(release, 'DEV_PLUGIN', plugin):
                release.complete_smoke('3.4.5', 'vps', evidence, 'Verified real client')
                receipt_path = deployed / 'smoke-vps.json'
                receipt = json.loads(receipt_path.read_text())
                copied = Path(receipt['evidence'])
                self.assertNotEqual(copied, receipt_path)
                self.assertEqual(copied.read_bytes(), original)
                self.assertEqual(release.sha256_file(copied), receipt['evidenceSha256'])
                manifest = {path.name: path.read_bytes() for path in deployed.iterdir()}
                with self.assertRaises(SystemExit):
                    release.complete_smoke('3.4.5', 'vps', evidence, 'Retry')
                self.assertEqual({path.name: path.read_bytes() for path in deployed.iterdir()}, manifest)

    def test_smoke_rejects_every_same_version_artifact_mismatch_before_creating_evidence(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            plugin = root / 'plugin'; plugin.mkdir()
            files = {name:name.encode() for name in release.RELEASE_FILES}
            files['manifest.json'] = b'{"version":"3.4.5"}'
            for name, value in files.items(): (plugin / name).write_bytes(value)
            receipts = root / 'releases'; deployed = receipts / '3.4.5'; deployed.mkdir(parents=True)
            (deployed / 'deployment.json').write_text(json.dumps({'version':'3.4.5','status':'awaiting-live-smoke','releaseFileSha256':{name:release.sha256_bytes(value) for name,value in files.items()}}))
            evidence = root / 'live.json'; evidence.write_text('{}')
            with patch.object(release, 'canonical_root_required'), patch.object(release, 'RECEIPTS', receipts), patch.object(release, 'QLO2_PLUGIN', plugin), patch.object(release, 'DEV_PLUGIN', plugin):
                for name in release.RELEASE_FILES:
                    tampered = b'{"version":"3.4.5","tampered":true}' if name == 'manifest.json' else b'tampered'
                    (plugin / name).write_bytes(tampered)
                    with self.assertRaisesRegex(SystemExit, 'does not match'): release.complete_smoke('3.4.5','vps',evidence,'Verified')
                    self.assertEqual([p.name for p in deployed.iterdir()], ['deployment.json'])
                    (plugin / name).write_bytes(files[name])

    def test_plain_resume_accepts_only_release_generated_version_edits_and_uses_archive_bytes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); (root / 'dist').mkdir()
            for name in release.RELEASE_FILES:
                (root / ('dist/main.js' if name == 'main.js' else name)).write_bytes(name.encode())
            (root / 'manifest.json').write_text('{"version":"1.0.0","minAppVersion":"1.8.7"}')
            (root / 'package.json').write_text('{"version":"1.0.0"}')
            (root / 'package-lock.json').write_text('{"version":"1.0.0","packages":{"":{"version":"1.0.0"}}}')
            (root / 'versions.json').write_text('{"1.0.0":"1.8.7"}')
            subprocess.run(['git','init','-q',str(root)],check=True)
            subprocess.run(['git','-C',str(root),'add','.'],check=True)
            subprocess.run(['git','-C',str(root),'-c','user.name=Test','-c','user.email=test@example.com','commit','-qm','Original'],check=True)
            commit = subprocess.check_output(['git','-C',str(root),'rev-parse','HEAD'],text=True).strip()
            with patch.object(release,'ROOT',root), patch.object(release,'RECEIPTS',root/'receipts'), patch.object(release,'QLO2_PLUGIN',root/'missing-plugin'), patch.object(release,'canonical_root_required'), patch.object(release,'run'), patch.object(release,'git_state',return_value=(commit,[])), patch.object(release,'publish_release',side_effect=RuntimeError('Sync failure')):
                with self.assertRaisesRegex(RuntimeError,'Sync failure'): release.new_release('patch',False)
            dirty = [' M '+name for name in ('package.json','package-lock.json','manifest.json','versions.json')]
            with patch.object(release,'ROOT',root), patch.object(release,'RECEIPTS',root/'receipts'), patch.object(release,'canonical_root_required'), patch.object(release,'git_state',return_value=(commit,dirty)), patch.object(release,'publish_release') as publish:
                release.resume_release('1.0.1',False); self.assertTrue(publish.call_args.kwargs['resumed'])
                with patch.object(release,'git_state',return_value=(commit,dirty+[' M main.ts'])):
                    with self.assertRaisesRegex(SystemExit,'Unrelated'): release.resume_release('1.0.1',False)
                (root/'package.json').write_text('{"version":"1.0.1","changed":true}')
                with self.assertRaisesRegex(SystemExit,'version bytes changed'): release.resume_release('1.0.1',False)

    def test_semver_bumps_are_strict(self) -> None:
        self.assertEqual(release.bump_version('2.12.1', 'patch'), '2.12.2')
        self.assertEqual(release.bump_version('2.12.1', 'minor'), '2.13.0')
        self.assertEqual(release.bump_version('2.12.1', 'major'), '3.0.0')
        with self.assertRaises(ValueError):
            release.parse_version('2.12')
        with self.assertRaises(ValueError):
            release.parse_version('v2.12.1')

    def test_exact_version_option_and_old_version_preflight(self) -> None:
        args = release.parser().parse_args(['--version', '2.28.1'])
        self.assertEqual(args.version, '2.28.1')
        with patch.object(release, 'canonical_root_required'), patch.object(release, 'git_state', return_value=('commit', False)), patch.object(release, 'read_json', return_value={'version': '2.18.0'}), patch.object(release, 'set_version') as mutate:
            for version in ['2.18.0', '2.17.9', 'v2.28.1']:
                with self.assertRaises((SystemExit, ValueError)):
                    release.new_release(None, False, version)
            mutate.assert_not_called()

    def test_archive_is_exact_and_immutable(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'dist').mkdir()
            files = {
                'main.js': b'plugin bundle',
                'manifest.json': json.dumps({'version': '3.4.5'}).encode(),
                'versions.json': b'{"3.4.5":"1.8.7"}',
                'styles.css': b'body {}',
                'README.md': b'docs',
                'LICENSE': b'license',
            }
            for name, value in files.items():
                path = root / 'dist/main.js' if name == 'main.js' else root / name
                path.write_bytes(value)
            original = release.ROOT
            release.ROOT = root
            try:
                archive = release.create_archive('3.4.5')
                hashes = release.validate_archive(archive, '3.4.5')
                self.assertEqual(hashes['main.js'], release.sha256_bytes(files['main.js']))
                with self.assertRaises(SystemExit):
                    release.create_archive('3.4.5')
            finally:
                release.ROOT = original

    def test_dev_install_preserves_data_and_rejects_source_files(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'source'
            plugin = Path(directory) / 'plugin'
            (root / 'dist').mkdir(parents=True)
            plugin.mkdir()
            (root / 'dist/main.js').write_bytes(b'bundle')
            (root / 'manifest.json').write_text('{"version":"1.0.0"}')
            (root / 'styles.css').write_bytes(b'css')
            settings = b'{"kept":true}'
            (plugin / 'data.json').write_bytes(settings)
            original = release.ROOT
            release.ROOT = root
            try:
                release.install_runtime(plugin, strict_dev=True)
                self.assertEqual((plugin / 'data.json').read_bytes(), settings)
                self.assertEqual({path.name for path in plugin.iterdir()}, release.DEV_ALLOWED)
                (plugin / 'main.ts').write_text('source must not be installed')
                with self.assertRaises(SystemExit):
                    release.install_runtime(plugin, strict_dev=True)
            finally:
                release.ROOT = original


if __name__ == '__main__':
    unittest.main()
