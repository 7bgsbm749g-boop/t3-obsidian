import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from './obsidian-context';
import {webcrypto} from 'node:crypto';
import {settingsSocket} from './rpc-fixture';
async function fixture(mobile=false,intercept?:(url:string,options:any)=>Promise<Response|undefined>,socket?:unknown){
 const requests:Array<{url:string;method:string;token?:string}>=[],sessions:string[]=[];let rejectDispatch=false;
 class Base{}
 const module={exports:{} as any},api={Plugin:Base,Modal:Base,FuzzySuggestModal:Base,EditorSuggest:Base,ItemView:Base,PluginSettingTab:Base,Notice:Base,Platform:{isMobile:mobile}};
 runInNewContext(await readFile('dist/main.js','utf8'),{module,exports:module.exports,require:(name:string)=>{assert.equal(name,'obsidian','No native connection module may load');return api;},
 fetch:async(url:string,options:any)=>{const origin=new URL(url).origin,token=options?.headers?.Authorization;requests.push({url,method:options?.method??'GET',token});
  const intercepted=await intercept?.(url,options);if(intercepted)return intercepted;
  if(url.endsWith('/.well-known/t3/environment'))return new Response(JSON.stringify({environmentId:origin.includes('other')?'other':'target',label:'Synthetic',orchestrationProtocolVersion:2}));
  if(token==='Bearer revoked'||rejectDispatch&&options?.method==='POST')return new Response('{}',{status:401});
  if(url.endsWith('/shell'))return new Response(JSON.stringify({projects:[],threads:[]}));
  return new Response(JSON.stringify({thread:{id:'thread',projectId:'project',messages:[{role:'assistant',text:'Remote reply'}]}}));
 },WebSocket:socket,document:{createElement:()=>({innerHTML:'',get textContent(){return this.innerHTML;}})},URL,URLSearchParams,Headers,Response,AbortController,TextEncoder,TextDecoder,crypto:webcrypto,setTimeout,clearTimeout,console});
 const plugin=new module.exports.default(),remote={id:'remote',environmentId:'target',name:'Target',url:'https://remote.example'},tokens:Record<string,string>={remote:'valid'};
 plugin.settings={paired:[remote],folderLinks:[],connection:{}};
 plugin.sessionFor=async(id:string)=>{sessions.push(id);const connection=plugin.settings.paired.find((value:any)=>value.id===id),stored=plugin.pairedSessions[id];if(!tokens[id])return undefined;if(stored?.token===tokens[id]&&stored.url===connection.url&&stored.environmentId===connection.environmentId)return stored;return plugin.pairedSessions[id]={token:tokens[id],expiresAt:Date.now()+600_000,environmentId:connection.environmentId,url:connection.url};};
 return {plugin,requests,sessions,remote,tokens,failDispatch:()=>rejectDispatch=true};
}
for(const mobile of [false,true])test(`${mobile?'mobile':'desktop without a local T3 process'} uses authenticated remote access`,async()=>{
 const f=await fixture(mobile),access=await f.plugin.inlineThreadAccess('target'),result=await access.api('/api/orchestration/threads/thread?turnLimit=20');assert.equal(result.thread.messages[0].text,'Remote reply');assert.equal(access.origin,f.remote.url);assert.ok(f.requests.some(request=>request.url.endsWith('/shell')),'authorization must be checked before exposing the route');assert.deepEqual(f.sessions,['remote']);
});
test('an authenticated loopback endpoint wins without CLI access; stale credentials fall back only to the same machine',async()=>{
 for(const token of ['valid','revoked']){const f=await fixture();f.plugin.settings.paired.push({...f.remote,id:'local',url:'http://127.0.0.1:3773'});f.tokens.local=token;
  const access=await f.plugin.inlineThreadAccess('target');assert.equal(access.origin,token==='valid'?'http://127.0.0.1:3773':f.remote.url);assert.deepEqual(f.sessions,token==='valid'?['local']:['local','remote']);
 }
});
test('unpaired or changed environment identities cannot reach another machine',async()=>{
 const f=await fixture();await assert.rejects(f.plugin.inlineThreadAccess('unpaired'),/Connect this device/);assert.equal(f.requests.length,0);f.plugin.settings.paired=[{...f.remote,url:'https://other.example'}];await assert.rejects(f.plugin.inlineThreadAccess('target'),/different T3 environment/);assert.ok(f.requests.every(request=>request.url.endsWith('/.well-known/t3/environment')));
});
test('a lost or rejected mutation is never rerouted or replayed',async()=>{
 const f=await fixture();f.plugin.settings.paired.push({...f.remote,id:'spare',url:'https://spare.example'});f.tokens.spare='valid';const access=await f.plugin.inlineThreadAccess('target');f.failDispatch();await assert.rejects(access.api('/api/orchestration/dispatch',{type:'thread.turn.interrupt'}));assert.equal(f.requests.filter(request=>request.method==='POST').length,1);assert.deepEqual(f.sessions,['remote']);
});
test('catalog credentials select the same endpoint for reply access before discovery',async()=>{
 const f=await fixture();f.plugin.settings.paired.unshift({...f.remote,id:'stale',url:'https://stale.example'});f.tokens.stale='revoked';f.plugin.pairedSessions.remote={token:'valid',expiresAt:Date.now()+600_000,environmentId:'target',url:f.remote.url};assert.equal((await f.plugin.inlineThreadAccess('target')).origin,f.remote.url);assert.deepEqual(f.sessions,['remote']);
});
test('an offline command host does not hold up polling a ready paired client',async()=>{
 const f=await fixture();let release!:()=>void,readyTicks=0;const pending=new Promise<void>(resolve=>{release=resolve;});
 f.plugin.commandHosts.set('offline',{host:{tick:()=>pending}});f.plugin.commandHosts.set('ready',{host:{tick:async()=>{readyTicks++;}}});
 f.plugin.tickCommandHosts();await Promise.resolve();f.plugin.tickCommandHosts();await Promise.resolve();f.plugin.tickCommandHosts();await Promise.resolve();
 assert.equal(readyTicks,3);release();f.plugin.commandHosts.clear();
});

test('stopped route waiter preserves shared authorization and does not mark the route offline',async()=>{
 let reply!:(value:Response)=>void;
 const f=await fixture(false,async url=>url.endsWith('/environment')?new Promise(resolve=>{reply=resolve;}):undefined);
 const stop=new AbortController(),first=f.plugin.pairedThreadAccess(f.remote,false,stop.signal),second=f.plugin.pairedThreadAccess(f.remote);
 await new Promise(resolve=>setImmediate(resolve));stop.abort(Error('Stopped'));
 await assert.rejects(first,/Stopped/);assert.equal(f.plugin.unaryOwners.size,1);assert.equal(f.plugin.routeFailures.size,0);
 reply(new Response(JSON.stringify({environmentId:'target',label:'Synthetic',orchestrationProtocolVersion:2})));
 assert.equal((await second).origin,f.remote.url);assert.equal(f.requests.filter(r=>r.url.endsWith('/environment')).length,1);
 f.plugin.disposeUnaryOwners();
});

test('safe read renewal stays shared when one reader stops, and verifies the fresh endpoint',async()=>{
 let reply!:()=>void,renewals=0;
 const f=await fixture(false,async(url,options)=>url.endsWith('/api/probe')&&options.headers.Authorization==='Bearer old'?new Response('{}',{status:401}):undefined);
 Object.assign(f.remote,{managed:true});
 let credential={token:'old',expiresAt:Date.now()+600_000,environmentId:'target',url:f.remote.url};
 f.plugin.sessionFor=async(_id:string,force:boolean)=>{
  if(force){renewals++;await new Promise<void>(resolve=>{reply=resolve;});credential={...credential,token:'new'};}
  return credential;
 };
 const chosen=await f.plugin.pairedThreadAccess(f.remote),stop=new AbortController();
 const first=chosen.api('/api/probe',undefined,{signal:stop.signal}),second=chosen.api('/api/probe');
 await new Promise(resolve=>setImmediate(resolve));assert.equal(renewals,1);
 stop.abort(Error('Stopped'));await assert.rejects(first,/Stopped/);assert.equal(f.plugin.routeFailures.size,0);
 reply();await second;assert.equal(renewals,1);assert.equal(f.requests.filter(r=>r.url.endsWith('/environment')).length,2);
 assert.equal(f.requests.filter(r=>r.url.endsWith('/api/probe')&&r.token==='Bearer new').length,1);
 f.plugin.disposeUnaryOwners();
});

for(const openedFresh of [false,true])test(`cached access refreshes rotated credentials before HTTP and unary operations (${openedFresh?'another adapter opened':'activity preparation only'})`,async()=>{
 let calls=0;
 const Socket=settingsSocket(undefined,undefined,()=>{calls++;return {accepted:true};});
 const f=await fixture(false,async url=>url.endsWith('/websocket-ticket')?new Response(JSON.stringify({ticket:'fixture'})):undefined,Socket);
 try{
  const old=await f.plugin.pairedThreadAccess(f.remote);
  const first=await old.api.acquireUnaryRpc();await first.call('orchestration.dispatchCommand',{command:{type:'thread.visit',threadId:'thread'}});first.close();
  f.tokens.remote='new';f.plugin.pairedSessions.remote={token:'new',expiresAt:Date.now()+600_000,environmentId:'target',url:f.remote.url};
  const fresh=openedFresh?await f.plugin.pairedThreadAccess(f.remote):undefined;
  await Promise.all([old.api('/api/probe'),old.api('/api/probe')]);
  const next=await old.api.acquireUnaryRpc();await next.call('orchestration.dispatchCommand',{command:{type:'thread.visit',threadId:'thread'}});next.close();
  if(fresh){const other=await fresh.api.acquireUnaryRpc();await other.call('orchestration.dispatchCommand',{command:{type:'thread.visit',threadId:'thread'}});other.close();}
  assert.ok(f.requests.filter(r=>r.url.endsWith('/api/probe')).every(r=>r.token==='Bearer new'));
  assert.equal(f.requests.filter(r=>r.url.endsWith('/environment')).length,2,'One verified setup per credential, not per operation');
  assert.equal(f.requests.filter(r=>r.url.endsWith('/websocket-ticket')).length,2,'The fresh adapters still share one socket');
  assert.equal(calls,fresh?3:2);
 }finally{f.plugin.disposeUnaryOwners();}
});

test('credential rotation rejects an in-flight mutation without replaying it through fresh access',async()=>{
 let sent=0,reply!:(v:unknown)=>void;
 const Socket=settingsSocket(undefined,undefined,()=>{sent++;return new Promise(resolve=>reply=resolve);});
 const f=await fixture(false,async url=>url.endsWith('/websocket-ticket')?new Response(JSON.stringify({ticket:'fixture'})):undefined,Socket);
 try{
  const access=await f.plugin.pairedThreadAccess(f.remote),lease=await access.api.acquireUnaryRpc();
  const pending=lease.call('orchestration.dispatchCommand',{command:{type:'thread.visit',threadId:'thread'}}),rejected=assert.rejects(pending,/stopped|released|closed/);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(sent,1);
  f.tokens.remote='new';await f.plugin.pairedThreadAccess(f.remote);await rejected;lease.close();reply({accepted:true});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(sent,1);
  const next=await access.api.acquireUnaryRpc();next.close();assert.equal(sent,1,'Refreshing acquisition never repeats a sent operation');
 }finally{f.plugin.disposeUnaryOwners();}
});

test('cached access refuses a removed or replaced route before sending any operation',async()=>{
 for(const mode of ['removed','endpoint','environment','stopped']){
  const f=await fixture();try{
   const access=await f.plugin.pairedThreadAccess(f.remote),before=f.requests.length;
   if(mode==='removed')f.plugin.settings.paired=[];
   if(mode==='endpoint')f.remote.url='https://other.example';
   if(mode==='environment')f.remote.environmentId='other';
   if(mode==='stopped')f.plugin.stopped=true;
   await assert.rejects(access.api('/api/probe'),/changed|stopped|unavailable/);
   await assert.rejects(access.api.acquireUnaryRpc(),/changed|stopped|unavailable/);
   assert.equal(f.requests.length,before);
  }finally{f.plugin.disposeUnaryOwners();}
 }
});

test('ticket renewal replaces the rejected pool even when issuance returns the same credential',async()=>{
 let tickets=0;
 const Socket=settingsSocket(undefined,undefined,()=>({accepted:true}));
 const f=await fixture(false,async url=>url.endsWith('/websocket-ticket')?(++tickets===1?new Response('{}',{status:401}):new Response(JSON.stringify({ticket:'fixture'}))):undefined,Socket);
 Object.assign(f.remote,{managed:true});
 try{
  const access=await f.plugin.pairedThreadAccess(f.remote),lease=await access.api.acquireUnaryRpc();
  await lease.call('orchestration.dispatchCommand',{command:{type:'thread.visit',threadId:'thread'}});lease.close();assert.equal(tickets,2);
  const next=await access.api.acquireUnaryRpc();next.close();assert.equal(tickets,2,'Later work reuses the renewed socket');
 }finally{f.plugin.disposeUnaryOwners();}
});

test('a route changed during stale-access refresh cannot send the waiting operation',async()=>{
 let block=false,reply!:(value:Response)=>void;
 const f=await fixture(false,async url=>block&&url.endsWith('/environment')?new Promise(resolve=>reply=resolve):undefined);
 try{
  const access=await f.plugin.pairedThreadAccess(f.remote);f.tokens.remote='new';
  f.plugin.pairedSessions.remote={token:'new',expiresAt:Date.now()+600_000,environmentId:'target',url:f.remote.url};block=true;
  const pending=access.api('/api/probe'),rejected=assert.rejects(pending,/changed/);
  await new Promise(resolve=>setImmediate(resolve));assert.ok(reply);
  f.remote.url='https://other.example';reply(new Response(JSON.stringify({environmentId:'target',orchestrationProtocolVersion:2})));
  await rejected;assert.equal(f.requests.filter(r=>r.url.endsWith('/api/probe')).length,0);
 }finally{f.plugin.disposeUnaryOwners();}
});
