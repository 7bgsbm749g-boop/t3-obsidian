import {test} from 'node:test';
import assert from 'node:assert/strict';
import {localSyncReady,localSyncEvidence} from '../src/storage/local-sync-state';
test('Sync status is diagnostic and never a local save permission',()=>{
 for(const status of ['synced','syncing','paused','disconnected','error']){
  const app={internalPlugins:{getEnabledPluginById:()=>({vaultId:'remote',getStatus:()=>status})}};
  assert.equal(localSyncReady(app,'Note.md'),true);assert.deepEqual(localSyncEvidence(app),{provider:'obsidian-core',status,localSaveAllowed:true});
 }
});
test('missing or failing private Sync APIs cannot prevent a checked local save',()=>{
 for(const app of [{},null,{internalPlugins:{getEnabledPluginById(){throw Error('Unsupported');}}}]){
  assert.equal(localSyncReady(app),true);assert.equal(localSyncEvidence(app).localSaveAllowed,true);
 }
});
