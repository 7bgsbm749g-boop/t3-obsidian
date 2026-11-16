"""Allocate agent-managed merge versions and prepare and publish tagged releases."""
from __future__ import annotations

import argparse
import base64
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
from urllib.parse import quote

from release_policy import bump, release_title, require_target

ROOT = Path(__file__).resolve().parent.parent
ASSETS = {'main.js': 'dist/main.js', 'manifest.json': 'manifest.json', 'styles.css': 'styles.css'}
VERSION_FILES = ('manifest.json', 'package.json', 'package-lock.json', 'versions.json')
NUMERIC_VERSION = re.compile(r'0\.0\.(0|[1-9][0-9]*)\Z')


def command(*args: str) -> str:
    return subprocess.check_output(args, cwd=ROOT, text=True, timeout=120).strip()


def api(path: str, *, missing: bool = False, payload: dict | None = None):
    args = ['gh', 'api', path]
    if payload is not None:
        args += ['--method', 'POST', '--input', '-']
    result = subprocess.run(args, cwd=ROOT, input=json.dumps(payload) if payload is not None else None,
                            capture_output=True, text=True, timeout=60)
    if result.returncode:
        if missing and '(HTTP 404)' in result.stderr:
            return None
        raise RuntimeError(result.stderr.strip())
    return json.loads(result.stdout) if result.stdout.strip() else None


def base_version(reference: str) -> str:
    source = command('git', 'rev-parse', '--verify', '--end-of-options', reference + '^{commit}')
    if not re.fullmatch(r'[a-f0-9]{40}', source):
        raise ValueError('Invalid base commit.')
    previous = json.loads(command('git', 'show', source + ':manifest.json'))['version']
    require_target(ROOT, previous)
    return previous


def version(base: str | None = None) -> str:
    manifest = json.loads((ROOT / 'manifest.json').read_text())
    selected = manifest['version']
    require_target(ROOT, selected)
    package = json.loads((ROOT / 'package.json').read_text())
    lock = json.loads((ROOT / 'package-lock.json').read_text())
    if not selected == package['version'] == lock['version'] == lock['packages']['']['version']:
        raise ValueError('Align manifest.json, package.json and package-lock.json before releasing.')
    if json.loads((ROOT / 'versions.json').read_text()).get(selected) != manifest['minAppVersion']:
        raise ValueError('versions.json must include the exact release and minimum Obsidian version.')
    if base is not None and int(selected.rsplit('.', 1)[1]) <= int(base_version(base).rsplit('.', 1)[1]):
        raise ValueError('Merge preparation requires a newer 0.0.BUILD than its target. Run prepare-merge.')
    return selected


def bump_version(base: str) -> str:
    """Update only version metadata; never create a tag or publish."""
    values = {name: json.loads((ROOT / name).read_text()) for name in VERSION_FILES}
    manifest, package, lock, history = (values[name] for name in VERSION_FILES)
    candidates = [base_version(base), manifest['version'], package['version'], lock['version'], lock['packages']['']['version']]
    candidates.extend(item for item in history if re.fullmatch(r'0\.0\.(0|[1-9][0-9]*)', item))
    for candidate in candidates:
        require_target(ROOT, candidate)
    selected = bump(ROOT, max(candidates, key=lambda item: int(item.rsplit('.', 1)[1])), 'patch')
    write_version(values, selected)
    return selected


def write_version(values: dict, selected: str) -> None:
    manifest, package, lock, history = (values[name] for name in VERSION_FILES)
    manifest['version'] = package['version'] = lock['version'] = lock['packages']['']['version'] = selected
    history[selected] = manifest['minAppVersion']
    for name, value in values.items():
        (ROOT / name).write_text(json.dumps(value, indent=2) + '\n')


def pages(path: str) -> list:
    result = []
    for page in range(1, 51):
        rows = api(f'{path}{"&" if "?" in path else "?"}per_page=100&page={page}')
        if not isinstance(rows, list):
            raise ValueError('GitHub returned an invalid version inventory.')
        result.extend(rows)
        if len(rows) < 100:
            return result
    raise ValueError('Version inventory exceeded 5,000 entries. No version was assigned.')


def remote_version(repo: str, source: str) -> str:
    if not re.fullmatch(r'[\w.-]+/[\w.-]+', repo) or not re.fullmatch(r'[a-f0-9]{40}', source):
        raise ValueError('Invalid version source identity.')
    value = api(f'repos/{repo}/contents/manifest.json?ref={source}')
    if (not isinstance(value, dict) or value.get('type') != 'file' or value.get('encoding') != 'base64'
            or not isinstance(value.get('size'), int) or value['size'] > 1_000_000
            or not isinstance(value.get('content'), str) or len(value['content']) > 1_400_000):
        raise ValueError('Cannot read the exact source manifest. No version was assigned.')
    selected = json.loads(base64.b64decode(''.join(value['content'].split()), validate=True))['version']
    require_target(ROOT, selected)
    return selected


def target_head(repo: str, target: dict) -> str:
    reference = quote(target['base']['ref'], safe='')
    return api(f'repos/{repo}/git/ref/heads/{reference}')['object']['sha']


def merge_inventory(repo: str, number: int, base: str) -> dict:
    """Read immutable manifests, including fork PRs, without checking out their code."""
    if not re.fullmatch(r'[\w.-]+/[\w.-]+', repo) or number < 1:
        raise ValueError('Specify the exact repository and PR number.')
    target = api(f'repos/{repo}/pulls/{number}')
    if (target['state'] != 'open' or target['draft'] or target['base']['repo']['full_name'] != repo
            or target['head']['sha'] != command('git', 'rev-parse', 'HEAD')):
        raise ValueError('Use the clean, published head of the exact open, ready PR.')
    base_sha = command('git', 'rev-parse', '--verify', '--end-of-options', base + '^{commit}')
    if target['base']['sha'] != base_sha or target_head(repo, target) != base_sha:
        raise ValueError('The target moved. Fetch and integrate it before preparing the merge.')
    command('git', 'merge-base', '--is-ancestor', base_sha, 'HEAD')
    if command('git', 'status', '--porcelain'):
        raise ValueError('Commit or preserve local changes before preparing the merge.')
    others = [row for row in pages(f'repos/{repo}/pulls?state=open') if row['number'] != number]

    def read_pr(row: dict) -> tuple[int, str]:
        if not row['head'].get('repo'):
            raise ValueError(f'Cannot read PR #{row["number"]}; no version was assigned.')
        return row['number'], remote_version(row['head']['repo']['full_name'], row['head']['sha'])

    with ThreadPoolExecutor(max_workers=4) as pool:
        claims = dict(pool.map(read_pr, others))
    tags = [row['name'] for row in pages(f'repos/{repo}/tags') if NUMERIC_VERSION.fullmatch(row['name'])]
    return {'target': target, 'base': base_version(base), 'claims': claims, 'tags': tags}


def unchanged_merge_source(repo: str, number: int, inventory: dict) -> None:
    latest = api(f'repos/{repo}/pulls/{number}')
    expected = inventory['target']
    if (latest['state'] != 'open' or latest['draft'] or latest['head']['sha'] != expected['head']['sha']
            or latest['base']['sha'] != expected['base']['sha']
            or latest['base']['ref'] != expected['base']['ref']
            or target_head(repo, latest) != expected['base']['sha']):
        raise ValueError('The PR or target moved during the version check. Fetch, integrate and retry.')


def merge_version(repo: str, number: int, base: str, *, validate: bool = False) -> str:
    """Agent-managed pre-merge step. No remote writes, commits, tags or merges."""
    selected = version()
    inventory = merge_inventory(repo, number, base)
    used = set(inventory['claims'].values()) | set(inventory['tags'])
    floor = max([inventory['base'], *inventory['tags']], key=lambda value: int(value.rsplit('.', 1)[1]))
    values = {name: json.loads((ROOT / name).read_text()) for name in VERSION_FILES}
    history = [value for value in values['versions.json'] if NUMERIC_VERSION.fullmatch(value)]
    ready = (selected not in used and int(selected.rsplit('.', 1)[1]) > int(floor.rsplit('.', 1)[1])
             and not any(int(value.rsplit('.', 1)[1]) > int(selected.rsplit('.', 1)[1]) for value in history))
    if validate:
        if not ready:
            raise ValueError('Version is stale, published or used by another PR. Run prepare-merge again.')
    elif not ready:
        selected = bump(ROOT, max([selected, floor, *used, *history], key=lambda value: int(value.rsplit('.', 1)[1])), 'patch')
    unchanged_merge_source(repo, number, inventory)
    if not validate:
        write_version(values, selected)
    return selected


def tag_commit(repo: str, selected: str) -> str | None:
    ref = api(f'repos/{repo}/git/ref/tags/{selected}', missing=True)
    if ref is None:
        return None
    obj = ref['object']
    if obj['type'] == 'tag':
        obj = api(f'repos/{repo}/git/tags/{obj["sha"]}')['object']
    if obj['type'] != 'commit':
        raise ValueError('Release tag does not identify a commit.')
    return obj['sha']


def find_release(repo: str, selected: str):
    published = api(f'repos/{repo}/releases/tags/{selected}', missing=True)
    if published is not None:
        return published
    # The tag endpoint returns published releases only. Drafts must be found
    # through the authenticated release list, including after a partial upload.
    for page in range(1, 51):
        releases = api(f'repos/{repo}/releases?per_page=100&page={page}')
        for candidate in releases:
            if candidate['tag_name'] == selected:
                return candidate
        if len(releases) < 100:
            return None
    raise ValueError('Release lookup exceeded 5,000 entries; refusing to create a duplicate draft.')


def prepare(repo: str, selected: str, source: str) -> None:
    """Release the scheduled main snapshot without changing source versions."""
    existing = tag_commit(repo, selected)
    if existing is not None and existing != source:
        raise ValueError('This version already belongs to another commit. Bump the PR version; never move a release tag.')
    latest = api(f'repos/{repo}/releases/latest', missing=True)
    if (latest is not None and re.fullmatch(r'0\.0\.(0|[1-9][0-9]*)', latest['tag_name'])
            and int(selected.rsplit('.', 1)[1]) < int(latest['tag_name'].rsplit('.', 1)[1])):
        raise ValueError('The scheduled version is older than the latest release. Update main before releasing.')
    if existing is not None:
        release = find_release(repo, selected)
        if release is not None and not release['draft']:
            print(f'Already released {selected} at {source}; nothing to publish.')
            return
    else:
        api(f'repos/{repo}/git/refs', payload={'ref': 'refs/tags/' + selected, 'sha': source})
    # GITHUB_TOKEN-created tags do not trigger push workflows. Dispatch at the
    # immutable tag explicitly, including after an interrupted preparation run.
    api(f'repos/{repo}/actions/workflows/release-provenance.yml/dispatches', payload={'ref': selected})
    print(f'Dispatched release {selected} at {source}.')


def publish(repo: str, selected: str, source: str) -> None:
    if tag_commit(repo, selected) != source:
        raise ValueError('The remote release tag no longer matches this build.')
    release = find_release(repo, selected)
    if release is None:
        command('gh', 'release', 'create', selected, '--repo', repo, '--verify-tag', '--target', source,
                '--title', release_title(ROOT, selected), '--notes', 'Source commit: ' + source,
                '--generate-notes', '--draft', *ASSETS.values())
        release = find_release(repo, selected)
    else:
        present = {asset['name'] for asset in release['assets']}
        absent = [path for name, path in ASSETS.items() if name not in present]
        if absent:
            if not release['draft']:
                raise ValueError('An existing published release has missing assets; refusing to replace it.')
            command('gh', 'release', 'upload', selected, '--repo', repo, *absent)
            release = find_release(repo, selected)
    if release is None:
        raise ValueError('The uploaded release draft is not visible; retry without replacing its assets.')
    assets = {asset['name']: asset for asset in release['assets']}
    if set(assets) != set(ASSETS):
        raise ValueError('The release must contain exactly the three attested plugin assets.')
    for name, path in ASSETS.items():
        expected = 'sha256:' + hashlib.sha256((ROOT / path).read_bytes()).hexdigest()
        if assets[name].get('digest') != expected:
            raise ValueError('Existing release bytes differ from the attested build: ' + name)
    if release['draft']:
        # An older slow build must not replace a newer release as Latest.
        latest = api(f'repos/{repo}/releases/latest', missing=True)
        newer = (latest is None or not re.fullmatch(r'0\.0\.(0|[1-9][0-9]*)', latest['tag_name'])
                 or int(selected.rsplit('.', 1)[1]) > int(latest['tag_name'].rsplit('.', 1)[1]))
        command('gh', 'release', 'edit', selected, '--repo', repo, '--draft=false',
                '--prerelease=false', '--latest=' + str(newer).lower())
    print('Published and verified: ' + release['html_url'])


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['validate', 'bump', 'prepare-merge', 'validate-merge', 'prepare', 'publish'])
    parser.add_argument('--base', help='Fetched PR target reference; merge preparation defaults to origin/main.')
    parser.add_argument('--repo', help='Exact owner/repository for merge-time version allocation.')
    parser.add_argument('--pr', type=int, help='Exact ready PR number; only use after merge authorization.')
    args = parser.parse_args()
    merge_action = args.action in ('prepare-merge', 'validate-merge')
    if merge_action:
        if not args.repo or not args.pr:
            parser.error('Merge-time version commands require --repo and --pr.')
        print(merge_version(args.repo, args.pr, args.base or 'origin/main', validate=args.action == 'validate-merge'))
        return
    if args.repo is not None or args.pr is not None:
        parser.error('--repo and --pr apply only to merge-time version commands.')
    if args.base is not None and args.action not in ('validate', 'bump'):
        parser.error('--base applies only to validation or version allocation.')
    if args.action == 'bump':
        print(bump_version(args.base or 'origin/main'))
        return
    selected = version(args.base)
    if args.action == 'validate':
        print(selected)
        return
    repo, source = os.environ['GITHUB_REPOSITORY'], os.environ['GITHUB_SHA']
    if not re.fullmatch(r'[\w.-]+/[\w.-]+', repo) or not re.fullmatch(r'[a-f0-9]{40}', source):
        raise ValueError('Invalid GitHub source identity.')
    if command('git', 'rev-parse', 'HEAD') != source:
        raise ValueError('Checkout does not match the event source commit.')
    expected = 'refs/heads/main' if args.action == 'prepare' else 'refs/tags/' + selected
    if os.environ['GITHUB_REF'] != expected:
        raise ValueError('Release action does not match the event ref.')
    if args.action == 'prepare' and os.environ.get('GITHUB_EVENT_NAME') != 'schedule':
        raise ValueError('Only the nightly schedule can prepare an automatic release.')
    (prepare if args.action == 'prepare' else publish)(repo, selected, source)


if __name__ == '__main__':
    main()
