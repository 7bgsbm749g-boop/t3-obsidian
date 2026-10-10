import {test} from 'node:test';
import assert from 'node:assert/strict';
import {connectT3Rpc,T3ConnectionTimeoutError,T3RequestTimeoutError,type RpcClock} from '../t3-rpc';

const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function fixture(){
  let now=0,serial=0,closes=0,pongs=true;const timers=new Map<number,{at:number;fn:()=>void}>(),requests:any[]=[];
  const time:RpcClock={now:()=>now,timer:(fn,ms)=>{const id=++serial;timers.set(id,{at:now+ms,fn});return id as any;},clear:id=>{timers.delete(id as any);}};
  const emit=(frame:any)=>ws.onmessage?.({data:JSON.stringify(frame)});
  const ws:any={send:(raw:string)=>{const frame=JSON.parse(raw);requests.push(frame);if(frame._tag==='Ping'&&pongs)emit({_tag:'Pong'});},close:()=>{closes++;ws.onclose?.();}};
  const open=()=>connectT3Rpc(async()=>({ticket:'synthetic-only'}),'https://synthetic.example',()=>{queueMicrotask(()=>ws.onopen?.());return ws;},time);
  const advance=async(ms:number)=>{
    const until=now+ms;
    for(;;){const next=[...timers].filter(([,t])=>t.at<=until).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;now=next[1].at;timers.delete(next[0]);next[1].fn();await flush();}
    now=until;await flush();
  };
  return {open,advance,requests,emit,reply:(id:string,value:any)=>emit({_tag:'Exit',requestId:id,exit:{_tag:'Success',value}}),silent:()=>{pongs=false;},closes:()=>closes,timers};
}

test('a socket that appears open but drops every frame is confirmed dead before the old request deadline',async()=>{
  const h=fixture(),rpc=await h.open();h.silent();
  const pending=rpc.call('projects.readFile',{cwd:'/synthetic',relativePath:'small.json'});
  const rejected=assert.rejects(pending,(e:any)=>e instanceof T3ConnectionTimeoutError&&e.rpcMethod==='projects.readFile'&&e.confirmed&&e.elapsedMs===8000&&e.pendingCount===1);
  await flush();await h.advance(8000);await rejected;
  assert.equal(rpc.closed,true);assert.equal(h.closes(),1);assert.equal(h.timers.size,0);
});

test('slow file requests do not close a responding shared socket or cancel unrelated requests',async()=>{
  const h=fixture(),rpc=await h.open();
  const slow=rpc.call('projects.readFile',{relativePath:'slow.json'}),rejected=assert.rejects(slow,(e:any)=>e instanceof T3RequestTimeoutError&&e.rpcMethod==='projects.readFile');
  await flush();const fast=rpc.call('projects.writeFile',{relativePath:'other.json',contents:'synthetic'});await flush();
  h.reply('2',{saved:true});assert.deepEqual(await fast,{saved:true});
  await h.advance(15_000);await rejected;assert.equal(rpc.closed,false);assert.equal(h.closes(),0);
  const next=rpc.call('projects.readFile',{relativePath:'new.json'});await flush();h.reply('3','healthy');assert.equal(await next,'healthy');
  rpc.close();assert.equal(h.timers.size,0);
});

test('an idle or suspended connection checks health before sending another operation and shares one probe',async()=>{
  const h=fixture(),rpc=await h.open();h.silent();await h.advance(5000);
  const first=rpc.call('projects.readFile',{}),second=rpc.call('projects.readFile',{});
  const rejected=Promise.all([assert.rejects(first,T3ConnectionTimeoutError),assert.rejects(second,T3ConnectionTimeoutError)]);
  await flush();assert.equal(h.requests.filter(x=>x._tag==='Ping').length,1);assert.equal(h.requests.filter(x=>x._tag==='Request').length,0);
  await h.advance(3000);await rejected;assert.equal(h.closes(),1);
});

test('a valid concurrent reply proves health without a Pong and a late reply cannot reopen a failed socket',async()=>{
  const h=fixture(),rpc=await h.open();h.silent();const pending=rpc.call('projects.readFile',{});await flush();await h.advance(5000);
  h.reply('1','alive');assert.equal(await pending,'alive');assert.equal(rpc.closed,false);
  await h.advance(8000);assert.equal(rpc.closed,true);h.reply('1','late');assert.equal(rpc.closed,true);assert.equal(h.closes(),1);
});
