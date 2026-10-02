import {test} from 'node:test';
import assert from 'node:assert/strict';
import {followInlineQuestions,inlineQuestionPhase,questionConversationInputs} from '../inline-questions';
import {steeringSegments,type InlineSteering} from '../inline-steering';
import type {InlineThreadState,InlineMessage} from '../inline-thread';

const message=(id:string,text:string,turnId:string|null='turn',role='assistant'):InlineMessage=>({id,text,turnId,role,streaming:false});
const requested=(requestId:string,responseMode='message')=>({id:requestId,kind:'user-input.requested',summary:'Question',turnId:'turn',payload:{requestId,responseMode}});
const resolved=(requestId:string,answers?:Record<string,string|string[]>)=>({id:`resolved:${requestId}`,kind:'user-input.resolved',summary:'Resolved',turnId:'turn',payload:{requestId,...(answers?{answers}:{})}});

test('confirmed late answers appear once between their source turn and follow-up, even with truncated history',()=>{
  const old=message('old','First final.'),next=message('next','Follow-up.','next');
  const state:InlineThreadState={messages:[old,message('async-answer:late','Continue? Yes',null,'user'),next],activities:[requested('late'),resolved('late',{choice:'Yes'})],latestTurn:{turnId:'next',state:'running'},session:{status:'running',activeTurnId:'next'}};
  const followed=followInlineQuestions(state,['turn'],[],[old]);
  const inputs=questionConversationInputs(state,[],followed.follows,[old,next]);
  assert.deepEqual(steeringSegments([old,next],inputs).map(s=>s.text),['First final.','Yes','Follow-up.']);
  const restarted=followInlineQuestions({...state,messages:[next],activities:[]},followed.turnIds,JSON.parse(JSON.stringify(followed.follows)),[old,next]);
  assert.deepEqual(steeringSegments([old,next],questionConversationInputs({...state,messages:[next]},[],restarted.follows,[old,next])).map(s=>s.text),['First final.','Yes','Follow-up.']);
});

test('native answers freeze the preceding paragraph and do not become pending async continuations',()=>{
  const before={...message('growing','Earlier.\n\n'),streaming:true};
  const after={...before,text:'Earlier.\n\nAfter answer.\n\n'};
  const state:InlineThreadState={messages:[after],activities:[requested('native','native'),resolved('native',{choice:['One','Two'],detail:'Extra detail'})],session:{status:'running',activeTurnId:'turn'}};
  const followed=followInlineQuestions(state,['turn'],[],[before]);
  assert.equal(followed.waiting,false);
  assert.deepEqual(steeringSegments([after],questionConversationInputs(state,[],followed.follows,[after])).map(s=>s.text),['Earlier.\n\n','One, Two\n\nExtra detail','After answer.\n\n']);
});

test('question answers interleave with steering in message order, with dismissal and unrelated answers excluded',()=>{
  const old=message('old','Before.'),next=message('next','After.','next');
  const steer:InlineSteering={messageId:'steer',text:'Steering.',before:[old],confirmed:true};
  const state:InlineThreadState={messages:[old,message('steer','Steering.',null,'user'),message('async-answer:late','Late answer.',null,'user'),next],activities:[requested('late'),resolved('late',{choice:'Late answer.'}),requested('dismissed'),resolved('dismissed'),{...requested('other'),turnId:'unrelated'},resolved('other',{choice:'Other answer.'})],latestTurn:{turnId:'next',state:'running'},session:{status:'running',activeTurnId:'next'}};
  const followed=followInlineQuestions(state,['turn'],[],[old]);
  const inputs=questionConversationInputs(state,[steer],followed.follows,[old,next]);
  assert.deepEqual(steeringSegments([old,next],inputs).map(s=>s.text),['Before.','Steering.','Late answer.','After.']);
  assert.equal(followed.follows.some(item=>item.requestId==='other'),false);
  assert.equal(followed.follows.find(item=>item.requestId==='dismissed')?.input,undefined);
});

const at=(seconds:number)=>`2026-10-02T08:42:${String(seconds).padStart(2,'0')}.000Z`;
function steeredQuestion():InlineThreadState {
  return {messages:[{...message('before','Before.'),createdAt:at(0)},{...message('async-answer:steered','Yes',null,'user'),createdAt:at(10)},{...message('after','After answer.'),createdAt:at(20)}],activities:[requested('steered'),resolved('steered',{choice:'Yes'})],latestTurn:{turnId:'turn',state:'completed',requestedAt:at(0),completedAt:at(30)},session:{status:'ready',activeTurnId:null}};
}

test('a completed same-turn async answer repairs an old running checkpoint and stays bound after restart',()=>{
  const state=steeredQuestion();
  const old=[{requestId:'steered',turnId:'turn',responseMode:'message' as const,answered:true,completed:true}];
  const followed=followInlineQuestions(state,['turn'],old);
  assert.equal(old[0].answered,true);
  assert.equal(followed.follows[0].replyTurnId,'turn');
  assert.equal(followed.waiting,false);assert.equal(followed.continued,false);
  assert.equal(inlineQuestionPhase(state,'turn',followed.follows),'complete');
  assert.deepEqual(steeringSegments(state.messages.filter(m=>m.role==='assistant'),questionConversationInputs(state,[],followed.follows,state.messages)).map(s=>s.text),['Before.','Yes','After answer.']);
  const restarted=followInlineQuestions({...state,messages:[],activities:[]},['turn'],JSON.parse(JSON.stringify(followed.follows)));
  assert.equal(restarted.waiting,false);assert.equal(inlineQuestionPhase(state,'turn',restarted.follows),'complete');
});

test('same-turn answer recovery uses the source completion checkpoint while unrelated work is running',()=>{
  const state=steeredQuestion();
  state.latestTurn={turnId:'unrelated',state:'running'};state.session={status:'running',activeTurnId:'unrelated'};
  state.checkpoints=[{turnId:'turn',status:'ready',checkpointRef:'refs/t3/checkpoints/thread/turn/1',assistantMessageId:'after',completedAt:at(30)}];
  const followed=followInlineQuestions(state,['turn']);
  assert.equal(followed.follows[0].replyTurnId,'turn');assert.deepEqual(followed.turnIds,['turn']);assert.equal(followed.waiting,false);
});

test('late answers and ambiguous source history keep the projection-gap guard',()=>{
  for(const change of [
    (s:InlineThreadState)=>{s.messages[1].createdAt=at(40);},
    (s:InlineThreadState)=>{s.messages[1].createdAt=at(30);},
    (s:InlineThreadState)=>{delete s.messages[1].createdAt;},
    (s:InlineThreadState)=>{delete s.latestTurn!.completedAt;},
    (s:InlineThreadState)=>{delete s.latestTurn!.requestedAt;s.messages[2].turnId='unrelated';},
    (s:InlineThreadState)=>{delete s.latestTurn!.requestedAt;s.messages[2].streaming=true;},
    (s:InlineThreadState)=>{delete s.latestTurn!.requestedAt;s.messages=s.messages.slice(1);},
    (s:InlineThreadState)=>{s.latestTurn!.state='running';s.session={status:'running',activeTurnId:'turn'};},
  ]){
    const state=steeredQuestion();change(state);
    const followed=followInlineQuestions(state,['turn']);
    assert.equal(followed.follows[0].replyTurnId,undefined);assert.equal(followed.waiting,true);assert.equal(inlineQuestionPhase(state,'turn',followed.follows),'running');
  }
});

test('a completed source lifecycle binds an answer even without separate before and after prose',()=>{
  const state=steeredQuestion();state.messages=[state.messages[1]];
  const followed=followInlineQuestions(state,['turn']);
  assert.equal(followed.follows[0].replyTurnId,'turn');assert.equal(followed.waiting,false);
});

test('an exact new-turn binding takes precedence over source-turn timing evidence',()=>{
  const state=steeredQuestion();state.messages[1].turnId='follow-up';
  const followed=followInlineQuestions(state,['turn']);
  assert.equal(followed.follows[0].replyTurnId,'follow-up');assert.deepEqual(followed.turnIds,['turn','follow-up']);
});
