import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ensureVaultIdentityRecord,identityPathForSettings,readVaultIdentityRecord,vaultIdentityPath} from '../vault-identity';

test('host identity publishes once, follows adopted vault identity, and supports custom configuration folders',async()=>{
  const entries=new Map<string,string>([['Custom/Config','']]);let writes=0;
  const files={exists:async(path:string)=>entries.has(path),read:async(path:string)=>entries.get(path)!,mkdir:async(path:string)=>{entries.set(path,'');},write:async(path:string,contents:string)=>{writes++;entries.set(path,contents);}};
  await ensureVaultIdentityRecord(files,'Custom/Config','first');await ensureVaultIdentityRecord(files,'Custom/Config','first');
  assert.equal(writes,1);assert.equal(readVaultIdentityRecord(entries.get(vaultIdentityPath('Custom/Config'))!),'first');
  await ensureVaultIdentityRecord(files,'Custom/Config','second');assert.equal(writes,2);assert.equal(readVaultIdentityRecord(entries.get(vaultIdentityPath('Custom/Config'))!),'second');
  assert.equal(identityPathForSettings('Custom/Config/plugins/send-to-t3-code/data.json'),vaultIdentityPath('Custom/Config'));
  for(const path of ['/abs/plugins/p/data.json','../plugins/p/data.json','a/../plugins/p/data.json','C:/plugins/p/data.json','settings.json'])assert.equal(identityPathForSettings(path),undefined);
});
