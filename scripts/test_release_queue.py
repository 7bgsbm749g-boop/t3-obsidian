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
        self.assertEqual(result['status'], 'awaiting-smoke')
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

    def test_missing_behavior_smoke_holds_the_slot_until_its_receipt_exists(self):
        a = self.submit(self.source('first'), evidence=False)
        b = self.submit(self.source('second'))
        result = queue.drain(self.release, queue=self.store)
        self.assertEqual(result['status'], 'awaiting-smoke')
        self.assertEqual(self.published, ['1.0.1'])
        self.assertEqual(queue.status(b['jobId'], queue=self.store)['jobs'][0]['status'], 'queued')
        self.smoke('1.0.1', 'native', self.evidence, 'Verified')
        queue.drain(self.release, queue=self.store)
        self.assertEqual(self.published, ['1.0.1', '1.0.2'])
        self.assertEqual(queue.status(a['jobId'], queue=self.store)['jobs'][0]['status'], 'complete')

    def test_install_failure_blocks_following_jobs_and_retry_resumes_the_same_archive(self):
        a = self.submit(self.source('first')); self.submit(self.source('second'))
        def fail(bump, dirty, version):
            self.release.archive_path(version).write_text('immutable bytes')
            raise RuntimeError('Sync failed')
        with patch.object(self.release, 'new_release', side_effect=fail):
            self.assertEqual(queue.drain(self.release, queue=self.store)['status'], 'blocked')
        self.assertEqual(self.published, [])
        self.assertEqual(queue.drain(self.release, queue=self.store)['status'], 'blocked')
        queue.retry(a['jobId'], queue=self.store)
        with patch.object(self.release, 'resume_release', wraps=self.release.resume_release) as resume:
            queue.drain(self.release, queue=self.store)
            resume.assert_called_once_with('1.0.1', False)
        self.assertEqual(self.published, ['1.0.1', '1.0.2'])

    def test_dirty_canonical_checkout_is_preserved_and_no_release_is_attempted(self):
        a = self.submit(self.source('first'))
        user_file = self.root / 'unrelated.txt'; user_file.write_text('user work')
        self.assertEqual(queue.drain(self.release, queue=self.store)['status'], 'blocked')
        self.assertEqual(user_file.read_text(), 'user work')
        self.assertEqual(self.published, [])
        self.assertIn('uncommitted', queue.status(a['jobId'], queue=self.store)['jobs'][0]['error'])

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
            self.assertEqual(queue.drain(self.release, queue=self.store)['status'], 'blocked')
        directory = queue.job_path(self.store, submitted['jobId'])
        original = (directory / 'request.json').read_bytes()
        (source / 'first.ts').write_text('export const value=2;')
        subprocess.run(['git', 'add', '.'], cwd=source, check=True)
        subprocess.run(['git', 'commit', '-qm', 'correct source'], cwd=source, check=True)
        replacement = queue.submission(source, self.root, 'HEAD', evidence=self.evidence, notes='Verified correction')
        queue.retry(submitted['jobId'], replacement=replacement, queue=self.store)
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
