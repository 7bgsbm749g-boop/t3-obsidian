"""Bounded admission probes and durable backoff for release recovery."""
from __future__ import annotations

import json
from pathlib import Path
import re
import subprocess
import sys

PROBE = Path('/home/ubuntu/projects/t3-resource-manager/job_runner.py')
INITIAL_DELAY = 30
MAX_DELAY = 15 * 60
REFUSALS = ('insufficient_host_headroom', 'host_memory_pressure')


def budget(value: str) -> str:
    value = value.strip().upper()
    if not re.fullmatch(r'[1-9][0-9]{0,8}[MG]', value):
        raise ValueError('Use a positive memory allowance such as 768M or 2G.')
    return value


def delay(failed_probes: int) -> int:
    return min(MAX_DELAY, INITIAL_DELAY * 2 ** min(max(failed_probes, 0), 5))


def probe(memory: str) -> dict:
    """Ask the installed manager; never allocate the requested allowance."""
    try:
        result = subprocess.run(
            [sys.executable, str(PROBE), '--check-admission', '--lane', 'heavy', '--memory', budget(memory)],
            capture_output=True, text=True, timeout=15)
        value = json.loads(result.stdout)
        if result.returncode not in (0, 75) or not isinstance(value, dict) or type(value.get('allowed')) is not bool:
            raise ValueError('The memory manager returned no admission decision.')
        if value['allowed'] != (result.returncode == 0):
            raise ValueError('The memory manager returned inconsistent admission evidence.')
        return value
    except (OSError, ValueError, subprocess.TimeoutExpired) as error:
        return {'allowed': False, 'reason': 'memory_probe_unavailable', 'error': str(error)}


def refused(error: BaseException, output: str = '') -> bool:
    """Only explicit admission refusals are transient memory waits."""
    message = str(error).strip()
    if message in REFUSALS or (message.startswith(('Resource manager:', 'Application not started:',
                                                  'Session manager: Application not started:'))
                               and any(reason in message for reason in REFUSALS)):
        return True
    temporary_exit = (isinstance(error, subprocess.CalledProcessError) and error.returncode == 75
                      or bool(re.match(r'^Check failed \(75\)\.', message)))
    if not temporary_exit:
        return False
    if output.strip() in REFUSALS:
        return True
    for line in output.splitlines():
        if line.startswith(('Resource manager: command not started', 'Session manager: Application not started:',
                            'Application not started:')) and any(reason in line for reason in REFUSALS):
            return True
    try:
        decision = json.loads(output)
        return isinstance(decision, dict) and decision.get('allowed') is False and decision.get('reason') in REFUSALS
    except ValueError:
        return False
