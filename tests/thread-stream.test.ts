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
