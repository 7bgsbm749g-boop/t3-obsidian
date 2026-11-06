#!/usr/bin/env python3
"""Operate the two isolated synthetic Obsidian Sync lab clients.

Authentication stays in the child's environment. This never reads or writes
Obsidian's Sync database or the production QLO2 vault.
"""
import argparse
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import uuid

LAB = Path('/home/ubuntu/.local/share/obsidian-sync-test-lab')
MANIFEST = LAB / 'lab.json'
OB = '/home/ubuntu/.local/bin/ob'
AUTH = Path('/home/ubuntu/.config/obsidian-headless/auth_token')
EVIDENCE = Path('/home/ubuntu/projects/send-to-t3-code/evidence/sync-test-lab')


def stamp():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def configuration(client):
    lab = json.loads(MANIFEST.read_text())
    item = lab['clients'][client]
    vault = Path(item['vault'])
    state = Path(item['state'])
    if not lab['syntheticOnly'] or vault.resolve() != Path('/home/ubuntu/vaults') / ('Sync Test ' + client.upper()):
        raise RuntimeError('Refusing a vault outside the synthetic lab')
    if state.resolve() != LAB / client:
        raise RuntimeError('Refusing shared or unexpected Sync state')
    return lab, item


def sync_environment(client):
    _, item = configuration(client)
    env = os.environ.copy()
    env['XDG_CONFIG_HOME'] = item['state'] + '/config'
    env['OBSIDIAN_AUTH_TOKEN'] = AUTH.read_text().strip()
    return env


def unit(client):
    return 'obsidian-sync-test-' + client + '.service'


def active(client):
    return subprocess.run(['systemctl', '--user', 'is-active', '--quiet', unit(client)]).returncode == 0


def service(client, action):
    configuration(client)
    subprocess.run(['systemctl', '--user', action, unit(client)], check=True)


def scan(client, log=None):
    if active(client):
        raise RuntimeError('Stop this lab client Sync service before a one-shot scan')
    _, item = configuration(client)
    result = subprocess.run([OB, 'sync', '--path', item['vault']], env=sync_environment(client),
                            capture_output=True, text=True, timeout=90)
    if log:
        with log.open('x') as out:
            out.write(result.stdout + result.stderr)
    if result.returncode or 'Fully synced' not in result.stdout:
        raise RuntimeError('Official Sync scan did not finish; inspect retained log')
    return {'client': client, 'at': stamp(), 'fullySynced': True}


def status():
    lab, _ = configuration('a')
    clients = {}
    for name in ('a', 'b'):
        _, item = configuration(name)
        result = subprocess.run([OB, 'sync-status', '--path', item['vault'], '--json'],
                                env=sync_environment(name), capture_output=True, text=True, check=True)
        value = json.loads(result.stdout)
        if value['vaultId'] != lab['remoteVault']['id']:
            raise RuntimeError('The lab client is connected to a different remote vault')
        clients[name] = dict(vault=item['vault'], desktopProfile=item['desktopProfile'],
                             xdgConfigHome=item['state'] + '/config',
                             continuousSyncActive=active(name), sync=value)
    return dict(remoteVault=lab['remoteVault'], clients=clients,
                transport=lab['transport'], syntheticOnly=True, nativeMobileVerified=False)


def wait_for(path, expected=None, absent=False):
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        if absent and not path.exists():
            return
        if not absent and path.is_file() and (expected is None or path.read_bytes() == expected):
            return
        time.sleep(0.25)
    raise RuntimeError('Sync did not produce the expected file state: ' + str(path))


def smoke():
    status()  # Validate both actual remote identities before any mutation.
    run_id = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + uuid.uuid4().hex[:8]
    evidence = EVIDENCE / run_id
    evidence.mkdir(parents=True, exist_ok=False)
    a = Path(configuration('a')[1]['vault'])
    b = Path(configuration('b')[1]['vault'])
    name = 'Sync lab smoke ' + run_id + '.md'
    renamed = 'Renamed ' + name
    body = ('# Synthetic Sync smoke\n\nCreated by A: ' + run_id + '\n').encode()
    edited = body + b'Edited by B through its independent local copy.\n'
    offline = edited + b'A changed this while B was disconnected.\n'
    tracked = (a / name, b / name, a / renamed, b / renamed)
    was_active = {x: active(x) for x in ('a', 'b')}
    steps = []
    result = dict(status='running', runId=run_id, startedAt=stamp(),
                  transport='official Obsidian Headless Sync, two independent local vaults',
                  nativeDesktopSyncEngine=False, nativeMobileVerified=False, steps=steps)
    try:
        for x in ('a', 'b'):
            service(x, 'stop')
            scan(x, evidence / ('baseline-' + x + '.log'))
            service(x, 'start')
        with (a / name).open('xb') as out:
            out.write(body)
        wait_for(b / name, body)
        steps.append(dict(check='create A -> B', at=stamp(), sha256=hashlib.sha256(body).hexdigest()))
        (b / name).write_bytes(edited)
        wait_for(a / name, edited)
        steps.append(dict(check='edit B -> A', at=stamp(), sha256=hashlib.sha256(edited).hexdigest()))
        (b / name).rename(b / renamed)
        wait_for(a / renamed, edited)
        wait_for(a / name, absent=True)
        steps.append(dict(check='rename B -> A, old path absent', at=stamp()))
        service('b', 'stop')
        (a / renamed).write_bytes(offline)
        service('a', 'stop')
        scan('a', evidence / 'offline-source-upload.log')
        if (b / renamed).read_bytes() != edited:
            raise RuntimeError('Disconnected B unexpectedly received the new bytes')
        steps.append(dict(check='B stayed stale while disconnected', at=stamp()))
        service('a', 'start')
        service('b', 'start')
        wait_for(b / renamed, offline)
        steps.append(dict(check='reconnect B catches up', at=stamp(), sha256=hashlib.sha256(offline).hexdigest()))
        (evidence / 'final-note.md').write_bytes(offline)
        (a / renamed).unlink()
        wait_for(b / renamed, absent=True)
        steps.append(dict(check='owned temporary note deletion A -> B', at=stamp()))
        for x in ('a', 'b'):
            service(x, 'stop')
            scan(x, evidence / ('final-' + x + '.log'))
        if any(p.exists() for p in tracked):
            raise RuntimeError('A temporary test path remains')
        result.update(status='complete', completedAt=stamp(), temporaryNotesCleaned=True,
                      clients=status()['clients'])
    except Exception as error:
        result.update(status='failed', failedAt=stamp(), error=str(error),
                      retainedTemporaryPaths=[str(p) for p in tracked if p.exists()])
        raise
    finally:
        for x in ('a', 'b'):
            if was_active[x]:
                service(x, 'start')
            else:
                service(x, 'stop')
        result['restoredContinuousSync'] = {x: active(x) for x in ('a', 'b')}
        with (evidence / 'smoke.json').open('x') as out:
            json.dump(result, out, indent=2)
        print(json.dumps(dict(evidence=str(evidence / 'smoke.json'), **result), indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('status', 'scan', 'start', 'stop', 'run', 'smoke'))
    parser.add_argument('client', nargs='?', choices=('a', 'b', 'both'))
    args = parser.parse_args()
    operation_lock = None
    if args.action not in ('status', 'run'):
        operation_lock = (LAB / 'operation.lock').open('a')
        try:
            fcntl.flock(operation_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            parser.error('Another lab operation is running; preserve its clients')
    if args.action == 'status':
        print(json.dumps(status(), indent=2))
    elif args.action == 'smoke':
        smoke()
    elif args.action == 'run':
        if args.client not in ('a', 'b'):
            parser.error('run requires one client')
        _, item = configuration(args.client)
        os.execve(OB, [OB, 'sync', '--continuous', '--path', item['vault']], sync_environment(args.client))
    else:
        if not args.client:
            parser.error('this action requires a client')
        for client in (('a', 'b') if args.client == 'both' else (args.client,)):
            if args.action == 'scan':
                print(json.dumps(scan(client)))
            else:
                service(client, args.action)
        if args.action in ('start', 'stop'):
            print(json.dumps(status(), indent=2))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
