from pathlib import Path
import subprocess
import tempfile
import unittest
from scripts import integrate_docs


class DocumentationIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'canonical'; self.root.mkdir()
        self.git(self.root, 'init', '-q'); self.git(self.root, 'config', 'user.name', 'Test'); self.git(self.root, 'config', 'user.email', 'test@example.com')
        (self.root / '.gitignore').write_text('/evidence/\n')
        (self.root / 'AGENTS.md').write_text('base instructions\n')
        (self.root / 'manifest.json').write_text('{"version":"0.0.393"}')
        self.git(self.root, 'add', '.'); self.git(self.root, 'commit', '-qm', 'base')
        self.source = Path(self.temp.name) / 'task'; self.git(self.root, 'worktree', 'add', '-qb', 'task', str(self.source))

    def git(self, root, *args):
        return subprocess.check_output(['git', '-C', str(root), *args], text=True, stderr=subprocess.DEVNULL).strip()

    def commit(self, filename, text):
        (self.source / filename).write_text(text); self.git(self.source, 'add', '.'); self.git(self.source, 'commit', '-qm', 'Update instructions')
        return self.git(self.source, 'rev-parse', 'HEAD')

    def test_documentation_uses_normal_git_without_release_jobs_or_version_changes(self):
        commit = self.commit('AGENTS.md', 'new instructions\n')
        result = integrate_docs.integrate(self.source, self.root, commit)
        self.assertEqual(result['status'], 'committed')
        self.assertEqual((self.root / 'AGENTS.md').read_text(), 'new instructions\n')
        self.assertEqual((self.root / 'manifest.json').read_text(), '{"version":"0.0.393"}')
        self.assertFalse((self.root / 'evidence/release-queue/jobs').exists())
        self.assertEqual(len(self.git(self.root, 'rev-list', '--parents', '-n', '1', 'HEAD').split()), 2)

    def test_product_changes_and_uncommitted_files_are_refused(self):
        commit = self.commit('feature.ts', 'export const value=1;')
        with self.assertRaisesRegex(SystemExit, 'product or tooling'): integrate_docs.integrate(self.source, self.root, commit)
        (self.source / 'AGENTS.md').write_text('unfinished')
        with self.assertRaisesRegex(SystemExit, 'Commit all'): integrate_docs.integrate(self.source, self.root, commit)

    def test_conflict_restores_canonical_and_preserves_task(self):
        commit = self.commit('AGENTS.md', 'task instructions\n')
        (self.root / 'AGENTS.md').write_text('newer instructions\n'); self.git(self.root, 'add', '.'); self.git(self.root, 'commit', '-qm', 'Other task')
        before = self.git(self.root, 'rev-parse', 'HEAD')
        with self.assertRaisesRegex(SystemExit, 'conflicts'): integrate_docs.integrate(self.source, self.root, commit)
        self.assertEqual(self.git(self.root, 'rev-parse', 'HEAD'), before)
        self.assertEqual(self.git(self.root, 'status', '--porcelain=v1'), '')
        self.assertEqual((self.source / 'AGENTS.md').read_text(), 'task instructions\n')
