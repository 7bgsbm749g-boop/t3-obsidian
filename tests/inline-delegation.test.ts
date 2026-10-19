import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyThreadItem,inlineBindingCheckpoint,restoreInlineBindings,renderInlineTurn,activeInlineIds,initialRegion,replaceRegion,type InlineThreadState} from '../inline-thread';
import {normalizeV2Snapshot,normalizeV2StreamItem} from '../orchestration-v2';
import {delegatedTurnIds,delegatedWork} from '../inline-delegation';
import {followInlineQuestions,inlineQuestionPhase} from '../inline-questions';
import {finalResponseKey} from '../final-response';

const at='2026-10-19T01:00:00.000Z';
const run={id:'source',ordinal:1,status:'completed',userMessageId:'prompt',requestedAt:at,completedAt:at,delegatedCompletion:{disposition:'open',delivery:null}};
const child=(id='child')=>({id,runId:'source',origin:'app_owned',completionWake:'always',status:'running',title:id});
function snapshot(overrides:any={}){return normalizeV2Snapshot({snapshotSequence:10,projection:{thread:{id:'thread',projectId:'project',title:'Research'},runs:[run],messages:[{id:'prompt',role:'user',runId:'source',text:'Research',streaming:false,createdAt:at},{id:'answer',role:'assistant',runId:'source',text:'Agents are running',streaming:false,createdAt:at}],turnItems:[{id:'item-answer',type:'assistant_message',messageId:'answer',runId:'source',updatedAt:at}],subagents:[child()],runtimeRequests:[],...overrides}});}
const initial=(overrides:any={})=>applyThreadItem({messages:[],activities:[]},{kind:'snapshot',snapshot:snapshot(overrides)}).state;
const event=(state:InlineThreadState,sequence:number,type:string,payload:any)=>applyThreadItem(state,normalizeV2StreamItem({kind:'event',sequence,event:{type,payload}})).state;

test('a completed parent stays live while waking children run and renders an active waiting block',()=>{
 const state=initial(),phase=inlineQuestionPhase(state,'source');
 assert.equal(phase,'running');assert.equal(finalResponseKey(state,'source'),undefined);
 const body=renderInlineTurn(state,'source','thread',phase,'collapse');
 assert.match(body,/Research · Waiting for subagents/);assert.match(body,/Waiting for 1 subagent</);assert.match(body,/\[!t3-progress\]\+/);assert.doesNotMatch(body,/· Completed/);
 const id='a0000000-0000-4000-8000-000000000000',region=initialRegion(id),edit=replaceRegion(region.text,id,region.bodyHash,body)!,document=region.text.slice(0,edit.from)+edit.text+region.text.slice(edit.to);
 assert.deepEqual(activeInlineIds(document),[id]);
});

test('terminal child before acknowledgement cannot finalize the parent; acknowledgement in that run releases it',()=>{
 let state=initial();state=event(state,11,'subagent.updated',{...child(),status:'completed'});
 assert.equal(inlineQuestionPhase(state,'source'),'running');assert.equal(finalResponseKey(state,'source'),undefined);
 state=event(state,12,'subagent.updated',{...child(),status:'completed',completionDelivery:{state:'acknowledged',observedByRunId:'source'}});
 assert.equal(inlineQuestionPhase(state,'source'),'complete');assert.ok(finalResponseKey(state,'source'));
});

test('exact delivery identity covers the gap before its run and follows that run in either event order',()=>{
 for(const messageFirst of [false,true]){
  let state=initial({subagents:[{...child(),status:'completed',completionDelivery:{state:'acknowledged'}}]});
  state=event(state,11,'run.updated',{...run,delegatedCompletion:{disposition:'open',delivery:{messageId:'delivery',generation:1,taskIds:[]}}});
  assert.equal(inlineQuestionPhase(state,'source'),'running');
  const message={id:'delivery',role:'user',runId:'resume',text:'Child completed',streaming:false,createdAt:at,createdBy:'agent',delegatedCompletion:{parentRunId:'source',generation:1,taskIds:['child']}};
  const resume={id:'resume',ordinal:2,status:'running',userMessageId:'delivery',requestedAt:at,completedAt:null};
  state=event(state,12,messageFirst?'message.updated':'run.created',messageFirst?message:resume);
  state=event(state,13,messageFirst?'run.created':'message.updated',messageFirst?resume:message);
  assert.deepEqual(delegatedTurnIds(state,['source']),['source','resume']);
  assert.equal(followInlineQuestions(state,['source']).turnId,'resume');assert.equal(inlineQuestionPhase(state,'resume'),'running');
  assert.equal(state.turns!.resume.delegatedParentRunId,'source');
 }
});

test('multiple deliveries and nested delegation recover through checkpoints without stealing unrelated runs',()=>{
 const acknowledged=(id:string,observedByRunId:string)=>({...child(id),status:'completed',completionDelivery:{state:'acknowledged',observedByRunId}});
 const state=initial({runs:[run,{id:'resume-one',ordinal:2,status:'completed',userMessageId:'delivery-one',completedAt:at},{id:'unrelated',ordinal:3,status:'running',userMessageId:'other'},{id:'resume-two',ordinal:4,status:'completed',userMessageId:'delivery-two',completedAt:at}],subagents:[acknowledged('one','resume-one'),acknowledged('two','resume-two')]});
 const checkpoint=JSON.parse(JSON.stringify(inlineBindingCheckpoint(state)));
 const recovered=restoreInlineBindings({protocolVersion:2,messages:[],activities:[],historyComplete:false},checkpoint);
 assert.deepEqual(delegatedTurnIds(recovered,['source']),['source','resume-one','resume-two']);
 assert.equal(followInlineQuestions(recovered,['source']).turnId,'resume-two');assert.equal(inlineQuestionPhase(recovered,'resume-two'),'complete');
 assert.equal(delegatedWork(recovered,['source']).waiting,false);
 const nested={...recovered,turns:{...recovered.turns,'resume-two':{...recovered.turns!['resume-two'],delegatedCompletion:{disposition:'open'}},nested:{turnId:'nested',ordinal:5,state:'running',delegatedParentRunId:'resume-two'}}};
 assert.deepEqual(delegatedTurnIds(nested,['source']),['source','resume-one','resume-two','nested']);
 assert.equal(inlineQuestionPhase(nested,'resume-two'),'running');
});

test('open disposition alone and non-waking or unrelated children do not delay completion',()=>{
 for(const overrides of [{subagents:[]},{subagents:[{...child(),runId:'other'}]},{subagents:[{...child(),completionWake:'never'}]},{runs:[{...run,delegatedCompletion:{disposition:'closed'}}]}]){
  const state=initial(overrides);assert.equal(inlineQuestionPhase(state,'source'),'complete');assert.ok(finalResponseKey(state,'source'));
 }
 const state=initial({runs:[{...run,status:'failed'}]});assert.equal(inlineQuestionPhase(state,'source'),'error');
});

test('observing an old child in an independent user run does not attach that run to the earlier response',()=>{
 const state=initial({subagents:[{...child(),status:'completed',completionDelivery:{state:'acknowledged',observedByRunId:'other'}}],runs:[run,{id:'other',ordinal:2,status:'running',userMessageId:'other-input'}],messages:[{id:'other-input',role:'user',createdBy:'user',runId:'other',text:'Independent work',streaming:false}]});
 assert.deepEqual(delegatedTurnIds(state,['source']),['source']);assert.equal(delegatedWork(state,['source']).waiting,false);
});

test('terminal run metadata retains the parent link after the delivery message leaves a bounded snapshot',()=>{
 let state=initial({subagents:[],runs:[run,{id:'resume',ordinal:2,userMessageId:'delivery',status:'running'}],messages:[{id:'delivery',runId:'resume',role:'user',text:'Complete',streaming:false,delegatedCompletion:{parentRunId:'source',generation:1,taskIds:[]}}]});
 assert.equal(state.turns!.resume.delegatedParentRunId,'source');
 state=applyThreadItem(state,{kind:'snapshot',snapshot:{snapshotSequence:11,thread:{id:'thread',projectId:'project',protocolVersion:2,messages:[],turns:{resume:{turnId:'resume',state:'running',ordinal:2,messageId:'delivery'}}}}}).state;
 state=event(state,12,'run.updated',{id:'resume',ordinal:2,userMessageId:'delivery',status:'completed',completedAt:at});
 assert.equal(state.turns!.resume.delegatedParentRunId,'source');assert.deepEqual(delegatedTurnIds(state,['source']),['source','resume']);
});
