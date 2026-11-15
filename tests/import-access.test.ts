import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readImportAccess} from '../src/conversations/import-access';
import type {ThreadAccess} from '../src/conversations/thread-stream';

function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(yes=>{resolve=yes;});return {promise,resolve};}
const drain=()=>new Promise<void>(resolve=>setImmediate(resolve));
function access(closed:string[]):ThreadAccess{return {origin:'https://synthetic.invalid',api:async()=>({}),close:reason=>{closed.push(reason!);}};}

test('cancelled connection setup returns promptly and closes late access exactly once',async()=>{
 const controller=new AbortController(),opening=deferred<ThreadAccess>(),closed:string[]=[];let reads=0;
 const work=readImportAccess(()=>opening.promise,async()=>{reads++;return 'unexpected';},controller.signal);
 controller.abort();await assert.rejects(work,{name:'AbortError'});
 opening.resolve(access(closed));await drain();assert.equal(reads,0);assert.deepEqual(closed,['late-access']);
});

test('cancellation releases acquired access even if its read ignores the signal',async()=>{
 const controller=new AbortController(),closed:string[]=[],pending=deferred<string>();let reading=false;
 const work=readImportAccess(async()=>access(closed),()=>{reading=true;return pending.promise;},controller.signal);
 await drain();assert.equal(reading,true);controller.abort();await assert.rejects(work,{name:'AbortError'});assert.deepEqual(closed,['caller-closed']);
 pending.resolve('obsolete');await drain();assert.deepEqual(closed,['caller-closed']);
});

test('successful and failed reads release access while pre-cancelled reads do not open it',async()=>{
 const closed:string[]=[];
 assert.equal(await readImportAccess(async()=>access(closed),async()=>42),42);
 await assert.rejects(readImportAccess(async()=>access(closed),async()=>{throw Error('Read failed');}),/Read failed/);
 assert.deepEqual(closed,['caller-closed','caller-closed']);
 const controller=new AbortController();controller.abort();
 await assert.rejects(readImportAccess(async()=>{assert.fail('Do not start cancelled setup');},async()=>42,controller.signal),{name:'AbortError'});
});
