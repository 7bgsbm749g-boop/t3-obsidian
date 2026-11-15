import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ThreadSettlementEvents,watchSettlementShell} from '../src/conversations/thread-settlement-events';
import type {ThreadSettlementJob} from '../src/conversations/thread-settlement';
import type {ThreadAccess} from '../src/conversations/thread-stream';

const job:ThreadSettlementJob={requestId:'request',messageId:'message',threadId:'thread',projectId:'project',connection:{executable:'',host:'direct',transport:'direct',environmentId:'environment'},inlineJobId:'binding'};
const drain=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
function harness(check:(job:ThreadSettlementJob)=>Promise<void>=async()=>{}){
  const streams:Array<{changed:(threadId?:string)=>void;stopped:boolean}>=[],checks:string[]=[],errors:Error[]=[];let blocked=false;
  const events=new ThreadSettlementEvents(async()=>({origin:'https://fixture',api:async()=>({ticket:'fixture'})}),async job=>{checks.push(job.requestId);await check(job);},()=>blocked,error=>errors.push(error),(_access,changed)=>{const stream={changed,stopped:false};streams.push(stream);return {stop(){stream.stopped=true;}};});
  return {events,streams,checks,errors,block:(value:boolean)=>{blocked=value;}};
}

test('settlement jobs share metadata subscriptions, check on startup and final save, and ignore other threads',async()=>{
  const h=harness(),other={...job,requestId:'other',threadId:'other-thread',inlineJobId:'other-binding'};
  try{
    h.events.sync([job,other]);await drain();assert.equal(h.streams.length,1);assert.deepEqual(h.checks,['request','other']);h.checks.length=0;
    h.streams[0].changed('unrelated');await drain();assert.deepEqual(h.checks,[]);
    h.streams[0].changed(job.threadId);await drain();assert.deepEqual(h.checks,['request']);h.checks.length=0;
    h.events.wake('other-binding');await drain();assert.deepEqual(h.checks,['other']);h.checks.length=0;
    h.events.sync([job,other]);await drain();assert.deepEqual(h.checks,[],'unrelated settings saves must not restart checks');
    const remote={...job,requestId:'remote',connection:{...job.connection,environmentId:'another'}};h.events.sync([job,other,remote]);await drain();assert.equal(h.streams.length,2);assert.deepEqual(h.checks,['remote']);
  }finally{h.events.dispose();}assert.ok(h.streams.every(stream=>stream.stopped));
});

test('a final-save event during a check is retained and concurrent events are coalesced',async()=>{
  let finish!:()=>void,active=0,maximum=0;let first=true;
  const h=harness(async()=>{active++;maximum=Math.max(maximum,active);if(first){first=false;await new Promise<void>(resolve=>{finish=resolve;});}active--;});
  try{
    h.events.sync([job]);await drain();h.events.wake('binding');h.streams[0].changed('thread');h.streams[0].changed('thread');await drain();assert.equal(h.checks.length,1);
    finish();await drain();assert.deepEqual(h.checks,['request','request']);assert.equal(maximum,1);
  }finally{h.events.dispose();}
});

test('busy sends defer checks, reconnect recovers jobs, and disabling fences queued and late events',async()=>{
  const h=harness();h.block(true);h.events.sync([job]);await drain();assert.deepEqual(h.checks,[]);
  h.block(false);h.events.wake();await drain();assert.deepEqual(h.checks,['request']);
  h.events.reconnect();await drain();assert.equal(h.streams[0].stopped,true);assert.equal(h.streams.length,2);assert.equal(h.checks.length,2);
  h.block(true);h.streams[1].changed('thread');h.events.sync([]);h.block(false);h.events.wake();h.streams[1].changed('thread');await drain();assert.equal(h.checks.length,2);assert.ok(h.streams.every(stream=>stream.stopped));
  h.events.dispose();h.events.sync([job]);h.events.reconnect();await drain();assert.equal(h.streams.length,2);
});

class Socket {
  onopen:(()=>void)|null=null;onmessage:((message:{data:string})=>void)|null=null;onerror:(()=>void)|null=null;onclose:(()=>void)|null=null;
  sent:any[]=[];closed=false;
  send(value:string){this.sent.push(JSON.parse(value));}close(){this.closed=true;this.onclose?.();}
  chunk(values:unknown[]){this.onmessage?.({data:JSON.stringify({_tag:'Chunk',requestId:'1',values})});}
}

test('native shell events trigger terminal checks without periodic reads and reconnect to a fresh snapshot',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const sockets:Socket[]=[],changes:Array<string|undefined>=[],paths:string[]=[];let releases=0;
  const access=async():Promise<ThreadAccess>=>({origin:'https://fixture',api:async path=>{paths.push(path);return {ticket:'fixture'};},close:()=>{releases++;}});
  const watch=watchSettlementShell(access,id=>changes.push(id),()=>{const socket=new Socket();sockets.push(socket);return socket as unknown as WebSocket;});
  try{
    await drain();sockets[0].onopen?.();assert.equal(sockets[0].sent[0].tag,'orchestration.subscribeShell');
    sockets[0].chunk([{kind:'snapshot',snapshot:{threads:[]}}]);assert.deepEqual(changes,[undefined]);
    for(let i=0;i<10;i++)sockets[0].chunk([{kind:'thread.updated',thread:{id:'thread',status:'running'}}]);assert.equal(changes.length,1,'streaming does not cause canonical checks');
    sockets[0].chunk([{kind:'thread.updated',thread:{id:'thread',status:'completed'}},{kind:'thread.updated',thread:{id:'thread',status:'failed'}},{kind:'thread.removed',threadId:'removed'}]);assert.deepEqual(changes,[undefined,'thread','thread','removed']);
    t.mock.timers.tick(60_000);await drain();assert.deepEqual(paths,['/api/auth/websocket-ticket']);assert.equal(sockets.length,1);
    sockets[0].onerror?.();assert.equal(sockets[0].closed,true);assert.equal(releases,1);t.mock.timers.tick(1000);await drain();assert.equal(sockets.length,2);
    sockets[1].onopen?.();sockets[1].chunk([{kind:'snapshot',snapshot:{threads:[]}}]);assert.equal(changes.at(-1),undefined);
    watch.stop();sockets[1].chunk([{kind:'thread.removed',threadId:'late'}]);t.mock.timers.tick(60_000);await drain();assert.equal(sockets.length,2);assert.equal(releases,2);assert.notEqual(changes.at(-1),'late');
  }finally{watch.stop();t.mock.timers.reset();}
});

test('stopping during authentication closes late access without creating a socket',async()=>{
  let resolve!:(access:ThreadAccess)=>void,releases=0,sockets=0;
  const watch=watchSettlementShell(()=>new Promise<ThreadAccess>(done=>{resolve=done;}),()=>assert.fail('late event'),()=>{sockets++;return new Socket() as unknown as WebSocket;});
  watch.stop();resolve({origin:'https://fixture',api:async()=>({}),close:()=>{releases++;}});await drain();assert.equal(releases,1);assert.equal(sockets,0);
});
