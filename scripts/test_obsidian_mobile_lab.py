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


if __name__ == '__main__':
    unittest.main()
