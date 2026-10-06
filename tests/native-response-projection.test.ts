import {test} from 'node:test';
import assert from 'node:assert/strict';
import {displayToSaved,savedToDisplay,responseAnchor,responseRegion,projectResponses,savedProjection,editableDisplayRange} from '../native-response-projection';
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
function fakeView(document:string,normalizeIncoming?:(text:string)=>string){
  let value=document,saves=0;const conflicts:any[]=[];
  let disk=document;
  const view:any={getViewData:()=>value,setViewData:(data:string)=>{value=data;},getMode:()=> 'preview',requestSave:()=>{saves++;},save:async()=>{disk=view.getViewData();}};
  const adapter=new NativeResponseView(view,document,record=>conflicts.push(record),async()=>disk,normalizeIncoming);
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
  assert.throws(()=>fixture.view.getViewData(),/overlap/);fixture.adapter.dispose();assert.equal(fixture.read(),saved.replace('Before','External before'));assert.ok(fixture.conflicts[0].local.includes('Local before')); // unload preserves the incoming revision and journals local edits
});
test('a mode switch or own-save echo adopts identical ordinary edits without a false conflict',()=>{
  const fixture=fakeView(saved);fixture.adapter.setResponses([{id,body:'> Stream'}]);fixture.edit(fixture.read().replace('Before','Saved user edit'));
  const durable=saved.replace('Before','Saved user edit');fixture.view.setViewData(durable,true);assert.equal(fixture.view.getViewData(),durable);assert.deepEqual(fixture.conflicts,[]);
});
test('verified own saves advance the baseline before a compatible external edit arrives',async()=>{
  const fixture=fakeView(saved);fixture.adapter.setResponses([{id,body:'> Stream'}]);fixture.edit(fixture.read().replace('Before','Saved edit'));await fixture.view.save();
  const incoming=saved.replace('Before','Saved edit').replace('After','External edit');fixture.view.setViewData(incoming,false);assert.equal(fixture.view.getViewData(),incoming);assert.deepEqual(fixture.conflicts,[]);
});
test('a debounced own-save readback advances its baseline without overwriting a later undo',async()=>{
  let value=saved,disk=saved,pending=saved;
  const view:any={getViewData:()=>value,setViewData:(text:string)=>{value=text;},getMode:()=> 'preview',requestSave:()=>{},save:async()=>{pending=view.getViewData();}};
  const adapter=new NativeResponseView(view,saved,()=>assert.fail('No competing edit exists.'),async()=>disk);
  adapter.setResponses([{id,body:'> Stream'}]);value=value.replace('Before','Edited Before');await view.save();
  disk=pending;value=value.replace('Edited Before','Before');await view.save();
  assert.equal(view.getViewData(),saved);assert.ok(value.includes('> Stream'));assert.equal(pending,saved);
});
test('unsaved cross-pane echoes do not turn an unchanged disk read into an edit deletion',async()=>{
  let value=saved,disk=saved;
  const view:any={getViewData:()=>value,setViewData:(text:string)=>{value=text;},getMode:()=> 'preview',requestSave:()=>{},save:async()=>{disk=view.getViewData();}};
  const adapter=new NativeResponseView(view,saved,()=>assert.fail('No competing edit exists.'),async()=>disk);
  adapter.setResponses([{id,body:'> Stream'}]);
  const edited=saved+'\nUnsaved pane';view.setViewData(edited,false);await view.save();
  assert.equal(disk,edited);assert.ok(value.includes('> Stream'));
  view.setViewData(saved,false);await view.save();assert.equal(disk,saved);
});
test('a delayed own-save echo preserves a newer cross-pane undo',async()=>{
  let value=saved,disk=saved,pending=saved;
  const view:any={getViewData:()=>value,setViewData:(text:string)=>{value=text;},getMode:()=> 'preview',requestSave:()=>{},save:async()=>{pending=view.getViewData();}};
  const adapter=new NativeResponseView(view,saved,()=>assert.fail('No competing edit exists.'),async()=>disk);
  adapter.setResponses([{id,body:'> Stream'}]);
  const edited=saved.replace('Before','Edited Before');view.setViewData(edited,false);await view.save();
  view.setViewData(saved,false);disk=pending;view.setViewData(disk,false);
  assert.equal(view.getViewData(),saved);await view.save();assert.equal(pending,saved);assert.ok(value.includes('> Stream'));
});
test('native autosave bypassing view.save cannot make its ordinary disk edit overwrite a later undo',async()=>{
  let value=saved,disk=saved;
  const view:any={getViewData:()=>value,setViewData:(text:string)=>{value=text;},getMode:()=> 'preview',requestSave:()=>{},save:async()=>{disk=view.getViewData();}};
  const adapter=new NativeResponseView(view,saved,()=>assert.fail('An ordinary undo is safe.'),async()=>disk);
  adapter.setResponses([{id,body:'> Stream'}]);
  value=value.replace('Before','Edited Before');disk=view.getViewData(); // Native's captured autosave function.
  value=value.replace('Edited Before','Before');await view.save();
  assert.equal(view.getViewData(),saved);assert.equal(disk,saved);assert.ok(value.includes('> Stream'));
});
test('literal marker examples in fenced code are rendered and stripped structurally',()=>{
  const body=`Example:\n\n\`\`\`html\n${responseAnchor(other)}\n\`\`\``;
  const projection=projectResponses(saved,[{id,body}]);assert.ok(projection.display.includes(body));assert.equal(savedProjection(projection.display,projection),saved);
});
test('native transaction filter prevents partial response edits while preserving ordinary editor transactions',()=>{
  const fixture=fakeView(saved);fixture.adapter.setResponses([{id,body:'> Stream'}]);
  const state=EditorState.create({doc:fixture.read(),extensions:[fixture.adapter.extension()]});
  fixture.view.editor={cm:{state}};
  const from=state.doc.toString().indexOf('Stream');assert.equal(state.update({changes:{from,to:from+6,insert:'bad'}}).state.doc.toString(),state.doc.toString());
  const ordinary=state.update({changes:{from:0,to:6,insert:'User edit'}}).state.doc.toString();
  assert.ok(ordinary.startsWith('User edit'));assert.ok(ordinary.includes('> Stream'));
});
test('typing beside either tracking comment remains editable and survives save, stream updates and reopen',async()=>{
  for(const side of ['before','after'] as const){
    const fixture=fakeView(saved);fixture.adapter.setResponses([{id,body:'> Stream'}]);
    let state=EditorState.create({doc:fixture.read(),extensions:[fixture.adapter.extension()]});
    fixture.view.editor={cm:{state}};
    const edit=(from:number,to:number,insert:string)=>{
      state=state.update({changes:{from,to,insert}}).state;
      fixture.view.editor.cm.state=state;fixture.edit(state.doc.toString());
    };
    const region=responseRegion(fixture.read(),id)!;
    const at=side==='before'?region.from:region.to;
    edit(at,at,'User text');edit(at+9,at+9,' remains');edit(at+9,at+17,'');
    assert.ok(fixture.read().includes('User text'));
    const durable=side==='before'?saved.replace(responseAnchor(id),'User text'+responseAnchor(id)):saved.replace(responseAnchor(id),responseAnchor(id)+'User text');
    assert.equal(fixture.view.getViewData(),durable);await fixture.view.save();
    fixture.adapter.setResponses([{id,body:'> New stream'}]);
    assert.equal(fixture.view.getViewData(),durable);assert.ok(fixture.read().includes('> New stream'));
    fixture.adapter.dispose();assert.equal(fixture.read(),durable);
    const reopened=fakeView(durable);reopened.adapter.setResponses([{id,body:'> Restored stream'}]);
    assert.equal(reopened.view.getViewData(),durable);assert.ok(reopened.read().includes('User text'));
  }
});
test('ordinary edits cannot make an active response unparseable or stop the next valid edit',()=>{
  const fixture=fakeView(saved);fixture.adapter.setResponses([{id,body:'> Stream'}]);
  let state=EditorState.create({doc:fixture.read(),extensions:[fixture.adapter.extension()]});
  fixture.view.editor={cm:{state}};
  const duplicate=state.update({changes:{from:0,insert:responseAnchor(id)+'\n'}});
  assert.equal(duplicate.state.doc.toString(),fixture.read());
  const fenced=state.update({changes:{from:0,insert:'```\n'}});
  assert.equal(fenced.state.doc.toString(),fixture.read());
  state=state.update({changes:{from:0,insert:'Ordinary text\n'}}).state;
  assert.ok(state.doc.toString().startsWith('Ordinary text\n'));
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

test('native cross-pane displayed-data echoes are stripped before merging ordinary edits',()=>{
 const fixture=fakeView(saved);fixture.adapter.setResponses([{id,body:'> Stream'}]);
 fixture.view.setViewData(fixture.read().replace('After','Second-pane ordinary edit'),false);
 assert.ok(fixture.view.getViewData().includes('Second-pane ordinary edit'));assert.ok(!fixture.view.getViewData().includes('> Stream'));assert.ok(fixture.read().includes('> Stream'));assert.deepEqual(fixture.conflicts,[]);
});
test('a switched file unwraps the old projection before loading another note',()=>{
 const fixture=fakeView(saved);fixture.adapter.setResponses([{id,body:'> Stream'}]);fixture.view.file={path:'New.md'};fixture.view.setViewData('# Another note',true);
 assert.equal(fixture.view.getViewData(),'# Another note');assert.equal(fixture.adapter.isDisposed(),true);
});

test('explicit view resolution preserves the competing snapshot and resumes a saved projection',()=>{
 const fixture=fakeView(saved);fixture.adapter.setResponses([{id,body:'> Stream'}]);fixture.edit(fixture.read().replace('Before','Local before'));
 const incoming=saved.replace('Before','Remote before');fixture.view.setViewData(incoming,false);const conflict=fixture.adapter.conflictRecord()!;assert.ok(conflict.local.includes('Local before'));
 fixture.adapter.resolveConflict(incoming,'saved');assert.equal(fixture.view.getViewData(),incoming);assert.ok(fixture.read().includes('> Stream'));assert.ok(fixture.conflicts[0].local.includes('Local before'));
});

test('an exact verified native load can settle an old projection after its completed anchor has disappeared',()=>{
  const fixture=fakeView(saved);fixture.adapter.setResponses([{id,body:'> Stream'},{id:other,body:'> Other'}]);
  const final=saved.replace(responseAnchor(id),'\n> Finished');fixture.edit(final);
  fixture.adapter.acceptCommitted(final,[id]);assert.equal(fixture.view.getViewData(),final);
  assert.ok(fixture.read().includes('> Other'));assert.ok(!fixture.read().includes('> Stream'));
});


test('independent response insertion already in a final native save is not an overlap or duplicated anchor',()=>{
 const original='Before\n\n'+responseAnchor(id)+'\n\nAfter\n',fixture=fakeView(original);
 fixture.adapter.setResponses([{id,body:'> Stream'}]);
 fixture.edit(fixture.read()+'\nIndependent\n'+responseAnchor(other)+'\n');
 fixture.adapter.setResponses([{id,body:'> Stream'},{id:other,body:'> Other stream'}]);
 const before=original+'\nIndependent\n'+responseAnchor(other)+'\n',final=before.replace(responseAnchor(id),'\n> Finished');
 fixture.adapter.prepareMaterialization(before,final,[id]);fixture.view.setViewData(final,false);fixture.adapter.acceptCommitted(final,[id]);
 assert.deepEqual(fixture.conflicts,[]);assert.equal(fixture.view.getViewData(),final);assert.ok(fixture.read().includes('Other stream'));
 assert.equal(fixture.view.getViewData().split(responseAnchor(other)).length,2);
});

test('late verified readback resolves a false view conflict without losing an independent registration',()=>{
 const original='Before\n\n'+responseAnchor(id)+'\n\nAfter\n',fixture=fakeView(original);
 fixture.adapter.setResponses([{id,body:'> Stream'}]);fixture.edit(fixture.read()+'\n'+responseAnchor(other)+'\n');
 fixture.adapter.setResponses([{id,body:'> Stream'},{id:other,body:'> Other'}]);
 const final=(original+'\n'+responseAnchor(other)+'\n').replace(responseAnchor(id),'\n> Finished');
 fixture.view.setViewData(final,false);assert.ok(fixture.adapter.conflictRecord());
 assert.equal(fixture.adapter.resolveCommitted(final,[id]),true);assert.equal(fixture.view.getViewData(),final);assert.ok(fixture.read().includes('> Other'));
});

test('finalizing a newly registered response adopts the checked disk baseline before native acknowledgement',()=>{
 const original='Before\n\n'+responseAnchor(id)+'\n\nAfter\n',fixture=fakeView(original);
 fixture.adapter.setResponses([{id,body:'> Older response'}]);fixture.edit(fixture.read()+'\n'+responseAnchor(other)+'\n');
 fixture.adapter.setResponses([{id,body:'> Older response'},{id:other,body:'> New response'}]);
 const before=original+'\n'+responseAnchor(other)+'\n',final=before.replace(responseAnchor(other),'\n> New response finished');
 fixture.adapter.prepareMaterialization(before,final,[other]);fixture.view.setViewData(final,false);fixture.adapter.acceptCommitted(final,[other]);
 assert.deepEqual(fixture.conflicts,[]);assert.equal(fixture.view.getViewData(),final);assert.ok(fixture.read().includes('> Older response'));assert.ok(!fixture.read().includes('> New response\n'));
});

test('cross-pane final materialization recognizes its exact saved intent with another response still displayed',()=>{
 const normalize=(document:string)=>{for(const uuid of [id,other]){const region=responseRegion(document,uuid);if(region)document=document.slice(0,region.from)+responseAnchor(uuid)+document.slice(region.to);}return document;};
 const fixture=fakeView(saved,normalize);fixture.adapter.setResponses([{id,body:'> Older response'},{id:other,body:'> Independent stream'}]);
 const final=saved.replace(responseAnchor(id),'\n> Finished'),echo=projectResponses(final,[{id:other,body:'> Independent stream'}]).display;
 fixture.adapter.prepareMaterialization(saved,final,[id]);fixture.view.setViewData(echo,false);fixture.adapter.acceptCommitted(final,[id]);
 assert.deepEqual(fixture.conflicts,[]);assert.equal(fixture.view.getViewData(),final);assert.ok(fixture.read().includes('Independent stream'));
});
