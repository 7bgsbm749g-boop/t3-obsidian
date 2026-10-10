import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {InlineLeaseAuthority,InlineLeaseClient,leasePaths,leaseRoute,COORDINATED_OWNER,type LeaseFiles,type LeaseRecord} from '../inline-lease';
import {initialRegion} from '../inline-thread';
import {hostedRequestHash,type HostedInlineRequest} from '../hosted-inline';

function backlog(){
  const directory='.obsidian/t3-code/inline/v1',identity={vaultId:'vault',environmentId:'host',workspaceRoot:'/vault',directory},actor=randomUUID();
  let time=100_000;const data=new Map<string,string>(),writes=new Map<string,number>();let leaseReads=0;
  const request:HostedInlineRequest={version:2,nativeProjection:true,id:randomUUID(),initialOwner:actor,vaultId:identity.vaultId,host:identity,notePath:'New.md',threadId:randomUUID(),messageId:randomUUID(),projectId:'project',threadEnvironmentId:identity.environmentId,initialHash:initialRegion(randomUUID()).bodyHash,createdAt:new Date(time).toISOString()};
  const historical:LeaseRecord[]=[];
  for(let n=0;n<417;n++){
    const old={...request,id:randomUUID(),nativeProjection:false,notePath:`Old-${n}.md`},record:LeaseRecord={request:old,owner:randomUUID(),epoch:1,revision:0,expiresAt:0,state:{requestHash:hostedRequestHash(old),accepted:true,status:n<390?'complete':'running',notePath:old.notePath,hashes:[],updatedAt:'',body:'Historical response '.repeat(400)}};
    data.set(leasePaths(directory,old.id).record,JSON.stringify(record));historical.push(record);
  }
  for(let n=0;n<400;n++){
    const id=randomUUID();data.set(leasePaths(directory,id).command,JSON.stringify({id,jobId:historical[390+n%27].request.id,actor:randomUUID(),kind:'claim'}));
  }
  const files:LeaseFiles={read:async path=>{time+=5;if(path.includes('/leases/'))leaseReads++;return data.get(path);},write:async(path,value)=>{time+=5;writes.set(path,(writes.get(path)??0)+1);data.set(path,value);},remove:async path=>{time+=5;data.delete(path);},list:async dir=>{time+=5;return [...data.keys()].filter(path=>path.startsWith(dir+'/'));}};
  const authority=new InlineLeaseAuthority(identity,files,()=>time);
  const enqueue=(kind:string,jobId:string,extra:object={})=>{const id=randomUUID();data.set(leasePaths(directory,id).command,JSON.stringify({id,jobId,actor,kind,...extra}));return id;};
  return {directory,identity,actor,data,files,authority,request,writes,enqueue,now:()=>time,leaseReads:()=>leaseReads};
}

test('a first native send is acknowledged within the existing deadline on cold start with 417 leases and 400 legacy claims',async()=>{
  const h=backlog(),id=h.enqueue('register',h.request.id,{request:h.request}),started=h.now();
  await h.authority.tick();
  const reply=JSON.parse(h.data.get(leasePaths(h.directory,id).reply)!);
  assert.equal(reply.ok,true);assert.equal(reply.record.owner,COORDINATED_OWNER);
  assert.deepEqual(JSON.parse(h.data.get(leasePaths(h.directory,h.request.id).route)!),leaseRoute(reply.record),'fresh routing is durable before acknowledgement');
  assert.ok(reply.answeredAt-started<5000,`first acknowledgement took ${reply.answeredAt-started}ms of storage latency`);
  assert.ok(h.now()-started<5000,'a batch must release the authority before the send deadline');
  assert.equal([...h.data.keys()].filter(path=>path.includes('/mailbox/')).length,392,'background work yields after eight claims');
  assert.ok(h.leaseReads()<440,'claims and native registration do not rescan historical lease files');
  assert.ok((h.writes.get(leasePaths(h.directory,'').catalog)??0)<=3,'cold recovery publishes the catalog in bulk');
  assert.ok([...h.data.keys()].filter(path=>path.includes('/routes/')).length<=17,'historical route migration is bounded after the native send and eight claims');
});

test('cold route migration yields in eight-record batches and reuses recovered metadata without reading lease bodies again',async()=>{
  const h=backlog();for(const path of [...h.data.keys()])if(path.includes('/mailbox/'))h.data.delete(path);
  try{
    await h.authority.tick();assert.equal([...h.data.keys()].filter(path=>path.includes('/routes/')).length,8);const reads=h.leaseReads();
    for(let remaining=409;remaining>0;remaining-=8){const started=h.now(),before=[...h.data.keys()].filter(path=>path.includes('/routes/')).length;await h.authority.tick();assert.ok(h.now()-started<100,'a route migration batch releases the host promptly');assert.equal([...h.data.keys()].filter(path=>path.includes('/routes/')).length-before,Math.min(8,remaining));}
    assert.equal(h.leaseReads(),reads);assert.equal(reads,417);
    for(const [path,bytes] of h.data)if(path.includes('/leases/')){const record=JSON.parse(bytes) as LeaseRecord;assert.deepEqual(JSON.parse(h.data.get(leasePaths(h.directory,record.request.id).route)!),leaseRoute(record));}
  }finally{h.authority.stop();}
});

test('new registrations and an exact-ID replay stay responsive while an old claim backlog remains',async()=>{
  const h=backlog();await h.authority.tick();
  const remote={...h.files,read:async(path:string)=>{if(path.includes('/replies/'))await h.authority.tick();return h.files.read(path);}};
  const client=new InlineLeaseClient(h.actor,remote,h.directory,h.now,h.now,async()=>{}),started=h.now(),reads=h.leaseReads();
  for(let n=0;n<2;n++)assert.equal((await client.command({kind:'register',jobId:h.request.id,request:h.request})).ok,true);
  assert.ok(h.now()-started<5000,'original send and same-ID replay finish without manual timeout recovery');
  assert.ok(h.leaseReads()-reads<30,'interactive traffic does not pay for another 417-file lease scan');
  const records=[...h.data.keys()].filter(path=>path.includes('/leases/')&&path.endsWith(`/${h.request.id}.json`));assert.equal(records.length,1);
});

test('a background mailbox batch yields to a host checkpoint without draining competing claims',async()=>{
  const h=backlog();h.enqueue('register',h.request.id,{request:h.request});await h.authority.tick();
  await h.authority.migrated(h.request.id);
  const before=h.now();const record=await h.authority.checkpoint(h.request.id,{requestHash:hostedRequestHash(h.request),accepted:true,status:'running',notePath:h.request.notePath,hashes:[],updatedAt:''});
  assert.equal(record.state?.status,'running');assert.ok(h.now()-before<100,'host recovery work is not held behind the entire mailbox');
  assert.ok([...h.data.keys()].filter(path=>path.includes('/mailbox/')).length>350);
});
