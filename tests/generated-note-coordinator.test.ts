import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GeneratedNoteCoordinator,type GenerationJournal,type NoteGeneration} from '../generated-note-coordinator';
import {responseAnchor} from '../native-response-projection';
import {initialRegion} from '../inline-thread';
import type {HostedInlineRequest} from '../hosted-inline';
import {contentHash} from '../completion';
import {assertCoordinatedDeliveryAvailable} from '../coordinated-delivery-gates';
const id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',other='bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee';
function request(response=id,path='Arms.md'):HostedInlineRequest{return {version:2,id:response,initialOwner:id,vaultId:'vault',host:{environmentId:'host',workspaceRoot:'/test/vault',directory:'.obsidian/t3-code/inline/v1'},notePath:path,threadId:'thread',messageId:id,projectId:'project',threadEnvironmentId:'host',initialHash:initialRegion(response).bodyHash,createdAt:'2026-10-02T20:00:00Z',independent:true};}
function fixture(){
  const records=new Map<string,NoteGeneration>(),events:any[]=[];
  const journal:GenerationJournal={read:async id=>{const record=records.get(id);return record&&structuredClone(record);},append:async(id,state,event)=>{records.set(id,structuredClone(state));events.push({id,event,state:structuredClone(state)});}};
  let document=`Workout\n\n| Exercise | 20kg |\n| --- | ---: |\n| Barb | 20 |\n\n${responseAnchor(id)}\n\nTail`,writes=0,casFailure=false,afterWrite:((text:string)=>string)|undefined;
  const notes={read:async()=>document,compareAndSet:async(_path:string,before:string,after:string)=>{if(casFailure||document!==before)return false;writes++;document=afterWrite?afterWrite(after):after;return true;}};
  return {journal,notes,events,records,coordinator:new GeneratedNoteCoordinator(journal,notes),original:document,get:()=>document,set:(value:string)=>{document=value;},writes:()=>writes,failCAS:()=>{casFailure=true;},afterWrite:(fn:(text:string)=>string)=>{afterWrite=fn;}};
}
const staged=(text:string)=>text.replace('| Exercise | 20kg |','| Exercise | 20kg | 25kg |').replace('| --- | ---: |','| --- | ---: | ---: |').replace('| Barb | 20 |','| Barb | 20 | |');
test('staged table patch and final response land in one checked save with durable intent and readback',async()=>{
  const f=fixture();await f.coordinator.accept(request(),f.original);
  await f.coordinator.result(id,staged(f.original),'> Added 25kg.');
  f.set(f.original.replace('Tail','User tail edit'));
  const record=await f.coordinator.commit(id);
  assert.equal(f.writes(),1);assert.equal(record.status,'verified');assert.equal(record.verified?.document,f.get());assert.equal(record.acknowledgements.length,0);
  assert.ok(f.get().includes('| Barb | 20 | |'));assert.ok(f.get().includes('> Added 25kg.'));assert.ok(f.get().includes('User tail edit'));assert.ok(!f.get().includes('t3-inline'));
  assert.deepEqual(f.events.map(event=>event.event),['accepted','result-ready','commit-pending','saved-and-verified']);
});
test('overlapping table edit keeps all three versions and performs no note write',async()=>{
  const f=fixture();await f.coordinator.accept(request(),f.original);await f.coordinator.result(id,staged(f.original),'> Added 25kg.');
  const latest=f.original.replace('| Barb | 20 |','| Barb | 21 |');f.set(latest);
  const record=await f.coordinator.commit(id);assert.equal(record.status,'conflict');assert.equal(f.writes(),0);assert.equal(f.get(),latest);assert.equal(record.conflicts[0].original,f.original);assert.equal(record.conflicts[0].proposed,staged(f.original));
});
test('crash after checked write resumes from immutable intent without duplicate response or write',async()=>{
  const f=fixture();await f.coordinator.accept(request(),f.original);await f.coordinator.result(id,staged(f.original),'> Added 25kg.');await f.coordinator.commit(id);
  const pending=f.events.find(event=>event.event==='commit-pending').state;f.records.set(id,pending);
  const restarted=new GeneratedNoteCoordinator(f.journal,f.notes);const record=await restarted.commit(id);
  assert.equal(record.status,'verified');assert.equal(f.writes(),1);assert.equal(f.get().split('> Added 25kg.').length,2);
});
test('lost compare-and-set and failed readback never certify delivery',async()=>{
  for(const fail of ['cas','readback']){
    const f=fixture();await f.coordinator.accept(request(),f.original);await f.coordinator.result(id,staged(f.original),'> Answer');
    if(fail==='cas')f.failCAS();else f.afterWrite(text=>text.replace('> Answer','Different content'));
    const record=await f.coordinator.commit(id);assert.equal(record.verified,undefined);assert.equal(record.status,fail==='cas'?'commit-pending':'conflict');
  }
});
test('independent responses in one note serialize and do not bind a job or thread to one destination',async()=>{
  const f=fixture();const original=f.original.replace('Tail',`${responseAnchor(other)}\n\nTail`);f.set(original);
  await f.coordinator.accept(request(),original);await f.coordinator.accept({...request(other),messageId:other,threadId:'another-thread'},original);
  await f.coordinator.result(id,original,'> One');await f.coordinator.result(other,original,'> Two');
  const results=await Promise.all([f.coordinator.commit(id),f.coordinator.commit(other)]);
  assert.ok(results.every(record=>record.status==='verified'));assert.equal(f.writes(),2);assert.ok(f.get().includes('> One'));assert.ok(f.get().includes('> Two'));
});
test('a stale whole note is detected and preserved without claiming deletion intent',async()=>{
  const f=fixture();await f.coordinator.accept(request(),f.original);await f.coordinator.result(id,staged(f.original),'> Added 25kg.');await f.coordinator.commit(id);f.set(f.original);
  const record=await f.coordinator.observe(id);assert.equal(record.status,'conflict');assert.equal(f.get(),f.original);assert.equal(f.writes(),1);assert.match(record.conflicts[0].reason,/ancestry/);
});
test('explicit restore preserves a compatible later edit, journals the repair, and checks the reviewed revision',async()=>{
  const f=fixture();await f.coordinator.accept(request(),f.original);await f.coordinator.result(id,staged(f.original),'> Answer');await f.coordinator.commit(id);
  const latest=f.original.replace('Tail','Later user edit');f.set(latest);await f.coordinator.observe(id);
  await assert.rejects(f.coordinator.restore(id,contentHash(f.original)),/reviewed/);
  const repaired=await f.coordinator.restore(id,contentHash(latest));assert.equal(repaired.status,'verified');assert.equal(f.writes(),2);assert.ok(f.get().includes('Later user edit'));assert.ok(f.get().includes('25kg'));assert.equal(f.events.at(-1).event,'repair-verified');
});
test('intentional removal persists across restart and does not resurrect the response',async()=>{
  const f=fixture();await f.coordinator.accept(request(),f.original);await f.coordinator.result(id,f.original,'> Answer');await f.coordinator.commit(id);await f.coordinator.remove(id);f.set('User deleted response');
  const restarted=new GeneratedNoteCoordinator(f.journal,f.notes);assert.equal((await restarted.observe(id)).status,'removed');assert.equal((await restarted.commit(id)).status,'removed');assert.equal(f.get(),'User deleted response');
});
test('acknowledgements require the exact verified commit and saved content',async()=>{
  const f=fixture();await f.coordinator.accept(request(),f.original);await f.coordinator.result(id,f.original,'> Answer');const record=await f.coordinator.commit(id);
  await assert.rejects(f.coordinator.acknowledge(id,'iphone',record.verified!.commitId,f.original),/different/);
  assert.equal(record.acknowledgements.length,0);
  const observed=await f.coordinator.acknowledge(id,'fixture-device',record.verified!.commitId,f.get());assert.equal(observed.acknowledgements.length,1);assert.equal(observed.acknowledgements[0].hash,contentHash(f.get()));
});
test('checkpoints retain exact metadata and sequence, and retries cannot change request or result identities',async()=>{
  const f=fixture();await f.coordinator.accept(request(),f.original);
  const state:any={status:'running',incoming:[{messageId:other,text:'Incoming',label:'You · Sender'}],bindingCheckpoint:{bindings:{[id]:{turnId:'turn',kind:'explicit'}}},hashes:['hash']};
  await f.coordinator.checkpoint(id,9,state);await f.coordinator.checkpoint(id,8,{...state,incoming:[]});
  assert.deepEqual((await f.journal.read(id))?.checkpoint,state);
  await assert.rejects(f.coordinator.accept({...request(),threadId:'wrong'},f.original),/identity/);
  await f.coordinator.result(id,f.original,'> Answer');await assert.rejects(f.coordinator.result(id,f.original,'> Changed'),/immutable/);
});
test('renames retain immutable request identity and exact response registration',async()=>{
  const f=fixture();await f.coordinator.accept(request(),f.original);const record=await f.coordinator.renamed(id,'Arms.md','Moved/Arms.md');assert.equal(record.notePath,'Moved/Arms.md');assert.deepEqual(record.request,request());
});
test('delivery cannot be enabled by a settings toggle, prompt instruction or fake device evidence',()=>{
  assert.throws(assertCoordinatedDeliveryAvailable,/write exclusion.*iPhone.*migration/);
});
