import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SharedThreadStreams} from '../src/conversations/shared-thread-stream';
import type {watchThread,ThreadAccess} from '../src/conversations/thread-stream';
import {T3ResponseTooLargeError} from '../src/connection/t3-response-limits';

const drain=async()=>{for(let n=0;n<12;n++)await Promise.resolve();};
function fixture(limit=2){
  const starts:Array<Parameters<typeof watchThread>>=[],stops:string[]=[];
  const pool=new SharedThreadStreams((...args)=>{starts.push(args);return {stop:()=>{stops.push(args[0]);}};},limit);
  const access=async()=>({origin:'https://synthetic.invalid',api:async()=>({thread:{id:'thread',projectId:'project',messages:[],activities:[]},snapshotSequence:1})}) as ThreadAccess;
  const received:unknown[]=[];
  const subscribe=(key='environment:project:thread')=>pool.forSource(key)('thread',access,{item:item=>received.push(item),reconnecting:()=>{}},undefined,()=>({messageIds:['message'],turnIds:[]}),{afterSequence:()=>0,pollSnapshots:false});
  return {pool,starts,stops,subscribe,received,access};
}
test('many response attachments share a source and release it only after the last reader',async()=>{
  const h=fixture(),readers=Array.from({length:12},()=>h.subscribe());await drain();
  assert.equal(h.starts.length,1);assert.equal(h.pool.status().readers,12);
  h.starts[0][2].item({kind:'synchronized'});assert.equal(h.received.length,12);
  readers[0].stop();assert.equal(h.stops.length,0);
  for(const reader of readers.slice(1))reader.stop();assert.equal(h.stops.length,1);assert.equal(h.pool.status().sources,0);h.pool.dispose();
});
test('startup bounds connection handshakes and a cancelled queued source never starts',async()=>{
  const h=fixture(),a=h.subscribe('A'),b=h.subscribe('B'),c=h.subscribe('C'),d=h.subscribe('D');await drain();
  assert.equal(h.starts.length,2);assert.equal(h.pool.status().queued,2);c.stop();
  h.starts[0][2].item({kind:'synchronized'});await drain();assert.equal(h.starts.length,3);assert.equal(h.pool.status().queued,0);
  a.stop();b.stop();d.stop();h.pool.dispose();
});
test('distinct environments never share a response connection',async()=>{
  const h=fixture();h.subscribe('env-A:project:thread');h.subscribe('env-B:project:thread');await drain();assert.equal(h.starts.length,2);h.pool.dispose();
});
test('visible-note recovery precedes queued closed notes within the startup bound',async()=>{
  const h=fixture(1);h.subscribe('opening');await drain();h.subscribe('closed');
  h.pool.forSource('visible',false,()=>2)('visible-thread',h.access,{item:()=>{},reconnecting:()=>{}});
  await drain();assert.equal(h.starts.length,1);h.starts[0][2].item({kind:'synchronized'});await drain();assert.equal(h.starts[1][0],'visible-thread');h.pool.dispose();
});
test('compatible immutable reads coalesce but dispatches and socket tickets do not',async()=>{
  const h=fixture();let calls=0,release!:(value:unknown)=>void;
  const original={origin:'https://synthetic.invalid',api:async()=>{calls++;return new Promise(resolve=>{release=resolve;});}} as ThreadAccess;
  const a=await h.pool.access(async()=>original),b=await h.pool.access(async()=>original);
  const first=a.api('/api/orchestration/turn-item',{threadId:'thread',itemId:'item',revision:'one'}),second=b.api('/api/orchestration/turn-item',{threadId:'thread',itemId:'item',revision:'one'});
  await drain();assert.equal(calls,1);release({id:'item'});assert.deepEqual(await first,await second);
  const unsafe={origin:original.origin,api:async()=>{calls++;return {};}} as ThreadAccess,access=await h.pool.access(async()=>unsafe);
  await Promise.all([access.api('/api/auth/websocket-ticket',{}),access.api('/api/auth/websocket-ticket',{}),access.api('/api/orchestration/dispatch',{}),access.api('/api/orchestration/dispatch',{})]);
  assert.equal(calls,5);h.pool.dispose();
});
test('joining readers retain live events newer than an intervening canonical snapshot',async()=>{
  const h=fixture();h.subscribe();await drain();const send=h.starts[0][2].item;
  send({kind:'snapshot',snapshot:{snapshotSequence:5,thread:{id:'thread',projectId:'project',messages:[]}}} as any);
  send({kind:'event',event:{sequence:6,type:'thread.message-sent',payload:{}}} as any);
  send({kind:'snapshot',snapshot:{snapshotSequence:5,thread:{id:'thread',projectId:'project',messages:[]}}} as any);
  const late:any[]=[];h.pool.forSource('environment:project:thread')('thread',h.access,{item:item=>late.push(item),reconnecting:()=>{}},undefined,()=>({messageIds:[],turnIds:[]}),{afterSequence:()=>0,pollSnapshots:false});
  await drain();assert.ok(late.some(item=>item.event?.sequence===6));assert.equal(h.starts.length,1);h.pool.dispose();
});
test('completed shared hints use one canonical read and never open a live socket',async()=>{
  const h=fixture();let reads=0;
  const access=async()=>({origin:'https://synthetic.invalid',api:async()=>{reads++;return {thread:{id:'thread',projectId:'project',messages:[],activities:[]},snapshotSequence:1};}}) as ThreadAccess;
  for(let n=0;n<12;n++)h.pool.forSource('done',true)('thread',access,{item:()=>{},reconnecting:()=>{}},undefined,()=>({messageIds:[],turnIds:[]}));
  await drain();assert.equal(h.starts.length,0);assert.equal(reads,1);assert.equal(h.pool.status().opening,0);h.pool.dispose();
});
test('an oversized completed read reports its specific failure without a reconnect loop',async()=>{
  const h=fixture(),failures:unknown[]=[],reconnecting:unknown[]=[];
  h.pool.forSource('too-large',true)('thread',async()=>({origin:'https://synthetic.invalid',api:async()=>{throw new T3ResponseTooLargeError();}}),{item:()=>{},reconnecting:error=>reconnecting.push(error),failure:error=>failures.push(error)});
  await drain();assert.equal(failures.length,1);assert.equal(reconnecting.length,0);assert.equal(h.pool.status().retryTimers,0);assert.equal(h.pool.status().opening,0);h.pool.dispose();
});
test('a live reader can join a pending completed read without leaking a startup slot',async()=>{
  const h=fixture();let resolve!:(value:unknown)=>void;
  const access=async()=>({origin:'https://synthetic.invalid',api:()=>new Promise(done=>resolve=done)}) as ThreadAccess;
  h.pool.forSource('mixed',true)('thread',access,{item:()=>{},reconnecting:()=>{}});await drain();
  h.pool.forSource('mixed')('thread',h.access,{item:()=>{},reconnecting:()=>{}});await drain();assert.equal(h.starts.length,1);assert.equal(h.pool.status().opening,1);
  h.starts[0][2].item({kind:'synchronized'});assert.equal(h.pool.status().opening,0);
  resolve({thread:{id:'thread',projectId:'project',messages:[],activities:[]},snapshotSequence:1});await drain();h.pool.dispose();
});
test('read sharing works across newly acquired route APIs and preserves signals and connection tracking',async()=>{
  const h=fixture();let calls=0,release!:(value:unknown)=>void,tracked=0;
  const factory=async()=>({origin:'https://synthetic.invalid',api:Object.assign(async(_path:string,_payload?:unknown,options?:{signal?:AbortSignal})=>{calls++;if(options?.signal){assert.equal(options.signal.aborted,false);return {};}return new Promise(done=>release=done);},{trackConnection:()=>tracked++})}) as ThreadAccess;
  const a=await h.pool.access(factory,'same'),b=await h.pool.access(factory,'same');
  const first=a.api('/api/orchestration/turn-item',{id:'one'}),second=b.api('/api/orchestration/turn-item',{id:'one'});await drain();assert.equal(calls,1);release({});await Promise.all([first,second]);
  a.api.trackConnection?.({closed:false});assert.equal(tracked,1);
  await Promise.all([a.api('/api/orchestration/turn-item',{}, {signal:new AbortController().signal}),b.api('/api/orchestration/turn-item',{}, {signal:new AbortController().signal})]);assert.equal(calls,3);h.pool.dispose();
});
