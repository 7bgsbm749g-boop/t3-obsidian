import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'scripts'))
spec = importlib.util.spec_from_file_location('agent_mcp', ROOT / 'agent/mcp_server.py')
mcp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mcp)


class AgentMcpTests(unittest.TestCase):
    def test_tools_send_exact_checked_commands_and_return_pending_uuid(self):
        with patch.object(mcp, 'send_command', return_value={'ok': False, 'pending': True, 'id': 'preserved'}) as send:
            result = mcp.call_tool('submit_note_edit', dict(vault='Lab', requestId='73e8f114-bf46-49e7-9560-482ed8128c5f', editId='edit', originalHash='hash', proposed='synthetic text'), '/test/scratch')
        self.assertTrue(result['isError'])
        self.assertTrue(json.loads(result['content'][0]['text'])['pending'])
        call = send.call_args
        self.assertEqual(call.args[1], dict(version=1, id='73e8f114-bf46-49e7-9560-482ed8128c5f', kind='submit-note-edit', editId='edit', originalHash='hash', proposed='synthetic text'))
        self.assertEqual(call.kwargs['root'], '/test/scratch')
        with self.assertRaises(ValueError):
            mcp.call_tool('create_note', dict(vault='Lab', notePath='A.md', proposed='x', token='exfiltrate'), '/test')

    def test_client_listing_never_returns_capability_tokens(self):
        with patch.object(mcp, 'select_client', return_value=[(Path('/test'), dict(vaultName='Lab', clientId='client', token='secret'))]):
            result = mcp.call_tool('connected_clients', dict(vault='Lab'), '/test')
        self.assertNotIn('secret', json.dumps(result))
        self.assertNotIn('token', json.dumps(result))

    def test_source_only_fresh_install_serves_real_stdio_protocol_and_skill(self):
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory)
            shutil.copy(ROOT / 'agent/mcp_server.py', destination)
            shutil.copy(ROOT / 'scripts/connect_commands.py', destination)
            shutil.copy(ROOT / 'skills/obsidian-t3/SKILL.md', destination)
            messages = [dict(jsonrpc='2.0', id=1, method='initialize', params=dict(protocolVersion='2025-11-25', capabilities={}, clientInfo=dict(name='test', version='1'))),
                        dict(jsonrpc='2.0', method='notifications/initialized'), dict(jsonrpc='2.0', id=2, method='tools/list'),
                        dict(jsonrpc='2.0', id=3, method='resources/read', params=dict(uri=mcp.URI)),
                        dict(jsonrpc='2.0', id=4, method='tools/call', params=dict(name='client_status', arguments=dict(vault='Synthetic')))]
            result = subprocess.run([sys.executable, str(destination / 'mcp_server.py'), '--transport-root', str(destination / 'scratch')], input=''.join(json.dumps(message)+'\n' for message in messages), capture_output=True, text=True, timeout=10, check=True)
            self.assertEqual(result.stderr, '')
            replies = [json.loads(line) for line in result.stdout.splitlines()]
            self.assertEqual([reply['id'] for reply in replies], [1, 2, 3, 4])
            self.assertIn('safe', replies[0]['result']['instructions'])
            self.assertIn('submit_note_edit', [item['name'] for item in replies[1]['result']['tools']])
            self.assertEqual(replies[2]['result']['contents'][0]['text'], (destination / 'SKILL.md').read_text())
            self.assertTrue(replies[3]['result']['isError'])
            self.assertTrue((destination / 'last-connected.json').exists())


if __name__ == '__main__':
    unittest.main()
