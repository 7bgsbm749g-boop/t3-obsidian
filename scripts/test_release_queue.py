from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import json
import importlib.util
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from scripts import release_queue as queue

SPEC = importlib.util.spec_from_file_location('queue_publisher', Path(__file__).with_name('release-qlo2.py'))
publisher = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(publisher)


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
        documents = {'package.json': {'version': '1.0.0'},
                     'package-lock.json': {'version': '1.0.0', 'packages': {'': {'version': '1.0.0'}}},
                     'manifest.json': {'version': '1.0.0', 'minAppVersion': '1.8.7'},
                     'versions.json': {'1.0.0': '1.8.7'}}
        for name, value in documents.items():
            queue.write(self.root / name, value)
        self.git('add', '.'); self.git('commit', '-qm', 'base')
        self.published = []
        self.evidence = self.directory / 'behavior.json'; self.evidence.write_text('{"realFixture":"retained"}')
        self.release = SimpleNamespace(ROOT=self.root, BACKUPS=self.backups,
            canonical_root_required=lambda: None, read_json=queue.read, version_updates=publisher.version_updates,
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

    def publish(self, bump, dirty, version, *, committed_version=False):
        self.assertEqual(queue.read(self.root / 'manifest.json')['version'], version)
        self.assertEqual(self.git('status', '--porcelain=v1'), '')
        self.published.append(version)
        self.release.archive_path(version).write_text('immutable bytes')
        path = self.release.release_receipt_dir(version); path.mkdir(parents=True)
        queue.write(path / 'deployment.json', {'version': version, 'gitCommit': self.git('rev-parse', 'HEAD')})
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

    def tooling_source(self, name='repair'):
        source = self.source(name)
        (source / 'scripts').mkdir(exist_ok=True)
        (source / 'scripts/plugin_id_migration.py').write_text('# reviewed discovery repair\n')
        subprocess.run(['git', 'add', '.'], cwd=source, check=True)
        subprocess.run(['git', 'commit', '-qm', 'repair release loader'], cwd=source, check=True)
        return source

    def test_alpha_assignment_ignores_old_numeric_history_and_respects_reserved_builds(self):
        queue.write(self.root / 'release-policy.json', {'schemaVersion': 1, 'stage': 'alpha', 'firstAlphaVersion': '0.0.377-alpha', 'transitionFrom': '1.0.0'})
        source = self.source('alpha-work'); job = self.submit(source)
        directory = queue.job_path(self.store, job['jobId'])
        self.assertEqual(queue.next_version(self.release, directory, {'bump': 'major'}), '0.0.377-alpha')
        queue.write(directory / 'state.json', {'status': 'queued', 'version': '0.0.377-alpha', 'reservedVersions': ['0.0.378-alpha']})
        self.assertEqual(queue.next_version(self.release, directory, {'bump': 'minor'}), '0.0.379-alpha')

    def test_numeric_alpha_assignment_counts_both_formats_and_reserved_builds(self):
        queue.write(self.root / 'release-policy.json', {'schemaVersion': 1, 'stage': 'alpha', 'versionFormat': '0.0.BUILD', 'firstAlphaVersion': '0.0.377-alpha', 'transitionFrom': '2.45.81'})
        source = self.source('numeric-alpha-work'); job = self.submit(source)
        directory = queue.job_path(self.store, job['jobId'])
        queue.write(self.root / 'manifest.json', {'version': '0.0.381-alpha'})
        self.assertEqual(queue.next_version(self.release, directory, {'bump': 'major'}), '0.0.382')
        queue.write(directory / 'state.json', {'status': 'queued', 'version': '0.0.382', 'reservedVersions': ['0.0.383', '2.45.81']})
        self.assertEqual(queue.next_version(self.release, directory, {'bump': 'none'}), '0.0.384')

    def test_bootstrap_integrates_only_the_exact_fifo_tooling_repair_then_restarts(self):
        source = self.tooling_source()
        submitted = self.submit(source)
        self.release.ROOT = source
        result = queue.bootstrap(self.release, self.root, submitted['jobId'], queue=self.store)
        self.assertEqual(result, {'status': 'worker-restart', 'jobId': submitted['jobId'], 'publicationStarted': False})
        self.assertEqual(self.release.ROOT, source)
        self.assertEqual(self.published, [])
        state = queue.read(self.store / 'jobs' / submitted['jobId'] / 'state.json')
        self.assertEqual(state['status'], 'queued')
        self.assertEqual(state['version'], '1.0.1')
        self.assertFalse(self.release.archive_path('1.0.1').exists())
        self.assertEqual((self.root / 'scripts/plugin_id_migration.py').read_bytes(), (source / 'scripts/plugin_id_migration.py').read_bytes())
        self.release.ROOT = self.root
        queue.drain(self.release, queue=self.store)
        self.assertEqual(self.published, ['1.0.1'])

    def test_bootstrap_cannot_overtake_an_earlier_job_or_use_dirty_source(self):
        earlier = self.source('earlier')
        self.submit(earlier)
        source = self.tooling_source()
        submitted = self.submit(source)
        self.release.ROOT = source
        with self.assertRaisesRegex(SystemExit, 'overtake'):
            queue.bootstrap(self.release, self.root, submitted['jobId'], queue=self.store)
        (source / 'unreviewed.ts').write_text('uncommitted')
        with self.assertRaisesRegex(SystemExit, 'clean'):
            queue.bootstrap(self.release, self.root, submitted['jobId'], queue=self.store)
        self.assertEqual(self.published, [])
        self.assertFalse((self.root / 'scripts/plugin_id_migration.py').exists())

    def test_integration_only_worker_cannot_publish_even_if_the_engine_hash_matches(self):
        source = self.source('product')
        submitted = self.submit(source)
        directory = self.store / 'jobs' / submitted['jobId']
        state, request = queue.read(directory / 'state.json'), queue.read(directory / 'request.json')
        self.assertTrue(queue.run_job(self.release, directory, request, state, queue.engine_hash(self.root), integration_only=True))
        self.assertEqual(self.published, [])
        self.assertEqual(queue.read(directory / 'state.json')['version'], '1.0.1')
        self.assertFalse(self.release.archive_path('1.0.1').exists())

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
        def publish(*args, **kwargs):
            events.append('publish'); self.publish(*args, **kwargs)
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

    def test_each_release_has_one_public_commit_with_source_and_exact_version_bytes(self):
        base = self.git('rev-parse', 'HEAD')
        first = self.source('first'); second = self.source('second')
        (first / 'first.ts').write_text('export const value=2;')
        subprocess.run(['git', 'commit', '-qam', 'Improve first change'], cwd=first, check=True)
        a = queue.enqueue(first, self.root, 'HEAD', queue=self.store, evidence=self.evidence,
                          notes='Verified fixture', summary='Improve first change')
        b = self.submit(second)
        queue.drain(self.release, queue=self.store)
        commits = self.git('rev-list', '--reverse', base + '..HEAD').splitlines()
        self.assertEqual(len(commits), 2)
        for job, commit, version, name in [(a, commits[0], '1.0.1', 'first'), (b, commits[1], '1.0.2', 'second')]:
            state = queue.status(job['jobId'], queue=self.store)['jobs'][0]
            self.assertEqual(state['releaseCommit'], commit)
            self.assertEqual(len(self.git('rev-list', '--parents', '-n', '1', commit).split()), 2)
            self.assertFalse(queue.ancestor(self.root, state['sourceCommit'], 'HEAD'))
            self.assertEqual(json.loads(self.git('show', commit + ':manifest.json'))['version'], version)
            self.assertEqual(self.git('show', commit + ':' + name + '.ts'), (self.root / (name + '.ts')).read_text())
            self.assertEqual(queue.read(self.release.release_receipt_dir(version) / 'deployment.json')['gitCommit'], commit)
        self.assertEqual(self.git('show', '-s', '--format=%s', commits[0]), 'Release 1.0.1: Improve first change')
        self.assertEqual(self.git('rev-parse', 'refs/t3-release-queue/sources/' + state['sourceCommit']), state['sourceCommit'])

    def test_later_commit_on_an_old_task_branch_can_edit_its_already_released_source(self):
        source = self.source('first'); self.submit(source)
        queue.drain(self.release, queue=self.store)
        original_source = queue.git(source, 'rev-parse', 'HEAD')
        (source / 'first.ts').write_text('export const value=2;')
        subprocess.run(['git', 'commit', '-qam', 'Improve released source'], cwd=source, check=True)
        second = self.submit(source)
        request = queue.read(queue.job_path(self.store, second['jobId']) / 'request.json')
        self.assertEqual(request['mergeBase'], original_source)
        queue.drain(self.release, queue=self.store)
        self.assertEqual(self.published, ['1.0.1', '1.0.2'])
        self.assertEqual((self.root / 'first.ts').read_text(), 'export const value=2;')

    def test_task_can_build_on_multiple_squashed_sources_without_reapplying_them(self):
        first = self.source('first'); second = self.source('second'); combined = self.source('combined')
        for source in (first, second):
            self.submit(source)
            subprocess.run(['git', 'merge', '--no-edit', '--no-ff', queue.git(source, 'rev-parse', 'HEAD')],
                           cwd=combined, check=True, capture_output=True)
        for name in ('first', 'second'):
            (combined / (name + '.ts')).write_text('export const value=2;')
        subprocess.run(['git', 'commit', '-qam', 'Build on both sources'], cwd=combined, check=True)
        job = self.submit(combined)
        queue.drain(self.release, queue=self.store)
        self.assertEqual(self.published, ['1.0.1', '1.0.2', '1.0.3'])
        self.assertEqual(queue.status(job['jobId'], queue=self.store)['jobs'][0]['status'], 'complete')
        for name in ('first', 'second'):
            self.assertEqual((self.root / (name + '.ts')).read_text(), 'export const value=2;')

    def test_documentation_followup_on_old_task_is_maintenance_and_keeps_later_product_edits(self):
        source = self.source('first'); self.submit(source)
        queue.drain(self.release, queue=self.store)
        removal = self.source('removal')
        subprocess.run(['git', 'rm', 'first.ts'], cwd=removal, check=True, capture_output=True)
        subprocess.run(['git', 'commit', '-qm', 'Remove first feature'], cwd=removal, check=True)
        self.submit(removal); queue.drain(self.release, queue=self.store)
        (source / 'docs').mkdir(); (source / 'docs/followup.md').write_text('Updated instructions')
        subprocess.run(['git', 'add', '.'], cwd=source, check=True)
        subprocess.run(['git', 'commit', '-qm', 'Document followup'], cwd=source, check=True)
        job = self.submit(source, evidence=False)
        request = queue.read(queue.job_path(self.store, job['jobId']) / 'request.json')
        self.assertTrue(request['maintenanceOnly'])
        with patch.object(self.release, 'change_checks', SimpleNamespace(run_validation=lambda root: self.evidence), create=True):
            queue.drain(self.release, queue=self.store)
        self.assertFalse((self.root / 'first.ts').exists())
        self.assertEqual(self.published, ['1.0.1', '1.0.2'])
        self.assertEqual(queue.status(job['jobId'], queue=self.store)['jobs'][0]['delivery'], 'source-only')

    def test_crash_on_either_side_of_fast_forward_resumes_the_same_single_commit(self):
        class WorkerCrash(BaseException):
            pass
        for after_move in (False, True):
            with self.subTest(after_move=after_move):
                base = self.git('rev-parse', 'HEAD')
                source = self.source('crash-' + str(after_move)); job = self.submit(source)
                original_run = self.release.run
                def interrupted(command):
                    if command[:3] == ['git', 'merge', '--ff-only']:
                        if after_move:
                            original_run(command)
                        raise WorkerCrash()
                    return original_run(command)
                with patch.object(self.release, 'run', side_effect=interrupted):
                    with self.assertRaises(WorkerCrash):
                        queue.drain(self.release, queue=self.store)
                state = queue.status(job['jobId'], queue=self.store)['jobs'][0]
                candidate = state['pendingIntegration']['commit']
                self.assertEqual(self.git('rev-parse', 'HEAD'), candidate if after_move else base)
                self.assertEqual(self.git('status', '--porcelain=v1'), '')
                queue.drain(self.release, queue=self.store)
                self.assertEqual(self.git('rev-parse', 'HEAD'), candidate)
                self.assertEqual(self.git('rev-list', '--count', base + '..HEAD'), '1')
                self.assertIsNone(queue.status(job['jobId'], queue=self.store)['jobs'][0]['pendingIntegration'])

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
        def fail(bump, dirty, version, **kwargs):
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
        def publish(*args, **kwargs):
            calls.append(args)
            if len(calls) == 1:
                raise SystemExit('ENOTEMPTY during temporary fixture cleanup')
            self.publish(*args, **kwargs)
        with patch.object(self.release, 'new_release', side_effect=publish):
            self.assertEqual(queue.drain(self.release, queue=self.store)['status'], 'idle')
        self.assertEqual(len(calls), 2)
        state = queue.status(job['jobId'], queue=self.store)['jobs'][0]
        self.assertEqual(state['status'], 'complete')
        self.assertIsNone(state['error'])
        self.assertEqual(len(list(queue.job_path(self.store, job['jobId']).glob('failure-*.json'))), 1)

    def test_bad_candidate_is_reverted_and_a_later_independent_job_publishes(self):
        a = self.submit(self.source('first')); b = self.submit(self.source('second'))
        def publish(*args, **kwargs):
            if (self.root / 'first.ts').exists():
                raise RuntimeError('Deterministic test failure')
            self.publish(*args, **kwargs)
        with patch.object(self.release, 'new_release', side_effect=publish):
            self.assertEqual(queue.drain(self.release, queue=self.store)['status'], 'idle')
        self.assertEqual(queue.status(a['jobId'], queue=self.store)['jobs'][0]['status'], 'failed')
        self.assertEqual(queue.status(b['jobId'], queue=self.store)['jobs'][0]['status'], 'complete')
        self.assertEqual(queue.status(a['jobId'], queue=self.store)['jobs'][0]['version'], '1.0.1')
        self.assertEqual(queue.status(b['jobId'], queue=self.store)['jobs'][0]['version'], '1.0.2')
        self.assertFalse((self.root / 'first.ts').exists())
        self.assertTrue((self.root / 'second.ts').exists())
        self.assertEqual(self.published, ['1.0.2'])
        self.assertEqual(self.git('status', '--porcelain=v1'), '')
        queue.retry(a['jobId'], queue=self.store)
        directory = queue.job_path(self.store, a['jobId'])
        state = queue.read(directory / 'state.json'); state['version'] = '1.0.1'
        queue.write(directory / 'state.json', state)
        queue.drain(self.release, queue=self.store)
        self.assertEqual(self.published, ['1.0.2', '1.0.3'])

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

    def test_descendant_of_reverted_source_waits_while_independent_work_continues(self):
        first = self.source('first'); a = self.submit(first)
        dependent = self.source('dependent')
        subprocess.run(['git', 'merge', '--no-edit', '--no-ff', self.git('rev-parse', 'first')], cwd=dependent, check=True, capture_output=True)
        b = self.submit(dependent); c = self.submit(self.source('third'))
        def publish(*args, **kwargs):
            if (self.root / 'first.ts').exists():
                raise RuntimeError('Bad parent candidate')
            self.publish(*args, **kwargs)
        with patch.object(self.release, 'new_release', side_effect=publish):
            queue.drain(self.release, queue=self.store)
        self.assertEqual(queue.status(b['jobId'], queue=self.store)['jobs'][0]['status'], 'waiting-for-dependency')
        self.assertEqual(queue.status(c['jobId'], queue=self.store)['jobs'][0]['status'], 'complete')
        self.assertFalse((self.root / 'dependent.ts').exists())
        queue.retry(a['jobId'], queue=self.store)
        queue.drain(self.release, queue=self.store)
        self.assertEqual(queue.status(b['jobId'], queue=self.store)['jobs'][0]['status'], 'complete')
        self.assertEqual(self.published, ['1.0.2', '1.0.3', '1.0.4'])

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
        request_path = queue.job_path(self.store, a['jobId']) / 'request.json'
        legacy = queue.read(request_path); legacy.pop('maintenanceOnly')
        queue.write(request_path, legacy)
        validate = SimpleNamespace(run_validation=lambda root: self.evidence)
        with patch.object(self.release, 'change_checks', validate, create=True):
            self.assertEqual(queue.drain(self.release, queue=self.store)['status'], 'idle')
        state = queue.status(a['jobId'], queue=self.store)['jobs'][0]
        self.assertEqual(state['delivery'], 'source-only')
        self.assertEqual(self.published, [])

    def test_upgrade_keeps_an_already_integrated_legacy_maintenance_commit(self):
        source = self.source('maintenance-upgrade')
        subprocess.run(['git', 'rm', 'maintenance-upgrade.ts'], cwd=source, check=True, capture_output=True)
        (source / 'docs').mkdir(); (source / 'docs/queue.md').write_text('New release rules')
        subprocess.run(['git', 'add', '.'], cwd=source, check=True)
        subprocess.run(['git', 'commit', '-qm', 'Update release rules'], cwd=source, check=True)
        job = self.submit(source, evidence=False)
        self.git('merge', '--no-edit', '--no-ff', queue.git(source, 'rev-parse', 'HEAD'))
        existing = self.git('rev-parse', 'HEAD')
        directory = queue.job_path(self.store, job['jobId'])
        queue.write(directory / 'state.json', {'status': 'queued', 'integratedCommit': existing,
                    'ownedIntegrations': [{'commit': existing, 'merge': True}]})
        with patch.object(self.release, 'change_checks', SimpleNamespace(run_validation=lambda root: self.evidence), create=True):
            queue.drain(self.release, queue=self.store)
        self.assertEqual(self.git('rev-parse', 'HEAD'), existing)
        self.assertEqual(queue.status(job['jobId'], queue=self.store)['jobs'][0]['status'], 'complete')
        self.assertEqual(self.published, [])

    def test_upgrade_finishes_a_legacy_archive_without_changing_its_source_commit(self):
        source = self.source('legacy-archive'); job = self.submit(source)
        self.git('merge', '--no-edit', '--no-ff', queue.git(source, 'rev-parse', 'HEAD'))
        legacy_commit = self.git('rev-parse', 'HEAD')
        for name, value in publisher.version_updates('1.0.1', {name: (self.root / name).read_bytes() for name in queue.VERSION_FILES}).items():
            (self.root / name).write_bytes(value)
        archive = self.release.archive_path('1.0.1'); archive.write_bytes(b'legacy immutable archive')
        directory = queue.job_path(self.store, job['jobId'])
        queue.write(directory / 'state.json', {'status': 'retrying', 'version': '1.0.1',
                    'integratedCommit': legacy_commit, 'archive': str(archive),
                    'ownedIntegrations': [{'commit': legacy_commit, 'merge': True}]})
        def resume(version, dirty):
            self.assertEqual(self.git('rev-parse', 'HEAD'), legacy_commit)
            queue.write(self.release.release_receipt_dir(version) / 'deployment.json',
                        {'version': version, 'gitCommit': legacy_commit})
            self.client(version)
        with patch.object(self.release, 'resume_release', side_effect=resume) as resumed, \
             patch.object(self.release, 'new_release') as rebuilt:
            queue.drain(self.release, queue=self.store)
            resumed.assert_called_once_with('1.0.1', False); rebuilt.assert_not_called()
        self.assertEqual(archive.read_bytes(), b'legacy immutable archive')
        self.assertEqual(self.git('status', '--porcelain=v1'), '')
        self.assertEqual(queue.read(self.release.release_receipt_dir('1.0.1') / 'deployment.json')['gitCommit'], legacy_commit)
        self.assertEqual(queue.status(job['jobId'], queue=self.store)['jobs'][0]['status'], 'complete')

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
            self.schedule_retry('2030-01-02T03:04:05.999999+00:00', queue=self.store)
            self.assertIn('OnCalendar=2030-01-02 03:04:06 UTC', (units / (queue.UNIT + '-retry.timer')).read_text())

    def memory_job(self, name='memory-first'):
        source = self.source(name)
        job = queue.enqueue(source, self.root, 'HEAD', thread_id='owning-thread', queue=self.store)
        queue.drain(self.release, queue=self.store)
        clock = patch.object(queue, 'now', return_value='2030-01-01T00:00:00+00:00').start()
        queue.wait_for_memory(job['jobId'], '768M', 'native-watch-' + name, queue=self.store)
        return source, job['jobId'], clock

    def test_verification_memory_wait_requires_a_native_owner_and_watch(self):
        source = self.source('missing-owner'); job = self.submit(source, evidence=False)
        queue.drain(self.release, queue=self.store)
        with self.assertRaisesRegex(ValueError, 'owning native T3 thread'):
            queue.wait_for_memory(job['jobId'], '768M', 'watch', queue=self.store)
        with self.assertRaisesRegex(ValueError, 'scheduledTaskId'):
            queue.wait_for_memory(job['jobId'], '768M', '', queue=self.store)

    def test_registration_cannot_race_a_job_the_worker_can_still_take(self):
        source = self.source('not-paused')
        job = queue.enqueue(source, self.root, 'HEAD', thread_id='owning-thread', queue=self.store)
        with self.assertRaisesRegex(ValueError, 'needs-evidence first'):
            queue.wait_for_memory(job['jobId'], '768M', 'native-watch', queue=self.store)
        self.assertEqual(queue.status(job['jobId'], queue=self.store)['jobs'][0]['status'], 'queued')

    def test_later_release_does_not_reset_probe_deadline_or_block_behind_verification(self):
        _, first, clock = self.memory_job()
        second = self.submit(self.source('memory-second'))
        clock.return_value = '2030-01-01T00:00:10+00:00'
        with patch.object(queue.release_memory, 'probe') as probe:
            self.assertEqual(queue.drain(self.release, queue=self.store)['status'], 'waiting-for-memory')
            probe.assert_not_called()
        self.assertEqual(self.published, ['1.0.1'])
        state = queue.status(first, queue=self.store)['jobs'][0]
        self.assertEqual(state['memoryWait']['nextProbeAt'], '2030-01-01T00:00:30+00:00')
        self.assertEqual(state['memoryWait']['failedProbes'], 0)
        self.assertEqual(queue.status(second['jobId'], queue=self.store)['jobs'][0]['status'], 'complete')
        self.timer.assert_called_with('2030-01-01T00:00:30+00:00', queue=self.store)

    def test_probe_backoff_survives_reloads_and_ready_still_requires_evidence(self):
        source, job, clock = self.memory_job()
        for seconds in [60, 120, 240, 480, 900, 900]:
            state = queue.status(job, queue=self.store)['jobs'][0]
            clock.return_value = state['memoryWait']['nextProbeAt']
            with patch.object(queue.release_memory, 'probe', return_value={'allowed': False, 'reason': 'insufficient_host_headroom'}):
                state = queue.probe_memory(job, queue=self.store)
            self.assertEqual(state['memoryWait']['nextProbeDelaySeconds'], seconds)
            self.assertEqual(state.get('failures', 0), 0)
        clock.return_value = state['memoryWait']['nextProbeAt']
        with patch.object(queue.release_memory, 'probe', return_value={'allowed': True}):
            ready = queue.probe_memory(job, queue=self.store)
        self.assertEqual(ready['status'], 'needs-evidence')
        self.assertTrue(ready['memoryWait']['ready'])
        self.assertEqual(ready['recoveryTaskId'], 'native-watch-memory-first')
        self.assertEqual(queue.drain(self.release, queue=self.store)['status'], 'idle')
        self.assertEqual(self.published, [])
        replacement = queue.submission(source, self.root, 'HEAD', queue=self.store, evidence=self.evidence, notes='Verified after memory recovery')
        queue.retry(job, replacement=replacement, queue=self.store)
        queue.drain(self.release, queue=self.store)
        self.assertEqual(queue.status(job, queue=self.store)['jobs'][0]['status'], 'complete')

    def test_not_due_probe_does_not_contact_manager_and_refusal_race_keeps_backoff(self):
        _, job, clock = self.memory_job()
        with patch.object(queue.release_memory, 'probe') as probe:
            queue.probe_memory(job, queue=self.store);probe.assert_not_called()
        clock.return_value = '2030-01-01T00:00:30+00:00'
        with patch.object(queue.release_memory, 'probe', return_value={'allowed': False}):
            state = queue.probe_memory(job, queue=self.store)
        clock.return_value = state['memoryWait']['nextProbeAt']
        with patch.object(queue.release_memory, 'probe', return_value={'allowed': True}):
            queue.probe_memory(job, queue=self.store)
        repeated = queue.wait_for_memory(job, '768M', 'same-watch', queue=self.store)
        self.assertEqual(repeated['memoryWait']['failedProbes'], 2)
        self.assertEqual(repeated['memoryWait']['nextProbeDelaySeconds'], 120)

    def test_repeated_wait_registration_does_not_push_the_deadline(self):
        _, job, clock = self.memory_job()
        clock.return_value = '2030-01-01T00:00:10+00:00'
        state = queue.wait_for_memory(job, '768M', 'native-watch-memory-first', queue=self.store)
        self.assertEqual(state['memoryWait']['nextProbeAt'], '2030-01-01T00:00:30+00:00')
        self.assertEqual(state['memoryWait']['failedProbes'], 0)

    def test_memory_helper_changes_require_a_fresh_worker(self):
        path = self.root / 'scripts/release_memory.py'; path.parent.mkdir()
        path.write_text('first input')
        before = queue.engine_hash(self.root)
        path.write_text('new input')
        self.assertNotEqual(before['release_memory.py'], queue.engine_hash(self.root)['release_memory.py'])

    def test_tooling_bootstrap_cannot_overtake_an_integrated_memory_wait(self):
        first = self.submit(self.source('held-installation'))
        directory = queue.job_path(self.store, first['jobId'])
        state = queue.read(directory / 'state.json')
        state['integratedCommit'] = self.git('rev-parse', 'HEAD')
        queue.defer_memory(directory, state, '2G', phase='worker', reason='host_memory_pressure')
        source = self.tooling_source(); submitted = self.submit(source)
        self.release.ROOT = source
        with self.assertRaisesRegex(SystemExit, 'overtake'):
            queue.bootstrap(self.release, self.root, submitted['jobId'], queue=self.store)

    def test_worker_refusal_preserves_candidate_and_recovers_without_failure_or_rollback(self):
        first = self.submit(self.source('worker-memory')); self.submit(self.source('worker-later'))
        with patch.object(queue, 'now', return_value='2030-01-01T00:00:00+00:00') as clock:
            with patch.object(self.release, 'new_release', side_effect=RuntimeError('insufficient_host_headroom')):
                result = queue.drain(self.release, queue=self.store)
            self.assertEqual(result['status'], 'waiting-for-memory')
            state = queue.status(first['jobId'], queue=self.store)['jobs'][0]
            self.assertEqual(state.get('failures', 0), 0)
            self.assertFalse(state.get('rollbackCommits'))
            self.assertTrue((self.root / 'worker-memory.ts').exists())
            self.assertEqual(self.published, [])
            clock.return_value = state['memoryWait']['nextProbeAt']
            with patch.object(queue.release_memory, 'probe', return_value={'allowed': True}):
                queue.drain(self.release, queue=self.store)
        self.assertEqual(self.published, ['1.0.1', '1.0.2'])

    def test_memory_wait_before_fast_forward_keeps_the_recorded_candidate_and_fifo_lane(self):
        first = self.submit(self.source('pending-memory')); self.submit(self.source('pending-later'))
        original_run = self.release.run
        def refuse_move(command):
            if command[:3] == ['git', 'merge', '--ff-only']:
                raise SystemExit('Resource manager: insufficient_host_headroom')
            return original_run(command)
        with patch.object(queue, 'now', return_value='2030-01-01T00:00:00+00:00') as clock:
            with patch.object(self.release, 'run', side_effect=refuse_move):
                self.assertEqual(queue.drain(self.release, queue=self.store)['status'], 'waiting-for-memory')
            state = queue.status(first['jobId'], queue=self.store)['jobs'][0]
            candidate = state['pendingIntegration']['commit']
            self.assertFalse(state.get('integratedCommit'))
            self.assertEqual(state.get('failures', 0), 0)
            self.assertEqual(self.published, [])
            clock.return_value = state['memoryWait']['nextProbeAt']
            with patch.object(queue.release_memory, 'probe', return_value={'allowed': True}):
                queue.drain(self.release, queue=self.store)
        self.assertEqual(queue.status(first['jobId'], queue=self.store)['jobs'][0]['releaseCommit'], candidate)
        self.assertEqual(self.published, ['1.0.1', '1.0.2'])

    def test_worker_reads_only_this_attempt_for_admission_refusal(self):
        job = self.submit(self.source('bounded-log')); calls = []
        def fail(*_, **kwargs):
            calls.append(1)
            if len(calls) == 1:
                print('Resource manager: command not started (host_memory_pressure).')
            raise subprocess.CalledProcessError(75, ['temporary-command'])
        with patch.object(queue, 'now', return_value='2030-01-01T00:00:00+00:00') as clock:
            with patch.object(self.release, 'new_release', side_effect=fail):
                queue.drain(self.release, queue=self.store)
                state = queue.status(job['jobId'], queue=self.store)['jobs'][0]
                clock.return_value = state['memoryWait']['nextProbeAt']
                with patch.object(queue.release_memory, 'probe', return_value={'allowed': True}):
                    queue.drain(self.release, queue=self.store)
        state = queue.status(job['jobId'], queue=self.store)['jobs'][0]
        self.assertEqual(state['status'], 'failed')
        self.assertEqual(state['failures'], 3)

    def test_memory_recovery_resumes_the_same_immutable_archive(self):
        job = self.submit(self.source('memory-archive'))
        def packaged_then_refused(_bump, _dirty, version, **kwargs):
            self.release.archive_path(version).write_text('immutable bytes')
            raise SystemExit('Resource manager: insufficient_host_headroom')
        with patch.object(queue, 'now', return_value='2030-01-01T00:00:00+00:00') as clock:
            with patch.object(self.release, 'new_release', side_effect=packaged_then_refused) as create:
                queue.drain(self.release, queue=self.store)
                create.assert_called_once()
            state = queue.status(job['jobId'], queue=self.store)['jobs'][0]
            self.assertEqual(state['version'], '1.0.1')
            clock.return_value = state['memoryWait']['nextProbeAt']
            with patch.object(queue.release_memory, 'probe', return_value={'allowed': True}), \
                 patch.object(self.release, 'new_release') as create, \
                 patch.object(self.release, 'resume_release', wraps=self.release.resume_release) as resume:
                queue.drain(self.release, queue=self.store)
                create.assert_not_called();resume.assert_called_once_with('1.0.1', False)
        self.assertEqual(self.release.archive_path('1.0.1').read_text(), 'immutable bytes')
        self.assertEqual(queue.status(job['jobId'], queue=self.store)['jobs'][0]['status'], 'complete')

    def test_earliest_memory_probe_is_not_hidden_by_an_install_retry(self):
        _, waiting, clock = self.memory_job()
        second = self.submit(self.source('install-wait'))
        directory = queue.job_path(self.store, second['jobId'])
        state = queue.read(directory / 'state.json')
        queue.update(directory, state, status='retrying', nextRetryAt='2030-01-01T00:05:00+00:00')
        self.assertEqual(queue.drain(self.release, queue=self.store)['status'], 'retrying')
        self.timer.assert_called_with('2030-01-01T00:00:30+00:00', queue=self.store)
        self.assertEqual(self.published, [])

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
        replacement = queue.submission(source, self.root, 'HEAD', queue=self.store, evidence=self.evidence, notes='Verified correction')
        # A replacement with only a tooling diff must retain the original
        # product job and all restored behavior-evidence dependencies.
        replacement['maintenanceOnly'] = True
        replacement['sourceInputsSha256'] = {}
        queue.retry(submitted['jobId'], replacement=replacement, queue=self.store)
        self.assertFalse(queue.read(directory / 'request-1.json')['maintenanceOnly'])
        self.assertEqual(queue.read(directory / 'request-1.json')['sourceInputsSha256']['first.ts'],
                         queue.hashlib.sha256((source / 'first.ts').read_bytes()).hexdigest())
        queue.drain(self.release, queue=self.store)
        self.assertEqual(self.published, ['1.0.2'])
        self.assertEqual(queue.status(submitted['jobId'], queue=self.store)['jobs'][0]['status'], 'complete')
        self.assertEqual((directory / 'request.json').read_bytes(), original)
        self.assertTrue((directory / 'request-1.json').exists())
        self.assertEqual(self.submit(source)['jobId'], submitted['jobId'])

    def test_prepared_candidate_keeps_its_checked_version_and_does_not_run_new_checks(self):
        source = self.source('first')
        for name, value in publisher.version_updates('1.0.1', {name: (source / name).read_bytes() for name in queue.VERSION_FILES}).items():
            (source / name).write_bytes(value)
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
