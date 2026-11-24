"""Validate source versions and prepare and publish tagged GitHub releases."""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

from release_policy import bump, release_title, require_target

ROOT = Path(__file__).resolve().parent.parent
ASSETS = {'main.js': 'dist/main.js', 'manifest.json': 'manifest.json', 'styles.css': 'styles.css'}
VERSION_FILES = ('manifest.json', 'package.json', 'package-lock.json', 'versions.json')
NUMERIC_VERSION = re.compile(r'0\.0\.(0|[1-9][0-9]*)\Z')


def command(*args: str) -> str:
    return subprocess.check_output(args, cwd=ROOT, text=True, timeout=120).strip()


def api(path: str, *, missing: bool = False, payload: dict | None = None, method: str | None = None):
    args = ['gh', 'api', path]
    if payload is not None:
        args += ['--method', method or 'POST', '--input', '-']
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
    selected = metadata_version({name: json.loads((ROOT / name).read_text()) for name in VERSION_FILES})
    if base is not None and int(selected.rsplit('.', 1)[1]) <= int(base_version(base).rsplit('.', 1)[1]):
        raise ValueError('Explicit base validation requires a newer 0.0.BUILD than its target.')
    return selected


def metadata_version(values: dict) -> str:
    manifest, package, lock, history = (values[name] for name in VERSION_FILES)
    selected = manifest['version']
    require_target(ROOT, selected)
    if not selected == package['version'] == lock['version'] == lock['packages']['']['version']:
        raise ValueError('Align manifest.json, package.json and package-lock.json before releasing.')
    if history.get(selected) != manifest['minAppVersion']:
        raise ValueError('versions.json must include the exact release and minimum Obsidian version.')
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


def set_version(values: dict, selected: str) -> None:
    manifest, package, lock, history = (values[name] for name in VERSION_FILES)
    manifest['version'] = package['version'] = lock['version'] = lock['packages']['']['version'] = selected
    history[selected] = manifest['minAppVersion']


def write_version(values: dict, selected: str) -> None:
    set_version(values, selected)
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


def remote_json(repo: str, source: str, name: str) -> dict:
    if not re.fullmatch(r'[\w.-]+/[\w.-]+', repo) or not re.fullmatch(r'[a-f0-9]{40}', source):
        raise ValueError('Invalid version source identity.')
    if name not in (*VERSION_FILES, 'pr-versions.json'):
        raise ValueError('Unexpected version metadata path.')
    value = api(f'repos/{repo}/contents/{name}?ref={source}')
    if (not isinstance(value, dict) or value.get('type') != 'file' or value.get('encoding') != 'base64'
            or not isinstance(value.get('size'), int) or value['size'] > 1_000_000
            or not isinstance(value.get('content'), str) or len(value['content']) > 1_400_000):
        raise ValueError('Cannot read the exact source manifest. No version was assigned.')
    result = json.loads(base64.b64decode(''.join(value['content'].split()), validate=True))
    if not isinstance(result, dict):
        raise ValueError('Version metadata must be a JSON object.')
    return result


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
    """Release the completed assignment without changing source versions."""
    existing = tag_commit(repo, selected)
    if existing is not None and existing != source:
        raise ValueError('This version already belongs to another commit. Repair post-merge assignment; never move a release tag.')
    latest = api(f'repos/{repo}/releases/latest', missing=True)
    if (latest is not None and re.fullmatch(r'0\.0\.(0|[1-9][0-9]*)', latest['tag_name'])
            and int(selected.rsplit('.', 1)[1]) < int(latest['tag_name'].rsplit('.', 1)[1])):
        raise ValueError('The assigned version is older than the latest release. Update main before releasing.')
    if existing is not None:
        release = find_release(repo, selected)
        if release is not None and not release['draft']:
            print(f'Already released {selected} at {source}; nothing to publish.')
            return
        runs = api(f'repos/{repo}/actions/workflows/release-provenance.yml/runs'
                   f'?branch={selected}&head_sha={source}&per_page=100')
        if any(run['head_branch'] == selected and run['head_sha'] == source
               and run['event'] in ('push', 'workflow_dispatch') and run['status'] != 'completed'
               for run in runs['workflow_runs']):
            print(f'Release build already active for {selected} at {source}.')
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
    parser.add_argument('action', choices=['validate', 'bump', 'prepare', 'publish'])
    parser.add_argument('--base', help='Optional comparison reference; low-level bump defaults to origin/main.')
    args = parser.parse_args()
    if args.base is not None and args.action not in ('validate', 'bump'):
        parser.error('--base applies only to validation or version allocation.')
    if args.action == 'bump':
        print(bump_version(args.base or 'origin/main'))
        return
    selected = version(args.base)
    if args.action == 'validate':
        print(selected)
        return
    repo = os.environ['GITHUB_REPOSITORY']
    source = command('git', 'rev-parse', 'HEAD') if args.action == 'prepare' else os.environ['GITHUB_SHA']
    if not re.fullmatch(r'[\w.-]+/[\w.-]+', repo) or not re.fullmatch(r'[a-f0-9]{40}', source):
        raise ValueError('Invalid GitHub source identity.')
    if command('git', 'rev-parse', 'HEAD') != source:
        raise ValueError('Checkout does not match the event source commit.')
    expected = 'refs/heads/main' if args.action == 'prepare' else 'refs/tags/' + selected
    if os.environ['GITHUB_REF'] != expected:
        raise ValueError('Release action does not match the event ref.')
    if args.action == 'prepare' and os.environ.get('GITHUB_EVENT_NAME') not in ('push', 'workflow_dispatch'):
        raise ValueError('Only post-merge assignment or manual recovery can prepare a release.')
    if args.action == 'prepare':
        from merge_versions import versioned_snapshot
        versioned_snapshot(ROOT, source)
        command('git', 'merge-base', '--is-ancestor', source, 'origin/main')
    (prepare if args.action == 'prepare' else publish)(repo, selected, source)


if __name__ == '__main__':
    main()
