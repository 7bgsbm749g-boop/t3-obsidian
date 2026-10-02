import {test} from 'node:test';
import assert from 'node:assert/strict';
import {unified} from 'unified';
import remarkParse from 'remark-parse';
import {activeInlineIds,failedInlineIds,initialRegion,renderInlineTurn,type InlineThreadState} from '../inline-thread';
import {elapsedRun,intermediateMode,runTimer,completionTime} from '../response-presentation';
import {stoppedResponseBody} from '../response-stop';

const timing={startedAt:'2026-10-02T10:00:00Z',finishedAt:'2026-10-02T10:03:17Z'};
const state:InlineThreadState={title:'Bounded history',messages:[
  {id:'progress',role:'assistant',turnId:'turn',text:'Checking.\n\n## Nested heading\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```md\n> [!t3-progress]- Example\n```',streaming:false},
  {id:'final',role:'assistant',turnId:'turn',text:'Final visible answer.',streaming:false},
  {id:'late-progress',role:'assistant',turnId:'turn',text:'Earlier progress recovered out of order.',streaming:false},
],activities:[],latestTurn:{turnId:'turn',state:'completed',assistantMessageId:'final',completedAt:timing.finishedAt}};
const render=(value=state,phase:'running'|'complete'|'error'='complete',conversation?:any)=>renderInlineTurn(value,'turn','thread',phase,'collapse','environment',conversation,undefined,undefined,timing);

test('legacy settings migrate and run durations handle waits, hours, clock skew and frozen completion',()=>{
  assert.equal(intermediateMode(undefined,false),'remove');assert.equal(intermediateMode(undefined,true),'keep');
  assert.equal(intermediateMode('collapse',true),'collapse');assert.equal(intermediateMode('invalid',false),'remove');
  assert.equal(elapsedRun(timing,0),'03:17');assert.equal(elapsedRun({startedAt:timing.startedAt},Date.parse(timing.startedAt)+3661000),'01:01:01');
  assert.equal(elapsedRun({startedAt:timing.startedAt},0),'00:00');assert.equal(elapsedRun({startedAt:'bad'}),'00:00');
  assert.match(runTimer(timing),/>03:17<\/span>/);assert.match(runTimer({startedAt:timing.startedAt}),/>00:00<\/span>/);
  assert.equal(completionTime(state,'turn'),timing.finishedAt);
});

test('default-closed fold bounds nested headings, tables, fences and out-of-order progress; exact final stays outside',()=>{
  const text=render(),ast=unified().use(remarkParse).parse(text+'\nFollowing user paragraph.');
  assert.match(text,/^> \[!t3-progress\]- \*\*Bounded history · Completed\*\*/);
  assert.doesNotMatch(text,/spinner/);
  const folds=ast.children.filter(node=>node.type==='blockquote'&&text.slice(node.position!.start.offset!,node.position!.end.offset!).startsWith('> [!t3-progress]-'));
  assert.equal(folds.length,2);
  for(const fold of folds)assert.doesNotMatch(text.slice(fold.position!.start.offset!,fold.position!.end.offset!),/Final visible answer|Following user/);
  assert.match(text,/> > Checking\./);assert.match(text,/> ## Nested heading/);assert.match(text,/> ```md/);
  assert.equal(text.split('Final visible answer.').length-1,1);
});

test('steering quotes stay outside folds and final-message pieces retain exact boundaries',()=>{
  const conversation={messages:state.messages,steering:[{messageId:'steer',text:'Keep my question visible.',confirmed:true,before:[{...state.messages[0],text:'Checking.'}]}]};
  const text=render(state,'complete',conversation),ast=unified().use(remarkParse).parse(text);
  for(const node of ast.children.filter(n=>n.type==='blockquote')){
    const block=text.slice(node.position!.start.offset!,node.position!.end.offset!);
    if(block.startsWith('> [!t3-progress]-'))assert.doesNotMatch(block,/Keep my question visible|Final visible answer/);
  }
  assert.match(text,/> \[!t3-steering\] You\n> Keep my question visible\./);
});

test('empty late-answer follow-up places a working fold after its visible input',()=>{
  const running={...state,messages:state.messages.slice(0,2),latestTurn:{turnId:'next',state:'running'},turns:{turn:{turnId:'turn',state:'completed',assistantMessageId:'final'}},session:{status:'running',activeTurnId:'next'}};
  const text=render(running,'running',{messages:running.messages,steering:[{messageId:'reply',text:'Follow up now.',confirmed:true,before:running.messages}],preserveHistory:true});
  assert.match(text,/Final visible answer\.[\s\S]*> Follow up now\.[\s\S]*> \[!t3-progress\]- \*\*Bounded history · Working/);
});

test('Collapse status remains discoverable for steering and exact error recovery; Stop freezes it',()=>{
  const id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const initial=initialRegion(id,undefined,'Name','collapse',{startedAt:timing.startedAt});
  assert.deepEqual(activeInlineIds(initial.text),[id]);
  const failed=initial.text.replace(' · Working**',' · Error**');assert.deepEqual(failedInlineIds(failed),[id]);
  const stopped=stoppedResponseBody(initial.text);
  assert.match(stopped,/Name · Interrupted/);assert.match(stopped,/data-t3-end=/);assert.doesNotMatch(stopped,/spinner|Working/);
});

test('active clock ticks do not change rendered note bytes',()=>{
  const live={...state,latestTurn:{turnId:'turn',state:'running'},session:{status:'running',activeTurnId:'turn'}};
  const original=Date.now;try{
    Date.now=()=>Date.parse(timing.startedAt)+1000;
    const first=renderInlineTurn(live,'turn','thread','running','collapse',undefined,undefined,undefined,undefined,{startedAt:timing.startedAt});
    Date.now=()=>Date.parse(timing.startedAt)+90000;
    assert.equal(renderInlineTurn(live,'turn','thread','running','collapse',undefined,undefined,undefined,undefined,{startedAt:timing.startedAt}),first);
  }finally{Date.now=original;}
});

test('questions and pending actions remain outside progress folds',()=>{
  const live:InlineThreadState={...state,latestTurn:{turnId:'turn',state:'running'},session:{status:'running',activeTurnId:'turn'},activities:[
    {id:'approval',kind:'approval.requested',turnId:'turn',summary:'Approve the next action'},
    {id:'question',kind:'user-input.requested',turnId:'turn',summary:'Question',payload:{requestId:'request',questions:[{id:'choice',header:'Choice',question:'Which option?',options:[{label:'One',description:'First'}]}]}},
  ]};
  const text=render(live,'running'),ast=unified().use(remarkParse).parse(text);
  assert.match(text,/Action needed in T3: Approve the next action/);assert.match(text,/Which option\?|t3-question:/);
  for(const node of ast.children.filter(n=>n.type==='blockquote')){
    const block=text.slice(node.position!.start.offset!,node.position!.end.offset!);
    if(block.startsWith('> [!t3-progress]-'))assert.doesNotMatch(block,/Action needed|Which option|t3-question:/);
  }
});

test('Stop preserves header examples inside code fences',()=>{
  const example='```md\n> [!t3-progress]- **Example · Working** <span class="send-to-t3-inline-spinner" aria-label="Loading"></span>\n```';
  assert.equal(stoppedResponseBody(example),example);
});
