"""Checked Obsidian commands and bundled skill over MCP stdio.

Runs on the T3 machine, with Python 3 and no third-party dependencies.
Only the connected Obsidian plugin edits notes. No incoming port is opened.
"""
from __future__ import annotations
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import sys
import threading
import time
import uuid
from connect_commands import atomic_text, select_client, send_command

PROTOCOLS = ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25']
MAX_MESSAGE = 2_200_000
SKILL = Path(__file__).with_name('SKILL.md')
URI = 't3-obsidian://instructions'


def string(description):
    return dict(type='string', description=description)


TARGET = dict(vault=string('Exact vault name or UUID from the Obsidian source context.'),
              clientId=string('Exact device UUID; required when several clients match.'),
              requestId=string('Stable UUID. Reuse after an unconfirmed result; never replace it to repeat an operation.'),
              retry=dict(type='boolean', description='Explicit retry after a confirmed failure and inspection. Ambiguous execution never replays.'))
NOTE = string('Exact vault-relative Markdown path. Do not guess another vault or scan notes.')
BINDING = string('Exact response binding UUID from note_context, not a thread ID.')
HASH = string('SHA-256 checksum returned by the plugin after reading the current note.')


def tool(name, description, properties=None, required=(), readonly=False):
    return dict(name=name, description=description,
                inputSchema=dict(type='object', properties={**TARGET, **(properties or {})},
                                 required=['vault', *required], additionalProperties=False),
                annotations=dict(readOnlyHint=readonly, destructiveHint=not readonly,
                                 idempotentHint=readonly, openWorldHint=False))


TOOLS = [
    dict(name='instructions', description='Read the complete safe Obsidian editing and continuation skill. Before waiting for an automatic next turn, register its reply stream in the same note.',
         inputSchema=dict(type='object', properties={}, additionalProperties=False), annotations=dict(readOnlyHint=True)),
    tool('connected_clients', 'List matching live Obsidian device identities on this T3 machine. No note scan or tokens are returned.', readonly=True),
    tool('note_context', 'Find the exact source note and response destinations for a send. Supply a note or exact T3 send identity.',
         dict(notePath=NOTE, threadId=string('Exact T3 thread ID.'), messageId=string('Exact T3 message ID.'), environmentId=string('Exact T3 environment ID.')), readonly=True),
    tool('prepare_note_edit', 'Read the current note and prepare a checked edit. Preserve protected reply frames exactly. For streaming notes supply bindingId from note_context.',
         dict(notePath=NOTE, bindingId=BINDING), ['notePath'], True),
    tool('submit_note_edit', 'Submit the complete proposed note using editId and originalHash. Streaming proposals save with the final reply; submitted is not saved. Do not wait for your own reply to finish inside that reply.',
         dict(editId=string('Prepared edit UUID.'), originalHash=HASH, proposed=string('Complete proposed Markdown, at most 1 MB. Preserve active response frames byte-for-byte.')), ['editId', 'originalHash', 'proposed']),
    tool('note_edit_status', 'Check whether an edit is submitted or saved; returns the current note checksum for reviewed withdrawal.', dict(editId=string('Prepared edit UUID.')), ['editId'], True),
    tool('cancel_note_edit', 'Withdraw only an unsaved proposal after reviewing its current note checksum. Does not undo saved text.', dict(editId=string('Prepared edit UUID.'), hash=HASH), ['editId', 'hash']),
    tool('create_note', 'Create an explicitly requested ordinary Markdown note through Obsidian. Parent folders must exist; an existing destination is refused.', dict(notePath=NOTE, proposed=string('Complete new Markdown, at most 1 MB; no active response frames.')), ['notePath', 'proposed']),
    tool('rename_note', 'Move or rename through Obsidian with native link updates. Requires its current checksum; refuses an existing destination.', dict(notePath=NOTE, destination=NOTE, originalHash=HASH), ['notePath', 'destination', 'originalHash']),
    tool('response_status', 'Read the status of one exact response binding.', dict(bindingId=BINDING), ['bindingId'], True),
    tool('response_recovery_info', 'Inspect a frozen final reply and current note checksum before a reviewed save retry.', dict(bindingId=BINDING), ['bindingId'], True),
    tool('retry_response_save', 'Retry the checked save of a retained frozen reply after reviewing the current hash. Never sends another prompt or remote Stop.', dict(bindingId=BINDING, hash=HASH), ['bindingId', 'hash']),
    tool('client_status', 'Read the selected running Obsidian client version and connection status.', readonly=True),
    tool('stream_thread', 'Register replies from later turns of this exact thread in the existing destination notes, without sending a prompt. Required before yielding for automatic continuation of Obsidian work. Check thread_streams first and reuse a matching active registration.',
         dict(threadId=string('Exact source thread ID from note_context.'), projectId=string('Exact source project ID from note_context.'), environmentId=string('Exact source environment ID from note_context.'), scope=dict(type='string', enum=['thread']), destinations=dict(type='array', items=NOTE), start=dict(type='string', enum=['future', 'after', 'history'], description='Use future before waiting. Use after with the original prompt ID to catch up a continuation that already started. History imports all prior runs only when requested.'), afterMessageId=string('Original user-message ID; required only for start=after.'), destinationSection=string('Reuse an existing exact destination heading when known; otherwise append to the note.')), ['threadId', 'projectId', 'environmentId', 'scope', 'destinations', 'start']),
    tool('thread_streams', 'Inspect saved thread-follow registrations. Reuse an enabled, uncancelled registration for the exact thread, project, environment and destination notes; inspect errors before claiming continuation is registered.', readonly=True),
    tool('pause_thread_stream', 'Pause an exact reply-follow registration. Existing replies continue; runs started while paused are skipped on resume.', dict(subscriptionId=string('Exact registration UUID from thread_streams.')), ['subscriptionId']),
    tool('resume_thread_stream', 'Resume an exact paused reply-follow registration. Skips runs already started; use stream_thread with an after boundary if catch-up is needed.', dict(subscriptionId=string('Exact registration UUID from thread_streams.')), ['subscriptionId']),
    tool('cancel_thread_stream', 'Cancel an exact reply-follow registration without deleting saved replies. Do not cancel a user-owned follow merely because one task finished.', dict(subscriptionId=string('Exact registration UUID from thread_streams.')), ['subscriptionId']),
    tool('remove_stream_destination', 'Remove one exact destination note from an existing reply-follow registration without deleting its replies.', dict(subscriptionId=string('Exact registration UUID from thread_streams.'), destination=NOTE), ['subscriptionId', 'destination']),
    tool('send_note', 'Only on an explicit user request: send this note to T3, starting agent work. Do not use for answering an existing conversation or saving edits.', dict(notePath=NOTE, destinations=dict(type='array', items=NOTE), streamReply=dict(type='boolean'), destinationSection=string('Optional target heading.')), ['notePath', 'destinations', 'streamReply']),
    tool('attach_response', 'Only on an explicit user request: import an existing exact reply without dispatching another prompt.', dict(notePath=NOTE, threadId=string('Exact T3 thread ID.'), messageId=string('Exact T3 message ID.'), destinations=dict(type='array', items=NOTE), streamReply=dict(type='boolean')), ['notePath', 'threadId', 'messageId', 'destinations', 'streamReply']),
    tool('inspect_folder', 'Inspect the routing of one exact folder; / means the vault root.', dict(folderPath=string('Exact vault-relative folder or /.')), ['folderPath'], True),
    tool('link_folder', 'Link an explicitly selected existing folder to a verified T3 project, changing future note routing.', dict(folderPath=string('Exact vault-relative folder, excluding the root.'), projectId=string('Verified project ID.'), connectionId=string('Verified plugin connection ID.'), environmentId=string('Verified T3 environment ID.'), mode=dict(type='string', enum=['project', 'self']), relink=dict(type='boolean')), ['folderPath', 'projectId', 'connectionId', 'environmentId', 'mode', 'relink']),
    tool('unlink_folder', 'Remove an explicitly selected folder link; does not delete notes or projects.', dict(folderPath=string('Exact vault-relative folder.')), ['folderPath']),
]
BY_NAME = {item['name']: item for item in TOOLS}


def instructions():
    return SKILL.read_text(encoding='utf-8')


def text_result(value, error=False):
    return dict(content=[dict(type='text', text=value if isinstance(value, str) else json.dumps(value, ensure_ascii=False))], isError=error)


def call_tool(name, arguments, root):
    if not isinstance(name, str) or name not in BY_NAME or not isinstance(arguments, dict):
        raise ValueError('Unknown tool or invalid arguments.')
    spec = BY_NAME[name]['inputSchema']
    if set(arguments) - set(spec['properties']) or any(key not in arguments for key in spec.get('required', [])):
        raise ValueError('Missing or unexpected tool arguments.')
    for key, value in arguments.items():
        prop = spec['properties'][key]
        kind = prop['type']
        if kind == 'string' and not isinstance(value, str) or kind == 'boolean' and type(value) is not bool or kind == 'array' and (not isinstance(value, list) or any(not isinstance(item, str) for item in value)):
            raise ValueError('Invalid tool argument type: ' + key)
        if 'enum' in prop and value not in prop['enum']:
            raise ValueError('Invalid tool argument value: ' + key)
    if name == 'instructions':
        return text_result(instructions())
    if name == 'connected_clients':
        matches = select_client(arguments['vault'], root, arguments.get('clientId'), all_matches=True)
        return text_result(dict(ok=True, clients=[{key: item.get(key) for key in ['vaultName', 'vaultId', 'clientId', 'instanceId', 'loadedVersion', 'environmentId', 'expiresAt']} for _, item in matches]))
    arguments = dict(arguments)
    vault = arguments.pop('vault')
    client = arguments.pop('clientId', None)
    request = str(uuid.UUID(arguments.pop('requestId', str(uuid.uuid4()))))
    retry = arguments.pop('retry', False)
    command = dict(version=1, id=request, kind=name.replace('_', '-'), **arguments)
    if name == 'stream_thread':
        command['source'] = {key: command.pop(key) for key in ('threadId', 'projectId', 'environmentId')}
    result = send_command(vault, command, root=root, client_id=client, retry=retry, timeout=45)
    if result is None:
        result = dict(id=request, ok=False, error='No matching Obsidian client is connected. Open the intended vault and connect this T3 machine. No command was sent.')
    return text_result(result, not result.get('ok', False))


def dispatch(message, root):
    method, params = message.get('method'), message.get('params', {})
    if not isinstance(params, dict):
        raise ValueError('Invalid parameters.')
    if method == 'initialize':
        version = params.get('protocolVersion')
        result = dict(protocolVersion=version if version in PROTOCOLS else PROTOCOLS[-1], capabilities=dict(tools={}, resources={}, prompts={}), serverInfo=dict(name='t3-obsidian', version='1.0.0'), instructions=instructions())
        atomic_text(Path(__file__).with_name('last-connected.json'), json.dumps(dict(at=int(time.time() * 1000), protocolVersion=result['protocolVersion'])))
        return result
    if method == 'ping':
        return {}
    if method == 'tools/list':
        return dict(tools=TOOLS)
    if method == 'tools/call':
        return call_tool(params.get('name'), params.get('arguments', {}), root)
    if method == 'resources/list':
        return dict(resources=[dict(uri=URI, name='Obsidian editing skill', description='Checked editing, streaming and final-save instructions.', mimeType='text/markdown')])
    if method == 'resources/read' and params.get('uri') == URI:
        return dict(contents=[dict(uri=URI, mimeType='text/markdown', text=instructions())])
    if method == 'prompts/list':
        return dict(prompts=[dict(name='obsidian-note-editing', description='Use the checked Obsidian editing protocol.')])
    if method == 'prompts/get' and params.get('name') == 'obsidian-note-editing':
        return dict(messages=[dict(role='user', content=dict(type='text', text=instructions()))])
    raise LookupError('Method, resource or prompt not found.')


def serve(root):
    output = threading.Lock()
    slots = threading.BoundedSemaphore(4)
    executor = ThreadPoolExecutor(max_workers=4)

    def write(answer):
        with output:
            sys.stdout.buffer.write((json.dumps(answer, ensure_ascii=False) + '\n').encode('utf-8'))
            sys.stdout.buffer.flush()

    def execute(message):
        try:
            write(dict(jsonrpc='2.0', id=message['id'], result=dispatch(message, root)))
        except (ValueError, LookupError, OSError) as error:
            write(dict(jsonrpc='2.0', id=message['id'], error=dict(code=-32602, message=str(error))))
        except Exception:
            write(dict(jsonrpc='2.0', id=message['id'], error=dict(code=-32603, message='Request failed. Preserve the requestId for any unconfirmed command.')))
        finally:
            slots.release()

    while True:
        raw = sys.stdin.buffer.readline(MAX_MESSAGE + 1)
        if not raw:
            executor.shutdown(wait=True)
            return
        message = None
        try:
            if len(raw) > MAX_MESSAGE or not raw.endswith(b'\n'):
                raise ValueError('MCP message exceeds the size limit.')
            message = json.loads(raw)
            if not isinstance(message, dict) or message.get('jsonrpc') != '2.0':
                raise ValueError('Expected one JSON-RPC 2.0 message.')
            if 'id' not in message:
                continue
            if not isinstance(message['id'], (str, int)) or isinstance(message['id'], bool):
                raise ValueError('Invalid JSON-RPC request ID.')
            if message.get('method') == 'tools/call':
                if not slots.acquire(blocking=False):
                    raise ValueError('Four tool calls are already running. Wait for a result before sending another command.')
                executor.submit(execute, message)
                continue
            answer = dict(jsonrpc='2.0', id=message['id'], result=dispatch(message, root))
        except (ValueError, LookupError, OSError) as error:
            if isinstance(message, dict) and 'id' not in message:
                continue
            answer = dict(jsonrpc='2.0', id=message.get('id') if isinstance(message, dict) else None, error=dict(code=-32601 if isinstance(error, LookupError) else -32602, message=str(error)))
        write(answer)
        if len(raw) > MAX_MESSAGE:
            executor.shutdown(wait=True)
            return


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--transport-root', required=True)
    serve(parser.parse_args().transport_root)
