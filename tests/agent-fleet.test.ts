import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AgentFleet,type FleetHost} from '../src/agents/fleet';
import type {AgentProvider,AgentStatus} from '../src/agents/setup';

const codex:AgentProvider={id:'codex',driver:'codex',name:'Codex'};
const cursor:AgentProvider={id:'cursor',driver:'cursor',name:'Cursor'};
function lab(){
  const status=new Map<string,AgentStatus>(),calls:{machine:string;agent:string;runtime?:string;kind:string}[]=[];
  const host:FleetHost={
    machines:()=>[{id:'linux',name:'Server'},{id:'windows',name:'Laptop'}],
    inspect:async id=>({providers:[codex,cursor],unsupported:[],windows:id==='windows'}),
    status:async(id,provider)=>({...status.get(id+':'+provider.id)??{installed:false,owned:false}}),
    install:async(id,provider,runtime)=>{calls.push({machine:id,agent:provider.id,runtime,kind:'connect'});status.set(id+':'+provider.id,{installed:true,owned:true});},
    remove:async(id,provider)=>{calls.push({machine:id,agent:provider.id,kind:'disconnect'});status.set(id+':'+provider.id,{installed:false,owned:false});},
  };
  return {host,status,calls,fleet:new AgentFleet(host)};
}
test('background detection is read-only, coalesced and deduplicates routes to the same machine',async()=>{
  const h=lab();h.host.machines=()=>[{id:'linux',name:'Server'},{id:'linux',name:'Another route'}];
  let reads=0;const inspect=h.host.inspect;h.host.inspect=async id=>{reads++;return inspect(id);};
  const first=h.fleet.scan();assert.equal(h.fleet.scan(),first);await first;
  assert.equal(reads,1);assert.equal(h.fleet.snapshot.length,1);assert.equal(h.calls.length,0);
});
test('Connect MCP skips current and custom setups, updates an old bundle and chooses each machine runtime',async()=>{
  const h=lab();h.status.set('linux:codex',{installed:true,owned:true});h.status.set('linux:cursor',{installed:true,owned:true,needsUpdate:true});h.status.set('windows:cursor',{installed:true,owned:false,custom:true});
  await h.fleet.run('connect');
  assert.deepEqual(h.calls.sort((a,b)=>a.machine.localeCompare(b.machine)),[
    {machine:'linux',agent:'cursor',runtime:'python3',kind:'connect'},
    {machine:'windows',agent:'codex',runtime:'python',kind:'connect'},
  ]);
  assert.equal(h.status.get('windows:cursor')?.custom,true);
});
test('one failed agent does not block the remaining agents or lose its actionable result',async()=>{
  const h=lab(),install=h.host.install;
  h.host.install=async(id,provider,runtime)=>{if(id==='linux'&&provider.id==='codex')throw Error('Settings access is required');return install(id,provider,runtime);};
  const first=h.fleet.run('connect');assert.equal(h.fleet.run('connect'),first);await first;
  assert.equal(h.calls.length,3);assert.equal(h.fleet.snapshot[0].targets[0].error,'Settings access is required');
  assert.equal(h.fleet.snapshot[1].targets.every(target=>target.installed),true);
});
test('an offline machine stays explicit while online machines finish',async()=>{
  const h=lab(),inspect=h.host.inspect;h.host.inspect=async id=>{if(id==='linux')throw Error('Computer is offline');return inspect(id);};
  await h.fleet.run('connect');assert.equal(h.calls.length,2);assert.equal(h.fleet.snapshot[0].error,'Computer is offline');assert.equal(h.fleet.snapshot[1].targets.every(target=>target.installed),true);
});
test('Disconnect MCP removes only owned installations, including an interrupted setup',async()=>{
  const h=lab();h.status.set('linux:codex',{installed:true,owned:true});h.status.set('linux:cursor',{installed:false,owned:true});h.status.set('windows:cursor',{installed:true,owned:false,custom:true});
  await h.fleet.run('disconnect');assert.deepEqual(h.calls.map(call=>call.machine+':'+call.agent),['linux:codex','linux:cursor']);assert.equal(h.status.get('windows:cursor')?.installed,true);
});
test('manual preparation is explicit and unsupported agents are never reported as installed',async()=>{
  const h=lab();h.host.machines=()=>[{id:'linux',name:'Server'}];h.host.inspect=async()=>({providers:[],unsupported:[{id:'other',name:'Other harness',driver:'other'}],windows:false});
  let prepared=0;h.host.prepare=async()=>{prepared++;return {config:'{}',path:'/owned/mcp.json'};};
  await h.fleet.scan();assert.equal(prepared,0);await h.fleet.run('connect');assert.equal(prepared,1);assert.equal(h.calls.length,0);assert.equal(h.fleet.snapshot[0].targets.length,0);assert.equal(h.fleet.snapshot[0].unsupported.length,1);
});
test('machine concurrency is bounded even when many machines are connected',async()=>{
  const h=lab();h.host.machines=()=>Array.from({length:35},(_,id)=>({id:String(id),name:String(id)}));
  let active=0,peak=0;h.host.inspect=async()=>{active++;peak=Math.max(active,peak);await new Promise<void>(resolve=>setImmediate(resolve));active--;return {providers:[],unsupported:[],windows:false};};
  await h.fleet.scan();assert.equal(peak,2);assert.equal(h.fleet.snapshot.length,35);
});

test('connect leaves inactive owned agents alone and disconnect removes their setup',async()=>{
 const calls:string[]=[],fleet=new AgentFleet({machines:()=>[{id:'machine',name:'Computer'}],inspect:async()=>({providers:[],inactive:[codex],unsupported:[],windows:false}),status:async()=>({installed:true,owned:true}),install:async()=>{calls.push('connect');},remove:async()=>{calls.push('disconnect');}});
 await fleet.run('connect');assert.deepEqual(calls,[]);assert.equal(fleet.snapshot[0].targets[0].available,false);
 await fleet.run('disconnect');assert.deepEqual(calls,['disconnect']);
});
