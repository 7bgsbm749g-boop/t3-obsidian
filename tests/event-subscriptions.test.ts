import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {EventSubscriptions,eventContent,inEventScope,validateEventCommand,validateEventFilter,validateEventScope,type EventState,type NoteEventSubscriptionCommand as EventSubscriptionCommand,type NoteEventSnapshot,type EventNotification} from '../event-subscriptions';

const target={threadId:'thread',projectId:'project',environmentId:'machine'};
const note=(path='Gym/A.md',content='old',properties:Record<string,unknown>|null={}):NoteEventSnapshot=>({path,content,properties});
const subscription=(extra:Partial<EventSubscriptionCommand>={}):EventSubscriptionCommand=>({version:1,id:randomUUID(),kind:'subscribe',target,scope:{path:'Gym',kind:'folder',recursive:true},filter:{events:['modify']},...extra});
async function harness(initialNotes=[note()],initialState?:EventState){
  let saved=initialState?structuredClone(initialState):undefined,now=1000,busy=false,fail=false,failSave=false,reads=0,saves=0,active=false,delivered:EventNotification[]=[];
  const notes=new Map(initialNotes.map(n=>[n.path,n]));
  const service=new EventSubscriptions({
    load:async()=>saved,save:async state=>{saves++;if(failSave)throw Error('disk full');saved=structuredClone(state);},
    notes:async scope=>{reads++;return [...notes.values()].filter(n=>inEventScope(scope,n.path));},
    validateTarget:async t=>{assert.deepEqual(t,target);},isBusy:async()=>busy,
    prepare:async n=>({commandId:n.id,createdAt:now,target:n.target,events:n.events}),
    deliver:async n=>{if(busy)return 'busy';delivered.push(structuredClone(n));if(fail)throw Error('lost reply');busy=true;return 'delivered';},
    recording:value=>{active=value;},now:()=>now,id:randomUUID,
  });
  await service.initialize();
  return {service,notes,advance:(ms=2000)=>{now+=ms;},setBusy:(value:boolean)=>{busy=value;},setFail:(value:boolean)=>{fail=value;},setSaveFail:(value:boolean)=>{failSave=value;},get saved(){return saved!;},get reads(){return reads;},get saves(){return saves;},get active(){return active;},get delivered(){return delivered;}};
}
async function control(h:Awaited<ReturnType<typeof harness>>,id:string,kind:EventSubscriptionCommand['kind'],extra:Partial<EventSubscriptionCommand>={}){return h.service.command({version:1,id:randomUUID(),kind,subscriptionId:id,...extra});}

test('zero subscriptions do not read notes, record observations, or attempt delivery',async()=>{
  const h=await harness();assert.equal(h.reads,0);assert.equal(h.active,false);
  await h.service.observe('modify','Gym/A.md',note('Gym/A.md','new'));await h.service.tick();
  assert.equal(h.reads,0);assert.equal(h.saves,0);assert.equal(h.delivered.length,0);
});
test('registration starts with a silent baseline and UUID replay is immutable',async()=>{
  const h=await harness(),command=subscription();const first=await h.service.command(command);
  assert.equal(first.monitoring,true);assert.equal(first.subscriptionId,command.id);assert.equal(h.active,true);assert.equal(h.service.snapshot.notifications.length,0);
  const reads=h.reads;assert.deepEqual(await h.service.command(command),first);assert.equal(h.reads,reads);
  await assert.rejects(h.service.command({...command,scope:{path:'Other',kind:'folder',recursive:true}}),/different input/);
});
test('only scoped Markdown changes match, rapid changes debounce into one existing-thread notification',async()=>{
  const h=await harness();await h.service.command(subscription());
  await h.service.observe('modify','Other/A.md',note('Other/A.md','new'));await h.service.observe('modify','Gym/A.md',note('Gym/A.md','old'));
  assert.equal(h.service.snapshot.notifications.length,0);
  await h.service.observe('modify','Gym/A.md',note('Gym/A.md','one'));await h.service.observe('modify','Gym/A.md',note('Gym/A.md','two'));
  assert.equal(h.service.snapshot.notifications.length,1);assert.equal(h.service.snapshot.notifications[0].count,2);
  await h.service.tick();assert.equal(h.delivered.length,0);h.advance();await h.service.tick();assert.equal(h.delivered.length,1);assert.deepEqual(h.delivered[0].target,target);assert.equal(h.saved.notifications[0].status,'delivered');
});
test('a busy originating thread keeps user changes queued until idle',async()=>{
  const h=await harness();await h.service.command(subscription());h.setBusy(true);
  await h.service.observe('modify','Gym/A.md',note('Gym/A.md','one'));h.advance();await h.service.tick();assert.equal(h.delivered.length,0);
  await h.service.observe('modify','Gym/A.md',note('Gym/A.md','two'));h.advance();h.setBusy(false);await h.service.tick();assert.equal(h.delivered.length,1);assert.equal(h.delivered[0].count,2);
});
test('property transition matches a typed value once and preserves rapid transitions',async()=>{
  const h=await harness([note('Gym/A.md','body',{completed:false})]);await h.service.command(subscription({filter:{events:['property'],property:'completed',equals:true}}));
  await h.service.observe('modify','Gym/A.md',note('Gym/A.md','body',{completed:'true'}));assert.equal(h.service.snapshot.notifications.length,0);
  await h.service.observe('modify','Gym/A.md',note('Gym/A.md','body',{completed:true}));await h.service.observe('modify','Gym/A.md',note('Gym/A.md','body',{completed:true}));
  assert.equal(h.service.snapshot.notifications[0].count,1);const event=h.service.snapshot.notifications[0].events[0];assert.equal(event.kind,'property');assert.equal(event.before,'true');assert.equal(event.after,true);
});
test('invalid YAML does not fabricate a property removal or transition',async()=>{
  const h=await harness([note('Gym/A.md','body',{completed:true})]);await h.service.command(subscription({filter:{events:['property'],property:'completed'}}));
  await h.service.observe('modify','Gym/A.md',note('Gym/A.md','invalid',null));await h.service.observe('modify','Gym/A.md',note('Gym/A.md','body',{completed:false}));assert.equal(h.service.snapshot.notifications.length,0);
});
test('pause stops monitoring and cancels pending work; resume silently seeds current notes',async()=>{
  const h=await harness(),command=subscription();await h.service.command(command);await h.service.observe('modify','Gym/A.md',note('Gym/A.md','one'));
  await control(h,command.id,'pause-subscription');assert.equal(h.active,false);assert.equal(h.service.snapshot.notifications[0].status,'cancelled');
  const saves=h.saves;await h.service.observe('modify','Gym/A.md',note('Gym/A.md','two'));assert.equal(h.saves,saves);
  h.notes.set('Gym/A.md',note('Gym/A.md','two'));await control(h,command.id,'resume-subscription');assert.equal(h.active,true);h.advance();await h.service.tick();assert.equal(h.delivered.length,0);
  await control(h,command.id,'cancel-subscription');assert.equal(h.active,false);assert.equal(h.service.snapshot.subscriptions.length,0);
});
test('updating scope cancels old notifications and does not backfill',async()=>{
  const h=await harness([note(),note('Other/A.md','old')]),command=subscription();await h.service.command(command);await h.service.observe('modify','Gym/A.md',note('Gym/A.md','one'));
  await control(h,command.id,'update-subscription',{scope:{path:'Other',kind:'folder',recursive:false}});assert.equal(h.service.snapshot.notifications[0].status,'cancelled');
  await h.service.observe('modify','Gym/A.md',note('Gym/A.md','two'));await h.service.observe('modify','Other/A.md',note('Other/A.md','one'));assert.equal(h.service.snapshot.notifications.filter(n=>n.status==='pending').length,1);
});
test('new notes notify once; existing notes at registration are never creation events',async()=>{
  const h=await harness();await h.service.command(subscription({filter:{events:['create']}}));
  await h.service.observe('create','Gym/A.md',note());await h.service.observe('create','Gym/B.md',note('Gym/B.md','new'));await h.service.observe('create','Gym/B.md',note('Gym/B.md','new'));assert.equal(h.service.snapshot.notifications.length,1);
});
test('explicit note subscriptions follow renames and then detect modifications and deletion',async()=>{
  const h=await harness();await h.service.command(subscription({scope:{path:'Gym/A.md',kind:'note',recursive:false},filter:{events:['rename','modify','delete']}}));
  await h.service.observe('rename','Gym/B.md',note('Gym/B.md','old'),'Gym/A.md');assert.equal(h.service.snapshot.subscriptions[0].scope.path,'Gym/B.md');
  await h.service.observe('modify','Gym/B.md',note('Gym/B.md','new'));await h.service.observe('delete','Gym/B.md');assert.deepEqual(h.service.snapshot.notifications[0].events.map(e=>e.kind),['rename','modify','delete']);
});
test('watched folders follow a parent rename, including empty folders',async()=>{
  const h=await harness(),command=subscription({scope:{path:'Gym',kind:'folder',recursive:true},filter:{events:['rename','modify']}});await h.service.command(command);
  h.notes.delete('Gym/A.md');h.notes.set('Archive/Gym/A.md',note('Archive/Gym/A.md','old'));
  await h.service.renameFolder('Gym','Archive/Gym',[note('Archive/Gym/A.md','old')]);assert.equal(h.service.snapshot.subscriptions[0].scope.path,'Archive/Gym');
  await h.service.observe('modify','Archive/Gym/A.md',note('Archive/Gym/A.md','new'));assert.equal(h.service.snapshot.notifications[0].count,2);
  const empty=subscription({scope:{path:'Empty',kind:'folder',recursive:true}});await h.service.command(empty);await h.service.renameFolder('Empty','Moved',[]);assert.equal(h.service.snapshot.subscriptions.find(s=>s.id===empty.id)?.scope.path,'Moved');
});
test('folder deletion emits bounded note deletion notifications',async()=>{
  const h=await harness([note(),note('Gym/B.md')]);await h.service.command(subscription({filter:{events:['delete']}}));await h.service.deleteFolder('Gym');assert.equal(h.service.snapshot.notifications.length,2);
});
test('active and completed streamed response blocks never trigger events',async()=>{
  const h=await harness();await h.service.command(subscription());
  await h.service.observe('modify','Gym/A.md',note('Gym/A.md','old\n\n<!-- t3-inline:start:id -->\nreply\n<!-- t3-inline:end:id -->\n'));
  await h.service.observe('modify','Gym/A.md',note('Gym/A.md','old\n\n<!-- t3-response:start:id -->\nfinished\n<!-- t3-response:end:id -->\n'));
  assert.equal(h.service.snapshot.notifications.length,0);assert.equal(eventContent('A\n<!-- t3-inline:start:a -->body<!-- t3-inline:end:a -->\nB'),'A\n\nB');
});
test('notification turns suppress their own edits and rebaseline when idle',async()=>{
  const h=await harness();await h.service.command(subscription());await h.service.observe('modify','Gym/A.md',note('Gym/A.md','user'));h.advance();await h.service.tick();
  await h.service.observe('modify','Gym/A.md',note('Gym/A.md','agent'));assert.equal(h.service.snapshot.notifications.length,1);
  h.notes.set('Gym/A.md',note('Gym/A.md','agent'));h.setBusy(false);await h.service.tick();
  await h.service.observe('modify','Gym/A.md',note('Gym/A.md','next user'));assert.equal(h.service.snapshot.notifications.length,2);
});
test('prepared notification retries identical bytes and IDs after a lost reply and host restart',async()=>{
  const h=await harness();await h.service.command(subscription());await h.service.observe('modify','Gym/A.md',note('Gym/A.md','user'));h.advance();h.setFail(true);await h.service.tick();
  const first=h.delivered[0];assert.equal(h.saved.notifications[0].status,'prepared');assert.match(h.saved.notifications[0].error!,/lost reply/);
  const restarted=await harness([note('Gym/A.md','offline change')],h.saved);restarted.advance(10000);await restarted.service.tick();assert.equal(restarted.delivered.length,1);assert.equal(restarted.delivered[0].id,first.id);assert.deepEqual(restarted.delivered[0].command,first.command);assert.equal(restarted.service.snapshot.notifications.length,1);
});
test('storage failure rolls back registration and captured baselines',async()=>{
  const h=await harness(),command=subscription();h.setSaveFail(true);await assert.rejects(h.service.command(command),/disk full/);assert.equal(h.active,false);
  h.setSaveFail(false);await h.service.command(command);h.setSaveFail(true);await assert.rejects(h.service.observe('modify','Gym/A.md',note('Gym/A.md','one')),/disk full/);assert.equal(h.service.snapshot.notifications.length,0);
  h.setSaveFail(false);await h.service.observe('modify','Gym/A.md',note('Gym/A.md','one'));assert.equal(h.service.snapshot.notifications.length,1);
});
test('registration validates exact machine/project/thread and stopping disables all recording',async()=>{
  const h=await harness();await assert.rejects(h.service.command(subscription({target:{...target,projectId:'wrong'}})));assert.equal(h.active,false);
  await h.service.command(subscription());h.service.stop();assert.equal(h.active,false);assert.equal(h.service.interested('Gym/A.md'),false);await assert.rejects(h.service.command(subscription()),/stopped/);
});
test('scope and filter validation excludes hidden paths, traversal, logs, and ambiguous filters',()=>{
  for(const path of ['../Gym','/home/notes','.obsidian','Gym/..','Gym\\nested','Gym/'])assert.throws(()=>validateEventScope({path,kind:'folder',recursive:true}));
  assert.throws(()=>validateEventScope({path:'T3 Code Logs',kind:'folder',recursive:true}));
  assert.throws(()=>validateEventFilter({events:['property']}));assert.throws(()=>validateEventFilter({events:['modify'],equals:true}));assert.throws(()=>validateEventFilter({events:['modify','property'],property:'done'}));
  assert.equal(inEventScope({path:'/',kind:'folder',recursive:false},'A.md'),true);assert.equal(inEventScope({path:'/',kind:'folder',recursive:false},'Gym/A.md'),false);
  assert.equal(inEventScope({path:'Gym',kind:'folder',recursive:true},'Gymnasium/A.md'),false);assert.equal(inEventScope({path:'/',kind:'folder',recursive:true},'T3 Code Logs/A.md'),false);
  assert.throws(()=>validateEventCommand({version:1,id:randomUUID(),kind:'pause-subscription',subscriptionId:randomUUID(),target}));
});
