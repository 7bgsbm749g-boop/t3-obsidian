#!/usr/bin/env python3
"""Reload the laptop's QLO2 window after Sync, using the plugin's direct command endpoint."""
from __future__ import annotations

import argparse
import base64
import datetime as dt
import fcntl
import json
from pathlib import Path
import subprocess
import uuid

ROOT = Path(__file__).resolve().parent.parent
CONFIG = Path.home() / '.config/send-to-t3-code/laptop-reload.json'
STATE = Path.home() / '.local/state/send-to-t3-code/native-laptop-reload'
RECEIPTS = Path('/home/ubuntu/projects/send-to-t3-code/evidence/releases')
RUNTIME = ('main.js', 'manifest.json', 'styles.css')


def atomic_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(value, indent=2) + '\n')
    temp.replace(path)


def latest_release() -> dict | None:
    releases = []
    for path in RECEIPTS.glob('*/deployment.json'):
        value = json.loads(path.read_text())
        parts = value.get('version', '').split('.')
        if value.get('status') != 'awaiting-live-smoke' or len(parts) != 3 or not all(p.isdigit() for p in parts):
            continue
        hashes = value.get('releaseFileSha256', {})
        if not all(name in hashes for name in RUNTIME):
            continue
        releases.append((tuple(map(int, parts)), {'version': value['version'], 'hashes': {n: hashes[n] for n in RUNTIME}}))
    return max(releases, key=lambda item: item[0])[1] if releases else None


def mailbox(config: dict, command: dict, *, retry: bool = False, cleanup: bool = False) -> dict:
    # Structured data is base64; neither paths nor user strings become shell code.
    payload = base64.b64encode(json.dumps({'vault': config['vault'], 'command': command, 'retry': retry, 'cleanup': cleanup}).encode()).decode()
    script = r'''
$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('PAYLOAD')) | ConvertFrom-Json
$routePath=Join-Path $p.vault '.obsidian/t3-code/storage-route.json'
if(-not (Test-Path $routePath)) {
  @{id=$p.command.id;ok=$false;pending=$true;bootstrapRequired=$true;error='The plugin command bridge is not initialized. Load the current plugin once to create its private mailbox.'} | ConvertTo-Json -Compress; exit
}
$storage=$null
if(Test-Path $routePath) {
  $route=Get-Content $routePath -Raw | ConvertFrom-Json
  if($route.version -ne 1 -or $route.configDir -ne '.obsidian' -or
     [IO.Path]::GetFullPath($route.workspaceRoot) -ne [IO.Path]::GetFullPath($p.vault) -or
     -not [IO.Path]::IsPathRooted($route.storageRoot) -or
     [IO.Path]::GetFullPath($route.storageRoot).StartsWith([IO.Path]::GetFullPath($p.vault).TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase) -or
     [IO.Path]::GetFullPath($route.storageRoot) -eq [IO.Path]::GetFullPath($p.vault)) { throw 'Invalid private mailbox route' }
  $storage=$route.storageRoot
}
$base=Join-Path $storage '.obsidian/t3-code/commands/v1'
if(-not (Test-Path (Join-Path $p.vault '.obsidian/plugins/send-to-t3-code/manifest.json'))) { throw 'QLO2 plugin is unavailable' }
$request=Join-Path $base ('requests/'+$p.command.id+'.json'); $result=Join-Path $base ('results/'+$p.command.id+'.json')
if($p.cleanup) {
  if($p.command.kind -ne 'client-status') { throw 'Cleanup is limited to this status request' }
  Remove-Item $request,$result -ErrorAction SilentlyContinue
  @{ok=$true} | ConvertTo-Json -Compress; exit
}
$endpointPath=Join-Path $base 'endpoint.json'
if(-not (Test-Path $endpointPath)) {
  @{id=$p.command.id;ok=$false;pending=$true;error='The direct laptop plugin endpoint is unavailable. Reload the updated plugin.'} | ConvertTo-Json -Compress; exit
}
$endpoint=Get-Content $endpointPath -Raw | ConvertFrom-Json
$uri=[Uri]$endpoint.url
if($endpoint.version -ne 1 -or $uri.Scheme -ne 'http' -or $uri.Host -ne '127.0.0.1' -or $uri.AbsolutePath -ne '/commands' -or $uri.UserInfo -or $uri.Query -or $uri.Fragment -or $endpoint.token -notmatch '^[0-9a-f]{64}$') { throw 'Invalid direct command endpoint' }
$body=@{command=$p.command;retry=[bool]$p.retry} | ConvertTo-Json -Depth 12 -Compress
$answer=Invoke-RestMethod -Method Post -Uri $uri -Headers @{Authorization=('Bearer '+$endpoint.token)} -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 5 -MaximumRedirection 0
$answer | ConvertTo-Json -Depth 20 -Compress
'''.replace('PAYLOAD', payload)
    bootstrap = '[Console]::InputEncoding=[Text.UTF8Encoding]::new($false); & ([ScriptBlock]::Create([Console]::In.ReadToEnd()))'
    encoded = base64.b64encode(bootstrap.encode('utf-16le')).decode()
    result = subprocess.run(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', config['host'],
                             'powershell.exe -NoProfile -NonInteractive -EncodedCommand ' + encoded],
                            input=script, capture_output=True, text=True, check=True, timeout=15)
    return json.loads(result.stdout.lstrip('\ufeff'))


def attempt(config: dict, release: dict, state: dict) -> dict:
    if state.get('status') == 'complete':
        return state
    status_id = state.setdefault('statusId', str(uuid.uuid4()))
    atomic_json(STATE / 'pending.json', state)
    status_command = {'version': 1, 'id': status_id, 'kind': 'client-status'}
    observed = mailbox(config, status_command, retry=True)
    if not observed.get('ok'):
        return {**state, 'status': 'pending', 'reason': observed.get('error', 'client unavailable')}
    client = observed['client']
    mailbox(config, status_command, cleanup=True)
    state.pop('statusId', None)
    if client['loadedVersion'] == release['version'] and (not state.get('beforeInstanceId') or client['instanceId'] != state['beforeInstanceId']):
        return {**state, 'status': 'complete', 'client': client, 'completedAt': dt.datetime.now(dt.timezone.utc).isoformat()}
    if tuple(map(int, client['loadedVersion'].split('.'))) > tuple(map(int, release['version'].split('.'))):
        return {**state, 'status': 'complete', 'client': client, 'reason': 'client already newer'}
    state.setdefault('beforeInstanceId', client['instanceId'])
    state.setdefault('reloadId', str(uuid.uuid4()))
    atomic_json(STATE / 'pending.json', state)
    command = {'version': 1, 'id': state['reloadId'], 'kind': 'reload-client', 'releaseVersion': release['version'], 'runtimeSha256': release['hashes']}
    scheduled = mailbox(config, command, retry=True)
    return {**state, 'status': 'pending', 'reason': 'waiting for a new loaded client' if scheduled.get('ok') else scheduled.get('error', 'waiting for Sync')}


def retry() -> dict:
    if not CONFIG.exists():
        return {'status': 'not-configured'}
    config = json.loads(CONFIG.read_text())
    release = latest_release()
    if not release:
        return {'status': 'no-published-release'}
    STATE.mkdir(parents=True, exist_ok=True)
    with (STATE / 'retry.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return {'status': 'running'}
        path = STATE / 'pending.json'
        state = json.loads(path.read_text()) if path.exists() else {}
        if state.get('release') != release or state.get('target') != config:
            state = {'release': release, 'target': config, 'status': 'pending'}
        try:
            result = attempt(config, release, state)
        except (subprocess.SubprocessError, OSError, ValueError, KeyError) as error:
            result = {**state, 'status': 'pending', 'reason': 'Laptop transport unavailable: ' + type(error).__name__}
        atomic_json(path, result)
        if result['status'] == 'complete':
            receipt = STATE / ('loaded-' + release['version'] + '.json')
            if not receipt.exists():
                with receipt.open('x') as output:
                    json.dump(result, output, indent=2)
        return result


def install(host: str, vault: str) -> None:
    atomic_json(CONFIG, {'host': host, 'vault': vault})
    units = Path.home() / '.config/systemd/user'
    units.mkdir(parents=True, exist_ok=True)
    (units / 'send-to-t3-native-laptop-reload.service').write_text('[Unit]\nDescription=Reload laptop QLO2 after an immutable plugin release\n[Service]\nType=oneshot\nExecStart=/usr/bin/python3 ' + str(ROOT / 'scripts/laptop-reload.py') + ' --retry\nTimeoutStartSec=55\n')
    (units / 'send-to-t3-native-laptop-reload.timer').write_text('[Unit]\nDescription=Retry laptop QLO2 reload after reconnect\n[Timer]\nOnBootSec=1min\nOnUnitInactiveSec=1min\n[Install]\nWantedBy=timers.target\n')
    subprocess.run(['systemctl', '--user', 'daemon-reload'], check=True)
    subprocess.run(['systemctl', '--user', 'enable', '--now', 'send-to-t3-native-laptop-reload.timer'], check=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--retry', action='store_true')
    parser.add_argument('--install', action='store_true')
    parser.add_argument('--host', default='fleet-laptop')
    parser.add_argument('--vault', default=r'C:\Users\jacks\Documents\QLO2')
    args = parser.parse_args()
    if args.install:
        install(args.host, args.vault)
    print(json.dumps(retry()))


if __name__ == '__main__':
    main()
