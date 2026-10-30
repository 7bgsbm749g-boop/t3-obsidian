import {markdownCodeCacheStatus} from '../reply-html';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {displayToSaved,savedToDisplay,responseAnchor,responseRegion,projectResponses,savedProjection,editableDisplayRange} from '../native-response-projection';
import {containerBody,containerEnd} from '../response-container';
import {renderInlineTurn,selectionAnchor,insertionOffset} from '../inline-thread';
import {NativeResponseView} from '../native-response-view';
import {EditorState} from '@codemirror/state';
import {renderResponseToolGroup,type ResponseToolGroup} from '../response-tools';
import {presentToolGroups} from '../response-tool-presentation';
import {heightFixture} from './fixtures/response-height';

const id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',other='bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee';
const saved=`Before\n\n${responseAnchor(id)}\n\nBetween\n\n${responseAnchor(other)}\n\nAfter`;
test('native projection guards height before a background redraw and retains saved text and selection',()=>{
  const document=`Before\n\n${responseAnchor(id)}\n\nAfter`,h=heightFixture(document),adapter=new NativeResponseView(h.view,document,record=>{throw Error(record.reason);},async()=>document);
  const body='> [!t3-progress]+ Working <span data-t3-fold="thread:active"></span>\n> First paragraph';
  adapter.setResponses([{id,body}]);h.advance(1000);assert.equal(h.guarded(),false);
  const selection=h.cm.state.selection;let dispatched=false;
  h.cm.onDispatch=(spec:any)=>{assert.equal(h.guarded(),true);assert.ok(spec.effects.some((effect:any)=>effect.value?.range),'every guarded update needs a consumed viewport target');h.rendered(false);h.height(6500);dispatched=true;};
  adapter.setResponses([{id,body:body+'\n> New output'}]);assert.equal(dispatched,true);assert.equal(h.scroller.scrollTop,7000);assert.equal(adapter.saved(),document);assert.equal(h.cm.state.selection.main.head,selection.main.head);
  h.cm.onDispatch=undefined;h.rendered(true);h.height(11000);h.advance(1000);assert.equal(h.guarded(),false);
  adapter.dispose();assert.equal(h.guarded(),false);assert.equal(h.jobs.size,0);
});
test('Reading response updates retain explicit Follow while clearing any editor height guard',()=>{
  const document=`Before\n\n${responseAnchor(id)}\n\nAfter`,h=heightFixture(document);h.mode('preview');
  const adapter=new NativeResponseView(h.view,document,record=>{throw Error(record.reason);},async()=>document);
  const body='> [!t3-progress]+ Working <span data-t3-fold="thread:active"></span>\n> First paragraph';
  adapter.setResponses([{id,body}]);adapter.toggleScroll('thread:active');assert.equal(adapter.scrollControl('thread:active')?.active,true);
  adapter.setResponses([{id,body:body+'\n> More output'}]);assert.equal(adapter.scrollControl('thread:active')?.active,true);assert.equal(h.guarded(),false);
  adapter.dispose();assert.equal(h.jobs.size,0);
});
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
  assert.throws(()=>savedProjection(projection.display.replace(containerEnd,''),projection),/boundaries/);
  assert.throws(()=>projectResponses(saved,[{id,body:responseAnchor(other)}]),/Nested/);
  assert.throws(()=>projectResponses(saved.replace(responseAnchor(id),responseAnchor(id).replace('\n\n','\nlegacy\n')),[{id,body:'> Stream'}]),/Legacy|spacing/);
  assert.throws(()=>projectResponses(saved,[{id,body:'one'},{id,body:'two'}]),/Duplicate/);
});
test('all existing progress/final choices retain exact formatter output in the native document',()=>{
  for(const phase of ['running','complete'] as const)for(const mode of ['collapse','keep','remove'] as const)for(const format of ['formatted','raw-markdown'] as const){
    const state:any={messages:[{id:'message',role:'assistant',turnId:'turn',text:'## Heading\n\n**Answer**\n\n| Weight |\n| --- |\n| 25kg |',streaming:phase==='running'}],activities:[],latestTurn:{turnId:'turn',state:phase==='running'?'running':'completed',assistantMessageId:'message'}};
    const body=renderInlineTurn(state,'turn','thread',phase,mode,undefined,undefined,undefined,'Thread',{startedAt:'2026-10-02T20:00:00Z'},format);
    const projection=projectResponses(responseAnchor(id),[{id,body}]);
    assert.equal(projection.display,containerBody(id,body));
    assert.equal(savedProjection(projection.display,projection),responseAnchor(id));
  }
});
function fakeView(document:string,normalizeIncoming?:(text:string)=>string){
  let value=document,saves=0;const conflicts:any[]=[];
  let disk=document;
  const view:any={getViewData:()=>value,setViewData:(data:string)=>{value=data;},getMode:()=> 'preview',requestSave:()=>{saves++;},save:async()=>{disk=view.getViewData();}};
  const originalGet=view.getViewData,originalSet=view.setViewData;
  const adapter=new NativeResponseView(view,document,record=>conflicts.push(record),async()=>disk,normalizeIncoming);
  return {view,adapter,conflicts,originalGet,originalSet,read:()=>value,edit:(data:string)=>{value=data;},saves:()=>saves};
}

test('detached views retain exact late-save bytes without rendering and restore native methods on reuse',async()=>{
 const document=`Before\n\n${responseAnchor(id)}\n\nAfter`,h=fakeView(document);
 h.adapter.setResponses([{id,body:'Transient output'}]);h.edit(h.read().replace('After','Edited after'));
 const displayed=h.read(),expected=document.replace('After','Edited after');
 h.adapter.dispose(true);assert.equal(h.adapter.isDisposed(),true);assert.equal(h.read(),displayed);assert.equal(h.view.getViewData(),expected);
 await h.view.save();assert.equal(h.view.getViewData(),expected);
 h.view.setViewData('Next note',false);assert.equal(h.read(),'Next note');assert.equal(h.view.getViewData,h.originalGet);assert.equal(h.view.setViewData,h.originalSet);
});

test('confirmed steering moves its exact source into the running projection and saves it',()=>{
  const document=`Keep this.\n\n${responseAnchor(id)}\n\nSteer now.\n\nKeep this too.`,h=fakeView(document),text='Steer now.',start=document.indexOf(text);
  const input={messageId:'steer',text,before:[],confirmed:true,selection:selectionAnchor(document,text,start,start+text.length)};
  const body='> [!t3-progress]+ Working\n> > [!t3-steering] You\n> > Steer now.';
  h.adapter.setResponses([{id,body}], [{id,steering:[{...input,confirmed:false}]}]);assert.equal(h.adapter.saved(),document);
  h.adapter.setResponses([{id,body}], [{id,steering:[input]}]);
  assert.equal(h.adapter.saved(),document.replace(text,''));assert.equal(h.read().split(text).length-1,1);assert.ok(h.read().includes('Keep this too.'));assert.equal(h.saves(),1);
  h.adapter.setResponses([{id,body}], [{id,steering:[input]}]);assert.equal(h.saves(),1);
  const recovered=fakeView(h.adapter.saved());recovered.adapter.setResponses([{id,body}],[{id,steering:[input]}]);assert.equal(recovered.read().split(text).length-1,1);
  h.adapter.dispose();recovered.adapter.dispose();
});

test('steering capture maps canonical live output into the saved source coordinates',()=>{
  const document=`Before\n\n${responseAnchor(id)}\n\nSteer after the response.\nTail`,h=fakeView(document);
  h.adapter.setResponses([{id,body:'> Growing output.\n\n'+largeTools()}]);
  const canonical=h.adapter.canonicalDisplayed(),text='Steer after the response.',from=canonical.indexOf(text);
  h.adapter.setResponses([{id,body:'> Live output grew while preparing the send.'}]);
  const [anchor]=h.adapter.sourceSelections(canonical,[[from,from+text.length]]);
  assert.equal(anchor.start,document.indexOf(text));assert.equal(anchor.before,document.slice(anchor.start-24,anchor.start));
  h.adapter.setResponses([{id,body:'> Changed output.\n\n> [!t3-steering] You\n> '+text}],[{id,steering:[{messageId:'steer',text,before:[],confirmed:true,selection:anchor}]}]);
  assert.equal(h.adapter.saved(),document.replace(text,''));
  assert.throws(()=>h.adapter.sourceSelections(canonical,[[from,from+text.length]]),/source note changed/);
  const current=h.adapter.canonicalDisplayed(),generated=current.indexOf('Changed output');assert.throws(()=>h.adapter.sourceSelections(current,[[generated,generated+7]]),/Generated responses/);h.adapter.dispose();
});

test('steering preserves edited source and removes an exact source restored by a delayed save',()=>{
  const document=`Before\n\n${responseAnchor(id)}\n\nOriginal steer.\nTail`,h=fakeView(document),text='Original steer.',start=document.indexOf(text);
  const input={messageId:'steer',text,before:[],confirmed:true,selection:selectionAnchor(document,text,start,start+text.length)},responses=[{id,body:'> [!t3-steering] You\n> '+text}];
  h.adapter.setResponses(responses);h.edit(h.read().replace(/Original steer\.(?=\nTail)/,'Edited steer.'));
  h.adapter.setResponses(responses,[{id,steering:[input]}]);assert.ok(h.adapter.saved().includes('Edited steer.'));assert.equal(h.saves(),0);
  h.edit(h.read().replace('Edited steer.','Original steer.'));h.adapter.setResponses(responses,[{id,steering:[input]}]);
  assert.equal(h.adapter.saved(),document.replace(text,''));assert.equal(h.read().split(text).length-1,1);assert.equal(h.saves(),1);h.adapter.dispose();
});

test('adjacent steering ranges and overlapping receipts consume once and exclude mirror targets',()=>{
  const document=`Before\n\n${responseAnchor(id)}\n\nFirst steer. Second steer.\nTail`,h=fakeView(document),first=document.indexOf('First steer.'),second=document.indexOf('Second steer.');
  const selections=[selectionAnchor(document,'First steer.',first,first+12),selectionAnchor(document,'Second steer.',second,second+13)];
  const input={messageId:'steer',text:'First steer. Second steer.',before:[],confirmed:true,selections,sourceResponseId:other},body='> First steer. Second steer.';
  h.adapter.setResponses([{id,body}],[{id,steering:[input]}]);assert.equal(h.adapter.saved(),document);
  h.adapter.setResponses([{id,body}],[{id,steering:[{...input,sourceResponseId:id},{...input,sourceResponseId:id}]}]);assert.equal(h.adapter.saved(),document.replace('First steer.','').replace('Second steer.',''));assert.equal(h.saves(),1);h.adapter.dispose();
});

function largeTools(){return renderResponseToolGroup({id:'synthetic',turnId:'turn',tools:[{id:'tool',turnId:'turn',key:'tool',status:'completed',label:'Read output',activeLabel:'Read output',icon:'file-text',action:'read',sequence:1,output:'retained output '.repeat(1000)}]} satisfies ResponseToolGroup);}
test('native tool summaries preserve completed and active canonical output through typing and final adoption',()=>{
  const tools=largeTools(),document='Before\n\n'+tools+'\n\n'+responseAnchor(id)+'\n\nAfter',h=fakeView(document);
  h.adapter.setResponses([{id,body:'> Reply\n\n'+tools}]);assert.ok(h.read().length<2000);assert.equal(h.adapter.saved(),document);assert.equal(h.adapter.responseBody(id),'> Reply\n\n'+tools);
  let state=EditorState.create({doc:h.read(),extensions:[h.adapter.extension()]});h.view.editor={cm:{state}};
  state=state.update({changes:{from:0,insert:'Typed '}}).state;h.view.editor.cm.state=state;h.edit(state.doc.toString());
  assert.equal(h.adapter.saved(),'Typed '+document);const after=h.read().indexOf('After');assert.deepEqual(h.adapter.mapSelection(after,after+5).from,{kind:'saved',offset:('Typed '+document).indexOf('After')});
  const final=('Typed '+document).replace(responseAnchor(id),'Final\n\n'+tools);h.adapter.prepareMaterialization('Typed '+document,final,[id]);assert.equal(h.adapter.acceptCommitted(final,[id]),true);assert.ok(h.read().length<2000);assert.equal(h.adapter.saved(),final);
  const summary=h.read().indexOf('Open to view tool details.');state=EditorState.create({doc:h.read(),extensions:[h.adapter.extension()]});h.view.editor.cm.state=state;
  assert.equal(state.update({changes:{from:summary,to:summary+4,insert:'Lost'}}).state.doc.toString(),state.doc.toString());
  h.adapter.dispose();assert.equal(h.read(),final);assert.equal(final.split('retained output').length,h.read().split('retained output').length);
});
test('completed tool notes compact on first attachment and raw source exposes exact editable canonical bytes',()=>{
  const tools=largeTools(),document='Before\n\n'+tools+'\n\nAfter',h=fakeView(document);h.adapter.setResponses([]);assert.ok(h.read().length<1000);assert.equal(h.adapter.saved(),document);
  h.view.getState=()=>({source:true});h.adapter.setResponses([]);assert.equal(h.read(),document);assert.equal(h.adapter.saved(),document);h.adapter.dispose();
});
test('canonical prompt reads retain full saved tools and the current live response without changing save bytes',()=>{
  const tools=largeTools(),document='Before\n\n'+tools+'\n\n'+responseAnchor(id)+'\n\nAfter',h=fakeView(document),first='> Live reply\n\n'+tools;
  h.adapter.setResponses([{id,body:first}]);assert.equal(h.adapter.canonicalDisplayed(),projectResponses(document,[{id,body:first}]).display);assert.equal(h.adapter.saved(),document);assert.doesNotMatch(h.adapter.canonicalDisplayed(),/data-t3-tool-ref=/);
  h.edit(h.read().replace('After','Typed ordinary text'));const edited=document.replace('After','Typed ordinary text');
  h.adapter.setResponses([{id,body:first+'\n\nNew live prose'}]);assert.equal(h.adapter.canonicalDisplayed(),projectResponses(edited,[{id,body:first+'\n\nNew live prose'}]).display);assert.equal(h.adapter.saved(),edited);
});
test('canonical selection after completed tools keeps a separate valid native insertion anchor',()=>{
  const tools=largeTools(),document='Before\n\n'+tools+'\n\nSelected ordinary text\n\nTail',h=fakeView(document);h.adapter.setResponses([]);
  const display=h.read(),text='Selected ordinary text',from=display.indexOf(text),anchor=selectionAnchor(display,text,from,from+text.length),selected=h.adapter.canonicalSelection(anchor.start,anchor.end);
  assert.equal(selected.document,document);assert.equal(selected.text,text);assert.equal(selected.start,document.indexOf(text));assert.equal(selected.reference,false);
  const insertion=insertionOffset(display,anchor);let state=EditorState.create({doc:display,extensions:[h.adapter.extension()]});h.view.editor={cm:{state}};
  state=state.update({changes:{from:insertion,insert:'Inserted reply anchor\n'}}).state;h.view.editor.cm.state=state;h.edit(state.doc.toString());assert.equal(h.adapter.saved(),document.replace(text+'\n',text+'\nInserted reply anchor\n'));assert.ok(h.read().length<1000);
});
test('partial compact summaries select exact retained output as context and never an editable placeholder',()=>{
  const tools=largeTools(),document='Before\n\n'+tools+'\n\n'+responseAnchor(id)+'\n\nAfter',h=fakeView(document);h.adapter.setResponses([{id,body:'> Reply\n\n'+tools}]);
  for(const at of [h.read().indexOf('Open to view tool details.'),h.read().lastIndexOf('Open to view tool details.')]){const selected=h.adapter.canonicalSelection(at,at+4);assert.equal(selected.text,tools);assert.equal(selected.reference,true);assert.doesNotMatch(selected.text,/data-t3-tool-ref=/);assert.equal(selected.document.slice(selected.start,selected.end),tools);}
  assert.throws(()=>h.adapter.canonicalSelection(-1,2),/range/);assert.throws(()=>h.adapter.canonicalSelection(0,h.read().length+1),/range/);
});
test('completed tool-only native pane echoes never become saved placeholders',async()=>{
  const tools=largeTools(),document='Before\n\n'+tools+'\n\nAfter',h=fakeView(document);h.adapter.setResponses([]);
  const compact=h.read();h.view.setViewData(compact,false);assert.equal(h.adapter.saved(),document);
  h.view.setViewData(compact.replace('After','Edited after'),false);const edited=document.replace('After','Edited after');
  assert.equal(h.adapter.saved(),edited);assert.ok(h.read().length<1000);await h.view.save();assert.equal(h.adapter.saved(),edited);
  assert.equal(h.adapter.conflictRecord(),undefined);h.adapter.dispose();assert.equal(h.read(),edited);assert.doesNotMatch(h.read(),/data-t3-tool-ref=/);
});
test('a failed response rebuild retains exact completed tool output and the prior live response',()=>{
  const tools=largeTools(),document='Before\n\n'+tools+'\n\n'+responseAnchor(id)+'\n\nAfter',h=fakeView(document);
  h.adapter.setResponses([{id,body:'> Original reply\n\n'+tools}]);const compact=h.read(),projection=h.adapter.currentProjection();
  assert.throws(()=>h.adapter.setResponses([{id,body:'> Changed reply\n\n'+tools},{id:other,body:'> Missing anchor'}]),/missing/);
  assert.equal(h.read(),compact);assert.equal(h.adapter.currentProjection(),projection);assert.equal(h.adapter.saved(),document);assert.equal(h.adapter.responseBody(id),'> Original reply\n\n'+tools);
  h.edit(compact.replace('After','Edited after'));assert.equal(h.adapter.saved(),document.replace('After','Edited after'));
  h.adapter.dispose();assert.equal(h.read(),document.replace('After','Edited after'));
});
test('a damaged compact pane echo remains a conflict and cannot reach an unwrapped native save',()=>{
  const tools=largeTools(),document='Before\n\n'+tools+'\n\nAfter',h=fakeView(document);h.adapter.setResponses([]);
  const attempted=h.read().replace('Open to view tool details.','Changed summary.').replace('Before','Incoming before').replace('After','Incoming after');h.view.setViewData(attempted,false);
  assert.ok(h.adapter.conflictRecord());assert.throws(()=>h.adapter.saved());
  assert.equal(h.adapter.conflictRecord()!.attemptedIncoming,attempted);assert.equal(h.adapter.conflictRecord()!.unsafeIncoming,false);
  h.adapter.dispose();assert.equal(h.read(),document.replace('Before','Incoming before').replace('After','Incoming after'));assert.doesNotMatch(h.read(),/data-t3-tool-ref=/);assert.ok(h.read().includes(tools));
});
test('pasting a live tool placeholder into ordinary text cannot escape the saved projection',()=>{
  const tools=largeTools(),document='Before\n\n'+responseAnchor(id)+'\n\nAfter',h=fakeView(document);h.adapter.setResponses([{id,body:tools}]);
  let state=EditorState.create({doc:h.read(),extensions:[h.adapter.extension()]});h.view.editor={cm:{state}};
  state=state.update({changes:{from:state.doc.length,insert:'\n\n'+presentToolGroups(tools).display}}).state;h.view.editor.cm.state=state;h.edit(state.doc.toString());
  assert.doesNotMatch(h.adapter.saved(),/data-t3-tool-ref=/);assert.equal(h.adapter.responseBody(id),tools);
});
test('unknown or tampered compact identities retain the save guard until a clean file switch',async()=>{
  for(const replacement of ['', 'f'.repeat(64),'unknown']){
    const tools=largeTools(),document='Before\n\n'+tools+'\n\nAfter',h=fakeView(document),{originalGet,originalSet}=h;h.adapter.setResponses([]);
    const ref=presentToolGroups(tools).groups[0].ref,attempted=h.read().replace(ref,replacement).replace('After','Incoming ordinary edit');h.view.setViewData(attempted,false);
    assert.equal(h.adapter.conflictRecord()!.attemptedIncoming,attempted);assert.equal(h.adapter.conflictRecord()!.unsafeIncoming,true);assert.ok(h.adapter.conflictRecord()!.local.includes(tools));
    h.adapter.dispose();assert.equal(h.adapter.isDisposed(),false);assert.notEqual(h.view.getViewData,originalGet);assert.throws(()=>h.view.getViewData());
    const saves=h.saves();h.view.requestSave();await h.view.save();assert.equal(h.saves(),saves);assert.ok(h.read().includes(ref));
    h.view.file={path:'Different.md'};h.view.setViewData('Different note',false);assert.equal(h.adapter.isDisposed(),true);assert.equal(h.view.getViewData,originalGet);assert.equal(h.view.setViewData,originalSet);assert.equal(h.view.getViewData(),'Different note');
  }
});
test('structurally damaged generated summaries cannot be adopted or unwrapped without canonical proof',()=>{
  const tools=largeTools(),document='Before\n\n'+tools+'\n\nAfter',h=fakeView(document);h.adapter.setResponses([]);
  const attempted=h.read().replace('</div></details>','');h.view.setViewData(attempted,false);assert.equal(h.adapter.conflictRecord()!.attemptedIncoming,attempted);assert.equal(h.adapter.conflictRecord()!.unsafeIncoming,true);
  h.adapter.dispose();assert.equal(h.adapter.isDisposed(),false);assert.throws(()=>h.view.getViewData());h.view.file={path:'Next.md'};h.view.setViewData('Next note',false);assert.equal(h.view.getViewData(),'Next note');
});
test('literal compact examples remain editable and do not confuse retained tool offset mapping',()=>{
  const tools=largeTools(),document='Before\n\n'+tools+'\n\nAfter',h=fakeView(document);h.adapter.setResponses([]);
  const literal='```html\n'+presentToolGroups(tools).display+'\n```\n\n';let state=EditorState.create({doc:h.read(),extensions:[h.adapter.extension()]});h.view.editor={cm:{state}};
  state=state.update({changes:{from:0,insert:literal}}).state;h.view.editor.cm.state=state;h.edit(state.doc.toString());assert.equal(h.adapter.saved(),literal+document);
  const after=h.read().indexOf('After');assert.deepEqual(h.adapter.mapSelection(after,after+5).from,{kind:'saved',offset:(literal+document).indexOf('After')});
  h.adapter.dispose();assert.equal(h.read(),literal+document);
});

test('verified readback resolves a transient projection conflict but retains competing ordinary edits',()=>{
  const before=`Before\n\n${responseAnchor(id)}\n\nAfter`,final=before.replace(responseAnchor(id),'\n> Finished');
  const matching=fakeView(before);matching.adapter.setResponses([{id,body:'> Working'}]);
  matching.adapter.preserveConflict({base:before,local:before,incoming:final,reason:'The exact durable response anchor is missing.'});
  assert.equal(matching.adapter.acceptCommitted(final,[id]),true);assert.equal(matching.adapter.conflictRecord(),undefined);assert.equal(matching.view.getViewData(),final);
  const competing=fakeView(before);competing.adapter.setResponses([{id,body:'> Working'}]);
  competing.adapter.preserveConflict({base:before,local:before.replace('Before','User heading'),incoming:final,reason:'Transient native update'});
  assert.equal(competing.adapter.acceptCommitted(final.replace('Before','Generated heading'),[id]),false);assert.match(competing.adapter.conflictRecord()!.local,/User heading/);
});
test('unchanged native response reads retain a validated projection, while ordinary edits and changed boundaries remain fresh',()=>{
 const h=fakeView(saved),responses=[{id,body:'> Retained large reply '.repeat(5000)},{id:other,body:'> Independent reply'}];
 h.adapter.setResponses(responses);const projection=h.adapter.currentProjection();
 for(let i=0;i<100;i++){
  assert.equal(h.adapter.saved(),saved);h.adapter.setResponses(responses.map(response=>({...response})));
  assert.equal(h.adapter.currentProjection(),projection);
 }
 h.edit(h.read().replace('Between','New ordinary text between'));
 assert.equal(h.adapter.saved(),saved.replace('Between','New ordinary text between'));
 const edited=h.adapter.currentProjection();assert.notEqual(edited,projection);assert.equal(edited.saved,saved.replace('Between','New ordinary text between'));
 h.adapter.setResponses([{id,body:'> Changed reply'},{id:other,body:'> Independent reply'}]);
 assert.ok(h.read().includes('Changed reply'));assert.ok(!h.read().includes('Retained large reply'));assert.equal(h.view.getViewData(),edited.saved);
 const validDisplay=h.read();h.edit(validDisplay.replace(containerEnd,''));
 assert.throws(()=>h.adapter.saved(),/boundaries/);assert.throws(()=>h.adapter.currentProjection(),/boundaries/);assert.throws(()=>h.adapter.setResponses([{id,body:'> Changed reply'},{id:other,body:'> Independent reply'}]),/boundaries/);
 h.edit(validDisplay);h.adapter.dispose();
});
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
  assert.throws(()=>fixture.view.getViewData(),/overlap/);fixture.adapter.dispose();assert.equal(fixture.read(),saved.replace('Before','Local before'));assert.ok(fixture.conflicts[0].incoming.includes('External before')); // unload retains ordinary typing and strips transient response text
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

test('saved adoption retains competing ordinary text and the active projection',()=>{
 const fixture=fakeView(saved);fixture.adapter.setResponses([{id,body:'> Stream'}]);fixture.edit(fixture.read().replace('Before','Local before'));
 const incoming=saved.replace('Before','Remote before');fixture.view.setViewData(incoming,false);const conflict=fixture.adapter.conflictRecord()!;assert.ok(conflict.local.includes('Local before'));
 assert.equal(fixture.adapter.adoptSaved(incoming),false);assert.ok(fixture.read().includes('Local before'));assert.ok(fixture.read().includes('> Stream'));assert.ok(fixture.conflicts[0].local.includes('Local before'));
});
test('a late conflicting file update cannot erase typing after every response has finished',()=>{
 const document='Finished response\n\nOrdinary paragraph\n',fixture=fakeView(document);fixture.adapter.setResponses([]);
 fixture.edit(document.replace('Ordinary paragraph','NEW USER TYPING paragraph'));
 fixture.view.setViewData(document.replace('Ordinary paragraph','Old incoming paragraph'),false);
 assert.equal(fixture.adapter.responseIds().length,0);assert.equal(fixture.adapter.adoptSaved(document.replace('Ordinary paragraph','Old incoming paragraph')),false);
 let state=EditorState.create({doc:fixture.read(),extensions:[fixture.adapter.extension()]});fixture.view.editor={cm:{state}};
 state=state.update({changes:{from:state.doc.length,insert:'More typing'}}).state;fixture.view.editor.cm.state=state;fixture.edit(state.doc.toString());
 assert.match(fixture.read(),/NEW USER TYPING/);assert.match(fixture.read(),/More typing/);
 fixture.adapter.dispose();assert.match(fixture.view.getViewData(),/NEW USER TYPING/);assert.match(fixture.view.getViewData(),/More typing/);
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

test('ordinary transactions around retained tools map exact saved bytes without reparsing Markdown',()=>{
 const document='Before ordinary text.\n\n'+largeTools()+'\n\nAfter ordinary text.',h=fakeView(document);h.adapter.setResponses([]);
 let state=EditorState.create({doc:h.read(),extensions:[h.adapter.extension()]});h.view.editor={cm:{state}};
 const before=markdownCodeCacheStatus();let expected=document;
 for(let i=0;i<30;i++){
  const at=i%2===0?2:state.doc.toString().indexOf('After')+2;
  const savedAt=i%2===0?2:expected.indexOf('After')+2;
  state=state.update({changes:{from:at,insert:'x'}}).state;h.view.editor.cm.state=state;h.edit(state.doc.toString());expected=expected.slice(0,savedAt)+'x'+expected.slice(savedAt);
  assert.equal(h.adapter.saved(),expected);assert.equal(h.adapter.currentProjection().saved,expected);
 }
 assert.equal(markdownCodeCacheStatus().sourceParses,before.sourceParses);
 // Delimiter and newline edits still take full validation, including undo.
 for(const insert of ['\n','`','<pre>']){
  const old=state.doc.toString();state=state.update({changes:{from:2,insert}}).state;h.view.editor.cm.state=state;h.edit(state.doc.toString());
  state=state.update({changes:{from:2,to:2+insert.length,insert:''}}).state;h.view.editor.cm.state=state;h.edit(state.doc.toString());assert.equal(state.doc.toString(),old);assert.equal(h.adapter.saved(),expected);
 }
 h.adapter.dispose();assert.equal(h.read(),expected);
});
