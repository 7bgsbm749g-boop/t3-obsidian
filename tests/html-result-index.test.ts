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

test('definitions and empty containers match Remark on creation, context edits and restoration',()=>{
 const contexts=[
  ['[a]: /x\ntext\n','[a]: /x\n<span>\n',1],
  ['>\ntext\n','>\n<span>\n',0],
 ] as const;
 for(const [before,after,count] of contexts){
  let state=EditorState.create({doc:after+block}),index=HtmlResultIndex.create(state.doc);check(state,index);assert.equal(index.blocks.length,count);
  state=EditorState.create({doc:before+block});index=HtmlResultIndex.create(state.doc);check(state,index);
  for(const prefix of [after,before,after,before]){
   const transaction=state.update({changes:{from:0,to:state.doc.length-block.length,insert:prefix}});
   state=transaction.state;index=index.update(transaction.changes,state.doc);check(state,index);
  }
 }
});

test('flow-only context agrees with full Remark across HTML types, definitions and containers',()=>{
 const prefixes=['','[a]: /x\n','[a]:\n  /x\n','[a]: /x\n  "title"\n','[a]: /x\n\n',
  '>\n','> quote\n','- \n','- item\n','1. item\n','paragraph\n','paragraph\n\n','    code\n','```md\n','<div>\n','<!--\n'];
 const lines=['<span>','<custom attr=">">','</custom>','<svg:path>','<div>','<pre>','<!--','<?target','<![CDATA[','<!DOCTYPE html>','<script type="x">','<textarea>','plain'];
 for(const prefix of prefixes)for(const line of lines)for(const gap of ['','\n']){
  const before=prefix+'text\n'+gap,after=prefix+line+'\n'+gap;
  let state=EditorState.create({doc:'Before\n\n'+after+block+'\n\nAfter\n\n'+block}),index=HtmlResultIndex.create(state.doc);check(state,index);
  for(const context of [before,after,before]){
   const transaction=state.update({changes:{from:8,to:state.doc.toString().indexOf(block),insert:context}});
   state=transaction.state;index=index.update(transaction.changes,state.doc);check(state,index);
  }
 }
});

test('indent edits inside a section can extend the preceding list or indented code',()=>{
 for(const prefix of ['- item\n\n','    code\n\n']){
  const original=prefix+' x\n\n   '+block;
  let state=EditorState.create({doc:original}),index=HtmlResultIndex.create(state.doc);check(state,index);
  const from=prefix.length+1,transaction=state.update({changes:{from,insert:'   '}});
  state=transaction.state;index=index.update(transaction.changes,state.doc);check(state,index);
  const undo=state.update({changes:{from,to:from+3,insert:''}});state=undo.state;index=index.update(undo.changes,state.doc);check(state,index);
 }
});

test('restart boundaries survive edits on blanks, multiple ranges and unclosed containers',()=>{
 const paragraphs='A paragraph.\n\n'.repeat(80),original='Before\n\n'+block+'\n\n'+paragraphs+block+'\n\nAfter';
 for(const [from,to,insert] of [[6,8,'\n'],[7,8,'x'],[8,8,' '],[0,6,'<pre>'],[0,6,'<!--'],[0,6,'````'],[0,6,'- item']] as const){
  let state=EditorState.create({doc:original}),index=HtmlResultIndex.create(state.doc);
  const transaction=state.update({changes:{from,to,insert}});state=transaction.state;index=index.update(transaction.changes,state.doc);check(state,index);
  const undo=state.update({changes:{from,to:from+insert.length,insert:original.slice(from,to)}});state=undo.state;index=index.update(undo.changes,state.doc);check(state,index);
 }
 let state=EditorState.create({doc:original}),index=HtmlResultIndex.create(state.doc);
 const transaction=state.update({changes:[{from:0,to:6,insert:'<pre>'},{from:state.doc.length-5,insert:'</pre>\n\n'}]});
 state=transaction.state;index=index.update(transaction.changes,state.doc);check(state,index);
});

test('blank runs and append edits keep container continuation context',()=>{
 for(const prefix of ['- item','    code','Before'])for(const blanks of [2,3,6]){
  const original=prefix+'\n'.repeat(blanks)+' x\n\n   '+block+'\n'.repeat(blanks);
  let state=EditorState.create({doc:original}),index=HtmlResultIndex.create(state.doc);check(state,index);
  for(const [from,to,insert] of [[prefix.length+blanks+1,prefix.length+blanks+1,'   '],[state.doc.length,state.doc.length,'    appended']] as const){
   const transaction=state.update({changes:{from,to,insert}});state=transaction.state;index=index.update(transaction.changes,state.doc);check(state,index);
   const undo=state.update({changes:{from,to:from+insert.length,insert:original.slice(from,to)}});state=undo.state;index=index.update(undo.changes,state.doc);check(state,index);
  }
 }
});

test('deterministic structural edit round trips retain full-parser reference ranges',()=>{
 const pieces=['Paragraph.\n\n','[a]: /x\n<span>\n','>\n<span>\n','- item\n\n x\n\n','    code\n\n','<pre>\n\nraw\n\n</pre>\n\n','<!-- closed -->\n\n'];
 const original=pieces.map((piece,index)=>piece+(index%2?'   ':'')+block+'\n\n').join('');
 let state=EditorState.create({doc:original}),index=HtmlResultIndex.create(state.doc),seed=4271;check(state,index);
 for(let step=0;step<240;step++){
  seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  const from=seed%(state.doc.length+1),to=Math.min(state.doc.length,from+step%9),insert=['<span>','\n','   ','- ','> ','```md\n','</pre>','[b]: /x\n'][step%8];
  const transaction=state.update({changes:{from,to,insert}});state=transaction.state;index=index.update(transaction.changes,state.doc);check(state,index);
  const undo=state.update({changes:{from,to:from+insert.length,insert:original.slice(from,to)}});state=undo.state;index=index.update(undo.changes,state.doc);check(state,index);
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

test('distant fence and HTML context edits invalidate cached sections around a reference',()=>{
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

test('ordinary edits in long paragraphs reuse exact context without a full-note typing delay',()=>{
 const prose='Letters with **bold**, `code`, and <span>inline</span> text. '.repeat(950);
 let state=EditorState.create({doc:prose+'\n\n'+block}),index=HtmlResultIndex.create(state.doc);const original=index.blocks[0].reference,samples:number[]=[];
 for(let key=0;key<24;key++){
  const from=key%3===0?0:key%3===1?prose.length/2|0:prose.length-1;
  const insert=['x','`','<div>'][key%3],started=performance.now(),transaction=state.update({changes:{from,insert}});
  state=transaction.state;index=index.update(transaction.changes,state.doc);samples.push(performance.now()-started);
  assert.equal(index.blocks[0].reference,original);check(state,index);
  const undo=state.update({changes:{from,to:from+insert.length,insert:''}});state=undo.state;index=index.update(undo.changes,state.doc);check(state,index);
 }
 const median=samples.sort((a,b)=>a-b)[12];assert.ok(median<50,`Long-paragraph edits took ${median}ms`);
 // A change to the initial block marker must leave the ordinary-typing path.
 const transaction=state.update({changes:{from:0,to:1,insert:'[a]: /x\n<span>\n'}});state=transaction.state;index=index.update(transaction.changes,state.doc);check(state,index);
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
