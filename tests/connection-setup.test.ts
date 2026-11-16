import {test} from 'node:test';
import assert from 'node:assert/strict';
import {connectionDeadline,setupFetcher,ConnectionPreparation,CONNECTION_SETUP_MS} from '../src/connection/connection-setup';

test('setup deadline bounds an uncooperative transport and fences late credential rotation',async context=>{
 context.mock.timers.enable({apis:['setTimeout']});
 let reply!:(value:Response)=>void,signal!:AbortSignal,rotations=0;
 const work=connectionDeadline(async owned=>{
  signal=owned;
  const result=await setupFetcher(async()=>new Promise(resolve=>{reply=resolve;}),owned)('https://synthetic.example');
  if(result.headers.has('authorization'))rotations++;
 });
 await Promise.resolve();
 const rejected=assert.rejects(work,/connection setup timed out/);
 context.mock.timers.tick(CONNECTION_SETUP_MS);await rejected;assert.equal(signal.aborted,true);
 reply(new Response('{}',{headers:{authorization:'synthetic-rotation'}}));
 await new Promise(resolve=>setImmediate(resolve));assert.equal(rotations,0);
});

test('a stalled setup body is bounded; owner cancellation prevents further requests',async context=>{
 context.mock.timers.enable({apis:['setTimeout']});
 let bodyRead=false;
 const work=connectionDeadline(async signal=>setupFetcher(async()=>({text:()=>{bodyRead=true;return new Promise<string>(()=>{});}} as Response),signal)('https://synthetic.example'));
 await new Promise(resolve=>setImmediate(resolve));assert.equal(bodyRead,true);
 const rejected=assert.rejects(work,/timed out/);context.mock.timers.tick(CONNECTION_SETUP_MS);await rejected;
 const owner=new AbortController();owner.abort(Error('Account changed'));
 await assert.rejects(connectionDeadline(async()=>{assert.fail('No request after owner cancellation');},owner.signal),/Account changed/);
});

test('activity preparation coalesces, cools down after failure and runs only on a later event',async()=>{
 let now=0,attempts=0,finish!:()=>void;
 const preparation=new ConnectionPreparation(()=>now),run=async()=>{attempts++;await new Promise<void>(resolve=>{finish=resolve;});throw Error('Offline');};
 const first=preparation.prepare(run);assert.equal(preparation.prepare(run),first);
 await Promise.resolve();assert.equal(attempts,1);finish();await assert.rejects(first,/Offline/);
 await preparation.prepare(run);assert.equal(attempts,1);now=30_000;assert.equal(attempts,1,'No timer or autonomous retry');
 await preparation.prepare(async()=>{attempts++;});assert.equal(attempts,2);
});
