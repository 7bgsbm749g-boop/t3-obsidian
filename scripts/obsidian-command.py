#!/usr/bin/env python3
"""Send notes, attach responses, or manage thread event subscriptions in Obsidian."""
import argparse
import json
import os
from pathlib import Path
import time
import uuid


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--vault', required=True, type=Path, help='Local vault root')
    parser.add_argument('--config-dir', default='.obsidian')
    parser.add_argument('--request-id', default=None, help='Reuse this UUID to inspect/retry the same command')
    parser.add_argument('--timeout', type=float, default=90)
    parser.add_argument('--retry', action='store_true', help='Retry a failed result with the original prepared send')
    parser.add_argument('kind', choices=['send-note', 'attach-response', 'subscribe', 'subscriptions', 'update-subscription', 'pause-subscription', 'resume-subscription', 'cancel-subscription'])
    parser.add_argument('note', nargs='?', help='Vault-relative source note path (note sends only)')
    parser.add_argument('--destination', action='append', default=[])
    parser.add_argument('--thread-id')
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
    args = parser.parse_args()
    command_id = str(uuid.UUID(args.request_id)) if args.request_id else str(uuid.uuid4())
    if args.kind in ['send-note', 'attach-response']:
        if not args.note:
            parser.error('Note sends and attachments require a source note.')
        command = dict(version=1, id=command_id, kind=args.kind, notePath=args.note,
                       destinations=list(dict.fromkeys(args.destination)), streamReply=not args.no_stream)
        if args.thread_id:
            command['threadId'] = args.thread_id
        if args.message_id:
            command['messageId'] = args.message_id
    else:
        if args.note or args.destination or args.message_id or args.no_stream:
            parser.error('Subscription commands do not take notes or streaming destinations.')
        command = dict(version=1, id=command_id, kind=args.kind)
        if args.kind == 'subscribe':
            if not all([args.scope, args.scope_kind, args.thread_id, args.project_id, args.environment_id]):
                parser.error('subscribe requires --scope, --scope-kind, --thread-id, --project-id, and --environment-id.')
            command['target'] = dict(threadId=args.thread_id, projectId=args.project_id, environmentId=args.environment_id)
        elif args.kind != 'subscriptions':
            if not args.subscription_id:
                parser.error('This command requires --subscription-id.')
            command['subscriptionId'] = args.subscription_id
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
    base = args.vault / args.config_dir / 't3-code' / 'commands' / 'v1'
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
