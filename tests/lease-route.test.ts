import {test} from 'node:test';
import assert from 'node:assert/strict';
import {InlineLeaseAuthority,InlineLeaseClient,leasePaths,leaseRoute,type LeaseFiles,type LeaseRecord} from '../inline-lease';
import {hostedRequestHash,type HostedInlineRequest,type HostedInlineState} from '../hosted-inline';

const id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',actor='bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee',messageId='cccccccc-bbbb-cccc-dddd-eeeeeeeeeeee';
const identity={vaultId:'vault',environmentId:'host',workspaceRoot:'/vault',directory:'.obsidian/t3-code/inline/v1'};
function harness(){
  const data=new Map<string,string>(),writes:Array<{path:string;bytes:string}>=[];let failRoute=false;
  const files:LeaseFiles={read:async path=>data.get(path),write:async(path,bytes)=>{if(failRoute&&path.includes('/routes/'))throw Error('Routing storage unavailable');writes.push({path,bytes});data.set(path,bytes);},remove:async path=>{data.delete(path);},list:async dir=>[...data.keys()].filter(path=>path.startsWith(dir+'/'))};
  let authority=new InlineLeaseAuthority(identity,files,()=>100_000);
  const remote={...files,read:async(path:string)=>{if(path.includes('/replies/'))await authority.tick();return files.read(path);}};
  const client=new InlineLeaseClient(actor,remote,identity.directory,()=>100_000,()=>100_000,async()=>{await authority.tick();});
  const request:HostedInlineRequest={version:3,id,initialOwner:actor,vaultId:'vault',host:identity,notePath:'Note.md',threadId:'thread',messageId,projectId:'project',threadEnvironmentId:'host',nativeProjection:true,initialHash:'a'.repeat(64),createdAt:'2026-10-10T00:00:00Z',initialInput:{messageId,text:'private prompt'}};
  const state:HostedInlineState={requestHash:hostedRequestHash(request),accepted:true,notePath:'Note.md',status:'running',hashes:[request.initialHash],body:'private tool output '.repeat(25_000),turnId:'old-turn',turnIds:['old-turn','current-turn'],bindingCheckpoint:{bindings:{[messageId]:{turnId:'current-turn',kind:'explicit'}}},updatedAt:''};
  const paths=leasePaths(identity.directory,id);
  const record=()=>JSON.parse(data.get(paths.record)!) as LeaseRecord;
  return {data,writes,files,client,request,state,paths,record,authority:()=>authority,failRoute:(fail:boolean)=>{failRoute=fail;},restart:async()=>{authority.stop();authority=new InlineLeaseAuthority(identity,files,()=>100_000);await authority.tick();},close:()=>{client.dispose();authority.stop();}};
}

test('a route is small discovery metadata and never copies prompt, body, grant, or proof data',()=>{
  const h=harness(),record:LeaseRecord={request:h.request,owner:actor,epoch:3,revision:12,expiresAt:100_000,state:h.state,finalWriter:{actor,token:'private-token',messageId,turnId:'final-turn',turnIds:['current-turn','final-turn'],sequence:5,body:'private final answer',phase:'complete'},preparedFinal:{commitId:id,hash:'private-hash',proofHash:'private-proof'}};
  const route=leaseRoute(record),bytes=JSON.stringify(route);
  assert.ok(bytes.length<1024);assert.doesNotMatch(bytes,/private|body|token|owner|preparedFinal|initialInput|bindingCheckpoint/);
  assert.deepEqual(route,{version:1,id,vaultId:'vault',host:{environmentId:'host',workspaceRoot:'/vault',directory:identity.directory},notePath:'Note.md',threadId:'thread',projectId:'project',threadEnvironmentId:'host',messageId,turnId:'final-turn',turnIds:['final-turn','current-turn','old-turn'],epoch:3,revision:12,status:'running',finalPhase:'complete'});h.close();
});

test('registration publishes its route after the lease is durable and metadata follows native checkpoint and rename',async()=>{
  const h=harness();try{
    assert.equal((await h.client.command({kind:'register',jobId:id,request:h.request})).ok,true);
    assert.ok(h.writes.findIndex(write=>write.path===h.paths.record)<h.writes.findIndex(write=>write.path===h.paths.route));
    assert.deepEqual(JSON.parse(h.data.get(h.paths.route)!),leaseRoute(h.record()));
    await h.authority().migrated(id);await h.authority().checkpoint(id,h.state);
    let route=JSON.parse(h.data.get(h.paths.route)!);assert.equal(route.turnId,'current-turn');assert.equal(route.messageId,messageId);assert.equal(route.revision,h.record().revision);assert.doesNotMatch(h.data.get(h.paths.route)!,/private/);
    await h.authority().renameNative('Note.md','Moved.md');route=JSON.parse(h.data.get(h.paths.route)!);assert.equal(route.notePath,'Moved.md');assert.equal(route.revision,h.record().revision);
  }finally{h.close();}
});

test('cold recovery backfills a missing route and a second recovery does not rewrite unchanged bytes',async()=>{
  const h=harness();try{
    const record:LeaseRecord={request:h.request,coordinated:true,owner:actor,epoch:2,revision:4,expiresAt:Number.MAX_SAFE_INTEGER,state:h.state};h.data.set(h.paths.record,JSON.stringify(record));
    await h.authority().tick();assert.deepEqual(JSON.parse(h.data.get(h.paths.route)!),leaseRoute(record));assert.equal(h.writes.filter(write=>write.path===h.paths.record).length,0);
    const previous=h.writes.filter(write=>write.path===h.paths.route).length;await h.restart();assert.equal(h.writes.filter(write=>write.path===h.paths.route).length,previous);
  }finally{h.close();}
});

test('an unchanged Stop does not rewrite the route or the large lease',async()=>{
  const h=harness();try{
    await h.client.command({kind:'register',jobId:id,request:h.request});await h.authority().migrated(id);await h.authority().checkpoint(id,h.state);
    assert.equal((await h.client.command({kind:'stop',jobId:id,receiptOnly:1})).ok,true);const writes=h.writes.length,revision=h.record().revision;
    assert.equal((await h.client.command({kind:'stop',jobId:id,receiptOnly:1})).ok,true);assert.equal(h.record().revision,revision);assert.equal(h.writes.slice(writes).some(write=>write.path===h.paths.route||write.path===h.paths.record),false);
  }finally{h.close();}
});

test('a route write failure retains the durable grant and a fresh registration retry repairs only discovery',async()=>{
  const h=harness();try{
    h.failRoute(true);const failed=await h.client.command({kind:'register',jobId:id,request:h.request});assert.equal(failed.ok,false);assert.match(failed.error!,/Routing storage unavailable/);const retained=h.data.get(h.paths.record);assert.ok(retained);assert.equal(h.data.has(h.paths.route),false);
    h.failRoute(false);assert.equal((await h.client.command({kind:'register',jobId:id,request:h.request})).ok,true);assert.equal(h.data.get(h.paths.record),retained);assert.deepEqual(JSON.parse(h.data.get(h.paths.route)!),leaseRoute(h.record()));
  }finally{h.close();}
});
