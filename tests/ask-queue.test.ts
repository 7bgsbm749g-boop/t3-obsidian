import test from 'node:test';
import assert from 'node:assert/strict';
import {combinedAsks,loadAskQueue,relocateQueuedAsks} from '../src/conversations/ask-queue';
test('queued selection snapshots survive reload and combine in reviewed order without sending',()=>{
 const items=[{id:'one',notePath:'Note.md',selection:'Selected **source**.',question:'Why?'},{id:'two',notePath:'Note.md',selection:'Another passage.',question:'How?'}];
 const restored=loadAskQueue(JSON.parse(JSON.stringify(items)));const prompt=combinedAsks(restored.reverse());
 assert.ok(prompt.indexOf('How?')<prompt.indexOf('Why?'));assert.match(prompt,/Selected \*\*source\*\*\./);assert.equal(items[0].id,'one');
 assert.deepEqual(loadAskQueue([null,{id:3}]),[]);assert.throws(()=>combinedAsks([]),/question/);
 assert.throws(()=>combinedAsks([{...items[0],question:' '}]),/question/);
});
test('note and folder moves retain queued snapshots while deletion removes only owned entries',()=>{
 const one={id:'one',notePath:'Folder/Note.md',selection:'Snapshot.',question:'Why?'},other={...one,id:'two',notePath:'Folder2/Note.md'};
 const moved=relocateQueuedAsks([one,other],'Folder','Moved');assert.equal(moved[0].notePath,'Moved/Note.md');assert.equal(moved[1],other);
 assert.deepEqual(relocateQueuedAsks(moved,'Moved'),[other]);assert.equal(one.notePath,'Folder/Note.md');
});
