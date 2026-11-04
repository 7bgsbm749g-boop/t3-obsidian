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
  const api={Plugin,Platform:{isMobile:true},Modal:Base,FuzzySuggestModal:Base,EditorSuggest:Base,ItemView:Base,PluginSettingTab:Base,Notice:Base};
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
  h.plugin.settings.threadTitleGeneration='always';await h.plugin.save();
  assert.equal(h.saves(),1,'an actual shared setting change is persisted');
});

test('project creation locations sync as complete machine/path choices and persist through restart',async()=>{
  const h=await harness({vaultId:'vault'});
  const locations=[{connectionId:'laptop',environmentId:'windows',parentPath:'C:\\Projects',selectedAt:'2026-10-20T12:00:00Z'}];
  h.setCurrent({...h.current(),projectCreationLocations:locations});await h.plugin.onExternalSettingsChange();
  assert.deepEqual(JSON.parse(JSON.stringify(h.plugin.settings.projectCreationLocations)),locations);
  h.plugin.settings.completion.archiveFolder='Local';await h.plugin.save();
  const restarted=await harness(h.current());assert.deepEqual(JSON.parse(JSON.stringify(restarted.plugin.settings.projectCreationLocations)),locations);
  h.plugin.settings.projectCreationLocations=[{connectionId:'vps',environmentId:'linux',parentPath:'/work',selectedAt:'2026-10-20T13:00:00Z'}];
  const newer=[{connectionId:'laptop',environmentId:'windows',parentPath:'D:\\Projects',selectedAt:'2026-10-20T14:00:00Z'}];
  h.setCurrent({...h.current(),projectCreationLocations:newer});await h.plugin.save();
  assert.deepEqual(JSON.parse(JSON.stringify(h.plugin.settings.projectCreationLocations)),newer);
});

test('shared saves preserve a disk folder link not edited in the local snapshot',async()=>{
  const h=await harness({vaultId:'vault'});
  const link={id:'link',folderPath:'Remote',projectId:'project',projectTitle:'Repository',connectionId:'c',workspaceRoot:'/repo',self:false};
  h.setCurrent({...h.current(),folderLinks:[link]});
  h.plugin.settings.threadTitleGeneration='always';await h.plugin.save();
  assert.deepEqual(JSON.parse(JSON.stringify(h.current().folderLinks)),[link]);
  assert.deepEqual(JSON.parse(JSON.stringify(h.plugin.settings.folderLinks)),[link]);
});

test('rapid folder move and reverse move survive queued saves, a stale Sync file and restart',async()=>{
  const link={id:'link',folderPath:'Projects/Side/App',projectId:'project',projectTitle:'Repository',connectionId:'c',workspaceRoot:'/repo',self:false};
  const h=await harness({vaultId:'vault',folderLinks:[link]});
  const out=h.plugin.renameLinkedFolder('Projects/Side','Projects/Moved/Side');
  const back=h.plugin.renameLinkedFolder('Projects/Moved/Side','Projects/Side');
  await Promise.all([out,back]);
  assert.deepEqual(JSON.parse(JSON.stringify(h.current().folderLinks)),[link]);
  const changes=JSON.parse(JSON.stringify(h.current().folderLinkChanges));
  assert.equal(changes.find((c:any)=>c.folderPath==='Projects/Side/App').link.projectId,'project');
  assert.equal(changes.find((c:any)=>c.folderPath==='Projects/Moved/Side/App').link,null);
  h.setCurrent({...h.current(),folderLinks:[{...link,folderPath:'Projects/Moved/Side/App'}],folderLinkChanges:[]});
  await h.plugin.onExternalSettingsChange();await h.plugin.save();
  const restarted=await harness(h.current(),h.deviceId);
  assert.deepEqual(JSON.parse(JSON.stringify(restarted.plugin.settings.folderLinks)),[link]);
});

test('external refresh adopts all shared preferences and unrelated saves preserve them',async()=>{
  const h=await harness({vaultId:'vault'});
  h.setCurrent({...h.current(),inlineStreaming:{enabled:false,keepIntermediate:true,intermediateMode:'collapse',finalAnswerFormat:'raw-markdown'},vaultHost:{connectionId:'c',environmentId:'env',workspaceRoot:'/vault'},completion:{action:'archive',archiveFolder:'Remote'}});
  await h.plugin.onExternalSettingsChange();
  assert.equal(h.plugin.settings.inlineStreaming.enabled,false);assert.equal(h.plugin.settings.vaultHost.workspaceRoot,'/vault');
  h.plugin.settings.completion.archiveFolder='Local';await h.plugin.save();
  assert.equal(h.current().inlineStreaming.enabled,false);assert.equal(h.current().inlineStreaming.finalAnswerFormat,'raw-markdown');assert.equal(h.current().completion.action,'archive');
});

test('general attachment folders default without writes and merge distinct synced edits',async()=>{
  const h=await harness({vaultId:'vault'});assert.equal(h.plugin.settings.replyFolders.images,'T3 Code Attachments');assert.equal(h.saves(),0);
  h.setCurrent({...h.current(),replyFolders:{images:'Remote Images',files:'T3 Code Attachments'}});
  h.plugin.settings.replyFolders.files='Local Documents';await h.plugin.save();
  assert.deepEqual(JSON.parse(JSON.stringify(h.current().replyFolders)),{images:'Remote Images',files:'Local Documents'});
  h.setCurrent({...h.current(),replyFolders:{images:'Synced Images',files:'Synced Documents'}});await h.plugin.onExternalSettingsChange();
  assert.equal(h.plugin.settings.replyFolders.images,'Synced Images');assert.equal(h.plugin.settings.replyFolders.files,'Synced Documents');
});

test('title generation defaults safely and follows synced settings without losing local edits',async()=>{
  const h=await harness({vaultId:'vault',threadTitleGeneration:'invalid'});
  assert.equal(h.plugin.settings.threadTitleGeneration,'untitled-only');
  h.setCurrent({...h.current(),threadTitleGeneration:'always'});
  await h.plugin.onExternalSettingsChange();
  assert.equal(h.plugin.settings.threadTitleGeneration,'always');
  h.plugin.settings.completion.archiveFolder='Local';await h.plugin.save();
  assert.equal(h.current().threadTitleGeneration,'always');
  h.plugin.settings.threadTitleGeneration='untitled-only';await h.plugin.save();
  const restarted=await harness(h.current());
  assert.equal(restarted.plugin.settings.threadTitleGeneration,'untitled-only');
});

test('concurrent distinct nested edits merge while a same-field conflict prefers disk',async()=>{
  const h=await harness({vaultId:'vault',inlineStreaming:{enabled:true,finalAnswerFormat:'formatted',intermediateMode:'remove'}});
  h.plugin.settings.inlineStreaming.finalAnswerFormat='raw-markdown';
  h.setCurrent({...h.current(),inlineStreaming:{enabled:false,finalAnswerFormat:'formatted',intermediateMode:'collapse'}});
  await h.plugin.save();
  assert.equal(h.current().inlineStreaming.enabled,false);assert.equal(h.current().inlineStreaming.intermediateMode,'collapse');assert.equal(h.current().inlineStreaming.finalAnswerFormat,'raw-markdown');
  h.plugin.settings.inlineStreaming.intermediateMode='keep';
  h.setCurrent({...h.current(),inlineStreaming:{...h.current().inlineStreaming,intermediateMode:'remove'}});
  await h.plugin.save();assert.equal(h.current().inlineStreaming.intermediateMode,'remove');assert.equal(h.plugin.settings.inlineStreaming.intermediateMode,'remove');
});

test('queued local saves preserve the latest intent even when it returns to the original value',async()=>{
  const h=await harness({vaultId:'vault'});
  h.plugin.settings.inlineStreaming.enabled=false;const first=h.plugin.save();
  h.plugin.settings.inlineStreaming.enabled=true;const second=h.plugin.save();
  await Promise.all([first,second]);assert.equal(h.current().inlineStreaming.enabled,true);assert.equal(h.plugin.settings.inlineStreaming.enabled,true);
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
