import contextlib
import importlib.util
import io
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('obsidian_command', Path(__file__).with_name('obsidian-command.py'))
command = importlib.util.module_from_spec(spec)
spec.loader.exec_module(command)


class FailureLogCommandTests(unittest.TestCase):
    def test_ssh_log_uses_exact_remote_vault_and_request_without_local_mailbox_access(self):
        request = '6f7ed71f-f1f9-48bb-ab64-e8193f0032ea'
        argv = ['obsidian-command.py', '--vault', r'C:\Users\jacks\Documents\QLO2', '--ssh-host', 'fleet-laptop', '--request-id', request, 'send-failure-log', '--since', '2026-10-09T17:40:00Z']
        with patch.object(sys, 'argv', argv), patch.object(command, 'remote_failure_log', return_value={'id': request, 'ok': True}) as remote, contextlib.redirect_stdout(io.StringIO()):
            command.main()
        remote.assert_called_once_with('fleet-laptop', Path(argv[2]), {'version': 1, 'id': request, 'kind': 'send-failure-log', 'since': '2026-10-09T17:40:00Z'}, False)

    def test_ssh_diagnostics_cannot_dispatch_notes_or_reload_or_use_an_option_as_host(self):
        for kind, host in [('send-note', 'fleet-laptop'), ('reload-client', 'fleet-laptop'), ('send-failure-log', '-oProxyCommand=anything')]:
            with patch.object(sys, 'argv', ['obsidian-command.py', '--vault', 'unused', '--ssh-host=' + host, kind]), contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                command.main()


if __name__ == '__main__':
    unittest.main()
