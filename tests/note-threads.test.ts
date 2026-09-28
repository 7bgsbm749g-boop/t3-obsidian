import {test} from 'node:test';
import assert from 'node:assert/strict';
import {activeNoteThread,loadNoteThreads,mergeNoteThreads,previousNoteThreads,type NoteThread} from '../note-threads';

const first:NoteThread={notePath:'Notes/a.md',threadId:'one',projectId:'project',workspaceRoot:'/vault',connectionId:'connection',selectedAt:'2026-09-27T10:00:00.000Z'};

test('a later selection becomes active while earlier confirmed threads remain available',()=>{
  const second={...first,threadId:'two',selectedAt:'2026-09-28T10:00:00.000Z'};
  const merged=mergeNoteThreads([first],[second]);
  assert.equal(activeNoteThread(merged,first.notePath)?.threadId,'two');
  assert.deepEqual(previousNoteThreads(merged,first.notePath).map(entry=>entry.threadId),['two','one']);
});

test('a deletion tombstone wins over an older synced copy and malformed settings are ignored',()=>{
  const deleted={...first,deletedAt:'2026-09-28T12:00:00.000Z'};
  const merged=mergeNoteThreads([deleted],[first]);
  assert.equal(activeNoteThread(merged,first.notePath),undefined);
  assert.equal(loadNoteThreads([{},first]).length,1);
});
