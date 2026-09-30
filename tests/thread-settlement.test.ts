import {test} from 'node:test';
import assert from 'node:assert/strict';
import {settlementState,type ThreadSettlementJob} from '../thread-settlement';

const job:ThreadSettlementJob={requestId:'request',messageId:'message',threadId:'thread',projectId:'project',connection:{executable:'',host:'local'}};
function completed(overrides:any={}){
  return {id:'thread',projectId:'project',messages:[{id:'message',role:'user',createdAt:'2026-09-30T10:00:00Z'},{id:'answer',role:'assistant',streaming:false}],latestTurn:{requestedAt:'2026-09-30T10:00:00Z',state:'completed',assistantMessageId:'answer'},session:{status:'ready',activeTurnId:null},hasPendingApprovals:false,hasPendingUserInput:false,backgroundLiveness:null,...overrides};
}

test('settle only the completed Obsidian turn with a final assistant reply',()=>{
  assert.equal(settlementState(completed(),job),'settle');
  assert.equal(settlementState(completed({latestTurn:{requestedAt:'2026-09-30T10:00:00Z',state:'running'}}),job),'wait');
  assert.equal(settlementState(completed({messages:[{id:'message',role:'user',createdAt:'2026-09-30T10:00:00Z'},{id:'answer',role:'assistant',streaming:true}]}),job),'wait');
  assert.equal(settlementState(completed({hasPendingApprovals:true}),job),'wait');
  assert.equal(settlementState(completed({hasPendingUserInput:true}),job),'wait');
  assert.equal(settlementState(completed({backgroundLiveness:'working'}),job),'wait');
});

test('discard a superseded, failed, archived, or already settled turn',()=>{
  assert.equal(settlementState(completed({latestTurn:{requestedAt:'2026-09-30T10:01:00Z',state:'completed',assistantMessageId:'answer'}}),job),'discard');
  assert.equal(settlementState(completed({latestTurn:{requestedAt:'2026-09-30T10:00:00Z',state:'error'}}),job),'discard');
  assert.equal(settlementState(completed({archivedAt:'2026-09-30T10:02:00Z'}),job),'discard');
  assert.equal(settlementState(completed({settledOverride:'settled'}),job),'discard');
});
