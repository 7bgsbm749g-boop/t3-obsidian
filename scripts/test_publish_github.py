import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
spec = importlib.util.spec_from_file_location('publish_github', Path(__file__).with_name('publish-github.py'))
publish = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publish)


class PublicationTests(unittest.TestCase):
    def test_configured_external_store_needs_no_project_local_link(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary); source = base / 'source'; source.mkdir()
            external = base / 'external'; external.mkdir()
            other = base / 'other-project'; other.mkdir()
            (external / 'escape').symlink_to(other, target_is_directory=True)
            config = {'canonicalRoot': str(source), 'evidenceRoot': str(external)}
            with patch.object(publish.maintainer_config, 'configuration', return_value=config):
                self.assertEqual(publish.publication_directory(source, external / 'round'), external / 'round')
                for path in [source / 'evidence/round', other / 'round', external / 'escape/round']:
                    with self.assertRaises(ValueError):
                        publish.publication_directory(source, path)

    def test_external_evidence_store_accepts_its_link_and_rejects_escapes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            checkout, external = root / 'checkout', root / 'external'
            checkout.mkdir()
            external.mkdir()
            (checkout / 'evidence').symlink_to(external, target_is_directory=True)
            expected = external / 'publication'
            self.assertEqual(publish.publication_directory(checkout, expected), expected)
            self.assertEqual(publish.publication_directory(checkout, checkout / 'evidence/publication'), expected)
            outside = root / 'another-project'
            outside.mkdir()
            (external / 'escape').symlink_to(outside, target_is_directory=True)
            for candidate in [outside / 'publication', external / 'escape/publication']:
                with self.assertRaises(ValueError):
                    publish.publication_directory(checkout, candidate)

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
