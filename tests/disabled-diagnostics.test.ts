import {test} from 'node:test';
import assert from 'node:assert/strict';
import {indexedDB} from 'fake-indexeddb';
import {clearDeviceDiagnostics,deviceState} from '../device-state';
import {clearVaultDiagnostics} from '../disabled-diagnostics';

test('clearing diagnostics preserves requests, credentials, and another vault',async()=>{
  globalThis.indexedDB=indexedDB;
  const vault='logging-disabled-test';
  await deviceState(`diagnostics:${vault}:phone`,{events:[{event:'old'}]});
  await deviceState(`diagnostics:${vault}:desktop`,{events:[{event:'old'}]});
  await deviceState(`diagnostics:${vault}-other:phone`,{events:[{event:'keep'}]});
  await deviceState(vault,{pending:[{id:'keep'}],credentials:'keep'});
  await clearDeviceDiagnostics(vault);
  assert.equal(await deviceState(`diagnostics:${vault}:phone`),undefined);
  assert.equal(await deviceState(`diagnostics:${vault}:desktop`),undefined);
  assert.deepEqual(await deviceState(`diagnostics:${vault}-other:phone`),{events:[{event:'keep'}]});
  assert.deepEqual(await deviceState(vault),{pending:[{id:'keep'}],credentials:'keep'});
});

test('log cleanup handles custom config, preserves user files and is idempotent',async()=>{
  const data=new Map([
    ['.custom/t3-code-log.json','old log'],
    ['.custom/plugins/send-to-t3-code/data.json','settings'],
    ['T3 Code Logs/device/generated.md','# T3 Code plugin event log\nold'],
    ['T3 Code Logs/user.md','User note'],
  ]);
  const removedFolders:string[]=[];
  const list=async(path:string)=>{
    const rest=[...data.keys()].filter(p=>p.startsWith(path+'/')).map(p=>p.slice(path.length+1));
    return {files:rest.filter(p=>!p.includes('/')).map(p=>path+'/'+p),folders:[...new Set(rest.filter(p=>p.includes('/')).map(p=>path+'/'+p.split('/')[0]))]};
  };
  const files={exists:async(path:string)=>data.has(path)||[...data.keys()].some(p=>p.startsWith(path+'/')),read:async(path:string)=>data.get(path)!,remove:async(path:string)=>{data.delete(path);},list,rmdir:async(path:string)=>{removedFolders.push(path);}};
  await clearVaultDiagnostics(files,'.custom');await clearVaultDiagnostics(files,'.custom');
  assert.deepEqual([...data.keys()],['.custom/plugins/send-to-t3-code/data.json','T3 Code Logs/user.md']);
  assert.deepEqual(removedFolders,['T3 Code Logs/device']);
});
