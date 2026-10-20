import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyThreadItem,inlineBindingCheckpoint,restoreInlineBindings,renderInlineTurn,type InlineThreadState} from '../inline-thread';
import {normalizeV2Snapshot,normalizeV2StreamItem} from '../orchestration-v2';
import {delegatedTurnIds,delegatedWork} from '../inline-delegation';
import {followInlineQuestions,inlineQuestionPhase} from '../inline-questions';
import {finalResponseKey} from '../final-response';
import {handoffProjection,handoffSource,handoffRun,handoffMessage,handoffItem,handoffPrompt,handoffMessageId} from './fixtures/worktree-handoff';

const snapshot=(overrides:any={})=>applyThreadItem({messages:[],activities:[]},{kind:'snapshot',snapshot:normalizeV2Snapshot(handoffProjection(overrides))}).state;
const event=(state:InlineThreadState,sequence:number,type:string,payload:any)=>applyThreadItem(state,normalizeV2StreamItem({kind:'event',sequence,event:{type,payload}})).state;

test('canonical successful handoff joins exact runs and retains the original response',()=>{
 const state=snapshot();
 assert.deepEqual(delegatedTurnIds(state,['source']),['source','resume']);
 assert.equal(followInlineQuestions(state,['source']).turnId,'resume');assert.equal(inlineQuestionPhase(state,'resume'),'running');
 assert.equal(finalResponseKey(state,'source'),undefined);
 assert.equal(state.worktreeHandoffs!['handoff-tool'].messageId,handoffMessageId);
});

test('pending handoff and queued continuation keep the timer and response active',()=>{
 for(const overrides of [{runs:[handoffSource],messages:[],turnItems:[{...handoffItem,status:'running',output:undefined,completedAt:null}]},{runs:[handoffSource],messages:[]},{runs:[handoffSource,{...handoffRun,status:'queued'}]}]){
  const state=snapshot(overrides),turn=followInlineQuestions(state,['source']).turnId!;
  assert.equal(inlineQuestionPhase(state,turn),'running');assert.equal(delegatedWork(state,['source']).moving,true);
  assert.match(renderInlineTurn(state,turn,'thread','running','collapse'),/Moving to worktree/);
  assert.equal(finalResponseKey(state,turn),undefined);
 }
});

test('handoff tool, message, and run can arrive in every order without losing the association',()=>{
 const permutations=<T>(items:T[]):T[][]=>items.length?items.flatMap((item,index)=>permutations(items.filter((_,i)=>i!==index)).map(rest=>[item,...rest])):[[]];
 for(const order of permutations([['turn-item.updated',handoffItem],['message.updated',handoffMessage],['run.created',handoffRun]] as const)){
  let state=snapshot({runs:[handoffSource],messages:[],turnItems:[]}),sequence=10;
  for(const [type,payload] of order)state=event(state,++sequence,type,payload);
  assert.deepEqual(delegatedTurnIds(state,['source']),['source','resume']);
 }
});

test('human, other agent, wrong namespace, wrong prompt, and out-of-window messages cannot become continuations',()=>{
 for(const change of [{createdBy:'user'},{creationSource:'web'},{id:'ordinary-agent-message'},{text:'Other task'},{createdAt:'2026-10-20T20:00:09Z'},{createdAt:'2026-10-20T19:59:59Z'},{runId:'source'}]){
  const state=snapshot({messages:[{...handoffMessage,...change}]});
  assert.deepEqual(delegatedTurnIds(state,['source']),['source']);
 }
 const duplicate={...handoffMessage,id:handoffMessageId.replace('22222222','33333333'),runId:'other'};
 assert.deepEqual(delegatedTurnIds(snapshot({messages:[handoffMessage,duplicate]}),['source']),['source']);
});

test('failed and skipped handoffs do not wait indefinitely or adopt another run',()=>{
 const failed=snapshot({turnItems:[{...handoffItem,output:{continuation:{status:'failed',detail:'Synthetic failure'}}}]});
 assert.equal(inlineQuestionPhase(failed,'source'),'error');assert.equal(delegatedWork(failed,['source']).moving,false);
 const skipped=snapshot({turnItems:[{...handoffItem,output:{...handoffItem.output,continuation:{status:'skipped'}}}]});
 assert.equal(inlineQuestionPhase(skipped,'source'),'interrupted');assert.deepEqual(delegatedTurnIds(skipped,['source']),['source']);
 const noPrompt=snapshot({turnItems:[{...handoffItem,input:{branch:'test/handoff'}}]});
 assert.deepEqual(delegatedTurnIds(noPrompt,['source']),['source']);
});

test('compact checkpoint recovers the link without retaining the continuation prompt or later unrelated output',()=>{
 let state=snapshot();const checkpoint=JSON.parse(JSON.stringify(inlineBindingCheckpoint(state)));
 assert.ok(!JSON.stringify(checkpoint).includes(handoffPrompt));
 state=restoreInlineBindings({protocolVersion:2,messages:[],activities:[]},checkpoint);
 state=event(state,11,'run.updated',{...handoffRun,status:'completed',completedAt:'2026-10-20T20:00:10Z'});
 state=event(state,12,'run.created',{id:'other',ordinal:3,status:'running',userMessageId:'other-prompt'});
 assert.deepEqual(delegatedTurnIds(state,['source']),['source','resume']);assert.equal(inlineQuestionPhase(state,'resume'),'complete');
 state=applyThreadItem(state,{kind:'snapshot',snapshot:{snapshotSequence:13,thread:{id:'thread',projectId:'project',messages:[],activities:[],protocolVersion:2}}}).state;
 assert.equal(state.worktreeHandoffs!['handoff-tool'].turnId,'resume');
});

test('a later omitted tool output cannot downgrade a confirmed handoff',()=>{
 let state=snapshot();
 state=event(state,11,'turn-item.updated',{...handoffItem,output:undefined,outputOmitted:true});
 assert.equal(state.worktreeHandoffs!['handoff-tool'].status,'scheduled');
 assert.deepEqual(delegatedTurnIds(state,['source']),['source','resume']);
});

test('string and MCP text tool results retain the same verified handoff identity',()=>{
 for(const output of [JSON.stringify(handoffItem.output),{content:[{type:'text',text:JSON.stringify(handoffItem.output)}]}]){
  assert.deepEqual(delegatedTurnIds(snapshot({turnItems:[{...handoffItem,toolName:'mcp__t3_code__t3_worktree_handoff',input:JSON.stringify(handoffItem.input),output}]}),['source']),['source','resume']);
 }
});

test('failed handoff attempts do not end a still-running task or poison a successful retry',()=>{
 const failed={...handoffItem,id:'failed-tool',status:'failed',startedAt:'2026-10-20T20:00:00Z',output:undefined};
 const running=snapshot({runs:[{...handoffSource,status:'running',completedAt:null}],turnItems:[failed]});
 assert.equal(inlineQuestionPhase(running,'source'),'running');
 const retry=snapshot({turnItems:[failed,handoffItem]});
 assert.equal(inlineQuestionPhase(retry,'resume'),'running');assert.equal(delegatedWork(retry,['source']).handoffFailed,false);
});
