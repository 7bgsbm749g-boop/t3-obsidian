import {test} from 'node:test';
import assert from 'node:assert/strict';
import {nativeCommitPath,readNativeCommitProof,nativeCommitMatches} from '../native-response-commit';
import {nativeResponses} from '../native-response-manager';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {CoordinatedHost} from '../coordinated-host-desktop';
import {InlineLeaseAuthority,InlineLeaseClient,leasePaths,COORDINATED_OWNER,type LeaseFiles} from '../inline-lease';
import {HostedInlineWriter,hostedRequestHash,hostedPaths,type HostedInlineRequest,type HostedWriterIO} from '../hosted-inline';
import {initialRegion} from '../inline-thread';
import {responseAnchor,responseRegion} from '../native-response-projection';
import {contentHash} from '../completion';
import {streamBlock,streamBlocks} from '../stream-block';
import {DeviceResponseCompletion,type DeviceGeneration} from '../device-response-completion';
import {LeaseRecordCache} from '../lease-record-cache';

async function setup(native=true,liveLease=false,collapse=false,device=false){
  const root=await mkdtemp(join(tmpdir(),'coordinated-production-')),vault=join(root,'vault');await import('node:fs/promises').then(fs=>fs.mkdir(vault));
  const identity={vaultId:randomUUID(),environmentId:'host',workspaceRoot:vault,directory:'.obsidian/t3-code/inline/v1'},id=randomUUID(),actor=randomUUID(),initial=initialRegion(id);
  const request:HostedInlineRequest={version:2,nativeProjection:native,independent:true,id,initialOwner:actor,vaultId:identity.vaultId,host:identity,notePath:'Note.md',threadId:'thread',messageId:randomUUID(),projectId:'project',threadEnvironmentId:'host',initialHash:initial.bodyHash,createdAt:'2026-10-03T00:00:00Z',...(collapse?{intermediateMode:'collapse'}:{})};
  const file={path:'Note.md'},notes=new Map([['Note.md',`# Exercise\n\n| Exercise | 20kg |\n| --- | ---: |\n| Barb | 20 |\n\n${native?responseAnchor(id):initial.text}\n\nTail\n`]]),storage=new Map<string,string>();let writes=0;
  const files:LeaseFiles={read:async path=>storage.get(path),write:async(path,value)=>{storage.set(path,value);},remove:async path=>{storage.delete(path);},list:async directory=>[...storage.keys()].filter(path=>path.startsWith(directory+'/'))};
  const authority=new InlineLeaseAuthority(identity,files),remote={...files,read:async(path:string)=>{if(path.includes('/replies/'))await authority.tick();return files.read(path);}};
  const client=new InlineLeaseClient(actor,remote,identity.directory,undefined,undefined,async()=>{await authority.tick();});
  const extraFiles=new Map<string,{path:string}>();
  const getFile=(path:string)=>{if(path===file.path)return file;if(!notes.has(path))return undefined;let extra=extraFiles.get(path);if(!extra){extra={path};extraFiles.set(path,extra);}return extra;};
  const app:any={workspace:{getLeavesOfType:()=>[]},vault:{getFileByPath:getFile,getMarkdownFiles:()=>[...notes.keys()].map(getFile),read:async(target:any)=>notes.get(target.path),process:async(target:any,change:any)=>{const next=change(notes.get(target.path));notes.set(target.path,next);writes++;return next;}},saveLocalStorage:()=>{}};
  const original=notes.get('Note.md')!;
  if(device){request.version=4;request.deviceCompletion={version:1,actor,originalHash:contentHash(original)};}
  await client.command({kind:'register',jobId:id,request,...(device?{original}:{})});
  if(!native){const record=JSON.parse(storage.get(leasePaths(identity.directory,id).record)!);record.state={requestHash:hostedRequestHash(request),accepted:true,notePath:file.path,status:'running',hashes:[initial.bodyHash],updatedAt:'',bindingCheckpoint:{bindings:{[request.messageId]:{turnId:'turn',kind:'start'}}},incoming:[{messageId:randomUUID(),text:'Keep data',label:'You · Author',before:[]}]};record.expiresAt=liveLease?Date.now()+25:Date.now()-3000;storage.set(leasePaths(identity.directory,id).record,JSON.stringify(record));}
  const host=await CoordinatedHost.open(app,identity,files,authority,{journalRoot:join(root,'journal')});await host.scan();
  let completed=false;
  const snapshot=()=>({thread:{id:'thread',projectId:'project',messages:[{id:request.messageId,role:'user',streaming:false,text:'Add 25kg',createdAt:request.createdAt},{id:'answer',role:'assistant',text:completed?'Added **25kg**.':'Still working.',turnId:'turn',streaming:!completed}],activities:[],latestTurn:{turnId:'turn',messageId:request.messageId,state:completed?'completed':'running',requestedAt:request.createdAt,assistantMessageId:'answer'},session:{status:completed?'ready':'running',activeTurnId:completed?null:'turn'}}});
  const base:HostedWriterIO={...files,requests:async()=>[],access:async()=>({origin:'https://fixture',api:async()=>snapshot()}),updateNote:async()=>{throw Error('Legacy direct writes are forbidden in this fixture');}};
  const writer=new HostedInlineWriter(identity,host.io(base));
  return {root,app,identity,base,host,authority,client,files,storage,request,id,notes,file,writer,complete:()=>{completed=true;},writes:()=>writes,close:async()=>{writer.stop();host.stop();authority.stop();client.dispose();await rm(root,{recursive:true,force:true});}};
}

test('import-info returns compact exact bindings from a large lease without writing the lease, journal or note',async()=>{
 const h=await setup();try{
  await h.writer.tick();const path=leasePaths(h.identity.directory,h.id).record,record=JSON.parse((await h.files.read(path))!);
  record.state.body='Large response'.repeat(130000);
  record.state.bindingCheckpoint={bindings:{[h.request.messageId]:{turnId:'turn',kind:'explicit'}},turns:{turn:{turnId:'turn',messageId:h.request.messageId,state:'completed'}},inputBoundaries:{input:[{text:record.state.body}]}};
  const bytes=JSON.stringify(record);await h.files.write(path,bytes);const note=h.notes.get('Note.md'),journal=JSON.stringify(await h.host.journal.read(h.id)),writes=h.writes();
  const result:any=await h.host.command('response-import-info',h.id);
  assert.ok(JSON.stringify(result).length<5000);assert.equal(result.importRecord.state.bindingCheckpoint.turns.turn.messageId,h.request.messageId);
  assert.equal(result.importRecord.state.body,undefined);assert.equal(result.importRecord.state.bindingCheckpoint.inputBoundaries,undefined);
  const page:any=await h.host.command('response-import-records',randomUUID(),undefined,undefined,{version:1,id:randomUUID(),kind:'response-import-records',source:{threadId:h.request.threadId,projectId:h.request.projectId,environmentId:h.request.threadEnvironmentId}});
  assert.equal(page.importRecords.length,1);assert.equal(page.importRecords[0].request.id,h.id);assert.ok(JSON.stringify(page).length<5000);
  assert.equal(await h.files.read(path),bytes);assert.equal(h.notes.get('Note.md'),note);assert.equal(h.writes(),writes);assert.equal(JSON.stringify(await h.host.journal.read(h.id)),journal);
  await assert.rejects(h.host.command('response-import-info','../wrong'),/binding UUID/);
 }finally{await h.close();}
});

test('negotiated host keeps a final result private while the sender saves with Sync disconnected',async()=>{
 const h=await setup(true,false,false,true);try{
  const original=h.notes.get('Note.md')!;h.notes.delete('Note.md');
  await h.writer.tick();let record=JSON.parse((await h.files.read(leasePaths(h.identity.directory,h.id).record))!);
  assert.equal(record.migrating,false);assert.equal(record.state.accepted,true);assert.equal(h.writes(),0);
  h.complete();await h.writer.tick();record=JSON.parse((await h.files.read(leasePaths(h.identity.directory,h.id).record))!);
  assert.match(record.state.finalBody,/Added/);assert.equal(record.state.finalSaved,undefined);assert.equal(h.writes(),0);
  const reserve=await h.client.command({kind:'reserve-final',jobId:h.id,final:{messageId:h.request.messageId,turnId:'turn',sequence:10,body:record.state.finalBody,phase:'complete'}});assert.equal(reserve.ok,true);
  let local=original+'Sender outside edit\n',localWrites=0;const journals=new Map<string,DeviceGeneration>();
  const completion=new DeviceResponseCompletion(h.request.deviceCompletion!.actor,{read:async id=>structuredClone(journals.get(id)),write:async(id,value)=>{journals.set(id,structuredClone(value));}},{read:async()=>local,compareAndSet:async(_path,before,after)=>{if(local!==before)return false;local=after;localWrites++;return true;}},()=>{});
  const proof=await completion.complete(reserve.record!,original,undefined,async proof=>{const prepared=await h.client.command({kind:'prepare-final',jobId:h.id,token:reserve.record!.finalWriter!.token,proof});assert.equal(prepared.ok,true,prepared.error);assert.equal(h.writes(),0);const planned=await h.host.eventContent('Note.md',proof.document);assert.ok(!planned.includes('Added **25kg**.'));});assert.ok(proof);assert.equal(localWrites,1);assert.match(local,/Sender outside edit/);assert.doesNotMatch(local,/t3-inline:/);
  assert.equal((await h.client.command({kind:'commit-final',jobId:h.id,token:reserve.record!.finalWriter!.token,proof})).ok,true);
  await h.host.scan();await h.writer.tick();assert.equal(h.writes(),0);assert.equal(h.notes.has('Note.md'),false);
  const retained=(await h.host.journal.read(h.id))!;assert.equal(retained.status,'verified');assert.equal(retained.deviceProof!.hash,proof.hash);
  h.notes.set('Note.md',local);await h.host.scan();assert.equal(h.writes(),0);
 }finally{await h.close();}
});

test('negotiated host still completes after the sender closes before taking a final grant',async()=>{
 const h=await setup(true,false,false,true);try{
  await h.writer.tick();const path=leasePaths(h.identity.directory,h.id).record,record=JSON.parse((await h.files.read(path))!);record.presenceUntil=Date.now()-1;record.revision++;await h.files.write(path,JSON.stringify(record));
  await h.host.scan();h.complete();await h.writer.tick();await h.host.scan();
  const final=JSON.parse((await h.files.read(path))!);assert.equal(final.finalWriter.actor,COORDINATED_OWNER);assert.equal(final.state.finalSaved,true);assert.equal(final.state.cleanupComplete,true);assert.equal(h.writes(),1);assert.match(h.notes.get('Note.md')!,/Added/);
  const late=await h.client.command({kind:'reserve-final',jobId:h.id,final:{messageId:h.request.messageId,turnId:'turn',sequence:99,body:'Late duplicate',phase:'complete'}});assert.equal(late.ok,false);assert.equal(h.writes(),1);
 }finally{await h.close();}
});

test('negotiated early Stop removes the response without waiting for the sender presence timeout',async()=>{
 const h=await setup(true,false,false,true);try{
  await h.client.command({kind:'stop',jobId:h.id,discardResponse:true});await h.host.scan();await h.writer.tick();await h.host.scan();
  const record=JSON.parse((await h.files.read(leasePaths(h.identity.directory,h.id).record))!);assert.equal(record.state.cleanupComplete,true);assert.equal(record.state.finalPhase,'interrupted');assert.equal(h.writes(),1);assert.doesNotMatch(h.notes.get('Note.md')!,/t3-inline:/);
 }finally{await h.close();}
});

test('legacy discovery excludes known native requests and retains unknown paths',async()=>{
 const h=await setup();try{
  const native=hostedPaths(h.identity.directory,h.id).request,unknown=hostedPaths(h.identity.directory,randomUUID()).request;
  assert.deepEqual(h.host.legacyRequests([native,unknown]),[unknown]);
  const id=randomUUID(),request={...h.request,id,version:1 as const};
  h.storage.set(leasePaths(h.identity.directory,id).record,JSON.stringify({request,owner:COORDINATED_OWNER,coordinated:true,epoch:1,revision:0,expiresAt:Number.MAX_SAFE_INTEGER}));
  await h.host.scan();const legacy=hostedPaths(h.identity.directory,id).request;
  assert.deepEqual(h.host.legacyRequests([native,legacy,unknown]),[legacy,unknown]);
 }finally{await h.close();}
});

test('a failed checked final save waits between retries and then saves current outside text',async()=>{
 const h=await setup();let writer:HostedInlineWriter|undefined;
 try{
  let clock=0,attempts=0,allow=false;
  const io=h.host.io(h.base),commit=io.commitFinal!;
  io.monotonic=()=>clock;
  io.commitFinal=async(...args)=>{attempts++;return allow?commit(...args):false;};
  writer=new HostedInlineWriter(h.identity,io);h.complete();
  await writer.tick();assert.equal(attempts,1);
  const journal=await h.host.journal.read(h.id),before=h.notes.get('Note.md')!;
  for(let i=0;i<20;i++)await writer.tick();
  assert.equal(attempts,1,'unchanged failed saves must not rebuild on every tick');
  assert.equal((await h.host.journal.read(h.id))!.journalRevision,journal!.journalRevision);
  h.notes.set('Note.md',before+'New ordinary text\n');allow=true;clock=4999;
  await writer.tick();assert.equal(attempts,1);
  clock=5000;await writer.tick();assert.equal(attempts,2);
  assert.match(h.notes.get('Note.md')!,/Added \*\*25kg\*\*/);
  assert.ok(h.notes.get('Note.md')!.endsWith('New ordinary text\n'));
  assert.equal(JSON.parse((await h.files.read(leasePaths(h.identity.directory,h.id).record))!).state.finalSaved,true);
 }finally{writer?.stop();await h.close();}
});

test('failed stopped saves wait after servicing each explicit Stop and retain current outside text',async()=>{
 const h=await setup();let writer:HostedInlineWriter|undefined;
 try{
  await h.writer.tick();let clock=0,attempts=0,allow=false;
  const io=h.host.io(h.base),commit=io.commitFinal!;io.monotonic=()=>clock;
  io.commitFinal=async(...args)=>{attempts++;return allow?commit(...args):false;};
  writer=new HostedInlineWriter(h.identity,io);writer.requestStop(h.id);await writer.tick();
  assert.equal(attempts,1);const before=h.notes.get('Note.md')!;
  for(let i=0;i<20;i++)await writer.tick();assert.equal(attempts,1,'a retained Stop must not permanently bypass retry waits');
  clock=4999;await writer.tick();assert.equal(attempts,1);
  writer.requestStop(h.id);await writer.tick();assert.equal(attempts,2,'a new explicit Stop takes priority');
  for(let i=0;i<20;i++)await writer.tick();assert.equal(attempts,2);
  h.notes.set('Note.md',before+'New ordinary stop suffix\n');allow=true;clock=9999;await writer.tick();
  assert.equal(attempts,3);assert.ok(h.notes.get('Note.md')!.endsWith('New ordinary stop suffix\n'));
  const state=JSON.parse((await h.files.read(leasePaths(h.identity.directory,h.id).record))!).state;
  assert.equal(state.status,'interrupted');assert.equal(state.finalSaved,true);assert.equal(state.cleanupComplete,true);
 }finally{writer?.stop();await h.close();}
});

test('history close uses a completed lease and publishes a shortened immutable delivery proof',async()=>{
 const h=await setup(true,false,true);try{
  await h.writer.tick();h.complete();await h.writer.tick();await h.host.scan();
  let historicalReads=0;const idleIO=h.host.io({...h.base,read:async path=>{historicalReads++;return h.base.read(path);}}),idleWriter=new HostedInlineWriter(h.identity,idleIO);
  try{for(let i=0;i<10;i++)await idleWriter.tick();assert.equal(historicalReads,0,'completed history must not repeatedly enter the reply writer');}finally{idleWriter.stop();}
  const before=h.notes.get('Note.md')!,block=streamBlocks(before)[0],old=JSON.parse((await h.files.read(leasePaths(h.identity.directory,h.id).record))!);
  assert.ok(block?.complete);h.notes.set('Note.md',before+'Unrelated late text\n');
  const response:any=await h.host.command('close-stream-block',block.key,contentHash(block.text),'Note.md');assert.equal(response.closed,true);
  const after=h.notes.get('Note.md')!,record=JSON.parse((await h.files.read(leasePaths(h.identity.directory,h.id).record))!);
  assert.ok(after.includes('Added **25kg**.'));assert.ok(after.endsWith('Unrelated late text\n'));assert.ok(!after.includes('[!t3-progress]'));assert.equal(record.state.status,'complete');assert.notEqual(record.state.delivery.commitId,old.state.delivery.commitId);
  const bytes=(await h.files.read(nativeCommitPath(h.identity.directory,h.id,record.state.delivery.commitId)))!,proof=readNativeCommitProof(bytes,h.id,record.state.delivery);
  assert.ok(nativeCommitMatches(proof,after));assert.equal(nativeCommitMatches(proof,after.replace('Added **25kg**.','Changed final')),false);
  const writes=h.writes();await h.host.command('close-stream-block',block.key,contentHash(block.text),'Note.md');assert.equal(h.writes(),writes);
  await h.host.scan();assert.equal((await h.host.journal.read(h.id))!.status,'verified');
 }finally{await h.close();}
});

test('production host streams only to journal, stages a table and commits the result in one save with real acknowledgements',async()=>{
 const h=await setup();try{
  await h.writer.tick();const before=h.notes.get('Note.md')!;assert.ok(!before.includes('Still working'));
  const stage:any=await h.host.command('stage-note-edit',h.id);assert.ok(!stage.stagingPath.startsWith(join(h.root,'vault')));
  const staged=(await readFile(stage.stagingPath,'utf8')).replace('| Exercise | 20kg |','| Exercise | 20kg | 25kg |').replace('| --- | ---: |','| --- | ---: | ---: |').replace('| Barb | 20 |','| Barb | 20 | |');
  await writeFile(stage.stagingPath,staged);await h.host.command('submit-note-edit',h.id,stage.originalHash);
  h.notes.set('Note.md',before+'Ordinary edit\n');h.complete();await h.writer.tick();
  const saved=h.notes.get('Note.md')!,journal=await h.host.journal.read(h.id),record=JSON.parse((await h.files.read(leasePaths(h.request.host.directory,h.id).record))!);
  assert.equal(h.writes(),1,JSON.stringify({record,journal}));assert.ok(saved.includes('| Barb | 20 | |'));assert.ok(saved.includes('Added **25kg**.'));assert.ok(saved.endsWith('Ordinary edit\n'));assert.ok(!saved.includes('t3-inline:'));assert.equal(journal!.status,'verified');assert.equal(record.state.cleanupComplete,true);assert.deepEqual(record.state.delivery.observedBy,[]);
  const proofPath=nativeCommitPath(h.request.host.directory,h.id,record.state.delivery.commitId),proofBytes=(await h.files.read(proofPath))!;
  const proof=readNativeCommitProof(proofBytes,h.id,record.state.delivery);
  assert.ok(nativeCommitMatches(proof,saved.replace('Ordinary edit','Later ordinary edit')));
  assert.equal(nativeCommitMatches(proof,saved.replace('Added **25kg**.','Different answer')),false);
  assert.equal(nativeCommitMatches(proof,saved.replace('25kg','30kg')),false,'staged result ranges are protected too');
  const ack=await h.client.command({kind:'observe',jobId:h.id,observed:{commitId:journal!.verified!.commitId,hash:contentHash(saved)}});assert.equal(ack.ok,true);await h.host.scan();assert.equal((await h.host.journal.read(h.id))!.acknowledgements.length,1);
  assert.equal((await h.client.command({kind:'claim',jobId:h.id})).ok,false);
 }finally{await h.close();}
});

for(const reordered of [false,true])test(`unchanged live snapshots retain the durable cursor and journal${reordered?' across reordered JSON fields':''}`,async()=>{
 const h=await setup();try{
  let sequence=100,text='Stable live response';
  h.base.threadState=async()=>({sequence,messages:[{id:h.request.messageId,role:'user',text:'Add 25kg',createdAt:h.request.createdAt,turnId:null,streaming:false},{id:'answer',role:'assistant',text,turnId:'turn',streaming:true}],activities:[],latestTurn:{turnId:'turn',messageId:h.request.messageId,state:'running',requestedAt:h.request.createdAt,assistantMessageId:'answer'},session:{status:'running',activeTurnId:'turn'}});
  // Install the changed IO before constructing a writer, as production does.
  const io=h.host.io(h.base),read=io.read.bind(io);
  if(reordered){
   const reverseKeys=(value:any):any=>Array.isArray(value)?value.map(reverseKeys):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).reverse().map(([key,item])=>[key,reverseKeys(item)])):value;
   io.read=async path=>{const text=await read(path);return text&&path.includes('/states/')?JSON.stringify(reverseKeys(JSON.parse(text))):text;};
  }
  const writer=new HostedInlineWriter(h.identity,io);
  try{
   await writer.tick();
   const first=(await h.host.journal.read(h.id))!,lease=await h.files.read(leasePaths(h.identity.directory,h.id).record);
   for(let i=0;i<20;i++){sequence++;await writer.tick();}
   const unchanged=(await h.host.journal.read(h.id))!;
   assert.equal(unchanged.journalRevision,first.journalRevision);
   assert.equal(await h.files.read(leasePaths(h.identity.directory,h.id).record),lease);
   assert.equal(unchanged.checkpoint?.bindingCheckpoint?.sequence,100,'restart must replay from the earlier durable cursor');
   assert.equal(unchanged.checkpoint?.bindingCheckpoint?.bindings?.[h.request.messageId]?.sequence,100,'the inferred association must not be stamped again with each global snapshot');
   text='Meaningful new progress';await writer.tick();
   const changed=(await h.host.journal.read(h.id))!;
   assert.ok(changed.journalRevision!>first.journalRevision!);
   assert.equal(changed.checkpoint?.bindingCheckpoint?.sequence,sequence);
   assert.ok(changed.checkpoint?.body?.includes(text));
   assert.equal(h.writes(),0,'live progress must remain outside saved note bytes');
  }finally{writer.stop();}
 }finally{await h.close();}
});

test('an unchanged rejected final keeps its error and journal stable, then completes after a bounded retry',async()=>{
 const h=await setup();try{
  let reject=true,now=0,attempts=0;
  const io=h.host.io({...h.base,monotonic:()=>now}),commit=io.commitFinal!;
  io.commitFinal=async(...args)=>{attempts++;if(reject)throw Error('Retained final cannot be committed yet');return commit(...args);};
  const writer=new HostedInlineWriter(h.identity,io);
  try{
   h.complete();await writer.tick();
   const before=(await h.host.journal.read(h.id))!,lease=await h.files.read(leasePaths(h.identity.directory,h.id).record);
   await writer.tick();
   assert.equal((await h.host.journal.read(h.id))!.journalRevision,before.journalRevision);
   assert.equal(await h.files.read(leasePaths(h.identity.directory,h.id).record),lease);
   assert.equal(attempts,2);
   for(let i=0;i<20;i++){now+=100;await writer.tick();}
   assert.equal(attempts,2,'same failure must not retry every renderer tick');
   reject=false;now=5001;await writer.tick();
   const complete=JSON.parse((await h.files.read(leasePaths(h.identity.directory,h.id).record))!);
   assert.equal(complete.state.status,'complete');assert.equal(complete.state.cleanupComplete,true);
   assert.equal(complete.state.detail,undefined);assert.ok(h.notes.get('Note.md')!.includes('Added **25kg**.'));
  }finally{writer.stop();}
 }finally{await h.close();}
});

test('a structurally rejected final cannot consume a private history audit or alter the note',async()=>{
 const h=await setup();try{
  await h.writer.tick();
  const before=h.notes.get('Note.md'),state=JSON.parse((await h.files.read(leasePaths(h.identity.directory,h.id).record))!).state;
  const headChecks=h.host.journal.status().headChecks;
  await assert.rejects(h.host.io(h.base).commitFinal!(h.request,state,'Unsafe <!-- t3-inline:start:other -->'),/tracking boundaries/);
  assert.equal(state.status,'conflict');
  assert.equal(h.host.journal.status().headChecks,headChecks);assert.equal(h.notes.get('Note.md'),before);assert.equal(h.writes(),0);
 }finally{await h.close();}
});
test('a structurally rejected finished reply stops automatic retries and resumes only after an explicit command',async()=>{
 const h=await setup();let writer:HostedInlineWriter|undefined;
 try{
  let unsafe=true,accesses=0;
  const base={...h.base,access:async()=>{accesses++;return {origin:'https://fixture',api:async()=>({thread:{id:h.request.threadId,projectId:h.request.projectId,messages:[{id:h.request.messageId,role:'user',turnId:'turn',streaming:false,text:'Add 25kg'},{id:'answer',role:'assistant',turnId:'turn',streaming:false,text:unsafe?'Unsafe <!-- t3-inline:start:other -->':'Safe final answer'}],activities:[],latestTurn:{turnId:'turn',messageId:h.request.messageId,state:'completed',assistantMessageId:'answer'},session:{status:'ready',activeTurnId:null}}})};}};
  writer=new HostedInlineWriter(h.identity,h.host.io(base));const original=h.notes.get('Note.md');
  await writer.tick();const conflict=JSON.parse(h.storage.get(leasePaths(h.identity.directory,h.id).record)!);
  assert.equal(conflict.state.status,'conflict');assert.match(conflict.state.detail,/tracking boundaries/);assert.equal(h.notes.get('Note.md'),original);
  const calls=accesses,journal=await h.host.journal.read(h.id);for(let i=0;i<20;i++)await writer.tick();
  assert.equal(accesses,calls);assert.equal((await h.host.journal.read(h.id))!.journalRevision,journal!.journalRevision);
  unsafe=false;h.notes.set('Note.md',original+'New ordinary text\n');await h.host.command('resume-response',h.id);await writer.tick();
  const complete=JSON.parse(h.storage.get(leasePaths(h.identity.directory,h.id).record)!);
  assert.equal(complete.state.finalSaved,true);assert.equal(complete.state.cleanupComplete,true);assert.match(h.notes.get('Note.md')!,/Safe final answer/);assert.ok(h.notes.get('Note.md')!.endsWith('New ordinary text\n'));
 }finally{writer?.stop();await h.close();}
});

test('a durable journal conflict becomes a terminal writer conflict with its original reason preserved',async()=>{
 const h=await setup();try{
  await h.writer.tick();
  const journal=await h.host.journal.read(h.id);await h.host.coordinator.result(h.id,journal!.original,'Retained final reply');
  h.notes.set('Note.md',h.notes.get('Note.md')!.replace(responseAnchor(h.id),'User replacement'));
  const conflict=await h.host.coordinator.commit(h.id);assert.equal(conflict.status,'conflict');
  const io=h.host.io(h.base),state=JSON.parse(h.storage.get(leasePaths(h.identity.directory,h.id).record)!).state,before=h.notes.get('Note.md');
  assert.equal(await io.commitFinal!(h.request,state,'Retained final reply'),false);assert.equal(state.status,'conflict');assert.equal(state.detail,conflict.conflicts.at(-1)!.reason);
  await io.write(hostedPaths(h.identity.directory,h.id).state,JSON.stringify(state));assert.deepEqual(await io.requests(),[]);assert.equal(h.notes.get('Note.md'),before);assert.equal(h.writes(),0);
 }finally{await h.close();}
});
for(const side of ['before','after','both'] as const)test(`ordinary text touching the ${side} marker survives final host delivery`,async()=>{
 const h=await setup();try{
  await h.writer.tick();const anchor=responseAnchor(h.id),ordinary='User writing';
  h.notes.set('Note.md',h.notes.get('Note.md')!.replace(anchor,side==='before'?ordinary+anchor:side==='after'?anchor+ordinary:ordinary+anchor+ordinary));
  h.complete();await h.writer.tick();
  const lease=JSON.parse((await h.files.read(leasePaths(h.identity.directory,h.id).record))!);
  assert.equal(lease.state.cleanupComplete,true,JSON.stringify({lease,journal:await h.host.journal.read(h.id)}));
  assert.ok(h.notes.get('Note.md')!.includes(ordinary));assert.ok(h.notes.get('Note.md')!.includes('Added **25kg**.'));
  if(side==='both')assert.equal(h.notes.get('Note.md')!.split(ordinary).length,3);
 }finally{await h.close();}
});
test('legacy migration fences the old epoch before stripping and preserves exact run and incoming metadata',async()=>{
 const h=await setup(false);try{
  const record=JSON.parse((await h.files.read(leasePaths(h.request.host.directory,h.id).record))!);
  assert.equal(record.owner,COORDINATED_OWNER);assert.equal(record.epoch,2);assert.equal(record.migrating,false);assert.equal(record.state.incoming[0].label,'You · Author');assert.equal(record.state.bindingCheckpoint.bindings[h.request.messageId].turnId,'turn');assert.ok(h.notes.get('Note.md')!.includes(responseAnchor(h.id)));assert.ok(!h.notes.get('Note.md')!.includes('Working'));
  assert.equal((await h.client.command({kind:'heartbeat',jobId:h.id,epoch:1})).ok,false);
  await h.writer.tick();assert.ok(!h.notes.get('Note.md')!.includes('Still working'));
 }finally{await h.close();}
});
test('late competing text is preserved as a recoverable conflict and checked repair refuses changed review hashes',async()=>{
 const h=await setup();try{
  await h.writer.tick();const original=h.notes.get('Note.md')!;h.complete();await h.writer.tick();
  h.notes.set('Note.md',original);await h.host.scan();const conflict=await h.host.journal.read(h.id);assert.equal(conflict!.status,'conflict');assert.ok(conflict!.verified);assert.equal(h.notes.get('Note.md'),original);
  await assert.rejects(h.host.command('repair-response',h.id,'0'.repeat(64)),/changed/);
  const repaired:any=await h.host.command('repair-response',h.id,contentHash(original));assert.equal(repaired.generation.status,'verified');assert.ok(h.notes.get('Note.md')!.includes('Added **25kg**.'));
 }finally{await h.close();}
});

test('migration fences an unexpired cached grant and waits out its TTL before stripping note content',async()=>{
 const h=await setup(false,true);try{
  let record=JSON.parse((await h.files.read(leasePaths(h.request.host.directory,h.id).record))!);assert.equal(record.coordinated,true);assert.equal(record.migrating,true);assert.ok(h.notes.get('Note.md')!.includes('Working'));assert.equal(await h.host.journal.read(h.id),undefined);assert.equal((await h.client.command({kind:'heartbeat',jobId:h.id,epoch:1})).ok,false);
  await new Promise(resolve=>setTimeout(resolve,2050));await h.host.scan();record=JSON.parse((await h.files.read(leasePaths(h.request.host.directory,h.id).record))!);assert.equal(record.migrating,false);assert.ok(!h.notes.get('Note.md')!.includes('Working'));
 }finally{await h.close();}
});

test('native note rename preserves immutable registration and moves coordinated commits and verification to the new path',async()=>{
 const h=await setup();try{
  await h.writer.tick();const before=h.notes.get('Note.md')!;h.notes.delete('Note.md');h.file.path='Renamed.md';h.notes.set('Renamed.md',before);await h.host.renamed('Note.md','Renamed.md');h.complete();await h.writer.tick();
  const journal=await h.host.journal.read(h.id),record=JSON.parse((await h.files.read(leasePaths(h.request.host.directory,h.id).record))!);assert.equal(journal!.notePath,'Renamed.md');assert.equal(journal!.request.notePath,'Note.md');assert.equal(journal!.status,'verified');assert.equal(record.state.notePath,'Renamed.md');assert.ok(h.notes.get('Renamed.md')!.includes('Added **25kg**.'));
 }finally{await h.close();}
});

test('a pending rename cannot remove the only saved response anchor',async()=>{
 const h=await setup();try{
  await h.writer.tick();const original=h.notes.get('Note.md')!;
  await h.host.renamed('Note.md','Delayed.md');await h.host.scan();
  assert.equal(h.notes.get('Note.md'),original,'Sync has not supplied the destination yet');
  h.notes.set('Delayed.md',original);await h.host.scan();
  assert.equal(h.notes.get('Note.md'),original.replace(responseAnchor(h.id),''));
  assert.ok(h.notes.get('Delayed.md')!.includes(responseAnchor(h.id)));
 }finally{await h.close();}
});

test('a folder round trip with delayed files keeps the stream recoverable after restart',async()=>{
 const h=await setup();let restarted:CoordinatedHost|undefined;try{
  await h.writer.tick();const original=h.notes.get('Note.md')!;
  await h.host.renamed('Note.md','Moved/Note.md');
  await h.host.renamed('Moved','Returned');
  await h.host.renamed('Returned/Note.md','Note.md');
  assert.equal(h.notes.get('Note.md'),original);
  h.writer.stop();h.host.stop();
  restarted=await CoordinatedHost.open(h.app,h.identity,h.files,h.authority,{journalRoot:join(h.root,'journal')});await restarted.scan();
  const writer=new HostedInlineWriter(h.identity,restarted.io(h.base));h.complete();await writer.tick();writer.stop();
  assert.equal((await restarted.journal.read(h.id))!.status,'verified');
  assert.ok(h.notes.get('Note.md')!.includes('Added **25kg**.'));
 }finally{restarted?.stop();await h.close();}
});

test('active response repair restores a proven missing anchor and corrects its stale relocation trail',async()=>{
 const h=await setup();try{
  await h.writer.tick();const original=h.notes.get('Note.md')!;
  await h.authority.renameNative('Note.md','Missing.md');
  const key=leasePaths(h.identity.directory,h.id).record,lease=JSON.parse(h.storage.get(key)!);
  lease.state.notePath='Note.md';lease.state.status='paused';h.storage.set(key,JSON.stringify(lease));
  h.notes.set('Note.md',original.replace(responseAnchor(h.id),''));
  const hash=contentHash(h.notes.get('Note.md')!);
  await assert.rejects(h.host.command('repair-response',h.id,'0'.repeat(64)),/reviewed note changed/);
  assert.equal(h.writes(),0);
  const result:any=await h.host.command('repair-response',h.id,hash);
  assert.equal(result.restored,true);assert.equal(h.notes.get('Note.md'),original);
  assert.equal(await readFile(join(result.evidence,'before.md'),'utf8'),original.replace(responseAnchor(h.id),''));
  assert.deepEqual(JSON.parse(h.storage.get(key)!).relocations.at(-1),{before:'Missing.md',after:'Note.md'});
  h.complete();await h.writer.tick();assert.equal((await h.host.journal.read(h.id))!.status,'verified');
 }finally{await h.close();}
});

test('active repair preserves text typed inside the saved anchor as ordinary note text',async()=>{
 const h=await setup();try{
  await h.writer.tick();const anchor=responseAnchor(h.id);
  h.notes.set('Note.md',h.notes.get('Note.md')!.replace(anchor,anchor.replace('\n\n','its \n\n')));
  const before=h.notes.get('Note.md')!,result:any=await h.host.command('repair-response',h.id,contentHash(before));
  assert.equal(result.restored,true);assert.ok(h.notes.get('Note.md')!.includes(responseRegion(before,h.id)!.body+anchor));
  assert.equal(await readFile(join(result.evidence,'before.md'),'utf8'),before);
  h.complete();await h.writer.tick();assert.equal((await h.host.journal.read(h.id))!.status,'verified');
  assert.ok(h.notes.get('Note.md')!.includes('its '));assert.ok(h.notes.get('Note.md')!.includes('Added **25kg**.'));
 }finally{await h.close();}
});

test('repair preserves anchor text when the retained reply finishes before the recovery command',async()=>{
 const h=await setup();try{
  await h.writer.tick();const anchor=responseAnchor(h.id);
  h.notes.set('Note.md',h.notes.get('Note.md')!.replace(anchor,anchor.replace('\n\n','its \n\n')));
  h.complete();await h.writer.tick();
  assert.equal((await h.host.journal.read(h.id))!.status,'conflict');
  const before=h.notes.get('Note.md')!,result:any=await h.host.command('repair-response',h.id,contentHash(before));
  assert.equal(result.restored,true);assert.equal(result.generation.status,'verified');
  assert.equal(await readFile(join(result.evidence,'before.md'),'utf8'),before);
  assert.ok(h.notes.get('Note.md')!.includes('its '));assert.ok(h.notes.get('Note.md')!.includes('Added **25kg**.'));
  await h.writer.tick();const lease=JSON.parse(h.storage.get(leasePaths(h.identity.directory,h.id).record)!);
  assert.equal(lease.state.finalSaved,true);assert.equal(lease.state.cleanupComplete,true);
 }finally{await h.close();}
});

test('active repair refuses changed placement, canceled responses, and competing native buffers',async()=>{
 const h=await setup();try{
  await h.writer.tick();const original=h.notes.get('Note.md')!;
  h.notes.set('Note.md',original.replace(responseAnchor(h.id),'')+'Later writing');
  await assert.rejects(h.host.command('repair-response',h.id,contentHash(h.notes.get('Note.md')!)),/changed beyond/);
  assert.equal(h.writes(),0);
  h.notes.set('Note.md',original.replace(responseAnchor(h.id),''));
  const manager=nativeResponses(h.app),savedViews=manager.savedViews;
  manager.savedViews=()=>[{saved:()=>original+'Unsaved edit'}] as any;
  await assert.rejects(h.host.command('repair-response',h.id,contentHash(h.notes.get('Note.md')!)),/Save the note/);
  manager.savedViews=savedViews;assert.equal(h.writes(),0);
  await h.client.command({kind:'stop',jobId:h.id});
  await assert.rejects(h.host.command('repair-response',h.id,contentHash(h.notes.get('Note.md')!)),/saved or canceled/);
  assert.equal(h.writes(),0);
 }finally{await h.close();}
});

test('malformed historical paused mirror boundaries cannot block another coordinated commit',async()=>{
 const h=await setup();try{
  const old=randomUUID(),request={...h.request,id:old,nativeProjection:false};
  await h.client.command({kind:'register',jobId:old,request});const key=leasePaths(h.request.host.directory,old).record;
  const record=JSON.parse(h.storage.get(key)!);record.state={requestHash:hostedRequestHash(request),accepted:true,notePath:'Note.md',status:'paused',hashes:[],updatedAt:'',detail:'Restored boundary required'};h.storage.set(key,JSON.stringify(record));
  h.notes.set('Note.md',h.notes.get('Note.md')+'\n<!-- t3-inline:end:'+old+' -->\n');await h.host.scan();h.complete();await h.writer.tick();
  assert.equal((await h.host.journal.read(h.id))!.status,'verified');assert.ok(h.notes.get('Note.md')!.includes('Added **25kg**.'));assert.ok(h.notes.get('Note.md')!.includes('t3-inline:end:'+old));
 }finally{await h.close();}
});
test('one malformed lease file is isolated while independent response scanning and delivery continue',async()=>{
 const h=await setup();try{
  h.storage.set(leasePaths(h.request.host.directory,randomUUID()).record,'{ malformed');await h.host.scan();h.complete();await h.writer.tick();assert.equal((await h.host.journal.read(h.id))!.status,'verified');
 }finally{await h.close();}
});

test('a removed native binding without its anchor cannot block another reply in the same note',async()=>{
 const h=await setup();try{
  const old=randomUUID(),request={...h.request,id:old};
  h.notes.set('Note.md',h.notes.get('Note.md')+'\n'+responseAnchor(old));
  await h.client.command({kind:'register',jobId:old,request});await h.host.scan();
  await h.host.command('remove-response',old);h.notes.set('Note.md',h.notes.get('Note.md')!.replace(responseAnchor(old),''));
  await h.host.scan();assert.equal((await h.host.journal.read(old))!.status,'removed');
  h.complete();await h.writer.tick();assert.equal((await h.host.journal.read(h.id))!.status,'verified');assert.ok(h.notes.get('Note.md')!.includes('Added **25kg**.'));
 }finally{await h.close();}
});


test('restart verifies an already-landed native intent before locating removed anchors and propagates fenced completion',async()=>{
 const h=await setup();let restarted:CoordinatedHost|undefined;try{
  await h.writer.tick();const other=randomUUID(),request={...h.request,id:other,messageId:randomUUID()};
  h.notes.set('Note.md',h.notes.get('Note.md')+'\nIndependent registration\n'+responseAnchor(other)+'\n');
  await h.client.command({kind:'register',jobId:other,request});await h.host.scan();
  const process=h.app.vault.process;h.app.vault.process=async(...args:any[])=>{await process(...args);throw Error('Native materialization acknowledgement interrupted after save');};
  h.complete();await h.writer.tick();
  const pending=await h.host.journal.read(h.id);assert.equal(pending!.status,'commit-pending');assert.equal(pending!.attempt!.expected,h.notes.get('Note.md'));assert.equal(pending!.verified,undefined);
  h.writer.stop();h.host.stop();h.app.vault.process=process;
  restarted=await CoordinatedHost.open(h.app,h.identity,h.files,h.authority,{journalRoot:join(h.root,'journal')});await restarted.scan();
  const recovered=await restarted.journal.read(h.id),lease=JSON.parse((await h.files.read(leasePaths(h.identity.directory,h.id).record))!);
  assert.equal(recovered!.status,'verified');assert.equal(recovered!.verified!.commitId,pending!.attempt!.id);assert.equal(h.writes(),1);
  assert.equal(lease.state.status,'complete');assert.equal(lease.state.finalSaved,true);assert.equal(lease.state.cleanupComplete,true);assert.equal(lease.state.detail,undefined);
  assert.ok(h.notes.get('Note.md')!.includes(responseAnchor(other)));assert.deepEqual(lease.state.delivery.observedBy,[]);
  assert.equal((await h.client.command({kind:'observe',jobId:h.id,observed:{commitId:recovered!.verified!.commitId,hash:contentHash(h.notes.get('Note.md')!)}})).ok,true);
  await restarted.scan();assert.equal((await restarted.journal.read(h.id))!.acknowledgements.length,1);
  await restarted.scan();assert.equal(h.writes(),1);
 }finally{restarted?.stop();await h.close();}
});

test('completion recovery rejects a changed ownership revision instead of publishing stale state',async()=>{
 const h=await setup();try{
  const record=JSON.parse((await h.files.read(leasePaths(h.identity.directory,h.id).record))!);
  await h.authority.checkpoint(h.id,{requestHash:hostedRequestHash(h.request),accepted:true,notePath:'Note.md',status:'running',hashes:[],updatedAt:''});
  await assert.rejects(h.authority.checkpoint(h.id,record.state??{}, {epoch:record.epoch,revision:record.revision}),/ownership or revision changed/);
 }finally{await h.close();}
});


test('supported repair verifies a reviewed pending commit without treating it as a conflict',async()=>{
 const h=await setup();try{
  await h.writer.tick();const process=h.app.vault.process;h.app.vault.process=async(...args:any[])=>{await process(...args);throw Error('Lost native acknowledgement');};h.complete();await h.writer.tick();h.app.vault.process=process;
  const pending=await h.host.journal.read(h.id);assert.equal(pending!.status,'commit-pending');assert.deepEqual(pending!.conflicts,[]);
  await assert.rejects(h.host.command('repair-response',h.id,'0'.repeat(64)),/exact reviewed saved commit/);
  const result:any=await h.host.command('repair-response',h.id,contentHash(h.notes.get('Note.md')!));assert.equal(result.generation.status,'verified');assert.equal(h.writes(),1);
  const lease=JSON.parse((await h.files.read(leasePaths(h.identity.directory,h.id).record))!);assert.equal(lease.state.cleanupComplete,true);
 }finally{await h.close();}
});

test('unchanged active host scans authenticate recovery without copying the note',async()=>{
 const h=await setup();try{
  await h.writer.tick();const snapshot=await h.host.journal.inspect(h.id),before=h.host.journal.status(),note=h.notes.get('Note.md'),writes=h.writes();
  for(let n=0;n<20;n++)await h.host.scan();
  const after=h.host.journal.status();assert.ok(after.inspections-before.inspections>=40);assert.ok(after.headChecks>before.headChecks);assert.equal(after.mutableCopies,before.mutableCopies);
  assert.equal(await h.host.journal.inspect(h.id),snapshot);assert.equal(h.notes.get('Note.md'),note);assert.equal(h.writes(),writes);
  h.complete();await h.writer.tick();assert.equal((await h.host.journal.inspect(h.id))!.status,'verified');assert.match(h.notes.get('Note.md')!,/Added \*\*25kg\*\*/);
 }finally{await h.close();}
});

test('active delivery uses its catalog while completed journal checks require explicit maintenance',async t=>{
 const h=await setup();try{
  let clock=Date.now();t.mock.method(Date,'now',()=>clock);
  await h.writer.tick();const historical=new Set<string>();
  for(let n=0;n<9;n++){
   const id=randomUUID(),request={...h.request,id,notePath:`Historical-${n}.md`};historical.add(id);
   h.storage.set(leasePaths(h.identity.directory,id).record,JSON.stringify({request,coordinated:true,owner:COORDINATED_OWNER,epoch:1,revision:1,expiresAt:Number.MAX_SAFE_INTEGER,state:{requestHash:hostedRequestHash(request),accepted:true,status:'complete',finalSaved:true,cleanupComplete:true,finalPhase:'complete',finalBody:'Saved old answer',notePath:request.notePath,hashes:[],updatedAt:''}}));
  }
  let activeReads=0;
  const read=h.host.journal.read.bind(h.host.journal),inspect=h.host.journal.inspect.bind(h.host.journal),observed=new Set<string>();h.host.journal.inspect=async id=>{if(historical.has(id)){observed.add(id);return undefined;}activeReads++;return inspect(id);};
  (h.host as any).terminalDiscoveryComplete=false;
  await h.host.scan(true);assert.equal(observed.size,0,'completed history has no background audit');
  const before=activeReads;
  await h.host.scan(true);assert.equal(observed.size,0,'completed history stays inactive');
  assert.equal(activeReads,before,'unchanged active leases do not repeat private journal audits every timer tick');
  clock+=29_999;await h.host.scan(true);assert.equal(observed.size,0);
  clock++;
  await h.host.scan(true);assert.equal(observed.size,0,'elapsed time does not wake completed responses');
  await h.host.scan();assert.equal(observed.size,4,'explicit recovery checks four historical records');
  h.complete();await h.writer.tick();assert.equal((await read(h.id))!.status,'verified');assert.match(h.notes.get('Note.md')!,/Added \*\*25kg\*\*/);
  await h.host.scan();assert.ok(observed.size>=7,'explicit maintenance audits another bounded batch');
  const changed=[...historical][0],path=leasePaths(h.identity.directory,changed).record,record=JSON.parse(h.storage.get(path)!);
  record.revision++;h.storage.set(path,JSON.stringify(record));observed.clear();
  await h.host.scan(true);assert.equal(observed.size,0,'completed revisions do not restart background work');
  for(let n=0;n<3&&!observed.has(changed);n++)await h.host.scan();assert.ok(observed.has(changed),'explicit maintenance still checks current historical revisions');
 }finally{await h.close();}
});

test('unchanged oversized history uses fresh file versions without rereading or parsing bodies',async()=>{
 const h=await setup();try{
  await h.writer.tick();const historical:string[]=[];
  for(let n=0;n<24;n++){
   const id=randomUUID(),request={...h.request,id,notePath:`Historical-${n}.md`};historical.push(id);
   h.storage.set(leasePaths(h.identity.directory,id).record,JSON.stringify({request,coordinated:true,owner:COORDINATED_OWNER,epoch:1,revision:1,expiresAt:Number.MAX_SAFE_INTEGER,state:{requestHash:hostedRequestHash(request),accepted:true,status:'complete',body:'Retained history'.repeat(200),finalSaved:true,cleanupComplete:true,finalPhase:'complete',notePath:request.notePath,hashes:[],updatedAt:''}}));
  }
  // All historical snapshots exceed the decoded-text cache budget. Their
  // existing host records must still avoid reparsing on every live tick.
  (h.host as any).leaseCache=new LeaseRecordCache(100,1);
  h.files.version=async path=>{const raw=h.storage.get(path);return raw===undefined?undefined:contentHash(raw);};
  const read=h.files.read;let reads:string[]=[];h.files.read=async path=>{if(path.includes('/leases/'))reads.push(path);return read(path);};
  await h.host.scan();assert.ok(reads.length>=24);const parsed=h.host.leaseCacheStatus().parses;
  reads=[];for(let n=0;n<5;n++)await h.host.scan(true);
  assert.equal(reads.length,0);assert.equal(h.host.leaseCacheStatus().parses,parsed);assert.ok(h.host.leaseCacheStatus().versionHits>=5);
  const changed=historical[0],path=leasePaths(h.identity.directory,changed).record,record=JSON.parse(h.storage.get(path)!);record.revision++;record.state.body='New completed revision';h.storage.set(path,JSON.stringify(record));
  await h.host.scan(true);assert.equal(reads.length,0);await h.host.scan();assert.ok(reads.includes(path));
  assert.equal((h.host as any).records.get(changed).state.body,undefined);assert.equal((await (h.host as any).fullLease((h.host as any).records.get(changed))).state.body,'New completed revision');
  h.storage.delete(path);await h.host.scan();assert.equal((h.host as any).leaseVersions.has(path),false);
 }finally{await h.close();}
});

test('a lease replacement during discovery cannot authenticate the older decoded version',async()=>{
 const h=await setup();try{
  await h.writer.tick();const id=randomUUID(),path=leasePaths(h.identity.directory,id).record,request={...h.request,id,notePath:'Historical.md'};
  const record={request,coordinated:true,owner:COORDINATED_OWNER,epoch:1,revision:1,expiresAt:Number.MAX_SAFE_INTEGER,state:{requestHash:hostedRequestHash(request),accepted:true,status:'complete',body:'Before replacement',finalSaved:true,cleanupComplete:true,finalPhase:'complete',notePath:request.notePath,hashes:[],updatedAt:''}};
  h.storage.set(path,JSON.stringify(record));h.files.version=async value=>{const raw=h.storage.get(value);return raw===undefined?undefined:contentHash(raw);};
  const read=h.files.read;let replace=true;h.files.read=async value=>{const bytes=await read(value);if(value===path&&replace){replace=false;record.revision++;record.state.body='After replacement';h.storage.set(path,JSON.stringify(record));}return bytes;};
  await h.host.scan();assert.equal((h.host as any).leaseVersions.has(path),false);
  await h.host.scan();assert.equal((h.host as any).records.get(id).state.body,undefined);assert.equal((await (h.host as any).fullLease((h.host as any).records.get(id))).state.body,'After replacement');assert.equal((h.host as any).leaseVersions.has(path),true);
 }finally{await h.close();}
});

test('a completed record damaged during its lazy read does not block another response',async()=>{
 const h=await setup();try{
  await h.writer.tick();const id=randomUUID(),path=leasePaths(h.identity.directory,id).record,request={...h.request,id,notePath:'History.md'};
  h.storage.set(path,JSON.stringify({request,coordinated:true,owner:COORDINATED_OWNER,epoch:1,revision:1,expiresAt:Number.MAX_SAFE_INTEGER,state:{requestHash:hostedRequestHash(request),accepted:true,status:'complete',body:'Retained completed reply',finalSaved:true,cleanupComplete:true,notePath:request.notePath,hashes:[],updatedAt:''}}));
  const read=h.files.read;let reads=0;h.files.read=async value=>{if(value===path&&++reads===2)h.storage.set(path,'{');return read(value);};
  await h.host.scan();assert.equal(reads,2);assert.ok((h.host as any).failures.has(id));
  h.complete();await h.writer.tick();assert.equal((await h.host.journal.read(h.id))!.status,'verified');assert.ok(h.notes.get('Note.md')!.includes('Added **25kg**.'));assert.equal(h.storage.get(path),'{');
 }finally{await h.close();}
});

test('stream binding discovery shares verified oversized history while checking fresh identities',async()=>{
 const h=await setup();try{
  await h.writer.tick();const target={threadId:h.request.threadId,projectId:h.request.projectId,environmentId:h.request.threadEnvironmentId};
  const histories:Array<{id:string;path:string}>=[];
  for(let n=0;n<24;n++){
   const id=randomUUID(),request={...h.request,id,notePath:`History-${n}.md`,threadId:n%2?'other-thread':target.threadId};
   const record={request,coordinated:true,owner:COORDINATED_OWNER,epoch:1,revision:1,expiresAt:Number.MAX_SAFE_INTEGER,state:{requestHash:hostedRequestHash(request),accepted:true,status:'complete',body:'Retained reply'.repeat(2000),finalSaved:true,cleanupComplete:true,notePath:request.notePath,messageId:`message-${n}`,pendingMessageId:`pending-${n}`,steering:[{messageId:`steer-${n}`}],turnIds:[`earlier-${n}`],turnId:`turn-${n}`,questionFollows:[{requestId:`question-${n}`,replyTurnId:`answer-turn-${n}`,input:{messageId:`answer-${n}`}}],hashes:[],updatedAt:''}};
   const path=leasePaths(h.identity.directory,id).record;h.storage.set(path,JSON.stringify(record));histories.push({id,path});
  }
  (h.host as any).leaseCache=new LeaseRecordCache(100,1);
  h.files.version=async path=>{const raw=h.storage.get(path);return raw===undefined?undefined:contentHash(raw);};
  await h.host.scan();
  const read=h.files.read;let reads=0;h.files.read=async path=>{if(path.includes('/leases/'))reads++;return read(path);};
  const before=h.host.leaseCacheStatus(),note=h.notes.get('Note.md'),writes=h.writes();
  for(let n=0;n<8;n++){
   const result=await h.host.responseBindings(target);assert.equal(result.length,13);assert.ok(JSON.stringify(result).length<10_000);
   const first=result.find(binding=>binding.id===histories[0].id)!;
   assert.deepEqual(first.messageIds,[h.request.messageId,'message-0','pending-0','steer-0','async-answer:question-0','answer-0']);
   assert.deepEqual(first.turnIds,['earlier-0','turn-0','answer-turn-0']);
   first.messageIds.push('caller mutation');
  }
  assert.equal(reads,0);assert.equal(h.host.leaseCacheStatus().parses,before.parses);assert.equal(h.host.leaseCacheStatus().bindingQueries-before.bindingQueries,8);
  const changed=histories[0],record=JSON.parse(h.storage.get(changed.path)!);record.state.notePath='History-X.md';record.state.messageId='changed-0';h.storage.set(changed.path,JSON.stringify(record));
  const current=await h.host.responseBindings(target),binding=current.find(value=>value.id===changed.id)!;
  assert.equal(binding.path,'History-X.md');assert.ok(binding.messageIds.includes('changed-0'));assert.equal(reads,1,'changed bytes bypass the cached epoch and revision');
  h.storage.delete(changed.path);assert.ok(!(await h.host.responseBindings(target)).some(value=>value.id===changed.id));
  assert.equal(h.notes.get('Note.md'),note);assert.equal(h.writes(),writes);
 }finally{await h.close();}
});

test('stream binding discovery keeps fresh reads when storage cannot verify file identities',async()=>{
 const h=await setup();try{
  const target={threadId:h.request.threadId,projectId:h.request.projectId,environmentId:h.request.threadEnvironmentId},path=leasePaths(h.identity.directory,h.id).record;
  assert.equal((await h.host.responseBindings(target))[0].path,'Note.md');
  const record=JSON.parse(h.storage.get(path)!);record.request.notePath='Moved.md';h.storage.set(path,JSON.stringify(record));
  assert.equal((await h.host.responseBindings(target))[0].path,'Moved.md');
  assert.deepEqual(await h.host.responseBindings({...target,projectId:'another-project'}),[]);
  assert.deepEqual(await h.host.responseBindings({...target,environmentId:'another-machine'}),[]);
 }finally{await h.close();}
});

test('a stalled older response cannot gate newly registered responses or duplicate its worker',async()=>{
 const h=await setup();let release!:()=>void;let first:Promise<void>|undefined;
 try{
  const blocked=randomUUID(),old={...h.request,id:blocked,notePath:'Older.md'};
  h.notes.set(old.notePath,responseAnchor(blocked));await h.client.command({kind:'register',jobId:blocked,request:old});
  const read=h.host.journal.read.bind(h.host.journal);let calls=0,started!:()=>void;
  const entered=new Promise<void>(resolve=>{started=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
  h.host.journal.read=async id=>{if(id===blocked){calls++;started();await gate;}return read(id);};
  first=h.host.scan();await entered;
  const id=randomUUID(),fresh={...h.request,id,notePath:'Fresh.md'};
  h.notes.set(fresh.notePath,responseAnchor(id));await h.client.command({kind:'register',jobId:id,request:fresh});
  await h.host.scan();assert.equal(calls,1,'the stalled registration has only one serial worker');
  assert.equal((await read(id))!.status,'accepted');
  h.complete();await h.writer.tick();assert.equal((await read(id))!.status,'verified');
  assert.match(h.notes.get(fresh.notePath)!,/Added \*\*25kg\*\*/);
 }finally{release?.();await first;await h.close();}
});

test('mobile rename handoff waits for delayed Sync and retires the exact old-path resurrection',async()=>{
 const h=await setup();try{
  await h.writer.tick();const original=h.notes.get('Note.md')!;
  const relocated=await h.client.command({kind:'relocate',jobId:h.id,previousNotePath:'Note.md',notePath:'Mobile title.md'});assert.equal(relocated.ok,true);
  await h.host.scan();h.complete();await h.writer.tick();assert.equal((await h.host.journal.read(h.id))!.notePath,'Mobile title.md');
  assert.equal(h.notes.get('Note.md'),original,'the sole saved anchor survives until the destination arrives');assert.ok(!h.notes.has('Mobile title.md'));
  h.notes.set('Mobile title.md',original);h.notes.set('Note.md',original);await h.host.scan();await h.writer.tick();
  const record=JSON.parse((await h.files.read(leasePaths(h.identity.directory,h.id).record))!);
  assert.equal(record.state.status,'complete');assert.equal(record.state.finalSaved,true);assert.equal(record.state.cleanupComplete,true);
  assert.ok(h.notes.get('Mobile title.md')!.includes('Added **25kg**.'));assert.ok(!h.notes.get('Note.md')!.includes(h.id));
  assert.equal(await readFile(join(h.root,'journal',h.id,'stale-rename-preimages',contentHash('Note.md')+'.md'),'utf8'),original);
 }finally{await h.close();}
});
test('a completed native rename repairs only the exact stale anchor once, including delayed Sync after restart',async()=>{
 const h=await setup();let restarted:CoordinatedHost|undefined;try{
  await h.writer.tick();const original=h.notes.get('Note.md')!;h.complete();await h.writer.tick();
  const final=h.notes.get('Note.md')!;
  await h.client.command({kind:'relocate',jobId:h.id,previousNotePath:'Note.md',notePath:'Renamed.md'});
  await h.host.scan();assert.equal((await h.host.journal.read(h.id))!.pendingRename!.after,'Renamed.md');
  h.host.stop();h.writer.stop();restarted=await CoordinatedHost.open(h.app,h.identity,h.files,h.authority,{journalRoot:join(h.root,'journal')});
  h.notes.set('Renamed.md',original);await restarted.scan();
  assert.equal(h.notes.get('Renamed.md'),final);assert.equal(h.notes.get('Note.md'),final);
  assert.equal((await restarted.journal.read(h.id))!.pendingRename,undefined);
  assert.equal(await readFile(join(h.root,'journal',h.id,'completed-rename-preimages',contentHash('Renamed.md')+'.md'),'utf8'),original);
  h.notes.set('Renamed.md',original);await restarted.scan();
  assert.equal(h.notes.get('Renamed.md'),original,'a later undo is not silently repaired');
  assert.equal((await restarted.journal.read(h.id))!.status,'conflict');
 }finally{restarted?.stop();await h.close();}
});
test('completed rename recovery retains an explicitly closed history after restart',async()=>{
 const h=await setup(true,false,true);let restarted:CoordinatedHost|undefined;try{
  await h.writer.tick();const original=h.notes.get('Note.md')!;h.complete();await h.writer.tick();
  const block=streamBlocks(h.notes.get('Note.md')!)[0];
  await h.host.command('close-stream-block',block.key,contentHash(block.text),'Note.md');
  const shortened=h.notes.get('Note.md')!;
  await h.client.command({kind:'relocate',jobId:h.id,previousNotePath:'Note.md',notePath:'Renamed.md'});await h.host.scan();
  h.host.stop();h.writer.stop();restarted=await CoordinatedHost.open(h.app,h.identity,h.files,h.authority,{journalRoot:join(h.root,'journal')});
  h.notes.set('Renamed.md',original);await restarted.scan();
  assert.equal(h.notes.get('Renamed.md'),shortened);assert.ok(!shortened.includes('[!t3-progress]'));assert.ok(shortened.includes('Added **25kg**.'));
  assert.equal((await restarted.journal.read(h.id))!.status,'verified');
 }finally{restarted?.stop();await h.close();}
});
test('completed rename recovery preserves changed ordinary text as a conflict',async()=>{
 const h=await setup();try{
  await h.writer.tick();const original=h.notes.get('Note.md')!;h.complete();await h.writer.tick();
  const edited=original+'New user writing\n';h.notes.set('Renamed.md',edited);
  await h.client.command({kind:'relocate',jobId:h.id,previousNotePath:'Note.md',notePath:'Renamed.md'});await h.host.scan();
  assert.equal(h.notes.get('Renamed.md'),edited);assert.equal((await h.host.journal.read(h.id))!.status,'conflict');
  assert.equal((await h.host.journal.read(h.id))!.pendingRename,undefined);
 }finally{await h.close();}
});
test('copied destinations show paths, require a current review and recover the same completed T3 response after restart',async()=>{
 const h=await setup();let restarted:CoordinatedHost|undefined;try{
  await h.writer.tick();const original=h.notes.get('Note.md')!;h.notes.set('Copy.md',original);
  const {deviceNoteIO}=await import('../inline-note-io');deviceNoteIO(h.app).noteChanged('Copy.md');h.complete();await h.writer.tick();
  let lease=JSON.parse((await h.files.read(leasePaths(h.identity.directory,h.id).record))!);assert.equal(lease.state.status,'paused');assert.deepEqual(lease.state.locationConflict,['Copy.md','Note.md']);
  const stale:any=await h.host.command('response-status',h.id);h.notes.set('Copy.md',original+'Ordinary copied tail\n');
  await assert.rejects(h.host.command('resolve-response-location',h.id,stale.locationHash,'Copy.md'),/changed/);assert.equal(h.notes.get('Note.md'),original);
  h.writer.stop();h.host.stop();restarted=await CoordinatedHost.open(h.app,h.identity,h.files,h.authority,{journalRoot:join(h.root,'journal')});await restarted.scan();
  const review:any=await restarted.command('response-status',h.id);const recovery:any=await restarted.command('resolve-response-location',h.id,review.locationHash,'Copy.md');
  const writer=new HostedInlineWriter(h.identity,restarted.io(h.base));await writer.tick();writer.stop();
  lease=JSON.parse((await h.files.read(leasePaths(h.identity.directory,h.id).record))!);
  assert.equal(lease.request.id,h.id);assert.equal(lease.request.messageId,h.request.messageId);assert.equal(lease.state.status,'complete');assert.equal(lease.state.finalSaved,true);assert.equal(lease.state.cleanupComplete,true);assert.equal(lease.state.locationConflict,undefined);
  assert.ok(h.notes.get('Copy.md')!.includes('Added **25kg**.'));assert.ok(h.notes.get('Copy.md')!.includes('Ordinary copied tail'));assert.ok(!h.notes.get('Note.md')!.includes(h.id));
  assert.equal(await readFile(join(recovery.evidence,contentHash('Note.md')+'.md'),'utf8'),original);
 }finally{restarted?.stop();await h.close();}
});
test('a writer checkpoint read before a mobile rename cannot put the lease back at its old path',async()=>{
 const h=await setup();try{
  await h.writer.tick();const io=h.host.io(h.base),statePath=hostedPaths(h.identity.directory,h.id).state;const stale=(await io.read(statePath))!;
  await h.client.command({kind:'relocate',jobId:h.id,previousNotePath:'Note.md',notePath:'First.md'});
  await assert.rejects(io.write(statePath,stale),/revision changed/);
  await h.client.command({kind:'relocate',jobId:h.id,previousNotePath:'First.md',notePath:'Folder/Second.md'});await h.host.scan();
  const lease=JSON.parse((await h.files.read(leasePaths(h.identity.directory,h.id).record))!);assert.equal(lease.state.notePath,'Folder/Second.md');assert.equal(lease.request.notePath,'Note.md');
 }finally{await h.close();}
});

test('reviewed duplicate recovery normalizes a known legacy Working checkpoint and refuses edited text',async()=>{
 const h=await setup();try{
  await h.writer.tick();const original=h.notes.get('Note.md')!,legacy=original.replace(responseAnchor(h.id),initialRegion(h.id).text.trim());
  h.notes.set('Renamed.md',legacy);const {deviceNoteIO}=await import('../inline-note-io');deviceNoteIO(h.app).noteChanged('Renamed.md');
  h.complete();await h.writer.tick();
  let lease=JSON.parse((await h.files.read(leasePaths(h.identity.directory,h.id).record))!);assert.equal(lease.state.status,'paused');
  const edited=legacy.replace('Working','User edited');h.notes.set('Renamed.md',edited);
  const bad:any=await h.host.command('response-status',h.id);
  await assert.rejects(h.host.command('resolve-response-location',h.id,bad.locationHash,'Renamed.md'),/not a known checkpoint/);
  assert.equal(h.notes.get('Note.md'),original);assert.equal(h.notes.get('Renamed.md'),edited);
  h.notes.set('Renamed.md',legacy);const review:any=await h.host.command('response-status',h.id);
  await h.host.command('resolve-response-location',h.id,review.locationHash,'Renamed.md');await h.writer.tick();
  lease=JSON.parse((await h.files.read(leasePaths(h.identity.directory,h.id).record))!);
  assert.equal(lease.request.messageId,h.request.messageId);assert.equal(lease.state.status,'complete',JSON.stringify({lease,journal:await h.host.journal.read(h.id),notes:[...h.notes]}));assert.equal(lease.state.finalSaved,true);assert.equal(lease.state.cleanupComplete,true);
  assert.match(h.notes.get('Renamed.md')!,/Added \*\*25kg\*\*/);assert.ok(!h.notes.get('Note.md')!.includes(h.id));
 }finally{await h.close();}
});


test('intentional removal stops hosted polling and stale writes while preserving the running T3 thread and all evidence',async()=>{
 const h=await setup();try{
  await h.writer.tick();const before=h.notes.get('Note.md'),record=JSON.parse(h.storage.get(leasePaths(h.identity.directory,h.id).record)!);
  const state=structuredClone(record.state),journal=await h.host.journal.read(h.id);
  const io=h.host.io(h.base);await io.read(hostedPaths(h.identity.directory,h.id).state);
  assert.deepEqual(await h.host.command('remove-response',h.id),{removed:true});
  const removed=JSON.parse(h.storage.get(leasePaths(h.identity.directory,h.id).record)!);
  assert.equal(typeof removed.responseRemovedAt,'number');assert.deepEqual(removed.state,state);assert.equal(removed.stopRequestedAt,undefined);assert.equal(removed.state.userStopped,undefined);
  assert.equal((await h.host.journal.read(h.id))!.status,'removed');assert.equal(h.notes.get('Note.md'),before);
  assert.deepEqual(await io.requests(),[]);assert.equal(io.accepts!(h.request),false);
  await assert.rejects(()=>io.write(hostedPaths(h.identity.directory,h.id).state,JSON.stringify(state)),/removed|revision changed/);
  await h.host.command('remove-response',h.id);assert.equal(JSON.parse(h.storage.get(leasePaths(h.identity.directory,h.id).record)!).revision,removed.revision);
  let audits=0;const read=h.host.journal.read.bind(h.host.journal);h.host.journal.read=async id=>{audits++;return read(id);};
  for(let i=0;i<6;i++){await h.host.scan();await h.writer.tick();}
  assert.equal(audits,0,'durable removed delivery must not repeatedly audit its history');assert.equal(h.notes.get('Note.md'),before);
  assert.equal((await read(h.id))!.journalRevision,journal!.journalRevision!+1);
 }finally{await h.close();}
});

test('startup repairs removal recorded before its lease tombstone without changing note or response state',async()=>{
 const h=await setup();try{
  await h.writer.tick();const before=h.notes.get('Note.md'),state=JSON.parse(h.storage.get(leasePaths(h.identity.directory,h.id).record)!).state;
  await h.host.coordinator.remove(h.id);await h.host.scan();
  const record=JSON.parse(h.storage.get(leasePaths(h.identity.directory,h.id).record)!);
  assert.equal(typeof record.responseRemovedAt,'number');assert.deepEqual(record.state,state);assert.equal(record.stopRequestedAt,undefined);assert.equal(h.notes.get('Note.md'),before);
  await assert.rejects(()=>h.authority.resume(h.id),/not awaiting/);
 }finally{await h.close();}
});
