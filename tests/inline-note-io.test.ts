import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deviceNoteIO,deviceFinalNoteIO} from '../inline-note-io';
import {nativeResponses} from '../native-response-manager';
import {randomUUID} from 'node:crypto';
import {completionProof,initialRegion} from '../inline-thread';
import {responseAnchor} from '../native-response-projection';
import {contentHash} from '../completion';

function localFinalFixture(panes=1){
 const id=randomUUID(),file={path:'Note.md'},before='Before\n\n'+responseAnchor(id)+'\n\nAfter\n';let disk=before,writes=0,saves=0;
 const values=Array.from({length:panes},()=>before),views=values.map((_,index)=>({file,editor:{getValue:()=>values[index]},getViewData:()=>values[index],setViewData:(text:string)=>{values[index]=text;},getMode:()=> 'source',requestSave:()=>{},save:async()=>{saves++;disk=views[index].getViewData();}}));
 const app:any={workspace:{getLeavesOfType:()=>views.map(view=>({view}))},vault:{getFileByPath:(path:string)=>path===file.path?file:undefined,read:async()=>disk,process:async(_file:unknown,change:(value:string)=>string)=>{disk=change(disk);writes++;for(const view of views)view.setViewData(disk);return disk;}},saveLocalStorage:()=>{}};
 const manager=nativeResponses(app);manager.preview(views[0] as any,id,'> Working preview');
 return {id,app,manager,views,io:deviceFinalNoteIO(app,()=>true),before,edit:(text:string,index=0)=>{values[index]=text;},visible:(index=0)=>values[index],disk:()=>disk,writes:()=>writes,saves:()=>saves,setDisk:(text:string)=>{disk=text;}};
}

test('device final IO includes dirty ordinary text in one atomic save without waiting for native autosave',async()=>{
 const h=localFinalFixture();h.edit(h.visible().replace('Before','Dirty ordinary edit'));
 const before=(await h.io.read('Note.md'))!,after=before.replace(responseAnchor(h.id),'> Final response');
 assert.equal(await h.io.compareAndSet('Note.md',before,after),true);assert.equal(h.writes(),1);assert.equal(h.saves(),0);assert.equal(h.disk(),after);assert.equal(h.views[0].getViewData(),after);h.manager.dispose();
});

test('divergent native panes prevent the final write and retain their separate ordinary edits',async()=>{
 const h=localFinalFixture(2);h.edit(h.visible().replace('Before','Pane one edit'),0);h.edit(h.visible(1).replace('After','Pane two edit'),1);
 assert.equal(await h.io.read('Note.md'),undefined);assert.equal(h.writes(),0);assert.match(h.visible(),/Pane one edit/);assert.match(h.visible(1),/Pane two edit/);h.manager.dispose();
});

test('a pane edit after planning the final write is preserved before any atomic mutation',async()=>{
 const h=localFinalFixture(),before=(await h.io.read('Note.md'))!,after=before.replace(responseAnchor(h.id),'> Final response');h.edit(h.visible().replace('After','New outside edit'));
 assert.equal(await h.io.compareAndSet('Note.md',before,after),false);assert.equal(h.writes(),0);assert.match(h.visible(),/New outside edit/);h.manager.dispose();
});

test('an equal pane opened inside the atomic callback invalidates fence membership before writing',async()=>{
 const h=localFinalFixture(),before=(await h.io.read('Note.md'))!,after=before.replace(responseAnchor(h.id),'> Final response');let value=before;
 const late={file:h.views[0].file,editor:{getValue:()=>value},getViewData:()=>value,setViewData:(text:string)=>{value=text;},getMode:()=> 'source' as const,requestSave:()=>{},save:async()=>{throw Error('Late native save must wait');}};
 h.app.vault.process=async(_file:unknown,change:(text:string)=>string)=>{h.views.push(late);h.setDisk(change(h.disk()));};
 assert.deepEqual(await h.io.compareAndSetAttempt('Note.md',before,after,'new-pane'),{status:'no-write'});assert.equal(h.disk(),h.before);assert.equal(value,before);assert.equal(h.writes(),0);await new Promise(resolve=>setImmediate(resolve));h.manager.dispose();
});

test('closing an equal pane inside the atomic callback invalidates the sealed final snapshot',async()=>{
 const h=localFinalFixture(2),before=(await h.io.read('Note.md'))!,after=before.replace(responseAnchor(h.id),'> Final response');
 h.app.vault.process=async(_file:unknown,change:(text:string)=>string)=>{h.views.pop();h.setDisk(change(h.disk()));};
 assert.deepEqual(await h.io.compareAndSetAttempt('Note.md',before,after,'closed-pane'),{status:'no-write'});assert.equal(h.disk(),h.before);assert.equal(h.writes(),0);h.manager.dispose();
});

test('typed final CAS proves no-write for an intervening ordinary edit and never certifies storage ambiguity',async()=>{
  const edited=localFinalFixture(),before=(await edited.io.read('Note.md'))!,after=before.replace(responseAnchor(edited.id),'> Final response');
  edited.edit(edited.visible()+'Ordinary edit');assert.deepEqual(await edited.io.compareAndSetAttempt('Note.md',before,after,'attempt-one'),{status:'no-write'});assert.equal(edited.writes(),0);assert.ok(edited.visible().endsWith('Ordinary edit'));edited.manager.dispose();
  const ambiguous=localFinalFixture(),source=(await ambiguous.io.read('Note.md'))!,expected=source.replace(responseAnchor(ambiguous.id),'> Final response');
  ambiguous.app.vault.process=async(_file:unknown,change:(text:string)=>string)=>{ambiguous.setDisk(change(ambiguous.disk()));throw Error('Storage failed after mutation');};
  assert.deepEqual(await ambiguous.io.compareAndSetAttempt('Note.md',source,expected,'attempt-two'),{status:'unknown'});assert.equal(ambiguous.disk(),expected);ambiguous.manager.dispose();
});

test('a final atomic guard refusal is no-write, while a completed write with failed readback remains unverified',async()=>{
  const refused=localFinalFixture(),before=(await refused.io.read('Note.md'))!,after=before.replace(responseAnchor(refused.id),'> Final response');
  refused.app.vault.process=async(_file:unknown,change:(text:string)=>string)=>{refused.setDisk(refused.disk()+'Sync edit');return change(refused.disk());};
  assert.deepEqual(await refused.io.compareAndSetAttempt('Note.md',before,after,'attempt-one'),{status:'no-write'});assert.ok(refused.disk().endsWith('Sync edit'));assert.equal(refused.writes(),0);refused.manager.dispose();
  const changed=localFinalFixture(),source=(await changed.io.read('Note.md'))!,expected=source.replace(responseAnchor(changed.id),'> Final response');
  changed.app.vault.process=async(_file:unknown,change:(text:string)=>string)=>{changed.setDisk(change(changed.disk())+'Sync edit after write');return changed.disk();};
  assert.deepEqual(await changed.io.compareAndSetAttempt('Note.md',source,expected,'attempt-two'),{status:'written-unverified'});assert.ok(changed.disk().includes('Sync edit after write'));changed.manager.dispose();
});
test('a partial native preparation is cancelled before later unverified bytes can retire the response',async()=>{
  const h=localFinalFixture(),before=(await h.io.read('Note.md'))!,after=before.replace(responseAnchor(h.id),'> Final response');
  const prepare=h.manager.prepare.bind(h.manager);h.manager.prepare=(...args)=>{prepare(...args);throw Error('A later pane refused preparation');};
  assert.deepEqual(await h.io.compareAndSetAttempt('Note.md',before,after,'attempt-one'),{status:'no-write'});assert.equal(h.writes(),0);assert.equal(h.disk(),h.before);
  const adapter=h.manager.view(h.views[0] as any)!;h.views[0].setViewData(after);
  assert.equal(adapter.conflictRecord()?.awaitingCompletion,true);assert.equal(adapter.responseBody(h.id),'> Working preview');assert.throws(()=>adapter.saved());
  h.manager.dispose();
});

test('exact pending local materialization can recover before a delayed native file notification',async()=>{
 const h=localFinalFixture(),after=h.before.replace(responseAnchor(h.id),'> Final response');h.setDisk(after);
 await h.io.recover('Note.md',after,[h.id]);assert.equal(await h.io.read('Note.md'),after);assert.equal(h.views[0].getViewData(),after);assert.equal(h.writes(),0);h.manager.dispose();
});

test('reviewing a blocked native view preserves disk and local ordinary edits until checked recovery',async()=>{
 const h=localFinalFixture(),adapter=h.manager.view(h.views[0] as any)!,local=h.before.replace('Before','Local ordinary heading'),incoming=h.before.replace('After','Incoming ordinary tail');
 const conflict={base:h.before,local,incoming,reason:'Synthetic preserved completion conflict'};adapter.preserveConflict(conflict);h.setDisk(incoming);
 const candidate=(await h.io.reviewRead('Note.md'))!;assert.ok(candidate.includes('Local ordinary heading'));assert.ok(candidate.includes('Incoming ordinary tail'));
 assert.equal(h.saves(),0);assert.equal(h.writes(),0);assert.deepEqual(adapter.conflictRecord(),conflict);assert.equal(h.disk(),incoming);
 h.setDisk(incoming+'New ordinary edit');await assert.rejects(h.io.resumeReviewed('Note.md',contentHash(candidate)),/reviewed note changed/);assert.deepEqual(adapter.conflictRecord(),conflict);assert.equal(h.writes(),0);
 h.setDisk(incoming);await h.io.resumeReviewed('Note.md',contentHash(candidate));const before=(await h.io.read('Note.md'))!,after=before.replace(responseAnchor(h.id),'> Final response');
 assert.equal(await h.io.compareAndSet('Note.md',before,after),true);assert.equal(h.writes(),1);assert.ok(h.disk().includes('Local ordinary heading'));assert.ok(h.disk().includes('Incoming ordinary tail'));assert.ok(h.disk().includes('Final response'));assert.equal(h.saves(),0);h.manager.dispose();
});

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
  const view={file:{path:'Note.md'},editor};
  const io=deviceNoteIO({workspace:{getLeavesOfType:()=>[{view}]}} as any);
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

test('an editor edit during disk boundary validation invalidates the captured read and write',async()=>{
  for(const operation of ['read','write']){
    let buffer='Original',writes=0,release!:(text:string)=>void;
    const file={path:'Note.md'},view={file,editor:{getValue:()=>buffer,replaceRange:()=>{writes++;}}};
    const disk=new Promise<string>(done=>release=done);
    const io=deviceNoteIO({workspace:{getLeavesOfType:()=>[{view}]},vault:{getFileByPath:()=>file,read:()=>disk}} as any);
    const pending=operation==='read'?io.readNote('Note.md'):io.updateNote('Note.md',current=>current+' Reply',()=>true);
    buffer='Intervening ordinary edit';release('Original');assert.equal(await pending,undefined);
    assert.equal(writes,0);assert.equal(buffer,'Intervening ordinary edit');
  }
});

test('pane replacement during disk boundary validation retries without changing detached or competing views',async()=>{
  let writes=0,release!:(text:string)=>void;
  const file={path:'Note.md'},view={file,editor:{getValue:()=> 'Original',replaceRange:()=>{writes++;}}};
  let leaves=[{view}];const disk=new Promise<string>(done=>release=done);
  const io=deviceNoteIO({workspace:{getLeavesOfType:()=>leaves},vault:{getFileByPath:()=>file,read:()=>disk}} as any);
  const pending=io.updateNote('Note.md',current=>current+' Reply',()=>true);
  leaves=[{view:{file,editor:{getValue:()=> 'Competing pane',replaceRange:()=>{writes++;}}}}];
  release('Original');assert.equal(await pending,undefined);assert.equal(writes,0);
});
test('new Live Preview response anchors are saved before registration can attach a native projection',async()=>{
  const id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',file={path:'Note.md'};let buffer='Prompt\n',disk=buffer,release!:()=>void,saves=0;
  const pendingSave=new Promise<void>(resolve=>release=resolve);
  const editor={getValue:()=>buffer,offsetToPos:(n:number)=>n,replaceRange:(text:string,from:number,to:number)=>{buffer=buffer.slice(0,from)+text+buffer.slice(to);}};
  const view={file,editor,getMode:()=> 'source',save:async()=>{saves++;await pendingSave;disk=buffer;}};
  const io=deviceNoteIO({workspace:{getLeavesOfType:()=>[{view}]},vault:{getFileByPath:()=>file,read:async()=>disk}} as any);
  let returned=false;const work=io.updateNote(file.path,current=>current+responseAnchor(id),()=>true).then(value=>{returned=true;return value;});
  for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(saves,1);assert.equal(returned,false);assert.equal(disk,'Prompt\n');assert.ok(!buffer.includes('Working'));
  release();assert.equal(await work,disk);assert.ok(disk.includes(responseAnchor(id)));
});
test('a save that does not persist a new response anchor cannot authorize registration',async()=>{
  const id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',file={path:'Note.md'};let buffer='Prompt\n';
  const editor={getValue:()=>buffer,offsetToPos:(n:number)=>n,replaceRange:(text:string,from:number,to:number)=>{buffer=buffer.slice(0,from)+text+buffer.slice(to);}};
  const view={file,editor,getMode:()=> 'source',save:async()=>{}};
  const io=deviceNoteIO({workspace:{getLeavesOfType:()=>[{view}]},vault:{getFileByPath:()=>file,read:async()=> 'Prompt\n'}} as any);
  await assert.rejects(io.updateNote(file.path,current=>current+responseAnchor(id),()=>true),/boundaries were not saved/);
});
