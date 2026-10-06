import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GeneratedNoteCoordinator,type GenerationJournal,type NoteGeneration} from '../generated-note-coordinator';
import {responseAnchor} from '../native-response-projection';
import {initialRegion} from '../inline-thread';
import type {HostedInlineRequest} from '../hosted-inline';
import {contentHash} from '../completion';
import {coordinatedDeliveryLimitations} from '../coordinated-delivery-gates';
import {generatedEventContent} from '../generated-event-content';
import {eventContent} from '../event-subscriptions';
import {historyFixture} from './fixtures/stream-history';
import {streamBlock} from '../stream-block';
import {nativeCommitMatches,readNativeCommitProof} from '../native-response-commit';
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
test('native materialization intents exclude generated text but preserve staged and surrounding user changes',async()=>{
  const f=fixture();await f.coordinator.accept(request(),f.original);await f.coordinator.result(id,f.original,'> Answer');const completed=await f.coordinator.commit(id);
  const baseline=eventContent(f.original);
  assert.equal(eventContent(generatedEventContent(f.get(),[completed])),baseline);
  const pending=f.events.find(event=>event.event==='commit-pending').state;
  assert.equal(eventContent(generatedEventContent(f.get(),[pending])),baseline,'File events can precede verified checkpoint propagation');
  const edited=f.get().replace('Workout','User workout').replace('Tail','User tail');
  assert.equal(eventContent(generatedEventContent(edited,[completed])),baseline.replace('Workout','User workout').replace('Tail','User tail'));
  assert.match(generatedEventContent(f.get().replace('> Answer','> My edit'),[completed]),/My edit/,'Edited generated content must count as user content');
  const g=fixture();await g.coordinator.accept(request(),g.original);await g.coordinator.result(id,staged(g.original),'> Answer');const result=await g.coordinator.commit(id);
  assert.equal(eventContent(generatedEventContent(g.get(),[result])),eventContent(staged(g.original)),'Authorized staged edits remain observable');
});
test('independent generated ranges and code examples remain distinct after restart',async()=>{
  const f=fixture(),original=f.original.replace('Tail',`${responseAnchor(other)}\n\nTail`);f.set(original);
  await f.coordinator.accept(request(),original);await f.coordinator.accept(request(other),original);
  await f.coordinator.result(id,original,'> Same answer');await f.coordinator.commit(id);
  await f.coordinator.result(other,original,'> Same answer');await f.coordinator.commit(other);
  const records=JSON.parse(JSON.stringify([...f.records.values()]));
  assert.equal(eventContent(generatedEventContent(f.get(),records)),eventContent(original));
  const example='```html\n<!-- t3-inline:start:example -->\nreal user example\n<!-- t3-inline:end:example -->\n```';
  assert.equal(eventContent(example),example);
});
test('legacy cleanup uses an exact saved position proof and refuses changed prefixes or bodies',()=>{
  const body='> Legacy answer',prefix='Before\n\n',document=prefix+body+'\n\nAfter';
  const state:any={finalSaved:true,finalBody:body,responseAnchor:{length:prefix.length,hash:contentHash(prefix)}};
  assert.equal(eventContent(generatedEventContent(document,[],[state])),eventContent('Before\n\nAfter'));
  assert.equal(generatedEventContent(document.replace('Before','Edited'),[],[state]),document.replace('Before','Edited'));
  assert.equal(generatedEventContent(document.replace('answer','user edit'),[],[state]),document.replace('answer','user edit'));
});
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
test('delivery limitations describe the actual out-of-band boundary and waived platform coverage',()=>{
  assert.ok(coordinatedDeliveryLimitations.some(value=>value.includes('out-of-band')));assert.ok(coordinatedDeliveryLimitations.some(value=>value.includes('iPhone')));
});

test('history close preserves the immutable final result, unrelated edits and observable subscription baseline',async()=>{
  const f=fixture(),{body,key}=historyFixture();await f.coordinator.accept(request(),f.original);await f.coordinator.result(id,f.original,body);await f.coordinator.commit(id);
  const original=(await f.journal.read(id))!,oldProof=f.coordinator.materialization(original),oldBaseline=eventContent(generatedEventContent(f.get(),[original]));
  f.set(f.get().replace('Workout','Edited workout').replace('Tail','Edited tail'));
  const result=await f.coordinator.closeHistory(id,key,contentHash(streamBlock(body,key)!.text));
  assert.equal(result.finalBody,body);assert.deepEqual(result.verified,original.verified);assert.deepEqual(result.attempt,original.attempt);
  assert.equal(result.historyRemoval!.status,'verified');assert.ok(!f.get().includes('Checking.'));assert.ok(f.get().includes('Final answer stays.'));assert.ok(f.get().includes('Edited workout'));assert.ok(f.get().includes('Edited tail'));
  const proof=f.coordinator.materialization(result),bytes=JSON.stringify(proof);
  assert.notEqual(proof.commitId,oldProof.commitId);assert.ok(nativeCommitMatches(proof,f.get()));assert.equal(nativeCommitMatches(proof,f.get().replace('Final answer stays.','Changed final')),false);
  assert.deepEqual(readNativeCommitProof(bytes,id,{commitId:proof.commitId,hash:proof.hash,proofHash:contentHash(bytes),verifiedOnHost:true,observedBy:[]}),proof);
  assert.equal(eventContent(generatedEventContent(f.get(),[result])),oldBaseline.replace('Workout','Edited workout').replace('Tail','Edited tail'));
  assert.equal((await f.coordinator.observe(id)).status,'verified');
  const writes=f.writes();await f.coordinator.closeHistory(id,key,contentHash(streamBlock(body,key)!.text));assert.equal(f.writes(),writes);
  await f.coordinator.acknowledge(id,'late-device',proof.commitId,proof.document);assert.equal((await f.journal.read(id))!.acknowledgements.at(-1)!.commitId,proof.commitId);
});
test('history close refuses a changed final answer, active block or stale checksum without writing',async()=>{
  for(const reason of ['final','checksum','active']){
    const f=fixture(),{body,key}=historyFixture(reason==='active');await f.coordinator.accept(request(),f.original);await f.coordinator.result(id,f.original,body);await f.coordinator.commit(id);
    if(reason==='final')f.set(f.get().replace('Final answer stays.','User final edit'));
    const before=f.get(),writes=f.writes(),hash=reason==='checksum'?'0'.repeat(64):contentHash(streamBlock(body,key)!.text);
    await assert.rejects(f.coordinator.closeHistory(id,key,hash));assert.equal(f.get(),before);assert.equal(f.writes(),writes);
  }
});
test('a crash after history save recovers its durable intent and shortened delivery proof',async()=>{
  const f=fixture(),{body,key}=historyFixture();await f.coordinator.accept(request(),f.original);await f.coordinator.result(id,f.original,body);await f.coordinator.commit(id);
  await f.coordinator.closeHistory(id,key,contentHash(streamBlock(body,key)!.text));
  f.records.set(id,structuredClone(f.events.find(event=>event.event==='history-removal-pending').state));
  const restart=new GeneratedNoteCoordinator(f.journal,f.notes),writes=f.writes();
  const recovered=await restart.observe(id);assert.equal(recovered.status,'verified');assert.equal(recovered.historyRemoval!.status,'verified');assert.equal(f.writes(),writes);assert.ok(nativeCommitMatches(restart.materialization(recovered),f.get()));
});
test('closing one response preserves an independent active response in the same note',async()=>{
  const f=fixture(),{body,key}=historyFixture(),original=f.original.replace('Tail',`${responseAnchor(other)}\n\nTail`);f.set(original);
  await f.coordinator.accept(request(),original);
  await f.coordinator.accept({...request(other),messageId:other,threadId:'another-thread'},original);
  await f.coordinator.result(id,original,body);await f.coordinator.commit(id);
  await f.coordinator.closeHistory(id,key,contentHash(streamBlock(body,key)!.text));
  assert.ok(f.get().includes(responseAnchor(other)));assert.ok(f.get().includes('Final answer stays.'));assert.ok(!f.get().includes('Checking.'));
  await f.coordinator.result(other,original,'> Independent final answer.');
  assert.equal((await f.coordinator.commit(other)).status,'verified');
  assert.ok(f.get().includes('Independent final answer.'));assert.ok(!f.get().includes('Checking.'));
  assert.equal((await f.coordinator.observe(id)).status,'verified');
});
test('failed history compare-and-set cancels its intent and permits a later checked retry',async()=>{
  const f=fixture(),{body,key}=historyFixture();await f.coordinator.accept(request(),f.original);await f.coordinator.result(id,f.original,body);await f.coordinator.commit(id);
  let fail=true;const coordinator=new GeneratedNoteCoordinator(f.journal,{read:f.notes.read,compareAndSet:async(...args)=>fail?false:f.notes.compareAndSet(...args)});
  const hash=contentHash(streamBlock(body,key)!.text),before=f.get();await assert.rejects(coordinator.closeHistory(id,key,hash),/changed/);
  assert.equal(f.get(),before);assert.equal((await f.journal.read(id))!.historyRemoval,undefined);
  fail=false;assert.equal((await coordinator.closeHistory(id,key,hash)).historyRemoval!.status,'verified');
});
