"""Remove only the exact clean source checkout and branch of a finished job."""
from pathlib import Path
import json
import subprocess
try:
    from . import maintainer_config
except ImportError:
    import maintainer_config


def git(root: Path, *args: str) -> str:
    return subprocess.check_output(['git', *args], cwd=root, text=True, stderr=subprocess.DEVNULL).strip()


def cleanup(canonical: Path, request: dict) -> dict:
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
    if refs != commit:
        return {'status': 'blocked', 'reason': 'The source branch has newer or different commits.'}
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
        if any(name not in {'dist/', 'node_modules/', 'scripts/__pycache__/'} for name in ignored):
            return {'status': 'blocked', 'reason': 'The source has retained local files outside generated output.'}
        config = maintainer_config.configuration(canonical)
        if not config.get('t3Command') or not config.get('t3BaseDir'):
            return {'status': 'pending', 'reason': 'Configure T3 checkout cleanup on this machine.'}
        result = subprocess.run(['node', str(canonical / 'scripts/cleanup-worktree.mjs')],
                                input=json.dumps({**config, 'canonical': str(canonical), 'path': str(source), 'branch': branch, 'commit': commit}),
                                text=True, capture_output=True, timeout=65)
        try:
            outcome = json.loads(result.stdout)
        except ValueError:
            return {'status': 'pending', 'reason': 'T3 checkout cleanup did not confirm removal.'}
        if outcome.get('status') != 'removed' or source.exists():
            return outcome
    # Git itself refuses deleting a branch checked out by a newly created worktree.
    if git(canonical, 'rev-parse', 'refs/heads/' + branch) != commit:
        return {'status': 'blocked', 'reason': 'The branch changed during checkout cleanup.'}
    subprocess.run(['git', 'branch', '-D', '--', branch], cwd=canonical, check=True, capture_output=True)
    return {'status': 'removed'}
