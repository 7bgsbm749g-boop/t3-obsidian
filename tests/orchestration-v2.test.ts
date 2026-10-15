import {test} from 'node:test';
import assert from 'node:assert/strict';
import {restoreCompactSnapshot,normalizeV2Snapshot,normalizeV2StreamItem,normalizeV2TitleItem,v2Command} from '../orchestration-v2';
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

test('normal compact reads restore local reasoning, tools, controls and final identity without inherited duplicates',async()=>{
 const assistant={id:'item-answer',type:'assistant_message',messageId:'answer',threadId:'thread',runId:run.id,text:'Reply',streaming:false,status:'completed',updatedAt:at};
 const reasoning={id:'reason',type:'reasoning',runId:run.id,text:'Thinking',streaming:false,updatedAt:at};
 const tool={id:'tool',type:'command_execution',runId:run.id,input:'pwd',output:'/vault',status:'completed',updatedAt:at};
 const control={id:'control',type:'user_input_request',runId:run.id,requestId:'question',questions:[],status:'running',updatedAt:at};
 const local=[assistant,reasoning,tool,control],wire={...snapshot({messages:[message,{id:'answer',role:'assistant',runId:run.id,text:'Reply',streaming:false}],turnItems:[],visibleTurnItems:[...local.map(item=>({visibility:'local',sourceThreadId:'thread',item})),{visibility:'inherited',sourceThreadId:'parent',item:{...tool,id:'inherited'}}],runtimeRequests:[{id:'question',status:'pending',kind:'user_input',responseCapability:{type:'message'}}]}),turnItemsOmitLocalVisible:true};
 const restored=restoreCompactSnapshot(wire);assert.deepEqual(restored.projection.turnItems,local);assert.equal(wire.projection.turnItems.length,0);assert.equal(restored.projection.turnItems[0],assistant);
 const paths:string[]=[],api=t3Api(async path=>{paths.push(path);return wire;},'https://fixture');const normalized=await api('/api/orchestration/threads/thread?turnLimit=20');
 assert.deepEqual(paths,['/api/orchestration/threads/thread/bounded?compactTurnItems=1']);assert.equal(normalized.thread.messages.find((m:any)=>m.id==='answer').itemId,'item-answer');assert.ok(normalized.thread.messages.some((m:any)=>m.role==='reasoning'&&m.text==='Thinking'));assert.equal(normalized.thread.activities.filter((a:any)=>a.kind==='tool.completed').length,1);assert.equal(normalized.thread.hasPendingUserInput,true);
});
test('assistant item events carry their exact item identity without duplicating message text',()=>{
 let current=event(initial(),11,'message.updated',{id:'answer',role:'assistant',runId:run.id,text:'Reply',streaming:false,createdAt:at,updatedAt:at});
 current=event(current,12,'turn-item.updated',{id:'opaque-item',type:'assistant_message',messageId:'answer',runId:run.id,text:'Reply',streaming:false,status:'completed',updatedAt:at});
 assert.equal(current.messages.filter((m:any)=>m.role==='assistant').length,1);assert.equal(current.messages.at(-1)!.text,'Reply');assert.equal(current.messages.at(-1)!.itemId,'opaque-item');
});
test('final-item adapter uses the existing authenticated unary RPC',async()=>{
 const calls:any[]=[],raw:string[]=[],Socket=settingsSocket(undefined,undefined,(tag,payload)=>{calls.push({tag,payload});return {item:{id:'opaque-item',text:'Reply'}};});
 const api=t3Api(async path=>{raw.push(path);assert.equal(path,'/api/auth/websocket-ticket');return {ticket:'ticket'};},'https://fixture',url=>new Socket(url) as any);
 assert.equal((await api('/api/orchestration/turn-item',{threadId:'thread',itemId:'opaque-item'})).text,'Reply');assert.deepEqual(calls,[{tag:'orchestration.getTurnItem',payload:{threadId:'thread',itemId:'opaque-item'}}]);assert.equal(raw.length,1);
});

test('HTML attachment URLs use the existing authenticated asset RPC',async()=>{
 const calls:any[]=[],Socket=settingsSocket(undefined,undefined,(tag,payload)=>{calls.push({tag,payload});return {relativeUrl:'/api/assets/page',expiresAt:123};});
 const api=t3Api(async path=>{assert.equal(path,'/api/auth/websocket-ticket');return {ticket:'ticket'};},'https://fixture',url=>new Socket(url) as any);
 const payload={resource:{_tag:'attachment',attachmentId:'page-html',mimeType:'text/html',disposition:'inline'}};
 assert.deepEqual(await api('/api/assets/create-url',payload),{relativeUrl:'/api/assets/page',expiresAt:123});assert.deepEqual(calls,[{tag:'assets.createUrl',payload}]);
});

test('title normalization does not inspect duplicate history or unrelated event payloads',()=>{
 const forbidden=()=>{throw Error('Title listener read transcript data');};
 const projection={thread:{id:'thread',projectId:'project',title:'Only title'},get messages(){return forbidden();},get runs(){return forbidden();},get turnItems(){return forbidden();},get runtimeRequests(){return forbidden();}};
 const item=normalizeV2TitleItem({kind:'snapshot',snapshotSequence:17,projection});
 assert.deepEqual(item,{kind:'snapshot',snapshot:{snapshotSequence:17,thread:{id:'thread',projectId:'project',title:'Only title',protocolVersion:2,messages:[]}}});
 const unrelated=normalizeV2TitleItem({kind:'event',sequence:18,event:{type:'turn-item.updated',get payload(){return forbidden();}}});
 assert.deepEqual(unrelated,{kind:'event',event:{sequence:18,type:'v2.unknown',payload:{}}});
 assert.equal(normalizeV2TitleItem({kind:'unknown-event',sequence:19}).event.sequence,19);
 assert.deepEqual(normalizeV2TitleItem({kind:'event',sequence:20,event:{type:'thread.updated',payload:{title:'Changed',output:'unused'}}}).event,{sequence:20,type:'thread.metadata-updated',payload:{title:'Changed'}});
 assert.throws(()=>normalizeV2TitleItem({kind:'snapshot',projection:{thread:{id:'thread'}}}),/invalid title snapshot/);
});

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
 const api=t3Api(async path=>{calls.push(path);if(path.endsWith('/bounded?compactTurnItems=1'))return {...snapshot(),hasMoreHistory:true,historyCursor:'older'};if(path.includes('/history?'))return {items:[{sourceThreadId:'thread',item:older}],hasMoreHistory:false};if(path==='/api/orchestration/shell')return {threads:[{id:'wrong-id',title:'Wrong source'}],archivedThreads:[{id:senderThreadId,title:'Source thread'}]};throw Error('Unexpected source body read');},'https://t3.example');
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
  const api=t3Api(async path=>{paths.push(path);return path.endsWith('/bounded?compactTurnItems=1')?{...snapshot(),hasMoreHistory:true,historyCursor:'opaque / cursor'}:{snapshotSequence:50,items:[{sourceThreadId:'thread',item:older}],nextCursor:null,hasMoreHistory:false};},'https://t3.example');
  const bounded=await api('/api/orchestration/threads/thread?turnLimit=20');assert.equal(bounded.page.hasMore,true);assert.equal(paths.length,1);
  const full=await api('/api/orchestration/threads/thread');assert.equal(full.page.hasMore,false);assert.equal(full.snapshotSequence,10);
  assert.equal(full.thread.messages[0].id,'old-prompt');assert.ok(paths.at(-1)?.endsWith('cursor=opaque%20%2F%20cursor'));
});

test('import metadata uses all canonical run rows and exact root prompt IDs without a host history scan',async()=>{
 const calls:string[]=[],runs=Array.from({length:19},(_,n)=>({...run,id:'run-'+n,ordinal:n+1,userMessageId:'input-'+n,status:'completed',completedAt:at}));
 const messages=runs.map(r=>({...message,id:r.userMessageId,runId:r.id,text:'Prompt '+r.ordinal}));
 const api=t3Api(async path=>{calls.push(path);assert.equal(path,'/api/orchestration/threads/thread');return snapshot({runs,messages,turnItems:[{id:'huge-tool',type:'command_execution',outputOmitted:true}]});},'https://t3.example',()=>{throw Error('Import metadata must not hydrate tool output');});
 const result=await api('/api/orchestration/threads/thread?importRuns=true');
 assert.equal(Object.keys(result.thread.turns).length,19);assert.equal(result.page.hasMore,false);assert.equal(result.thread.activities.length,0);
 const state=applyThreadItem({messages:[],activities:[]},{kind:'snapshot',snapshot:result}).state;
 for(const r of runs)assert.equal(turnForMessage(state,r.userMessageId),r.id);
 assert.deepEqual(calls,['/api/orchestration/threads/thread']);
});

test('selected imports reconstruct compact display items and hydrate only the exact run',async()=>{
 const calls:any[]=[],selected={id:'selected-tool',type:'command_execution',runId:run.id,ordinal:2,status:'completed',outputOmitted:true,updatedAt:at},unrelated={...selected,id:'unrelated-tool',runId:'other-run'};
 const Socket=settingsSocket(undefined,undefined,(tag,payload)=>{calls.push({tag,payload});assert.equal(payload.itemId,selected.id);return {item:{...selected,output:'SELECTED OUTPUT',outputOmitted:false}};});
 const api=t3Api(async path=>{if(path.endsWith('/bounded?compactTurnItems=1'))return snapshot({turnItems:undefined,visibleTurnItems:[{sourceThreadId:'thread',item:selected},{sourceThreadId:'thread',item:unrelated}]});if(path.endsWith('/websocket-ticket'))return {ticket:'ticket'};throw Error('Unexpected full-thread read');},'https://t3.example',url=>new Socket(url) as any);
 const result=await api('/api/orchestration/threads/thread?importRunId='+encodeURIComponent(run.id));
 assert.equal(result.snapshotSequence,10);assert.equal(result.page.hasMore,false);assert.equal(calls.length,1);assert.equal(result.thread.activities.length,1);assert.equal(result.thread.activities[0].payload.data.output,'SELECTED OUTPUT');
 const state=applyThreadItem({messages:[],activities:[]},{kind:'snapshot',snapshot:result}).state;assert.equal(turnForMessage(state,'prompt'),run.id);
});

test('a saved v1 request with a lost receipt checks migrated history before any resend',async()=>{
  const command={type:'thread.turn.start',commandId:'command',threadId:'thread',__legacyV1:true,message:{messageId:'old',text:'Original',attachments:[]}};
  let dispatches=0;
  const Socket=settingsSocket(undefined,undefined,()=>{dispatches++;return {};});
  const api=t3Api(async path=>path.endsWith('/bounded?compactTurnItems=1')?{...snapshot({messages:[]}),historyCursor:'older',hasMoreHistory:true}:path.includes('/history?')?{items:[{item:{type:'user_message',messageId:'old',text:'Original'}}],hasMoreHistory:false}:{ticket:'ticket'},'https://t3.example',url=>new Socket(url) as any);
  await api('/api/orchestration/dispatch',command);assert.equal(dispatches,0);
  await assert.rejects(api('/api/orchestration/dispatch',{...command,message:{...command.message,text:'Changed'}}),/different content/);assert.equal(dispatches,0);
});

test('omitted tool output is fetched by exact revision and cached without changing reply state',async()=>{
  const item={id:'tool',type:'command_execution',runId:run.id,ordinal:2,status:'completed',input:'echo test',outputOmitted:true,updatedAt:at};let reads=0;
  const Socket=settingsSocket(undefined,undefined,(tag,payload)=>{assert.equal(tag,'orchestration.getTurnItem');assert.deepEqual(payload,{threadId:'thread',itemId:'tool',revision:at});reads++;return {item:{...item,output:'test',outputOmitted:false}};});
  const api=t3Api(async path=>path.endsWith('/bounded?compactTurnItems=1')?snapshot({turnItems:[item]}):{ticket:'ticket'},'https://t3.example',url=>new Socket(url) as any);
  const first=await api('/api/orchestration/threads/thread?turnLimit=20');await api('/api/orchestration/threads/thread?turnLimit=20');
  assert.equal(first.thread.activities[0].payload.data.output,'test');assert.equal(reads,1);assert.equal(first.snapshotSequence,10);
});

test('tool detail cache evicts by retained text size without losing the current reply',async()=>{
 const items=Array.from({length:3},(_,i)=>({id:'large-'+i,type:'command_execution',runId:run.id,ordinal:i,status:'completed',outputOmitted:true,updatedAt:at}));let reads=0;
 const output='x'.repeat(800_000),Socket=settingsSocket(undefined,undefined,(tag,payload)=>{assert.equal(tag,'orchestration.getTurnItem');reads++;return {item:{...items.find(item=>item.id===payload.itemId),output,outputOmitted:false}};});
 const api=t3Api(async path=>path.endsWith('/bounded?compactTurnItems=1')?snapshot({turnItems:items}):{ticket:'ticket'},'https://t3.example',url=>new Socket(url) as any);
 const first=await api('/api/orchestration/threads/thread?turnLimit=20');assert.equal(reads,3);assert.deepEqual(first.thread.activities.map((a:any)=>a.payload.data.output.length),[800_000,800_000,800_000]);
 const next=await api('/api/orchestration/threads/thread?turnLimit=20');assert.equal(reads,4,'The oldest detail is fetched again after exceeding the 2M character budget');assert.deepEqual(next.thread.activities.map((a:any)=>a.payload.data.output.length),[800_000,800_000,800_000]);
});

test('one detail larger than the cache budget remains available but is not retained between reads',async()=>{
 const item={id:'oversize',type:'command_execution',runId:run.id,ordinal:1,status:'completed',outputOmitted:true,updatedAt:at};let reads=0;const output='x'.repeat(2_000_001);
 const Socket=settingsSocket(undefined,undefined,()=>{reads++;return {item:{...item,output,outputOmitted:false}};});
 const api=t3Api(async path=>path.endsWith('/bounded?compactTurnItems=1')?snapshot({turnItems:[item]}):{ticket:'ticket'},'https://t3.example',url=>new Socket(url) as any);
 for(let i=0;i<2;i++){const state=await api('/api/orchestration/threads/thread?turnLimit=20');assert.equal(state.thread.activities[0].payload.data.output,output);}assert.equal(reads,2);
});

test('control reads skip forty omitted tools, sender metadata and history but keep exact run and pending controls',async()=>{
 const calls:string[]=[],tools=Array.from({length:40},(_,i)=>({id:'tool-'+i,type:'command_execution',runId:run.id,ordinal:i,status:'completed',outputOmitted:true,updatedAt:at}));
 const control={id:'approval',type:'approval_request',runId:run.id,ordinal:41,status:'waiting',requestId:'request',updatedAt:at};
 const wire=snapshot({turnItems:undefined,visibleTurnItems:[...tools,control].map(item=>({sourceThreadId:'thread',item})),messages:[{...message,createdBy:'agent',senderThreadId:'2c9cb7b6-a4c9-5746-b9b7-bc463c5024fa'}],runtimeRequests:[{id:'request',status:'pending',responseCapability:{type:'message'}}]});
 const api=t3Api(async path=>{calls.push(path);assert.equal(path,'/api/orchestration/threads/thread/bounded?compactTurnItems=1');return {...wire,hasMoreHistory:true,historyCursor:'older'};},'https://t3.example',()=>{throw Error('Control lookup must not open a tool socket');});
 const result=await api('/api/orchestration/threads/thread?controlOnly=true');
 assert.deepEqual(calls,['/api/orchestration/threads/thread/bounded?compactTurnItems=1']);assert.equal(result.thread.session.activeTurnId,run.id);assert.equal(result.thread.hasPendingApprovals,true);assert.equal(result.thread.messages.length,0);assert.equal(result.thread.activities.length,1);
});

test('control read forwards cancellation and refuses a late snapshot after abort',async()=>{
 const controller=new AbortController();let release!:(value:any)=>void,observed:AbortSignal|undefined;
 const api=t3Api(async(_path,_payload,options)=>{observed=options?.signal;return new Promise(resolve=>{release=resolve;});},'https://t3.example');
 const work=api('/api/orchestration/threads/thread?controlOnly=true',undefined,{signal:controller.signal});
 controller.abort(Error('obsolete lookup'));release(snapshot());await assert.rejects(work,/obsolete lookup/);assert.equal(observed,controller.signal);
});

test('v2 direct access sends the protocol HTTP header and refuses a v1 machine before authorization',async()=>{
  const connection:any={url:'https://t3.example',environmentId:'environment'},session:any={...connection,token:'test',expiresAt:Date.now()+600000};let authorized=0;
  const fetcher:any=async(url:string,options:any)=>{if(url.endsWith('/environment'))return new Response(JSON.stringify({environmentId:'environment',label:'Test',orchestrationProtocolVersion:2}));authorized++;assert.equal(options.headers['x-t3-orchestration-protocol'],'2');assert.ok(url.endsWith('/thread/bounded?compactTurnItems=1'));return new Response(JSON.stringify(snapshot()));};
  const api=await environmentApi(connection,session,fetcher);await api('/api/orchestration/threads/thread?turnLimit=20');assert.equal(authorized,1);
  await assert.rejects(environmentApi(connection,session,(async()=>new Response(JSON.stringify({environmentId:'environment',label:'Old',orchestrationProtocolVersion:1}))) as any),/Orchestrator v2/);assert.equal(authorized,1);
});
