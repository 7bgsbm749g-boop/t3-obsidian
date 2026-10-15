import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {NativeResponseManager} from '../native-response-manager';
import {responseAnchor} from '../native-response-projection';
import {contentHash} from '../completion';
import type {ResponseRecord} from '../response-record';

function fixture(open=true){
 const id=randomUUID(),commitId=randomUUID(),body='Completed reply '.repeat(10000),anchor=responseAnchor(id),before=`Before\n\n${anchor}\n\nAfter\n`,final=before.replace(anchor,body),file={path:'Done.md'};
 let disk=before,value=before;
 const view:any={file,getViewData:()=>value,setViewData:(text:string)=>{value=text;},getMode:()=> 'preview',requestSave:()=>{},save:async()=>{disk=value;}};
 const app:any={workspace:{getLeavesOfType:()=>open?[{view}]:[]},vault:{getFileByPath:()=>file,read:async()=>disk},saveLocalStorage:()=>{}};
 const record:ResponseRecord={coordinated:true,owner:'host',epoch:1,revision:1,expiresAt:Number.MAX_SAFE_INTEGER,request:{version:3,id,vaultId:'vault',host:{environmentId:'host',workspaceRoot:'/vault',directory:'.obsidian/t3-code/inline/v1'},notePath:file.path,threadId:'thread',messageId:id,projectId:'project',threadEnvironmentId:'host',initialHash:'initial',createdAt:'2026-10-11T00:00:00Z'},state:{requestHash:'request',accepted:true,notePath:file.path,status:'complete',hashes:[],updatedAt:'',body,finalBody:body,finalPhase:'complete',finalSaved:true,cleanupComplete:true,delivery:{commitId,hash:contentHash(final),verifiedOnHost:true,observedBy:[]}}};
 const from=final.indexOf(body),proof={version:1,bindingId:id,commitId,hash:contentHash(final),document:final,ranges:[{from,to:from+body.length}]},bytes=JSON.stringify(proof);record.state!.delivery!.proofHash=contentHash(bytes);
 const manager=new NativeResponseManager(app);return {manager,record,bytes,id,body,final,view,visible:()=>value,disk:(text:string)=>{disk=text;},open:(value:boolean)=>{open=value;}};
}
test('native completed bodies and proofs retire after saved content reaches both disk and the pane',async()=>{
 const h=fixture();try{
  await h.manager.receive(h.record,h.bytes);assert.equal(h.manager.retentionStatus().completedIndexes,0);assert.equal(h.manager.retentionStatus().proofs,1);assert.ok(h.visible().includes(h.body));
  h.disk(h.final);await h.manager.changed('Done.md');assert.equal(h.visible(),h.final);assert.equal(h.manager.retentionStatus().completedIndexes,1);assert.equal(h.manager.retentionStatus().proofs,0);
  assert.equal((h.manager as any).records.get(h.id).state.body,undefined);assert.equal((h.manager as any).completionIdentities.get(h.id).commitId,h.record.state!.delivery!.commitId);
 }finally{h.manager.dispose();}
});
test('closed completed notes do not retain full bodies or documents in the native manager',async()=>{
 const h=fixture(false);try{h.disk(h.final);await h.manager.receive(h.record,h.bytes);assert.equal(h.manager.retentionStatus().completedIndexes,1);assert.equal(h.manager.retentionStatus().proofs,0);assert.equal((h.manager as any).records.get(h.id).state.finalBody,undefined);}finally{h.manager.dispose();}
});

test('adopted device completion drops its full proof and keeps a stale-anchor receipt',async()=>{
 const h=fixture();try{
  h.view.setViewData(h.final);h.disk(h.final);h.manager.deviceCommitted('Done.md',JSON.parse(h.bytes));assert.equal(h.manager.retentionStatus().deviceProofs,1);
  await h.manager.receive(h.record,h.bytes);assert.equal(h.manager.retentionStatus().deviceProofs,0);assert.equal(h.manager.retentionStatus().proofs,0);
  h.view.setViewData(h.final.replace(h.body,responseAnchor(h.id)));assert.ok(h.manager.view(h.view)!.conflictRecord());assert.equal((h.manager as any).completionIdentities.get(h.id).commitId,h.record.state!.delivery!.commitId);
 }finally{h.manager.dispose();}
});

test('a reopened stale pane adopts the saved result without retaining its full completion again',async()=>{
 const h=fixture(false);try{
  h.disk(h.final);await h.manager.receive(h.record,h.bytes);assert.equal(h.manager.retentionStatus().completedIndexes,1);
  h.open(true);h.manager.refresh();assert.ok(h.manager.view(h.view)!.conflictRecord());assert.doesNotMatch(h.visible(),/Thinking|Working|Ready/);
  assert.ok(h.manager.reconnectingResponseIds().includes(h.id));await h.manager.receive(h.record,h.bytes);
  for(let i=0;i<20&&h.manager.view(h.view)!.conflictRecord();i++)await new Promise(resolve=>setTimeout(resolve,1));
  assert.equal(h.visible(),h.final);assert.equal(h.manager.view(h.view)!.conflictRecord(),undefined);assert.equal((h.manager as any).records.get(h.id).state.finalBody,undefined);assert.equal(h.manager.retentionStatus().completedIndexes,1);assert.equal(h.manager.retentionStatus().proofs,0);
 }finally{h.manager.dispose();}
});
