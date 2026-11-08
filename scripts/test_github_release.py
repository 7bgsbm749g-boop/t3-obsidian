import copy
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
import github_release as release


class AutomaticPublicationTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.root.joinpath('dist').mkdir()
        self.root.joinpath('dist/main.js').write_bytes(b'checked plugin')
        self.root.joinpath('styles.css').write_bytes(b'checked styles')
        self.root.joinpath('manifest.json').write_text(json.dumps({'version': '0.0.999', 'minAppVersion': '1.13.0'}))
        self.root.joinpath('package.json').write_text(json.dumps({'version': '0.0.999'}))
        self.root.joinpath('package-lock.json').write_text(json.dumps({'version': '0.0.999', 'packages': {'': {'version': '0.0.999'}}}))
        self.root.joinpath('versions.json').write_text(json.dumps({'0.0.999': '1.13.0'}))
        self.root.joinpath('release-policy.json').write_bytes((release.ROOT / 'release-policy.json').read_bytes())
        root_patch = patch.object(release, 'ROOT', self.root)
        root_patch.start()
        self.addCleanup(root_patch.stop)

    def draft(self, *, draft=True):
        return {'draft': draft, 'html_url': 'https://example.invalid/release', 'assets': [
            {'name': name, 'digest': 'sha256:' + hashlib.sha256((self.root / path).read_bytes()).hexdigest()}
            for name, path in release.ASSETS.items()]}

    def test_version_requires_alignment_and_an_increase_over_the_push_base(self):
        with patch.dict(os.environ, {'T3_PREVIOUS_SHA': 'a' * 40}), patch.object(release, 'command') as command:
            command.return_value = json.dumps({'version': '0.0.998'})
            self.assertEqual(release.version(), '0.0.999')
            for previous in ['0.0.999', '0.0.1000']:
                command.return_value = json.dumps({'version': previous})
                with self.assertRaisesRegex(ValueError, 'requires a newer'):
                    release.version()
            self.root.joinpath('package.json').write_text(json.dumps({'version': '0.0.998'}))
            with self.assertRaisesRegex(ValueError, 'Align'):
                release.version()

    def test_tag_collision_cannot_overwrite_or_dispatch_another_source(self):
        with patch.object(release, 'tag_commit', return_value='b' * 40), patch.object(release, 'api') as api:
            with self.assertRaisesRegex(ValueError, 'another commit'):
                release.prepare('owner/repo', '0.0.999', 'a' * 40)
            api.assert_not_called()

    def test_retry_after_failed_dispatch_reuses_only_its_exact_tag(self):
        with patch.object(release, 'tag_commit', side_effect=[None, 'a' * 40]), patch.object(release, 'api') as api:
            api.side_effect = [None, RuntimeError('dispatch interrupted'), None]
            with self.assertRaisesRegex(RuntimeError, 'interrupted'):
                release.prepare('owner/repo', '0.0.999', 'a' * 40)
            release.prepare('owner/repo', '0.0.999', 'a' * 40)
            calls = api.call_args_list
            self.assertEqual(sum(call.args[0].endswith('/git/refs') for call in calls), 1)
            self.assertEqual(calls[-1].kwargs['payload'], {'ref': '0.0.999'})

    def test_missing_resource_is_distinct_from_denied_access(self):
        with patch.object(release.subprocess, 'run') as run:
            run.return_value = subprocess.CompletedProcess([], 1, '', 'gh: Not Found (HTTP 404)')
            self.assertIsNone(release.api('unused', missing=True))
            run.return_value = subprocess.CompletedProcess([], 1, '', 'gh: Forbidden (HTTP 403)')
            with self.assertRaisesRegex(RuntimeError, 'Forbidden'):
                release.api('unused', missing=True)

    def test_failed_upload_keeps_the_release_unpublished(self):
        draft = self.draft()
        draft['assets'].pop()
        with patch.object(release, 'tag_commit', return_value='a' * 40), patch.object(release, 'api', return_value=draft), patch.object(release, 'command') as command:
            command.side_effect = subprocess.CalledProcessError(1, 'upload')
            with self.assertRaises(subprocess.CalledProcessError):
                release.publish('owner/repo', '0.0.999', 'a' * 40)
            self.assertEqual(command.call_count, 1)
            self.assertEqual(command.call_args.args[:3], ('gh', 'release', 'upload'))
            self.assertNotIn('--clobber', command.call_args.args)

    def test_new_release_uploads_a_draft_before_publication(self):
        with patch.object(release, 'tag_commit', return_value='a' * 40), patch.object(release, 'api', side_effect=[None, self.draft(), {'tag_name': '0.0.998'}]), patch.object(release, 'command') as command:
            release.publish('owner/repo', '0.0.999', 'a' * 40)
            create, publish = [call.args for call in command.call_args_list]
            self.assertEqual(create[:4], ('gh', 'release', 'create', '0.0.999'))
            self.assertIn('--draft', create)
            self.assertIn('--verify-tag', create)
            self.assertEqual(create[create.index('--target') + 1], 'a' * 40)
            self.assertEqual(create[-3:], tuple(release.ASSETS.values()))
            self.assertIn('--draft=false', publish)

    def test_draft_retry_uploads_only_missing_bytes_then_publishes(self):
        complete = self.draft()
        partial = copy.deepcopy(complete)
        partial['assets'].pop()
        with patch.object(release, 'tag_commit', return_value='a' * 40), patch.object(release, 'api', side_effect=[partial, complete, {'tag_name': '0.0.998'}]), patch.object(release, 'command') as command:
            release.publish('owner/repo', '0.0.999', 'a' * 40)
            self.assertEqual(command.call_args_list[0].args, ('gh', 'release', 'upload', '0.0.999', '--repo', 'owner/repo', 'styles.css'))
            self.assertIn('--draft=false', command.call_args_list[1].args)
            self.assertIn('--prerelease=false', command.call_args_list[1].args)
            self.assertIn('--latest=true', command.call_args_list[1].args)

    def test_published_retry_verifies_bytes_without_mutation(self):
        existing = self.draft(draft=False)
        with patch.object(release, 'tag_commit', return_value='a' * 40), patch.object(release, 'api', return_value=existing), patch.object(release, 'command') as command:
            release.publish('owner/repo', '0.0.999', 'a' * 40)
            command.assert_not_called()
            existing['assets'][0]['digest'] = 'sha256:changed'
            with self.assertRaisesRegex(ValueError, 'bytes differ'):
                release.publish('owner/repo', '0.0.999', 'a' * 40)
            command.assert_not_called()

    def test_moved_tag_and_incomplete_published_release_are_never_modified(self):
        with patch.object(release, 'tag_commit', return_value='b' * 40), patch.object(release, 'api') as api:
            with self.assertRaisesRegex(ValueError, 'no longer matches'):
                release.publish('owner/repo', '0.0.999', 'a' * 40)
            api.assert_not_called()
        existing = self.draft(draft=False)
        existing['assets'].pop()
        with patch.object(release, 'tag_commit', return_value='a' * 40), patch.object(release, 'api', return_value=existing), patch.object(release, 'command') as command:
            with self.assertRaisesRegex(ValueError, 'missing assets'):
                release.publish('owner/repo', '0.0.999', 'a' * 40)
            command.assert_not_called()

    def test_older_build_does_not_replace_a_newer_latest_release(self):
        with patch.object(release, 'tag_commit', return_value='a' * 40), patch.object(release, 'api', side_effect=[self.draft(), {'tag_name': '0.0.1000'}]), patch.object(release, 'command') as command:
            release.publish('owner/repo', '0.0.999', 'a' * 40)
            self.assertIn('--latest=false', command.call_args.args)


if __name__ == '__main__':
    unittest.main()
