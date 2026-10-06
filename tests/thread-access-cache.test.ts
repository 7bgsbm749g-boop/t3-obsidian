import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {T3HttpError,ThreadAccessCache} from '../thread-access-cache';
import {requestJson} from '../desktop';
import {interruptStoppedResponse} from '../response-stop';

const rejected=()=>new T3HttpError(401,'T3 API returned HTTP 401.');
const path='/api/orchestration/threads/test?turnLimit=20';
const defer=<T>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};};

test('loopback HTTP errors retain their status without exposing the rejected response',async()=>{
  const server=createServer((_request,response)=>{response.writeHead(401);response.end('PRIVATE_RESPONSE');});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try{
    const address=server.address() as {port:number};
    await assert.rejects(requestJson(`http://127.0.0.1:${address.port}`,'PRIVATE_TOKEN',path),error=>{
      assert.ok(error instanceof T3HttpError);assert.equal(error.status,401);assert.doesNotMatch(String(error),/PRIVATE_RESPONSE|PRIVATE_TOKEN/);return true;
    });
  }finally{server.closeAllConnections();server.close();await once(server,'close');}
});

test('concurrent rejected reads share one immediate refresh before the three-minute TTL',async()=>{
  let creates=0,oldCloses=0;const reasons:string[]=[];
  const cache=new ThreadAccessCache(async(_environment,reason)=>{
    const generation=++creates;if(reason)reasons.push(reason);
    return {origin:'https://test',api:async()=>{if(generation===1)throw rejected();return {progress:'Recovered'};},close:async()=>{if(generation===1)oldCloses++;}};
  });
  try{
    const access=await cache.get('env');
    assert.deepEqual(await Promise.all(Array.from({length:16},()=>access.api(path))),Array.from({length:16},()=>({progress:'Recovered'})));
    assert.equal(creates,2);assert.equal(oldCloses,1);assert.deepEqual(reasons,['auth-rejected']);
  }finally{await cache.dispose();}
});

test('a late rejection from the old credential cannot revoke the replacement',async()=>{
  let creates=0;const gate=defer<void>(),entered=defer<void>(),closed:number[]=[];
  const cache=new ThreadAccessCache(async()=>{
    const generation=++creates;
    return {origin:'https://test',api:async(readPath:string)=>{if(generation===1){if(readPath.endsWith('slow')){entered.resolve();await gate.promise;}throw rejected();}return generation;},close:()=>{closed.push(generation);}};
  });
  try{
    const access=await cache.get('env'),slow=access.api(path+'slow');await entered.promise;
    assert.equal(await access.api(path),2);gate.resolve();assert.equal(await slow,2);
    assert.equal(creates,2);assert.deepEqual(closed,[1]);assert.equal(await access.api(path),2);
  }finally{gate.resolve();await cache.dispose();}
});

for(const timeout of [false,true])test(`stopping a borrowed response ${timeout?'at its deadline':'successfully'} keeps every other reader authorized`,async()=>{
  let closes=0,creates=0;const commands:any[]=[],releases:string[]=[];
  const cache=new ThreadAccessCache(async()=>{
    creates++;return {origin:'https://test',api:async(_path,payload)=>{
      if(payload){commands.push(payload);if(timeout)return new Promise(()=>{});return {};}
      assert.equal(closes,0,'the shared session is still valid');return {progress:'Other response still streams'};
    },close:()=>{closes++;},trace:(event,reason)=>{if(event==='borrow-released')releases.push(reason!);}};
  });
  try{
    const work=interruptStoppedResponse(()=>cache.get('env'),randomUUID(),'stopped-thread','turn',5);
    if(timeout)await assert.rejects(work,/did not acknowledge/);else await work;
    assert.equal(commands.length,1);assert.equal(commands[0].type,'thread.turn.interrupt');
    assert.deepEqual(await (await cache.get('env')).api(path),{progress:'Other response still streams'});
    assert.equal(creates,1);assert.equal(closes,0);assert.deepEqual(releases,[timeout?'stop-timeout':'stop-complete']);
  }finally{await cache.dispose();assert.equal(closes,1);}
});

test('dispatch rejection is never replayed and only a subsequent read refreshes access',async()=>{
  let creates=0,dispatches=0;
  const cache=new ThreadAccessCache(async()=>{
    const generation=++creates;
    return {origin:'https://test',api:async(_path,payload)=>{if(payload){dispatches++;throw rejected();}return generation;}};
  });
  try{
    const access=await cache.get('env');
    await assert.rejects(access.api('/api/orchestration/dispatch',{type:'thread.turn.start',messageId:'unchanged'}),T3HttpError);
    assert.equal(dispatches,1);assert.equal(creates,1);assert.equal(await access.api(path),2);assert.equal(dispatches,1);
  }finally{await cache.dispose();}
});

test('a rejected stream ticket recovers once while permission and server failures are not retried',async()=>{
  for(const status of [401,403,500]){
    let creates=0,calls=0;
    const cache=new ThreadAccessCache(async()=>{const generation=++creates;return {origin:'https://test',api:async()=>{calls++;if(generation===1)throw new T3HttpError(status,'T3 request rejected.');return {ticket:'new'};}};});
    try{
      const work=(await cache.get('env')).api('/api/auth/websocket-ticket',{});
      if(status===401){assert.deepEqual(await work,{ticket:'new'});assert.equal(creates,2);assert.equal(calls,2);}
      else {await assert.rejects(work,T3HttpError);assert.equal(creates,1);assert.equal(calls,1);}
    }finally{await cache.dispose();}
  }
});

test('a persistently rejected replacement is bounded to one retry and a cooldown',async()=>{
  let creates=0,now=0;const cache=new ThreadAccessCache(async()=>{creates++;return {origin:'https://test',api:async()=>{throw rejected();}};},()=>now);
  try{
    const access=await cache.get('env');await assert.rejects(access.api(path),T3HttpError);assert.equal(creates,2);
    await assert.rejects(access.api(path),T3HttpError);assert.equal(creates,2,'failed credentials cannot churn in a tight loop');
    now=5001;await assert.rejects(access.api(path),T3HttpError);assert.equal(creates,4,'a later poll permits one new attempt and one retry');
  }finally{await cache.dispose();}
});

test('failed cleanup and failed issuance do not strand the cache opening promise',async()=>{
  let creates=0;
  const cache=new ThreadAccessCache(async()=>{
    const generation=++creates;if(generation===2)throw Error('Temporary CLI failure');
    return {origin:'https://test',api:async()=>{if(generation===1)throw rejected();return generation;},close:()=>{throw Error('Already closed');}};
  });
  try{
    const access=await cache.get('env');await assert.rejects(access.api(path),/Temporary CLI failure/);
    assert.equal(await access.api(path),3);assert.equal(creates,3);
  }finally{await cache.dispose();}
});

test('expiry follows the actual credential deadline and shutdown closes a late factory result once',async()=>{
  let creates=0,now=0;const closes:string[]=[],gate=defer<any>();
  const cache=new ThreadAccessCache(async()=>{
    if(++creates===2)return gate.promise;
    return {origin:'https://test',expiresAt:20000,api:async()=>({}),close:(reason)=>{closes.push(reason!);}};
  },()=>now);
  const access=await cache.get('env');now=15001;const renewal=access.api(path);
  await new Promise(resolve=>setImmediate(resolve));const closing=cache.dispose();
  await closing;
  gate.resolve({origin:'https://test',api:async()=>({}),close:(reason:string)=>{closes.push(reason);}});
  await assert.rejects(renewal,/host has stopped/);await closing;await cache.dispose();
  assert.deepEqual(closes,['cache-expired','late-access']);await assert.rejects(cache.get('env'),/host has stopped/);
});
