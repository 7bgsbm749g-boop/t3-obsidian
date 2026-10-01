import {test} from 'node:test';
import assert from 'node:assert/strict';
import {followInlineQuestions,questionConversationInputs} from '../inline-questions';
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
