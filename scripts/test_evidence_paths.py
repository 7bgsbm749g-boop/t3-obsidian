"""Project evidence must not recreate the retired shared backup directory."""
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import json
import unittest
import ast

ROOT = Path(__file__).resolve().parent.parent
NATIVE_LAB = Path(__file__).with_name('build-native-response-lab.mjs')


class EvidencePathTests(unittest.TestCase):
    def test_native_sync_driver_resolves_the_repository_after_the_fixture_move(self):
        script = ROOT / 'tests/native/local-response-sync-lab.py'
        tree = ast.parse(script.read_text())
        assignment = next(node for node in tree.body if isinstance(node, ast.Assign)
                          and any(isinstance(target, ast.Name) and target.id == 'ROOT' for target in node.targets))
        # Evaluate only the path expression, never the driver's real Sync operations.
        resolved = eval(compile(ast.Expression(assignment.value), str(script), 'eval'),
                        {'Path': Path, '__file__': str(script)})
        self.assertEqual(resolved, ROOT)
        self.assertTrue((resolved / 'scripts/obsidian-sync-lab.py').is_file())
        self.assertTrue((resolved / 'tests/native/local-response-sync-case.ts').is_file())

    def test_sync_lab_keeps_evidence_inside_the_plugin_project(self):
        spec = importlib.util.spec_from_file_location('sync_lab', Path(__file__).with_name('obsidian-sync-lab.py'))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        self.assertEqual(module.EVIDENCE.parent, Path('/home/ubuntu/projects/send-to-t3-code/evidence'))

    def test_native_lab_build_accepts_gitignored_project_evidence_and_refuses_synced_vaults(self):
        evidence = ROOT / 'evidence'
        evidence.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=evidence, prefix='native-path-contract-') as temporary:
            lab = Path(temporary) / 'native-lab'
            result = subprocess.run(['node', str(NATIVE_LAB), str(lab), '--run-import'],
                                    cwd=ROOT, capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(Path(json.loads(result.stdout)['root']), lab)
            self.assertTrue((lab / 'ISOLATED-NATIVE-LAB').is_file())
        for path in ['/home/ubuntu/vaults/QLO2/evidence/forbidden-lab',
                     '/home/ubuntu/backups/send-to-t3-code/forbidden-lab']:
            result = subprocess.run(['node', str(NATIVE_LAB), path, '--run-import'],
                                    cwd=ROOT, capture_output=True, text=True, timeout=20)
            self.assertNotEqual(result.returncode, 0)
            self.assertRegex(result.stderr, 'outside synced vaults|gitignored evidence/')

    def test_lab_commands_reject_the_retired_directory_before_accessing_vaults_or_credentials(self):
        for script, extra, message in [
            ('scripts/prepare-remote-delivery-lab.mjs', [], 'Private evidence directory required.'),
            ('scripts/prepare-smart-send-rename-lab.mjs', [], 'Private evidence directory required.'),
            ('tests/native/connection-health-live.ts', [], 'Private evidence directory required.'),
            ('tests/native/remote-delivery-api.ts', ['before'], 'Supply a private lab directory'),
            ('tests/native/remote-delivery-results.ts', [], 'Private lab evidence directory required.'),
        ]:
            with self.subTest(script=script):
                result = subprocess.run(
                    ['node', '--import', 'tsx', str(ROOT / script),
                     '/home/ubuntu/backups/send-to-t3-code/forbidden-evidence-path', *extra],
                    cwd=ROOT, capture_output=True, text=True, timeout=20)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(message, result.stderr)
                self.assertNotIn('ENOENT', result.stderr)


if __name__ == '__main__':
    unittest.main()
