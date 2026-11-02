import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from scripts.plugin_id_migration import PLUGIN_ID, LEGACY_ID, installed_plugin, migrate_installation, archive_legacy_settings


class PluginIdMigrationTests(unittest.TestCase):
    def current_fixture(self, root):
        plugins = root / 'vault/.obsidian/plugins'
        current, legacy = plugins / PLUGIN_ID, plugins / LEGACY_ID
        current.mkdir(parents=True); legacy.mkdir()
        (current / 'manifest.json').write_text(json.dumps({'id': PLUGIN_ID}))
        (current / 'main.js').write_bytes(b'current runtime')
        (current / 'styles.css').write_bytes(b'current styles')
        (current / 'data.json').write_bytes(b'{"current":"preserved"}\n')
        (legacy / 'data.json').write_bytes(b'\xef\xbb\xbf{ "old": "preserved separately" }\n')
        return plugins, current, legacy

    def test_discovery_uses_the_current_plugin_without_mutating_a_legacy_settings_remnant(self):
        with tempfile.TemporaryDirectory() as directory:
            plugins, current, legacy = self.current_fixture(Path(directory))
            before = {path: path.read_bytes() for path in plugins.rglob('*') if path.is_file()}
            self.assertEqual(installed_plugin(plugins), current)
            self.assertEqual({path: path.read_bytes() for path in plugins.rglob('*') if path.is_file()}, before)

    def test_cleanup_retains_both_settings_and_removes_only_the_legacy_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); plugins, current, legacy = self.current_fixture(root)
            current_before = {path: path.read_bytes() for path in current.iterdir()}
            old = (legacy / 'data.json').read_bytes(); backup = root / 'evidence/cleanup'
            result = archive_legacy_settings(plugins, backup)
            self.assertFalse(legacy.exists())
            self.assertEqual((backup / 'plugin/data.json').read_bytes(), old)
            self.assertEqual((backup / 'removed-directory/data.json').read_bytes(), old)
            self.assertEqual({path: path.read_bytes() for path in current.iterdir()}, current_before)
            self.assertEqual(json.loads((backup / 'receipt.json').read_text()), result)
            self.assertIsNone(archive_legacy_settings(plugins, root / 'unused'))

    def test_discovery_and_cleanup_refuse_actual_duplicate_runtime_or_unknown_contents(self):
        for name in ['main.js', 'manifest.json', 'styles.css', 'unknown.txt', 'nested']:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                root = Path(directory); plugins, current, legacy = self.current_fixture(root)
                extra = legacy / name
                if name == 'nested': extra.mkdir()
                else: extra.write_bytes(b'preserve')
                with self.assertRaises(SystemExit): installed_plugin(plugins)
                with self.assertRaises(SystemExit): archive_legacy_settings(plugins, root / 'evidence')
                self.assertTrue(extra.exists())

    def test_cleanup_refuses_symlinks_missing_current_runtime_and_backups_inside_the_vault(self):
        for problem in ['legacy-symlink', 'settings-symlink', 'no-runtime', 'wrong-id', 'backup-in-vault']:
            with self.subTest(problem=problem), tempfile.TemporaryDirectory() as directory:
                root = Path(directory); plugins, current, legacy = self.current_fixture(root)
                if problem == 'legacy-symlink':
                    moved = legacy.with_name('original'); legacy.rename(moved); legacy.symlink_to(moved, target_is_directory=True)
                elif problem == 'settings-symlink':
                    data = legacy / 'data.json'; moved = root / 'private.json'; data.rename(moved); data.symlink_to(moved)
                elif problem == 'no-runtime': (current / 'main.js').unlink()
                elif problem == 'wrong-id': (current / 'manifest.json').write_text('{"id":"other"}')
                backup = plugins.parent / 'backup' if problem == 'backup-in-vault' else root / 'evidence'
                with self.assertRaises(SystemExit): archive_legacy_settings(plugins, backup)
                self.assertTrue(legacy.exists())

    def test_changed_settings_during_backup_and_failed_move_leave_the_source_directory(self):
        for problem in ['changed', 'move-failed']:
            with self.subTest(problem=problem), tempfile.TemporaryDirectory() as directory:
                root = Path(directory); plugins, current, legacy = self.current_fixture(root)
                if problem == 'changed':
                    import shutil
                    copy = shutil.copytree
                    def racing_copy(*args, **kwargs):
                        result = copy(*args, **kwargs); (legacy / 'data.json').write_bytes(b'new user settings'); return result
                    with patch('scripts.plugin_id_migration.shutil.copytree', side_effect=racing_copy):
                        with self.assertRaises(SystemExit): archive_legacy_settings(plugins, root / 'backup')
                else:
                    with patch.object(Path, 'rename', side_effect=OSError('move failed')):
                        with self.assertRaises(OSError): archive_legacy_settings(plugins, root / 'backup')
                self.assertTrue(legacy.exists())

    def test_synced_legacy_settings_only_directory_is_preserved_beside_current_runtime(self):
        with tempfile.TemporaryDirectory() as directory:
            plugins = Path(directory)
            legacy = plugins / LEGACY_ID
            current = plugins / PLUGIN_ID
            legacy.mkdir()
            current.mkdir()
            settings = b'{"retained":"old device settings"}\n'
            (legacy / 'data.json').write_bytes(settings)
            (current / 'manifest.json').write_text(json.dumps({'id': PLUGIN_ID}))
            (current / 'main.js').write_text('current runtime')
            (current / 'styles.css').write_text('current styles')
            before = {str(path): path.read_bytes() for path in plugins.rglob('*') if path.is_file()}
            self.assertEqual(installed_plugin(plugins), current)
            self.assertEqual({str(path): path.read_bytes() for path in plugins.rglob('*') if path.is_file()}, before)
            (legacy / 'manifest.json').write_text(json.dumps({'id': LEGACY_ID}))
            with self.assertRaises(SystemExit):
                installed_plugin(plugins)

    def test_settings_only_exception_refuses_symlinks_and_incomplete_current_runtime(self):
        with tempfile.TemporaryDirectory() as directory:
            plugins = Path(directory)
            legacy = plugins / LEGACY_ID
            current = plugins / PLUGIN_ID
            legacy.mkdir()
            current.mkdir()
            (legacy / 'data.json').write_text('{}')
            (current / 'manifest.json').write_text(json.dumps({'id': PLUGIN_ID}))
            (current / 'main.js').write_text('runtime')
            with self.assertRaises(SystemExit):
                installed_plugin(plugins)
            (current / 'styles.css').write_text('styles')
            (legacy / 'data.json').unlink()
            (legacy / 'data.json').symlink_to(current / 'manifest.json')
            with self.assertRaises(SystemExit):
                installed_plugin(plugins)

    def fixture(self, root):
        config = root / 'vault/.obsidian'
        plugin = config / 'plugins' / LEGACY_ID
        plugin.mkdir(parents=True)
        (plugin / 'data.json').write_bytes(b'\xef\xbb\xbf{ "private": "unchanged", "schema": 1 }\n')
        (plugin / 'main.js').write_bytes(b'old bundle')
        (config / 'community-plugins.json').write_text(json.dumps(['other', LEGACY_ID]))
        (config / 'hotkeys.json').write_text(json.dumps({LEGACY_ID + ':send-or-ask': [{'modifiers': ['Ctrl'], 'key': 'T'}], 'other:command': []}))
        return config, plugin

    def test_move_keeps_settings_and_unrelated_plugins_and_migrates_hotkeys(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config, plugin = self.fixture(root)
            data = (plugin / 'data.json').read_bytes()
            target = migrate_installation(plugin, PLUGIN_ID, root / 'evidence')
            self.assertFalse(plugin.exists())
            self.assertEqual(installed_plugin(plugin.parent), target)
            self.assertEqual((target / 'data.json').read_bytes(), data)
            self.assertEqual((root / 'evidence/plugin/data.json').read_bytes(), data)
            self.assertEqual(json.loads((config / 'community-plugins.json').read_bytes()), ['other', PLUGIN_ID])
            hotkeys = json.loads((config / 'hotkeys.json').read_bytes())
            self.assertEqual(hotkeys[PLUGIN_ID + ':send-or-ask'], [{'modifiers': ['Ctrl'], 'key': 'T'}])
            self.assertEqual(hotkeys['other:command'], [])
            self.assertNotIn(LEGACY_ID + ':send-or-ask', hotkeys)
            self.assertEqual(migrate_installation(target, PLUGIN_ID, root / 'evidence'), target)

    def test_conflicting_hotkeys_or_destination_refuse_before_changing_anything(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config, plugin = self.fixture(root)
            keys = json.loads((config / 'hotkeys.json').read_bytes())
            keys[PLUGIN_ID + ':send-or-ask'] = []
            (config / 'hotkeys.json').write_text(json.dumps(keys))
            before = {path: path.read_bytes() for path in config.rglob('*') if path.is_file()}
            with self.assertRaisesRegex(SystemExit, 'Conflicting hotkeys'):
                migrate_installation(plugin, PLUGIN_ID, root / 'evidence')
            self.assertEqual({path: path.read_bytes() for path in config.rglob('*') if path.is_file()}, before)
            plugin.with_name(PLUGIN_ID).mkdir()
            with self.assertRaises(SystemExit):
                installed_plugin(plugin.parent)

    def test_sync_recreated_legacy_settings_are_not_a_second_runtime_and_remain_untouched(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config, legacy = self.fixture(root)
            (legacy / 'main.js').unlink()
            (config / 'community-plugins.json').write_text(json.dumps([PLUGIN_ID]))
            current = legacy.with_name(PLUGIN_ID)
            current.mkdir()
            for name, contents in {'main.js': b'current bundle', 'manifest.json': json.dumps({'id': PLUGIN_ID}).encode(),
                                   'styles.css': b'current styles', 'data.json': b'{"different":"current settings"}'}.items():
                (current / name).write_bytes(contents)
            before = {path: path.read_bytes() for path in config.rglob('*') if path.is_file()}
            self.assertEqual(installed_plugin(legacy.parent), current)
            self.assertEqual({path: path.read_bytes() for path in config.rglob('*') if path.is_file()}, before)
            for name in ('main.js', 'manifest.json', 'unexpected.txt'):
                extra = legacy / name
                extra.write_text('old or unknown runtime content')
                with self.assertRaisesRegex(SystemExit, 'Both plugin installations'):
                    installed_plugin(legacy.parent)
                extra.unlink()
            (config / 'community-plugins.json').write_text(json.dumps([PLUGIN_ID, LEGACY_ID]))
            with self.assertRaises(SystemExit):
                installed_plugin(legacy.parent)
            (config / 'community-plugins.json').write_text(json.dumps([PLUGIN_ID]))
            (current / 'main.js').unlink()
            with self.assertRaises(SystemExit):
                installed_plugin(legacy.parent)

    def test_failed_directory_move_restores_original_configuration_and_data(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config, plugin = self.fixture(root)
            before = {path: path.read_bytes() for path in config.rglob('*') if path.is_file()}
            with patch.object(Path, 'rename', side_effect=OSError('move failed')):
                with self.assertRaises(OSError):
                    migrate_installation(plugin, PLUGIN_ID, root / 'evidence')
            self.assertEqual({path: path.read_bytes() for path in config.rglob('*') if path.is_file()}, before)

    def test_disabled_plugin_stays_disabled_and_other_ids_do_not_move(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config, plugin = self.fixture(root)
            (config / 'community-plugins.json').write_text('["other"]')
            self.assertEqual(migrate_installation(plugin, LEGACY_ID, root / 'evidence'), plugin)
            migrate_installation(plugin, PLUGIN_ID, root / 'evidence')
            self.assertEqual(json.loads((config / 'community-plugins.json').read_bytes()), ['other'])

    def test_release_restores_the_original_enabled_state_after_its_temporary_stop(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config, plugin = self.fixture(root)
            (config / 'community-plugins.json').write_text('["other"]')
            migrate_installation(plugin, PLUGIN_ID, root / 'evidence', restore_enabled=True)
            self.assertEqual(json.loads((config / 'community-plugins.json').read_bytes()), ['other', PLUGIN_ID])


if __name__ == '__main__':
    unittest.main()
