import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pendingQuestions,questionAnswers,questionTargets,questionToken,parseQuestionToken,renderQuestion,clearResolvedQuestion,removeDismissedQuestions,questionSections,type QuestionTarget} from '../questions';
import {QuestionController,type QuestionRecord} from '../question-controller';
import {applyThreadItem,renderInlineTurn,initialRegion,finalizeRegion} from '../inline-thread';
import {contentHash} from '../completion';
import {markdownCodeCacheStatus} from '../reply-html';
const target:QuestionTarget={environmentId:'original-machine',threadId:'original-thread',requestId:'native:123'};
const questions=[{id:' exact id ',header:'Choice',question:'Which option?',multiSelect:false,options:[{label:' Label ',description:'Description',value:' exact value '},{label:'Second',description:''}]}];
const opened=(requestId=target.requestId,responseMode?:'message')=>({id:'opened-'+requestId,kind:'user-input.requested',summary:'Input needed',turnId:'turn',createdAt:'2026-09-30T00:00:00Z',payload:{requestId,questions,...(responseMode?{responseMode}:{})}});
const resolved=(requestId=target.requestId)=>({id:'resolved-'+requestId,kind:'user-input.resolved',summary:'Answered',turnId:'turn',payload:{requestId,answers:{' exact id ':'answer'}}});
const failure=(detail:string,id='failed')=>({id,kind:'provider.user-input.respond.failed',summary:'Failed',turnId:'turn',payload:{requestId:target.requestId,detail}});

test('terminal request IDs cannot reappear after out-of-order events or reconnects',()=>{
  for(const activities of [[opened(),resolved()],[resolved(),opened()],[opened(),failure('Unknown pending Codex user input request: native:123')]])assert.deepEqual(pendingQuestions(activities),[]);
  const activities=[opened(),resolved('different'),failure('Network unavailable')];assert.equal(pendingQuestions(activities).length,1);
  let state=applyThreadItem({messages:[],activities:[]},{kind:'snapshot',snapshot:{thread:{messages:[],activities}}}).state;
  state=applyThreadItem(state,{kind:'event',event:{sequence:3,type:'thread.activity-appended',payload:{activity:resolved()}}}).state;
  assert.deepEqual(pendingQuestions(state.activities),[]);
  assert.equal(state.activities[0].payload?.questions[0].id,' exact id ');
});

test('single, multiple, and text answers preserve provider keys and values and require every answer',()=>{
  const request=pendingQuestions([opened()])[0];assert.throws(()=>questionAnswers(request,{}),/Answer/);
  assert.deepEqual(questionAnswers(request,{' exact id ':{selected:[' exact value ']}}),{' exact id ':' exact value '});
  const multi={...request,questions:[{...questions[0],multiSelect:true},{id:'text',header:'Text',question:'Details?',multiSelect:false,options:[]}]};
  assert.deepEqual(questionAnswers(multi,{' exact id ':{selected:[' exact value ','Second','Second']},text:{text:'  Details  '}}),{' exact id ':[' exact value ','Second'],text:'Details'});
  assert.throws(()=>questionAnswers(multi,{' exact id ':{selected:['invalid']}}),/Answer/);
  assert.throws(()=>questionAnswers({...request,questions:[{...questions[0],allowCustomAnswer:false}]},{' exact id ':{text:'custom'}}),/Answer/);
  const prototypeRequest={...request,questions:[{...questions[0],id:'__proto__'}]};const answers=questionAnswers(prototypeRequest,Object.fromEntries([['__proto__',{text:'safe'}]]));assert.equal(Object.hasOwn(answers,'__proto__'),true);
});

test('synced targets round trip punctuation and final responses retain async questions without response tracking tags',()=>{
  const unusual={...target,requestId:'id with () ! * emoji 🦉'};assert.deepEqual(parseQuestionToken(questionToken(unusual)),unusual);
  assert.equal(parseQuestionToken('%bad'),undefined);assert.equal(parseQuestionToken(encodeURIComponent('{}')),undefined);
  const request=pendingQuestions([opened(unusual.requestId,'message')])[0],section=renderQuestion(request,unusual);
  assert.deepEqual(questionTargets(section),[unusual]);assert.match(section,/Description/);
  const state={messages:[{id:'final',role:'assistant',turnId:'turn',text:'Done.',streaming:false}],activities:[opened(target.requestId,'message')],latestTurn:{turnId:'turn',state:'completed'}};
  const final=renderInlineTurn(state,'turn',target.threadId,'complete',false,target.environmentId);
  assert.match(final,/Question pending/);assert.match(final,/> Done\./);assert.deepEqual(questionTargets(final),[target]);
  const id='0bf96232-2e70-434a-ae55-5a987387b4b7',initial=initialRegion(id),change=finalizeRegion(initial.text,id,initial.bodyHash,final)!;
  const document=initial.text.slice(0,change.from)+change.text+initial.text.slice(change.to);
  assert.doesNotMatch(document,/t3-inline:/);assert.doesNotMatch(clearResolvedQuestion(document,target),/t3-question:|Question pending/);
  assert.equal(clearResolvedQuestion(`<!-- t3-inline:start:${id} -->\n${section}\n<!-- t3-inline:end:${id} -->`,unusual),`<!-- t3-inline:start:${id} -->\n${section}\n<!-- t3-inline:end:${id} -->`);
});

function harness(){
  let saved:QuestionRecord[]=[],activities:any[]=[opened()],offline=false,throwDispatch=false,resolveDispatch=false,failSave=false,id=0;
  const dispatches:any[]=[],accesses:string[]=[],order:string[]=[];
  const store={load:()=>structuredClone(saved),save:(records:QuestionRecord[])=>{if(failSave)throw Error('Storage unavailable');saved=structuredClone(records);order.push('save');}};
  const access=async(environmentId:string)=>{accesses.push(environmentId);return {origin:'https://t3.example',api:async(path:string,payload?:any)=>{
    if(offline)throw Error('Disconnected');
    if(payload){order.push('dispatch');dispatches.push(structuredClone(payload));assert.equal(saved[0].command?.commandId,payload.commandId);if(resolveDispatch)activities.push(resolved());if(throwDispatch)throw Error('Lost acknowledgement');return {};}
    assert.equal(path,'/api/orchestration/threads/original-thread?controlOnly=true');return {thread:{id:target.threadId,activities}};
  },close:()=>{}};};
  const create=()=>new QuestionController(access,store,()=>`command-${++id}`,()=> '2026-09-30T01:00:00Z');
  return {create,dispatches,accesses,order,activities,get saved(){return saved;},offline:(v:boolean)=>{offline=v;},throwDispatch:(v:boolean)=>{throwDispatch=v;},resolveDispatch:(v:boolean)=>{resolveDispatch=v;},failSave:(v:boolean)=>{failSave=v;}};
}

test('opening and refreshing never submits; write-ahead submission stays pending until resolution',async()=>{
  const h=harness(),controller=h.create();await controller.refresh([target]);controller.draft(target,' exact id ',{selected:[' exact value ']});
  await controller.refresh([target]);assert.equal(h.dispatches.length,0);
  await Promise.all([controller.submit(target),controller.submit(target)]);assert.equal(h.dispatches.length,1);assert.equal(controller.view(target).status,'submitting');
  assert.deepEqual(h.dispatches[0].answers,{' exact id ':' exact value '});assert.equal(h.dispatches[0].threadId,target.threadId);assert.equal(h.dispatches[0].requestId,target.requestId);assert.ok(h.accesses.every(e=>e===target.environmentId));
  h.activities.push(resolved());await controller.refresh([target]);assert.equal(controller.view(target).status,'resolved');assert.deepEqual(h.saved[0].drafts,{});assert.equal(h.saved[0].command,undefined);
});

test('lost acknowledgement survives restart and explicit retry reuses byte-identical command',async()=>{
  const h=harness(),first=h.create();await first.refresh([target]);first.draft(target,' exact id ',{text:'draft'});h.throwDispatch(true);
  await assert.rejects(first.submit(target),/Lost acknowledgement/);assert.equal(first.view(target).status,'error');
  const bytes=JSON.stringify(h.dispatches[0]);first.dispose();const next=h.create();await next.refresh([target]);assert.equal(next.view(target).status,'error');
  assert.equal(next.record(target).drafts[' exact id '].text,'draft');assert.throws(()=>next.draft(target,' exact id ',{text:'different'}),/saved submission/);
  h.throwDispatch(false);h.resolveDispatch(true);await next.submit(target);assert.equal(JSON.stringify(h.dispatches[1]),bytes);assert.equal(next.view(target).status,'resolved');
});

test('refresh before submission prevents another-client answer and storage failures prevent dispatch',async()=>{
  const h=harness(),controller=h.create();await controller.refresh([target]);controller.draft(target,' exact id ',{text:'draft'});h.activities.push(resolved());
  await controller.submit(target);assert.equal(h.dispatches.length,0);assert.equal(controller.view(target).status,'resolved');
  const other=harness(),c=other.create();await c.refresh([target]);c.draft(target,' exact id ',{text:'draft'});other.failSave(true);
  await assert.rejects(c.submit(target),/Storage unavailable/);assert.equal(other.dispatches.length,0);
});

test('a failed provider response retains draft and permits a new command; old failures do not poison retries',async()=>{
  const h=harness(),controller=h.create();await controller.refresh([target]);controller.draft(target,' exact id ',{text:'draft'});await controller.submit(target);
  h.activities.push(failure('Provider disconnected'));await controller.refresh([target]);assert.equal(controller.view(target).status,'error');assert.equal(controller.record(target).drafts[' exact id '].text,'draft');
  await controller.submit(target);assert.equal(h.dispatches.length,2);assert.notEqual(h.dispatches[0].commandId,h.dispatches[1].commandId);
  await controller.refresh([target]);assert.equal(controller.view(target).status,'submitting');
});

test('async requests remain answerable after completion; only message-mode requests can dismiss',async()=>{
  const h=harness();h.activities.splice(0,1,opened(target.requestId,'message'));const controller=h.create();await controller.refresh([target]);await controller.submit(target,true);
  assert.equal(h.dispatches[0].type,'thread.user-input.dismiss');assert.equal('answers' in h.dispatches[0],false);assert.equal(controller.view(target).status,'submitting');
  const blocking=harness(),c=blocking.create();await c.refresh([target]);await assert.rejects(c.submit(target,true),/cannot be dismissed/);assert.equal(blocking.dispatches.length,0);
});

test('failed refresh never submits stale state or clears a question merely absent from a snapshot',async()=>{
  const h=harness(),controller=h.create();await controller.refresh([target]);controller.draft(target,' exact id ',{text:'draft'});h.offline(true);await assert.rejects(controller.submit(target),/Disconnected/);assert.equal(h.dispatches.length,0);
  h.offline(false);h.activities.splice(0);await controller.refresh([target]);assert.equal(controller.view(target).status,'unavailable');
});

test('dismissal is saved and observable before any remote refresh, survives offline reload and safely retries',async()=>{
  const h=harness();h.activities.splice(0,1,opened(target.requestId,'message'));const first=h.create();await first.refresh([target]);h.offline(true);
  const work=first.submit(target,true);
  assert.equal(first.isDismissed(target),true);assert.equal(h.saved[0].dismissed,true);assert.equal(h.saved[0].command?.type,'thread.user-input.dismiss');assert.equal(h.dispatches.length,0);
  await assert.rejects(work,/Disconnected/);const bytes=JSON.stringify(h.saved[0].command);first.dispose();
  const next=h.create();assert.equal(next.isDismissed(target),true);assert.deepEqual(next.pendingDismissals(),[target]);
  h.offline(false);await next.refresh([target]);next.retryDismissals();await next.submit(target,true);assert.equal(JSON.stringify(h.dispatches[0]),bytes);assert.equal(h.dispatches.length,1);
  h.activities.push({...resolved(),payload:{requestId:target.requestId}});await next.refresh([target]);
  assert.equal(next.isDismissed(target),true);assert.deepEqual(next.pendingDismissals(),[]);assert.equal(next.record(target).command,undefined);
  next.dispose();assert.equal(h.create().isDismissed(target),true);
});

test('native questions and failed write-ahead storage never hide a question or dispatch dismissal',async()=>{
  const native=harness(),first=native.create();await first.refresh([target]);await assert.rejects(first.submit(target,true),/cannot be dismissed/);assert.equal(first.isDismissed(target),false);
  const h=harness();h.activities.splice(0,1,opened(target.requestId,'message'));const c=h.create();await c.refresh([target]);h.failSave(true);
  await assert.rejects(c.submit(target,true),/Storage unavailable/);assert.equal(c.isDismissed(target),false);assert.equal(h.dispatches.length,0);
});

test('another-client dismissal is hidden while answered questions retain their transcript',async()=>{
  for(const dismissed of [true,false]){
    const h=harness(),c=h.create();h.activities.push(dismissed?{...resolved(),payload:{requestId:target.requestId}}:resolved());await c.refresh([target]);
    assert.equal(c.isDismissed(target),dismissed);assert.equal(c.view(target).status,'resolved');
  }
});

test('dismissed section cleanup preserves answers, other questions, code examples and live writer hashes',()=>{
  const section=renderQuestion(pendingQuestions([opened(target.requestId,'message')])[0],target),other={...target,requestId:'other'},otherSection=renderQuestion(pendingQuestions([opened('other','message')])[0],other);
  const example='```md\n'+section+'\n```',document='Before\n\n'+section+'\n\n'+otherSection+'\n\nAfter';
  const dismissed=(value:QuestionTarget)=>value.requestId===target.requestId;
  assert.equal(removeDismissedQuestions(document,dismissed),'Before\n\n\n\n'+otherSection+'\n\nAfter');
  assert.equal(removeDismissedQuestions(example,dismissed),example);
  assert.equal(removeDismissedQuestions(section+'\n\n'+example,dismissed),'\n\n'+example);
  const live='<!-- t3-inline:start:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee -->\n'+section+'\n<!-- t3-inline:end:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee -->';
  assert.equal(removeDismissedQuestions(live,dismissed),live);assert.equal(questionSections(live).length,1);
  assert.equal(removeDismissedQuestions(live.replaceAll('t3-inline:','t3-response:'),dismissed),live.replaceAll('t3-inline:','t3-response:'));
  assert.equal(removeDismissedQuestions(section.replace('t3-question:end:','broken:end:'),dismissed),section.replace('t3-question:end:','broken:end:'));
  assert.equal(clearResolvedQuestion(section,target),'');
  assert.equal(clearResolvedQuestion(example,target),example);
});

test('one submission uses two control reads and shows feedback before access begins',async()=>{
  const h=harness(),controller=h.create();await controller.refresh([target]);controller.draft(target,' exact id ',{text:'draft'});
  h.accesses.length=0;
  const work=controller.submit(target);
  assert.equal(controller.view(target).status,'submitting');assert.equal(h.accesses.length,0);
  await work;
  assert.equal(h.accesses.length,3,'one preflight, one dispatch, one confirmation; no duplicate preflight');
  assert.equal(h.dispatches.length,1);assert.equal(controller.view(target).accepted,true);
  assert.deepEqual(controller.watchedTargets(),[target],'an accepted answer stays monitored without saved-note controls');
  h.activities.push(resolved());await controller.refresh(controller.watchedTargets());assert.equal(controller.view(target).status,'resolved');controller.dispose();
});

test('concurrent refreshes share one snapshot, including a target added during the read',async()=>{
  let reads=0,release!:(value:any)=>void,entered!:()=>void;const started=new Promise<void>(resolve=>{entered=resolve;});
  const controller=new QuestionController(async()=>({origin:'test',api:async()=>{reads++;return new Promise(resolve=>{release=resolve;entered();});}}),{load:()=>[],save:()=>{}},()=> 'command');
  const first=controller.refresh([target]);await started;
  const other={...target,requestId:'other'},second=controller.refresh([other]);
  release({thread:{id:target.threadId,activities:[opened(),opened('other')]}});
  await Promise.all([first,second]);assert.equal(reads,1);assert.equal(controller.view(target).status,'pending');assert.equal(controller.view(other).status,'pending');controller.dispose();
});

test('draft writes coalesce while live updates run and flush exact text before close or disposal',async()=>{
  const h=harness(),controller=h.create();await controller.refresh([target]);
  const before=h.order.length;
  for(let index=0;index<20;index++){controller.draft(target,' exact id ',{text:'Draft '+index});controller.observe(target.environmentId,target.threadId,[opened()],index);}
  assert.equal(h.order.length,before,'status updates do not force keystroke saves');
  controller.flushDrafts();assert.equal(h.order.length,before+1);assert.equal(h.saved[0].drafts[' exact id '].text,'Draft 19');
  controller.dispose();assert.equal(h.order.length,before+1);
});

test('tracked display-only questions resolve from live events and stale snapshots cannot restore them',async()=>{
  const h=harness(),controller=h.create(),untrack=controller.track(target);
  controller.observe(target.environmentId,target.threadId,[opened()],10);assert.equal(controller.view(target).status,'pending');
  controller.observe(target.environmentId,target.threadId,[opened(),resolved()],12);assert.equal(controller.view(target).status,'resolved');
  controller.observe(target.environmentId,target.threadId,[opened()],11);assert.equal(controller.view(target).status,'resolved');
  untrack();assert.deepEqual(controller.watchedTargets(),[]);controller.dispose();
});

test('an omitted old control can resolve from its explicit runtime request, but absence is not resolution',async()=>{
  let remote:any={status:'pending'},activities:any[]=[opened()];
  const controller=new QuestionController(async()=>({origin:'test',api:async()=>({thread:{id:target.threadId,activities,v2Requests:{[target.requestId]:remote}}})}),{load:()=>[],save:()=>{}},()=> 'command');
  await controller.refresh([target]);activities=[];await controller.refresh([target]);assert.equal(controller.view(target).status,'pending');
  remote={status:'resolved',answers:{}};await controller.refresh([target]);assert.equal(controller.view(target).status,'resolved');controller.dispose();
});

test('large notes without question markers do not invoke the Markdown code parser after old dismissals',()=>{
  const before=markdownCodeCacheStatus().sourceParses;
  assert.equal(removeDismissedQuestions('ordinary content '.repeat(30000),()=>true).length,510000);
  assert.equal(markdownCodeCacheStatus().sourceParses,before);
});

test('a timed-out read releases the shared slot and cannot apply a late snapshot',async context=>{
  context.mock.timers.enable({apis:['setTimeout']});
  let entered!:()=>void,release!:(value:any)=>void,signal:AbortSignal|undefined,reads=0;
  const started=new Promise<void>(resolve=>{entered=resolve;});
  const controller=new QuestionController(async()=>({origin:'test',api:async(_path,_payload,options)=>{signal=options?.signal;if(++reads===1)return new Promise(resolve=>{release=resolve;entered();});return {thread:{id:target.threadId,activities:[opened()]}};}}),{load:()=>[],save:()=>{}},()=> 'command');
  const first=controller.refresh([target]);await started;context.mock.timers.tick(8000);await first;
  assert.equal(signal?.aborted,true);assert.equal(controller.view(target).status,'error');
  await controller.refresh([target]);assert.equal(reads,2);assert.equal(controller.view(target).status,'pending');
  release({thread:{id:target.threadId,activities:[resolved()]}});await Promise.resolve();assert.equal(controller.view(target).status,'pending');controller.dispose();
});

test('resolution or disposal while acquiring dispatch access prevents a stale mutation',async()=>{
  for(const stop of [false,true]){
    let accesses=0,dispatches=0,entered!:()=>void,release!:(value:any)=>void;const started=new Promise<void>(resolve=>{entered=resolve;});
    const connection={origin:'test',api:async(_path:string,payload?:any)=>{if(payload){dispatches++;return {};}return {thread:{id:target.threadId,activities:[opened()]}};}};
    const controller=new QuestionController(async()=>{if(++accesses===3)return new Promise(resolve=>{release=resolve;entered();});return connection;},{load:()=>[],save:()=>{}},()=> 'command');
    await controller.refresh([target]);controller.draft(target,' exact id ',{text:'Draft'});const submission=controller.submit(target);await started;
    if(stop)controller.dispose();else controller.observe(target.environmentId,target.threadId,[opened(),resolved()],20);
    release(connection);await submission;assert.equal(dispatches,0);controller.dispose();
  }
});
