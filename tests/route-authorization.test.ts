import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RouteAuthorizationCache,verifyOrchestrationRead} from '../src/connection/route-authorization';

test('route identity and authorization setup is shared, bounded, and expires',async()=>{
 let now=0,creates=0;const cache=new RouteAuthorizationCache<object>(()=>now);
 const create=async()=>({generation:++creates});
 const first=cache.open('route',create);
 assert.equal(cache.open('route',create),first);assert.deepEqual(await first,{generation:1});
 now=29_999;assert.equal(cache.open('route',create),first);
 now=30_000;assert.deepEqual(await cache.open('route',create),{generation:2});
 assert.deepEqual(await cache.open('route',create,true),{generation:3});
 cache.delete('route');assert.deepEqual(await cache.open('route',create),{generation:4});
 for(let i=0;i<16;i++)await cache.open('other'+i,create);
 assert.deepEqual(await cache.open('route',create),{generation:21});
});

test('a connection setup expires before its credential',async()=>{
 let now=0,creates=0;const cache=new RouteAuthorizationCache<number>(()=>now),create=async()=>++creates;
 assert.equal(await cache.open('route',create,false,5000),1);
 now=5000;assert.equal(await cache.open('route',create,false,5000),2);
});

test('a failed older setup cannot evict its pending replacement',async()=>{
 let reject!:(error:Error)=>void;const cache=new RouteAuthorizationCache<number>();
 const old=cache.open('route',()=>new Promise((_resolve,rejectOld)=>{reject=rejectOld;}));
 await Promise.resolve();
 const replacement=cache.open('route',async()=>2,true);
 reject(Error('Old route failed'));await assert.rejects(old,/Old route failed/);
 assert.equal(cache.open('route',async()=>3),replacement);assert.equal(await replacement,2);
});

test('failed setup is retried and changed credentials have a separate identity',async()=>{
 const cache=new RouteAuthorizationCache<number>();
 await assert.rejects(cache.open('old token',async()=>{throw Error('Denied');}),/Denied/);
 assert.equal(await cache.open('old token',async()=>1),1);
 assert.equal(await cache.open('new token',async()=>2),2);
});

for(const grants of [{permissions:['orchestration:read']},{scopes:['orchestration:read']}])test('authorized session metadata does not wait for the thread catalog: '+JSON.stringify(grants),async()=>{
 const paths:string[]=[];
 await verifyOrchestrationRead(async path=>{
  paths.push(path);assert.equal(path,'/api/auth/session','a valid session needs no bulk shell read');
  return {authenticated:true,...grants};
 });
 assert.deepEqual(paths,['/api/auth/session']);
});

for(const state of [undefined,{authenticated:false},{authenticated:true,permissions:[],scopes:['orchestration:read']},{authenticated:true,permissions:['filesystem:read']},{authenticated:true,permissions:null,scopes:['orchestration:read']}])test('unknown or insufficient metadata keeps the exact server authorization failure: '+JSON.stringify(state),async()=>{
 const paths:string[]=[],denied=Object.assign(Error('Scope denied'),{status:403});
 await assert.rejects(verifyOrchestrationRead(async path=>{
  paths.push(path);if(path==='/api/auth/session')return state;
  assert.equal(path,'/api/orchestration/shell');throw denied;
 }),error=>error===denied);
 assert.deepEqual(paths,['/api/auth/session','/api/orchestration/shell']);
});

test('a server without session metadata keeps its authenticated legacy probe',async()=>{
 const paths:string[]=[];
 await verifyOrchestrationRead(async path=>{paths.push(path);if(path==='/api/auth/session')throw Object.assign(Error('Missing'),{status:404});return {};});
 assert.deepEqual(paths,['/api/auth/session','/api/orchestration/shell']);
});

for(const status of [401,403,500])test('session transport and authorization errors remain failures without a bulk read: '+status,async()=>{
 const paths:string[]=[],failure=Object.assign(Error('Session request failed'),{status});
 await assert.rejects(verifyOrchestrationRead(async path=>{paths.push(path);throw failure;}),error=>error===failure);
 assert.deepEqual(paths,['/api/auth/session']);
});
