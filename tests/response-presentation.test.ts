import {test} from 'node:test';
import assert from 'node:assert/strict';
import {unified} from 'unified';
import remarkParse from 'remark-parse';
import {activeInlineIds,failedInlineIds,initialRegion,renderInlineTurn,type InlineThreadState} from '../inline-thread';
import {elapsedRun,intermediateMode,runTimer,completionTime} from '../response-presentation';
import {stoppedResponseBody} from '../response-stop';
import {followInlineQuestions,questionConversationInputs} from '../inline-questions';
import type {InlineSteering} from '../inline-steering';

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

test('a stale commentary checkpoint cannot hide newer final prose created before completion',()=>{
  const messages=[
    {id:'commentary',role:'assistant',turnId:'turn',text:'AFTER TOOL',streaming:false,createdAt:'2026-10-02T10:03:16.200Z'},
    {id:'final',role:'assistant',turnId:'turn',text:'FINAL ANSWER',streaming:false,createdAt:'2026-10-02T10:03:16.900Z'},
    {id:'recovered',role:'assistant',turnId:'turn',text:'EARLIER RECOVERED PROGRESS',streaming:false,createdAt:'2026-10-02T10:00:10Z'},
  ];
  const snapshot={...state,messages,latestTurn:{...state.latestTurn!,assistantMessageId:'commentary'}};
  const text=render(snapshot),ast=unified().use(remarkParse).parse(text);
  assert.match(text,/\n\n> FINAL ANSWER\n/);
  for(const node of ast.children.filter(n=>n.type==='blockquote')){
    const block=text.slice(node.position!.start.offset!,node.position!.end.offset!);
    if(block.startsWith('> [!t3-progress]-'))assert.doesNotMatch(block,/FINAL ANSWER/);
  }
  assert.equal(renderInlineTurn(snapshot,'turn','thread','complete','remove'),'> FINAL ANSWER\n');
  const afterCompletion={...snapshot,messages:[...messages,{...messages[1],id:'late',text:'LATE UNVERIFIED PROGRESS',createdAt:'2026-10-02T10:04:00Z'}]};
  assert.equal(renderInlineTurn(afterCompletion,'turn','thread','complete','remove'),'> FINAL ANSWER\n');
});

test('steering quotes stay outside folds and final-message pieces retain exact boundaries',()=>{
  const conversation={messages:state.messages,steering:[{messageId:'steer',text:'Keep my question visible.',confirmed:true,before:[{...state.messages[0],text:'Checking.'}]}]};
  const text=render(state,'complete',conversation),ast=unified().use(remarkParse).parse(text);
  for(const node of ast.children.filter(n=>n.type==='blockquote')){
    const block=text.slice(node.position!.start.offset!,node.position!.end.offset!);
    if(block.startsWith('> [!t3-progress]-'))assert.doesNotMatch(block,/Keep my question visible|Final visible answer/);
  }
  assert.match(text,/> \[!t3-steering\] You\n> Keep my question visible\./);
  assert.equal(text.match(/Bounded history · Completed/g)?.length,1);
  assert.equal(text.match(/class="send-to-t3-run-timer"/g)?.length,1);
});

function assertOneRun(text:string,phase='Working'){
  assert.equal(text.match(new RegExp(`Bounded history · ${phase}`,'g'))?.length,1);
  assert.equal(text.match(/class="send-to-t3-run-timer"/g)?.length,1);
  assert.equal(text.match(/^> \[!t3-progress\]- .*class="send-to-t3-inline-spinner"/gm)?.length,1);
  assert.equal(text.match(/class="send-to-t3-response-activity"/g)?.length,1,'retain the separate bottom tool activity indicator');
}
function foldsOf(text:string){
  return unified().use(remarkParse).parse(text).children.filter(node=>node.type==='blockquote').map(node=>text.slice(node.position!.start.offset!,node.position!.end.offset!)).filter(block=>block.startsWith('> [!t3-progress]-'));
}
function foldKeys(text:string){return [...text.matchAll(/data-t3-fold="([^"]+)"/g)].map(match=>match[1]);}

for(const inputKind of ['question answer','steering','repeated mixed inputs'] as const)test(`${inputKind} within a run keeps one status while progress and inputs retain chronological boundaries`,()=>{
  const progress={id:'progress',role:'assistant',turnId:'turn',text:'Before input.',streaming:false,createdAt:'2026-10-02T10:00:01Z'};
  const after={...progress,id:'after',text:'After first input.',createdAt:'2026-10-02T10:00:03Z'};
  let live:InlineThreadState={title:state.title,messages:[progress],activities:[],latestTurn:{turnId:'turn',state:'running',requestedAt:timing.startedAt},session:{status:'running',activeTurnId:'turn'}};
  const steering:InlineSteering[]=[];
  const addQuestion=(id:string,text:string,at:string)=>{
    live.messages.push({id:`async-answer:${id}`,role:'user',turnId:null,text,streaming:false,createdAt:at});
    live.activities.push({id,kind:'user-input.requested',turnId:'turn',summary:'Question',payload:{requestId:id,responseMode:'message',questions:[{id:'choice',header:'Choice',question:'Choose?',options:[{label:'One',description:'First'}]}]}},
      {id:`resolved:${id}`,kind:'user-input.resolved',turnId:'turn',summary:'Answered',createdAt:at,payload:{requestId:id,answers:{choice:[text]}}});
  };
  if(inputKind==='steering')steering.push({messageId:'steer',text:'Use private handoff browser',before:[progress],confirmed:true});
  else addQuestion('question','jslepx','2026-10-02T10:00:02Z');
  // Accepted input without new prose must not manufacture another status.
  const renderLive=()=>{
    const prose=live.messages.filter(message=>message.role==='assistant');
    const follows=followInlineQuestions(live,['turn'],[],prose);
    const inputs=questionConversationInputs(live,steering,follows.follows,prose);
    return renderInlineTurn(live,'turn','thread','running','collapse','environment',{messages:prose,steering:inputs,preserveHistory:follows.continued},undefined,undefined,{startedAt:timing.startedAt});
  };
  const waiting=renderLive();assertOneRun(waiting);
  live.messages.push(after);
  const first=renderLive();assertOneRun(first);
  assert.match(first,/> \[!t3-progress\]- Progress /);
  assert.deepEqual(foldKeys(first).slice(0,foldKeys(waiting).length),foldKeys(waiting),'streaming retains the keys used for explicit fold choices');
  if(inputKind==='repeated mixed inputs'){
    steering.push({messageId:'steer',text:'Use private handoff browser',before:[progress,after],confirmed:true});
    addQuestion('second','Second answer','2026-10-02T10:00:04Z');
    live.messages.push({...after,id:'last',text:'After repeated inputs.',createdAt:'2026-10-02T10:00:05Z'});
  }
  const text=renderLive();assertOneRun(text);
  const visibleInputs=inputKind==='steering'?['Use private handoff browser']:inputKind==='question answer'?['jslepx']:['jslepx','Use private handoff browser','Second answer'];
  for(const fold of foldsOf(text))for(const input of visibleInputs)assert.ok(!fold.includes(input),'input stays outside progress');
  const ordered=['Before input.',visibleInputs[0],'After first input.',...visibleInputs.slice(1),...(inputKind==='repeated mixed inputs'?['After repeated inputs.']:[])];
  for(let index=1;index<ordered.length;index++)assert.ok(text.indexOf(ordered[index-1])<text.indexOf(ordered[index]),'transcript retains chronological order');
  const id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',document=`<!-- t3-inline:start:${id} -->\n${text}<!-- t3-inline:end:${id} -->`;
  assert.deepEqual(activeInlineIds(document),[id]);
  assert.deepEqual(failedInlineIds(document.replace(' · Working**',' · Error**')),[id]);
  assert.doesNotMatch(stoppedResponseBody(document),/ · Working|class="send-to-t3-inline-spinner"/);
});

test('independent response bindings and a new run in the same thread each own their status and fold choices',()=>{
  const live={...state,messages:state.messages.slice(0,1),latestTurn:{turnId:'turn',state:'running'},session:{status:'running',activeTurnId:'turn'}};
  const first=renderInlineTurn(live,'turn','thread','running','collapse',undefined,undefined,undefined,undefined,{startedAt:timing.startedAt});
  const next={...live,messages:[{...live.messages[0],turnId:'next'}],latestTurn:{turnId:'next',state:'running'},session:{status:'running',activeTurnId:'next'}};
  const second=renderInlineTurn(next,'next','thread','running','collapse',undefined,undefined,undefined,undefined,{startedAt:'2026-10-02T10:04:00Z'});
  assertOneRun(first);assertOneRun(second);assert.notDeepEqual(foldKeys(first),foldKeys(second));
  const a='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',b='bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee';
  const document=`<!-- t3-inline:start:${a} -->\n${first}<!-- t3-inline:end:${a} -->\n\n<!-- t3-inline:start:${b} -->\n${second}<!-- t3-inline:end:${b} -->`;
  assert.deepEqual(activeInlineIds(document),[a,b]);
});

test('empty late-answer follow-up places a working fold after its visible input',()=>{
  const running={...state,messages:state.messages.slice(0,2),latestTurn:{turnId:'next',state:'running'},turns:{turn:{turnId:'turn',state:'completed',assistantMessageId:'final'}},session:{status:'running',activeTurnId:'next'}};
  const text=render(running,'running',{messages:running.messages,steering:[{messageId:'reply',text:'Follow up now.',confirmed:true,before:running.messages}],preserveHistory:true});
  assert.match(text,/Final visible answer\.[\s\S]*> Follow up now\.[\s\S]*> \[!t3-progress\]- \*\*Bounded history · Working/);
  assertOneRun(text);
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
    {id:'approval',kind:'approval.requested',turnId:'turn',summary:'Approve the next action',payload:{requestId:'approval'}},
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

test('native fold transitions finish, hidden clones do not cause repeated clicks, and rerenders retain user expansion',async()=>{
  const {installResponsePresentation}=await import('../response-presentation');
  const savedElement=(globalThis as any).Element,savedObserver=(globalThis as any).MutationObserver;
  let observed:(records:any[])=>void=()=>{},clicks=0;
  const owner={};
  class NativeElement {
    constructor(readonly fold?:any){}
    closest(selector:string){return selector==='.workspace-leaf-content'?owner:selector==='.callout-title'?this:selector==='.callout[data-callout="t3-progress"]'?this.fold:null;}
  }
  class NativeFold extends NativeElement {
    collapsed=true;key='stable-response:0';heading:any;content:any;
    classList={contains:()=>this.collapsed};
    constructor(readonly hidden=false){super();this.content={nodeType:1};this.heading=new NativeElement(this);this.heading.setAttribute=()=>{};this.heading.click=()=>{
      clicks++;
      // Hidden source clones may have no native handler. A visible callout
      // changes class immediately and finishes its transition on a timer.
      if(!this.hidden){root.fire('click',{target:this.heading});this.collapsed=!this.collapsed;}
      observed([{addedNodes:[this.content],removedNodes:[]}]);
    };}
    querySelector(selector:string){return selector==='.send-to-t3-fold-key'?{dataset:{t3Fold:this.key}}:this.heading;}
  }
  const listeners=new Map<string,(event:any)=>void>();
  const root:any={body:{},documentElement:owner,folds:[] as NativeFold[],querySelectorAll:(selector:string)=>selector.startsWith('.callout')?root.folds:[],addEventListener:(kind:string,callback:any)=>listeners.set(kind,callback),removeEventListener:(kind:string)=>listeners.delete(kind),fire:(kind:string,event:any)=>listeners.get(kind)?.(event)};
  (globalThis as any).Element=NativeElement;(globalThis as any).MutationObserver=class {constructor(callback:any){observed=callback;}observe(){}disconnect(){}};
  const visible=new NativeFold(),hidden=new NativeFold(true);root.folds=[visible,hidden];
  let dispose:()=>void=()=>{};
  try{
    dispose=installResponsePresentation(root);
    visible.heading.click();await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(visible.collapsed,false);assert.equal(clicks,1,'a native click is not replayed against retained titles or hidden clones');
    const fresh=new NativeFold();root.folds=[fresh];observed([{addedNodes:[fresh.content],removedNodes:[]}]);
    await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(fresh.collapsed,false,'replacement retains the explicit expansion');assert.equal(clicks,2,'restoration runs once despite transition mutations');
  }finally{dispose();(globalThis as any).Element=savedElement;(globalThis as any).MutationObserver=savedObserver;}
});

test('native edit actions follow the header through expansion, wrapping and removal',async()=>{
  const {installResponsePresentation}=await import('../response-presentation');
  const savedObserver=globalThis.MutationObserver,savedResize=globalThis.ResizeObserver;
  let reflow:()=>void=()=>{},mutation:(records:any[])=>void=()=>{},disconnected=false;
  const observed=new Set<Element>(),values=new Map<string,string>(),classes=new Set<string>();
  let containerTop=100,containerHeight=32,headerHeight=20;
  const block:any={clientTop:1,getBoundingClientRect:()=>({top:containerTop,height:containerHeight}),querySelector:(selector:string)=>selector.includes('.callout')?fold:actions};
  const actions:any={offsetParent:block,querySelector:()=>({}),style:{getPropertyValue:(key:string)=>values.get(key)??'',setProperty:(key:string,value:string)=>values.set(key,value),removeProperty:(key:string)=>values.delete(key)},classList:{add:(key:string)=>classes.add(key),remove:(key:string)=>classes.delete(key)}};
  const heading:any={setAttribute:()=>{},getBoundingClientRect:()=>({top:containerTop+7,height:headerHeight})};
  const fold:any={closest:(selector:string)=>selector==='.cm-embed-block'?block:null,querySelector:(selector:string)=>selector.includes('callout-title')?heading:null,classList:{contains:()=>false}};
  const root:any={body:{},documentElement:{},folds:[fold],querySelectorAll:(selector:string)=>selector.startsWith('.callout')?root.folds:[],addEventListener:()=>{},removeEventListener:()=>{}};
  (globalThis as any).MutationObserver=class {constructor(callback:any){mutation=callback;}observe(){}disconnect(){}};
  (globalThis as any).ResizeObserver=class {constructor(callback:any){reflow=callback;}observe(element:Element){observed.add(element);}unobserve(element:Element){observed.delete(element);}disconnect(){disconnected=true;}};
  let dispose=()=>{};
  try{
    dispose=installResponsePresentation(root);
    assert.equal(values.get('--send-to-t3-header-center'),'16px');
    assert.ok(classes.has('send-to-t3-progress-actions'));assert.ok(observed.has(heading));
    // Expansion and scrolling move the container but do not center the icon
    // in the entire history. Wrapping instead changes the header midpoint.
    containerTop=250;containerHeight=240;reflow();await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(values.get('--send-to-t3-header-center'),'16px');
    headerHeight=44;reflow();await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(values.get('--send-to-t3-header-center'),'28px');
    root.folds=[];mutation([{addedNodes:[],removedNodes:[{nodeType:1}]}]);await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(observed.size,0);assert.equal(classes.size,0);assert.equal(values.size,0);
  }finally{dispose();globalThis.MutationObserver=savedObserver;globalThis.ResizeObserver=savedResize;}
  assert.equal(disconnected,true);
});
