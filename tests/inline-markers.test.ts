import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EditorState} from '@codemirror/state';
import {hiddenInlineMarkerExtension,inlineMarkerRegex} from '../inline-markers';
import {responseBindingComment} from '../local-response-binding';
import {containerBody} from '../response-container';
import {runImportReceipt} from '../run-import-receipt';

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

test('long legacy binding metadata stays hidden while its native response is displayed',()=>{
  const request:any={version:4,localOnly:true,nativeProjection:true,responseContainer:true,id,initialOwner:id,vaultId:'vault',notePath:'Test.md',host:{environmentId:'env',workspaceRoot:'/test',directory:'.obsidian/t3-code/inline/v1'},threadId:id,projectId:id,messageId:id,threadEnvironmentId:'env',initialHash:'0'.repeat(64),createdAt:'2026-10-15T00:00:00Z',initialInput:{messageId:id,text:'Synthetic prompt '.repeat(1500)}};
  const comment=responseBindingComment(request),document='Before\n'+comment+'\n'+containerBody(id,'Visible live response')+'\nAfter';
  const extension=hiddenInlineMarkerExtension() as any[],state=EditorState.create({doc:document}),view={state,visibleRanges:[{from:0,to:document.length}],viewport:{from:0,to:document.length}};
  const plugin=extension[0].create(view),hidden:string[]=[];plugin.decorations.between(0,document.length,(from:number,to:number)=>hidden.push(document.slice(from,to)));
  assert.ok(hidden.includes(comment));assert.ok(comment.length>10000);
  const example=EditorState.create({doc:'```md\n'+document+'\n```'}),literal=extension[0].create({...view,state:example,visibleRanges:[{from:0,to:example.doc.length}],viewport:{from:0,to:example.doc.length}});
  assert.equal(literal.decorations.size,0,'Literal metadata examples must remain visible');
});
test('import receipts are hidden in the editor while ordinary comments remain visible',()=>{
  const receipt=runImportReceipt({version:1,bindingId:id,messageId:id,threadId:id,projectId:id,environmentId:'env',runId:'run:exact'}),document='Before\n'+receipt+'\n<!-- ordinary -->';
  const state=EditorState.create({doc:document}),extension=hiddenInlineMarkerExtension() as any[],plugin=extension[0].create({state,visibleRanges:[{from:0,to:document.length}],viewport:{from:0,to:document.length}}),hidden:string[]=[];
  plugin.decorations.between(0,document.length,(from:number,to:number)=>hidden.push(document.slice(from,to)));assert.deepEqual(hidden,[receipt]);
});
