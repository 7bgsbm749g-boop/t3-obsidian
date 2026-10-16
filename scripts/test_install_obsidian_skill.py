import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('install_obsidian_skill', Path(__file__).with_name('install-obsidian-skill.py'))
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class SkillInstallationTests(unittest.TestCase):
    def test_directory_links_expose_regular_manifest_and_preserve_previous_installation(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            home, source, backups = root / 'home', root / 'source', root / 'backups'
            source.mkdir()
            (source / 'SKILL.md').write_text('new maintained skill')
            old = home / '.codex' / 'skills' / 'obsidian-t3'
            (old / 'agents').mkdir(parents=True)
            (old / 'SKILL.md').write_text('previous skill')
            (old / 'agents' / 'openai.yaml').write_text('previous metadata')
            result = installer.install(home, source, backups)
            self.assertTrue(result['ok'])
            for target in installer.destinations(home):
                self.assertTrue(target.is_symlink())
                self.assertFalse((target / 'SKILL.md').is_symlink())
                self.assertEqual((target / 'SKILL.md').read_text(), 'new maintained skill')
            archived = list(backups.iterdir())
            self.assertEqual(len(archived), 1)
            self.assertEqual((archived[0] / 'SKILL.md').read_text(), 'previous skill')
            self.assertEqual((archived[0] / 'agents' / 'openai.yaml').read_text(), 'previous metadata')
            self.assertTrue(installer.install(home, source, backups, check=True)['ok'])
            self.assertTrue(installer.install(home, source, backups)['ok'])
            self.assertEqual(list(backups.iterdir()), archived)

    def test_unrelated_folder_link_is_refused_before_other_installations_change(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            home, source, other = root / 'home', root / 'source', root / 'other'
            source.mkdir()
            (source / 'SKILL.md').write_text('maintained skill')
            other.mkdir()
            target = home / '.agents' / 'skills' / 'obsidian-t3'
            target.parent.mkdir(parents=True)
            target.symlink_to(other, target_is_directory=True)
            with self.assertRaisesRegex(ValueError, 'unrelated skill link'):
                installer.install(home, source)
            self.assertEqual(target.resolve(), other)
            self.assertFalse((home / '.codex').exists())


if __name__ == '__main__':
    unittest.main()
