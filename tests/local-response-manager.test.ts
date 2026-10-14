import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {contentHash} from '../completion';
import {LocalResponseManager} from '../local-response-manager';
import {localResponseBindings,localResponseRange,withLocalResponseBinding} from '../local-response-binding';
import {localSyncReady} from '../local-sync-state';
import {responseAnchor} from '../native-response-projection';
import {NativeResponseView} from '../native-response-view';
import {localStageCommand,localStagedDraft} from '../local-response-staging';
import {promises as fs} from 'node:fs';
import {dirname} from 'node:path';
import {retainedLocalFinal,restoredLocalFinal} from '../local-final-cache';
import type {HostedInlineRequest} from '../hosted-inline';
import type {DirectInlineUpdate} from '../direct-inline-preview';

function request():HostedInlineRequest{return {version:4,localOnly:true,nativeProjection:true,responseContainer:true,independent:true,id:randomUUID(),initialOwner:randomUUID(),vaultId:'vault',host:{environmentId:'env',workspaceRoot:'/synthetic',directory:'.obsidian/t3-code/inline/v1'},notePath:'Test.md',threadId:randomUUID(),projectId:randomUUID(),messageId:randomUUID(),threadEnvironmentId:'env',initialHash:contentHash(''),createdAt:'2026-10-14T00:00:00Z'};}
function fixture(binding=request(),initial?:string){
  let document=initial??`Before\n\n${responseAnchor(binding.id)}\n\nAfter`,open=true,ready=true,now=0,writes=0;
  const callbacks=new Map<string,(update:DirectInlineUpdate)=>void>(),registered:any[]=[],errors:any[]=[],finished:string[]=[];
  const io:any={openedNotes:()=>open?[{path:binding.notePath,document}]:[],readNote:async()=>document,updateNote:async(_path:string,change:(text:string)=>string)=>document=change(document),saveLocalNote:async()=>{},syncReady:()=>ready,isOpen:()=>open,access:async()=>{throw Error('No host or T3 access needed by this replay.');},receiveCoordinated:(record:any)=>registered.push(record),receiveDirect:()=>{},localCompleted:(id:string)=>finished.push(id),completionFailed:(error:any)=>errors.push(error)};
  const notes={read:async()=>document,compareAndSet:async(_path:string,before:string,after:string)=>{if(document!==before)return false;document=after;writes++;return true;}};
  const manager=new LocalResponseManager(randomUUID(),'vault',io,notes,()=>now,(record,_access,receive)=>{callbacks.set(record.request.id,receive);return {tick:()=>{},update:()=>{},delivery:()=>{},suspend:()=>{},dispose:()=>{}} as any;});
  return {binding,manager,io,notes,callbacks,registered,errors,finished,read:()=>document,write:(text:string)=>document=text,open:(value:boolean)=>open=value,ready:(value:boolean)=>ready=value,advance:()=>now+=1100,writes:()=>writes,emit:(body='Final answer',verified=true,messageId=binding.messageId)=>callbacks.get(binding.id)!({request:binding,messageId,sequence:5,body,turnId:'exact-turn',phase:'complete',completionVerified:verified})};
}
const drain=async()=>{for(let n=0;n<8;n++)await new Promise(resolve=>setImmediate(resolve));};

test('fresh devices reconnect from a synced binding and save final text without a host grant',async()=>{
  const first=fixture();await first.manager.register(first.binding);
  const saved=first.read();assert.equal(localResponseBindings(saved).length,1);assert.equal(saved.includes('Final answer'),false);
  const second=fixture(first.binding,saved);second.manager.resume();assert.equal(second.registered.length,1);
  second.emit();await drain();assert.equal(second.read(),'Before\n\nFinal answer\n\nAfter');assert.equal(second.writes(),1);
  second.emit();second.manager.tick();await drain();assert.equal(second.writes(),1);assert.deepEqual(second.errors,[]);
  first.manager.dispose();second.manager.dispose();
});
test('two independent devices produce exactly identical final notes',async()=>{
  const a=fixture();await a.manager.register(a.binding);const b=fixture(a.binding,a.read());b.manager.resume();
  a.emit();b.emit();await drain();assert.equal(a.read(),b.read());assert.equal(a.writes(),1);assert.equal(b.writes(),1);
  assert.equal(localResponseBindings(a.read()).length,0);a.manager.dispose();b.manager.dispose();
});
test('completion waits for core Sync and resumes while the note remains loaded',async()=>{
  const h=fixture();await h.manager.register(h.binding);h.ready(false);h.emit();await drain();assert.equal(h.writes(),0);
  h.ready(true);h.manager.tick();await drain();assert.equal(h.writes(),1);h.manager.dispose();
});
test('unverified output and another message cannot replace this response',async()=>{
  const h=fixture();await h.manager.register(h.binding);h.emit('Preview',false);await drain();assert.equal(h.writes(),0);
  h.emit('Other turn',true,randomUUID());await drain();assert.equal(h.writes(),0);h.manager.dispose();
});
test('closed notes defer completion until they load again',async()=>{
  const h=fixture();await h.manager.register(h.binding);h.open(false);h.emit();await drain();assert.equal(h.writes(),0);
  h.open(true);h.manager.tick();await drain();assert.equal(h.writes(),1);h.manager.dispose();
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
  const next=fixture(first.binding,first.read());next.io.loadLocalFinal=async(request:HostedInlineRequest)=>restoredLocalFinal(saved,request);next.manager.resume();await drain();assert.match(next.read(),/Retained canonical final/);assert.equal(next.writes(),1);
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
  const binding=request(),document=withLocalResponseBinding(`Before\n\n${responseAnchor(binding.id)}\n\nAfter`,binding);
  let displayed=document;const view:any={getViewData:()=>displayed,setViewData:(text:string)=>displayed=text,getMode:()=> 'preview',requestSave:()=>{},save:async()=>{}};
  const adapter=new NativeResponseView(view,document,()=>{},async()=>document);adapter.setResponses([{id:binding.id,body:'Live preview'}]);
  displayed=displayed.replace('Before','Local edit');const range=localResponseRange(document,binding.id)!;
  const incoming=document.slice(0,range.from)+'Final answer'+document.slice(range.to);view.setViewData(incoming,false);
  assert.equal(adapter.conflictRecord(),undefined);assert.equal(adapter.saved(),'Local edit\n\nFinal answer\n\nAfter');assert.match(displayed,/Final answer/);adapter.dispose();
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
    assert.match(merged,/Local edit before/);assert.match(merged,/Agent edit after/);assert.ok(localResponseRange(merged,binding.id));
    await assert.rejects(localStageCommand('submit-note-edit',binding,document,files,'0'.repeat(64)),/original hash/);
  }finally{await fs.rm(dirname(stage.stagingPath!),{recursive:true,force:true});}
});
