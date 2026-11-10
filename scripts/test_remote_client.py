import subprocess
import base64
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('remote_client', Path(__file__).with_name('remote-client.py'))
remote = importlib.util.module_from_spec(spec)
spec.loader.exec_module(remote)


class RemoteClientTransportTests(unittest.TestCase):
    def test_connected_result_returns_without_opening_ssh(self):
        answer = {'id': 'fixed', 'ok': True}
        with patch.object(remote, 'connected_command', return_value=answer), patch.object(remote.subprocess, 'run') as run:
            self.assertIs(remote.mailbox({'vault': 'synthetic'}, {'id': 'fixed', 'kind': 'client-status'}), answer)
            run.assert_not_called()

    def test_unsupported_fallback_command_is_rejected_before_ssh(self):
        with patch.object(remote, 'connected_command', return_value=None), patch.object(remote.subprocess, 'run') as run:
            with self.assertRaisesRegex(ValueError, 'maintenance commands only'):
                remote.mailbox({'vault': 'synthetic'}, {'id': 'fixed', 'kind': 'edit-note'})
            run.assert_not_called()

    def test_unconfirmed_python_and_powershell_commands_preserve_id_without_exposing_output(self):
        command = {'id': 'fixed-request', 'kind': 'reload-client'}
        for powershell in [False, True]:
            for timeout in [False, True]:
                failure = (subprocess.TimeoutExpired(['ssh'], 15, stderr='private-token') if timeout else
                           subprocess.CalledProcessError(1, ['ssh'], stderr='private-token'))
                responses = [subprocess.CompletedProcess(['ssh'], 0, stdout='null', stderr='')] if powershell else []
                # A direct nonzero exit must also exercise check_returncode().
                responses.append(failure if timeout or powershell else subprocess.CompletedProcess(['ssh'], 1, stdout='', stderr='private-token'))
                with self.subTest(powershell=powershell, timeout=timeout), patch.object(remote, 'connected_command', return_value=None), patch.object(remote.subprocess, 'run', side_effect=responses) as run:
                    result = remote.mailbox({'vault': 'synthetic', 'host': 'laptop'}, command)
                self.assertEqual(result['id'], command['id'])
                self.assertFalse(result['ok'])
                self.assertTrue(result['pending'])
                self.assertIn('Reuse its request ID', result['error'])
                self.assertNotIn('private-token', str(result))
                self.assertEqual(run.call_count, 2 if powershell else 1)

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
        script = base64.b64decode(calls[1][0][-1].split('-EncodedCommand ')[1]).decode('utf-16le')
        self.assertIn('-or $uri.IsDefaultPort -or', script)
        self.assertLess(script.index('$uri.IsDefaultPort'), script.index('Invoke-RestMethod'))


if __name__ == '__main__':
    unittest.main()
