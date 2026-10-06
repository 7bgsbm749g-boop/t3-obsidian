import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EditorState} from '@codemirror/state';
import {hiddenInlineMarkerExtension,inlineMarkerRegex} from '../inline-markers';

const id='25158e9b-7a9b-40bb-9866-e777549652b4';
const start=`<!-- t3-inline:start:${id} -->`;
const end=`<!-- t3-inline:end:${id} -->`;

test('only complete T3 tracking comments are hidden, including markers beside ordinary text',()=>{
  const regex=inlineMarkerRegex();
  assert.equal(regex.test(start),true);
  regex.lastIndex=0;assert.equal(regex.test(`A ${start}`),true);
  regex.lastIndex=0;assert.equal(regex.test(`${end}User text`),true);
  regex.lastIndex=0;assert.equal(regex.test('<!-- an ordinary note comment -->'),false);

  const initial=`Question\n${start}\n**T3 · Working**\n${end}\n<!-- an ordinary note comment -->`;
  const extension=hiddenInlineMarkerExtension() as any[];
  const plugin=extension[0];
  const state=EditorState.create({doc:initial});
  const view=(current:EditorState)=>({state:current,visibleRanges:[{from:0,to:current.doc.length}],viewport:{from:0,to:current.doc.length}});
  const instance=plugin.create(view(state));
  const ranges=()=>{const result:Array<[number,number]>=[];instance.decorations.between(0,instance.decorations.length??10000,(from:number,to:number)=>{result.push([from,to]);});return result;};
  assert.deepEqual(ranges().map(([from,to])=>initial.slice(from,to)),[start,end]);

  const added='\n'+start+'\n';
  const transaction=state.update({changes:{from:state.doc.length,to:state.doc.length,insert:added}});
  instance.update({docChanged:true,viewportMoved:false,changes:transaction.changes,view:view(transaction.state)});
  const updated=transaction.state.doc.toString();
  assert.deepEqual(ranges().map(([from,to])=>updated.slice(from,to)),[start,end,start]);
});

test('question metadata is hidden without hiding ordinary note comments',()=>{
  const regex=inlineMarkerRegex();assert.equal(regex.test('<!-- t3-question:start:%7B%22environmentId%22%3A%22environment%22%7D -->'),true);
  regex.lastIndex=0;assert.equal(regex.test('<!-- t3-question:start:ordinary user text -->'),false);
  regex.lastIndex=0;assert.equal(regex.test('<!-- t3-approval:start:%7B%22environmentId%22%3A%22environment%22%7D -->'),true);
  regex.lastIndex=0;assert.equal(regex.test('<!-- t3-approval:start:ordinary user text -->'),false);
});
