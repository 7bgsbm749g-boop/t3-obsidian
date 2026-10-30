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

QUEUE = Path('/home/ubuntu/projects/send-to-t3-code/evidence/release-queue')
UNIT = 'send-to-t3-release-queue'
JOB_ID = re.compile(r'^\d{12}-[0-9a-f]{16}$')
VERSION_FILES = {'package.json', 'package-lock.json', 'manifest.json', 'versions.json'}
MAX_ATTEMPTS = 3
FINISHED = {'complete', 'failed', 'needs-evidence', 'awaiting-smoke'}


def maintenance_only(names: list[str]) -> bool:
    return bool(names) and all(name.startswith(('scripts/', 'tests/', 'docs/')) or
                               name in {'AGENTS.md', 'README.md', 'LICENSE'} for name in names)


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
               evidence: Path | None = None, notes: str = '') -> dict:
    commit = git(root, 'rev-parse', '--verify', '--end-of-options', commit + '^{commit}')
    canonical_commit = git(canonical, 'rev-parse', 'HEAD')
    base = git(root, 'merge-base', canonical_commit, commit)
    # Requests contain committed source only; no task can deploy another task's
    # uncommitted checkout. Identical submissions are idempotent.
    proof_hash = hashlib.sha256(validation.read_bytes()).hexdigest() if validation else None
    evidence_hash = hashlib.sha256(evidence.read_bytes()).hexdigest() if evidence else None
    identity = {'commit': commit, 'bump': bump, 'validationSha256': proof_hash,
                'evidenceSha256': evidence_hash, 'notes': notes}
    changed = git(root, 'diff', '--name-only', '--no-renames', base, commit).splitlines()
    inputs = {}
    for name in changed:
        if name in VERSION_FILES or Path(name).suffix not in {'.ts', '.tsx', '.mjs', '.js', '.py', '.css', '.json'}:
            continue
        item = subprocess.run(['git', 'show', f'{commit}:{name}'], cwd=root, capture_output=True)
        inputs[name] = hashlib.sha256(item.stdout).hexdigest() if item.returncode == 0 else None
    return {**identity, 'createdAt': now(), 'sourceRoot': str(root), 'mergeBase': base,
            'maintenanceOnly': maintenance_only(changed),
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
    if (directory / name).exists():
        raise SystemExit('Queue requests are immutable.')
    write(directory / name, request)


def enqueue(root: Path, canonical: Path, commit: str, *, bump: str = 'patch', validation: Path | None = None,
            evidence: Path | None = None, notes: str = '', queue: Path = QUEUE) -> dict:
    request = submission(root, canonical, commit, bump=bump, validation=validation, evidence=evidence, notes=notes)
    key = hashlib.sha256(request['commit'].encode()).hexdigest()[:16]
    with locked(queue / 'queue.lock'):
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
        '[Path]\nPathExists=' + str(queue / 'wake') + '\nUnit=' + UNIT + '.service\n'
        '[Install]\nWantedBy=default.target\n')
    subprocess.run(['systemctl', '--user', 'daemon-reload'], check=True)
    subprocess.run(['systemctl', '--user', 'enable', '--now', UNIT + '.path'], check=True)


def schedule_retry(when: str, *, queue: Path = QUEUE) -> None:
    """One persisted deadline, armed only while recovery is needed; no polling."""
    units = Path.home() / '.config/systemd/user'
    if not (units / (UNIT + '.service')).is_file():
        return
    timestamp = dt.datetime.fromisoformat(when).astimezone(dt.timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')
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
        if state['status'] not in {'blocked', 'failed', 'awaiting-smoke', 'needs-evidence', 'retrying'}:
            raise SystemExit('Only a failed, blocked, or smoke-waiting job can be retried.')
        if state['status'] == 'retrying' and not state.get('nextRetryAt'):
            raise SystemExit('This job is already recovering in the active worker.')
        if replacement:
            if any(Path(state[key]).exists() for key in ('archive', 'deploymentReceipt') if state.get(key)):
                raise SystemExit('This job already has immutable release bytes. Resume them; submit later code separately.')
            revision = state.get('requestRevision', 0) + 1
            name = f'request-{revision}.json'
            save_request(directory, replacement, name)
            state.update(requestRevision=revision, requestFile=name)
        state.update(status='queued', updatedAt=now(), failures=0)
        for key in ('error', 'nextAction', 'nextRetryAt'):
            state.pop(key, None)
        if state.get('rollbackCommits'):
            state.pop('version', None)
        write(directory / 'state.json', state)
        (queue / 'wake').touch()
    return {'jobId': job_id, **state}


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
        pattern = r"process\.argv\.includes\('(--[a-z0-9-]+)'\)\?'(validation/[a-z0-9-]+\.ts)':"
        tokens = re.findall(pattern, entries[2])
        remainder = re.sub(pattern, '', entries[2])
        if not re.fullmatch(r"'validation/[a-z0-9-]+\.ts'", remainder):
            return None
        if ''.join(f"process.argv.includes('{key}')?'{value}':" for key, value in tokens) + remainder != entries[2]:
            return None
        return entries[1], tokens, remainder + entries[3], 'entries'
    return None


def resolve_validation_merge(release) -> bool:
    """Union independent additions to the two lab registries, never product code."""
    name = 'scripts/build-native-response-lab.mjs'
    if git(release.ROOT, 'diff', '--name-only', '--diff-filter=U').splitlines() != [name]:
        return False
    base = [parsed for line in git(release.ROOT, 'show', ':1:' + name).splitlines()
            if (parsed := registration_line(line))]
    path = release.ROOT / name
    source = path.read_text()
    conflict = re.compile(r'^<<<<<<<[^\n]*\n(.*?)^=======\n(.*?)^>>>>>>>[^\n]*\n', re.M | re.S)
    matches = list(conflict.finditer(source))
    if not matches:
        return False
    for match in reversed(matches):
        left, right = match[1].splitlines(), match[2].splitlines()
        if len(left) != len(right):
            return False
        lines = []
        for left_line, right_line in zip(left, right):
            if left_line == right_line:
                lines.append(left_line)
                continue
            ours, theirs = registration_line(left_line), registration_line(right_line)
            if not ours or not theirs or (ours[0], ours[2:]) != (theirs[0], theirs[2:]):
                return False
            original = next((item for item in base if (item[0], item[2:]) == (ours[0], ours[2:])), None)
            if original is None:
                return False
            a, b, before = dict(ours[1]), dict(theirs[1]), dict(original[1])
            if len(a) != len(ours[1]) or len(b) != len(theirs[1]):
                return False
            if any(a.get(key) != value or b.get(key) != value for key, value in before.items()):
                return False
            if any(a[key] != b[key] for key in a.keys() & b.keys()):
                return False
            combined = {**a, **b}
            body = (','.join("'" + key + "'" for key in combined) if ours[3] == 'flags' else
                    ''.join(f"process.argv.includes('{key}')?'{value}':" for key, value in combined.items()))
            lines.append(ours[0] + body + ours[2])
        source = source[:match.start()] + '\n'.join(lines) + '\n' + source[match.end():]
    if re.search(r'^(<<<<<<<|=======|>>>>>>>)', source, re.M):
        return False
    path.write_text(source)
    release.run(['git', 'add', name])
    release.run(['git', 'commit', '--no-edit'])
    print('Merged independent validation-mode registrations; no product conflicts were resolved automatically.', flush=True)
    return True


def engine_hash(root: Path) -> dict:
    return {name: hashlib.sha256((root / 'scripts' / name).read_bytes()).hexdigest()
            for name in ('release-qlo2.py', 'release_queue.py', 'change_checks.py', 'plugin_id_migration.py')
            if (root / 'scripts' / name).is_file()}


def run_job(release, directory: Path, request: dict, state: dict, loaded_engine: dict) -> bool:
    root = release.ROOT
    version = state.get('version')
    deployed = version and (release.release_receipt_dir(version) / 'deployment.json').is_file()
    if not request.get('maintenanceOnly') and not request.get('evidence') and not version:
        update(directory, state, status='needs-evidence',
               nextAction='Supply changed-behavior evidence with --retry-queued --replacement before publication. Later jobs continue.')
        return False
    if not deployed and not (version and release.archive_path(version).exists()):
        if git(root, 'status', '--porcelain=v1'):
            raise SystemExit('Canonical checkout contains uncommitted work. The queue will not alter it.')
        update(directory, state, status='integrating')
        while state.get('rollbackCommits'):
            # Restore only the queue's own reverted merge; never reset history.
            revert_owned(release, state['rollbackCommits'][-1])
            update(directory, state, rollbackCommits=state['rollbackCommits'][:-1],
                   ownedIntegrations=[*state.get('ownedIntegrations', []), {'commit': git(root, 'rev-parse', 'HEAD'), 'merge': False}])
        ancestor = subprocess.run(['git', 'merge-base', '--is-ancestor', request['commit'], 'HEAD'], cwd=root)
        if ancestor.returncode:
            try:
                release.run(['git', 'merge', '--no-edit', '--no-ff', request['commit']])
            except subprocess.CalledProcessError:
                # This merge began in a clean checkout. Abort only our own
                # conflicted merge; preserve all submitted commits and logs.
                resolved = False
                try:
                    resolved = resolve_validation_merge(release)
                finally:
                    marker = Path(git(root, 'rev-parse', '--git-path', 'MERGE_HEAD'))
                    if not marker.is_absolute():
                        marker = root / marker
                    if not resolved and marker.exists():
                        release.run(['git', 'merge', '--abort'])
                if not resolved:
                    raise
            update(directory, state, ownedIntegrations=[*state.get('ownedIntegrations', []), {'commit': git(root, 'rev-parse', 'HEAD'), 'merge': True}])
        update(directory, state, integratedCommit=git(root, 'rev-parse', 'HEAD'))
        if engine_hash(root) != loaded_engine:
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
        version = version or (source_version if request.get('validation') else release.bump_version(source_version, request['bump']))
        update(directory, state, version=version, status='releasing',
               archive=str(release.archive_path(version)),
               deploymentReceipt=str(release.release_receipt_dir(version) / 'deployment.json'))
        if request.get('validation'):
            proof = Path(request['validation'])
            if release.sha256_file(proof) != request['validationSha256']:
                raise SystemExit('Prepared validation changed after submission.')
            release.publish_prepared(version, proof)
        else:
            release.new_release(None, False, version)
    elif not deployed:
        update(directory, state, status='publishing')
        release.resume_release(version, False)
    # Commit only generated version files. The publisher's immutable provenance
    # still identifies the source commit and exact generated bytes.
    dirty = release.git_state()[1]
    if dirty:
        if any(line[:3] != ' M ' or line[3:] not in VERSION_FILES for line in dirty):
            raise SystemExit('Unexpected canonical edits appeared; release queue stopped.')
        release.run(['git', 'add', *sorted(VERSION_FILES)])
        release.run(['git', 'commit', '-m', f'Release {version}'])
    evidence = release.release_receipt_dir(version) / 'client-check.json'
    if not evidence.exists():
        release.check_client(version)
    update(directory, state, status='verifying-evidence')
    if completed_smoke(release, version):
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
        update(directory, state, status='complete', completedAt=now(), error=None, nextAction=None)
    else:
        update(directory, state, status='awaiting-smoke',
               nextAction=f'Verify only changed behavior for {version}, then use --complete-smoke. '
                          'Publication is verified; other jobs can continue. This release remains incomplete.',
               suppliedBehaviorInputsMatch=matches)
    return False


def isolate_failure(release, directory: Path, state: dict) -> bool:
    """Remove only this job's unshipped integration, retaining commits and logs."""
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
                                update(path, item, status='complete', completedAt=now(), nextAction=None, error=None)
                        directory = next((path for path, item in pending if item['status'] not in FINISHED), None)
                        if directory is None:
                            (queue / 'wake').unlink(missing_ok=True)
                            return {'status': 'idle'}
                        state = read(directory / 'state.json')
                        if state.get('nextRetryAt') and state['nextRetryAt'] > now():
                            (queue / 'wake').unlink(missing_ok=True)
                            schedule_retry(state['nextRetryAt'], queue=queue)
                            return {'status': 'retrying', 'jobId': directory.name, 'nextRetryAt': state['nextRetryAt']}
                        state.pop('nextRetryAt', None)
                        request = read(directory / state.get('requestFile', 'request.json'))
                    with (directory / 'worker.log').open('a', buffering=1) as log, redirect_stdout(log), redirect_stderr(log):
                        print(f'Queue attempt {now()}: {directory.name}', flush=True)
                        try:
                            restart = run_job(release, directory, request, state, loaded_engine)
                            if restart:
                                return {'status': 'worker-restart', 'jobId': directory.name}
                        except (Exception, SystemExit) as error:
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
