import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EditorState} from '@codemirror/state';
import {history,undo,redo} from '@codemirror/commands';
import {NativeResponseView} from '../native-response-view';
import {removeStreamBlockFromEditor} from '../stream-block-edit';
import {streamBlock,removeStreamBlock} from '../stream-block';
import {responseAnchor} from '../native-response-projection';
import {renderInlineTurn} from '../inline-thread';
import {renderResponseToolGroup} from '../response-tools';
import {historyFixture,interruptedHistoryFixture} from './fixtures/stream-history';

function editor(document:string){
  let disk=document,saves=0;
  const view:any={file:{path:'Note.md'},getMode:()=> 'source',getState:()=>({source:false}),getViewData:()=>cm.state.doc.toString(),setViewData:()=>assert.fail('Use the native editor'),requestSave:()=>{saves++;},save:async()=>{disk=view.getViewData();}};
  const adapter=new NativeResponseView(view,document,()=>assert.fail('An ordinary completed-note edit is not a response conflict'),async()=>disk);
  const cm:any={state:EditorState.create({doc:document,extensions:[adapter.extension(),history()]}),dispatch:(spec:any)=>{cm.state=(spec.startState?spec:cm.state.update(spec)).state;}};
  view.editor={cm,getValue:()=>cm.state.doc.toString(),offsetToPos:(offset:number)=>{const line=cm.state.doc.lineAt(offset);return {line:line.number-1,ch:offset-line.from};},replaceRange:(text:string,from:{line:number;ch:number},to:{line:number;ch:number})=>cm.dispatch({changes:{from:cm.state.doc.line(from.line+1).from+from.ch,to:cm.state.doc.line(to.line+1).from+to.ch,insert:text}})};
  adapter.setResponses([]);
  return {view,adapter,cm,saves:()=>saves,disk:()=>disk};
}
function withTools(){
  const {body,key}=historyFixture();
  const tool=renderResponseToolGroup({id:'saved-tool',turnId:'saved-turn',tools:[{id:'command',turnId:'saved-turn',key:'command',status:'completed',label:'Ran command',activeLabel:'Running command',icon:'terminal',action:'command',sequence:1,output:'Retained tool details. '.repeat(2000)}]});
  return {key,body:body.replace('\n>\n','\n>\n> '+tool+'\n>\n')};
}
test('completed history closes locally without a host, including unsaved text and native undo/redo',async()=>{
  const {body,key}=withTools(),document='Unsaved before\n\n'+body+'\n\nOrdinary after\n',h=editor(document);
  assert.ok(h.view.editor.getValue().length<document.length);
  assert.equal(removeStreamBlockFromEditor(h.view,key,h.adapter.saved()),true);
  const after=removeStreamBlock(document,key).text;
  assert.equal(h.adapter.saved(),after);assert.equal(h.saves(),1);
  await h.view.save();assert.equal(h.disk(),after);
  // Native refresh and a save must not remove the rendering backing needed
  // by Undo. The restored Markdown includes the full original tool output.
  h.adapter.setResponses([]);
  assert.equal(undo(h.cm),true);assert.equal(h.adapter.saved(),document);
  h.adapter.setResponses([]);
  assert.equal(redo(h.cm),true);assert.equal(h.adapter.saved(),after);
  await h.view.save();assert.equal(h.disk(),after);h.adapter.dispose();
});
test('interrupted history closes through native undo and autosave while other responses remain',async()=>{
  const {body,key}=interruptedHistoryFixture(),completed=withTools(),id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const document='Unsaved before\n\n'+body+'\n\n'+completed.body+'\n\n'+responseAnchor(id)+'\n\nAfter\n',h=editor(document);
  h.adapter.setResponses([{id,body:'> Independent stream.'}]);
  assert.equal(removeStreamBlockFromEditor(h.view,key,h.adapter.saved()),true);
  const after=removeStreamBlock(document,key).text;
  assert.equal(h.adapter.saved(),after);assert.ok(h.view.editor.getValue().includes('Independent stream.'));
  assert.ok(after.includes(completed.body));assert.ok(after.includes(responseAnchor(id)));
  await h.view.save();assert.equal(h.disk(),after);
  assert.equal(undo(h.cm),true);assert.equal(h.adapter.saved(),document);
  assert.equal(redo(h.cm),true);assert.equal(h.adapter.saved(),after);h.adapter.dispose();
});
test('an interrupted display that is not saved cannot be closed',()=>{
  const {body,key}=interruptedHistoryFixture(),id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',h=editor(responseAnchor(id));
  h.adapter.setResponses([{id,body}]);
  const before=h.view.editor.getValue();
  assert.equal(removeStreamBlockFromEditor(h.view,key,h.adapter.saved()),false);
  assert.equal(h.view.editor.getValue(),before);assert.equal(h.saves(),0);h.adapter.dispose();
});
test('local close preserves another completed history and an independent active response',()=>{
  const first=withTools(),second=historyFixture(),otherBody=second.body.replaceAll(second.key,'independent:complete'),id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const document=first.body+'\n\n'+otherBody+'\n\n'+responseAnchor(id)+'\n\nTail\n',h=editor(document);
  h.adapter.setResponses([{id,body:'> Still streaming.'}]);
  assert.equal(removeStreamBlockFromEditor(h.view,first.key,h.adapter.saved()),true);
  assert.equal(h.adapter.saved(),removeStreamBlock(document,first.key).text);
  assert.ok(h.view.editor.getValue().includes('Still streaming.'));assert.ok(h.adapter.saved().includes(otherBody));
  assert.ok(h.adapter.saved().includes(responseAnchor(id)));h.adapter.dispose();
});
test('an active or terminal-looking unsaved projection cannot be deleted as completed history',()=>{
  const fixture=historyFixture(),id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',h=editor(responseAnchor(id));
  h.adapter.setResponses([{id,body:fixture.body}]);
  const before=h.view.editor.getValue();
  assert.equal(removeStreamBlockFromEditor(h.view,fixture.key,h.adapter.saved()),false);
  assert.equal(h.view.editor.getValue(),before);assert.equal(h.saves(),0);h.adapter.dispose();
  const active=renderInlineTurn({messages:[],activities:[]} as any,'turn','thread','running','collapse');
  assert.ok(!streamBlock(active,fixture.key));
});
test('whole completed tool groups can be deleted but partial compact-shell edits stay rejected',()=>{
  const {body,key}=withTools(),h=editor(body),display=h.view.editor.getValue(),at=display.indexOf('Open to view tool details.');
  h.cm.dispatch({changes:{from:at,to:at+4,insert:'Changed'}});
  assert.equal(h.view.editor.getValue(),display);assert.equal(h.adapter.saved(),body);
  assert.equal(removeStreamBlockFromEditor(h.view,key,h.adapter.saved()),true);
  assert.equal(h.adapter.saved(),removeStreamBlock(body,key).text);h.adapter.dispose();
});
