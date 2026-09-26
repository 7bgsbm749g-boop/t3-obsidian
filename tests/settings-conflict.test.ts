import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {randomUUID,webcrypto} from 'node:crypto';
import {indexedDB} from 'fake-indexeddb';
import type {FolderWorkflow} from '../workflow';
import {loadWorkflowReplica,mergeWorkflowReplicas,workflowChanges} from '../workflow-sync';

const workflow:FolderWorkflow={id:'gym',name:'Gym workflow',folderPath:'Projects',includeSubfolders:true,events:['modify'],task:'Format.',connectionId:'c',projectId:'p',deviceId:'phone',enabled:true};

async function harness(initial:any){
  let current=initial,saves=0,local:any={deviceId:randomUUID(),mode:'direct'};
  class Base{}
  class Plugin {
    app={loadLocalStorage:()=>local,saveLocalStorage:(_:string,value:any)=>{local=value;},workspace:{onLayoutReady:()=>{},on:()=>({})}};
    async loadData(){return current;}
    async saveData(value:any){current=value;saves++;}
    addSettingTab(){}registerEvent(){}addCommand(){}
  }
  const api={Plugin,Platform:{isMobile:true},Modal:Base,FuzzySuggestModal:Base,PluginSettingTab:Base,Notice:Base};
  const module={exports:{} as any};
  runInNewContext(await readFile('dist/main.js','utf8'),{module,exports:module.exports,require:(name:string)=>{assert.equal(name,'obsidian');return api;},indexedDB,document:{createElement:()=>({innerHTML:'',get textContent(){return this.innerHTML;}})},URL,TextEncoder,TextDecoder,crypto:webcrypto,setTimeout,clearTimeout,console},{timeout:5000});
  const plugin=new module.exports.default();await plugin.onload();
  return {plugin,saves:()=>saves,current:()=>current,setCurrent:(value:any)=>{current=value;}};
}

test('established vault startup and device-only saves do not rewrite synced settings',async()=>{
  const h=await harness({vaultId:'vault',folderWorkflows:[workflow]});
  assert.equal(h.saves(),0,'startup must not save an established shared file');
  h.plugin.settings.pending.push({id:'device-only'});await h.plugin.save();
  assert.equal(h.saves(),0,'device-local request state must not touch data.json');
  h.plugin.settings.orchestration.waitForOtherThreads=true;await h.plugin.save();
  assert.equal(h.saves(),1,'an actual shared setting change is persisted');
});

test('an unrelated shared save merges a newer workflow tombstone before writing',async()=>{
  const initial={vaultId:'vault',folderWorkflows:[workflow]},h=await harness(initial);
  const original=loadWorkflowReplica(initial),deleted=mergeWorkflowReplicas(original,original,workflowChanges(original,[]),'phone',100);
  h.setCurrent({...initial,folderWorkflows:deleted.workflows,workflowSync:deleted.sync});
  h.plugin.settings.orchestration.waitForOtherThreads=true;await h.plugin.save();
  assert.equal(h.current().folderWorkflows.length,0);
  assert.ok(h.current().workflowSync.tombstones.gym);
  assert.equal(h.plugin.settings.folderWorkflows.length,0);
});
