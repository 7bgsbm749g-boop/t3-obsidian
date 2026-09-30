from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).with_name('release-qlo2.py')
SPEC = importlib.util.spec_from_file_location('release_qlo2', SCRIPT)
assert SPEC and SPEC.loader
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)


class ReleasePipelineTests(unittest.TestCase):
    def test_json_smoke_evidence_survives_receipt_creation_and_retry(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            plugin = root / 'plugin'
            plugin.mkdir()
            (plugin / 'manifest.json').write_text('{"version":"3.4.5"}')
            (plugin / 'main.js').write_bytes(b'bundle')
            receipts = root / 'releases'
            deployed = receipts / '3.4.5'
            deployed.mkdir(parents=True)
            (deployed / 'deployment.json').write_text('{"version":"3.4.5","status":"awaiting-live-smoke"}')
            evidence = root / 'live.json'
            original = b'{"realClient":"QLO2","verified":true}'
            evidence.write_bytes(original)
            with patch.object(release, 'canonical_root_required'), patch.object(release, 'RECEIPTS', receipts), patch.object(release, 'QLO2_PLUGIN', plugin):
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

    def test_semver_bumps_are_strict(self) -> None:
        self.assertEqual(release.bump_version('2.12.1', 'patch'), '2.12.2')
        self.assertEqual(release.bump_version('2.12.1', 'minor'), '2.13.0')
        self.assertEqual(release.bump_version('2.12.1', 'major'), '3.0.0')
        with self.assertRaises(ValueError):
            release.parse_version('2.12')
        with self.assertRaises(ValueError):
            release.parse_version('v2.12.1')

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
