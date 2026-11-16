import copy
import base64
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


class TaggedPublicationTests(unittest.TestCase):
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

    def test_release_alignment_does_not_require_a_bump_over_the_push_base(self):
        with patch.dict(os.environ, {'T3_PREVIOUS_SHA': 'a' * 40}), patch.object(release, 'command') as command:
            self.assertEqual(release.version(), '0.0.999')
            command.assert_not_called()
            self.root.joinpath('package.json').write_text(json.dumps({'version': '0.0.998'}))
            with self.assertRaisesRegex(ValueError, 'Align'):
                release.version()

    def test_merge_validation_requires_newer_version_but_development_validation_does_not(self):
        for previous in ['0.0.999', '0.0.1000']:
            with self.subTest(previous=previous), patch.object(release, 'base_version', return_value=previous):
                with self.assertRaisesRegex(ValueError, 'Merge preparation'):
                    release.version('origin/main')
        with patch.object(release, 'base_version', return_value='0.0.998'):
            self.assertEqual(release.version('origin/main'), '0.0.999')
        self.assertEqual(release.version(), '0.0.999')

    def inventory(self, *, base='0.0.999', claims=None, tags=None):
        return {'base': base, 'claims': claims or {}, 'tags': tags or [],
                'target': {'state': 'open', 'draft': False, 'head': {'sha': 'a' * 40}, 'base': {'sha': 'b' * 40, 'ref': 'main'}}}

    def test_merge_allocation_skips_open_prs_tags_and_local_compatibility_history(self):
        history = {'0.0.999': '1.13.0', '0.0.1004': '1.13.0'}
        self.root.joinpath('versions.json').write_text(json.dumps(history))
        state = self.inventory(claims={23: '0.0.1008', 24: '0.0.1002'}, tags=['0.0.1005'])
        with patch.object(release, 'merge_inventory', return_value=state), patch.object(release, 'unchanged_merge_source') as guard:
            self.assertEqual(release.merge_version('owner/repo', 22, 'origin/main'), '0.0.1009')
        guard.assert_called_once()
        self.assertEqual(release.version(), '0.0.1009')
        self.assertEqual(json.loads(self.root.joinpath('versions.json').read_text()), {**history, '0.0.1009': '1.13.0'})

    def test_merge_allocation_reuses_its_unclaimed_bump_and_changes_no_other_metadata(self):
        state = self.inventory(base='0.0.998', claims={23: '0.0.1000'})
        before = {name: json.loads(self.root.joinpath(name).read_text()) for name in release.VERSION_FILES}
        with patch.object(release, 'merge_inventory', return_value=state), patch.object(release, 'unchanged_merge_source'):
            self.assertEqual(release.merge_version('owner/repo', 22, 'origin/main'), '0.0.999')
            self.assertEqual(release.merge_version('owner/repo', 22, 'origin/main', validate=True), '0.0.999')
        self.assertEqual(before, {name: json.loads(self.root.joinpath(name).read_text()) for name in release.VERSION_FILES})

    def test_final_merge_check_rejects_a_late_claim_tag_or_target_change_without_writing(self):
        for state in [self.inventory(claims={23: '0.0.999'}), self.inventory(base='0.0.998', tags=['0.0.999']),
                      self.inventory(base='0.0.1000')]:
            before = {name: self.root.joinpath(name).read_bytes() for name in release.VERSION_FILES}
            with patch.object(release, 'merge_inventory', return_value=state):
                with self.assertRaisesRegex(ValueError, 'stale, published or used'):
                    release.merge_version('owner/repo', 22, 'origin/main', validate=True)
            self.assertEqual(before, {name: self.root.joinpath(name).read_bytes() for name in release.VERSION_FILES})

    def test_moving_source_during_inventory_leaves_metadata_untouched(self):
        before = {name: self.root.joinpath(name).read_bytes() for name in release.VERSION_FILES}
        state = self.inventory()
        for field in ['head', 'base']:
            latest = copy.deepcopy(state['target']); latest[field]['sha'] = 'c' * 40
            with patch.object(release, 'merge_inventory', return_value=state), patch.object(release, 'api', return_value=latest):
                with self.assertRaisesRegex(ValueError, 'moved during'):
                    release.merge_version('owner/repo', 22, 'origin/main')
            self.assertEqual(before, {name: self.root.joinpath(name).read_bytes() for name in release.VERSION_FILES})

    def test_agent_reallocates_a_late_collision_without_manual_version_selection(self):
        state = self.inventory(claims={23: '0.0.1008'})
        with patch.object(release, 'merge_inventory', return_value=state), patch.object(release, 'unchanged_merge_source'):
            self.assertEqual(release.merge_version('owner/repo', 22, 'origin/main'), '0.0.1009')
            state['claims'][23] = '0.0.1009'
            with self.assertRaisesRegex(ValueError, 'used by another PR'):
                release.merge_version('owner/repo', 22, 'origin/main', validate=True)
            self.assertEqual(release.merge_version('owner/repo', 22, 'origin/main'), '0.0.1010')
            self.assertEqual(release.merge_version('owner/repo', 22, 'origin/main', validate=True), '0.0.1010')

    def test_inventory_failure_cannot_partially_allocate_a_version(self):
        before = {name: self.root.joinpath(name).read_bytes() for name in release.VERSION_FILES}
        with patch.object(release, 'merge_inventory', side_effect=RuntimeError('Cannot read another PR')):
            with self.assertRaisesRegex(RuntimeError, 'another PR'):
                release.merge_version('owner/repo', 22, 'origin/main')
        self.assertEqual(before, {name: self.root.joinpath(name).read_bytes() for name in release.VERSION_FILES})

    def test_final_check_reads_target_ref_even_when_pr_base_metadata_is_stale(self):
        state = self.inventory(base='0.0.998')
        with patch.object(release, 'api', return_value=state['target']), patch.object(release, 'target_head', return_value='f' * 40):
            with self.assertRaisesRegex(ValueError, 'moved during'):
                release.unchanged_merge_source('owner/repo', 22, state)

    def test_inventory_paginates_and_does_not_hide_read_failures(self):
        with patch.object(release, 'api', side_effect=[[{}] * 100, [{'number': 101}]]) as api:
            self.assertEqual(len(release.pages('repos/owner/repo/pulls?state=open')), 101)
            self.assertTrue(api.call_args.args[0].endswith('&per_page=100&page=2'))
        with patch.object(release, 'api', side_effect=RuntimeError('Forbidden')):
            with self.assertRaisesRegex(RuntimeError, 'Forbidden'):
                release.pages('repos/owner/repo/tags')

    def test_remote_manifest_uses_immutable_fork_identity_and_rejects_invalid_inputs(self):
        value = {'type': 'file', 'encoding': 'base64', 'size': 24,
                 'content': base64.b64encode(b'{"version":"0.0.1002"}').decode()}
        with patch.object(release, 'api', return_value=value) as api:
            self.assertEqual(release.remote_version('contributor/fork', 'c' * 40), '0.0.1002')
            self.assertEqual(api.call_args.args[0], 'repos/contributor/fork/contents/manifest.json?ref=' + 'c' * 40)
            with self.assertRaisesRegex(ValueError, 'source identity'):
                release.remote_version('owner/repo', 'moving-branch')
        for bad in [{**value, 'size': 1_000_001}, {**value, 'type': 'symlink'}, {**value, 'encoding': 'none'}]:
            with patch.object(release, 'api', return_value=bad), self.assertRaisesRegex(ValueError, 'exact source manifest'):
                release.remote_version('owner/repo', 'c' * 40)

    def test_real_checkout_preparation_and_recheck_read_other_prs_without_remote_mutations(self):
        def git(*args):
            return subprocess.check_output(['git', *args], cwd=self.root, text=True).strip()
        git('init', '--quiet'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid')
        git('add', '.'); git('commit', '--quiet', '-m', 'Synthetic base')
        base = git('rev-parse', 'HEAD')
        target = {'number': 22, 'state': 'open', 'draft': False, 'head': {'sha': base},
                  'base': {'sha': base, 'ref': 'main', 'repo': {'full_name': 'owner/repo'}}}
        other = {'number': 23, 'head': {'sha': 'c' * 40, 'repo': {'full_name': 'contributor/fork'}}}
        requests = []
        def api(path, **kwargs):
            requests.append((path, kwargs)); self.assertNotIn('payload', kwargs)
            if path.endswith('/pulls/22'):return target
            if path.endswith('/git/ref/heads/main'):return {'object': {'sha': base}}
            if '/pulls?' in path:return [target, other]
            if '/tags?' in path:return [{'name': '0.0.1005'}, {'name': '0.0.377-alpha'}]
            if '/contents/manifest.json?' in path:
                return {'type': 'file', 'encoding': 'base64', 'size': 24,
                        'content': base64.b64encode(b'{"version":"0.0.1003"}').decode()}
            self.fail(path)
        with patch.object(release, 'api', side_effect=api):
            self.assertEqual(release.merge_version('owner/repo', 22, base), '0.0.1006')
            with self.assertRaisesRegex(ValueError, 'local changes'):
                release.merge_version('owner/repo', 22, base, validate=True)
            git('add', '.'); git('commit', '--quiet', '-m', 'Allocate merge version')
            target['head']['sha'] = git('rev-parse', 'HEAD')
            self.assertEqual(release.merge_version('owner/repo', 22, base, validate=True), '0.0.1006')
            target['draft'] = True
            with self.assertRaisesRegex(ValueError, 'ready PR'):
                release.merge_version('owner/repo', 22, base)
            target['draft'] = False; target['head']['sha'] = 'e' * 40
            with self.assertRaisesRegex(ValueError, 'exact open'):
                release.merge_version('owner/repo', 22, base)
            target['head']['sha'] = git('rev-parse', 'HEAD'); target['base']['sha'] = 'f' * 40
            with self.assertRaisesRegex(ValueError, 'target moved'):
                release.merge_version('owner/repo', 22, base)
        self.assertTrue(any('contributor/fork/contents/manifest.json?ref=' + 'c' * 40 in path for path, _ in requests))

    def test_development_workflow_keeps_version_check_without_early_bump_requirement(self):
        workflow = (Path(__file__).resolve().parent.parent / '.github/workflows/release-provenance.yml').read_text()
        self.assertIn('  version:', workflow)
        self.assertIn('run: python3 scripts/github_release.py validate\n', workflow)
        self.assertNotIn('validate --base', workflow)

    def test_bump_updates_all_metadata_and_preserves_other_fields_and_history(self):
        history = {'2.45.81': '1.8.7', '0.0.999': '1.13.0', '0.0.1003': '1.13.0'}
        self.root.joinpath('versions.json').write_text(json.dumps(history))
        lock = json.loads(self.root.joinpath('package-lock.json').read_text())
        lock['packages']['node_modules/example'] = {'version': '7.0.0', 'integrity': 'preserved'}
        self.root.joinpath('package-lock.json').write_text(json.dumps(lock))
        with patch.object(release, 'base_version', return_value='0.0.1001'), patch.object(release, 'api') as api:
            self.assertEqual(release.bump_version('origin/main'), '0.0.1004')
            api.assert_not_called()
        self.assertEqual(release.version(), '0.0.1004')
        self.assertEqual(json.loads(self.root.joinpath('versions.json').read_text()), {**history, '0.0.1004': '1.13.0'})
        result = json.loads(self.root.joinpath('package-lock.json').read_text())
        self.assertEqual(result['packages']['node_modules/example'], lock['packages']['node_modules/example'])
        self.assertEqual(json.loads(self.root.joinpath('manifest.json').read_text())['minAppVersion'], '1.13.0')

    def test_bump_uses_real_git_target_and_rejects_invalid_target_before_writing(self):
        subprocess.run(['git', 'init', '--quiet', str(self.root)], check=True, capture_output=True)
        subprocess.run(['git', 'add', '.'], cwd=self.root, check=True, capture_output=True)
        subprocess.run(['git', '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid',
                        'commit', '--quiet', '-m', 'Synthetic base'], cwd=self.root, check=True, capture_output=True)
        before = {path: path.read_bytes() for path in self.root.glob('*.json')}
        with self.assertRaises(subprocess.CalledProcessError):
            release.bump_version('missing-target')
        self.assertEqual({path: path.read_bytes() for path in before}, before)
        self.assertEqual(release.bump_version('HEAD'), '0.0.1000')
        self.assertEqual(release.version('HEAD'), '0.0.1000')

    def test_nightly_creates_only_the_selected_tag_then_dispatches_its_build(self):
        with patch.object(release, 'tag_commit', return_value=None), patch.object(release, 'api', return_value=None) as api:
            release.prepare('owner/repo', '0.0.999', 'a' * 40)
            self.assertEqual(api.call_args_list[-2].kwargs['payload'], {'ref': 'refs/tags/0.0.999', 'sha': 'a' * 40})
            self.assertEqual(api.call_args.args[0], 'repos/owner/repo/actions/workflows/release-provenance.yml/dispatches')
            self.assertEqual(api.call_args.kwargs['payload'], {'ref': '0.0.999'})

    def test_nightly_skips_an_already_published_snapshot_without_dispatching(self):
        with patch.object(release, 'tag_commit', return_value='a' * 40), patch.object(release, 'find_release', return_value=self.draft(draft=False)), patch.object(release, 'api', return_value={'tag_name': '0.0.999'}) as api:
            release.prepare('owner/repo', '0.0.999', 'a' * 40)
            self.assertEqual(api.call_count, 1)
            self.assertNotIn('payload', api.call_args.kwargs)

    def test_nightly_retries_existing_tag_after_failed_dispatch_or_upload(self):
        for existing in [None, self.draft()]:
            with self.subTest(existing=existing), patch.object(release, 'tag_commit', return_value='a' * 40), patch.object(release, 'find_release', return_value=existing), patch.object(release, 'api', return_value=None) as api:
                release.prepare('owner/repo', '0.0.999', 'a' * 40)
                mutations = [call for call in api.call_args_list if 'payload' in call.kwargs]
                self.assertEqual(len(mutations), 1)
                self.assertTrue(mutations[0].args[0].endswith('/dispatches'))

    def test_nightly_refuses_reused_version_and_version_older_than_latest(self):
        with patch.object(release, 'tag_commit', return_value='b' * 40), patch.object(release, 'api') as api:
            with self.assertRaisesRegex(ValueError, 'another commit'):
                release.prepare('owner/repo', '0.0.999', 'a' * 40)
            api.assert_not_called()
        with patch.object(release, 'tag_commit', return_value=None), patch.object(release, 'api', return_value={'tag_name': '0.0.1000'}) as api:
            with self.assertRaisesRegex(ValueError, 'older than'):
                release.prepare('owner/repo', '0.0.999', 'a' * 40)
            self.assertEqual(api.call_count, 1)

    def test_prepare_accepts_only_scheduled_main_snapshot(self):
        for event, ref, checkout in [('push', 'refs/heads/main', 'a' * 40),
                                     ('workflow_dispatch', 'refs/heads/main', 'a' * 40),
                                     ('schedule', 'refs/heads/feature', 'a' * 40),
                                     ('schedule', 'refs/tags/0.0.999', 'a' * 40),
                                     ('schedule', 'refs/heads/main', 'b' * 40)]:
            with self.subTest(event=event, ref=ref, checkout=checkout), patch.dict(os.environ, {
                'GITHUB_REPOSITORY': 'owner/repo', 'GITHUB_SHA': 'a' * 40,
                'GITHUB_REF': ref, 'GITHUB_EVENT_NAME': event,
            }), patch.object(sys, 'argv', ['github_release.py', 'prepare']), patch.object(release, 'command', return_value=checkout), patch.object(release, 'prepare') as prepare:
                with self.assertRaises(ValueError):
                    release.main()
                prepare.assert_not_called()
        with patch.dict(os.environ, {
            'GITHUB_REPOSITORY': 'owner/repo', 'GITHUB_SHA': 'a' * 40,
            'GITHUB_REF': 'refs/heads/main', 'GITHUB_EVENT_NAME': 'schedule',
        }), patch.object(sys, 'argv', ['github_release.py', 'prepare']), patch.object(release, 'command', return_value='a' * 40), patch.object(release, 'prepare') as prepare:
            release.main()
            prepare.assert_called_once_with('owner/repo', '0.0.999', 'a' * 40)

    def test_publish_rejects_main_and_mismatched_tags_without_api_calls(self):
        for ref in ['refs/heads/main', 'refs/tags/0.0.998']:
            with self.subTest(ref=ref), patch.dict(os.environ, {
                'GITHUB_REPOSITORY': 'owner/repo', 'GITHUB_SHA': 'a' * 40, 'GITHUB_REF': ref,
            }), patch.object(sys, 'argv', ['github_release.py', 'publish']), patch.object(release, 'command', return_value='a' * 40), patch.object(release, 'api') as api:
                with self.assertRaisesRegex(ValueError, 'event ref'):
                    release.main()
                api.assert_not_called()

    def test_publish_accepts_only_the_exact_tagged_checkout(self):
        with patch.dict(os.environ, {
            'GITHUB_REPOSITORY': 'owner/repo', 'GITHUB_SHA': 'a' * 40, 'GITHUB_REF': 'refs/tags/0.0.999',
        }), patch.object(sys, 'argv', ['github_release.py', 'publish']), patch.object(release, 'command', return_value='a' * 40), patch.object(release, 'publish') as publish:
            release.main()
            publish.assert_called_once_with('owner/repo', '0.0.999', 'a' * 40)

    def test_release_rejects_invalid_versions_and_missing_compatibility_entries(self):
        self.root.joinpath('manifest.json').write_text(json.dumps({'version': 'unversioned', 'minAppVersion': '1.13.0'}))
        with self.assertRaises(ValueError):
            release.version()
        self.root.joinpath('manifest.json').write_text(json.dumps({'version': '0.0.999', 'minAppVersion': '1.13.0'}))
        self.root.joinpath('versions.json').write_text('{}')
        with self.assertRaisesRegex(ValueError, 'versions.json'):
            release.version()

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

    def test_draft_lookup_falls_back_to_the_authenticated_release_list(self):
        draft = {**self.draft(), 'tag_name': '0.0.999'}
        with patch.object(release, 'api', side_effect=[None, [draft]]) as api:
            self.assertEqual(release.find_release('owner/repo', '0.0.999'), draft)
            self.assertEqual(api.call_args.args[0], 'repos/owner/repo/releases?per_page=100&page=1')

    def test_draft_lookup_does_not_duplicate_or_hide_listing_errors(self):
        with patch.object(release, 'api', side_effect=[None, []]):
            self.assertIsNone(release.find_release('owner/repo', '0.0.999'))
        with patch.object(release, 'api', side_effect=[None, RuntimeError('Forbidden')]):
            with self.assertRaisesRegex(RuntimeError, 'Forbidden'):
                release.find_release('owner/repo', '0.0.999')

    def test_new_release_uploads_a_draft_before_publication(self):
        with patch.object(release, 'tag_commit', return_value='a' * 40), patch.object(release, 'find_release', side_effect=[None, self.draft()]), patch.object(release, 'api', return_value={'tag_name': '0.0.998'}), patch.object(release, 'command') as command:
            release.publish('owner/repo', '0.0.999', 'a' * 40)
            create, publish = [call.args for call in command.call_args_list]
            self.assertEqual(create[:4], ('gh', 'release', 'create', '0.0.999'))
            self.assertEqual(create[create.index('--title') + 1], 't3-obsidian 0.0.999')
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
