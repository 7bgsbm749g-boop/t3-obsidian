from __future__ import annotations

import json
import subprocess
import unittest
from unittest.mock import patch

from scripts import release_memory as memory


class ReleaseMemoryTests(unittest.TestCase):
    def test_backoff_increases_and_stays_bounded(self):
        self.assertEqual([memory.delay(n) for n in range(9)], [30, 60, 120, 240, 480, 900, 900, 900, 900])

    def test_probe_uses_the_exact_allowance_without_starting_a_workload(self):
        for allowed, code in [(False, 75), (True, 0)]:
            result = subprocess.CompletedProcess([], code, json.dumps({'allowed': allowed}), '')
            with patch.object(memory.subprocess, 'run', return_value=result) as command:
                self.assertEqual(memory.probe('768M')['allowed'], allowed)
                self.assertEqual(command.call_args.args[0][-4:], ['--lane', 'heavy', '--memory', '768M'])

    def test_unavailable_or_inconsistent_probe_never_grants_admission(self):
        for result in [subprocess.CompletedProcess([], 0, '{}', ''),
                       subprocess.CompletedProcess([], 75, '{"allowed":true}', ''),
                       subprocess.CompletedProcess([], 2, 'not JSON', '')]:
            with patch.object(memory.subprocess, 'run', return_value=result):
                self.assertEqual(memory.probe('2G')['reason'], 'memory_probe_unavailable')
        with patch.object(memory.subprocess, 'run', side_effect=FileNotFoundError('Unavailable')):
            self.assertFalse(memory.probe('2G')['allowed'])

    def test_only_known_admission_refusals_are_memory_waits(self):
        self.assertTrue(memory.refused(RuntimeError('insufficient_host_headroom')))
        self.assertTrue(memory.refused(subprocess.CalledProcessError(75, ['build']), 'host_memory_pressure'))
        for message in ['JavaScript heap out of memory', 'merge conflict', 'deterministic test failure']:
            self.assertFalse(memory.refused(RuntimeError(message)))
        self.assertFalse(memory.refused(RuntimeError("Test expected 'insufficient_host_headroom'")))
        self.assertFalse(memory.refused(subprocess.CalledProcessError(1, ['tests']),
                                        'Resource manager: command not started (host_memory_pressure).'))
        self.assertTrue(memory.refused(SystemExit('Check failed (75). Full log: retained.log'),
                                       'Resource manager: command not started (host_memory_pressure).'))

    def test_invalid_allowances_are_rejected(self):
        for value in ['', '0', '-1G', '1G; command', 'Infinity', '8 GB', '768MiB', '512', '1T']:
            with self.assertRaises(ValueError):memory.budget(value)
        self.assertEqual(memory.budget('768M'), '768M')
        self.assertEqual(memory.budget(' 768m '), '768M')
