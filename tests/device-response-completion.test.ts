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
import type {FinalAttemptAbort,FinalWriteOutcome} from '../completion-attempt';
import {deviceState} from '../device-state';
import {ResponseNoteLocator} from '../response-location';

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

async function renamedCompletionFixture(documents?:(original:string,path:string)=>Map<string,string>,loseRenameReply=false){
  const h=await fixture(),path='Jobs/Settled/Note.md';
  await h.client().command({kind:'reserve-final',jobId:h.id,final:h.final});
  const grant=structuredClone(h.record().finalWriter!),docs=documents?.(h.original,path)??new Map([[path,h.original+'Ordinary text after a rename.\n'],['Unrelated.md','Keep this note exactly.\n']]);
  const locator=new ResponseNoteLocator(()=>[...docs.keys()],async path=>docs.get(path));
  const writes:string[]=[],errors:unknown[]=[],relocations:string[]=[],completions:LeaseRecord[]=[];
  const notes={read:async(path:string)=>docs.get(path),compareAndSet:async(path:string,before:string,after:string)=>{
    if(docs.get(path)!==before)return false;
    assert.equal(h.record().state?.notePath,path,'the host rename must be acknowledged before the final write');
    assert.ok(h.record().preparedFinal,'the immutable intent must be retained before the final write');
    assert.deepEqual(h.record().finalWriter,grant);docs.set(path,after);writes.push(path);return true;
  }};
  let lost=loseRenameReply;
  const files={read:async(file:string)=>{
    if(file.includes('/replies/'))await h.authority.tick();
    if(lost&&relocations.some(id=>file===leasePaths(h.request.host.directory,id).reply)){lost=false;throw Error('Lost rename acknowledgement');}
    return h.data.get(file);
  },write:async(file:string,text:string)=>{if(file.includes('/mailbox/')){const command=JSON.parse(text);if(command.kind==='relocate')relocations.push(command.id);}h.data.set(file,text);}};
  const manager=()=>{
    const completion=new DeviceResponseCompletion(h.actor,h.store,notes,()=>{});
    return new DeviceInlineManager(randomUUID(),h.request.vaultId,{completionActor:h.actor,isOpen:()=>false,readNote:notes.read,locateNote:(id,path)=>locator.locate(id,path),updateNote:async()=>{throw Error('Legacy writer must not run');},access:async()=>{throw Error('No T3 access needed');},completeResponse:(record,original,staged,prepare,abort)=>{completions.push(structuredClone(record));return completion.complete(record,original,staged,prepare,abort);},completionFailed:error=>errors.push(error)},async()=>({files,close:()=>{}}),()=>100_000,()=>100_000,async()=>{await h.authority.tick();});
  };
  return {h,path,grant,docs,writes,errors,relocations,completions,manager};
}
async function waitForCompletion(condition:()=>boolean){for(let n=0;n<200&&!condition();n++)await new Promise(resolve=>setImmediate(resolve));assert.ok(condition(),'the bounded completion did not settle');}

test('palette Stop excludes a completed permanent grant while its checkpoint and final save are pending',async()=>{
  const h=await fixture();await h.client().command({kind:'reserve-final',jobId:h.id,final:h.final});
  const files={read:async(path:string)=>{if(path.includes('/replies/'))await h.authority.tick();return h.data.get(path);},write:async(path:string,text:string)=>{h.data.set(path,text);}};
  const manager=new DeviceInlineManager(randomUUID(),h.request.vaultId,{completionActor:h.actor,isOpen:()=>false,readNote:async()=>h.original,updateNote:async()=>{throw Error('No legacy write');},access:async()=>{throw Error('No provider access');},completeResponse:async()=>undefined},async()=>({files,close:()=>{}}),()=>100_000,()=>100_000,async()=>{await h.authority.tick();});
  try{
    await manager.register(h.request);
    assert.equal(manager.responseStatus(h.id)?.runTerminal,true);
    assert.equal(manager.responseStatus(h.id)?.finalWriterPending,true);
    assert.deepEqual(manager.stoppableResponses(h.request.notePath),[]);
  }finally{manager.dispose();}
});

test('a permanent final grant locates a renamed note after reload with no local journal',async()=>{
  const r=await renamedCompletionFixture(),manager=r.manager();assert.equal(r.h.local.size,0);
  try{
    await manager.register(r.h.request);await waitForCompletion(()=>r.h.record().state?.cleanupComplete===true);
    assert.deepEqual(r.errors,[]);assert.deepEqual(r.writes,[r.path]);assert.equal(r.relocations.length,1);
    assert.equal(r.h.record().state?.notePath,r.path);assert.equal(r.h.local.get(r.h.id)?.notePath,r.path);
    assert.equal(r.h.record().request.notePath,'Note.md');assert.deepEqual(r.h.record().finalWriter,r.grant);
    assert.ok(r.docs.get(r.path)?.endsWith('Ordinary text after a rename.\n'));assert.ok(r.docs.get(r.path)?.includes(r.h.final.body));
    assert.equal(r.docs.get('Unrelated.md'),'Keep this note exactly.\n');assert.equal(r.docs.has('Note.md'),false);
    const verified=structuredClone(r.h.local.get(r.h.id)!);r.docs.delete(r.path);
    const reloaded=new DeviceResponseCompletion(r.h.actor,r.h.store,{read:async(path:string)=>r.docs.get(path),compareAndSet:async()=>{throw Error('Verified replay must never write');}},()=>{});
    assert.equal((await reloaded.complete(r.h.record()))?.hash,verified.verified?.hash);
  }finally{manager.dispose();}
});

test('missing and duplicate renamed anchors cannot start a final write',async()=>{
  for(const duplicate of [false,true]){
    const r=await renamedCompletionFixture((original,path)=>duplicate?new Map([[path,original],['Copied.md',original]]):new Map()),manager=r.manager();
    try{
      await manager.register(r.h.request);
      if(duplicate)await waitForCompletion(()=>r.errors.length>0);else for(let n=0;n<20;n++)await new Promise(resolve=>setImmediate(resolve));
      assert.equal(r.completions.length,0);assert.equal(r.writes.length,0);assert.equal(r.h.local.size,0);
      assert.equal(r.h.record().preparedFinal,undefined);assert.deepEqual(r.h.record().finalWriter,r.grant);
      if(duplicate)assert.match(String(r.errors[0]),/multiple notes/);else assert.deepEqual(r.errors,[]);
    }finally{manager.dispose();}
  }
});

test('an existing note with a removed anchor remains protected by the completion conflict guard',async()=>{
  const r=await renamedCompletionFixture(()=>new Map([['Note.md','User removed the response anchor.\n']])),manager=r.manager();
  try{
    await manager.register(r.h.request);await waitForCompletion(()=>r.h.local.get(r.h.id)?.status==='conflict');
    assert.equal(r.docs.get('Note.md'),'User removed the response anchor.\n');assert.equal(r.writes.length,0);
    assert.equal(r.h.record().preparedFinal,undefined);assert.deepEqual(r.h.record().finalWriter,r.grant);
  }finally{manager.dispose();}
});

test('a lost rename acknowledgement does not write and a reload uses its retained host path',async()=>{
  const r=await renamedCompletionFixture(undefined,true),manager=r.manager();
  try{
    await manager.register(r.h.request);await waitForCompletion(()=>r.errors.length>0);
    assert.match(String(r.errors[0]),/Lost rename acknowledgement/);assert.equal(r.writes.length,0);assert.equal(r.completions.length,0);assert.equal(r.h.local.size,0);
    assert.equal(r.h.record().state?.notePath,r.path);assert.equal(r.h.record().preparedFinal,undefined);assert.deepEqual(r.h.record().finalWriter,r.grant);
  }finally{manager.dispose();}
  const reloaded=r.manager();try{
    await reloaded.register(r.h.request);await waitForCompletion(()=>r.h.record().state?.cleanupComplete===true);
    assert.deepEqual(r.writes,[r.path]);assert.equal(r.relocations.length,1);assert.deepEqual(r.h.record().finalWriter,r.grant);
  }finally{reloaded.dispose();}
});

test('prepared verified receipts replay after edited or deleted notes without an anchor lookup',async()=>{
  for(const deleted of [false,true]){
    const h=await fixture();await h.client().command({kind:'reserve-final',jobId:h.id,final:h.final});
    const proof=await h.completion().complete(h.record(),h.original);assert.ok(proof);assert.ok(h.record().preparedFinal);assert.equal(h.record().state?.finalSaved,undefined);
    const document=deleted?undefined:'User replaced the saved response.\n',completion=new DeviceResponseCompletion(h.actor,h.store,{read:async()=>document,compareAndSet:async()=>{throw Error('Prepared verified replay must not write');}},()=>{}),errors:unknown[]=[];
    const files={read:async(path:string)=>{if(path.includes('/replies/'))await h.authority.tick();return h.data.get(path);},write:async(path:string,text:string)=>{h.data.set(path,text);}};
    const manager=new DeviceInlineManager(randomUUID(),h.request.vaultId,{completionActor:h.actor,isOpen:()=>false,readNote:async()=>document,locateNote:async()=>{throw Error('A saved receipt must not require its old anchor');},updateNote:async()=>{throw Error('Legacy writer must not run');},access:async()=>{throw Error('No T3 access needed');},completeResponse:(record,original,staged,prepare,abort)=>completion.complete(record,original,staged,prepare,abort),completionFailed:error=>errors.push(error)},async()=>({files,close:()=>{}}),()=>100_000,()=>100_000,async()=>{await h.authority.tick();});
    try{
      await manager.register(h.request);await waitForCompletion(()=>h.record().state?.cleanupComplete===true);
      assert.deepEqual(errors,[]);assert.equal(h.record().state?.delivery?.hash,proof.hash);assert.equal(h.writes(),1);
    }finally{manager.dispose();}
  }
});

function startupDiscoveryFixture(h:Awaited<ReturnType<typeof fixture>>,document:string|undefined,actor=h.actor){
  const counts={recordReads:0,locations:0,noteReads:0,writeAttempts:0,completions:0,settled:0},commands:Array<{kind:string;actor:string}>=[],errors:unknown[]=[];
  const notes={read:async()=>document,compareAndSet:async()=>{counts.writeAttempts++;throw Error('Startup receipt recovery must not write a changed or missing note');}};
  const completion=new DeviceResponseCompletion(actor,h.store,notes,()=>{});
  const files={read:async(path:string)=>{
    // Completed bindings can leave the active catalog. Startup must recover
    // their exact durable records through the restored response IDs as well.
    if(path===leasePaths(h.request.host.directory,'').catalog)return '[]';
    if(path===leasePaths(h.request.host.directory,h.id).record)counts.recordReads++;
    if(path.includes('/replies/'))await h.authority.tick();
    return h.data.get(path);
  },write:async(path:string,text:string)=>{
    if(path.includes('/mailbox/')){const command=JSON.parse(text);commands.push({kind:command.kind,actor:command.actor});}
    h.data.set(path,text);
  }};
  const manager=new DeviceInlineManager(randomUUID(),h.request.vaultId,{
    completionActor:actor,isOpen:()=>false,
    readNote:async()=>{counts.noteReads++;return document;},
    locateNote:async()=>{counts.locations++;return undefined;},
    updateNote:async()=>{throw Error('Legacy writer must not run');},
    access:async()=>{throw Error('No T3 access needed for a retained completion');},
    completeResponse:async(record,original,staged,prepare,abort)=>{
      counts.completions++;try{return await completion.complete(record,original,staged,prepare,abort);}finally{counts.settled++;}
    },completionFailed:error=>errors.push(error),
  },async()=>({files,close:()=>{}}),()=>100_000,()=>100_000,async()=>{await h.authority.tick();});
  return {manager,counts,commands,errors,start:()=>manager.discover([h.request.host],[h.id])};
}

test('startup discovery replays verified prepared receipts after the note was deleted or its anchor was removed',async()=>{
  for(const document of [undefined,'User replaced the saved response and removed its anchor.\n']){
    const h=await fixture();await h.client().command({kind:'reserve-final',jobId:h.id,final:h.final});
    const proof=await h.completion().complete(h.record(),h.original);assert.ok(proof);
    const grant=structuredClone(h.record().finalWriter),prepared=structuredClone(h.record().preparedFinal);
    assert.equal(h.local.get(h.id)?.status,'verified');assert.equal(h.record().state?.finalSaved,undefined);
    const r=startupDiscoveryFixture(h,document);
    try{
      r.start();await waitForCompletion(()=>h.record().state?.cleanupComplete===true);
      assert.ok(r.counts.recordReads>0);assert.equal(r.counts.locations,0);assert.equal(r.counts.noteReads,0);
      assert.equal(r.counts.completions,1);assert.equal(r.counts.writeAttempts,0);assert.deepEqual(r.errors,[]);
      assert.deepEqual(r.commands.filter(command=>command.kind==='commit-final'),[{kind:'commit-final',actor:h.actor}]);
      assert.equal(h.record().state?.delivery?.hash,proof.hash);assert.equal(h.record().state?.delivery?.commitId,proof.commitId);
      assert.deepEqual(h.record().finalWriter,grant);assert.deepEqual(h.record().preparedFinal,prepared);assert.equal(h.writes(),1);
    }finally{r.manager.dispose();}
  }
});

test('startup discovery cannot acknowledge a prepared host intent without a locally verified save',async()=>{
  for(const document of [undefined,'User text with no response anchor.\n']){
    const h=await fixture();await h.client().command({kind:'reserve-final',jobId:h.id,final:h.final});
    assert.ok(await h.completion().complete(h.record(),h.original));
    const grant=structuredClone(h.record().finalWriter),prepared=structuredClone(h.record().preparedFinal);
    h.local.clear(); // A retained host intent does not prove the local note write.
    const r=startupDiscoveryFixture(h,document);
    try{
      r.start();await waitForCompletion(()=>r.counts.settled>0);
      assert.equal(r.counts.locations,0);assert.equal(r.counts.noteReads,0);assert.equal(r.counts.writeAttempts,0);
      assert.equal(r.commands.some(command=>command.kind==='commit-final'),false);assert.deepEqual(r.errors,[]);
      assert.equal(h.record().state?.finalSaved,undefined);assert.equal(h.record().state?.cleanupComplete,undefined);
      assert.equal(h.record().state?.delivery,undefined);assert.notEqual(h.local.get(h.id)?.status,'verified');
      assert.deepEqual(h.record().finalWriter,grant);assert.deepEqual(h.record().preparedFinal,prepared);assert.equal(h.writes(),1);
    }finally{r.manager.dispose();}
  }
});

test('startup discovery requires both prepared-grant and request device actors to match this device',async()=>{
  for(const mismatch of ['grant','request'] as const){
    const h=await fixture();await h.client().command({kind:'reserve-final',jobId:h.id,final:h.final});
    assert.ok(await h.completion().complete(h.record(),h.original));
    const record=h.record(),other=randomUUID();
    if(mismatch==='grant')record.finalWriter!.actor=other;
    else record.request.deviceCompletion!.actor=other;
    h.data.set(leasePaths(h.request.host.directory,h.id).record,JSON.stringify(record));
    const r=startupDiscoveryFixture(h,undefined);
    try{
      r.start();await waitForCompletion(()=>r.counts.locations>0);
      assert.ok(r.counts.recordReads>0);assert.equal(r.counts.noteReads,0);assert.equal(r.counts.completions,0);
      assert.equal(r.counts.writeAttempts,0);assert.equal(r.commands.some(command=>command.kind==='commit-final'),false);
      assert.equal(h.record().state?.finalSaved,undefined);assert.deepEqual(h.record(),record);assert.deepEqual(r.errors,[]);
    }finally{r.manager.dispose();}
  }
});

test('startup discovery still requires a current note location for an unprepared permanent grant',async()=>{
  const h=await fixture();await h.client().command({kind:'reserve-final',jobId:h.id,final:h.final});
  const record=structuredClone(h.record()),r=startupDiscoveryFixture(h,undefined);
  assert.ok(record.finalWriter);assert.equal(record.preparedFinal,undefined);
  try{
    r.start();await waitForCompletion(()=>r.counts.locations>0);
    assert.equal(r.counts.noteReads,0);assert.equal(r.counts.completions,0);assert.equal(r.counts.writeAttempts,0);
    assert.equal(r.commands.some(command=>command.kind==='commit-final'),false);assert.deepEqual(h.record(),record);
    assert.equal(h.local.size,0);assert.equal(h.writes(),0);assert.deepEqual(r.errors,[]);
  }finally{r.manager.dispose();}
});

test('reload uses the durable local renamed path when the host still reports a missing old path',async()=>{
  const h=await fixture(),path='Jobs/Settled/Note.md',docs=new Map([[path,h.original]]),adopted:string[]=[];
  await h.client().command({kind:'reserve-final',jobId:h.id,final:h.final});
  const notes={read:async(path:string)=>docs.get(path),compareAndSet:async(path:string,before:string,after:string)=>{if(docs.get(path)!==before)return false;docs.set(path,after);return true;}};
  const completion=new DeviceResponseCompletion(h.actor,h.store,notes,()=>{}),lease=h.record();lease.state={...lease.state!,notePath:path};
  const proof=await completion.complete(lease,h.original,undefined,async proof=>{assert.equal((await h.client().command({kind:'prepare-final',jobId:h.id,token:h.record().finalWriter!.token,proof})).ok,true);});assert.ok(proof);
  assert.equal(h.record().state?.notePath??h.record().request.notePath,'Note.md');assert.equal(h.local.get(h.id)?.notePath,path);
  const reloaded=new DeviceResponseCompletion(h.actor,h.store,{...notes,compareAndSet:async()=>{throw Error('Verified replay must not write');}},path=>adopted.push(path));
  assert.deepEqual(await reloaded.complete(h.record()),proof);assert.deepEqual(adopted,[path]);
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

test('an EOF edit during preparation is retried only after durable no-write evidence and host fencing',async()=>{
  const h=await fixture(),addition='Ordinary text added during a save!';assert.equal(addition.length,34);
  await h.client().command({kind:'reserve-final',jobId:h.id,final:h.final});let prepareCalls=0,abortCalls=0;
  const notes={...h.notes,compareAndSetAttempt:async(path:string,before:string,after:string):Promise<FinalWriteOutcome>=>{
    assert.equal(h.local.get(h.id)!.attempt!.writeState,'writing','write intent must be durable before CAS');
    return {status:await h.notes.compareAndSet(path,before,after)?'verified':'no-write'};
  }};
  const prepare=async(proof:any)=>{assert.equal((await h.client().command({kind:'prepare-final',jobId:h.id,token:h.record().finalWriter!.token,proof})).ok,true);if(++prepareCalls===1)h.edit(h.document()+addition);};
  const abort=async(_proof:any,evidence:FinalAttemptAbort)=>{abortCalls++;assert.equal(h.local.get(h.id)!.attempt!.superseding,true);assert.equal(evidence.writeState,'no-write');assert.equal((await h.client().command({kind:'abort-final',jobId:h.id,token:h.record().finalWriter!.token,abort:evidence})).ok,true);};
  const first=new DeviceResponseCompletion(h.actor,h.store,notes,()=>{});
  assert.equal(await first.complete(h.record(),h.original,undefined,prepare,abort),undefined);
  const pending=structuredClone(h.local.get(h.id)!);assert.equal(pending.attempt!.writeState,'no-write');assert.equal(h.writes(),0);
  const oldProofPath=nativeCommitPath(h.request.host.directory,h.id,pending.attempt!.id),oldProofBytes=h.data.get(oldProofPath)!;assert.ok(oldProofBytes);
  const reloaded=new DeviceResponseCompletion(h.actor,h.store,notes,()=>{});reloaded.restorePending(pending);
  const proof=await reloaded.complete(h.record(),undefined,undefined,prepare,abort);assert.ok(proof);assert.equal(abortCalls,1);assert.equal(h.writes(),1);
  assert.ok(h.document().endsWith(addition));assert.ok(h.document().includes(h.final.body));assert.equal(h.record().finalWriter!.actor,h.actor);
  assert.equal(h.local.get(h.id)!.supersededAttempts!.length,1);
  assert.equal(h.data.get(oldProofPath),oldProofBytes,'supersession retains the exact old proof');const oldProof=JSON.parse(oldProofBytes);
  assert.equal((await h.client().command({kind:'prepare-final',jobId:h.id,token:h.record().finalWriter!.token,proof:oldProof})).ok,false);
});

test('a lost abort acknowledgement preserves the old attempt across repeated reloads',async()=>{
  const h=await fixture();await h.client().command({kind:'reserve-final',jobId:h.id,final:h.final});let prepared=false,lost=true;
  const notes={...h.notes,compareAndSetAttempt:async(path:string,before:string,after:string):Promise<FinalWriteOutcome>=>({status:await h.notes.compareAndSet(path,before,after)?'verified':'no-write'})};
  const prepare=async(proof:any)=>{assert.equal((await h.client().command({kind:'prepare-final',jobId:h.id,token:h.record().finalWriter!.token,proof})).ok,true);if(!prepared){prepared=true;h.edit(h.document()+'Outside edit');}};
  const abort=async(_proof:any,evidence:FinalAttemptAbort)=>{assert.equal((await h.client().command({kind:'abort-final',jobId:h.id,token:h.record().finalWriter!.token,abort:evidence})).ok,true);if(lost){lost=false;throw Error('Lost abort acknowledgement');}};
  let completion=new DeviceResponseCompletion(h.actor,h.store,notes,()=>{});await completion.complete(h.record(),h.original,undefined,prepare,abort);
  const old=structuredClone(h.local.get(h.id)!.attempt!);completion=new DeviceResponseCompletion(h.actor,h.store,notes,()=>{});
  await assert.rejects(completion.complete(h.record(),undefined,undefined,prepare,abort),/Lost abort/);
  assert.equal(h.local.get(h.id)!.attempt!.id,old.id);assert.equal(h.local.get(h.id)!.attempt!.hash,old.hash);assert.equal(h.writes(),0);
  completion=new DeviceResponseCompletion(h.actor,h.store,notes,()=>{});assert.ok(await completion.complete(h.record(),undefined,undefined,prepare,abort));
  assert.equal(h.writes(),1);assert.ok(h.document().includes('Outside edit'));
});

test('ambiguous legacy attempts require an explicit current-note review and retain old proof identity',async()=>{
  const h=await fixture();await h.client().command({kind:'reserve-final',jobId:h.id,final:h.final});h.allow(false);
  const prepare=async(proof:any)=>{assert.equal((await h.client().command({kind:'prepare-final',jobId:h.id,token:h.record().finalWriter!.token,proof})).ok,true);};
  let aborts=0;const abort=async(_proof:any,evidence:FinalAttemptAbort)=>{aborts++;assert.equal(evidence.writeState,'reviewed-conflict');assert.equal((await h.client().command({kind:'abort-final',jobId:h.id,token:h.record().finalWriter!.token,abort:evidence})).ok,true);};
  const completion=new DeviceResponseCompletion(h.actor,h.store,h.notes,()=>{});await completion.complete(h.record(),h.original,undefined,prepare);
  const old=h.local.get(h.id)!.attempt!;delete old.writeState;h.allow(true);h.edit(h.document()+'Later ordinary edit');
  assert.equal(await completion.complete(h.record(),undefined,undefined,prepare,abort),undefined);assert.equal(aborts,0);assert.equal(h.local.get(h.id)!.status,'conflict');
  const candidate=await completion.recoveryCandidate(h.id);assert.ok(candidate);
  await assert.rejects(completion.reviewRecovery(h.id,'0'.repeat(64),abort),/reviewed note changed/);assert.equal(aborts,0);
  await completion.reviewRecovery(h.id,candidate.currentHash,abort);assert.equal(aborts,1);
  const proof=await completion.complete(h.record(),undefined,undefined,prepare,abort);assert.ok(proof);assert.equal(h.writes(),1);assert.ok(h.document().includes('Later ordinary edit'));assert.ok(h.document().includes(h.final.body));
  assert.equal(h.local.get(h.id)!.supersededAttempts![0].id,old.id);assert.equal(h.local.get(h.id)!.supersededAttempts![0].writeState,'reviewed-conflict');
});

test('unfinished journals remain discoverable after reload without being adopted as verified saves',async()=>{
  const h=await fixture(),storage=deviceCompletionStore(h.actor,h.request.vaultId);await h.client().command({kind:'reserve-final',jobId:h.id,final:h.final});h.allow(false);
  const completion=new DeviceResponseCompletion(h.actor,storage.store,h.notes,()=>{throw Error('Unverified completion must not be adopted');});
  assert.equal(await completion.complete(h.record(),h.original),undefined);assert.deepEqual(await storage.restore(),[]);
  let restored=await storage.restorePending();assert.equal(restored.records.length,1);completion.restorePending(restored.records[0]);assert.equal(restored.records[0].status,'commit-pending');
  h.edit(h.document()+'Outside edit');assert.equal(await completion.complete(h.record()),undefined);
  restored=await storage.restorePending();assert.equal(restored.records[0].status,'conflict');assert.equal((await storage.candidates(0)).records[0].id,h.id);
  assert.deepEqual((await storage.restorePending(1)).records,[]);assert.equal(h.writes(),0);
});

test('no-write recovery does not recreate a deleted or damaged response anchor',async()=>{
  const h=await fixture();await h.client().command({kind:'reserve-final',jobId:h.id,final:h.final});
  const notes={...h.notes,compareAndSetAttempt:async():Promise<FinalWriteOutcome>=>({status:'no-write'})};
  const completion=new DeviceResponseCompletion(h.actor,h.store,notes,()=>{});await completion.complete(h.record(),h.original);
  const body=h.local.get(h.id)!.finalBody;h.edit(h.original.replace(responseAnchor(h.id),'User deleted the response'));let aborts=0;
  assert.equal(await completion.complete(h.record(),undefined,undefined,undefined,async()=>{aborts++;}),undefined);
  assert.equal(aborts,0);assert.equal(h.writes(),0);assert.equal(h.local.get(h.id)!.finalBody,body);assert.equal(await completion.previewRecovery(h.id),undefined);
});

test('completion polling uses atomic body-free phase metadata and migrates a legacy journal once',async()=>{
  let now=Date.UTC(2026,9,9,23,59);const h=await fixture(),storage=deviceCompletionStore(h.actor,h.request.vaultId,()=>now);await h.client().command({kind:'reserve-final',jobId:h.id,final:h.final});h.allow(false);
  const completion=new DeviceResponseCompletion(h.actor,storage.store,h.notes,()=>{});await completion.complete(h.record(),h.original);
  const key=`response-completion:${h.actor}:${h.request.vaultId}:`,get=IDBObjectStore.prototype.get;let bodyReads=0;
  IDBObjectStore.prototype.get=function(query){if(query===key+h.id)bodyReads++;return get.call(this,query);};
  try{
    const metadata=(await storage.candidates(0)).records[0];assert.equal(metadata.status,'commit-pending');assert.equal(metadata.attemptPhase,'unknown');assert.equal('finalBody' in metadata,false);assert.equal('original' in metadata,false);assert.equal('token' in metadata,false);await storage.candidates(0);assert.equal(bodyReads,0);
    now+=2*24*60*60*1000;await storage.pruneProofs();assert.equal((await storage.candidates(0)).records[0].id,h.id,'unfinished work survives midnight and completed-proof pruning');assert.equal(bodyReads,0);
    await deviceState(key+'phase-index',{});await storage.candidates(0);assert.ok(bodyReads>0);const migrated=bodyReads;
    await storage.candidates(0);assert.equal(bodyReads,migrated,'later polls read metadata only');
    assert.equal((await storage.restorePending()).records[0].finalBody,h.final.body);
  }finally{IDBObjectStore.prototype.get=get;}
});
