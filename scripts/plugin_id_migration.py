"""One-time, offline installation migration to the directory's letters-only ID."""
from pathlib import Path
import json
import os
import shutil
import hashlib

PLUGIN_ID = 't-three-code'
LEGACY_ID = 'send-to-t3-code'


def legacy_settings_remnant(plugins: Path) -> bool:
    """A stale client/Sync may recreate data.json after the runtime ID moved."""
    current, legacy = plugins / PLUGIN_ID, plugins / LEGACY_ID
    if any(path.is_symlink() or not path.is_dir() for path in (current, legacy)):
        return False
    manifest = current / 'manifest.json'
    if any(path.is_symlink() or not path.is_file() for path in (manifest, current / 'main.js', current / 'styles.css')):
        return False
    try:
        if json.loads(manifest.read_text(encoding='utf-8-sig')).get('id') != PLUGIN_ID:
            return False
        enabled_path = plugins.parent / 'community-plugins.json'
        enabled = json.loads(enabled_path.read_text(encoding='utf-8-sig')) if enabled_path.exists() else []
        if not isinstance(enabled, list) or LEGACY_ID in enabled:
            return False
    except (ValueError, OSError, AttributeError):
        return False
    return all(path.name == 'data.json' and path.is_file() and not path.is_symlink() for path in legacy.iterdir())


def installed_plugin(plugins: Path) -> Path:
    current, legacy = plugins / PLUGIN_ID, plugins / LEGACY_ID
    if current.exists() and legacy.exists():
        if not legacy_settings_remnant(plugins):
            raise SystemExit(f'Both plugin installations exist; inspect before publishing: {plugins}')
    return current if current.exists() or not legacy.exists() else legacy


def archive_legacy_settings(plugins: Path, backup: Path) -> dict | None:
    """Caller holds release.lock and pauses QLO2 Sync. Never merge settings."""
    legacy, current = plugins / LEGACY_ID, plugins / PLUGIN_ID
    if not legacy.exists() and not legacy.is_symlink():
        return None
    if not legacy_settings_remnant(plugins):
        raise SystemExit(f'Legacy folder is not a settings-only remnant; inspect before cleanup: {legacy}')
    if backup.resolve().is_relative_to(plugins.parent.parent.resolve()):
        raise SystemExit('Legacy settings backups must be outside the vault.')
    active = current / 'data.json'
    active_bytes = active.read_bytes() if active.exists() else None
    settings = legacy / 'data.json'
    old_bytes = settings.read_bytes() if settings.exists() else None
    backup.mkdir(parents=True, mode=0o700, exist_ok=False)
    saved = backup / 'plugin'
    shutil.copytree(legacy, saved)
    # Validate again after the copy. A real second plugin, changed settings,
    # or a symlink introduced during backup cannot be silently removed.
    if (not legacy_settings_remnant(plugins) or
            (settings.read_bytes() if settings.exists() else None) != old_bytes or
            ((saved / 'data.json').read_bytes() if (saved / 'data.json').exists() else None) != old_bytes or
            (active.read_bytes() if active.exists() else None) != active_bytes):
        raise SystemExit('Plugin settings changed during legacy backup; cleanup refused.')
    # Keep the copied settings immutable even if an old process still has the
    # removed directory's data.json open. The original directory is retained too.
    legacy.rename(backup / 'removed-directory')
    if (active.read_bytes() if active.exists() else None) != active_bytes:
        raise SystemExit('Current plugin settings changed during legacy cleanup.')
    result = {'removedDirectory': str(legacy), 'backup': str(saved),
              'legacySettingsSha256': hashlib.sha256(old_bytes).hexdigest() if old_bytes is not None else None,
              'currentSettingsSha256': hashlib.sha256(active_bytes).hexdigest() if active_bytes is not None else None}
    with (backup / 'receipt.json').open('x') as output:
        json.dump(result, output, indent=2)
    return result


def needs_migration(plugin: Path, identifier: str) -> bool:
    return plugin.name == LEGACY_ID and identifier == PLUGIN_ID


def migrate_installation(plugin: Path, identifier: str, backup: Path, *, restore_enabled: bool = False) -> Path:
    """Caller stops the old client and, for QLO2, pauses Sync before calling."""
    if not needs_migration(plugin, identifier):
        return plugin
    target = plugin.with_name(PLUGIN_ID)
    if plugin.is_symlink() or not plugin.is_dir() or target.exists() or target.is_symlink():
        raise SystemExit('Plugin ID migration requires one real legacy directory and no destination.')
    if any(path.is_symlink() for path in plugin.rglob('*')):
        raise SystemExit('Symlinked plugin contents cannot be migrated.')
    config = plugin.parent.parent
    settings_path = plugin / 'data.json'
    settings = settings_path.read_bytes() if settings_path.exists() else None
    changes = {}
    enabled_path = config / 'community-plugins.json'
    if enabled_path.exists():
        original = enabled_path.read_bytes()
        enabled = json.loads(original.decode('utf-8-sig'))
        if not isinstance(enabled, list) or any(not isinstance(item, str) for item in enabled):
            raise SystemExit('Invalid enabled-plugin list; migration refused.')
        updated = list(dict.fromkeys(PLUGIN_ID if item == LEGACY_ID else item for item in enabled))
        if restore_enabled and PLUGIN_ID not in updated:
            updated.append(PLUGIN_ID)
        if updated != enabled:
            changes[enabled_path] = (original, (json.dumps(updated, indent=2) + '\n').encode())
    hotkeys_path = config / 'hotkeys.json'
    if hotkeys_path.exists():
        original = hotkeys_path.read_bytes()
        hotkeys = json.loads(original.decode('utf-8-sig'))
        if not isinstance(hotkeys, dict):
            raise SystemExit('Invalid hotkey map; migration refused.')
        updated = dict(hotkeys)
        for key, value in hotkeys.items():
            if not key.startswith(LEGACY_ID + ':'):
                continue
            replacement = PLUGIN_ID + key[len(LEGACY_ID):]
            if replacement in updated and updated[replacement] != value:
                raise SystemExit(f'Conflicting hotkeys for {replacement}; migration refused.')
            updated[replacement] = value
            del updated[key]
        if updated != hotkeys:
            changes[hotkeys_path] = (original, (json.dumps(updated, indent=2) + '\n').encode())
    # All conflicts are checked before any installation/configuration write.
    backup.mkdir(parents=True, exist_ok=True)
    saved_plugin = backup / 'plugin'
    if not saved_plugin.exists():
        shutil.copytree(plugin, saved_plugin)
    if settings is not None and (saved_plugin / 'data.json').read_bytes() != settings:
        raise SystemExit('Migration backup settings differ from the installation; inspect before retrying.')
    for path, (original, _) in changes.items():
        saved = backup / path.name
        if not saved.exists():
            with saved.open('xb') as output:
                output.write(original)

    def write(path: Path, value: bytes):
        temporary = path.with_name(path.name + '.id-migration')
        temporary.write_bytes(value)
        os.replace(temporary, path)

    written = []
    try:
        for path, (_, updated) in changes.items():
            write(path, updated)
            written.append(path)
        # Configurations are ready before the atomic directory move. A retry
        # after the move discovers the current path and cannot recopy old data.
        plugin.rename(target)
    except BaseException:
        for path in reversed(written):
            write(path, changes[path][0])
        raise
    if settings is not None and (target / 'data.json').read_bytes() != settings:
        raise SystemExit('Plugin settings changed during the ID migration.')
    return target
