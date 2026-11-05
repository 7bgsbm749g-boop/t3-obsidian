import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {contentHash} from '../src/responses/completion';
import {updateResponseBindingData,responseBindingRequests,type ResponseBindingData} from '../src/responses/response-binding-data';
import {LocalResponseManager} from '../src/responses/local-response-manager';
import {localResponseBindings,localResponseRange,withLocalResponseBinding} from '../src/responses/local-response-binding';
import {localSyncReady} from '../src/storage/local-sync-state';
import {responseAnchor} from '../src/responses/native-response-projection';
import {NativeResponseView} from '../src/responses/native-response-view';
import {checkedStageDraft,editPath} from '../src/notes/checked-note-edits';
import {retainedLocalFinal,restoredLocalFinal} from '../src/responses/local-final-cache';
import type {ResponseRequest} from '../src/responses/response-model';
import type {DirectInlineUpdate} from '../src/responses/direct-inline-preview';
import {loadSmartSend,rememberNoteEdits,rememberResponse,prepareSmartSend} from '../src/notes/smart-send';

function request():ResponseRequest{return {version:4,localOnly:true,nativeProjection:true,responseContainer:true,independent:true,id:randomUUID(),initialOwner:randomUUID(),vaultId:'vault',host:{environmentId:'env',workspaceRoot:'/synthetic',directory:'.obsidian/t3-code/inline/v1'},notePath:'Test.md',threadId:randomUUID(),projectId:randomUUID(),messageId:randomUUID(),threadEnvironmentId:'env',initialHash:contentHash(''),createdAt:'2026-10-14T00:00:00Z'};}
function fixture(binding=request(),initial?:string,records:ResponseBindingData={},stops?:unknown){
  let document=initial??`Before\n\n${responseAnchor(binding.id)}\n\nAfter`,open=true,ready=true,now=0,writes=0;
  const callbacks=new Map<string,(update:DirectInlineUpdate)=>void>(),registered:any[]=[],errors:any[]=[],finished:string[]=[];
  const io:any={localBindings:()=>responseBindingRequests(records),saveLocalBinding:async(request:ResponseRequest)=>{records=updateResponseBindingData(records,request,'test');},openedNotes:()=>open?[{path:binding.notePath,document}]:[],readNote:async()=>document,updateNote:async(_path:string,change:(text:string)=>string)=>document=change(document),saveLocalNote:async()=>{},syncReady:()=>ready,isOpen:()=>open,access:async()=>{throw Error('No host or T3 access needed by this replay.');},receiveCoordinated:(record:any)=>registered.push(record),receiveDirect:()=>{},localCompleted:(id:string)=>finished.push(id),completionFailed:(error:any)=>errors.push(error)};
  io.loadStops=()=>stops;
  const notes={read:async()=>document,compareAndSet:async(_path:string,before:string,after:string,guard?:()=>boolean)=>{if(document!==before||guard?.()===false)return false;document=after;writes++;return true;}};
  const manager=new LocalResponseManager(randomUUID(),'vault',io,notes,()=>now,(record,_access,receive)=>{callbacks.set(record.request.id,receive);return {tick:()=>{},update:()=>{},delivery:()=>{},reconnect:()=>{},suspend:()=>{},dispose:()=>{}} as any;});
  return {binding,manager,io,notes,records:()=>records,receiveRecords:(value:ResponseBindingData)=>records=value,callbacks,registered,errors,finished,read:()=>document,write:(text:string)=>document=text,open:(value:boolean)=>open=value,ready:(value:boolean)=>ready=value,advance:()=>now+=1100,writes:()=>writes,emit:(body='Final answer',verified=true,messageId=binding.messageId)=>callbacks.get(binding.id)!({request:binding,messageId,sequence:5,body,turnId:'exact-turn',phase:'complete',completionVerified:verified})};
}
const drain=async()=>{for(let n=0;n<8;n++)await new Promise(resolve=>setImmediate(resolve));};
const recover=async(h:ReturnType<typeof fixture>)=>{h.manager.resume();await (h.manager as any).recoveryWork;await drain();};

test('reload restores Working and its watch before the saved note is opened',async()=>{
  const binding=request(),h=fixture(binding,undefined,updateResponseBindingData({},binding,'A'));h.open(false);
  let ticks=0;await recover(h);
  const runtime=(h.manager as any).jobs.get(binding.id);runtime.preview.tick=()=>ticks++;
  assert.equal(h.registered.length,1);assert.equal(h.manager.responses()[0].active,true);assert.equal(h.writes(),0);
  h.manager.tick();assert.equal(ticks,1,'The recovered closed reply retains its background watch');
  h.emit('Final answer');await drain();assert.equal(h.manager.responses()[0].active,false);assert.equal(h.manager.responses()[0].complete,true);assert.equal(h.writes(),0,'Closed ordinary notes retain the final-save boundary');
  h.open(true);h.manager.resume();await drain();assert.equal(h.writes(),1);h.manager.dispose();
});

test('closed recovery reads a shared note once and skips historical, missing and stopped anchors',async()=>{
  const active=request(),second={...request(),notePath:active.notePath},historical={...request(),notePath:active.notePath},missing={...request(),notePath:'Missing.md'},stopped={...request(),notePath:'Stopped.md'};
  let records:ResponseBindingData={};for(const binding of [active,second,historical,missing,stopped])records=updateResponseBindingData(records,binding,'A');
  const document=responseAnchor(active.id)+'\n'+responseAnchor(second.id),h=fixture(active,document,records);h.open(false);h.io.loadStops=()=>[stopped.id];
  // Stops recorded after construction are also honored before an in-flight read attaches.
  h.manager.stopLocally(stopped.id);
  const reads:string[]=[];h.io.readNote=async(path:string)=>{reads.push(path);return path===active.notePath?document:undefined;};
  await recover(h);assert.deepEqual(reads,[active.notePath,missing.notePath]);
  assert.deepEqual(h.manager.responses().map(response=>response.id).sort(),[active.id,second.id].sort());
  for(let n=0;n<30;n++)h.manager.tick();await recover(h);assert.equal(reads.length,2,'Frequent timer ticks must not rescan old records');
  assert.equal(h.writes(),0);h.manager.dispose();
});

test('persisted stops prevent startup recovery and malformed stop storage uses an empty list',async()=>{
  for(const stopped of [true,false]){
    const binding=request(),h=fixture(binding,undefined,updateResponseBindingData({},binding,'A'),stopped?[binding.id]:{});h.open(false);
    await recover(h);assert.equal(h.registered.length,stopped?0:1);h.manager.dispose();
  }
});

test('closed recovery rejects duplicate, fenced and nonempty anchors without rewriting notes',async()=>{
  const binding=request(),anchor=responseAnchor(binding.id);
  for(const document of [anchor+'\n'+anchor,'```\n'+anchor+'\n```',anchor.replace('\n\n','\nEdited content\n')]){
    const h=fixture(binding,document,updateResponseBindingData({},binding,'A'));h.open(false);await recover(h);
    assert.equal(h.registered.length,0);assert.equal(h.writes(),0);assert.equal(h.read(),document);h.manager.dispose();
  }
});

test('closed note changes invalidate one cached path and incoming completion retires its watch',async()=>{
  const binding=request(),h=fixture(binding,'Before',updateResponseBindingData({},binding,'A'));h.open(false);
  let reads=0;h.io.readNote=async()=>{reads++;return h.read();};await recover(h);assert.equal(h.registered.length,0);
  h.write(responseAnchor(binding.id));h.manager.changed(binding.notePath);await recover(h);assert.equal(h.registered.length,1);assert.equal(reads,2);
  h.write('Final answer received through Sync');h.manager.changed(binding.notePath);await recover(h);
  assert.equal(reads,3);assert.equal(h.manager.responses().length,0);assert.deepEqual(h.finished,[binding.id]);h.manager.dispose();
});

test('closed bindings arriving after startup recover without reopening the note',async()=>{
  const binding=request(),h=fixture(binding);h.open(false);await recover(h);assert.equal(h.registered.length,0);
  h.receiveRecords(updateResponseBindingData({},binding,'A'));await recover(h);assert.equal(h.registered.length,1);h.manager.dispose();
});

test('closed recovery discards a read invalidated by a note change or plugin disposal',async()=>{
  for(const action of ['changed','deleted','dispose'] as const){
    const binding=request(),h=fixture(binding,undefined,updateResponseBindingData({},binding,'A'));h.open(false);
    const before=h.read();let release!:(value:string)=>void,reads=0;
    h.io.readNote=async()=>{if(reads++===0)return new Promise<string>(resolve=>release=resolve);return 'Anchor removed';};
    h.manager.resume();const pending=(h.manager as any).recoveryWork;
    if(action==='changed')h.manager.changed(binding.notePath);else if(action==='deleted')h.manager.deleted(binding.notePath);else h.manager.dispose();
    release(before);await pending;await drain();assert.equal(h.registered.length,0);assert.equal(h.manager.responses().length,0);h.manager.dispose();
  }
});

test('closed recovery replaces an in-flight stale settings read and limits file reads to one at a time',async()=>{
  const binding=request(),other={...request(),notePath:'Other.md'},h=fixture(binding,undefined,updateResponseBindingData({},binding,'A'));h.open(false);
  let release!:(value:string)=>void,reading=0,peak=0,reads=0;
  h.io.readNote=async(path:string)=>{reading++;peak=Math.max(peak,reading);try{if(reads++===0)return await new Promise<string>(resolve=>release=resolve);return path===binding.notePath?h.read():responseAnchor(other.id);}finally{reading--;}};
  h.manager.resume();const next={...binding,localMessageId:randomUUID()};
  h.receiveRecords(updateResponseBindingData(updateResponseBindingData({},next,'B'),other,'B'));h.manager.resume();release(h.read());await recover(h);
  assert.equal(peak,1);assert.equal(h.manager.request(binding.id)?.localMessageId,next.localMessageId);assert.equal(h.registered.length,2);h.manager.dispose();
});

test('closed read failures back off and saved note checks never run again on unchanged timer ticks',async()=>{
  const binding=request(),h=fixture(binding,undefined,updateResponseBindingData({},binding,'A'));h.open(false);let reads=0;
  h.io.readNote=async()=>{reads++;throw Error('Transient vault read failure');};await recover(h);
  for(let n=0;n<20;n++)h.manager.tick();await recover(h);assert.equal(reads,1);
  for(let n=0;n<5;n++)h.advance();h.io.readNote=async()=>{reads++;return h.read();};await recover(h);
  assert.equal(reads,2);assert.equal(h.registered.length,1);h.manager.dispose();
});

test('a refresh between final note replacement and save completion waits for the in-flight commit',async()=>{
 const h=fixture();await h.manager.register(h.binding);await drain();
 let release!:()=>void,entered=false;const pending=new Promise<void>(resolve=>release=resolve),save=h.notes.compareAndSet;
 h.notes.compareAndSet=async(...args)=>{const result=await save(...args);entered=true;h.manager.tick();await pending;return result;};
 h.emit();await drain();assert.equal(entered,true);assert.equal(h.writes(),1);assert.equal(h.manager.status(h.binding.id)?.finalSaved,false);
 const result=h.manager.waitForSave(h.binding.id,1000);release();assert.deepEqual(await result,{saved:true});assert.equal(h.writes(),1);h.manager.dispose();
});

test('staged edits persist their Smart Send exclusions before final write and keep later user additions',async()=>{
  const h=fixture(),data=loadSmartSend(undefined),events:string[]=[];
  await h.manager.register(h.binding);
  h.io.localFinalDraft=async(document:string)=>document.replace('Before','Agent first.\nAgent last.');
  h.io.rememberNoteEdits=async(request:ResponseRequest,before:string,after:string)=>{events.push('edit');await rememberNoteEdits(data,request.notePath,request.id,before,after);};
  h.io.rememberResponse=async(request:ResponseRequest,body:string,before:string,after:string,offset:number)=>{events.push('reply');await rememberResponse(data,request.notePath,request.id,body,before,after,offset);};
  const write=h.notes.compareAndSet;h.notes.compareAndSet=async(...args)=>{events.push('write');return write(...args);};
  h.emit();await drain();
  assert.deepEqual(events,['edit','reply','write']);assert.equal(h.writes(),1);
  const document=h.read().replace('Agent first.','Agent first.\nUser insertion.')+'\nUser ending.';
  const sent=(await prepareSmartSend(loadSmartSend(JSON.parse(JSON.stringify(data))),h.binding.notePath,'another-thread',document)).text;
  assert.match(sent,/User insertion\./);assert.match(sent,/User ending\./);assert.match(sent,/After/);assert.doesNotMatch(sent,/Agent|Final answer/);
  h.manager.dispose();
});
test('failed staged edit provenance persistence prevents the final write',async()=>{
  const h=fixture();await h.manager.register(h.binding);
  h.io.localFinalDraft=async(document:string)=>document.replace('Before','Agent edit');
  h.io.rememberNoteEdits=async()=>{throw Error('Provenance storage unavailable');};
  h.emit();await drain();assert.equal(h.writes(),0);assert.match(h.read(),/^Before/);assert.equal(h.errors.length,1);h.manager.dispose();
});

test('completion indicators retain the exact canonical run and time after the final save',async()=>{
  const h=fixture();await h.manager.register(h.binding);
  const turn={turnId:'exact-turn',state:'completed',completedAt:'2026-10-14T00:01:00Z'};
  h.callbacks.get(h.binding.id)!({request:h.binding,messageId:h.binding.messageId,sequence:5,body:'Final answer',turnId:turn.turnId,phase:'complete',completionVerified:true,checkpoint:{turns:{[turn.turnId]:turn}}});
  await drain();
  assert.equal(h.writes(),1);
  assert.deepEqual(h.manager.responses()[0].completion,{environmentId:'env',projectId:h.binding.projectId,threadId:h.binding.threadId,runId:turn.turnId,completedAt:turn.completedAt});
  h.manager.dispose();
});

test('fresh devices reconnect from a synced binding and save final text without a host grant',async()=>{
  const first=fixture();await first.manager.register(first.binding);
  const saved=first.read();assert.equal(localResponseBindings(saved,responseBindingRequests(first.records())).length,1);assert.doesNotMatch(saved,/t3-response-binding/);assert.equal(saved.includes('Final answer'),false);
  const second=fixture(first.binding,saved,first.records());second.manager.resume();assert.equal(second.registered.length,1);
  second.emit();await drain();assert.equal(second.read(),'Before\n\nFinal answer\n\nAfter');assert.equal(second.writes(),1);
  second.emit();second.manager.tick();await drain();assert.equal(second.writes(),1);assert.deepEqual(second.errors,[]);
  first.manager.dispose();second.manager.dispose();
});
test('two independent devices produce exactly identical final notes',async()=>{
  const a=fixture();await a.manager.register(a.binding);const b=fixture(a.binding,a.read(),a.records());b.manager.resume();
  a.emit();b.emit();await drain();assert.equal(a.read(),b.read());assert.equal(a.writes(),1);assert.equal(b.writes(),1);
  assert.equal(localResponseBindings(a.read()).length,0);a.manager.dispose();b.manager.dispose();
});
test('completion waits for core Sync and resumes while the note remains loaded',async()=>{
  const h=fixture();await h.manager.register(h.binding);h.ready(false);h.emit();await drain();assert.equal(h.writes(),0);
  h.ready(true);h.manager.tick();await drain();assert.equal(h.writes(),1);h.manager.dispose();
});
test('final-save status, preparation, and the atomic write check the exact destination path',async()=>{
  const h=fixture();await h.manager.register(h.binding);const paths:string[]=[];
  h.io.syncReady=(path:string)=>{paths.push(path);return path===h.binding.notePath;};
  h.emit();await drain();assert.equal(h.writes(),1);assert.ok(paths.length>=4);assert.ok(paths.every(path=>path===h.binding.notePath));h.manager.dispose();
});
test('a note Sync update arriving at the write boundary prevents the old final save',async()=>{
  const h=fixture();await h.manager.register(h.binding);const compare=h.notes.compareAndSet;
  h.notes.compareAndSet=async(...args)=>{h.ready(false);return compare(...args);};
  h.emit();await drain();assert.equal(h.writes(),0);assert.equal(h.manager.status(h.binding.id)?.pendingSaveReason,'sync');
  h.notes.compareAndSet=compare;h.write(h.read().replace('Before','Incoming ordinary edit'));h.ready(true);h.advance();h.manager.tick();await drain();
  assert.equal(h.writes(),1);assert.match(h.read(),/^Incoming ordinary edit/);h.manager.dispose();
});
test('renaming a destination while a final write waits invalidates its old path guard',async()=>{
  const h=fixture();await h.manager.register(h.binding);const compare=h.notes.compareAndSet;
  h.notes.compareAndSet=async(...args)=>{h.manager.renamed(h.binding.notePath,'Renamed.md');return compare(...args);};
  h.emit();await drain();assert.equal(h.writes(),0);h.manager.dispose();
});
test('unverified output and another message cannot replace this response',async()=>{
  const h=fixture();await h.manager.register(h.binding);h.emit('Preview',false);await drain();assert.equal(h.writes(),0);
  h.emit('Other turn',true,randomUUID());await drain();assert.equal(h.writes(),0);h.manager.dispose();
});
test('closed notes defer completion until they load again',async()=>{
  const h=fixture();await h.manager.register(h.binding);h.open(false);h.emit();await drain();assert.equal(h.writes(),0);
  h.open(true);h.manager.tick();await drain();assert.equal(h.writes(),1);h.manager.dispose();
});
test('an imported completed run saves through checked note IO after its tab closes',async()=>{
  const h=fixture();h.binding.importTurn={turnId:'exact-turn',messageId:h.binding.messageId,state:'completed',requestedAt:h.binding.createdAt,completedAt:h.binding.createdAt};
  await h.manager.register(h.binding);h.open(false);h.emit('Imported final');await drain();
  assert.equal(h.writes(),1);assert.match(h.read(),/Imported final/);assert.doesNotMatch(h.read(),/:::send-to-t3-response/);
  assert.deepEqual(await h.manager.waitForSave(h.binding.id,0),{saved:true});h.manager.dispose();
});
test('a closed imported response retries its save when Sync becomes ready',async()=>{
  const h=fixture();h.binding.importTurn={turnId:'exact-turn',messageId:h.binding.messageId,state:'completed',requestedAt:h.binding.createdAt,completedAt:h.binding.createdAt};
  await h.manager.register(h.binding);h.open(false);h.ready(false);h.emit();await drain();
  assert.deepEqual(await h.manager.waitForSave(h.binding.id,0),{saved:false,reason:'sync'});assert.equal(h.writes(),0);
  assert.equal(h.manager.status(h.binding.id)?.pendingSaveReason,'sync');
  h.ready(true);h.manager.tick();await drain();assert.equal(h.writes(),1);assert.deepEqual(await h.manager.waitForSave(h.binding.id,0),{saved:true});h.manager.dispose();
});
test('import completion waits for the verified note write and bounds a pending verification',async()=>{
  const h=fixture();await h.manager.register(h.binding);
  const start=Date.now(),unverified=await h.manager.waitForSave(h.binding.id,20);
  assert.deepEqual(unverified,{saved:false,reason:'verification'});assert.ok(Date.now()-start<1000);assert.equal(h.writes(),0);
  const compare=h.notes.compareAndSet;let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  h.notes.compareAndSet=async(...args)=>{await gate;return compare(...args);};
  h.emit();await drain();let completed=false;const wait=h.manager.waitForSave(h.binding.id,1000).then(result=>{completed=true;return result;});
  await drain();assert.equal(completed,false);assert.equal(h.writes(),0);release();
  assert.deepEqual(await wait,{saved:true});assert.equal(h.writes(),1);h.manager.dispose();
});
test('a refused final write reports a pending note change and a deleted response is not certified as saved',async()=>{
  const h=fixture();await h.manager.register(h.binding);h.notes.compareAndSet=async()=>false;
  h.emit();await drain();assert.deepEqual(await h.manager.waitForSave(h.binding.id,0),{saved:false,reason:'note-changed'});assert.equal(h.writes(),0);h.manager.dispose();
  const removed=fixture();await removed.manager.register(removed.binding);removed.write('The response was removed.');removed.emit();await drain();
  assert.deepEqual(await removed.manager.waitForSave(removed.binding.id,0),{saved:false,reason:'note-changed'});assert.equal(removed.writes(),0);removed.manager.dispose();
});
test('a closed response keeps its completion watch and projects only verified success for the explorer',async()=>{
  const h=fixture();await h.manager.register(h.binding);
  let ticks=0,suspends=0;
  const runtime=(h.manager as any).jobs.get(h.binding.id);runtime.preview.tick=()=>ticks++;runtime.preview.suspend=()=>suspends++;
  h.open(false);h.manager.tick();assert.equal(ticks,1);assert.equal(suspends,0);
  h.emit('Not verified',false);assert.equal(h.manager.responses()[0].complete,false);
  h.emit('Final answer');await drain();
  assert.equal(h.writes(),0);assert.equal(h.manager.responses()[0].complete,true);assert.equal(h.manager.responses()[0].active,false);
  const identity=h.manager.responses()[0].completionId;
  h.manager.tick();assert.equal(suspends,1,'Verified runs release their background watch');
  h.open(true);h.manager.tick();await drain();
  assert.equal(h.writes(),1);assert.equal(h.manager.responses()[0].complete,true);assert.equal(h.manager.responses()[0].completionId,identity);
  h.manager.dispose();
});
test('a removed attachment cannot keep an unverified terminal preview active in the explorer',async()=>{
  const h=fixture();await h.manager.register(h.binding);h.emit('Final preview',false);
  assert.equal(h.manager.responses()[0].active,true);
  h.write('Final text received from another device');h.manager.resume();await drain();
  assert.equal(h.manager.responses().length,0,'Only a verified successful completion survives attachment retirement');
  h.manager.dispose();
});
test('explicit Stop saves its frozen local text while completion is waiting for Sync',async()=>{
  const h=fixture();await h.manager.register(h.binding);h.ready(false);h.emit('Canonical final');await drain();
  const receipt=await h.manager.stop(h.binding.id,'Frozen visible text');assert.equal(receipt.finalSaved,true);assert.equal(receipt.hostRecorded,true);assert.match(h.read(),/Frozen visible text/);assert.equal(h.writes(),1);h.manager.dispose();
});
test('a stale response block that returns through Sync can be replaced with the same final result',async()=>{
  const h=fixture();await h.manager.register(h.binding);const original=h.read();h.emit();await drain();const final=h.read();
  h.write(original);h.advance();h.manager.resume();h.emit();await drain();assert.equal(h.read(),final);assert.equal(h.writes(),2);h.manager.dispose();
});
test('verified final recovery survives reload without another T3 read and rejects another binding',async()=>{
  const first=fixture();await first.manager.register(first.binding);first.ready(false);
  let saved:any;first.io.retainLocalFinal=async(update:DirectInlineUpdate)=>{saved=retainedLocalFinal(update);};first.emit('Retained canonical final');await drain();
  const next=fixture(first.binding,first.read(),first.records());next.io.loadLocalFinal=async(request:ResponseRequest)=>restoredLocalFinal(saved,request);next.manager.resume();await drain();assert.match(next.read(),/Retained canonical final/);assert.equal(next.writes(),1);
  assert.equal(restoredLocalFinal(saved,{...first.binding,messageId:randomUUID()}),undefined);
  assert.equal(restoredLocalFinal({...saved,bodyHash:'0'.repeat(64)},first.binding),undefined);first.manager.dispose();next.manager.dispose();
});
test('final saves preserve current ordinary edits and incoming final text stops local writes',async()=>{
  const h=fixture();await h.manager.register(h.binding);h.write(h.read().replace('Before','Edited before'));h.emit();await drain();assert.match(h.read(),/^Edited before/);assert.equal(h.writes(),1);
  const other=fixture();await other.manager.register(other.binding);other.write('Already saved on another device');other.emit();await drain();assert.equal(other.read(),'Already saved on another device');assert.equal(other.writes(),0);
  h.manager.dispose();other.manager.dispose();
});
test('an intervening save fails the local compare-and-set and retries against the latest note',async()=>{
  const h=fixture();await h.manager.register(h.binding);const compare=h.notes.compareAndSet;let raced=false;
  h.notes.compareAndSet=async(path,before,after)=>{if(!raced){raced=true;h.write(h.read().replace('After','Later edit'));}return compare(path,before,after);};
  h.emit();await drain();assert.equal(h.writes(),0);h.advance();h.manager.tick();await drain();assert.equal(h.writes(),1);assert.match(h.read(),/Later edit$/);h.manager.dispose();
});
test('a copied, malformed, foreign-vault, or fenced binding cannot start a response',()=>{
  const binding=request(),document=withLocalResponseBinding(responseAnchor(binding.id),binding);
  assert.equal(localResponseBindings('```\n'+document+'\n```').length,0);
  assert.equal(localResponseBindings(document+'\n'+responseAnchor(binding.id)).length,0);
  assert.equal(localResponseBindings(document.replace(binding.id,randomUUID())).length,0);
  const h=fixture({...binding,vaultId:'other'},document.replace(encodeURIComponent('"vaultId":"vault"'),encodeURIComponent('"vaultId":"other"')));h.manager.resume();assert.equal(h.registered.length,0);h.manager.dispose();
});
test('core Sync gate distinguishes synced, paused, disconnected, errors and absent transports',()=>{
  assert.equal(localSyncReady({}),true);
  for(const status of ['synced','syncing','paused','error','disconnected'])assert.equal(localSyncReady({internalPlugins:{getEnabledPluginById:()=>({vaultId:'remote',getStatus:()=>status})}}),status==='synced');
});
test('a synced local final answer is adopted without host evidence and keeps an unrelated editor edit',()=>{
  const binding=request(),document=`Before\n\n${responseAnchor(binding.id)}\n\nAfter`;
  let displayed=document;const view:any={getViewData:()=>displayed,setViewData:(text:string)=>displayed=text,getMode:()=> 'preview',requestSave:()=>{},save:async()=>{}};
  const adapter=new NativeResponseView(view,document,()=>{},async()=>document);adapter.registerLocalBindings([binding.id]);adapter.setResponses([{id:binding.id,body:'Live preview'}]);
  displayed=displayed.replace('Before','Local edit');const range=localResponseRange(document,binding.id,[binding])!;
  const incoming=document.slice(0,range.from)+'Final answer'+document.slice(range.to);view.setViewData(incoming,false);
  assert.equal(adapter.conflictRecord(),undefined);assert.equal(adapter.saved(),'Local edit\n\nFinal answer\n\nAfter');assert.match(displayed,/Final answer/);adapter.dispose();
});

test('notes and settings can arrive in either order without remote registration',async()=>{
  const binding=request(),records=updateResponseBindingData({},binding,'A'),document=`Before\n\n${responseAnchor(binding.id)}\n\nAfter`;
  const lateSettings=fixture(binding,document);lateSettings.manager.resume();assert.equal(lateSettings.registered.length,0);
  lateSettings.receiveRecords(records);lateSettings.manager.resume();assert.equal(lateSettings.registered.length,1);lateSettings.emit();await drain();assert.match(lateSettings.read(),/Final answer/);
  const lateNote=fixture(binding,'Before\n\nAfter',records);lateNote.manager.resume();assert.equal(lateNote.registered.length,0);
  lateNote.write(document);lateNote.manager.resume();assert.equal(lateNote.registered.length,1);lateNote.emit();await drain();assert.match(lateNote.read(),/Final answer/);
  lateSettings.manager.dispose();lateNote.manager.dispose();
});
test('legacy tags migrate only after settings are stored and retain all ordinary text',async()=>{
  const binding=request(),document=withLocalResponseBinding(`Before\n\n${responseAnchor(binding.id)}\n\nAfter`,binding),h=fixture(binding,document);
  const save=h.io.saveLocalBinding;let release!:()=>void;h.io.saveLocalBinding=async(request:ResponseRequest)=>{await new Promise<void>(resolve=>release=resolve);await save(request);};
  h.manager.resume();assert.equal(h.read(),document);assert.equal(h.registered.length,0);await drain();release();await drain();
  assert.doesNotMatch(h.read(),/t3-response-binding/);assert.equal(h.read(),`Before\n\n${responseAnchor(binding.id)}\n\nAfter`);assert.ok(h.records()[binding.id]);h.manager.dispose();
  const failed=fixture(binding,document);failed.io.saveLocalBinding=async()=>{throw Error('Storage failed');};failed.manager.resume();await drain();assert.equal(failed.read(),document);failed.manager.dispose();
});
test('following and steering update settings without modifying the note or publishing received prose',async()=>{
  const h=fixture();await h.manager.register(h.binding);const document=h.read(),messageId=randomUUID();
  await h.manager.follow(h.binding.id,messageId);await h.manager.steer(h.binding.id,{messageId:randomUUID(),text:'Follow this input'});
  assert.equal(h.read(),document);assert.equal(h.records()[h.binding.id].request.localMessageId,messageId);assert.equal(h.records()[h.binding.id].request.localSteering![0].text,'Follow this input');h.manager.dispose();
});
test('a metadata change during final-write preparation cancels the old answer',async()=>{
  const h=fixture();await h.manager.register(h.binding);const compare=h.notes.compareAndSet;
  h.notes.compareAndSet=async(path,before,after,guard)=>{
    h.receiveRecords(updateResponseBindingData(h.records(),{...h.binding,localMessageId:randomUUID()},'newer'));
    return guard?.()===false?false:compare(path,before,after);
  };
  h.emit();await drain();assert.equal(h.writes(),0);assert.match(h.read(),/data-t3-response=/);h.manager.dispose();
});

test('checked immutable proposals merge compatible ordinary edits on another device',async()=>{
  const binding=request(),document=`Before\n\n${responseAnchor(binding.id)}\n\nAfter`,proposed=document.replace('After','Agent edit after'),stored=new Map<string,string>();
  const localStage={editId:randomUUID(),originalHash:contentHash(document),stagedHash:contentHash(proposed),transport:{environmentId:'env',workspaceRoot:'/scratch',base:'.t3-obsidian/clients/vault/'+randomUUID()}};
  stored.set(editPath(localStage,'original'),document);stored.set(editPath(localStage,'proposed'),proposed);
  const files={read:async(path:string)=>stored.get(path),write:async()=>{},list:async()=>[]},submitted={...binding,localStage};
  const merged=await checkedStageDraft(document.replace('Before','Local edit before'),submitted,files);
  assert.match(merged,/Local edit before/);assert.match(merged,/Agent edit after/);assert.ok(localResponseRange(merged,binding.id,[submitted]));
  stored.set(editPath(localStage,'proposed'),'Changed payload');await assert.rejects(checkedStageDraft(document,submitted,files),/changed/);
});

test('completion and Stop save checked proposals with the reply before marking the edit saved',async()=>{
  for(const stop of [false,true]){
    const binding=request(),document=`Before\n\n${responseAnchor(binding.id)}\n\nAfter`,proposed=document.replace('After','Agent edit after'),localStage={editId:randomUUID(),originalHash:contentHash(document),stagedHash:contentHash(proposed),transport:{environmentId:'env',workspaceRoot:'/scratch',base:'.t3-obsidian/clients/vault/'+randomUUID()}};
    const h=fixture({...binding,localStage},document),saved:any[]=[],files={read:async(path:string)=>path===editPath(localStage,'original')?document:path===editPath(localStage,'proposed')?proposed:undefined,write:async()=>{},list:async()=>[]};
h.io.localFinalDraft=(text:string,request:ResponseRequest)=>checkedStageDraft(text,request,files);h.io.localEditSaved=async(_request:any,text:string)=>{assert.equal(text,h.read());saved.push(text);};
    await h.manager.register(h.binding);h.ready(false);h.emit('Final reply');await drain();assert.equal(saved.length,0);h.write(h.read().replace('Before','Typed before'));
    if(stop)await h.manager.stop(binding.id,'Frozen reply');else{h.ready(true);h.advance();h.manager.tick();await drain();}
    assert.equal(saved.length,1);assert.match(h.read(),/Typed before/);assert.match(h.read(),/Agent edit after/);assert.ok(h.read().includes(stop?'Frozen reply':'Final reply'));assert.ok(!h.read().includes(responseAnchor(binding.id)));h.manager.dispose();
  }
});

test('a merge conflict still sends Stop and never records the proposal as saved',async()=>{
  const h=fixture(),commands:any[]=[],saved:any[]=[];h.io.localFinalDraft=async()=>{throw Error('Checked proposal overlap');};h.io.localEditSaved=async()=>saved.push(true);
  h.io.access=async()=>({origin:'https://synthetic.invalid',api:async(_path:string,payload:unknown)=>{if(payload){commands.push(payload);return {};}return {thread:{id:h.binding.threadId,projectId:h.binding.projectId,messages:[],activities:[],latestTurn:{turnId:'exact-turn',state:'running',requestedAt:h.binding.createdAt},session:{status:'running',activeTurnId:'exact-turn'}}};}});
  await h.manager.register(h.binding);h.emit('Live reply',false);await drain();const before=h.read();await assert.rejects(h.manager.stop(h.binding.id,'Frozen reply'),/overlap/);assert.equal(commands.length,1);assert.equal(commands[0].type,'thread.turn.interrupt');assert.equal(h.read(),before);assert.equal(saved.length,0);assert.equal(h.manager.status(h.binding.id)?.finalSaved,false);h.manager.dispose();
});
test('reviewed frozen-save retry preserves user text and does not repeat the remote interrupt',async()=>{
 const h=fixture(),commands:any[]=[];let conflict=true;
 h.io.localFinalDraft=async(text:string)=>{if(conflict)throw Error('proposal overlap');return text;};
 h.io.access=async()=>({origin:'https://synthetic.invalid',api:async(_path:string,payload:unknown)=>{if(payload){commands.push(payload);return {};}return {thread:{id:h.binding.threadId,projectId:h.binding.projectId,messages:[],activities:[],latestTurn:{turnId:'exact-turn',state:'running',requestedAt:h.binding.createdAt},session:{status:'running',activeTurnId:'exact-turn'}}};}});
 await h.manager.register(h.binding);h.emit('Live reply',false);await drain();await assert.rejects(h.manager.stop(h.binding.id,'Frozen reply'),/overlap/);
 h.write(h.read().replace('Before','User retained'));const reviewed=contentHash(h.read());
 await assert.rejects(h.manager.retrySave(h.binding,'a'.repeat(64)),/reviewed note changed/);assert.equal(commands.length,1);
 conflict=false;const result=await h.manager.retrySave(h.binding,reviewed);assert.equal(result.saved,true);assert.match(h.read(),/User retained/);assert.match(h.read(),/Frozen reply/);assert.equal(commands.length,1);h.manager.dispose();
});
test('a frozen reply can retry after reload from its exact retained body without opening a remote stream',async()=>{
 const binding=request(),h=fixture(binding,undefined,updateResponseBindingData({},binding,'test'));let opens=0;h.io.access=async()=>{opens++;throw Error('No remote operation is permitted');};
 const result=await h.manager.retrySave(h.binding,contentHash(h.read()),'Retained frozen reply');assert.equal(result.saved,true);assert.equal(opens,0);assert.match(h.read(),/Retained frozen reply/);assert.ok(!h.read().includes(responseAnchor(h.binding.id)));h.manager.dispose();
});

test('a refused steering preparation removes only its pending input and keeps the original stream',async()=>{
 const h=fixture(),confirmed={messageId:randomUUID(),text:'Already accepted.',confirmed:true,before:[]};
 h.binding.localSteering=[confirmed];
 try{
  await h.manager.register(h.binding);const before=h.read(),pending={messageId:randomUUID(),text:'Pending addition.'};
  await h.manager.steer(h.binding.id,pending);
  await h.manager.steer(h.binding.id,pending);
  assert.equal(h.manager.request(h.binding.id)!.localSteering!.length,2);
  assert.throws(()=>h.manager.steer(h.binding.id,{...pending,text:'Different input.'}),/already belongs/);
  await h.manager.discardSteering(h.binding.id,pending.messageId);
  assert.deepEqual(h.manager.request(h.binding.id)!.localSteering!.map(input=>input.messageId),[confirmed.messageId]);
  assert.equal(h.read(),before);assert.equal(h.manager.responses().length,1);
  await h.manager.discardSteering(h.binding.id,confirmed.messageId);
  assert.equal(h.manager.request(h.binding.id)!.localSteering!.length,1);
  h.emit('Original response still completes.');await drain();assert.match(h.read(),/Original response still completes/);
 }finally{h.manager.dispose();}
});

test('a verified final with a pending question retains one attachment, recovery copy and background watch',async()=>{
  const h=fixture();let retained:DirectInlineUpdate|undefined;h.io.retainLocalFinal=async(update:DirectInlineUpdate)=>{retained=update;};await h.manager.register(h.binding);
  const pending:DirectInlineUpdate={request:h.binding,messageId:h.binding.messageId,sequence:5,body:'Final text and question',turnId:'source',phase:'complete',completionVerified:true,questionsPending:true,resume:{turnIds:['source'],prose:[],questionFollows:[{requestId:'q',turnId:'source',responseMode:'message',questions:[]}]}};
  h.callbacks.get(h.binding.id)!(pending);await drain();
  assert.equal(h.writes(),0);assert.equal(retained?.questionsPending,true);assert.equal(h.manager.responses()[0].input,true);assert.equal(h.manager.responses()[0].complete,false);assert.equal(h.manager.responses()[0].active,false);
  assert.deepEqual(await h.manager.waitForSave(h.binding.id,0),{saved:false,reason:'answer'});
  let ticks=0;const runtime=(h.manager as any).jobs.get(h.binding.id);runtime.preview.tick=()=>ticks++;h.open(false);h.manager.tick();assert.equal(ticks,1);
  h.open(true);h.callbacks.get(h.binding.id)!({...pending,sequence:6,body:'Original final\nAnswer\nFollow-up final',turnId:'follow-up',questionsPending:false});await drain();
  assert.equal(h.writes(),1);assert.equal(h.finished.length,1);assert.match(h.read(),/Original final\nAnswer\nFollow-up final/);h.manager.dispose();
});

test('pending final recovery after reload never detaches the original response before the question resolves',async()=>{
  const first=fixture();await first.manager.register(first.binding);let cached:any;first.io.retainLocalFinal=async(update:DirectInlineUpdate)=>{cached=retainedLocalFinal(update);};
  first.callbacks.get(first.binding.id)!({request:first.binding,messageId:first.binding.messageId,sequence:5,body:'Visible final with pending question',turnId:'source',phase:'complete',completionVerified:true,questionsPending:true,resume:{turnIds:['source'],prose:[],questionFollows:[{requestId:'q',turnId:'source',responseMode:'message'}]}});await drain();first.manager.dispose();
  const next=fixture(first.binding,first.read(),first.records());next.io.loadLocalFinal=async(binding:ResponseRequest)=>restoredLocalFinal(cached,binding);next.manager.resume();await drain();
  assert.equal(next.writes(),0);assert.equal(next.manager.status(first.binding.id)?.pendingSaveReason,'answer');assert.equal(next.manager.record(first.binding.id)?.state?.questionFollows?.[0].requestId,'q');next.manager.dispose();
});

test('a question arriving at the atomic final-write boundary invalidates that final save',async()=>{
  const h=fixture();await h.manager.register(h.binding);const compare=h.notes.compareAndSet;let injected=false;
  h.notes.compareAndSet=async(...args)=>{if(!injected){injected=true;h.callbacks.get(h.binding.id)!({request:h.binding,messageId:h.binding.messageId,sequence:6,body:'Final with question',turnId:'exact-turn',phase:'complete',completionVerified:true,questionsPending:true});}return compare(...args);};
  h.emit();await drain();assert.equal(h.writes(),0);assert.equal(h.manager.status(h.binding.id)?.pendingSaveReason,'answer');h.manager.dispose();
});

test('an older cached final containing unresolved question controls is retained instead of finalized',()=>{
 const binding=request(),target={environmentId:'env',threadId:binding.threadId,requestId:'old-question'};
 const body='Saved final\n> [Answer](t3-question:'+encodeURIComponent(JSON.stringify(target))+')';
 const restored=restoredLocalFinal(retainedLocalFinal({request:binding,messageId:binding.messageId,sequence:1,body,turnId:'old-turn',phase:'complete',completionVerified:true}),binding);
 assert.equal(restored?.questionsPending,true);
});

test('live completion cannot write before the local question checkpoint has loaded',async()=>{
 const h=fixture();let release!:(value:DirectInlineUpdate|undefined)=>void;h.io.loadLocalFinal=()=>new Promise(resolve=>{release=resolve;});
 await h.manager.register(h.binding);h.emit();await drain();assert.equal(h.writes(),0);
 release(undefined);await drain();assert.equal(h.writes(),1);h.manager.dispose();
});
