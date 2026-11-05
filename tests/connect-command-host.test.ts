import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {ConnectCommandHost,commandBase,type CommandFiles} from '../src/notes/connect-command-host';
import {contentHash} from '../src/responses/completion';
function fixture(){
  const data=new Map<string,string>(),receipts=new Map<string,any>(),executed:string[]=[],acknowledged:string[]=[];
  let now=1000,instanceId=randomUUID(),fail=false,ambiguous=false;
  const vaultId=randomUUID(),clientId=randomUUID(),route={environmentId:'selected-machine',workspaceRoot:'/t3/scratch',base:commandBase(vaultId,clientId)};
  const files:CommandFiles={read:async path=>data.get(path),write:async(path,text)=>{data.set(path,text);},list:async path=>[...data.keys()].filter(key=>key.startsWith(path+'/'))};
  function host(){return new ConnectCommandHost({files,route,identity:{vaultId,clientId,instanceId,vaultName:'Synthetic',loadedVersion:'0.0.397'},validate:()=>{},load:async id=>receipts.get(id),save:async(id,value)=>{receipts.set(id,structuredClone(value));},execute:async command=>{const input=command as any;assert.equal(receipts.get(input.id)?.phase,'executing');executed.push(input.id);if(ambiguous)throw Error('synthetic failure after dispatch');if(fail)return {id:input.id,ok:false,retryable:true,error:'confirmed no-op failure'};return {id:input.id,ok:true,client:{instanceId}};},acknowledged:async(command:any)=>{assert.ok(data.has(route.base+'/results/'+command.id+'.json'),'result must precede acknowledgement');acknowledged.push(command.id);},now:()=>now});}
  function request(command={version:1,id:randomUUID(),kind:'client-status'},extra={}){const ready=JSON.parse(data.get(route.base+'/ready.json')!);const envelope={version:1,id:command.id,vaultId,clientId,instanceId,token:ready.token,expiresAt:now+60_000,command,...extra},path=route.base+'/requests/'+command.id+'.json',raw=JSON.stringify(envelope);data.set(path,raw);data.set(path+'.ready',contentHash(raw));return {command,path,raw};}
  return {data,receipts,executed,acknowledged,host,request,route,advance:(ms:number)=>now+=ms,restart:()=>instanceId=randomUUID(),setFail:(value:boolean)=>fail=value,setAmbiguous:()=>ambiguous=true};
}
test('only complete authenticated exact-client requests execute, after a durable intent receipt',async()=>{
  for(const change of [{token:'wrong'},{vaultId:randomUUID()},{clientId:randomUUID()},{instanceId:randomUUID()},{expiresAt:1}]){
    const f=fixture(),host=f.host();await host.tick();f.request(undefined,change);await host.tick();assert.equal(f.executed.length,0);await host.dispose();
  }
  const f=fixture(),host=f.host();await host.tick();const request=f.request();f.data.delete(request.path+'.ready');await host.tick();assert.equal(f.executed.length,0);
  f.data.set(request.path+'.ready',contentHash(request.raw));await host.tick();assert.deepEqual(f.executed,[request.command.id]);assert.deepEqual(f.acknowledged,[request.command.id]);assert.match(f.data.get(request.path+'.ready')!,/^consumed:/);await host.dispose();
});
test('same ID cannot change input or replay a successful mutation after client restart',async()=>{
  const f=fixture();let host=f.host();await host.tick();const {command}=f.request();await host.tick();await host.dispose();f.restart();host=f.host();await host.tick();f.request(command);await host.tick();assert.equal(f.executed.length,1);
  f.request({...command,kind:'reload-client'});await host.tick();const result=JSON.parse(f.data.get(f.route.base+'/results/'+command.id+'.json')!);assert.equal(result.ok,false);assert.match(result.error,/different input/);assert.equal(f.executed.length,1);await host.dispose();
});
test('an interrupted dispatch stays ambiguous; only an explicitly failed command can retry',async()=>{
  const f=fixture(),host=f.host();await host.tick();const command={version:1,id:randomUUID(),kind:'client-status'};
  f.receipts.set(command.id,{hash:contentHash(JSON.stringify(command)),startedAt:1,phase:'executing'});f.request(command,{retry:true});await host.tick();assert.equal(f.executed.length,0);assert.equal(JSON.parse(f.data.get(f.route.base+'/results/'+command.id+'.json')!).pending,true);
  const second={...command,id:randomUUID()};f.setFail(true);f.request(second);await host.tick();f.setFail(false);f.request(second);await host.tick();assert.equal(f.executed.length,1);f.request(second,{retry:true});await host.tick();assert.equal(f.executed.length,2);await host.dispose();
});
test('consumed files do not starve later requests and overlapping ticks do not duplicate work',async()=>{
  const f=fixture(),host=f.host();await host.tick();for(let i=0;i<70;i++)f.request();await Promise.all([host.tick(),host.tick()]);for(let i=0;i<4;i++)await host.tick();assert.equal(new Set(f.executed).size,70);assert.equal(f.executed.length,70);await host.dispose();const ready=f.data.get(f.route.base+'/ready.json');f.advance(31_000);await host.tick();assert.equal(f.data.get(f.route.base+'/ready.json'),ready);
});

test('an exception after dispatch is ambiguous and cannot execute again even with an explicit retry',async()=>{
 const f=fixture(),host=f.host();await host.tick();f.setAmbiguous();const {command}=f.request();await host.tick();assert.equal(f.receipts.get(command.id).phase,'executing');assert.equal(JSON.parse(f.data.get(f.route.base+'/results/'+command.id+'.json')!).pending,true);f.request(command,{retry:true});await host.tick();assert.equal(f.executed.length,1);await host.dispose();
});
