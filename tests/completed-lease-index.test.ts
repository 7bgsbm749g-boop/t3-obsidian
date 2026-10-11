import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {retainedLease,isCompletedLeaseIndex,canCompactLease,responseBinding} from '../completed-lease-index';
import {InlineLeaseAuthority,InlineLeaseClient,leasePaths,COORDINATED_OWNER,type LeaseRecord,type LeaseFiles} from '../inline-lease';
import {LeaseRecordCache} from '../lease-record-cache';
import {hostedRequestHash} from '../hosted-inline';
import {contentHash} from '../completion';

function completed():LeaseRecord {
 const id=randomUUID(),input={messageId:randomUUID(),text:'Private prompt '.repeat(1000),createdAt:'2026-10-11T00:00:00Z',senderLabel:'You'};
 const request={version:3 as const,id,vaultId:randomUUID(),initialOwner:randomUUID(),host:{environmentId:'host',workspaceRoot:'/vault',directory:'.obsidian/t3-code/inline/v1'},notePath:'Done.md',threadId:'thread',messageId:input.messageId,projectId:'project',threadEnvironmentId:'host',initialHash:contentHash('initial'),createdAt:input.createdAt,nativeProjection:true,independent:true,initialInput:input};
 return {request,coordinated:true,owner:COORDINATED_OWNER,epoch:1,revision:1,expiresAt:Number.MAX_SAFE_INTEGER,
  state:{requestHash:hostedRequestHash(request),accepted:true,notePath:'Done.md',status:'complete',updatedAt:'',hashes:[],body:'Private reply '.repeat(20000),finalBody:'Private final '.repeat(20000),directFinalBody:'Private direct '.repeat(20000),finalSaved:true,cleanupComplete:true,finalPhase:'complete',turnId:'turn',turnIds:['turn'],delivery:{commitId:randomUUID(),hash:contentHash('saved note'),proofHash:contentHash('proof'),verifiedOnHost:true,observedBy:[]}}};
}
test('completed indexes release content while retaining delivery and duplicate identities',()=>{
 const full=completed();full.state!.steering=[{messageId:'steer',text:'Private steering'} as any];full.state!.questionFollows=[{requestId:'question',replyTurnId:'answer-turn',input:{messageId:'answer',text:'Private answer'},answered:true} as any];
 const indexed=retainedLease(full);assert.ok(isCompletedLeaseIndex(indexed));assert.deepEqual(responseBinding(indexed),responseBinding(full));assert.deepEqual(indexed.state!.delivery,full.state!.delivery);
 assert.equal(indexed.state!.body,undefined);assert.equal(indexed.state!.finalBody,undefined);assert.equal(indexed.request.initialInput,undefined);assert.ok(!JSON.stringify(indexed).includes('Private'));
 assert.equal(full.state!.body!.length,280000,'the durable source remains unchanged');
 const moved={...indexed,state:{...indexed.state!,notePath:'Moved.md'}};assert.ok(isCompletedLeaseIndex(moved));assert.equal(responseBinding(moved).path,'Moved.md');
});
test('pending save, cleanup, migration, inputs and questions retain full live data',()=>{
 for(const change of [{finalSaved:false},{cleanupComplete:false},{status:'running'},{status:'conflict'},{pendingMessageId:'pending'},{questionFollows:[{requestId:'open',answered:false,dismissed:false}]}]){
  const full=completed();Object.assign(full.state!,change);assert.equal(canCompactLease(full),false);assert.equal(retainedLease(full),full);
 }
 const migrating=completed();migrating.migrating=true;assert.equal(retainedLease(migrating),migrating);
 const removed=completed();removed.responseRemovedAt=1;removed.state!.cleanupComplete=false;assert.ok(isCompletedLeaseIndex(retainedLease(removed)));
});
test('completed discovery caches store neither raw reply bytes nor parsed bodies, and detect same-revision changes',()=>{
 const cache=new LeaseRecordCache(16000000,1024),full=completed(),raw=JSON.stringify(full),first=cache.read('one',raw);
 assert.ok(isCompletedLeaseIndex(first));assert.ok(cache.status().characters<3000);assert.equal(cache.read('one',raw),first);
 const binding=responseBinding(first);binding.messageIds.push('Caller mutation');assert.ok(!responseBinding(first).messageIds.includes('Caller mutation'));
 for(let i=0;i<80;i++)cache.read(String(i),JSON.stringify({...full,request:{...full.request,id:String(i)}}));
 assert.equal(cache.status().entries,81);assert.ok(cache.status().characters<250000);
 assert.ok([...(cache as any).entries.values()].every(entry=>entry.raw===undefined&&entry.record.state.body===undefined));
 full.state!.notePath='Moved.md';const changed=cache.read('one',JSON.stringify(full));assert.equal(changed.revision,first.revision);assert.equal(responseBinding(changed).path,'Moved.md');assert.notEqual(first,changed);
 assert.throws(()=>{changed.state!.delivery!.observedBy.push('tampered');},TypeError);
});
test('authority keeps indexes but loads exact completed data for recovery and immutable registration retries',async()=>{
 const full=completed(),directory=full.request.host.directory,identity={vaultId:full.request.vaultId,...full.request.host},path=leasePaths(directory,full.request.id).record,raw=JSON.stringify(full),data=new Map([[path,raw]]);
 const files:LeaseFiles={read:async p=>data.get(p),write:async(p,value)=>{data.set(p,value);},remove:async p=>{data.delete(p);},list:async d=>[...data.keys()].filter(p=>p.startsWith(d+'/'))};
 const authority=new InlineLeaseAuthority(identity,files);await authority.tick();assert.equal(authority.status().completedIndexes,1);assert.equal((authority as any).records.get(full.request.id).state.body,undefined);
 const recovered=await authority.responsesFor('Done.md');assert.equal(recovered[0].state!.body,full.state!.body);assert.equal(recovered[0].request.initialInput!.text,full.request.initialInput!.text);
 const remote={...files,read:async(p:string)=>{if(p.includes('/replies/'))await authority.tick();return files.read(p);}};
 const client=new InlineLeaseClient(full.request.initialOwner!,remote,directory,undefined,undefined,async()=>{await authority.tick();});
 assert.equal((await client.command({kind:'register',jobId:full.request.id,request:full.request})).ok,true);
 assert.equal((await client.command({kind:'register',jobId:full.request.id,request:{...full.request,initialInput:{...full.request.initialInput!,text:'Different prompt'}}})).ok,false);
 assert.equal(data.get(path),raw);assert.equal(authority.status().completedIndexes,1);client.dispose();authority.stop();
});
