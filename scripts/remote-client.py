#!/usr/bin/env python3
"""Private SSH transport for Obsidian client diagnostics."""
from __future__ import annotations
import base64
import json
from pathlib import Path
import subprocess
try:
    from connect_commands import send_command as connected_command
except ModuleNotFoundError:
    from scripts.connect_commands import send_command as connected_command


def mailbox(config: dict, command: dict, *, retry: bool = False, cleanup: bool = False) -> dict:
    if cleanup:
        return {'ok': True}  # Connected commands clean their exact files after acknowledgement.
    connected = connected_command(config['vault'], command, root=config.get('transportRoot'), client_id=config.get('clientId'), timeout=5, retry=retry)
    if connected is not None:
        return connected
    # A client connected only to its own T3 machine uses the same helper there.
    # Legacy HTTP below is restricted to the first reload from an older plugin.
    if command.get('kind') not in ['client-status', 'send-failure-log', 'reload-client']:
        raise ValueError('The remote transport accepts maintenance commands only.')
    # Send one bounded Python program directly over SSH. Nesting Python's
    # stdin pipe inside a PowerShell ReadToEnd bootstrap can hang before the
    # legacy bridge is reached, leaving a successfully synced client stale.
    payload = base64.b64encode(json.dumps({'vault': config['vault'], 'command': command, 'retry': retry, 'cleanup': cleanup}).encode()).decode()
    helper = Path(__file__).with_name('connect_commands.py').read_text() + "\n_p=json.loads(base64.b64decode('" + payload + "').decode())\ntry:\n _r=send_command(_p['vault'],_p['command'],timeout=5,retry=_p['retry'])\nexcept (ValueError,OSError) as _e:\n _r=dict(id=_p['command']['id'],ok=False,error=str(_e))\nprint(json.dumps(_r))\n"
    remote = ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', config['host']]
    result = subprocess.run([*remote, 'python.exe -c "import sys;exec(sys.stdin.read())"'],
                            input=helper, capture_output=True, text=True, timeout=15)
    if result.returncode == 0:
        answer = json.loads(result.stdout.lstrip('\ufeff'))
        if answer is not None:
            return answer
    elif not any(text in result.stderr.lower() for text in ['not recognized', 'was not found', 'not found']):
        result.check_returncode()
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
if(-not (Test-Path (Join-Path $p.vault '.obsidian/plugins/t-three-code/manifest.json')) -and
   -not (Test-Path (Join-Path $p.vault '.obsidian/plugins/send-to-t3-code/manifest.json'))) { throw 'QLO2 plugin is unavailable' }
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
    encoded = base64.b64encode(script.encode('utf-16le')).decode()
    result = subprocess.run([*remote, 'powershell.exe -NoProfile -NonInteractive -EncodedCommand ' + encoded],
                            capture_output=True, text=True, check=True, timeout=15)
    return json.loads(result.stdout.lstrip('\ufeff'))
