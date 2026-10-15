#!/usr/bin/env python3
"""Synthetic real-Sync checks for note anchors and separate plugin data."""
import datetime as dt
import fcntl
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import uuid

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('lab', ROOT / 'scripts/obsidian-sync-lab.py')
lab = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lab)
run = uuid.uuid4().hex[:12]
evidence = lab.EVIDENCE / (dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-binding-data-' + run)
evidence.mkdir(parents=True, exist_ok=False)
lock = (lab.LAB / 'operation.lock').open('a')
fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
states = {client: lab.active(client) for client in ('a', 'b')}
vaults = {client: Path(lab.configuration(client)[1]['vault']) for client in ('a', 'b')}
config_dir = '.obsidian-binding-lab-' + run
relative_data = Path(config_dir) / 'plugins' / 't3-binding-data-lab' / 'data.json'
names = ['Binding data note ' + run + '.md', 'Binding data second ' + run + '.md']
configs, checks = {}, []
counter = 0


def fixture(mode=None, value=None):
    command = ['./node_modules/.bin/tsx', 'validation/local-response-sync-case.ts']
    if mode:
        command.append(mode)
    return json.loads(subprocess.run(command, cwd=ROOT, input=json.dumps(value) if value is not None else None,
                                     check=True, capture_output=True, text=True).stdout)


def config(client, *args):
    result = subprocess.run([lab.OB, 'sync-config', '--path', str(vaults[client]), *args, '--json'],
                            env=lab.sync_environment(client), check=True, capture_output=True, text=True)
    return json.loads(result.stdout)


def scan(client):
    global counter
    counter += 1
    return lab.scan(client, evidence / f'{counter:02d}-{client}.log')


def transfer():
    for client in ('a', 'b', 'a', 'b'):
        scan(client)


def read(client):
    return json.loads((vaults[client] / relative_data).read_text())


def write(client, settings):
    path = vaults[client] / relative_data
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(settings, indent=2) + '\n')


case, extra = fixture(), fixture()
try:
    for client in states:
        lab.service(client, 'stop')
        configs[client] = config(client)
        assert not (vaults[client] / config_dir).exists()
        config(client, '--config-dir', config_dir, '--configs', 'community-plugin-data')
    (evidence / 'original-configs.json').write_text(json.dumps(configs, indent=2) + '\n')
    (vaults['a'] / names[0]).write_text(case['initial'])
    scan('a'); scan('b')
    document = (vaults['b'] / names[0]).read_text()
    assert document == case['initial']
    assert not fixture('consume', dict(document=document, settings={}))['attached']
    checks.append('Note arrived first; no unbound T3 work started')
    write('a', case['settingsA'])
    scan('a'); scan('b')
    assert fixture('consume', dict(document=document, settings=read('b')))['attached']
    checks.append('Plugin data.json propagated through official configuration Sync; existing note reconnected')
    # Independent additions while both clients still have the same base.
    replicas = {'a': fixture('merge', [read('a'), extra['settingsA']]),
                'b': fixture('merge', [read('b'), case['settingsB']])}
    for client in states:
        write(client, replicas[client])
    transfer()
    # External settings notifications can arrive separately on both devices.
    # Each notification merges the device's retained replica, as the plugin does.
    for round_number in range(4):
        snapshots = {client: read(client) for client in states}
        (evidence / f'merge-round-{round_number}.json').write_text(json.dumps(snapshots, indent=2) + '\n')
        if snapshots['a'] == snapshots['b'] and len(snapshots['a']['responseBindings']) == 3:
            break
        for client in states:
            replicas[client] = fixture('merge', [replicas[client], snapshots[client]])
            if replicas[client] != snapshots[client]:
                write(client, replicas[client])
        transfer()
    assert read('a') == read('b')
    assert len(read('a')['responseBindings']) == 3
    checks.append('Independent device record additions converged without losing either ID')
    assert not fixture('consume', dict(document='Before\nAfter', settings=read('b')))['attached']
    (vaults['a'] / names[1]).write_text(case['second'])
    scan('a'); scan('b')
    assert fixture('consume', dict(document=(vaults['b'] / names[1]).read_text(), settings=read('b')))['attached']
    checks.append('Settings arrived first; later note reconnected from its hidden response ID')
    finals = {client: fixture('consume', dict(document=(vaults[client] / names[0]).read_text(), settings=read(client), complete=True))['document'] for client in states}
    assert finals['a'] == finals['b']
    for client in states:
        (vaults[client] / names[0]).write_text(finals[client])
    transfer()
    assert (vaults['a'] / names[0]).read_text() == (vaults['b'] / names[0]).read_text() == finals['a']
    assert finals['a'].count('LOCAL_FINAL_SAVE_LAB_ANSWER') == 1
    assert 't3-response-binding:' not in finals['a'] and 'data-t3-response=' not in finals['a']
    checks.append('Identical independent local final saves converged to one ordinary Markdown answer')
    (evidence / 'result.md').write_text(finals['a'])
    (evidence / 'synced-plugin-data.json').write_text(json.dumps(read('a'), indent=2) + '\n')
    receipt = dict(status='passed', checks=checks, transport='official Obsidian Headless Sync',
                   plugin='Actual LocalResponseManager and settings merge, replayed against transferred synthetic bytes',
                   desktopCoreRuntime=False, nativeMobile=False, liveEditorAdoption=False, productionTouched=False)
    (evidence / 'result.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps(dict(evidence=str(evidence / 'result.json'), checks=checks)), flush=True)
finally:
    try:
        for name in names:
            (vaults['a'] / name).unlink(missing_ok=True)
        (vaults['a'] / relative_data).unlink(missing_ok=True)
        transfer()
    finally:
        for client, old in configs.items():
            config(client, '--config-dir', old['configDir'], '--configs', ','.join(old['configs']))
            shutil.rmtree(vaults[client] / config_dir, ignore_errors=True)
        for client, running in states.items():
            lab.service(client, 'start' if running else 'stop')
