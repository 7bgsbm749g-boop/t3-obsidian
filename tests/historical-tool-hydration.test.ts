import {test} from 'node:test';
import assert from 'node:assert/strict';
import {t3Api} from '../src/connection/t3-api';
import {readInlineSnapshot} from '../src/conversations/thread-stream';
import {applyThreadItem} from '../src/conversations/inline-thread';
import {incomingLabel} from '../src/conversations/inline-steering';
import {checkFinalResponse} from '../src/responses/final-response';
import {responseHtmlResults,renderHtmlResult} from '../src/responses/html-results';
import {pendingQuestions} from '../src/interaction/questions';
import {pendingApprovals} from '../src/interaction/approvals';
import {handoffProjection,handoffItem} from './fixtures/worktree-handoff';
import {settingsSocket} from './rpc-fixture';
import {expectRecord} from './wire-fixture';

const at='2026-11-15T12:00:00.000Z',later='2026-11-15T12:01:00.000Z';
const old={id:'old-run',ordinal:1,userMessageId:'old-prompt',status:'completed',completedAt:at};
const current={id:'current-run',ordinal:2,userMessageId:'prompt',status:'running',requestedAt:at};
const senderThreadId='2c9cb7b6-a4c9-5746-b9b7-bc463c5024fa';
const tool=(id:string,runId=old.id)=>({id,type:'command_execution',runId,ordinal:1,status:'completed',outputOmitted:true,updatedAt:at});
const wire=(overrides:any={})=>({snapshotSequence:10,hasMoreHistory:false,projection:{thread:{id:'thread',projectId:'project'},runs:[old,current],messages:[{id:'prompt',role:'user',runId:current.id,text:'Prompt',streaming:false,createdAt:at}],turnItems:[],runtimeRequests:[],...overrides}});
const data=(snapshot:Awaited<ReturnType<typeof readInlineSnapshot>>,id:string)=>expectRecord(expectRecord(snapshot.thread.activities!.find(a=>a.id===`v2:${id}`)!.payload).data);

test('active reads defer historical display work, explicit history fills the exact-revision cache, and final evidence remains authoritative',async()=>{
 const paths:string[]=[],reads:string[]=[];
 const tools=Array.from({length:120},(_,i)=>({...tool('tool-'+i),ordinal:i}));
 const answer={id:'answer-item',type:'assistant_message',threadId:'thread',messageId:'answer',runId:current.id,text:'Current reply',streaming:false,status:'completed',updatedAt:at};
 let snapshot=wire({runs:[old,{...current,status:'completed',completedAt:at}],messages:[{id:'prompt',role:'user',runId:current.id,text:'Prompt',streaming:false,createdAt:at,createdBy:'agent',senderThreadId},{id:'answer',role:'assistant',runId:current.id,text:'Current reply',streaming:false,createdAt:at}],turnItems:[...tools,answer]});
 const Socket=settingsSocket(undefined,undefined,(tag,payload)=>{assert.equal(tag,'orchestration.getTurnItem');reads.push(payload.itemId);return {item:payload.itemId===answer.id?answer:{...tools.find(item=>item.id===payload.itemId),updatedAt:payload.revision,output:payload.revision,outputOmitted:false}};});
 const api=t3Api(async path=>{paths.push(path);if(path==='/api/auth/websocket-ticket')return {ticket:'fixture'};if(path==='/api/orchestration/shell')return {threads:[{id:senderThreadId,title:'Sender title'}]};return snapshot;},'https://fixture',url=>new Socket(url) as any),access={origin:'https://fixture',api};
 try{
  const first=await readInlineSnapshot(access,'thread'),state=applyThreadItem({messages:[],activities:[]},{kind:'snapshot',snapshot:first}).state;
  assert.equal(state.messages.at(-1)?.text,'Current reply');assert.equal(state.latestTurn?.state,'completed');assert.equal(incomingLabel(state.messages.find(message=>message.id==='prompt')!),'Agent · 2c9cb7b6');
  assert.deepEqual(paths,['/api/orchestration/threads/thread/bounded?compactTurnItems=1']);assert.deepEqual(reads,[]);
  assert.equal((await checkFinalResponse(access,'thread',state,current.id)).verified,true);assert.deepEqual(reads,[answer.id]);reads.length=0;
  const history=await readInlineSnapshot(access,'thread',undefined,undefined,true);
  assert.equal(incomingLabel(history.thread.messages!.find(message=>message.id==='prompt')!),'Agent · Sender title');assert.equal(reads.length,40);assert.equal(data(history,'tool-119').output,at);
  paths.length=0;reads.length=0;
  const next=await readInlineSnapshot(access,'thread');assert.equal(incomingLabel(next.thread.messages!.find(message=>message.id==='prompt')!),'Agent · Sender title');assert.equal(data(next,'tool-119').output,at);
  assert.deepEqual(reads,[]);assert.deepEqual(paths,['/api/orchestration/threads/thread/bounded?compactTurnItems=1']);
  snapshot=wire({...snapshot.projection,turnItems:[{...tools[119],updatedAt:later},answer]});
  assert.equal(data(await readInlineSnapshot(access,'thread'),'tool-119').output,'Output details are not available yet.','An old revision must never be substituted');
  await readInlineSnapshot(access,'thread',undefined,undefined,true);assert.deepEqual(reads,['tool-119']);
  assert.equal(data(await readInlineSnapshot(access,'thread'),'tool-119').output,later);
  snapshot=wire({...snapshot.projection,thread:{id:'other-thread',projectId:'project'}});
  assert.equal(data(await readInlineSnapshot(access,'other-thread'),'tool-119').output,'Output details are not available yet.','Thread identities must not share cached output');
 }finally{api.disposeUnaryRpc?.();}
});

test('current, queued, unknown and exact old response targets keep tool results while unrelated terminal runs defer',async()=>{
 for(const targets of [{messageIds:[],turnIds:[old.id]},{messageIds:['old-prompt'],turnIds:[]},{messageIds:['old-answer'],turnIds:[]}]){
  const items=[tool('old-target'),tool('historical','unrelated'),tool('current',current.id),tool('queued','queued'),tool('unknown','unknown'),tool('without-run',null as any)];
  const reads:string[]=[],Socket=settingsSocket(undefined,undefined,(_tag,payload)=>{reads.push(payload.itemId);return {item:{...items.find(item=>item.id===payload.itemId),output:'Result',outputOmitted:false}};});
  const api=t3Api(async path=>path==='/api/auth/websocket-ticket'?{ticket:'fixture'}:wire({runs:[{...old,id:'unrelated',ordinal:0,userMessageId:'unrelated-prompt'},old,current,{id:'queued',ordinal:3,status:'queued'}],messages:[{id:'old-answer',role:'assistant',runId:old.id,text:'Old result'}],turnItems:items}),'https://fixture',url=>new Socket(url) as any);
  try{
   const result=await readInlineSnapshot({origin:'https://fixture',api},'thread',undefined,targets);
   assert.deepEqual(reads,['old-target','current','queued','unknown','without-run']);
   for(const id of reads)assert.equal(data(result,id).output,'Result');
   assert.equal(result.thread.session?.activeTurnId,current.id);
  }finally{api.disposeUnaryRpc?.();}
 }
});

test('required handoff proof survives the recent window, history fallback and pending approval/question ownership',async()=>{
 const handoff={...handoffItem,outputOmitted:true,output:undefined,updatedAt:at},reads:string[]=[],paths:string[]=[];
 const tools=Array.from({length:120},(_,i)=>({...tool('tool-'+i,'unrelated'),ordinal:i+1}));
 const controls=['approval_request','user_input_request'].map((type,i)=>({id:type,type,runId:'resume',requestId:'request-'+i,ordinal:122+i,status:'waiting',updatedAt:at,questions:[{id:'choice',header:'Choice',question:'Choose',options:[]}]}));
 const snapshot=handoffProjection({runs:[{...old,id:'unrelated',ordinal:0},{id:'source',ordinal:1,status:'interrupted',userMessageId:'old-message'},{id:'resume',ordinal:2,status:'running'}],turnItems:[handoff,...tools,...controls],runtimeRequests:controls.map((item,i)=>({id:item.requestId,status:'pending',kind:i?'user_input':'command',responseCapability:{type:'live'}}))});
 const Socket=settingsSocket(undefined,undefined,(_tag,payload)=>{reads.push(payload.itemId);assert.equal(payload.itemId,handoff.id);return {item:{...handoffItem,outputOmitted:false,updatedAt:at}};});
 const api=t3Api(async path=>{paths.push(path);if(path==='/api/auth/websocket-ticket')return {ticket:'fixture'};if(path.includes('/history?'))return {items:[{sourceThreadId:'thread',item:{id:'old-prompt',type:'user_message',runId:'source',messageId:'old-message',text:'Old prompt'}}],hasMoreHistory:false};return {...snapshot,hasMoreHistory:true,historyCursor:'older'};},'https://fixture',url=>new Socket(url) as any);
 try{
  const result=await readInlineSnapshot({origin:'https://fixture',api},'thread',undefined,{messageIds:['old-message'],turnIds:[]});
  assert.ok(paths.some(path=>path.includes('/history?')));assert.deepEqual(reads,[handoff.id]);
  assert.equal(result.thread.worktreeHandoffs?.[handoff.id].status,'scheduled');assert.equal(result.thread.session?.activeTurnId,'resume');
  assert.equal(pendingQuestions(result.thread.activities!).length,1);assert.equal(pendingApprovals(result.thread.activities!).length,1);assert.equal(result.thread.hasPendingApprovals,true);assert.equal(result.thread.hasPendingUserInput,true);
  assert.ok(result.thread.messages?.some(message=>message.id==='old-message'));assert.equal(result.snapshotSequence,10);
 }finally{api.disposeUnaryRpc?.();}
});

test('historical HTML results and supplied sender metadata remain available to saved replies',async()=>{
 for(const toolName of ['html_render','mcp__t3_code__html_render','mcp__t3-code__html_render','t3-code.html_render','t3_code.html_render']){
  const html={...tool('html'),type:'dynamic_tool',toolName},reads:string[]=[],htmlRender={attachmentId:'page',title:'Chart',height:320};
  const Socket=settingsSocket(undefined,undefined,(_tag,payload)=>{reads.push(payload.itemId);return {item:{...html,output:{htmlRender},outputOmitted:false}};});
  const api=t3Api(async path=>{if(path==='/api/auth/websocket-ticket')return {ticket:'fixture'};assert.ok(path.includes('/bounded?'));return wire({messages:[{id:'prompt',role:'user',runId:current.id,text:'Prompt',streaming:false,createdAt:at,createdBy:'agent',senderThreadId,senderThreadTitle:'Supplied title'}],turnItems:[tool('optional'),html]});},'https://fixture',url=>new Socket(url) as any);
  try{
   const result=await readInlineSnapshot({origin:'https://fixture',api},'thread');assert.deepEqual(reads,['html']);assert.equal(incomingLabel(result.thread.messages![0]),'Agent · Supplied title');
   const references=responseHtmlResults(result.thread.activities!,[old.id],'environment','thread');assert.equal(references.length,1);assert.deepEqual(references[0],{version:1,environmentId:'environment',threadId:'thread',runId:old.id,itemId:'html',revision:at,...htmlRender});assert.match(renderHtmlResult(references[0]),/```t3-html/);
  }finally{api.disposeUnaryRpc?.();}
 }
});

test('active recovery keeps continuation and cancellation options; explicit history and imports request details',async()=>{
 for(const mode of ['active','full','import','run']){
  let version=0;const options:any[]=[];
  const controller=new AbortController(),access={origin:'https://fixture',api:async(_path:string,_payload?:unknown,option?:any)=>{options.push(option);return {snapshotSequence:10,page:{hasMore:true},thread:{id:'thread',projectId:'project',messages:[],activities:[]}};}};
  await readInlineSnapshot(access,'thread',undefined,()=>({messageIds:['old-message'],turnIds:[old.id],recoveryVersion:String(version)}),mode!=='active',mode==='import',mode==='run'?old.id:undefined,controller.signal);
  assert.equal(options.length,mode==='active'?2:1);
  for(const option of options){assert.equal(option.signal,controller.signal);assert.equal(!!option.deferHistoricalDetails,mode==='active');}
  assert.equal(options.at(-1).continueHistory(),true);version++;assert.equal(options.at(-1).continueHistory(),false);
 }
});
