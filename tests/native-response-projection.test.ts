import {test} from 'node:test';
import assert from 'node:assert/strict';
import {displayToSaved,savedToDisplay,responseAnchor,projectResponses,savedProjection,editableDisplayRange} from '../native-response-projection';
import {renderInlineTurn} from '../inline-thread';
import {NativeResponseView} from '../native-response-view';
import {EditorState} from '@codemirror/state';

const id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',other='bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee';
const saved=`Before\n\n${responseAnchor(id)}\n\nBetween\n\n${responseAnchor(other)}\n\nAfter`;
test('many independent native response projections preserve ordinary edits and map positions',()=>{
  const projection=projectResponses(saved,[{id,body:'> Stream\n\n| Weight |\n| --- |\n| 25kg |'},{id:other,body:'> Other stream'}]);
  assert.equal(savedProjection(projection.display,projection),saved);
  assert.equal(savedProjection(projection.display.replace('Between','Edited between'),projection),saved.replace('Between','Edited between'));
  for(const needle of ['Before','Between','After']){
    const display=projection.display.indexOf(needle),offset=saved.indexOf(needle);
    assert.deepEqual(displayToSaved(projection,display),{kind:'saved',offset});assert.equal(savedToDisplay(projection,offset),display);
  }
  const from=projection.display.indexOf('Stream');assert.equal(displayToSaved(projection,from).kind,'response');
  assert.equal(editableDisplayRange(projection,from,from+6),false);
});
test('save projection refuses lost, duplicated, nested and legacy boundaries',()=>{
  const projection=projectResponses(saved,[{id,body:'> Stream'}]);
  assert.throws(()=>savedProjection(projection.display.replace(responseAnchor(other),responseAnchor(id)),projection),/duplicate/i);
  assert.throws(()=>savedProjection(projection.display.replace(/<!-- t3-inline:end:aaaaaaaa[^\n]+ -->/,''),projection),/boundaries/);
  assert.throws(()=>projectResponses(saved,[{id,body:responseAnchor(other)}]),/Nested/);
  assert.throws(()=>projectResponses(saved.replace(responseAnchor(id),responseAnchor(id).replace('\n\n','\nlegacy\n')),[{id,body:'> Stream'}]),/Legacy/);
  assert.throws(()=>projectResponses(saved,[{id,body:'one'},{id,body:'two'}]),/Duplicate/);
});
test('all existing progress/final choices retain exact formatter output in the native document',()=>{
  for(const phase of ['running','complete'] as const)for(const mode of ['collapse','keep','remove'] as const)for(const format of ['formatted','raw-markdown'] as const){
    const state:any={messages:[{id:'message',role:'assistant',turnId:'turn',text:'## Heading\n\n**Answer**\n\n| Weight |\n| --- |\n| 25kg |',streaming:phase==='running'}],activities:[],latestTurn:{turnId:'turn',state:phase==='running'?'running':'completed',assistantMessageId:'message'}};
    const body=renderInlineTurn(state,'turn','thread',phase,mode,undefined,undefined,undefined,'Thread',{startedAt:'2026-10-02T20:00:00Z'},format);
    const projection=projectResponses(responseAnchor(id),[{id,body}]);
    assert.equal(projection.display,`<!-- t3-inline:start:${id} -->\n${body}\n<!-- t3-inline:end:${id} -->`);
    assert.equal(savedProjection(projection.display,projection),responseAnchor(id));
  }
});
function fakeView(document:string){
  let value=document,saves=0;const conflicts:any[]=[];
  let disk=document;
  const view:any={getViewData:()=>value,setViewData:(data:string)=>{value=data;},getMode:()=> 'preview',requestSave:()=>{saves++;},save:async()=>{disk=view.getViewData();}};
  const adapter=new NativeResponseView(view,document,record=>conflicts.push(record),async()=>disk);
  return {view,adapter,conflicts,read:()=>value,edit:(data:string)=>{value=data;},saves:()=>saves};
}
test('incoming compatible ordinary edits preserve unsaved local edits and local response state',()=>{
  const fixture=fakeView(saved);fixture.adapter.setResponses([{id,body:'> Stream'}]);
  fixture.edit(fixture.read().replace('Before','Local before'));
  fixture.view.setViewData(saved.replace('After','External after'),false);
  assert.equal(fixture.view.getViewData(),saved.replace('Before','Local before').replace('After','External after'));
  assert.ok(fixture.read().includes('> Stream'));assert.equal(fixture.saves(),1);assert.deepEqual(fixture.conflicts,[]);
  fixture.adapter.dispose();assert.equal(fixture.read(),saved.replace('Before','Local before').replace('After','External after'));
});
test('incoming overlapping edits retain competing versions and block saves',()=>{
  const fixture=fakeView(saved);fixture.adapter.setResponses([{id,body:'> Stream'}]);fixture.edit(fixture.read().replace('Before','Local before'));
  fixture.view.setViewData(saved.replace('Before','External before'),false);
  assert.equal(fixture.conflicts.length,1);assert.ok(fixture.conflicts[0].local.includes('Local before'));assert.ok(fixture.conflicts[0].incoming.includes('External before'));
  assert.throws(()=>fixture.view.getViewData(),/overlap/);assert.throws(()=>fixture.adapter.dispose(),/Resolve/);
});
test('a mode switch or own-save echo adopts identical ordinary edits without a false conflict',()=>{
  const fixture=fakeView(saved);fixture.adapter.setResponses([{id,body:'> Stream'}]);fixture.edit(fixture.read().replace('Before','Saved user edit'));
  const durable=saved.replace('Before','Saved user edit');fixture.view.setViewData(durable,true);assert.equal(fixture.view.getViewData(),durable);assert.deepEqual(fixture.conflicts,[]);
});
test('verified own saves advance the baseline before a compatible external edit arrives',async()=>{
  const fixture=fakeView(saved);fixture.adapter.setResponses([{id,body:'> Stream'}]);fixture.edit(fixture.read().replace('Before','Saved edit'));await fixture.view.save();
  const incoming=saved.replace('Before','Saved edit').replace('After','External edit');fixture.view.setViewData(incoming,false);assert.equal(fixture.view.getViewData(),incoming);assert.deepEqual(fixture.conflicts,[]);
});
test('literal marker examples in fenced code are rendered and stripped structurally',()=>{
  const body=`Example:\n\n\`\`\`html\n${responseAnchor(other)}\n\`\`\``;
  const projection=projectResponses(saved,[{id,body}]);assert.ok(projection.display.includes(body));assert.equal(savedProjection(projection.display,projection),saved);
});
test('native transaction filter prevents partial response edits while preserving ordinary editor transactions',()=>{
  const fixture=fakeView(saved);fixture.adapter.setResponses([{id,body:'> Stream'}]);
  const state=EditorState.create({doc:fixture.read(),extensions:[fixture.adapter.extension()]});
  const from=state.doc.toString().indexOf('Stream');assert.equal(state.update({changes:{from,to:from+6,insert:'bad'}}).state.doc.toString(),state.doc.toString());
  const ordinary=state.update({changes:{from:0,to:6,insert:'User edit'}}).state.doc.toString();
  assert.ok(ordinary.startsWith('User edit'));assert.ok(ordinary.includes('> Stream'));
});
test('final materialization requires an explicit verified commit and excludes completed response from local projections',()=>{
  const fixture=fakeView(saved);fixture.adapter.setResponses([{id,body:'> Stream'},{id:other,body:'> Other'}]);
  const final=saved.replace(responseAnchor(id),'\n> Finished');fixture.adapter.acceptCommitted(final,[id]);
  assert.equal(fixture.view.getViewData(),final);assert.ok(fixture.read().includes('> Other'));assert.ok(!fixture.read().includes('> Stream'));
});
test('write-ahead materialization handles a synchronous native load before the readback acknowledgement',()=>{
  const fixture=fakeView(saved);fixture.adapter.setResponses([{id,body:'> Stream'},{id:other,body:'> Other'}]);
  const final=saved.replace(responseAnchor(id),'\n> Finished');fixture.adapter.prepareMaterialization(saved,final,[id]);fixture.view.setViewData(final,false);
  assert.equal(fixture.view.getViewData(),final);assert.deepEqual(fixture.conflicts,[]);fixture.adapter.acceptCommitted(final,[id]);
});
