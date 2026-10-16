import {test} from 'node:test';
import assert from 'node:assert/strict';
import {captureCursorInsertion,cursorInsertionOffset,resolveCursorInsertion} from '../cursor-insertion';
import {responseAnchor} from '../native-response-projection';
import {initialRegion} from '../inline-thread';

test('a cursor between blocks, at paragraph edges, or on a blank line stays there',()=>{
  const document='First paragraph.\n\nSecond paragraph.\n\n';
  for(const offset of [0,'First paragraph.'.length,document.indexOf('Second'),document.length-1,document.length])assert.equal(cursorInsertionOffset(document,offset),offset);
  assert.equal(cursorInsertionOffset('First\n  \nSecond',7),7);
});

test('a cursor inside a wrapped paragraph moves past the complete paragraph',()=>{
  const paragraph='First line with `inline code`.\nSecond line of the same paragraph.';
  const document=paragraph+'\n\nLater paragraph.';
  for(const offset of [1,document.indexOf('code'),document.indexOf('\n'),document.indexOf('Second')])assert.equal(cursorInsertionOffset(document,offset),paragraph.length);
});

test('a reply stays outside Markdown containers and note properties',()=>{
  for(const block of ['```ts\nconst x = 1;\n```','~~~\ncode\n~~~','    indented code\n    more code','- First item\n  continued\n- Second item','> First quote\n> Continued quote','| A | B |\n| - | - |\n| 1 | 2 |']){
    const document=block+'\n\nLater paragraph.';
    assert.equal(cursorInsertionOffset(document,block.indexOf('\n')+2),block.length,block);
  }
  for(const eol of ['\n','\r\n']){
    const properties=['---','title: Test','---',''].join(eol),document=properties+eol+'Body';
    assert.equal(cursorInsertionOffset(document,0),properties.length);
    assert.equal(cursorInsertionOffset(document,properties.indexOf('Test')),properties.length);
  }
  assert.throws(()=>cursorInsertionOffset('Before\n\n```ts\nUnclosed',17),/unclosed Markdown code fence/);
  assert.equal(cursorInsertionOffset('Before\n\n```ts\nUnclosed',0),0);
});

test('insertion cannot split a retained response boundary',()=>{
  const id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  for(const block of [responseAnchor(id),initialRegion(id).text.trim()]){
    const document='Before\n\n'+block+'\n\nAfter';
    const offset=cursorInsertionOffset(document,document.indexOf(block)+2);
    assert.ok(offset>=document.indexOf(block)+block.length);
    assert.ok(offset<document.indexOf('After'));
  }
});

test('the captured position survives unrelated edits and rejects changes at its boundary',()=>{
  const document='First paragraph.\n\nSecond paragraph.\n\nLast paragraph.',cursor=document.indexOf('Second')-1,insertion=captureCursorInsertion(document,cursor);
  assert.equal(resolveCursorInsertion(document,insertion),cursor);
  const edited='New introduction.\n\n'+document.replace('Last paragraph.','Changed final paragraph.');
  assert.equal(resolveCursorInsertion(edited,insertion),cursor+'New introduction.\n\n'.length);
  assert.throws(()=>resolveCursorInsertion(document.slice(0,cursor)+'New text'+document.slice(cursor),insertion),/changed at the send cursor/);
  assert.throws(()=>resolveCursorInsertion('Replaced note',insertion),/changed at the send cursor/);
  for(const cursor of [-1,NaN,document.length+1])assert.throws(()=>captureCursorInsertion(document,cursor),/cursor/);
});
