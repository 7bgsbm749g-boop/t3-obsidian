#!/usr/bin/env python3
"""Send checked commands to a connected Obsidian client through T3."""
import argparse
import importlib.util
import json
from pathlib import Path
import re
import urllib.request
import urllib.error
import urllib.parse
import socket
try:
    from connect_commands import send_command, select_client
except ModuleNotFoundError:
    from scripts.connect_commands import send_command, select_client
import uuid
import os
import sys


def resolve_vault(value, config_dir='.obsidian'):
    """Resolve a displayed vault name through Obsidian's own local registry."""
    candidate = Path(value).expanduser()
    if candidate.is_absolute() or '/' in value or '\\' in value or value.startswith('.'):
        return candidate
    if sys.platform == 'win32':
        config = Path(os.environ.get('APPDATA', Path.home() / 'AppData' / 'Roaming'))
    elif sys.platform == 'darwin':
        config = Path.home() / 'Library' / 'Application Support'
    else:
        config = Path(os.environ.get('XDG_CONFIG_HOME', Path.home() / '.config'))
    try:
        registered = json.loads((config / 'obsidian' / 'obsidian.json').read_text(encoding='utf-8-sig'))
    except (FileNotFoundError, ValueError):
        raise ValueError('Cannot resolve the vault name. Supply its verified absolute path with --vault.')
    if not isinstance(registered, dict) or not isinstance(registered.get('vaults'), dict):
        raise ValueError('Invalid Obsidian vault registry. Supply a verified absolute path with --vault.')
    matches = {Path(item['path']).resolve() for item in registered['vaults'].values()
               if isinstance(item, dict) and isinstance(item.get('path'), str) and Path(item['path']).name == value}
    if len(matches) != 1:
        raise ValueError('Vault name is missing or ambiguous. Supply its verified absolute path with --vault.')
    return matches.pop()


def remote_failure_log(host, vault, command, retry=False):
    # Reuse the existing private Windows SSH command transport. No T3 prompt, GUI input,
    # or plugin settings change is involved.
    spec = importlib.util.spec_from_file_location('remote_client_mailbox', Path(__file__).with_name('remote-client.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.mailbox({'host': host, 'vault': str(vault)}, command, retry=retry)


def legacy_client(vault,config_dir,command,retry=False,timeout=5):
    """One upgrade bridge for old clients; never used for note edits or sends."""
    if command['kind'] not in ['client-status','send-failure-log','reload-client']:
        return None
    storage_root = vault
    route_path = vault / config_dir / 't3-code' / 'storage-route.json'
    if route_path.exists():
        route = json.loads(route_path.read_text())
        destination = Path(route.get('storageRoot', ''))
        if (route.get('version') != 1 or route.get('configDir') != config_dir
                or Path(route.get('workspaceRoot', '')).resolve() != vault.resolve()
                or not destination.is_absolute()
                or destination.resolve().is_relative_to(vault.resolve())):
            raise ValueError('Invalid private vault storage route.')
        storage_root = destination
    base = storage_root / config_dir / 't3-code' / 'commands' / 'v1'
    try:
        endpoint = json.loads((base / 'endpoint.json').read_text())
        target = urllib.parse.urlsplit(endpoint.get('url', ''))
        if (endpoint.get('version') != 1 or target.scheme != 'http' or target.hostname != '127.0.0.1'
                or not target.port or target.path != '/commands' or target.query or target.fragment
                or target.username or target.password or not re.fullmatch(r'[0-9a-f]{64}', endpoint.get('token', ''))):
            raise ValueError('Invalid direct command endpoint.')
        data = json.dumps(dict(command=command, retry=retry)).encode()
        request = urllib.request.Request(endpoint['url'], data=data, method='POST', headers={
            'Authorization': 'Bearer ' + endpoint['token'], 'Content-Type': 'application/json'})
        # Loopback traffic never uses proxy settings or follows redirects.
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, req, fp, code, msg, headers, newurl):
                return None
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        try:
            with opener.open(request, timeout=timeout) as response:
                result = json.load(response)
        except urllib.error.HTTPError as error:
            result = json.load(error)
        return result
    except (FileNotFoundError, ConnectionRefusedError):
        return None
    except (TimeoutError, socket.timeout, urllib.error.URLError, ConnectionError):
        return dict(id=command['id'],ok=False,pending=True,error='The legacy client did not confirm this command. Reuse its request ID.')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--vault',required=True,help='Exact vault name, UUID, or registered local path')
    parser.add_argument('--vault-id')
    parser.add_argument('--client-id',help='Exact connected Obsidian device UUID when multiple clients match')
    parser.add_argument('--transport-root',help="T3's No project workspace root on this agent machine")
    parser.add_argument('--config-dir',default='.obsidian')
    parser.add_argument('--request-id')
    parser.add_argument('--timeout',type=float,default=90)
    parser.add_argument('--retry',action='store_true',help='Explicitly retry a failed command; ambiguous executions never replay')
    parser.add_argument('--ssh-host',help='Existing private Windows route for read-only failure logs')
    parser.add_argument('--output',help='Write the JSON result to an agent-owned file instead of stdout')
    parser.add_argument('kind',choices=['connected-clients','note-context','client-status','send-failure-log','reload-client','response-recovery-info','retry-response-save','resolve-response-location','response-status','response-import-info','resume-response','prepare-note-edit','submit-note-edit','note-edit-status','cancel-note-edit','create-note','rename-note','repair-response','remove-response','send-note','attach-response','inspect-folder','link-folder','unlink-folder','stream-thread','thread-streams','pause-thread-stream','resume-thread-stream','cancel-thread-stream','remove-stream-destination'])
    parser.add_argument('note',nargs='?')
    for name in ['since','release-version','runtime-hashes','destination-section','binding-id','note-path','hash','edit-id','proposed-file','thread-id','message-id','project-id','environment-id','subscription-id','remove-destination','connection-id','image-folder','file-folder']:
        parser.add_argument('--'+name)
    parser.add_argument('--destination',action='append',default=[])
    parser.add_argument('--stream-scope',choices=['thread'])
    parser.add_argument('--start',choices=['future','history'],default='future')
    parser.add_argument('--no-stream',action='store_true')
    parser.add_argument('--mode',choices=['project','self'])
    parser.add_argument('--relink',action='store_true')
    args=parser.parse_args()
    try:
        request_id=str(uuid.UUID(args.request_id)) if args.request_id else str(uuid.uuid4())
        if not 0 < args.timeout <= 300:
            raise ValueError('Timeout must be between 0 and 300 seconds.')
        if args.kind=='connected-clients':
            clients=select_client(args.vault,args.transport_root,args.client_id,args.vault_id,all_matches=True)
            print(json.dumps({'ok':True,'clients':[{key:item.get(key) for key in ['vaultName','vaultId','clientId','instanceId','loadedVersion','environmentId','expiresAt']} for _,item in clients]}))
            return
        command=dict(version=1,id=request_id,kind=args.kind)
        if args.kind in ['prepare-note-edit','submit-note-edit','note-edit-status','cancel-note-edit','create-note','rename-note']:
            if args.kind=='create-note':
                if not args.note or not args.proposed_file: raise ValueError('Create needs a new note path and --proposed-file.')
                proposal=Path(args.proposed_file)
                if proposal.stat().st_size>1_000_000: raise ValueError('The proposed note exceeds 1 MB.')
                command.update(notePath=args.note,proposed=proposal.read_bytes().decode('utf-8'))
            elif args.kind=='rename-note':
                if not args.note or not args.note_path or not args.hash: raise ValueError('Rename needs the source note, new --note-path and current --hash.')
                command.update(notePath=args.note,destination=args.note_path,originalHash=args.hash)
            elif args.kind=='prepare-note-edit':
                if not args.note:
                    raise ValueError('prepare-note-edit needs the exact vault-relative note path.')
                command['notePath']=args.note
                if args.binding_id: command['bindingId']=args.binding_id
            else:
                if not args.edit_id: raise ValueError('Use the prepared edit ID.')
                command['editId']=args.edit_id
                if args.kind=='cancel-note-edit':
                    if not args.hash: raise ValueError('Review the current note --hash before withdrawing a proposal.')
                    command['hash']=args.hash
                if args.kind=='submit-note-edit':
                    if not args.hash or not args.proposed_file: raise ValueError('Submit the original --hash and --proposed-file.')
                    proposal=Path(args.proposed_file)
                    if proposal.stat().st_size>1_000_000: raise ValueError('The proposed note exceeds 1 MB.')
                    command.update(originalHash=args.hash,proposed=proposal.read_bytes().decode('utf-8'))
        elif args.kind in ['client-status','send-failure-log','reload-client']:
            if args.note or args.destination: raise ValueError('Client commands do not take notes or destinations.')
            if args.kind=='reload-client':
                if not args.release_version or not args.runtime_hashes: raise ValueError('Reload needs the exact version and complete runtime hashes.')
                command.update(releaseVersion=args.release_version,runtimeSha256=json.loads(args.runtime_hashes))
            elif args.release_version or args.runtime_hashes: raise ValueError('Read-only client commands do not reload the client.')
            if args.since:
                if args.kind!='send-failure-log': raise ValueError('--since requires send-failure-log.')
                command['since']=args.since
        elif args.kind=='note-context':
            if not any([args.note,args.thread_id,args.message_id]): raise ValueError('Supply an exact note or T3 identity.')
            for key,value in [('notePath',args.note),('threadId',args.thread_id),('messageId',args.message_id),('environmentId',args.environment_id)]:
                if value is not None: command[key]=value
        elif args.kind in ['inspect-folder','link-folder','unlink-folder']:
            if not args.note: raise ValueError('Supply a vault-relative folder, or / for the root.')
            command['folderPath']=args.note
            if args.kind=='link-folder':
                if not all([args.project_id,args.environment_id,args.connection_id]): raise ValueError('Linking requires the exact project, environment and connection IDs.')
                command.update(projectId=args.project_id,environmentId=args.environment_id,connectionId=args.connection_id,mode=args.mode or 'project',relink=args.relink)
                if args.image_folder or args.file_folder:
                    if not args.image_folder or not args.file_folder: raise ValueError('Supply both reply folders.')
                    command['replyFolders']=dict(images=args.image_folder,files=args.file_folder)
        elif args.kind in ['stream-thread','thread-streams','pause-thread-stream','resume-thread-stream','cancel-thread-stream','remove-stream-destination']:
            if args.kind=='stream-thread':
                if not all([args.thread_id,args.project_id,args.environment_id,args.stream_scope,args.destination]): raise ValueError('Following requires thread scope, exact source IDs and destination notes.')
                command.update(scope=args.stream_scope,source=dict(threadId=args.thread_id,projectId=args.project_id,environmentId=args.environment_id),destinations=args.destination,start=args.start)
            elif args.kind!='thread-streams':
                command['subscriptionId']=args.subscription_id
                if args.kind=='remove-stream-destination': command['destination']=args.remove_destination
        elif args.kind in ['send-note','attach-response']:
            if not args.note: raise ValueError('Supply the source note.')
            command.update(notePath=args.note,destinations=list(dict.fromkeys(args.destination)),streamReply=not args.no_stream)
            if args.thread_id: command['threadId']=args.thread_id
            if args.message_id: command['messageId']=args.message_id
        else:
            if not args.binding_id: raise ValueError('Supply an exact response binding ID.')
            command['bindingId']=args.binding_id
            if args.hash: command['hash']=args.hash
            if args.note_path: command['notePath']=args.note_path
        if args.destination_section:
            if args.kind not in ['send-note','attach-response','stream-thread']: raise ValueError('A section requires a streaming destination command.')
            command['destinationSection']=args.destination_section
        if args.ssh_host:
            if args.kind!='send-failure-log' or args.config_dir!='.obsidian' or not re.fullmatch('[A-Za-z0-9][A-Za-z0-9_.-]{0,127}',args.ssh_host): raise ValueError('The SSH route is limited to failure logs from an existing private Windows alias.')
            result=remote_failure_log(args.ssh_host,Path(args.vault),command,args.retry)
        else:
            result=send_command(args.vault,command,root=args.transport_root,client_id=args.client_id,vault_id=args.vault_id,timeout=args.timeout,retry=args.retry)
            if result is None and args.kind in ['client-status','send-failure-log','reload-client']:
                try: result=legacy_client(resolve_vault(args.vault),args.config_dir,command,args.retry,args.timeout)
                except ValueError: pass
            if result is None: result=dict(id=request_id,ok=False,error='No matching connected Obsidian client is ready. Open the vault and connect T3; specify --client-id if needed. No command was queued.')
        if args.output:
            Path(args.output).write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        else: print(json.dumps(result,ensure_ascii=False))
        if not result.get('ok'): raise SystemExit(2 if result.get('pending') else 1)
    except (ValueError,OSError) as error:
        parser.error(str(error))


if __name__=='__main__': main()
