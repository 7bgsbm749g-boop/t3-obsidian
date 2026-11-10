import {test} from 'node:test';
import assert from 'node:assert/strict';
import {t3Api} from '../src/connection/t3-api';
import {readImportThreads,readImportRuns,readImportRun,readImportPreview,importHistoryState} from '../src/conversations/import-source';
import type {ThreadAccess} from '../src/conversations/thread-stream';

const date=(n:number)=>new Date(Date.UTC(2026,0,1,0,n)).toISOString();
const thread={id:'thread',projectId:'project',title:'Long conversation'};
const run=(n:number)=>({id:'run-'+n,status:'completed',ordinal:n,userMessageId:'prompt-'+n,requestedAt:date(n),completedAt:date(n+0.5)});
const message=(n:number,role:'user'|'assistant')=>({id:(role==='user'?'prompt-':'answer-')+n,role,runId:'run-'+n,text:role==='user'?'Original prompt '+n:'Complete answer '+n,streaming:false,createdAt:date(n+(role==='assistant'?0.5:0))});
function fixture(progress=false){
 const paths:string[]=[];let reads=0;
 const api=t3Api(async(path,_payload,options)=>{
  paths.push(path);reads++;
  if(path==='/api/orchestration/shell')return {threads:[thread,{id:'other',projectId:'another'}]};
  if(path.includes('/bounded?'))return {snapshotSequence:7,hasMoreHistory:true,historyCursor:'opaque / older',turnItemsOmitLocalVisible:true,projection:{thread,runs:[run(3)],messages:[message(3,'user'),...(progress?[{...message(3,'assistant'),id:'earlier-progress',text:'Earlier public progress. '.repeat(20_000),createdAt:date(3.2)}]:[]),message(3,'assistant')],turnItems:[],visibleTurnItems:[]}};
  assert.ok(path.includes('/history?cursor=opaque%20%2F%20older&view=conversation&deferWork=1'),'only documented bounded/history reads are permitted');
  assert.equal(options?.signal?.aborted??false,false);
  assert.equal(options?.compactImport,true,'history pages also discard unrelated JSON fields while streaming');
  return {snapshotSequence:9,items:[1,2].flatMap(n=>['user','assistant'].map(role=>{const m=message(n,role as 'user'|'assistant');return {sourceThreadId:'thread',item:{id:'item-'+m.id,type:role+'_message',messageId:m.id,runId:m.runId,text:m.text,streaming:false,ordinal:n*2+(role==='assistant'?1:0),startedAt:m.createdAt}};})),hasMoreHistory:false,nextCursor:null};
 },'https://stock.example');
 const access:ThreadAccess={origin:'https://stock.example',api};
 return {paths,access,reads:()=>reads};
}

test('thread choices use the regular shell and stay within the selected project',async()=>{
 const {access,paths}=fixture();assert.deepEqual((await readImportThreads(access,'project')).map(row=>row.id),['thread']);assert.deepEqual(paths,['/api/orchestration/shell']);
});

test('regular bounded pages recover older exact roots without custom endpoints or unrelated output hydration',async()=>{
 const {access,paths}=fixture(),runs=await readImportRuns(access,'thread','project');
 assert.deepEqual(runs.map(run=>run.turnId),['run-3','run-2','run-1']);
 assert.ok(runs.every(run=>run.status==='Completed'&&run.turn?.state==='completed'));
 assert.equal(runs[2].messageId,'prompt-1');assert.equal(paths.length,2);
 assert.ok(paths[0].endsWith('/bounded?compactTurnItems=1&deferWork=1&dedupeBodies=1'));
 assert.ok(paths.every(path=>!path.includes('import-runs')&&!path.includes('/import/')));
});

test('preview and first paint reuse the exact canonical selection while final saving still needs verification',async()=>{
 const {access,reads}=fixture(),runs=await readImportRuns(access,'thread','project'),selected=runs[2];
 const preview=await readImportPreview(access,'thread','project',selected,'environment');assert.equal(preview.body,'Complete answer 1');assert.equal(reads(),2);
 const result=await readImportRun(access,'thread','project','run-1',{selected,firstPageOnly:true});assert.equal(reads(),2);assert.equal(result.state.historyComplete,false);
 assert.equal(result.snapshot.thread.turns?.['run-1'].state,'completed','the older exact selection can seed its completed import');
 assert.equal(result.state.messages.find(m=>m.id==='answer-1')?.text,'Complete answer 1');
 const history=importHistoryState(runs,result.state,'prompt-1');assert.equal(history.run?.status,'Completed');assert.equal(history.state.historyComplete,false);
});

test('first paint uses the exact final answer while the fresh read preserves all earlier progress',async()=>{
 const {access}=fixture(true),runs=await readImportRuns(access,'thread','project'),selected=runs[0];
 const first=await readImportRun(access,'thread','project','run-3',{selected,firstPageOnly:true});
 assert.deepEqual(first.state.messages.map(message=>message.id),['prompt-3','answer-3']);assert.equal(first.state.messages.at(-1)?.text,'Complete answer 3');assert.equal(first.state.historyComplete,false);
 const fresh=await readImportRun(access,'thread','project','run-3',{preview:true});assert.ok(fresh.state.messages.some(message=>message.id==='earlier-progress'&&message.text.length===500_000));assert.equal(fresh.state.historyComplete,true);
});

test('a new read performs authoritative requests instead of treating the preview cache as a final receipt',async()=>{
 const {access,reads}=fixture();await readImportRuns(access,'thread','project');const before=reads();
 await readImportRun(access,'thread','project','run-1',{preview:true});assert.equal(reads(),before+2);
 await assert.rejects(readImportRun(access,'thread','project','unrelated',{preview:true}),/selected response/);
});

test('another project or thread cannot supply a selected response',async()=>{
 const {access}=fixture();await assert.rejects(readImportRuns(access,'thread','another'),/requested T3 thread/);
});

test('caller cancellation prevents a read and is preserved through catalog, preview and history operations',async()=>{
 const controller=new AbortController();controller.abort(Error('User closed the picker'));let calls=0;
 const access:ThreadAccess={origin:'test',api:async()=>{calls++;throw Error('Must not read');}};
 await assert.rejects(readImportThreads(access,'project',controller.signal),/User closed/);
 await assert.rejects(readImportRuns(access,'thread','project',controller.signal),/User closed/);
 await assert.rejects(readImportRun(access,'thread','project','run-1',{signal:controller.signal}),/User closed/);assert.equal(calls,0);
});

test('canonical recent runs appear while older pages wait, and their partial snapshot cannot authorize a save',async()=>{
 let release!:(page:unknown)=>void;
 const older=new Promise<unknown>(resolve=>{release=resolve;}),progress:any[][]=[];
 const api=t3Api(async path=>path.includes('/bounded?')?{snapshotSequence:7,hasMoreHistory:true,historyCursor:'older',projection:{thread,runs:[run(3)],messages:[message(3,'user'),message(3,'assistant')],turnItems:[],visibleTurnItems:[]}}:older,'https://stock.example');
 const access={origin:'https://stock.example',api},work=readImportRuns(access,'thread','project',undefined,runs=>progress.push(runs));
 await new Promise(resolve=>setImmediate(resolve));assert.equal(progress.length,1);assert.deepEqual(progress[0].map(run=>run.turnId),['run-3']);
 const selected=progress[0][0],preview=await readImportPreview(access,'thread','project',selected,'machine');assert.equal(preview.body,'Complete answer 3');
 const first=await readImportRun(access,'thread','project','run-3',{selected,firstPageOnly:true});assert.equal(first.state.historyComplete,false);assert.equal(first.snapshot.page?.hasMore,true);
 release({snapshotSequence:7,hasMoreHistory:false,nextCursor:null,items:[1,2].flatMap(n=>['user','assistant'].map(role=>{const m=message(n,role as 'user'|'assistant');return {sourceThreadId:'thread',item:{id:'item-'+m.id,type:role+'_message',messageId:m.id,runId:m.runId,text:m.text,ordinal:n*2,startedAt:m.createdAt}};}))});
 assert.deepEqual((await work).map(run=>run.turnId),['run-3','run-2','run-1']);
});

test('progressive choices do not infer a missing persisted lifecycle from an incomplete page',async()=>{
 const progress:any[][]=[];
 const api=t3Api(async()=>({snapshotSequence:7,hasMoreHistory:false,projection:{thread,runs:[],messages:[message(1,'user'),message(1,'assistant'),message(2,'user'),message(2,'assistant')],turnItems:[],visibleTurnItems:[]}}),'https://stock.example');
 const completed=await readImportRuns({origin:'https://stock.example',api},'thread','project',undefined,runs=>progress.push(runs));
 assert.deepEqual(progress,[[]]);assert.ok(completed.some(run=>run.turnId==='run-1'),'the complete canonical boundary can prove the older lifecycle');
});
