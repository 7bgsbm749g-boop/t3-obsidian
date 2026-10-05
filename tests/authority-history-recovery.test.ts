import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {applyThreadItem,restoreInlineBindings,inlineBindingCheckpoint,turnPhase,type InlineThreadState} from '../inline-thread';
import {followInlineQuestions,inlineQuestionPhase} from '../inline-questions';
import {mergeProse} from '../inline-steering';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/authority-recovery.json',import.meta.url),'utf8'));
const empty=():InlineThreadState=>({messages:[],activities:[]});
const apply=(s:InlineThreadState,item:any)=>applyThreadItem(s,item).state;

test('a durable active-session checkpoint catches up both exact answers after interruption and excludes unrelated work',()=>{
  const cursor=fixture.checkpoint.sequence;
  const before=fixture.events.filter((item:any)=>item.event.sequence<=cursor).reduce(apply,empty());
  const checkpoint=inlineBindingCheckpoint(before);
  assert.equal(checkpoint.session?.activeTurnId,'source');assert.equal(checkpoint.latestTurn?.turnId,'source');
  const restored=restoreInlineBindings(empty(),JSON.parse(JSON.stringify(checkpoint)));
  assert.equal(restored.session?.activeTurnId,'source');
  const evidence=fixture.events.filter((item:any)=>item.event.sequence>cursor).reduce(apply,restored);
  const canonical=apply(restoreInlineBindings(empty(),fixture.checkpoint),{kind:'snapshot',snapshot:fixture.canonical});
  const bindings=inlineBindingCheckpoint(evidence);delete bindings.sequence;
  const current=restoreInlineBindings({...canonical,turns:{...canonical.turns,...evidence.turns}},bindings);
  const questions=followInlineQuestions(current,['source'],fixture.follows,fixture.sourceProse);
  assert.deepEqual(questions.turnIds,['source','continuation']);assert.equal(questions.waiting,false);
  assert.equal(questions.follows[0].replyTurnId,'source');assert.equal(questions.follows[1].replyTurnId,'continuation');
  assert.equal(turnPhase(current,'source'),'complete');assert.equal(inlineQuestionPhase(current,questions.turnId!,questions.follows),'complete');
  const prose=mergeProse(fixture.sourceProse,current.messages,questions.turnIds);
  assert.equal(prose.filter(m=>m.turnId==='source').length,6);assert.equal(prose.filter(m=>m.turnId==='continuation').length,2);assert.ok(prose.every(m=>m.turnId!=='unrelated'));
});

test('snapshot fallback without historical lifecycle retains unresolved answer bindings',()=>{
  const current=apply(restoreInlineBindings(empty(),fixture.checkpoint),{kind:'snapshot',snapshot:fixture.canonical});
  const questions=followInlineQuestions(current,['source'],fixture.follows,fixture.sourceProse);
  assert.equal(questions.waiting,true);assert.deepEqual(questions.turnIds,['source']);
  assert.ok(questions.follows.every(item=>!item.replyTurnId));
});
