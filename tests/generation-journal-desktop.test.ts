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
