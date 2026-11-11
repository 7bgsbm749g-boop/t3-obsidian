import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readImportRuns,readImportPreview,readImportRun} from '../src/conversations/import-source';
import {ImportIndexCache} from '../src/conversations/import-index-cache';
import {T3HttpError} from '../src/conversations/thread-access-cache';
import {t3Api} from '../src/connection/t3-api';
import type {T3Api} from '../src/connection/t3-rpc';
import {settingsSocket} from './rpc-fixture';

const at='2026-01-01T00:00:00.000Z';
const drain=async()=>{for(let n=0;n<4;n++)await new Promise(resolve=>setImmediate(resolve));};
function fixture(){
 let revision='one',body='Canonical answer',reads=0,heads=0,denied=false,unavailable=false,projectId='project';
 let headOverride:(()=>Promise<unknown>)|undefined;
 const api:T3Api=async path=>{
  if(path.startsWith('/api/orchestration/import-head/')){
   heads++;if(denied)throw new T3HttpError(403,'Denied');if(unavailable)throw Error('Older server does not support this read');
   if(headOverride)return headOverride();return {threadId:'thread',projectId,revision};
  }
  reads++;return {snapshotSequence:7,hasMoreHistory:false,projection:{thread:{id:'thread',projectId:'project'},runs:[{id:'run',ordinal:1,status:'completed',userMessageId:'prompt',requestedAt:at,completedAt:at}],messages:[{id:'prompt',runId:'run',role:'user',text:'Exact prompt',streaming:false,createdAt:at},{id:'answer',runId:'run',role:'assistant',text:body,streaming:false,createdAt:at}],turnItems:[{id:'item',messageId:'answer',runId:'run',type:'assistant_message',text:body,streaming:false,status:'completed',ordinal:1,updatedAt:at}]}};
 };
 api.importCacheIdentity={};
 const access={origin:'https://synthetic',api};
 return {access,reads:()=>reads,heads:()=>heads,change:()=>{revision='two';body='Changed canonical answer';},deny:(value:boolean)=>{denied=value;},unsupported:()=>{unavailable=true;},move:()=>{projectId='another';},pending:(read:()=>Promise<unknown>)=>{headOverride=read;}};
}
test('an unchanged authenticated revision reuses canonical run history, while saving still reads fresh data',async()=>{
 const h=fixture(),first=await readImportRuns(h.access,'thread','project'),second=await readImportRuns(h.access,'thread','project');
 assert.equal(h.reads(),1);assert.equal(h.heads(),2);assert.equal(second[0],first[0]);
 assert.equal((await readImportPreview(h.access,'thread','project',second[0],'machine')).body,'Canonical answer');
 await readImportRun(h.access,'thread','project','run');assert.equal(h.reads(),2,'checked saving never reuses the picker index');
});
test('a changed revision rebuilds the index and cannot keep an earlier answer',async()=>{
 const h=fixture();await readImportRuns(h.access,'thread','project');h.change();const runs=await readImportRuns(h.access,'thread','project');
 assert.equal(h.reads(),2);assert.equal((await readImportPreview(h.access,'thread','project',runs[0],'machine')).body,'Changed canonical answer');
});
test('changed credentials and denied or moved sources cannot reuse another index',async()=>{
 const h=fixture();await readImportRuns(h.access,'thread','project');h.access.api.importCacheIdentity={};await readImportRuns(h.access,'thread','project');assert.equal(h.reads(),2);
 h.deny(true);await assert.rejects(readImportRuns(h.access,'thread','project'),/Denied/);assert.equal(h.reads(),2);
 h.deny(false);await readImportRuns(h.access,'thread','project');assert.equal(h.reads(),3,'a denied read evicts its prior index');
 h.move();await assert.rejects(readImportRuns(h.access,'thread','project'),/requested T3 thread/);assert.equal(h.reads(),3);
});
test('an older stock server without the revision reader still performs ordinary imports',async()=>{
 const h=fixture();h.unsupported();assert.equal((await readImportRuns(h.access,'thread','project')).length,1);assert.equal((await readImportRuns(h.access,'thread','project')).length,1);assert.equal(h.reads(),2);
});
test('credential renewal during the head read cannot adopt the previous credential cache',async()=>{
 const h=fixture();await readImportRuns(h.access,'thread','project');h.change();
 h.pending(async()=>{h.access.api.importCacheIdentity={};return {threadId:'thread',projectId:'project',revision:'one'};});
 const runs=await readImportRuns(h.access,'thread','project');assert.equal(h.reads(),2);assert.equal((await readImportPreview(h.access,'thread','project',runs[0],'machine')).body,'Changed canonical answer');
});
test('caller cancellation cannot expose a cached index before its fresh revision check finishes',async()=>{
 const h=fixture();await readImportRuns(h.access,'thread','project');let release!:(value:unknown)=>void;h.pending(()=>new Promise(resolve=>{release=resolve;}));
 const controller=new AbortController(),work=readImportRuns(h.access,'thread','project',controller.signal);controller.abort(Error('Picker closed'));
 await assert.rejects(work,/Picker closed/);release({threadId:'thread',projectId:'project',revision:'one'});await drain();assert.equal(h.reads(),1);
});
test('the optional retention budget evicts cached data without rejecting an oversized import result',async()=>{
 const cache=new ImportIndexCache(1,10),identity={},snapshot={thread:{id:'thread',projectId:'project',messages:[],activities:[]}};
 assert.doesNotThrow(()=>cache.remember(identity,'thread','project','revision',[],snapshot));assert.equal(cache.read(identity,'thread','project','revision'),undefined);
});

test('the revision read uses the stock family RPC and never sends an import HTTP endpoint',async()=>{
 const paths:string[]=[],calls:unknown[]=[],Socket=settingsSocket(undefined,undefined,(tag,payload)=>{calls.push({tag,payload});assert.equal(tag,'orchestration.getThreadFamily');return {snapshotSequence:2,threads:[{id:'thread',projectId:'project',updatedAt:at,latestRunId:'run',status:'completed'}]};});
 const api=t3Api(async path=>{paths.push(path);assert.equal(path,'/api/auth/websocket-ticket');return {ticket:'test'};},'https://synthetic',url=>new Socket(url) as unknown as WebSocket);
 const head=await api('/api/orchestration/import-head/thread') as {threadId:string;projectId:string;revision:string};
 assert.equal(head.threadId,'thread');assert.equal(head.projectId,'project');assert.ok(head.revision);assert.equal(calls.length,1);assert.deepEqual(paths,['/api/auth/websocket-ticket']);
});
test('cancelling a revision read closes its owned socket during opening',async()=>{
 let socket:{onopen?:()=>void;onclose?:()=>void;close:()=>void}|undefined,closes=0,closed=false;
 const controller=new AbortController(),api=t3Api(async()=>({ticket:'test'}),'https://synthetic',()=>{
  socket={close:()=>{if(closed)return;closed=true;closes++;queueMicrotask(()=>socket?.onclose?.());}};return socket as unknown as WebSocket;
 });
 const work=api('/api/orchestration/import-head/thread',undefined,{signal:controller.signal});await drain();assert.ok(socket);
 controller.abort(Error('Picker closed'));await assert.rejects(work,/Picker closed/);assert.equal(closes,1);
});
test('cancellation after the revision RPC starts closes its connection and rejects the pending read',async()=>{
 let closed=false,requests=0;let socket:{onopen?:()=>void;onclose?:()=>void;close:()=>void;send:(text:string)=>void};
 const controller=new AbortController(),api=t3Api(async()=>({ticket:'test'}),'https://synthetic',()=>{
  socket={close:()=>{if(closed)return;closed=true;queueMicrotask(()=>socket.onclose?.());},send:text=>{assert.equal(JSON.parse(text).tag,'orchestration.getThreadFamily');requests++;}};
  queueMicrotask(()=>socket.onopen?.());return socket as unknown as WebSocket;
 });
 const work=api('/api/orchestration/import-head/thread',undefined,{signal:controller.signal});await drain();assert.equal(requests,1);
 controller.abort(Error('Picker closed'));await assert.rejects(work,/Picker closed/);assert.equal(closed,true);
});
test('cancellation before a late ticket arrives cannot open a revision socket',async()=>{
 let issue!:(value:unknown)=>void,opens=0;
 const controller=new AbortController(),api=t3Api(()=>new Promise(resolve=>{issue=resolve;}),'https://synthetic',()=>{opens++;throw Error('Must not open');});
 const work=api('/api/orchestration/import-head/thread',undefined,{signal:controller.signal});controller.abort(Error('Picker closed'));await assert.rejects(work,/Picker closed/);
 issue({ticket:'late'});await drain();assert.equal(opens,0);
});
