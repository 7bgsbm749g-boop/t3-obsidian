import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {ResponseNoteLocator} from '../response-location';
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
