#!/usr/bin/env python3
"""Select affected test files, cache successful checks, and attest release inputs."""
from __future__ import annotations

import argparse
import ast
from collections import defaultdict, deque
from contextlib import contextmanager
import datetime as dt
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path
import platform
import re
import subprocess
import sys
import tarfile
import tempfile
import time

ROOT = Path(__file__).resolve().parent.parent
CACHE = Path('/home/ubuntu/projects/send-to-t3-code/evidence/checks')
RECEIPTS = Path('/home/ubuntu/projects/send-to-t3-code/evidence/releases')
QLO2 = Path('/home/ubuntu/vaults/QLO2/.obsidian/plugins/t-three-code/manifest.json')
if not QLO2.exists():
    QLO2 = QLO2.parent.with_name('send-to-t3-code') / 'manifest.json'
RELEASE_FILES = ('manifest.json', 'versions.json', 'styles.css', 'README.md', 'LICENSE')
RUNNER_INPUTS = {'scripts/change_checks.py', 'scripts/test-impact.json'}
CODE_SUFFIXES = {'.ts', '.tsx', '.js', '.mjs', '.cjs', '.py', '.css'}
IMPORTS = re.compile(r'''(?:\bfrom\s+|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)["']([^"']+)''')
FILE_READS = re.compile(r'''(?:\breadFile(?:Sync)?|\bnew\s+URL|\.with_name)\s*\(\s*["'`]([^"'`\r\n]+)["'`]''')


def digest(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def json_bytes(value) -> bytes:
    return (json.dumps(value, sort_keys=True, indent=2) + '\n').encode()


def git(root: Path, *args: str) -> bytes:
    return subprocess.check_output(['git', *args], cwd=root)


def source_files(root: Path) -> dict[str, bytes]:
    names = git(root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard').split(b'\0')
    return {name.decode(): (root / os.fsdecode(name)).read_bytes()
            for name in sorted(set(names)) if name and (root / os.fsdecode(name)).is_file()}


def committed_files(root: Path, base: str) -> dict[str, bytes]:
    with tarfile.open(fileobj=io.BytesIO(git(root, 'archive', base))) as archive:
        return {item.name: archive.extractfile(item).read() for item in archive if item.isfile()}


def file_hashes(files: dict[str, bytes]) -> dict[str, str]:
    return {name: digest(value) for name, value in sorted(files.items())}


def snapshot_hash(files: dict[str, bytes]) -> str:
    return digest(json_bytes(file_hashes(files)))


def semantic_bytes(name: str, value: bytes | None) -> bytes | None:
    """Version bookkeeping is not a reason to select additional test files."""
    if value is None:
        return None
    if name in ('package.json', 'package-lock.json', 'manifest.json'):
        item = json.loads(value)
        item.pop('version', None)
        if name == 'package-lock.json':
            item.get('packages', {}).get('', {}).pop('version', None)
        return json_bytes(item)
    if name == 'versions.json':
        # Obsidian's version history has no executable behavior. Its release
        # alignment is checked separately by the release entry point.
        return b'version-history'
    return value


def default_base(root: Path) -> str:
    if QLO2.is_file():
        version = json.loads(QLO2.read_bytes())['version']
        receipt = RECEIPTS / version / 'deployment.json'
        if receipt.is_file():
            return json.loads(receipt.read_bytes())['gitCommit']
    raise SystemExit('No installed release baseline is available. Supply --base COMMIT.')


def resolve_reference(owner: str, reference: str, names: set[str]) -> set[str]:
    if '${' in reference or '\\' in reference or len(reference) > 240:
        return set()
    result = set()
    for base in (Path(owner).parent, Path('.')):
        candidate = os.path.normpath(str(base / reference))
        for suffix in ('', '.ts', '.tsx', '.js', '.mjs', '.json', '/index.ts', '/index.js'):
            if candidate + suffix in names:
                result.add(candidate + suffix)
    return result


def dependency_graph(files: dict[str, bytes]) -> dict[str, set[str]]:
    names = set(files) | {'dist/main.js'}
    graph = {name: set() for name in names}
    for name, value in files.items():
        if Path(name).suffix not in CODE_SUFFIXES or name in RUNNER_INPUTS:
            continue
        source = value.decode('utf-8', errors='replace')
        # Include source paths inside esbuild stdin strings and filesystem
        # reads, as well as ordinary static/dynamic imports and exports.
        references = [] if name.endswith('.py') else IMPORTS.findall(source) + FILE_READS.findall(source)
        if name.startswith('tests/') and 'dist/main.js' in source:
            references.append('dist/main.js')
        for reference in references:
            graph[name].update(resolve_reference(name, reference, names))
        if name.endswith('.py'):
            tree = ast.parse(source, filename=name)
            for node in ast.walk(tree):
                if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == 'with_name'
                        and node.args and isinstance(node.args[0], ast.Constant) and isinstance(node.args[0].value, str)):
                    graph[name].update(resolve_reference(name, node.args[0].value, names))
                modules = ([item.name for item in node.names] if isinstance(node, ast.Import)
                           else [node.module or '', *[(node.module + '.' if node.module else '') + item.name
                                                     for item in node.names]] if isinstance(node, ast.ImportFrom) else [])
                for module in modules:
                    graph[name].update(resolve_reference(name, module.replace('.', '/') + '.py', names))
    config = json.loads(files.get('scripts/test-impact.json', b'{}'))
    for owner, dependencies in config.get('dependencies', {}).items():
        graph.setdefault(owner, set()).update(dependencies)
    return graph


def is_test(name: str) -> bool:
    return (name.startswith('tests/') and name.endswith('.test.ts') or
            name.startswith('scripts/test_') and name.endswith('.py'))


def closure(start: set[str], graph: dict[str, set[str]]) -> set[str]:
    visited = set(start)
    queue = deque(start)
    while queue:
        for name in graph.get(queue.popleft(), ()):
            if name not in visited:
                visited.add(name)
                queue.append(name)
    return visited


def select_tests(current: dict[str, bytes], previous: dict[str, bytes], *, all_tests: bool = False) -> dict:
    changed = {name for name in current.keys() | previous.keys()
               if semantic_bytes(name, current.get(name)) != semantic_bytes(name, previous.get(name))}
    graph = dependency_graph(previous)
    for name, dependencies in dependency_graph(current).items():
        graph.setdefault(name, set()).update(dependencies)
    tests = {name for name in current if is_test(name)}
    # Runner/dependency/build configuration changes affect the test runtime.
    shared = RUNNER_INPUTS | {'package.json', 'package-lock.json', 'tsconfig.json', 'esbuild.config.mjs'}
    for test in tests:
        graph.setdefault(test, set()).update(shared & current.keys())
    reverse = defaultdict(set)
    for owner, dependencies in graph.items():
        for dependency in dependencies:
            reverse[dependency].add(owner)
    affected = closure(changed, reverse)
    selected = tests if all_tests else tests & affected
    covered = closure(selected, graph)
    uncovered = sorted(name for name in changed if name in current and Path(name).suffix in CODE_SUFFIXES
                       and not is_test(name) and name not in covered)
    return {'changedFiles': sorted(changed), 'testFiles': sorted(selected), 'uncoveredFiles': uncovered,
            'scope': 'all' if all_tests else 'affected', 'graph': graph}


def environment() -> dict:
    return {'node': subprocess.check_output(['node', '--version'], text=True).strip(),
            'npm': subprocess.check_output(['npm', '--version'], text=True).strip(),
            'python': sys.version, 'platform': platform.platform(), 'machine': platform.machine()}


def dependency_hash(root: Path) -> str:
    modules = root / 'node_modules'
    if not modules.is_dir():
        raise SystemExit('Dependencies are missing. Run npm ci first.')
    # Hash actual installed bytes, not timestamps or just the lockfile.
    return digest(json_bytes({str(path.relative_to(modules)): digest(path.read_bytes())
                              for path in sorted(modules.rglob('*')) if path.is_file() and path != modules / '.package-lock.json'}))


@contextmanager
def lock(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('a') as stream:
        fcntl.flock(stream, fcntl.LOCK_EX)
        yield


def checked_command(root: Path, command: list[str], log: Path, timeout: int = 900) -> None:
    print('+', ' '.join(command), flush=True)
    with log.open('xb') as output:
        result = subprocess.run(command, cwd=root, stdout=output, stderr=subprocess.STDOUT, timeout=timeout)
    if result.returncode:
        print(log.read_text(errors='replace')[-16000:], file=sys.stderr)
        raise SystemExit(f'Check failed ({result.returncode}). Full log: {log}')


def cached_build(root: Path, files: dict[str, bytes], context: dict, cache: Path) -> tuple[Path, bool]:
    inputs = {name: digest(value) for name, value in files.items()
              if name.endswith(('.ts', '.tsx', '.mjs')) or name in
              ('package.json', 'package-lock.json', 'manifest.json', 'tsconfig.json')}
    key = digest(json_bytes({'inputs': inputs, 'context': context}))
    directory = cache / 'builds' / key
    directory.parent.mkdir(parents=True, exist_ok=True)
    with lock(cache / 'locks' / ('build-' + key)):
        if not directory.exists():
            temporary = Path(tempfile.mkdtemp(prefix='build-', dir=cache))
            checked_command(root, ['npm', 'run', 'build'], temporary / 'build.log', timeout=240)
            if snapshot_hash(source_files(root)) != snapshot_hash(files) or dependency_hash(root) != context['dependenciesSha256']:
                raise SystemExit('Inputs changed during the build. No cached build was created.')
            bundle = (root / 'dist/main.js').read_bytes()
            (temporary / 'main.js').write_bytes(bundle)
            (temporary / 'build.json').write_bytes(json_bytes({'sha256': digest(bundle)}))
            temporary.rename(directory)
            reused = False
        else:
            reused = True
        bundle = (directory / 'main.js').read_bytes()
        if digest(bundle) != json.loads((directory / 'build.json').read_bytes())['sha256']:
            raise SystemExit(f'Cached build is damaged: {directory}')
        (root / 'dist').mkdir(exist_ok=True)
        (root / 'dist/main.js').write_bytes(bundle)
    return directory / 'main.js', reused


def run_validation(root: Path = ROOT, *, base: str | None = None, all_tests: bool = False,
                   require_build: bool = False, cache: Path = CACHE) -> Path:
    started = time.monotonic()
    base = git(root, 'rev-parse', '--verify', (base or default_base(root)) + '^{commit}').decode().strip()
    files = source_files(root)
    plan = select_tests(files, committed_files(root, base), all_tests=all_tests)
    if plan['uncoveredFiles']:
        raise SystemExit('Changed code has no test dependency path. Add coverage or an explicit dependency in '
                         'scripts/test-impact.json: ' + ', '.join(plan['uncoveredFiles']))
    context = {'environment': environment(), 'dependenciesSha256': dependency_hash(root)}
    cache.mkdir(parents=True, exist_ok=True)
    graph = plan.pop('graph')
    validation_key = digest(json_bytes({'source': snapshot_hash(files), 'context': context,
                                        'base': base, 'scope': plan['scope'], 'build': require_build}))
    with lock(cache / 'locks' / ('validation-' + validation_key)):
        receipt = cache / 'validations' / (validation_key + '.json')
        if receipt.exists():
            verify_validation(receipt, root)
            print(f'Checks already passed for these exact inputs. Reusing {receipt}', flush=True)
            return receipt
        run_directory = Path(tempfile.mkdtemp(prefix='run-', dir=cache))
        # Bundle consumers need the production bundle. A release always does.
        needs_build = require_build or any('dist/main.js' in closure({test}, graph) for test in plan['testFiles'])
        needs_build = needs_build or any(name.endswith(('.ts', '.tsx')) for name in plan['changedFiles'])
        bundle, build_reused = cached_build(root, files, context, cache) if needs_build else (None, False)
        test_keys = {}
        for test in plan['testFiles']:
            inputs = {name: digest(files[name]) if name in files else None for name in closure({test}, graph)}
            if 'dist/main.js' in inputs and bundle:
                inputs['dist/main.js'] = digest(bundle.read_bytes())
            test_keys[test] = digest(json_bytes({'inputs': inputs, 'context': context}))
        # Serialize shared cache access so two worktrees do not execute the
        # same successful check concurrently. Their source edits stay isolated.
        with lock(cache / 'locks' / 'tests'):
            pending, reused = [], []
            for test, key in test_keys.items():
                result_path = cache / 'tests' / (key + '.json')
                if result_path.exists():
                    result = json.loads(result_path.read_bytes())
                    log = Path(result['log'])
                    if (result.get('status') != 'passed' or result.get('test') != test or
                            not log.is_file() or digest(log.read_bytes()) != result['logSha256']):
                        raise SystemExit(f'Cached test evidence is damaged: {result_path}')
                    reused.append(test)
                else:
                    pending.append(test)
            print(f"Affected tests: {len(plan['testFiles'])} files; run {len(pending)}, reuse {len(reused)}.", flush=True)
            commands = []
            javascript = [name for name in pending if name.endswith('.ts')]
            python = [name for name in pending if name.endswith('.py')]
            if javascript:
                commands.append((javascript, [str(root / 'node_modules/.bin/tsx'), '--test', '--test-concurrency=2', *javascript]))
            if python:
                commands.append((python, [sys.executable, '-m', 'unittest', *[name.removesuffix('.py').replace('/', '.') for name in python]]))
            for index, (tests, command) in enumerate(commands):
                log = run_directory / f'tests-{index}.log'
                checked_command(root, command, log)
                if snapshot_hash(source_files(root)) != snapshot_hash(files) or dependency_hash(root) != context['dependenciesSha256']:
                    raise SystemExit('Inputs changed during testing. No successful check was cached.')
                log_hash = digest(log.read_bytes())
                (cache / 'tests').mkdir(exist_ok=True)
                for test in tests:
                    path = cache / 'tests' / (test_keys[test] + '.json')
                    with path.open('xb') as output:
                        output.write(json_bytes({'test': test, 'status': 'passed', 'log': str(log), 'logSha256': log_hash}))
        if snapshot_hash(source_files(root)) != snapshot_hash(files) or dependency_hash(root) != context['dependenciesSha256']:
            raise SystemExit('Source or dependencies changed during validation. No release proof was created.')
        result = {'schema': 1, 'createdAt': dt.datetime.now(dt.timezone.utc).isoformat(),
                  'sourceSha256': snapshot_hash(files), 'context': context, 'sourceRoot': str(root),
                  'bundle': str(bundle) if bundle else None, 'bundleSha256': digest(bundle.read_bytes()) if bundle else None,
                  'releaseInputsSha256': {name: digest(files[name]) for name in RELEASE_FILES if name in files},
                  'testSuite': {'status': 'passed', 'baseCommit': base, **plan, 'executed': pending, 'reused': reused},
                  'testResultsSha256': {str(cache / 'tests' / (key + '.json')):
                                       digest((cache / 'tests' / (key + '.json')).read_bytes()) for key in test_keys.values()},
                  'buildReused': build_reused, 'durationSeconds': round(time.monotonic() - started, 3)}
        receipt.parent.mkdir(parents=True, exist_ok=True)
        with receipt.open('xb') as output:
            output.write(json_bytes(result))
        print(f'Validation: {receipt} ({result["durationSeconds"]}s)', flush=True)
        return receipt


def verify_validation(path: Path, root: Path = ROOT, *, require_build: bool = False) -> dict:
    result = json.loads(path.read_bytes())
    if result.get('schema') != 1 or result.get('testSuite', {}).get('status') != 'passed':
        raise SystemExit('Validation proof does not record successful checks.')
    if result['sourceSha256'] != snapshot_hash(source_files(root)):
        raise SystemExit('Source changed after validation. Prepare the changed candidate again.')
    if result['context'] != {'environment': environment(), 'dependenciesSha256': dependency_hash(root)}:
        raise SystemExit('Dependencies or runtime changed after validation. Prepare again.')
    if require_build and not result.get('bundle'):
        raise SystemExit('Validation has no release build. Run release:qlo2 -- --prepare first.')
    if result.get('bundle') and digest(Path(result['bundle']).read_bytes()) != result['bundleSha256']:
        raise SystemExit('Validated bundle does not match its proof.')
    for name, checksum in result.get('testResultsSha256', {}).items():
        check = Path(name)
        if digest(check.read_bytes()) != checksum:
            raise SystemExit('Cached test result changed after validation.')
        test = json.loads(check.read_bytes())
        if test['status'] != 'passed' or digest(Path(test['log']).read_bytes()) != test['logSha256']:
            raise SystemExit('Cached test evidence changed after validation.')
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', help='Compare against this commit; default: installed release source.')
    parser.add_argument('--all', action='store_true', help='Explicitly run the complete test suite.')
    parser.add_argument('--plan', action='store_true', help='Print selected test files without running checks.')
    args = parser.parse_args()
    if args.plan:
        base = git(ROOT, 'rev-parse', '--verify', (args.base or default_base(ROOT)) + '^{commit}').decode().strip()
        plan = select_tests(source_files(ROOT), committed_files(ROOT, base), all_tests=args.all)
        plan.pop('graph')
        print(json.dumps({'baseCommit': base, **plan}, indent=2))
    else:
        run_validation(base=args.base, all_tests=args.all)


if __name__ == '__main__':
    main()
