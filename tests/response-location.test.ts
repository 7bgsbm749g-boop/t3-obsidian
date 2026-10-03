import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {ResponseNoteLocator,DuplicateResponseLocation} from '../response-location';
import {contentHash} from '../completion';
import {initialRegion,completionProof} from '../inline-thread';

function harness(){
  const id=randomUUID(),notes=new Map<string,string>([['Old.md',initialRegion(id).text]]);
  let time=0,reads=0;
  const locator=new ResponseNoteLocator(()=>[...notes.keys()],async path=>{reads++;return notes.get(path);},()=>time);
  const move=(before:string,after:string)=>{notes.set(after,notes.get(before)!);notes.delete(before);};
  return {id,notes,locator,move,advance:()=>{time+=3001;},get reads(){return reads;}};
}

test('a missed rename is recovered by binding identity even when the old path is reused',async()=>{
  const h=harness();h.move('Old.md','Moved/Note.md');h.notes.set('Old.md','An unrelated replacement note');
  assert.equal(await h.locator.locate(h.id,'Old.md'),'Moved/Note.md');
  assert.equal(h.notes.get('Old.md'),'An unrelated replacement note');
  const reads=h.reads;
  assert.equal(await h.locator.locate(h.id,'Moved/Note.md'),'Moved/Note.md');
  assert.equal(h.reads,reads+1,'Normal progress does not scan the vault');
});

test('a missing note waits, shares throttled recovery, then finds a delayed Sync arrival',async()=>{
  const h=harness(),text=h.notes.get('Old.md')!;h.notes.delete('Old.md');h.notes.set('Unrelated.md','Unrelated');
  assert.equal(await h.locator.locate(h.id,'Old.md'),undefined);
  const reads=h.reads;
  assert.equal(await h.locator.locate(h.id,'Old.md'),undefined);
  assert.equal(h.reads,reads+1);
  h.notes.set('New.md',text);h.locator.changed('New.md');
  assert.equal(await h.locator.locate(h.id,'Old.md'),'New.md');
});

test('folder moves and successive moves preserve indexed locations',async()=>{
  const h=harness();h.move('Old.md','Folder/Note.md');
  assert.equal(await h.locator.locate(h.id,'Old.md'),'Folder/Note.md');
  h.move('Folder/Note.md','Renamed/Note.md');h.locator.renamed('Folder','Renamed');
  h.move('Renamed/Note.md','Final.md');h.locator.renamed('Renamed/Note.md','Final.md');
  assert.equal(await h.locator.locate(h.id,'Old.md'),'Final.md');
});

test('duplicate blocks pause relocation; removing the duplicate permits recovery',async()=>{
  const h=harness();h.move('Old.md','Moved.md');h.notes.set('Copy.md',h.notes.get('Moved.md')!);
  await assert.rejects(h.locator.locate(h.id,'Old.md'),/multiple notes/);
  h.notes.delete('Copy.md');h.locator.deleted('Copy.md');
  assert.equal(await h.locator.locate(h.id,'Old.md'),'Moved.md');
});

test('an observed copy is detected even while the cached original path still exists',async()=>{
  const h=harness();await h.locator.locate(h.id,'Old.md');
  h.notes.set('Copy.md',h.notes.get('Old.md')!);h.locator.changed('Copy.md');
  await assert.rejects(h.locator.locate(h.id,'Old.md'),/multiple notes/);
});

test('final-save proof follows a moved note and markers in code fences are ignored',async()=>{
  const h=harness();h.notes.set('Old.md',completionProof(h.id,'Final reply'));h.move('Old.md','Final.md');
  h.notes.set('Example.md','```markdown\n'+initialRegion(h.id).text+'\n```');
  assert.equal(await h.locator.locate(h.id,'Old.md'),'Final.md');
});

test('edited bodies retain their identity and removed markers reach the conflict guard',async()=>{
  const h=harness();h.move('Old.md','Moved.md');h.notes.set('Moved.md',h.notes.get('Moved.md')!.replace('Working','My edit'));
  assert.equal(await h.locator.locate(h.id,'Old.md'),'Moved.md');
  h.notes.set('Moved.md','My text with the block removed');h.locator.changed('Moved.md');
  assert.equal(await h.locator.locate(h.id,'Moved.md'),'Moved.md');
});

test('many missing responses share an index and do not repeatedly read unchanged notes',async()=>{
  const notes=new Map(Array.from({length:100},(_,i)=>[`Note${i}.md`,'Ordinary Markdown']));
  let reads=0,time=0;
  const locator=new ResponseNoteLocator(()=>[...notes.keys()],async path=>{reads++;return notes.get(path);},()=>time);
  for(let i=0;i<20;i++){
    await locator.locate(randomUUID(),'Missing.md');time+=3001;
  }
  assert.equal(reads,120,'One initial scan plus one preferred-path check per response');
  const id=randomUUID();notes.set('New.md',initialRegion(id).text);
  assert.equal(await locator.locate(id,'Missing.md'),'New.md','New Sync files bypass fallback backoff without an event');
});

test('missed changes to an existing note recover through the bounded fallback sweep',async()=>{
  let time=0;const id=randomUUID(),notes=new Map([['Existing.md','Unrelated']]);
  const locator=new ResponseNoteLocator(()=>[...notes.keys()],async path=>notes.get(path),()=>time);
  assert.equal(await locator.locate(id,'Missing.md'),undefined);
  notes.set('Existing.md',initialRegion(id).text);
  time=3001;assert.equal(await locator.locate(id,'Missing.md'),undefined);
  time=120001;assert.equal(await locator.locate(id,'Missing.md'),'Existing.md');
});

test('changed existing files bypass fallback backoff and still detect copies',async()=>{
  const h=harness();await h.locator.locate(randomUUID(),'Missing.md');
  h.notes.set('Old.md',initialRegion(h.id).text);h.locator.changed('Old.md');
  assert.equal(await h.locator.locate(h.id,'Missing.md'),'Old.md');
  h.notes.set('Copy.md',h.notes.get('Old.md')!);h.locator.changed('Copy.md');
  await assert.rejects(h.locator.locate(h.id,'Old.md'),/multiple notes/);
});
test('proven relocation waits for Sync, follows its new path and excludes only the exact stale saved snapshot',async()=>{
  const h=harness(),original=h.notes.get('Old.md')!;await h.locator.locate(h.id,'Old.md');
  h.locator.relocated(h.id,'Old.md','Moved.md',contentHash(original));
  assert.equal(await h.locator.locate(h.id,'Old.md'),undefined,'do not write the old note while the move is in transit');
  h.notes.set('Moved.md',original);h.locator.changed('Moved.md');assert.equal(await h.locator.locate(h.id,'Old.md'),'Moved.md');
  h.notes.set('Copy.md',original);h.locator.changed('Copy.md');
  await assert.rejects(h.locator.locate(h.id,'Old.md'),error=>error instanceof DuplicateResponseLocation&&error.paths.join(',')==='Copy.md,Moved.md');
  h.notes.delete('Copy.md');h.locator.deleted('Copy.md');h.notes.set('Old.md',original+'Changed copied note');h.locator.changed('Old.md');
  await assert.rejects(h.locator.locate(h.id,'Old.md'),error=>error instanceof DuplicateResponseLocation&&error.paths.includes('Old.md'));
});
