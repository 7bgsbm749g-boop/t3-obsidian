import {test} from 'node:test';
import assert from 'node:assert/strict';
import {connectT3Rpc,type RpcClock,type T3Api} from '../src/connection/t3-rpc';
import {T3ResponseTooLargeError} from '../src/connection/t3-response-limits';

const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function fixture(){
  let now=0,serial=0,closes=0,pongs=true;const timers=new Map<number,{at:number;fn:()=>void}>(),requests:any[]=[];
  const time:RpcClock={now:()=>now,timer:(fn,ms)=>{const id=++serial;timers.set(id,{at:now+ms,fn});return id as any;},clear:id=>{timers.delete(id as any);}};
  const emit=(frame:any)=>ws.onmessage?.({data:JSON.stringify(frame)});
  const ws:any={send:(raw:string)=>{const frame=JSON.parse(raw);requests.push(frame);if(frame._tag==='Ping'&&pongs)emit({_tag:'Pong'});},close:()=>{closes++;ws.onclose?.();}};
  const open=(observe?:T3Api['trackConnection'])=>connectT3Rpc(Object.assign(async()=>({ticket:'synthetic-only'}),{trackConnection:observe}),'https://synthetic.example',()=>{queueMicrotask(()=>ws.onopen?.());return ws;},time);
  const advance=async(ms:number)=>{
    const until=now+ms;
    for(;;){const next=[...timers].filter(([,t])=>t.at<=until).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;now=next[1].at;timers.delete(next[0]);next[1].fn();await flush();}
    now=until;await flush();
  };
  return {open,advance,requests,emit,reply:(id:string,value:any)=>emit({_tag:'Exit',requestId:id,exit:{_tag:'Success',value}}),silent:()=>{pongs=false;},closes:()=>closes,timers};
}

test('elapsed time does not fail a silent open socket or its pending requests',async()=>{
 const h=fixture(),seen:Array<{readonly closed:boolean}>=[],rpc=await h.open(connection=>seen.push(connection));h.silent();
 const pending=rpc.call('projects.readFile',{});await flush();await h.advance(150_000);
 assert.equal(rpc.closed,false);assert.equal(seen[0].closed,false);assert.equal(h.closes(),0);
 h.reply('1','late result');assert.equal(await pending,'late result');rpc.close();
});

test('unary final replies above the former limit work and oversized errors retain their size identity',async()=>{
 const h=fixture(),rpc=await h.open();const accepted=rpc.call('orchestration.getTurnItem',{threadId:'thread',itemId:'item'});h.reply('1',{text:'x'.repeat(4_100_000)});const value=await accepted;assert.ok(value&&typeof value==='object'&&'text' in value&&typeof value.text==='string');assert.equal(value.text.length,4_100_000);
 const blocked=rpc.call('orchestration.getTurnItem',{threadId:'thread',itemId:'large'}),rejected=assert.rejects(blocked,T3ResponseTooLargeError);h.reply('2',{text:'x'.repeat(8_000_001)});await rejected;assert.equal(rpc.closed,true);assert.equal(h.timers.size,0);
});

test('a slow request survives while independent requests finish and a real close fails pending work',async()=>{
 const h=fixture(),rpc=await h.open(),slow=rpc.call('projects.readFile',{});await flush();
 const fast=rpc.call('projects.writeFile',{});await flush();h.reply('2',{saved:true});assert.deepEqual(await fast,{saved:true});
 await h.advance(150_000);assert.equal(rpc.closed,false);h.reply('1','late');assert.equal(await slow,'late');
 const stopped=rpc.call('projects.readFile',{});await flush();const rejected=assert.rejects(stopped,/closed/);rpc.close();await rejected;
 assert.equal(rpc.closed,true);assert.equal(h.closes(),1);assert.equal(h.timers.size,0);
});

test('MCP provider permission failures remain actionable without closing the connection',async()=>{
 const h=fixture(),rpc=await h.open(),pending=rpc.call('server.updateSettings',{});
 const rejected=assert.rejects(pending,(error:any)=>error.requiredPermission==='providers:manage'&&error.message.includes('MCP setup'));
 h.emit({_tag:'Exit',requestId:'1',exit:{_tag:'Failure',cause:[{_tag:'Fail',error:{_tag:'EnvironmentAuthorizationError',requiredPermission:'providers:manage'}}]}});
 await rejected;assert.equal(rpc.closed,false);rpc.close();
});
