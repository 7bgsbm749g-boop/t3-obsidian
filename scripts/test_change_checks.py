from __future__ import annotations

import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from scripts import change_checks as checks


class ImpactSelectionTests(unittest.TestCase):
    def test_transitive_consumers_and_bundle_tests_are_selected_but_unrelated_tests_are_not(self):
        previous = {
            'core.ts': b'export const value=1;',
            'consumer.ts': b"export {value} from './core';",
            'main.ts': b"import {value} from './consumer';",
            'unrelated.ts': b'export const value=1;',
            'tests/core.test.ts': b"import {value} from '../core';",
            'tests/consumer.test.ts': b"import {value} from '../consumer';",
            'tests/bundle.test.ts': b"readFile('dist/main.js');",
            'tests/unrelated.test.ts': b"import {value} from '../unrelated';",
            'scripts/test-impact.json': b'{"dependencies":{"dist/main.js":["main.ts"]}}',
        }
        current = {**previous, 'core.ts': b'export const value=2;'}
        plan = checks.select_tests(current, previous)
        self.assertEqual(plan['testFiles'], ['tests/bundle.test.ts', 'tests/consumer.test.ts', 'tests/core.test.ts'])
        self.assertEqual(plan['uncoveredFiles'], [])

    def test_removed_dependency_edges_and_new_source_are_accounted_for(self):
        previous = {'old.ts': b'export const value=1;', 'consumer.ts': b"export * from './old';",
                    'tests/consumer.test.ts': b"import '../consumer';"}
        current = {name: value for name, value in previous.items() if name != 'old.ts'}
        current.update({'consumer.ts': b"export * from './new';", 'new.ts': b'export const value=2;'})
        plan = checks.select_tests(current, previous)
        self.assertEqual(plan['testFiles'], ['tests/consumer.test.ts'])
        self.assertEqual(plan['uncoveredFiles'], [])

    def test_esbuild_stdin_python_imports_and_dynamic_dependency_overrides(self):
        previous = {
            'view.ts': b'export const value=1;',
            'tests/view.test.ts': b'''build({stdin:{contents:"export * from './view';",resolveDir:process.cwd()}});''',
            'scripts/helper.py': b'value = 1',
            'scripts/release.py': b'from helper import value',
            'scripts/test_release.py': b"Path(__file__).with_name('release.py')",
            'scripts/dynamic.py': b'value = 1',
            'scripts/test_dynamic.py': b'# Loaded via runtime registry',
            'scripts/test-impact.json': b'{"dependencies":{"scripts/test_dynamic.py":["scripts/dynamic.py"]}}',
        }
        for source, expected in [('view.ts', 'tests/view.test.ts'), ('scripts/helper.py', 'scripts/test_release.py'),
                                 ('scripts/dynamic.py', 'scripts/test_dynamic.py')]:
            current = {**previous, source: previous[source] + b'\n# changed'}
            plan = checks.select_tests(current, previous)
            self.assertEqual(plan['testFiles'], [expected])
            self.assertEqual(plan['uncoveredFiles'], [])

    def test_docs_and_version_bookkeeping_select_no_tests_but_shared_runtime_changes_do(self):
        previous = {'package.json': b'{"version":"1.0.0","dependencies":{"x":"1"}}',
                    'manifest.json': b'{"version":"1.0.0","minAppVersion":"1"}',
                    'versions.json': b'{"1.0.0":"1"}', 'README.md': b'old',
                    'tests/a.test.ts': b'', 'scripts/test_b.py': b''}
        current = {**previous, 'package.json': b'{"version":"1.0.1","dependencies":{"x":"1"}}',
                   'manifest.json': b'{"version":"1.0.1","minAppVersion":"1"}',
                   'versions.json': b'{"1.0.0":"1","1.0.1":"1"}', 'README.md': b'new'}
        self.assertEqual(checks.select_tests(current, previous)['testFiles'], [])
        current['package.json'] = b'{"version":"1.0.1","dependencies":{"x":"2"}}'
        self.assertEqual(checks.select_tests(current, previous)['testFiles'], ['scripts/test_b.py', 'tests/a.test.ts'])

    def test_missing_coverage_is_reported_instead_of_selecting_unrelated_tests(self):
        previous = {'tests/unrelated.test.ts': b''}
        plan = checks.select_tests({**previous, 'uncovered.ts': b'export const value=1;'}, previous)
        self.assertEqual(plan['testFiles'], [])
        self.assertEqual(plan['uncoveredFiles'], ['uncovered.ts'])


class ValidationCacheTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        directory = Path(self.temporary.name)
        self.root = directory / 'source'; self.root.mkdir()
        self.cache = directory / 'checks'
        for name, value in {
            '.gitignore': b'node_modules/\ndist/\n',
            'core.ts': b'export const value=1;',
            'tests/core.test.ts': b"import '../core';",
            'tests/unrelated.test.ts': b'',
            'README.md': b'docs',
            'package.json': b'{"name":"fixture","version":"1.0.0"}',
            'node_modules/package/index.js': b'installed dependency',
        }.items():
            path = self.root / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(value)
        subprocess.run(['git', 'init', '-q', str(self.root)], check=True)
        subprocess.run(['git', 'add', '.'], cwd=self.root, check=True)
        subprocess.run(['git', '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'base'], cwd=self.root, check=True)
        self.base = checks.git(self.root, 'rev-parse', 'HEAD').decode().strip()
        (self.root / 'core.ts').write_bytes(b'export const value=2;')
        self.commands = []

    def tearDown(self):
        self.temporary.cleanup()

    def command(self, root, command, log, timeout=900):
        self.commands.append(command)
        log.write_bytes(b'passed\n')
        if command == ['npm', 'run', 'build']:
            (root / 'dist').mkdir(exist_ok=True)
            (root / 'dist/main.js').write_bytes(b'built:' + (root / 'core.ts').read_bytes())

    def validate(self):
        return checks.run_validation(self.root, base=self.base, cache=self.cache, require_build=True)

    def test_repeat_publish_and_docs_edit_reuse_checks_but_code_dependency_and_environment_changes_do_not(self):
        with patch.object(checks, 'environment', return_value={'node': 'test'}), patch.object(checks, 'checked_command', side_effect=self.command):
            proof = self.validate()
            self.assertEqual(len(self.commands), 2)
            self.assertEqual(json.loads(proof.read_bytes())['testSuite']['executed'], ['tests/core.test.ts'])
            self.assertEqual(self.validate(), proof)
            checks.verify_validation(proof, self.root, require_build=True)
            self.assertEqual(len(self.commands), 2)
            (self.root / 'README.md').write_bytes(b'changed docs')
            with self.assertRaisesRegex(SystemExit, 'Source changed'):
                checks.verify_validation(proof, self.root)
            proof = self.validate()
            self.assertEqual(len(self.commands), 2)
            self.assertEqual(json.loads(proof.read_bytes())['testSuite']['reused'], ['tests/core.test.ts'])
            (self.root / 'core.ts').write_bytes(b'export const value=3;')
            proof = self.validate()
            self.assertEqual(len(self.commands), 4)
            (self.root / 'node_modules/package/index.js').write_bytes(b'changed dependency')
            with self.assertRaisesRegex(SystemExit, 'Dependencies or runtime changed'):
                checks.verify_validation(proof, self.root)
            proof = self.validate()
            self.assertEqual(len(self.commands), 6)
            with patch.object(checks, 'environment', return_value={'node': 'different'}):
                with self.assertRaisesRegex(SystemExit, 'Dependencies or runtime changed'):
                    checks.verify_validation(proof, self.root)

    def test_changed_inputs_during_testing_cannot_create_a_successful_cache_entry(self):
        def mutate(root, command, log, timeout=900):
            self.command(root, command, log, timeout)
            if command[0] != 'npm':
                (root / 'core.ts').write_bytes(b'changed during the test')
        with patch.object(checks, 'environment', return_value={}), patch.object(checks, 'checked_command', side_effect=mutate):
            with self.assertRaisesRegex(SystemExit, 'Inputs changed during testing'):
                self.validate()
        self.assertFalse((self.cache / 'tests').exists())
        self.assertFalse((self.cache / 'validations').exists())

    def test_failed_tests_and_damaged_evidence_cannot_be_reused(self):
        def fail(root, command, log, timeout=900):
            self.command(root, command, log, timeout)
            if command[0] != 'npm':
                raise SystemExit('failure')
        with patch.object(checks, 'environment', return_value={}), patch.object(checks, 'checked_command', side_effect=fail):
            with self.assertRaisesRegex(SystemExit, 'failure'):
                self.validate()
        self.assertFalse((self.cache / 'validations').exists())
        with patch.object(checks, 'environment', return_value={}), patch.object(checks, 'checked_command', side_effect=self.command):
            proof = self.validate()
            result = next((self.cache / 'tests').glob('*.json'))
            log = Path(json.loads(result.read_bytes())['log'])
            log.write_bytes(b'changed evidence')
            with self.assertRaisesRegex(SystemExit, 'evidence changed'):
                checks.verify_validation(proof, self.root)


if __name__ == '__main__':
    unittest.main()
