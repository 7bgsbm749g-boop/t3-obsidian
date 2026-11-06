#!/usr/bin/env python3
"""Integrate one reviewed documentation commit with ordinary Git, without release work."""
from pathlib import Path
import argparse
import subprocess
try:
    from . import maintainer_config
    from .release_queue import locked
except ImportError:
    import maintainer_config
    from release_queue import locked

ROOT = Path(__file__).resolve().parent.parent


def git(root: Path, *args: str) -> str:
    return subprocess.check_output(['git', *args], cwd=root, text=True).strip()


def documentation_file(name: str) -> bool:
    return (name in {'AGENTS.md', 'README.md', 'LICENSE'} or
            name.startswith('docs/') or
            name.startswith('skills/') and Path(name).suffix in {'.md', '.yaml', '.yml'})


def integrate(source: Path, canonical: Path, commit: str) -> dict:
    if git(source, 'status', '--porcelain=v1'):
        raise SystemExit('Commit all task changes before integrating documentation.')
    commit = git(source, 'rev-parse', '--verify', commit + '^{commit}')
    parents = git(source, 'rev-list', '--parents', '-n', '1', commit).split()
    if len(parents) != 2:
        raise SystemExit('Select one ordinary documentation commit, not a merge or root commit.')
    names = git(source, 'diff', '--name-only', '--no-renames', parents[1], commit).splitlines()
    if not names or not all(documentation_file(name) for name in names):
        raise SystemExit('This commit includes product or tooling changes. Use the release process for those.')
    if git(source, 'rev-parse', '--path-format=absolute', '--git-common-dir') != git(canonical, 'rev-parse', '--path-format=absolute', '--git-common-dir'):
        raise SystemExit('The documentation source is not a checkout of this repository.')
    with locked(canonical / 'evidence/release-queue/worker.lock'), locked(canonical / 'evidence/release.lock'):
        if git(canonical, 'status', '--porcelain=v1'):
            raise SystemExit('The canonical checkout contains uncommitted work.')
        if subprocess.run(['git', 'merge-base', '--is-ancestor', commit, 'HEAD'], cwd=canonical).returncode == 0:
            return {'commit': commit, 'status': 'already-integrated'}
        before = git(canonical, 'rev-parse', 'HEAD')
        if canonical.resolve() == source.resolve():
            return {'commit': commit, 'status': 'committed'}
        try:
            subprocess.run(['git', 'cherry-pick', commit], cwd=canonical, check=True, capture_output=True, text=True)
        except subprocess.CalledProcessError:
            # This command owns this cherry-pick; leave existing source work intact.
            marker = Path(git(canonical, 'rev-parse', '--git-path', 'CHERRY_PICK_HEAD'))
            if not marker.is_absolute():
                marker = canonical / marker
            if marker.exists():
                subprocess.run(['git', 'cherry-pick', '--abort'], cwd=canonical, check=True)
            assert git(canonical, 'rev-parse', 'HEAD') == before
            raise SystemExit('Documentation conflicts with current source. Rebase the documentation and retry.') from None
        return {'commit': git(canonical, 'rev-parse', 'HEAD'), 'status': 'committed'}


if __name__ == '__main__':
    import json
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('commit')
    args = parser.parse_args()
    print(json.dumps(integrate(ROOT, maintainer_config.canonical_root(), args.commit), indent=2))
