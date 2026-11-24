import base64
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
import merge_versions as versions


def metadata():
    return {'manifest.json': {'version': '0.0.999', 'minAppVersion': '1.13.0', 'name': 'Synthetic'},
            'package.json': {'version': '0.0.999', 'dependencies': {'keep': '1'}},
            'package-lock.json': {'version': '0.0.999', 'packages': {'': {'version': '0.0.999'}, 'keep': {'version': '1'}}},
            'versions.json': {'0.0.999': '1.13.0', '0.0.1002': '1.13.0'},
            versions.LEDGER: {'schemaVersion': 1, 'since': '2026-11-16T12:00:00Z', 'pullRequests': {}},
            'src/source.ts': 'Preserve this source'}


def pr(number, merged='2026-11-16T12:01:00Z'):
    return {'number': number, 'merged_at': merged, 'merge_commit_sha': hashlib.sha1(str(number).encode()).hexdigest(),
            'base': {'ref': 'main'}}


class FakeGitHub:
    def __init__(self):
        self.head = 'a' * 40
        self.states = {self.head: metadata()}
        self.closed = [pr(9, '2026-11-16T11:00:00Z'), pr(10, None), pr(13), pr(12)]
        self.open = [{'number': 14, 'head': {'repo': {'full_name': 'contributor/fork'}, 'sha': 'f' * 40}}]
        self.blobs = {}; self.trees = {}; self.parents = {}; self.stamps = []
        self.mode = None; self.mutations = []; self.serial = 0; self.unreachable = set()

    def identity(self):
        self.serial += 1
        return hashlib.sha1(str(self.serial).encode()).hexdigest()

    def api(self, path, *, payload=None, method=None, **_kwargs):
        if payload is not None:self.mutations.append((path, copy.deepcopy(payload), method))
        if path.endswith('/git/ref/heads/main'):return {'object': {'sha': self.head}}
        if '/contents/' in path:
            name, source = path.split('/contents/')[1].split('?ref=')
            value = {'version': '0.0.1004'} if 'contributor/fork' in path else self.states[source][name]
            raw = json.dumps(value).encode()
            return {'type': 'file', 'encoding': 'base64', 'size': len(raw), 'content': base64.b64encode(raw).decode()}
        if '/pulls?state=closed' in path:return copy.deepcopy(self.closed)
        if '/pulls?state=open' in path:return copy.deepcopy(self.open)
        if '/compare/' in path:
            merge = path.split('/compare/')[1].split('...')[0]
            return {'status': 'behind' if merge in self.unreachable else 'ahead'}
        if '/tags?' in path:return [{'name': '0.0.1005'}, {'name': '0.0.377-alpha'}]
        if '/commits?sha=' in path:
            if 'per_page=100' in path:return [{'sha': 'a' * 40, 'commit': {'committer': {'date': '2026-11-16T12:00:00Z'}}}]
            return [{'sha': self.stamps[-1]}]
        if '/commits/' in path and path.endswith('/pulls?per_page=100&page=1'):return [pr(12)]
        if '/git/commits/' in path:return {'tree': {'sha': path.rsplit('/', 1)[1]}}
        if path.endswith('/git/blobs'):
            key = self.identity(); self.blobs[key] = json.loads(base64.b64decode(payload['content']))
            return {'sha': key}
        if path.endswith('/git/trees'):
            key = self.identity(); values = copy.deepcopy(self.states[payload['base_tree']])
            assert {row['path'] for row in payload['tree']} == set(versions.FILES)
            for row in payload['tree']:values[row['path']] = copy.deepcopy(self.blobs[row['sha']])
            self.trees[key] = values
            return {'sha': key}
        if path.endswith('/git/commits'):
            key = self.identity(); self.parents[key] = payload['parents']
            self.states[key] = copy.deepcopy(self.trees[payload['tree']])
            return {'sha': key}
        if path.endswith('/git/refs/heads/main'):
            assert method == 'PATCH' and payload['force'] is False
            if self.mode == 'permission':raise RuntimeError('Forbidden (HTTP 403)')
            if self.mode in ('race', 'race-every'):
                raced = self.identity(); self.states[raced] = copy.deepcopy(self.states[self.head])
                self.states[raced]['src/new.ts'] = 'Concurrent merge must survive'
                self.head = raced
                if self.mode == 'race':self.mode = None
            if self.parents[payload['sha']] != [self.head]:
                raise RuntimeError('Update is not a fast forward (HTTP 422)')
            self.head = payload['sha']; self.stamps.append(self.head)
            if self.mode == 'ambiguous':
                self.mode = None
                raise RuntimeError('Response lost after submission')
            return {'object': {'sha': self.head}}
        raise AssertionError(path)


class AutomaticVersionTests(unittest.TestCase):
    def setUp(self):
        self.github = FakeGitHub()
        self.patch = patch.object(release, 'api', side_effect=self.github.api)
        self.patch.start(); self.addCleanup(self.patch.stop)

    def test_two_fast_merges_get_distinct_versions_in_merge_order_without_source_changes(self):
        result = versions.assign('owner/repo')
        self.assertEqual([(row['pr'], row['version']) for row in result['assignments']], [(12, '0.0.1006'), (13, '0.0.1007')])
        values = self.github.states[self.github.head]
        self.assertEqual(release.metadata_version(values), '0.0.1007')
        self.assertEqual(values['package.json']['dependencies'], {'keep': '1'})
        self.assertEqual(values['src/source.ts'], 'Preserve this source')
        self.assertEqual(set(values[versions.LEDGER]['pullRequests']), {'12', '13'})
        for row in result['assignments']:
            state = self.github.states[row['commit']]
            self.assertEqual(state[versions.LEDGER]['latest']['pr'], row['pr'])
            self.assertEqual(state[versions.LEDGER]['latest']['source'], self.github.parents[row['commit']][0])
        self.assertEqual(len(self.github.stamps), 2)

    def test_interrupted_release_is_retried_before_the_next_merge_is_assigned(self):
        attempts = []
        def prepare(repo, version, commit):
            attempts.append((version, commit))
            self.assertEqual(self.github.states[commit][versions.LEDGER]['latest']['version'], version)
            if len(attempts) == 1:
                raise RuntimeError('dispatch interrupted')
        with self.assertRaisesRegex(RuntimeError, 'dispatch interrupted'):
            versions.assign('owner/repo', prepare)
        self.assertEqual(len(self.github.stamps), 1)
        versions.assign('owner/repo', prepare)
        self.assertEqual(attempts, [('0.0.1006', self.github.stamps[0])]*2 +
                         [('0.0.1007', self.github.stamps[1])])

    def test_merge_event_supplies_pr_before_closed_list_is_indexed(self):
        self.github.closed = [pr(12, None)]
        result = versions.assign('owner/repo', merged_event=pr(12))
        self.assertEqual([row['pr'] for row in result['assignments']], [12])

    def test_rerun_is_idempotent_and_does_not_consume_another_number(self):
        first = versions.assign('owner/repo'); mutations = len(self.github.mutations)
        second = versions.assign('owner/repo')
        self.assertEqual(second['assignments'], [])
        self.assertEqual(second['source'], first['source'])
        self.assertEqual(second['version'], first['version'])
        self.assertEqual(len(self.github.mutations), mutations)

    def test_concurrent_merge_rejects_old_commit_and_preserves_new_source_on_retry(self):
        self.github.mode = 'race'
        result = versions.assign('owner/repo')
        self.assertEqual(self.github.states[self.github.head]['src/new.ts'], 'Concurrent merge must survive')
        self.assertEqual([row['version'] for row in result['assignments']], ['0.0.1006', '0.0.1007'])
        self.assertEqual(len(self.github.stamps), 2)

    def test_lost_response_stops_and_later_reconciliation_does_not_double_assign(self):
        self.github.mode = 'ambiguous'
        with self.assertRaisesRegex(RuntimeError, 'Response lost'):
            versions.assign('owner/repo')
        self.assertEqual(len(self.github.stamps), 1)
        result = versions.assign('owner/repo')
        self.assertEqual([(row['pr'], row['version']) for row in result['assignments']], [(13, '0.0.1007')])
        self.assertEqual(len(self.github.stamps), 2)

    def test_repeated_concurrent_updates_have_a_bounded_retry_limit(self):
        self.github.mode = 'race-every'
        with self.assertRaisesRegex(RuntimeError, 'not a fast forward'):
            versions.assign('owner/repo')
        self.assertEqual(self.github.stamps, [])
        self.assertEqual(sum(path.endswith('/git/refs/heads/main') for path, _, _ in self.github.mutations), 5)

    def test_permission_failure_never_changes_main_or_retries_mutations(self):
        self.github.mode = 'permission'; before = self.github.head
        with self.assertRaisesRegex(RuntimeError, 'Forbidden'):
            versions.assign('owner/repo')
        self.assertEqual(self.github.head, before)
        self.assertEqual(self.github.stamps, [])
        self.assertEqual(sum(path.endswith('/git/refs/heads/main') for path, _, _ in self.github.mutations), 1)

    def test_late_merge_is_deferred_and_reconciliation_pins_last_completed_assignment(self):
        self.github.closed = [pr(12)]
        first = versions.assign('owner/repo')
        self.github.closed.append(pr(13)); self.github.unreachable.add(pr(13)['merge_commit_sha'])
        source = self.github.identity(); self.github.states[source] = copy.deepcopy(self.github.states[self.github.head]); self.github.head = source
        deferred = versions.assign('owner/repo')
        self.assertEqual(deferred['source'], first['source'])
        self.assertEqual(deferred['assignments'], [])
        self.github.unreachable.clear()
        self.assertEqual(versions.assign('owner/repo')['assignments'][0]['pr'], 13)

    def test_read_failure_prevents_all_assignment_writes(self):
        with patch.object(release, 'remote_json', side_effect=RuntimeError('Cannot read version claim')):
            with self.assertRaisesRegex(RuntimeError, 'Cannot read'):
                versions.assign('owner/repo')
        self.assertEqual(self.github.mutations, [])

    def test_unmerged_and_historical_prs_do_not_receive_new_versions(self):
        self.github.closed = [pr(9, '2026-11-16T11:00:00Z'), pr(10, None)]
        with self.assertRaisesRegex(ValueError, 'No completed'):
            versions.assign('owner/repo')
        self.assertEqual(self.github.mutations, [])

    def test_cutover_uses_actual_introduction_merge_not_development_time(self):
        self.github.states[self.github.head][versions.LEDGER]['since'] = None
        self.github.closed.insert(0, pr(11, '2026-11-16T12:00:30Z'))
        result = versions.assign('owner/repo')
        self.assertEqual([row['pr'] for row in result['assignments']], [12, 13])
        ledger = self.github.states[self.github.head][versions.LEDGER]
        self.assertEqual(ledger['since'], pr(12)['merged_at'])
        self.assertEqual(ledger['startCommit'], pr(12)['merge_commit_sha'])


class VersionSnapshotTests(unittest.TestCase):
    def test_only_real_metadata_commit_can_be_released(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            def git(*args):return subprocess.check_output(['git', *args], cwd=root, text=True).strip()
            values = metadata()
            for name in versions.FILES:(root / name).write_text(json.dumps(values[name]))
            (root / 'source.txt').write_text('Original')
            git('init', '--quiet'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid')
            git('add', '.'); git('commit', '--quiet', '-m', 'Merged source')
            git('branch', '-M', 'main')
            parent = git('rev-parse', 'HEAD')
            release.set_version(values, '0.0.1006')
            values[versions.LEDGER]['pullRequests']['12'] = {'version': '0.0.1006', 'mergeCommit': 'b' * 40}
            values[versions.LEDGER]['latest'] = {'pr': 12, 'version': '0.0.1006', 'source': parent}
            for name in versions.FILES:(root / name).write_text(json.dumps(values[name]))
            git('add', '.'); git('commit', '--quiet', '-m', 'Assign version')
            with patch.object(release, 'ROOT', root):
                with tempfile.TemporaryDirectory() as runner_path:
                    runner = Path(runner_path)
                    subprocess.run(['git', 'init', '--quiet', runner_path], check=True)
                    subprocess.run(['git', 'remote', 'add', 'origin', directory], cwd=runner, check=True)
                    subprocess.run(['git', 'fetch', '--quiet', 'origin', parent], cwd=runner, check=True)
                    subprocess.run(['git', 'checkout', '--quiet', '--detach', parent], cwd=runner, check=True)
                    stamp = git('rev-parse', 'HEAD')
                    with patch.object(release, 'ROOT', runner), patch.object(release, 'prepare') as dispatch:
                        versions.prepare_completed('owner/repo', '0.0.1006', stamp)
                        dispatch.assert_called_once_with('owner/repo', '0.0.1006', stamp)
                    self.assertEqual(subprocess.check_output(['git','rev-parse','HEAD'],cwd=runner,text=True).strip(), parent)
                versions.versioned_snapshot(root, git('rev-parse', 'HEAD'))
                (root / 'source.txt').write_text('Another merge without assignment')
                git('add', '.'); git('commit', '--quiet', '-m', 'Unnumbered source')
                with self.assertRaisesRegex(ValueError, 'metadata commit'):
                    versions.versioned_snapshot(root, git('rev-parse', 'HEAD'))

    def test_duplicate_receipts_are_rejected(self):
        value = metadata()[versions.LEDGER]
        value['pullRequests'] = {'12': {'version': '0.0.1006', 'mergeCommit': 'a' * 40},
                                 '13': {'version': '0.0.1006', 'mergeCommit': 'b' * 40}}
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            versions.ledger_state(value)

    def test_actions_ref_guard_and_outputs(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {
            'GITHUB_REPOSITORY': 'owner/repo', 'GITHUB_EVENT_NAME': 'push', 'GITHUB_REF': 'refs/heads/main',
            'GITHUB_OUTPUT': str(Path(directory) / 'output')
        }), patch.object(versions, 'assign', return_value={'source': 'a' * 40, 'version': '0.0.1006'}) as assign:
            versions.main()
            self.assertIn('source=' + 'a' * 40, (Path(directory) / 'output').read_text())
            for event, ref in [('pull_request', 'refs/heads/main'), ('workflow_dispatch', 'refs/heads/feature')]:
                with patch.dict(os.environ, {'GITHUB_EVENT_NAME': event, 'GITHUB_REF': ref}):
                    with self.assertRaisesRegex(ValueError, 'only for main'):
                        versions.main()
            assign.assert_called_once_with('owner/repo', versions.prepare_completed, None)

    def test_only_closed_merged_events_from_this_base_feed_reconciliation(self):
        row = pr(12)
        row.update(merged=True, base={'ref':'main', 'repo':{'full_name':'owner/repo'}})
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {
            'GITHUB_EVENT_PATH':str(Path(directory)/'event'), 'GITHUB_REF':'refs/heads/main',
            'GITHUB_EVENT_NAME':'pull_request_target', 'GITHUB_REPOSITORY':'owner/repo'
        }), patch.object(versions, 'assign', return_value={'source':'a'*40,'version':'0.0.1006'}) as assign:
            path = Path(os.environ['GITHUB_EVENT_PATH'])
            path.write_text(json.dumps({'action':'closed','pull_request':row}))
            versions.main()
            assign.assert_called_once_with('owner/repo',versions.prepare_completed,row)
            row['merged']=False
            path.write_text(json.dumps({'action':'closed','pull_request':row}))
            with self.assertRaisesRegex(ValueError,'Expected a merged PR'):
                versions.main()
    def test_latest_receipt_must_match_the_recorded_version(self):
        value = metadata()[versions.LEDGER]
        value['pullRequests']['12'] = {'version': '0.0.1006', 'mergeCommit': 'a' * 40}
        value['latest'] = {'pr': 12, 'version': '0.0.1007', 'source': 'b' * 40}
        with self.assertRaisesRegex(ValueError, 'latest PR version'):
            versions.ledger_state(value)

    def test_post_merge_assignment_can_dispatch_release_builds(self):
        root = Path(__file__).resolve().parent.parent
        assignment = (root / '.github/workflows/pr-versions.yml').read_text()
        release_flow = (root / '.github/workflows/release-provenance.yml').read_text()
        for setting in ['group: main-version-metadata', 'queue: max', 'actions: write',
                        'branches: [main]', 'workflow_dispatch:', 'pull_request_target:', 'types: [closed]',
                        'fetch-depth: 0', 'ref: main', 'cancel-in-progress: false', 'pull-requests: read',
                        'GH_TOKEN: ${{ github.token }}', 'python3 scripts/merge_versions.py']:
            self.assertIn(setting, assignment)
        self.assertNotIn('schedule:', release_flow)
        self.assertIn('group: public-plugin-release', release_flow)
        versions.ledger_state(json.loads((root / versions.LEDGER).read_text()))


if __name__ == '__main__':
    unittest.main()
