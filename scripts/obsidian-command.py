#!/usr/bin/env python3
"""Send notes, manage folder routing, attach responses, or subscribe to Obsidian events."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import re
import time
import uuid


def remote_failure_log(host, vault, command, retry=False):
    # Reuse the existing private Windows SSH mailbox transport. No new server,
    # T3 prompt, GUI input, or plugin settings change is involved.
    spec = importlib.util.spec_from_file_location('laptop_client_mailbox', Path(__file__).with_name('laptop-reload.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.mailbox({'host': host, 'vault': str(vault)}, command, retry=retry)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--vault', required=True, type=Path, help='Local vault root')
    parser.add_argument('--config-dir', default='.obsidian')
    parser.add_argument('--request-id', default=None, help='Reuse this UUID to inspect/retry the same command')
    parser.add_argument('--timeout', type=float, default=90)
    parser.add_argument('--retry', action='store_true', help='Retry a failed result with the original prepared send')
    parser.add_argument('--ssh-host', help='Private Windows SSH alias, for read-only send-failure-log from the VPS')
    parser.add_argument('kind', choices=['client-status', 'send-failure-log', 'reload-client', 'archive-reply-imports', 'response-recovery-info', 'retry-response-save', 'resolve-response-location', 'response-status', 'response-import-info', 'resume-response', 'stage-note-edit', 'submit-note-edit', 'repair-response', 'remove-response', 'send-note', 'attach-response', 'inspect-folder', 'link-folder', 'unlink-folder', 'stream-thread', 'thread-streams', 'pause-thread-stream', 'resume-thread-stream', 'cancel-thread-stream', 'remove-stream-destination', 'subscribe-job', 'subscribe', 'subscriptions', 'update-subscription', 'pause-subscription', 'resume-subscription', 'cancel-subscription'])
    parser.add_argument('--since', help='Read failure log entries at or after this UTC timestamp')
    parser.add_argument('--release-version', help='Exact immutable release for reload-client')
    parser.add_argument('--runtime-hashes', help='JSON object of exact release runtime SHA-256 hashes')
    parser.add_argument('--archive-directory', help='Directory inside a linked local project for old reply imports')
    parser.add_argument('note', nargs='?', help='Vault-relative note or folder path; / means vault root')
    parser.add_argument('--destination', action='append', default=[])
    parser.add_argument('--destination-section', help='Exact unique Markdown heading for response placement')
    parser.add_argument('--binding-id', help='Exact independent response binding UUID')
    parser.add_argument('--note-path', help='Reviewed intended destination for duplicate recovery')
    parser.add_argument('--hash', help='Reviewed original hash for staging, current saved hash for repair')
    parser.add_argument('--thread-id')
    parser.add_argument('--stream-scope', choices=['thread'], help='Explicit opt-in for thread-wide display')
    parser.add_argument('--start', choices=['future', 'history'], default='future')
    parser.add_argument('--job-id')
    parser.add_argument('--job-request-id', help='Original job dispatch request ID')
    parser.add_argument('--job-thread-id')
    parser.add_argument('--job-project-id')
    parser.add_argument('--job-environment-id')
    parser.add_argument('--turn-id')
    parser.add_argument('--remove-destination')
    parser.add_argument('--message-id')
    parser.add_argument('--no-stream', action='store_true')
    parser.add_argument('--scope', help='Vault-relative note/folder to watch; / means vault root')
    parser.add_argument('--scope-kind', choices=['note', 'folder'])
    parser.add_argument('--no-subfolders', action='store_true')
    parser.add_argument('--event', action='append', choices=['create', 'modify', 'property', 'rename', 'delete'])
    parser.add_argument('--property', help='Exact frontmatter property name')
    parser.add_argument('--equals', help='JSON value the changed property must become')
    parser.add_argument('--project-id')
    parser.add_argument('--environment-id')
    parser.add_argument('--subscription-id')
    parser.add_argument('--action', help='Direct action JSON: move-note or set-property; replaces the receiving thread')
    parser.add_argument('--job-state', action='append', choices=['running', 'waiting-approval', 'waiting-input', 'completed', 'failed', 'interrupted', 'cancelled'], help='Job action transition (default: completed)')
    parser.add_argument('--connection-id', help='Exact paired connection ID, or local for this desktop')
    parser.add_argument('--mode', choices=['project', 'self'], help='Link mode (default: project); self requires an existing project at the folder')
    parser.add_argument('--relink', action='store_true', help='Deliberately replace a different direct folder link')
    parser.add_argument('--image-folder', help='Image subfolder inside the linked folder (link-folder only)')
    parser.add_argument('--file-folder', help='Document subfolder inside the linked folder (link-folder only)')
    args = parser.parse_args()
    if args.ssh_host and (args.kind != 'send-failure-log' or args.config_dir != '.obsidian' or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,127}', args.ssh_host)):
        parser.error('--ssh-host requires send-failure-log, a Windows SSH alias, and the default configuration directory.')
    if args.since is not None and args.kind != 'send-failure-log':
        parser.error('--since requires send-failure-log.')
    if args.image_folder is not None or args.file_folder is not None:
        if args.kind != 'link-folder' or not args.image_folder or not args.file_folder:
            parser.error('--image-folder and --file-folder must be supplied together with link-folder.')
    config_path = Path(args.config_dir)
    if (not args.config_dir or config_path.is_absolute() or '..' in config_path.parts
            or '\\' in args.config_dir or ':' in args.config_dir
            or any(ord(char) < 32 or ord(char) == 127 for char in args.config_dir)):
        parser.error('--config-dir must be a directory inside the requested vault.')
    if args.action is not None and args.kind not in ['subscribe', 'subscribe-job']:
        parser.error('--action requires subscribe or subscribe-job.')
    if args.job_state and (args.kind != 'subscribe-job' or args.action is None):
        parser.error('--job-state requires a direct job action.')
    direct_action = None
    if args.action is not None:
        try:
            direct_action = json.loads(args.action)
        except ValueError:
            parser.error('--action must contain valid JSON.')
        if not isinstance(direct_action, dict):
            parser.error('--action must be a JSON object.')
        if any([args.thread_id, args.project_id, args.environment_id]):
            parser.error('Choose an action or a receiving thread, not both.')
    folder_kind = args.kind in ['inspect-folder', 'link-folder', 'unlink-folder']
    if not folder_kind and (args.connection_id is not None or args.mode is not None or args.relink):
        parser.error('Folder linking options require a folder command.')
    try:
        command_id = str(uuid.UUID(args.request_id)) if args.request_id else str(uuid.uuid4())
    except ValueError:
        parser.error('--request-id must be a UUID.')
    if args.archive_directory is not None and args.kind != 'archive-reply-imports':
        parser.error('--archive-directory requires archive-reply-imports.')
    if args.kind in ['client-status', 'send-failure-log', 'reload-client', 'archive-reply-imports']:
        if any([args.note, args.destination, args.thread_id, args.message_id, args.binding_id, args.scope, args.event]):
            parser.error('Client commands do not send notes, prompts, or subscriptions.')
        command = dict(version=1, id=command_id, kind=args.kind)
        if args.kind == 'archive-reply-imports':
            if not all([args.project_id, args.environment_id, args.archive_directory]):
                parser.error('archive-reply-imports requires --project-id, --environment-id and --archive-directory.')
            command.update(projectId=args.project_id, environmentId=args.environment_id, archiveDirectory=args.archive_directory)
        if args.since is not None:
            command['since'] = args.since
        if args.kind == 'reload-client':
            if not args.release_version or not args.runtime_hashes:
                parser.error('reload-client requires --release-version and --runtime-hashes.')
            try:
                command.update(releaseVersion=args.release_version, runtimeSha256=json.loads(args.runtime_hashes))
            except ValueError:
                parser.error('--runtime-hashes must be valid JSON.')
        elif args.release_version or args.runtime_hashes:
            parser.error('Read-only client commands do not reload the client.')
    elif args.kind in ['response-recovery-info', 'retry-response-save', 'resolve-response-location', 'response-status', 'response-import-info', 'resume-response', 'stage-note-edit', 'submit-note-edit', 'repair-response', 'remove-response']:
        if not args.binding_id or args.note or args.destination:
            parser.error('Response commands require --binding-id and do not take note destinations.')
        command = dict(version=1, id=command_id, kind=args.kind, bindingId=args.binding_id)
        if args.hash:
            command['hash'] = args.hash
        if args.note_path:
            command['notePath'] = args.note_path
    elif folder_kind:
        if not args.note:
            parser.error('Folder commands require a vault-relative folder; / means the vault root.')
        if any([args.destination, args.thread_id, args.message_id, args.no_stream, args.scope,
                args.scope_kind, args.no_subfolders, args.event, args.property,
                args.equals is not None, args.subscription_id]):
            parser.error('Folder commands do not take note-send or subscription arguments.')
        command = dict(version=1, id=command_id, kind=args.kind, folderPath=args.note)
        if args.kind == 'link-folder':
            if not all([args.project_id, args.connection_id, args.environment_id]):
                parser.error('link-folder requires --project-id, --connection-id, and --environment-id.')
            command.update(projectId=args.project_id, connectionId=args.connection_id,
                           environmentId=args.environment_id, mode=args.mode or 'project', relink=args.relink)
            if args.image_folder is not None:
                command['replyFolders'] = dict(images=args.image_folder, files=args.file_folder)
        elif any([args.project_id, args.connection_id, args.environment_id, args.mode, args.relink]):
            parser.error('Project selection and relinking options require link-folder.')
    elif args.kind in ['stream-thread', 'thread-streams', 'pause-thread-stream', 'resume-thread-stream', 'cancel-thread-stream', 'remove-stream-destination']:
        if args.note or args.no_stream or args.message_id or args.scope or args.event:
            parser.error('Thread display registration does not send notes or prompts.')
        command = dict(version=1, id=command_id, kind=args.kind)
        if args.kind == 'stream-thread':
            if not all([args.thread_id, args.project_id, args.environment_id, args.destination, args.stream_scope]):
                parser.error('stream-thread requires --stream-scope thread, source --thread-id, --project-id, --environment-id, and --destination.')
            command.update(scope=args.stream_scope, source=dict(threadId=args.thread_id, projectId=args.project_id, environmentId=args.environment_id), destinations=list(dict.fromkeys(args.destination)), start=args.start)
        elif args.kind != 'thread-streams':
            if not args.subscription_id:
                parser.error('Management requires --subscription-id.')
            command['subscriptionId'] = args.subscription_id
            if args.kind == 'remove-stream-destination':
                if not args.remove_destination:
                    parser.error('Removing a destination requires --remove-destination.')
                command['destination'] = args.remove_destination
    elif args.kind in ['send-note', 'attach-response']:
        if not args.note:
            parser.error('Note sends and attachments require a source note.')
        command = dict(version=1, id=command_id, kind=args.kind, notePath=args.note,
                       destinations=list(dict.fromkeys(args.destination)), streamReply=not args.no_stream)
        if args.thread_id:
            command['threadId'] = args.thread_id
        if args.message_id:
            command['messageId'] = args.message_id
    else:
        if args.note or args.destination or args.message_id and args.kind != 'subscribe-job' or args.no_stream:
            parser.error('Subscription commands do not take notes or streaming destinations.')
        command = dict(version=1, id=command_id, kind=args.kind)
        if args.kind in ['subscribe', 'subscribe-job']:
            if args.kind == 'subscribe' and not all([args.scope, args.scope_kind]):
                parser.error('subscribe requires --scope and --scope-kind.')
            if direct_action is not None:
                command['action'] = direct_action
                if args.job_state:
                    command['jobStates'] = list(dict.fromkeys(args.job_state))
            else:
                if not all([args.thread_id, args.project_id, args.environment_id]):
                    parser.error('subscribe requires receiving --thread-id, --project-id, and --environment-id, or --action.')
                command['target'] = dict(threadId=args.thread_id, projectId=args.project_id, environmentId=args.environment_id)
        elif args.kind != 'subscriptions':
            if not args.subscription_id:
                parser.error('This command requires --subscription-id.')
            command['subscriptionId'] = args.subscription_id
        if args.kind == 'subscribe-job':
            if not all([args.job_id, args.job_request_id, args.message_id, args.job_thread_id, args.job_project_id, args.job_environment_id]):
                parser.error('subscribe-job requires --job-id, --job-request-id, --message-id, --job-thread-id, --job-project-id, and --job-environment-id.')
            if args.scope or args.event or args.property or args.equals is not None:
                parser.error('Job subscriptions do not take note filters.')
            command['job'] = dict(jobId=args.job_id, requestId=args.job_request_id, messageId=args.message_id, threadId=args.job_thread_id, projectId=args.job_project_id, environmentId=args.job_environment_id)
            if args.turn_id:
                command['job']['turnId'] = args.turn_id
        if args.scope:
            if not args.scope_kind:
                parser.error('--scope requires --scope-kind.')
            command['scope'] = dict(path=args.scope, kind=args.scope_kind, recursive=not args.no_subfolders)
        if args.kind == 'subscribe' or args.event:
            command['filter'] = dict(events=list(dict.fromkeys(args.event or ['modify'])))
            if args.property:
                command['filter']['property'] = args.property
            if args.equals is not None:
                try:
                    command['filter']['equals'] = json.loads(args.equals)
                except ValueError:
                    parser.error('--equals must be a JSON value, for example true or '"completed"'.')
        elif args.property or args.equals is not None:
            parser.error('A property filter requires --event property.')
    if args.destination_section:
        if args.kind not in ['send-note', 'attach-response', 'stream-thread']:
            parser.error('--destination-section requires a streaming destination command.')
        command['destinationSection'] = args.destination_section
    if args.ssh_host:
        outcome = remote_failure_log(args.ssh_host, args.vault, command, args.retry)
        print(json.dumps(outcome))
        return
    storage_root = args.vault
    route_path = args.vault / args.config_dir / 't3-code' / 'storage-route.json'
    if route_path.exists():
        route = json.loads(route_path.read_text())
        destination = Path(route.get('storageRoot', ''))
        if (route.get('version') != 1 or route.get('configDir') != args.config_dir
                or Path(route.get('workspaceRoot', '')).resolve() != args.vault.resolve()
                or not destination.is_absolute()
                or destination.resolve().is_relative_to(args.vault.resolve())):
            parser.error('Invalid private vault storage route.')
        storage_root = destination
    base = storage_root / args.config_dir / 't3-code' / 'commands' / 'v1'
    if not (base / 'requests').is_dir():
        parser.error('Command mailbox not found. Open the vault in Obsidian with the updated plugin enabled.')
    request = base / 'requests' / (command_id + '.json')
    result = base / 'results' / (command_id + '.json')
    if request.exists():
        if json.loads(request.read_text()) != command:
            parser.error('This request ID already belongs to different input.')
    else:
        temporary = request.with_suffix('.' + str(uuid.uuid4()) + '.tmp')
        try:
            with open(temporary, 'x') as output:
                os.chmod(temporary, 0o600)
                json.dump(command, output)
            # Publish without overwriting another caller's immutable request.
            os.link(temporary, request)
        finally:
            temporary.unlink(missing_ok=True)
    if args.retry and result.exists():
        previous = json.loads(result.read_text())
        if previous.get('ok'):
            print(json.dumps(previous))
            return
        result.unlink()
    deadline = time.monotonic() + args.timeout
    while time.monotonic() < deadline:
        if result.exists():
            response = json.loads(result.read_text())
            print(json.dumps(response))
            raise SystemExit(0 if response.get('ok') else 1)
        time.sleep(0.25)
    print(json.dumps(dict(id=command_id, ok=False, pending=True,
                         error='Timed out waiting for Obsidian. Reuse this request ID; do not create a replacement send.')))
    raise SystemExit(2)


if __name__ == '__main__':
    main()
