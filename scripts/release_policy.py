"""Shared release ordering and the user-approved alpha numbering policy."""
from __future__ import annotations

import json
from pathlib import Path
import re

NUMERIC = re.compile(r'(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\Z')
ALPHA = re.compile(r'0\.0\.(0|[1-9][0-9]*)-alpha\Z')
ALPHA_NUMERIC = re.compile(r'0\.0\.(0|[1-9][0-9]*)\Z')


def parse(value: str) -> tuple[int, int, int]:
    if match := NUMERIC.fullmatch(value):
        return tuple(map(int, match.groups()))
    if match := ALPHA.fullmatch(value):
        return 0, 0, int(match[1])
    raise ValueError(f'Expected MAJOR.MINOR.PATCH or 0.0.BUILD-alpha, got {value!r}.')


def policy(root: Path) -> dict | None:
    path = root / 'release-policy.json'
    if not path.exists():
        return None
    value = json.loads(path.read_text())
    if value.get('schemaVersion') != 1 or value.get('stage') not in {'alpha', 'stable'}:
        raise ValueError('Invalid release policy; alpha graduation requires an explicit reviewed policy change.')
    if value['stage'] == 'alpha':
        if not ALPHA.fullmatch(value.get('firstAlphaVersion', '')):
            raise ValueError('Alpha policy must retain its first historical 0.0.BUILD-alpha version.')
        if value.get('versionFormat', '0.0.BUILD-alpha') not in {'0.0.BUILD-alpha', '0.0.BUILD'}:
            raise ValueError('Unsupported alpha version format.')
    return value


def alpha_build(version: str) -> int:
    match = ALPHA.fullmatch(version) or ALPHA_NUMERIC.fullmatch(version)
    if not match:
        raise ValueError(f'Expected an alpha-lineage version, got {version!r}.')
    return int(match[1])


def is_alpha_version(root: Path, version: str) -> bool:
    value = policy(root)
    if not value or value['stage'] != 'alpha':
        return False
    if ALPHA.fullmatch(version):
        return True
    return bool(value.get('versionFormat') == '0.0.BUILD' and ALPHA_NUMERIC.fullmatch(version)
                and alpha_build(version) >= alpha_build(value['firstAlphaVersion']))


def release_title(root: Path, version: str) -> str:
    return f't3-obsidian {version}'


def transition(root: Path, new: str, old: str) -> bool:
    value = policy(root)
    return bool(value and value['stage'] == 'alpha' and
                new == value['firstAlphaVersion'] and old == value.get('transitionFrom'))


def order_key(root: Path, version: str) -> tuple[int, int, int, int, int]:
    core = parse(version)
    # Historical receipts retain their original numbers. The reviewed alpha
    # lineage follows those receipts even though its numeric core starts at 0.
    lineage = int(is_alpha_version(root, version))
    return lineage, *core, int(not bool(ALPHA.fullmatch(version)))


def require_target(root: Path, version: str) -> None:
    parse(version)
    value = policy(root)
    if value and value['stage'] == 'alpha':
        numeric = value.get('versionFormat') == '0.0.BUILD'
        pattern = ALPHA_NUMERIC if numeric else ALPHA
        if not pattern.fullmatch(version) or alpha_build(version) < alpha_build(value['firstAlphaVersion']):
            expected = '0.0.BUILD' if numeric else '0.0.BUILD-alpha'
            raise ValueError(f'Alpha stage requires {expected}; only the user can authorize graduation.')


def newer(root: Path, version: str, previous: str, *, allow_equal: bool = False) -> bool:
    require_target(root, version)
    if version == previous:
        return allow_equal
    if is_alpha_version(root, version) and not is_alpha_version(root, previous):
        return transition(root, version, previous)
    return order_key(root, version) > order_key(root, previous)


def bump(root: Path, version: str, part: str) -> str:
    if part not in {'patch', 'minor', 'major', 'none'}:
        raise ValueError(f'Unsupported version component: {part}')
    value = policy(root)
    if value and value['stage'] == 'alpha':
        if is_alpha_version(root, version):
            suffix = '' if value.get('versionFormat') == '0.0.BUILD' else '-alpha'
            return f'0.0.{alpha_build(version) + 1}{suffix}'
        if version == value.get('transitionFrom') and value.get('versionFormat') != '0.0.BUILD':
            return value['firstAlphaVersion']
        raise ValueError('The alpha transition does not authorize replacing this source version.')
    if part == 'none':
        raise ValueError('A stable maintenance-only change does not require a product release.')
    major, minor, patch = parse(version)
    if part == 'major':
        return f'{major + 1}.0.0'
    if part == 'minor':
        return f'{major}.{minor + 1}.0'
    return f'{major}.{minor}.{patch + 1}'


def reload_request_version(root: Path, target: str, loaded: str) -> str:
    # The pre-transition client accepts only numeric command versions. It can
    # still invoke app:reload after exact installed runtime hashes are checked.
    # Loaded-version proof must always verify the real alpha target afterwards.
    value = policy(root)
    legacy_client = bool(NUMERIC.fullmatch(loaded))
    alpha_target = bool(ALPHA.fullmatch(target))
    return loaded if value and value['stage'] == 'alpha' and legacy_client and alpha_target else target
