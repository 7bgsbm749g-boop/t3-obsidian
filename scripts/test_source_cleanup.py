from pathlib import Path
import json
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from scripts import source_cleanup


class SourceCleanupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'canonical'; self.root.mkdir()
        self.run_git(self.root, 'init', '-q')
        self.run_git(self.root, 'config', 'user.name', 'Test'); self.run_git(self.root, 'config', 'user.email', 'test@example.com')
        (self.root / 'README.md').write_text('base')
        self.run_git(self.root, 'add', '.'); self.run_git(self.root, 'commit', '-qm', 'base')
        self.source = Path(self.temp.name) / 'task'
        self.run_git(self.root, 'worktree', 'add', '-qb', 'task', str(self.source))
        self.commit = self.run_git(self.source, 'rev-parse', 'HEAD')
        self.request = {'sourceRoot': str(self.source), 'sourceBranch': 'task', 'commit': self.commit}

    def run_git(self, root, *args):
        return subprocess.check_output(['git', '-C', str(root), *args], text=True, stderr=subprocess.DEVNULL).strip()

    def test_branch_is_removed_after_owning_app_removed_the_checkout(self):
        self.run_git(self.root, 'worktree', 'remove', str(self.source))
        self.assertEqual(source_cleanup.cleanup(self.root, self.request), {'status': 'removed'})
        self.assertEqual(self.run_git(self.root, 'branch', '--list', 'task'), '')

    def test_dirty_files_and_newer_commits_are_protected(self):
        (self.source / 'AGENTS.md').write_text('unfinished instructions')
        result = source_cleanup.cleanup(self.root, self.request)
        self.assertEqual(result['status'], 'blocked'); self.assertIn('uncommitted', result['reason'])
        self.run_git(self.source, 'add', '.'); self.run_git(self.source, 'commit', '-qm', 'new work')
        self.assertEqual(source_cleanup.cleanup(self.root, self.request)['status'], 'blocked')
        self.assertTrue(self.source.exists()); self.assertNotEqual(self.run_git(self.root, 'branch', '--list', 'task'), '')

    def test_another_checkout_is_never_removed(self):
        moved = Path(self.temp.name) / 'another-task'
        self.run_git(self.root, 'worktree', 'move', str(self.source), str(moved))
        result = source_cleanup.cleanup(self.root, self.request)
        self.assertEqual(result['status'], 'blocked'); self.assertTrue(moved.exists())

    def test_retained_ignored_files_block_removal(self):
        (self.source / '.git/info').exists()
        common = Path(self.run_git(self.root, 'rev-parse', '--path-format=absolute', '--git-common-dir'))
        (common / 'info/exclude').write_text('evidence/\n')
        (self.source / 'evidence').mkdir(); (self.source / 'evidence/proof.json').write_text('{}')
        self.assertEqual(source_cleanup.cleanup(self.root, self.request)['status'], 'blocked')

    def test_clean_checkout_uses_t3_before_deleting_its_exact_branch(self):
        original_run = subprocess.run
        def execute(args, **kwargs):
            if args[0] == 'node':
                self.assertEqual(json.loads(kwargs['input'])['commit'], self.commit)
                self.run_git(self.root, 'worktree', 'remove', str(self.source))
                return subprocess.CompletedProcess(args, 0, json.dumps({'status': 'removed'}), '')
            return original_run(args, **kwargs)
        with patch.object(source_cleanup.maintainer_config, 'configuration', return_value={'t3Command': 't3', 't3BaseDir': '/private/t3'}), patch.object(source_cleanup.subprocess, 'run', side_effect=execute):
            self.assertEqual(source_cleanup.cleanup(self.root, self.request), {'status': 'removed'})
        self.assertFalse(self.source.exists()); self.assertEqual(self.run_git(self.root, 'branch', '--list', 'task'), '')

    def test_active_app_work_leaves_both_checkout_and_branch(self):
        original_run = subprocess.run
        def execute(args, **kwargs):
            if args[0] == 'node':
                return subprocess.CompletedProcess(args, 0, json.dumps({'status': 'pending', 'reason': 'A T3 thread still uses the checkout.'}), '')
            return original_run(args, **kwargs)
        with patch.object(source_cleanup.maintainer_config, 'configuration', return_value={'t3Command': 't3', 't3BaseDir': '/private/t3'}), patch.object(source_cleanup.subprocess, 'run', side_effect=execute):
            self.assertEqual(source_cleanup.cleanup(self.root, self.request)['status'], 'pending')
        self.assertTrue(self.source.exists()); self.assertNotEqual(self.run_git(self.root, 'branch', '--list', 'task'), '')

    def delivered(self):
        (self.source / 'feature.txt').write_text('reviewed feature')
        self.run_git(self.source, 'add', '.'); self.run_git(self.source, 'commit', '-qm', 'feature')
        self.commit = self.run_git(self.source, 'rev-parse', 'HEAD')
        self.request['commit'] = self.commit
        self.run_git(self.root, 'merge', '--squash', 'task'); self.run_git(self.root, 'commit', '-qm', 'published squash')
        target = self.run_git(self.root, 'rev-parse', 'HEAD')
        self.run_git(self.root, 'update-ref', 'refs/remotes/origin/main', target)
        return target, {**self.request, 'path': str(self.source), 'branch': 'task'}

    def test_alignment_clears_shipped_diff_and_keeps_original_source_reachable(self):
        target, request = self.delivered()
        self.assertNotEqual(self.run_git(self.source, 'diff', 'refs/remotes/origin/main...HEAD'), '')
        result = source_cleanup.align_source(self.root, request, target)
        self.assertEqual(result['status'], 'aligned')
        self.assertEqual(self.run_git(self.source, 'rev-parse', 'HEAD'), target)
        self.assertEqual(self.run_git(self.source, 'diff', 'refs/remotes/origin/main...HEAD'), '')
        self.assertEqual(self.run_git(self.root, 'rev-parse', 'refs/t3-release-queue/sources/' + self.commit), self.commit)

    def test_alignment_blocks_new_commits_and_dirty_or_untracked_files(self):
        target, request = self.delivered()
        for name in ['feature.txt', 'unfinished.txt']:
            with self.subTest(name=name):
                p = self.source / name; existed = p.exists(); before = p.read_bytes() if existed else None
                p.write_text('keep this work')
                self.assertEqual(source_cleanup.align_source(self.root, request, target)['status'], 'blocked')
                self.assertEqual(p.read_text(), 'keep this work')
                if existed: p.write_bytes(before)
                else: p.unlink()
        (self.source / 'new.txt').write_text('new work'); self.run_git(self.source, 'add', '.'); self.run_git(self.source, 'commit', '-qm', 'new')
        head = self.run_git(self.source, 'rev-parse', 'HEAD')
        self.assertEqual(source_cleanup.align_source(self.root, request, target)['status'], 'blocked')
        self.assertEqual(self.run_git(self.source, 'rev-parse', 'HEAD'), head)

    def test_alignment_waits_for_published_main_and_protects_ignored_files(self):
        target, request = self.delivered()
        self.run_git(self.root, 'update-ref', '-d', 'refs/remotes/origin/main')
        self.assertEqual(source_cleanup.align_source(self.root, request, target)['status'], 'pending')
        self.run_git(self.root, 'update-ref', 'refs/remotes/origin/main', target)
        common = Path(self.run_git(self.root, 'rev-parse', '--path-format=absolute', '--git-common-dir'))
        (common / 'info/exclude').write_text('/retained.txt\n')
        (self.source / 'retained.txt').write_text('private retained data')
        (self.root / 'retained.txt').write_text('published replacement')
        self.run_git(self.root, 'add', '-f', 'retained.txt'); self.run_git(self.root, 'commit', '-qm', 'new tracked path')
        target = self.run_git(self.root, 'rev-parse', 'HEAD'); self.run_git(self.root, 'update-ref', 'refs/remotes/origin/main', target)
        self.assertEqual(source_cleanup.align_source(self.root, request, target)['status'], 'blocked')
        self.assertEqual((self.source / 'retained.txt').read_text(), 'private retained data')

    def test_ref_transaction_rejects_a_new_commit_racing_the_idle_check(self):
        target, request = self.delivered()
        original = subprocess.Popen
        def race(*args, **kwargs):
            (self.source / 'new.txt').write_text('new commit wins')
            self.run_git(self.source, 'add', '.'); self.run_git(self.source, 'commit', '-qm', 'racing commit')
            return original(*args, **kwargs)
        def guarded(*args, **kwargs):
            if args[0][:3] == ['git', 'update-ref', '--stdin']:
                with patch.object(source_cleanup.subprocess, 'Popen', original):
                    return race(*args, **kwargs)
            return original(*args, **kwargs)
        with patch.object(source_cleanup.subprocess, 'Popen', side_effect=guarded):
            self.assertEqual(source_cleanup.align_source(self.root, request, target)['status'], 'blocked')
        self.assertEqual((self.source / 'new.txt').read_text(), 'new commit wins')
        self.assertNotEqual(self.run_git(self.source, 'rev-parse', 'HEAD'), self.commit)

    def test_external_evidence_link_can_be_removed_without_removing_its_target(self):
        external = Path(self.temp.name) / 'external'; external.mkdir()
        retained = external / 'worktrees/task'; retained.mkdir(parents=True)
        (retained / 'proof.txt').write_text('keep')
        link = self.source / 'evidence'; link.symlink_to(retained, target_is_directory=True)
        common = Path(self.run_git(self.root, 'rev-parse', '--path-format=absolute', '--git-common-dir'))
        (common / 'info/exclude').write_text('/evidence\n')
        original_run = subprocess.run
        def execute(args, **kwargs):
            if args[0] == 'node':
                self.run_git(self.root, 'worktree', 'remove', str(self.source))
                return subprocess.CompletedProcess(args, 0, json.dumps({'status': 'removed'}), '')
            return original_run(args, **kwargs)
        config = {'canonicalRoot': str(self.root), 't3Command': 't3', 't3BaseDir': '/private/t3', 'evidenceRoot': str(external)}
        with patch.object(source_cleanup.maintainer_config, 'configuration', return_value=config), patch.object(source_cleanup.subprocess, 'run', side_effect=execute):
            self.assertEqual(source_cleanup.cleanup(self.root, self.request)['status'], 'removed')
        self.assertEqual((retained / 'proof.txt').read_text(), 'keep')
