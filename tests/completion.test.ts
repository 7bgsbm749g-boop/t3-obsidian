import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CompletionJob, CleanupIO, cleanCompletedNote, completionState, contentHash, initialMessageId, isOriginalCompletedTurn} from '../src/responses/completion';
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
test('legacy cleanup requests always retain notes without file, archive or deletion operations',async()=>{
 for(const action of ['archive','delete'] as const){
  const f=fixture(),j=job(action);
  for(const key of Object.keys(f.io) as Array<keyof CleanupIO>)(f.io as any)[key]=()=>{throw Error('Legacy cleanup must not access or change notes');};
  assert.equal(await cleanCompletedNote(j,f.io),'Kept note.');
  assert.equal(f.files.get(j.notePath)!.text,'original');assert.equal(f.trash.length,0);assert.equal(j.destination,undefined);
 }
});
