import {test} from 'node:test';
import assert from 'node:assert/strict';
import {followInlineQuestions,questionConversationInputs} from '../inline-questions';
import {renderInlineTurn,type InlineThreadState} from '../inline-thread';
import {renderSubmittedAnswer,submittedAnswers} from '../response-answers';
import {presentToolGroups,restoreToolGroups} from '../response-tool-presentation';

const at=(seconds:number)=>`2026-10-06T19:52:${String(seconds).padStart(2,'0')}.000Z`;
const question={id:'device',header:'Device',question:'Which device and vault did you reload?',options:[],multiSelect:false};
function fixture(mode='message'):InlineThreadState {
  return {messages:[
    {id:'before',role:'assistant',turnId:'turn',text:'Checking before input.',streaming:false,createdAt:at(0)},
    ...(mode==='message'?[{id:'async-answer:request',role:'user',turnId:null,text:'Which device and vault did you reload? laptop QLO2',streaming:false,createdAt:at(10)}]:[]),
    {id:'final',role:'assistant',turnId:'turn',text:'Continuing after input.',streaming:false,createdAt:at(20)},
  ],activities:[
    {id:'request',kind:'user-input.requested',summary:'Question',turnId:'turn',createdAt:at(5),payload:{requestId:'request',responseMode:mode,questions:[question]}},
    {id:'resolution',kind:'user-input.resolved',summary:'Resolved',turnId:'turn',createdAt:at(10),payload:{requestId:'request',answers:{device:'laptop QLO2'}}},
  ],latestTurn:{turnId:'turn',state:'completed',requestedAt:at(0),completedAt:at(30),assistantMessageId:'final'}};
}
function render(state:InlineThreadState,mode:'remove'|'keep'|'collapse',saved?:ReturnType<typeof followInlineQuestions>['follows']) {
  const followed=followInlineQuestions(state,['turn'],saved,state.messages.filter(message=>message.role==='assistant'));
  const steering=questionConversationInputs(state,[],followed.follows,state.messages);
  return {followed,body:renderInlineTurn(state,'turn','thread','complete',mode,'environment',{messages:state.messages.filter(message=>message.role==='assistant'),steering})};
}

for(const responseMode of ['message','native'])for(const mode of ['remove','keep','collapse'] as const)test(`${responseMode} answers use one closed disclosure in ${mode} history`,()=>{
  const state=fixture(responseMode),original=JSON.stringify(state),{body}=render(state,mode);
  assert.equal(body.match(/data-t3-answer-id="request"/g)?.length,1);
  assert.match(body,/<details class="send-to-t3-answer" data-t3-answer-id="request"><summary>/);
  assert.match(body,/User input submitted<\/span><span class="send-to-t3-answer-preview">laptop QLO2<\/span>/);
  assert.match(body,/Which device and vault did you reload\?<\/p><p class="send-to-t3-answer-text">laptop QLO2<\/p>/);
  assert.ok(body.indexOf('Checking before input.')<body.indexOf('data-t3-answer-id='));
  assert.ok(body.indexOf('data-t3-answer-id=')<body.indexOf('Continuing after input.'));
  assert.doesNotMatch(body,/\[!t3-steering\]|t3-question:|<details[^>]* open/);
  assert.equal(JSON.stringify(state),original);
});

test('question metadata survives request-page truncation before an answer and checkpoint recovery afterward',()=>{
  const state=fixture(),pending=followInlineQuestions({...state,messages:[],activities:state.activities.slice(0,1)},['turn']);
  const answered=render({...state,activities:state.activities.slice(1)},'collapse',JSON.parse(JSON.stringify(pending.follows)));
  const saved=JSON.stringify(answered.followed.follows);
  const recovered=render({...state,messages:state.messages.filter(message=>message.role==='assistant'),activities:[]},'collapse',JSON.parse(saved));
  assert.equal(recovered.body,answered.body);
  assert.equal(JSON.stringify(answered.followed.follows),saved);
  assert.match(recovered.body,/Which device and vault did you reload\?/);
});

test('a canonical async-answer quote cannot hide or duplicate submitted-answer metadata',()=>{
  const state=fixture(),followed=followInlineQuestions(state,['turn']);
  const input=followed.follows[0].input!;
  const inputs=questionConversationInputs(state,[{...input,text:'Raw canonical answer',answer:undefined}],followed.follows,state.messages);
  assert.equal(inputs.length,1);assert.equal(inputs[0].answer?.requestId,'request');assert.equal(inputs[0].text,'laptop QLO2');
});

test('a native answer without a user message stays between the preceding and following tool groups',()=>{
  const state=fixture('native');
  for(const [id,seconds,command] of [['before-tool',2,'pwd'],['after-tool',15,'ls']] as const)state.activities.push({id,kind:'tool.completed',summary:'Command',turnId:'turn',createdAt:at(seconds),payload:{toolCallId:id,status:'completed',itemType:'command_execution',data:{item:{command}}}});
  const {body}=render(state,'collapse');
  assert.ok(body.indexOf('data-t3-tool-id="before-tool"')<body.indexOf('data-t3-answer-id='));
  assert.ok(body.indexOf('data-t3-answer-id=')<body.indexOf('data-t3-tool-id="after-tool"'));
});

test('multiple questions, selected values, custom multiline text and HTML stay complete and inert',()=>{
  const text='Custom <script>alert("x")</script>\n\n```md\n</details>';
  const answer={requestId:'id" onclick="bad',questions:[question,{...question,id:'more',question:'Next <question>?'}],answers:{device:['A','B'],more:text,unknown:'Retained extra answer'}};
  const body=renderSubmittedAnswer(answer,'fallback',at(10));
  assert.match(body,/A, B/);assert.match(body,/Next &lt;question&gt;\?/);assert.match(body,/&#10;&#10;```md&#10;&lt;\/details&gt;/);
  assert.match(body,/Retained extra answer/);assert.doesNotMatch(body,/<script| onclick="bad|fallback/);
  assert.equal(restoreToolGroups(presentToolGroups(body).display,presentToolGroups(body)),body);
  const long='Full answer '.repeat(1000),full=renderSubmittedAnswer({requestId:'long',questions:[]},long);
  assert.ok(full.includes(long));assert.ok(full.length<2*long.length);
});

test('legacy follows without request details show the full answer without inventing a question',()=>{
  const state=fixture();state.activities=[];
  const {body}=render(state,'keep',[{requestId:'request',turnId:'turn',responseMode:'message',input:{messageId:'async-answer:request',text:'Saved answer',confirmed:true,before:[state.messages[0]]}}]);
  assert.match(body,/User input submitted/);assert.match(body,/>Saved answer<\/p>/);assert.doesNotMatch(body,/answer-question/);
  assert.equal(submittedAnswers(['bad']),undefined);
  assert.deepEqual(submittedAnswers({one:['Valid'],bad:['valid',2],other:3}),{one:['Valid']});
});

test('dismissed and unrelated questions never create submitted-answer rows',()=>{
  const state=fixture();state.activities[1].payload={requestId:'request'};state.messages=state.messages.filter(message=>message.role==='assistant');
  assert.doesNotMatch(render(state,'collapse').body,/data-t3-answer-id/);
  const other=fixture();other.activities.forEach(activity=>activity.turnId='unrelated');
  assert.doesNotMatch(render(other,'keep').body,/data-t3-answer-id/);
});
