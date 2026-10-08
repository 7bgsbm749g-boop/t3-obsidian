import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {DeviceResponseCompletion,deviceCompletionStore,type DeviceGeneration} from '../device-response-completion';
import {DeviceInlineManager} from '../leased-inline';
import 'fake-indexeddb/auto';
import {hostedRequestHash} from '../hosted-inline';
import {InlineLeaseAuthority,InlineLeaseClient,COORDINATED_OWNER,deviceStagedPath,leasePaths,type LeaseFiles,type LeaseRecord} from '../inline-lease';
import {responseAnchor} from '../native-response-projection';
import {contentHash} from '../completion';
import {nativeCommitPath} from '../native-response-commit';

async function fixture(actorOverride?:string){
  let time=100_000,writes=0,allowed=true;
  const id=randomUUID(),actor=actorOverride??randomUUID(),instance=randomUUID(),identity={vaultId:'vault',environmentId:'host',workspaceRoot:'/vault',directory:'private/inline'};
  const original=`Before\n\n${responseAnchor(id)}\n\nAfter\n`,request={version:4 as const,id,initialOwner:instance,nativeProjection:true,independent:true,vaultId:identity.vaultId,host:identity,notePath:'Note.md',threadId:'thread',projectId:'project',messageId:randomUUID(),threadEnvironmentId:'host',initialHash:'0'.repeat(64),createdAt:'2026-10-08T00:00:00Z',deviceCompletion:{version:1 as const,actor,originalHash:contentHash(original)}};
  let document=original,authority:InlineLeaseAuthority;
  const data=new Map<string,string>(),local=new Map<string,DeviceGeneration>();
  const files:LeaseFiles={read:async path=>data.get(path),write:async(path,value)=>{data.set(path,value);},remove:async path=>{data.delete(path);},list:async directory=>[...data.keys()].filter(path=>path.startsWith(directory+'/'))};
  authority=new InlineLeaseAuthority(identity,files,()=>time);
  const remote={...files,read:async(path:string)=>{if(path.includes('/replies/'))await authority.tick();return files.read(path);}};
  const client=(who=actor)=>new InlineLeaseClient(who,remote,identity.directory,()=>time,()=>time,async()=>{await authority.tick();});
  const registration=client(instance);assert.equal((await registration.command({kind:'register',jobId:id,request,original})).ok,true);
  await authority.migrated(id);
  const record=():LeaseRecord=>JSON.parse(data.get(leasePaths(identity.directory,id).record)!);
  const final={messageId:request.messageId,turnId:'turn',sequence:25,body:'> Finished response\n',phase:'complete' as const};
  const store={read:async(id:string)=>structuredClone(local.get(id)),write:async(id:string,value:DeviceGeneration)=>{local.set(id,structuredClone(value));}};
  const notes={read:async()=>document,compareAndSet:async(_path:string,before:string,after:string)=>{if(!allowed||document!==before)return false;document=after;writes++;return true;}};
  const adopted:Array<string>=[],conflicts:Array<DeviceGeneration>=[];
  const completion=()=>{
    const instance=new DeviceResponseCompletion(actor,store,notes,(_path,proof)=>adopted.push(proof.hash),record=>conflicts.push(record as DeviceGeneration)),complete=instance.complete.bind(instance);
    instance.complete=(lease,source)=>complete(lease,source,lease.state?.deviceStaged?data.get(deviceStagedPath(identity.directory,id,lease.state.deviceStaged.hash)):undefined,async proof=>{const reply=await client().command({kind:'prepare-final',jobId:id,token:lease.finalWriter!.token,proof});assert.equal(reply.ok,true,reply.error);});return instance;
  };
  return {request,id,actor,instance,authority,client,record,final,store,notes,data,local,adopted,conflicts,completion,original,advance:(ms:number)=>{time+=ms;},document:()=>document,edit:(text:string)=>{document=text;},writes:()=>writes,allow:(value:boolean)=>{allowed=value;}};
}

test('a reloaded sending manager finishes a closed note through canonical host evidence without Sync',async()=>{
  const h=await fixture(),turnId='turn';
  await h.authority.checkpoint(h.id,{requestHash:hostedRequestHash(h.request),accepted:true,notePath:h.request.notePath,status:'complete',hashes:[],updatedAt:'',turnId,turnIds:[turnId],directFinalBody:h.final.body,finalPhase:'complete',bindingCheckpoint:{sequence:25,bindings:{[h.request.messageId]:{turnId,kind:'explicit'}},turns:{[turnId]:{turnId,messageId:h.request.messageId,state:'completed'}}}});
  const files={read:async(path:string)=>{if(path.includes('/replies/'))await h.authority.tick();return h.data.get(path);},write:async(path:string,text:string)=>{h.data.set(path,text);}};
  const completion=new DeviceResponseCompletion(h.actor,h.store,h.notes,()=>{}),errors:unknown[]=[];
  const manager=new DeviceInlineManager(randomUUID(),h.request.vaultId,{completionActor:h.actor,isOpen:()=>false,readNote:async()=>h.document(),updateNote:async()=>{throw Error('Legacy writer must not run');},access:async()=>{throw Error('No T3 access needed for canonical host evidence');},completeResponse:(record,original,staged,prepare)=>completion.complete(record,original,staged,prepare),completionFailed:error=>errors.push(error)},async()=>({files,close:()=>{}}),()=>100_000,()=>100_000,async()=>{await h.authority.tick();});
  try{
    await manager.register(h.request);
    for(let n=0;n<100&&!h.record().state?.cleanupComplete;n++)await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(errors,[]);assert.equal(h.record().state?.cleanupComplete,true);assert.equal(h.record().finalWriter?.actor,h.actor);assert.equal(h.writes(),1);assert.match(h.document(),/Finished response/);
  }finally{manager.dispose();}
});

test('acknowledged device completion retires its full journal atomically and duplicate completion never writes',async()=>{
  const h=await fixture(),storage=deviceCompletionStore(h.actor,h.request.vaultId);await h.client().command({kind:'reserve-final',jobId:h.id,final:h.final});
  const completion=new DeviceResponseCompletion(h.actor,storage.store,h.notes,()=>{}),proof=await completion.complete(h.record(),h.original,undefined,async proof=>{assert.equal((await h.client().command({kind:"prepare-final",jobId:h.id,token:h.record().finalWriter!.token,proof})).ok,true);});assert.ok(proof);
  await completion.acknowledged(h.record());assert.ok(await storage.store.read(h.id),'verified local save alone is not a host receipt');
  assert.equal((await h.client().command({kind:'commit-final',jobId:h.id,token:h.record().finalWriter!.token,proof})).ok,true);
  await completion.acknowledged(h.record());assert.equal(await storage.store.read(h.id),undefined);const retired=await storage.store.retired!(h.id);assert.equal(retired?.receipt.hash,proof.hash);assert.equal('original' in retired!.receipt,false);assert.deepEqual(await storage.restore(),[]);
  h.edit('User replaced the note');assert.deepEqual(await completion.complete(h.record(),h.original),proof);assert.equal(h.document(),'User replaced the note');assert.equal(h.writes(),1);assert.equal((await storage.restoreReceipts()).length,1);
});

test('completed device proof retention has count and age bounds without removing replay identities',async()=>{
  const actor=randomUUID();let now=100_000;const storage=deviceCompletionStore(actor,'vault',()=>now),ids:string[]=[];
  for(let n=0;n<35;n++){
    const h=await fixture(actor);ids.push(h.id);await h.client().command({kind:'reserve-final',jobId:h.id,final:h.final});const completion=new DeviceResponseCompletion(actor,storage.store,h.notes,()=>{}),proof=await completion.complete(h.record(),h.original,undefined,async proof=>{assert.equal((await h.client().command({kind:"prepare-final",jobId:h.id,token:h.record().finalWriter!.token,proof})).ok,true);});assert.ok(proof);await h.client().command({kind:'commit-final',jobId:h.id,token:h.record().finalWriter!.token,proof});await completion.acknowledged(h.record());now++;
  }
  const restored=await storage.restoreReceipts();assert.equal(restored.length,35);assert.equal(restored.filter(record=>record.proof).length,32);assert.ok((await storage.store.retired!(ids[0]))?.receipt);assert.equal((await storage.store.retired!(ids[0]))?.proof,undefined);
  now+=31*24*60*60*1000;const expired=await storage.restoreReceipts();assert.equal(expired.length,35);assert.ok(expired.every(record=>!record.proof));assert.deepEqual(await storage.restore(),[]);
});

test('a pending or unresolved device completion is never eligible for retirement',async()=>{
  const h=await fixture(),storage=deviceCompletionStore(h.actor,h.request.vaultId);await h.client().command({kind:'reserve-final',jobId:h.id,final:h.final});h.allow(false);
  const completion=new DeviceResponseCompletion(h.actor,storage.store,h.notes,()=>{});assert.equal(await completion.complete(h.record(),h.original),undefined);await completion.acknowledged(h.record());assert.equal((await storage.store.read(h.id))!.status,'commit-pending');
  h.allow(true);h.edit(h.original.replace('Before','Competing content'));const before=await storage.store.read(h.id);assert.equal(await completion.complete(h.record(),h.original),undefined);await completion.acknowledged(h.record());const preserved=await storage.store.read(h.id);assert.equal(preserved!.status,'conflict');assert.ok(preserved!.conflicts.length);assert.equal(preserved!.original,before!.original);
});

test('the device journal index is atomic, revision-fenced and private to the durable actor',async()=>{
  const h=await fixture();await h.client().command({kind:'reserve-final',jobId:h.id,final:h.final});
  const storage=deviceCompletionStore(h.actor,h.request.vaultId),completion=new DeviceResponseCompletion(h.actor,storage.store,h.notes,()=>{});
  assert.ok(await completion.complete(h.record(),h.original));
  const restored=await storage.restore();assert.equal(restored.length,1);assert.equal(restored[0].status,'verified');
  await assert.rejects(storage.store.write(h.id,restored[0]),/Cannot save/);
  assert.deepEqual(await deviceCompletionStore(randomUUID(),h.request.vaultId).restore(),[]);
  assert.equal((await storage.restore())[0].verified?.hash,restored[0].verified?.hash);
});

test('local completion needs no synced host note and one permanent grant excludes every other writer',async()=>{
  const h=await fixture(),sender=h.client();
  const reply=await sender.command({kind:'reserve-final',jobId:h.id,final:h.final});assert.equal(reply.ok,true);
  h.edit(h.document().replace('Before','Ordinary user edit'));
  const proof=await h.completion().complete(reply.record!,h.original);assert.ok(proof);
  assert.match(h.document(),/Ordinary user edit/);assert.match(h.document(),/Finished response/);assert.doesNotMatch(h.document(),/t3-(?:inline|response):/);assert.equal(h.writes(),1);
  h.advance(120_000);
  await assert.rejects(h.authority.reserveHostFinal(h.id,h.final),/Another final writer/);
  assert.equal((await h.client(randomUUID()).command({kind:'reserve-final',jobId:h.id,final:h.final})).ok,false);
  assert.equal((await h.client().command({kind:'claim',jobId:h.id})).ok,false);
  const receipt=await sender.command({kind:'commit-final',jobId:h.id,token:reply.record!.finalWriter!.token,proof});assert.equal(receipt.ok,true);
  assert.equal(h.record().state!.delivery!.verifiedOnHost,false);assert.deepEqual(h.record().state!.delivery!.observedBy,[h.actor]);
  assert.ok(h.data.has(nativeCommitPath(h.request.host.directory,h.id,proof.commitId)));
});

test('closing before reservation permits host fallback; returning device cannot save through that grant',async()=>{
  const h=await fixture();assert.equal(await h.authority.reserveHostFinal(h.id,h.final),undefined);
  h.advance(15_001);const host=await h.authority.reserveHostFinal(h.id,h.final);assert.equal(host!.finalWriter!.actor,COORDINATED_OWNER);
  const returned=await h.client().command({kind:'reserve-final',jobId:h.id,final:h.final});assert.equal(returned.ok,false);
  await assert.rejects(h.completion().complete(host!,h.original),/does not own/);assert.equal(h.writes(),0);
});

test('presence is not a writing lease and does not revoke an already granted slow save',async()=>{
  const h=await fixture();h.advance(14_000);
  assert.equal((await h.client(h.instance).command({kind:'presence',jobId:h.id})).ok,false);
  assert.equal((await h.client().command({kind:'presence',jobId:h.id})).ok,true);
  h.advance(10_000);assert.equal(await h.authority.reserveHostFinal(h.id,h.final),undefined);
  await h.client().command({kind:'reserve-final',jobId:h.id,final:h.final});h.allow(false);
  assert.equal(await h.completion().complete(h.record(),h.original),undefined);h.advance(60_000);
  await assert.rejects(h.authority.reserveHostFinal(h.id,h.final),/Another final writer/);
  h.allow(true);assert.ok(await h.completion().complete(h.record(),h.original));assert.equal(h.writes(),1);
});

test('reload and duplicate finish receipts reuse the durable result without replacing edited or deleted output',async()=>{
  const h=await fixture();const sender=h.client(),reserved=await sender.command({kind:'reserve-final',jobId:h.id,final:h.final});
  const proof=await h.completion().complete(h.record(),h.original);assert.ok(proof);
  h.edit('User replaced the completed note.\n');
  assert.deepEqual(await h.completion().complete(h.record(),h.original),proof);assert.equal(h.document(),'User replaced the completed note.\n');assert.equal(h.writes(),1);
  const input={kind:'commit-final' as const,jobId:h.id,token:reserved.record!.finalWriter!.token,proof};
  assert.equal((await sender.command(input)).ok,true);const revision=h.record().revision;
  assert.equal((await sender.command(input)).ok,true);assert.equal(h.record().revision,revision);
  assert.equal((await sender.command({...input,proof:{...proof,hash:'0'.repeat(64)}})).ok,false);
});

test('a crash after the note write recovers by exact readback before publishing a receipt',async()=>{
  const h=await fixture();await h.client().command({kind:'reserve-final',jobId:h.id,final:h.final});
  let fail=true;const store={...h.store,write:async(id:string,record:DeviceGeneration)=>{if(record.status==='verified'&&fail){fail=false;throw Error('Crash at verification');}await h.store.write(id,record);}};
  const completion=new DeviceResponseCompletion(h.actor,store,h.notes,()=>{});
  await assert.rejects(completion.complete(h.record(),h.original),/Crash at verification/);assert.equal(h.writes(),1);assert.equal(h.local.get(h.id)!.status,'commit-pending');
  const recovered=await h.completion().complete(h.record(),h.original);assert.ok(recovered);assert.equal(h.writes(),1);
});

test('staged changes and the reply share one local commit and late staging is refused',async()=>{
  const h=await fixture(),draft=h.original.replace('Before','Generated heading');
  await h.authority.stageDevice(h.id,draft,contentHash(h.original),async()=>{});
  await h.client().command({kind:'reserve-final',jobId:h.id,final:h.final});
  await assert.rejects(h.authority.stageDevice(h.id,h.original,contentHash(h.original),async()=>{}),/no longer accepts/);
  h.edit(h.document().replace('After','User tail edit'));
  assert.ok(await h.completion().complete(h.record(),h.original));assert.match(h.document(),/Generated heading/);assert.match(h.document(),/User tail edit/);assert.match(h.document(),/Finished response/);assert.equal(h.writes(),1);
});

test('overlapping staged and user changes retain both versions and do not save the proposed result',async()=>{
  const h=await fixture();await h.authority.stageDevice(h.id,h.original.replace('Before','Generated heading'),contentHash(h.original),async()=>{});
  await h.client().command({kind:'reserve-final',jobId:h.id,final:h.final});h.edit(h.original.replace('Before','User heading'));
  assert.equal(await h.completion().complete(h.record(),h.original),undefined);assert.equal(h.writes(),0);assert.match(h.document(),/User heading/);assert.equal(h.conflicts.length,1);assert.match(h.conflicts[0].staged!,/Generated heading/);
});

test('completion storage failure happens before note mutation and malformed or stopped reservations are rejected',async()=>{
  const h=await fixture(),sender=h.client();
  assert.equal((await sender.command({kind:'reserve-final',jobId:h.id,final:{...h.final,messageId:randomUUID()}})).ok,false);
  assert.equal((await sender.command({kind:'reserve-final',jobId:h.id,final:{...h.final,body:responseAnchor(randomUUID())}})).ok,false);
  await sender.command({kind:'reserve-final',jobId:h.id,final:h.final});
  const completion=new DeviceResponseCompletion(h.actor,{...h.store,write:async()=>{throw Error('Device disk full');}},h.notes,()=>{});
  await assert.rejects(completion.complete(h.record(),h.original),/Device disk full/);assert.equal(h.writes(),0);
  const stopped=await fixture();await stopped.client(stopped.instance).command({kind:'stop',jobId:stopped.id});
  assert.equal((await stopped.client().command({kind:'reserve-final',jobId:stopped.id,final:stopped.final})).ok,false);
});
