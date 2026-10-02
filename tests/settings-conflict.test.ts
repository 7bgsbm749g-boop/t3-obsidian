import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {randomUUID,webcrypto} from 'node:crypto';
import {indexedDB} from 'fake-indexeddb';
async function harness(initial:any,deviceId=randomUUID()){
  let current=initial,saves=0,local:any={deviceId,mode:'direct'};
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
  return {plugin,deviceId,saves:()=>saves,current:()=>current,setCurrent:(value:any)=>{current=value;}};
}

test('established vault startup and device-only saves do not rewrite synced settings',async()=>{
  const h=await harness({vaultId:'vault'});
  assert.equal(h.saves(),0,'startup must not save an established shared file');
  h.plugin.settings.pending.push({id:'device-only'});await h.plugin.save();
  assert.equal(h.saves(),0,'device-local request state must not touch data.json');
  h.plugin.settings.orchestration.waitForOtherThreads=true;await h.plugin.save();
  assert.equal(h.saves(),1,'an actual shared setting change is persisted');
});

test('shared saves preserve a disk folder link not edited in the local snapshot',async()=>{
  const h=await harness({vaultId:'vault'});
  const link={id:'link',folderPath:'Remote',projectId:'project',projectTitle:'Repository',connectionId:'c',workspaceRoot:'/repo',self:false};
  h.setCurrent({...h.current(),folderLinks:[link]});
  h.plugin.settings.orchestration.waitForOtherThreads=true;await h.plugin.save();
  assert.deepEqual(JSON.parse(JSON.stringify(h.current().folderLinks)),[link]);
  assert.deepEqual(JSON.parse(JSON.stringify(h.plugin.settings.folderLinks)),[link]);
});

test('UI folder edits and unlink tombstones survive stale Sync snapshots and accept newer remote edits',async()=>{
  const h=await harness({vaultId:'vault'}),stale={...h.current()};
  const link={id:'link',folderPath:'Notes',projectId:'project',projectTitle:'Repository',connectionId:'c',workspaceRoot:'/repo',self:false};
  h.plugin.settings.folderLinks=[link];await h.plugin.save();
  const created=h.current().folderLinkChanges[0];assert.equal(created.link.id,'link');
  h.setCurrent({...stale});await h.plugin.onExternalSettingsChange();
  assert.equal(h.current().folderLinks[0].id,'link');assert.equal(h.current().folderLinkChanges[0].id,created.id);
  await h.plugin.unlinkFolder('Notes');const removed=h.current().folderLinkChanges[0];assert.equal(removed.link,null);
  h.setCurrent({...stale,folderLinks:[link],folderLinkChanges:[created]});await h.plugin.onExternalSettingsChange();
  assert.equal(h.current().folderLinks.length,0);assert.equal(h.current().folderLinkChanges[0].id,removed.id);
  const replacement={...link,id:'new',projectTitle:'New repository'};
  const remote={folderPath:'Notes',id:'remote',at:new Date(Date.parse(removed.at)+1000).toISOString(),link:replacement};
  h.setCurrent({...h.current(),folderLinks:[replacement],folderLinkChanges:[remote]});await h.plugin.onExternalSettingsChange();
  assert.equal(h.plugin.settings.folderLinks[0].id,'new');
});

test('failed settings save does not publish a ghost folder mutation on the next refresh',async()=>{
  const h=await harness({vaultId:'vault'});
  const save=h.plugin.saveData;h.plugin.saveData=async()=>{throw Error('storage failure');};
  h.plugin.settings.folderLinks=[{id:'new',folderPath:'Notes',projectId:'p',projectTitle:'P',workspaceRoot:'/repo',connectionId:'c',self:false}];
  await assert.rejects(h.plugin.save(),/storage failure/);h.plugin.settings.folderLinks=[];
  h.plugin.saveData=save;await h.plugin.onExternalSettingsChange();
  assert.equal(h.plugin.settings.folderLinks.length,0);assert.equal(h.plugin.settings.folderLinkChanges.length,0);assert.equal(h.saves(),0);
});

test('a reloaded client restores its durable unlink record when Sync drops the change history',async()=>{
  const h=await harness({vaultId:'vault'});
  const link={id:'link',folderPath:'Notes',projectId:'project',projectTitle:'Repository',connectionId:'c',workspaceRoot:'/repo',self:false};
  h.plugin.settings.folderLinks=[link];await h.plugin.save();await h.plugin.unlinkFolder('Notes');
  const removed=h.current().folderLinkChanges[0];
  const restarted=await harness({vaultId:'vault',folderLinks:[link]},h.deviceId);
  assert.equal(restarted.current().folderLinks.length,0);
  assert.equal(restarted.current().folderLinkChanges[0].id,removed.id);assert.equal(restarted.saves(),1);
});

for(const format of [undefined,'formatted','raw-markdown','invalid'])test(`final answer setting ${format} defaults safely and persists independently of progress`,async()=>{
  const h=await harness({vaultId:'vault',inlineStreaming:{intermediateMode:'collapse',...(format?{finalAnswerFormat:format}:{})}});
  assert.equal(h.plugin.settings.inlineStreaming.finalAnswerFormat,format==='raw-markdown'?'raw-markdown':'formatted');
  assert.equal(h.plugin.settings.inlineStreaming.intermediateMode,'collapse');assert.equal(h.saves(),0);
  h.plugin.settings.inlineStreaming.finalAnswerFormat='raw-markdown';await h.plugin.save();
  assert.equal(h.current().inlineStreaming.finalAnswerFormat,'raw-markdown');
  assert.equal(h.current().inlineStreaming.intermediateMode,'collapse');
});
