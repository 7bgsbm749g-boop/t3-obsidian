import {test} from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {CurrentGenerationJournal} from '../current-generation-journal-desktop';
import {contentHash} from '../completion';
import type {NoteGeneration} from '../generated-note-coordinator';

const initial=(id:string,original='Recovery text\n'.repeat(50_000)):NoteGeneration=>({request:{id} as any,notePath:'Note.md',original,originalHash:contentHash(original),status:'accepted',conflicts:[],acknowledgements:[]});
async function fixture(options:Parameters<typeof CurrentGenerationJournal.open>[2]={}){
  const root=await fs.mkdtemp(join(tmpdir(),'t3-journal-maintenance-')),vault=join(root,'vault'),privateRoot=join(root,'private');await fs.mkdir(vault);
  const journal=await CurrentGenerationJournal.open(privateRoot,[vault],options);
  return {root,privateRoot,vault,journal,path:(id:string)=>join(privateRoot,id,'current','state.json'),close:async()=>{await journal.stop();await fs.rm(root,{recursive:true,force:true});}};
}

test('warm and cold maintenance never hydrate or copy full states beyond both cache limits',async t=>{
  let now=0;const h=await fixture({now:()=>now,maxHeads:2,maxHeadCharacters:30_000,maxStates:1,maxStateCharacters:1_000});
  try{
    const ids=Array.from({length:12},()=>randomUUID());
    for(const id of ids)await h.journal.append(id,initial(id),'accepted');
    let copies=0,blobReads=0;const clone=structuredClone,read=fs.readFile;
    t.mock.method(globalThis,'structuredClone',(value:any)=>{if(typeof value?.original==='string')copies++;return clone(value);});
    t.mock.method(fs,'readFile',async(...args:any[])=>{if(String(args[0]).endsWith('.blob'))blobReads++;return (read as any)(...args);});
    const before=h.journal.status();
    for(let round=0;round<3;round++){now+=30_001;for(let tick=0;tick<10;tick++)await h.journal.maintain();}
    const after=h.journal.status();
    assert.ok(after.maintenanceRecords>=ids.length*3);assert.equal(after.maintenanceFailures,0);
    assert.equal(copies,0);assert.equal(blobReads,0,'cold blobs are hashed in bounded buffers, never read as document strings');
    assert.equal(after.hydrations,before.hydrations);assert.equal(after.mutableCopies,before.mutableCopies);
    assert.ok(after.heads<=2&&after.headCharacters<=30_000);assert.equal(after.states,0);assert.equal(after.stateCharacters,0);
  }finally{await h.close();}
});

test('maintenance makes one head check per unchanged record and paces idle discovery',async()=>{
  let now=0;const h=await fixture({now:()=>now}),id=randomUUID();
  try{
    await h.journal.append(id,initial(id),'accepted');const before=h.journal.status();await h.journal.maintain();
    assert.equal(h.journal.status().headChecks-before.headChecks,1);
    const checked=h.journal.status().headChecks;for(let n=0;n<30;n++)await h.journal.maintain();assert.equal(h.journal.status().headChecks,checked);
    now=30_001;await h.journal.maintain();assert.equal(h.journal.status().headChecks,checked+1);
  }finally{await h.close();}
});

test('public mutable reads cannot change the private hydrated snapshot or request',async()=>{
  const h=await fixture(),id=randomUUID();try{
    const state=initial(id);state.conflicts=[{original:state.original,latest:'Local edit',reason:'Unresolved'}];await h.journal.append(id,state,'accepted');
    const first=(await h.journal.read(id))!;first.request.id=randomUUID();first.original='Changed';first.conflicts[0].latest='Changed';
    assert.deepEqual(await h.journal.read(id),state);assert.equal(h.journal.status().hydrations,1);
  }finally{await h.close();}
});

test('changed checksum objects fail maintenance before obsolete evidence is collected',async()=>{
  const h=await fixture(),id=randomUUID();try{
    const state=initial(id);await h.journal.append(id,state,'accepted');const directory=join(h.privateRoot,id),old=join(directory,'0000000000.json');await fs.writeFile(old,'Preserve evidence');
    await fs.writeFile(join(directory,'current','objects',state.originalHash+'.blob'),'Damaged bytes');await h.journal.maintain();
    assert.equal(h.journal.status().maintenanceFailures,1);assert.equal(await fs.readFile(old,'utf8'),'Preserve evidence');await assert.rejects(h.journal.read(id),/integrity/);
  }finally{await h.close();}
});

test('same-size head replacement cannot use a warm metadata cache',async()=>{
  const h=await fixture(),id=randomUUID();try{
    await h.journal.append(id,initial(id),'accepted');const raw=await fs.readFile(h.path(id),'utf8');assert.ok(raw.includes('Note.md'));await fs.writeFile(h.path(id),raw.replace('Note.md','Edit.md'));
    await h.journal.maintain();assert.equal(h.journal.status().maintenanceFailures,1);await assert.rejects(h.journal.read(id),/integrity/);
  }finally{await h.close();}
});

test('cold maintenance rejects authenticated rollback after its metadata cache is full',async()=>{
  const h=await fixture({maxHeads:0}),id=randomUUID();try{
    const state=initial(id);await h.journal.append(id,state,'accepted');const old=await fs.readFile(h.path(id));state.status='streaming';await h.journal.append(id,state,'streaming');await fs.writeFile(h.path(id),old);
    await h.journal.maintain();assert.equal(h.journal.status().maintenanceFailures,1);await assert.rejects(h.journal.read(id),/anchor integrity/);
  }finally{await h.close();}
});

test('missing published heads, objects, and observed anchors fail closed',async()=>{
  for(const kind of ['head','object','anchor']){
    const h=await fixture(),id=randomUUID();try{
      const state=initial(id);await h.journal.append(id,state,'accepted');await h.journal.read(id);
      const path=kind==='head'?h.path(id):kind==='object'?join(h.privateRoot,id,'current','objects',state.originalHash+'.blob'):join(h.privateRoot,id,'.current-format');
      await fs.rm(path);await h.journal.maintain();assert.equal(h.journal.status().maintenanceFailures,1,kind);await assert.rejects(h.journal.read(id));
    }finally{await h.close();}
  }
});

test('removed generations with pending renames retain recovery until the rename settles',async()=>{
  const h=await fixture(),id=randomUUID();try{
    const state=initial(id);state.status='removed';state.pendingRename={before:'Note.md',after:'Moved.md'};await h.journal.append(id,state,'removed');await h.journal.maintain();
    assert.equal((await h.journal.read(id))!.original,state.original);assert.equal(h.journal.status().mutableCopies,1);
    const settled=(await h.journal.read(id))!;delete settled.pendingRename;await h.journal.append(id,settled,'rename-settled');await h.journal.maintain();
    const retired=(await h.journal.read(id))!;assert.equal(retired.original,'');assert.equal(retired.retiredOriginalHash,state.originalHash);
    const copies=h.journal.status().mutableCopies;await h.journal.maintain();assert.equal(h.journal.status().mutableCopies,copies);
  }finally{await h.close();}
});

test('a bounded cleanup backlog resumes after restart without any state hydration',async()=>{
  const h=await fixture(),id=randomUUID();let reopened:CurrentGenerationJournal|undefined;
  try{
    await h.journal.append(id,initial(id),'accepted');const directory=join(h.privateRoot,id);
    await Promise.all(Array.from({length:520},(_,n)=>fs.writeFile(join(directory,String(n).padStart(10,'0')+'.json'),'Obsolete')));
    await h.journal.maintain();const remaining=(await fs.readdir(directory)).filter(name=>/^\d{10}\.json$/.test(name)).length;assert.ok(remaining>=8&&remaining<=12);assert.equal(h.journal.status().hydrations,0);
    await h.journal.stop();reopened=await CurrentGenerationJournal.open(h.privateRoot,[h.vault]);await reopened.maintain();assert.equal((await fs.readdir(directory)).filter(name=>/^\d{10}\.json$/.test(name)).length,0);assert.equal(reopened.status().hydrations,0);
  }finally{await reopened?.stop();await h.close();}
});

test('large directories bound visits, resume cursors, and use a changed publication before deletion',async()=>{
  const h=await fixture(),id=randomUUID();try{
    const state=initial(id);await h.journal.append(id,state,'accepted');const objects=join(h.privateRoot,id,'current','objects');
    await Promise.all(Array.from({length:1100},(_,n)=>fs.writeFile(join(objects,'preserved-'+n),'Unrecognized evidence')));
    await h.journal.maintain();assert.equal(h.journal.status().cleanupCursors,1,'a slice yields even when no files are garbage');
    state.finalBody='Useful newly published body\n'.repeat(1000);await h.journal.append(id,state,'finished');
    for(let n=0;n<8;n++)await h.journal.maintain();
    assert.equal(h.journal.status().cleanupCursors,0);assert.equal(h.journal.status().maintenanceFailures,0);
    assert.equal(await fs.readFile(join(objects,contentHash(state.finalBody)+'.blob'),'utf8'),state.finalBody);
    assert.equal((await fs.readdir(objects)).filter(name=>name.startsWith('preserved-')).length,1100);
  }finally{await h.close();}
});

test('coalesced maintenance stops an active slice without deleting the remaining backlog',async t=>{
  const h=await fixture(),id=randomUUID();let release:()=>void=()=>{};let maintaining:Promise<void>|undefined,stopping:Promise<void>|undefined;
  try{
    await h.journal.append(id,initial(id),'accepted');const directory=join(h.privateRoot,id);
    await Promise.all(Array.from({length:20},(_,n)=>fs.writeFile(join(directory,String(n).padStart(10,'0')+'.json'),'Obsolete')));
    let entered:()=>void=()=>{};const started=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;}),unlink=fs.unlink;
    t.mock.method(fs,'unlink',async(path:any)=>{if(String(path).endsWith('.json')){entered();await gate;}return unlink(path);});
    maintaining=h.journal.maintain();assert.equal(h.journal.maintain(),maintaining);await started;stopping=h.journal.stop();release();await stopping;await maintaining;
    assert.equal((await fs.readdir(directory)).filter(name=>/^\d{10}\.json$/.test(name)).length,19);
    assert.equal(h.journal.status().cleanupCursors,0);assert.equal(h.journal.status().pending,0);
  }finally{release();await stopping;await maintaining;await h.close();}
});

test('busy delivery queues do not block cleanup of independent records',async t=>{
  const h=await fixture(),blocked=randomUUID(),healthy=randomUUID();let release:()=>void=()=>{};let writing:Promise<void>|undefined;
  try{
    const state=initial(blocked);await h.journal.append(blocked,state,'accepted');await h.journal.append(healthy,initial(healthy),'accepted');await h.journal.maintain();
    let started:()=>void=()=>{};const entered=new Promise<void>(resolve=>{started=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;}),rename=fs.rename;
    t.mock.method(fs,'rename',async(...args:any[])=>{if(args[1]===h.path(blocked)){started();await gate;}return (rename as any)(...args);});
    state.status='streaming';writing=h.journal.append(blocked,state,'streaming');await entered;
    const orphan=join(h.privateRoot,healthy,'current','objects','0'.repeat(64)+'.blob');await fs.writeFile(orphan,'Obsolete');
    // Queue the healthy record through a fresh safety scan.
    (h.journal as any).nextDiscovery=0;await h.journal.maintain();await assert.rejects(fs.access(orphan),/ENOENT/);
    release();await writing;writing=undefined;
  }finally{release();await writing?.catch(()=>{});await h.close();}
});

test('stopping maintenance releases its cursor and caches and prevents later cleanup',async()=>{
  const h=await fixture(),id=randomUUID();try{
    await h.journal.append(id,initial(id),'accepted');await h.journal.read(id);await h.journal.maintain();await h.journal.stop();
    const garbage=join(h.privateRoot,id,'0000000000.json');await fs.writeFile(garbage,'Retain after shutdown');const before=h.journal.status();await h.journal.maintain();
    assert.deepEqual(h.journal.status(),before);assert.equal(before.heads,0);assert.equal(before.states,0);assert.equal(before.pending,0);assert.equal(await fs.readFile(garbage,'utf8'),'Retain after shutdown');
  }finally{await h.close();}
});
