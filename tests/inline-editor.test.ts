import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EditorState,EditorSelection} from '@codemirror/state';
import {replaceInlineEditorText} from '../inline-editor';

test('stream updates map multiple selections without requesting a cursor scroll',()=>{
  let state=EditorState.create({doc:'Intro\nOld reply\nReading here',selection:EditorSelection.create([EditorSelection.cursor(0),EditorSelection.range(16,23)],1),extensions:EditorState.allowMultipleSelections.of(true)});
  const editor={cm:{dispatch:(spec:any)=>{
    const update=state.update(spec);
    assert.equal(update.scrollIntoView,false);
    state=update.state;
  }},replaceRange:()=>{throw Error('Obsidian replaceRange scrolls the cursor into view');}};
  replaceInlineEditorText(editor as any,'A much longer reply',6,15);
  assert.equal(state.doc.toString(),'Intro\nA much longer reply\nReading here');
  assert.equal(state.selection.main.anchor,26);assert.equal(state.selection.main.head,33);
  assert.equal(state.selection.ranges[0].head,0);
});

test('public editor fallback restores both scroll axes after the editor scrolls to the cursor',()=>{
  let value='Before reply after',scroll={top:920,left:18};
  const editor={getScrollInfo:()=>({...scroll}),offsetToPos:(offset:number)=>offset,
    replaceRange:(text:string,from:number,to:number)=>{value=value.slice(0,from)+text+value.slice(to);scroll={top:0,left:0};},
    scrollTo:(left:number,top:number)=>{scroll={top,left};}};
  replaceInlineEditorText(editor as any,'new reply',7,12);
  assert.equal(value,'Before new reply after');assert.deepEqual(scroll,{top:920,left:18});
});
