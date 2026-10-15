import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {EventSubscriptions,type EventState,type EventSubscriptionCommand,type NoteEventSnapshot} from '../event-subscriptions';
import {applyThreadItem,type InlineThreadState} from '../inline-thread';

const source={threadId:'worker',projectId:'project',environmentId:'machine'};
const origin=randomUUID(),turn='original';
const thread=():InlineThreadState=>({historyComplete:true,messages:[{id:origin,role:'user',text:'work',turnId:turn,streaming:false},{id:'assistant',role:'assistant',text:'progress',turnId:turn,streaming:true}],activities:[],turns:{[turn]:{turnId:turn,state:'running'}},latestTurn:{turnId:turn,state:'running'},session:{status:'running',activeTurnId:turn}});
const stream=(path='A.md'):EventSubscriptionCommand=>({version:1,id:randomUUID(),kind:'stream-thread',source,scope:'thread',destinations:[path]});
const inspect:EventSubscriptionCommand={version:1,id:randomUUID(),kind:'thread-streams'};
const note=(content='before'):NoteEventSnapshot=>({path:'A.md',content,properties:{}});
function historicalState():EventState {
  const body='retained history '.repeat(5000);
  return {version:1,subscriptions:[],notifications:[],commands:{},feedback:[],threads:Object.fromEntries(Array.from({length:22},(_,i)=>['historical-'+i,{state:{historyComplete:true,messages:[{id:'old-'+i,role:'assistant',turnId:null,text:body,streaming:false}],activities:[]}}]))};
}
async function harness(initial=historicalState()){
  let saved:EventState=JSON.parse(JSON.stringify(initial)),remote=thread(),reads=0,saves=0,attachments=0,bindingReads=0,failSave=false,failRead=false,failBindings=false,failAttach=false;
  const missing=new Set<string>();
  const monitors=new Map<string,{item:(value:any)=>void;cursor:()=>number|undefined}>();
  const service=new EventSubscriptions({load:async()=>saved,save:async state=>{saves++;if(failSave)throw Error('disk unavailable');saved=JSON.parse(JSON.stringify(state));},
    notes:async()=>[note()],validateTarget:async()=>{},isBusy:async()=>true,prepare:async()=>({}),deliver:async()=> 'busy',recording:()=>{},now:()=>1000,id:randomUUID,
    readThread:async()=>{reads++;if(failRead)throw Error('offline');const state=applyThreadItem({messages:[],activities:[]},{kind:'snapshot',snapshot:{thread:structuredClone(remote)}}).state;return {...state,...(remote.sequence!==undefined?{sequence:remote.sequence}:{})};},
    watchThread:(target,item,cursor)=>{monitors.set(target.threadId,{item,cursor});return {stop(){monitors.delete(target.threadId);}};},
    displayHost:{validateDestination:async path=>{if(missing.has(path))throw Error('Destination note unavailable: '+path);},responseBindings:async()=>{bindingReads++;if(failBindings)throw Error('disk unavailable');return [];},prepareDisplay:async()=>{throw Error('unexpected new reply');},attachDisplay:async()=>{if(failAttach)throw Error('transport offline');attachments++;}},
  });await service.initialize();
  return {service,monitors,setRemote:(state:InlineThreadState)=>{remote=state;},missing:(path:string,value:boolean)=>{if(value)missing.add(path);else missing.delete(path);},failAttach:(value:boolean)=>{failAttach=value;},failSave:(value:boolean)=>{failSave=value;},failRead:(value:boolean)=>{failRead=value;},failBindings:(value:boolean)=>{failBindings=value;},get attachments(){return attachments;},get saves(){return saves;},get reads(){return reads;},get bindingReads(){return bindingReads;},get saved(){return saved;}};
}

function pendingDisplay(paths=['A.md']):EventState {
  const initial=historicalState(),destinations=paths.map(path=>({id:randomUUID(),path}));
  initial.displays=[{...source,id:randomUUID(),scope:'thread',enabled:true,createdAt:'2026-10-11T00:00:00Z',boundary:[],destinations,bindings:destinations.map(destination=>({messageId:origin,turnId:turn,destinationId:destination.id,status:'planned',request:{id:randomUUID()} as any}))}];
  return initial;
}

test('response-only note changes skip persistence; a failed real change restores baseline and full history',async()=>{
  const h=await harness();await h.service.command({version:1,id:randomUUID(),kind:'subscribe',target:source,scope:{path:'A.md',kind:'note',recursive:false},filter:{events:['modify']}});
  const before=h.saved,saves=h.saves;
  for(let i=0;i<10;i++)await h.service.observe('modify','A.md',note('before\n<!-- t3-response:start:owned -->\nprogress '+i+'\n<!-- t3-response:end:owned -->\n'));
  assert.equal(h.saves,saves);h.failSave(true);await assert.rejects(h.service.observe('modify','A.md',note('user change')),/disk unavailable/);
  assert.deepEqual(h.service.snapshot,before);h.failSave(false);await h.service.observe('modify','A.md',note('user change'));
  assert.equal(h.saved.notifications.length,1);assert.deepEqual(h.saved.threads,before.threads);h.service.stop();
});

test('cursor and reduced history roll back together on failed save, then replay exactly once after restart',async()=>{
  const h=await harness();await h.service.command(stream());await h.service.command(inspect);
  const monitor=h.monitors.get(source.threadId)!,before=h.saved;
  const event={kind:'event',event:{sequence:41,type:'thread.message-sent',payload:{messageId:'assistant',role:'assistant',turnId:turn,text:' delta',streaming:true}}};
  h.failSave(true);monitor.item(event);await h.service.command(inspect);
  assert.equal(monitor.cursor(),undefined);assert.deepEqual(h.service.snapshot,before);
  h.failSave(false);monitor.item(event);await h.service.command(inspect);assert.equal(monitor.cursor(),41);
  const key=JSON.stringify([source.environmentId,source.projectId,source.threadId]);
  assert.equal(h.saved.threads![key].state.messages.at(-1)!.text,'progress delta');
  const restarted=await harness(h.saved);h.service.stop();const recovered=restarted.monitors.get(source.threadId)!;
  const saves=restarted.saves;recovered.item(event);await restarted.service.command(inspect);
  assert.equal(restarted.saves,saves);assert.equal(recovered.cursor(),41);assert.equal(restarted.service.snapshot.threads![key].state.messages.at(-1)!.text,'progress delta');restarted.service.stop();
});

test('unchanged observation errors skip writes and recovery clears the durable error',async()=>{
  const h=await harness();await h.service.command(stream());h.failRead(true);await h.service.tick();
  assert.equal(h.saved.displays![0].error,'offline');const saves=h.saves;
  for(let i=0;i<5;i++)await h.service.tick();assert.equal(h.saves,saves);
  h.failRead(false);await h.service.tick();assert.equal(h.saved.displays![0].error,undefined);assert.equal(h.saves,saves+1);h.service.stop();
});

test('changed canonical history and old turn records persist without requiring a stream event',async()=>{
  const h=await harness();await h.service.command(stream());
  const remote=thread();remote.messages[1]={...remote.messages[1],text:'recovered final',streaming:false};remote.turns![turn]={turnId:turn,state:'completed'};remote.latestTurn=remote.turns![turn];remote.session={status:'ready',activeTurnId:null};
  h.setRemote(remote);const saves=h.saves;await h.service.tick();assert.equal(h.saves,saves+1);
  const key=JSON.stringify([source.environmentId,source.projectId,source.threadId]);assert.equal(h.saved.threads![key].state.messages[1].text,'recovered final');assert.equal(h.saved.threads![key].state.turns![turn].state,'completed');
  remote.turns={};remote.latestTurn=undefined;h.setRemote(remote);await h.service.tick();assert.equal(h.saved.threads![key].state.turns![turn].state,'completed');h.service.stop();
});

test('canonical polls retain the event watermark and do not rewrite an unchanged streamed snapshot',async()=>{
  const h=await harness();await h.service.command(stream());await h.service.command(inspect);
  h.monitors.get(source.threadId)!.item({kind:'snapshot',snapshot:{snapshotSequence:41,thread:thread()}});await h.service.command(inspect);
  const saves=h.saves;await h.service.tick();assert.equal(h.saves,saves);
  const key=JSON.stringify([source.environmentId,source.projectId,source.threadId]);assert.equal(h.service.snapshot.threads![key].state.sequence,41);h.service.stop();
});

test('a canonical watermark-only advance skips persistence, and restart replays from the last durable cursor',async()=>{
  const h=await harness();await h.service.command(stream());await h.service.command(inspect);
  h.monitors.get(source.threadId)!.item({kind:'snapshot',snapshot:{snapshotSequence:41,thread:thread()}});await h.service.command(inspect);
  h.setRemote({...thread(),sequence:45});const saves=h.saves;await h.service.tick();assert.equal(h.saves,saves);
  const key=JSON.stringify([source.environmentId,source.projectId,source.threadId]);assert.equal(h.service.snapshot.threads![key].state.sequence,45);assert.equal(h.saved.threads![key].state.sequence,41);
  const restarted=await harness(h.saved);assert.equal(restarted.monitors.get(source.threadId)!.cursor(),41);h.service.stop();restarted.service.stop();
});

test('a changed full snapshot fences late text deltas through restart and ignores stale canonical reads',async()=>{
  const h=await harness();await h.service.command(stream());await h.service.command(inspect);
  h.monitors.get(source.threadId)!.item({kind:'snapshot',snapshot:{snapshotSequence:41,thread:thread()}});await h.service.command(inspect);
  const remote={...thread(),sequence:45};remote.messages[1]={...remote.messages[1],text:'progress delta'};h.setRemote(remote);await h.service.tick();
  const restarted=await harness(h.saved);h.service.stop();restarted.monitors.get(source.threadId)!.item({kind:'event',event:{sequence:42,type:'thread.message-sent',payload:{messageId:'assistant',role:'assistant',turnId:turn,text:' delta',streaming:true}}});await restarted.service.command(inspect);
  const key=JSON.stringify([source.environmentId,source.projectId,source.threadId]);assert.equal(restarted.service.snapshot.threads![key].state.messages[1].text,'progress delta');
  restarted.setRemote({...thread(),sequence:40});const saves=restarted.saves;await restarted.service.tick();assert.equal(restarted.saves,saves);assert.equal(restarted.service.snapshot.threads![key].state.messages[1].text,'progress delta');restarted.service.stop();
});
