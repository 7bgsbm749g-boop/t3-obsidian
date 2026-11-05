import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {registeredVaults} from './fixtures/baseline-native/private-storage-desktop';

test('a stale registry path cannot hide later vaults from private-storage checks',async t=>{
  const directory=join(process.cwd(),'evidence/review-remediation');
  await mkdir(directory,{recursive:true});
  const base=await mkdtemp(join(directory,'registry-test-'));
  t.after(()=>rm(base,{recursive:true,force:true}));
  const vault=join(base,'Other vault'),registry=join(base,'registry.json');await mkdir(vault);
  await writeFile(registry,JSON.stringify({vaults:{stale:{path:join(base,'missing')},present:{path:vault}}}));
  assert.deepEqual(await registeredVaults(registry),[await realpath(vault)]);
  assert.deepEqual(await registeredVaults(join(base,'absent-registry')),[]);
  await writeFile(registry,'{bad');await assert.rejects(registeredVaults(registry));
  await writeFile(registry,JSON.stringify({vaults:{bad:{path:'relative/vault'}}}));await assert.rejects(registeredVaults(registry),/Invalid registered vault path/);
  await assert.rejects(registeredVaults(vault),'an unreadable registry must fail closed');
});
