from pathlib import Path
from types import SimpleNamespace
import json
import tempfile
import unittest
from unittest.mock import patch
from scripts import release_history as history


def seed_value():
    columns=['Original version(s)','First new version (superseded)','Proposed 0.x.x','Alpha proposal (SemVer label only)','Obsidian numeric proposal (manifest/tag format)','Proposed release title','Milestone/build rationale','Date','Thread links','Concise change','Category / increment reason','Delivery / evidence status']
    def row(i):return {k: str(i) if k=='Original version(s)' else 'retained '+k for k in columns}
    return {'schemaVersion':1,'releaseRows':[row(i) for i in range(383)],'threadRows':[row(i) for i in range(478)],'counters':{'first':'24.8.10','zero':'0.111.10','build':377},'mirrors':[]}


class ReleaseHistoryTests(unittest.TestCase):
    def test_external_store_retains_history_and_existing_mirrors(self):
        external_temp = tempfile.TemporaryDirectory(); self.addCleanup(external_temp.cleanup)
        external = Path(external_temp.name)
        mirror = external / 'worktrees/old-task/version-audit-alpha'
        mirror.mkdir(parents=True)
        seed = seed_value(); seed['mirrors'] = [str(mirror)]
        self.seed.write_text(json.dumps(seed))
        (self.root / 'evidence').symlink_to(external, target_is_directory=True)
        with patch.object(history.maintainer_config, 'configuration', return_value={'canonicalRoot': str(self.root), 'evidenceRoot': str(external)}):
            self.refresh('0.0.377-alpha', seed=self.seed)
            self.assertTrue((external / 'version-history/history.json').is_file())
            self.assertTrue((mirror / 'RELEASE-LEDGER.csv').is_file())
            self.assertTrue((self.root / 'evidence').is_symlink())
            self.assertFalse(history.mirror_allowed(self.root, self.root))

    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        (self.root/'release-policy.json').write_text(json.dumps({'schemaVersion':1,'stage':'alpha','firstAlphaVersion':'0.0.377-alpha','transitionFrom':'2.45.81'}))
        self.seed=self.root/'seed.json';self.seed.write_text(json.dumps(seed_value()))
        self.release=SimpleNamespace(ROOT=self.root,archive_path=lambda version:self.root/'archives'/version,release_receipt_dir=lambda version:self.root/'receipts'/version)
        self.job=self.root/'job';self.request={'commit':'reviewed-source','bump':'none','summary':'Repository and alpha policy correction','threadId':'test-thread','createdAt':'2026-11-04T00:00:00Z'}

    def tearDown(self):self.temp.cleanup()

    def refresh(self,version,**kw):return history.refresh(self.release,self.job,self.request,version,**kw)

    def test_preserves_seed_and_all_types_while_retries_advance_delivery_status_only(self):
        first=self.refresh('0.0.377-alpha',seed=self.seed)
        self.assertEqual(first['counters'],seed_value()['counters']);self.assertEqual(first['status'],'assigned; packaging pending')
        archive=self.release.archive_path(first['version']);archive.parent.mkdir();archive.write_bytes(b'immutable candidate')
        self.assertEqual(self.refresh(first['version'])['status'],'packaged; installation unverified')
        receipt=self.release.release_receipt_dir(first['version']);receipt.mkdir(parents=True)
        (receipt/'deployment.json').write_text('{}');(receipt/'smoke-device.json').write_text('{"status":"complete"}')
        self.assertEqual(self.refresh(first['version'])['status'],'completed live smoke')
        state=history.read(self.root/'evidence/version-history/history.json')
        self.assertEqual(state['releaseRows'],seed_value()['releaseRows']);self.assertEqual(state['threadRows'],seed_value()['threadRows']);self.assertEqual(len(state['records']),1)
        text=(self.root/'evidence/version-history/RELEASE-LEDGER.md').read_text();self.assertIn('0.0.377-alpha',text);self.assertIn('t3-thread://v1/test-thread',text)
        archive.write_bytes(b'different bytes')
        with self.assertRaisesRegex(ValueError,'Immutable'):self.refresh(first['version'])

    def test_classification_and_alpha_counters_increment_once_per_assigned_release(self):
        self.refresh('0.0.377-alpha',seed=self.seed)
        self.request={**self.request,'commit':'second','bump':'minor'}
        second=self.refresh('0.0.378-alpha');self.assertEqual(second['counters'],{'first':'24.9.0','zero':'0.112.0','build':378})
        self.assertEqual(self.refresh('0.0.378-alpha')['counters'],second['counters'])
        self.request={**self.request,'commit':'third','bump':'major'}
        third=self.refresh('0.0.379-alpha');self.assertEqual(third['counters'],{'first':'25.0.0','zero':'0.113.0','build':379})
        self.request={**self.request,'commit':'fourth','bump':'none'}
        self.assertEqual(self.refresh('0.0.380-alpha')['counters'],{'first':'25.0.0','zero':'0.113.0','build':380})
        with self.assertRaises(ValueError):self.refresh('0.0.376-alpha')

    def test_missing_seed_is_refused_and_legacy_receipts_do_not_add_alpha_rows(self):
        with self.assertRaisesRegex(ValueError,'reviewed seed'):self.refresh('0.0.377-alpha')
        self.assertIsNone(self.refresh('2.45.81'))
        self.assertFalse((self.root/'evidence/version-history/history.json').exists())

    def test_numeric_format_preserves_old_rows_and_continues_every_comparison(self):
        import csv
        original_request = dict(self.request)
        self.refresh('0.0.377-alpha', seed=self.seed)
        table = self.root / 'evidence/version-history/RELEASE-LEDGER.csv'
        with table.open(newline='') as stream:
            before = list(csv.DictReader(stream))
        path = self.root / 'release-policy.json'
        path.write_text(json.dumps({**history.read(path), 'versionFormat': '0.0.BUILD'}))
        self.request = {**self.request, 'commit': 'numeric-release', 'bump': 'minor'}
        record = self.refresh('0.0.378')
        self.assertEqual(record['counters'], {'first': '24.9.0', 'zero': '0.112.0', 'build': 378})
        self.assertEqual(record['releaseTitle'], 't3-obsidian 0.0.378')
        self.assertEqual(self.refresh('0.0.378')['counters'], record['counters'])
        history.refresh(self.release, self.job, original_request, '0.0.377-alpha')
        with table.open(newline='') as stream:
            after = list(csv.DictReader(stream))
        self.assertEqual(after[:-1], before)
        self.assertEqual(after[-1]['Alpha proposal (SemVer label only)'], '0.1.0-alpha.378')
        self.assertEqual(after[-1]['Obsidian numeric proposal (manifest/tag format)'], '0.0.378')
        self.assertIn('`0.0.BUILD`', table.with_suffix('.md').read_text())
        self.assertEqual(len(history.read(self.root / 'evidence/version-history/history.json')['records']), 2)
