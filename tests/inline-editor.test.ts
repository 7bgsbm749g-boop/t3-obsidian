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


test('question removal preserves a visible unchanged paragraph through CodeMirror scrolling',()=>{
  let state=EditorState.create({doc:'Intro\nQuestion\n<!-- t3-inline:end:job -->\nRetained response\n\nReading here\nTail'}),target:any;
  const scrollDOM={scrollTop:500,getBoundingClientRect:()=>({top:60,bottom:760})};
  const cm={get state(){return state;},scrollDOM,
    coordsAtPos:(position:number)=>state.doc.sliceString(position).startsWith('Reading here')?{top:300,bottom:320}:{top:-100,bottom:-80},
    dispatch:(spec:any)=>{const transaction=state.update(spec);state=transaction.state;target=transaction.effects[0].value;assert.equal(state.doc.sliceString(target.range.head).split('\n')[0],'Reading here');assert.equal(target.y,'start');assert.equal(target.yMargin,240);assert.equal(spec.scrollIntoView,false);}};
  replaceInlineEditorText({cm} as any,'Final',6,14);
  const next=state.update({changes:{from:0,insert:'More progress\n'}});
  const mapped=target.map(next.changes);assert.equal(next.state.doc.sliceString(mapped.range.head).split('\n')[0],'Reading here');
});
