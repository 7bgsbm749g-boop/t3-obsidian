import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Editor} from 'obsidian';
import {InlineAgentEdit} from '../src/conversations/inline-agent-edit';

function fixture(){
  let document='Hello old world',sequence=0;
  const editor={getValue:()=>document,offsetToPos:(n:number)=>n,replaceRange:(text:string,from:number,to:number)=>{document=document.slice(0,from)+text+document.slice(to);}};
  const edit=new InlineAgentEdit(editor as unknown as Editor,()=>true,'id',()=>{},{document,from:6,to:9});
  const update=(text:string,state='running',streaming=state==='running',id='assistant')=>edit.receive({kind:'snapshot',snapshot:{snapshotSequence:++sequence,thread:{latestTurn:{turnId:'turn',state,messageId:'user'},messages:[{id:'user',role:'user',text:'edit',streaming:false,turnId:'turn'},{id,role:'assistant',text,streaming,turnId:'turn'}],activities:[{id:'tool',kind:'tool',summary:'Reading',turnId:'turn'}]}}},'user');
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
