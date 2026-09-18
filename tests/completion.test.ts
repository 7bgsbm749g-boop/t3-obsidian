import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CompletionJob, CleanupIO, archiveFolder, cleanCompletedNote, completionState, contentHash, initialMessageId, isOriginalCompletedTurn} from '../completion';
function job(action:'archive'|'delete'='archive'):CompletionJob {return {requestId:'50b38c2e-24bf-47fc-a934-461977de14d1',threadId:'t',projectId:'p',connection:{executable:'adapter',host:'vps'},notePath:'Tasks/a.md',contentHash:contentHash('original'),ctime:10,action,archiveFolder:'Archive/T3 Code',status:'watching'};}
function fixture() {
 const files=new Map([['Tasks/a.md',{path:'Tasks/a.md',ctime:10,text:'original'}]]);const folders=new Set(['Tasks']);const trash:string[]=[];let saved=0;let unsaved=false;let enabled=true;
 const io:CleanupIO={find:p=>files.get(p)??null,read:async f=>files.get(f.path)!.text,hasUnsavedChanges:()=>unsaved,exists:p=>files.has(p)||folders.has(p),mkdir:async p=>{folders.add(p);},move:async(f,p)=>{assert.ok(!files.has(p));const value=files.get(f.path)!;files.delete(f.path);files.set(p,{...value,path:p});},trash:async f=>{trash.push(f.path);files.delete(f.path);},save:async()=>{saved++;},active:()=>enabled};
 return {files,folders,trash,io,setUnsaved:()=>{unsaved=true;},stop:()=>{enabled=false;},saved:()=>saved};
}
test('completion requires correct thread, successful state, idle session and explicit absence of pending input',()=>{
 const j=job();const t={id:'t',projectId:'p',latestTurn:{state:'completed'},session:{status:'ready',activeTurnId:null,lastError:null},hasPendingApprovals:false,hasPendingUserInput:false};
 assert.equal(completionState(t,j),'complete');
 assert.equal(completionState({...t,session:{status:'stopped',activeTurnId:null,lastError:null}},j),'complete');
 for(const mutation of [{id:'other'},{projectId:'other'},{latestTurn:{state:'running'}},{hasPendingUserInput:true},{hasPendingApprovals:true},{hasPendingUserInput:undefined},{session:{status:'running',activeTurnId:'x'}}])assert.equal(completionState({...t,...mutation},j),'wait');
 assert.equal(completionState({...t,latestTurn:{state:'interrupted'}},j),'keep');
 assert.equal(completionState({...t,session:{status:'error'}},j),'keep');
});
test('a later conversation turn cannot trigger cleanup of the original note',()=>{
 const j=job();const t={id:'t',projectId:'p',latestTurn:{state:'completed',assistantMessageId:'a'},session:{status:'ready'},messages:[{id:initialMessageId(j.requestId),role:'user'},{id:'a',role:'assistant',streaming:false}]};
 assert.equal(isOriginalCompletedTurn(t,j),true);
 assert.equal(isOriginalCompletedTurn({...t,messages:[...t.messages,{id:'later',role:'user'}]},j),false);
 assert.equal(isOriginalCompletedTurn({...t,messages:[{id:'wrong',role:'user'},t.messages[1]]},j),false);
});
test('archive preserves subfolders, avoids overwrite and records its destination before moving',async()=>{
 const f=fixture();const j=job();f.files.set('Archive/T3 Code/Tasks/a.md',{path:'Archive/T3 Code/Tasks/a.md',ctime:1,text:'other'});
 await cleanCompletedNote(j,f.io);
 assert.equal(j.destination,'Archive/T3 Code/Tasks/a (1).md');assert.ok(f.saved()>0);
 assert.equal(f.files.get('Archive/T3 Code/Tasks/a.md')!.text,'other');assert.equal(f.files.get(j.destination!)!.text,'original');assert.equal(f.files.has(j.notePath),false);
 // Restart after a successful move but before completion status was saved.
 await cleanCompletedNote(JSON.parse(JSON.stringify(j)),f.io);assert.equal(f.files.size,2);
});
test('delete uses the supplied trash operation once, including after restart',async()=>{
 const f=fixture();const j=job('delete');await cleanCompletedNote(j,f.io);await cleanCompletedNote(JSON.parse(JSON.stringify(j)),f.io);assert.deepEqual(f.trash,['Tasks/a.md']);
});
test('edited, replaced, renamed and unsaved notes are retained',async()=>{
 for(const action of ['archive','delete'] as const) for(const kind of ['edited','replaced','renamed','unsaved']){
  const f=fixture();const j=job(action);
  if(kind==='edited')f.files.get(j.notePath)!.text='new work';
  if(kind==='replaced')f.files.get(j.notePath)!.ctime=20;
  if(kind==='renamed'){const file=f.files.get(j.notePath)!;f.files.delete(j.notePath);f.files.set('renamed.md',{...file,path:'renamed.md'});}
  if(kind==='unsaved')f.setUnsaved();
  await cleanCompletedNote(j,f.io);assert.equal(f.files.size,1);assert.equal(f.trash.length,0);
 }
});
test('shutdown and failure to save the archive plan prevent moving the note',async()=>{
 const f=fixture();f.stop();await assert.rejects(cleanCompletedNote(job(),f.io),/stopped/);assert.ok(f.files.has('Tasks/a.md'));
 const g=fixture();g.io.save=async()=>{throw new Error('disk full');};await assert.rejects(cleanCompletedNote(job(),g.io),/disk full/);assert.ok(g.files.has('Tasks/a.md'));
});
test('archive paths cannot escape the vault or use internal folders',()=>{
 for(const p of ['','../outside','/tmp','C:\\temp','.obsidian','Archive/../Notes','Archive/.trash','Archive//Notes'])assert.throws(()=>archiveFolder(p));
 assert.equal(archiveFolder('Archive\\T3 Code'),'Archive/T3 Code');
});
