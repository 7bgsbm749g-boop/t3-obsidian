import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadVaultHost,vaultHost,mergeVaultHost} from '../vault-host';

const root={id:'root',folderPath:'/',connectionId:'c',environmentId:'env',projectId:'old-project',projectTitle:'Vault',workspaceRoot:'/vault',self:true};

test('legacy root records still select the host without requiring or rewriting their project',()=>{
  const settings={folderLinks:[root]},before=JSON.stringify(settings);
  assert.deepEqual(vaultHost(settings),{connectionId:'c',environmentId:'env',workspaceRoot:'/vault'});
  assert.equal(JSON.stringify(settings),before);
});

test('concurrent host changes retain a whole machine/path choice',()=>{
  const baseline={connectionId:'a',environmentId:'a',workspaceRoot:'/vault'},disk={connectionId:'b',environmentId:'b',workspaceRoot:'C:\\Vault'},intended={...baseline,workspaceRoot:'/moved/vault'};
  assert.deepEqual(mergeVaultHost(baseline,disk,intended),disk);
  assert.deepEqual(mergeVaultHost(baseline,baseline,intended),intended);
  assert.deepEqual(mergeVaultHost(baseline,disk,baseline),disk);
});

test('a new host can replace the selected machine without changing old folder links',()=>{
  const host={connectionId:'other',environmentId:'other-env',workspaceRoot:'C:\\Vault'};
  assert.deepEqual(vaultHost({vaultHost:host,folderLinks:[root]}),host);
  assert.equal(root.projectId,'old-project');
  assert.equal(loadVaultHost({connectionId:'',workspaceRoot:'/local/vault'})?.connectionId,'');
  for(const value of [null,{}, {connectionId:'c',workspaceRoot:''},{connectionId:'c',workspaceRoot:'/vault',environmentId:17}])assert.equal(loadVaultHost(value),undefined);
});
