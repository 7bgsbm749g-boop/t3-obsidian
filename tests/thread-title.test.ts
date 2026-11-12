import {test} from 'node:test';
import assert from 'node:assert/strict';
import {noteThreadTitle,promptThreadTitle,threadTitleGeneration} from '../src/conversations/thread-title';
import {obsidianFooter} from '../src/notes/obsidian-prompt';

test('default generates only whole untitled basenames and preserves named notes',()=>{
  for(const path of ['Untitled.md','Folder/Untitled 1.md','Untitled 202.md',' untitled 2 .md'])assert.equal(noteThreadTitle(path,'untitled-only'),'New thread');
  for(const name of ['Untitled ideas','Untitled 1 draft','1','Planning.md appendix'])assert.equal(noteThreadTitle(`Folder/${name}.md`,'untitled-only'),name);
  assert.equal(noteThreadTitle('Folder/'+ 'a'.repeat(180)+'.md','untitled-only'),'a'.repeat(160));
});

test('prompt titles normalize whitespace, omit delivery metadata and truncate by Unicode character',()=>{
  assert.equal(promptThreadTitle('  Plan\n a\tvegetable garden  '+obsidianFooter('Synthetic','Untitled.md')),'Plan a vegetable garden');
  assert.equal(promptThreadTitle('a'.repeat(50)),'a'.repeat(50));
  assert.equal(promptThreadTitle('a'.repeat(51)),'a'.repeat(50)+'...');
  assert.equal(promptThreadTitle('🌱'.repeat(51)),'🌱'.repeat(50)+'...');
  assert.equal(promptThreadTitle('New thread'),'New thread');
  assert.equal(promptThreadTitle(' \n\t '),'New thread');
});

test('prompt titles hide image context URLs and use attachment labels for image-only sends',()=>{
  const image='[garden.png](t3-context://v1/image/asset)';
  assert.equal(promptThreadTitle('Plan '+image+' tomorrow'),'Plan tomorrow');
  assert.equal(promptThreadTitle(image+obsidianFooter('Synthetic','Untitled.md')),'Attached image');
  assert.equal(promptThreadTitle('[garden \\[draft\\].png](t3-context://v1/image/asset)'),'Attached image');
  assert.equal(promptThreadTitle(image+' [other](t3-context://v1/image/other)'),'Attached images');
  assert.equal(promptThreadTitle('',[{type:'image',name:'garden.png'}]),'Attached image');
  assert.equal(promptThreadTitle('',[{type:'image',name:'one.png'},{type:'image',name:'two.png'}]),'Attached images');
  assert.equal(promptThreadTitle('Use [selected code](t3-context://v1/selection/code)'),'Use selected code');
});

test('always mode and note-free conversations use T3 generation',()=>{
  assert.equal(noteThreadTitle('Named note.md','always'),'New thread');
  assert.equal(noteThreadTitle(undefined,'untitled-only'),'New thread');
  for(const value of [undefined,null,'bad',true])assert.equal(threadTitleGeneration(value),'untitled-only');
  assert.equal(threadTitleGeneration('always'),'always');
});
