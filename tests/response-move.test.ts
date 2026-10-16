import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EditorState} from '@codemirror/state';
import {history,undo,redo,undoDepth} from '@codemirror/commands';
import {movedResponse} from '../response-move';
import {responseAnchor,responseRegion,renderResponse} from '../native-response-projection';
import {NativeResponseView} from '../native-response-view';
import {applySavedEdits} from '../coordinated-merge';
import {renderResponseToolGroup} from '../response-tools';
import {withLocalResponseBinding,localResponseBindings} from '../local-response-binding';

const id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',other='bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee',key='thread:active';
const body=(text='First streamed paragraph.')=>`> [!t3-progress]+ **Thread · Working** <span class="send-to-t3-fold-key" data-t3-fold="${key}"></span>\n>\n> ${text}`;
const original=`First paragraph.\n\n${responseAnchor(id)}\n\nMiddle paragraph.\n\n${responseAnchor(other)}\n\nLast paragraph.\n`;
function editor(document=original){
  let disk=document,saves=0;
  const file={path:'Note.md'},view:any={file,getMode:()=> 'source',getState:()=>({source:false}),getViewData:()=>cm.state.doc.toString(),setViewData:()=>assert.fail('Use the native editor'),requestSave:()=>{saves++;},save:async()=>{disk=view.getViewData();}};
  const adapter=new NativeResponseView(view,document,conflict=>assert.fail(conflict.reason),async()=>disk);
  const cm:any={state:EditorState.create({doc:document,extensions:[adapter.extension(),history()]}),dispatch:(spec:any)=>{const tr=spec.startState?spec:cm.state.update(spec);if(!tr.isUserEvent('undo')&&!tr.isUserEvent('redo'))assert.equal(tr.scrollIntoView,false);cm.state=tr.state;}};
  view.editor={cm,getValue:()=>cm.state.doc.toString()};
  const responses=(text='First streamed paragraph.',movable=true)=>[{id,body:body(text),movable},{id:other,body:'Other response.',movable:true}];
  adapter.setResponses(responses());
  return {view,adapter,cm,saves:()=>saves,disk:()=>disk,stream:(text:string,movable=true)=>adapter.setResponses(responses(text,movable)),text:()=>cm.state.doc.toString()};
}

test('moving the saved anchor keeps every ordinary byte and has an exact inverse',()=>{
  for(const at of [0,original.indexOf('Middle')+3,original.length]){
    const moved=movedResponse(original,id,at)!;
    assert.equal(applySavedEdits(original,moved.edits),moved.text);
    assert.equal(applySavedEdits(moved.text,moved.inverse),original);
    assert.equal(moved.text.split(responseAnchor(id)).length,2);
    assert.ok(responseRegion(moved.text,other));
    assert.equal(moved.text.replace(responseAnchor(id),'').replace(/\n/g,''),original.replace(responseAnchor(id),'').replace(/\n/g,''));
    if(at===original.length)assert.ok(moved.text.indexOf(responseAnchor(id))>moved.text.indexOf('Last paragraph.'));
  }
});
test('drops snap after complete paragraphs and containers, never into a live reply',()=>{
  const text=`Wrapped paragraph\nsecond source line.\n\n${responseAnchor(id)}\n\n~~~\nCode\n~~~\n\nAfter\n`;
  const inParagraph=movedResponse(text,id,4)!;assert.ok(inParagraph.text.indexOf('second source line.')<inParagraph.text.indexOf(responseAnchor(id)));
  const inCode=movedResponse(text,id,text.indexOf('Code')+2)!;assert.ok(inCode.text.indexOf('~~~',inCode.text.indexOf('Code'))<inCode.text.indexOf(responseAnchor(id)));
  const region=responseRegion(text,id)!;assert.equal(movedResponse(text,id,region.from+5),undefined);
  assert.throws(()=>movedResponse(text+responseAnchor(id),id,0),/duplicate/i);
  assert.throws(()=>movedResponse(text.replace(responseAnchor(id),renderResponse(id,'Unexpected saved body')),id,0),/changed/);
});
test('a legacy binding descriptor moves with its exact saved response',()=>{
  const request:any={version:4,id,localOnly:true,nativeProjection:true,responseContainer:true,initialOwner:other,vaultId:'vault',host:{environmentId:'host',workspaceRoot:'/vault',directory:'.obsidian/t3-code/inline/v1'},notePath:'Note.md',threadId:id,messageId:other,projectId:'project',threadEnvironmentId:'host',createdAt:'2026-10-16T00:00:00Z',initialHash:'0'.repeat(64)};
  const source=withLocalResponseBinding(original,request),moved=movedResponse(source,id,source.length)!;
  assert.equal(localResponseBindings(moved.text).length,1);assert.equal(applySavedEdits(moved.text,moved.inverse),source);
});

test('one move supports native Undo and Redo while new tokens keep their current content',async()=>{
  const h=editor(),saved=h.adapter.saved();
  assert.equal(h.adapter.moveControl(key),id);assert.equal(h.adapter.moveResponse(key,h.text().length),true);
  const moved=h.adapter.saved();assert.ok(moved.indexOf(responseAnchor(id))>moved.indexOf('Last paragraph.'));assert.equal(undoDepth(h.cm.state),1);
  h.stream('A much longer current response. '.repeat(30));
  assert.equal(undo(h.cm),true);assert.equal(h.adapter.saved(),saved);assert.match(h.text(),/A much longer current response/);
  h.stream('Latest response after Undo.');assert.equal(redo(h.cm),true);assert.equal(h.adapter.saved(),moved);assert.match(h.text(),/Latest response after Undo/);
  assert.doesNotMatch(h.adapter.saved(),/Latest response/);await h.view.save();assert.equal(h.disk(),moved);h.adapter.dispose();
});
test('ordinary edits between the old and new positions survive move Undo and Redo',()=>{
  const h=editor();h.adapter.moveResponse(key,h.text().length);
  const at=h.text().indexOf('Middle');h.cm.dispatch({changes:{from:at,to:at+6,insert:'User middle'}});
  h.stream('Stream after ordinary edit.');assert.equal(undo(h.cm),true);assert.ok(!h.adapter.saved().includes('User middle'));
  assert.equal(undo(h.cm),true);assert.equal(h.adapter.saved(),original);
  assert.equal(redo(h.cm),true);assert.ok(h.adapter.saved().indexOf(responseAnchor(id))>h.adapter.saved().indexOf('Last'));
  assert.equal(redo(h.cm),true);assert.match(h.adapter.saved(),/User middle/);assert.match(h.text(),/Stream after ordinary edit/);h.adapter.dispose();
});
test('moves use canonical saved offsets around compact retained tools',()=>{
  const tools=renderResponseToolGroup({id:'tool',turnId:'turn',tools:[{id:'command',turnId:'turn',key:'command',status:'completed',label:'Ran command',activeLabel:'Running command',icon:'terminal',action:'command',sequence:1,output:'Full output. '.repeat(2000)}]});
  const h=editor(original.replace('Middle paragraph.',tools+'\n\nMiddle paragraph.'));
  assert.ok(h.text().length<3000);const target=h.text().indexOf('Last');
  assert.equal(h.adapter.moveResponse(key,target),true);assert.ok(h.adapter.saved().indexOf(responseAnchor(id))>h.adapter.saved().indexOf(tools));
  h.stream('More text.');assert.equal(undo(h.cm),true);assert.ok(h.adapter.saved().indexOf(responseAnchor(id))<h.adapter.saved().indexOf(tools));assert.ok(h.adapter.saved().includes(tools));h.adapter.dispose();
});
test('terminal state and final-save fences cancel movement and old move history cannot restore an anchor',async()=>{
  const h=editor();h.adapter.moveResponse(key,h.text().length);const moved=h.adapter.saved();
  const release=await h.adapter.beginFinalSave();assert.equal(h.adapter.moveControl(key),undefined);assert.equal(h.adapter.moveResponse(key,0),false);release();
  h.stream('Completed output.',false);assert.equal(h.adapter.moveControl(key),undefined);assert.equal(h.adapter.moveResponse(key,0),false);
  const final=moved.replace(responseAnchor(id),'Final saved answer.');h.adapter.prepareMaterialization(moved,final,[id]);assert.equal(h.adapter.acceptCommitted(final,[id]),true);
  assert.equal(undo(h.cm),true);assert.equal(h.adapter.saved(),final);assert.doesNotMatch(h.adapter.saved(),new RegExp(id));h.adapter.dispose();
});
test('reading mode, response changes, wrong keys and foreign file views never move a reply',()=>{
  const h=editor();assert.equal(h.adapter.moveResponse('missing:active',0),false);assert.equal(h.adapter.moveResponse(key,h.text().indexOf('Other response.')),false);
  h.view.getMode=()=> 'preview';assert.equal(h.adapter.moveControl(key),undefined);
  h.view.getMode=()=> 'source';h.view.file={path:'Other.md'};assert.equal(h.adapter.moveControl(key),undefined);
});


test('successive moves each undo once and detached history cannot restore a stale response',()=>{
  const h=editor();h.adapter.moveResponse(key,h.text().length);const last=h.adapter.saved();
  h.adapter.moveResponse(key,0);const first=h.adapter.saved();assert.equal(undoDepth(h.cm.state),2);
  h.stream('Current output after two moves.');assert.equal(undo(h.cm),true);assert.equal(h.adapter.saved(),last);
  assert.equal(undo(h.cm),true);assert.equal(h.adapter.saved(),original);
  assert.equal(redo(h.cm),true);assert.equal(redo(h.cm),true);assert.equal(h.adapter.saved(),first);
  h.adapter.dispose();const detached=h.text();assert.equal(undo(h.cm),true);assert.equal(h.text(),detached);
});
test('partial response edits remain blocked after a drag and cancellation leaves ordinary history intact',()=>{
  const h=editor();h.adapter.moveResponse(key,h.text().length);const at=h.text().indexOf('First streamed');
  h.cm.dispatch({changes:{from:at,to:at+5,insert:'Unsafe'}});assert.doesNotMatch(h.text(),/Unsafe/);
  h.stream('Stopped response.',false);assert.equal(undo(h.cm),true);const text=h.text();
  h.cm.dispatch({changes:{from:0,insert:'User edit.\n\n'}});assert.match(h.adapter.saved(),/^User edit/);
  assert.equal(undo(h.cm),true);assert.equal(h.text(),text);h.adapter.dispose();
});
