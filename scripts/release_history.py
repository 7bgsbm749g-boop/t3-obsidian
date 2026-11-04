"""Maintain private release comparison tables from a reviewed immutable seed.

The release queue owns serialization. No vault files or public documentation are
written. Historical source rows and links remain byte-for-byte field values.
"""
from __future__ import annotations
import csv
import hashlib
import json
from pathlib import Path
import subprocess

try:
    from . import release_policy
except ImportError:
    import release_policy

ACTUAL = 'Published alpha version'


def read(path):
    return json.loads(path.read_text())


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + '.tmp')
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    temp.replace(path)


def file_hash(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def initialize(root: Path, seed: Path | None = None) -> Path:
    directory = root / 'evidence/version-history'
    state = directory / 'history.json'
    if state.exists():
        return state
    if seed is None:
        raise ValueError('Alpha history needs its reviewed seed. Enqueue with --history-seed PATH once.')
    value = read(seed)
    if value.get('schemaVersion') != 1 or len(value.get('releaseRows', [])) != 383 or len(value.get('threadRows', [])) != 478:
        raise ValueError('Invalid reviewed alpha history seed.')
    if value.get('counters') != {'first': '24.8.10', 'zero': '0.111.10', 'build': 377}:
        raise ValueError('History seed does not match the approved comparison baseline.')
    directory.mkdir(parents=True, exist_ok=True)
    original = directory / 'reviewed-seed.json'
    if original.exists():
        if read(original) != value:
            raise ValueError('Reviewed seed already exists with different contents.')
    else:
        write(original, value)
    write(state, {**value, 'seedSha256': file_hash(original), 'records': []})
    render(root, read(state))
    return state


def semantic_bump(value: str, kind: str, *, zero: bool = False) -> str:
    major, minor, patch = map(int, value.split('.'))
    if kind == 'none':
        return value
    if kind == 'major' and not zero:
        return f'{major + 1}.0.0'
    if kind in {'major', 'minor'}:
        return f'{major}.{minor + 1}.0'
    return f'{major}.{minor}.{patch + 1}'


def refresh(release, job: Path, request: dict, version: str, *, seed: Path | None = None) -> dict | None:
    root = release.ROOT
    policy = release_policy.policy(root)
    if not policy or policy['stage'] != 'alpha' or not release_policy.is_alpha_version(root, version):
        return None
    state_path = initialize(root, seed)
    state = read(state_path)
    found = next((r for r in state['records'] if r['version'] == version), None)
    if found is None:
        release_policy.require_target(root, version)
        build = release_policy.alpha_build(version)
        previous_build = state['records'][-1]['build'] if state['records'] else state['counters']['build']
        if build < previous_build or (not state['records'] and version != policy['firstAlphaVersion']):
            raise ValueError('History cannot regress or start from an unapproved alpha version.')
        counters = dict(state['records'][-1]['counters'] if state['records'] else state['counters'])
        # The first approved alpha is a renumbering of the reviewed baseline,
        # not a fictional extra feature increment in the historical proposals.
        kind = 'none' if not state['records'] else request.get('bump', 'patch')
        counters['first'] = semantic_bump(counters['first'], kind)
        counters['zero'] = semantic_bump(counters['zero'], kind, zero=True)
        counters['build'] = build
        found = {'version': version, 'build': build, 'kind': kind, 'counters': counters,
                 'sourceCommit': request['commit'], 'jobId': job.name,
                 'summary': request.get('summary') or 'Reviewed source release; see source commit.',
                 'threadId': request.get('threadId'), 'createdAt': request.get('createdAt'),
                 'releaseTitle': release_policy.release_title(root, version),
                 'baselineTransition': not state['records']}
        state['records'].append(found)
    elif found['sourceCommit'] != request['commit']:
        # An unarchived failed attempt can be replaced in the same queue slot.
        if found.get('archiveSha256') or found['jobId'] != job.name:
            raise ValueError('History cannot replace an archived release or another queue job.')
        found.update(sourceCommit=request['commit'], summary=request.get('summary') or found['summary'], threadId=request.get('threadId'))
    archive = release.archive_path(version)
    receipt = release.release_receipt_dir(version)
    if archive.exists():
        checksum = file_hash(archive)
        if found.get('archiveSha256') and found['archiveSha256'] != checksum:
            raise ValueError('Immutable alpha archive changed; history update refused.')
        found['archiveSha256'] = checksum
    smoke = next((p for p in receipt.glob('smoke-*.json') if '-evidence' not in p.name and read(p).get('status') == 'complete'), None) if receipt.exists() else None
    found['status'] = ('completed live smoke' if smoke else 'installed; live smoke pending' if (receipt / 'deployment.json').exists()
                       else 'packaged; installation unverified' if archive.exists() else 'assigned; packaging pending')
    if smoke:
        found['smokeReceipt'] = str(smoke)
        found['smokeSha256'] = file_hash(smoke)
    if (receipt / 'client-check.json').exists():
        found['clientCheck'] = str(receipt / 'client-check.json')
    found['receiptDirectory'] = str(receipt)
    write(state_path, state)
    render(root, state)
    return found


def mirror_allowed(root: Path, directory: Path) -> bool:
    # Register only existing evidence directories inside a checkout of this
    # same repository. Never recreate a removed worktree or follow symlinks.
    if not directory.is_dir() or directory.is_symlink() or directory.parent.name != 'evidence':
        return False
    checkout = directory.parent.parent
    try:
        current = subprocess.check_output(['git', '-C', str(root), 'rev-parse', '--path-format=absolute', '--git-common-dir'], text=True).strip()
        other = subprocess.check_output(['git', '-C', str(checkout), 'rev-parse', '--path-format=absolute', '--git-common-dir'], text=True, stderr=subprocess.DEVNULL).strip()
        return current == other and directory.resolve() == checkout.resolve() / 'evidence' / directory.name
    except (subprocess.CalledProcessError, OSError):
        return False


def render(root: Path, state: dict) -> None:
    rows = [dict(row) for row in state['releaseRows']]
    threads = [dict(row) for row in state['threadRows']]
    headers = list(rows[0])
    if ACTUAL not in headers:
        headers.insert(0, ACTUAL)
    for row in [*rows, *threads]:
        row.setdefault(ACTUAL, 'Historical comparison only')
    for record in state['records']:
        counters = record['counters']
        row = {key: '' for key in headers}
        thread = record.get('threadId')
        row.update({ACTUAL: record['version'], 'Original version(s)': record['version'],
                    'First new version (superseded)': counters['first'], 'Proposed 0.x.x': counters['zero'],
                    'Alpha proposal (SemVer label only)': f"0.1.0-alpha.{record['build']}",
                    'Obsidian numeric proposal (manifest/tag format)': f"0.0.{record['build']}",
                    'Proposed release title': record.get('releaseTitle', f"t3-obsidian {record['version']}"),
                    'Milestone/build rationale': 'Approved alpha numbering. ' + ('One-time baseline renumbering; earlier rows remain unchanged.' if record['baselineTransition'] else 'Alpha build advances once; comparison counters follow the declared change type.'),
                    'Date': record.get('createdAt') or '',
                    'Thread links': f'[Release work](t3-thread://v1/{thread})' if thread else 'Thread not supplied; source commit ' + record['sourceCommit'],
                    'Concise change': record['summary'], 'Category / increment reason': record['kind'],
                    'Delivery / evidence status': record['status'] + '; source ' + record['sourceCommit'] + '; queue job ' + record['jobId']})
        rows.append(row)
        threads.append(dict(row))
    directories = [root / 'evidence/version-history']
    directories.extend(Path(p) for p in state.get('mirrors', []) if mirror_allowed(root, Path(p)))
    for directory in dict.fromkeys(directories):
        directory.mkdir(parents=True, exist_ok=True)
        for name, values in [('RELEASE-LEDGER', rows), ('THREAD-AUDIT', threads)]:
            csv_path = directory / (name + '.csv')
            temporary_csv = directory / (name + '.csv.tmp')
            with temporary_csv.open('w', newline='') as out:
                writer = csv.DictWriter(out, fieldnames=headers)
                writer.writeheader(); writer.writerows(values)
            temporary_csv.replace(csv_path)
            version_format = release_policy.policy(root).get('versionFormat', '0.0.BUILD-alpha')
            text = ['# Private alpha release history', '', f'The release queue maintains this table. Historical comparisons stay unchanged; new rows record assigned, packaged, installed and completed states separately. The approved version format is `{version_format}` while the project remains in alpha; Alpha is a display label for numeric releases.', '',
                    '| ' + ' | '.join(headers) + ' |', '| ' + ' | '.join('---' for _ in headers) + ' |']
            text.extend('| ' + ' | '.join(str(row.get(k, '')).replace('\n', ' ').replace('|', '\\|') for k in headers) + ' |' for row in values)
            temp = directory / (name + '.md.tmp')
            temp.write_text('\n'.join(text) + '\n'); temp.replace(directory / (name + '.md'))
