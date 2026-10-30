from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from scripts import release_queue as queue


class ReleaseQueueTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.directory = Path(self.temporary.name)
        self.root = self.directory / 'canonical'; self.root.mkdir()
        self.store = self.directory / 'queue'
        self.backups = self.directory / 'backups'; self.backups.mkdir()
        self.schedule_retry = queue.schedule_retry
        self.timer = patch.object(queue, 'schedule_retry').start()
        self.addCleanup(patch.stopall)
        subprocess.run(['git', 'init', '-q', str(self.root)], check=True)
        self.git('config', 'user.name', 'Test'); self.git('config', 'user.email', 'test@example.com')
        for name in queue.VERSION_FILES:
            (self.root / name).write_text(json.dumps({'version': '1.0.0'}))
        self.git('add', '.'); self.git('commit', '-qm', 'base')
        self.published = []
        self.evidence = self.directory / 'behavior.json'; self.evidence.write_text('{"realFixture":"retained"}')
        self.release = SimpleNamespace(ROOT=self.root, BACKUPS=self.backups,
            canonical_root_required=lambda: None, read_json=queue.read,
            bump_version=lambda value, part: '.'.join([*value.split('.')[:2], str(int(value.split('.')[2])+1)]),
            release_receipt_dir=lambda version: self.backups / 'releases' / version,
            archive_path=lambda version: self.backups / (version + '.zip'),
            sha256_file=lambda path: queue.hashlib.sha256(path.read_bytes()).hexdigest(),
            git_state=lambda: (self.git('rev-parse', 'HEAD'), subprocess.check_output(['git', 'status', '--porcelain=v1'], cwd=self.root, text=True).splitlines()),
            run=lambda command: subprocess.run(command, cwd=self.root, check=True, capture_output=True),
            new_release=self.publish, resume_release=lambda version, dirty: self.publish(None, dirty, version),
            check_client=self.client, complete_smoke=self.smoke)

    def tearDown(self):
        self.temporary.cleanup()

    def git(self, *args):
        return queue.git(self.root, *args)

    def source(self, name):
        path = self.directory / name
        self.git('worktree', 'add', '-qb', name, str(path), 'HEAD')
        (path / (name + '.ts')).write_text('export const value=1;')
        subprocess.run(['git', 'add', '.'], cwd=path, check=True)
        subprocess.run(['git', 'commit', '-qm', name], cwd=path, check=True)
        return path

    def submit(self, source, *, evidence=True):
        return queue.enqueue(source, self.root, 'HEAD', queue=self.store,
                             evidence=self.evidence if evidence else None, notes='Verified fixture' if evidence else '')

    def publish(self, bump, dirty, version):
        self.published.append(version)
        self.release.archive_path(version).write_text('immutable bytes')
        for name in queue.VERSION_FILES:
            value = queue.read(self.root / name); value['version'] = version
            if name == 'package-lock.json':
                value.get('packages', {}).get('', {}).update(version=version)
            (self.root / name).write_text(json.dumps(value))
        path = self.release.release_receipt_dir(version); path.mkdir(parents=True)
        queue.write(path / 'deployment.json', {'version': version})
        self.client(version)

    def client(self, version):
        path = self.release.release_receipt_dir(version) / 'client-check.json'
        queue.write(path, {'version': version, 'newNativeInstance': True})
        return path

    def smoke(self, version, device, evidence, notes):
        queue.write(self.release.release_receipt_dir(version) / ('smoke-' + device + '.json'),
                    {'version': version, 'status': 'complete', 'installedMainSha256': 'bundle', 'evidenceSha256': 'evidence'})

    def dependency_fixture(self):
        package = {'name': 'fixture', 'version': '1.0.0', 'dependencies': {'grammar': '1.0.0'}}
        lock = {'name': 'fixture', 'version': '1.0.0', 'lockfileVersion': 3,
                'packages': {'': package.copy(), 'node_modules/grammar': {'version': '1.0.0'}}}
        queue.write(self.root / 'package.json', package)
        queue.write(self.root / 'package-lock.json', lock)

    def test_dependency_install_is_cached_but_lock_changes_require_a_new_install(self):
        self.dependency_fixture()
        with patch.object(queue.subprocess, 'run', side_effect=lambda *args, **kwargs: (self.root / 'node_modules').mkdir(exist_ok=True)) as install:
            queue.ensure_dependencies(self.root)
            queue.ensure_dependencies(self.root)
            install.assert_called_once_with(['npm', 'ci', '--no-audit', '--no-fund'], cwd=self.root, check=True, timeout=300)
            for name in ('package.json', 'package-lock.json'):
                value = queue.read(self.root / name); value['version'] = '1.0.1'
                if name == 'package-lock.json':
                    value['packages']['']['version'] = '1.0.1'
                queue.write(self.root / name, value)
            queue.ensure_dependencies(self.root)
            self.assertEqual(install.call_count, 1)
            value = queue.read(self.root / 'package-lock.json')
            value['packages']['node_modules/grammar']['version'] = '1.0.1'
            queue.write(self.root / 'package-lock.json', value)
            queue.ensure_dependencies(self.root)
            self.assertEqual(install.call_count, 2)

    def test_failed_or_changed_dependency_install_never_records_success(self):
        self.dependency_fixture()
        marker = self.root / 'evidence/release-dependencies.json'
        with patch.object(queue.subprocess, 'run', side_effect=subprocess.CalledProcessError(1, ['npm', 'ci'])):
            with self.assertRaises(subprocess.CalledProcessError):
                queue.ensure_dependencies(self.root)
        self.assertFalse(marker.exists())
        def change_inputs(*args, **kwargs):
            value = queue.read(self.root / 'package.json'); value['dependencies']['grammar'] = '2.0.0'
            queue.write(self.root / 'package.json', value)
        with patch.object(queue.subprocess, 'run', side_effect=change_inputs):
            with self.assertRaisesRegex(SystemExit, 'inputs changed'):
                queue.ensure_dependencies(self.root)
        self.assertFalse(marker.exists())

    def test_worker_installs_dependencies_before_publication(self):
        source = self.source('first'); self.submit(source)
        events = []
        def publish(*args):
            events.append('publish'); self.publish(*args)
        with patch.object(queue, 'ensure_dependencies', side_effect=lambda root: events.append('dependencies')), patch.object(self.release, 'new_release', side_effect=publish):
            queue.drain(self.release, queue=self.store)
        self.assertEqual(events, ['dependencies', 'publish'])

    def test_behavior_evidence_is_not_reused_after_integrated_dependency_changes(self):
        source = self.source('first'); job = self.submit(source)
        value = queue.read(self.root / 'package.json'); value['description'] = 'Different package input'
        queue.write(self.root / 'package.json', value)
        self.git('add', 'package.json'); self.git('commit', '-qm', 'package update')
        result = queue.drain(self.release, queue=self.store)
        self.assertEqual(result['status'], 'idle')
        self.assertEqual(self.published, ['1.0.1'])
        self.assertFalse(queue.status(job['jobId'], queue=self.store)['jobs'][0]['suppliedBehaviorInputsMatch'])

    def test_fifo_integrates_independent_worktrees_and_assigns_distinct_versions(self):
        first = self.source('first'); second = self.source('second')
        a = self.submit(first); b = self.submit(second)
        self.assertEqual(queue.drain(self.release, queue=self.store)['status'], 'idle')
        self.assertEqual(self.published, ['1.0.1', '1.0.2'])
        self.assertTrue((self.root / 'first.ts').exists()); self.assertTrue((self.root / 'second.ts').exists())
        self.assertEqual([job['status'] for job in queue.status(queue=self.store)['jobs']], ['complete', 'complete'])
        self.assertLess(a['jobId'], b['jobId'])
        self.assertEqual(self.git('status', '--porcelain=v1'), '')

    def test_concurrent_submissions_are_idempotent_and_a_second_worker_cannot_publish(self):
        source = self.source('first')
        with ThreadPoolExecutor(max_workers=3) as pool:
            submitted = list(pool.map(lambda _: self.submit(source), range(3)))
        self.assertEqual(len({item['jobId'] for item in submitted}), 1)
        with queue.locked(self.store / 'worker.lock'):
            self.assertEqual(queue.drain(self.release, queue=self.store)['status'], 'worker-running')
        self.assertEqual(self.published, [])
        queue.drain(self.release, queue=self.store)
        queue.drain(self.release, queue=self.store)
        self.assertEqual(self.published, ['1.0.1'])

    def test_missing_behavior_evidence_defers_without_publishing_or_holding_the_lane(self):
        a = self.submit(self.source('first'), evidence=False)
        b = self.submit(self.source('second'))
        result = queue.drain(self.release, queue=self.store)
        self.assertEqual(result['status'], 'idle')
        self.assertEqual(self.published, ['1.0.1'])
        self.assertEqual(queue.status(b['jobId'], queue=self.store)['jobs'][0]['status'], 'complete')
        self.assertEqual(queue.status(a['jobId'], queue=self.store)['jobs'][0]['status'], 'needs-evidence')
        self.assertFalse((self.root / 'first.ts').exists())

    def test_install_failure_arms_durable_retry_and_resumes_the_same_archive(self):
        a = self.submit(self.source('first')); self.submit(self.source('second'))
        def fail(bump, dirty, version):
            self.release.archive_path(version).write_text('immutable bytes')
            raise RuntimeError('Sync failed')
        with patch.object(self.release, 'new_release', side_effect=fail), patch.object(self.release, 'resume_release', side_effect=RuntimeError('Sync unavailable')):
            self.assertEqual(queue.drain(self.release, queue=self.store)['status'], 'retrying')
        self.assertEqual(self.published, [])
        self.assertEqual(queue.drain(self.release, queue=self.store)['status'], 'retrying')
        self.timer.assert_called()
        queue.retry(a['jobId'], queue=self.store)
        with patch.object(self.release, 'resume_release', wraps=self.release.resume_release) as resume:
            queue.drain(self.release, queue=self.store)
            resume.assert_called_once_with('1.0.1', False)
        self.assertEqual(self.published, ['1.0.1', '1.0.2'])

    def test_dirty_canonical_checkout_is_preserved_and_no_release_is_attempted(self):
        a = self.submit(self.source('first'))
        user_file = self.root / 'unrelated.txt'; user_file.write_text('user work')
        self.assertEqual(queue.drain(self.release, queue=self.store)['status'], 'retrying')
        self.assertEqual(user_file.read_text(), 'user work')
        self.assertEqual(self.published, [])
        self.assertIn('uncommitted', queue.status(a['jobId'], queue=self.store)['jobs'][0]['error'])

    def test_transient_check_failure_retries_without_an_operator(self):
        job = self.submit(self.source('first'))
        calls = []
        def publish(*args):
            calls.append(args)
            if len(calls) == 1:
                raise SystemExit('ENOTEMPTY during temporary fixture cleanup')
            self.publish(*args)
        with patch.object(self.release, 'new_release', side_effect=publish):
            self.assertEqual(queue.drain(self.release, queue=self.store)['status'], 'idle')
        self.assertEqual(len(calls), 2)
        state = queue.status(job['jobId'], queue=self.store)['jobs'][0]
        self.assertEqual(state['status'], 'complete')
        self.assertIsNone(state['error'])
        self.assertEqual(len(list(queue.job_path(self.store, job['jobId']).glob('failure-*.json'))), 1)

    def test_bad_candidate_is_reverted_and_a_later_independent_job_publishes(self):
        a = self.submit(self.source('first')); b = self.submit(self.source('second'))
        def publish(*args):
            if (self.root / 'first.ts').exists():
                raise RuntimeError('Deterministic test failure')
            self.publish(*args)
        with patch.object(self.release, 'new_release', side_effect=publish):
            self.assertEqual(queue.drain(self.release, queue=self.store)['status'], 'idle')
        self.assertEqual(queue.status(a['jobId'], queue=self.store)['jobs'][0]['status'], 'failed')
        self.assertEqual(queue.status(b['jobId'], queue=self.store)['jobs'][0]['status'], 'complete')
        self.assertFalse((self.root / 'first.ts').exists())
        self.assertTrue((self.root / 'second.ts').exists())
        self.assertEqual(self.published, ['1.0.1'])
        self.assertEqual(self.git('status', '--porcelain=v1'), '')

    def test_independent_validation_registrations_merge_without_losing_a_mode(self):
        name = 'scripts/build-native-response-lab.mjs'
        (self.root / 'scripts').mkdir()
        def builder(extra=''):
            return ("if(!['--base'" + (",'--" + extra + "'" if extra else '') + "].some(flag=>process.argv.includes(flag)))throw Error('mode');\n" +
                    "await build({entryPoints:[process.argv.includes('--base')?'validation/base.ts':" +
                    (f"process.argv.includes('--{extra}')?'validation/{extra}.ts':" if extra else '') +
                    "'validation/fallback.ts'],bundle:true});\n")
        (self.root / name).write_text(builder())
        self.git('add', '.'); self.git('commit', '-qm', 'lab baseline')
        first = self.source('first'); second = self.source('second')
        for source, mode in [(first, 'first'), (second, 'second')]:
            (source / name).write_text(builder(mode))
            subprocess.run(['git', 'add', '.'], cwd=source, check=True)
            subprocess.run(['git', 'commit', '-qm', 'add mode'], cwd=source, check=True)
            self.submit(source)
        self.assertEqual(queue.drain(self.release, queue=self.store)['status'], 'idle')
        combined = (self.root / name).read_text()
        self.assertIn("'--base','--first','--second'", combined)
        self.assertIn("?'validation/first.ts':", combined)
        self.assertIn("?'validation/second.ts':", combined)
        self.assertEqual(self.published, ['1.0.1', '1.0.2'])
        self.assertEqual(self.git('status', '--porcelain=v1'), '')

    def test_product_conflict_is_not_resolved_automatically_and_a_later_job_runs(self):
        (self.root / 'shared.ts').write_text('base\n')
        self.git('add', '.'); self.git('commit', '-qm', 'shared baseline')
        first = self.source('first'); second = self.source('second'); third = self.source('third')
        for source, text in [(first, 'accepted'), (second, 'conflict')]:
            (source / 'shared.ts').write_text(text + '\n')
            subprocess.run(['git', 'add', '.'], cwd=source, check=True)
            subprocess.run(['git', 'commit', '-qm', text], cwd=source, check=True)
        a = self.submit(first); b = self.submit(second); c = self.submit(third)
        self.assertEqual(queue.drain(self.release, queue=self.store)['status'], 'idle')
        self.assertEqual(queue.status(b['jobId'], queue=self.store)['jobs'][0]['status'], 'failed')
        self.assertEqual(queue.status(c['jobId'], queue=self.store)['jobs'][0]['status'], 'complete')
        self.assertEqual((self.root / 'shared.ts').read_text(), 'accepted\n')
        self.assertEqual(self.git('status', '--porcelain=v1'), '')

    def test_legacy_blocked_job_is_recovered_automatically(self):
        a = self.submit(self.source('first'))
        directory = queue.job_path(self.store, a['jobId'])
        queue.write(directory / 'state.json', {'status': 'blocked', 'updatedAt': queue.now(), 'error': 'Old failure'})
        self.assertEqual(queue.drain(self.release, queue=self.store)['status'], 'idle')
        self.assertEqual(queue.status(a['jobId'], queue=self.store)['jobs'][0]['status'], 'complete')

    def test_pending_smoke_does_not_hold_the_lane_or_claim_completion(self):
        a = self.submit(self.source('first')); b = self.submit(self.source('second'))
        with patch.object(queue, 'completed_smoke', return_value=False), patch.object(self.release, 'complete_smoke'):
            # Evidence is retained, but integration changed the first job's input.
            request = queue.job_path(self.store, a['jobId']) / 'request.json'
            value = queue.read(request); value['sourceInputsSha256']['first.ts'] = 'old-input'
            queue.write(request, value)
            self.assertEqual(queue.drain(self.release, queue=self.store)['status'], 'idle')
        self.assertEqual(self.published, ['1.0.1', '1.0.2'])
        self.assertEqual(queue.status(a['jobId'], queue=self.store)['jobs'][0]['status'], 'awaiting-smoke')
        self.assertEqual(queue.status(b['jobId'], queue=self.store)['jobs'][0]['status'], 'complete')
        self.smoke('1.0.1', 'native', self.evidence, 'Verified exact archived candidate')
        queue.drain(self.release, queue=self.store)
        self.assertEqual(queue.status(a['jobId'], queue=self.store)['jobs'][0]['status'], 'complete')

    def test_tooling_only_job_validates_without_a_plugin_release(self):
        source = self.source('first')
        subprocess.run(['git', 'rm', 'first.ts'], cwd=source, check=True, capture_output=True)
        (source / 'docs').mkdir(); (source / 'docs/queue.md').write_text('Recovery instructions')
        subprocess.run(['git', 'add', '.'], cwd=source, check=True)
        subprocess.run(['git', 'commit', '-qm', 'maintenance'], cwd=source, check=True)
        a = self.submit(source, evidence=False)
        validate = SimpleNamespace(run_validation=lambda root: self.evidence)
        with patch.object(self.release, 'change_checks', validate, create=True):
            self.assertEqual(queue.drain(self.release, queue=self.store)['status'], 'idle')
        state = queue.status(a['jobId'], queue=self.store)['jobs'][0]
        self.assertEqual(state['delivery'], 'source-only')
        self.assertEqual(self.published, [])

    def test_retry_timer_is_a_persistent_single_deadline_and_worker_restarts_after_crashes(self):
        home = self.directory / 'home'
        units = home / '.config/systemd/user'; units.mkdir(parents=True)
        with patch.object(queue.Path, 'home', return_value=home), patch.object(queue.subprocess, 'run'):
            queue.install(self.root, queue=self.store)
            self.assertIn('Restart=on-failure', (units / (queue.UNIT + '.service')).read_text())
        with patch.object(queue.Path, 'home', return_value=home), patch.object(queue.subprocess, 'run') as command:
            self.schedule_retry('2030-01-02T03:04:05+00:00', queue=self.store)
            timer = (units / (queue.UNIT + '-retry.timer')).read_text()
            self.assertIn('OnCalendar=2030-01-02 03:04:05 UTC', timer)
            self.assertIn('Persistent=true', timer)
            self.assertIn('WantedBy=timers.target', timer)
            self.assertNotIn('OnUnitInactiveSec', timer)
            command.assert_any_call(['systemctl', '--user', 'restart', queue.UNIT + '-retry.timer'], check=True, timeout=10)

    def test_conflicting_restore_aborts_its_own_revert_and_preserves_later_source(self):
        self.git('checkout', '-qb', 'fixture')
        (self.root / 'first.ts').write_text('original')
        self.git('add', '.'); self.git('commit', '-qm', 'original')
        original = self.git('rev-parse', 'HEAD')
        self.git('revert', '--no-edit', original)
        removal = self.git('rev-parse', 'HEAD')
        (self.root / 'first.ts').write_text('later independent change')
        self.git('add', '.'); self.git('commit', '-qm', 'later')
        with self.assertRaises(subprocess.CalledProcessError):
            queue.revert_owned(self.release, removal)
        self.assertEqual((self.root / 'first.ts').read_text(), 'later independent change')
        self.assertEqual(self.git('status', '--porcelain=v1'), '')

    def test_updated_release_engine_restarts_before_validating_with_old_code(self):
        source = self.source('first')
        (source / 'scripts').mkdir(); (source / 'scripts/change_checks.py').write_text('# updated engine')
        subprocess.run(['git', 'add', '.'], cwd=source, check=True)
        subprocess.run(['git', 'commit', '-qm', 'update engine'], cwd=source, check=True)
        a = self.submit(source)
        self.assertEqual(queue.drain(self.release, queue=self.store)['status'], 'worker-restart')
        self.assertTrue((self.store / 'wake').exists())
        self.assertEqual(self.published, [])
        self.assertEqual(queue.status(a['jobId'], queue=self.store)['jobs'][0]['status'], 'queued')
        self.assertEqual(queue.drain(self.release, queue=self.store)['status'], 'idle')
        self.assertEqual(self.published, ['1.0.1'])

    def test_corrected_source_retries_the_original_slot_and_preserves_the_original_request(self):
        source = self.source('first'); submitted = self.submit(source)
        with patch.object(self.release, 'new_release', side_effect=RuntimeError('test failed')):
            self.assertEqual(queue.drain(self.release, queue=self.store)['status'], 'idle')
        self.assertEqual(queue.status(submitted['jobId'], queue=self.store)['jobs'][0]['status'], 'failed')
        self.assertFalse((self.root / 'first.ts').exists())
        directory = queue.job_path(self.store, submitted['jobId'])
        original = (directory / 'request.json').read_bytes()
        (source / 'first.ts').write_text('export const value=2;')
        subprocess.run(['git', 'add', '.'], cwd=source, check=True)
        subprocess.run(['git', 'commit', '-qm', 'correct source'], cwd=source, check=True)
        replacement = queue.submission(source, self.root, 'HEAD', evidence=self.evidence, notes='Verified correction')
        # A replacement with only a tooling diff must retain the original
        # product job and all restored behavior-evidence dependencies.
        replacement['maintenanceOnly'] = True
        queue.retry(submitted['jobId'], replacement=replacement, queue=self.store)
        self.assertFalse(queue.read(directory / 'request-1.json')['maintenanceOnly'])
        queue.drain(self.release, queue=self.store)
        self.assertEqual(self.published, ['1.0.1'])
        self.assertEqual((directory / 'request.json').read_bytes(), original)
        self.assertTrue((directory / 'request-1.json').exists())
        self.assertEqual(self.submit(source)['jobId'], submitted['jobId'])

    def test_prepared_candidate_keeps_its_checked_version_and_does_not_run_new_checks(self):
        source = self.source('first')
        for name in queue.VERSION_FILES:
            (source / name).write_text(json.dumps({'version': '1.0.1'}))
        subprocess.run(['git', 'add', '.'], cwd=source, check=True)
        subprocess.run(['git', 'commit', '-qm', 'prepared version'], cwd=source, check=True)
        proof = self.directory / 'proof.json'; proof.write_text('{"checked":"final bytes"}')
        queue.enqueue(source, self.root, 'HEAD', queue=self.store, validation=proof,
                      evidence=self.evidence, notes='Verified prepared candidate')
        prepared = lambda version, validation: self.publish(None, False, version)
        with patch.object(self.release, 'publish_prepared', side_effect=prepared, create=True) as publish, patch.object(self.release, 'new_release') as fresh:
            self.assertEqual(queue.drain(self.release, queue=self.store)['status'], 'idle')
            fresh.assert_not_called(); publish.assert_called_once_with('1.0.1', proof)
        self.assertEqual(self.published, ['1.0.1'])


if __name__ == '__main__':
    unittest.main()
