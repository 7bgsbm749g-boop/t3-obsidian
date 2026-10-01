#!/usr/bin/env python3
"""Ask the running Send to T3 Code plugin to send a note or attach a response."""
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
    parser.add_argument('kind', choices=['send-note', 'attach-response'])
    parser.add_argument('note', help='Vault-relative source note path')
    parser.add_argument('--destination', action='append', default=[])
    parser.add_argument('--thread-id')
    parser.add_argument('--message-id')
    parser.add_argument('--no-stream', action='store_true')
    args = parser.parse_args()
    command_id = str(uuid.UUID(args.request_id)) if args.request_id else str(uuid.uuid4())
    command = dict(version=1, id=command_id, kind=args.kind, notePath=args.note,
                   destinations=list(dict.fromkeys(args.destination)), streamReply=not args.no_stream)
    if args.thread_id:
        command['threadId'] = args.thread_id
    if args.message_id:
        command['messageId'] = args.message_id
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
