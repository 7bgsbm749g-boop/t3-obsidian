#!/usr/bin/env python3
"""Link local agent skill discovery to the repository's maintained Obsidian skill."""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import shutil
import uuid

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'docs' / 'obsidian-t3-SKILL.md'


def destinations(home):
    roots = [home / '.agents' / 'skills', home / '.codex' / 'skills']
    for detected, skills in [(home / '.claude', home / '.claude' / 'skills'),
                             (home / '.config' / 'opencode', home / '.config' / 'opencode' / 'skills')]:
        if detected.is_dir():
            roots.append(skills)
    return [root / 'obsidian-t3' / 'SKILL.md' for root in roots]


def install(home, source=SOURCE, backups=None, check=False):
    source = source.resolve(strict=True)
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    targets = destinations(home)
    # Inspect all targets before changing any installation.
    for target in targets:
        if target.is_symlink() and target.resolve() != source:
            raise ValueError(f'Refusing an unrelated skill link: {target}')
    results = []
    for target in targets:
        current = target.is_symlink() and target.resolve() == source
        if not check and not current:
            target.parent.mkdir(parents=True, exist_ok=True)
            if target.exists():
                directory = backups or home / 'backups' / 'send-to-t3-code' / 'skills'
                directory.mkdir(parents=True, exist_ok=True)
                backup = directory / (dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + uuid.uuid4().hex + '.md')
                shutil.copy2(target, backup)
                backup.chmod(0o600)
            temporary = target.with_name('.SKILL.md.' + uuid.uuid4().hex)
            try:
                temporary.symlink_to(source)
                os.replace(temporary, target)
            finally:
                temporary.unlink(missing_ok=True)
            current = True
        results.append({'path': str(target), 'current': current})
    return {'source': str(source), 'sha256': digest, 'installations': results, 'ok': all(item['current'] for item in results)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Verify links without changing files')
    args = parser.parse_args()
    result = install(Path.home(), check=args.check)
    print(json.dumps(result, indent=2))
    raise SystemExit(0 if result['ok'] else 1)


if __name__ == '__main__':
    main()
