import {test} from 'node:test';
import assert from 'node:assert/strict';
import {lastUsedNoteThread,loadNoteThreads,mergeNoteThreads,mutateNoteThreads,previousNoteThreads,type NoteThread} from '../note-threads';

const first:NoteThread={notePath:'Notes/a.md',threadId:'one',projectId:'project',workspaceRoot:'/vault',connectionId:'connection',selectedAt:'2026-09-27T10:00:00.000Z'};

test('a later selection becomes active while earlier confirmed threads remain available',()=>{
  const second={...first,threadId:'two',selectedAt:'2026-09-28T10:00:00.000Z'};
  const merged=mergeNoteThreads([first],[second]);
  assert.equal(lastUsedNoteThread(merged,first.notePath)?.threadId,'two');
  assert.deepEqual(previousNoteThreads(merged,first.notePath).map(entry=>entry.threadId),['two','one']);
});

test('a deletion tombstone wins over an older synced copy and malformed settings are ignored',()=>{
  const deleted={...first,deletedAt:'2026-09-28T12:00:00.000Z'};
  const merged=mergeNoteThreads([deleted],[first]);
  assert.equal(lastUsedNoteThread(merged,first.notePath),undefined);
  assert.equal(loadNoteThreads([{},first]).length,1);
});

test('round-trip note and folder moves survive reload, stale tombstones and clock rollback',()=>{
  for(const folder of [false,true]){
    const before=folder?'Notes':first.notePath,after=folder?'Moved':'Moved/a.md';
    const moved=mutateNoteThreads([first],before,after,folder,1);
    const roundtrip=loadNoteThreads(mutateNoteThreads(moved,after,before,folder,0));
    const merged=mergeNoteThreads(roundtrip,moved,[first]);
    assert.equal(lastUsedNoteThread(merged,first.notePath)?.threadId,first.threadId);
    assert.equal(lastUsedNoteThread(merged,first.notePath)?.selectedAt,first.selectedAt,'Moves must not change previous-thread ordering');
    const deleted=mutateNoteThreads(merged,before,undefined,folder,0);assert.equal(lastUsedNoteThread(mergeNoteThreads(deleted,roundtrip),first.notePath),undefined);
  }
});
