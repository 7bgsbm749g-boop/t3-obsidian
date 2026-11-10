import subprocess
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('remote_client', Path(__file__).with_name('remote-client.py'))
remote = importlib.util.module_from_spec(spec)
spec.loader.exec_module(remote)


class RemoteClientTransportTests(unittest.TestCase):
    def test_direct_python_avoids_nested_powershell_stdin_and_preserves_request_identity(self):
        calls = []
        def run(argv, **kwargs):
            calls.append((argv, kwargs))
            return subprocess.CompletedProcess(argv, 0, stdout='{"ok":true,"client":{"loadedVersion":"0.0.399"}}', stderr='')
        command = {'version': 1, 'id': 'fixed-command-id', 'kind': 'client-status'}
        with patch.object(remote, 'connected_command', return_value=None), patch.object(remote.subprocess, 'run', side_effect=run):
            result = remote.mailbox({'host': 'laptop', 'vault': r'C:\Vault'}, command)
        self.assertTrue(result['ok'])
        self.assertEqual(len(calls), 1)
        self.assertIn('python.exe -c', calls[0][0][-1])
        self.assertNotIn('ReadToEnd', calls[0][0][-1])
        self.assertIn('fixed-command-id', __import__('base64').b64decode(calls[0][1]['input'].split("_p=json.loads(base64.b64decode('")[1].split("'")[0]).decode())
        self.assertEqual(calls[0][1]['timeout'], 15)

    def test_old_client_uses_a_small_encoded_legacy_probe_only_after_no_connected_client(self):
        calls = []
        def run(argv, **kwargs):
            calls.append((argv, kwargs))
            return subprocess.CompletedProcess(argv, 0, stdout='null' if len(calls) == 1 else '{"ok":false,"pending":true}', stderr='')
        with patch.object(remote, 'connected_command', return_value=None), patch.object(remote.subprocess, 'run', side_effect=run):
            result = remote.mailbox({'host': 'laptop', 'vault': r'C:\Vault'}, {'id':'fixed','kind':'client-status'})
        self.assertTrue(result['pending'])
        self.assertEqual(len(calls), 2)
        self.assertNotIn('input', calls[1][1])
        self.assertIn('-EncodedCommand', calls[1][0][-1])
        self.assertLess(len(calls[1][0][-1]), 20000)


if __name__ == '__main__':
    unittest.main()
