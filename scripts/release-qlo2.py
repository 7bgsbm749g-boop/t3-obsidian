#!/usr/bin/env python3
"""Build, test, package, install, and publish an immutable QLO2 release.

The command deliberately stops at ``awaiting-live-smoke``. A release is not
complete until a real Obsidian client has reloaded the plugin, exercised the
changed behavior, and recorded evidence with ``--complete-smoke``.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
from typing import Any
import zipfile
import re
sys.path.insert(0, str(Path(__file__).resolve().parent))
import change_checks
import release_queue
from plugin_id_migration import LEGACY_ID, installed_plugin, needs_migration, migrate_installation


ROOT = Path(__file__).resolve().parent.parent
CANONICAL_ROOT = Path('/home/ubuntu/projects/send-to-t3-code')
DEV_PLUGIN = installed_plugin(Path('/home/ubuntu/Obsidian Vault/.obsidian/plugins'))
QLO2_PLUGIN = installed_plugin(Path('/home/ubuntu/vaults/QLO2/.obsidian/plugins'))
BACKUPS = Path('/home/ubuntu/projects/send-to-t3-code/evidence')
RECEIPTS = BACKUPS / 'releases'
SYNC_SERVICE = 'obsidian-qlo2-sync.service'
OB = Path('/home/ubuntu/.local/bin/ob')
HOST_UNIT = Path('/home/ubuntu/.config/systemd/user/send-to-t3-code-response-host.service')

RUNTIME_FILES = ('main.js', 'manifest.json', 'styles.css')
RELEASE_FILES = ('main.js', 'manifest.json', 'versions.json', 'styles.css', 'README.md', 'LICENSE')
DEV_ALLOWED = {*RUNTIME_FILES, 'data.json'}


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding='utf-8-sig'))


def atomic_write(path: Path, value: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.installing')
    temporary.write_bytes(value)
    os.replace(temporary, path)


def run(command: list[str], *, cwd: Path = ROOT, capture: bool = False, timeout: int = 240) -> subprocess.CompletedProcess[str]:
    print('+', ' '.join(command), flush=True)
    return subprocess.run(
        command,
        cwd=cwd,
        check=True,
        text=True,
        capture_output=capture,
        stdout=None if capture else sys.stdout,
        stderr=None if capture else sys.stderr,
        timeout=timeout,
    )


def parse_version(value: str) -> tuple[int, int, int]:
    pieces = value.split('.')
    if len(pieces) != 3 or any(not piece.isdigit() for piece in pieces):
        raise ValueError(f'Expected a numeric MAJOR.MINOR.PATCH version, got {value!r}.')
    return tuple(int(piece) for piece in pieces)  # type: ignore[return-value]


def bump_version(value: str, part: str) -> str:
    major, minor, patch = parse_version(value)
    if part == 'major':
        return f'{major + 1}.0.0'
    if part == 'minor':
        return f'{major}.{minor + 1}.0'
    if part == 'patch':
        return f'{major}.{minor}.{patch + 1}'
    raise ValueError(f'Unsupported version component: {part}')


def canonical_root_required() -> None:
    if ROOT.resolve() != CANONICAL_ROOT.resolve():
        raise SystemExit(
            f'Releases must run from the canonical checkout {CANONICAL_ROOT}; current root is {ROOT}.'
        )


def source_file(name: str) -> Path:
    return ROOT / 'dist/main.js' if name == 'main.js' else ROOT / name


def source_bytes(name: str) -> bytes:
    path = source_file(name)
    if not path.is_file():
        raise SystemExit(f'Missing release input: {path}')
    return path.read_bytes()


def git_state() -> tuple[str, list[str]]:
    commit = run(['git', 'rev-parse', 'HEAD'], capture=True).stdout.strip()
    lines = run(['git', 'status', '--porcelain=v1'], capture=True).stdout.splitlines()
    return commit, lines


def version_documents() -> dict[Path, bytes]:
    paths = (ROOT / 'package.json', ROOT / 'package-lock.json', ROOT / 'manifest.json', ROOT / 'versions.json')
    return {path: path.read_bytes() for path in paths}


def set_version(version: str) -> None:
    package = read_json(ROOT / 'package.json')
    package_lock = read_json(ROOT / 'package-lock.json')
    manifest = read_json(ROOT / 'manifest.json')
    versions = read_json(ROOT / 'versions.json')

    package['version'] = version
    package_lock['version'] = version
    package_lock['packages']['']['version'] = version
    manifest['version'] = version
    if version in versions:
        raise SystemExit(f'versions.json already contains immutable release {version}.')
    versions[version] = manifest['minAppVersion']

    for path, value in (
        (ROOT / 'package.json', package),
        (ROOT / 'package-lock.json', package_lock),
        (ROOT / 'manifest.json', manifest),
        (ROOT / 'versions.json', versions),
    ):
        atomic_write(path, (json.dumps(value, indent=2) + '\n').encode())


def validate_version_alignment(expected: str) -> None:
    values = {
        read_json(ROOT / 'package.json')['version'],
        read_json(ROOT / 'package-lock.json')['version'],
        read_json(ROOT / 'package-lock.json')['packages']['']['version'],
        read_json(ROOT / 'manifest.json')['version'],
    }
    if values != {expected}:
        raise SystemExit(f'Version files disagree: {sorted(values)}; expected {expected}.')
    if read_json(ROOT / 'versions.json').get(expected) != read_json(ROOT / 'manifest.json')['minAppVersion']:
        raise SystemExit(f'versions.json does not describe {expected}.')


def install_runtime(plugin: Path, *, strict_dev: bool, runtime: dict[str, bytes] | None = None) -> dict[str, str]:
    if strict_dev:
        plugin.mkdir(parents=True, exist_ok=True)
        unexpected = {path.name for path in plugin.iterdir()} - DEV_ALLOWED
        if unexpected:
            raise SystemExit(
                f'Development install contains source or unknown files: {sorted(unexpected)}. '
                'The development vault may contain only runtime artifacts and data.json.'
            )
    elif not plugin.is_dir():
        raise SystemExit(f'Plugin installation is missing: {plugin}')

    data_path = plugin / 'data.json'
    settings = data_path.read_bytes() if data_path.exists() else None
    if settings is not None:
        json.loads(settings.decode('utf-8-sig'))

    hashes: dict[str, str] = {}
    for name in RUNTIME_FILES:
        value = runtime[name] if runtime is not None else source_bytes(name)
        atomic_write(plugin / name, value)
        hashes[name] = sha256_bytes(value)
    if settings is not None and data_path.read_bytes() != settings:
        raise SystemExit(f'{plugin}/data.json changed while installing runtime artifacts.')
    return hashes


def archive_path(version: str) -> Path:
    return ROOT / 'release' / f'send-to-t3-code-{version}.zip'


def create_archive(version: str) -> Path:
    archive = archive_path(version)
    if archive.exists():
        raise SystemExit(f'Release archive is immutable and already exists: {archive}')
    archive.parent.mkdir(parents=True, exist_ok=True)
    temporary = archive.with_suffix('.zip.creating')
    try:
        with zipfile.ZipFile(temporary, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as bundle:
            for name in RELEASE_FILES:
                info = zipfile.ZipInfo(f'send-to-t3-code/{name}', date_time=(2026, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o100664 << 16
                bundle.writestr(info, source_bytes(name))
        validate_archive(temporary, version)
        os.replace(temporary, archive)
    finally:
        if temporary.exists():
            temporary.unlink()
    return archive


def validate_archive(archive: Path, version: str, *, compare_source: bool = True) -> dict[str, str]:
    expected = {f'send-to-t3-code/{name}' for name in RELEASE_FILES}
    hashes: dict[str, str] = {}
    with zipfile.ZipFile(archive) as bundle:
        if set(bundle.namelist()) != expected:
            raise SystemExit(f'{archive} has unexpected contents: {bundle.namelist()}')
        for name in RELEASE_FILES:
            value = bundle.read(f'send-to-t3-code/{name}')
            hashes[name] = sha256_bytes(value)
            if compare_source and value != source_bytes(name):
                raise SystemExit(f'{archive} does not match the current tested {name}.')
        manifest = json.loads(bundle.read('send-to-t3-code/manifest.json'))
        if manifest['version'] != version:
            raise SystemExit(f'{archive} contains version {manifest["version"]}, expected {version}.')
    return hashes


def sync_release() -> list[str]:
    # A fresh vault scan can include a large unrelated upload backlog. Keep
    # requiring Fully synced, but do not abort a healthy scan after four minutes.
    result = run([str(OB), 'sync', '--path', str(QLO2_PLUGIN.parents[2])], capture=True, timeout=1800)
    lines = result.stdout.splitlines()
    if 'Fully synced' not in lines:
        raise SystemExit('Release installed, but a fresh Sync scan did not confirm Fully synced.')
    return [
        line.removeprefix('Upload complete ')
        for line in lines
        if line.startswith(f'Upload complete .obsidian/plugins/{QLO2_PLUGIN.name}/')
    ]


def deploy_qlo2(
    archive: Path,
    version: str,
    archive_hashes: dict[str, str],
    *,
    allow_same_version: bool = False,
) -> dict[str, Any]:
    global QLO2_PLUGIN
    run(['systemctl', '--user', 'is-active', '--quiet', SYNC_SERVICE])
    if not QLO2_PLUGIN.is_dir():
        raise SystemExit(f'QLO2 plugin installation is missing: {QLO2_PLUGIN}')

    installed_version = read_json(QLO2_PLUGIN / 'manifest.json')['version']
    installed_parsed = parse_version(installed_version)
    requested_parsed = parse_version(version)
    if installed_parsed > requested_parsed or (installed_parsed == requested_parsed and not allow_same_version):
        raise SystemExit(
            f'QLO2 already has {installed_version}; new deployments require a strictly newer version than {version}.'
        )

    data_path = QLO2_PLUGIN / 'data.json'
    settings = data_path.read_bytes()
    json.loads(settings.decode('utf-8-sig'))
    timestamp = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%d-%H%M%S')
    backup = BACKUPS / f'before-{version}-{timestamp}'
    if backup.exists():
        raise SystemExit(f'Backup already exists: {backup}')
    backup.mkdir(parents=True)
    for name in (*RELEASE_FILES, 'data.json'):
        source = QLO2_PLUGIN / name
        if source.exists():
            shutil.copy2(source, backup / name)

    run(['systemctl', '--user', 'stop', SYNC_SERVICE])
    try:
        with zipfile.ZipFile(archive) as bundle:
            identifier = json.loads(bundle.read('send-to-t3-code/manifest.json')).get('id')
            activation = migration_activation(version)
            QLO2_PLUGIN = migrate_installation(QLO2_PLUGIN, identifier, backup / 'id-migration',
                                               restore_enabled=activation.get(str(QLO2_PLUGIN), False))
            data_path = QLO2_PLUGIN / 'data.json'
            for name in RELEASE_FILES:
                atomic_write(QLO2_PLUGIN / name, bundle.read(f'send-to-t3-code/{name}'))
        if data_path.read_bytes() != settings:
            raise SystemExit('QLO2 data.json changed during deployment; restore from the backup before retrying.')
        uploaded = sync_release()
    finally:
        run(['systemctl', '--user', 'start', SYNC_SERVICE])

    run(['systemctl', '--user', 'is-active', '--quiet', SYNC_SERVICE])
    installed = read_json(QLO2_PLUGIN / 'manifest.json')
    if installed['version'] != version:
        raise SystemExit(f'QLO2 reports {installed["version"]} after installing {version}.')
    for name in RELEASE_FILES:
        if sha256_file(QLO2_PLUGIN / name) != archive_hashes[name]:
            raise SystemExit(f'QLO2 {name} does not match the immutable archive.')
    if data_path.read_bytes() != settings:
        raise SystemExit('QLO2 data.json did not survive deployment unchanged.')
    return {
        'backup': str(backup),
        'settingsSha256': sha256_bytes(settings),
        'uploadedPluginFiles': uploaded,
    }


def release_receipt_dir(version: str) -> Path:
    return RECEIPTS / version


def install_response_host(version: str, bundle: bytes) -> None:
    """Retire the standalone service; releases cannot install a legacy writer."""
    if b'T3_RESPONSE_HOST_RUNTIME_V1:' in bundle:
        raise SystemExit('Legacy response host runtime is retired; release refused.')
    if HOST_UNIT.exists():
        run(['systemctl', '--user', 'disable', '--now', 'send-to-t3-code-response-host.service'])
    return None



def write_release_receipt(version: str, value: dict[str, Any]) -> Path:
    directory = release_receipt_dir(version)
    receipt = directory / 'deployment.json'
    if directory.exists():
        raise SystemExit(f'Immutable release receipt already exists: {directory}')
    directory.mkdir(parents=True)
    atomic_write(receipt, (json.dumps(value, indent=2) + '\n').encode())
    return receipt


def migration_activation(version: str) -> dict[str, bool]:
    path = BACKUPS / f'id-migration-{version}-activation.json'
    return read_json(path) if path.is_file() else {}


def publish_release(
    version: str,
    archive: Path,
    commit: str,
    dirty: list[str],
    *,
    resumed: bool,
    skip_laptop_reload: bool = False,
) -> None:
    global DEV_PLUGIN
    archive_hashes = validate_archive(archive, version, compare_source=not resumed)
    with zipfile.ZipFile(archive) as bundle:
        runtime = {name: bundle.read(f'send-to-t3-code/{name}') for name in RUNTIME_FILES}
    identifier = json.loads(runtime['manifest.json']).get('id')
    if any(needs_migration(plugin, identifier) for plugin in (DEV_PLUGIN, QLO2_PLUGIN)):
        activation_path = BACKUPS / f'id-migration-{version}-activation.json'
        if not activation_path.exists():
            activation = {}
            for plugin in (DEV_PLUGIN, QLO2_PLUGIN):
                enabled = plugin.parent.parent / 'community-plugins.json'
                activation[str(plugin)] = enabled.is_file() and LEGACY_ID in read_json(enabled)
            activation_path.parent.mkdir(parents=True, exist_ok=True)
            with activation_path.open('xb') as output:
                output.write((json.dumps(activation, indent=2) + '\n').encode())
    # A running legacy instance can recreate/write its old data path after a
    # directory move. Hold the queue slot until the owner has disabled it.
    for plugin in (DEV_PLUGIN, QLO2_PLUGIN):
        if needs_migration(plugin, identifier):
            enabled = plugin.parent.parent / 'community-plugins.json'
            if plugin == QLO2_PLUGIN and enabled.exists() and plugin.name in read_json(enabled):
                raise SystemExit(f'Plugin ID migration: disable T3 Code in {plugin.parents[2]} while this queue slot is held, then retry this job. Re-enable T3 Code after installation before completing smoke.')
            try:
                client_command('client-status', vault=plugin.parents[2])
            except (subprocess.SubprocessError, OSError, ValueError, SystemExit):
                pass
            else:
                raise SystemExit(f'Plugin ID migration: disable T3 Code in {plugin.parents[2]} while this queue slot is held, then retry this job. Re-enable T3 Code after installation before completing smoke.')
    DEV_PLUGIN = migrate_installation(DEV_PLUGIN, identifier, BACKUPS / f'id-migration-{version}-development',
                                     restore_enabled=migration_activation(version).get(str(DEV_PLUGIN), False))
    dev_hashes = install_runtime(DEV_PLUGIN, strict_dev=True, runtime=runtime)
    deployment = deploy_qlo2(
        archive,
        version,
        archive_hashes,
        allow_same_version=resumed,
    )
    background_host = install_response_host(version, runtime['main.js'])
    receipt = {
        'version': version,
        'status': 'awaiting-live-smoke',
        'createdAt': utc_now(),
        'sourceRoot': str(ROOT),
        'gitCommit': commit,
        'dirtySourceAuthorized': bool(dirty),
        'dirtySourceEntries': dirty,
        'resumedImmutableArchive': resumed,
        'archive': str(archive),
        'archiveSha256': sha256_file(archive),
        'testSuite': read_json(archive.with_suffix('.provenance.json')).get('testSuite', {'status': 'unknown'}) if archive.with_suffix('.provenance.json').is_file() else {'status': 'unknown'},
        'releaseFileSha256': archive_hashes,
        'developmentInstall': str(DEV_PLUGIN),
        'developmentRuntimeSha256': dev_hashes,
        'qlo2Install': str(QLO2_PLUGIN),
        **deployment,
        **({'backgroundResponseHost': background_host} if background_host else {}),
        'nextAction': (
            'Publication runs the native QLO2 reload check; retry --check-client if client-check.json is absent. '
            'Reuse changed-behavior evidence for this exact candidate, then run '
            f'npm run release:qlo2 -- --complete-smoke {version} --device <device> --evidence <path> --notes <text>'
        ),
    }
    receipt_path = write_release_receipt(version, receipt)
    print(json.dumps({**receipt, 'receipt': str(receipt_path)}, indent=2))
    # The existing laptop timer owns retries. Do not wait for SSH/offline devices.
    if skip_laptop_reload:
        print('Laptop reload omitted by explicit release option.')
    else:
        try:
            run(['systemctl', '--user', 'start', '--no-block', 'send-to-t3-native-laptop-reload.service'], timeout=10)
        except (subprocess.SubprocessError, OSError):
            print('Laptop reload deferred; configure the existing laptop reload timer.', file=sys.stderr)
    try:
        check_client(version)
    except (subprocess.SubprocessError, OSError, ValueError, SystemExit) as error:
        print(f'QLO2 client verification pending: {error}. Retry with --check-client {version}.', file=sys.stderr)


def client_command(*arguments: str, vault: Path | None = None) -> dict:
    result = run([sys.executable, str(ROOT / 'scripts/obsidian-command.py'), '--vault',
                  str(vault or QLO2_PLUGIN.parents[2]), '--timeout', '5', *arguments], capture=True, timeout=8)
    value = json.loads(result.stdout)
    if not value.get('ok'):
        raise SystemExit('The real QLO2 client did not acknowledge the command.')
    return value


def check_client(version: str) -> Path:
    """Record real native reload proof; changed behavior still needs its own smoke."""
    canonical_root_required()
    directory = release_receipt_dir(version)
    deployment = read_json(directory / 'deployment.json')
    for name, checksum in deployment['releaseFileSha256'].items():
        if sha256_file(QLO2_PLUGIN / name) != checksum:
            raise SystemExit(f'QLO2 {name} no longer matches release {version}.')
    evidence = directory / 'client-check.json'
    if evidence.exists():
        print(f'Existing immutable client check: {evidence}')
        return evidence
    before = client_command('client-status')
    if before.get('connectionRecovery', {}).get('pending') or before.get('connectionRecovery', {}).get('reloading'):
        raise SystemExit('QLO2 is recovering a connection; retry the client check when it is idle.')
    settings = {str(plugin): sha256_file(plugin / 'data.json') for plugin in (DEV_PLUGIN, QLO2_PLUGIN)}
    runtime = {name: deployment['releaseFileSha256'][name] for name in RUNTIME_FILES}
    acknowledgement = client_command('reload-client', '--release-version', version, '--runtime-hashes', json.dumps(runtime))
    if not acknowledgement.get('reloadScheduled'):
        raise SystemExit('QLO2 did not schedule its native reload.')
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        time.sleep(0.5)
        try:
            after = client_command('client-status')
        except (subprocess.SubprocessError, ValueError):
            continue
        if after['client']['loadedVersion'] == version and after['client']['instanceId'] != before['client']['instanceId']:
            break
    else:
        raise SystemExit('No new QLO2 client instance loaded the release within 45 seconds.')
    if settings != {str(plugin): sha256_file(plugin / 'data.json') for plugin in (DEV_PLUGIN, QLO2_PLUGIN)}:
        raise SystemExit('Plugin settings changed during the client check; inspect before completing smoke.')
    if any(sha256_file(QLO2_PLUGIN / name) != checksum for name, checksum in deployment['releaseFileSha256'].items()):
        raise SystemExit('QLO2 release bytes changed during the client check.')
    value = {'version': version, 'verifiedAt': utc_now(), 'device': 'vps-qlo2',
             'nativeReloadCommand': 'app:reload', 'before': before, 'acknowledgement': acknowledgement,
             'after': after, 'settingsSha256': settings, 'runtimeSha256': runtime,
             'testNotesCreated': [], 'testThreadsCreated': [],
             'scope': 'Real QLO2 reload and loaded version. Changed behavior requires separate evidence.'}
    with evidence.open('xb') as output:
        output.write((json.dumps(value, indent=2) + '\n').encode())
    print(f'Real QLO2 client verified: {evidence}')
    return evidence


def complete_smoke(version: str, device: str, evidence: Path, notes: str) -> None:
    canonical_root_required()
    directory = release_receipt_dir(version)
    deployment_path = directory / 'deployment.json'
    if not deployment_path.is_file():
        raise SystemExit(f'No deployment receipt exists for {version}.')
    deployment = read_json(deployment_path)
    if deployment['version'] != version or deployment['status'] != 'awaiting-live-smoke':
        raise SystemExit(f'{version} is not awaiting a live smoke test.')
    if read_json(QLO2_PLUGIN / 'manifest.json')['version'] != version:
        raise SystemExit(f'QLO2 is not currently installed at {version}.')
    expected = deployment.get('releaseFileSha256', {})
    background = deployment.get('backgroundResponseHost')
    if background and sha256_file(Path(background['runtime'])) != background['runtimeSha256']:
        raise SystemExit('The background response host does not match its immutable release.')
    for name in RELEASE_FILES:
        if name not in expected or not (QLO2_PLUGIN / name).is_file() or sha256_file(QLO2_PLUGIN / name) != expected[name]:
            raise SystemExit(f'QLO2 {name} does not match the immutable deployment; smoke completion refused.')
    for name in RUNTIME_FILES:
        if not (DEV_PLUGIN / name).is_file() or sha256_file(DEV_PLUGIN / name) != expected[name]:
            raise SystemExit(f'Development {name} does not match the immutable deployment; smoke completion refused.')
    if not evidence.is_file():
        raise SystemExit(f'Smoke evidence does not exist: {evidence}')
    smoke = directory / f'smoke-{device}.json'
    if smoke.exists():
        raise SystemExit(f'Immutable smoke receipt already exists: {smoke}')
    evidence_copy = directory / f'smoke-{device}-evidence{evidence.suffix.lower()}'
    if evidence_copy.exists():
        raise SystemExit(f'Smoke evidence destination already exists: {evidence_copy}')
    shutil.copy2(evidence, evidence_copy)
    receipt = {
        'version': version,
        'status': 'complete',
        'device': device,
        'completedAt': utc_now(),
        'installedMainSha256': sha256_file(QLO2_PLUGIN / 'main.js'),
        'evidence': str(evidence_copy),
        'evidenceSha256': sha256_file(evidence_copy),
        'notes': notes,
    }
    atomic_write(smoke, (json.dumps(receipt, indent=2) + '\n').encode())
    print(json.dumps(receipt, indent=2))


def release_checks(skip_tests_reason: str | None = None, *, base: str | None = None) -> dict:
    if skip_tests_reason is not None and not skip_tests_reason.strip():
        raise SystemExit('--skip-tests-reason requires the explicit user instruction.')
    if skip_tests_reason is not None:
        run(['npm', 'run', 'build'])
        return {'status': 'skipped', 'reason': skip_tests_reason.strip()}
    installed_base = change_checks.default_base(ROOT)
    if base is not None and change_checks.git(ROOT, 'rev-parse', base + '^{commit}').decode().strip() != installed_base:
        raise SystemExit('Release checks must compare against the installed release source.')
    proof = change_checks.run_validation(ROOT, base=installed_base, require_build=True)
    return {**read_json(proof)['testSuite'], 'validation': str(proof), 'validationSha256': sha256_file(proof)}


def prepare_release(bump: str | None, requested_version: str | None, *, base: str | None = None) -> Path:
    """Prepare final version bytes in the task worktree; never install or package."""
    current = read_json(ROOT / 'manifest.json')['version']
    version = requested_version or bump_version(current, bump)
    if parse_version(version) < parse_version(current):
        raise SystemExit('The prepared version cannot be older than the source version.')
    if parse_version(version) <= parse_version(read_json(QLO2_PLUGIN / 'manifest.json')['version']):
        raise SystemExit('Prepare a version strictly newer than QLO2.')
    originals = version_documents()
    try:
        if version != current:
            set_version(version)
        validate_version_alignment(version)
        suite = release_checks(base=base)
        proof = Path(suite['validation'])
    except BaseException:
        for path, value in originals.items():
            atomic_write(path, value)
        raise
    print('Commit these reviewed bytes, then submit from this task worktree:\n'
          f'npm run release:qlo2 -- --enqueue HEAD --validation {proof}')
    return proof


def publish_prepared(version: str, proof: Path, *, skip_laptop_reload: bool = False) -> None:
    canonical_root_required()
    commit, dirty = git_state()
    if dirty:
        raise SystemExit('Commit and integrate the prepared candidate before publishing.')
    validate_version_alignment(version)
    if parse_version(version) <= parse_version(read_json(QLO2_PLUGIN / 'manifest.json')['version']):
        raise SystemExit('The prepared release must be strictly newer than QLO2.')
    if release_receipt_dir(version).exists() or archive_path(version).exists():
        raise SystemExit(f'Immutable release {version} already exists; retry its queue job to resume publication.')
    validation = change_checks.verify_validation(proof, ROOT, require_build=True)
    # Check the installed-release baseline has not moved since preparation.
    if validation['testSuite']['baseCommit'] != change_checks.default_base(ROOT):
        raise SystemExit('The installed release changed after preparation. Prepare against its source again.')
    (ROOT / 'dist').mkdir(exist_ok=True)
    atomic_write(ROOT / 'dist/main.js', Path(validation['bundle']).read_bytes())
    archive = create_archive(version)
    versions = {str(path.relative_to(ROOT)): sha256_file(path) for path in version_documents()}
    suite = {**validation['testSuite'], 'validation': str(proof), 'validationSha256': sha256_file(proof), 'reusedPreparedValidation': True}
    provenance = {'version': version, 'gitCommit': commit, 'archiveSha256': sha256_file(archive),
                  'versionFileSha256': versions, 'originalVersionFileSha256': versions,
                  'dirtySourceAuthorized': False, 'testSuite': suite}
    with archive.with_suffix('.provenance.json').open('xb') as output:
        output.write((json.dumps(provenance, indent=2) + '\n').encode())
    publish_release(version, archive, commit, [], resumed=False, skip_laptop_reload=skip_laptop_reload)


def new_release(bump: str | None, allow_dirty: bool, requested_version: str | None = None, *, skip_laptop_reload: bool = False, skip_tests_reason: str | None = None, base: str | None = None) -> None:
    canonical_root_required()
    commit, dirty = git_state()
    if dirty and not allow_dirty:
        raise SystemExit(
            'The worktree is dirty. Commit/stash it, or use --allow-dirty only when the user explicitly '
            'authorized deploying the reviewed dirty worktree.'
        )
    current = read_json(ROOT / 'manifest.json')['version']
    version = requested_version or bump_version(current, bump)
    if parse_version(version) <= parse_version(current):
        raise SystemExit('The requested release must be strictly newer than the source version.')
    if (QLO2_PLUGIN / 'manifest.json').exists() and parse_version(version) <= parse_version(read_json(QLO2_PLUGIN / 'manifest.json')['version']):
        raise SystemExit('The requested release must be strictly newer than the QLO2 installation.')
    if release_receipt_dir(version).exists() or archive_path(version).exists():
        raise SystemExit(f'Immutable release {version} already exists; choose a newer version.')

    originals = version_documents()
    archive: Path | None = None
    try:
        set_version(version)
        validate_version_alignment(version)
        test_suite = release_checks(skip_tests_reason, base=base)
        archive = create_archive(version)
        provenance = {
            'version': version, 'gitCommit': commit,
            'archiveSha256': sha256_file(archive),
            'versionFileSha256': {str(path.relative_to(ROOT)): sha256_file(path) for path in originals},
            'originalVersionFileSha256': {str(path.relative_to(ROOT)): sha256_bytes(value) for path, value in originals.items()},
            'dirtySourceAuthorized': bool(dirty),
            'testSuite': test_suite,
        }
        provenance_path = archive.with_suffix('.provenance.json')
        with provenance_path.open('xb') as stream:
            stream.write((json.dumps(provenance, indent=2) + '\n').encode())
    except BaseException:
        if archive is None:
            for path, value in originals.items():
                atomic_write(path, value)
        raise

    publish_release(version, archive, commit, dirty, resumed=False, skip_laptop_reload=skip_laptop_reload)


def resume_release(version: str, allow_dirty: bool, *, skip_laptop_reload: bool = False) -> None:
    canonical_root_required()
    commit, dirty = git_state()
    archive = archive_path(version)
    if not archive.is_file():
        raise SystemExit(f'Cannot resume; immutable archive is missing: {archive}')
    provenance_path = archive.with_suffix('.provenance.json')
    if provenance_path.is_file():
        provenance = read_json(provenance_path)
        if provenance['version'] != version or provenance['gitCommit'] != commit or provenance['archiveSha256'] != sha256_file(archive):
            raise SystemExit('Resume provenance or source commit does not match the immutable release.')
        expected = provenance['versionFileSha256']
        if any(sha256_file(ROOT / name) != checksum for name, checksum in expected.items()):
            raise SystemExit('Release-generated version bytes changed; resume refused.')
        if not allow_dirty and (provenance['dirtySourceAuthorized'] or any(line[:3] != ' M ' or line[3:] not in expected for line in dirty)):
            raise SystemExit('Unrelated worktree changes prevent immutable resume.')
        # Verify that these are exactly the original committed version inputs.
        for name, checksum in provenance['originalVersionFileSha256'].items():
            committed = subprocess.run(['git', 'show', f'{commit}:{name}'], cwd=ROOT, check=True, capture_output=True).stdout
            if sha256_bytes(committed) != checksum and not allow_dirty:
                raise SystemExit('Original version inputs did not match the reviewed commit.')
    else:
        if dirty and not allow_dirty:
            raise SystemExit('Legacy archive has no provenance. Commit reviewed version changes before resuming.')
        validate_archive(archive, version)
    validate_version_alignment(version)
    if release_receipt_dir(version).exists():
        raise SystemExit(f'Release {version} already has an immutable deployment receipt.')
    publish_release(version, archive, commit, dirty, resumed=True, skip_laptop_reload=skip_laptop_reload)


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    action = result.add_mutually_exclusive_group(required=True)
    action.add_argument('--bump', choices=('patch', 'minor', 'major'))
    action.add_argument('--version', metavar='VERSION', help='Create a strictly newer exact version.')
    action.add_argument('--resume', metavar='VERSION')
    action.add_argument('--complete-smoke', metavar='VERSION')
    action.add_argument('--publish', metavar='VERSION', help='Publish exact prepared bytes without repeating checks.')
    action.add_argument('--check-client', metavar='VERSION', help='Retry the real QLO2 reload/loaded-version check.')
    action.add_argument('--enqueue', metavar='COMMIT', help='Submit reviewed committed work to the FIFO publisher.')
    action.add_argument('--queue-status', nargs='?', const='all', metavar='JOB_ID', help='Read queue state without contacting other threads.')
    action.add_argument('--drain-queue', action='store_true', help='Run the single queue worker in the canonical checkout.')
    action.add_argument('--install-queue', action='store_true', help='Install the event-driven local queue worker once.')
    action.add_argument('--retry-queued', metavar='JOB_ID', help='Retry the same blocked job and immutable release.')
    result.add_argument('--prepare', action='store_true', help='With --bump/--version: prepare and check a task-worktree candidate without deployment.')
    result.add_argument('--validation', type=Path, help='Exact successful validation proof for --publish.')
    result.add_argument('--base', help='Affected-test baseline; default: installed release source.')
    result.add_argument('--replacement', metavar='COMMIT', help='With --retry-queued: replace an uninstalled failed candidate with a corrected reviewed commit.')
    result.add_argument('--allow-dirty', action='store_true')
    result.add_argument('--skip-laptop-reload', action='store_true', help='Publish on the VPS without contacting the laptop reload helper.')
    result.add_argument('--skip-tests-reason', help='Skip affected tests only at explicit user request; record that instruction in immutable provenance and the deployment receipt.')
    result.add_argument('--device')
    result.add_argument('--evidence', type=Path)
    result.add_argument('--notes', default='')
    return result


def dispatch(args: argparse.Namespace) -> None:
    if args.replacement and not args.retry_queued:
        raise SystemExit('--replacement is valid only with --retry-queued.')
    if args.enqueue:
        if args.prepare or args.allow_dirty or args.skip_tests_reason or args.skip_laptop_reload or args.base or args.device:
            raise SystemExit('--enqueue accepts a commit, optional --validation, and optional --evidence/--notes.')
        if bool(args.evidence) != bool(args.notes):
            raise SystemExit('Supply --evidence and --notes together, or verify changed behavior when the job owns its release slot.')
        if git_state()[1]:
            raise SystemExit('Commit the reviewed task changes before enqueueing; uncommitted edits are not submitted.')
        result = release_queue.enqueue(ROOT, CANONICAL_ROOT, args.enqueue,
                                       validation=args.validation.resolve() if args.validation else None,
                                       evidence=args.evidence.resolve() if args.evidence else None, notes=args.notes)
        print(json.dumps(result, indent=2))
        release_queue.kick()
        return
    if args.queue_status or args.install_queue or args.drain_queue or args.retry_queued:
        if args.prepare or args.allow_dirty or args.skip_tests_reason or args.skip_laptop_reload or args.base or args.device:
            raise SystemExit('Queue management accepts only its action and job ID.')
        if (args.validation or args.evidence or args.notes) and not (args.retry_queued and args.replacement):
            raise SystemExit('Replacement evidence is valid only with --retry-queued and --replacement.')
        if args.queue_status:
            print(json.dumps(release_queue.status(None if args.queue_status == 'all' else args.queue_status), indent=2))
        elif args.install_queue:
            canonical_root_required()
            release_queue.install(CANONICAL_ROOT)
        elif args.retry_queued:
            replacement = None
            if args.replacement:
                if git_state()[1] or bool(args.evidence) != bool(args.notes):
                    raise SystemExit('Commit replacement source first; supply evidence and notes together.')
                replacement = release_queue.submission(ROOT, CANONICAL_ROOT, args.replacement,
                    validation=args.validation.resolve() if args.validation else None,
                    evidence=args.evidence.resolve() if args.evidence else None, notes=args.notes)
            print(json.dumps(release_queue.retry(args.retry_queued, replacement=replacement), indent=2))
            release_queue.kick()
        else:
            print(json.dumps(release_queue.drain(sys.modules[__name__]), indent=2))
        return
    if (not args.prepare and (args.bump or args.version or args.publish or args.resume)
            and (Path.home() / '.config/systemd/user' / (release_queue.UNIT + '.service')).is_file()):
        raise SystemExit('The release queue owns publication. Submit reviewed work with --enqueue COMMIT; '
                         'retry an interrupted job with --retry-queued JOB_ID.')
    if args.prepare:
        if not (args.bump or args.version) or args.allow_dirty or args.skip_tests_reason or args.skip_laptop_reload or args.validation or args.device or args.evidence or args.notes:
            raise SystemExit('--prepare requires --bump/--version and cannot authorize deployment or skip checks.')
        prepare_release(args.bump, args.version, base=args.base)
        return
    if args.publish:
        if not args.validation or args.allow_dirty or args.skip_tests_reason or args.base or args.device or args.evidence or args.notes:
            raise SystemExit('--publish requires only VERSION and --validation PATH.')
        publish_prepared(args.publish, args.validation.resolve(), skip_laptop_reload=args.skip_laptop_reload)
        return
    if args.validation:
        raise SystemExit('--validation is valid only with --publish.')
    if args.check_client:
        if args.allow_dirty or args.skip_tests_reason or args.skip_laptop_reload or args.base or args.device or args.evidence or args.notes:
            raise SystemExit('--check-client accepts only its version.')
        check_client(args.check_client)
        return
    if args.base and (args.complete_smoke or args.resume):
        raise SystemExit('--base is valid only for a new candidate.')
    if args.skip_tests_reason is not None and (args.complete_smoke or args.resume):
        raise SystemExit('--skip-tests-reason is valid only when creating a new release.')
    if args.complete_smoke:
        if args.allow_dirty:
            raise SystemExit('--allow-dirty is valid only with --bump.')
        if not args.device or not args.evidence or not args.notes:
            raise SystemExit('--complete-smoke requires --device, --evidence, and --notes.')
        complete_smoke(args.complete_smoke, args.device, args.evidence.resolve(), args.notes)
        if (release_queue.QUEUE / 'jobs').exists():
            release_queue.kick()
        return
    if args.device or args.evidence or args.notes:
        raise SystemExit('--device, --evidence, and --notes are valid only with --complete-smoke.')
    if args.resume:
        resume_release(args.resume, args.allow_dirty, skip_laptop_reload=args.skip_laptop_reload)
        return
    new_release(args.bump, args.allow_dirty, args.version, skip_laptop_reload=args.skip_laptop_reload, skip_tests_reason=args.skip_tests_reason, base=args.base)


def main() -> None:
    args = parser().parse_args()
    if args.prepare or args.enqueue or args.queue_status or args.install_queue or args.drain_queue or args.retry_queued:
        dispatch(args)
    else:
        with change_checks.lock(BACKUPS / 'release.lock'):
            dispatch(args)


if __name__ == '__main__':
    try:
        main()
    except subprocess.CalledProcessError as error:
        raise SystemExit(error.returncode) from error
