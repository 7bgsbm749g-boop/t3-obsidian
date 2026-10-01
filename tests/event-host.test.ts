import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {EventHostServer} from '../event-host-desktop';
import {forwardEventCommand,eventRequest,eventCanonical} from '../event-host';
import {EventSubscriptions,type EventSubscriptionCommand} from '../event-subscriptions';
const pause=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
test('two origins share one host, immutable IDs, durable state and restart authority',{timeout:15000},async()=>{
  const root=await mkdtemp(join(tmpdir(),'t3-event-host-'));
  const host={vaultId:'vault',environmentId:'vps',workspaceRoot:root,directory:'.obsidian/t3-code/events/v1'};
  let server:EventHostServer|undefined;let service:EventSubscriptions;let active=false;
  const open=async()=>{
    server=await EventHostServer.open(host,c=>service.command(c),()=>true,()=>service?.stop());
    service=new EventSubscriptions({load:()=>server!.load(),save:s=>server!.save(s),notes:async()=>[],validateTarget:async()=>{},isBusy:async()=>false,prepare:async()=>({}),deliver:async()=> 'delivered',recording:a=>{active=a;},now:Date.now,id:randomUUID});
    await service.initialize();server.activate();
  };
  try{
    await open();
    await assert.rejects(EventHostServer.open(host,async c=>({id:c.id,ok:true}),()=>true,()=>{}),/lock/i);
    const command:EventSubscriptionCommand={version:1,id:randomUUID(),kind:'subscribe',target:{threadId:'thread',projectId:'project',environmentId:'laptop'},scope:{path:'A.md',kind:'note',recursive:true},filter:{events:['modify']}};
    // Separate callers can only see the host file API, never the service itself.
    const files=()=>({read:server!.files.read,write:server!.files.write,remove:server!.files.remove});
    const [a,b]=await Promise.all([forwardEventCommand(host,command,files(),pause),forwardEventCommand(host,command,files(),pause)]);
    assert.equal(a.ok,true);assert.deepEqual(a,b);assert.deepEqual(a.host,host);assert.equal(service!.snapshot.subscriptions.length,1);assert.equal(active,true);
    const changed=await forwardEventCommand(host,{...command,scope:{...command.scope!,path:'B.md'}},files(),pause);
    assert.equal(changed.ok,false);assert.match(changed.error!,/different input/);assert.equal(service!.snapshot.subscriptions[0].scope.path,'A.md');
    await server!.dispose();await open();assert.equal(service!.snapshot.subscriptions.length,1);
    const list=await forwardEventCommand(host,{version:1,id:randomUUID(),kind:'subscriptions'},files(),pause);
    assert.equal(list.subscriptions![0].environmentId,'laptop');
    await forwardEventCommand(host,{version:1,id:randomUUID(),kind:'cancel-subscription',subscriptionId:command.id},files(),pause);
    assert.equal(active,false);assert.equal((await server!.load())!.subscriptions.length,0);
    await server!.dispose();await open();assert.equal(active,false);
  }finally{await server?.dispose();await rm(root,{recursive:true,force:true});}
});
test('wrong vault, tampered request, and changed saved host identity cannot acquire subscriptions',{timeout:10000},async()=>{
  const root=await mkdtemp(join(tmpdir(),'t3-event-identity-'));let calls=0;
  const host={vaultId:'vault',environmentId:'vps',workspaceRoot:root,directory:'.obsidian/t3-code/events/v1'};
  const server=await EventHostServer.open(host,async c=>{calls++;return {id:c.id,ok:true};},()=>true,()=>{});server.activate();
  try{
    const wrong={...host,vaultId:'other'};const command:EventSubscriptionCommand={version:1,id:randomUUID(),kind:'subscriptions'};
    await assert.rejects(forwardEventCommand(wrong,command,server.files,pause),/invalid acknowledgement/);assert.equal(calls,0);
    const request=eventRequest(host,{...command,id:randomUUID()});
    await server.files.write(request.request,request.body.replace('subscriptions','cancel-subscription'));await server.tick();assert.equal(calls,0);
    await server.files.write(host.directory+'/state.json',JSON.stringify({version:1,host:wrong,state:{}}));await assert.rejects(server.load(),/different vault/);
  }finally{await server.dispose();await rm(root,{recursive:true,force:true});}
});
test('offline forwarding retains exact bytes for retry and rejects foreign acknowledgements',async()=>{
  const host={vaultId:'vault',environmentId:'vps',workspaceRoot:'/vault',directory:'.obsidian/t3-code/events/v1'};
  const command:EventSubscriptionCommand={version:1,id:randomUUID(),kind:'subscriptions'};
  const store=new Map<string,string>();let writes=0;
  const files={read:async(p:string)=>store.get(p),write:async(p:string,v:string)=>{writes++;store.set(p,v);},remove:async(p:string)=>{store.delete(p);}};
  await assert.rejects(forwardEventCommand(host,command,files,async()=>{},0),/not acknowledged/);assert.equal(writes,1);
  await assert.rejects(forwardEventCommand(host,command,files,async()=>{},0),/not acknowledged/);assert.equal(writes,1);
  const request=eventRequest(host,command);assert.equal(store.get(request.request),request.body);
  store.set(request.result,eventCanonical({version:1,host:{...host,environmentId:'other'},request:request.name,result:{id:command.id,ok:true}}));
  await assert.rejects(forwardEventCommand(host,command,files,pause),/invalid acknowledgement/);
});
test('a failed host command can be retried without rewriting input; successful acknowledgements replay',{timeout:10000},async()=>{
  const root=await mkdtemp(join(tmpdir(),'t3-event-retry-'));let calls=0;
  const host={vaultId:'vault',environmentId:'vps',workspaceRoot:root,directory:'.obsidian/t3-code/events/v1'};
  const server=await EventHostServer.open(host,async c=>{calls++;if(calls===1)throw Error('Thread temporarily unavailable.');return {id:c.id,ok:true};},()=>true,()=>{});server.activate();
  try{
    const command:EventSubscriptionCommand={version:1,id:randomUUID(),kind:'subscriptions'};
    assert.equal((await forwardEventCommand(host,command,server.files,pause)).ok,false);
    const request=eventRequest(host,command),bytes=await server.files.read(request.request);
    assert.equal((await forwardEventCommand(host,command,server.files,pause)).ok,true);assert.equal(calls,2);
    assert.equal((await forwardEventCommand(host,command,server.files,pause)).ok,true);assert.equal(calls,2);assert.equal(await server.files.read(request.request),bytes);
  }finally{await server.dispose();await rm(root,{recursive:true,force:true});}
});
