"""Validate, tag and publish the exact source selected by GitHub Actions."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

from release_policy import release_title, require_target

ROOT = Path(__file__).resolve().parent.parent
ASSETS = {'main.js': 'dist/main.js', 'manifest.json': 'manifest.json', 'styles.css': 'styles.css'}


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


def version() -> str:
    manifest = json.loads((ROOT / 'manifest.json').read_text())
    selected = manifest['version']
    require_target(ROOT, selected)
    package = json.loads((ROOT / 'package.json').read_text())
    lock = json.loads((ROOT / 'package-lock.json').read_text())
    if not selected == package['version'] == lock['version'] == lock['packages']['']['version']:
        raise ValueError('Align manifest.json, package.json and package-lock.json before pushing.')
    if json.loads((ROOT / 'versions.json').read_text()).get(selected) != manifest['minAppVersion']:
        raise ValueError('versions.json must include the exact release and minimum Obsidian version.')
    previous = os.environ.get('T3_PREVIOUS_SHA', '')
    if previous and previous != '0' * 40:
        if not re.fullmatch(r'[a-f0-9]{40}', previous):
            raise ValueError('Invalid previous source commit.')
        before = json.loads(command('git', 'show', previous + ':manifest.json'))['version']
        if tuple(map(int, selected.split('.'))) <= tuple(map(int, before.split('.'))):
            raise ValueError('Every main push, including documentation changes, requires a newer 0.0.BUILD.')
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


def prepare(repo: str, selected: str, source: str) -> None:
    existing = tag_commit(repo, selected)
    if existing is not None and existing != source:
        raise ValueError('This version already belongs to another commit. Bump the version before pushing.')
    if existing is None:
        api(f'repos/{repo}/git/refs', payload={'ref': 'refs/tags/' + selected, 'sha': source})
    # GITHUB_TOKEN tag pushes do not trigger another workflow. Dispatch explicitly
    # at the tag so provenance still names the immutable numeric tag and commit.
    api(f'repos/{repo}/actions/workflows/release-provenance.yml/dispatches', payload={'ref': selected})
    print(f'Dispatched release {selected} at {source}.')


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
    parser.add_argument('action', choices=['validate', 'prepare', 'publish'])
    args = parser.parse_args()
    selected = version()
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
    (prepare if args.action == 'prepare' else publish)(repo, selected, source)


if __name__ == '__main__':
    main()
