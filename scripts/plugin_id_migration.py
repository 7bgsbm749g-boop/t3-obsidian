"""One-time, offline installation migration to the directory's letters-only ID."""
from pathlib import Path
import json
import os
import shutil

PLUGIN_ID = 't-three-code'
LEGACY_ID = 'send-to-t3-code'


def installed_plugin(plugins: Path) -> Path:
    current, legacy = plugins / PLUGIN_ID, plugins / LEGACY_ID
    if current.exists() and legacy.exists():
        raise SystemExit(f'Both plugin installations exist; inspect before publishing: {plugins}')
    return current if current.exists() or not legacy.exists() else legacy


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
