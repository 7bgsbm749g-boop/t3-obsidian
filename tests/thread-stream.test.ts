import {test} from 'node:test';
import assert from 'node:assert/strict';
import {watchThread,readInlineEvents} from '../thread-stream';

test('thread subscription authenticates, acknowledges chunks, and interrupts on stop',async()=>{
  const sent:any[]=[],items:any[]=[],urls:string[]=[];let issueCount=0,closed=0;
  class Socket {
    onopen?:()=>void;onmessage?:(event:{data:string})=>void;onerror?:()=>void;onclose?:()=>void;
    constructor(url:string){urls.push(url);queueMicrotask(()=>this.onopen?.());}
    send(raw:string){
      const frame=JSON.parse(raw);sent.push(frame);
      if(frame.tag==='orchestration.subscribeThread')queueMicrotask(()=>this.onmessage?.({data:JSON.stringify({_tag:'Chunk',requestId:frame.id,values:[{kind:'snapshot',snapshot:{snapshotSequence:3,thread:{messages:[]}}},{kind:'synchronized'}]})}));
    }
    close(){closed++;this.onclose?.();}
  }
  const watcher=watchThread('thread-1',async()=>({origin:'https://t3.example',api:async(path,payload)=>{assert.equal(path,'/api/auth/websocket-ticket');assert.deepEqual(payload,{});issueCount++;return {ticket:'short-lived'};}}),{item:item=>items.push(item),reconnecting:error=>assert.fail(error.message)},url=>new Socket(url) as unknown as WebSocket);
  await new Promise(resolve=>setTimeout(resolve,30));
  assert.equal(issueCount,1);assert.match(urls[0],/^wss:\/\/t3\.example\/ws\?/);
  assert.equal(new URL(urls[0]).searchParams.get('orchestrationProtocol'),'1');
  assert.deepEqual(sent[0],{_tag:'Request',id:'1',tag:'orchestration.subscribeThread',payload:{threadId:'thread-1',reasoningMessages:true},headers:[]});
  assert.equal(items.length,2);assert.deepEqual(sent[1],{_tag:'Ack',requestId:'1'});
  watcher.stop();assert.deepEqual(sent[2],{_tag:'Interrupt',requestId:'1'});assert.equal(closed,1);
});

test('a quiet subscription refreshes the current thread snapshot',async()=>{
  const items:any[]=[],paths:string[]=[];
  class QuietSocket {
    onopen?:()=>void;onclose?:()=>void;onmessage?:(event:{data:string})=>void;onerror?:()=>void;
    constructor(_url:string){queueMicrotask(()=>this.onopen?.());}
    send(_raw:string){}
    close(){this.onclose?.();}
  }
  const watcher=watchThread('thread-2',async()=>({origin:'https://t3.example',api:async path=>{
    paths.push(path);
    return path==='/api/auth/websocket-ticket'?{ticket:'ticket'}:{snapshotSequence:9,thread:{messages:[],latestTurn:{turnId:'turn',state:'completed'}}};
  }}),{item:item=>items.push(item),reconnecting:error=>assert.fail(error.message)},url=>new QuietSocket(url) as unknown as WebSocket);
  try{
    await new Promise(resolve=>setTimeout(resolve,1400));
    assert.deepEqual(paths,['/api/auth/websocket-ticket','/api/orchestration/threads/thread-2?reasoningMessages=true&turnLimit=20']);
    assert.equal(items[0]?.kind,'snapshot');assert.equal(items[0]?.snapshot.snapshotSequence,9);
  }finally{watcher.stop();}
});

test('a closed stream obtains fresh credentials and a new canonical snapshot',async()=>{
  const sockets:Socket[]=[],items:any[]=[],errors:string[]=[];let tickets=0;
  class Socket {
    onopen?:()=>void;onclose?:()=>void;onmessage?:(event:{data:string})=>void;onerror?:()=>void;
    constructor(_url:string){sockets.push(this);queueMicrotask(()=>this.onopen?.());}
    send(raw:string){const frame=JSON.parse(raw);if(frame.tag==='orchestration.subscribeThread')queueMicrotask(()=>this.onmessage?.({data:JSON.stringify({_tag:'Chunk',requestId:'1',values:[{kind:'snapshot',snapshot:{snapshotSequence:sockets.length,thread:{messages:[{id:'answer',role:'assistant',text:`snapshot ${sockets.length}`,streaming:false}]}}}]})}));}
    close(){this.onclose?.();}
  }
  const watcher=watchThread('thread-3',async()=>({origin:'https://t3.example',api:async()=>({ticket:`ticket-${++tickets}`})}),{item:item=>items.push(item),reconnecting:error=>errors.push(error.message)},url=>new Socket(url) as unknown as WebSocket);
  try{
    await new Promise(resolve=>setTimeout(resolve,20));sockets[0].onclose?.();
    await new Promise(resolve=>setTimeout(resolve,1150));
    assert.equal(tickets,2);assert.equal(sockets.length,2);assert.equal(errors.length,1);
    assert.equal(items.at(-1)?.snapshot.thread.messages[0].text,'snapshot 2');
  }finally{watcher.stop();}
});

test('a host with its own canonical poll keeps live/replay streaming without a second snapshot poll',async()=>{
  const paths:string[]=[],items:any[]=[],sent:any[]=[],sockets:Socket[]=[];
  class Socket {
    onopen?:()=>void;onclose?:()=>void;onmessage?:(event:{data:string})=>void;onerror?:()=>void;
    constructor(){sockets.push(this);queueMicrotask(()=>this.onopen?.());}
    send(raw:string){const frame=JSON.parse(raw);sent.push(frame);if(frame.tag==='orchestration.subscribeThread')queueMicrotask(()=>this.onmessage?.({data:JSON.stringify({_tag:'Chunk',requestId:'1',values:[{kind:'event',event:{sequence:42,type:'thread.metadata-updated',payload:{title:'progress'}}}]})}));}
    close(){this.onclose?.();}
  }
  const watcher=watchThread('worker',async()=>({origin:'https://t3.example',api:async path=>{paths.push(path);return {ticket:'test'};}}),{item:item=>items.push(item),reconnecting:()=>{}},()=>new Socket() as unknown as WebSocket,undefined,{afterSequence:()=>41,pollSnapshots:false});
  try{
    await new Promise(resolve=>setTimeout(resolve,1400));
    assert.deepEqual(paths,['/api/auth/websocket-ticket']);assert.equal(items[0].event.sequence,42);assert.equal(sent[0].payload.afterSequence,41);assert.equal(sent[1]._tag,'Ack');
    sockets[0].onclose?.();await new Promise(resolve=>setTimeout(resolve,1150));
    assert.equal(sockets.length,2);assert.deepEqual(paths,['/api/auth/websocket-ticket','/api/auth/websocket-ticket']);assert.equal(items.length,2);
  }finally{watcher.stop();}
});

test('one-shot binding replay stops at synchronization and cancels a stranded socket without renderer timers',async()=>{
  for(const cancel of [false,true]){
    const abort=new AbortController(),sent:any[]=[];let closed=0;
    class Socket {
      onopen?:()=>void;onmessage?:(event:any)=>void;onclose?:()=>void;onerror?:()=>void;
      constructor(){queueMicrotask(()=>this.onopen?.());}
      send(raw:string){const frame=JSON.parse(raw);sent.push(frame);if(frame.tag==='orchestration.subscribeThread')queueMicrotask(()=>cancel?abort.abort():this.onmessage?.({data:JSON.stringify({_tag:'Chunk',requestId:'1',values:[{kind:'event',event:{sequence:9}},{kind:'synchronized'}]})}));}
      close(){closed++;this.onclose?.();}
    }
    const work=readInlineEvents({origin:'https://t3.example',api:async()=>({ticket:'test'})},'thread',8,abort.signal,()=>new Socket() as any);
    if(cancel)await assert.rejects(work,/canceled/);else assert.deepEqual(await work,[{kind:'event',event:{sequence:9}}]);
    assert.equal(sent[0].payload.afterSequence,8);assert.equal(sent[0].payload.requestCompletionMarker,true);assert.equal(closed,1);
    assert.equal(sent.at(-1)._tag,'Interrupt');
  }
});

test('quiet canonical polling backs off despite unrelated cursors and recovers missed completion',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date']});
  const items:any[]=[],readTimes:number[]=[];let sequence=0,complete=false,socket:Socket;
  class Socket {
    onopen?:()=>void;onclose?:()=>void;onmessage?:(event:{data:string})=>void;onerror?:()=>void;
    send(_raw:string){}close(){this.onclose?.();}
  }
  const watcher=watchThread('quiet',async()=>({origin:'https://t3.example',api:async path=>{
    if(path==='/api/auth/websocket-ticket')return {ticket:'test'};
    readTimes.push(Date.now());return {snapshotSequence:++sequence,thread:{id:'quiet',messages:[{id:'reply',text:'unchanged'}],latestTurn:{state:complete?'completed':'running'}}};
  }}),{item:x=>items.push(x),reconnecting:e=>assert.fail(e.message)},()=>{socket=new Socket();return socket as any;});
  const settle=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
  const advance=async(n:number)=>{t.mock.timers.tick(n);await settle();};
  try{
    await settle();socket!.onopen?.();
    for(const n of [1200,1200,2400,4800,5000])await advance(n);
    assert.deepEqual(readTimes,[1200,2400,4800,9600,14600]);
    assert.equal(items.length,5);assert.deepEqual(items.map(x=>x.snapshot.snapshotSequence),[1,2,3,4,5]);
    // No WebSocket delta arrives: the bounded canonical fallback finds completion.
    complete=true;await advance(4999);assert.equal(items.length,5);
    await advance(1);assert.equal(items.at(-1).snapshot.thread.latestTurn.state,'completed');
    await advance(1200);assert.equal(readTimes.at(-1),20800);
    watcher.stop();await advance(10000);assert.equal(items.length,7);
  }finally{watcher.stop();t.mock.timers.reset();}
});

test('live activity accelerates a quiet poll without overlap or postponing a due read',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date']});
  let socket:Socket,reads=0,inFlight=0,maxInFlight=0,release:(x:any)=>void=()=>{},blocked=false;
  class Socket {onopen?:()=>void;onclose?:()=>void;onmessage?:(event:{data:string})=>void;onerror?:()=>void;send(_raw:string){}close(){this.onclose?.();}}
  const value={thread:{id:'live',messages:[]}};
  const watcher=watchThread('live',async()=>({origin:'https://t3.example',api:async path=>{
    if(path==='/api/auth/websocket-ticket')return {ticket:'test'};
    reads++;inFlight++;maxInFlight=Math.max(maxInFlight,inFlight);
    try{return blocked?await new Promise(resolve=>{release=resolve;}):value;}finally{inFlight--;}
  }}),{item:()=>{},reconnecting:e=>assert.fail(e.message)},()=>{socket=new Socket();return socket as any;});
  const settle=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
  const advance=async(n:number)=>{t.mock.timers.tick(n);await settle();};
  const event=()=>socket!.onmessage?.({data:JSON.stringify({_tag:'Chunk',requestId:'1',values:[{kind:'event',event:{sequence:reads,type:'thread.message-updated'}}]})});
  try{
    await settle();socket!.onopen?.();await advance(1200);await advance(1200);
    await advance(100);event();await advance(1100);event();await advance(100);
    assert.equal(reads,3); // First event accelerated; second did not postpone.
    blocked=true;await advance(1200);assert.equal(reads,4);
    event();await advance(1200);assert.equal(reads,4);assert.equal(maxInFlight,1);
    release(value);await settle();blocked=false;
    await advance(1200);assert.equal(reads,5); // Activity during the read kept fast polling.
    watcher.stop();await advance(10000);assert.equal(reads,5);
  }finally{watcher.stop();t.mock.timers.reset();}
});

test('a failed canonical poll returns to the fast fallback and stop ignores a late response',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date']});
  let socket:Socket,reads=0,fail=false,blocked=false,release:(x:any)=>void=()=>{};const items:any[]=[];
  class Socket {onopen?:()=>void;onclose?:()=>void;onmessage?:(event:{data:string})=>void;onerror?:()=>void;send(_raw:string){}close(){this.onclose?.();}}
  const watcher=watchThread('failure',async()=>({origin:'https://t3.example',api:async path=>{
    if(path==='/api/auth/websocket-ticket')return {ticket:'test'};
    reads++;if(fail)throw Error('temporary transport error');
    return blocked?await new Promise(resolve=>{release=resolve;}):{thread:{id:'failure',messages:[]}};
  }}),{item:x=>items.push(x),reconnecting:e=>assert.fail(e.message)},()=>{socket=new Socket();return socket as any;});
  const settle=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
  const advance=async(n:number)=>{t.mock.timers.tick(n);await settle();};
  try{
    await settle();socket!.onopen?.();await advance(1200);await advance(1200);
    fail=true;await advance(2400);assert.equal(reads,3);
    fail=false;blocked=true;await advance(1200);assert.equal(reads,4);
    watcher.stop();release({thread:{id:'failure',messages:[]}});await settle();await advance(10000);
    assert.equal(reads,4);assert.equal(items.length,2);
  }finally{watcher.stop();t.mock.timers.reset();}
});

test('reconnect resets a quiet deadline and releases the old access',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date']});
  const sockets:Socket[]=[],reads:number[]=[],closed:string[]=[],errors:string[]=[];let tickets=0;
  class Socket {onopen?:()=>void;onclose?:()=>void;onmessage?:(event:{data:string})=>void;onerror?:()=>void;send(_raw:string){}close(){this.onclose?.();}}
  const watcher=watchThread('reconnect',async()=>({origin:'https://t3.example',close:reason=>{closed.push(reason!);},api:async path=>{
    if(path==='/api/auth/websocket-ticket')return {ticket:`ticket-${++tickets}`};
    reads.push(Date.now());return {thread:{id:'reconnect',messages:[]}};
  }}),{item:()=>{},reconnecting:e=>errors.push(e.message)},()=>{const s=new Socket();sockets.push(s);return s as any;});
  const settle=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
  const advance=async(n:number)=>{t.mock.timers.tick(n);await settle();};
  try{
    await settle();sockets[0].onopen?.();for(const n of [1200,1200,2400,4800])await advance(n);
    assert.equal(reads.length,4);sockets[0].onclose?.();assert.equal(errors.length,1);
    await advance(1000);assert.equal(tickets,2);sockets[1].onopen?.();
    await advance(1199);assert.equal(reads.length,4);await advance(1);
    assert.equal(reads.at(-1),11800);assert.deepEqual(closed,['stream-reconnect']);
    watcher.stop();assert.deepEqual(closed,['stream-reconnect','stream-stopped']);
  }finally{watcher.stop();t.mock.timers.reset();}
});
