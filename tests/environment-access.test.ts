import {test} from 'node:test';
import assert from 'node:assert/strict';
import {environmentAccess,type EnvironmentAccessIO} from '../src/connection/environment-access';
import type {ThreadAccess} from '../src/conversations/thread-stream';

type Equal<A,B>=(<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2)?true:false;
type Expect<T extends true>=T;
// The strict build checks these contracts, including accidental widening to any.
export type AccessTypeContracts=[
  Expect<Equal<Awaited<ReturnType<typeof environmentAccess>>,ThreadAccess>>,
  Expect<Equal<Awaited<ReturnType<ThreadAccess['api']>>,unknown>>,
  Expect<Equal<Parameters<ThreadAccess['api']>[1],unknown>>,
];

const connection={id:'paired',environmentId:'target',name:'Target',url:'https://target.example'};
const access=(origin:string):ThreadAccess=>({origin,api:async()=>({ok:true})});

test('a verified local identity takes priority over account and pairing state',async()=>{
  const local=access('http://127.0.0.1:3773');
  const io:EnvironmentAccessIO={local:{identify:async()=> 'target',open:async()=>local},paired:[connection],openPaired:async()=>{assert.fail('Local access must not require an account');}};
  assert.equal(await environmentAccess('target',io),local);
});

test('local access establishment can fall back to a pairing for that exact machine',async()=>{
  const remote=access(connection.url),calls:string[]=[];
  const io:EnvironmentAccessIO={local:{identify:async()=> 'target',open:async()=>{calls.push('local');throw Error('CLI unavailable');}},paired:[{...connection,environmentId:'other'},connection],openPaired:async selected=>{assert.equal(selected,connection);calls.push('paired');return remote;}};
  assert.equal(await environmentAccess('target',io),remote);assert.deepEqual(calls,['local','paired']);
});

test('a local credential error is retained when there is no route to the same machine',async()=>{
  const failure=Error('Local credential unavailable');
  const io:EnvironmentAccessIO={local:{identify:async()=> 'target',open:async()=>{throw failure;}},paired:[{...connection,environmentId:'other'}],openPaired:async()=>{assert.fail('Never connect to another machine');}};
  await assert.rejects(environmentAccess('target',io),error=>error===failure);
});

test('remote and mobile access do not open local credentials',async()=>{
  const remote=access(connection.url);
  for(const identify of [undefined,async()=>undefined,async()=> 'different',async():Promise<string|undefined>=>{throw Error('Local T3 stopped');}]){
    const io:EnvironmentAccessIO={...(identify?{local:{identify,open:async()=>{assert.fail('Do not open local credentials for another machine');}}}:{}),paired:[connection],openPaired:async()=>remote};
    assert.equal(await environmentAccess('target',io),remote);
  }
});

test('an unavailable target cannot resolve through an unrelated pairing',async()=>{
  const io:EnvironmentAccessIO={paired:[connection],openPaired:async()=>{assert.fail('Never connect to another machine');}};
  await assert.rejects(environmentAccess('other',io),/Connect this device to the thread machine/);
});

test('an unusable saved endpoint cannot hide a working connection to the same environment',async()=>{
  const remote=access(connection.url),stale={...connection,id:'stale',url:'https://stale.example'},calls:string[]=[];
  const io:EnvironmentAccessIO={paired:[stale,{...connection,environmentId:'other'},connection],openPaired:async selected=>{calls.push(selected.id);if(selected===stale)throw Error('Expired pairing');return remote;}};
  assert.equal(await environmentAccess('target',io),remote);assert.deepEqual(calls,['stale','paired']);
});

test('a caller operation is never replayed or rerouted after access was established',async()=>{
  const failure=Error('Reply lost after dispatch'),calls:unknown[]=[],local:ThreadAccess={origin:'http://127.0.0.1:3773',api:async(path,payload)=>{calls.push({path,payload});throw failure;}};
  const io:EnvironmentAccessIO={local:{identify:async()=> 'target',open:async()=>local},paired:[connection],openPaired:async()=>{assert.fail('Never reroute an accepted operation');}};
  const chosen=await environmentAccess('target',io),command={type:'thread.turn.start',commandId:'stable-id'};
  await assert.rejects(chosen.api('/api/orchestration/dispatch',command),error=>error===failure);
  assert.deepEqual(calls,[{path:'/api/orchestration/dispatch',payload:command}]);
});
