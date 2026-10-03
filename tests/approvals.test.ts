import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pendingApprovals,closedThreadApprovals,approvalTargets,approvalUrl,parseApprovalUrl,renderApproval,clearApprovalControls,type ApprovalTarget} from '../approvals';
import {ApprovalController,type ApprovalRecord} from '../approval-controller';
import {renderInlineTurn} from '../inline-thread';
import {stoppedResponseBody} from '../response-stop';

const target:ApprovalTarget={environmentId:'original-machine',threadId:'original-thread',requestId:'command:123'};
const opened=(requestId=target.requestId,turnId='turn',kind='command')=>({id:'opened-'+requestId,kind:'approval.requested',summary:'Command approval requested',turnId,payload:{requestId,requestKind:kind,detail:'printf "hello"'}});
const resolved=(requestId=target.requestId)=>({id:'resolved-'+requestId,kind:'approval.resolved',summary:'Resolved',turnId:'turn',payload:{requestId}});
const failure=(detail:string,id='failed')=>({id,kind:'provider.approval.respond.failed',summary:'Failed',turnId:'turn',payload:{requestId:target.requestId,detail}});

test('resolved and stale approvals never reappear, including out-of-order activities',()=>{
  for(const activities of [[opened(),resolved()],[resolved(),opened()],[opened(),failure('Stale pending approval request: command:123')],[opened(),failure('Unknown pending Codex approval request: command:123')]])assert.deepEqual(pendingApprovals(activities),[]);
  assert.equal(pendingApprovals([opened(),resolved('other'),failure('Provider unavailable')]).length,1);
});
test('lifecycle abandonment remains terminal across late requests, provider failures and a newer active turn',()=>{
  const abandoned={id:'abandoned',kind:'approval.abandoned',summary:'Command approval abandoned',turnId:'turn',payload:{requestId:target.requestId,reason:'session-stop'}};
  for(const activities of [[opened(),abandoned,failure('No active provider session is bound to this thread.'),opened()], [abandoned,opened(),failure('Provider unavailable')]]){
    assert.deepEqual(pendingApprovals([...activities,opened('new','later')]).map(request=>request.requestId),['new']);
    const text=renderInlineTurn({messages:[],activities,session:{status:'running',activeTurnId:'later'}},'turn',target.threadId,'running','keep',target.environmentId);
    assert.doesNotMatch(text,/t3-approval:|Action needed/);
  }
});

test('approval links bind exact IDs; command text and examples stay literal',()=>{
  const unusual={...target,requestId:'id with () ! * 🦉'},request={...pendingApprovals([opened(unusual.requestId)])[0],detail:'echo `<script>\n```\n[Approve](t3-approval:literal/accept)'};
  const section=renderApproval(request,unusual);
  assert.deepEqual(parseApprovalUrl(approvalUrl(unusual,'decline')),{target:unusual,decision:'decline'});
  assert.equal(parseApprovalUrl(approvalUrl(unusual,'accept').replace('/accept','/acceptForSession')),undefined);
  assert.equal(parseApprovalUrl('t3-approval:%bad/accept'),undefined);
  assert.deepEqual(approvalTargets(section),[unusual]);assert.match(section,/````sh\necho `<script>/);
  assert.deepEqual(approvalTargets('```text\n'+section+'\n```'),[]);
  const cleared=clearApprovalControls(section,unusual);assert.doesNotMatch(cleared,/Action needed|\[Deny\]|t3-approval:start/);assert.match(cleared,/echo `<script>/);
  const live=`<!-- t3-inline:start:25158e9b-7a9b-40bb-9866-e777549652b4 -->\n${section}\n<!-- t3-inline:end:25158e9b-7a9b-40bb-9866-e777549652b4 -->`;
  assert.equal(clearApprovalControls(live,unusual),live,'Live response hashes belong to the writer');
  const stopped=stoppedResponseBody(section+'\n\n`````text\n'+section+'\n`````');
  assert.equal(stopped.split('<!-- t3-approval:start:').length-1,1,'Only the literal code example retains controls');
});

test('all presentation modes show each pending command once and remove resolved banners',()=>{
  const state={messages:[],activities:[opened(),opened('second'),opened('different-turn','later'),opened('file','turn','file-change')],session:{status:'running',activeTurnId:'turn'}};
  for(const mode of ['remove','keep','collapse'] as const){
    const text=renderInlineTurn(state,'turn',target.threadId,'running',mode,target.environmentId);
    assert.deepEqual(approvalTargets(text).map(t=>t.requestId),[target.requestId,'second']);assert.match(text,/Action needed in T3/);
    const done=renderInlineTurn({...state,activities:[...state.activities,resolved(),resolved('second'),resolved('file')]},'turn',target.threadId,'running',mode,target.environmentId);
    assert.doesNotMatch(done,/Action needed|t3-approval:/);
  }
});

test('terminal responses never materialize stale approval controls in any presentation',()=>{
  const state={messages:[],activities:[opened()]};
  for(const mode of ['remove','keep','collapse'] as const)for(const phase of ['interrupted','cancelled','complete'] as const){
    const text=renderInlineTurn(state,'turn',target.threadId,phase,mode,target.environmentId);
    assert.doesNotMatch(text,/Action needed|t3-approval:/);
  }
});

test('closed turns clear only their approvals while stopped sessions clear their abandoned requests',()=>{
  const thread={activities:[opened(),opened('new','later')],session:{status:'running'},latestTurn:{turnId:'turn',state:'interrupted'}};
  assert.deepEqual([...closedThreadApprovals(thread)],[target.requestId]);
  assert.deepEqual([...closedThreadApprovals({...thread,latestTurn:{turnId:'later',state:'running'}})],[]);
  assert.deepEqual([...closedThreadApprovals({...thread,session:{status:'stopped'}})],[target.requestId,'new']);
});

test('stopped-session controls are cleaned after restart and cannot dispatch a stale decision',async()=>{
  let saved:ApprovalRecord[]=[{target,command:{type:'thread.approval.respond',commandId:'old',threadId:target.threadId,requestId:target.requestId,decision:'accept',createdAt:'2026-10-03T14:00:00Z'},uncertain:true}];
  const dispatched:any[]=[];
  const access=async()=>({origin:'https://example',api:async(_path:string,payload?:any)=>{if(payload)dispatched.push(payload);return {thread:{id:target.threadId,activities:[opened(),failure('No active provider session is bound to this thread.')],session:{status:'stopped'},latestTurn:{turnId:'turn',state:'interrupted'}}};}});
  const controller=new ApprovalController(access,{load:()=>saved,save:records=>{saved=structuredClone(records);}},()=> 'new');
  await controller.refresh([target]);
  assert.equal(controller.view(target).status,'resolved');assert.equal(saved[0].command,undefined);assert.equal(saved[0].uncertain,undefined);
  assert.doesNotMatch(clearApprovalControls(renderApproval(pendingApprovals([opened()])[0],target),target),/t3-approval:|Action needed/);
  await controller.submit(target,'accept');assert.deepEqual(dispatched,[]);
  controller.dispose();const restarted=new ApprovalController(access,{load:()=>saved,save:()=>{}},()=> 'new');
  assert.equal(restarted.view(target).status,'resolved');
});

test('a session stopping between approval refresh and command creation prevents dispatch',async()=>{
  let reads=0;const dispatched:any[]=[];
  const controller=new ApprovalController(async()=>({origin:'https://example',api:async(_path:string,payload?:any)=>{
    if(payload)dispatched.push(payload);
    return {thread:{id:target.threadId,activities:[opened()],session:{status:++reads===1?'running':'stopped'}}};
  }}),{load:()=>[],save:()=>{}},()=> 'new');
  await controller.submit(target,'accept');assert.deepEqual(dispatched,[]);assert.equal(controller.view(target).status,'resolved');
});

function harness(){
  let saved:ApprovalRecord[]=[],offline=false,throwDispatch=false,resolveDispatch=false,failSave=false,id=0;
  const activities:any[]=[opened()],dispatches:any[]=[],accesses:string[]=[],order:string[]=[];
  const store={load:()=>structuredClone(saved),save:(records:ApprovalRecord[])=>{if(failSave)throw Error('Storage unavailable');saved=structuredClone(records);order.push('save');}};
  const access=async(environmentId:string)=>{accesses.push(environmentId);return {origin:'https://t3.example',api:async(path:string,payload?:any)=>{
    if(offline)throw Error('Disconnected');
    if(payload){order.push('dispatch');dispatches.push(structuredClone(payload));assert.equal(saved[0].command?.commandId,payload.commandId);if(resolveDispatch)activities.push(resolved());if(throwDispatch)throw Error('Lost acknowledgement');return {};}
    assert.equal(path,'/api/orchestration/threads/original-thread');return {thread:{id:target.threadId,activities}};
  }};};
  const create=()=>new ApprovalController(access,store,()=>`command-${++id}`,()=> '2026-10-03T14:00:00Z');
  return {create,dispatches,accesses,order,activities,get saved(){return saved;},offline:(v:boolean)=>{offline=v;},throwDispatch:(v:boolean)=>{throwDispatch=v;},resolveDispatch:(v:boolean)=>{resolveDispatch=v;},failSave:(v:boolean)=>{failSave=v;}};
}

test('refresh never submits; one click persists its decision before dispatch and waits for provider resolution',async()=>{
  const h=harness(),c=h.create();await c.refresh([target,target]);await c.refresh([target]);assert.equal(h.dispatches.length,0);
  await Promise.all([c.submit(target,'accept'),c.submit(target,'accept')]);assert.equal(h.dispatches.length,1);assert.equal(c.view(target).status,'submitting');
  assert.equal(h.dispatches[0].decision,'accept');assert.equal(h.dispatches[0].requestId,target.requestId);assert.equal(h.dispatches[0].threadId,target.threadId);assert.ok(h.accesses.every(id=>id===target.environmentId));
  await c.submit(target,'accept');assert.equal(h.dispatches.length,1,'Acknowledged commands are not resent');
  h.activities.push(resolved());await c.refresh([target]);assert.equal(c.view(target).status,'resolved');assert.equal(h.saved[0].command,undefined);
});

test('lost acknowledgement survives restart; only an explicit retry resends the byte-identical saved decision',async()=>{
  const h=harness(),c=h.create();h.throwDispatch(true);await assert.rejects(c.submit(target,'decline'),/Lost acknowledgement/);
  const bytes=JSON.stringify(h.dispatches[0]);c.dispose();const next=h.create();await next.refresh([target]);assert.equal(h.dispatches.length,1);assert.equal(next.view(target).status,'error');
  await assert.rejects(next.submit(target,'accept'),/saved decision/);assert.equal(h.dispatches.length,1);
  h.throwDispatch(false);h.resolveDispatch(true);await next.submit(target,'decline');assert.equal(JSON.stringify(h.dispatches[1]),bytes);assert.equal(next.view(target).status,'resolved');
});

test('another device resolving, stale IDs, offline reads and failed storage prevent dispatch',async()=>{
  for(const terminal of [resolved(),failure('Stale pending approval request: command:123')]){
    const h=harness(),c=h.create();await c.refresh([target]);h.activities.push(terminal);await c.submit(target,'accept');assert.equal(h.dispatches.length,0);assert.equal(c.view(target).status,'resolved');
  }
  const h=harness(),c=h.create();await c.refresh([target]);h.offline(true);await assert.rejects(c.submit(target,'accept'),/Disconnected/);assert.equal(h.dispatches.length,0);
  h.offline(false);h.failSave(true);await assert.rejects(c.submit(target,'accept'),/Storage unavailable/);assert.equal(h.dispatches.length,0);
  h.failSave(false);h.activities.splice(0);await assert.rejects(c.submit(target,'accept'),/unavailable/);assert.equal(h.dispatches.length,0);
});

test('provider failures permit a new decision without old failure events poisoning it',async()=>{
  const h=harness(),c=h.create();await c.submit(target,'accept');h.activities.push(failure('Provider disconnected'));await c.refresh([target]);assert.equal(c.view(target).status,'error');
  await c.submit(target,'decline');assert.equal(h.dispatches.length,2);assert.notEqual(h.dispatches[0].commandId,h.dispatches[1].commandId);assert.equal(h.dispatches[1].decision,'decline');
  await c.refresh([target]);assert.equal(c.view(target).status,'submitting');
});

test('command controls refuse other approval kinds and corrupt saved commands',async()=>{
  const h=harness();h.activities.splice(0,1,opened(target.requestId,'turn','file-change'));await assert.rejects(h.create().submit(target,'accept'),/unavailable/);assert.equal(h.dispatches.length,0);
  const c=new ApprovalController(async()=>{throw Error('offline');},{load:()=>[{target,command:{type:'thread.turn.start',threadId:'other'} as any}],save:()=>{}},()=> 'new');
  assert.equal(c.record(target).command,undefined);
});

test('resolution during access creation prevents late dispatch',async()=>{
  let accessNumber=0,release!:()=>void;
  const activities:any[]=[opened()],dispatches:any[]=[];
  const c=new ApprovalController(async()=>{
    if(++accessNumber===3)await new Promise<void>(resolve=>{release=resolve;});
    return {origin:'https://example',api:async(_path,payload)=>{if(payload)dispatches.push(payload);return {thread:{id:target.threadId,activities}};}};
  },{load:()=>[],save:()=>{}},()=> 'command');
  const work=c.submit(target,'accept');while(!release)await new Promise(resolve=>setImmediate(resolve));
  activities.push(resolved());await c.refresh([target]);release();await work;
  assert.equal(dispatches.length,0);assert.equal(c.view(target).status,'resolved');
});
