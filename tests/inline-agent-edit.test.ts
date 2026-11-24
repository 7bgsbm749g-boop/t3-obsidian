import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Editor} from 'obsidian';
import {InlineAgentEdit} from '../src/conversations/inline-agent-edit';

function fixture(){
  let document='Hello old world',sequence=0;
  const editor={getValue:()=>document,offsetToPos:(n:number)=>n,replaceRange:(text:string,from:number,to:number)=>{document=document.slice(0,from)+text+document.slice(to);}};
  const edit=new InlineAgentEdit(editor as unknown as Editor,()=>true,'id',()=>{},{document,from:6,to:9});
  const update=(text:string,state='running',streaming=state==='running',id='assistant',snapshotSequence=++sequence)=>edit.receive({kind:'snapshot',snapshot:{snapshotSequence,thread:{latestTurn:{turnId:'turn',state,messageId:'user'},messages:[{id:'user',role:'user',text:'edit',streaming:false,turnId:'turn'},{id,role:'assistant',text,streaming,turnId:'turn'}],activities:[{id:'tool',kind:'tool',summary:'Reading',turnId:'turn'}]}}},'user');
  return {edit,update,document:()=>document,change:()=>document+='!'};
}
test('an inline edit replaces the captured range and appends each streamed suffix once',()=>{
  const f=fixture();f.update('Thinking');assert.equal(f.document(),'Hello old world');assert.deepEqual(f.edit.activity.lines,['Thinking','Reading']);
  f.update('Thinking<edit-id>n');assert.equal(f.document(),'Hello n world');
  f.update('Thinking<edit-id>new</edi');f.update('Thinking<edit-id>new</edi');assert.equal(f.document(),'Hello new world');
  f.update('Thinking<edit-id>new</edit-id>Finished','completed');assert.equal(f.document(),'Hello new world');assert.equal(f.edit.activity.status,'Edit complete');
});
test('concurrent note edits stop typing and retain both writers’ text',()=>{
  const f=fixture();f.update('<edit-id>n');f.change();f.update('<edit-id>new');assert.equal(f.document(),'Hello n world!');assert.equal(f.edit.activity.running,false);assert.match(f.edit.activity.status,/preserve/);
});

test('turn completion waits for sealed final text and applies the remaining edit',()=>{
  const f=fixture();f.update('<edit-id>a','completed',true);assert.equal(f.edit.activity.running,true);
  f.update('<edit-id>amber</edit-id>','completed',false);assert.equal(f.document(),'Hello amber world');assert.equal(f.edit.activity.running,false);
});
test('a revised output after steering replaces only the owned text',()=>{
  const f=fixture();f.update('<edit-id>amber</edit-id>');f.update('<edit-id>blu','running',true,'steered');assert.equal(f.document(),'Hello amber world');
  f.update('<edit-id>blue</edit-id>','completed',false,'steered');assert.equal(f.document(),'Hello blue world');
});

test('sealed commentary and turn completion before the final edit do not close the watcher',()=>{
  const f=fixture();f.update('Working','running',false,'progress');f.update('Working','completed',false,'progress');
  assert.equal(f.edit.activity.running,true);f.update('<edit-id>green</edit-id>','completed',false,'answer');
  assert.equal(f.document(),'Hello green world');assert.equal(f.edit.activity.running,false);
});
test('a finished canonical turn with no assistant output releases the writer',()=>{
  const f=fixture(),snapshot={kind:'snapshot' as const,snapshot:{thread:{latestTurn:{turnId:'turn',state:'completed',messageId:'user'},messages:[{id:'user',role:'user',turnId:'turn',streaming:false,text:'edit'}]}}};
  f.edit.receive(snapshot,'user');f.edit.receive(snapshot,'user');assert.equal(f.edit.activity.running,false);assert.equal(f.document(),'Hello old world');
});
test('steering can revise an edit in the same assistant message',()=>{
  const f=fixture();const first='<edit-id>red</edit-id>';f.update(first);f.update(first+' Revised: <edit-id>blue</edit-id>','completed',false);
  assert.equal(f.document(),'Hello blue world');assert.ok(f.edit.activity.lines.every(line=>!line.includes('edit-id')));
});

test('a stale completed poll cannot close a newer streaming edit',()=>{
  const f=fixture();
  f.update('Working','completed',false,'progress',2);
  f.update('<edit-id>gr','completed',true,'answer',4);
  f.update('Working','completed',false,'progress',3);
  assert.equal(f.edit.activity.running,true);
  f.update('<edit-id>green</edit-id>','completed',false,'answer',5);
  assert.equal(f.document(),'Hello green world');
  assert.equal(f.edit.activity.status,'Edit complete');
});

test('a trailing open marker preserves the complete edit and reports the incomplete revision',()=>{
  const f=fixture(),text='<edit-id>red</edit-id> I put it in the <edit-id> block.';
  f.update(text,'completed');
  f.update(text,'completed');
  assert.equal(f.document(),'Hello red world');
  assert.equal(f.edit.activity.status,'The edit ended before its closing marker');
});
