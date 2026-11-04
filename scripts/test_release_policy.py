import json
from pathlib import Path
import tempfile
import unittest
from scripts import release_policy as policy


class AlphaPolicyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / 'release-policy.json').write_text(json.dumps({'schemaVersion': 1, 'stage': 'alpha', 'firstAlphaVersion': '0.0.377-alpha', 'transitionFrom': '2.45.81'}))

    def tearDown(self):
        self.temp.cleanup()

    def test_exact_approved_transition_and_monotonic_alpha_releases(self):
        self.assertTrue(policy.newer(self.root, '0.0.377-alpha', '2.45.81'))
        self.assertFalse(policy.newer(self.root, '0.0.378-alpha', '2.45.81'))
        self.assertFalse(policy.newer(self.root, '0.0.377-alpha', '2.45.80'))
        self.assertTrue(policy.newer(self.root, '0.0.378-alpha', '0.0.377-alpha'))
        self.assertFalse(policy.newer(self.root, '0.0.377-alpha', '0.0.378-alpha'))
        self.assertFalse(policy.newer(self.root, '0.0.377-alpha', '0.0.377-alpha'))
        self.assertTrue(policy.newer(self.root, '0.0.377-alpha', '0.0.377-alpha', allow_equal=True))

    def test_all_change_kinds_stay_alpha_until_explicit_policy_graduation(self):
        for kind in ['patch', 'minor', 'major', 'none']:
            self.assertEqual(policy.bump(self.root, '2.45.81', kind), '0.0.377-alpha')
            self.assertEqual(policy.bump(self.root, '0.0.377-alpha', kind), '0.0.378-alpha')
        for version in ['1.0.0', '0.1.0', '0.0.378']:
            with self.assertRaises(ValueError):policy.require_target(self.root, version)
        for version in ['0.0.0377-alpha', '0.0.377-alpha.1', '0.1.377-alpha', '0.0.377-beta', 'v0.0.377-alpha']:
            with self.assertRaises(ValueError):policy.parse(version)

    def test_receipt_order_and_legacy_reload_bootstrap_keep_target_proof_separate(self):
        self.assertGreater(policy.order_key(self.root, '0.0.377-alpha'), policy.order_key(self.root, '2.45.81'))
        self.assertEqual(policy.reload_request_version(self.root, '0.0.377-alpha', '2.45.81'), '2.45.81')
        self.assertEqual(policy.reload_request_version(self.root, '0.0.378-alpha', '0.0.377-alpha'), '0.0.378-alpha')
        self.assertEqual(policy.reload_request_version(self.root, '0.0.377-alpha', '2.45.80'), '2.45.80')

        self.assertEqual(policy.reload_request_version(self.root, '0.0.378-alpha', '2.45.55'), '2.45.55')
