from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import subprocess
import sys
import base64
import gzip
import zipfile
from unittest.mock import patch


SCRIPT = Path(__file__).with_name('release-qlo2.py')
SPEC = importlib.util.spec_from_file_location('release_qlo2', SCRIPT)
assert SPEC and SPEC.loader
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)


class ReleasePipelineTests(unittest.TestCase):
    def test_documentation_enqueue_is_an_ordinary_commit_without_a_queue_job(self):
        with patch.object(release, 'git_state', return_value=('commit', [])), \
             patch.object(release.subprocess, 'check_output', side_effect=['commit\n', 'AGENTS.md\n']), \
             patch.object(release.integrate_docs, 'integrate', return_value={'status': 'committed'}) as integrate, \
             patch.object(release.release_queue, 'enqueue') as enqueue, \
             patch.object(release.release_queue, 'kick') as kick:
            release.dispatch(release.parser().parse_args(['--enqueue', 'HEAD']))
            integrate.assert_called_once_with(release.ROOT, release.CANONICAL_ROOT, 'commit')
            enqueue.assert_not_called(); kick.assert_not_called()

    def test_memory_wait_cli_requires_allowance_and_native_recovery_watch(self):
        for arguments in [['--wait-for-memory', 'job'],
                          ['--wait-for-memory', 'job', '--memory-budget', '768M'],
                          ['--queue-status', 'job', '--memory-budget', '768M']]:
            with self.assertRaises(SystemExit):
                release.dispatch(release.parser().parse_args(arguments))

    def test_memory_cli_uses_queue_probe_and_preserves_publication_barriers(self):
        with patch.object(release.release_queue, 'wait_for_memory', return_value={'status':'waiting-for-memory'}) as wait, \
             patch.object(release.release_queue, 'probe_memory', return_value={'status':'needs-evidence'}) as probe, \
             patch.object(release.release_queue, 'kick') as kick:
            release.dispatch(release.parser().parse_args(['--wait-for-memory', 'job', '--memory-budget', '768M', '--resume-task-id', 'native-watch']))
            wait.assert_called_once_with('job', '768M', 'native-watch')
            release.dispatch(release.parser().parse_args(['--probe-memory', 'job']))
            probe.assert_called_once_with('job');self.assertEqual(kick.call_count, 2)

    def cleanup_fixture(self, root):
        plugin = root / 'vault/.obsidian/plugins/t-three-code'; plugin.mkdir(parents=True)
        legacy = plugin.with_name('send-to-t3-code'); legacy.mkdir()
        (plugin / 'manifest.json').write_text('{"id":"t-three-code","version":"3.4.4"}')
        (plugin / 'main.js').write_bytes(b'current runtime')
        (plugin / 'styles.css').write_bytes(b'current styles')
        (plugin / 'data.json').write_bytes(b'{ "current": "keep exact bytes" }\n')
        (legacy / 'data.json').write_bytes(b'{ "legacy": "keep separately" }\n')
        return plugin, legacy

    def test_explicit_legacy_cleanup_preserves_settings_and_restarts_sync_even_after_scan_failure(self):
        for fail in [False, True]:
            with self.subTest(fail=fail), tempfile.TemporaryDirectory() as directory:
                root = Path(directory); plugin, legacy = self.cleanup_fixture(root)
                current = (plugin / 'data.json').read_bytes(); old = (legacy / 'data.json').read_bytes()
                with patch.object(release, 'QLO2_PLUGIN', plugin), patch.object(release, 'DEV_PLUGIN', root / 'dev/plugins/t-three-code'), patch.object(release, 'BACKUPS', root / 'evidence'), patch.object(release, 'run') as run, patch.object(release, 'sync_release', side_effect=RuntimeError('scan failed') if fail else None) as sync:
                    if fail:
                        with self.assertRaisesRegex(RuntimeError, 'scan failed'): release.cleanup_legacy_plugin_settings()
                    else:
                        result = release.cleanup_legacy_plugin_settings(); self.assertEqual(result['status'], 'complete')
                    self.assertFalse(legacy.exists()); self.assertEqual((plugin / 'data.json').read_bytes(), current)
                    copies = list((root / 'evidence').glob('legacy-settings-*/qlo2/plugin/data.json'))
                    self.assertEqual(len(copies), 1); self.assertEqual(copies[0].read_bytes(), old)
                    sync.assert_called_once()
                    self.assertEqual(run.call_args_list[-1].args[0], ['systemctl', '--user', 'start', release.SYNC_SERVICE])
                    self.assertIn(unittest.mock.call(['systemctl', '--user', 'stop', release.SYNC_SERVICE]), run.call_args_list)

    def test_cleanup_refuses_a_real_old_plugin_before_sync_or_file_changes_and_noops_when_clean(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); plugin, legacy = self.cleanup_fixture(root)
            (legacy / 'main.js').write_bytes(b'preserve old runtime')
            with patch.object(release, 'QLO2_PLUGIN', plugin), patch.object(release, 'DEV_PLUGIN', root / 'dev/plugins/t-three-code'), patch.object(release, 'run') as run:
                with self.assertRaisesRegex(SystemExit, 'more than stale settings'): release.cleanup_legacy_plugin_settings()
                run.assert_not_called(); self.assertTrue((legacy / 'main.js').exists())
            empty = root / 'empty/plugins/t-three-code'
            with patch.object(release, 'QLO2_PLUGIN', empty), patch.object(release, 'DEV_PLUGIN', empty):
                self.assertEqual(release.cleanup_legacy_plugin_settings()['status'], 'already-clean')

    def test_publication_archives_recreated_legacy_settings_before_fresh_sync(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); plugin, legacy = self.cleanup_fixture(root)
            current = (plugin / 'data.json').read_bytes(); old = (legacy / 'data.json').read_bytes()
            archive = root / 'release.zip'; hashes = {}
            with zipfile.ZipFile(archive, 'w') as bundle:
                for name in release.RELEASE_FILES:
                    value = b'{"id":"t-three-code","version":"3.4.5"}' if name == 'manifest.json' else name.encode()
                    bundle.writestr('send-to-t3-code/' + name, value); hashes[name] = release.sha256_bytes(value)
            def synced():
                self.assertFalse(legacy.exists()); self.assertEqual((plugin / 'data.json').read_bytes(), current)
                return []
            with patch.object(release, 'ROOT', root), patch.object(release, 'QLO2_PLUGIN', plugin), patch.object(release, 'BACKUPS', root / 'evidence'), patch.object(release, 'run') as run, patch.object(release, 'sync_release', side_effect=synced):
                result = release.deploy_qlo2(archive, '3.4.5', hashes)
            self.assertEqual((Path(result['legacySettingsCleanup']['backup']) / 'data.json').read_bytes(), old)
            self.assertEqual((plugin / 'data.json').read_bytes(), current)
            self.assertEqual(json.loads((plugin / 'manifest.json').read_text())['version'], '3.4.5')

    def test_cleanup_cli_refuses_dirty_source(self):
        with patch.object(release, 'git_state', return_value=('head', [' M unrelated'])), patch.object(release, 'cleanup_legacy_plugin_settings') as cleanup:
            with self.assertRaisesRegex(SystemExit, 'committed reviewed source'):
                release.dispatch(release.parser().parse_args(['--cleanup-legacy-settings']))
            cleanup.assert_not_called()

    def test_bootstrap_owns_its_lock_and_restarts_the_worker_without_an_outer_publication_lock(self) -> None:
        job_id = '202611022300-0123456789abcdef'
        with patch.object(sys, 'argv', [str(SCRIPT), '--bootstrap-queue', job_id]), \
                patch.dict(sys.modules, {release.__name__: release}), \
                patch.object(release.change_checks, 'lock') as outer_lock, \
                patch.object(release.release_queue, 'bootstrap', return_value={'status': 'worker-restart'}) as bootstrap, \
                patch.object(release.release_queue, 'kick') as kick:
            release.main()
            bootstrap.assert_called_once_with(release, release.CANONICAL_ROOT, job_id)
            outer_lock.assert_not_called()
            kick.assert_called_once_with()

    def test_release_commands_follow_the_current_canonical_root_during_queue_bootstrap(self) -> None:
        with tempfile.TemporaryDirectory() as directory, patch.object(release.subprocess, 'run') as command:
            root = Path(directory)
            with patch.object(release, 'ROOT', root):
                release.run(['git', 'status'])
            self.assertEqual(command.call_args.kwargs['cwd'], root)

    def test_id_migration_holds_the_queue_slot_before_installing_over_an_enabled_client(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            plugin = root / 'vault/.obsidian/plugins/send-to-t3-code'
            plugin.mkdir(parents=True)
            (plugin.parent.parent / 'community-plugins.json').write_text('["send-to-t3-code"]')
            archive = root / 'candidate.zip'
            with zipfile.ZipFile(archive, 'w') as bundle:
                for name in release.RUNTIME_FILES:
                    bundle.writestr('send-to-t3-code/' + name, '{"id":"t-three-code"}' if name == 'manifest.json' else name)
            with patch.object(release, 'BACKUPS', root / 'evidence'), patch.object(release, 'QLO2_PLUGIN', plugin), patch.object(release, 'DEV_PLUGIN', plugin), patch.object(release, 'validate_archive', return_value={}), patch.object(release, 'install_runtime') as install, patch.object(release, 'migrate_installation') as migrate:
                with self.assertRaisesRegex(SystemExit, 'disable T3 Code'):
                    release.publish_release('3.4.5', archive, 'reviewed', [], resumed=False)
                install.assert_not_called()
                migrate.assert_not_called()
                self.assertTrue(release.migration_activation('3.4.5')[str(plugin)])

    def test_installed_queue_prevents_a_direct_publication_from_bypassing_its_slots(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); units = root / '.config/systemd/user'; units.mkdir(parents=True)
            (units / (release.release_queue.UNIT + '.service')).write_text('installed')
            with patch.object(release.Path, 'home', return_value=root), patch.object(release, 'new_release') as publish:
                with self.assertRaisesRegex(SystemExit, 'queue owns publication'):
                    release.dispatch(release.parser().parse_args(['--bump', 'patch']))
                publish.assert_not_called()

    def test_prepared_publication_uses_validated_bundle_without_repeating_checks(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); (root / 'dist').mkdir()
            (root / 'package.json').write_text('{"version":"3.4.5"}')
            (root / 'package-lock.json').write_text('{"version":"3.4.5","packages":{"":{"version":"3.4.5"}}}')
            (root / 'manifest.json').write_text('{"version":"3.4.5","minAppVersion":"1"}')
            (root / 'versions.json').write_text('{"3.4.5":"1"}')
            for name in ('styles.css', 'README.md', 'LICENSE'): (root / name).write_text(name)
            plugin = root / 'installed'; plugin.mkdir()
            (plugin / 'manifest.json').write_text('{"version":"3.4.4"}')
            bundle = root / 'validated-main.js'; bundle.write_bytes(b'exact tested bundle')
            (root / 'dist/main.js').write_bytes(b'old untested build')
            proof = root / 'validation.json'; proof.write_text('{}')
            validation = {'bundle': str(bundle), 'testSuite': {'status': 'passed', 'scope': 'affected', 'baseCommit': 'installed'}}
            with patch.object(release, 'ROOT', root), patch.object(release, 'QLO2_PLUGIN', plugin), patch.object(release, 'RECEIPTS', root / 'receipts'), patch.object(release, 'canonical_root_required'), patch.object(release, 'git_state', return_value=('reviewed', [])), patch.object(release.change_checks, 'verify_validation', return_value=validation), patch.object(release.change_checks, 'default_base', return_value='installed'), patch.object(release, 'release_checks') as checks, patch.object(release, 'publish_release') as publish:
                release.publish_prepared('3.4.5', proof)
                checks.assert_not_called()
                self.assertEqual((root / 'dist/main.js').read_bytes(), b'exact tested bundle')
                self.assertTrue(release.archive_path('3.4.5').is_file())
                self.assertTrue(json.loads(release.archive_path('3.4.5').with_suffix('.provenance.json').read_bytes())['testSuite']['reusedPreparedValidation'])
                publish.assert_called_once()

    def test_common_client_check_requires_a_new_loaded_instance_and_preserves_settings(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); plugin = root / 'plugin'; plugin.mkdir()
            for name in release.RELEASE_FILES: (plugin / name).write_bytes(name.encode())
            (plugin / 'data.json').write_bytes(b'{"kept":true}')
            receipts = root / 'receipts'; deployed = receipts / '3.4.5'; deployed.mkdir(parents=True)
            (deployed / 'deployment.json').write_text(json.dumps({'releaseFileSha256': {name: release.sha256_file(plugin / name) for name in release.RELEASE_FILES}}))
            old = {'ok': True, 'client': {'instanceId': 'old', 'loadedVersion': '3.4.5'}}
            new = {'ok': True, 'client': {'instanceId': 'new', 'loadedVersion': '3.4.5'}}
            with patch.object(release, 'canonical_root_required'), patch.object(release, 'QLO2_PLUGIN', plugin), patch.object(release, 'DEV_PLUGIN', plugin), patch.object(release, 'RECEIPTS', receipts), patch.object(release.time, 'sleep'), patch.object(release, 'client_command', side_effect=[old, {'ok': True, 'reloadScheduled': True}, old, new]) as command:
                evidence = release.check_client('3.4.5')
                self.assertEqual(command.call_count, 4)
                self.assertEqual(json.loads(evidence.read_bytes())['after']['client']['instanceId'], 'new')
                command.reset_mock()
                release.check_client('3.4.5')
                command.assert_not_called()
                self.assertEqual((plugin / 'data.json').read_bytes(), b'{"kept":true}')

    def test_plugin_only_release_disables_the_existing_external_writer(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            unit = Path(directory) / 'old.service'
            unit.write_text('old immutable runtime')
            with patch.object(release, 'HOST_UNIT', unit), patch.object(release, 'run') as command:
                self.assertIsNone(release.install_response_host('2.39.0', b'plugin only;'))
                command.assert_called_once_with(['systemctl', '--user', 'disable', '--now', 'send-to-t3-code-response-host.service'])
                self.assertEqual(unit.read_text(), 'old immutable runtime')



    def test_explicit_user_test_skip_preserves_build_and_audit_reason(self) -> None:
        with tempfile.TemporaryDirectory() as directory, patch.object(release, 'run') as command:
            proof = Path(directory) / 'proof.json'
            proof.write_text(json.dumps({'testSuite': {'status': 'passed', 'scope': 'affected'}}))
            with patch.object(release.change_checks, 'default_base', return_value='installed'), patch.object(release.change_checks, 'run_validation', return_value=proof) as validate:
                result = release.release_checks()
                self.assertEqual(result['scope'], 'affected')
                self.assertEqual(result['validationSha256'], release.sha256_file(proof))
                validate.assert_called_once_with(release.ROOT, base='installed', require_build=True)
            command.assert_not_called()
            self.assertEqual(release.release_checks(' forget the full tests '), {'status': 'skipped', 'reason': 'forget the full tests'})
            command.assert_called_once_with(['npm', 'run', 'build'])
            command.reset_mock()
            with self.assertRaises(SystemExit): release.release_checks(' ')
            command.assert_not_called()

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

    def test_later_release_does_not_prevent_completion_of_retained_exact_smoke(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); plugin = root / 'plugin'; plugin.mkdir()
            (plugin / 'manifest.json').write_text('{"version":"3.4.6"}')
            receipts = root / 'releases'; deployed = receipts / '3.4.5'; deployed.mkdir(parents=True)
            files = {name: name.encode() for name in release.RELEASE_FILES}
            files['manifest.json'] = b'{"version":"3.4.5"}'
            hashes = {name: release.sha256_bytes(value) for name, value in files.items()}
            (deployed / 'deployment.json').write_text(json.dumps({'version':'3.4.5','status':'awaiting-live-smoke','releaseFileSha256':hashes}))
            client = {'version':'3.4.5', 'before':{'client':{'instanceId':'old'}},
                      'after':{'client':{'instanceId':'new','loadedVersion':'3.4.5'}},
                      'runtimeSha256':{name:hashes[name] for name in release.RUNTIME_FILES}}
            (deployed / 'client-check.json').write_text(json.dumps(client))
            archive = root / 'archive.zip'
            with zipfile.ZipFile(archive, 'w') as bundle:
                for name, value in files.items(): bundle.writestr('send-to-t3-code/' + name, value)
            evidence = root / 'behavior.json'; evidence.write_text('{"verifiedExactArchivedCandidate":true}')
            with patch.object(release, 'canonical_root_required'), patch.object(release, 'RECEIPTS', receipts), patch.object(release, 'QLO2_PLUGIN', plugin), patch.object(release, 'archive_path', return_value=archive):
                for key in ('runtimeSha256', 'after'):
                    wrong = {**client, key: {}}
                    (deployed / 'client-check.json').write_text(json.dumps(wrong))
                    with self.assertRaisesRegex(SystemExit, 'native-client proof'):
                        release.complete_smoke('3.4.5','native',evidence,'Verified exact archived candidate')
                    self.assertFalse((deployed / 'smoke-native.json').exists())
                (deployed / 'client-check.json').write_text(json.dumps(client))
                # A busy publisher must not block proof for an older release.
                child = f'''import importlib.util, sys
from pathlib import Path
spec = importlib.util.spec_from_file_location('release_fixture', {str(SCRIPT.resolve())!r})
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
root = Path({str(root)!r})
module.CANONICAL_ROOT = root
module.BACKUPS = root / 'evidence'
module.RECEIPTS = root / 'releases'
module.QLO2_PLUGIN = root / 'plugin'
module.archive_path = lambda version: root / 'archive.zip'
module.release_queue.QUEUE = root / 'unused-queue'
sys.argv = ['release-qlo2.py', '--complete-smoke', '3.4.5', '--device', 'native', '--evidence', {str(evidence)!r}, '--notes', 'Verified exact archived candidate']
module.main()
'''
                with release.change_checks.lock(root / 'evidence/release.lock'):
                    completed = subprocess.run([sys.executable, '-c', child], capture_output=True, text=True, timeout=3)
                self.assertEqual(completed.returncode, 0, completed.stderr)
                receipt = json.loads((deployed / 'smoke-native.json').read_text())
                self.assertTrue(receipt['historicalClientProof'])
                self.assertEqual(receipt['installedMainSha256'], hashes['main.js'])
                self.assertEqual(json.loads((plugin / 'manifest.json').read_text())['version'], '3.4.6')

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
            with patch.object(release,'ROOT',root), patch.object(release,'RECEIPTS',root/'receipts'), patch.object(release,'QLO2_PLUGIN',root/'missing-plugin'), patch.object(release,'canonical_root_required'), patch.object(release,'release_checks',return_value={'status':'passed','scope':'affected'}), patch.object(release,'git_state',return_value=(commit,[])), patch.object(release,'publish_release',side_effect=RuntimeError('Sync failure')):
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

    def test_committed_candidate_packages_and_resumes_exactly_its_release_commit(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); (root / 'dist').mkdir()
            (root / '.gitignore').write_text('/release/\n/receipts/\n')
            for name in release.RELEASE_FILES:
                (root / ('dist/main.js' if name == 'main.js' else name)).write_bytes(name.encode())
            (root / 'package.json').write_text('{"version":"1.0.0"}')
            (root / 'package-lock.json').write_text('{"version":"1.0.0","packages":{"":{"version":"1.0.0"}}}')
            (root / 'manifest.json').write_text('{"version":"1.0.0","minAppVersion":"1.8.7"}')
            (root / 'versions.json').write_text('{"1.0.0":"1.8.7"}')
            for name, value in release.version_updates('1.0.1', {name: (root / name).read_bytes() for name in release.release_queue.VERSION_FILES}).items():
                (root / name).write_bytes(value)
            subprocess.run(['git', 'init', '-q', str(root)], check=True)
            subprocess.run(['git', '-C', str(root), 'add', '.'], check=True)
            subprocess.run(['git', '-C', str(root), '-c', 'user.name=Test', '-c', 'user.email=test@example.com',
                            'commit', '-qm', 'Release 1.0.1: Example change'], check=True)
            commit = subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip()
            with patch.object(release, 'ROOT', root), patch.object(release, 'CANONICAL_ROOT', root), \
                 patch.object(release, 'RECEIPTS', root / 'receipts'), patch.object(release, 'QLO2_PLUGIN', root / 'missing-plugin'), \
                 patch.object(release, 'release_checks', return_value={'status': 'passed', 'scope': 'affected'}) as checks, \
                 patch.object(release, 'publish_release', side_effect=RuntimeError('Sync unavailable')):
                with self.assertRaisesRegex(RuntimeError, 'Sync unavailable'):
                    release.new_release(None, False, '1.0.1', committed_version=True)
                checks.assert_called_once()
                archive = release.archive_path('1.0.1')
                checksum = release.sha256_file(archive)
                provenance = release.read_json(archive.with_suffix('.provenance.json'))
                self.assertEqual(provenance['gitCommit'], commit)
                self.assertFalse(provenance['dirtySourceAuthorized'])
                self.assertEqual(provenance['versionFileSha256'], provenance['originalVersionFileSha256'])
                self.assertEqual(subprocess.check_output(['git', '-C', str(root), 'status', '--porcelain=v1']), b'')
                with patch.object(release, 'publish_release') as publish, patch.object(release, 'release_checks') as recheck:
                    release.resume_release('1.0.1', False)
                    publish.assert_called_once_with('1.0.1', archive, commit, [], resumed=True, skip_laptop_reload=False)
                    recheck.assert_not_called()
                self.assertEqual(release.sha256_file(archive), checksum)
                self.assertEqual(release.validate_archive(archive, '1.0.1')['manifest.json'],
                                 release.sha256_file(root / 'manifest.json'))

    def test_committed_candidate_requires_exact_clean_version_and_keeps_legacy_preflight_strict(self):
        with patch.object(release, 'canonical_root_required'), patch.object(release, 'git_state', return_value=('commit', [])), \
             patch.object(release, 'read_json', return_value={'version': '1.0.1'}), patch.object(release, 'set_version') as mutate, \
             patch.object(release.release_policy, 'policy', return_value=None):
            for version in (None, '1.0.2', '1.0.0'):
                with self.assertRaisesRegex(SystemExit, 'clean committed candidate'):
                    release.new_release(None, False, version, committed_version=True)
            with self.assertRaisesRegex(SystemExit, 'strictly newer than the source'):
                release.new_release(None, False, '1.0.1')
            with patch.object(release, 'git_state', return_value=('commit', [' M styles.css'])):
                with self.assertRaisesRegex(SystemExit, 'dirty'):
                    release.new_release(None, True, '1.0.1', committed_version=True)
            mutate.assert_not_called()

    def test_enqueue_preserves_the_selected_semantic_release_type(self) -> None:
        for selection, expected in [(None, 'patch'), ('patch', 'patch'), ('minor', 'minor'), ('major', 'major'), ('none', 'none')]:
            arguments = ['--enqueue', 'HEAD'] + (['--release-type', selection] if selection else [])
            args = release.parser().parse_args(arguments)
            with patch.object(release, 'git_state', return_value=('commit', [])), \
                    patch.object(release.release_queue, 'enqueue', return_value={'jobId': 'test'}) as enqueue, \
                    patch.object(release.release_queue, 'kick') as kick, patch('builtins.print'):
                release.dispatch(args)
                self.assertEqual(enqueue.call_args.kwargs['bump'], expected)
                self.assertEqual(enqueue.call_args.args, (release.ROOT, release.CANONICAL_ROOT, 'HEAD'))
                kick.assert_called_once()

    def test_release_type_cannot_override_another_action(self) -> None:
        for arguments in [
                ['--bump', 'patch', '--release-type', 'major'],
                ['--queue-status', '--release-type', 'minor']]:
            with patch.object(release.release_queue, 'enqueue') as enqueue:
                with self.assertRaisesRegex(SystemExit, 'release-type'):
                    release.dispatch(release.parser().parse_args(arguments))
                enqueue.assert_not_called()

    def test_alpha_prepared_candidate_keeps_independent_comparison_classification(self) -> None:
        args = release.parser().parse_args(['--enqueue', 'HEAD', '--validation', 'proof.json', '--release-type', 'minor'])
        with patch.object(release, 'git_state', return_value=('commit', [])), patch.object(release.release_queue, 'enqueue', return_value={}) as enqueue, patch.object(release.release_queue, 'kick'), patch('builtins.print'):
            release.dispatch(args)
        self.assertEqual(enqueue.call_args.kwargs['bump'], 'minor')
        self.assertEqual(enqueue.call_args.kwargs['validation'], Path('proof.json').resolve())

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
