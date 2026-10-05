import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {EventSubscriptions,type EventState,type EventSubscriptionCommand,type NoteEventSnapshot} from '../event-subscriptions';
import type {InlineThreadState} from '../inline-thread';

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
  let saved:EventState=JSON.parse(JSON.stringify(initial)),remote=thread(),reads=0,saves=0,failSave=false,failRead=false;
  const monitors=new Map<string,{item:(value:any)=>void;cursor:()=>number|undefined}>();
  const service=new EventSubscriptions({load:async()=>saved,save:async state=>{saves++;if(failSave)throw Error('disk unavailable');saved=JSON.parse(JSON.stringify(state));},
    notes:async()=>[note()],validateTarget:async()=>{},isBusy:async()=>true,prepare:async()=>({}),deliver:async()=> 'busy',recording:()=>{},now:()=>1000,id:randomUUID,
    readThread:async()=>{reads++;if(failRead)throw Error('offline');return structuredClone(remote);},
    watchThread:(target,item,cursor)=>{monitors.set(target.threadId,{item,cursor});return {stop(){monitors.delete(target.threadId);}};},
    displayHost:{validateDestination:async()=>{},responseBindings:async()=>[],prepareDisplay:async()=>{throw Error('unexpected new reply');},attachDisplay:async()=>{throw Error('unexpected attachment');}},
  });await service.initialize();
  return {service,monitors,setRemote:(state:InlineThreadState)=>{remote=state;},failSave:(value:boolean)=>{failSave=value;},failRead:(value:boolean)=>{failRead=value;},get saves(){return saves;},get reads(){return reads;},get saved(){return saved;}};
}

test('unchanged polling shares reads and performs zero writes while retaining all historical threads',async()=>{
  const h=await harness();await h.service.command(stream());await h.service.command(stream('B.md'));
  for(let i=0;i<2;i++)await h.service.command({version:1,id:randomUUID(),kind:'subscribe-job',target:{...source,threadId:'receiver'},job:{...source,jobId:'job-'+i,requestId:randomUUID(),messageId:origin}});
  await h.service.tick();const saves=h.saves,reads=h.reads,history=h.saved.threads;
  for(let i=0;i<10;i++)await h.service.tick();
  assert.equal(h.saves,saves);assert.equal(h.reads-reads,10);assert.deepEqual(h.saved.threads,history);assert.equal(Object.keys(history!).length,23);h.service.stop();
});

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
