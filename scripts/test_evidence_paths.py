"""Project evidence must not recreate the retired shared backup directory."""
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import json
import unittest

ROOT = Path(__file__).resolve().parent.parent
NATIVE_LAB = Path(__file__).with_name('build-native-response-lab.mjs')


class EvidencePathTests(unittest.TestCase):
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
            ('validation/connection-health-live.ts', [], 'Private evidence directory required.'),
            ('validation/remote-delivery-api.ts', ['before'], 'Supply a private lab directory'),
            ('validation/remote-delivery-results.ts', [], 'Private lab evidence directory required.'),
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
