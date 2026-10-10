import {test} from 'node:test';
import assert from 'node:assert/strict';
import {NativeResponseView} from '../native-response-view';
import {NativeResponseManager} from '../native-response-manager';
import {responseAnchor} from '../native-response-projection';
import type {LeaseRecord} from '../inline-lease';
import type {NativeStoppedResponse,NativeStoppedStore} from '../native-stop-store';
import {deviceFinalNoteIO} from '../inline-note-io';
import {nativeResponses} from '../native-response-manager';
import {renderResponseToolGroup} from '../response-tools';
import {presentToolGroups} from '../response-tool-presentation';

const id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const body='> Final reply\n\n<details><summary>Tool output</summary><pre>'+ 'retained output '.repeat(1000)+'</pre></details>';
const before=`Ordinary text\n\n${responseAnchor(id)}\n\nLast paragraph\n`;
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};}
const nextTurn=()=>new Promise<void>(resolve=>setImmediate(resolve));

/** The relevant TextFileView shape in Obsidian 1.14.4: save is bound in the
 * constructor, and the debounce retains that function before a plugin wraps
 * view.save. Its save captures getViewData/lastSavedData before the adapter
 * queue, marks saving synchronously, and can schedule saveAgain in finally.
 * The callbacks are controlled here; no timers or application boot are used. */
function nativeFixture(panes=1,local=new Map<string,unknown>(),document=before){
  let disk=document,adapterPromise:Promise<void>=Promise.resolve(),storageFailure=false;
  const writes:string[]=[],storageWrites:Array<{key:string;value:unknown}>=[],file={path:'Note.md',deleted:false};
  const app:any={vault:{adapter:{get promise(){return adapterPromise;}},read:async()=>disk,getFileByPath:(path:string)=>path===file.path?file:null,modify:async(_file:unknown,data:string)=>{disk=data;writes.push(data);}},loadLocalStorage:(key:string)=>local.get(key),saveLocalStorage:(key:string,value:unknown)=>{if(storageFailure)throw Error('Device storage unavailable');storageWrites.push({key,value:structuredClone(value)});local.set(key,structuredClone(value));}};
  const makePane=(initial=document)=>{
    let visible=initial,queued=false;
    const view:any={app,file,lastSavedData:initial,dirty:false,saving:false,saveAgain:false,data:initial,getViewData:()=>visible,setViewData:(data:string)=>{visible=data;},getMode:()=> 'preview'};
    const nativeSave=async function(this:any,clear?:boolean){
      this.dirty=false;if(!this.file||this.file.deleted)return;
      if(this.saving){if(!clear)this.saveAgain=true;return;}
      this.saveAgain=false;const data=this.getViewData();
      if(this.lastSavedData===data||this.lastSavedData===null)return;
      const previous=this.lastSavedData;
      if(clear){this.data=null;this.lastSavedData=null;}else{this.data=data;this.lastSavedData=data;}
      this.saving=true;
      try{await this.app.vault.adapter.promise.catch(()=>{});await this.app.vault.modify(this.file,data);}
      catch(error){this.lastSavedData=previous;throw error;}
      finally{this.saving=false;if(this.saveAgain&&!clear)void this.save();}
    };
    view.save=nativeSave.bind(view);
    const constructorBoundSave=view.save;
    // requestSave is a method that schedules a separately retained debounce;
    // requestSave.cancel is absent on the actual native view.
    view.requestSave=()=>{view.dirty=true;queued=true;};
    return {view,visible:()=>visible,edit:(data:string)=>{visible=data;view.dirty=true;},fire:async()=>{assert.ok(queued,'The native debounce was scheduled');queued=false;await constructorBoundSave();},fireCaptured:()=>constructorBoundSave(),queued:()=>queued};
  };
  const panesState=Array.from({length:panes},()=>makePane());
  app.workspace={getLeavesOfType:()=>panesState.map(({view})=>({view}))};
  return {app,local,file,writes,storageWrites,panes:panesState,view:panesState[0].view,addPane:(initial=document)=>{const pane=makePane(initial);panesState.push(pane);return pane;},visible:(pane=0)=>panesState[pane].visible(),edit:(data:string,pane=0)=>panesState[pane].edit(data),disk:()=>disk,setDisk:(data:string)=>{disk=data;},blockAdapter:(promise:Promise<void>)=>{adapterPromise=promise;},failStorage:(fail:boolean)=>{storageFailure=fail;}};
}
function adapterFixture(){
  const h=nativeFixture(),adapter=new NativeResponseView(h.view,before,conflict=>{throw Error(conflict.reason);},async()=>h.disk());
  adapter.setResponses([{id,body}]);return {...h,adapter};
}
function record(revision=1):LeaseRecord{return {coordinated:true,owner:'host',epoch:1,revision,expiresAt:Number.MAX_SAFE_INTEGER,request:{version:3,id,vaultId:'vault',host:{environmentId:'host',workspaceRoot:'/vault',directory:'.obsidian/t3-code/inline/v1'},notePath:'Note.md',threadId:'thread',messageId:id,projectId:'project',threadEnvironmentId:'host',initialHash:'initial',createdAt:'2026-10-10T00:00:00Z'},state:{requestHash:'request',accepted:true,notePath:'Note.md',status:'running',hashes:[],body,updatedAt:''}};}

test('final save drains a constructor-bound native save that already captured the old anchors',async()=>{
  const h=adapterFixture(),gate=deferred();h.edit(h.visible().replace('Ordinary text','Earlier ordinary edit'));h.view.requestSave();h.blockAdapter(gate.promise);
  const pendingNative=h.panes[0].fire();assert.equal(h.view.saving,true);
  let acquired=false;const pendingBarrier=h.adapter.beginFinalSave().then(release=>{acquired=true;return release;});
  await nextTurn();assert.equal(acquired,false);assert.deepEqual(h.writes,[]);
  // A second captured callback takes native saveAgain, whose eventual dynamic
  // view.save call must also remain behind the held final-write fence.
  await h.panes[0].fireCaptured();assert.equal(h.view.saveAgain,true);
  gate.resolve();await pendingNative;const release=await pendingBarrier;
  const saved=before.replace('Ordinary text','Earlier ordinary edit');assert.equal(h.disk(),saved);assert.equal(h.writes.length,1);assert.doesNotMatch(h.disk(),/retained output/);
  const final=saved.replace(responseAnchor(id),body);h.adapter.prepareMaterialization(saved,final,[id]);h.setDisk(final);assert.equal(h.adapter.acceptCommitted(final,[id]),true);release();
  if(h.panes[0].queued())await h.panes[0].fire();await nextTurn();
  assert.equal(h.disk(),final);assert.doesNotMatch(h.disk(),/t3-response:start/);assert.equal(h.disk().split('Earlier ordinary edit').length-1,1);h.adapter.dispose();
});

test('a late constructor-bound debounce cannot write during final delivery, including an edit made while held',async()=>{
  const h=adapterFixture();h.edit(h.visible().replace('Ordinary text','First edit'));h.view.requestSave();
  const release=await h.adapter.beginFinalSave();await h.panes[0].fire();assert.deepEqual(h.writes,[]);
  h.edit(h.visible().replace('Last paragraph','Edit during final delivery'));h.view.requestSave();await h.panes[0].fireCaptured();assert.deepEqual(h.writes,[]);
  const saved=before.replace('Ordinary text','First edit').replace('Last paragraph','Edit during final delivery'),final=saved.replace(responseAnchor(id),body);
  h.adapter.prepareMaterialization(saved,final,[id]);h.setDisk(final);assert.equal(h.adapter.acceptCommitted(final,[id]),true);
  release();release();assert.equal(Object.getOwnPropertyDescriptor(h.view,'lastSavedData')!.get,undefined);assert.equal(h.panes[0].queued(),true);await h.panes[0].fire();
  assert.equal(h.disk(),final);assert.doesNotMatch(h.disk(),/t3-response:start/);assert.equal(h.disk().split('Final reply').length-1,1);h.adapter.dispose();
});

test('releasing a failed final attempt resumes ordinary unsaved autosave without saving local generated text',async()=>{
  const h=adapterFixture(),release=await h.adapter.beginFinalSave();h.edit(h.visible().replace('Ordinary text','Unsaved ordinary edit'));h.view.requestSave();
  await h.panes[0].fireCaptured();assert.deepEqual(h.writes,[]);release();assert.equal(h.panes[0].queued(),true);await h.panes[0].fire();
  assert.equal(h.disk(),before.replace('Ordinary text','Unsaved ordinary edit'));assert.doesNotMatch(h.disk(),/Final reply|retained output/);assert.match(h.visible(),/Final reply/);h.adapter.dispose();
});

test('final delivery refuses a native baseline that cannot be safely fenced',async()=>{
  const h=adapterFixture();Object.defineProperty(h.view,'lastSavedData',{value:before,writable:true,configurable:false});
  await assert.rejects(h.adapter.beginFinalSave(),/cannot be fenced safely/);assert.equal(h.view.lastSavedData,before);h.adapter.dispose();
});

test('a final snapshot fences an initially unwrapped native pane and its retained debounce',async()=>{
  const h=nativeFixture(),manager=new NativeResponseManager(h.app);h.view.requestSave();
  assert.equal(manager.view(h.view),undefined);const release=await manager.beginFinalSave('Note.md');assert.ok(manager.view(h.view));assert.equal(manager.finalSaveReady('Note.md'),true);
  await h.panes[0].fire();assert.deepEqual(h.writes,[]);
  const final=before.replace(responseAnchor(id),body);manager.prepare('Note.md',before,final,[id]);h.setDisk(final);manager.committed('Note.md',final,[id]);release();
  if(h.panes[0].queued())await h.panes[0].fire();await nextTurn();assert.equal(h.disk(),final);assert.doesNotMatch(h.disk(),/t3-response:start/);manager.dispose();
});

test('an unwrapped pane save already captured before acquisition drains before the final snapshot',async()=>{
  const h=nativeFixture(),manager=new NativeResponseManager(h.app),gate=deferred();h.edit(before.replace('Ordinary text','Unwrapped ordinary edit'));h.view.requestSave();h.blockAdapter(gate.promise);
  const native=h.panes[0].fire();assert.equal(h.view.saving,true);let acquired=false;
  const acquiring=manager.beginFinalSave('Note.md').then(release=>{acquired=true;return release;});await nextTurn();assert.equal(acquired,false);assert.ok(manager.view(h.view));
  gate.resolve();await native;const release=await acquiring;assert.equal(manager.finalSaveReady('Note.md'),true);
  const saved=before.replace('Ordinary text','Unwrapped ordinary edit'),final=saved.replace(responseAnchor(id),body);
  assert.equal(h.disk(),saved);manager.prepare('Note.md',saved,final,[id]);h.setDisk(final);manager.committed('Note.md',final,[id]);release();await nextTurn();assert.equal(h.disk(),final);assert.doesNotMatch(h.disk(),/t3-response:start/);manager.dispose();
});

test('new pane baseline initialization retains dirty ordinary text, Sync text and exact canonical tool output',async()=>{
  const tool=renderResponseToolGroup({id:'baseline-tool',turnId:'turn',tools:[{id:'tool',turnId:'turn',key:'tool-key',status:'completed',label:'Ran command',activeLabel:'Running command',icon:'terminal',action:'command',sequence:1,command:'synthetic command',output:'Retained exact output 🎯 '.repeat(400)}]}),canonical=before.replace('Last paragraph','> '+tool+'\n\nLast paragraph'),h=nativeFixture(1,new Map(),canonical),manager=new NativeResponseManager(h.app);
  h.edit(canonical.replace('Ordinary text','Dirty ordinary edit'));h.view.requestSave();const incoming=canonical.replace('Last paragraph','Incoming ordinary edit');h.setDisk(incoming);
  const release=await manager.beginFinalSave('Note.md'),expected=incoming.replace('Ordinary text','Dirty ordinary edit');
  assert.equal(manager.view(h.view)!.saved(),expected);assert.equal(h.disk(),incoming);assert.doesNotMatch(h.visible(),/Retained exact output/);assert.match(h.visible(),/data-t3-tool-ref=/);
  await h.panes[0].fire();assert.deepEqual(h.writes,[]);
  const final=expected.replace(responseAnchor(id),'> Final reply');manager.prepare('Note.md',expected,final,[id]);h.setDisk(final);manager.committed('Note.md',final,[id]);release();
  if(h.panes[0].queued())await h.panes[0].fire();assert.equal(h.disk(),final);assert.ok(h.disk().includes(tool));assert.doesNotMatch(h.disk(),/data-t3-tool-ref=/);manager.dispose();
});

test('a new pane baseline refuses an incoming compact summary without canonical backing',async()=>{
  const tool=renderResponseToolGroup({id:'baseline-tool',turnId:'turn',tools:[{id:'tool',turnId:'turn',key:'tool-key',status:'completed',label:'Ran command',activeLabel:'Running command',icon:'terminal',action:'command',sequence:1,command:'synthetic command',output:'Full canonical output'}]}),canonical=before+'\n'+tool,h=nativeFixture(1,new Map(),canonical),manager=new NativeResponseManager(h.app),attempted=presentToolGroups(canonical).display;
  h.edit(canonical.replace('Ordinary text','Dirty ordinary edit'));h.view.requestSave();h.setDisk(attempted);
  await assert.rejects(manager.beginFinalSave('Note.md'),/no canonical/);assert.equal(h.disk(),attempted);assert.deepEqual(h.writes,[]);
  const conflict=manager.view(h.view)!.conflictRecord()!;assert.equal(conflict.unsafeIncoming,true);assert.equal(conflict.attemptedIncoming,attempted);assert.ok(conflict.local.includes(tool));assert.match(conflict.local,/Dirty ordinary edit/);
  await assert.rejects(h.panes[0].fire(),/no canonical/);assert.deepEqual(h.writes,[]);manager.dispose();
});

test('a new split pane immediately joins a held fence and invalidates the sealed final snapshot',async()=>{
  const h=nativeFixture(),manager=new NativeResponseManager(h.app);await manager.receive(record());const release=await manager.beginFinalSave('Note.md');
  const split=h.addPane();split.view.requestSave();manager.refresh();assert.ok(manager.view(split.view));
  await split.fire();assert.deepEqual(h.writes,[]);assert.equal(manager.finalSaveReady('Note.md'),false);
  await nextTurn();assert.equal(manager.finalSaveReady('Note.md'),false,'late admission must not silently restore the old snapshot');
  assert.throws(()=>manager.prepare('Note.md',before,before.replace(responseAnchor(id),body),[id]),/panes changed/);
  release();await nextTurn();assert.equal(Object.getOwnPropertyDescriptor(split.view,'lastSavedData')!.get,undefined);manager.dispose();
});

test('a late constructor-bound split save prevents verified final delivery and releases after its drain',async()=>{
  const h=nativeFixture(),manager=nativeResponses(h.app);await manager.receive(record());const io=deviceFinalNoteIO(h.app,()=>true),saved=(await io.read('Note.md'))!,final=saved.replace(responseAnchor(id),body),written=deferred(),finishWrite=deferred(),nativeGate=deferred();
  h.app.vault.process=async(_file:unknown,change:(current:string)=>string)=>{h.setDisk(change(h.disk()));written.resolve();await finishWrite.promise;return h.disk();};
  const committing=io.compareAndSetAttempt('Note.md',saved,final,'final-attempt');await written.promise;
  const split=h.addPane();split.edit(before.replace('Last paragraph','Late split ordinary edit'));split.view.requestSave();h.blockAdapter(nativeGate.promise);
  const native=split.fire();assert.equal(split.view.saving,true);manager.refresh();assert.ok(manager.view(split.view));
  finishWrite.resolve();assert.deepEqual(await committing,{status:'written-unverified'});assert.equal(h.disk(),final);
  assert.equal(typeof Object.getOwnPropertyDescriptor(split.view,'lastSavedData')!.get,'function','the pending late pane remains fenced until its captured save drains');
  nativeGate.resolve();await native;
  for(let n=0;n<50&&Object.getOwnPropertyDescriptor(split.view,'lastSavedData')!.get;n++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(Object.getOwnPropertyDescriptor(split.view,'lastSavedData')!.get,undefined);
  assert.match(h.disk(),/Late split ordinary edit/);assert.equal(manager.view(split.view)?.responseBody(id),body);manager.dispose();
});

test('reload waits for a held final save and succeeds after the save fence is released',async()=>{
  const h=nativeFixture(),manager=new NativeResponseManager(h.app);manager.configurePreviewCache('vault',undefined,async()=>{});await manager.receive(record());
  const release=await manager.beginFinalSave('Note.md');await assert.rejects(manager.prepareReload(),/final|delivery|save/i);release();await manager.prepareReload();manager.dispose();
});

test('reload checks again when a final save starts during awaited preview persistence',async()=>{
  const h=nativeFixture(),manager=new NativeResponseManager(h.app),persisting=deferred(),started=deferred();
  manager.configurePreviewCache('vault',undefined,async()=>{started.resolve();await persisting.promise;});await manager.receive(record());
  const reload=manager.prepareReload();await started.promise;const release=await manager.beginFinalSave('Note.md');persisting.resolve();
  await assert.rejects(reload,/final|delivery|save/i);release();await manager.prepareReload();manager.dispose();
});

test('Stop seals the clicked pane and retains all tool output before it drops the stream cache',async()=>{
  const h=nativeFixture(2),manager=new NativeResponseManager(h.app);let checkpoint:unknown;manager.configurePreviewCache('vault',undefined,async value=>{checkpoint=structuredClone(value);});await manager.receive(record());
  const selectedBody=body.replace('Final reply','Clicked pane reply');manager.view(h.panes[1].view)!.setResponses([{id,body:selectedBody}]);
  manager.stop(id,'Note.md',false,h.panes[1].view);assert.equal(manager.stoppedBody(id),selectedBody);
  for(const pane of h.panes){assert.match(pane.visible(),/Clicked pane reply/);assert.doesNotMatch(pane.visible(),/> Final reply/);assert.equal(pane.view.getViewData(),before);}
  const retained=h.local.get('t3-local-response-stops-v1:vault') as Array<{body:string}>;assert.equal(retained[0].body,selectedBody);
  await manager.flushPreviewCache();assert.deepEqual((checkpoint as any).entries,[]);assert.equal(h.disk(),before);manager.dispose();
});

test('failed durable Stop leaves the visible response and cached recovery intact',async()=>{
  const h=nativeFixture(),manager=new NativeResponseManager(h.app);let checkpoint:any;manager.configurePreviewCache('vault',undefined,async value=>{checkpoint=structuredClone(value);});await manager.receive(record());
  const latest=body.replace('Final reply','Latest partial reply');manager.stream({request:record().request,messageId:id,sequence:8,body:latest});h.failStorage(true);
  assert.throws(()=>manager.stop(id,'Note.md',false,h.view),/Device storage unavailable/);assert.equal(manager.stoppedBody(id),undefined);assert.match(h.visible(),/Latest partial reply/);
  await manager.flushPreviewCache();assert.equal(checkpoint.entries[0].body,latest);h.failStorage(false);manager.stop(id,'Note.md',false,h.view);assert.equal(manager.stoppedBody(id),latest);manager.dispose();
});

test('three reloads preserve a stopped large response once and keep late host or stream text out',async()=>{
  const local=new Map<string,unknown>();let checkpoint:unknown;let h=nativeFixture(2,local),manager=new NativeResponseManager(h.app);
  const configure=()=>manager.configurePreviewCache('vault',checkpoint,async value=>{checkpoint=structuredClone(value);});configure();await manager.receive(record());
  manager.stop(id,'Note.md',false,h.panes[1].view);
  for(let reload=0;reload<3;reload++){
    await manager.prepareReload();assert.equal(h.disk(),before);manager.dispose();h=nativeFixture(2,local);manager=new NativeResponseManager(h.app);configure();manager.refresh();
    await manager.receive({...record(20+reload),state:{...record().state!,body:'> Delayed host output'}});manager.stream({request:record().request,messageId:id,sequence:100+reload,body:'> Late direct output'});
    for(const pane of h.panes){assert.equal(pane.visible().split('Final reply').length-1,1);assert.equal(pane.visible().split('retained output ').length-1,1000);assert.doesNotMatch(pane.visible(),/Delayed host|Late direct/);assert.equal(pane.view.getViewData(),before);}
  }
  await manager.prepareReload();assert.equal(h.disk(),before);manager.dispose();
});

test('identical durable Stops do not serialize or rewrite the frozen body list',async()=>{
  const h=nativeFixture(),manager=new NativeResponseManager(h.app);manager.configurePreviewCache('vault',undefined,async()=>{});await manager.receive(record());
  await manager.stop(id,'Note.md',false,h.view);const count=h.storageWrites.length;
  for(let n=0;n<4;n++){await manager.stop(id,'Note.md',false,h.view);manager.refresh();}
  assert.equal(h.storageWrites.length,count);assert.equal(manager.stoppedBody(id),body);manager.dispose();
});

function contentElement(){
  const children:any[]=[];return {ownerDocument:{defaultView:undefined},children,createDiv:()=>{const element:any={isConnected:true,textContent:'',setAttribute(){},setText(text:string){this.textContent=text;},remove(){this.isConnected=false;}};return element;},prepend:(element:any)=>{children.unshift(element);}};
}
function granted(revision=2):LeaseRecord {return {...record(revision),state:{...record().state!,body:'**T3 · Working**\n\n> Stale checkpoint reply'},finalWriter:{actor:'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee',token:'retained-token',messageId:id,turnId:'completed-turn',sequence:20,body,phase:'complete'}};}
test('a retained final grant replaces stale stream and reconnect text without adding a save banner',async()=>{
  const initial=nativeFixture(),first=new NativeResponseManager(initial.app);let checkpoint:unknown;first.configurePreviewCache('vault',undefined,async value=>{checkpoint=structuredClone(value);});await first.receive(record());first.stream({request:record().request,messageId:id,sequence:10,body:'**T3 · Working**\n\n> Stale cached reply'});await first.prepareReload();first.dispose();
  const h=nativeFixture(),manager=new NativeResponseManager(h.app),element=contentElement();h.view.contentEl=element;
  manager.configurePreviewCache('vault',checkpoint,async()=>{});await manager.receive(granted());
  assert.match(h.visible(),/Final reply/);assert.equal(h.visible().split('retained output ').length-1,1000);assert.doesNotMatch(h.visible(),/Working|Stale|Reconnecting/);assert.equal(h.view.getViewData(),before);
  assert.equal(element.children.length,0);
  await manager.receive({...granted(3),state:{...granted().state!,status:'conflict'}});assert.equal(element.children.length,0);assert.equal(h.view.getViewData(),before);manager.dispose();
});

test('a closed-pane Stop uses the permanent final body rather than stale checkpoint prose',async()=>{
  const h=nativeFixture(),manager=new NativeResponseManager(h.app);manager.configurePreviewCache('vault',undefined,async()=>{});await manager.receive(granted());h.app.workspace.getLeavesOfType=()=>[];manager.refresh();
  await manager.stop(id,'Note.md');assert.equal(manager.stoppedBody(id),body);manager.dispose();
});

test('host Stop recovery retains the exact original partial across restart instead of refreezing a final grant',async()=>{
  const frozen='**T3 · Working**\n\n> Original frozen partial\n\n<details><summary>Frozen tool</summary><pre>exact retained bytes</pre></details>\n';
  const retained=new Map<string,NativeStoppedResponse>(),store:NativeStoppedStore={readAll:async()=>[...retained.values()].map(stop=>({...stop})),write:async stop=>{retained.set(stop.id,{...stop});}};
  const h=nativeFixture(),manager=new NativeResponseManager(h.app);manager.configurePreviewCache('vault',undefined,async()=>{});await manager.configureStoppedStore(store);await manager.receive(record());
  await manager.receive({...granted(),stopRequestedAt:100_000,stoppedBody:frozen});
  assert.equal(manager.stoppedBody(id),frozen);assert.equal(retained.get(id)!.body,frozen);assert.match(h.visible(),/Original frozen partial/);assert.doesNotMatch(h.visible(),/Final reply|Stale checkpoint reply/);assert.equal(h.view.getViewData(),before);await manager.prepareReload();manager.dispose();
  const reopened=nativeFixture(),next=new NativeResponseManager(reopened.app);next.configurePreviewCache('vault',undefined,async()=>{});await next.configureStoppedStore(store);await next.receive({...granted(3),stopRequestedAt:100_000,stoppedBody:frozen});
  assert.equal(next.stoppedBody(id),frozen);assert.equal(reopened.visible().split('Original frozen partial').length-1,1);assert.doesNotMatch(reopened.visible(),/Final reply|Stale checkpoint reply/);assert.equal(reopened.view.getViewData(),before);next.dispose();
});

test('async Stop freezes now, retains preview recovery until storage commits, and reload waits for its body',async()=>{
  const h=nativeFixture(),manager=new NativeResponseManager(h.app),gate=deferred(),durable=new Map<string,NativeStoppedResponse>();let checkpoint:any,calls=0;
  const store:NativeStoppedStore={readAll:async()=>[...durable.values()].map(stop=>({...stop})),write:async stop=>{calls++;await gate.promise;durable.set(stop.id,{...stop});}};
  manager.configurePreviewCache('vault',undefined,async value=>{checkpoint=structuredClone(value);});await manager.configureStoppedStore(store);await manager.receive(record());await manager.flushPreviewCache();
  const stop=manager.stop(id,'Note.md',false,h.view);assert.equal(manager.stoppedBody(id),body);manager.stream({request:record().request,messageId:id,sequence:99,body:'> Late output'});assert.doesNotMatch(h.visible(),/Late output/);
  await manager.flushPreviewCache();assert.equal(checkpoint.entries[0].body,body);assert.equal(h.storageWrites.length,0);
  let ready=false;const reload=manager.prepareReload().then(()=>{ready=true;});await nextTurn();assert.equal(ready,false);gate.resolve();await stop;await reload;assert.deepEqual(checkpoint.entries,[]);assert.equal(durable.get(id)!.body,body);
  await manager.stop(id,'Note.md');assert.equal(calls,1);manager.dispose();
  const reopened=nativeFixture(),next=new NativeResponseManager(reopened.app);next.configurePreviewCache('vault',checkpoint,async()=>{});await next.configureStoppedStore(store);assert.equal(reopened.visible().split('Final reply').length-1,1);assert.equal(reopened.view.getViewData(),before);next.dispose();
});

test('async Stop storage failure preserves full frozen and preview bodies and blocks reload until exact retry succeeds',async()=>{
  const h=nativeFixture(),manager=new NativeResponseManager(h.app);let fail=true,checkpoint:any,calls=0;
  manager.configurePreviewCache('vault',undefined,async value=>{checkpoint=structuredClone(value);});await manager.configureStoppedStore({readAll:async()=>[],write:async stop=>{calls++;assert.equal(stop.body,body);if(fail)throw Error('Disk full');}});await manager.receive(record());
  await assert.rejects(Promise.resolve(manager.stop(id,'Note.md')),/Disk full/);assert.equal(manager.stoppedBody(id),body);assert.match(h.visible(),/Final reply/);await manager.flushPreviewCache();assert.equal(checkpoint.entries[0].body,body);await assert.rejects(manager.prepareReload(),/durable frozen/);
  fail=false;await manager.stop(id,'Note.md');await manager.prepareReload();assert.equal(calls,2);assert.deepEqual(checkpoint.entries,[]);manager.dispose();
});

test('legacy stopped bodies stay in localStorage until migration commits and failed restore prevents reload',async()=>{
  const legacy={id,path:'Note.md',body,hidden:false},local=new Map<string,unknown>([['t3-local-response-stops-v1:vault',[legacy]]]),h=nativeFixture(1,local),manager=new NativeResponseManager(h.app),gate=deferred();let retained:NativeStoppedResponse|undefined;
  manager.configurePreviewCache('vault',undefined,async()=>{});const migrating=manager.configureStoppedStore({readAll:async()=>[],write:async stop=>{await gate.promise;retained={...stop};}});await nextTurn();assert.deepEqual(local.get('t3-local-response-stops-v1:vault'),[legacy]);gate.resolve();await migrating;assert.deepEqual(retained,legacy);assert.deepEqual(local.get('t3-local-response-stops-v1:vault'),[]);await manager.prepareReload();manager.dispose();
  const failedLocal=new Map<string,unknown>([['t3-local-response-stops-v1:vault',[legacy]]]),failed=nativeFixture(1,failedLocal),other=new NativeResponseManager(failed.app);other.configurePreviewCache('vault',undefined,async()=>{});await assert.rejects(other.configureStoppedStore({readAll:async()=>{throw Error('Storage blocked');},write:async()=>{}}),/Storage blocked/);assert.deepEqual(failedLocal.get('t3-local-response-stops-v1:vault'),[legacy]);assert.equal(other.stoppedBody(id),body);await assert.rejects(other.prepareReload(),/durable frozen/);other.dispose();
});

test('a late frozen-store commit retains the body without rewrapping an unloaded native view',async()=>{
  const h=nativeFixture(),manager=new NativeResponseManager(h.app),gate=deferred();let retained:NativeStoppedResponse|undefined;
  manager.configurePreviewCache('vault',undefined,async()=>{});await manager.configureStoppedStore({readAll:async()=>[],write:async stop=>{await gate.promise;retained={...stop};}});await manager.receive(record());
  const stop=manager.stop(id,'Note.md');manager.dispose();assert.equal(manager.view(h.view),undefined);gate.resolve();await stop;assert.equal(retained!.body,body);assert.equal(manager.view(h.view),undefined);assert.equal(h.visible(),before);
});
