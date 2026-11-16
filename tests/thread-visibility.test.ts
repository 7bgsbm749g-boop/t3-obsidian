import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ThreadVisibility,OBSIDIAN_THREAD_TAG,threadHiding,type ThreadTagJob} from '../src/conversations/thread-visibility';
import {settingsSocket} from './rpc-fixture';

const job:ThreadTagJob={id:'tag-operation',threadId:'plugin-thread',projectId:'project',environmentId:'one'};
function fixture(t:{after:(run:()=>void)=>void},initial:unknown=[]){
  const before=globalThis.WebSocket;t.after(()=>{globalThis.WebSocket=before;});
  let stored=initial,failTag=false,failConfig=false,wrongProject=false,reads=0;
  const settings={hiddenThreadTags:['private'],hideTaggedThreads:false,unrelated:'kept'},writes:any[]=[],commands:any[]=[];
  globalThis.WebSocket=settingsSocket(()=>{reads++;return {settings};},undefined,(tag,payload)=>{
    if(tag==='server.updateSettings'){if(failConfig)throw Error('settings denied');writes.push(payload.patch);Object.assign(settings,payload.patch);return {settings};}
    if(tag==='orchestration.getThreadFamily')return {threads:[{id:payload.threadId,projectId:wrongProject?'wrong':'project'}]};
    assert.equal(tag,'orchestration.dispatchCommand');commands.push(payload);if(failTag)throw Error('Lost tag acknowledgement');return {};
  }) as any;
  const access={origin:'https://fixture',api:async()=>({ticket:'fixture'})};
  const store={load:()=>stored,save:(jobs:ThreadTagJob[])=>{stored=structuredClone(jobs);}};
  const visibility=new ThreadVisibility(store);t.after(()=>visibility.dispose());
  return {visibility,store,access,settings,writes,commands,stored:()=>stored,reads:()=>reads,failTag:(value:boolean)=>{failTag=value;},failConfig:(value:boolean)=>{failConfig=value;},wrongProject:(value:boolean)=>{wrongProject=value;}};
}

test('hiding is opt-in and uses the reserved tag',()=>{assert.equal(threadHiding(undefined),undefined);assert.equal(threadHiding('true'),undefined);assert.equal(threadHiding(true),true);assert.equal(threadHiding(false),false);assert.equal(OBSIDIAN_THREAD_TAG,'t3-obsidian');});
test('enabling preserves other tags and settings; disabling removes only the reserved hidden tag',async t=>{
  const h=fixture(t);h.settings.hiddenThreadTags.push('private');await h.visibility.apply(h.access,'one',true,'credential');
  assert.deepEqual(h.settings.hiddenThreadTags,['private','private','t3-obsidian']);assert.equal(h.settings.hideTaggedThreads,true);assert.equal(h.settings.unrelated,'kept');
  const reads=h.reads();await h.visibility.apply(h.access,'one',true,'credential');assert.equal(h.reads(),reads);
  await h.visibility.apply(h.access,'one',false,'credential');assert.deepEqual(h.settings.hiddenThreadTags,['private','private']);assert.equal(h.settings.hideTaggedThreads,true);assert.deepEqual(h.writes[1],{hiddenThreadTags:['private','private']});
});
test('tagging checks the original project and persists lost acknowledgements without sending prompts',async t=>{
  const h=fixture(t);h.visibility.queue(job);h.failTag(true);
  await assert.rejects(h.visibility.apply(h.access,'one',true,'credential'),/remain pending/);assert.equal((h.stored() as any[]).length,1);
  h.failTag(false);await h.visibility.apply(h.access,'one',true,'credential');assert.deepEqual(h.commands.map(command=>command.commandId),[job.id,job.id]);
  assert.ok(h.commands.every(command=>command.type==='thread.tag.set'&&command.tag==='t3-obsidian'&&command.tagged===true));assert.deepEqual(h.stored(),[]);
});
test('forced synchronization repairs external filter changes while ordinary calls stay cached',async t=>{
  const h=fixture(t);await h.visibility.apply(h.access,'one',true,'credential');const reads=h.reads();
  h.settings.hiddenThreadTags=['private'];h.settings.hideTaggedThreads=false;
  await h.visibility.apply(h.access,'one',true,'credential');assert.equal(h.reads(),reads);assert.equal(h.settings.hideTaggedThreads,false);
  await h.visibility.apply(h.access,'one',true,'credential',true);assert.ok(h.reads()>reads);assert.deepEqual(h.settings.hiddenThreadTags,['private','t3-obsidian']);assert.equal(h.settings.hideTaggedThreads,true);
});
test('restart retains pending tags, isolates environments, and refuses a mismatched project',async t=>{
  const h=fixture(t,[job,{...job,id:'remote',environmentId:'two'}]);h.wrongProject(true);
  await assert.rejects(h.visibility.apply(h.access,'one',true,'credential'),/original Obsidian thread/);assert.equal(h.commands.length,0);
  h.wrongProject(false);const restarted=new ThreadVisibility(h.store);try{await restarted.apply(h.access,'one',true,'credential');assert.deepEqual((h.stored() as any[]).map(job=>job.environmentId),['two']);}finally{restarted.dispose();}
});
test('failed settings and disabling never tag threads, and concurrent configuration is serialized',async t=>{
  const h=fixture(t);h.visibility.queue(job);h.failConfig(true);await assert.rejects(h.visibility.apply(h.access,'one',true,'credential'));assert.equal(h.commands.length,0);
  h.failConfig(false);await Promise.all([h.visibility.apply(h.access,'one',false,'credential'),h.visibility.apply(h.access,'one',false,'credential')]);assert.equal(h.commands.length,0);assert.deepEqual(h.stored(),[]);
  h.visibility.dispose();await h.visibility.apply(h.access,'one',true,'credential');assert.equal(h.settings.hiddenThreadTags.includes('t3-obsidian'),false);
});

test('rapid forced refreshes share one in-flight rerun and keep the latest preference and credential',async t=>{
  const h=fixture(t);let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;}),tickets:string[]=[];
  const access=(name:string)=>({...h.access,api:async()=>{tickets.push(name);if(tickets.length===1)await gate;return {ticket:'fixture'};}});
  const first=h.visibility.apply(access('old'),'one',false,'old',true),waiting:Promise<void>[]=[];
  for(let i=0;i<40;i++)waiting.push(h.visibility.apply(access('latest'),'one',i%2===1,'latest',true));
  assert.ok(waiting.every(work=>work===first),'callers share completion rather than queueing individual continuations');
  release();await Promise.all([first,...waiting]);
  assert.deepEqual(tickets,['old','latest']);assert.equal(h.reads(),3);
  assert.deepEqual(h.settings.hiddenThreadTags,['private','t3-obsidian']);assert.equal(h.settings.hideTaggedThreads,true);
  const reads=h.reads();await h.visibility.apply(h.access,'one',true,'latest');assert.equal(h.reads(),reads);
  await h.visibility.apply(h.access,'one',true,'new-credential');assert.equal(h.reads(),reads+1,'a fresh credential still verifies the setting');
});

test('jobs queued during a visibility pass are handled by the shared rerun',async t=>{
  const h=fixture(t);let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const first=h.visibility.apply({...h.access,api:async()=>{await gate;return {ticket:'fixture'};}},'one',true,'credential');
  h.visibility.queue(job);const rerun=h.visibility.apply(h.access,'one',true,'credential');
  release();await Promise.all([first,rerun]);assert.equal(h.commands.length,1);assert.deepEqual(h.stored(),[]);
});

test('disposing visibility work fences the coalesced rerun',async t=>{
  const h=fixture(t);let release!:()=>void,tickets=0;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const access={...h.access,api:async()=>{tickets++;await gate;return {ticket:'fixture'};}};
  const first=h.visibility.apply(access,'one',false,'credential');h.visibility.apply(access,'one',true,'credential',true);
  h.visibility.dispose();release();await first;assert.equal(tickets,1);assert.equal(h.reads(),0);assert.deepEqual(h.writes,[]);
});

test('a failed coalesced pass retains tag jobs and rejects all shared waiters for a later retry',async t=>{
  const h=fixture(t);h.visibility.queue(job);h.failTag(true);let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const access={...h.access,api:async()=>{await gate;return {ticket:'fixture'};}};
  const first=h.visibility.apply(access,'one',true,'credential',true);
  const second=h.visibility.apply(h.access,'one',true,'credential',true);assert.equal(first,second);
  const result=assert.rejects(first,/remain pending/);release();await result;
  assert.equal((h.stored() as any[]).length,1);assert.equal(h.commands.length,2,'only one in-flight rerun retries the durable command');
  h.failTag(false);await h.visibility.apply(h.access,'one',true,'credential');assert.deepEqual(h.stored(),[]);assert.ok(h.commands.every(command=>command.commandId===job.id));
});

test('an older disable pass cannot drop a tag queued for the latest enabled preference',async t=>{
  const h=fixture(t);let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const first=h.visibility.apply({...h.access,api:async()=>{await gate;return {ticket:'fixture'};}},'one',false,'credential',true);
  h.visibility.queue(job);const enabled=h.visibility.apply(h.access,'one',true,'credential',true);
  release();await Promise.all([first,enabled]);assert.equal(h.commands.length,1);assert.deepEqual(h.stored(),[]);assert.ok(h.settings.hiddenThreadTags.includes('t3-obsidian'));
});
