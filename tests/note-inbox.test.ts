import {test} from 'node:test';
import assert from 'node:assert/strict';
import {changeNoteInbox,inboxNotes,mergeNoteInbox,type NoteInboxData} from '../src/notes/note-inbox';
import type {ResponseRequest} from '../src/responses/response-model';
import type {NoteIndicator} from '../src/responses/explorer-responses';
const binding=(id:string,path='Project/Note.md',extra:Partial<ResponseRequest>={}):ResponseRequest=>({id,notePath:path,vaultId:'vault',createdAt:'2026-01-01T00:00:00Z',messageId:'message-'+id,...extra} as ResponseRequest);
const indicator=(extra:Partial<NoteIndicator>={}):NoteIndicator=>({active:0,input:0,complete:0,total:1,...extra});
const project=(bindings:ResponseRequest[],data:NoteInboxData={},indicators=new Map<string,NoteIndicator>(),now=100)=>inboxNotes(bindings,[],indicators,data,'vault',path=>path!=='Deleted.md',now);

test('only streamed Markdown notes enter; history survives Stop and removal; duplicates collapse',()=>{
 const bindings=[binding('first'),binding('second'),binding('deleted','Deleted.md'),binding('other','Other.md',{vaultId:'other'}),binding('image','Image.png')];
 const notes=project(bindings);assert.equal(notes.length,1);assert.deepEqual(notes[0].ids,['first','second']);assert.equal(notes[0].section,'regular');
 assert.deepEqual(project([]),[],'unbound sends and folder links cannot create rows');
 const stopped=inboxNotes(bindings,[{id:'first',notePath:'Project/Note.md',epoch:1,revision:2,deleted:true,active:false,input:false,complete:false}],new Map(),{},'vault',()=>true);
 assert.equal(stopped.find(note=>note.path==='Project/Note.md')?.ids.length,2,'persistent binding retains stream history');
});
test('working and input come from live note indicators, pin takes precedence and finishing never settles',()=>{
 const bindings=[binding('one')],busy=new Map([['Project/Note.md',indicator({active:1})]]);
 let note=project(bindings,{},busy)[0];assert.equal(note.section,'working');
 const data=changeNoteInbox({},note,{kind:'pin',value:true},'actor',100);
 note=project(bindings,data,busy)[0];assert.equal(note.section,'pinned');assert.equal(note.indicator.active,1);
 assert.throws(()=>changeNoteInbox(data,note,{kind:'settled'},'actor',101),/Wait/);
 const needsInput=new Map([['Project/Note.md',indicator({input:1})]]);
 assert.throws(()=>changeNoteInbox({},project(bindings,{},needsInput)[0],{kind:'snoozed',until:1000},'actor',101),/answer/);
 assert.equal(project(bindings)[0].section,'regular');
});
test('settle, reopen, snooze, timed wake, and new input preserve content and stream identity',()=>{
 const bindings=[binding('one')],before=JSON.stringify(bindings),note=project(bindings)[0];
 let data=changeNoteInbox({},note,{kind:'settled'},'actor',100);assert.equal(project(bindings,data)[0].section,'settled');
 data=changeNoteInbox(data,project(bindings,data)[0],{kind:'regular'},'actor',101);assert.equal(project(bindings,data)[0].section,'regular');
 data=changeNoteInbox(data,project(bindings,data)[0],{kind:'snoozed',until:200},'actor',102);assert.equal(project(bindings,data)[0].section,'snoozed');assert.equal(project(bindings,data,new Map(),201)[0].section,'regular');
 assert.equal(project([binding('one','Project/Note.md',{localMessageId:'new-message'})],data)[0].section,'regular');
 assert.equal(project([...bindings,binding('new-stream')],data)[0].section,'regular');
 assert.equal(JSON.stringify(bindings),before);
 assert.throws(()=>changeNoteInbox(data,note,{kind:'snoozed',until:1},'actor',100),/future/);
});
test('stream IDs carry state across file and folder moves; delete and new unbound file cannot inherit a row',()=>{
 const original=project([binding('one')])[0],data=changeNoteInbox({},original,{kind:'settled'},'actor',100);
 assert.equal(project([binding('one','Renamed/Note.md')],data)[0].section,'settled');
 assert.equal(project([binding('one','Deleted.md')],data).length,0);
 assert.equal(project([],data).length,0);
 assert.equal(project([binding('different')],data)[0].section,'regular');
});
test('independent devices merge pin and shelf changes; unpin and reopen cannot be resurrected by stale copies',()=>{
 const note=project([binding('one'),binding('two')])[0];
 const pinned=changeNoteInbox({},note,{kind:'pin',value:true},'a',100),settled=changeNoteInbox({},note,{kind:'settled'},'b',100);
 const merged=mergeNoteInbox(pinned,settled);assert.deepEqual(merged,mergeNoteInbox(settled,pinned));assert.equal(project([binding('one'),binding('two')],merged)[0].section,'settled');
 const unpinned=changeNoteInbox(merged,note,{kind:'pin',value:false},'a',101),reopened=changeNoteInbox(merged,note,{kind:'regular'},'b',101);
 const final=mergeNoteInbox(pinned,settled,unpinned,reopened);assert.equal(project([binding('one'),binding('two')],final)[0].section,'regular');assert.equal(final.one.pinned?.value,false);
 assert.deepEqual(final,mergeNoteInbox(final,pinned,settled));
});
test('malformed persisted data cannot create membership or invalid snooze deadlines',()=>{
 assert.deepEqual(mergeNoteInbox({one:{shelf:{clock:1,actor:'a',value:{kind:'snoozed',activity:'x',until:NaN}}},two:{pinned:{clock:-1,actor:'a',value:true}}}),{});
});
