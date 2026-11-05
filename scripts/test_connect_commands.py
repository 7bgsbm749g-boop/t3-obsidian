import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
import uuid
from unittest.mock import patch
from scripts import connect_commands as transport

class ConnectCommandTests(unittest.TestCase):
    def ready(self, root, name='Synthetic', client=None, vault=None):
        client, vault = client or str(uuid.uuid4()), vault or str(uuid.uuid4())
        base = root / '.t3-obsidian/clients' / vault / client
        item = dict(version=1, vaultId=vault, vaultName=name, clientId=client, instanceId=str(uuid.uuid4()), token='a'*64, expiresAt=time.time()*1000+30_000, workspaceRoot=str(root), base=base.relative_to(root).as_posix(), vaultPath='/synthetic/vault')
        transport.atomic_text(base/'ready.json', json.dumps(item))
        return base, item

    def test_custom_t3_home_and_explicit_transport_root_are_respected(self):
        with patch.dict(transport.os.environ, {'T3CODE_HOME': '/synthetic/t3'}, clear=True):
            self.assertEqual(transport.default_root(), Path('/synthetic/t3/scratch'))
        with patch.dict(transport.os.environ, {'T3_OBSIDIAN_COMMAND_ROOT': '/synthetic/other'}, clear=True):
            self.assertEqual(transport.default_root(), Path('/synthetic/other'))

    def test_unicode_chunks_are_compatible_and_missing_or_changed_chunks_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'proposal.json'
            text = '😀漢字\n'*30_000
            transport.write_text(path, text)
            self.assertEqual(transport.read_text(path), text)
            manifest = json.loads(path.read_text())
            part = path.parent/(path.name+'.parts')/manifest['hash']/'0.txt'
            part.write_text('YWJj')
            with self.assertRaisesRegex(ValueError, 'changed'):
                transport.read_text(path)

    def test_client_selection_requires_exact_unexpired_identity_and_refuses_ambiguity(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory);base,item = self.ready(root)
            self.assertEqual(transport.select_client('Synthetic',root)[0],base)
            second,other = self.ready(root,vault=item['vaultId'])
            with self.assertRaisesRegex(ValueError,'More than one'):
                transport.select_client('Synthetic',root)
            self.assertEqual(transport.select_client('Synthetic',root,client_id=item['clientId'])[0],base)
            other['expiresAt']=0;transport.atomic_text(second/'ready.json',json.dumps(other))
            self.assertEqual(transport.select_client('/synthetic/vault',root)[0],base)
            item['workspaceRoot']='/wrong';transport.atomic_text(base/'ready.json',json.dumps(item))
            self.assertIsNone(transport.select_client('Synthetic',root))

    def test_acknowledged_requests_clean_only_their_files_and_timeout_reuses_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory);base,identity = self.ready(root)
            command = dict(version=1,id=str(uuid.uuid4()),kind='client-status')
            request=base/'requests'/(command['id']+'.json');marker=request.with_name(request.name+'.ready')
            result=base/'results'/(command['id']+'.json')
            sentinel=base/'keep.txt';sentinel.write_text('unrelated')
            def host():
                deadline=time.monotonic()+5
                while time.monotonic()<deadline:
                    if marker.exists():
                        raw=transport.read_text(request)
                        if marker.read_text()==transport.digest(raw):
                            envelope=json.loads(raw);self.assertEqual(envelope['clientId'],identity['clientId'])
                            transport.write_text(result,json.dumps(dict(version=1,id=command['id'],requestHash=transport.digest(raw),ok=True,client=dict(instanceId=identity['instanceId']))))
                            transport.atomic_text(marker,'consumed:'+transport.digest(raw));return
                    time.sleep(.01)
                self.fail('request did not arrive')
            worker=threading.Thread(target=host);worker.start()
            answer=transport.send_command('Synthetic',command,root=root,timeout=3);worker.join(5)
            self.assertTrue(answer['ok']);self.assertFalse(request.exists());self.assertFalse(result.exists());self.assertTrue(sentinel.exists())
            pending=transport.send_command('Synthetic',command,root=root,timeout=.01)
            self.assertTrue(pending['pending']);original=request.read_bytes()
            transport.send_command('Synthetic',command,root=root,timeout=.01)
            self.assertEqual(request.read_bytes(),original)
            with self.assertRaisesRegex(ValueError,'different input'):
                transport.send_command('Synthetic',{**command,'kind':'reload-client'},root=root,timeout=.01)

if __name__=='__main__': unittest.main()
