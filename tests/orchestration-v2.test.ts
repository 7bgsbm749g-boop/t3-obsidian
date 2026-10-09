import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeV2Snapshot,normalizeV2StreamItem,v2Command} from '../orchestration-v2';
import {applyThreadItem,restoreInlineBindings,inlineBindingCheckpoint,turnForMessage,turnPhase} from '../inline-thread';
import {pendingQuestions} from '../questions';
import {pendingApprovals} from '../approvals';
import {t3Api} from '../t3-api';
import {environmentApi} from '../direct';
import {settingsSocket} from './rpc-fixture';
import {incomingLabel} from '../inline-steering';

const at='2026-10-09T12:00:00.000Z';
const run={id:'app-run',ordinal:1,userMessageId:'prompt',status:'running',requestedAt:at,completedAt:null};
const message={id:'prompt',role:'user',runId:run.id,text:'Hello',streaming:false,createdAt:at};
function snapshot(overrides:any={}){return {snapshotSequence:10,hasMoreHistory:false,projection:{thread:{id:'thread',projectId:'project',title:'Test',runtimeMode:'approval-required'},messages:[message],runs:[run],turnItems:[],runtimeRequests:[],...overrides}};}
const initial=()=>applyThreadItem({messages:[],activities:[]},{kind:'snapshot',snapshot:normalizeV2Snapshot(snapshot())}).state;
const event=(state:any,sequence:number,type:string,payload:any)=>applyThreadItem(state,normalizeV2StreamItem({kind:'event',sequence,event:{type,payload}})).state;

test('native v2 sender identity survives snapshots and live absolute message replacements',()=>{
 const senderThreadId='2c9cb7b6-a4c9-5746-b9b7-bc463c5024fa';
 const input={...message,createdBy:'agent',senderThreadId,senderThreadTitle:'Orchestrator v2 upgrade'};
 let state=applyThreadItem({messages:[],activities:[]},{kind:'snapshot',snapshot:normalizeV2Snapshot(snapshot({messages:[input]}))}).state;
 state=event(state,11,'message.updated',{...input,senderThreadTitle:undefined,text:'Changed'});
 assert.equal(state.messages[0].senderThreadId,senderThreadId);
 assert.equal(incomingLabel(state.messages[0]),'Agent · Orchestrator v2 upgrade');
 const unknown=event(initial(),11,'message.updated',{...input,senderThreadTitle:undefined}).messages[0];
 assert.equal(incomingLabel(unknown),'Agent · 2c9cb7b6');
 assert.equal(incomingLabel({...unknown,createdBy:'user'}),'User');
 assert.equal(incomingLabel({...unknown,senderThreadId:'invalid'}),'User');
});

test('sender titles use only exact same-environment shell IDs and survive paged history',async()=>{
 const senderThreadId='2c9cb7b6-a4c9-5746-b9b7-bc463c5024fa',calls:string[]=[];
 const older={id:'older',type:'user_message',messageId:'older-input',text:'Coordination',runId:run.id,createdBy:'agent',senderThreadId,startedAt:at,ordinal:1};
 const api=t3Api(async path=>{calls.push(path);if(path.endsWith('/bounded'))return {...snapshot(),hasMoreHistory:true,historyCursor:'older'};if(path.includes('/history?'))return {items:[{sourceThreadId:'thread',item:older}],hasMoreHistory:false};if(path==='/api/orchestration/shell')return {threads:[{id:'wrong-id',title:'Wrong source'}],archivedThreads:[{id:senderThreadId,title:'Source thread'}]};throw Error('Unexpected source body read');},'https://t3.example');
 const result=await api('/api/orchestration/threads/thread');
 assert.equal(incomingLabel(result.thread.messages.find((m:any)=>m.id==='older-input')),'Agent · Source thread');
 await api('/api/orchestration/threads/thread');assert.equal(calls.filter(path=>path==='/api/orchestration/shell').length,1);
});

test('unavailable or deleted sender metadata preserves canonical input and uses a source ID label',async()=>{
 const senderThreadId='2c9cb7b6-a4c9-5746-b9b7-bc463c5024fa';
 for(const unavailable of [true,false]){
  const api=t3Api(async path=>{if(path==='/api/orchestration/shell'){if(unavailable)throw Error('offline');return {threads:[]};}return snapshot({messages:[{...message,createdBy:'agent',senderThreadId}]});},'https://t3.example');
  const result=await api('/api/orchestration/threads/thread?turnLimit=1');
  assert.equal(result.thread.messages[0].text,'Hello');assert.equal(result.snapshotSequence,10);
  assert.equal(incomingLabel(result.thread.messages[0]),'Agent · 2c9cb7b6');
 }
});

test('v2 flat snapshots and absolute message updates bind app runs and preserve the event cursor',()=>{
  let state=initial();assert.equal(turnForMessage(state,'prompt'),run.id);
  const reply={id:'reply',role:'assistant',runId:run.id,text:'Hel',streaming:true,createdAt:at};
  state=event(state,11,'message.updated',reply);
  state=event(state,12,'message.updated',{...reply,text:'Hello'});
  state=event(state,12,'message.updated',{...reply,text:'duplicate'});
  assert.equal(state.messages.at(-1)?.text,'Hello');
  state=event(state,13,'provider-turn.updated',{id:'native-turn',status:'completed'});
  state=event(state,14,'node.updated',{id:'child',status:'completed'});
  assert.equal(turnPhase(state,run.id),'running','Native and child completion cannot settle the app run');
  state=event(state,15,'run.updated',{...run,status:'completed',completedAt:at});
  state=event(state,16,'message.updated',{...reply,text:'Final answer',streaming:false});
  assert.equal(turnPhase(state,run.id),'complete');assert.equal(state.latestTurn?.assistantMessageId,'reply');
  state=applyThreadItem(state,normalizeV2StreamItem({kind:'unknown-event',sequence:20})).state;
  assert.equal(state.sequence,20);assert.equal(state.messages.at(-1)?.text,'Final answer');
});

test('queued runs do not replace the active run; canonical failure and cancellation stay terminal',()=>{
  let state=initial();state=event(state,11,'run.created',{...run,id:'queued',ordinal:2,status:'queued',userMessageId:'later'});
  assert.equal(state.latestTurn?.turnId,run.id);assert.equal(state.session?.activeTurnId,run.id);
  state=event(state,12,'run.updated',{...run,id:'queued',ordinal:2,status:'cancelled',userMessageId:'later'});
  assert.equal(state.session?.activeTurnId,run.id,'Cancelling a queued message cannot stop the running response');
  state=event(state,13,'run.updated',{...run,status:'failed',completedAt:at});assert.equal(turnPhase(state,run.id),'error');
  assert.equal(turnPhase(state,'queued'),'interrupted');
  state=event(state,14,'thread.metadata-updated',{title:'Canonical new title'});assert.equal(state.title,'Canonical new title');
});

test('questions and approvals require runtime capabilities and never reopen after resolution',()=>{
  for(const type of ['user_input_request','approval_request']){
    const item={id:'control',runId:run.id,ordinal:2,type,status:'waiting',requestId:'request',startedAt:at,updatedAt:at,questions:[{id:'q',header:'Choice',question:'Choose',options:[]}],prompt:'Run test',requestKind:'command'};
    const request={id:'request',kind:type==='user_input_request'?'user_input':'command',status:'pending',responseCapability:{type:'live'},createdAt:at};
    for(const requestFirst of [false,true]){
      let state=initial();
      state=event(state,11,requestFirst?'runtime-request.updated':'turn-item.updated',requestFirst?request:item);
      assert.equal(state.activities.length,0,'Half a control record cannot offer a response');
      state=event(state,12,requestFirst?'turn-item.updated':'runtime-request.updated',requestFirst?item:request);
      const pending=type==='user_input_request'?pendingQuestions(state.activities):pendingApprovals(state.activities);
      assert.equal(pending.length,1);
      state=event(state,13,'runtime-request.updated',{...request,status:'resolved',resolvedAt:at,answers:{q:['answer']}});
      state=event(state,14,'turn-item.updated',item);
      assert.equal((type==='user_input_request'?pendingQuestions(state.activities):pendingApprovals(state.activities)).length,0);
    }
    const unavailable=normalizeV2Snapshot(snapshot({turnItems:[item],runtimeRequests:[{...request,responseCapability:{type:'not_resumable',reason:'Imported'}}]}));
    assert.equal(unavailable.thread.hasPendingApprovals,false);assert.equal(unavailable.thread.hasPendingUserInput,false);
  }
});

test('v1 saved cursors cannot suppress a v2 snapshot or revive a migrated provider run',()=>{
  const saved:any={sequence:999999,bindings:{prompt:{turnId:'old-provider',kind:'start'}},turns:{'old-provider':{turnId:'old-provider',messageId:'prompt',requestedAt:at,state:'running'}}};
  const wire=snapshot({thread:{id:'thread',projectId:'project',historyOrigin:'v1_import'},messages:[{...message,runId:null}],runs:[]});
  const current=applyThreadItem({...saved,messages:[],activities:[]},{kind:'snapshot',snapshot:normalizeV2Snapshot(wire)}).state;
  const recovered=restoreInlineBindings(current,saved);
  assert.equal(recovered.sequence,10);assert.equal(turnPhase(recovered,'old-provider'),'interrupted');assert.equal(recovered.session?.status,'ready');
  const checkpoint=inlineBindingCheckpoint(recovered);assert.equal(checkpoint.protocolVersion,2);
  const newer=restoreInlineBindings(initial(),{...checkpoint,sequence:100});assert.equal(newer.sequence,100,'Same-protocol cursor protection remains intact');
});

test('v1 completed responses retain their exact saved final message and completion after migration',()=>{
  const saved:any={sequence:999999,bindings:{prompt:{turnId:'old-provider',kind:'explicit'}},turns:{'old-provider':{turnId:'old-provider',messageId:'prompt',assistantMessageId:'old-answer',requestedAt:at,state:'completed'}}};
  const wire=snapshot({thread:{id:'thread',projectId:'project',historyOrigin:'v1_import'},messages:[{...message,runId:null},{...message,id:'old-answer',runId:null,role:'assistant',text:'Saved final answer'}],runs:[]});
  const current=applyThreadItem({messages:[],activities:[]},{kind:'snapshot',snapshot:normalizeV2Snapshot(wire)}).state;
  const recovered=restoreInlineBindings(current,saved);
  assert.equal(turnPhase(recovered,'old-provider'),'complete');assert.equal(recovered.messages.find(m=>m.id==='old-answer')?.turnId,'old-provider');
  const refreshed=applyThreadItem(recovered,{kind:'snapshot',snapshot:normalizeV2Snapshot({...wire,snapshotSequence:11})}).state;
  assert.equal(turnPhase(refreshed,'old-provider'),'complete');assert.equal(refreshed.messages.at(-1)?.text,'Saved final answer');
});

test('v2 mutations use RPC, server delivery policy, runtime IDs, and the separate project API',async()=>{
  const calls:any[]=[],wire:any[]=[];
  const Socket=settingsSocket(undefined,undefined,(tag,payload)=>{wire.push({tag,payload});return {sequence:42};});
  const api=t3Api(async(path,payload)=>{calls.push({path,payload});return {ticket:'ticket'};},'https://t3.example',url=>new Socket(url) as any);
  await api('/api/orchestration/dispatch',{type:'thread.turn.start',commandId:'command',threadId:'thread',createdAt:at,runtimeMode:'full-access',interactionMode:'default',message:{messageId:'prompt',text:'Hello',attachments:[]}});
  assert.equal(wire[0].tag,'orchestration.dispatchCommand');
  assert.deepEqual(wire[0].payload,{type:'message.dispatch',commandId:'command',threadId:'thread',messageId:'prompt',text:'Hello',attachments:[],createdBy:'user',creationSource:'web',deliveryIntent:'auto',dispatchMode:{type:'start_immediately'}});
  await api('/api/orchestration/dispatch',{type:'thread.turn.interrupt',commandId:'stop',threadId:'thread',turnId:run.id,createdAt:at});
  assert.deepEqual(wire[1].payload,{type:'run.interrupt',commandId:'stop',threadId:'thread',runId:run.id,holdQueue:true});
  await api('/api/orchestration/dispatch',{type:'thread.user-input.respond',commandId:'answer',threadId:'thread',requestId:'request',answers:{q:['A']},createdAt:at});
  assert.equal(wire[2].payload.type,'runtime-request.respond');
  await api('/api/orchestration/dispatch',{type:'project.meta.update',commandId:'rename',projectId:'project',title:'New',createdAt:at});
  assert.equal(calls.at(-1).path,'/api/projects/mutate');assert.equal(calls.at(-1).payload.type,'project.update');
  assert.ok(calls.every(c=>c.path!=='/api/orchestration/dispatch'));
  assert.deepEqual(v2Command({type:'thread.create',createdAt:at}),{type:'thread.create',createdBy:'user',creationSource:'web'});
});

test('v2 attachment uploads remap context asset IDs and retain the saved request for an identical retry',async()=>{
  const wire:any[]=[],Socket=settingsSocket(undefined,undefined,(tag,payload)=>{wire.push(payload);return {};});
  const api=t3Api(async()=>({ticket:'ticket'}),'https://t3.example',url=>new Socket(url) as any);
  const command={type:'thread.turn.start',commandId:'command',threadId:'thread',message:{messageId:'prompt',text:'[image](t3-context://context)',attachments:[{type:'image',id:'local-image',name:'a.png',mimeType:'image/png',sizeBytes:1,dataUrl:'data:image/png;base64,YQ=='}],context:{version:1,records:[{contextId:'context',attachmentId:'local-image'}]}}};
  const before=structuredClone(command);await api('/api/orchestration/dispatch',command);await api('/api/orchestration/dispatch',command);
  assert.deepEqual(command,before);assert.deepEqual(wire[0],wire[1]);
  assert.equal(wire[0].context.records[0].attachmentId,wire[0].attachments[0].id);assert.equal(wire[0].context.records[0].contextId,'context');
  assert.ok(!('dataUrl' in wire[0].attachments[0]));
});

test('full recovery follows opaque history cursors without advancing past concurrent live events',async()=>{
  const paths:string[]=[],older={id:'old-item',type:'user_message',messageId:'old-prompt',runId:'old-run',text:'Older',ordinal:0,startedAt:at};
  const api=t3Api(async path=>{paths.push(path);return path.endsWith('/bounded')?{...snapshot(),hasMoreHistory:true,historyCursor:'opaque / cursor'}:{snapshotSequence:50,items:[{sourceThreadId:'thread',item:older}],nextCursor:null,hasMoreHistory:false};},'https://t3.example');
  const bounded=await api('/api/orchestration/threads/thread?turnLimit=20');assert.equal(bounded.page.hasMore,true);assert.equal(paths.length,1);
  const full=await api('/api/orchestration/threads/thread');assert.equal(full.page.hasMore,false);assert.equal(full.snapshotSequence,10);
  assert.equal(full.thread.messages[0].id,'old-prompt');assert.ok(paths.at(-1)?.endsWith('cursor=opaque%20%2F%20cursor'));
});

test('import run history requests compact conversation pages without hydrating tools or reading sender titles',async()=>{
 const calls:string[]=[],older={id:'old-input-item',type:'user_message',messageId:'old-input',runId:'old-run',text:'Original old prompt',ordinal:0,startedAt:'2026-10-08T00:00:00Z',createdBy:'agent',senderThreadId:'2c9cb7b6-a4c9-5746-b9b7-bc463c5024fa'};
 const tool={id:'tool',type:'command_execution',runId:run.id,ordinal:2,status:'completed',outputOmitted:true,updatedAt:at};
 const api=t3Api(async path=>{
  calls.push(path);
  if(path.endsWith('/bounded?compactTurnItems=1'))return {...snapshot({turnItems:undefined,visibleTurnItems:[{sourceThreadId:'thread',item:tool}]}),hasMoreHistory:true,historyCursor:'opaque / cursor'};
  if(path.endsWith('/history?cursor=opaque%20%2F%20cursor&view=conversation'))return {snapshotSequence:50,items:[{sourceThreadId:'thread',item:older},{sourceThreadId:'other',item:{...older,id:'foreign',messageId:'foreign'}}],hasMoreHistory:false};
  throw Error('Import metadata must not hydrate tool outputs or titles');
 },'https://t3.example',()=>{throw Error('Import metadata must not open a tool RPC socket');});
 const result=await api('/api/orchestration/threads/thread?importRuns=true');
 assert.equal(result.snapshotSequence,10);assert.equal(result.page.hasMore,false);assert.equal(result.thread.activities.length,0);assert.equal(result.thread.messages[0].id,'old-input');
 assert.equal(result.thread.messages[0].senderThreadId,older.senderThreadId);assert.equal(result.thread.messages.some((message:any)=>message.id==='foreign'),false);
 const state=applyThreadItem({messages:[],activities:[]},{kind:'snapshot',snapshot:result}).state;assert.equal(turnForMessage(state,'prompt'),run.id);assert.equal(calls.length,2);
});

test('a saved v1 request with a lost receipt checks migrated history before any resend',async()=>{
  const command={type:'thread.turn.start',commandId:'command',threadId:'thread',__legacyV1:true,message:{messageId:'old',text:'Original',attachments:[]}};
  let dispatches=0;
  const Socket=settingsSocket(undefined,undefined,()=>{dispatches++;return {};});
  const api=t3Api(async path=>path.endsWith('/bounded')?{...snapshot({messages:[]}),historyCursor:'older',hasMoreHistory:true}:path.includes('/history?')?{items:[{item:{type:'user_message',messageId:'old',text:'Original'}}],hasMoreHistory:false}:{ticket:'ticket'},'https://t3.example',url=>new Socket(url) as any);
  await api('/api/orchestration/dispatch',command);assert.equal(dispatches,0);
  await assert.rejects(api('/api/orchestration/dispatch',{...command,message:{...command.message,text:'Changed'}}),/different content/);assert.equal(dispatches,0);
});

test('omitted tool output is fetched by exact revision and cached without changing reply state',async()=>{
  const item={id:'tool',type:'command_execution',runId:run.id,ordinal:2,status:'completed',input:'echo test',outputOmitted:true,updatedAt:at};let reads=0;
  const Socket=settingsSocket(undefined,undefined,(tag,payload)=>{assert.equal(tag,'orchestration.getTurnItem');assert.deepEqual(payload,{threadId:'thread',itemId:'tool',revision:at});reads++;return {item:{...item,output:'test',outputOmitted:false}};});
  const api=t3Api(async path=>path.endsWith('/bounded')?snapshot({turnItems:[item]}):{ticket:'ticket'},'https://t3.example',url=>new Socket(url) as any);
  const first=await api('/api/orchestration/threads/thread?turnLimit=20');await api('/api/orchestration/threads/thread?turnLimit=20');
  assert.equal(first.thread.activities[0].payload.data.output,'test');assert.equal(reads,1);assert.equal(first.snapshotSequence,10);
});

test('v2 direct access sends the protocol HTTP header and refuses a v1 machine before authorization',async()=>{
  const connection:any={url:'https://t3.example',environmentId:'environment'},session:any={...connection,token:'test',expiresAt:Date.now()+600000};let authorized=0;
  const fetcher:any=async(url:string,options:any)=>{if(url.endsWith('/environment'))return new Response(JSON.stringify({environmentId:'environment',label:'Test',orchestrationProtocolVersion:2}));authorized++;assert.equal(options.headers['x-t3-orchestration-protocol'],'2');assert.ok(url.endsWith('/thread/bounded'));return new Response(JSON.stringify(snapshot()));};
  const api=await environmentApi(connection,session,fetcher);await api('/api/orchestration/threads/thread?turnLimit=20');assert.equal(authorized,1);
  await assert.rejects(environmentApi(connection,session,(async()=>new Response(JSON.stringify({environmentId:'environment',label:'Old',orchestrationProtocolVersion:1}))) as any),/Orchestrator v2/);assert.equal(authorized,1);
});
