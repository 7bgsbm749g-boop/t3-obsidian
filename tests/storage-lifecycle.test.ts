import {test} from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {CurrentGenerationJournal} from '../current-generation-journal-desktop';
import {DesktopGenerationJournal} from '../generation-journal-desktop';
import {contentHash} from '../completion';
import type {NoteGeneration} from '../generated-note-coordinator';
import {ensurePrivateStorage,existingPrivateStorage} from '../private-storage-desktop';
import {localInlineFiles} from '../hosted-inline-desktop';
import {readPrivateStorageRoute,privateStorageResolver} from '../private-storage';
import {InlineLeaseAuthority,InlineLeaseClient,leasePaths,type LeaseFiles} from '../inline-lease';

const initial=(id:string):NoteGeneration=>({request:{id} as any,notePath:'Note.md',original:'Original data\n'.repeat(1000),originalHash:contentHash('Original data\n'.repeat(1000)),status:'accepted',conflicts:[],acknowledgements:[]});
async function fixture(){const root=await fs.mkdtemp(join(tmpdir(),'t3-storage-lifecycle-')),vault=join(root,'vault'),privateRoot=join(root,'private');await fs.mkdir(vault);return {root,vault,privateRoot,close:()=>fs.rm(root,{recursive:true,force:true})};}

test('an existing remote connection follows a newly published private route',async()=>{
  let raw:string|undefined;const resolve=privateStorageResolver(async()=>raw,'/vault','.obsidian');
  assert.equal(await resolve(),'/vault');raw=JSON.stringify({version:1,workspaceRoot:'/vault',configDir:'.obsidian',storageRoot:'/private'});assert.equal(await resolve(),'/private');raw=undefined;assert.equal(await resolve(),'/private');
});
test('explicit removal retires payload bytes but keeps the original identity checksum',async()=>{
  const h=await fixture(),id=randomUUID();try{const journal=await CurrentGenerationJournal.open(h.privateRoot,[h.vault]),state=initial(id),hash=state.originalHash;state.status='removed';state.conflicts=[{original:state.original,latest:'Old bytes',reason:'Removed'}];await journal.append(id,state,'removed');await journal.maintain();const tombstone=(await journal.read(id))!;assert.equal(tombstone.original,'');assert.equal(tombstone.retiredOriginalHash,hash);assert.deepEqual(tombstone.conflicts,[]);assert.equal((await fs.readdir(join(h.privateRoot,id,'current','objects'))).length,0);assert.equal((await (await CurrentGenerationJournal.open(h.privateRoot,[h.vault])).read(id))!.status,'removed');}finally{await h.close();}
});
test('a failed cross-volume copy restores the original and never publishes a route',async t=>{
  const h=await fixture(),source=join(h.vault,'.obsidian/t3-code/commands/v1'),rename=fs.rename;try{await fs.mkdir(source,{recursive:true});await fs.writeFile(join(source,'pending.json'),'Pending private bytes');t.mock.method(fs,'rename',async(...args:any[])=>{if(args[0]===source&&args[1]!==source+'.private-migration')throw Object.assign(Error('Different volume'),{code:'EXDEV'});return (rename as any)(...args);});t.mock.method(fs,'copyFile',async()=>{throw Error('Disk full');});await assert.rejects(ensurePrivateStorage(h.vault,'.obsidian',{storageRoot:h.privateRoot}),/Disk full/);assert.equal(await fs.readFile(join(source,'pending.json'),'utf8'),'Pending private bytes');assert.equal(await existingPrivateStorage(h.vault,'.obsidian'),undefined);t.mock.restoreAll();assert.ok(await ensurePrivateStorage(h.vault,'.obsidian',{storageRoot:h.privateRoot}));}finally{t.mock.restoreAll();await h.close();}
});
test('restart resumes a cross-volume migration stopped before destination publication',async()=>{
  const h=await fixture(),source=join(h.vault,'.obsidian/t3-code/commands/v1');try{await fs.mkdir(source+'.private-migration',{recursive:true});await fs.writeFile(join(source+'.private-migration','pending.json'),'Retained command');const route=await ensurePrivateStorage(h.vault,'.obsidian',{storageRoot:h.privateRoot});assert.equal(await fs.readFile(join(route.storageRoot,'.obsidian/t3-code/commands/v1/pending.json'),'utf8'),'Retained command');await assert.rejects(fs.access(source+'.private-migration'),/ENOENT/);}finally{await h.close();}
});
test('a symlinked current registration cannot read or collect files inside a vault',async()=>{
  const h=await fixture(),id=randomUUID();try{const journal=await CurrentGenerationJournal.open(h.privateRoot,[h.vault]);await journal.append(id,initial(id),'accepted');const source=join(h.privateRoot,id),destination=join(h.vault,id);await fs.rename(source,destination);await fs.writeFile(join(destination,'0000000000.json'),'Keep vault file');await fs.symlink(destination,source);await assert.rejects(journal.read(id),/Symlinked/);await journal.maintain();assert.equal(await fs.readFile(join(destination,'0000000000.json'),'utf8'),'Keep vault file');}finally{await h.close();}
});

test('legacy migration checks the full chain before retiring it and retains an unresolved conflict',async()=>{
  const h=await fixture(),id=randomUUID();try{
    const legacy=await DesktopGenerationJournal.open(h.privateRoot,[h.vault]),state=initial(id);
    for(let n=0;n<40;n++){state.sequence=n;await legacy.append(id,state,'checkpoint');}
    state.status='conflict';state.conflicts=[{original:state.original,latest:'Local version '.repeat(1000),proposed:'Generated version '.repeat(1000),reason:'Unresolved overlap'}];await legacy.append(id,state,'conflict');
    const journal=await CurrentGenerationJournal.open(h.privateRoot,[h.vault]),migrated=(await journal.read(id))!;
    assert.deepEqual(migrated,state);await journal.maintain();assert.equal((await fs.readdir(join(h.privateRoot,id))).filter(name=>/^\d{10}\.json$/.test(name)).length,0);
    await journal.maintain();const reopened=await CurrentGenerationJournal.open(h.privateRoot,[h.vault]);assert.deepEqual(await reopened.read(id),state);
    await reopened.settle(id,'not-a-commit','0'.repeat(64));assert.equal((await reopened.read(id))!.conflicts[0].reason,'Unresolved overlap');
  }finally{await h.close();}
});
test('a corrupt legacy predecessor never becomes a valid compact recovery head',async()=>{
  const h=await fixture(),id=randomUUID();try{
    const legacy=await DesktopGenerationJournal.open(h.privateRoot,[h.vault]),state=initial(id);await legacy.append(id,state,'accepted');await legacy.append(id,state,'checkpoint');
    const path=join(h.privateRoot,id,'0000000000.json'),bytes=await fs.readFile(path,'utf8');await fs.writeFile(path,bytes.replace('Original data','Changed  data'));
    const journal=await CurrentGenerationJournal.open(h.privateRoot,[h.vault]);await assert.rejects(journal.read(id),/integrity/);await assert.rejects(fs.access(join(h.privateRoot,id,'current','state.json')),/ENOENT/);assert.equal((await fs.readdir(join(h.privateRoot,id))).filter(name=>name.endsWith('.json')).length,2);
  }finally{await h.close();}
});
test('many streaming checkpoints retain one head, bounded events, and only useful checksum objects',async()=>{
  const h=await fixture(),id=randomUUID();try{
    const journal=await CurrentGenerationJournal.open(h.privateRoot,[h.vault]),state=initial(id);await journal.append(id,state,'accepted');
    for(let n=0;n<100;n++)await journal.checkpoint(id,n,{requestHash:'fixture',accepted:true,notePath:'Note.md',status:'running',hashes:[],updatedAt:'',body:('Reply '+n+'\n').repeat(1000)},'Note.md');
    await journal.maintain();const directory=join(h.privateRoot,id,'current'),head=JSON.parse(await fs.readFile(join(directory,'state.json'),'utf8')),objects=await fs.readdir(join(directory,'objects'));
    assert.equal(head.events.length,64);assert.equal(objects.length,2,'the original and current reply survive; past streams do not');
    const reopened=await CurrentGenerationJournal.open(h.privateRoot,[h.vault]);assert.equal((await reopened.read(id))!.sequence,99);
    const stale=(await journal.read(id))!;await journal.checkpoint(id,101,{requestHash:'fixture',accepted:true,notePath:'Note.md',status:'running',hashes:[],updatedAt:''},'Note.md');await assert.rejects(journal.append(id,stale,'stale'),/predecessor/);
  }finally{await h.close();}
});
test('settled conflict copies clear only after the exact verified result and acknowledgement',async()=>{
  const h=await fixture(),id=randomUUID();try{
    const journal=await CurrentGenerationJournal.open(h.privateRoot,[h.vault]),state=initial(id);state.status='verified';state.verified={commitId:'commit',hash:contentHash('Saved'),document:'Saved'};state.conflicts=[{original:state.original,latest:'Old conflict '.repeat(1000),reason:'Resolved overlap'}];await journal.append(id,state,'verified');
    const draft=join(h.privateRoot,id,'staged.md');await fs.writeFile(draft,state.original);await journal.settle(id,'commit',state.verified.hash);assert.equal((await journal.read(id))!.conflicts.length,1);assert.equal(await fs.readFile(draft,'utf8'),state.original);
    state.acknowledgements=[{deviceId:'sender',commitId:'commit',hash:state.verified.hash,observedAt:''}];await journal.append(id,state,'device-observed');await journal.settle(id,'wrong',state.verified.hash);assert.equal((await journal.read(id))!.conflicts.length,1);
    await journal.settle(id,'commit',state.verified.hash);await journal.maintain();assert.equal((await journal.read(id))!.conflicts.length,0);assert.equal((await fs.readdir(join(h.privateRoot,id,'current','objects'))).length,1);await assert.rejects(fs.access(draft),/ENOENT/);
    await fs.writeFile(draft,'Unsubmitted user draft');await journal.settle(id,'commit',state.verified.hash);assert.equal(await fs.readFile(draft,'utf8'),'Unsubmitted user draft');
  }finally{await h.close();}
});
test('failed atomic head replacement preserves recovery, and restart rejects an authenticated old head',async t=>{
  const h=await fixture(),id=randomUUID();try{
    const journal=await CurrentGenerationJournal.open(h.privateRoot,[h.vault]),state=initial(id);await journal.append(id,state,'accepted');const path=join(h.privateRoot,id,'current','state.json'),old=await fs.readFile(path),rename=fs.rename;
    t.mock.method(fs,'rename',async(...args:any[])=>{if(args[1]===path)throw Error('Interrupted atomic publish');return (rename as any)(...args);});state.status='streaming';await assert.rejects(journal.append(id,state,'checkpoint'),/Interrupted atomic/);assert.equal((await journal.read(id))!.status,'accepted');t.mock.restoreAll();
    await journal.append(id,state,'checkpoint');await fs.writeFile(path,old);const reopened=await CurrentGenerationJournal.open(h.privateRoot,[h.vault]);await assert.rejects(reopened.read(id),/anchor integrity/);
  }finally{t.mock.restoreAll();await h.close();}
});
test('checksum-object damage and a missing current head fail closed after migration',async()=>{
  const h=await fixture(),id=randomUUID();try{
    const journal=await CurrentGenerationJournal.open(h.privateRoot,[h.vault]);await journal.append(id,initial(id),'accepted');const directory=join(h.privateRoot,id,'current'),object=join(directory,'objects',contentHash(initial(id).original)+'.blob');await fs.writeFile(object,'Damaged object');await assert.rejects(journal.read(id),/integrity/);await fs.rm(join(directory,'state.json'));await assert.rejects(journal.read(id),/head is missing/);
  }finally{await h.close();}
});
test('private migration preserves pending commands and lets an existing file client follow the route',async()=>{
  const h=await fixture(),directory='.obsidian/t3-code/inline/v1';try{
    const files=localInlineFiles(h.vault,directory);await files.write(directory+'/leases/pending.json','Pending original');await files.write(directory+'/mailbox/pending.json','Pending command');
    const route=await ensurePrivateStorage(h.vault,'.obsidian',{storageRoot:h.privateRoot});assert.equal(route.storageRoot,h.privateRoot);assert.equal(await files.read(directory+'/leases/pending.json'),'Pending original');assert.equal(await files.read(directory+'/mailbox/pending.json'),'Pending command');
    await files.write(directory+'/replies/result.json','New reply');assert.equal(await fs.readFile(join(h.privateRoot,directory,'replies/result.json'),'utf8'),'New reply');await assert.rejects(fs.access(join(h.vault,directory)),/ENOENT/);assert.deepEqual(await ensurePrivateStorage(h.vault,'.obsidian',{storageRoot:h.privateRoot}),route);
  }finally{await h.close();}
});
test('different-filesystem migration verifies its copy before removing the frozen source',async t=>{
  const h=await fixture(),source=join(h.vault,'.obsidian/t3-code/commands/v1'),rename=fs.rename;try{
    await fs.mkdir(join(source,'requests'),{recursive:true});await fs.writeFile(join(source,'requests/pending.json'),'Unresolved command');
    t.mock.method(fs,'rename',async(...args:any[])=>{if(args[0]===source&&String(args[1]).startsWith(h.privateRoot)){const error:any=Error('Other filesystem');error.code='EXDEV';throw error;}return (rename as any)(...args);});
    await ensurePrivateStorage(h.vault,'.obsidian',{storageRoot:h.privateRoot});assert.equal(await fs.readFile(join(h.privateRoot,'.obsidian/t3-code/commands/v1/requests/pending.json'),'utf8'),'Unresolved command');await assert.rejects(fs.access(source+'.private-migration'),/ENOENT/);
  }finally{t.mock.restoreAll();await h.close();}
});
test('invalid routes and private locations inside a vault are rejected before any move',async()=>{
  const h=await fixture();try{
    await assert.rejects(ensurePrivateStorage(h.vault,'.obsidian',{storageRoot:join(h.vault,'private')}),/outside/);
    assert.throws(()=>readPrivateStorageRoute(JSON.stringify({version:1,workspaceRoot:h.vault,configDir:'.obsidian',storageRoot:h.vault+'/inside'}),h.vault,'.obsidian'),/Invalid/);
    assert.equal(await existingPrivateStorage(h.vault,'.obsidian'),undefined);
  }finally{await h.close();}
});
test('receipt backlog cleanup exceeds the old batch, but pending commands and fresh replies remain',async()=>{
  const directory='private/inline',data=new Map<string,string>(),now=200_000,identity={vaultId:'vault',environmentId:'host',workspaceRoot:'/vault',directory};
  const files:LeaseFiles={read:async path=>data.get(path),write:async(path,value)=>{data.set(path,value);},remove:async path=>{data.delete(path);},list:async path=>[...data.keys()].filter(key=>key.startsWith(path+'/'))};
  const authority=new InlineLeaseAuthority(identity,files,()=>now),old=[];for(let n=0;n<1100;n++){const id=randomUUID();old.push(id);data.set(leasePaths(directory,id).reply,JSON.stringify({id,ok:true,answeredAt:0,ttlMs:0,record:{body:'Old payload '.repeat(100)}}));}
  const pending=old[0];data.set(leasePaths(directory,pending).command,'Pending');const fresh=randomUUID();data.set(leasePaths(directory,fresh).reply,JSON.stringify({id:fresh,ok:true,answeredAt:now,ttlMs:0}));await authority.cleanupReplies();assert.equal((await files.list(directory+'/replies')).length,2);assert.ok(data.has(leasePaths(directory,pending).reply));assert.ok(data.has(leasePaths(directory,fresh).reply));authority.stop();
});
test('compact command receipts retain exact identity and fetch checked current state instead of storing copies',async()=>{
  const directory='private/inline',data=new Map<string,string>(),identity={vaultId:'vault',environmentId:'host',workspaceRoot:'/vault',directory},actor=randomUUID(),id=randomUUID();
  const files:LeaseFiles={read:async path=>data.get(path),write:async(path,value)=>{data.set(path,value);},remove:async path=>{data.delete(path);},list:async path=>[...data.keys()].filter(key=>key.startsWith(path+'/'))};
  const authority=new InlineLeaseAuthority(identity,files),remote={...files,read:async(path:string)=>{if(path.includes('/replies/'))await authority.tick();return files.read(path);}},client=new InlineLeaseClient(actor,remote,directory);
  const request:any={version:2,id,initialOwner:actor,vaultId:'vault',host:identity,notePath:'Note.md',threadId:'thread',messageId:randomUUID(),projectId:'project',threadEnvironmentId:'host',initialHash:'0'.repeat(64),createdAt:new Date().toISOString()};
  try{const reply=await client.command({kind:'register',jobId:id,request});assert.equal(reply.ok,true);assert.deepEqual(reply.record?.request,request);const wire=JSON.parse(data.get(leasePaths(directory,reply.id).reply)!);assert.equal(wire.record,undefined);assert.deepEqual(wire.recordRef,{id,epoch:reply.record!.epoch,revision:reply.record!.revision});}
  finally{client.dispose();authority.stop();}
});
