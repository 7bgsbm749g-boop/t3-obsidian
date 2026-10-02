import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deviceNoteIO} from '../inline-note-io';
import {completionProof} from '../inline-thread';

test('completion checks distinguish saved proof from saved cleanup despite another stream changing the note',async()=>{
  const id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',body='> Answer\n';
  let document=completionProof(id,body)+'\nOther stream changed';
  const io=deviceNoteIO({vault:{getFileByPath:()=>({}),read:async()=>document}} as any);
  assert.equal(await io.isSaved('Note.md','stale whole-note hash',{id,body}),true);
  assert.equal(await io.isSaved('Note.md','stale whole-note hash',{id,body,cleaned:true}),false);
  document=body+'Other stream changed again';
  assert.equal(await io.isSaved('Note.md','stale whole-note hash',{id,body,cleaned:true}),true);
});

test('open-editor writes use the current text and preserve an outside edit',async()=>{
  let value='User edit\nOld reply\nTail',replacement:any;
  const editor={getValue:()=>value,offsetToPos:(offset:number)=>offset,replaceRange:(text:string,from:number,to:number)=>{replacement={text,from,to};value=value.slice(0,from)+text+value.slice(to);}};
  const io=deviceNoteIO({workspace:{getLeavesOfType:()=>[{view:{file:{path:'Note.md'},editor}}]}} as any);
  await io.updateNote('Note.md',current=>current.replace('Old reply','New reply'),()=>true);
  assert.equal(value,'User edit\nNew reply\nTail');assert.equal(replacement.text,'New');
});

test('a delayed disk read cannot mutate after the lease expires',async()=>{
  let allowed=true,resolve!:(value:string)=>void,writes=0;
  const read=new Promise<string>(done=>{resolve=done;});
  const io=deviceNoteIO({workspace:{getLeavesOfType:()=>[]},vault:{getFileByPath:()=>({}),read:()=>read,process:()=>{writes++;}}} as any);
  const update=io.updateNote('Note.md',current=>current+'Reply',()=>allowed);
  allowed=false;resolve('Original');await assert.rejects(update,/ownership changed/);assert.equal(writes,0);
});

test('an intervening disk edit is preserved and a stale lease is checked inside the atomic save',async()=>{
  for(const staleLease of [false,true]){
    let allowed=true,document='Original';
    const io=deviceNoteIO({workspace:{getLeavesOfType:()=>[]},vault:{getFileByPath:()=>({}),read:async()=>document,process:async(_file:any,change:(value:string)=>string)=>{if(staleLease)allowed=false;else document='Outside edit';document=change(document);return document;}}} as any);
    await assert.rejects(io.updateNote('Note.md',current=>current+' Reply',()=>allowed),/ownership changed/);
    assert.equal(document,staleLease?'Original':'Outside edit');
  }
});
