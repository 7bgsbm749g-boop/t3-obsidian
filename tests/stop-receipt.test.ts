import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {InlineLeaseAuthority,InlineLeaseClient,leasePaths,type LeaseFiles,type LeaseRecord} from '../inline-lease';
import {DeviceInlineManager} from '../leased-inline';
import {initialRegion} from '../inline-thread';
import {hostedRequestHash,type HostedInlineRequest} from '../hosted-inline';
import {stoppedBodyReference,stoppedBodyPath,responseStopReceipt} from '../response-stop-receipt';
import {configureDiagnostics,EventJournal} from '../diagnostics';

async function fixture(modern=true){
  const id=randomUUID(),actor=randomUUID(),directory='private/inline',identity={vaultId:'vault',environmentId:'host',workspaceRoot:'/vault',directory};
  const request:HostedInlineRequest={version:4,id,initialOwner:actor,nativeProjection:true,vaultId:'vault',host:identity,notePath:'Synthetic.md',threadId:randomUUID(),messageId:randomUUID(),projectId:'project',threadEnvironmentId:'host',createdAt:'2026-10-10T00:00:00Z',initialHash:initialRegion(id).bodyHash};
  const data=new Map<string,string>(),writes=new Map<string,number>();
  const files:LeaseFiles={read:async path=>data.get(path),write:async(path,value)=>{data.set(path,value);writes.set(path,(writes.get(path)??0)+1);},remove:async path=>{data.delete(path);},list:async prefix=>[...data.keys()].filter(path=>path.startsWith(prefix+'/'))};
  const authority=new InlineLeaseAuthority(identity,files,()=>100_000);
  const transport={...files,read:async(path:string)=>{if(path.includes('/replies/'))await authority.tick();return files.read(path);}};
  const client=new InlineLeaseClient(actor,transport,directory,()=>100_000,()=>100_000,async()=>{await authority.tick();});
  assert.equal((await client.command({kind:'register',jobId:id,request})).ok,true);
  const path=leasePaths(directory,id).record;
  const record:LeaseRecord={...JSON.parse(data.get(path)!),state:{requestHash:hostedRequestHash(request),accepted:true,notePath:request.notePath,status:'running',hashes:[],updatedAt:'',body:'Synthetic tool output '.repeat(30_000)},finalWriter:{actor,token:randomUUID(),messageId:request.messageId,turnId:'finished-turn',sequence:20,body:'Finished answer',phase:'complete'}};
  await files.write(path,JSON.stringify(record));data.set(`${directory}/coordinated-capabilities.json`,JSON.stringify({stopReceipts:modern?1:undefined}));
  return {id,actor,directory,request,data,writes,authority,files,transport,client,path};
}

test('modern Stop accepts a small durable receipt without reading the large lease',async()=>{
  const h=await fixture(),body='Frozen tool output '.repeat(25_000),reference=stoppedBodyReference(body);
  let leaseReads=0;
  const remote={...h.transport,read:async(path:string)=>{if(path===h.path){leaseReads++;throw Error('Large lease hydration must not gate Stop');}return h.transport.read(path);}};
  const manager=new DeviceInlineManager(h.actor,'vault',{readNote:async()=>'',isOpen:()=>false,updateNote:async()=>undefined,access:async()=>{throw Error('No run connection needed');}},async()=>({files:remote,close(){}}),()=>100_000,()=>100_000,async()=>{await h.authority.tick();});
  try{
    const receipt=await manager.stopResponse(h.request.host,h.id,body);
    assert.equal(receipt.hostRecorded,true);assert.equal(receipt.runTerminal,true);assert.equal(receipt.finalSaved,false);assert.equal(receipt.finalWriterPending,true);assert.equal(leaseReads,0);
    const retained=JSON.parse(h.data.get(h.path)!);assert.equal(retained.stoppedBody,body);
    const bodyPath=stoppedBodyPath(h.directory,h.id,reference);assert.equal(h.writes.get(bodyPath),1);
    const leaseWrites=h.writes.get(h.path),mailboxWrites=[...h.writes].filter(([path])=>path.includes('/mailbox/')).reduce((n,[,count])=>n+count,0);
    assert.deepEqual(await manager.stopResponse(h.request.host,h.id,body),receipt);
    assert.equal(h.writes.get(bodyPath),1);assert.equal(h.writes.get(h.path),leaseWrites);assert.equal([...h.writes].filter(([path])=>path.includes('/mailbox/')).reduce((n,[,count])=>n+count,0),mailboxWrites);
    const replyBytes=[...h.data].filter(([path])=>path.includes('/replies/')).map(([,bytes])=>bytes).find(bytes=>JSON.parse(bytes).stopReceipt);
    assert.ok(replyBytes);assert.ok(replyBytes.length<1000);assert.ok(!replyBytes.includes('Frozen tool output'));
  }finally{manager.dispose();h.client.dispose();h.authority.stop();}
});

test('legacy host negotiation retains the frozen body and original reply contract',async()=>{
  const h=await fixture(false),body='Legacy frozen text';
  const manager=new DeviceInlineManager(h.actor,'vault',{readNote:async()=>'',isOpen:()=>false,updateNote:async()=>undefined,access:async()=>{throw Error('No connection');}},async()=>({files:h.transport,close(){}}),()=>100_000,()=>100_000,async()=>{await h.authority.tick();});
  try{const receipt=await manager.stopResponse(h.request.host,h.id,body);assert.equal(receipt.hostRecorded,true);assert.equal(JSON.parse(h.data.get(h.path)!).stoppedBody,body);assert.equal([...h.data.keys()].some(path=>path.includes('/stopped-bodies/')),false);}
  finally{manager.dispose();h.client.dispose();h.authority.stop();}
});

test('Stop diagnostics record small receipt fields and duration without frozen bytes or writer tokens',async()=>{
  const h=await fixture(),body='Private frozen tool output',operation=randomUUID(),journal=new EventJournal({load:async()=>undefined,save:async()=>{},id:randomUUID,context:{deviceId:h.actor}});
  configureDiagnostics(journal);const manager=new DeviceInlineManager(h.actor,'vault',{readNote:async()=>'',isOpen:()=>false,updateNote:async()=>undefined,access:async()=>{throw Error('No connection');}},async()=>({files:h.transport,close(){}}),()=>100_000,()=>100_000,async()=>{await h.authority.tick();});
  try{
    await manager.stopResponse(h.request.host,h.id,body,operation);await manager.stopResponse(h.request.host,h.id,body,operation);
    const events=JSON.parse(journal.export()).events.filter((event:any)=>event.event==='response.stop.receipt');assert.equal(events.length,2);
    for(const event of events){assert.deepEqual(event.fields,{bindingId:h.id,operationId:operation,elapsedMs:0,hostRecorded:true,runTerminal:true,finalSaved:false,finalWriterPending:true,bodyCharacters:body.length});assert.ok(JSON.stringify(event).length<1000);assert.ok(!JSON.stringify(event).includes(body));assert.ok(!JSON.stringify(event).includes(JSON.parse(h.data.get(h.path)!).finalWriter.token));}
  }finally{configureDiagnostics();manager.dispose();h.client.dispose();h.authority.stop();}
});

test('repeated Stop commands retain the same lease bytes without rewriting its large body',async()=>{
  const h=await fixture(),body='Freeze once';
  try{
    await h.client.command({kind:'stop',jobId:h.id,stoppedBody:body});const before=h.data.get(h.path),writes=h.writes.get(h.path);
    await h.client.command({kind:'stop',jobId:h.id,stoppedBody:body});assert.equal(h.data.get(h.path),before);assert.equal(h.writes.get(h.path),writes);
  }finally{h.client.dispose();h.authority.stop();}
});

test('a modern retry cannot attach another pane reference to a legacy frozen transcript',async()=>{
  const h=await fixture(),canonical='The first frozen transcript',other='Different pane text',reference=stoppedBodyReference(other);
  try{await h.client.command({kind:'stop',jobId:h.id,stoppedBody:canonical});await h.files.write(stoppedBodyPath(h.directory,h.id,reference),other);const previous=h.data.get(h.path);const reply=await h.client.command({kind:'stop',jobId:h.id,receiptOnly:1,stoppedBodyRef:reference});assert.equal(reply.ok,true);assert.equal(reply.stopReceipt!.hostRecorded,true);assert.equal(h.data.get(h.path),previous);assert.equal(JSON.parse(h.data.get(h.path)!).stoppedBodyRef,undefined);}
  finally{h.client.dispose();h.authority.stop();}
});

test('a permanent final grant distinguishes completed run from pending note delivery',()=>{
  const id=randomUUID(),record={request:{id},epoch:1,revision:3,state:{status:'running',finalSaved:false},finalWriter:{phase:'complete'}} as LeaseRecord;
  assert.equal(responseStopReceipt(record).runTerminal,true);assert.equal(responseStopReceipt(record).finalSaved,false);
});

test('same-ID mailbox work stays single-flight and a saved acknowledgement prevents replay writes',async()=>{
  const id=randomUUID(),operation=randomUUID(),actor=randomUUID();let release!:()=>void,writes=0;
  const waiting=new Promise<void>(resolve=>{release=resolve;});let stored=false;
  const reply={id:operation,ok:true,ttlMs:0,stopReceipt:{version:1,bindingId:id,commandId:operation,epoch:1,revision:1,hostRecorded:true,runTerminal:false,finalSaved:false,finalWriterPending:false}};
  const files={write:async()=>{writes++;await waiting;stored=true;},read:async()=>stored?JSON.stringify(reply):undefined};
  const client=new InlineLeaseClient(actor,files,'private');
  const first=client.command({kind:'stop',jobId:id,receiptOnly:1},{id:operation,actor}),second=client.command({kind:'stop',jobId:id,receiptOnly:1},{id:operation,actor});
  assert.equal(first,second);release();assert.equal((await first).ok,true);assert.equal(writes,1);await client.command({kind:'stop',jobId:id,receiptOnly:1},{id:operation,actor});assert.equal(writes,1);client.dispose();
});
