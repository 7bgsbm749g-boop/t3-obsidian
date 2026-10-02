import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {EventSubscriptions,type EventState,type EventNotification,type EventSubscriptionCommand} from '../event-subscriptions';
import {jobEvents,type JobWatch,type JobObservation} from '../job-lifecycle';
import {validateDisplayCommand,type ThreadDisplay} from '../thread-display';
import {commandId} from '../direct';
import {initialRegion,type InlineThreadState} from '../inline-thread';
import type {HostedInlineRequest} from '../hosted-inline';

const worker={threadId:'worker',projectId:'project',environmentId:'machine'},target={...worker,threadId:'orchestrator'};
const job:JobWatch={...worker,jobId:'task-1',requestId:randomUUID(),messageId:randomUUID()};
let serial=0;
function run(messageId=job.messageId,turnId='original',status='completed'):InlineThreadState {
  const at=new Date(Date.parse('2026-10-02T12:00:00.000Z')+serial++*1000).toISOString();
  return {historyComplete:true,messages:[{id:messageId,role:'user',text:'work',turnId:null,streaming:false,createdAt:at},{id:randomUUID(),role:'assistant',text:'answer',turnId,streaming:false,createdAt:at}],activities:[],latestTurn:{turnId,state:status,requestedAt:at,completedAt:at},session:{status:status==='running'?'running':'ready',activeTurnId:status==='running'?turnId:null}};
}
async function harness(initial?:EventState){
  let saved=initial,thread=run(),now=1000,busy=false,fail=false,attachFail=false;
  const delivered:EventNotification[]=[],requests:HostedInlineRequest[]=[],existing:Array<{id:string;path:string;messageIds:string[];turnIds:string[];threadId?:string}>=[],monitors=new Map<string,{item:(value:any)=>void;cursor:()=>number|undefined;stopped:boolean}>();
  const service=new EventSubscriptions({
    load:async()=>saved,save:async state=>{saved=structuredClone(state);},notes:async()=>[],validateTarget:async()=>{},isBusy:async()=>busy,recording:()=>{},now:()=>now,id:randomUUID,
    prepare:async n=>({id:commandId(n.id,'message'),events:n.events}),deliver:async n=>{delivered.push(structuredClone(n));if(fail)throw Error('lost acknowledgement');return 'delivered';},
    readThread:async()=>structuredClone(thread),watchThread:(t,item,cursor)=>{const monitor={item,cursor,stopped:false};monitors.set(t.threadId,monitor);return {stop(){monitor.stopped=true;}};},
    displayHost:{validateDestination:async()=>{},responseBindings:async target=>existing.filter(b=>!b.threadId||b.threadId===target.threadId),
      prepareDisplay:async(display,destination,message)=>{const id=commandId(display.id,message.id+destination.id);return {version:2,initialOwner:randomUUID(),independent:true,id,vaultId:'vault',host:{environmentId:'machine',workspaceRoot:'/vault',directory:'.obsidian/inline'},notePath:destination.path,threadId:display.threadId,messageId:message.id,projectId:display.projectId,threadEnvironmentId:display.environmentId,initialHash:initialRegion(id).bodyHash,createdAt:'2026-10-02T12:00:00Z'};},
      attachDisplay:async(request,path)=>{requests.push({...request,notePath:path});if(attachFail)throw Error('note unavailable');existing.push({threadId:request.threadId,id:request.id,path,messageIds:[request.messageId],turnIds:[]});},
    },
  });await service.initialize();
  return {service,delivered,requests,existing,monitors,setThread:(value:InlineThreadState)=>{thread=value;},advance:()=>{now+=3000;},busy:(value:boolean)=>{busy=value;},fail:(value:boolean)=>{fail=value;},attachFail:(value:boolean)=>{attachFail=value;},get saved(){return saved!;}};
}
const subscribeJob=():EventSubscriptionCommand=>({version:1,id:randomUUID(),kind:'subscribe-job',target,job});
const stream=(source=worker,destinations=['A.md','B.md']):EventSubscriptionCommand=>({version:1,id:randomUUID(),kind:'stream-thread',scope:'thread',source,destinations});
const manage=(kind:EventSubscriptionCommand['kind'],subscriptionId:string,extra={})=>({version:1,id:randomUUID(),kind,subscriptionId,...extra}) as EventSubscriptionCommand;

test('job outcomes use the original turn after newer turns, not latest session error',()=>{
  const original=run(),state={...run(randomUUID(),'newer','error'),turns:{original:original.latestTurn!},messages:[...original.messages,...run(randomUUID(),'newer').messages]};
  const events=jobEvents(job,state,{seen:[]});assert.equal(events.at(-1)?.state,'completed');assert.equal(events.at(-1)?.job.turnId,'original');assert.equal(events.at(-1)?.productDelivery,'unverified');
  assert.equal(jobEvents(job,{...state,turns:{original:{...original.latestTurn!,state:'interrupted'}}},{seen:[]}).at(-1)?.state,'interrupted');
  assert.equal(jobEvents(job,{...state,turns:{original:{...original.latestTurn!,state:'error'}}},{seen:[]}).at(-1)?.state,'failed');
});
test('approval/input identities and resolution are recoverable; unresolved input blocks terminal completion',()=>{
  const state=run(),at='2026-10-02T12:00:00Z';state.activities=[{id:'approval',kind:'approval.requested',summary:'approve',turnId:'original',createdAt:at,payload:{requestId:'approval-1'}},{id:'input',kind:'user-input.requested',summary:'answer',turnId:'original',createdAt:at,payload:{requestId:'question-1'}}];
  let events=jobEvents(job,state,{seen:[]});assert.deepEqual(events.map(e=>[e.state,e.requestId,e.terminal]),[['waiting-approval','approval-1',false],['waiting-input','question-1',false]]);
  state.activities.push({id:'approve-done',kind:'approval.resolved',summary:'approved',turnId:'original',payload:{requestId:'approval-1'}},{id:'input-done',kind:'user-input.resolved',summary:'answered',turnId:'original',payload:{requestId:'question-1'}});
  events=jobEvents(job,state,{seen:events.map(e=>e.id)});assert.deepEqual(events.map(e=>e.state),['running','running','completed']);
});
test('duplicate job observations survive lost delivery acknowledgements and restart, preserving notification bytes',async()=>{
  const h=await harness();await h.service.command(subscribeJob());h.busy(true);await h.service.tick();assert.equal(h.saved.notifications.length,1);await h.service.tick();assert.equal(h.saved.notifications.length,1);
  h.advance();h.busy(false);h.fail(true);await h.service.tick();const command=h.saved.notifications[0].command;
  const restarted=await harness(h.saved);restarted.advance();restarted.advance();await restarted.service.tick();assert.deepEqual(restarted.delivered[0].command,command);assert.equal(restarted.saved.notifications.length,1);
});
test('an execution observation outage remains retryable and never becomes a failed implementation',async()=>{
  const h=await harness();h.setThread({historyComplete:true,messages:[],activities:[],session:{status:'error',activeTurnId:null,lastError:'transport outage'}});await h.service.command(subscribeJob());await h.service.tick();assert.equal(h.saved.notifications.length,0);h.setThread(run());await h.service.tick();assert.equal(h.saved.notifications[0].events[0].kind,'job');
});
test('thread opt-in captures fast, direct and event-triggered responses in many-to-many destinations; restart never reinserts',async()=>{
  const h=await harness(),command=stream();await h.service.command(command);assert.equal(h.requests.length,0);
  const message=randomUUID();h.setThread(run(message,'event-turn'));await h.service.tick();assert.equal(h.requests.length,2);assert.equal(new Set(h.requests.map(r=>r.id)).size,2);
  const restarted=await harness(h.saved);restarted.setThread(run(message,'event-turn'));await restarted.service.tick();assert.equal(restarted.requests.length,0);
  await restarted.service.command(stream({...worker,threadId:'second'},['A.md']));restarted.setThread(run(randomUUID(),'direct-turn'));await restarted.service.tick();assert.equal(restarted.requests.filter(r=>r.notePath==='A.md').length,2);
});
test('missed canonical runs recover beyond recent history and future boundary excludes earlier runs',async()=>{
  const h=await harness();await h.service.command(stream(worker,['A.md']));const runs=Array.from({length:25},(_,i)=>run(randomUUID(),'turn-'+i));
  h.setThread({...runs.at(-1)!,messages:[...run().messages,...runs.flatMap(s=>s.messages)],turns:Object.fromEntries(runs.map(s=>[s.latestTurn!.turnId,s.latestTurn!]))});await h.service.tick();assert.equal(h.requests.length,25);await h.service.tick();assert.equal(h.requests.length,25);
});
test('steering, explicit continuation and late question answers already attached to a response are not duplicated',async()=>{
  const h=await harness();await h.service.command(stream());
  const ids=[randomUUID(),randomUUID(),`async-answer:${randomUUID()}`];const runs=ids.map((id,i)=>run(id,'follow-'+i));h.setThread({...runs.at(-1)!,messages:runs.flatMap(s=>s.messages),turns:Object.fromEntries(runs.map(s=>[s.latestTurn!.turnId,s.latestTurn!]))});
  for(const path of ['A.md','B.md'])h.existing.push({id:randomUUID(),path,messageIds:ids,turnIds:['original','follow-0','follow-1','follow-2']});await h.service.tick();assert.equal(h.requests.length,0);assert.equal(h.saved.displays![0].bindings.length,6);
});
test('pause/resume skips paused runs; removal/cancellation affects future bindings without stopping T3 or active children',async()=>{
  const h=await harness(),command=stream();await h.service.command(command);h.setThread(run(randomUUID(),'first'));await h.service.tick();assert.equal(h.requests.length,2);
  await h.service.command(manage('pause-thread-stream',command.id));h.setThread(run(randomUUID(),'paused'));await h.service.tick();assert.equal(h.requests.length,2);
  await h.service.command(manage('resume-thread-stream',command.id));await h.service.tick();assert.equal(h.requests.length,2);
  await h.service.command(manage('remove-stream-destination',command.id,{destination:'B.md'}));h.setThread(run(randomUUID(),'next'));await h.service.tick();assert.equal(h.requests.length,3);
  await h.service.command(manage('cancel-thread-stream',command.id));h.setThread(run(randomUUID(),'cancelled'));await h.service.tick();assert.equal(h.requests.length,3);assert.equal(h.saved.displays![0].bindings.filter(b=>b.status==='attached').length,3);assert.equal(h.monitors.get('worker')!.stopped,true);
});
test('failed attachment retries stable binding IDs through renamed notes and restart',async()=>{
  const h=await harness(),command=stream(worker,['A.md']);await h.service.command(command);h.setThread(run(randomUUID(),'new'));h.attachFail(true);await h.service.tick();const id=h.requests[0].id;
  await h.service.observe('rename','Renamed.md',{path:'Renamed.md',content:'keep',properties:{}},'A.md');const restarted=await harness(h.saved);restarted.setThread(run(h.requests[0].messageId,'new'));await restarted.service.tick();assert.equal(restarted.requests[0].id,id);assert.equal(restarted.requests[0].notePath,'Renamed.md');
});
test('durable stream replay cursor never advances before save, ignores duplicate event identities and closes on cancel',async()=>{
  const h=await harness(),command=stream();await h.service.command(command);const monitor=h.monitors.get('worker')!;
  monitor.item({kind:'event',event:{sequence:9,type:'thread.session-set',payload:{session:{status:'running',activeTurnId:'new'}}}});assert.equal(monitor.cursor(),undefined);await h.service.command(manage('thread-streams',command.id));assert.equal(monitor.cursor(),9);
  monitor.item({kind:'event',event:{sequence:9,type:'thread.session-set',payload:{session:{status:'error',activeTurnId:null}}}});await h.service.command(manage('thread-streams',command.id));const state=Object.values(h.saved.threads!)[0].state;assert.equal(state.session?.status,'running');
});
test('registration validates explicit opt-in, exact source and destinations; inspection and replay are read-only',async()=>{
  assert.throws(()=>validateDisplayCommand({...stream(),scope:undefined}),/explicit/);assert.throws(()=>validateDisplayCommand({...stream(),destinations:['../A.md']}),/destination/);
  const h=await harness(),command=stream();const first=await h.service.command(command);assert.deepEqual(await h.service.command(command),first);await assert.rejects(h.service.command({...command,destinations:['Other.md']} as EventSubscriptionCommand),/different input/);assert.equal(h.requests.length,0);
});

 test('lifecycle catch-up never guesses an old completion from prose or an unrelated latest turn',()=>{
  const original=run(),newer=run(randomUUID(),'newer');const state={...newer,messages:[...original.messages,...newer.messages]};assert.equal(jobEvents(job,state,{seen:[]}).length,0);
  assert.throws(()=>jobEvents({...job,turnId:'newer'},state,{seen:[]}),/does not belong/);
  const cancelled={...original,latestTurn:{...original.latestTurn!,state:'cancelled'}};assert.equal(jobEvents(job,cancelled,{seen:[]}).at(-1)?.state,'cancelled');
});

test('a provider start failure identifies the exact message before a turn ID exists and ignores unrelated failures',()=>{
 const state:InlineThreadState={messages:[],activities:[{id:'failed-start',kind:'provider.turn.start.failed',summary:'Provider unavailable',turnId:null,payload:{requestId:job.messageId,detail:'Could not start'},createdAt:'2026-10-02T12:00:00Z'}],historyComplete:true};
 const events=jobEvents(job,state,{seen:[]});assert.equal(events[0].state,'failed');assert.equal(events[0].job.turnId,undefined);assert.equal(events[0].requestId,job.messageId);assert.equal(jobEvents({...job,messageId:randomUUID()},state,{seen:[]}).length,0);assert.equal(jobEvents(job,state,{seen:events.map(e=>e.id)}).length,0);
});
