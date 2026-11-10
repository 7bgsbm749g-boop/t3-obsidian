from pathlib import Path
import json
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from scripts import maintainer_config


class MaintainerConfigurationTests(unittest.TestCase):
    def test_unconfigured_evidence_defaults_outside_source_without_creating_directories(self):
        with tempfile.TemporaryDirectory() as temporary:
            home = Path(temporary) / 'home'
            root = home / 'projects/source'
            with patch.object(maintainer_config, 'configuration', return_value={'canonicalRoot': str(root)}), patch.object(Path, 'home', return_value=home):
                self.assertEqual(maintainer_config.evidence_root(root), home / '.local/state/t3-obsidian/evidence')
            self.assertFalse(home.exists())

    def test_default_evidence_cannot_be_inside_a_checkout_or_protected_vault(self):
        with tempfile.TemporaryDirectory() as temporary:
            home = Path(temporary) / 'home'
            source = Path(temporary) / 'source'
            task = Path(temporary) / 'task'
            for canonical, current, plugins, message in [
                (home, task, None, 'outside source checkouts'),
                (source, home, None, 'outside source checkouts'),
                (source, task, home / '.obsidian/plugins', 'outside synced vaults'),
            ]:
                config = {'canonicalRoot': str(canonical), 'productionPlugins': str(plugins) if plugins else None}
                with self.subTest(message=message, current=current), patch.object(maintainer_config, 'configuration', return_value=config), patch.object(Path, 'home', return_value=home):
                    with self.assertRaisesRegex(ValueError, message):
                        maintainer_config.evidence_root(current)
            self.assertFalse(home.exists())

    def test_private_configuration_is_shared_by_worktrees_and_stays_out_of_git(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'canonical'; root.mkdir()
            subprocess.run(['git', 'init', '-q', str(root)], check=True)
            for key, value in [('user.name', 'Test'), ('user.email', 'test@example.com')]: subprocess.run(['git', '-C', str(root), 'config', key, value], check=True)
            (root / 'README.md').write_text('fixture'); subprocess.run(['git', '-C', str(root), 'add', '.'], check=True); subprocess.run(['git', '-C', str(root), 'commit', '-qm', 'base'], check=True)
            private = root / '.git/t3-obsidian'; private.mkdir(); (private / 'maintainer.json').write_text(json.dumps({'canonicalRoot': str(root), 'productionPlugins': '/private/production/plugins'}))
            task = Path(directory) / 'task'; subprocess.run(['git', '-C', str(root), 'worktree', 'add', '-qb', 'task', str(task)], check=True)
            self.assertEqual(maintainer_config.configuration(task)['productionPlugins'], '/private/production/plugins')
            self.assertEqual(maintainer_config.canonical_root(task), root)
            self.assertEqual(subprocess.check_output(['git', '-C', str(root), 'status', '--porcelain=v1'], text=True), '')


    def test_external_evidence_is_shared_by_worktrees_without_creating_local_stores(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'canonical'; root.mkdir()
            subprocess.run(['git', 'init', '-q', str(root)], check=True)
            external = Path(directory) / 'external-evidence'
            private = root / '.git/t3-obsidian'; private.mkdir()
            (private / 'maintainer.json').write_text(json.dumps({'evidenceRoot': str(external)}))
            self.assertEqual(maintainer_config.evidence_root(root), external)
            self.assertFalse((root / 'evidence').exists())
            self.assertFalse(external.exists())

    def test_configured_evidence_cannot_be_relative_or_inside_the_checkout(self):
        from unittest.mock import patch
        root = Path('/synthetic/source')
        for value in ['local-evidence', str(root / 'evidence')]:
            with self.subTest(value=value), patch.object(maintainer_config, 'configuration', return_value={'canonicalRoot': str(root), 'evidenceRoot': value}):
                with self.assertRaisesRegex(ValueError, 'outside source checkouts'):
                    maintainer_config.evidence_root(root)

    def test_external_evidence_still_cannot_use_a_real_synced_vault(self):
        from unittest.mock import patch
        root = Path('/synthetic/source').resolve()
        vault = root.parent / 'vault'
        config = {'canonicalRoot': str(root), 'evidenceRoot': str(vault / 'evidence'),
                  'productionPlugins': str(vault / '.obsidian/plugins')}
        with patch.object(maintainer_config, 'configuration', return_value=config):
            with self.assertRaisesRegex(ValueError, 'outside synced vaults'):
                maintainer_config.evidence_root(root)
