import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
import {interruptibleAuthorityFiles} from '../authority-storage-desktop';
import {InlineLeaseAuthority,InlineLeaseClient,leasePaths,type LeaseFiles} from '../inline-lease';
import {contentHash} from '../completion';
import {hostedRequestHash} from '../hosted-inline';

function fixture(){
  const directory='.obsidian/t3-code/inline/v1',identity={vaultId:'vault',environmentId:'host',workspaceRoot:'/fixture',directory},actor=randomUUID(),data=new Map<string,string>();
  const request={version:2 as const,nativeProjection:true,id:randomUUID(),initialOwner:actor,vaultId:identity.vaultId,host:identity,notePath:'Synthetic.md',threadId:randomUUID(),messageId:randomUUID(),projectId:'project',threadEnvironmentId:'host',initialHash:contentHash(''),createdAt:new Date().toISOString()};
  const files:LeaseFiles={read:async path=>data.get(path),write:async(path,value)=>{data.set(path,value);},remove:async path=>{data.delete(path);},list:async path=>[...data.keys()].filter(key=>key.startsWith(path+'/'))};
  return {directory,identity,actor,data,request,files};
}

test('a lost authority read reproduces registration failure and bounded reads recover the same command',async()=>{
  const h=fixture(),base=h.files.read;let lose=true,late!:(value:string|undefined)=>void;
  h.files.read=path=>lose&&path.endsWith('/lease-catalog.json')?(lose=false,new Promise(resolve=>{late=resolve;})):base(path);
  const storage=interruptibleAuthorityFiles(h.files,30),authority=new InlineLeaseAuthority(h.identity,storage.files);
  const client=new InlineLeaseClient(h.actor,h.files,h.directory,()=>Date.now(),()=>performance.now(),async()=>{await pause(2);});
  const command={id:randomUUID(),actor:h.actor},input={kind:'register' as const,jobId:h.request.id,request:h.request};
  // Start exactly the stalled loop: subsequent ticks coalesce on its read.
  const stalled=authority.tick();await assert.rejects(stalled,/authority read timed out/);
  assert.equal(storage.status().timeouts,1);assert.equal(storage.status().lastTimeout?.path,`${h.directory}/lease-catalog.json`);
  assert.equal(storage.status().pendingCount,0,'health evidence cannot retain an abandoned read as active work');
  assert.equal(h.data.has(leasePaths(h.directory,command.id).reply),false);
  const answer=client.command(input,command);await authority.tick();assert.equal((await answer).ok,true);
  await authority.migrated(h.request.id);
  const checkpoint=await authority.checkpoint(h.request.id,{requestHash:hostedRequestHash(h.request),accepted:true,status:'running',notePath:h.request.notePath,hashes:[],updatedAt:new Date().toISOString()});
  assert.equal(checkpoint.state?.status,'running','the same authority serves streaming checkpoints after recovery');
  const durable=h.data.get(leasePaths(h.directory,h.request.id).record);
  late('invalid late snapshot');await pause(0);assert.equal(h.data.get(leasePaths(h.directory,h.request.id).record),durable,'abandoned reads cannot resume and overwrite recovery');
  const replay=client.command(input,command);await authority.tick();assert.equal((await replay).ok,true);assert.equal(h.data.get(leasePaths(h.directory,h.request.id).record),durable);
  authority.stop();storage.stop();client.dispose();
});

test('unbounded authority reads produce the observed native registration error',async()=>{
  const h=fixture(),authority=new InlineLeaseAuthority(h.identity,{...h.files,read:()=>new Promise(()=>{})});
  void authority.tick();
  const client=new InlineLeaseClient(h.actor,h.files,h.directory,()=>Date.now(),()=>performance.now(),async()=>{});
  await assert.rejects(client.command({kind:'register',jobId:h.request.id,request:h.request}),/The response host did not acknowledge registration/);
  authority.stop();client.dispose();
});

test('stop interrupts reads and enumeration, but never abandons a submitted mutation',async()=>{
  const h=fixture();let release!:(value:void)=>void,settled=false;
  const storage=interruptibleAuthorityFiles({...h.files,read:()=>new Promise(()=>{}),list:()=>new Promise(()=>{}),write:()=>new Promise<void>(resolve=>{release=resolve;})},1000);
  const read=storage.files.read('read'),list=storage.files.list('list'),write=storage.files.write('write','value').then(()=>{settled=true;});
  await pause(0);
  storage.stop();await assert.rejects(read,/stopped/);await assert.rejects(list,/stopped/);
  await pause(5);assert.equal(settled,false);assert.deepEqual(storage.status().pending.map(item=>item.operation),['write']);release();await write;assert.equal(settled,true);
});

test('a failed bounded read preserves identity and active ownership checks',async()=>{
  const h=fixture(),storage=interruptibleAuthorityFiles(h.files,20),authority=new InlineLeaseAuthority(h.identity,storage.files),client=new InlineLeaseClient(h.actor,h.files,h.directory);
  const command={kind:'register' as const,jobId:h.request.id,request:h.request};
  const send=client.command(command);await authority.tick();assert.equal((await send).ok,true);
  const changed=client.command({...command,request:{...h.request,messageId:randomUUID()}});await authority.tick();assert.match((await changed).error!,/another request/);
  const claim=client.command({kind:'claim',jobId:h.request.id});await authority.tick();assert.match((await claim).error!,/coordinated by the host/);
  authority.stop();storage.stop();client.dispose();
});
