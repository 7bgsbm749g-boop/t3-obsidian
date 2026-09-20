#!/usr/bin/env python3
"""Deploy the tested release into the VPS QLO2 vault used by Obsidian Headless Sync.

The sync service publishes these files to QLO2's other devices. Plugin settings
are preserved, and backups live outside the synced vault.
"""
import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parent.parent
PLUGIN = Path('/home/ubuntu/vaults/QLO2/.obsidian/plugins/send-to-t3-code')
BACKUPS = Path('/home/ubuntu/backups/send-to-t3-code')
ALLOWED = {'main.js', 'manifest.json', 'versions.json', 'styles.css', 'README.md', 'LICENSE'}
SYNC_SERVICE = 'obsidian-qlo2-sync.service'
OB = Path('/home/ubuntu/.local/bin/ob')


def sync_release():
    """A fresh process scans .obsidian even when the continuous watcher missed it."""
    try:
        result = subprocess.run(
            [str(OB), 'sync', '--path', str(PLUGIN.parents[2])],
            check=True, capture_output=True, text=True, timeout=120,
        )
    except subprocess.CalledProcessError as error:
        raise SystemExit(f'Release installed, but Sync failed: {error.stderr or error.stdout}') from error
    except subprocess.TimeoutExpired as error:
        raise SystemExit('Release installed, but Sync did not finish within 120 seconds.') from error
    if 'Fully synced' not in result.stdout.splitlines():
        raise SystemExit('Release installed, but the fresh Sync scan did not confirm completion.')
    return [line.removeprefix('Upload complete ') for line in result.stdout.splitlines()
            if line.startswith('Upload complete .obsidian/plugins/send-to-t3-code/')]


def main():
    version = json.loads((ROOT / 'manifest.json').read_text())['version']
    archive = ROOT / f'release/send-to-t3-code-{version}.zip'
    if not archive.is_file():
        raise SystemExit(f'Missing release archive: {archive}. Build and package {version} first.')
    if not PLUGIN.is_dir():
        raise SystemExit(f'QLO2 plugin directory is missing: {PLUGIN}')
    subprocess.run(['systemctl', '--user', 'is-active', '--quiet', SYNC_SERVICE], check=True, timeout=30)

    data_path = PLUGIN / 'data.json'
    settings = data_path.read_bytes()
    json.loads(settings.decode('utf-8-sig'))
    backup = BACKUPS / ('before-' + version + '-' + datetime.datetime.now().strftime('%Y%m%d-%H%M%S'))
    backup.mkdir(parents=True)
    for name in [*sorted(ALLOWED), 'data.json']:
        source = PLUGIN / name
        if source.exists():
            shutil.copy2(source, backup / name)

    with zipfile.ZipFile(archive) as bundle:
        expected = {f'send-to-t3-code/{name}' for name in ALLOWED}
        if set(bundle.namelist()) != expected:
            raise SystemExit('Release archive has unexpected contents.')
        # Keep continuous Sync from seeing a partly installed release. Its
        # generic "Fully synced" heartbeat does not prove it scanned .obsidian.
        subprocess.run(['systemctl', '--user', 'stop', SYNC_SERVICE], check=True, timeout=30)
        try:
            for name in ALLOWED:
                destination = PLUGIN / name
                temporary = destination.with_suffix(destination.suffix + '.installing')
                temporary.write_bytes(bundle.read(f'send-to-t3-code/{name}'))
                os.replace(temporary, destination)

            if data_path.read_bytes() != settings:
                raise SystemExit('Settings changed during deployment; review the backup before retrying.')
            uploaded = sync_release()
        finally:
            subprocess.run(['systemctl', '--user', 'start', SYNC_SERVICE], check=True, timeout=30)
    installed = json.loads((PLUGIN / 'manifest.json').read_text())
    result = {
        'vault': str(PLUGIN.parents[2]),
        'version': installed['version'],
        'mobileEnabled': not installed['isDesktopOnly'],
        'mainSha256': hashlib.sha256((PLUGIN / 'main.js').read_bytes()).hexdigest(),
        'archiveSha256': hashlib.sha256(archive.read_bytes()).hexdigest(),
        'settingsPreserved': True,
        'syncCompleted': True,
        'uploadedPluginFiles': uploaded,
        'backup': str(backup),
    }
    print(json.dumps(result))


if __name__ == '__main__':
    main()
