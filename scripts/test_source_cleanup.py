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
