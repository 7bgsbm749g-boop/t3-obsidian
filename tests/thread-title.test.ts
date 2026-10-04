import {test} from 'node:test';
import assert from 'node:assert/strict';
import {noteThreadTitle,threadTitleGeneration} from '../thread-title';

test('default generates only whole untitled basenames and preserves named notes',()=>{
  for(const path of ['Untitled.md','Folder/Untitled 1.md','Untitled 202.md',' untitled 2 .md'])assert.equal(noteThreadTitle(path,'untitled-only'),'New thread');
  for(const name of ['Untitled ideas','Untitled 1 draft','1','Planning.md appendix'])assert.equal(noteThreadTitle(`Folder/${name}.md`,'untitled-only'),name);
  assert.equal(noteThreadTitle('Folder/'+ 'a'.repeat(180)+'.md','untitled-only'),'a'.repeat(160));
});

test('always mode and note-free conversations use T3 generation',()=>{
  assert.equal(noteThreadTitle('Named note.md','always'),'New thread');
  assert.equal(noteThreadTitle(undefined,'untitled-only'),'New thread');
  for(const value of [undefined,null,'bad',true])assert.equal(threadTitleGeneration(value),'untitled-only');
  assert.equal(threadTitleGeneration('always'),'always');
});
