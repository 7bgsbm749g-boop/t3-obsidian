import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('mobile_lab', Path(__file__).with_name('obsidian-mobile-lab.py'))
LAB = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(LAB)


class MobileLabTests(unittest.TestCase):
    def test_status_does_not_start_an_unmanaged_adb_server(self):
        with patch.object(LAB, 'adb_running', return_value=False), patch.object(LAB, 'run') as run:
            LAB.status()
            run.assert_not_called()

    def test_second_freeze_preserves_the_original_process_receipt(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(LAB, 'ROOT', Path(directory)):
            receipt = Path(directory) / 'freeze.json'
            receipt.write_text('{"resumed": false, "processes": []}')
            with patch.object(LAB, 'adb') as adb:
                with self.assertRaisesRegex(RuntimeError, 'already frozen'):
                    LAB.freeze(Path(directory))
                adb.assert_not_called()
                self.assertEqual(json.loads(receipt.read_text())['resumed'], False)

    def test_existing_unowned_root_is_preserved(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(LAB, 'ROOT', Path(directory)):
            user_file = Path(directory) / 'keep.txt'
            user_file.write_text('preserve')
            with self.assertRaisesRegex(RuntimeError, 'ownership marker'):
                LAB.initialize()
            self.assertEqual(user_file.read_text(), 'preserve')

    def test_android_shell_paths_are_quoted(self):
        with patch.object(LAB, 'run') as run:
            LAB.adb('shell', 'mkdir', '-p', '/owned/Test Vault')
            self.assertEqual(run.call_args.args[0][-2:], ['shell', "mkdir -p '/owned/Test Vault'"])

    def test_thaw_never_signals_a_recycled_pid(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(LAB, 'ROOT', Path(directory)):
            (Path(directory) / 'freeze.json').write_text(json.dumps({'at': 0, 'processes': [{'pid': 42, 'startTicks': 'old'}], 'resumed': False}))
            with patch.object(LAB, 'process_identity', return_value={'pid': 42, 'startTicks': 'new'}), patch.object(LAB, 'adb') as adb:
                result = LAB.thaw(Path(directory))
                self.assertEqual(result['resumedPids'], [])
                self.assertFalse(any('kill' in call.args for call in adb.call_args_list))

    def test_freeze_selects_only_owned_app_and_webview_processes(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(LAB, 'ROOT', Path(directory)):
            listing = 'PID NAME ARGS\n21 md.obsidian md.obsidian\n22 com.android.webview:sandboxed_process0 renderer\n23 com.android.launcher3 launcher\n'
            def identity(pid):
                return {'pid': pid, 'startTicks': str(pid), 'state': 'T'}
            with patch.object(LAB, 'process_identity', side_effect=identity), patch.object(LAB, 'adb', return_value=types.SimpleNamespace(stdout=listing)) as adb:
                result = LAB.freeze(Path(directory))
                self.assertEqual([item['pid'] for item in result['processes']], [21, 22])
                adb.assert_any_call('shell', 'kill', '-STOP', '21', '22')

    def test_checksum_failure_never_installs_an_artifact(self):
        class Response(io.BytesIO):
            status = 200
        with tempfile.TemporaryDirectory() as directory, patch.object(LAB, 'ROOT', Path(directory)):
            package = ('test', 'https://dl.google.com/test.zip', 3, 'sha256', '0' * 64, Path(directory))
            with patch.object(LAB, 'PACKAGES', [package]), patch.object(LAB.shutil, 'disk_usage', return_value=types.SimpleNamespace(free=4_000_000_000)), patch.object(LAB.urllib.request, 'urlopen', return_value=Response(b'bad')):
                with self.assertRaisesRegex(RuntimeError, 'checksum'):
                    LAB.setup(Path(directory))
                self.assertFalse((Path(directory) / 'test-installed.json').exists())
                self.assertFalse((Path(directory) / 'test.zip').exists())


    def lab_root(self, directory):
        root = Path(directory)
        (root / 'emulator-session.json').write_text(json.dumps({'id': 'emu', 'unit': 't3session-emu.service', 'startedAt': 0}))
        (root / 'adb-session.json').write_text(json.dumps({'id': 'adb'}))
        return root

    def fake_run(self, calls, devices='emulator-5580\tdevice\n', states=None):
        states = list(states or ['inactive'])
        def run(args, **kwargs):
            calls.append(('run', [str(a) for a in args]))
            if 'devices' in args:
                return types.SimpleNamespace(stdout='List of devices attached\n' + devices, stderr='')
            if 'ActiveState' in [str(a) for a in args]:
                return types.SimpleNamespace(stdout=(states.pop(0) if len(states) > 1 else states[0]) + '\n', stderr='')
            return types.SimpleNamespace(stdout='', stderr='')
        return run

    def test_emulator_session_budget_covers_guest_ram_and_measured_overhead(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(LAB, 'ROOT', Path(directory)), \
                patch.object(LAB, 'EMULATOR', Path(directory) / 'emulator'), patch.object(LAB, 'IMAGE', Path(directory)), \
                patch.object(LAB, 'SDK', Path(directory)):
            (Path(directory) / 'emulator').write_text('')
            (Path(directory) / 'device').mkdir()
            (Path(directory) / 'device/userdata-qemu.img').write_text('')
            starts = []
            def run(args, **kwargs):
                starts.append([str(a) for a in args])
                return types.SimpleNamespace(stdout=json.dumps({'id': str(len(starts)), 'unit': 'unit'}), stderr='')
            with patch.object(LAB, 'run', side_effect=run), contextlib.redirect_stdout(io.StringIO()):
                LAB.start(Path(directory))
            emulator = next(call for call in starts if '-memory' in call[-1])
            budget = emulator[emulator.index('--memory') + 1]
            self.assertEqual(budget, LAB.SESSION_MEMORY)
            # The old 2300M budget plus its 256M swap was exhausted at 17m40s.
            self.assertGreater(int(budget.rstrip('M')), 2300 + 256)
            self.assertIn(f'-memory {LAB.GUEST_RAM_MIB}', emulator[-1])
            self.assertIn('startedAt', json.loads((Path(directory) / 'emulator-session.json').read_text()))

    def test_stop_flushes_and_powers_off_before_release(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(LAB, 'ROOT', Path(directory)):
            root = self.lab_root(directory)
            calls = []
            with patch.object(LAB, 'run', side_effect=self.fake_run(calls)), patch.object(LAB, 'adb_running', return_value=True), \
                    patch.object(LAB, 'adb', side_effect=lambda *a, **k: calls.append(('adb', list(a)))), patch.object(LAB, 'session_memory', return_value=None), \
                    patch.object(LAB, 'emulator_present', side_effect=[True, False]), patch.object(LAB.time, 'sleep'):
                result = LAB.stop(root)
            adb_calls = [call[1] for call in calls if call[0] == 'adb']
            self.assertEqual(adb_calls[:2], [['shell', 'sync'], ['shell', 'reboot', '-p']])
            self.assertNotIn(['emu', 'kill'], adb_calls)
            release = next(i for i, call in enumerate(calls) if call[0] == 'run' and 'release' in call[1])
            self.assertLess(calls.index(('adb', ['shell', 'sync'])), release)
            self.assertEqual(result['shutdown'], {'flushed': True, 'method': 'poweroff'})
            self.assertEqual(json.loads((root / 'stop.json').read_text())['shutdown']['method'], 'poweroff')

    def test_stop_kills_only_after_flush_when_poweroff_does_not_finish(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(LAB, 'ROOT', Path(directory)):
            root = self.lab_root(directory)
            calls = []
            with patch.object(LAB, 'run', side_effect=self.fake_run(calls, states=['active'])), patch.object(LAB, 'adb_running', return_value=True), \
                    patch.object(LAB, 'adb', side_effect=lambda *a, **k: calls.append(('adb', list(a)))), patch.object(LAB, 'session_memory', return_value=None), \
                    patch.object(LAB.time, 'sleep'), patch.object(LAB.time, 'monotonic', side_effect=[0, 0, 100]):
                result = LAB.shutdown(timeout=5)
            adb_calls = [call[1] for call in calls if call[0] == 'adb']
            self.assertEqual(adb_calls, [['shell', 'sync'], ['shell', 'reboot', '-p'], ['emu', 'kill']])
            self.assertEqual(result, {'flushed': True, 'method': 'emu-kill'})

    def test_offline_device_is_reported_as_unflushed(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(LAB, 'ROOT', Path(directory)):
            root = self.lab_root(directory)
            calls = []
            with patch.object(LAB, 'run', side_effect=self.fake_run(calls, devices='emulator-5580\toffline\n')), patch.object(LAB, 'adb_running', return_value=True), \
                    patch.object(LAB, 'adb', side_effect=lambda *a, **k: calls.append(('adb', list(a)))), patch.object(LAB, 'session_memory', return_value=None):
                result = LAB.stop(root)
            self.assertEqual([call[1] for call in calls if call[0] == 'adb'], [['emu', 'kill']])
            self.assertFalse(result['shutdown']['flushed'])

    def test_push_is_flushed_before_its_checksums_are_accepted(self):
        with tempfile.TemporaryDirectory() as directory:
            local = Path(directory) / 'main.js'
            local.write_text('runtime')
            calls = []
            def adb(*args, **kwargs):
                calls.append(list(args))
                return types.SimpleNamespace(stdout=LAB.sha256(local) + '  /remote/main.js\n')
            with patch.object(LAB, 'adb', side_effect=adb):
                self.assertEqual(LAB.push_verified([local], '/remote'), {'main.js': LAB.sha256(local)})
            self.assertLess(calls.index(['shell', 'sync']), calls.index(['shell', 'sha256sum', '/remote/main.js']))
            with patch.object(LAB, 'adb', return_value=types.SimpleNamespace(stdout='0' * 64 + '  /remote/main.js\n')):
                with self.assertRaisesRegex(RuntimeError, 'checksums do not match'):
                    LAB.push_verified([local], '/remote')

    def write_backup(self, directory, contents=None):
        backup = Path(directory) / 'backup'
        backup.mkdir()
        contents = contents or {name: 'bytes of ' + name for name in LAB.RUNTIME}
        for name, value in contents.items():
            (backup / name).write_text(value)
        (backup / 'backup.json').write_text(json.dumps({'sha256': {name: LAB.sha256(backup / name) for name in LAB.RUNTIME}}))
        return backup

    def test_restore_refuses_an_empty_backup_before_any_push(self):
        with tempfile.TemporaryDirectory() as directory:
            backup = self.write_backup(directory)
            (backup / 'main.js').write_text('')
            with patch.object(LAB, 'adb') as adb:
                with self.assertRaisesRegex(RuntimeError, 'missing or empty: main.js'):
                    LAB.restore_plugin(Path(directory), backup)
                adb.assert_not_called()

    def test_restore_refuses_a_backup_with_a_changed_checksum(self):
        with tempfile.TemporaryDirectory() as directory:
            backup = self.write_backup(directory)
            (backup / 'styles.css').write_text('changed')
            with patch.object(LAB, 'adb') as adb:
                with self.assertRaisesRegex(RuntimeError, 'does not match its checksum: styles.css'):
                    LAB.restore_plugin(Path(directory), backup)
                adb.assert_not_called()
            (backup / 'backup.json').unlink()
            with self.assertRaisesRegex(RuntimeError, 'no checksum manifest'):
                LAB.restore_plugin(Path(directory), backup)

    def test_restore_pushes_a_verified_backup_and_flushes_it(self):
        with tempfile.TemporaryDirectory() as directory:
            backup = self.write_backup(directory)
            with patch.object(LAB, 'push_verified', side_effect=lambda files, remote: {Path(f).name: LAB.sha256(f) for f in files}) as push:
                result = LAB.restore_plugin(Path(directory), backup)
            self.assertEqual(push.call_args.args[1], LAB.PLUGIN)
            self.assertTrue(result['flushed'])
            self.assertTrue((Path(directory) / 'plugin-restore.json').exists())

    def test_backup_refuses_an_empty_installed_runtime(self):
        with tempfile.TemporaryDirectory() as directory:
            backup = Path(directory) / 'backup'
            def adb(*args, **kwargs):
                if args[0] == 'pull':
                    Path(args[2]).write_text('')
                return types.SimpleNamespace(stdout='')
            with patch.object(LAB, 'adb', side_effect=adb):
                with self.assertRaisesRegex(RuntimeError, 'runtime file is empty: main.js'):
                    LAB.backup_plugin(Path(directory), backup)
            self.assertFalse((backup / 'backup.json').exists())

    def test_backup_never_replaces_an_existing_backup(self):
        with tempfile.TemporaryDirectory() as directory:
            backup = self.write_backup(directory)
            before = (backup / 'backup.json').read_text()
            with patch.object(LAB, 'adb') as adb:
                with self.assertRaisesRegex(RuntimeError, 'already holds a backup'):
                    LAB.backup_plugin(Path(directory), backup)
                adb.assert_not_called()
            self.assertEqual((backup / 'backup.json').read_text(), before)

    def test_restart_keeps_a_young_session_and_recycles_an_old_one(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(LAB, 'ROOT', Path(directory)):
            root = self.lab_root(directory)
            session = json.loads((root / 'emulator-session.json').read_text())
            session['startedAt'] = LAB.time.time() - 60
            (root / 'emulator-session.json').write_text(json.dumps(session))
            with patch.object(LAB, 'adb_running', return_value=True), patch.object(LAB, 'stop') as stop, patch.object(LAB, 'start') as start:
                self.assertFalse(LAB.restart(root, LAB.RESTART_MINUTES)['restarted'])
                stop.assert_not_called()
                start.assert_not_called()
            session['startedAt'] = LAB.time.time() - (LAB.RESTART_MINUTES + 1) * 60
            (root / 'emulator-session.json').write_text(json.dumps(session))
            order = []
            with patch.object(LAB, 'adb_running', side_effect=[True, False]), patch.object(LAB, 'stop', side_effect=lambda e: order.append('stop')), \
                    patch.object(LAB, 'start', side_effect=lambda e: order.append('start')), patch.object(LAB, 'wait_boot', side_effect=lambda: order.append('boot')):
                self.assertTrue(LAB.restart(root, LAB.RESTART_MINUTES)['restarted'])
            self.assertEqual(order, ['stop', 'start', 'boot'])

if __name__ == '__main__':
    unittest.main()
