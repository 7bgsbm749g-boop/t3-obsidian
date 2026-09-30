import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {InlineLeaseAuthority,InlineLeaseClient,LEASE_MS,leasePaths,type LeaseFiles,type LeaseRecord} from '../inline-lease';
import {hostedPaths,hostedRequestHash,type HostedInlineRequest,type HostedInlineState} from '../hosted-inline';
import {initialRegion} from '../inline-thread';
import {DeviceInlineManager} from '../leased-inline';

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
  return {actor,request,region,files,remote,data,client,record,state,now:()=>time,advance:(ms:number)=>{time+=ms;},restart:()=>{authority.stop();authority=new InlineLeaseAuthority(identity,files,()=>time);return authority.tick();}};
}

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

function devices(){
  const h=harness(),managers:DeviceInlineManager[]=[];
  let answer='First paragraph',complete=false;
  const snapshot=()=>({thread:{id:h.request.threadId,projectId:h.request.projectId,messages:[
    {id:h.request.messageId,role:'user',text:'Question',streaming:false,createdAt:h.request.createdAt},
    {id:'answer',role:'assistant',text:answer,streaming:!complete,turnId:'turn'}],activities:[],latestTurn:{turnId:'turn',state:complete?'completed':'running',requestedAt:h.request.createdAt,assistantMessageId:'answer'},session:{status:complete?'ready':'running',activeTurnId:complete?null:'turn'}}});
  const create=(actor:string)=>{
    const document={value:'Outside before\n'+h.region.text+'Outside after',writes:0,saved:true,hold:undefined as (()=>Promise<void>)|undefined};
    const manager=new DeviceInlineManager(actor,h.request.vaultId,{
      access:async()=>({origin:'https://unused.example',api:async path=>{if(path.includes('websocket-ticket'))throw Error('REST fallback fixture');return snapshot();}}),
      isOpen:()=>true,isSaved:async()=>document.saved,readNote:async()=>document.value,
      updateNote:async(_path,change,allowed)=>{assert.equal(allowed(),true);const next=change(document.value);if(next!==document.value){await document.hold?.();if(!allowed())throw Error('Expired write');document.writes++;document.value=next;}return next;},
    },async()=>({files:h.remote,close:()=>{}}),h.now,h.now);
    managers.push(manager);return {document,manager};
  };
  const drain=async(...active:DeviceInlineManager[])=>{for(let n=0;n<12;n++){for(const manager of active)manager.tick();await new Promise(resolve=>setImmediate(resolve));}};
  return {...h,create,drain,answer:(text:string,done=false)=>{answer=text;complete=done;},dispose:()=>managers.forEach(manager=>manager.dispose())};
}

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

test('a genuine edit inside the response survives takeover and pauses that editor',async()=>{
  const h=devices(),phone=h.create(h.actor),laptop=h.create(randomUUID());
  try{
    await phone.manager.register(h.request);await h.drain(phone.manager);
    laptop.document.value=phone.document.value.replace('First paragraph','My own correction');
    laptop.manager.discover([h.request.host]);await h.drain(laptop.manager);
    h.advance(LEASE_MS+1);h.answer('New answer');await h.drain(laptop.manager);h.advance(200);await h.drain(laptop.manager);
    assert.equal(h.record().state?.status,'paused');assert.match(laptop.document.value,/My own correction/);assert.doesNotMatch(laptop.document.value,/New answer/);
    assert.deepEqual(JSON.parse(h.data.get(leasePaths(h.request.host.directory,h.request.id).catalog)!),[],'A paused editor is not a device takeover job');
    h.advance(LEASE_MS);assert.equal((await h.client(randomUUID()).command({kind:'claim',jobId:h.request.id})).ok,false);
  }finally{h.dispose();}
});

test('undoing an edited or deleted response marker to a known body resumes the same open editor',async()=>{
  for(const damage of [(text:string)=>text.replace('First paragraph','My correction'),(text:string)=>text.replace(`<!-- t3-inline:start:`, '<!-- removed:start:')]){
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
    assert.match(phone.document.value,/Final before save/);assert.doesNotMatch(phone.document.value,/t3-inline:/);
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
