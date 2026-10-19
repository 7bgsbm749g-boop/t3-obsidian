import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {LocalResponseManager} from '../local-response-manager';
import {responseAnchor} from '../native-response-projection';
import {updateResponseBindingData,responseBindingRequests} from '../response-binding-data';
import {SignInRequiredError,responseConnectionBody,type ResponseConnectionIssue} from '../sign-in-state';
import type {ResponseRequest} from '../response-model';

const settle=async()=>{for(let n=0;n<16;n++)await new Promise(resolve=>setImmediate(resolve));};

test('a cold receiving device pauses for sign-in, then reads and verifies the exact completed run while retaining a new line',async()=>{
 const prompt=randomUUID();
 const request:ResponseRequest={version:4,id:randomUUID(),vaultId:'device-switch',localOnly:true,nativeProjection:true,responseContainer:true,independent:true,initialOwner:randomUUID(),host:{environmentId:'env',workspaceRoot:'/synthetic',directory:'.obsidian/t3-code/inline/v1'},notePath:'Switch.md',threadId:'thread',projectId:'project',messageId:prompt,threadEnvironmentId:'env',initialHash:'0'.repeat(64),createdAt:'2026-10-19T00:00:00Z',threadTitle:'Phone response',keepIntermediate:true,intermediateMode:'collapse'};
 // Only the durable Markdown and routing record transfer. No warm preview,
 // completed response callback, credentials or final cache is copied to B.
 let document=`Before\n\n${responseAnchor(request.id)}\n\nAfter`;
 const records=responseBindingRequests(updateResponseBindingData({},request,'phone',1));
 const reads:string[]=[],issues:Array<ResponseConnectionIssue|undefined>=[];
 let authenticated=false,writes=0,accesses=0;
 const run={turnId:'run',state:'completed',messageId:prompt,assistantMessageId:'answer',completedAt:'2026-10-19T00:01:00Z'};
 const snapshot={snapshotSequence:2,thread:{protocolVersion:2,id:'thread',projectId:'project',title:'Phone response',turns:{run},latestTurn:run,session:{status:'ready',activeTurnId:null},activities:[],messages:[{id:prompt,role:'user',turnId:'run',text:'Question',streaming:false},{id:'answer',role:'assistant',turnId:'run',itemId:'final-item',text:'Canonical final answer',streaming:false,updatedAt:'2026-10-19T00:01:00Z'}]}};
 const previousSocket=globalThis.WebSocket;
 class Socket {
  onopen?:()=>void;onmessage?:(event:{data:string})=>void;onclose?:()=>void;onerror?:()=>void;
  constructor(_url:string){queueMicrotask(()=>this.onopen?.());}
  send(raw:string){const frame=JSON.parse(raw);if(frame.tag==='orchestration.subscribeThread')queueMicrotask(()=>this.onmessage?.({data:JSON.stringify({_tag:'Chunk',requestId:frame.id,values:[{kind:'snapshot',snapshot},{kind:'synchronized'}]})}));}
  close(){this.onclose?.();}
 }
 globalThis.WebSocket=Socket as any;
 const io:any={localBindings:()=>records,openedNotes:()=>[{path:request.notePath,document}],isOpen:()=>true,syncReady:()=>true,readNote:async()=>document,localConnection:(_id:string,issue?:ResponseConnectionIssue)=>issues.push(issue),receiveDirect:()=>{},access:async()=>{
  accesses++;if(!authenticated)throw new SignInRequiredError();
  return {origin:'https://synthetic',api:async(path:string)=>{reads.push(path);if(path==='/api/auth/websocket-ticket')return {ticket:'synthetic'};if(path==='/api/orchestration/turn-item')return {id:'final-item',threadId:'thread',runId:'run',messageId:'answer',type:'assistant_message',text:'Canonical final answer',streaming:false,status:'completed',updatedAt:'2026-10-19T00:01:00Z'};return snapshot;}};
 }};
 const manager=new LocalResponseManager('laptop',request.vaultId,io,{read:async()=>document,compareAndSet:async(_path,before,after,guard)=>{if(document!==before||guard?.()===false)return false;document=after;writes++;return true;}});
 try{
  manager.resume();await settle();assert.equal(issues.at(-1)?.kind,'sign-in-required');assert.equal(writes,0);assert.equal(manager.status(request.id)?.finalSaved,false);
  for(let n=0;n<4;n++)manager.tick();await settle();assert.equal(accesses,1,'A signed-out response must not repeat rejected authentication in the background');
  document=document.replace('Before','Before\nNew ordinary line');
  authenticated=true;manager.reconnect();await settle();
  assert.equal(issues.at(-1),undefined);assert.equal(writes,1);assert.match(document,/Canonical final answer/);assert.match(document,/Before\nNew ordinary line/);assert.doesNotMatch(document,/data-t3-response=/);
  assert.equal(reads.filter(path=>path==='/api/orchestration/turn-item').length,1,'Completion must be checked through the real final-item reader');
  assert.equal(manager.status(request.id)?.runTerminal,true);assert.equal(manager.status(request.id)?.finalSaved,true);
 }finally{manager.dispose();globalThis.WebSocket=previousSocket;}
});

test('the waiting sign-in display has a stable control identity and preserves progress text',()=>{
 const id=randomUUID(),body='> [!t3-progress]+ **New thread · Working** <span class="send-to-t3-inline-spinner" aria-label="Loading"></span>\n>\n> Received progress stays.';
 const visible=responseConnectionBody(body,{kind:'sign-in-required'},id);
 assert.match(visible,/Sign in required/);assert.match(visible,new RegExp(`data-t3-fold="${id}:connection:active"`));assert.match(visible,/Received progress stays/);assert.doesNotMatch(visible,/inline-spinner/);
 assert.match(body,/Working/,'The source preview must not be rewritten by the display-only warning');
});
