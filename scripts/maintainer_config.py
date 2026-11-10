"""Machine-local validation settings shared by this repository's worktrees."""
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
    """Resolve an external evidence store before any validation writes."""
    value = configuration(root)
    path = value.get('evidenceRoot') or Path.home() / '.local/state/t3-obsidian/evidence'
    directory = Path(path).expanduser()
    canonical = Path(value['canonicalRoot']).expanduser().resolve()
    if not directory.is_absolute() or directory.resolve().is_relative_to(canonical) or directory.resolve().is_relative_to(root.resolve()):
        raise ValueError('Configure an absolute evidenceRoot outside source checkouts.')
    for name in ('developmentPlugins', 'productionPlugins'):
        if value.get(name) and directory.resolve().is_relative_to(Path(value[name]).expanduser().resolve().parent.parent):
            raise ValueError('Configure evidenceRoot outside synced vaults.')
    return directory.resolve()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--instructions', action='store_true')
    parser.add_argument('--evidence-root', action='store_true', help='Print the resolved external evidence directory')
    args = parser.parse_args()
    if args.evidence_root:
        print(evidence_root())
    elif args.instructions:
        guide = common_directory() / 't3-obsidian/AGENTS.md'
        print(guide.read_text() if guide.is_file() else 'No local maintainer instructions are installed.')
    else:
        print(json.dumps(configuration(), indent=2))


if __name__ == '__main__':
    main()
