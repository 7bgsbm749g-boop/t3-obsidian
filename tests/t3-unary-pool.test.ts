import {test} from 'node:test';
import assert from 'node:assert/strict';
import {T3UnaryRpcPool,T3UnaryRpcOwner,type RpcClock} from '../src/connection/t3-rpc';
import {t3Api} from '../src/connection/t3-api';
import {readNewThreadDefaults} from '../src/conversations/model-defaults';
import {settingsSocket} from './rpc-fixture';

const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
function fixture(){
 let tickets=0,now=0,next=0;const timers=new Map<number,{at:number;run:()=>void}>(),sockets:any[]=[],requests:any[]=[];
 const time:RpcClock={now:()=>now,timer:(run,ms)=>{const id=++next;timers.set(id,{at:now+ms,run});return id as any;},clear:id=>{timers.delete(id as any);}};
 const pool=new T3UnaryRpcPool(async()=>{tickets++;return {ticket:'synthetic'};},'https://synthetic',()=>{
  const socket:any={closed:false,send:(data:string)=>requests.push({socket,...JSON.parse(data)}),close:()=>{socket.closed=true;socket.onclose?.();}};
  sockets.push(socket);queueMicrotask(()=>socket.onopen?.());return socket;
 },time);
 const advance=async(ms:number)=>{now+=ms;for(const [id,t] of timers)if(t.at<=now){timers.delete(id);t.run();}await flush();};
 const reply=(request:any,value:any)=>request.socket.onmessage({data:JSON.stringify({_tag:'Exit',requestId:request.id,exit:{_tag:'Success',value}})});
 return {pool,sockets,requests,timers,tickets:()=>tickets,advance,reply};
}

test('related defaults and mutations use the same authenticated API socket',async()=>{
 let tickets=0,opens=0,dispatches=0;const Socket=settingsSocket(undefined,undefined,tag=>{assert.equal(tag,'projects.ensureScratch');dispatches++;return {id:'scratch'};});
 const api=t3Api(async()=>{tickets++;return {ticket:'synthetic'};},'https://synthetic',url=>{opens++;return new Socket(url) as any;});
 await readNewThreadDefaults(api,'https://synthetic',{id:'project'});
 await api('/api/orchestration/no-project');await readNewThreadDefaults(api,'https://synthetic',{id:'project'});
 assert.equal(tickets,1);assert.equal(opens,1);assert.equal(dispatches,1);api.disposeUnaryRpc!();
});

test('pool invalidation cannot cancel an explicit send waiting for its acknowledgement',async()=>{
 const owner=new T3UnaryRpcOwner();
 let sent=0,complete!:(value:unknown)=>void,started!:()=>void,opens=0,closes=0;
 const transmitted=new Promise<void>(resolve=>started=resolve);
 const Socket=settingsSocket(undefined,undefined,tag=>{
  assert.equal(tag,'orchestration.launchThread');
  return new Promise(resolve=>complete=resolve);
 });
 class Tracked extends Socket {close(){closes++;super.close();}}
 const api=t3Api(async()=>({ticket:'synthetic'}),'https://synthetic',url=>{opens++;return new Tracked(url) as any;},Infinity,owner);
 await readNewThreadDefaults(api,'https://synthetic',{id:'project'});
 const work=api('/api/orchestration/launch',{threadId:'thread',initialMessage:{messageId:'message',text:'Prompt',attachments:[]}},{sendTransmission:{onMessageSent:()=>{sent++;started();},onThreadCreateSent:()=>assert.fail('Launch also delivers the message')}});
 await transmitted;
 owner.dispose();
 assert.equal(closes,1,'Only the read socket closes');
 complete({threadId:'thread'});
 assert.deepEqual(await work,{threadId:'thread'});
 assert.equal(sent,1);
 assert.equal(opens,2);
 assert.equal(closes,2,'The send closes its own socket');
});

test('a socket lost before launch transmits neither the thread nor its message',async()=>{
 let socket!:InstanceType<ReturnType<typeof settingsSocket>>;
 const Socket=settingsSocket(undefined,undefined,()=>assert.fail('No RPC should reach T3'));
 const api=t3Api(async()=>({ticket:'synthetic'}),'https://synthetic',url=>(socket=new Socket(url)) as any);
 await assert.rejects(api('/api/orchestration/launch',{threadId:'thread',initialMessage:{messageId:'message',text:'Prompt',attachments:[]}},{
  beforeThreadCreate:()=>socket.close(),
  sendTransmission:{onMessageSent:()=>assert.fail('No message transmitted'),onThreadCreateSent:()=>assert.fail('No thread create transmitted')},
 }),/closed/);
});

test('concurrent leases share opening, reader cancellation is isolated, and late replies are harmless',async()=>{
 const h=fixture(),abort=new AbortController(),first=h.pool.acquire(abort.signal),second=h.pool.acquire();
 const [a,b]=await Promise.all([first,second]);assert.equal(h.tickets(),1);
 const cancelled=a.call('orchestration.getTurnItem',{}),kept=b.call('projects.ensureScratch',{});
 const rejection=assert.rejects(cancelled,/cancelled/);abort.abort(Error('reader cancelled'));await rejection;
 assert.equal(h.sockets[0].closed,false);h.reply(h.requests[1],{id:'scratch'});assert.deepEqual(await kept,{id:'scratch'});
 h.reply(h.requests[0],'late');b.close();await h.advance(4999);assert.equal(h.sockets[0].closed,false);
 await h.advance(1);assert.equal(h.sockets[0].closed,true);assert.equal(h.timers.size,0);
 const fresh=await h.pool.acquire();assert.equal(h.tickets(),2);fresh.close();h.pool.dispose();
});

test('ownership and pending request limits do not queue or replay uncertain mutations',async()=>{
 const h=fixture(),leases=await Promise.all(Array.from({length:8},()=>h.pool.acquire()));
 await assert.rejects(h.pool.acquire(),/concurrent/);
 const calls=leases.map(lease=>lease.call('orchestration.dispatchCommand',{}));
 await assert.rejects(leases[0].call('server.getConfig',{}),/pending/);
 const rejected=calls.map(call=>assert.rejects(call,/closed|stopped|released/));h.pool.dispose();await Promise.all(rejected);
 assert.equal(h.requests.length,8);assert.equal(h.tickets(),1);assert.equal(h.sockets[0].closed,true);assert.equal(h.timers.size,0);
 await assert.rejects(h.pool.acquire(),/stopped/);
});

test('a real transport loss fails once; only a later caller can open a new connection',async()=>{
 const h=fixture(),a=await h.pool.acquire(),pending=a.call('orchestration.dispatchCommand',{});
 const rejected=assert.rejects(pending,/closed/);h.sockets[0].onclose();await rejected;a.close();
 assert.equal(h.tickets(),1);assert.equal(h.requests.length,1);
 const b=await h.pool.acquire();assert.equal(h.tickets(),2);b.close();h.pool.dispose();
});

test('cancellation during ticket creation fences late sockets and disposal fences stale credentials',async()=>{
 let issue!:(v:unknown)=>void,opens=0;
 const pool=new T3UnaryRpcPool(()=>new Promise(resolve=>{issue=resolve;}),'https://synthetic',()=>{opens++;throw Error('Must not open');});
 const abort=new AbortController(),work=pool.acquire(abort.signal),rejected=assert.rejects(work,/cancelled/);
 abort.abort(Error('reader cancelled'));await rejected;issue({ticket:'late'});await flush();assert.equal(opens,0);
 pool.dispose();await assert.rejects(pool.acquire(),/stopped/);
});

test('a stuck socket open has a bounded deadline; credential expiry rejects new borrows',async()=>{
 let now=0,expired=0;const timers=new Map<number,()=>void>();
 const time:RpcClock={now:()=>now,timer:(run,ms)=>{timers.set(ms,run);return ms as any;},clear:id=>{timers.delete(id as any);}};
 const pool=new T3UnaryRpcPool(async()=>({ticket:'synthetic'}),'https://synthetic',()=>({close:()=>{expired++;}} as any),time);
 const opening=pool.acquire(),rejected=assert.rejects(opening,/open in time/);await flush();now=15_000;timers.get(15000)!();await rejected;assert.equal(expired,1);pool.dispose();
 const old=new T3UnaryRpcPool(async()=>{throw Error('Must not request');},'https://synthetic',undefined,undefined,Date.now()-1);
 await assert.rejects(old.acquire(),/stopped/);
});


test('two API adapters for the same credential owner reuse one pool across authorization refresh',async()=>{
 let tickets=0,opens=0;const owner=new T3UnaryRpcOwner(),Socket=settingsSocket(undefined,undefined,()=>({projectId:'scratch'}));
 const raw=async()=>{tickets++;return {ticket:'synthetic'};},socket=(url:string)=>{opens++;return new Socket(url) as any;};
 const first=t3Api(raw,'https://synthetic',socket,Infinity,owner),second=t3Api(raw,'https://synthetic',socket,Infinity,owner);
 await first('/api/orchestration/no-project');await second('/api/orchestration/no-project');
 assert.equal(tickets,1);assert.equal(opens,1);owner.dispose();
 await assert.rejects(second('/api/orchestration/no-project'),/stopped/);
 assert.throws(()=>t3Api(raw,'https://synthetic',socket,Infinity,owner),/stopped/);
});
