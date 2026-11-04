#!/usr/bin/env python3
"""Publish immutable queue assets only after exact-source provenance verification."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import zipfile
from release_policy import release_title

REPO = '7bgsbm749g-boop/t3-obsidian'
ASSETS = ('main.js', 'manifest.json', 'styles.css')
CANONICAL = Path('/home/ubuntu/projects/send-to-t3-code')


def checksum(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def require_delivery(directory: Path, version: str) -> dict:
    if not re.fullmatch(r'0\.0\.(0|[1-9][0-9]*)', version):
        raise ValueError('Supply the exact delivered numeric alpha version.')
    receipt = json.loads((directory / 'deployment.json').read_bytes())
    if receipt.get('version') != version or not re.fullmatch(r'[a-f0-9]{40}', receipt.get('gitCommit', '')):
        raise ValueError('Delivery source identity is invalid.')
    client = json.loads((directory / 'client-check.json').read_bytes())
    if client.get('version') != version or client.get('after', {}).get('ok') is not True or client.get('after', {}).get('client', {}).get('loadedVersion') != version:
        raise ValueError('The exact delivered client has not been verified.')
    smoke = [json.loads(path.read_bytes()) for path in directory.glob('smoke-*.json') if not path.stem.endswith('-evidence')]
    if not any(value.get('version') == version and value.get('status') == 'complete' and value.get('installedMainSha256') == receipt['releaseFileSha256']['main.js'] for value in smoke):
        raise ValueError('Changed-behavior smoke verification is incomplete.')
    return receipt


def attestation_command(gh: str, asset: Path, version: str, commit: str) -> list[str]:
    return [gh, 'attestation', 'verify', str(asset), '--repo', REPO,
            '--source-ref', 'refs/tags/' + version, '--source-digest', commit,
            '--signer-workflow', REPO + '/.github/workflows/release-provenance.yml', '--format', 'json']


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('version')
    parser.add_argument('--gh', default='gh', help='A current verified official GitHub CLI binary')
    parser.add_argument('--notes-file', type=Path, required=True)
    parser.add_argument('--evidence', type=Path, required=True)
    parser.add_argument('--publish', action='store_true', help='Create the regular Alpha release after verification')
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    evidence = args.evidence.resolve()
    if not evidence.is_relative_to(root / 'evidence'):
        raise ValueError('Keep publication evidence inside this project evidence directory.')
    evidence.mkdir(parents=True, exist_ok=False)
    receipt = require_delivery(CANONICAL / 'evidence/releases' / args.version, args.version)
    commit = receipt['gitCommit']
    archive = Path(receipt['archive'])
    if checksum(archive.read_bytes()) != receipt['archiveSha256']:
        raise ValueError('Immutable archive checksum changed.')
    def gh(*arguments: str) -> bytes:
        return subprocess.check_output([args.gh, *arguments], timeout=90)
    remote = json.loads(gh('api', f'repos/{REPO}/git/ref/tags/{args.version}'))
    obj = remote['object']
    if obj['type'] == 'tag':
        obj = json.loads(gh('api', f'repos/{REPO}/git/tags/{obj["sha"]}'))['object']
    if obj['type'] != 'commit' or obj['sha'] != commit:
        raise ValueError('Remote release tag does not match the delivered reviewed source.')
    with zipfile.ZipFile(archive) as bundle:
        for name in ASSETS:
            data = bundle.read('send-to-t3-code/' + name)
            if checksum(data) != receipt['releaseFileSha256'][name]:
                raise ValueError('Archive asset does not match its delivery receipt: ' + name)
            (evidence / name).write_bytes(data)
    if json.loads((evidence / 'manifest.json').read_bytes())['version'] != args.version:
        raise ValueError('Archive manifest does not match the release tag.')
    for name in ASSETS:
        result = subprocess.check_output(attestation_command(args.gh, evidence / name, args.version, commit), timeout=90)
        if not json.loads(result):
            raise ValueError('No verified provenance for ' + name)
        (evidence / (name + '.attestation.json')).write_bytes(result)
    (evidence / 'VERIFIED.json').write_text(json.dumps({'version': args.version, 'commit': commit, 'assets': receipt['releaseFileSha256'], 'tag': remote}, indent=2) + '\n')
    if args.publish:
        # gh refuses an existing release; no overwrite or asset clobber path.
        result = gh('release', 'create', args.version, '--repo', REPO, '--verify-tag', '--target', commit,
                    '--title', release_title(root, args.version), '--notes-file', str(args.notes_file.resolve()),
                    '--latest', *[str(evidence / name) for name in ASSETS])
        (evidence / 'PUBLISHED.txt').write_bytes(result)
        print(result.decode().strip())
    else:
        print('Exact source and all three immutable assets have verified provenance.')


if __name__ == '__main__':
    main()
