import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('native_laptop_reload', Path(__file__).with_name('laptop-reload.py'))
reload = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reload)


class LaptopReloadTests(unittest.TestCase):
    def test_acknowledgement_is_not_loaded_version_proof_and_retries_preserve_the_reload_id(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(reload, 'STATE', Path(directory)):
            config = {'host': 'laptop', 'vault': r'C:\Vault'}
            release = {'version': '3.4.5', 'hashes': {n: 'a' * 64 for n in reload.RUNTIME}}
            state = {'release': release, 'target': config}
            calls = []
            def mailbox(config, command, **kwargs):
                calls.append(command)
                if command['kind'] == 'client-status':
                    return {'ok': True, 'client': {'loadedVersion': '3.4.4', 'instanceId': 'old'}}
                return {'ok': True, 'reloadScheduled': True}
            with patch.object(reload, 'mailbox', mailbox):
                result = reload.attempt(config, release, state)
                self.assertEqual(result['status'], 'pending')
                second = reload.attempt(config, release, result)
                self.assertEqual(second['reloadId'], result['reloadId'])
                self.assertEqual([c['id'] for c in calls if c['kind'] == 'reload-client'], [result['reloadId']] * 2)
            with patch.object(reload, 'mailbox', return_value={'ok': True, 'client': {'loadedVersion': '3.4.5', 'instanceId': 'new'}}):
                self.assertEqual(reload.attempt(config, release, result)['status'], 'complete')

    def test_same_instance_is_not_confirmation_of_a_requested_reload(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(reload, 'STATE', Path(directory)), patch.object(reload, 'mailbox', return_value={'ok': True, 'client': {'loadedVersion': '3.4.5', 'instanceId': 'old'}}):
            state = {'beforeInstanceId': 'old'}
            result = reload.attempt({'host': 'laptop', 'vault': 'vault'}, {'version': '3.4.5', 'hashes': {}}, state)
            self.assertEqual(result['status'], 'pending')

    def test_latest_published_release_coalesces_offline_updates(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(reload, 'RECEIPTS', Path(directory)):
            for version in ['3.4.5', '3.4.6', '3.4.7']:
                path = Path(directory) / version / 'deployment.json'
                path.parent.mkdir()
                path.write_text(json.dumps({'version': version, 'status': 'awaiting-live-smoke', 'releaseFileSha256': {n: 'a' * 64 for n in reload.RUNTIME}}))
            self.assertEqual(reload.latest_release()['version'], '3.4.7')


if __name__ == '__main__':
    unittest.main()
