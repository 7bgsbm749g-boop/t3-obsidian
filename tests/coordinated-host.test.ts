import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {CoordinatedHost} from '../coordinated-host-desktop';
import {InlineLeaseAuthority,InlineLeaseClient,leasePaths,COORDINATED_OWNER,type LeaseFiles} from '../inline-lease';
import {HostedInlineWriter,hostedRequestHash,type HostedInlineRequest,type HostedWriterIO} from '../hosted-inline';
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
  const app:any={workspace:{getLeavesOfType:()=>[]},vault:{getFileByPath:(path:string)=>path===file.path?file:undefined,getMarkdownFiles:()=>[file],read:async()=>notes.get(file.path),process:async(_file:any,change:any)=>{const next=change(notes.get(file.path));notes.set(file.path,next);writes++;return next;}},saveLocalStorage:()=>{}};
  await client.command({kind:'register',jobId:id,request});
  if(!native){const record=JSON.parse(storage.get(leasePaths(identity.directory,id).record)!);record.state={requestHash:hostedRequestHash(request),accepted:true,notePath:file.path,status:'running',hashes:[initial.bodyHash],updatedAt:'',bindingCheckpoint:{bindings:{[request.messageId]:{turnId:'turn',kind:'start'}}},incoming:[{messageId:randomUUID(),text:'Keep data',label:'You · Author',before:[]}]};record.expiresAt=liveLease?Date.now()+25:Date.now()-3000;storage.set(leasePaths(identity.directory,id).record,JSON.stringify(record));}
  const host=await CoordinatedHost.open(app,identity,files,authority,{journalRoot:join(root,'journal')});await host.scan();
  let completed=false;
  const snapshot=()=>({thread:{id:'thread',projectId:'project',messages:[{id:request.messageId,role:'user',streaming:false,text:'Add 25kg',createdAt:request.createdAt},{id:'answer',role:'assistant',text:completed?'Added **25kg**.':'Still working.',turnId:'turn',streaming:!completed}],activities:[],latestTurn:{turnId:'turn',messageId:request.messageId,state:completed?'completed':'running',requestedAt:request.createdAt,assistantMessageId:'answer'},session:{status:completed?'ready':'running',activeTurnId:completed?null:'turn'}}});
  const base:HostedWriterIO={...files,requests:async()=>[],access:async()=>({origin:'https://fixture',api:async()=>snapshot()}),updateNote:async()=>{throw Error('Legacy direct writes are forbidden in this fixture');}};
  const writer=new HostedInlineWriter(identity,host.io(base));
  return {root,host,authority,client,files,storage,request,id,notes,file,writer,complete:()=>{completed=true;},writes:()=>writes,close:async()=>{writer.stop();host.stop();authority.stop();client.dispose();await rm(root,{recursive:true,force:true});}};
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
  const ack=await h.client.command({kind:'observe',jobId:h.id,observed:{commitId:journal!.verified!.commitId,hash:contentHash(saved)}});assert.equal(ack.ok,true);await h.host.scan();assert.equal((await h.host.journal.read(h.id))!.acknowledgements.length,1);
  assert.equal((await h.client.command({kind:'claim',jobId:h.id})).ok,false);
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
