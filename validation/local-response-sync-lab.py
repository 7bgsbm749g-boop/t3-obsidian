#!/usr/bin/env python3
"""Real Headless Sync duplicate-save check using only synthetic lab notes."""
import datetime as dt
import fcntl
import importlib.util
import json
from pathlib import Path
import subprocess
import uuid

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('lab', ROOT / 'scripts/obsidian-sync-lab.py')
lab = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lab)
evidence = lab.EVIDENCE / (dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-local-final-' + uuid.uuid4().hex[:8])
evidence.mkdir(parents=True, exist_ok=False)
case = json.loads(subprocess.run(['./node_modules/.bin/tsx', 'validation/local-response-sync-case.ts'], cwd=ROOT, check=True, capture_output=True, text=True).stdout)
lock = (lab.LAB / 'operation.lock').open('a')
fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
states = {client: lab.active(client) for client in ('a', 'b')}
vaults = {client: Path(lab.configuration(client)[1]['vault']) for client in ('a', 'b')}
name = 'Local final save lab ' + uuid.uuid4().hex[:12] + '.md'
counter = 0
checks = []

def scan(client):
    global counter
    counter += 1
    return lab.scan(client, evidence / f'{counter:02d}-{client}.log')

try:
    for client in states:
        lab.service(client, 'stop')
    (vaults['a'] / name).write_text(case['initial'])
    scan('a'); scan('b')
    assert (vaults['b'] / name).read_text() == case['initial']
    checks.append('Saved binding propagated A to B')
    for client in states:
        (vaults[client] / name).write_text(case[client])
    for client in ('a', 'b', 'a', 'b'):
        scan(client)
    outputs = {client: (vault / name).read_text() for client, vault in vaults.items()}
    assert outputs['a'] == outputs['b'] == case['a']
    assert outputs['a'].count('LOCAL_FINAL_SAVE_LAB_ANSWER') == 1
    checks.append('Two identical independent final saves converged to one answer')
    # Retain output and independent logs before deleting the synthetic note.
    (evidence / 'result.md').write_text(outputs['a'])
    receipt = dict(checks=checks, transport='official Obsidian Headless Sync', pluginFinals='actual LocalResponseManager with synthetic verified completion', desktopCoreRuntime=False, nativeMobile=False, liveEditorAdoption=False, productionTouched=False)
    (evidence / 'result.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps(dict(evidence=str(evidence / 'result.json'), checks=checks)), flush=True)
finally:
    try:
        (vaults['a'] / name).unlink(missing_ok=True)
        for client in ('a', 'b', 'a', 'b'):
            scan(client)
    finally:
        for client, running in states.items():
            lab.service(client, 'start' if running else 'stop')
