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
test('a slow shared recovery read survives elapsed time and stops on its last reader cancellation',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const h=fixture(),received:unknown[]=[],errors:unknown[]=[];
  let signal!:AbortSignal,release!:(value:unknown)=>void;
  const access=async()=>({origin:'https://synthetic.invalid',api:async(_path:string,_payload?:unknown,options?:{signal?:AbortSignal})=>{signal=options!.signal!;return new Promise(resolve=>release=resolve);}}) as ThreadAccess;
  const subscribe=(key:string)=>h.pool.forSource(key,true)('thread',access,{item:item=>received.push(item),reconnecting:error=>errors.push(error)});
  const first=subscribe('slow');await drain();t.mock.timers.tick(60_000);await drain();
  assert.equal(signal.aborted,false);assert.equal(errors.length,0);
  release({thread:{id:'thread',projectId:'project',messages:[],activities:[]},snapshotSequence:1});await drain();
  assert.equal(received.length,1);first.stop();
  const second=subscribe('cancelled');await drain();second.stop();assert.equal(signal.aborted,true);
  release({thread:{id:'thread',projectId:'project',messages:[],activities:[]},snapshotSequence:2});await drain();
  assert.equal(received.length,1);assert.equal(errors.length,0);h.pool.dispose();
});

function recoveryFixture(limit=2){
 let now=0,reads=0,sequence=1;const starts:Array<Parameters<typeof watchThread>>=[],received:any[]=[],requests:string[]=[],pending:Array<{resolve:(value:any)=>void;reject:(error:Error)=>void}>=[];
 const pool=new SharedThreadStreams((...args)=>{starts.push(args);return {stop(){}};},limit,()=>now);
 const snapshot=(value=sequence)=>({thread:{id:'thread',projectId:'project',protocolVersion:2 as const,messages:[],activities:[]},snapshotSequence:value});
 const access=(key:string)=>async()=>({origin:'https://synthetic.invalid',api:async()=>{reads++;requests.push(key);return new Promise((resolve,reject)=>pending.push({resolve,reject}));}}) as ThreadAccess;
 const subscribe=(key='same',priority=0)=>pool.forSource(key,false,()=>priority)('thread',access(key),{item:item=>received.push(item),reconnecting:()=>{}},undefined,()=>({messageIds:['prompt'],turnIds:[]}),{afterSequence:()=>0,pollSnapshots:false});
 return {pool,starts,received,requests,pending,subscribe,snapshot,reads:()=>reads,time:(value:number)=>now=value,sequence:(value:number)=>sequence=value};
}
test('foreground recovers one shared v2 feed immediately without waiting for a socket close',async()=>{
 const h=recoveryFixture();h.subscribe();await drain();h.subscribe();await drain();
 h.starts[0][2].item({kind:'snapshot',snapshot:h.snapshot()} as any);
 await drain();h.pending[0].resolve(h.snapshot());await drain();const before=h.reads();
 h.pool.tick(true);h.pool.tick(true);await drain();assert.equal(h.reads(),before+1);
 const recovered=h.snapshot(3);Object.assign(recovered.thread,{title:'Recovered thread update'});h.pending.at(-1)!.resolve(recovered);await drain();
 assert.equal(h.received.at(-1).snapshot.snapshotSequence,3);assert.equal(h.starts.length,2,'A proven stale subscription reconnects after recovery');h.pool.dispose();
});
test('global cursor advances alone do not reopen a healthy quiet source',async()=>{
 const h=recoveryFixture();h.subscribe();await drain();h.starts[0][2].item({kind:'snapshot',snapshot:h.snapshot()} as any);
 try{for(let n=1;n<=3;n++){
  h.time(n*10000);h.pool.tick();await drain();assert.equal(h.reads(),n);
  h.pending[n-1].resolve(h.snapshot(n*50));await drain();
  assert.equal(h.received.at(-1).snapshot.snapshotSequence,n*50);assert.equal(h.starts.length,1,'Only the global cursor changed');
 }}finally{h.pool.dispose();}
});
test('recovery compares canonical thread content with already delivered live events',async()=>{
 const h=recoveryFixture();h.subscribe();await drain();h.starts[0][2].item({kind:'snapshot',snapshot:h.snapshot()} as any);
 h.starts[0][2].item({kind:'event',event:{sequence:2,type:'thread.metadata-updated',payload:{title:'Already current'}}});
 h.starts[0][2].item({kind:'event',event:{sequence:3,type:'thread.message-sent',payload:{messageId:'answer',role:'assistant',text:'Live progress',streaming:true}}});
 h.time(10000);h.pool.tick();await drain();const current=h.snapshot(50);Object.assign(current.thread,{title:'Already current',messages:[{streaming:true,text:'Live progress',turnId:null,role:'assistant',id:'answer'}]});
 try{h.pending[0].resolve(current);await drain();assert.equal(h.starts.length,1,'The live feed already delivered this thread update');}finally{h.pool.dispose();}
});
test('foreground recovery selects the visible source before earlier background sources',async()=>{
 const h=recoveryFixture(2);h.subscribe('background-one');h.subscribe('background-two');h.subscribe('visible',2);await drain();
 for(const start of h.starts)start[2].item({kind:'synchronized'});await drain();
 try{h.pool.tick(true);await drain();assert.deepEqual(h.requests,['visible','background-one']);assert.equal(h.reads(),2);}finally{h.pool.dispose();}
});
test('an uncached large reply restores live delivery without cursor-only socket churn',async()=>{
 const h=recoveryFixture(),body='Large reply. '+ 'x'.repeat(8_000_100);
 const snapshot=(sequence:number,text=body)=>({...h.snapshot(sequence),thread:{...h.snapshot().thread,messages:[{id:'answer',role:'assistant',turnId:null,text,streaming:true}]}});
 h.subscribe();await drain();h.starts[0][2].item({kind:'snapshot',snapshot:snapshot(1)});assert.equal(h.pool.status().cacheCharacters,0);
 try{
  h.time(10000);h.pool.tick();await drain();h.pending[0].resolve(snapshot(3,body+' Missed output.'));await drain();
  assert.equal(h.starts.length,2,'A large uncached reply must restore the live subscription');assert.equal(h.pool.status().cacheCharacters,0);
  h.time(20000);h.pool.tick();await drain();h.pending[1].resolve(snapshot(50,body+' Missed output.'));await drain();assert.equal(h.starts.length,2,'Only the global cursor changed');
  h.starts[1][2].item({kind:'event',event:{sequence:51,type:'thread.message-sent',payload:{messageId:'answer',role:'assistant',text:' Delivered live.',streaming:true}}});
  h.time(30000);h.pool.tick();await drain();h.pending[2].resolve(snapshot(60,body+' Missed output. Delivered live.'));await drain();assert.equal(h.starts.length,2,'Delivered events require a new comparison baseline, not a false reconnect');
  h.time(40000);h.pool.tick();await drain();h.pending[3].resolve(snapshot(70,body+' Missed output. Delivered live. New missed text.'));await drain();assert.equal(h.starts.length,3);
  const tool=(sequence:number)=>({...snapshot(sequence*10,body+' Missed output. Delivered live. New missed text.'),thread:{...snapshot(1,body+' Missed output. Delivered live. New missed text.').thread,v2Controls:{tool:{id:'tool',type:'tool-call',ordinal:1,status:'running',output:{sequence}}}}});
  h.time(50000);h.pool.tick();await drain();h.pending[4].resolve(tool(8));await drain();assert.equal(h.starts.length,4);
  h.time(60000);h.pool.tick();await drain();h.pending[5].resolve(tool(9));await drain();assert.equal(h.starts.length,5,'A tool output field named sequence is actual content, not a global cursor');
 }finally{h.pool.dispose();}
});
test('replay event eviction retains bounded comparison evidence for subsequent recovery',async()=>{
 const h=recoveryFixture();h.subscribe();await drain();h.starts[0][2].item({kind:'snapshot',snapshot:h.snapshot()});
 for(let n=0;n<257;n++)h.starts[0][2].item({kind:'event',event:{sequence:n+2,type:'thread.metadata-updated',payload:{title:'Title '+n}}});
 assert.equal(h.pool.status().cacheCharacters,0);
 try{h.time(10000);h.pool.tick();await drain();const updated=h.snapshot(500);Object.assign(updated.thread,{title:'Missed title'});h.pending[0].resolve(updated);await drain();assert.equal(h.starts.length,2);}finally{h.pool.dispose();}
});
test('silent v2 sources recover after ten seconds, while live events and pings remain distinct',async()=>{
 const h=recoveryFixture();h.subscribe();await drain();h.starts[0][2].item({kind:'snapshot',snapshot:h.snapshot()} as any);
 h.time(9999);h.pool.tick();await drain();assert.equal(h.reads(),0);
 h.starts[0][2].item({kind:'synchronized'});h.time(10000);h.pool.tick();await drain();assert.equal(h.reads(),1);
 h.pending[0].resolve(h.snapshot());await drain();assert.equal(h.starts.length,1,'A current quiet feed keeps its socket');
 h.time(19000);h.starts[0][2].item({kind:'event',event:{sequence:2,type:'thread.metadata-updated',payload:{title:'Current'}}} as any);
 h.time(20000);h.pool.tick();await drain();assert.equal(h.reads(),1);h.pool.dispose();
});
test('hung recovery expires, backs off, and fences late results without blocking other sources',async()=>{
 const h=recoveryFixture();h.subscribe();await drain();h.pool.tick(true);await drain();assert.equal(h.reads(),1);
 h.time(30000);h.pool.tick();await drain();h.time(34999);h.pool.tick();await drain();assert.equal(h.reads(),1);
 h.time(35000);h.pool.tick();await drain();assert.equal(h.reads(),2);
 h.pending[0].resolve(h.snapshot(99));await drain();assert.equal(h.received.length,0);
 h.pending[1].resolve(h.snapshot(2));await drain();assert.equal(h.received.at(-1).snapshot.snapshotSequence,2);h.pool.dispose();
});
test('recovery bounds concurrent reads and cancels queued and late work on disposal',async()=>{
 const h=recoveryFixture(2);h.subscribe('one');h.subscribe('two');h.subscribe('three',2);await drain();
 for(const start of h.starts)start[2].item({kind:'synchronized'});await drain();
 h.pool.tick(true);await drain();assert.equal(h.reads(),2);h.pending[0].resolve(h.snapshot());await drain();assert.equal(h.reads(),3);
 const before=h.received.length;h.pool.dispose();for(const pending of h.pending)pending.resolve(h.snapshot(100));await drain();assert.equal(h.received.length,before);
});

test('independent history cancellation predicates are not shared across readers',async()=>{
 const h=fixture(),observed:unknown[]=[];
 const access=await h.pool.access(async()=>({origin:'https://synthetic.invalid',api:async(_path,_payload,options)=>{observed.push(options?.continueHistory?.());return {};}}));
 await Promise.all([access.api('/api/orchestration/threads/thread',undefined,{continueHistory:()=>true}),access.api('/api/orchestration/threads/thread',undefined,{continueHistory:()=>false})]);
 assert.deepEqual(observed,[true,false]);h.pool.dispose();
});
