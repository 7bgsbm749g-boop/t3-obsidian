import {test} from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {EditorState} from '@codemirror/state';
import {HtmlResultIndex} from '../html-result-index';
import {htmlResultBlocks,renderHtmlResult} from '../html-results';
import {reference} from './fixtures/html-result';

const block=renderHtmlResult(reference);
function check(state:EditorState,index:HtmlResultIndex){assert.deepEqual(index.blocks,htmlResultBlocks(state.doc.toString()),JSON.stringify(state.doc.toString()));}

test('incremental HTML references match full Markdown parsing across code, list and HTML contexts',()=>{
 const pieces=['Before\n\n','- a\n\n','1. a\n\n','> quote\n\n','    code\n\n','```md\n','~~~~\n','````md\n',
  '<div>\n\n','<div>\nword\n','<pre>\n','<!--\n','<?html\n','<![CDATA[\n','<script>\n','<custom>\n\n',
  '[link]: /url\n\n','`inline\n','\t\n','😀 café\n\n'];
 const forms=[block,'   '+block,block.split('\n').map(line=>'   '+line).join('\n'),
  block.split('\n').map(line=>'> '+line).join('\n'),block.replace('```t3-html','```t3-html extra'),block+'  \t',
  block.replace(/```$/,'````'),block.slice(0,-3),block.replace('```t3-html','~~~t3-html').replace(/```$/,'~~~')];
 for(const prefix of pieces)for(const form of forms){
  let state=EditorState.create({doc:prefix+form+'\n\nAfter'}),index=HtmlResultIndex.create(state.doc);check(state,index);
  for(const insert of ['x','\n','```md\n']){
   const transaction=state.update({changes:{from:0,insert}});state=transaction.state;index=index.update(transaction.changes,state.doc);check(state,index);
   const undo=state.update({changes:{from:0,to:insert.length,insert:''}});state=undo.state;index=index.update(undo.changes,state.doc);check(state,index);
  }
 }
});

test('line joins, fence edits, multiple ranges and restoration match fresh reference discovery',()=>{
 let state=EditorState.create({doc:'Before\n\n'+block+'\n\n<div>\n\n   '+block+'\n\nAfter'}),index=HtmlResultIndex.create(state.doc);
 let seed=6193;
 for(let step=0;step<120;step++){
  seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  const from=seed%(state.doc.length+1),insert=['x','\n','`','~',' ','- ','<div>','</pre>'][step%8];
  const transaction=state.update({changes:step%20===0?[{from:0,insert:block+'\n\n'},{from:state.doc.length,insert:'\n\n'+block}]:{from,to:Math.min(state.doc.length,from+step%4),insert}});
  state=transaction.state;index=index.update(transaction.changes,state.doc);check(state,index);
 }
});

test('distant fence and HTML context edits invalidate reused fragments around a reference',()=>{
 const body='Synthetic paragraph with `code` and **bold**.\n\n'.repeat(300);
 for(const [prefix,from,to,insert] of [['Before\n\n',0,6,'```md'],['<pre>\n',1,4,'div']] as const){
  let state=EditorState.create({doc:prefix+body+block+'\n\nAfter'}),index=HtmlResultIndex.create(state.doc);check(state,index);
  const original=state.doc.sliceString(from,to),transaction=state.update({changes:{from,to,insert}});
  state=transaction.state;index=index.update(transaction.changes,state.doc);check(state,index);
  assert.equal(index.blocks.length,prefix.startsWith('<')?1:0);
  const undo=state.update({changes:{from,to:from+insert.length,insert:original}});
  state=undo.state;index=index.update(undo.changes,state.doc);check(state,index);assert.equal(index.blocks.length,prefix.startsWith('<')?0:1);
 }
});

test('indented multiline payloads retain full-parser size limits and closing whitespace',()=>{
 const payload=JSON.stringify(reference,null,2)+'\n'.repeat(2500);
 const source='   ```t3-html\n'+payload.split('\n').map(line=>'   '+line).join('\n')+'\n```'+' \t'.repeat(100);
 let state=EditorState.create({doc:source}),index=HtmlResultIndex.create(state.doc);check(state,index);assert.equal(index.blocks.length,1);
 const transaction=state.update({changes:{from:0,insert:'\n'}});state=transaction.state;index=index.update(transaction.changes,state.doc);check(state,index);assert.equal(index.blocks.length,1);
});

test('ordinary edits reuse validated references and keep 52 KiB notes below the original typing delay',()=>{
 const prose='Synthetic **paragraph**, `code`, and [link](https://example.test).\n\n'.repeat(810);
 let state=EditorState.create({doc:prose+'\n\n'+block}),index=HtmlResultIndex.create(state.doc);const original=index.blocks[0].reference,samples:number[]=[];
 for(let key=0;key<20;key++){
  const started=performance.now(),transaction=state.update({changes:{from:0,insert:'x'}});state=transaction.state;index=index.update(transaction.changes,state.doc);samples.push(performance.now()-started);
  assert.equal(index.blocks[0].reference,original,'unchanged reference JSON must not be reparsed');
 }
 const median=samples.sort((a,b)=>a-b)[10];assert.ok(median<50,`Median incremental editor work was ${median}ms; original full parsing exceeded 200ms`);check(state,index);
});
