import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).parent))
spec = importlib.util.spec_from_file_location('publish_github', Path(__file__).with_name('publish-github.py'))
publish = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publish)


class PublicationTests(unittest.TestCase):
    def test_attestation_enforces_exact_source_tag_commit_and_workflow(self):
        command = publish.attestation_command('/verified/gh', Path('/immutable/main.js'), '0.0.999', 'a' * 40)
        for flag, value in [('--repo', publish.REPO), ('--source-ref', 'refs/tags/0.0.999'), ('--source-digest', 'a' * 40), ('--signer-workflow', publish.REPO + '/.github/workflows/release-provenance.yml')]:
            self.assertEqual(command[command.index(flag) + 1], value)

    def test_an_old_or_unverified_client_and_incomplete_smoke_are_refused(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / 'deployment.json').write_text(json.dumps({'version': '0.0.999', 'gitCommit': 'a' * 40, 'releaseFileSha256': {'main.js': 'hash'}}))
            def client(version):
                (root / 'client-check.json').write_text(json.dumps({'version': '0.0.999', 'after': {'ok': True, 'client': {'loadedVersion': version}}}))
            client('0.0.998')
            with self.assertRaisesRegex(ValueError, 'client'):
                publish.require_delivery(root, '0.0.999')
            client('0.0.999')
            with self.assertRaisesRegex(ValueError, 'smoke'):
                publish.require_delivery(root, '0.0.999')
            (root / 'smoke-fixture.json').write_text(json.dumps({'version': '0.0.999', 'status': 'complete', 'installedMainSha256': 'hash'}))
            self.assertEqual(publish.require_delivery(root, '0.0.999')['gitCommit'], 'a' * 40)

    def test_suffixes_and_noncanonical_version_strings_are_refused(self):
        for version in ['0.0.999-alpha', '0.0.0999', '2.0.0', '../escape']:
            with self.assertRaises(ValueError):
                publish.require_delivery(Path('/unused'), version)


if __name__ == '__main__':
    unittest.main()
