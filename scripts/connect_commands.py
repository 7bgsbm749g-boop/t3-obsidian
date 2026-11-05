"""Checked command-file transport for a running, connected Obsidian client.

This agent-side helper uses the T3 machine's scratch workspace, never vault files.
The plugin accesses the same data through authenticated T3 Connect file APIs.
"""
from __future__ import annotations
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import time
import uuid

MAX_BYTES = 2_000_000
CHUNK_BYTES = 24_000
UUID = re.compile(r'^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$', re.I)


def digest(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def default_root():
    return Path(os.environ.get('T3_OBSIDIAN_COMMAND_ROOT', Path(os.environ.get('T3_BASE_DIR', os.environ.get('T3CODE_HOME', Path.home() / '.t3'))) / 'scratch'))


def atomic_text(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.' + str(uuid.uuid4()) + '.tmp')
    try:
        temporary.write_text(text, encoding='utf-8', newline='')
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def write_text(path, text):
    data = text.encode('utf-8')
    if len(data) > MAX_BYTES:
        raise ValueError('Command data exceeds 2 MB.')
    if len(data) <= CHUNK_BYTES:
        atomic_text(path, text)
        return
    checksum = digest(text)
    parts = (len(data) + CHUNK_BYTES - 1) // CHUNK_BYTES
    for index in range(parts):
        atomic_text(path.parent / (path.name + '.parts') / checksum / (str(index) + '.txt'), base64.b64encode(data[index * CHUNK_BYTES:(index + 1) * CHUNK_BYTES]).decode())
    atomic_text(path, json.dumps(dict(schema='t3-obsidian-blob-v1', hash=checksum, bytes=len(data), parts=parts), separators=(',', ':')))


def read_text(path):
    text = path.read_text(encoding='utf-8')
    if len(text.encode('utf-8')) > MAX_BYTES:
        raise ValueError('Command data exceeds 2 MB.')
    try:
        item = json.loads(text)
    except ValueError:
        return text
    if not isinstance(item, dict) or item.get('schema') != 't3-obsidian-blob-v1':
        return text
    checksum, parts, size = item.get('hash'), item.get('parts'), item.get('bytes')
    if not isinstance(checksum, str) or not re.fullmatch('[a-f0-9]{64}', checksum) or type(parts) is not int or not 1 <= parts <= 84 or type(size) is not int or not 0 <= size <= MAX_BYTES:
        raise ValueError('Invalid command blob manifest.')
    data = bytearray()
    for index in range(parts):
        part = path.parent / (path.name + '.parts') / checksum / (str(index) + '.txt')
        if part.stat().st_size > CHUNK_BYTES * 2:
            raise ValueError('Invalid command chunk size.')
        data.extend(base64.b64decode(part.read_bytes(), validate=True))
        if len(data) > MAX_BYTES:
            raise ValueError('Command data exceeds 2 MB.')
    if len(data) != size or hashlib.sha256(data).hexdigest() != checksum:
        raise ValueError('Command data changed during transfer.')
    return data.decode('utf-8')


def normalized_path(path):
    value = str(path).replace('\\', '/').rstrip('/')
    return value.casefold() if re.match('^[a-z]:/', value, re.I) else value


def select_client(vault, root=None, client_id=None, vault_id=None, all_matches=False):
    root = Path(root or default_root()).expanduser().resolve()
    directory = root / '.t3-obsidian/clients'
    matches = []
    # These are bounded client registrations outside any vault, not note scans.
    paths = list(directory.glob('*/*/ready.json'))
    if len(paths) > 512:
        raise ValueError('Too many Obsidian client registrations. Specify an exact transport root and retire inactive registrations.')
    for path in paths:
        try:
            if path.stat().st_size > 16_000 or path.is_symlink():
                continue
            item = json.loads(path.read_text(encoding='utf-8'))
            if (item.get('version') != 1 or not UUID.fullmatch(str(item.get('vaultId', ''))) or not UUID.fullmatch(str(item.get('clientId', '')))
                    or item.get('expiresAt', 0) <= time.time() * 1000 or item.get('expiresAt', 0) > time.time() * 1000 + 60_000
                    or not re.fullmatch('[a-f0-9]{64}', str(item.get('token', ''))) or not UUID.fullmatch(str(item.get('instanceId', '')))):
                continue
            expected = '.t3-obsidian/clients/' + item['vaultId'] + '/' + item['clientId']
            if item.get('base') != expected or normalized_path(item.get('workspaceRoot', '')) != normalized_path(root) or path.parent.resolve() != root / expected:
                continue
            if client_id and item['clientId'] != client_id or vault_id and item['vaultId'] != vault_id:
                continue
            if not vault_id and str(vault) not in [item['vaultId'], item.get('vaultName')] and normalized_path(vault) != normalized_path(item.get('vaultPath', '')):
                continue
            matches.append((path.parent, item))
        except (ValueError, TypeError, OSError):
            continue
    if all_matches:
        return matches
    if len(matches) > 1:
        raise ValueError('More than one connected client matches. Use --client-id; no command was sent.')
    return matches[0] if matches else None


def remove_owned(path):
    path.unlink(missing_ok=True)
    parts = path.with_name(path.name + '.parts')
    if parts.exists():
        shutil.rmtree(parts)


def send_command(vault, command, *, root=None, client_id=None, vault_id=None, timeout=90, retry=False, cleanup=True):
    if not isinstance(command, dict) or not UUID.fullmatch(str(command.get('id', ''))):
        raise ValueError('A command needs one stable UUID.')
    selected = select_client(vault, root, client_id, vault_id)
    if not selected:
        return None
    base, identity = selected
    request = base / 'requests' / (command['id'] + '.json')
    result = base / 'results' / (command['id'] + '.json')
    marker = request.with_name(request.name + '.ready')
    # Preserve original envelope bytes during an unconfirmed retry. A fresh
    # instance/token may only rewrap the same command; the durable receipt still
    # prevents a second dispatch. Never reuse an ID for another command.
    envelope = dict(version=1, id=command['id'], vaultId=identity['vaultId'], clientId=identity['clientId'], instanceId=identity['instanceId'], token=identity['token'], expiresAt=int(time.time() * 1000) + 120_000, command=command)
    if retry:
        envelope['retry'] = True
    if request.exists():
        prior = json.loads(read_text(request))
        if prior.get('command') != command:
            raise ValueError('This request ID already belongs to different input.')
        if prior.get('token') == identity['token'] and prior.get('expiresAt', 0) > time.time() * 1000 and bool(prior.get('retry')) == bool(retry):
            envelope = prior
    raw = json.dumps(envelope, ensure_ascii=False, separators=(',', ':'))
    checksum = digest(raw)
    write_text(request, raw)
    atomic_text(marker, checksum)
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            item = json.loads(read_text(result))
            if item.get('version') == 1 and item.get('id') == command['id'] and item.get('requestHash') == checksum:
                # Wait for the host's durable consumption marker before cleanup.
                if marker.read_text(encoding='utf-8') != 'consumed:' + checksum:
                    time.sleep(0.05)
                    continue
                if cleanup and not item.get('pending'):
                    for path in [request, result]:
                        remove_owned(path)
                    marker.unlink(missing_ok=True)
                return item
        except (FileNotFoundError, ValueError):
            pass
        time.sleep(0.1)
    return dict(id=command['id'], ok=False, pending=True, error='No command result was confirmed. Reuse this request ID; do not repeat the operation with a new ID.')
