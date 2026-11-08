import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readImportThreads,readImportRuns,readImportRun,readImportPreview,importHistoryState} from '../src/conversations/import-source';
import {importRuns,importRunPreview} from '../src/conversations/run-import';
import type {ThreadAccess} from '../src/conversations/thread-stream';

const at='2026-11-07T12:00:00.000Z';
const thread={id:'thread',projectId:'project',title:'Synthetic long conversation'};
const run=(ordinal:number,status='completed')=>({id:'run-'+ordinal,ordinal,status,userMessageId:'prompt-'+ordinal,prompt:'Prompt '+ordinal,requestedAt:at,completedAt:at});

test('import lists read exact paged run identities without any transcript or tool download',async()=>{
 const paths:string[]=[];
 const access:ThreadAccess={origin:'https://fixture',api:async path=>{
  paths.push(path);
  if(path.endsWith('/projects/project/threads'))return {threads:[{...thread,updatedAt:at,session:{status:'ready'}}]};
  if(path.endsWith('/import-runs'))return {thread,runs:[run(102),run(101,'failed')],nextOrdinal:101};
  if(path.endsWith('?beforeOrdinal=101'))return {thread,runs:[run(1),{...run(0),userMessageId:null}],nextOrdinal:null};
  throw Error('A catalog must not read the full thread or any answer.');
 }};
 assert.equal((await readImportThreads(access,'project'))[0].id,'thread');
 const runs=await readImportRuns(access,'thread','project');
 assert.deepEqual(runs.map(row=>[row.turnId,row.messageId,row.status]),[['run-102','prompt-102','Completed'],['run-101','prompt-101','Failed'],['run-1','prompt-1','Completed']]);
 assert.equal(paths.length,3);assert.ok(paths.every(path=>path.includes('/import')));
});

test('selected import keeps the complete answer, item identity, watermark and HTML reference',async()=>{
 const text='Complete answer: 日本語. '.repeat(40_000),selected=run(1),paths:string[]=[];
 const messages=[{id:'prompt-1',role:'user',runId:selected.id,text:'Original prompt',streaming:false,createdAt:at},{id:'answer',role:'assistant',runId:selected.id,text,streaming:false,createdAt:at}];
 const turnItems=[{id:'answer-item',type:'assistant_message',messageId:'answer',runId:selected.id,ordinal:2,status:'completed',updatedAt:at},
  {id:'html-item',threadId:'thread',runId:selected.id,type:'dynamic_tool',toolName:'t3-code.html_render',status:'completed',ordinal:3,updatedAt:at,output:{htmlRender:{attachmentId:'html',title:'Synthetic app',height:900}}}];
 const access:ThreadAccess={origin:'https://fixture',api:async path=>{paths.push(path);return {snapshotSequence:1234,nextOrdinal:null,thread,runs:[selected],messages,turnItems};}};
 const {snapshot,state}=await readImportRun(access,'thread','project',selected.id);
 assert.equal(snapshot.snapshotSequence,1234);assert.equal(state.historyComplete,true);
 assert.equal(state.messages.find(message=>message.id==='answer')?.text,text);
 assert.equal(state.messages.find(message=>message.id==='answer')?.itemId,'answer-item');
 const imported=importRuns(state)[0];assert.equal(imported.turnId,'run-1');assert.equal(imported.status,'Completed');
 const preview=importRunPreview(state,imported,'environment','thread');assert.ok(preview.body.length<=24_000);assert.equal(preview.html[0].itemId,'html-item');
 assert.deepEqual(paths,['/api/orchestration/threads/thread/import-runs/run-1']);
});

test('wrong source identities and repeated page cursors fail without inventing a run association',async()=>{
 await assert.rejects(readImportRuns({origin:'test',api:async()=>({thread:{...thread,id:'other'},runs:[],nextOrdinal:null})},'thread','project'),/invalid import run index/);
 let calls=0;
 await assert.rejects(readImportRuns({origin:'test',api:async()=>{calls++;return {thread,runs:[run(3)],nextOrdinal:3};}},'thread','project'),/invalid import page cursor/);
 assert.equal(calls,2);
 await assert.rejects(readImportRun({origin:'test',api:async()=>({snapshotSequence:1,nextOrdinal:null,thread,runs:[run(2)],messages:[],turnItems:[]})},'thread','project','run-1'),/another response/);
});
test('selected-run paging preserves the first watermark and caller cancellation stops a stalled read',async()=>{
 const selected=run(1),paths:string[]=[];
 const access:ThreadAccess={origin:'test',api:async path=>{
  paths.push(path);return {snapshotSequence:paths.length===1?40:41,nextOrdinal:paths.length===1?10:null,thread,runs:[selected],
   messages:paths.length===1?[{id:'prompt-1',role:'user',runId:selected.id,text:'Original',streaming:false,createdAt:at}]:[],
   turnItems:[{id:'item-'+paths.length,type:'command_execution',runId:selected.id,ordinal:paths.length===1?10:20,status:'completed',updatedAt:at,input:'synthetic',output:'Complete output '+paths.length}]};
 }};
 const result=await readImportRun(access,'thread','project',selected.id);
 assert.equal(result.snapshot.snapshotSequence,40);assert.equal(result.state.activities.length,2);
 assert.deepEqual(paths,['/api/orchestration/threads/thread/import-runs/run-1','/api/orchestration/threads/thread/import-runs/run-1?afterOrdinal=10']);
 const controller=new AbortController();let entered!:()=>void;const started=new Promise<void>(resolve=>{entered=resolve;});
 const pending=readImportRuns({origin:'test',api:async()=>{entered();return new Promise(()=>{});}},'thread','project',controller.signal);
 await started;const rejected=assert.rejects(pending,/User cancelled/);controller.abort(Error('User cancelled'));await rejected;
});

test('registration reads one page and explicitly leaves further tool history for the response feed',async()=>{
 let calls=0;const selected=run(1);
 const result=await readImportRun({origin:'test',api:async()=>{calls++;return {snapshotSequence:7,nextOrdinal:40,thread,runs:[selected],messages:[{id:'prompt-1',role:'user',runId:null,text:'Complete root input',streaming:false,createdAt:at}],turnItems:[]};}},'thread','project',selected.id,{firstPageOnly:true});
 assert.equal(calls,1);assert.equal(result.state.historyComplete,false);assert.equal(result.state.messages[0].text,'Complete root input');
 const index=await readImportRuns({origin:'test',api:async()=>({thread,runs:[run(3),run(2),run(1)],nextOrdinal:null})},'thread','project');
 const combined=importHistoryState(index,result.state,'prompt-1');
 assert.equal(combined.run?.status,'Completed');assert.equal(combined.run?.unavailable,undefined,'pending tool pages must not make an exact run unavailable');
 assert.equal(combined.state.historyComplete,false);assert.deepEqual(combined.state.messages.filter(message=>message.role==='user').map(message=>message.id),['prompt-1','prompt-2','prompt-3']);
 assert.equal(combined.state.messages.find(message=>message.id==='prompt-1')?.text,'Complete root input');
});

test('older servers retain their supported import flow and previews reuse the already read state',async()=>{
 const paths:string[]=[],controller=new AbortController(),turn={turnId:'run-1',messageId:'prompt-1',state:'completed',requestedAt:at,completedAt:at};
 const access:ThreadAccess={origin:'test',api:async(path,_payload,options)=>{
  paths.push(path);assert.equal(options?.signal,controller.signal);
  if(path.endsWith('/import-runs'))throw Object.assign(Error('Endpoint unavailable'),{status:404});
  assert.ok(path.includes('importRuns=true'));
  return {snapshotSequence:10,page:{hasMore:false},thread:{...thread,turns:{'run-1':turn},latestTurn:turn,session:{status:'ready',activeTurnId:null},activities:[],messages:[
   {id:'prompt-1',role:'user',text:'Original prompt',streaming:false,createdAt:at,turnId:'run-1'},
   {id:'answer',role:'assistant',text:'Complete saved answer',streaming:false,createdAt:at,turnId:'run-1'}]}};
 }};
 const runs=await readImportRuns(access,'thread','project',controller.signal);assert.equal(runs.length,1);
 const preview=await readImportPreview(access,'thread','project',runs[0],'environment',controller.signal);
 assert.equal(preview.body,'Complete saved answer');assert.equal(paths.length,2,'hover must not download the old full transcript again');
 await assert.rejects(readImportRuns({origin:'test',api:async()=>{throw Object.assign(Error('Sign in'),{status:401});}},'thread','project'),/Sign in/);
});
