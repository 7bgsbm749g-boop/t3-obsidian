import test from 'node:test';
import assert from 'node:assert/strict';
import {EditorState} from '@codemirror/state';
import {EditorView,type DecorationSet} from '@codemirror/view';
import {sendPreviewBody,sendPreviewField,SendPreviews,type SendPreview} from '../send-preview';
import {activeInlineIds,initialRegion,renameInlineHeader} from '../inline-thread';
import {stoppedResponseBody} from '../response-stop';
import {responseConnectionBody} from '../sign-in-state';

const preview:SendPreview={app:{} as any,path:'Folder/Note.md',title:'Note',id:'pending-send',startedAt:'2026-10-30T00:00:00Z'};

test('the pending state has the real response fold, timer, activity body, and escaped note title',()=>{
  const body=sendPreviewBody({...preview,title:'My **note** <script>'});
  assert.match(body,/^> \[!t3-progress\]\+ \*\*My \\\*\\\*note\\\*\\\* &lt;script&gt; · Sending\*\*/);
  assert.match(body,/send-to-t3-run-timer/);assert.match(body,/data-t3-fold="[^"]+:active"/);
  assert.match(body,/> <span class="send-to-t3-response-activity"[^\n]+<span>Sending<\/span>/);
  assert.doesNotMatch(body,/T3 ·|Working|Thinking|t3-inline:|send-to-t3-response:/);
});

test('a prepared Sending response remains active, accepts its thread title, and stops cleanly',()=>{
  const id='11111111-2222-4333-8444-555555555555';
  for(const mode of ['collapse','remove'] as const){
    const region=initialRegion(id,undefined,'Note',mode,{startedAt:preview.startedAt},'sending');
    assert.deepEqual(activeInlineIds(region.text),[id]);
    const renamed=renameInlineHeader(region.text,'Actual thread');assert.match(renamed,/Actual thread · Sending/);
    const stopped=stoppedResponseBody(renamed);assert.doesNotMatch(stopped,/ · Sending|inline-spinner|response-activity/);
    if(mode==='collapse')assert.match(stopped,/Actual thread · Interrupted/);
    const signedOut=responseConnectionBody(renamed,{kind:'sign-in-required'},id);
    assert.match(signedOut,/Sign in required/);assert.match(signedOut,/Sign in to resume/);
    assert.doesNotMatch(signedOut,/ · Sending|<span>Sending<\/span>|inline-spinner/);
  }
});

test('pending block maps through typing without changing the document, selection, or undo data',()=>{
  const {field,change}=sendPreviewField(),document='First paragraph.\n\nLater paragraph.';
  let state=EditorState.create({doc:document,selection:{anchor:3},extensions:[field]});
  const start=state.update({effects:change.of({offset:18,preview})});
  assert.equal(start.docChanged,false);assert.equal(start.newSelection.main.anchor,3);
  state=start.state;assert.equal(state.doc.toString(),document);assert.equal(state.field(field).size,1);
  state=state.update({changes:{from:0,insert:'User edit. '}}).state;
  let position=-1;state.field(field).between(0,state.doc.length,from=>{position=from;});
  assert.equal(position,29);assert.equal(state.doc.toString(),'User edit. '+document);
  state=state.update({effects:change.of(null)}).state;
  assert.equal(state.field(field).size,0);assert.equal(state.doc.toString(),'User edit. '+document);
});

function fixture(){
  const cm={state:EditorState.create({doc:'Note text',selection:{anchor:2}}),destroyed:false,dispatch(spec:any){this.state=this.state.update(spec).state;}};
  const view={file:{path:'Note.md'},editor:{cm},getMode:()=> 'source'};
  const count=()=>cm.state.facet(EditorView.decorations).reduce((sum,deco)=>sum+(deco as DecorationSet).size,0);
  return {view: view as any,cm,count};
}

test('nested send scopes share one block and clear it only after the last scope',()=>{
  const h=fixture(),previews=new SendPreviews();
  const first=previews.begin(h.view,3),second=previews.begin(h.view,9);
  assert.equal(h.count(),1);assert.equal(h.cm.state.doc.toString(),'Note text');
  first();first();assert.equal(h.count(),1);second();assert.equal(h.count(),0);
  assert.equal(h.cm.state.selection.main.anchor,2);
});

test('handoff removes the pending block and old completions cannot clear a later send',()=>{
  const h=fixture(),previews=new SendPreviews(),old=previews.begin(h.view,3);
  previews.hide(h.view);assert.equal(h.count(),0);
  const next=previews.begin(h.view,4);old();assert.equal(h.count(),1);
  next();assert.equal(h.count(),0);
});

test('unload and reusing a view for another file release pending blocks',()=>{
  const h=fixture(),previews=new SendPreviews(),old=previews.begin(h.view,3);
  h.view.file={path:'Other.md'};previews.begin(h.view,5);old();assert.equal(h.count(),1);
  previews.dispose();assert.equal(h.count(),0);
});
