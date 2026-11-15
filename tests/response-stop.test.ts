import {expectRecord} from './wire-fixture';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {interruptStoppedResponse,stopResponseEdit,stoppedResponseBody} from '../src/responses/response-stop';
import {initialRegion,replaceRegion} from '../src/conversations/inline-thread';
import {normalizeV2Snapshot} from '../src/connection/orchestration-v2';
import {handoffProjection,handoffSource,handoffRun,interruptedHandoffItem} from './fixtures/worktree-handoff';

test('Stop resolves the verified replacement run instead of accepting the interrupted source as finished',async()=>{
 const commands:any[]=[];
 await interruptStoppedResponse(async()=>({origin:'https://test',api:async(_path,payload)=>{if(payload){commands.push(payload);return {};}return normalizeV2Snapshot(handoffProjection());}}),randomUUID(),'thread','source');
 assert.equal(commands.length,1);assert.equal(commands[0].turnId,'resume');
});

test('Stop targets the proven continuation when workspace detachment interrupted the handoff tool',async()=>{
 const commands:any[]=[];
 await interruptStoppedResponse(async()=>({origin:'https://test',api:async(_path,payload)=>{
  if(payload){commands.push(payload);return {};}
  return normalizeV2Snapshot(handoffProjection({turnItems:[interruptedHandoffItem]}));
 }}),randomUUID(),'thread','source');
 assert.equal(commands.length,1);assert.equal(commands[0].turnId,'resume');
});

test('Stop cancels a queued continuation and handles its concurrent start without stopping unrelated work',async()=>{
 for(const race of [false,true]){
  const commands:any[]=[];let reads=0;
  await interruptStoppedResponse(async()=>({origin:'https://test',api:async(_path,payload)=>{
   if(payload){commands.push(payload);if(race&&expectRecord(payload).type==='queued-run.cancel')throw Error('Started concurrently');return {};}
   return normalizeV2Snapshot(handoffProjection({runs:[handoffSource,{...handoffRun,status:++reads===1?'queued':race?'running':'cancelled'}]}));
  }}),randomUUID(),'thread','source');
  assert.equal(commands[0].type,'queued-run.cancel');assert.equal(commands[0].runId,'resume');
  assert.equal(commands.length,race?2:1);if(race){assert.equal(commands[1].turnId,'resume');assert.notEqual(commands[0].commandId,commands[1].commandId);}
 }
});

test('Stop does not report success while an identified handoff still lacks its continuation run',async()=>{
 await assert.rejects(interruptStoppedResponse(async()=>({origin:'https://test',api:async()=>normalizeV2Snapshot(handoffProjection({runs:[handoffSource],messages:[]}))}),randomUUID(),'thread','source'),/has not identified the worktree continuation/);
});

test('Stop freezes a Moving to worktree header and removes its spinner',()=>{
 const body=stoppedResponseBody('> [!t3-progress]+ **Test · Moving to worktree** <span class="send-to-t3-inline-spinner" aria-label="Loading"></span>\n> Previous progress');
 assert.match(body,/Test · Interrupted/);assert.doesNotMatch(body,/Moving to worktree|inline-spinner/);assert.match(body,/Previous progress/);
});

test('stop cleanup preserves the displayed transcript and status/tag examples inside code',()=>{
  const id=randomUUID(),initial=initialRegion(id);
  const body='> [!t3-steering] You\n> Continue\n\n**Named thread · Reconnecting** <span class="send-to-t3-inline-spinner" aria-label="Loading"></span>\n\n> Partial answer\n\n```text\n**T3 · Working**\n<!-- t3-inline:start:'+id+' -->\n<!-- t3-inline:end:'+id+' -->\n```';
  const update=replaceRegion(initial.text,id,initial.bodyHash,body)!;
  const document='Before\n'+initial.text.slice(0,update.from)+update.text+initial.text.slice(update.to)+'After';
  const change=stopResponseEdit(document,id)!;assert.ok(change);
  const after=document.slice(0,change.from)+change.text+document.slice(change.to);
  assert.match(after,/Before[\s\S]*Continue[\s\S]*Partial answer[\s\S]*After/);
  assert.doesNotMatch(after,/Reconnecting|send-to-t3-inline-spinner/);
  assert.match(after,/```text\n\*\*T3 · Working\*\*\n<!-- t3-inline:start:/);
  assert.equal(stopResponseEdit(after,id),null);
});

test('stop formatting closes raw and quoted open fences and preserves literal prose',()=>{
  assert.equal(stoppedResponseBody('**T3 · Working**\n\n```js\nlet x = 1;'),'```js\nlet x = 1;\n```');
  assert.equal(stoppedResponseBody('> ```\n> partial'),' > ```\n> partial\n> ```'.trim());
  assert.equal(stoppedResponseBody('> **T3 · Working**\n\nUser edits'),' > **T3 · Working**\n\nUser edits'.trim());
});

test('stop refuses nested or incomplete boundaries',()=>{
  const id=randomUUID(),other=randomUUID(),initial=initialRegion(id);
  assert.equal(stopResponseEdit(initial.text.replace('<!-- t3-inline:end:', '<!-- changed:end:'),id),null);
  const nested=initial.text.replace('**T3',initialRegion(other).text+'**T3');
  assert.equal(stopResponseEdit(nested,id),null);
});

test('late Stop access and acknowledgement remain valid after the former deadlines',async context=>{
 context.mock.timers.enable({apis:['setTimeout']});
 let grant!:(value:any)=>void,ack!:()=>void,calls=0,closed=0;
 const access=new Promise<any>(resolve=>{grant=resolve;});
 const work=interruptStoppedResponse(()=>access,randomUUID(),'thread','turn',5);
 context.mock.timers.tick(80_000);
 grant({origin:'https://test',api:async(_path:string,payload:any)=>{
  calls++;if(payload)return new Promise<void>(resolve=>{ack=resolve;});
  return {thread:{id:'thread',projectId:'project',messages:[],activities:[],latestTurn:{turnId:'turn',state:'running'},session:{status:'running',activeTurnId:'turn'}}};
 },close:()=>{closed++;}});
 for(let i=0;i<20;i++)await Promise.resolve();assert.equal(calls,2);assert.equal(closed,0);
 context.mock.timers.tick(80_000);assert.equal(closed,0);ack();await work;assert.equal(closed,1);
});

test('stopping removes pending question controls while preserving the prompt and code examples',async()=>{
  const {renderQuestion}=await import('../src/interaction/questions');
  const question=renderQuestion({requestId:'q',turnId:'turn',createdAt:'',questions:[{id:'choice',header:'Choice',question:'Which approach?',options:[],multiSelect:false}]},{environmentId:'env',threadId:'thread',requestId:'q'});
  const stopped=stoppedResponseBody('**T3 · Working**\n\n'+question+'\n\n```text\n'+question+'\n```');
  assert.match(stopped,/<p class="send-to-t3-question-prompt">Which approach\?<\/p>/);assert.ok(stopped.startsWith('<p'));
  assert.equal(stopped.split('<!-- t3-question:start:').length-1,1,'The code example remains literal');
  assert.equal(stopped.split('href="t3-question:').length-1,1);
});

test('an unbound stop resolves the completed original turn and does not interrupt a newer turn',async()=>{
  const commands:any[]=[];
  const snapshot={thread:{id:'thread',projectId:'project',messages:[{id:'original',role:'user',turnId:'original-turn',streaming:false,text:'Question',createdAt:'2026-10-01T00:00:00Z'},{id:'partial',role:'assistant',text:'Partial',turnId:'original-turn',streaming:false},{id:'new',role:'user',streaming:false,text:'Later',createdAt:'2026-10-02T00:00:00Z'}],activities:[],latestTurn:{turnId:'new-turn',state:'running',requestedAt:'2026-10-02T00:00:00Z'},checkpoints:[{turnId:'original-turn',status:'ready',checkpointRef:'refs/t3/checkpoints/thread/turn/1',assistantMessageId:'partial',completedAt:'2026-10-01T01:00:00Z'}]}};
  await interruptStoppedResponse(async()=>({origin:'https://test',api:async(_path,payload)=>{if(payload){commands.push(payload);return {};}return snapshot;}}),randomUUID(),'thread',undefined,1000,'original');
  assert.equal(commands.length,0);
});

test('a permanent terminal grant needs no remote interrupt or connection',async()=>{
  let accesses=0;await interruptStoppedResponse(async()=>{accesses++;throw Error('Must not connect');},randomUUID(),'thread','completed-turn',1000,'message','project','2026-10-10T00:00:00Z',true);assert.equal(accesses,0);
});

test('an active exact bound turn is interrupted after checking its canonical state',async()=>{
  const commands:any[]=[];
  await interruptStoppedResponse(async()=>({origin:'https://test',api:async(_path,payload)=>{if(payload){commands.push(payload);return {};}return {thread:{id:'thread',projectId:'project',messages:[],activities:[],latestTurn:{turnId:'active',state:'running'},session:{status:'running',activeTurnId:'active'}}};}}),randomUUID(),'thread','active');
  assert.equal(commands.length,1);assert.equal(commands[0].turnId,'active');
});

test('a run finishing between the status read and interrupt is confirmed without replay or stopping a newer run',async()=>{
  for(const completed of [false,true]){
    let reads=0,interrupts=0;
    const failure=Error('The run finished before the interrupt');
    const access={origin:'https://synthetic.invalid',api:async(_route:string,payload?:unknown)=>{
      if(payload){interrupts++;throw failure;}
      reads++;
      return {thread:{id:'thread',projectId:'project',messages:[],activities:[],latestTurn:{turnId:reads>1?'newer':'original',state:'running'},turns:reads>1&&completed?{original:{turnId:'original',state:'completed',requestedAt:'2026-10-10T00:00:00Z'}}:{},checkpoints:reads>1&&completed?[{turnId:'original',status:'ready',checkpointRef:'exact',completedAt:'2026-10-10T00:00:01Z'}]:[],session:{status:'running',activeTurnId:reads>1?'newer':'original'}}};
    }};
    const work=interruptStoppedResponse(async()=>access,'11111111-1111-4111-8111-111111111111','thread','original',1000,undefined,'project');
    if(completed)await work;else await assert.rejects(work,error=>error===failure);
    assert.equal(interrupts,1);assert.equal(reads,2);
  }
});
