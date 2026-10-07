import {test} from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DesktopGenerationJournal} from '../generation-journal-desktop';
import {contentHash} from '../completion';
import type {NoteGeneration} from '../generated-note-coordinator';
const id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const state=():NoteGeneration=>({request:{id} as any,notePath:'Arms.md',original:'Workout data',originalHash:contentHash('Workout data'),status:'accepted',conflicts:[],acknowledgements:[]});
test('real private journal survives reopen and publishes immutable checksum-verified revisions',async()=>{
  const root=await fs.mkdtemp(join(tmpdir(),'t3-generation-'));try{
    const vault=join(root,'vault');await fs.mkdir(vault);const journal=await DesktopGenerationJournal.open(join(root,'private'),[vault]);
    const original=state();await journal.append(id,original,'accepted');const first=await fs.readFile(join(journal.root,id,'0000000000.json'));
    await journal.append(id,{...original,status:'streaming',sequence:4},'checkpoint');
    assert.deepEqual(await fs.readFile(join(journal.root,id,'0000000000.json')),first);
    const reopened=await DesktopGenerationJournal.open(journal.root,[vault]);assert.equal((await reopened.read(id))?.sequence,4);
    await assert.rejects(journal.append(id,{...original,status:'conflict'},'stale-writer'),/predecessor/);
    assert.equal((await fs.stat(join(journal.root,id,'0000000000.json'))).mode&0o777,0o600);
    await assert.rejects(journal.append(id,{...original,original:'Different original'},'changed'),/checksum/);
    await assert.rejects(journal.append(id,{...original,request:{...original.request,id:'other'}},'changed'),/identity/);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('journal refuses synced locations and symlink aliases into a vault',async()=>{
  const root=await fs.mkdtemp(join(tmpdir(),'t3-generation-'));try{
    const vault=join(root,'vault');await fs.mkdir(vault);await fs.symlink(vault,join(root,'alias'));
    await assert.rejects(DesktopGenerationJournal.open(join(vault,'.obsidian','journal'),[vault]),/outside/);
    await assert.rejects(DesktopGenerationJournal.open(join(root,'alias','journal'),[vault]),/outside/);
    await assert.rejects(DesktopGenerationJournal.open(join(root,'private'),[]),/Explicit/);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('tampered or missing revisions fail closed instead of losing response evidence',async()=>{
  const root=await fs.mkdtemp(join(tmpdir(),'t3-generation-'));try{
    const vault=join(root,'vault');await fs.mkdir(vault);const journal=await DesktopGenerationJournal.open(join(root,'private'),[vault]);
    await journal.append(id,state(),'accepted');const file=join(journal.root,id,'0000000000.json');
    const raw=JSON.parse(await fs.readFile(file,'utf8'));raw.state.status='verified';await fs.writeFile(file,JSON.stringify(raw));
    await assert.rejects(journal.read(id),/integrity/);await fs.rename(file,join(journal.root,id,'0000000001.json'));await assert.rejects(journal.read(id),/missing/);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('verified immutable history is checked by file identity without rereading and hashing its bodies on every tick',async t=>{
  const root=await fs.mkdtemp(join(tmpdir(),'t3-generation-cache-'));try{
    const vault=join(root,'vault');await fs.mkdir(vault);const journal=await DesktopGenerationJournal.open(join(root,'private'),[vault]);let current=state();
    for(let n=0;n<40;n++){current={...current,sequence:n};await journal.append(id,current,'checkpoint');}
    await journal.read(id);let reads=0;const original=fs.readFile;t.mock.method(fs,'readFile',async(...args:any[])=>{reads++;return (original as any)(...args);});
    const first=(await journal.read(id))!;first.conflicts.push({original:'changed',latest:'changed',reason:'caller mutation'});
    assert.equal((await journal.read(id))!.conflicts.length,0,'callers receive an independent state');assert.equal(reads,0,'unchanged private history has no body reads');
    await journal.append(id,{...(await journal.read(id))!,sequence:40},'checkpoint');assert.equal((await journal.read(id))!.sequence,40);assert.equal(reads,1,'only the new immutable revision is read and verified');
  }finally{t.mock.restoreAll();await fs.rm(root,{recursive:true,force:true});}
});

test('cached history detects same-size tampering even when the old modification time is restored',async()=>{
  const root=await fs.mkdtemp(join(tmpdir(),'t3-generation-cache-'));try{
    const vault=join(root,'vault');await fs.mkdir(vault);const journal=await DesktopGenerationJournal.open(join(root,'private'),[vault]);await journal.append(id,state(),'accepted');await journal.read(id);
    const path=join(journal.root,id,'0000000000.json'),before=await fs.stat(path),raw=await fs.readFile(path,'utf8');await fs.writeFile(path,raw.replace('"status":"accepted"','"status":"verified"'));await fs.utimes(path,before.atime,before.mtime);
    assert.equal((await fs.stat(path)).size,before.size);await assert.rejects(journal.read(id),/integrity/);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('a verified prefix rejects a rewritten valid hash and tail truncation',async()=>{
  const root=await fs.mkdtemp(join(tmpdir(),'t3-generation-cache-'));try{
    const vault=join(root,'vault');await fs.mkdir(vault);const journal=await DesktopGenerationJournal.open(join(root,'private'),[vault]);const current=state();await journal.append(id,current,'accepted');await journal.append(id,{...current,sequence:1},'checkpoint');await journal.read(id);
    const path=join(journal.root,id,'0000000000.json'),raw=JSON.parse(await fs.readFile(path,'utf8'));raw.state.status='verified';const {hash,...body}=raw;raw.hash=contentHash(JSON.stringify(body));await fs.writeFile(path,JSON.stringify(raw));await assert.rejects(journal.read(id),/integrity/);
    await fs.rm(join(journal.root,id,'0000000001.json'));await assert.rejects(journal.read(id),/missing/);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('a cached revision path still rejects symlink replacement and malformed revision names',async()=>{
  const root=await fs.mkdtemp(join(tmpdir(),'t3-generation-path-'));try{
    const vault=join(root,'vault');await fs.mkdir(vault);const journal=await DesktopGenerationJournal.open(join(root,'private'),[vault]);await journal.append(id,state(),'accepted');await journal.read(id);
    const file=join(journal.root,id,'0000000000.json'),moved=join(root,'original.json');await fs.rename(file,moved);await fs.symlink(moved,file);await assert.rejects(journal.read(id),/Invalid journal revision file/);
    await fs.rm(file);await fs.rename(moved,join(journal.root,id,'0000000002.json'));await assert.rejects(journal.read(id),/missing or malformed/);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('overlapping journal reads share a full audit, with independent results and no more than four concurrent file audits',async t=>{
 const root=await fs.mkdtemp(join(tmpdir(),'t3-generation-overlap-'));
 try{
  const vault=join(root,'vault');await fs.mkdir(vault);const journal=await DesktopGenerationJournal.open(join(root,'private'),[vault]);
  const ids=Array.from({length:8},(_,index)=>`${String(index).padStart(8,'0')}-bbbb-cccc-dddd-eeeeeeeeeeee`);
  for(const key of ids)await journal.append(key,{...state(),request:{id:key} as any},'accepted');
  let active=0,maximum=0,reads=0;const original=fs.lstat;
  t.mock.method(fs,'lstat',async(...args:any[])=>{active++;maximum=Math.max(maximum,active);reads++;try{await new Promise(resolve=>setTimeout(resolve,10));return await (original as any)(...args);}finally{active--;}});
  const results=await Promise.all(ids.flatMap(key=>Array.from({length:10},()=>journal.read(key))));
  assert.equal(reads,8,'one complete filesystem audit per identity for overlapping callers');assert.equal(maximum,4);
  results[0]!.conflicts.push({original:'local',latest:'local',reason:'local'});assert.equal(results[1]!.conflicts.length,0);
 }finally{t.mock.restoreAll();await fs.rm(root,{recursive:true,force:true});}
});
