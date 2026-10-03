import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deviceNoteIO} from '../inline-note-io';
import {completionProof,initialRegion} from '../inline-thread';

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

test('moving a file during its disk read or atomic update retries without writing stale text',async()=>{
  for(const moveDuringRead of [true,false]){
    const file={path:'Note.md'};let document='Original',writes=0;
    const io=deviceNoteIO({workspace:{getLeavesOfType:()=>[]},vault:{
      getFileByPath:(path:string)=>path===file.path?file:undefined,
      read:async()=>{if(moveDuringRead)file.path='Moved.md';return document;},
      process:async(_file:any,change:(value:string)=>string)=>{file.path='Moved.md';document=change(document);writes++;return document;},
    }} as any);
    await assert.rejects(io.updateNote('Note.md',current=>current+' Reply',()=>true),/ownership changed/);
    assert.equal(writes,0);assert.equal(document,'Original');
  }
});

test('a move during final-save verification does not certify the previous path',async()=>{
  const id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',body='Final',file={path:'Note.md'};
  const io=deviceNoteIO({vault:{getFileByPath:(path:string)=>path===file.path?file:undefined,read:async()=>{file.path='Moved.md';return completionProof(id,body);}}} as any);
  assert.equal(await io.isSaved('Note.md','old hash',{id,body}),false);
});

test('stale Obsidian file entries after an external folder move do not prevent recovery scans',async()=>{
  const id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',old={path:'Old/Note.md'},moved={path:'Moved/Note.md'},text=initialRegion(id).text;
  const io=deviceNoteIO({workspace:{getLeavesOfType:()=>[]},vault:{
    getFileByPath:(path:string)=>path===old.path?old:path===moved.path?moved:undefined,
    getMarkdownFiles:()=>[old,moved],read:async(file:any)=>{if(file===old)throw Object.assign(Error('ENOENT: stale cached file'),{code:'ENOENT'});return text;},
  }} as any);
  assert.equal(await io.locateNote(id,old.path),moved.path);
  assert.equal(await io.readNote(old.path),undefined);
  assert.equal(await io.isSaved(old.path,'hash'),false);
  assert.equal(await io.updateNote(old.path,()=>{throw Error('Must not mutate');},()=>true),undefined);
});

test('note reads still surface storage errors other than a missing file',async()=>{
  const io=deviceNoteIO({workspace:{getLeavesOfType:()=>[]},vault:{getFileByPath:()=>({path:'Note.md'}),read:async()=>{throw Object.assign(Error('EACCES: permission denied'),{code:'EACCES'});}}} as any);
  await assert.rejects(io.readNote('Note.md'),/EACCES/);
  await assert.rejects(io.isSaved('Note.md','hash'),/EACCES/);
});

test('Reading view writes the saved note rather than its hidden editor, preserving progress and cleanup',async()=>{
  const id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',file={path:'Note.md'};let document='Prompt',hidden='Stale hidden editor',writes=0;
  const view={file,getMode:()=> 'preview',editor:{getValue:()=>hidden,replaceRange:()=>{throw Error('Hidden editor must not receive writes');}}};
  const io=deviceNoteIO({workspace:{getLeavesOfType:()=>[{view}]},vault:{getFileByPath:()=>file,read:async()=>document,process:async(_file:any,change:(text:string)=>string)=>{writes++;document=change(document);return document;}}} as any);
  assert.equal(io.isOpen('Note.md'),true);assert.equal(await io.readNote('Note.md'),'Prompt');
  await io.updateNote('Note.md',current=>current+initialRegion(id).text,()=>true);
  assert.equal(await io.locateNote(id,'Note.md'),'Note.md');
  await io.updateNote('Note.md',()=>completionProof(id,'Final'),()=>true);
  assert.equal(await io.isSaved('Note.md','unused',{id,body:'Final'}),true);
  await io.updateNote('Note.md',()=> 'Final',()=>true);
  assert.equal(await io.isSaved('Note.md','unused',{id,body:'Final',cleaned:true}),true);
  assert.equal(writes,3);assert.equal(hidden,'Stale hidden editor');
});

test('an intact disk response with a stale open buffer retries without declaring removed markers or overwriting either version',async()=>{
  const id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',disk='Head'+initialRegion(id).text+'Tail';let buffer='Head\nTail',writes=0;
  const file={path:'Ready.md'},view:any={file,editor:{getValue:()=>buffer,replaceRange:()=>{writes++;}}};
  const io=deviceNoteIO({workspace:{getLeavesOfType:()=>[{view}]},vault:{getFileByPath:()=>file,read:async()=>disk}} as any);
  assert.equal(await io.readNote('Ready.md'),undefined);assert.equal(await io.updateNote('Ready.md',current=>current+'response',()=>true),undefined);assert.equal(writes,0);
  buffer=disk;assert.equal(await io.readNote('Ready.md'),disk);assert.equal(await io.locateNote(id,'Ready.md'),'Ready.md');
});
test('equal multiple editor views receive the same minimal change; disagreement preserves all buffers',async()=>{
  const buffers=['Head old Tail','Head old Tail'],views=buffers.map((_,i)=>({file:{path:'Note.md'},editor:{getValue:()=>buffers[i],offsetToPos:(n:number)=>n,replaceRange:(text:string,from:number,to:number)=>{buffers[i]=buffers[i].slice(0,from)+text+buffers[i].slice(to);}}}));
  const io=deviceNoteIO({workspace:{getLeavesOfType:()=>views.map(view=>({view}))}} as any);
  await io.updateNote('Note.md',current=>current.replace('old','new'),()=>true);assert.deepEqual(buffers,['Head new Tail','Head new Tail']);
  buffers[1]+=' competing';assert.equal(await io.readNote('Note.md'),undefined);assert.equal(await io.updateNote('Note.md',current=>current+' overwrite',()=>true),undefined);assert.deepEqual(buffers,['Head new Tail','Head new Tail competing']);
});
