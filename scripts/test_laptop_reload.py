import subprocess
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
    def setUp(self):
        self.runtime = patch.object(reload, 'installed_runtime', side_effect=lambda config: self.release)
        self.runtime.start()
        self.addCleanup(self.runtime.stop)
        self.release = {}

    def test_acknowledgement_is_not_loaded_version_proof_and_retries_preserve_the_reload_id(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(reload, 'STATE', Path(directory)):
            config = {'host': 'laptop', 'vault': r'C:\Vault'}
            release = {'version': '3.4.5', 'hashes': {n: 'a' * 64 for n in reload.RUNTIME}}
            self.release = release
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
            self.release = {'version': '3.4.5', 'hashes': {}}
            result = reload.attempt({'host': 'laptop', 'vault': 'vault'}, {'version': '3.4.5', 'hashes': {}}, state)
            self.assertEqual(result['status'], 'pending')

    def test_alpha_receipt_is_newer_in_the_approved_lineage_and_bootstraps_old_client(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); (root / 'release-policy.json').write_text(json.dumps({'schemaVersion':1,'stage':'alpha','firstAlphaVersion':'0.0.377-alpha','transitionFrom':'2.45.81'}))
            receipts=root/'receipts'; receipts.mkdir()
            for version in ['2.45.81','0.0.377-alpha','0.0.378-alpha']:
                path=receipts/version/'deployment.json'; path.parent.mkdir(); path.write_text(json.dumps({'version':version,'status':'awaiting-live-smoke','releaseFileSha256':{n:'a'*64 for n in reload.RUNTIME}}))
            with patch.object(reload,'ROOT',root),patch.object(reload,'RECEIPTS',receipts),patch.object(reload,'STATE',root):
                self.assertEqual(reload.latest_release()['version'],'0.0.378-alpha')
                calls=[]
                def mailbox(config, command, **kwargs):
                    calls.append(command)
                    return {'ok':True,'client':{'loadedVersion':'2.45.81','instanceId':'old'}} if command['kind']=='client-status' else {'ok':True,'reloadScheduled':True}
                with patch.object(reload,'mailbox',mailbox):
                    self.release = {'version':'0.0.377-alpha','hashes':{}}
                    result=reload.attempt({'host':'laptop','vault':'vault'},{'version':'0.0.377-alpha','hashes':{}},{})
                self.assertEqual(result['status'],'pending');self.assertEqual(calls[-1]['releaseVersion'],'2.45.81')

    def test_latest_published_release_coalesces_offline_updates(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(reload, 'RECEIPTS', Path(directory)):
            for version in ['3.4.5', '3.4.6', '3.4.7']:
                path = Path(directory) / version / 'deployment.json'
                path.parent.mkdir()
                path.write_text(json.dumps({'version': version, 'status': 'awaiting-live-smoke', 'releaseFileSha256': {n: 'a' * 64 for n in reload.RUNTIME}}))
            self.assertEqual(reload.latest_release()['version'], '3.4.7')

    def test_numeric_alpha_receipt_wins_and_uses_exact_numeric_reload_target(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'release-policy.json').write_text(json.dumps({'schemaVersion': 1, 'stage': 'alpha', 'versionFormat': '0.0.BUILD', 'firstAlphaVersion': '0.0.377-alpha', 'transitionFrom': '2.45.81'}))
            receipts = root / 'receipts'
            for version in ['2.45.81', '0.0.381-alpha', '0.0.382']:
                path = receipts / version / 'deployment.json'; path.parent.mkdir(parents=True)
                path.write_text(json.dumps({'version': version, 'status': 'awaiting-live-smoke', 'releaseFileSha256': {n: 'a' * 64 for n in reload.RUNTIME}}))
            calls = []
            def mailbox(config, command, **kwargs):
                calls.append(command)
                return {'ok': True, 'client': {'loadedVersion': '2.45.81', 'instanceId': 'legacy'}} if command['kind'] == 'client-status' else {'ok': True, 'reloadScheduled': True}
            with patch.object(reload, 'ROOT', root), patch.object(reload, 'RECEIPTS', receipts), patch.object(reload, 'STATE', root), patch.object(reload, 'mailbox', mailbox):
                latest = reload.latest_release()
                self.release = latest
                self.assertEqual(latest['version'], '0.0.382')
                self.assertEqual(reload.attempt({'host': 'laptop', 'vault': 'vault'}, latest, {})['status'], 'pending')
                self.assertEqual(calls[-1]['releaseVersion'], '0.0.382')

    def test_sync_must_deliver_all_three_exact_runtime_files_before_reload(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(reload, 'STATE', Path(directory)):
            release = {'version':'0.0.400','hashes':{n:'a'*64 for n in reload.RUNTIME}}
            for installed in [{}, {'version':'0.0.400','hashes':{**release['hashes'],'styles.css':'b'*64}}]:
                self.release = installed
                calls = []
                def mailbox(config, command, **kwargs):
                    calls.append(command)
                    return {'ok':True,'client':{'loadedVersion':'0.0.399','instanceId':'old'}}
                with patch.object(reload,'mailbox',mailbox):
                    result = reload.attempt({'host':'laptop','vault':'vault'},release,{})
                self.assertEqual(result['status'],'pending')
                self.assertIn('runtime files', result['reason'])
                self.assertFalse(any(c['kind']=='reload-client' for c in calls))

    def test_completed_stale_reload_gets_one_new_request_only_after_a_new_instance(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(reload, 'STATE', Path(directory)):
            self.release = {'version':'0.0.400','hashes':{}}
            state = {'beforeInstanceId':'first','reloadId':'completed-first-reload'}
            requests = []
            instance = 'second'
            def mailbox(config, command, **kwargs):
                if command['kind']=='client-status':
                    return {'ok':True,'client':{'loadedVersion':'0.0.399','instanceId':instance}}
                requests.append(command['id'])
                return {'ok':True,'reloadScheduled':True}
            with patch.object(reload, 'mailbox', mailbox):
                result = reload.attempt({'host':'laptop','vault':'vault'},self.release,state)
                self.assertEqual(result['beforeInstanceId'],'second')
                self.assertNotEqual(result['reloadId'],'completed-first-reload')
                reload.attempt({'host':'laptop','vault':'vault'},self.release,result)
                instance = 'third'
                refused = reload.attempt({'host':'laptop','vault':'vault'},self.release,result)
                self.assertIn('inspection is required', refused['reason'])
            self.assertEqual(requests,[result['reloadId']]*2)


if __name__ == '__main__':
    unittest.main()

class LaptopSshTransportTests(unittest.TestCase):
    def test_direct_python_avoids_nested_powershell_stdin_and_preserves_request_identity(self):
        calls = []
        def run(argv, **kwargs):
            calls.append((argv, kwargs))
            return subprocess.CompletedProcess(argv, 0, stdout='{"ok":true,"client":{"loadedVersion":"0.0.399"}}', stderr='')
        command = {'version': 1, 'id': 'fixed-command-id', 'kind': 'client-status'}
        with patch.object(reload, 'connected_command', return_value=None), patch.object(reload.subprocess, 'run', side_effect=run):
            result = reload.mailbox({'host': 'laptop', 'vault': r'C:\Vault'}, command)
        self.assertTrue(result['ok'])
        self.assertEqual(len(calls), 1)
        self.assertIn('python.exe -c', calls[0][0][-1])
        self.assertNotIn('ReadToEnd', calls[0][0][-1])
        self.assertIn('fixed-command-id', __import__('base64').b64decode(calls[0][1]['input'].split("_p=json.loads(base64.b64decode('")[1].split("'")[0]).decode())
        self.assertEqual(calls[0][1]['timeout'], 15)

    def test_old_client_uses_a_small_encoded_legacy_probe_only_after_no_connected_client(self):
        calls = []
        def run(argv, **kwargs):
            calls.append((argv, kwargs))
            return subprocess.CompletedProcess(argv, 0, stdout='null' if len(calls) == 1 else '{"ok":false,"pending":true}', stderr='')
        with patch.object(reload, 'connected_command', return_value=None), patch.object(reload.subprocess, 'run', side_effect=run):
            result = reload.mailbox({'host': 'laptop', 'vault': r'C:\Vault'}, {'id':'fixed','kind':'client-status'})
        self.assertTrue(result['pending'])
        self.assertEqual(len(calls), 2)
        self.assertNotIn('input', calls[1][1])
        self.assertIn('-EncodedCommand', calls[1][0][-1])
        self.assertLess(len(calls[1][0][-1]), 20000)
