import test from 'node:test';
import assert from 'node:assert/strict';
import {EditorState} from '@codemirror/state';
import {EditorView,type DecorationSet} from '@codemirror/view';
import {sendPreviewField,SendPreviews} from '../send-preview';

test('pending block maps through typing without changing the document, selection, or undo data',()=>{
  const {field,change}=sendPreviewField(),document='First paragraph.\n\nLater paragraph.';
  let state=EditorState.create({doc:document,selection:{anchor:3},extensions:[field]});
  const start=state.update({effects:change.of(18)});
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
