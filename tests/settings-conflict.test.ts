import {loadSmartSend,prepareSmartSend,rememberResponse,smartDestination} from '../src/notes/smart-send';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from './obsidian-context';
import {randomUUID,webcrypto} from 'node:crypto';
import {indexedDB,IDBObjectStore} from 'fake-indexeddb';
async function harness(initial:any,deviceId=randomUUID()){
  let current=initial,saves=0,local:any={deviceId,mode:'direct'};
  class Base{}
  class Plugin {
    app={loadLocalStorage:()=>local,saveLocalStorage:(_:string,value:any)=>{local=value;},workspace:{onLayoutReady:()=>{},on:()=>({})}};
    async loadData(){return current;}
    async saveData(value:any){current=value;saves++;}
    addSettingTab(){}registerEvent(){}addCommand(){}register(_cleanup:()=>void){}
  }
  const api={Plugin,Platform:{isMobile:true},Modal:Base,FuzzySuggestModal:Base,EditorSuggest:Base,ItemView:Base,PluginSettingTab:Base,Notice:Base};
  const module={exports:{} as any};
  runInNewContext(await readFile('dist/main.js','utf8'),{module,exports:module.exports,require:(name:string)=>{assert.equal(name,'obsidian');return api;},indexedDB,document:{createElement:()=>({innerHTML:'',get textContent(){return this.innerHTML;}})},URL,TextEncoder,TextDecoder,AbortController,crypto:webcrypto,setTimeout,clearTimeout,console},{timeout:5000});
  const plugin=new module.exports.default();await plugin.onload();
  return {plugin,deviceId,saves:()=>saves,current:()=>current,setCurrent:(value:any)=>{current=value;}};
}

async function noteRoutingHarness(){
  const h=await harness({vaultId:randomUUID(),inlineStreaming:{enabled:false}}),p=h.plugin;
  const project={id:'project',title:'Synthetic project',workspaceRoot:'/synthetic/project',connectionId:'connection'};
  const notePath='Synthetic/Discussion.md',threadId='previous-thread';
  p.app.vault={adapter:{}};p.noteNeedsRelink=async()=>false;
  p.settings.directProjects=[project];p.settings.paired=[{id:'connection',name:'Synthetic machine',url:'https://synthetic.invalid',environmentId:'environment'}];
  p.projects=()=>[project];p.syncProjectSources=()=>{};
  const data=loadSmartSend(undefined),plan=await prepareSmartSend(data,notePath,smartDestination('environment',project.id,threadId),'Original request.');
  p.settings.smartSend=data;
  const request={id:randomUUID(),project,connection:{connectionId:'connection',environmentId:'environment'},noteThread:p.noteThreadIntent(notePath,project,{environmentId:'environment'}),smartSend:plan.capture};
  p.rememberStarted(request,threadId);
  p.settings.noteThreads[0].selectedAt='2026-01-01T00:00:00.000Z';
  await p.save();
  p.readChatThread=async(_connection:unknown,_project:unknown,id:string)=>({id,projectId:project.id,title:'Existing discussion'});
  p.hasSmartContent=async()=>true;p.previewSend=()=>()=>{};
  const sends:Array<{threadId?:string;projectKey?:string;newThread:boolean;overrideKey?:string}>=[];
  p.sendNote=async(_file:unknown,threadId:string|undefined,projectKey:string|undefined,newThread:boolean,overrideKey:string|undefined)=>{sends.push({threadId,projectKey,newThread,overrideKey});};
  return {...h,project,notePath,threadId,request,sends};
}

function pauseIdentityPublication(plugin:any){
  let release!:()=>void,entered!:()=>void;
  const waiting=new Promise<void>(resolve=>{release=resolve;}),ready=new Promise<void>(resolve=>{entered=resolve;});
  plugin.publishVaultIdentity=async()=>{entered();await waiting;};
  return {ready,release};
}

test('a direct note send keeps its previous thread while a stale Sync settings refresh is waiting',async()=>{
  const h=await noteRoutingHarness(),p=h.plugin;
  const other={...p.settings.noteThreads[0],notePath:'Synthetic/Other.md',noteId:'a'.repeat(64),threadId:'remote-thread'};
  h.setCurrent({...h.current(),noteThreads:[other]});
  const pause=pauseIdentityPublication(p),refresh=p.onExternalSettingsChange();
  try{
    await pause.ready;
    await p.openNoteSend({path:h.notePath},false,null);
    assert.deepEqual(h.sends,[{threadId:h.threadId,projectKey:'connection:project',newThread:false,overrideKey:'connection:project'}]);
    assert.equal(p.noteThread('Synthetic/Other.md')?.threadId,other.threadId,'new remote links are available during the refresh');
  }finally{pause.release();await refresh;}
  assert.equal(h.current().noteThreads.some((entry:any)=>entry.threadId===h.threadId),true);
  assert.equal(h.current().noteThreads.some((entry:any)=>entry.threadId===other.threadId),true);
});

test('a send confirmed during a Sync settings refresh stays remembered after refresh and restart',async()=>{
  const h=await noteRoutingHarness(),p=h.plugin;
  h.setCurrent({...h.current(),noteThreads:[]});
  const pause=pauseIdentityPublication(p),refresh=p.onExternalSettingsChange();
  try{
    await pause.ready;
    p.rememberStarted({...h.request,id:randomUUID()},'newly-selected-thread');
  }finally{pause.release();await refresh;}
  assert.equal(p.noteThread(h.notePath)?.threadId,'newly-selected-thread');
  await p.openNoteSend({path:h.notePath},false,null);
  assert.equal(h.sends[0]?.threadId,'newly-selected-thread');assert.equal(h.sends[0]?.newThread,false);
  const restarted=await harness(h.current(),h.deviceId);
  assert.equal(restarted.plugin.noteThread(h.notePath)?.threadId,'newly-selected-thread');
});

test('established vault startup and device-only saves do not rewrite synced settings',async()=>{
  const h=await harness({vaultId:'vault'});
  assert.equal(h.saves(),0,'startup must not save an established shared file');
  h.plugin.settings.pending.push({id:'device-only'});await h.plugin.save();
  assert.equal(h.saves(),0,'device-local request state must not touch data.json');
  h.plugin.settings.threadTitleGeneration='always';await h.plugin.save();
  assert.equal(h.saves(),1,'an actual shared setting change is persisted');
});

test('automatic thread settlement requires an explicit saved opt-in on startup and Sync refresh',async()=>{
  for(const value of [undefined,false,null,'true',1,true]){
    const initial=value===undefined?{vaultId:'vault'}:{vaultId:'vault',autoSettleThreads:value};
    const h=await harness(initial);
    assert.equal(h.plugin.settings.autoSettleThreads,value===true);
    assert.equal(h.saves(),0,'loading a default must not rewrite synced settings');
    h.plugin.settings.threadTitleGeneration='always';await h.plugin.save();
    assert.equal(h.current().autoSettleThreads,value===true);
    const restarted=await harness(h.current());assert.equal(restarted.plugin.settings.autoSettleThreads,value===true);
    h.setCurrent({...h.current(),autoSettleThreads:true});await h.plugin.onExternalSettingsChange();
    assert.equal(h.plugin.settings.autoSettleThreads,true);
    h.plugin.settings.settlementJobs.push({requestId:'pending'});
    const incoming={...h.current()};delete incoming.autoSettleThreads;h.setCurrent(incoming);
    await h.plugin.onExternalSettingsChange();
    assert.equal(h.plugin.settings.autoSettleThreads,false);assert.equal(h.plugin.settings.settlementJobs.length,0);
  }
});

test('disabled automatic settlement does not restore device jobs or settle a new send',async()=>{
  const h=await harness({vaultId:'vault',autoSettleThreads:true});
  h.plugin.settings.settlementJobs.push({requestId:'pending',messageId:'message',threadId:'thread',projectId:'project',connection:{executable:'',host:'',transport:'direct',environmentId:'environment'}});await h.plugin.saveDeviceState();
  const enabled=await harness(h.current(),h.deviceId);assert.equal(enabled.plugin.settings.settlementJobs.length,1);
  const restarted=await harness({vaultId:'vault'},h.deviceId);
  assert.equal(restarted.plugin.settings.settlementJobs.length,0);
  restarted.plugin.rememberSettlement({connection:{}},'thread');
  assert.equal(restarted.plugin.settings.settlementJobs.length,0);
});

for(const queued of [false,true])for(const missing of [false,true])test(`a shared save adopting disabled settlement discards persisted jobs (queued=${queued}, missing=${missing})`,async()=>{
  const h=await harness({vaultId:'vault',autoSettleThreads:true});
  h.plugin.settings.completionJobs.push({id:'keep-device-work'});
  h.plugin.settings.settlementJobs.push({requestId:'old',messageId:'message',threadId:'thread',projectId:'project',connection:{transport:'direct',environmentId:'environment'}});
  await h.plugin.saveDeviceState();
  const incoming={...h.current(),autoSettleThreads:false};if(missing)delete incoming.autoSettleThreads;h.setCurrent(incoming);
  h.plugin.settings.threadTitleGeneration='always';
  const saving=h.plugin.save();if(queued)await Promise.all([saving,h.plugin.save()]);else await saving;
  assert.equal(h.plugin.settings.autoSettleThreads,false);
  assert.equal(h.current().autoSettleThreads,false);
  assert.equal(h.plugin.settings.settlementJobs.length,0,'the save must clear jobs without waiting for a separate Sync refresh');
  assert.equal(h.plugin.settings.completionJobs[0]?.id,'keep-device-work','clearing settlement must preserve unrelated device work');
  const restarted=await harness({...h.current(),autoSettleThreads:true},h.deviceId);
  assert.equal(restarted.plugin.settings.settlementJobs.length,0,'re-enabling on another device must not restore old jobs');
});

test('saved job changes and reply completion drive settlement without waiting for a timer',async()=>{
  const h=await harness({vaultId:'vault',autoSettleThreads:true}),synced:unknown[][]=[],wakes:Array<string|undefined>=[];
  h.plugin.settlementEvents={sync:(jobs:unknown[])=>synced.push([...jobs]),wake:(id?:string)=>wakes.push(id)};
  const job={requestId:'pending',messageId:'message',threadId:'thread',projectId:'project',connection:{executable:'',host:'',transport:'direct',environmentId:'environment'}};
  h.plugin.settings.settlementJobs.push(job);await h.plugin.save();assert.equal(synced.at(-1)?.[0],job);
  h.plugin.busy=true;h.plugin.busy=false;assert.deepEqual(wakes,[undefined]);
  h.plugin.app.workspace.getLeavesOfType=()=>[];
  h.plugin.deviceInline.io.localCompleted('binding','Note.md');assert.deepEqual(wakes,[undefined,'binding']);
  h.setCurrent({...h.current(),autoSettleThreads:false});await h.plugin.onExternalSettingsChange();assert.equal(synced.at(-1)?.length,0);
});

test('thread hiding leaves T3 unchanged by default and syncs explicit hide and show choices',async()=>{
  const h=await harness({vaultId:'vault'});assert.equal(h.plugin.settings.hideObsidianThreads,undefined);assert.equal(h.saves(),0);
  h.plugin.settings.threadTitleGeneration='always';await h.plugin.save();assert.equal(Object.hasOwn(h.current(),'hideObsidianThreads'),false);
  h.setCurrent({...h.current(),hideObsidianThreads:true});await h.plugin.onExternalSettingsChange();assert.equal(h.plugin.settings.hideObsidianThreads,true);
  await h.plugin.setThreadHiding(false);assert.equal(h.current().hideObsidianThreads,false);
  const restarted=await harness(h.current());assert.equal(restarted.plugin.settings.hideObsidianThreads,false);
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

test('external refresh preserves shared preferences but cannot reactivate retired note cleanup',async()=>{
  const h=await harness({vaultId:'vault'});
  h.setCurrent({...h.current(),inlineStreaming:{enabled:false,keepIntermediate:true,intermediateMode:'collapse',finalAnswerFormat:'raw-markdown'},vaultHost:{connectionId:'c',environmentId:'env',workspaceRoot:'/vault'},completion:{action:'archive',archiveFolder:'Remote'}});
  await h.plugin.onExternalSettingsChange();
  assert.equal(h.plugin.settings.inlineStreaming.enabled,false);assert.equal(h.plugin.settings.vaultHost.workspaceRoot,'/vault');
  h.plugin.settings.completion.archiveFolder='Local';await h.plugin.save();
  assert.equal(h.current().inlineStreaming.enabled,false);assert.equal(h.current().inlineStreaming.finalAnswerFormat,'raw-markdown');assert.equal(h.current().completion.action,'keep');
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

test('Smart Send-only Sync adoption notifies pending peer-save proof without a binding or note change',async()=>{
 const h=await harness({vaultId:'vault'});let proofs=0,bindings=0;
 h.plugin.deviceInline.savedResponsesChanged=()=>proofs++;h.plugin.deviceInline.localBindingsChanged=()=>bindings++;
 const incoming=loadSmartSend(undefined);await rememberResponse(incoming,'Synthetic.md',randomUUID(),'Stored peer output','','',0);
 h.setCurrent({...h.current(),smartSend:incoming});await h.plugin.onExternalSettingsChange();assert.equal(proofs,1);assert.equal(bindings,0);
 await h.plugin.onExternalSettingsChange();assert.equal(proofs,1,'Identical settings do not restart proof checks');
});

test('reply provenance is durable locally before one combined shared publication',async()=>{
 const h=await harness({vaultId:randomUUID()}),p=h.plugin;
 for(let n=0;n<2;n++)await p.retainSmartChange(()=>rememberResponse(p.smartData(),'Synthetic.md','reply-'+n,'Generated '+n,'','',0));
 assert.equal(h.saves(),0,'Pre-write provenance must not rewrite the whole shared file');
 const restarted=await harness(h.current(),h.deviceId);assert.equal(Object.keys(restarted.plugin.smartData().responses).length,2,'Local provenance survives restart before shared publication');
 await p.checkExternalSettings();assert.equal(h.saves(),1);assert.equal(Object.keys(h.current().smartSend.responses).length,2);
});
test('a new provenance record during shared IO remains pending for the next publication',async()=>{
 const h=await harness({vaultId:randomUUID()}),p=h.plugin;
 await p.retainSmartChange(()=>rememberResponse(p.smartData(),'Synthetic.md','first','First body.','','',0));
 const save=p.saveData.bind(p);let entered!:()=>void,release!:()=>void;const ready=new Promise<void>(resolve=>entered=resolve),gate=new Promise<void>(resolve=>release=resolve);
 p.saveData=async(value:any)=>{entered();await gate;await save(value);};
 const saving=p.save(true);await ready;
 await p.retainSmartChange(()=>rememberResponse(p.smartData(),'Synthetic.md','second','Second body.','','',0));
 release();await saving;assert.ok(p.smartHistoryRevision>p.smartHistoryPublished);
 p.saveData=save;await p.checkExternalSettings();assert.equal(Object.keys(h.current().smartSend.responses).length,2);
});
test('shared snapshots keep immutable receipt membership while later history grows',async()=>{
 const h=await harness({vaultId:randomUUID()}),p=h.plugin;
 await p.retainSmartChange(()=>rememberResponse(p.smartData(),'Synthetic.md','first','First body.','','',0));
 const snapshot=p.sharedSnapshot();await p.retainSmartChange(()=>rememberResponse(p.smartData(),'Synthetic.md','later','Later body.','','',0));
 assert.equal(Object.keys(snapshot.smartSend.responses).length,1);assert.equal(Object.keys(p.smartData().responses).length,2);
});

async function storedDevice(key:string){
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('send-to-t3-code',3);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  try{return await new Promise<any>((resolve,reject)=>{const tx=db.transaction('devices'),r=tx.objectStore('devices').get(key);tx.oncomplete=()=>resolve(r.result);tx.onabort=()=>reject(tx.error);});}
  finally{db.close();}
}

test('queued send checkpoints own their snapshots and commit before compatible replicas and shared publication',async t=>{
  const h=await harness({vaultId:randomUUID()}),p=h.plugin,transactions=new Map<IDBTransaction,string[]>(),published:string[]=[];
  const put=IDBObjectStore.prototype.put;
  t.mock.method(IDBObjectStore.prototype,'put',function(this:IDBObjectStore,value:unknown,key?:IDBValidKey){
    const keys=transactions.get(this.transaction)??[];keys.push(String(key));transactions.set(this.transaction,keys);return put.call(this,value,key);
  });
  const save=p.saveData.bind(p);
  p.saveData=async(value:any)=>{
    const state=await storedDevice(h.deviceId);published.push(state.pending[0].directPlan.phase);
    assert.deepEqual(await storedDevice(`smart-send:${h.deviceId}:${p.settings.vaultId}`),JSON.parse(JSON.stringify(value.smartSend)));
    assert.deepEqual(await storedDevice(`response-bindings:${h.deviceId}:${p.settings.vaultId}`),JSON.parse(JSON.stringify(value.responseBindings)));
    await save(value);
  };
  const pending={id:randomUUID(),directPlan:{phase:'prepared',turn:{commandId:'stable-command',messageId:'stable-message',text:'Immutable prompt'}}};
  p.settings.pending=[pending];const first=p.save(true);
  pending.directPlan.phase='created';pending.directPlan.turn.text='Later snapshot';const second=p.save(true);
  await Promise.all([first,second]);assert.deepEqual(published,['prepared','created']);
  const groups=[...transactions.values()];
  assert.equal(groups.filter(keys=>keys.includes(h.deviceId)).every(keys=>keys.length===1),true,'Pending checkpoints stay separate');
  const replicas=groups.filter(keys=>keys.some(key=>key.startsWith('smart-send:')));
  assert.equal(replicas.length,2);assert.ok(replicas.every(keys=>keys.length===2&&keys[1].startsWith('response-bindings:')));
  assert.equal((await storedDevice(h.deviceId)).pending[0].directPlan.turn.commandId,'stable-command');
});

test('a failed replica batch retains the durable uncertain plan and rolls back provenance before publication',async t=>{
  const h=await harness({vaultId:randomUUID()}),p=h.plugin;
  await p.save(true);const previous=await storedDevice(`smart-send:${h.deviceId}:${p.settings.vaultId}`),saves=h.saves();
  await rememberResponse(p.smartData(),'Synthetic.md','new-receipt','Unsaved body.','','',0);
  p.settings.pending=[{id:'uncertain',directPlan:{phase:'prepared',turn:{commandId:'same-command',messageId:'same-message'}}}];
  const put=IDBObjectStore.prototype.put;
  t.mock.method(IDBObjectStore.prototype,'put',function(this:IDBObjectStore,value:unknown,key?:IDBValidKey){if(String(key).startsWith('response-bindings:'))throw Error('injected replica failure');return put.call(this,value,key);});
  await assert.rejects(p.save(true),/injected replica failure/);
  assert.equal(h.saves(),saves,'No shared proof is published after an aborted batch');
  assert.deepEqual(await storedDevice(`smart-send:${h.deviceId}:${p.settings.vaultId}`),previous,'Earlier puts in the batch roll back');
  assert.equal((await storedDevice(h.deviceId)).pending[0].directPlan.turn.commandId,'same-command');
  t.mock.restoreAll();await p.save(true);
  assert.equal(Object.keys(h.current().smartSend.responses).length,1,'A later save can retry without losing provenance');
});

test('rapid unrelated state saves skip settlement regrouping but additions, replacements and disable still synchronize',async()=>{
  const h=await harness({vaultId:'vault',autoSettleThreads:true}),p=h.plugin,synced:unknown[][]=[];
  p.settlementEvents={sync:(jobs:unknown[])=>synced.push([...jobs]),wake:()=>{}};
  const job={requestId:'pending',messageId:'message',threadId:'thread',projectId:'project',connection:{executable:'',host:'',transport:'direct',environmentId:'environment'}};
  p.settings.settlementJobs.push(job);await p.save();assert.equal(synced.length,1);
  await Promise.all(Array.from({length:40},()=>p.save()));assert.equal(synced.length,1);
  p.settings.settlementJobs=[...p.settings.settlementJobs];await p.save();assert.equal(synced.length,1,'array replacement with the same targets is unchanged');
  p.settings.settlementJobs[0]={...job,messageId:'new-turn'};await p.save();assert.equal(synced.length,2);
  p.settings.settlementJobs.push({...job,requestId:'another'});await p.save();assert.equal(synced.length,3);
  p.settings.autoSettleThreads=false;await p.save();assert.equal(synced.length,4);assert.equal(synced.at(-1)?.length,0);
});

test('plugin visibility saves share completion and collapse force requests to the latest preference',async()=>{
  const h=await harness({vaultId:'vault'}),p=h.plugin,calls:Array<{enabled:boolean;force:boolean}>=[];
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  p.threadVisibility={};p.settings.hideObsidianThreads=true;
  p.applyThreadVisibility=async(enabled:boolean,force:boolean)=>{calls.push({enabled,force});if(calls.length===1)await gate;};
  const first=p.syncThreadVisibility(true);
  await Promise.all(Array.from({length:40},()=>p.save()));assert.equal(calls.length,1);
  const waiting=[];for(let i=0;i<40;i++){p.settings.hideObsidianThreads=i%2===0;waiting.push(p.syncThreadVisibility(true));}
  assert.ok(waiting.every(work=>work===first));release();await Promise.all([first,...waiting]);
  assert.deepEqual(calls,[{enabled:true,force:true},{enabled:false,force:true}]);
  await p.save();assert.equal(calls.length,2);
  p.settings.paired=[{id:'new',environmentId:'remote',url:'https://fixture',name:'new'}];await p.save();await p.visibilityWork;
  assert.deepEqual(calls.at(-1),{enabled:false,force:false},'route changes still synchronize');
});
