import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {applyThreadItem,inlineBindingCheckpoint,restoreInlineBindings,renderInlineTurn,turnForMessage,turnPhase,type InlineThreadState} from '../inline-thread';
const observed=JSON.parse(readFileSync(new URL('./fixtures/working-event-sequence.json',import.meta.url),'utf8'));
const prompt=observed[0].payload.messageId,turn='01a0fdc1-9ab9-7463-9b44-3b7a96d6ef43';
const stamp='2026-10-02T17:55:18.588Z',later='2026-10-02T17:56:18.588Z';
const empty=():InlineThreadState=>({messages:[],activities:[]});
const event=(state:InlineThreadState,sequence:number,type:string,payload:any)=>applyThreadItem(state,{kind:'event',event:{sequence,type,payload}}).state;
function replay(end=observed.length){return observed.slice(0,end).reduce((s:InlineThreadState,e:any)=>applyThreadItem(s,{kind:'event',event:e}).state,empty());}
const user=(id:string,createdAt:string,turnId:string|null=null)=>({id,role:'user',text:id,streaming:false,turnId,createdAt});
const output=(id:string,turnId:string,createdAt:string)=>({id,role:'assistant',text:id,streaming:false,turnId,createdAt});
const snapshot=(state:InlineThreadState,sequence:number,thread:any)=>applyThreadItem(state,{kind:'snapshot',snapshot:{snapshotSequence:sequence,thread}}).state;

test('observed null-ID prompt binds at the first provider session and streams/finalizes without a second prompt',()=>{
  assert.equal(turnForMessage(replay(2),prompt),undefined,'request alone is not a provider turn');
  const running=replay(4);
  assert.equal(turnForMessage(running,prompt),turn);
  assert.equal(running.latestTurn?.requestedAt,stamp);
  assert.equal(running.latestTurn?.messageId,prompt);
  const progress=replay(5);
  assert.match(renderInlineTurn(progress,turn,'thread','running'),/Synthetic assistant prose/);
  const final=replay();
  assert.equal(turnForMessage(final,prompt),turn);assert.equal(turnPhase(final,turn),'complete');
  assert.equal(final.latestTurn?.completedAt,'2026-10-02T17:55:33.060Z');
  assert.doesNotMatch(renderInlineTurn(final,turn,'thread','complete'),/Working/);
});

test('duplicate and stale events/snapshots cannot duplicate deltas or erase exact start evidence',()=>{
  let state=replay(5),body=state.messages.at(-1)!.text;
  state=applyThreadItem(state,{kind:'event',event:observed[4]}).state;
  assert.equal(state.messages.at(-1)!.text,body);
  state=snapshot(state,1,{messages:[],latestTurn:{turnId:'unrelated',state:'running'}});
  assert.equal(turnForMessage(state,prompt),turn);
  state=snapshot(state,162085,{messages:state.messages,session:state.session,latestTurn:{turnId:turn,state:'running'}});
  assert.equal(state.latestTurn?.requestedAt,stamp);
  assert.equal(turnForMessage(state,prompt),turn);
});

test('missed starts use exact canonical timestamps; ambiguous or absent evidence stays unbound',()=>{
  const thread={messages:[user(prompt,stamp),output('answer',turn,stamp)],latestTurn:{turnId:turn,state:'completed',requestedAt:stamp}};
  assert.equal(turnForMessage(snapshot(empty(),100,thread),prompt),turn);
  assert.equal(turnForMessage(snapshot(empty(),100,{...thread,latestTurn:{turnId:turn,state:'completed'}}),prompt),undefined);
  const duplicate={...thread,messages:[user('another',stamp),...thread.messages]};
  assert.equal(turnForMessage(snapshot(empty(),100,duplicate),prompt),undefined);
  assert.equal(turnForMessage({...thread,latestTurn:{turnId:'unrelated',state:'running'},activities:[],historyComplete:true,messages:[user(prompt,stamp),output('late','prior',later),user('next',later)]},prompt),undefined);
});

test('a saved binding survives a cold reload after latestTurn advances and a recent window omits its prompt',()=>{
  const saved=JSON.parse(JSON.stringify(inlineBindingCheckpoint(replay())));
  let state=restoreInlineBindings(empty(),saved);
  state=snapshot(state,162110,{messages:[user('new',later),output('new answer','new',later)],latestTurn:{turnId:'new',state:'running',requestedAt:later},session:{status:'running',activeTurnId:'new'}});
  assert.equal(turnForMessage(state,prompt),turn);assert.equal(turnPhase(state,turn),'complete');
  assert.equal(state.turns?.[turn]?.requestedAt,stamp);
});

test('start-event-only evidence survives a checkpoint and later canonical provider metadata',()=>{
  const saved=inlineBindingCheckpoint(replay(2));
  const state=snapshot(restoreInlineBindings(empty(),saved),162100,{messages:[user(prompt,stamp),output('answer',turn,stamp)],latestTurn:{turnId:turn,state:'completed',requestedAt:stamp}});
  assert.equal(turnForMessage(state,prompt),turn);
});

test('interrupted or failed starts cannot borrow a later unrelated session',()=>{
  let state=replay(2);
  state=event(state,162082,'thread.session-set',{session:{status:'interrupted',activeTurnId:null,updatedAt:stamp}});
  state=event(state,162083,'thread.session-set',{session:{status:'running',activeTurnId:'other',updatedAt:later}});
  assert.equal(turnForMessage(state,prompt),undefined);
  state=replay(2);
  state=event(state,162082,'thread.activity-appended',{activity:{id:'failure',kind:'provider.turn.start.failed',summary:'Failed',turnId:null,payload:{requestId:prompt}}});
  state=event(state,162083,'thread.session-set',{session:{status:'running',activeTurnId:'other',updatedAt:later}});
  assert.equal(turnForMessage(state,prompt),undefined);
});

test('two pending starts and late output from a prior run do not supply a primary binding',()=>{
  let state=replay(2);
  state=event(state,162082,'thread.message-sent',{messageId:'next',role:'user',text:'Next',createdAt:later});
  state=event(state,162083,'thread.turn-start-requested',{messageId:'next',createdAt:later});
  state=event(state,162084,'thread.session-set',{session:{status:'running',activeTurnId:'other',updatedAt:later}});
  assert.equal(turnForMessage(state,prompt),undefined);assert.equal(turnForMessage(state,'next'),undefined);
  state=replay(2);
  state=event(state,162082,'thread.session-set',{session:{status:'running',activeTurnId:'prior',updatedAt:'2026-10-02T17:55:17.000Z'}});
  assert.equal(turnForMessage(state,prompt),undefined);
});

test('ordinary mid-run request follows confirmed T3 delivery and subsequent existing-run output, including cold recovery',()=>{
  let state=replay(5);
  state=event(state,162086,'thread.message-sent',{messageId:'steer',role:'user',text:'Steer',createdAt:'2026-10-02T17:55:25.000Z'});
  state=event(state,162087,'thread.turn-start-requested',{messageId:'steer',createdAt:'2026-10-02T17:55:25.000Z'});
  assert.equal(turnForMessage(state,'steer'),undefined,'bare delivery waits for existing-run evidence');
  const saved=inlineBindingCheckpoint(state);
  state=event(state,162088,'thread.message-sent',{messageId:'late',role:'assistant',turnId:turn,text:'Old',streaming:false,createdAt:'2026-10-02T17:55:24.000Z'});
  assert.equal(turnForMessage(state,'steer'),undefined,'late output created earlier cannot confirm steering');
  state=event(state,162089,'thread.message-sent',{messageId:'after',role:'assistant',turnId:turn,text:'After steering',streaming:true,createdAt:'2026-10-02T17:55:26.000Z'});
  assert.equal(turnForMessage(state,'steer'),turn);assert.equal(state.latestTurn?.requestedAt,stamp);
  const recovered=snapshot(restoreInlineBindings(empty(),saved),162100,{messages:[user(prompt,stamp),user('steer','2026-10-02T17:55:25.000Z'),output('after',turn,'2026-10-02T17:55:26.000Z')],latestTurn:{turnId:turn,state:'completed',requestedAt:stamp,completedAt:'2026-10-02T17:55:30.000Z'}});
  assert.equal(turnForMessage(recovered,'steer'),turn);
});

test('a completion-race request adopts its exact new primary, never the completed run',()=>{
  let state=replay(5);
  state=event(state,162086,'thread.message-sent',{messageId:'race',role:'user',text:'Race',createdAt:later});
  state=event(state,162087,'thread.turn-start-requested',{messageId:'race',createdAt:later});
  state=event(state,162088,'thread.session-set',{session:{status:'ready',activeTurnId:null,updatedAt:'2026-10-02T17:55:30.000Z'}});
  assert.equal(turnForMessage(state,'race'),undefined);
  state=event(state,162089,'thread.session-set',{session:{status:'running',activeTurnId:'new',updatedAt:later}});
  assert.equal(turnForMessage(state,'race'),'new');assert.equal(state.latestTurn?.requestedAt,later);
});

test('a newer exact primary corrects a provisional same-run steering association',()=>{
  let state=replay(5);
  state=event(state,162086,'thread.message-sent',{messageId:'race',role:'user',text:'Race',createdAt:'2026-10-02T17:55:25.000Z'});
  state=event(state,162087,'thread.turn-start-requested',{messageId:'race',createdAt:'2026-10-02T17:55:25.000Z'});
  state=event(state,162088,'thread.message-sent',{messageId:'after',role:'assistant',turnId:turn,text:'After',streaming:false,createdAt:'2026-10-02T17:55:26.000Z'});
  assert.equal(turnForMessage(state,'race'),turn);
  state=snapshot(state,162100,{messages:[...state.messages,output('new answer','new','2026-10-02T17:55:27.000Z')],latestTurn:{turnId:'new',state:'running',requestedAt:'2026-10-02T17:55:25.000Z'},session:{status:'running',activeTurnId:'new'}});
  assert.equal(turnForMessage(state,'race'),'new');assert.equal(turnForMessage(state,prompt),turn);
});

test('a stale canonical snapshot after cold recovery cannot roll back a saved binding or its completion',()=>{
  const saved=inlineBindingCheckpoint(replay());
  const stale=snapshot(restoreInlineBindings(empty(),saved),162080,{messages:[user(prompt,stamp)],latestTurn:{turnId:turn,state:'running',requestedAt:stamp}});
  assert.equal(turnForMessage(stale,prompt),turn);assert.equal(turnPhase(stale,turn),'complete');assert.equal(stale.messages.length,0,'stale prose is unavailable for rendering');
});

test('a proven primary binding keeps its exact request timestamp when canonical provider-start time differs',()=>{
  const state=restoreInlineBindings({messages:[user(prompt,stamp)],activities:[],latestTurn:{turnId:turn,state:'running',messageId:prompt,requestedAt:later},session:{status:'running',activeTurnId:turn}}, {starts:{[prompt]:{messageId:prompt,requestedAt:stamp,sequence:1}},bindings:{[prompt]:{turnId:turn,kind:'start'}}});
  assert.equal(state.latestTurn?.requestedAt,stamp);assert.equal(state.starts?.[prompt].turnId,turn);
  const cold=restoreInlineBindings(snapshot(empty(),9,{messages:[user(prompt,stamp)],latestTurn:{turnId:turn,state:'completed',requestedAt:later},session:{status:'ready',activeTurnId:null}}),inlineBindingCheckpoint(state));
  assert.equal(cold.latestTurn?.requestedAt,stamp);assert.equal(turnForMessage(cold,prompt),turn);
});
