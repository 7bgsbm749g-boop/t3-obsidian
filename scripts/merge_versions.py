"""Assign versions after merged PRs, using one atomic metadata commit per PR."""
from __future__ import annotations

import base64
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
import json
import os
from pathlib import Path
import re
import subprocess

import github_release as release

LEDGER = 'pr-versions.json'
FILES = (*release.VERSION_FILES, LEDGER)


def ledger_state(value: dict) -> dict:
    if value.get('schemaVersion') != 1 or not isinstance(value.get('pullRequests'), dict):
        raise ValueError('Invalid PR version ledger.')
    if value.get('since') is None:
        if value['pullRequests'] or value.get('latest'):
            raise ValueError('Assigned ledger cannot reset its cutover.')
    else:
        datetime.fromisoformat(value['since'].replace('Z', '+00:00'))
    assigned = []
    for number, row in value['pullRequests'].items():
        if not re.fullmatch(r'[1-9][0-9]*', number) or not release.NUMERIC_VERSION.fullmatch(row['version']):
            raise ValueError('Invalid PR version assignment.')
        if not re.fullmatch(r'[a-f0-9]{40}', row['mergeCommit']):
            raise ValueError('Invalid merged source identity.')
        assigned.append(row['version'])
    if len(assigned) != len(set(assigned)):
        raise ValueError('Duplicate versions in the PR ledger.')
    latest = value.get('latest')
    if latest is not None:
        if (not isinstance(latest, dict) or str(latest.get('pr')) not in value['pullRequests']
                or value['pullRequests'][str(latest['pr'])]['version'] != latest.get('version')
                or not isinstance(latest.get('source'), str)
                or not re.fullmatch(r'[a-f0-9]{40}', latest['source'])):
            raise ValueError('Invalid latest PR version receipt.')
    elif assigned:
        raise ValueError('PR version ledger has no latest receipt.')
    return value


def activate(repo: str, source: str, ledger: dict) -> None:
    if ledger['since'] is not None:
        return
    # A development timestamp would renumber PRs merged while this change was
    # awaiting review. Find the PR that actually introduced the ledger to main.
    history = release.pages(f'repos/{repo}/commits?sha={source}&path={LEDGER}')
    initial = history[-1]
    prs = release.pages(f'repos/{repo}/commits/{initial["sha"]}/pulls')
    merged = sorted((row for row in prs if row.get('merged_at') and row['base']['ref'] == 'main'),
                    key=lambda row: row['merged_at'])
    ledger['since'] = merged[0]['merged_at'] if merged else initial['commit']['committer']['date']
    ledger['startCommit'] = merged[0]['merge_commit_sha'] if merged else initial['sha']
    if not re.fullmatch(r'[a-f0-9]{40}', ledger['startCommit']):
        raise ValueError('Invalid versioning cutover source.')


def pending_prs(repo: str, source: str, ledger: dict) -> list[dict]:
    since = datetime.fromisoformat(ledger['since'].replace('Z', '+00:00'))
    rows = release.pages(f'repos/{repo}/pulls?state=closed&base=main&sort=updated&direction=desc')
    candidates = []
    for row in rows:
        if (row.get('merged_at') is None or row['base']['ref'] != 'main'
                or str(row['number']) in ledger['pullRequests']
                or datetime.fromisoformat(row['merged_at'].replace('Z', '+00:00')) < since):
            continue
        merged = row['merge_commit_sha']
        if not re.fullmatch(r'[a-f0-9]{40}', merged):
            raise ValueError('Invalid PR merge identity.')
        if ledger.get('startCommit'):
            order = release.api(f'repos/{repo}/compare/{ledger["startCommit"]}...{merged}')
            if order['status'] not in ('ahead', 'identical'):
                continue
        comparison = release.api(f'repos/{repo}/compare/{merged}...{source}')
        # A newer merge may appear after this main snapshot was read. Its push
        # or the next reconciliation will handle it, without stamping old code.
        if comparison['status'] in ('ahead', 'identical'):
            candidates.append(row)
    return sorted(candidates, key=lambda row: (row['merged_at'], row['number']))


def used_versions(repo: str, values: dict, ledger: dict) -> list[str]:
    rows = release.pages(f'repos/{repo}/pulls?state=open')

    def read(row: dict) -> str | None:
        if not row['head'].get('repo'):
            raise ValueError(f'Cannot inspect the version claim of PR #{row["number"]}.')
        manifest = release.remote_json(row['head']['repo']['full_name'], row['head']['sha'], 'manifest.json')
        selected = manifest.get('version')
        # Invalid/non-numeric draft metadata cannot claim a public build number.
        return selected if isinstance(selected, str) and release.NUMERIC_VERSION.fullmatch(selected) else None

    with ThreadPoolExecutor(max_workers=4) as pool:
        claims = [value for value in pool.map(read, rows) if value is not None]
    tags = [row['name'] for row in release.pages(f'repos/{repo}/tags') if release.NUMERIC_VERSION.fullmatch(row['name'])]
    history = [value for value in values['versions.json'] if release.NUMERIC_VERSION.fullmatch(value)]
    return [release.metadata_version(values), *claims, *tags, *history,
            *(row['version'] for row in ledger['pullRequests'].values())]


def commit_assignment(repo: str, source: str, values: dict, number: int, selected: str) -> str:
    commit = release.api(f'repos/{repo}/git/commits/{source}')
    entries = []
    for name in FILES:
        content = base64.b64encode((json.dumps(values[name], indent=2) + '\n').encode()).decode()
        blob = release.api(f'repos/{repo}/git/blobs', payload={'content': content, 'encoding': 'base64'})
        entries.append({'path': name, 'mode': '100644', 'type': 'blob', 'sha': blob['sha']})
    tree = release.api(f'repos/{repo}/git/trees', payload={'base_tree': commit['tree']['sha'], 'tree': entries})
    created = release.api(f'repos/{repo}/git/commits', payload={
        'message': f'chore(release): assign {selected} to PR #{number}',
        'tree': tree['sha'], 'parents': [source]})
    # Updating without force is a compare-and-swap: this single-parent commit
    # cannot overwrite a concurrent merge. All five files become visible at once.
    release.api(f'repos/{repo}/git/refs/heads/main', method='PATCH',
                payload={'sha': created['sha'], 'force': False})
    return created['sha']


def assign(repo: str, prepare_snapshot=None) -> dict:
    if not re.fullmatch(r'[\w.-]+/[\w.-]+', repo):
        raise ValueError('Invalid repository identity.')
    conflicts = 0
    assigned = []
    prepared = None
    for _ in range(100):
        source = release.api(f'repos/{repo}/git/ref/heads/main')['object']['sha']
        values = {name: release.remote_json(repo, source, name) for name in FILES}
        ledger = ledger_state(values[LEDGER])
        activate(repo, source, ledger)
        release.metadata_version(values)
        pending = pending_prs(repo, source, ledger)
        if not pending or (prepare_snapshot and ledger.get('latest') and ledger['latest']['version'] != prepared):
            if not ledger.get('latest'):
                raise ValueError('No completed PR assignment exists yet. Nothing can be released.')
            # Recover an interrupted dispatch BEFORE allocating the next version.
            # A later merge can be the main tip while its assignment is pending.
            commits = release.api(f'repos/{repo}/commits?sha={source}&path={LEDGER}&per_page=1')
            completed = commits[0]['sha']
            if not re.fullmatch(r'[a-f0-9]{40}', completed):
                raise ValueError('Invalid completed version source.')
            selected = ledger['latest']['version']
            if prepare_snapshot and selected != prepared:
                prepare_snapshot(repo, selected, completed)
                prepared = selected
            if not pending:
                return {'source': completed, 'version': selected, 'assignments': assigned}
        row = pending[0]
        selected = release.bump(release.ROOT, max(used_versions(repo, values, ledger),
                                                key=lambda value: int(value.rsplit('.', 1)[1])), 'patch')
        release.set_version(values, selected)
        number = row['number']
        ledger['pullRequests'][str(number)] = {'version': selected, 'mergeCommit': row['merge_commit_sha']}
        ledger['latest'] = {'pr': number, 'version': selected, 'source': source}
        try:
            stamped = commit_assignment(repo, source, values, number, selected)
        except RuntimeError as error:
            # Only a confirmed non-fast-forward rejection is retryable. A lost
            # response, permission error or unknown failure stops this run. The
            # next run reconciles the committed ledger instead of replaying it.
            if ('HTTP 422' not in str(error) or not re.search(r'not a fast[- ]forward', str(error), re.I)
                    or conflicts >= 4):
                raise
            conflicts += 1
            continue
        assigned.append({'pr': number, 'version': selected, 'commit': stamped})
    raise ValueError('Assignment limit reached. Rerun reconciliation; committed assignments are retained.')


def versioned_snapshot(root: Path, source: str) -> str:
    def read(name: str):
        return json.loads(subprocess.check_output(['git', 'show', f'{source}:{name}'], cwd=root, timeout=30))

    ledger = ledger_state(read(LEDGER))
    latest = ledger.get('latest', {})
    number = str(latest.get('pr', ''))
    if number not in ledger['pullRequests'] or ledger['pullRequests'][number]['version'] != latest.get('version'):
        raise ValueError('This snapshot has no completed PR version assignment.')
    values = {name: read(name) for name in release.VERSION_FILES}
    if release.metadata_version(values) != latest['version']:
        raise ValueError('Snapshot version differs from the PR assignment.')
    parents = subprocess.check_output(['git', 'rev-list', '--parents', '-n', '1', source], cwd=root,
                                      text=True, timeout=30).split()
    changed = subprocess.check_output(['git', 'diff-tree', '--no-commit-id', '--name-only', '-r', source],
                                     cwd=root, text=True, timeout=30).splitlines()
    if parents != [source, latest.get('source')] or not changed or not set(changed).issubset(FILES):
        raise ValueError('Release source is not the completed version metadata commit.')
    return latest['version']


def prepare_completed(repo: str, selected: str, source: str) -> None:
    release.command('git', 'fetch', '--no-tags', 'origin', 'main')
    release.command('git', 'merge-base', '--is-ancestor', source, 'origin/main')
    if versioned_snapshot(release.ROOT, source) != selected:
        raise ValueError('Completed assignment does not match the release version.')
    release.prepare(repo, selected, source)


def main() -> None:
    # This is a write-capable CI action, never a development-time bump command.
    if os.environ.get('GITHUB_REF') != 'refs/heads/main' or os.environ.get('GITHUB_EVENT_NAME') not in ('push', 'workflow_dispatch'):
        raise ValueError('Version assignment runs only for main in GitHub Actions.')
    result = assign(os.environ['GITHUB_REPOSITORY'], prepare_completed)
    if output := os.environ.get('GITHUB_OUTPUT'):
        with open(output, 'a') as stream:
            stream.write(f'source={result["source"]}\nversion={result["version"]}\n')
    print(json.dumps(result))


if __name__ == '__main__':
    main()
