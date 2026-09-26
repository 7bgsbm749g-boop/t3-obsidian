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
from typing import Any
import zipfile


ROOT = Path(__file__).resolve().parent.parent
CANONICAL_ROOT = Path('/home/ubuntu/projects/send-to-t3-code')
DEV_PLUGIN = Path('/home/ubuntu/Obsidian Vault/.obsidian/plugins/send-to-t3-code')
QLO2_PLUGIN = Path('/home/ubuntu/vaults/QLO2/.obsidian/plugins/send-to-t3-code')
BACKUPS = Path('/home/ubuntu/backups/send-to-t3-code')
RECEIPTS = BACKUPS / 'releases'
SYNC_SERVICE = 'obsidian-qlo2-sync.service'
OB = Path('/home/ubuntu/.local/bin/ob')

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


def run(command: list[str], *, cwd: Path = ROOT, capture: bool = False) -> subprocess.CompletedProcess[str]:
    print('+', ' '.join(command), flush=True)
    return subprocess.run(
        command,
        cwd=cwd,
        check=True,
        text=True,
        capture_output=capture,
        timeout=240,
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


def install_runtime(plugin: Path, *, strict_dev: bool) -> dict[str, str]:
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
        value = source_bytes(name)
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


def validate_archive(archive: Path, version: str) -> dict[str, str]:
    expected = {f'send-to-t3-code/{name}' for name in RELEASE_FILES}
    hashes: dict[str, str] = {}
    with zipfile.ZipFile(archive) as bundle:
        if set(bundle.namelist()) != expected:
            raise SystemExit(f'{archive} has unexpected contents: {bundle.namelist()}')
        for name in RELEASE_FILES:
            value = bundle.read(f'send-to-t3-code/{name}')
            hashes[name] = sha256_bytes(value)
            if value != source_bytes(name):
                raise SystemExit(f'{archive} does not match the current tested {name}.')
        manifest = json.loads(bundle.read('send-to-t3-code/manifest.json'))
        if manifest['version'] != version:
            raise SystemExit(f'{archive} contains version {manifest["version"]}, expected {version}.')
    return hashes


def sync_release() -> list[str]:
    result = run([str(OB), 'sync', '--path', str(QLO2_PLUGIN.parents[2])], capture=True)
    lines = result.stdout.splitlines()
    if 'Fully synced' not in lines:
        raise SystemExit('Release installed, but a fresh Sync scan did not confirm Fully synced.')
    return [
        line.removeprefix('Upload complete ')
        for line in lines
        if line.startswith('Upload complete .obsidian/plugins/send-to-t3-code/')
    ]


def deploy_qlo2(
    archive: Path,
    version: str,
    archive_hashes: dict[str, str],
    *,
    allow_same_version: bool = False,
) -> dict[str, Any]:
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


def write_release_receipt(version: str, value: dict[str, Any]) -> Path:
    directory = release_receipt_dir(version)
    receipt = directory / 'deployment.json'
    if directory.exists():
        raise SystemExit(f'Immutable release receipt already exists: {directory}')
    directory.mkdir(parents=True)
    atomic_write(receipt, (json.dumps(value, indent=2) + '\n').encode())
    return receipt


def publish_release(
    version: str,
    archive: Path,
    commit: str,
    dirty: list[str],
    *,
    resumed: bool,
) -> None:
    archive_hashes = validate_archive(archive, version)
    dev_hashes = install_runtime(DEV_PLUGIN, strict_dev=True)
    deployment = deploy_qlo2(
        archive,
        version,
        archive_hashes,
        allow_same_version=resumed,
    )
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
        'releaseFileSha256': archive_hashes,
        'developmentInstall': str(DEV_PLUGIN),
        'developmentRuntimeSha256': dev_hashes,
        'qlo2Install': str(QLO2_PLUGIN),
        **deployment,
        'nextAction': (
            'Reload a real QLO2 Obsidian client, smoke-test the changed behavior, capture evidence, then run '
            f'npm run release:qlo2 -- --complete-smoke {version} --device <device> --evidence <path> --notes <text>'
        ),
    }
    receipt_path = write_release_receipt(version, receipt)
    print(json.dumps({**receipt, 'receipt': str(receipt_path)}, indent=2))


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
    if not evidence.is_file():
        raise SystemExit(f'Smoke evidence does not exist: {evidence}')
    smoke = directory / f'smoke-{device}.json'
    if smoke.exists():
        raise SystemExit(f'Immutable smoke receipt already exists: {smoke}')
    evidence_copy = directory / f'smoke-{device}{evidence.suffix.lower()}'
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


def new_release(bump: str, allow_dirty: bool) -> None:
    canonical_root_required()
    commit, dirty = git_state()
    if dirty and not allow_dirty:
        raise SystemExit(
            'The worktree is dirty. Commit/stash it, or use --allow-dirty only when the user explicitly '
            'authorized deploying the reviewed dirty worktree.'
        )
    current = read_json(ROOT / 'manifest.json')['version']
    version = bump_version(current, bump)
    if release_receipt_dir(version).exists() or archive_path(version).exists():
        raise SystemExit(f'Immutable release {version} already exists; choose a newer version.')

    originals = version_documents()
    archive: Path | None = None
    try:
        set_version(version)
        validate_version_alignment(version)
        run(['npm', 'run', 'build'])
        run(['npm', 'test'])
        archive = create_archive(version)
    except BaseException:
        if archive is None:
            for path, value in originals.items():
                atomic_write(path, value)
        raise

    publish_release(version, archive, commit, dirty, resumed=False)


def resume_release(version: str, allow_dirty: bool) -> None:
    canonical_root_required()
    commit, dirty = git_state()
    if dirty and not allow_dirty:
        raise SystemExit(
            'The worktree is dirty. A resume may use --allow-dirty only when the current source was reviewed '
            'and still matches the immutable archive.'
        )
    validate_version_alignment(version)
    archive = archive_path(version)
    if not archive.is_file():
        raise SystemExit(f'Cannot resume; immutable archive is missing: {archive}')
    if release_receipt_dir(version).exists():
        raise SystemExit(f'Release {version} already has an immutable deployment receipt.')
    publish_release(version, archive, commit, dirty, resumed=True)


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    action = result.add_mutually_exclusive_group(required=True)
    action.add_argument('--bump', choices=('patch', 'minor', 'major'))
    action.add_argument('--resume', metavar='VERSION')
    action.add_argument('--complete-smoke', metavar='VERSION')
    result.add_argument('--allow-dirty', action='store_true')
    result.add_argument('--device')
    result.add_argument('--evidence', type=Path)
    result.add_argument('--notes', default='')
    return result


def main() -> None:
    args = parser().parse_args()
    if args.complete_smoke:
        if args.allow_dirty:
            raise SystemExit('--allow-dirty is valid only with --bump.')
        if not args.device or not args.evidence or not args.notes:
            raise SystemExit('--complete-smoke requires --device, --evidence, and --notes.')
        complete_smoke(args.complete_smoke, args.device, args.evidence.resolve(), args.notes)
        return
    if args.device or args.evidence or args.notes:
        raise SystemExit('--device, --evidence, and --notes are valid only with --complete-smoke.')
    if args.resume:
        resume_release(args.resume, args.allow_dirty)
        return
    new_release(args.bump, args.allow_dirty)


if __name__ == '__main__':
    try:
        main()
    except subprocess.CalledProcessError as error:
        raise SystemExit(error.returncode) from error
