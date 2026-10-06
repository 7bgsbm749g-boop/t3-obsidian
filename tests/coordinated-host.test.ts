import {test} from 'node:test';
import assert from 'node:assert/strict';
import {nativeCommitPath,readNativeCommitProof,nativeCommitMatches} from '../native-response-commit';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {CoordinatedHost} from '../coordinated-host-desktop';
import {InlineLeaseAuthority,InlineLeaseClient,leasePaths,COORDINATED_OWNER,type LeaseFiles} from '../inline-lease';
import {HostedInlineWriter,hostedRequestHash,hostedPaths,type HostedInlineRequest,type HostedWriterIO} from '../hosted-inline';
import {initialRegion} from '../inline-thread';
import {responseAnchor} from '../native-response-projection';
import {contentHash} from '../completion';

async function setup(native=true,liveLease=false){
  const root=await mkdtemp(join(tmpdir(),'coordinated-production-')),vault=join(root,'vault');await import('node:fs/promises').then(fs=>fs.mkdir(vault));
  const identity={vaultId:randomUUID(),environmentId:'host',workspaceRoot:vault,directory:'.obsidian/t3-code/inline/v1'},id=randomUUID(),actor=randomUUID(),initial=initialRegion(id);
  const request:HostedInlineRequest={version:2,nativeProjection:native,independent:true,id,initialOwner:actor,vaultId:identity.vaultId,host:identity,notePath:'Note.md',threadId:'thread',messageId:randomUUID(),projectId:'project',threadEnvironmentId:'host',initialHash:initial.bodyHash,createdAt:'2026-10-03T00:00:00Z'};
  const file={path:'Note.md'},notes=new Map([['Note.md',`# Exercise\n\n| Exercise | 20kg |\n| --- | ---: |\n| Barb | 20 |\n\n${native?responseAnchor(id):initial.text}\n\nTail\n`]]),storage=new Map<string,string>();let writes=0;
  const files:LeaseFiles={read:async path=>storage.get(path),write:async(path,value)=>{storage.set(path,value);},remove:async path=>{storage.delete(path);},list:async directory=>[...storage.keys()].filter(path=>path.startsWith(directory+'/'))};
  const authority=new InlineLeaseAuthority(identity,files),remote={...files,read:async(path:string)=>{if(path.includes('/replies/'))await authority.tick();return files.read(path);}};
  const client=new InlineLeaseClient(actor,remote,identity.directory,undefined,undefined,async()=>{await authority.tick();});
  const extraFiles=new Map<string,{path:string}>();
  const getFile=(path:string)=>{if(path===file.path)return file;if(!notes.has(path))return undefined;let extra=extraFiles.get(path);if(!extra){extra={path};extraFiles.set(path,extra);}return extra;};
  const app:any={workspace:{getLeavesOfType:()=>[]},vault:{getFileByPath:getFile,getMarkdownFiles:()=>[...notes.keys()].map(getFile),read:async(target:any)=>notes.get(target.path),process:async(target:any,change:any)=>{const next=change(notes.get(target.path));notes.set(target.path,next);writes++;return next;}},saveLocalStorage:()=>{}};
  await client.command({kind:'register',jobId:id,request});
  if(!native){const record=JSON.parse(storage.get(leasePaths(identity.directory,id).record)!);record.state={requestHash:hostedRequestHash(request),accepted:true,notePath:file.path,status:'running',hashes:[initial.bodyHash],updatedAt:'',bindingCheckpoint:{bindings:{[request.messageId]:{turnId:'turn',kind:'start'}}},incoming:[{messageId:randomUUID(),text:'Keep data',label:'You · Author',before:[]}]};record.expiresAt=liveLease?Date.now()+25:Date.now()-3000;storage.set(leasePaths(identity.directory,id).record,JSON.stringify(record));}
  const host=await CoordinatedHost.open(app,identity,files,authority,{journalRoot:join(root,'journal')});await host.scan();
  let completed=false;
  const snapshot=()=>({thread:{id:'thread',projectId:'project',messages:[{id:request.messageId,role:'user',streaming:false,text:'Add 25kg',createdAt:request.createdAt},{id:'answer',role:'assistant',text:completed?'Added **25kg**.':'Still working.',turnId:'turn',streaming:!completed}],activities:[],latestTurn:{turnId:'turn',messageId:request.messageId,state:completed?'completed':'running',requestedAt:request.createdAt,assistantMessageId:'answer'},session:{status:completed?'ready':'running',activeTurnId:completed?null:'turn'}}});
  const base:HostedWriterIO={...files,requests:async()=>[],access:async()=>({origin:'https://fixture',api:async()=>snapshot()}),updateNote:async()=>{throw Error('Legacy direct writes are forbidden in this fixture');}};
  const writer=new HostedInlineWriter(identity,host.io(base));
  return {root,app,identity,base,host,authority,client,files,storage,request,id,notes,file,writer,complete:()=>{completed=true;},writes:()=>writes,close:async()=>{writer.stop();host.stop();authority.stop();client.dispose();await rm(root,{recursive:true,force:true});}};
}

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

test('active delivery proceeds while completed journal observation rotates through bounded history batches',async()=>{
 const h=await setup();try{
  await h.writer.tick();const historical=new Set<string>();
  for(let n=0;n<9;n++){
   const id=randomUUID(),request={...h.request,id,notePath:`Historical-${n}.md`};historical.add(id);
   h.storage.set(leasePaths(h.identity.directory,id).record,JSON.stringify({request,coordinated:true,owner:COORDINATED_OWNER,epoch:1,revision:1,expiresAt:Number.MAX_SAFE_INTEGER,state:{requestHash:hostedRequestHash(request),accepted:true,status:'complete',finalSaved:true,cleanupComplete:true,finalPhase:'complete',finalBody:'Saved old answer',notePath:request.notePath,hashes:[],updatedAt:''}}));
  }
  const read=h.host.journal.read.bind(h.host.journal),observed=new Set<string>();h.host.journal.read=async id=>{if(historical.has(id)){observed.add(id);return undefined;}return read(id);};
  await h.host.scan();assert.equal(observed.size,4,'historical verification does not monopolize the active pass');
  h.complete();await h.writer.tick();assert.equal((await read(h.id))!.status,'verified');assert.match(h.notes.get('Note.md')!,/Added \*\*25kg\*\*/);
  await h.host.scan();assert.ok(observed.size>4,'later scans still audit historical results');
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
  assert.ok(!h.notes.get('Note.md')!.includes(h.id));assert.ok(!h.notes.has('Mobile title.md'));
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
