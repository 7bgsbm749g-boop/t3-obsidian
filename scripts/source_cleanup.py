"""Remove only the exact clean source checkout and branch of a finished job."""
from pathlib import Path
import json
import subprocess
import sys
try:
    from . import maintainer_config
except ImportError:
    import maintainer_config


def git(root: Path, *args: str) -> str:
    return subprocess.check_output(['git', *args], cwd=root, text=True, stderr=subprocess.DEVNULL).strip()


def managed_evidence_link(path: Path, canonical: Path) -> bool:
    """Only an external, configured evidence link is disposable with a checkout."""
    external = maintainer_config.evidence_root(canonical)
    return (path.is_symlink() and path.is_dir() and external.is_dir()
            and not external.is_relative_to(canonical.resolve())
            and path.resolve().is_relative_to(external))


def align_source(canonical: Path, request: dict, target_commit: str) -> dict:
    """Called after T3's fresh idle check; preserve local files and private history."""
    source = Path(request['path']).resolve()
    branch = request['branch']
    expected = request['commit']
    if source == canonical.resolve() or branch in {'main', 'master', 'trunk', 'develop'}:
        return {'status': 'blocked', 'reason': 'Protected source checkout.'}
    if (git(source, 'rev-parse', '--path-format=absolute', '--git-common-dir') != git(canonical, 'rev-parse', '--path-format=absolute', '--git-common-dir')
            or git(source, 'symbolic-ref', '--short', 'HEAD') != branch
            or git(source, 'rev-parse', 'HEAD') != expected):
        return {'status': 'blocked', 'reason': 'The source branch changed before alignment.'}
    if git(source, 'status', '--porcelain=v1', '--untracked-files=all'):
        return {'status': 'blocked', 'reason': 'The source has uncommitted files.'}
    target = git(canonical, 'rev-parse', '--verify', target_commit + '^{commit}')
    for destination in ['HEAD', 'refs/remotes/origin/main']:
        if subprocess.run(['git', 'merge-base', '--is-ancestor', target, destination], cwd=canonical, capture_output=True).returncode:
            return {'status': 'pending', 'reason': 'The exact delivered source has not reached published main.'}
    ignored = git(source, 'ls-files', '--others', '--ignored', '--exclude-standard', '--directory').splitlines()
    paths = git(canonical, 'ls-tree', '-r', '--name-only', target).splitlines()
    if any(path == item.rstrip('/') or path.startswith(item.rstrip('/') + '/') for path in paths for item in ignored):
        return {'status': 'blocked', 'reason': 'Alignment would overwrite retained ignored files.'}
    # Keep the exact original source reachable before moving its task-only ref.
    git(canonical, 'update-ref', 'refs/t3-release-queue/sources/' + expected, expected)
    # Lock and compare the task ref before updating the index/worktree. A new
    # commit racing the native idle check must never be reset or discarded.
    transaction = subprocess.Popen(['git', 'update-ref', '--stdin'], cwd=source,
                                   stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, text=True)
    try:
        transaction.stdin.write(f'start\nupdate refs/heads/{branch} {target} {expected}\nprepare\n')
        transaction.stdin.flush()
        if transaction.stdout.readline().strip() != 'start: ok' or transaction.stdout.readline().strip() != 'prepare: ok':
            return {'status': 'blocked', 'reason': 'The source branch changed during alignment.'}
        if git(source, 'status', '--porcelain=v1', '--untracked-files=all'):
            return {'status': 'blocked', 'reason': 'The source changed during alignment.'}
        result = subprocess.run(['git', 'read-tree', '-m', '-u', expected, target], cwd=source, capture_output=True, text=True)
        if result.returncode:
            return {'status': 'blocked', 'reason': 'Git refused to align changed local files.'}
        transaction.stdin.write('commit\n'); transaction.stdin.flush()
        if transaction.stdout.readline().strip() != 'commit: ok':
            return {'status': 'blocked', 'reason': 'Git could not commit the task branch alignment; local files remain protected.'}
    finally:
        transaction.stdin.close()
        transaction.wait(timeout=10)
        transaction.stdout.close()
        transaction.stderr.close()
    return {'status': 'aligned', 'alignedCommit': target, 'originalSourceCommit': expected}


def cleanup(canonical: Path, request: dict, *, target_commit: str | None = None) -> dict:
    branch = request.get('sourceBranch')
    if not branch:
        return {'status': 'not-requested'}
    source = Path(request['sourceRoot']).resolve()
    commit = request['commit']
    if source == canonical.resolve() or branch in {'main', 'master', 'trunk', 'develop'}:
        return {'status': 'protected', 'reason': 'The source is a main project checkout or branch.'}
    refs = git(canonical, 'for-each-ref', '--format=%(objectname)', 'refs/heads/' + branch)
    if not refs:
        return {'status': 'removed'}
    if refs not in {commit, target_commit}:
        return {'status': 'blocked', 'reason': 'The source branch has newer or different commits.'}
    expected = refs
    worktrees = git(canonical, 'worktree', 'list', '--porcelain', '-z').split('\0\0')
    holders = []
    for block in worktrees:
        fields = dict(line.split(' ', 1) for line in block.split('\0') if ' ' in line)
        if fields.get('branch') == 'refs/heads/' + branch:
            holders.append(Path(fields['worktree']).resolve())
    if any(holder != source for holder in holders):
        return {'status': 'blocked', 'reason': 'Another checkout uses the source branch.'}
    if source.exists():
        if source not in holders or git(source, 'rev-parse', '--path-format=absolute', '--git-common-dir') != git(canonical, 'rev-parse', '--path-format=absolute', '--git-common-dir'):
            return {'status': 'blocked', 'reason': 'The source checkout identity changed.'}
        if git(source, 'status', '--porcelain=v1'):
            return {'status': 'blocked', 'reason': 'The source has uncommitted files.'}
        ignored = git(source, 'ls-files', '--others', '--ignored', '--exclude-standard', '--directory').splitlines()
        retained = [name for name in ignored if name not in {'dist/', 'node_modules/', 'scripts/__pycache__/'}
                    and not managed_evidence_link(source / name, canonical)]
        if retained and not target_commit:
            return {'status': 'blocked', 'reason': 'The source has retained local files outside generated output.'}
        config = maintainer_config.configuration(canonical)
        if not config.get('t3Command') or not config.get('t3BaseDir'):
            return {'status': 'pending', 'reason': 'Configure T3 checkout cleanup on this machine.'}
        result = subprocess.run(['node', str(canonical / 'scripts/cleanup-worktree.mjs')],
                                input=json.dumps({**config, 'canonical': str(canonical), 'path': str(source), 'branch': branch,
                                                  'commit': expected, 'targetCommit': target_commit,
                                                  'preserveCheckout': bool(retained)}),
                                text=True, capture_output=True, timeout=65)
        try:
            outcome = json.loads(result.stdout)
        except ValueError:
            return {'status': 'pending', 'reason': 'T3 checkout cleanup did not confirm removal.'}
        if outcome.get('alignedCommit'):
            expected = outcome['alignedCommit']
        if outcome.get('status') != 'removed' or source.exists():
            return outcome
    # Git itself refuses deleting a branch checked out by a newly created worktree.
    if git(canonical, 'rev-parse', 'refs/heads/' + branch) != expected:
        return {'status': 'blocked', 'reason': 'The branch changed during checkout cleanup.'}
    subprocess.run(['git', 'branch', '-D', '--', branch], cwd=canonical, check=True, capture_output=True)
    return {'status': 'removed'}


if __name__ == '__main__':
    if sys.argv[1:] != ['--align']:
        raise SystemExit('Use through the release queue after native T3 idle verification.')
    value = json.load(sys.stdin)
    print(json.dumps(align_source(Path(value['canonical']), value, value['targetCommit'])))
