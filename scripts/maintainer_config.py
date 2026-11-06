"""Machine-local deployment settings shared by this repository's worktrees."""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parent.parent


def common_directory(root: Path = ROOT) -> Path:
    result = subprocess.run(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'],
                            cwd=root, capture_output=True, text=True, timeout=10)
    return Path(result.stdout.strip()) if result.returncode == 0 else root / '.git'


def configuration(root: Path = ROOT) -> dict:
    common = common_directory(root)
    filename = Path(os.environ.get('T3_OBSIDIAN_MAINTAINER_CONFIG', common / 't3-obsidian/maintainer.json'))
    value = json.loads(filename.read_text()) if filename.is_file() else {}
    if not isinstance(value, dict):
        raise ValueError('Maintainer configuration must be a JSON object.')
    return {'canonicalRoot': str(common.parent if common.name == '.git' else root), **value}


def canonical_root(root: Path = ROOT) -> Path:
    return Path(configuration(root)['canonicalRoot']).expanduser().resolve()


def evidence_root(root: Path = ROOT) -> Path:
    """Use the maintainer's external store, with a legacy contributor fallback."""
    value = configuration(root)
    path = value.get('evidenceRoot') or str(canonical_root(root) / 'evidence')
    directory = Path(path).expanduser()
    if value.get('evidenceRoot') and (not directory.is_absolute() or directory.resolve().is_relative_to(canonical_root(root)) or directory.resolve().is_relative_to(root.resolve())):
        raise ValueError('Configure an absolute evidenceRoot outside source checkouts.')
    return directory.resolve()


def path_setting(name: str, default: Path, root: Path = ROOT) -> Path:
    return Path(configuration(root).get(name, str(default))).expanduser()


def setting(name: str, default: str, root: Path = ROOT) -> str:
    value = configuration(root).get(name, default)
    if not isinstance(value, str) or not value:
        raise ValueError(f'Invalid maintainer setting: {name}')
    return value


def require_deployment(root: Path = ROOT) -> None:
    value = configuration(root)
    missing = [name for name in ('developmentPlugins', 'productionPlugins', 'syncService', 'obsidianCli') if not value.get(name)]
    if missing:
        raise SystemExit('Configure local deployment before publication: ' + ', '.join(missing))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--instructions', action='store_true')
    args = parser.parse_args()
    if args.instructions:
        guide = common_directory() / 't3-obsidian/AGENTS.md'
        print(guide.read_text() if guide.is_file() else 'No local maintainer instructions are installed.')
    else:
        print(json.dumps(configuration(), indent=2))


if __name__ == '__main__':
    main()
