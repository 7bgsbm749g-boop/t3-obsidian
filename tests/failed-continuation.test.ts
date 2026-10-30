import {test} from 'node:test';
import assert from 'node:assert/strict';
import {failedContinuations} from '../failed-continuation';
import {inlineBindingCheckpoint,restoreInlineBindings,type InlineThreadState} from '../inline-thread';

const at=(n:number)=>new Date(n*1000).toISOString();
function fixture():InlineThreadState{return {protocolVersion:2,messages:[{id:'retry-input',role:'user',turnId:'retry',createdBy:'user',creationSource:'web',text:'Continue.',streaming:false,createdAt:at(3)}],activities:[],turns:{source:{turnId:'source',messageId:'original',state:'error',ordinal:1,requestedAt:at(1),completedAt:at(2)},retry:{turnId:'retry',messageId:'retry-input',state:'running',ordinal:2,requestedAt:at(3)}}};}

test('the next exact human run joins a failed response without changing the original binding',()=>{
 const state=fixture(),result=failedContinuations(state,['source']);
 assert.deepEqual(result.turnIds,['source','retry']);assert.deepEqual([...result.messageIds],['retry-input']);assert.equal(result.continued,true);
 assert.deepEqual(result.state.failedContinuations?.source,{sourceTurnId:'source',turnId:'retry',messageId:'retry-input'});assert.equal(state.failedContinuations,undefined);
});

test('completion, Stop, missing lifecycle, gaps, agent work and ambiguous ordinals cannot attach',()=>{
 const changes:Array<(state:InlineThreadState)=>void>=[
  s=>s.turns!.source.state='completed',s=>s.turns!.source.state='interrupted',s=>delete s.turns!.source.ordinal,
  s=>delete s.turns!.source.completedAt,s=>s.turns!.retry.requestedAt=at(1),s=>s.turns!.retry.ordinal=3,
  s=>s.turns!.retry.state='queued',s=>s.turns!.retry.state='interrupted',s=>s.turns!.retry.state='cancelled',s=>s.turns!.retry.delegatedParentRunId='source',s=>delete s.turns!.retry.messageId,
  s=>s.turns!.duplicate={...s.turns!.retry,turnId:'duplicate'},s=>s.messages=[],s=>s.messages.push({...s.messages[0]}),
  s=>s.messages[0].createdBy='agent',s=>delete s.messages[0].createdBy,s=>s.messages[0].creationSource='mcp',
  s=>s.messages[0].senderThreadId='agent-thread',s=>s.messages[0].turnId='other',s=>s.messages[0].role='assistant',
  s=>s.messages[0].delegatedCompletion={parentRunId:'source',generation:1,taskIds:['child']},
 ];
 for(const change of changes){const state=fixture();change(state);assert.deepEqual(failedContinuations(state,['source']).turnIds,['source'],String(change));}
});

test('user continuations from the mobile app carry the same exact run ownership',()=>{
 const state=fixture();state.messages[0].creationSource='mobile';assert.deepEqual(failedContinuations(state,['source']).turnIds,['source','retry']);
});

test('a primary retry boundary includes frozen earlier output even after the active session changed',()=>{
 const state=fixture();state.inputBoundaries={'retry-input':[]};
 state.messages.push({id:'old',role:'assistant',turnId:'source',text:'Earlier partial output.',streaming:true,createdAt:at(1.5)});
 const result=failedContinuations(state,['source']);assert.deepEqual(result.state.inputBoundaries['retry-input'].map(message=>message.text),['Earlier partial output.']);
 assert.equal(result.state.inputBoundaries['retry-input'][0].streaming,false);
});

test('repeated failed retries chain in canonical order and stop at a completed turn',()=>{
 const state=fixture();state.turns!.retry={...state.turns!.retry,state:'error',completedAt:at(4)};
 state.turns!.third={turnId:'third',messageId:'third-input',state:'completed',ordinal:3,requestedAt:at(5),completedAt:at(6)};
 state.turns!.fourth={turnId:'fourth',messageId:'fourth-input',state:'running',ordinal:4,requestedAt:at(7)};
 state.messages.push({...state.messages[0],id:'third-input',turnId:'third',createdAt:at(5)},{...state.messages[0],id:'fourth-input',turnId:'fourth',createdAt:at(7)});
 assert.deepEqual(failedContinuations(state,['source']).turnIds,['source','retry','third']);
 state.messages[0].createdBy='agent';assert.deepEqual(failedContinuations(state,['source']).turnIds,['source']);
});

test('checkpoint recovery retains the exact human link when recent history omits its input',()=>{
 const linked=failedContinuations(fixture(),['source']).state;
 const restored=restoreInlineBindings({protocolVersion:2,messages:[],activities:[]},inlineBindingCheckpoint(linked));
 assert.deepEqual(failedContinuations(restored,['source']).turnIds,['source','retry']);
 restored.turns!.retry.messageId='replacement';assert.deepEqual(failedContinuations(restored,['source']).turnIds,['source']);
 const changed=fixture();changed.failedContinuations=linked.failedContinuations;changed.messages[0].createdBy='agent';
 assert.deepEqual(failedContinuations(changed,['source']).turnIds,['source']);
});
