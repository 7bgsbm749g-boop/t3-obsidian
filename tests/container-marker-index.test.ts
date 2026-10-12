import {test} from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {EditorState,type StateField} from '@codemirror/state';
import {ContainerMarkerIndex} from '../container-marker-index';
import {hiddenInlineMarkerExtension,type ContainerMarkerDecorations} from '../inline-markers';
import {containerBody,containerStart,containerEnd,responseBoundaries} from '../response-container';
import {markdownCodeCacheStatus} from '../reply-html';

const id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const marker=containerBody(id,'A reply.');
const shape=(boundaries:readonly any[])=>boundaries.map(({id,kind,from,to,text}:any)=>({id,kind,from,to,text}));
function check(source:string,index:ContainerMarkerIndex){assert.deepEqual(shape(index.boundaries),shape(responseBoundaries(source).filter(token=>token.format==='container')));}

test('incremental marker visibility preserves CommonMark code and native HTML code examples',()=>{
  const documents=[marker,'Before\n'+marker+'\nAfter','```md\n'+marker+'\n```\n\n'+marker,'~~~\n'+marker+'\n~~~\n\n'+marker,
    marker.split('\n').map(line=>'    '+line).join('\n')+'\n\n'+marker,'`'+marker+'`\n\n'+marker,'``'+marker+'``\n\n'+marker,
    '<pre><code>'+marker+'</code></pre>\n\n'+marker,'<code class="example"\n data-label="literal">'+marker+'</code>\n\n'+marker,
    '> ```md\n'+marker.split('\n').map(line=>'> '+line).join('\n')+'\n> ```\n\n'+marker,
    '\\'+marker+'\n\n'+marker];
  for(const source of documents)check(source,ContainerMarkerIndex.create(EditorState.create({doc:source}).doc));
});

test('marker edits, line joins, undo and code-context edits update the complete hidden ranges',()=>{
  let state=EditorState.create({doc:'Before\n\n'+marker+'\n\nAfter'}),index=ContainerMarkerIndex.create(state.doc);
  const edit=(from:number,to:number,insert:string)=>{const transaction=state.update({changes:{from,to,insert}});state=transaction.state;index=index.update(transaction.changes,state.doc);check(state.doc.toString(),index);};
  check(state.doc.toString(),index);
  edit(0,0,'Ordinary typing ');edit(0,0,'```md\n');edit(state.doc.length,state.doc.length,'\n```');
  edit(0,6,'');edit(state.doc.length-4,state.doc.length,'');
  edit(state.doc.toString().indexOf('A reply.'),state.doc.toString().indexOf('A reply.')+8,'Changed\nreply.');
  const start=state.doc.toString().indexOf(containerStart(id));edit(start,start,'\\');edit(start,start+1,'');
  const close=state.doc.toString().indexOf(containerEnd);edit(close,close+containerEnd.length,'');edit(close,close,containerEnd);
  edit(0,0,marker+'\n\n');edit(0,marker.length+2,'');
});

test('typing in a multiline HTML tag cannot hide a literal container example',()=>{
  let state=EditorState.create({doc:'<code\n title="example"\n data-label="literal"\n\n'+marker+'\n</code>'}),index=ContainerMarkerIndex.create(state.doc);
  check(state.doc.toString(),index);
  const position=state.doc.toString().indexOf('\n\n'),transaction=state.update({changes:{from:position,insert:'>'}});
  state=transaction.state;index=index.update(transaction.changes,state.doc);check(state.doc.toString(),index);
});

test('multiple changed ranges and successive structural edits match fresh boundary discovery',()=>{
  let state=EditorState.create({doc:'Before\n\n'+marker+'\n\n<pre><code>'+marker+'</code></pre>\n\nAfter'}),index=ContainerMarkerIndex.create(state.doc);
  let seed=12345;
  for(let step=0;step<60;step++){
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    const from=seed%(state.doc.length+1),insert=['x','\n','`','~','\\','<code>','</code>',':::'][step%8];
    const change=state.update({changes:step===0?[{from:0,insert:'Ordinary '},{from:state.doc.length,insert:'\nTail'}]:{from,to:Math.min(state.doc.length,from+(step%3)),insert}});
    state=change.state;index=index.update(change.changes,state.doc);check(state.doc.toString(),index);
  }
});

test('large ordinary edits do not invoke the full-document CommonMark code-range query',()=>{
  const unit='Synthetic paragraph with a `code span`.\n\n```ts\nconst value=123;\n```\n\n';
  const body=unit.repeat(Math.ceil(480000/unit.length)).slice(0,480000);
  for(const source of [body,`<!-- t3-inline:start:${id} -->\n${body}\n<!-- t3-inline:end:${id} -->`,containerBody(id,body)]){
    const extension=hiddenInlineMarkerExtension() as any[],field=extension[2] as StateField<ContainerMarkerDecorations>;
    const before=markdownCodeCacheStatus().sourceParses;
    let state=EditorState.create({doc:source,extensions:extension}),samples:number[]=[];
    for(let key=0;key<12;key++){const start=performance.now();state=state.update({changes:{from:0,insert:'x'}}).state;samples.push(performance.now()-start);}
    assert.equal(markdownCodeCacheStatus().sourceParses,before,'Typing must not call the full-document code-range parser');
    const ordered=samples.sort((a,b)=>a-b);assert.ok(ordered[6]<100,`Median editor work exceeded its 100ms regression ceiling: ${ordered[6]}ms`);
    assert.equal(state.field(field).decorations.size,source.startsWith(':::')?2:0);
  }
});
