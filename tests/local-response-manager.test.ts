import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {contentHash} from '../completion';
import {updateResponseBindingData,responseBindingRequests,type ResponseBindingData} from '../response-binding-data';
import {LocalResponseManager} from '../local-response-manager';
import {localResponseBindings,localResponseRange,withLocalResponseBinding} from '../local-response-binding';
import {localSyncReady} from '../local-sync-state';
import {responseAnchor} from '../native-response-projection';
import {NativeResponseView} from '../native-response-view';
import {localStageCommand,localStagedDraft} from '../local-response-staging';
import {promises as fs} from 'node:fs';
import {dirname} from 'node:path';
import {retainedLocalFinal,restoredLocalFinal} from '../local-final-cache';
import type {ResponseRequest} from '../response-model';
import type {DirectInlineUpdate} from '../direct-inline-preview';

function request():ResponseRequest{return {version:4,localOnly:true,nativeProjection:true,responseContainer:true,independent:true,id:randomUUID(),initialOwner:randomUUID(),vaultId:'vault',host:{environmentId:'env',workspaceRoot:'/synthetic',directory:'.obsidian/t3-code/inline/v1'},notePath:'Test.md',threadId:randomUUID(),projectId:randomUUID(),messageId:randomUUID(),threadEnvironmentId:'env',initialHash:contentHash(''),createdAt:'2026-10-14T00:00:00Z'};}
function fixture(binding=request(),initial?:string,records:ResponseBindingData={}){
  let document=initial??`Before\n\n${responseAnchor(binding.id)}\n\nAfter`,open=true,ready=true,now=0,writes=0;
  const callbacks=new Map<string,(update:DirectInlineUpdate)=>void>(),registered:any[]=[],errors:any[]=[],finished:string[]=[];
  const io:any={localBindings:()=>responseBindingRequests(records),saveLocalBinding:async(request:ResponseRequest)=>{records=updateResponseBindingData(records,request,'test');},openedNotes:()=>open?[{path:binding.notePath,document}]:[],readNote:async()=>document,updateNote:async(_path:string,change:(text:string)=>string)=>document=change(document),saveLocalNote:async()=>{},syncReady:()=>ready,isOpen:()=>open,access:async()=>{throw Error('No host or T3 access needed by this replay.');},receiveCoordinated:(record:any)=>registered.push(record),receiveDirect:()=>{},localCompleted:(id:string)=>finished.push(id),completionFailed:(error:any)=>errors.push(error)};
  const notes={read:async()=>document,compareAndSet:async(_path:string,before:string,after:string,guard?:()=>boolean)=>{if(document!==before||guard?.()===false)return false;document=after;writes++;return true;}};
  const manager=new LocalResponseManager(randomUUID(),'vault',io,notes,()=>now,(record,_access,receive)=>{callbacks.set(record.request.id,receive);return {tick:()=>{},update:()=>{},delivery:()=>{},reconnect:()=>{},suspend:()=>{},dispose:()=>{}} as any;});
  return {binding,manager,io,notes,records:()=>records,receiveRecords:(value:ResponseBindingData)=>records=value,callbacks,registered,errors,finished,read:()=>document,write:(text:string)=>document=text,open:(value:boolean)=>open=value,ready:(value:boolean)=>ready=value,advance:()=>now+=1100,writes:()=>writes,emit:(body='Final answer',verified=true,messageId=binding.messageId)=>callbacks.get(binding.id)!({request:binding,messageId,sequence:5,body,turnId:'exact-turn',phase:'complete',completionVerified:verified})};
}
const drain=async()=>{for(let n=0;n<8;n++)await new Promise(resolve=>setImmediate(resolve));};

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

test('agent staging retains checked immutable input and merges ordinary edits on another device',async()=>{
  const binding=request(),document=withLocalResponseBinding(`Before\n\n${responseAnchor(binding.id)}\n\nAfter`,binding),stored=new Map<string,string>();
  const files={read:async(path:string)=>stored.get(path),write:async(path:string,value:string)=>{stored.set(path,value);}};
  const stage=await localStageCommand('stage-note-edit',binding,document,files);assert.ok('stagingPath' in stage);
  try{
    await fs.writeFile(stage.stagingPath!,document.replace('After','Agent edit after'));
    const submitted=await localStageCommand('submit-note-edit',binding,document,files,stage.originalHash);assert.ok(submitted.request);
    const current=withLocalResponseBinding(document,binding).replace('Before','Local edit before').replace(encodeURIComponent(JSON.stringify(binding)).replace(/-/g,'%2D'),encodeURIComponent(JSON.stringify(submitted.request)).replace(/-/g,'%2D'));
    const merged=await localStagedDraft(current,submitted.request!,files);
    assert.match(merged,/Local edit before/);assert.match(merged,/Agent edit after/);assert.ok(localResponseRange(merged,binding.id,[submitted.request!]));assert.doesNotMatch(merged,/t3-response-binding/);
    await assert.rejects(localStageCommand('submit-note-edit',binding,document,files,'0'.repeat(64)),/original hash/);
  }finally{await fs.rm(dirname(stage.stagingPath!),{recursive:true,force:true});}
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
