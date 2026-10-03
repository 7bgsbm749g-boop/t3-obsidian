import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {InlineLeaseAuthority,InlineLeaseClient,LEASE_MS,leasePaths,type LeaseFiles,type LeaseRecord} from '../inline-lease';
import {hostedPaths,hostedRequestHash,type HostedInlineRequest,type HostedInlineState} from '../hosted-inline';
import {initialRegion,completionProof} from '../inline-thread';
import {DeviceInlineManager,INLINE_SNAPSHOT_INTERVAL_MS,INLINE_SNAPSHOT_TIMEOUT_MS} from '../leased-inline';
import {responseAnchor} from '../native-response-projection';
import {ResponseNoteLocator} from '../response-location';
import {EventJournal,configureDiagnostics} from '../diagnostics';
import {contentHash} from '../completion';
import {nativeCommitPath} from '../native-response-commit';

function harness(){
  let time=100_000;
  const directory='.obsidian/t3-code/inline/v1',identity={vaultId:'vault',environmentId:'host',workspaceRoot:'/vault',directory};
  const data=new Map<string,string>();
  const files:LeaseFiles={read:async path=>data.get(path),write:async(path,value)=>{data.set(path,value);},remove:async path=>{data.delete(path);},list:async dir=>[...data.keys()].filter(path=>path.startsWith(dir+'/'))};
  let authority=new InlineLeaseAuthority(identity,files,()=>time);
  const remote={...files,read:async(path:string)=>{if(path.includes('/replies/'))await authority.tick();return files.read(path);}};
  const actor=randomUUID(),id=randomUUID(),region=initialRegion(id);
  const request:HostedInlineRequest={version:2,id,initialOwner:actor,vaultId:'vault',host:identity,notePath:'Note.md',threadId:'thread',messageId:randomUUID(),projectId:'project',threadEnvironmentId:'host',initialHash:region.bodyHash,createdAt:'2026-09-29T12:00:00Z'};
  const client=(owner=actor)=>new InlineLeaseClient(owner,remote,directory,()=>time,()=>time,async()=>{await authority.tick();});
  const record=():LeaseRecord=>JSON.parse(data.get(leasePaths(directory,id).record)!);
  const state:HostedInlineState={requestHash:hostedRequestHash(request),accepted:true,notePath:'Note.md',status:'running',hashes:[region.bodyHash],updatedAt:''};
  return {actor,request,region,files,remote,data,client,record,state,authority:()=>authority,now:()=>time,advance:(ms:number)=>{time+=ms;},restart:()=>{authority.stop();authority=new InlineLeaseAuthority(identity,files,()=>time);return authority.tick();}};
}

test('registration timeout and successful retry expose the exact mailbox stage and correlated host reply',async()=>{
  const h=harness(),journal=new EventJournal({id:randomUUID,context:{deviceId:'test'},now:h.now,load:async()=>undefined,save:async()=>{}});
  configureDiagnostics(journal);
  try{
    const offline=new InlineLeaseClient(h.actor,h.files,h.request.host.directory,h.now,h.now,async ms=>h.advance(ms));
    await assert.rejects(offline.command({kind:'register',jobId:h.request.id,request:h.request}),/coordinator did not answer/);
    let events=JSON.parse(journal.export()).events;const timeout=events.find((e:any)=>e.event==='ownership.command.failed');
    assert.equal(timeout.fields.phase,'waiting-for-reply');assert.equal(timeout.fields.attempts,50);assert.equal(timeout.fields.elapsedMs,5000);
    assert.equal(timeout.fields.notePath,'Note.md');assert.equal(timeout.fields.threadId,'thread');assert.equal(timeout.fields.actor,h.actor);
    assert.equal(events.filter((e:any)=>e.event==='ownership.command.sent').length,1);
    await h.client().command({kind:'register',jobId:h.request.id,request:h.request});events=JSON.parse(journal.export()).events;
    const completed=events.findLast((e:any)=>e.event==='ownership.command.completed'),replied=events.find((e:any)=>e.event==='ownership.coordinator.replied'&&e.fields.commandId===completed.fields.commandId);
    assert.equal(completed.fields.jobId,timeout.fields.jobId);assert.equal(replied.fields.ok,true);assert.equal(completed.fields.attempts,1);
    assert.ok(events.some((e:any)=>e.event==='ownership.coordinator.received'&&e.fields.commandId===timeout.fields.commandId),'late registration is visible on the host');
  }finally{configureDiagnostics();await journal.close();}
});
test('coordinator scan failures are logged once per interval and recovery is visible',async()=>{
  const h=harness(),journal=new EventJournal({id:randomUUID,context:{deviceId:'test'},now:h.now,load:async()=>undefined,save:async()=>{}});let fail=true;
  const authority=new InlineLeaseAuthority({...h.request.host,vaultId:h.request.vaultId},{...h.files,list:async dir=>{if(fail)throw Error('mailbox unavailable');return h.files.list(dir);}},h.now);
  configureDiagnostics(journal);
  try{
    await assert.rejects(authority.tick(),/mailbox unavailable/);await assert.rejects(authority.tick(),/mailbox unavailable/);
    assert.equal(JSON.parse(journal.export()).events.filter((e:any)=>e.event==='ownership.coordinator.scan.failed').length,1);
    fail=false;await authority.tick();assert.ok(JSON.parse(journal.export()).events.some((e:any)=>e.event==='ownership.coordinator.recovered'));
  }finally{authority.stop();configureDiagnostics();await journal.close();}
});

test('register needs no synced note; healthy heartbeats prevent all competing claims',async()=>{
  const h=harness(),phone=h.client(),laptop=h.client(randomUUID());
  const registered=await phone.command({kind:'register',jobId:h.request.id,request:h.request});assert.equal(registered.ok,true);
  for(let n=0;n<8;n++){
    h.advance(3000);
    assert.equal((await phone.command({kind:'heartbeat',jobId:h.request.id,epoch:1})).ok,true);
    assert.equal((await laptop.command({kind:'claim',jobId:h.request.id})).ok,false);
    assert.equal(h.record().owner,h.actor);assert.equal(h.record().epoch,1);
  }
  const before=h.record();phone.dispose();assert.deepEqual(h.record(),before,'Disposal does not release or shorten ownership');
  assert.equal((await laptop.command({kind:'claim',jobId:h.request.id})).ok,false);
  h.advance(LEASE_MS);
  assert.equal((await laptop.command({kind:'claim',jobId:h.request.id})).ok,true);assert.equal(h.record().epoch,2);
});

test('simultaneous contenders receive one grant; an old epoch cannot heartbeat or checkpoint',async()=>{
  const h=harness(),phone=h.client(),laptop=h.client(randomUUID()),vps=h.client(randomUUID());
  await phone.command({kind:'register',jobId:h.request.id,request:h.request});h.advance(LEASE_MS+2000);
  const replies=await Promise.all([laptop,vps].map(client=>client.command({kind:'claim',jobId:h.request.id})));
  assert.equal(replies.filter(reply=>reply.ok).length,1);assert.equal(h.record().epoch,2);
  assert.equal(phone.valid(h.request.id,1),false);
  assert.equal((await phone.command({kind:'heartbeat',jobId:h.request.id,epoch:1})).ok,false);
  assert.equal((await phone.command({kind:'checkpoint',jobId:h.request.id,epoch:1,revision:0,state:h.state})).ok,false);
  assert.equal(h.record().state,undefined);
});

test('checkpoints preserve hashes without renewing expiry and stale revisions are rejected',async()=>{
  const h=harness(),phone=h.client();await phone.command({kind:'register',jobId:h.request.id,request:h.request});
  const expires=h.record().expiresAt;h.advance(8000);
  assert.equal((await phone.command({kind:'checkpoint',jobId:h.request.id,epoch:1,revision:0,state:h.state})).ok,true);
  assert.equal(h.record().expiresAt,expires);
  assert.equal((await phone.command({kind:'checkpoint',jobId:h.request.id,epoch:1,revision:0,state:{...h.state,status:'complete'}})).ok,false);
  assert.equal(h.record().state?.status,'running');
  h.advance(LEASE_MS);
  const next=h.client(randomUUID());await next.command({kind:'claim',jobId:h.request.id});
  assert.deepEqual(h.record().state?.hashes,[h.request.initialHash]);assert.equal(h.record().revision,1);
});

test('old paused bindings are discoverable and can be claimed after the original lease expires',async()=>{
  const h=harness(),owner=h.client(),other=h.client(randomUUID());
  await owner.command({kind:'register',jobId:h.request.id,request:h.request});
  await owner.command({kind:'checkpoint',jobId:h.request.id,epoch:1,revision:0,state:{...h.state,status:'paused'}});
  assert.equal(JSON.parse(h.data.get(leasePaths(h.request.host.directory,h.request.id).catalog)!).length,1);
  assert.equal((await other.command({kind:'claim',jobId:h.request.id})).ok,false);
  h.advance(LEASE_MS);
  assert.equal((await other.command({kind:'claim',jobId:h.request.id})).ok,true);
});

test('a failed response accepts one durable continuation and fences stale writer checkpoints',async()=>{
  const h=harness(),phone=h.client(),other=h.client(randomUUID());
  await phone.command({kind:'register',jobId:h.request.id,request:h.request});
  await phone.command({kind:'checkpoint',jobId:h.request.id,epoch:1,revision:0,state:{...h.state,status:'error'}});
  const next=randomUUID(),before=h.record();
  assert.equal((await other.command({kind:'follow',jobId:h.request.id,previousMessageId:h.request.messageId,messageId:next})).ok,true);
  assert.equal(h.record().state?.pendingMessageId,next);
  assert.equal((await phone.command({kind:'checkpoint',jobId:h.request.id,epoch:1,revision:before.revision,state:{...h.state,status:'running'}})).ok,false);
  assert.equal((await other.command({kind:'follow',jobId:h.request.id,previousMessageId:h.request.messageId,messageId:next})).ok,true,'the same saved send may be retried');
  assert.equal((await other.command({kind:'follow',jobId:h.request.id,previousMessageId:h.request.messageId,messageId:randomUUID()})).ok,false);
  assert.equal((await phone.command({kind:'checkpoint',jobId:h.request.id,epoch:1,revision:h.record().revision,state:{...h.state,status:'running',messageId:next}})).ok,true);
  assert.equal((await other.command({kind:'follow',jobId:h.request.id,previousMessageId:h.request.messageId,messageId:next})).ok,true,'a lost dispatch reply does not break the binding');
});

test('a failed response can attach a continuation after its note moves',async()=>{
  const h=harness(),owner=h.client(),sender=h.client(randomUUID());
  await owner.command({kind:'register',jobId:h.request.id,request:h.request});
  await owner.command({kind:'checkpoint',jobId:h.request.id,epoch:1,revision:0,state:{...h.state,status:'error'}});
  const messageId=randomUUID(),path='Moved/Note.md';
  assert.equal((await sender.command({kind:'follow',jobId:h.request.id,previousMessageId:h.request.messageId,messageId,notePath:'../Other.md'})).ok,false);
  assert.equal((await sender.command({kind:'follow',jobId:h.request.id,previousMessageId:h.request.messageId,messageId,notePath:path})).ok,true);
  assert.equal(h.record().state?.notePath,path);
  assert.equal(h.record().state?.pendingMessageId,messageId);
  assert.equal((await sender.command({kind:'follow',jobId:h.request.id,previousMessageId:h.request.messageId,messageId,notePath:path})).ok,true,'retry keeps the same moved path');
  assert.equal((await sender.command({kind:'follow',jobId:h.request.id,previousMessageId:h.request.messageId,messageId,notePath:'Another.md'})).ok,false);
});

test('relocation claims validate paths and cannot move an active grant or bypass another note writer',async()=>{
  const h=harness(),owner=h.client(),other=h.client(randomUUID());
  await owner.command({kind:'register',jobId:h.request.id,request:h.request});
  assert.equal((await other.command({kind:'claim',jobId:h.request.id,notePath:'Moved.md'})).ok,false);
  assert.equal(h.record().state,undefined);
  h.advance(LEASE_MS+1);
  assert.equal((await other.command({kind:'claim',jobId:h.request.id,notePath:'../Outside.md'})).ok,false);
  const occupant=randomUUID(),second={...h.request,id:randomUUID(),initialOwner:occupant,notePath:'Moved.md'};
  assert.equal((await h.client(occupant).command({kind:'register',jobId:second.id,request:second})).ok,true);
  assert.equal((await other.command({kind:'claim',jobId:h.request.id,notePath:'Moved.md'})).ok,false);
  assert.equal(h.record().owner,h.actor);assert.equal(h.record().epoch,1);
});

test('slow grants are expired on arrival and wall clock changes cannot prolong a lease',async()=>{
  const h=harness();let monotonic=h.now();
  const delayed={...h.remote,read:async(path:string)=>{const value=await h.remote.read(path);if(path.includes('/replies/')){h.advance(LEASE_MS+1);monotonic+=LEASE_MS+1;}return value;}};
  const client=new InlineLeaseClient(h.actor,delayed,h.request.host.directory,h.now,()=>monotonic);
  const response=await client.command({kind:'register',jobId:h.request.id,request:h.request});assert.equal(response.ok,true);assert.equal(client.valid(h.request.id,1),false);
  const next=h.client(randomUUID());assert.equal((await next.command({kind:'claim',jobId:h.request.id})).ok,true);
  // A backwards wall clock cannot restore a grant whose monotonic deadline passed.
  h.advance(-LEASE_MS-1);assert.equal(client.valid(h.request.id,1),false);
});

test('authority restart repairs catalog after a grant/index crash; duplicate registration is immutable',async()=>{
  const h=harness(),phone=h.client();await phone.command({kind:'register',jobId:h.request.id,request:h.request});
  const before=h.record();h.data.delete(leasePaths(h.request.host.directory,h.request.id).catalog);
  await h.restart();assert.equal(JSON.parse(h.data.get(leasePaths(h.request.host.directory,h.request.id).catalog)!)[0].id,h.request.id);
  h.advance(1000);await phone.command({kind:'register',jobId:h.request.id,request:h.request});assert.deepEqual(h.record(),before);
  assert.equal((await phone.command({kind:'register',jobId:h.request.id,request:{...h.request,notePath:'Other.md'}})).ok,false);
});

test('closed-note fallback waits briefly; completion removes discovery entry and prevents takeover',async()=>{
  const h=harness(),phone=h.client(),vps=h.client(randomUUID());await phone.command({kind:'register',jobId:h.request.id,request:h.request});h.advance(LEASE_MS);
  assert.equal((await vps.command({kind:'claim',jobId:h.request.id,fallback:true})).ok,false);
  h.advance(2000);assert.equal((await vps.command({kind:'claim',jobId:h.request.id,fallback:true})).ok,true);
  await vps.command({kind:'checkpoint',jobId:h.request.id,epoch:2,revision:0,state:{...h.state,status:'complete'}});
  assert.deepEqual(JSON.parse(h.data.get(leasePaths(h.request.host.directory,h.request.id).catalog)!),[]);
  h.advance(LEASE_MS);assert.equal((await phone.command({kind:'claim',jobId:h.request.id})).ok,false);
});

function devices(independent=false,stream=true){
  const h=harness(),managers:DeviceInlineManager[]=[];
  if(independent)h.request.independent=true;
  let answer='First paragraph',complete=false,sequence=0,reads=0;
  let readOverride:(()=>Promise<any>)|undefined;
  const snapshot=()=>({snapshotSequence:sequence,thread:{id:h.request.threadId,projectId:h.request.projectId,messages:[
    {id:h.request.messageId,role:'user',text:'Question',streaming:false,createdAt:h.request.createdAt},
    {id:'answer',role:'assistant',text:answer,streaming:!complete,turnId:'turn'}],activities:[],latestTurn:{turnId:'turn',state:complete?'completed':'running',requestedAt:h.request.createdAt,assistantMessageId:'answer'},session:{status:complete?'ready':'running',activeTurnId:complete?null:'turn'}}});
  const create=(actor:string)=>{
    const document={path:'Note.md',present:true,value:'Outside before\n'+h.region.text+'Outside after',writes:0,saved:true,hold:undefined as (()=>Promise<void>)|undefined};
    const extras=new Map<string,string>();
    const readNote=async(path:string)=>path===document.path&&document.present?document.value:extras.get(path);
    const locator=new ResponseNoteLocator(()=>[...(document.present?[document.path]:[]),...extras.keys()],readNote,h.now);
    const manager=new DeviceInlineManager(actor,h.request.vaultId,{
      access:async()=>({origin:'https://unused.example',api:async path=>{if(path.includes('websocket-ticket'))throw Error('REST fallback fixture');reads++;return readOverride?readOverride():snapshot();}}),
      isOpen:()=>true,isSaved:async path=>path===document.path&&document.saved,readNote,
      locateNote:(id,path)=>locator.locate(id,path),noteChanged:path=>locator.changed(path),noteRenamed:(before,after)=>locator.renamed(before,after),
      updateNote:async(path,change,allowed)=>{assert.equal(allowed(),true);if(path!==document.path||!document.present)return;const next=change(document.value);if(next!==document.value){await document.hold?.();if(!allowed())throw Error('Expired write');if(path!==document.path)throw Error('Note moved during write');document.writes++;document.value=next;}return next;},
    },async()=>({files:h.remote,close:()=>{}}),h.now,h.now,async()=>{await new Promise(resolve=>setImmediate(resolve));});
    managers.push(manager);return {document,manager,extras};
  };
  const drain=async(...active:DeviceInlineManager[])=>{for(let n=0;n<32;n++){for(const manager of active)manager.tick();await new Promise(resolve=>setImmediate(resolve));}};
  const deliver=(value:any)=>{for(const manager of managers)for(const runtime of (manager as any).jobs.values())(manager as any).item(runtime,{kind:'snapshot',snapshot:value});};
  return {...h,create,drain,snapshot,deliver,get reads(){return reads;},override:(read?:()=>Promise<any>)=>{readOverride=read;},answer:(text:string,done=false)=>{
    answer=text;complete=done;sequence++;
    if(stream)deliver(snapshot());
  },dispose:()=>managers.forEach(manager=>manager.dispose())};
}

test('an owned stale running cache recovers final output without stream events, reconnects or takeover',async()=>{
  const h=devices(true,false),device=h.create(h.actor);
  try{
    await device.manager.register(h.request);await h.drain(device.manager);
    const epoch=h.record().epoch,reads=h.reads,writes=device.document.writes;
    await h.drain(device.manager);assert.equal(h.reads,reads,'The writer does not poll on every rendering tick');assert.equal(device.document.writes,writes);
    h.answer('Recovered full final.',true);h.advance(INLINE_SNAPSHOT_INTERVAL_MS-1);await h.drain(device.manager);
    assert.equal(h.record().state?.status,'running');assert.match(device.document.value,/Working/);
    h.advance(1);await h.drain(device.manager);
    assert.equal(h.record().state?.status,'complete');assert.equal(h.record().epoch,epoch);assert.equal(h.record().owner,h.actor);
    assert.match(device.document.value,/Recovered full final/);assert.match(device.document.value,/Outside before/);assert.doesNotMatch(device.document.value,/Working|send-to-t3-inline-spinner|<!-- t3-(?:inline|response):/);
  }finally{h.dispose();}
});

test('failed freshness reads back off while lease renewal continues and then recover',async()=>{
  const h=devices(false,false),device=h.create(h.actor);
  try{
    await device.manager.register(h.request);await h.drain(device.manager);const epoch=h.record().epoch;
    h.override(async()=>{throw Error('Temporary T3 outage');});h.advance(INLINE_SNAPSHOT_INTERVAL_MS);await h.drain(device.manager);
    const reads=h.reads;h.advance(4999);await h.drain(device.manager);assert.equal(h.reads,reads);assert.equal(h.record().state?.status,'running');assert.equal(h.record().epoch,epoch);
    h.override();h.answer('Recovered after outage',true);h.advance(1);await h.drain(device.manager);
    assert.equal(h.record().state?.status,'complete');assert.match(device.document.value,/Recovered after outage/);
  }finally{h.dispose();}
});

test('hung freshness reads time out on coordinator ticks and late snapshots cannot roll back recovery',async()=>{
  const h=devices(false,false),device=h.create(h.actor);
  try{
    await device.manager.register(h.request);await h.drain(device.manager);
    const stale=h.snapshot();let release!:(snapshot:any)=>void;
    h.override(()=>new Promise(resolve=>{release=resolve;}));h.advance(INLINE_SNAPSHOT_INTERVAL_MS);await h.drain(device.manager);assert.ok(release);
    for(let elapsed=0;elapsed<INLINE_SNAPSHOT_TIMEOUT_MS;elapsed+=3000){h.advance(3000);await h.drain(device.manager);}
    assert.equal(h.record().epoch,1,'Timeout does not discard a healthy owner');
    h.override();h.answer('Final after hung request',true);h.advance(5000);await h.drain(device.manager);
    assert.equal(h.record().state?.status,'complete');const final=device.document.value;
    release(stale);await h.drain(device.manager);assert.equal(device.document.value,final);
  }finally{h.dispose();}
});

test('a slow canonical response cannot overwrite a newer stream snapshot',async()=>{
  const h=devices(false,false),device=h.create(h.actor);
  try{
    await device.manager.register(h.request);await h.drain(device.manager);const stale=h.snapshot();let release!:(value:any)=>void;
    h.override(()=>new Promise(resolve=>{release=resolve;}));h.advance(INLINE_SNAPSHOT_INTERVAL_MS);await h.drain(device.manager);
    h.answer('Newer stream progress');h.deliver(h.snapshot());h.advance(200);await h.drain(device.manager);
    release(stale);await h.drain(device.manager);
    assert.match(device.document.value,/Newer stream progress/);assert.doesNotMatch(device.document.value,/First paragraph/);assert.equal(h.record().state?.status,'running');
  }finally{h.dispose();}
});

test('a canonical read from an expired ownership epoch cannot finalize the note',async()=>{
  const h=devices(false,false),device=h.create(h.actor);
  try{
    await device.manager.register(h.request);await h.drain(device.manager);let release!:(value:any)=>void;
    h.override(()=>new Promise(resolve=>{release=resolve;}));h.advance(INLINE_SNAPSHOT_INTERVAL_MS);await h.drain(device.manager);
    const document=device.document.value;h.answer('Final from old request',true);
    h.advance(LEASE_MS+1);const other=h.client(randomUUID());assert.equal((await other.command({kind:'claim',jobId:h.request.id,epoch:1})).ok,true);
    release(h.snapshot());await h.drain(device.manager);
    assert.equal(device.document.value,document);assert.equal(h.record().epoch,2);assert.equal(h.record().state?.status,'running');
  }finally{h.dispose();}
});

for(const observed of [true,false])test(`stream follows ${observed?'observed folder moves':'a missed rename with old-path reuse'} without changing its request or ownership`,async()=>{
  const h=devices(true),phone=h.create(h.actor);
  try{
    await phone.manager.register(h.request);await h.drain(phone.manager);
    const original=h.record().request,epoch=h.record().epoch;
    phone.document.path='Moved/Note.md';
    if(observed)phone.manager.renamed('Note.md','Moved/Note.md');
    else phone.extras.set('Note.md','Replacement note stays untouched');
    h.answer('Progress after move');h.advance(200);await h.drain(phone.manager);
    assert.equal(h.record().state?.notePath,'Moved/Note.md');assert.equal(h.record().epoch,epoch);
    assert.match(phone.document.value,/Progress after move/);assert.deepEqual(h.record().request,original);
    phone.document.path='Final/Note.md';phone.manager.renamed('Moved','Final');
    h.answer('Final after second move',true);h.advance(200);await h.drain(phone.manager);h.advance(200);await h.drain(phone.manager);
    assert.equal(h.record().state?.notePath,'Final/Note.md');assert.equal(h.record().state?.status,'complete');
    assert.match(phone.document.value,/Final after second move/);assert.match(phone.document.value,/Outside before/);
    assert.doesNotMatch(phone.document.value,/<!-- t3-(?:inline|response):/);
    if(!observed)assert.equal(phone.extras.get('Note.md'),'Replacement note stays untouched');
  }finally{h.dispose();}
});

test('move arriving through Sync keeps a healthy lease and resumes from current T3 state',async()=>{
  const h=devices(),phone=h.create(h.actor),other=h.client(randomUUID());
  try{
    await phone.manager.register(h.request);await h.drain(phone.manager);
    phone.document.present=false;phone.document.path='Delayed.md';phone.manager.renamed('Note.md','Delayed.md');
    const epoch=h.record().epoch;
    for(let index=0;index<7;index++){h.advance(3000);await h.drain(phone.manager);}
    assert.equal(h.record().epoch,epoch);assert.match(h.record().state?.detail??'',/Waiting for moved note/);
    assert.equal((await other.command({kind:'claim',jobId:h.request.id})).ok,false);
    phone.document.present=true;phone.manager.changed('Delayed.md');h.answer('Caught up final',true);
    h.advance(200);await h.drain(phone.manager);
    assert.equal(h.record().state?.status,'complete');assert.match(phone.document.value,/Caught up final/);
  }finally{h.dispose();}
});

test('a restarted device discovers a moved response and persists its path atomically with takeover',async()=>{
  const h=devices(),phone=h.create(h.actor),laptop=h.create(randomUUID());
  try{
    await phone.manager.register(h.request);await h.drain(phone.manager);phone.manager.dispose();
    laptop.document.value='Outside edit\n'+phone.document.value;laptop.document.path='Offline move/Note.md';
    h.advance(LEASE_MS+1);laptop.manager.discover([h.request.host]);await h.drain(laptop.manager);
    assert.equal(h.record().epoch,2);assert.equal(h.record().state?.notePath,laptop.document.path);
    h.answer('Recovered final',true);h.advance(200);await h.drain(laptop.manager);
    assert.equal(h.record().state?.status,'complete');assert.match(laptop.document.value,/Outside edit/);assert.match(laptop.document.value,/Recovered final/);
  }finally{h.dispose();}
});

test('a moved response overwrites changed contents and a copied block waits for disambiguation',async()=>{
  const h=devices(),phone=h.create(h.actor);
  try{
    await phone.manager.register(h.request);await h.drain(phone.manager);
    phone.document.path='Moved.md';phone.extras.set('Copy.md',phone.document.value);phone.manager.changed('Copy.md');
    h.answer('New paragraph');h.advance(200);await h.drain(phone.manager);
    assert.equal(h.record().state?.status,'paused');assert.match(h.record().state?.detail??'',/multiple notes/);assert.deepEqual(h.record().state?.locationConflict,['Copy.md','Moved.md']);
    assert.doesNotMatch(phone.document.value,/New paragraph/);
    phone.extras.delete('Copy.md');phone.manager.changed('Copy.md');
    phone.document.value=phone.document.value.replace('First paragraph','My correction');
    h.advance(200);await h.drain(phone.manager);
    assert.equal(h.record().state?.status,'running');assert.doesNotMatch(phone.document.value,/My correction/);assert.match(phone.document.value,/New paragraph/);
  }finally{h.dispose();}
});

test('a move during final disk-save verification finishes in the relocated note',async()=>{
  const h=devices(true),phone=h.create(h.actor);
  try{
    await phone.manager.register(h.request);await h.drain(phone.manager);
    phone.document.saved=false;h.answer('Final before move',true);h.advance(200);await h.drain(phone.manager);
    assert.match(phone.document.value,/t3-response:start:/);assert.equal(h.record().state?.status,'running');
    phone.document.path='Final moved.md';phone.document.saved=true;
    h.advance(200);await h.drain(phone.manager);h.advance(200);await h.drain(phone.manager);
    assert.equal(h.record().state?.status,'complete');assert.equal(h.record().state?.notePath,'Final moved.md');
    assert.doesNotMatch(phone.document.value,/<!-- t3-(?:inline|response):/);assert.match(phone.document.value,/Final before move/);
  }finally{h.dispose();}
});

test('temporary proof cleanup waits for both disk saves and resumes after reload with outside edits',async()=>{
  const h=devices(true),phone=h.create(h.actor);
  try{
    await phone.manager.register(h.request);await h.drain(phone.manager);
    phone.document.saved=false;h.answer('Independent final',true);h.advance(200);await h.drain(phone.manager);
    assert.match(phone.document.value,/t3-response:start:/);assert.equal(h.record().state?.finalSaved,undefined);
    phone.document.saved=true;
    phone.document.hold=async()=>{phone.document.saved=false;};
    h.advance(200);await h.drain(phone.manager);
    assert.equal(h.record().state?.finalSaved,true);assert.equal(h.record().state?.status,'running');
    assert.doesNotMatch(phone.document.value,/<!-- t3-(?:inline|response):/);
    phone.manager.dispose();
    const reloaded=h.create(h.actor);reloaded.document.value=phone.document.value+'\nAnother stream changed the note';
    h.advance(LEASE_MS+1);reloaded.manager.discover([h.request.host]);await h.drain(reloaded.manager);h.advance(200);await h.drain(reloaded.manager);
    assert.equal(h.record().state?.status,'complete');assert.equal(h.record().state?.cleanupComplete,true);
    assert.match(reloaded.document.value,/Another stream changed the note/);
    assert.equal(reloaded.document.value.split('Independent final').length-1,1);
  }finally{h.dispose();}
});

test('coordinator restart publishes old completed proof records for cleanup on an eligible device',async()=>{
  const h=devices(true),phone=h.create(h.actor),owner=h.client();
  try{
    await owner.command({kind:'register',jobId:h.request.id,request:h.request});
    const body='> Old finished answer\n';phone.document.value='Before\n'+completionProof(h.request.id,'> Later user edit\n')+'\nAfter';
    const record=h.record();
    h.data.set(leasePaths(h.request.host.directory,h.request.id).record,JSON.stringify({...record,state:{...h.state,requestHash:hostedRequestHash(h.request),status:'complete',finalBody:body,finalDocumentHash:'old whole-note hash'}}));
    h.data.set(leasePaths(h.request.host.directory,h.request.id).catalog,'[]');await h.restart();
    assert.equal(JSON.parse(h.data.get(leasePaths(h.request.host.directory,h.request.id).catalog)!).length,1);
    h.advance(LEASE_MS+1);phone.manager.discover([h.request.host]);await h.drain(phone.manager);h.advance(200);await h.drain(phone.manager);
    assert.equal(h.record().state?.status,'complete');assert.equal(h.record().state?.cleanupComplete,true);
    assert.equal(phone.document.value,'Before\n> Later user edit\nAfter');
  }finally{h.dispose();}
});

test('another device resumes a missed-heartbeat reply from a known older Sync version, preserving outside edits',async()=>{
  const h=devices(),phone=h.create(h.actor),laptop=h.create(randomUUID());
  try{
    await phone.manager.register(h.request);await h.drain(phone.manager);assert.match(phone.document.value,/First paragraph/);
    laptop.manager.discover([h.request.host]);await h.drain(laptop.manager);assert.equal(laptop.document.writes,0);
    laptop.document.value='New outside edit\n'+laptop.document.value;
    h.answer('Second paragraph');h.advance(LEASE_MS+1);await h.drain(laptop.manager);h.advance(200);await h.drain(laptop.manager);
    assert.equal(h.record().epoch,2);assert.match(laptop.document.value,/Second paragraph/);assert.match(laptop.document.value,/New outside edit/);
    const oldPhone=phone.document.value;await h.drain(phone.manager);assert.equal(phone.document.value,oldPhone,'Resumed sender must not write its stale copy');
    h.answer('Final answer',true);h.advance(200);await h.drain(laptop.manager);
    assert.equal(h.record().state?.status,'complete');assert.match(laptop.document.value,/Final answer/);assert.doesNotMatch(laptop.document.value,/t3-inline:/);
  }finally{h.dispose();}
});

test('changed response contents are overwritten after device takeover',async()=>{
  const h=devices(),phone=h.create(h.actor),laptop=h.create(randomUUID());
  try{
    await phone.manager.register(h.request);await h.drain(phone.manager);
    laptop.document.value=phone.document.value.replace('First paragraph','My own correction');
    laptop.manager.discover([h.request.host]);await h.drain(laptop.manager);
    h.advance(LEASE_MS+1);h.answer('New answer');await h.drain(laptop.manager);h.advance(200);await h.drain(laptop.manager);
    assert.equal(h.record().state?.status,'running');assert.doesNotMatch(laptop.document.value,/My own correction/);assert.match(laptop.document.value,/New answer/);
    assert.equal(JSON.parse(h.data.get(leasePaths(h.request.host.directory,h.request.id).catalog)!).length,1);
    h.advance(LEASE_MS);assert.equal((await h.client(randomUUID()).command({kind:'claim',jobId:h.request.id})).ok,true);
  }finally{h.dispose();}
});

test('restoring removed response markers resumes the same open editor',async()=>{
  for(const damage of [(text:string)=>text.replace(`<!-- t3-inline:start:`, '<!-- removed:start:')]){
    const h=devices(),editor=h.create(h.actor);
    try{
      await editor.manager.register(h.request);await h.drain(editor.manager);
      const intact=editor.document.value;
      editor.document.value=damage(intact);h.answer('New paragraph');h.advance(200);await h.drain(editor.manager);
      assert.equal(h.record().state?.status,'paused');assert.equal(editor.document.value,damage(intact));
      h.advance(200);await h.drain(editor.manager);assert.equal(editor.document.value,damage(intact),'No changed text is overwritten while paused');
      h.advance(LEASE_MS+1);await h.drain(editor.manager);
      assert.equal(h.record().state?.status,'paused','A long undo delay does not finish the response');
      editor.document.value='Outside edit\n'+intact;
      h.answer('Final answer',true);h.advance(3000);await h.drain(editor.manager);h.advance(200);await h.drain(editor.manager);
      await (editor.manager as any).jobs.get(h.request.id)?.work;
      for(let attempt=0;attempt<8&&h.record().state?.status!=='complete';attempt++){h.advance(200);await h.drain(editor.manager);}
      assert.equal(h.record().state?.status,'complete');
      assert.match(editor.document.value,/Outside edit/);assert.match(editor.document.value,/Final answer/);
      assert.doesNotMatch(editor.document.value,/My correction|removed:start|t3-inline:/);
    }finally{h.dispose();}
  }
});


test('work suspended across two ownership changes cannot reuse a newer grant from the same device',async()=>{
  const h=devices(),phone=h.create(h.actor);let release!:()=>void;
  try{
    await phone.manager.register(h.request);await h.drain(phone.manager);
    phone.document.hold=()=>new Promise<void>(resolve=>{release=resolve;});
    h.answer('Stale pending paragraph');h.advance(200);await h.drain(phone.manager);assert.ok(release);
    h.advance(LEASE_MS);const other=h.client(randomUUID());await other.command({kind:'claim',jobId:h.request.id});assert.equal(h.record().epoch,2);
    h.advance(LEASE_MS);await h.drain(phone.manager);assert.equal(h.record().epoch,3);
    const before=phone.document.value;release();await h.drain();assert.equal(phone.document.value,before,'Old work remains fenced even after its device wins a later lease');
  }finally{release?.();h.dispose();}
});


for(const stopped of [false,true])test(`${stopped?'stopped':'completed'} finalization remains recoverable until the editor has saved its Markdown to disk`,async()=>{
  const h=devices(),phone=h.create(h.actor);
  try{
    await phone.manager.register(h.request);await h.drain(phone.manager);
    phone.document.saved=false;
    if(stopped)h.data.set(hostedPaths(h.request.host.directory,h.request.id).stop,'{}');
    h.answer('Final before save',!stopped);h.advance(200);await h.drain(phone.manager);
    assert.match(phone.document.value,stopped?/First paragraph/:/Final before save/);assert.doesNotMatch(phone.document.value,/t3-inline:/);
    assert.equal(h.record().state?.status,'running','The catalog must still advertise recoverable work');
    assert.equal(JSON.parse(h.data.get(leasePaths(h.request.host.directory,h.request.id).catalog)!).length,1);
    phone.document.saved=true;h.advance(200);await h.drain(phone.manager);assert.equal(h.record().state?.status,stopped?'interrupted':'complete');
  }finally{h.dispose();}
});

test('steering from another device is durable, idempotent, and fences stale completion checkpoints',async()=>{
  const h=harness(),owner=h.client(),sender=h.client(randomUUID());
  await owner.command({kind:'register',jobId:h.request.id,request:h.request});
  const prose=[{id:'progress',role:'assistant',text:'Before steering.',streaming:false,turnId:'turn'}];
  await owner.command({kind:'checkpoint',jobId:h.request.id,epoch:1,revision:0,state:{...h.state,turnId:'turn',prose}});
  const before=h.record(),input={messageId:randomUUID(),text:'Use the other approach.'};
  assert.equal((await sender.command({kind:'steer',jobId:h.request.id,steering:input})).ok,true);
  assert.equal(h.record().owner,h.actor,'sending does not steal writer ownership');
  assert.equal(h.record().state?.steering?.[0].before[0].text,'Before steering.');
  assert.equal((await owner.command({kind:'checkpoint',jobId:h.request.id,epoch:1,revision:before.revision,state:{...h.state,status:'complete'}})).ok,false);
  assert.equal((await sender.command({kind:'steer',jobId:h.request.id,steering:input})).ok,true);
  assert.equal(h.record().state?.steering?.length,1);
  assert.equal((await sender.command({kind:'steer',jobId:h.request.id,steering:{...input,text:'Changed'}})).ok,false);
  assert.equal((await owner.command({kind:'checkpoint',jobId:h.request.id,epoch:1,revision:h.record().revision,state:{...h.record().state!,steering:[]}})).ok,false);
  await owner.command({kind:'checkpoint',jobId:h.request.id,epoch:1,revision:h.record().revision,state:{...h.record().state!,status:'complete',steering:h.record().state!.steering!.map(input=>({...input,confirmed:true}))}});
  assert.equal((await sender.command({kind:'steer',jobId:h.request.id,steering:input})).ok,true,'lost acknowledgement may be retried after completion');
  assert.equal((await sender.command({kind:'steer',jobId:h.request.id,steering:{messageId:randomUUID(),text:'Too late'}})).ok,false);
});

test('initial question is immutable across register retries, authority restart and writer handoff',async()=>{
  const h=harness(),input={messageId:h.request.messageId,text:'Explain this selection.'};
  h.request.initialInput=input;
  h.request.initialHash=initialRegion(h.request.id,input).bodyHash;
  const owner=h.client(),next=h.client(randomUUID());
  assert.equal((await owner.command({kind:'register',jobId:h.request.id,request:h.request})).ok,true);
  assert.equal((await owner.command({kind:'register',jobId:h.request.id,request:h.request})).ok,true);
  assert.equal((await owner.command({kind:'register',jobId:h.request.id,request:{...h.request,initialInput:{...input,text:'Different question'}}})).ok,false);
  await h.restart();h.advance(LEASE_MS+1);
  assert.equal((await next.command({kind:'claim',jobId:h.request.id})).ok,true);
  assert.deepEqual(h.record().request.initialInput,input);
  assert.equal(h.record().request.initialHash,h.request.initialHash);
  owner.dispose();next.dispose();
});

test('different bindings in one note use the same writing device, including registration and takeover',async()=>{
  const h=harness(),sender=h.client(),otherActor=randomUUID(),other=h.client(otherActor);
  await sender.command({kind:'register',jobId:h.request.id,request:h.request});
  const next={...h.request,id:randomUUID(),messageId:randomUUID(),threadId:'second-thread',initialOwner:otherActor};
  const reply=await other.command({kind:'register',jobId:next.id,request:next});
  assert.equal(reply.ok,true);assert.equal(reply.record!.owner,h.actor);
  assert.equal(other.valid(next.id,1),false);
  assert.equal((await sender.command({kind:'heartbeat',jobId:next.id,epoch:1})).ok,true,'The existing note writer acquires a fresh grant for the adopted binding');
  assert.equal(sender.valid(next.id,1),true);
  // Expiry of one block is insufficient to take over while another is healthy.
  h.advance(8000);await sender.command({kind:'heartbeat',jobId:h.request.id,epoch:1});h.advance(8000);
  assert.equal((await other.command({kind:'claim',jobId:next.id})).ok,false);
  h.advance(LEASE_MS);
  assert.equal((await other.command({kind:'claim',jobId:next.id})).ok,true);
  assert.equal((await sender.command({kind:'claim',jobId:h.request.id})).ok,false);
  assert.equal((await other.command({kind:'claim',jobId:h.request.id})).ok,true);
});

test('stop intent is idempotent, durable, and fences stale and resumed checkpoints',async()=>{
  const h=harness(),owner=h.client(),sender=h.client(randomUUID());
  await owner.command({kind:'register',jobId:h.request.id,request:h.request});
  await owner.command({kind:'checkpoint',jobId:h.request.id,epoch:1,revision:0,state:h.state});
  const old=h.record();assert.equal((await sender.command({kind:'stop',jobId:h.request.id})).ok,true);
  const stopped=h.record();assert.ok(stopped.stopRequestedAt);assert.equal(stopped.owner,old.owner);
  assert.equal((await sender.command({kind:'stop',jobId:h.request.id})).ok,true);assert.equal(h.record().revision,stopped.revision);
  assert.equal((await owner.command({kind:'checkpoint',jobId:h.request.id,epoch:1,revision:old.revision,state:h.state})).ok,false);
  assert.equal((await owner.command({kind:'checkpoint',jobId:h.request.id,epoch:1,revision:stopped.revision,state:h.state})).ok,false);
  await h.restart();assert.equal(h.record().stopRequestedAt,stopped.stopRequestedAt);
  assert.equal((await owner.command({kind:'checkpoint',jobId:h.request.id,epoch:1,revision:stopped.revision,state:{...h.state,userStopped:true,status:'interrupted'}})).ok,true);
});

test('a coordinated stop checkpoints a block already cleaned by the sending editor and survives takeover',async()=>{
  const h=devices(true),phone=h.create(h.actor),laptop=h.create(randomUUID());
  try{
    await phone.manager.register(h.request);await h.drain(phone.manager);
    const {stopResponseEdit}=await import('../response-stop');
    const change=stopResponseEdit(phone.document.value,h.request.id)!;
    phone.document.value=phone.document.value.slice(0,change.from)+change.text+phone.document.value.slice(change.to);
    phone.document.saved=false;
    await phone.manager.stopResponse(h.request.host,h.request.id);h.advance(200);await h.drain(phone.manager);
    assert.ok(h.record().stopRequestedAt);assert.equal(h.record().state?.status,'running');assert.doesNotMatch(phone.document.value,/Working|t3-inline:|t3-response:/);
    phone.manager.dispose();laptop.document.value=phone.document.value;h.advance(LEASE_MS+3000);
    laptop.manager.discover([h.request.host]);await h.drain(laptop.manager);h.advance(200);await h.drain(laptop.manager);
    assert.equal(h.record().state?.status,'interrupted');assert.equal(h.record().state?.cleanupComplete,true);
    assert.match(laptop.document.value,/First paragraph/);assert.doesNotMatch(laptop.document.value,/Working|t3-inline:|t3-response:/);
  }finally{h.dispose();}
});

for(const format of ['formatted','raw-markdown'] as const)test(`${format} preference survives a real lease takeover and completion`,async()=>{
  const h=devices(true);
  h.request.finalAnswerFormat=format;h.request.version=format==='raw-markdown'?3:2;
  const first=h.create(h.actor),second=h.create(randomUUID());
  try{
    await first.manager.register(h.request);await h.drain(first.manager);
    assert.match(first.document.value,/> First paragraph/);
    second.document.value=first.document.value;
    first.manager.dispose();h.advance(LEASE_MS+2001);
    second.manager.discover([h.request.host]);await h.drain(second.manager);
    assert.equal(h.record().epoch,2);assert.equal(h.record().request.finalAnswerFormat,format);
    h.answer('Final after takeover.',true);h.advance(200);await h.drain(second.manager);
    assert.equal(h.record().state?.status,'complete');
    assert.match(second.document.value,format==='raw-markdown'?/\nFinal after takeover\.\n/:/\n> Final after takeover\.\n/);
    assert.match(second.document.value,/Outside before/);assert.match(second.document.value,/Outside after/);
    assert.doesNotMatch(second.document.value,/t3-inline:|t3-response:/);
  }finally{h.dispose();}
});

test('explorer projection survives terminal catalog cleanup, recovery, note moves and deletion without changing the lease',async()=>{
  const {explorerResponsePath}=await import('../explorer-responses');
  const h=harness(),client=h.client();await client.command({kind:'register',jobId:h.request.id,request:h.request});
  await client.command({kind:'checkpoint',jobId:h.request.id,epoch:1,revision:0,state:{...h.state,status:'complete'}});
  const path=explorerResponsePath(h.request.host.directory),before=h.record();
  assert.equal(JSON.parse(h.data.get(path)!)[0].complete,true);
  assert.deepEqual(JSON.parse(h.data.get(leasePaths(h.request.host.directory,'').catalog)!),[]);
  const authority=new InlineLeaseAuthority({...h.request.host,vaultId:'vault'},h.files,h.now);
  await authority.tick();authority.renamed('Note.md','Moved.md');await authority.tick();
  assert.equal(JSON.parse(h.data.get(path)!)[0].notePath,'Moved.md');assert.deepEqual(h.record(),before);
  authority.stop();const recovered=new InlineLeaseAuthority({...h.request.host,vaultId:'vault'},h.files,h.now);await recovered.tick();
  assert.equal(JSON.parse(h.data.get(path)!)[0].notePath,'Moved.md');
  recovered.deleted('Moved.md');await recovered.tick();assert.equal(JSON.parse(h.data.get(path)!)[0].deleted,true);recovered.stop();
});

test('acknowledged exact prompt delivery survives a stopped feed, is idempotent, and cannot target another response',async()=>{
  const h=harness(),sender=h.client();await sender.command({kind:'register',jobId:h.request.id,request:h.request});
  const delivery={messageId:h.request.messageId,requestedAt:h.request.createdAt,sequence:40,activeTurnId:'existing'};
  assert.equal((await sender.command({kind:'delivery',jobId:h.request.id,delivery})).ok,true);
  assert.deepEqual(h.record().state?.bindingCheckpoint?.starts?.[h.request.messageId],delivery);
  const before=h.record();assert.equal((await sender.command({kind:'delivery',jobId:h.request.id,delivery})).ok,true);assert.deepEqual(h.record(),before);
  assert.equal((await sender.command({kind:'delivery',jobId:h.request.id,delivery:{...delivery,messageId:randomUUID()}})).ok,false);
  assert.equal((await sender.command({kind:'delivery',jobId:h.request.id,delivery:{...delivery,requestedAt:'2026-10-03T12:00:00Z'}})).ok,false);
  h.advance(LEASE_MS);await h.client(randomUUID()).command({kind:'claim',jobId:h.request.id});
  assert.deepEqual(h.record().state?.bindingCheckpoint?.starts?.[h.request.messageId],delivery);
});

test('an independent mid-run destination recovers from acknowledged delivery with the live feed stopped',async()=>{
  const h=devices(true,false),device=h.create(h.actor);
  try{
    await device.manager.register(h.request);await h.drain(device.manager);
    const id=randomUUID(),messageId=randomUUID(),initial=initialRegion(id),createdAt=new Date(Date.parse(h.request.createdAt)+1000).toISOString();
    const second={...h.request,id,messageId,initialHash:initial.bodyHash,createdAt};
    device.document.value+=initial.text;
    let stage=0;
    h.override(async()=>({snapshotSequence:10+stage,thread:{id:h.request.threadId,projectId:h.request.projectId,messages:[{id:h.request.messageId,role:'user',text:'Original',turnId:null,streaming:false,createdAt:h.request.createdAt},{id:'before',role:'assistant',text:'Original progress',turnId:'turn',streaming:false,createdAt:h.request.createdAt},{id:messageId,role:'user',text:'Mid-run question',turnId:null,streaming:false,createdAt},...(stage?[{id:'after',role:'assistant',text:stage===2?'Mid-run final':'Mid-run streamed progress',turnId:'turn',streaming:stage!==2,createdAt:new Date(Date.parse(createdAt)+1000).toISOString()}]:[])],activities:[],latestTurn:{turnId:'turn',state:stage===2?'completed':'running',requestedAt:h.request.createdAt,assistantMessageId:stage?'after':'before',...(stage===2?{completedAt:new Date(Date.parse(createdAt)+2000).toISOString()}:{})},session:{status:stage===2?'ready':'running',activeTurnId:stage===2?null:'turn'}}}));
    await device.manager.register(second);await device.manager.delivered(second.host,id,{messageId,requestedAt:createdAt,sequence:9,activeTurnId:'turn'});await h.drain(device.manager);
    const record=()=>JSON.parse(h.data.get(leasePaths(second.host.directory,id).record)!);
    assert.equal(record().state.turnId,undefined,'Delivery alone cannot invent a turn');
    stage=1;h.advance(INLINE_SNAPSHOT_INTERVAL_MS);await h.drain(device.manager);
    assert.equal(record().state.turnId,'turn');assert.equal(record().state.status,'running');assert.match(device.document.value,/Mid-run streamed progress/);
    stage=2;h.advance(INLINE_SNAPSHOT_INTERVAL_MS);await h.drain(device.manager);
    assert.equal(record().state.status,'complete');assert.equal(record().state.cleanupComplete,true);assert.equal(record().epoch,1);assert.match(device.document.value,/Mid-run final/);assert.doesNotMatch(device.document.value,/Working|<!-- t3-(?:inline|response):/);
  }finally{h.dispose();}
});

test('a competing device waits for the denied grant expiry instead of sending another claim every heartbeat',async()=>{
  const h=devices(),owner=h.create(h.actor),other=h.create(randomUUID());
  try{
    await owner.manager.register(h.request);await h.drain(owner.manager);
    await other.manager.register(h.request);h.advance(3000);await h.drain(other.manager);
    const claimed=()=>[...h.data.values()].map(raw=>JSON.parse(raw)).filter(value=>value.error==='Another writer still owns this response.').length;
    const before=claimed();assert.ok(before>0);
    for(let n=0;n<3;n++){h.advance(3000);await h.drain(owner.manager,other.manager);}
    assert.equal(claimed(),before,'denied writer waits for the grant that blocked it');
  }finally{h.dispose();}
});

test('a device that reads a newly migrated native record does not send a legacy ownership claim',async()=>{
  const h=devices(),owner=h.create(h.actor),other=h.create(randomUUID());
  try{
    await owner.manager.register(h.request);await h.drain(owner.manager);
    await other.manager.register(h.request);
    const key=leasePaths(h.request.host.directory,h.request.id).record,record=h.record();
    h.data.set(key,JSON.stringify({...record,coordinated:true,owner:'00000000-0000-5000-8000-000000000001',expiresAt:Number.MAX_SAFE_INTEGER,epoch:record.epoch+1}));
    h.advance(3000);await h.drain(other.manager);
    assert.equal([...h.data.values()].map(raw=>JSON.parse(raw)).filter(value=>value.error==='Generated changes are coordinated by the host.').length,0);
  }finally{h.dispose();}
});

test('native devices cache authenticated commit evidence once and acknowledge only matching saved bytes',async()=>{
  const h=harness(),request={...h.request,nativeProjection:true},commitId=randomUUID(),document='Saved final response';
  await h.client().command({kind:'register',jobId:request.id,request});
  const key=leasePaths(request.host.directory,request.id).record;
  const proofBytes=JSON.stringify({version:1,bindingId:request.id,commitId,hash:contentHash(document),document,ranges:[{from:0,to:document.length}]});
  const proofPath=nativeCommitPath(request.host.directory,request.id,commitId);
  const state:HostedInlineState={...h.state,status:'complete',finalPhase:'complete',finalSaved:true,cleanupComplete:true,finalBody:document,delivery:{commitId,hash:contentHash(document),proofHash:contentHash(proofBytes),verifiedOnHost:true,observedBy:[]}};
  h.data.set(key,JSON.stringify({...h.record(),migrating:false,revision:1,state}));h.data.set(proofPath,proofBytes);
  let saved='Stale note',proofReads=0;const received:string[]=[];
  const remote={...h.remote,read:async(path:string)=>{if(path===proofPath)proofReads++;return h.remote.read(path);}};
  const manager=new DeviceInlineManager(h.actor,request.vaultId,{receiveCoordinated:async(_record,proof)=>{if(proof)received.push(proof);},readSaved:async()=>saved,access:async()=>{throw Error('Native devices never open a T3 writer.');},isOpen:()=>true,readNote:async()=>saved,updateNote:async()=>{throw Error('Native devices never write generated text.');}},async()=>({files:remote,close:()=>{}}),h.now,h.now,async()=>{await new Promise(resolve=>setImmediate(resolve));});
  const drain=async()=>{for(let n=0;n<20;n++){manager.tick();await new Promise(resolve=>setImmediate(resolve));}};
  try{
    await manager.register(request);h.advance(1000);await drain();assert.equal(proofReads,1);assert.deepEqual(h.record().state!.delivery!.observedBy,[]);
    h.advance(1000);await drain();assert.equal(proofReads,1);assert.ok(received.length>=2);
    saved=document;h.advance(1000);await drain();assert.deepEqual(h.record().state!.delivery!.observedBy,[h.actor]);assert.equal(proofReads,1);
    assert.equal((manager as any).jobs.size,0);
  }finally{manager.dispose();}
});

test('mobile rename handoffs persist offline, retain mailbox identity, and replay successive moves after reload',async()=>{
  const h=harness();h.request.nativeProjection=true;
  await h.client().command({kind:'register',jobId:h.request.id,request:h.request});await h.authority().migrated(h.request.id);
  let pending:import('../leased-inline').PendingResponseRename[]=[],offline=true;
  const received:LeaseRecord[]=[];
  const make=(actor:string)=>new DeviceInlineManager(actor,h.request.vaultId,{
    loadRenames:()=>structuredClone(pending),saveRenames:items=>{pending=structuredClone(items);},
    receiveCoordinated:record=>{received.push(record);},readNote:async()=>responseAnchor(h.request.id),isOpen:()=>true,updateNote:async()=>{throw Error('Relocation must not write a device document.');},
    access:async()=>{throw Error('No redispatch or T3 read is needed for relocation.');},
  },async()=>({files:{read:h.remote.read,write:async(path,value)=>{if(offline)throw Error('offline');await h.remote.write(path,value);}},close:()=>{}}),h.now,h.now,async()=>{await new Promise(resolve=>setImmediate(resolve));});
  const first=make(h.actor);
  first.discover([h.request.host]);for(let i=0;i<32;i++)await new Promise(resolve=>setImmediate(resolve));
  first.renamed('Note.md','Renamed.md');first.renamed('Renamed.md','Folder/Final.md');
  for(let i=0;i<16;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(pending.length,2);const identities=pending.map(item=>item.id);first.dispose();
  offline=false;const restarted=make(randomUUID());
  try{for(let i=0;i<80;i++){restarted.tick();await new Promise(resolve=>setImmediate(resolve));}
    assert.equal(pending.length,0);assert.equal(h.record().state?.notePath,'Folder/Final.md');
    assert.deepEqual(h.record().relocations,[{before:'Note.md',after:'Renamed.md'},{before:'Renamed.md',after:'Folder/Final.md'}]);
    assert.ok(identities.every(id=>h.data.has(leasePaths(h.request.host.directory,id).reply)));
    assert.equal(h.record().request.messageId,h.request.messageId);assert.ok(received.length);
  }finally{restarted.dispose();}
});

test('a canceled response rejects a persisted rename without relocating or retrying it after reload',async()=>{
  const h=harness();h.request.nativeProjection=true;
  await h.client().command({kind:'register',jobId:h.request.id,request:h.request});await h.authority().migrated(h.request.id);
  await h.client().command({kind:'stop',jobId:h.request.id});
  let pending:import('../leased-inline').PendingResponseRename[]=[{id:randomUUID(),actor:h.actor,bindingId:h.request.id,host:h.request.host,before:'Note.md',after:'Renamed.md'}];
  const commandId=pending[0].id;
  const manager=new DeviceInlineManager(randomUUID(),h.request.vaultId,{
    loadRenames:()=>structuredClone(pending),saveRenames:items=>{pending=structuredClone(items);},
    receiveCoordinated:()=>{},readNote:async()=>responseAnchor(h.request.id),isOpen:()=>true,updateNote:async()=>{throw Error('Cancellation must not relocate a device document.');},access:async()=>{throw Error('Cancellation must not redispatch.');},
  },async()=>({files:h.remote,close:()=>{}}),h.now,h.now,async()=>{await new Promise(resolve=>setImmediate(resolve));});
  try{
    for(let i=0;i<80;i++){manager.tick();await new Promise(resolve=>setImmediate(resolve));}
    assert.equal(pending.length,0);assert.equal(h.record().state?.notePath??h.record().request.notePath,'Note.md');assert.equal(h.record().relocations,undefined);
    const reply=JSON.parse(h.data.get(leasePaths(h.request.host.directory,commandId).reply)!);assert.equal(reply.ok,false);assert.match(reply.error,/canceled/);
    manager.renamed('Note.md','Later.md');assert.equal(pending.length,0);
  }finally{manager.dispose();}
});
