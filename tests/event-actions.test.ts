import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {prepareEventAction,executeEventAction,validateEventAction,type ActionIO,type EventAction,type ActionPlan} from '../event-actions';
import {EventSubscriptions,eventContent,type EventState,type NoteEventSnapshot,type NoteEventSubscriptionCommand} from '../event-subscriptions';

function ioHarness(entries:Array<[string,string]>=[['Jobs/A.md','body']]){
  const files=new Map(entries);let writes=0,moves=0;
  const io:ActionIO={read:async p=>files.get(p),parse:JSON.parse,stringify:JSON.stringify,
    write:async(p,expected,content)=>{assert.equal(files.get(p),expected);files.set(p,content);writes++;},
    move:async(p,d,expected)=>{assert.equal(files.get(p),expected);assert.equal(files.has(d),false);files.delete(p);files.set(d,expected);moves++;}};
  return {io,files,get writes(){return writes;},get moves(){return moves;}};
}
const actionCommand=(action:EventAction):NoteEventSubscriptionCommand=>({version:1,id:randomUUID(),kind:'subscribe',action,scope:{path:'Jobs',kind:'folder',recursive:true},filter:{events:['modify']}});
function snapshot(path:string,content:string):NoteEventSnapshot{
  const front=/^---\n([\s\S]*?)\n---\n/.exec(content);return {path,content,properties:front?JSON.parse(front[1]):{}};
}
async function serviceHarness(h:ReturnType<typeof ioHarness>,initial?:EventState){
  let saved=initial,now=1000,fail=false,threadCalls=0;
  const service=new EventSubscriptions({load:async()=>saved,save:async s=>{saved=structuredClone(s);},notes:async()=>[...h.files].map(([p,c])=>snapshot(p,c)),
    validateTarget:async()=>{threadCalls++;throw Error('Thread access must not be used');},isBusy:async()=>{threadCalls++;throw Error('Thread access must not be used');},prepare:async()=>{threadCalls++;throw Error('Thread access must not be used');},deliver:async()=>{threadCalls++;throw Error('Thread access must not be used');},
    prepareAction:n=>prepareEventAction(n.action!,n.events.at(-1)?.kind==='job'?undefined:n.events.at(-1)?.path,h.io),
    deliverAction:async n=>{await executeEventAction(n.command as ActionPlan,h.io);if(fail)throw Error('lost save');},recording:()=>{},now:()=>now,id:randomUUID});
  await service.initialize();return {service,advance:()=>{now+=10000;},fail:(v:boolean)=>{fail=v;},get saved(){return saved!;},get threadCalls(){return threadCalls;}};
}
test('property action preserves the body, writes once, and replays after a lost acknowledgement',async()=>{
  const h=ioHarness(),action:EventAction={kind:'set-property',property:'completed',value:true};
  const plan=await prepareEventAction(action,'Jobs/A.md',h.io);await executeEventAction(plan,h.io);await executeEventAction(plan,h.io);
  assert.equal(h.writes,1);assert.equal(h.files.get('Jobs/A.md'),'---\n{"completed":true}\n---\nbody');
  const noOp=await prepareEventAction(action,'Jobs/A.md',h.io);await executeEventAction(noOp,h.io);assert.equal(h.writes,1);
});
test('move action refuses overwrite and user changes, and recognizes an already completed move',async()=>{
  const h=ioHarness(),action:EventAction={kind:'move-note',folder:'Ready'};
  const plan=await prepareEventAction(action,'Jobs/A.md',h.io);h.files.set('Jobs/A.md','user change');await assert.rejects(executeEventAction(plan,h.io),/changed/);
  h.files.set('Jobs/A.md','body');h.files.set('Ready/A.md','other');await assert.rejects(executeEventAction(plan,h.io),/already exists/);await assert.rejects(prepareEventAction(action,'Jobs/A.md',h.io),/already exists/);
  h.files.delete('Ready/A.md');await executeEventAction(plan,h.io);await executeEventAction(plan,h.io);assert.equal(h.moves,1);assert.equal(h.files.get('Ready/A.md'),'body');assert.equal(h.files.has('Jobs/A.md'),false);
});
test('property action refuses stale preparation and malformed frontmatter',async()=>{
  const h=ioHarness(),plan=await prepareEventAction({kind:'set-property',property:'status',value:'ready'},'Jobs/A.md',h.io);
  h.files.set('Jobs/A.md','unsaved user revision');await assert.rejects(executeEventAction(plan,h.io),/changed/);assert.equal(h.writes,0);
  h.files.set('Jobs/A.md','---\n[]\n---\nbody');await assert.rejects(prepareEventAction({kind:'set-property',property:'status',value:'ready'},'Jobs/A.md',h.io),/invalid frontmatter/);
});
test('action registration, dispatch and restart use no receiving thread and preserve immutable execution',async()=>{
  const h=ioHarness(),s=await serviceHarness(h),command=actionCommand({kind:'set-property',property:'done',value:true});await s.service.command(command);
  h.files.set('Jobs/A.md','edited');await s.service.observe('modify','Jobs/A.md',snapshot('Jobs/A.md','edited'));s.advance();s.fail(true);await s.service.tick();
  assert.equal(h.writes,1);assert.equal(s.saved.notifications[0].status,'prepared');assert.equal(s.threadCalls,0);
  const restarted=await serviceHarness(h,s.saved);restarted.advance();restarted.advance();await restarted.service.tick();assert.equal(h.writes,1);assert.equal(restarted.saved.notifications[0].status,'delivered');assert.equal(restarted.threadCalls,0);
  assert.equal(JSON.stringify(restarted.saved.notifications[0].command).includes('edited'),false);
});
test('action-generated edits suppress feedback across subscriptions while later user edits still trigger',async()=>{
  const h=ioHarness(),s=await serviceHarness(h);await s.service.command(actionCommand({kind:'set-property',property:'done',value:true}));
  await s.service.command(actionCommand({kind:'set-property',property:'done',value:true}));
  h.files.set('Jobs/A.md','edited');await s.service.observe('modify','Jobs/A.md',snapshot('Jobs/A.md','edited'));s.advance();
  await s.service.tick();const output=h.files.get('Jobs/A.md')!;await s.service.observe('modify','Jobs/A.md',snapshot('Jobs/A.md',output));assert.equal(s.saved.notifications.filter(n=>n.status==='pending').length,0);
  h.files.set('Jobs/A.md',output+'\nuser');await s.service.observe('modify','Jobs/A.md',snapshot('Jobs/A.md',output+'\nuser'));assert.equal(s.saved.notifications.filter(n=>n.status==='pending').length,2);
});
test('a move follows note watch paths without retriggering a rename action',async()=>{
  const h=ioHarness(),s=await serviceHarness(h),command={...actionCommand({kind:'move-note',folder:'Ready'}),scope:{path:'Jobs/A.md',kind:'note' as const,recursive:false},filter:{events:['modify','rename'] as ['modify','rename']}};
  await s.service.command(command);h.files.set('Jobs/A.md','edited');await s.service.observe('modify','Jobs/A.md',snapshot('Jobs/A.md','edited'));s.advance();await s.service.tick();
  await s.service.observe('rename','Ready/A.md',snapshot('Ready/A.md','edited'),'Jobs/A.md');assert.equal(s.saved.notifications.length,1);assert.equal(s.saved.subscriptions[0].scope.path,'Ready/A.md');assert.equal(h.moves,1);
});
test('action validation rejects unsafe paths, unknown options, missing values and ambiguous destinations',async()=>{
  for(const folder of ['../Ready','.obsidian','/tmp','T3 Code Logs','Ready/'])assert.throws(()=>validateEventAction({kind:'move-note',folder}));
  for(const action of [{kind:'shell',command:'anything'},{kind:'set-property',property:'__proto__',value:{}},{kind:'set-property',property:'done'},{kind:'move-note',folder:'Ready',notePath:'../A.md'},{kind:'move-note',folder:'Ready',extra:true}])assert.throws(()=>validateEventAction(action));
  const h=ioHarness(),s=await serviceHarness(h);await assert.rejects(s.service.command({...actionCommand({kind:'move-note',folder:'Ready'}),target:{threadId:'x',projectId:'p',environmentId:'e'}}),/either/);
  await assert.rejects(s.service.command({...actionCommand({kind:'move-note',folder:'Ready'}),kind:'subscribe-job',job:{threadId:'x',projectId:'p',environmentId:'e',jobId:'job',requestId:'r',messageId:'m'}}),/notePath/);
  assert.equal(eventContent('body'),'body');
});

test('a reverted property transition skips its action instead of moving a stale ready note',async()=>{
  const h=ioHarness([['Jobs/A.md','---\n{"status":"draft"}\n---\nbody']]);
  await assert.rejects(prepareEventAction({kind:'move-note',folder:'Ready'},'Jobs/A.md',h.io,{property:'status',after:'ready'}),/changed again/);
  assert.equal(h.moves,0);
});
test('job action watches the worker, defaults to completion, and never calls a receiving agent',async()=>{
  const h=ioHarness();let saved:EventState|undefined,now=1000,threadCalls=0;
  const job={threadId:'worker',projectId:'p',environmentId:'e',jobId:'j',requestId:randomUUID(),messageId:'m'};
  let state:any={messages:[{id:'m',role:'user',text:'work',createdAt:'2026-10-04T12:00:00Z'}],activities:[],latestTurn:{turnId:'turn',state:'running',requestedAt:'2026-10-04T12:00:00Z'},session:{status:'running',activeTurnId:'turn'}};
  const service=new EventSubscriptions({load:async()=>saved,save:async s=>{saved=structuredClone(s);},notes:async()=>[],validateTarget:async t=>{assert.deepEqual(t,job);},readThread:async()=>state,isBusy:async()=>{threadCalls++;return false;},prepare:async()=>{threadCalls++;},deliver:async()=>{threadCalls++;return 'delivered';},
    prepareAction:n=>prepareEventAction(n.action!,undefined,h.io),deliverAction:n=>executeEventAction(n.command as ActionPlan,h.io),recording:()=>{},now:()=>now,id:randomUUID});
  await service.initialize();await service.command({version:1,id:randomUUID(),kind:'subscribe-job',job,action:{kind:'set-property',notePath:'Jobs/A.md',property:'status',value:'done'}});await service.tick();assert.equal(saved!.notifications.length,0);
  state={...state,latestTurn:{...state.latestTurn,state:'completed',completedAt:'2026-10-04T12:01:00Z'},session:{status:'ready',activeTurnId:null},messages:[{...state.messages[0],turnId:'turn'},{id:'answer',role:'assistant',text:'done',turnId:'turn',streaming:false}]};
  await service.tick();now+=3000;await service.tick();assert.equal(h.writes,1);assert.equal(threadCalls,0);assert.equal(saved!.notifications[0].status,'delivered');await service.tick();assert.equal(h.writes,1);
});

test('empty frontmatter is supported without duplicating delimiters',async()=>{
  const h=ioHarness([['Jobs/A.md','---\n---\nbody']]);const plan=await prepareEventAction({kind:'set-property',property:'done',value:true},'Jobs/A.md',h.io);await executeEventAction(plan,h.io);
  assert.equal(h.files.get('Jobs/A.md'),'---\n{"done":true}\n---\nbody');
});

test('a Markdown separator later in the body is not treated as frontmatter',async()=>{
  const body='intro\n---\n{"kept":"body"}\n---\nend',h=ioHarness([['Jobs/A.md',body]]);
  const plan=await prepareEventAction({kind:'set-property',property:'done',value:true},'Jobs/A.md',h.io);assert.equal(plan.after,'---\n{"done":true}\n---\n'+body);
});
test('a post-move receipt save failure keeps the plan in memory and flushes without moving again',async()=>{
  const h=ioHarness();let saved:EventState|undefined,now=1000,failedSaves=0;
  const service=new EventSubscriptions({load:async()=>saved,save:async state=>{if(state.notifications.some(n=>n.status==='delivered')&&failedSaves<2){failedSaves++;throw Error('disk unavailable');}saved=structuredClone(state);},
    notes:async()=>[...h.files].map(([p,c])=>snapshot(p,c)),validateTarget:async()=>{throw Error('no thread');},isBusy:async()=>false,prepare:async()=>{},deliver:async()=> 'delivered',
    prepareAction:n=>prepareEventAction(n.action!,n.events.at(-1)?.path,h.io),deliverAction:n=>executeEventAction(n.command as ActionPlan,h.io),recording:()=>{},now:()=>now,id:randomUUID});
  await service.initialize();await service.command(actionCommand({kind:'move-note',folder:'Ready'}));h.files.set('Jobs/A.md','edited');await service.observe('modify','Jobs/A.md',snapshot('Jobs/A.md','edited'));now+=3000;
  await assert.rejects(service.tick(),/disk unavailable/);assert.equal(h.moves,1);assert.equal(service.snapshot.notifications[0].status,'delivered');await service.tick();assert.equal(h.moves,1);assert.equal(saved!.notifications[0].status,'delivered');
});
