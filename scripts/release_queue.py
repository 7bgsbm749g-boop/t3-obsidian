"""Serialized releases with durable retries and isolated job failures."""
from __future__ import annotations

from contextlib import contextmanager, redirect_stderr, redirect_stdout
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

try:
    from . import release_policy, release_history, release_memory, maintainer_config, source_cleanup
except ImportError:
    import release_policy
    import release_history
    import release_memory
    import maintainer_config
    import source_cleanup

QUEUE = maintainer_config.evidence_root() / 'release-queue'
UNIT = maintainer_config.setting('releaseQueueUnit', 'send-to-t3-release-queue')
JOB_ID = re.compile(r'^\d{12}-[0-9a-f]{16}$')
VERSION_FILES = {'package.json', 'package-lock.json', 'manifest.json', 'versions.json'}
MAX_ATTEMPTS = 3
FINISHED = {'complete', 'failed', 'needs-evidence', 'awaiting-smoke', 'waiting-for-dependency', 'waiting-for-memory'}


def maintenance_only(names: list[str]) -> bool:
    return bool(names) and all(name.startswith(('scripts/', 'tests/', 'docs/')) or
                               (name.startswith('.github/workflows/') and Path(name).suffix in {'.yml', '.yaml'}) or
                               (name.startswith('skills/') and Path(name).suffix == '.md') or
                               name in {'AGENTS.md', 'README.md', 'LICENSE', '.gitignore'} for name in names)


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def read(path: Path) -> dict:
    return json.loads(path.read_bytes())


def write(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as output:
        temporary = Path(output.name)
        output.write((json.dumps(value, indent=2) + '\n').encode())
        output.flush()
        os.fsync(output.fileno())
    os.replace(temporary, path)


@contextmanager
def locked(path: Path, *, nonblocking: bool = False):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('a') as stream:
        fcntl.flock(stream, fcntl.LOCK_EX | (fcntl.LOCK_NB if nonblocking else 0))
        yield


def git(root: Path, *args: str) -> str:
    return subprocess.check_output(['git', *args], cwd=root, text=True).strip()


def ancestor(root: Path, before: str, after: str) -> bool:
    return subprocess.run(['git', 'merge-base', '--is-ancestor', before, after],
                          cwd=root, capture_output=True, check=False).returncode == 0


def commit_tree(root: Path, tree: str, parents: list[str], message: str) -> str:
    return subprocess.check_output(['git', 'commit-tree', tree, *[arg for parent in parents for arg in ('-p', parent)]],
                                   cwd=root, input=message, text=True).strip()


def integration_context(root: Path, head: str, queue: Path) -> str:
    """Keep source ancestry private, while the public branch stays linear.

    The tree is always the current canonical tree. Extra parents describe
    already integrated task sources, so a later task can edit their changes
    without reapplying them or treating them as independent conflicting edits.
    Reverted candidates are deliberately excluded until repaired.
    """
    parents = [head]
    with locked(queue / 'queue.lock'):
        states = [read(directory / 'state.json') for directory in jobs(queue)]
    for state in states:
        if (state.get('integrationStyle') != 'squash' or state.get('rollbackCommits')
                or not state.get('integratedCommit') or not ancestor(root, state['integratedCommit'], head)):
            continue
        source = state.get('integratedSourceCommit')
        if source and source not in parents and not ancestor(root, source, head):
            parents.append(source)
    if len(parents) == 1:
        return head
    return commit_tree(root, git(root, 'rev-parse', head + '^{tree}'), parents,
                       'Private release queue source ancestry\n')


def dependency_inputs(root: Path, commit: str | None = None) -> str:
    """Ignore release versions while retaining all package and lockfile inputs."""
    documents = {}
    for name in ('package.json', 'package-lock.json'):
        value = json.loads(git(root, 'show', f'{commit}:{name}')) if commit else read(root / name)
        value.pop('version', None)
        if name == 'package-lock.json':
            value.get('packages', {}).get('', {}).pop('version', None)
        documents[name] = value
    return hashlib.sha256(json.dumps(documents, sort_keys=True).encode()).hexdigest()


def ensure_dependencies(root: Path) -> None:
    """The worker owns dependency installation, just as it owns integration."""
    package = read(root / 'package.json')
    if not package.get('dependencies') and not package.get('devDependencies'):
        return
    expected = dependency_inputs(root)
    marker = root / 'evidence' / 'release-dependencies.json'
    try:
        if (root / 'node_modules').is_dir() and read(marker).get('inputsSha256') == expected:
            return
    except (FileNotFoundError, ValueError):
        pass
    marker.unlink(missing_ok=True)
    subprocess.run(['npm', 'ci', '--no-audit', '--no-fund'], cwd=root, check=True, timeout=300)
    if dependency_inputs(root) != expected:
        raise SystemExit('Package inputs changed during dependency installation; release stopped.')
    write(marker, {'inputsSha256': expected, 'installedAt': now()})


def jobs(queue: Path) -> list[Path]:
    return sorted(path for path in (queue / 'jobs').glob('*') if JOB_ID.fullmatch(path.name))


def job_path(queue: Path, job_id: str) -> Path:
    if not JOB_ID.fullmatch(job_id):
        raise SystemExit('Invalid queue job ID.')
    result = queue / 'jobs' / job_id
    if not (result / 'request.json').is_file():
        raise SystemExit(f'Unknown release job: {job_id}')
    return result


def submission(root: Path, canonical: Path, commit: str, *, bump: str = 'patch', validation: Path | None = None,
               evidence: Path | None = None, notes: str = '', history_seed: Path | None = None,
               summary: str = '', thread_id: str | None = None, queue: Path = QUEUE) -> dict:
    if git(root, 'status', '--porcelain=v1'):
        raise SystemExit('Commit all intended task files before submitting; uncommitted files are not released.')
    commit = git(root, 'rev-parse', '--verify', '--end-of-options', commit + '^{commit}')
    canonical_commit = git(canonical, 'rev-parse', 'HEAD')
    if validation:
        candidate_version = json.loads(git(root, 'show', commit + ':manifest.json'))['version']
        installed_version = json.loads(git(canonical, 'show', canonical_commit + ':manifest.json'))['version']
        if not release_policy.newer(root, candidate_version, installed_version):
            raise SystemExit('A development validation is not a prepared release. Enqueue without --validation so the queue assigns a new version and reuses matching checks.')
    context = integration_context(root, canonical_commit, queue)
    base = git(root, 'merge-base', context, commit)
    # Requests contain committed source only; no task can deploy another task's
    # uncommitted checkout. Identical submissions are idempotent.
    proof_hash = hashlib.sha256(validation.read_bytes()).hexdigest() if validation else None
    evidence_hash = hashlib.sha256(evidence.read_bytes()).hexdigest() if evidence else None
    seed_hash = hashlib.sha256(history_seed.read_bytes()).hexdigest() if history_seed else None
    identity = {'commit': commit, 'bump': bump, 'validationSha256': proof_hash,
                'evidenceSha256': evidence_hash, 'notes': notes, 'historySeedSha256': seed_hash}
    changed = git(root, 'diff', '--name-only', '--no-renames', base, commit).splitlines()
    inputs = {}
    for name in changed:
        if name in VERSION_FILES or Path(name).suffix not in {'.ts', '.tsx', '.mjs', '.js', '.py', '.css', '.json'}:
            continue
        item = subprocess.run(['git', 'show', f'{commit}:{name}'], cwd=root, capture_output=True)
        inputs[name] = hashlib.sha256(item.stdout).hexdigest() if item.returncode == 0 else None
    return {**identity, 'createdAt': now(), 'sourceRoot': str(root), 'sourceBranch': git(root, 'branch', '--show-current') or None, 'mergeBase': base,
            'maintenanceOnly': maintenance_only(changed),
            'historySeed': str(history_seed) if history_seed else None, 'threadId': thread_id,
            'summary': summary or ' | '.join(git(root, 'log', '--format=%s', base + '..' + commit).splitlines()[:12]),
            'dependencyInputsSha256': dependency_inputs(root, commit),
            'sourceInputsSha256': inputs, 'validation': str(validation) if validation else None,
            'evidence': str(evidence) if evidence else None}


def save_request(directory: Path, request: dict, name: str = 'request.json') -> None:
    if request.get('evidence'):
        evidence = Path(request['evidence'])
        copied = directory / (name.removesuffix('.json') + '-behavior' + evidence.suffix.lower())
        shutil.copy2(evidence, copied)
        if hashlib.sha256(copied.read_bytes()).hexdigest() != request['evidenceSha256']:
            raise SystemExit('Behavior evidence changed during submission.')
        request = {**request, 'evidence': str(copied)}
    if request.get('historySeed'):
        original_seed = Path(request['historySeed'])
        copied_seed = directory / (name.removesuffix('.json') + '-history-seed.json')
        shutil.copy2(original_seed, copied_seed)
        if hashlib.sha256(copied_seed.read_bytes()).hexdigest() != request['historySeedSha256']:
            raise SystemExit('History seed changed during submission.')
        request = {**request, 'historySeed': str(copied_seed)}
    if (directory / name).exists():
        raise SystemExit('Queue requests are immutable.')
    write(directory / name, request)


def enqueue(root: Path, canonical: Path, commit: str, *, bump: str = 'patch', validation: Path | None = None,
            evidence: Path | None = None, notes: str = '', history_seed: Path | None = None,
            summary: str = '', thread_id: str | None = None, queue: Path = QUEUE) -> dict:
    request = submission(root, canonical, commit, bump=bump, validation=validation, evidence=evidence, notes=notes,
                         history_seed=history_seed, summary=summary, thread_id=thread_id, queue=queue)
    key = hashlib.sha256(request['commit'].encode()).hexdigest()[:16]
    with locked(queue / 'queue.lock'):
        # A removed task branch must not allow Git GC to erase reviewed source.
        git(root, 'update-ref', 'refs/t3-release-queue/sources/' + request['commit'], request['commit'])
        existing = next((path for path in jobs(queue) if path.name.endswith('-' + key) or
                         read(path / read(path / 'state.json').get('requestFile', 'request.json'))['commit'] == request['commit']), None)
        if existing:
            return {'jobId': existing.name, **read(existing / 'state.json'), 'reusedSubmission': True}
        sequence = max((int(path.name.split('-')[0]) for path in jobs(queue)), default=0) + 1
        directory = queue / 'jobs' / f'{sequence:012d}-{key}'
        directory.mkdir(parents=True)
        state = {'status': 'queued', 'updatedAt': now()}
        try:
            save_request(directory, request)
            write(directory / 'state.json', state)
        except BaseException:
            directory.rename(queue / ('incomplete-' + directory.name))
            raise
        (queue / 'wake').touch()
        return {'jobId': directory.name, **state, 'reusedSubmission': False}


def status(job_id: str | None = None, *, queue: Path = QUEUE) -> dict:
    with locked(queue / 'queue.lock'):
        selected = [job_path(queue, job_id)] if job_id else jobs(queue)
        entries = [{'jobId': path.name, **read(path / 'state.json'),
                          'sourceCommit': read(path / read(path / 'state.json').get('requestFile', 'request.json'))['commit'], 'log': str(path / 'worker.log')}
                   for path in selected]
        return {'jobs': entries, 'counts': {name: sum(item['status'] == name for item in entries)
                                          for name in sorted({item['status'] for item in entries})}}


def kick(*, queue: Path = QUEUE) -> None:
    with locked(queue / 'queue.lock'):
        (queue / 'wake').touch()
    unit = Path.home() / '.config/systemd/user' / (UNIT + '.service')
    if unit.is_file():
        subprocess.run(['systemctl', '--user', 'start', '--no-block', UNIT + '.service'], check=True, timeout=10)
    else:
        print('Request saved. Install the queue worker once from the canonical checkout with --install-queue.')


def install(canonical: Path, *, queue: Path = QUEUE) -> None:
    queue.mkdir(parents=True, exist_ok=True)
    units = Path.home() / '.config/systemd/user'
    units.mkdir(parents=True, exist_ok=True)
    (units / (UNIT + '.service')).write_text(
        '[Unit]\nDescription=Serialize T3 Code releases\n'
        '[Service]\nType=oneshot\nWorkingDirectory=' + str(canonical) + '\n'
        'ExecStart=/usr/bin/python3 ' + str(canonical / 'scripts/release-qlo2.py') + ' --drain-queue\n'
        'TimeoutStartSec=3600\nRestart=on-failure\nRestartSec=15\n')
    (units / (UNIT + '.path')).write_text(
        '[Unit]\nDescription=Wake the T3 Code release queue\n'
        '[Path]\nPathExists=' + str(queue / 'wake') + '\nPathChanged=' + str(maintainer_config.common_directory(canonical) / 'worktrees') + '\nUnit=' + UNIT + '.service\n'
        '[Install]\nWantedBy=default.target\n')
    subprocess.run(['systemctl', '--user', 'daemon-reload'], check=True)
    subprocess.run(['systemctl', '--user', 'enable', '--now', UNIT + '.path'], check=True)


def schedule_retry(when: str, *, queue: Path = QUEUE) -> None:
    """One persisted deadline, armed only while recovery is needed; no polling."""
    units = Path.home() / '.config/systemd/user'
    if not (units / (UNIT + '.service')).is_file():
        return
    deadline = dt.datetime.fromisoformat(when).astimezone(dt.timezone.utc)
    if deadline.microsecond:
        deadline = (deadline + dt.timedelta(seconds=1)).replace(microsecond=0)
    timestamp = deadline.strftime('%Y-%m-%d %H:%M:%S UTC')
    (units / (UNIT + '-retry.timer')).write_text(
        '[Unit]\nDescription=Retry an interrupted T3 release\n[Timer]\n'
        f'OnCalendar={timestamp}\nPersistent=true\nAccuracySec=1s\nUnit={UNIT}.service\n'
        '[Install]\nWantedBy=timers.target\n')
    subprocess.run(['systemctl', '--user', 'daemon-reload'], check=True, timeout=10)
    subprocess.run(['systemctl', '--user', 'enable', UNIT + '-retry.timer'], check=True, timeout=10)
    subprocess.run(['systemctl', '--user', 'restart', UNIT + '-retry.timer'], check=True, timeout=10)


def retry(job_id: str, *, replacement: dict | None = None, queue: Path = QUEUE) -> dict:
    with locked(queue / 'queue.lock'):
        directory = job_path(queue, job_id)
        state = read(directory / 'state.json')
        if state['status'] not in {'blocked', 'failed', 'awaiting-smoke', 'needs-evidence', 'retrying', 'waiting-for-memory'}:
            raise SystemExit('Only a failed, blocked, or smoke-waiting job can be retried.')
        if state['status'] == 'retrying' and not state.get('nextRetryAt'):
            raise SystemExit('This job is already recovering in the active worker.')
        if replacement:
            if any(Path(state[key]).exists() for key in ('archive', 'deploymentReceipt') if state.get(key)):
                raise SystemExit('This job already has immutable release bytes. Resume them; submit later code separately.')
            revision = state.get('requestRevision', 0) + 1
            name = f'request-{revision}.json'
            previous = read(directory / state.get('requestFile', 'request.json'))
            # A failed integration remains in Git history after its explicit
            # revert. A merge-base can therefore hide restored product inputs.
            inputs = {}
            for source_name in previous['sourceInputsSha256'].keys() | replacement['sourceInputsSha256'].keys():
                item = subprocess.run(['git', 'show', f'{replacement["commit"]}:{source_name}'],
                                      cwd=replacement['sourceRoot'], capture_output=True)
                inputs[source_name] = hashlib.sha256(item.stdout).hexdigest() if item.returncode == 0 else None
            replacement = {**replacement,
                           'bump': previous['bump'],
                           'maintenanceOnly': bool(previous.get('maintenanceOnly')) and bool(replacement.get('maintenanceOnly')),
                           'sourceInputsSha256': inputs}
            save_request(directory, replacement, name)
            git(Path(replacement['sourceRoot']), 'update-ref',
                'refs/t3-release-queue/sources/' + replacement['commit'], replacement['commit'])
            state.update(requestRevision=revision, requestFile=name)
        waiting = state.get('memoryWait')
        if waiting and not (replacement and replacement.get('evidence')):
            waiting.update(ready=False, nextProbeAt=now())
            state.update(status='waiting-for-memory', updatedAt=now())
        else:
            state.pop('memoryWait', None)
            state.update(status='queued', updatedAt=now(), failures=0)
        for key in ('error', 'nextAction', 'nextRetryAt'):
            state.pop(key, None)
        if state.get('rollbackCommits'):
            if state.get('version'):
                state['reservedVersions'] = sorted(set([*state.get('reservedVersions', []), state['version']]))
            state.pop('version', None)
        write(directory / 'state.json', state)
        (queue / 'wake').touch()
    return {'jobId': job_id, **state}


def recover_version_collision(release, canonical: Path, job_id: str, *, queue: Path = QUEUE) -> dict:
    """Revert only an unshipped integration that selected another release's bytes.

    A development validation was historically accepted as a prepared version.
    Existing archives/receipts must remain immutable, including during recovery.
    """
    directory = job_path(queue, job_id)
    journal_path = directory / 'version-collision-recovery.json'
    with locked(queue / 'worker.lock', nonblocking=True), locked(release.BACKUPS / 'release.lock'), locked(queue / 'queue.lock'):
        if journal_path.exists() and read(journal_path).get('status') == 'complete':
            return {'jobId': job_id, 'status': 'already-recovered', 'journal': str(journal_path)}
        state = read(directory / 'state.json')
        if state['status'] not in {'failed', 'awaiting-smoke'} or state.get('integrationStyle') != 'squash':
            raise SystemExit('Collision recovery requires a failed, unshipped squash integration.')
        candidate = state.get('releaseCommit')
        if not candidate or state.get('ownedIntegrations') != [{'commit': candidate, 'merge': False}]:
            raise SystemExit('Collision recovery cannot prove one owned integration.')
        version = state['version']
        source_root = release.ROOT
        release.ROOT = canonical
        try:
            archive = release.archive_path(version)
        finally:
            release.ROOT = source_root
        receipt = release.release_receipt_dir(version) / 'deployment.json'
        deployed = read(receipt)
        archived_commit = deployed.get('gitCommit')
        if not archived_commit or archived_commit == candidate or not ancestor(canonical, archived_commit, candidate):
            raise SystemExit('These immutable bytes belong to this candidate, or their owner is unproven. Resume them; do not revert.')
        archive_hash = release.sha256_file(archive)
        receipt_hash = release.sha256_file(receipt)
        if deployed.get('archiveSha256') != archive_hash:
            raise SystemExit('The existing archive does not match its immutable receipt.')
        if git(canonical, 'status', '--porcelain=v1'):
            raise SystemExit('Canonical checkout contains uncommitted work.')
        head = git(canonical, 'rev-parse', 'HEAD')
        journal = read(journal_path) if journal_path.exists() else None
        if not journal:
            if not ancestor(canonical, candidate, head):
                raise SystemExit('The owned integration is not on the canonical branch.')
            owned_paths = set(git(canonical, 'diff-tree', '--no-commit-id', '--name-only', '-r', candidate).splitlines())
            newer_paths = set(git(canonical, 'diff', '--name-only', candidate, head).splitlines())
            if owned_paths & newer_paths:
                raise SystemExit('Later changes overlap this integration. Automatic collision recovery stopped.')
            journal = {'status': 'prepared', 'version': version, 'candidate': candidate,
                       'archivedCommit': archived_commit, 'archiveSha256': archive_hash,
                       'receiptSha256': receipt_hash, 'baseHead': head, 'beforeState': state.copy()}
            write(journal_path, journal)
        elif any(journal.get(key) != value for key, value in
                 [('version', version), ('candidate', candidate), ('archiveSha256', archive_hash), ('receiptSha256', receipt_hash)]):
            raise SystemExit('Collision recovery inputs changed.')
        source = release.ROOT
        release.ROOT = canonical
        try:
            if head == journal['baseHead']:
                revert_owned(release, candidate)
                reverted = git(canonical, 'rev-parse', 'HEAD')
            elif (git(canonical, 'rev-parse', 'HEAD^') == journal['baseHead'] and
                  f'This reverts commit {candidate}.' in git(canonical, 'show', '-s', '--format=%B', 'HEAD')):
                reverted = head  # Crash after the journalled revert committed.
            else:
                raise SystemExit('Canonical HEAD moved outside the recovery journal.')
            if release.sha256_file(archive) != archive_hash or release.sha256_file(receipt) != receipt_hash:
                raise SystemExit('Immutable release verification changed during recovery.')
            for key in ('version', 'releaseCommit', 'archive', 'deploymentReceipt'):
                state.pop(key, None)
            state.update(status='failed', ownedIntegrations=[], rollbackCommits=[reverted],
                         versionCollisionRecovery=str(journal_path), failures=0,
                         error='An unshipped integration selected an existing release version; it was reverted without changing those bytes.',
                         nextAction='Retry corrected source without a development --validation argument.')
            write(directory / 'state.json', state)
            write(journal_path, {**journal, 'status': 'complete', 'revertCommit': reverted})
            return {'jobId': job_id, 'status': 'recovered', 'revertCommit': reverted, 'immutableVersionPreserved': version}
        finally:
            release.ROOT = source


def defer_memory(directory: Path, state: dict, memory: str, *, phase: str,
                 reason: str, resume_task_id: str | None = None) -> None:
    previous = state.get('memoryWait', {})
    attempts = previous.get('failedProbes', 0) + int(bool(previous.get('ready')))
    seconds = release_memory.delay(attempts)
    deadline = (dt.datetime.fromisoformat(now()) + dt.timedelta(seconds=seconds)).isoformat()
    waiting = {'memory': release_memory.budget(memory), 'phase': phase, 'failedProbes': attempts,
               'nextProbeAt': deadline, 'nextProbeDelaySeconds': seconds, 'ready': False,
               'reason': reason, 'since': previous.get('since', now())}
    if resume_task_id:
        state['recoveryTaskId'] = resume_task_id
    state.pop('nextRetryAt', None)
    update(directory, state, status='waiting-for-memory', memoryWait=waiting, error=reason,
           nextAction='Automatic memory probes are active; verification still requires real evidence.')


def wait_for_memory(job_id: str, memory: str, resume_task_id: str, *, queue: Path = QUEUE) -> dict:
    """Register an agent-owned verification wait with a native recovery watch."""
    memory = release_memory.budget(memory)
    # Current T3 returns opaque, colon-delimited command IDs for schedules.
    if not re.fullmatch(r'[A-Za-z0-9_:-]{1,512}', resume_task_id):
        raise ValueError('Supply the returned native scheduledTaskId for this job’s recovery watch.')
    with locked(queue / 'queue.lock'):
        directory = job_path(queue, job_id)
        state = read(directory / 'state.json')
        request = read(directory / state.get('requestFile', 'request.json'))
        if state['status'] not in {'needs-evidence', 'waiting-for-memory'} or state.get('integratedCommit') or state.get('version'):
            raise ValueError('Only paused unintegrated verification can be deferred; wait for needs-evidence first.')
        if not request.get('threadId'):
            raise ValueError('The queued request must identify its owning native T3 thread.')
        waiting = state.get('memoryWait', {})
        if (state['status'] == 'waiting-for-memory' and waiting.get('phase') == 'verification'
                and waiting.get('memory') == memory and state.get('recoveryTaskId') == resume_task_id):
            schedule_retry(waiting['nextProbeAt'], queue=queue)
            return {'jobId': job_id, **state}
        defer_memory(directory, state, memory, phase='verification', resume_task_id=resume_task_id,
                     reason='Native verification was refused by memory admission.')
        schedule_retry(state['memoryWait']['nextProbeAt'], queue=queue)
        return {'jobId': job_id, **state}


def probe_memory_entry(directory: Path, state: dict) -> None:
    waiting = state['memoryWait']
    if waiting['ready'] or waiting['nextProbeAt'] > now():
        return
    decision = release_memory.probe(waiting['memory'])
    waiting['lastProbeAt'] = now()
    if decision['allowed']:
        waiting.update(ready=True, readyAt=now(), lastDecision=decision)
        waiting.pop('nextProbeAt', None)
        update(directory, state, memoryWait=waiting,
               status='needs-evidence' if waiting['phase'] == 'verification' else 'queued', error=None,
               nextAction='The native recovery watch resumes verification; evidence is still required.'
                          if waiting['phase'] == 'verification' else 'Memory admission passed; resuming the same candidate.')
        return
    waiting['failedProbes'] += 1
    seconds = release_memory.delay(waiting['failedProbes'])
    waiting.update(nextProbeAt=(dt.datetime.fromisoformat(now()) + dt.timedelta(seconds=seconds)).isoformat(),
                   nextProbeDelaySeconds=seconds, lastDecision=decision)
    update(directory, state, memoryWait=waiting, error=decision.get('reason'),
           nextAction='Automatic memory probes remain active. No publication or rollback was attempted.')


def probe_memory(job_id: str, *, queue: Path = QUEUE) -> dict:
    with locked(queue / 'queue.lock'):
        directory = job_path(queue, job_id)
        state = read(directory / 'state.json')
        if state.get('memoryWait') and state['status'] == 'waiting-for-memory':
            probe_memory_entry(directory, state)
        if state.get('memoryWait', {}).get('nextProbeAt'):
            schedule_retry(state['memoryWait']['nextProbeAt'], queue=queue)
        return {'jobId': job_id, **state}


def memory_holds_lane(state: dict) -> bool:
    return (state['status'] == 'waiting-for-memory' and state['memoryWait']['phase'] == 'worker'
            and bool(state.get('pendingIntegration') or state.get('integratedCommit') or state.get('archive')))


def next_memory_probe(pending: list[tuple[Path, dict]]) -> str | None:
    return min((item['memoryWait']['nextProbeAt'] for _, item in pending
                if item['status'] == 'waiting-for-memory' and item.get('memoryWait', {}).get('nextProbeAt')), default=None)


def completed_smoke(release, version: str) -> bool:
    for path in release.release_receipt_dir(version).glob('smoke-*.json'):
        value = read(path)
        if (value.get('version') == version and value.get('status') == 'complete'
                and value.get('installedMainSha256') and value.get('evidenceSha256')):
            return True
    return False


def update(directory: Path, state: dict, **values) -> None:
    state.update(**values, updatedAt=now())
    write(directory / 'state.json', state)


def revert_owned(release, commit: str, *, merge: bool = False) -> None:
    try:
        release.run(['git', 'revert', '--no-edit', *(['-m', '1'] if merge else []), commit])
    except subprocess.CalledProcessError:
        marker = Path(git(release.ROOT, 'rev-parse', '--git-path', 'REVERT_HEAD'))
        if not marker.is_absolute():
            marker = release.ROOT / marker
        if marker.exists():
            release.run(['git', 'revert', '--abort'])
        raise


def registration_line(line: str):
    """Parse only the lab builder's flag list or validation entry-point chain."""
    flags = re.fullmatch(r"(if\(!\[)(.*)(\]\.some.*)", line)
    if flags:
        body = flags[2]
        tokens = re.findall(r"'(--[a-z0-9-]+)'", body)
        if ','.join("'" + token + "'" for token in tokens) != body:
            return None
        return flags[1], [(token, token) for token in tokens], flags[3], 'flags'
    entries = re.fullmatch(r'(.*entryPoints:\[)(.*)(\],bundle:.*)', line)
    if entries:
        pattern = r"process\.argv\.includes\('(--[a-z0-9-]+)'\)\?'(tests/native/[a-z0-9-]+\.ts)':"
        tokens = re.findall(pattern, entries[2])
        remainder = re.sub(pattern, '', entries[2])
        if not re.fullmatch(r"'tests/native/[a-z0-9-]+\.ts'", remainder):
            return None
        if ''.join(f"process.argv.includes('{key}')?'{value}':" for key, value in tokens) + remainder != entries[2]:
            return None
        return entries[1], tokens, remainder + entries[3], 'entries'
    return None


def resolve_validation_source(original_source: str, source: str) -> str | None:
    """Union independent additions to the two lab registries, never product code."""
    base = [parsed for line in original_source.splitlines() if (parsed := registration_line(line))]
    conflict = re.compile(r'^<<<<<<<[^\n]*\n(.*?)^=======\n(.*?)^>>>>>>>[^\n]*\n', re.M | re.S)
    matches = list(conflict.finditer(source))
    if not matches:
        return None
    for match in reversed(matches):
        left, right = match[1].splitlines(), match[2].splitlines()
        if len(left) != len(right):
            return None
        lines = []
        for left_line, right_line in zip(left, right):
            if left_line == right_line:
                lines.append(left_line)
                continue
            ours, theirs = registration_line(left_line), registration_line(right_line)
            if not ours or not theirs or (ours[0], ours[2:]) != (theirs[0], theirs[2:]):
                return None
            original = next((item for item in base if (item[0], item[2:]) == (ours[0], ours[2:])), None)
            if original is None:
                return None
            a, b, before = dict(ours[1]), dict(theirs[1]), dict(original[1])
            if len(a) != len(ours[1]) or len(b) != len(theirs[1]):
                return None
            if any(a.get(key) != value or b.get(key) != value for key, value in before.items()):
                return None
            if any(a[key] != b[key] for key in a.keys() & b.keys()):
                return None
            combined = {**a, **b}
            body = (','.join("'" + key + "'" for key in combined) if ours[3] == 'flags' else
                    ''.join(f"process.argv.includes('{key}')?'{value}':" for key, value in combined.items()))
            lines.append(ours[0] + body + ours[2])
        source = source[:match.start()] + '\n'.join(lines) + '\n' + source[match.end():]
    if re.search(r'^(<<<<<<<|=======|>>>>>>>)', source, re.M):
        return None
    return source


def tree_bytes(root: Path, tree: str, name: str) -> bytes:
    return subprocess.check_output(['git', 'show', tree + ':' + name], cwd=root)


def update_tree(root: Path, tree: str, files: dict[str, bytes], directory: Path) -> str:
    """Build a tree in an owned temporary index; never stage canonical edits."""
    with tempfile.TemporaryDirectory(dir=directory, prefix='index-') as temporary:
        environment = {**os.environ, 'GIT_INDEX_FILE': str(Path(temporary) / 'index')}
        subprocess.run(['git', 'read-tree', tree], cwd=root, env=environment, check=True)
        for name, value in files.items():
            mode = git(root, 'ls-tree', tree, '--', name).split()[0]
            blob = subprocess.check_output(['git', 'hash-object', '-w', '--stdin'], cwd=root, input=value).decode().strip()
            subprocess.run(['git', 'update-index', '--add', '--cacheinfo', mode, blob, name],
                           cwd=root, env=environment, check=True)
        return subprocess.check_output(['git', 'write-tree'], cwd=root, env=environment, text=True).strip()


def merged_tree(root: Path, context: str, source: str, directory: Path) -> str:
    command = ['git', 'merge-tree', '--write-tree', '--name-only', '--no-messages', '-z', context, source]
    result = subprocess.run(command, cwd=root, capture_output=True, check=False)
    if result.returncode not in (0, 1):
        raise subprocess.CalledProcessError(result.returncode, command, result.stdout, result.stderr)
    fields = result.stdout.decode().split('\0')
    tree = fields[0]
    if result.returncode == 0:
        return tree
    name = 'scripts/build-native-response-lab.mjs'
    if [field for field in fields[1:] if field] == [name]:
        bases = git(root, 'merge-base', '--all', context, source).splitlines()
        if len(bases) == 1:
            resolved = resolve_validation_source(tree_bytes(root, bases[0], name).decode(),
                                                 tree_bytes(root, tree, name).decode())
            if resolved is not None:
                print('Merged independent validation-mode registrations; no product conflicts were resolved automatically.', flush=True)
                return update_tree(root, tree, {name: resolved.encode()}, directory)
    raise SystemExit('Queued source conflicts with the canonical tree: ' + ', '.join(field for field in fields[1:] if field))


def engine_hash(root: Path) -> dict:
    return {name: hashlib.sha256((root / 'scripts' / name).read_bytes()).hexdigest()
            for name in ('release-qlo2.py', 'release_queue.py', 'release_memory.py', 'release_policy.py', 'release_history.py', 'change_checks.py', 'plugin_id_migration.py', 'maintainer_config.py', 'source_cleanup.py', 'cleanup-worktree.mjs')
            if (root / 'scripts' / name).is_file()}


def bootstrap(release, canonical: Path, job_id: str, *, queue: Path = QUEUE) -> dict:
    """Queue-owned integration only; the freshly integrated worker validates and publishes.

    A canonical loader can fail before normal FIFO integration is available.
    Use an exact committed repair from its submitting worktree, preserving the
    same locks, FIFO order, merge checks, and mandatory engine restart.
    """
    source = release.ROOT
    if source.resolve() == canonical.resolve() or git(source, 'status', '--porcelain=v1'):
        raise SystemExit('Bootstrap requires the clean submitting source worktree.')
    directory = job_path(queue, job_id)
    with locked(queue / 'worker.lock', nonblocking=True), locked(release.BACKUPS / 'release.lock'):
        with locked(queue / 'queue.lock'):
            first = next((path for path in jobs(queue) if
                          (item := read(path / 'state.json'))['status'] not in FINISHED or memory_holds_lane(item)), None)
            if first != directory:
                raise SystemExit('Bootstrap cannot overtake an earlier queue job.')
            state = read(directory / 'state.json')
            request = read(directory / state.get('requestFile', 'request.json'))
            if (Path(request['sourceRoot']).resolve() != source.resolve() or
                    request['commit'] != git(source, 'rev-parse', 'HEAD') or
                    state.get('version') or state.get('ownedIntegrations') or state.get('rollbackCommits')):
                raise SystemExit('Bootstrap requires this worktree’s exact queued, unintegrated commit.')
            if not request.get('maintenanceOnly') and not request.get('evidence'):
                raise SystemExit('Bootstrap requires the product job’s behavior evidence.')
            if git(canonical, 'status', '--porcelain=v1'):
                raise SystemExit('Canonical checkout contains uncommitted work.')
            loaded_engine = engine_hash(canonical)
            if engine_hash(source) == loaded_engine:
                raise SystemExit('Bootstrap requires a reviewed release-tooling change.')
            if subprocess.run(['git', 'merge-base', '--is-ancestor', request['commit'], 'HEAD'],
                              cwd=canonical, capture_output=True).returncode == 0:
                raise SystemExit('The queued commit is already integrated; use the canonical worker.')
        release.ROOT = canonical
        try:
            with (directory / 'worker.log').open('a', buffering=1) as log, redirect_stdout(log), redirect_stderr(log):
                print(f'Queue tooling bootstrap {now()}: {directory.name}', flush=True)
                if not run_job(release, directory, request, state, loaded_engine, integration_only=True):
                    raise SystemExit('The tooling repair did not request its mandatory worker restart.')
            return {'status': 'worker-restart', 'jobId': job_id, 'publicationStarted': False}
        finally:
            release.ROOT = source


def next_version(release, directory: Path, request: dict, *, root: Path | None = None) -> str:
    """An assigned version belongs to its job, even when validation fails."""
    root = root or release.ROOT
    versions = [release.read_json(root / 'manifest.json')['version']]
    queue = directory.parent.parent
    with locked(queue / 'queue.lock'):
        states = [read(path / 'state.json') for path in jobs(queue)]
    for item in states:
        versions.extend(item.get('reservedVersions', []))
        if item.get('version'):
            versions.append(item['version'])
    policy = release_policy.policy(root)
    if policy and policy['stage'] == 'alpha':
        alphas = [value for value in versions if release_policy.is_alpha_version(root, value)]
        latest = max(alphas, key=lambda value: release_policy.order_key(root, value)) if alphas else versions[0]
        return release_policy.bump(root, latest, request['bump'])
    latest = max(versions, key=lambda value: release_policy.order_key(root, value))
    return release.bump_version(latest, request['bump'])


def apply_pending_integration(release, directory: Path, state: dict) -> None:
    """Complete the journalled fast-forward, including after a worker crash."""
    pending = state['pendingIntegration']
    if git(release.ROOT, 'status', '--porcelain=v1'):
        raise SystemExit('Canonical checkout contains uncommitted work. The queue will not alter it.')
    head = git(release.ROOT, 'rev-parse', 'HEAD')
    if head == pending['baseCommit']:
        release.run(['git', 'merge', '--ff-only', pending['commit']])
    elif head != pending['commit']:
        raise SystemExit('Canonical HEAD moved outside the pending queue integration; recovery stopped.')
    values = dict(integrationStyle='squash', integratedCommit=pending['commit'],
                  integratedSourceCommit=pending['sourceCommit'], pendingIntegration=None,
                  ownedIntegrations=[*state.get('ownedIntegrations', []), {'commit': pending['commit'], 'merge': False}],
                  pastRollbacks=[*state.get('pastRollbacks', []), *state.get('rollbackCommits', [])], rollbackCommits=[])
    if pending.get('version'):
        values.update(version=pending['version'], releaseCommit=pending['commit'])
    update(directory, state, **values)


def integrate_job(release, directory: Path, request: dict, state: dict) -> None:
    root = release.ROOT
    if state.get('pendingIntegration'):
        if state['pendingIntegration']['sourceCommit'] != request['commit']:
            raise SystemExit('Pending integration belongs to another request revision.')
        apply_pending_integration(release, directory, state)
        return
    if (state.get('integratedSourceCommit') == request['commit'] and not state.get('rollbackCommits')
            and ancestor(root, state['integratedCommit'], 'HEAD')):
        return
    if (request['maintenanceOnly'] and state.get('integratedCommit') and not state.get('rollbackCommits')
            and ancestor(root, request['commit'], 'HEAD')):
        # A pre-upgrade worker may have already merged this tooling update.
        update(directory, state, integratedSourceCommit=request['commit'])
        return
    # Older queued failures have real merge parents. Restore only their owned
    # reverts. Squashed candidates are instead recreated from reviewed source.
    if state.get('integrationStyle') != 'squash':
        while state.get('rollbackCommits'):
            revert_owned(release, state['rollbackCommits'][-1])
            update(directory, state, rollbackCommits=state['rollbackCommits'][:-1],
                   ownedIntegrations=[*state.get('ownedIntegrations', []), {'commit': git(root, 'rev-parse', 'HEAD'), 'merge': False}])
    head = git(root, 'rev-parse', 'HEAD')
    context = integration_context(root, head, directory.parent.parent)
    tree = merged_tree(root, context, request['commit'], directory)
    version = None
    if not request['maintenanceOnly']:
        # The submitted change can itself update the version policy. Read the
        # merged policy without checking out or staging any canonical files.
        with tempfile.TemporaryDirectory(dir=directory, prefix='policy-') as temporary:
            policy_root = Path(temporary)
            (policy_root / 'manifest.json').write_bytes(tree_bytes(root, tree, 'manifest.json'))
            policy_file = subprocess.run(['git', 'show', tree + ':release-policy.json'], cwd=root, capture_output=True)
            if policy_file.returncode == 0:
                (policy_root / 'release-policy.json').write_bytes(policy_file.stdout)
            source_version = read(policy_root / 'manifest.json')['version']
            version = source_version if request.get('validation') else state.get('version')
            if not request.get('validation'):
                if not version or not release_policy.newer(policy_root, version, source_version):
                    version = next_version(release, directory, request, root=policy_root)
                documents = {name: tree_bytes(root, tree, name) for name in VERSION_FILES}
                tree = update_tree(root, tree, release.version_updates(version, documents), directory)
    summary = ' '.join(request.get('summary', '').split())[:160] or 'Reviewed changes'
    title = f'Release {version}: {summary}' if version else f'Maintenance: {summary}'
    message = f"{title}\n\nSource-Commit: {request['commit']}\nRelease-Queue-Job: {directory.name}\n"
    candidate = commit_tree(root, tree, [head], message)
    git(root, 'update-ref', f'refs/t3-release-queue/candidates/{directory.name}/{candidate}', candidate)
    # Save ownership before moving the branch. An interruption on either side
    # of the fast-forward resumes this exact commit, never a second release.
    update(directory, state, pendingIntegration={'baseCommit': head, 'commit': candidate,
                                                'sourceCommit': request['commit'], 'version': version})
    apply_pending_integration(release, directory, state)


def run_job(release, directory: Path, request: dict, state: dict, loaded_engine: dict, *, integration_only: bool = False) -> bool:
    root = release.ROOT
    if 'maintenanceOnly' not in request:
        request = {**request, 'maintenanceOnly': maintenance_only(
            git(root, 'diff', '--name-only', '--no-renames', request['mergeBase'], request['commit']).splitlines())}
    version = state.get('version')
    deployed = version and (release.release_receipt_dir(version) / 'deployment.json').is_file()
    if deployed and state.get('integrationStyle') == 'squash' and state.get('releaseCommit'):
        owner = read(release.release_receipt_dir(version) / 'deployment.json').get('gitCommit')
        if owner != state['releaseCommit']:
            raise SystemExit('Another release owns this deployment. Use --recover-version-collision; its archive and client proof cannot satisfy this job.')
    if not request.get('maintenanceOnly') and not request.get('evidence') and not version:
        update(directory, state, status='needs-evidence',
               nextAction='Supply changed-behavior evidence with --retry-queued --replacement before publication. Later jobs continue.')
        return False
    if not deployed and not (version and release.archive_path(version).exists()):
        if git(root, 'status', '--porcelain=v1'):
            raise SystemExit('Canonical checkout contains uncommitted work. The queue will not alter it.')
        update(directory, state, status='integrating')
        integrate_job(release, directory, request, state)
        version = state.get('version')
        if integration_only or engine_hash(root) != loaded_engine:
            # Exit with the wake marker intact. systemd starts a fresh worker,
            # so a tooling change is checked by its newly integrated runner.
            update(directory, state, status='queued', nextAction='Restarting the updated release worker.')
            return True
        ensure_dependencies(root)
        if request.get('maintenanceOnly'):
            proof = release.change_checks.run_validation(root)
            update(directory, state, status='complete', completedAt=now(), validation=str(proof),
                   delivery='source-only', error=None, nextAction=None)
            return False
        source_version = release.read_json(root / 'manifest.json')['version']
        if version and not state.get('releaseCommit') and not request.get('validation') and release_policy.order_key(root, version) <= release_policy.order_key(root, source_version):
            # Older task checkouts can retry without clearing a stale version.
            version = None
        version = version or (source_version if request.get('validation') else next_version(release, directory, request))
        update(directory, state, version=version, status='releasing',
               archive=str(release.archive_path(version)),
               deploymentReceipt=str(release.release_receipt_dir(version) / 'deployment.json'))
        seed = Path(request['historySeed']) if request.get('historySeed') else None
        if seed and release.sha256_file(seed) != request['historySeedSha256']:
            raise SystemExit('Queued history seed changed; release stopped.')
        release_history.refresh(release, directory, request, version, seed=seed)
        if request.get('validation'):
            proof = Path(request['validation'])
            if release.sha256_file(proof) != request['validationSha256']:
                raise SystemExit('Prepared validation changed after submission.')
            try:
                release.publish_prepared(version, proof)
            finally:
                release_history.refresh(release, directory, request, version)
        else:
            try:
                if state.get('releaseCommit') != git(root, 'rev-parse', 'HEAD'):
                    raise SystemExit('The committed release candidate changed before packaging.')
                release.new_release(None, False, version, committed_version=True)
            finally:
                release_history.refresh(release, directory, request, version)
    elif not deployed:
        update(directory, state, status='publishing')
        try:
            release.resume_release(version, False)
        finally:
            release_history.refresh(release, directory, request, version)
    # Only legacy in-flight archives can have separate generated version edits.
    # New releases already committed their exact version bytes before packaging.
    dirty = release.git_state()[1]
    if dirty:
        if state.get('integrationStyle') == 'squash':
            raise SystemExit('Committed release inputs changed during publication; no extra commit will be created.')
        if any(line[:3] != ' M ' or line[3:] not in VERSION_FILES for line in dirty):
            raise SystemExit('Unexpected canonical edits appeared; release queue stopped.')
        release.run(['git', 'add', *sorted(VERSION_FILES)])
        release.run(['git', 'commit', '-m', f'Release {version}'])
    evidence = release.release_receipt_dir(version) / 'client-check.json'
    if not evidence.exists():
        release.check_client(version)
    update(directory, state, status='verifying-evidence')
    if completed_smoke(release, version):
        release_history.refresh(release, directory, request, version)
        update(directory, state, status='complete', completedAt=now(), error=None, nextAction=None)
        return False
    matches = all((release.sha256_file(root / name) if (root / name).is_file() else None) == checksum
                  for name, checksum in request['sourceInputsSha256'].items())
    matches = matches and (not request.get('dependencyInputsSha256') or
                           dependency_inputs(root) == request['dependencyInputsSha256'])
    if request.get('evidence') and matches:
        original = Path(request['evidence'])
        if release.sha256_file(original) != request['evidenceSha256']:
            raise SystemExit('Queued behavior evidence changed after submission.')
        combined = directory / 'release-evidence.json'
        if not combined.exists():
            write(combined, {'version': version, 'sourceCommit': request['commit'],
                             'behaviorEvidence': str(original), 'behaviorEvidenceSha256': request['evidenceSha256'],
                             'sourceInputsSha256': request['sourceInputsSha256'], 'matchingIntegratedInputs': True,
                             'clientCheck': str(evidence), 'clientCheckSha256': release.sha256_file(evidence),
                             'notes': request['notes'], 'queueJobId': directory.name, 'workerLog': str(directory / 'worker.log')})
        release.complete_smoke(version, 'vps-qlo2-queue', combined, request['notes'])
        release_history.refresh(release, directory, request, version)
        update(directory, state, status='complete', completedAt=now(), error=None, nextAction=None)
    else:
        update(directory, state, status='awaiting-smoke',
               nextAction=f'Verify only changed behavior for {version}, then use --complete-smoke. '
                          'Publication is verified; other jobs can continue. This release remains incomplete.',
               suppliedBehaviorInputsMatch=matches)
    return False


def isolate_failure(release, directory: Path, state: dict) -> bool:
    """Remove only this job's unshipped integration, retaining commits and logs."""
    if state.get('pendingIntegration'):
        apply_pending_integration(release, directory, state)
    version = state.get('version')
    if version and (release.archive_path(version).exists() or
                    (release.release_receipt_dir(version) / 'deployment.json').exists()):
        return False
    if git(release.ROOT, 'status', '--porcelain=v1'):
        return False
    owned = state.get('ownedIntegrations', [])
    if owned:
        if git(release.ROOT, 'rev-parse', 'HEAD') != owned[-1]['commit']:
            return False
        for integration in reversed(owned):
            revert_owned(release, integration['commit'], merge=integration['merge'])
            update(directory, state, rollbackCommits=[*state.get('rollbackCommits', []), git(release.ROOT, 'rev-parse', 'HEAD')],
                   ownedIntegrations=state['ownedIntegrations'][:-1])
    elif state.get('integratedCommit'):
        return False
    update(directory, state, status='failed', nextAction='This candidate needs repair. Later jobs continue; use --retry-queued with corrected committed source.')
    return True


def cleanup_finished_sources(release, pending: list) -> str | None:
    deadlines = []
    for directory, state in pending:
        if state['status'] != 'complete':
            continue
        request = read(directory / state.get('requestFile', 'request.json'))
        if not request.get('sourceBranch') or state.get('sourceCleanup', {}).get('status') in {'removed', 'protected', 'not-requested'}:
            continue
        previous = state.get('sourceCleanup', {})
        # A later queue wake can clear a blocker. Blocked entries do not arm
        # retries, but must be checked again after the owner resolves them.
        if previous.get('nextAttemptAt', '') > now():
            deadlines.append(previous['nextAttemptAt'])
            continue
        try:
            outcome = source_cleanup.cleanup(release.ROOT, request, target_commit=state.get('integratedCommit'))
        except (OSError, ValueError, subprocess.SubprocessError) as error:
            outcome = {'status': 'pending', 'reason': 'Checkout cleanup could not finish: ' + type(error).__name__}
        if outcome.get('status') == 'pending':
            attempts = previous.get('attempts', 0) + 1
            delay = min(300, 30 * 2 ** min(attempts - 1, 4))
            outcome.update(attempts=attempts, nextAttemptAt=(dt.datetime.fromisoformat(now()) + dt.timedelta(seconds=delay)).isoformat())
            deadlines.append(outcome['nextAttemptAt'])
        update(directory, state, sourceCleanup=outcome)
    return min(deadlines, default=None)


def drain(release, *, queue: Path = QUEUE) -> dict:
    release.canonical_root_required()
    try:
        with locked(queue / 'worker.lock', nonblocking=True):
            with locked(release.BACKUPS / 'release.lock'):
                loaded_engine = engine_hash(release.ROOT)
                while True:
                    with locked(queue / 'queue.lock'):
                        pending = [(path, read(path / 'state.json')) for path in jobs(queue)]
                        # Smoke completion can arrive after a later release. It
                        # remains visible without owning the installation lane.
                        for path, item in pending:
                            if item['status'] == 'awaiting-smoke' and completed_smoke(release, item['version']):
                                deployed = read(release.release_receipt_dir(item['version']) / 'deployment.json')
                                if item.get('integrationStyle') == 'squash' and deployed.get('gitCommit') != item.get('releaseCommit'):
                                    update(path, item, error='Another release owns this deployment. Use --recover-version-collision.',
                                           nextAction='Recover the unshipped version collision; older smoke records cannot complete it.')
                                    continue
                                completed_request = read(path / item.get('requestFile', 'request.json'))
                                release_history.refresh(release, path, completed_request, item['version'])
                                update(path, item, status='complete', completedAt=now(), nextAction=None, error=None)
                            if item['status'] == 'waiting-for-dependency':
                                parent = read(job_path(queue, item['requiresJobId']) / 'state.json')
                                if parent['status'] == 'complete':
                                    update(path, item, status='queued', requiresJobId=None, nextAction=None)
                            if item['status'] == 'waiting-for-memory':
                                probe_memory_entry(path, item)
                        cleanup_deadline = cleanup_finished_sources(release, pending)
                        memory_deadline = next_memory_probe(pending)
                        directory = next((path for path, item in pending
                                          if item['status'] not in FINISHED or memory_holds_lane(item)), None)
                        if directory is None:
                            (queue / 'wake').unlink(missing_ok=True)
                            if memory_deadline:
                                schedule_retry(min(memory_deadline, cleanup_deadline or memory_deadline), queue=queue)
                                return {'status': 'waiting-for-memory', 'nextProbeAt': memory_deadline}
                            if cleanup_deadline:
                                schedule_retry(cleanup_deadline, queue=queue)
                            return {'status': 'idle'}
                        state = read(directory / 'state.json')
                        if state['status'] == 'waiting-for-memory':
                            (queue / 'wake').unlink(missing_ok=True)
                            schedule_retry(memory_deadline, queue=queue)
                            return {'status': 'waiting-for-memory', 'jobId': directory.name,
                                    'nextProbeAt': state['memoryWait']['nextProbeAt']}
                        if state.get('nextRetryAt') and state['nextRetryAt'] > now():
                            (queue / 'wake').unlink(missing_ok=True)
                            schedule_retry(min(state['nextRetryAt'], memory_deadline or state['nextRetryAt']), queue=queue)
                            return {'status': 'retrying', 'jobId': directory.name, 'nextRetryAt': state['nextRetryAt']}
                        state.pop('nextRetryAt', None)
                        request = read(directory / state.get('requestFile', 'request.json'))
                        dependency = None
                        for path, item in pending:
                            if path == directory or not item.get('rollbackCommits'):
                                continue
                            parent = read(path / item.get('requestFile', 'request.json'))
                            if subprocess.run(['git', 'merge-base', '--is-ancestor', parent['commit'], request['commit']], cwd=release.ROOT, capture_output=True).returncode == 0:
                                dependency = path.name
                                break
                        if dependency:
                            update(directory, state, status='waiting-for-dependency', requiresJobId=dependency,
                                   nextAction='This candidate includes a reverted job. It resumes after that job is repaired; independent jobs continue.')
                            continue
                    with (directory / 'worker.log').open('a', buffering=1) as log, redirect_stdout(log), redirect_stderr(log):
                        print(f'Queue attempt {now()}: {directory.name}', flush=True)
                        log_offset = os.fstat(log.fileno()).st_size
                        try:
                            restart = run_job(release, directory, request, state, loaded_engine)
                            if restart:
                                return {'status': 'worker-restart', 'jobId': directory.name}
                        except (Exception, SystemExit) as error:
                            log.flush()
                            with (directory / 'worker.log').open('rb') as current_log:
                                current_log.seek(max(log_offset, current_log.seek(0, os.SEEK_END) - 16_384))
                                attempt_output = current_log.read().decode(errors='replace')
                            if release_memory.refused(error, attempt_output):
                                defer_memory(directory, state, '2G', phase='worker', reason=str(error))
                                continue
                            failures = state.get('failures', 0) + 1
                            failed_stage = state['status']
                            attempt = directory / f'failure-{len(list(directory.glob("failure-*.json"))) + 1:04d}.json'
                            write(attempt, {'at': now(), 'error': str(error), 'stage': state['status'], 'version': state.get('version')})
                            update(directory, state, status='retrying', failures=failures, error=str(error),
                                   nextAction='Automatic recovery is active. Failed checks are never bypassed.')
                            if failures >= MAX_ATTEMPTS:
                                if failed_stage == 'verifying-evidence':
                                    update(directory, state, status='awaiting-smoke',
                                           nextAction='Publication and native client are verified. Repair changed-behavior evidence; later jobs continue.')
                                    continue
                                try:
                                    isolated = isolate_failure(release, directory, state)
                                except (Exception, SystemExit) as cleanup_error:
                                    isolated = False
                                    update(directory, state, recoveryError=str(cleanup_error))
                                if not isolated:
                                    deadline = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(seconds=min(300, 15 * 2 ** min(failures - MAX_ATTEMPTS, 5)))).isoformat()
                                    update(directory, state, nextRetryAt=deadline)
                    if state['status'] in FINISHED or state['status'] == 'retrying':
                        continue
                    if state['status'] != 'complete':
                        with locked(queue / 'queue.lock'):
                            if read(directory / 'state.json')['status'] == 'queued':
                                continue
                            (queue / 'wake').unlink(missing_ok=True)
                        return {'status': state['status'], 'jobId': directory.name, 'version': state.get('version')}
    except BlockingIOError:
        return {'status': 'worker-running'}
