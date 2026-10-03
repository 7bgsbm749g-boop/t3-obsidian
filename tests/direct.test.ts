import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pair, pairingInput,sendDirect,readDirect,commandId} from '../direct';
import type {Request} from '../bridge';
import {modelConfig,settingsSocket} from './rpc-fixture';
const eid='environment';const url='https://t3.example';const now=Date.now();
const session={url,environmentId:eid,token:'device-token',expiresAt:now+600000};
const descriptor={environmentId:eid,label:'Computer',orchestrationProtocolVersion:1};
const response=(d:any,status=200)=>new Response(JSON.stringify(d),{status});
test('pairing parses native and hosted links without leaking secrets into endpoints',()=>{
 assert.deepEqual(pairingInput(url+'/pair#token=one-time'),{url,code:'one-time'});
 assert.deepEqual(pairingInput('https://app.t3.codes/pair?host=https%3A%2F%2Ft3.example#token=abc'),{url,code:'abc'});
 for(const address of ['http://public.example/pair#token=a','https://u:p@t3.example/pair#token=a',url+'/rpc',url+'/?token=a'])assert.throws(()=>pairingInput(address));
});
test('pairing exchanges code once for scoped device credentials, no cookies or redirects',async()=>{
 const calls:any[]=[];
 const fetcher=async(u:any,o:any)=>{calls.push({u,o});assert.equal(o.redirect,'error');assert.equal(o.credentials,'omit');return response(calls.length===1?descriptor:{token_type:'Bearer',access_token:'new-token',expires_in:3600,scope:'orchestration:read orchestration:operate'});};
 const result=await pair(url+'/pair#token=secret-code','',fetcher as any);
 assert.equal(calls[0].u,url+'/.well-known/t3/environment');assert.equal(calls[1].u,url+'/oauth/token');assert.equal(new URLSearchParams(calls[1].o.body).get('subject_token'),'secret-code');assert.equal(result.session.token,'new-token');assert.ok(!JSON.stringify(result).includes('secret-code'));
});
test('direct sends use current T3 defaults, then persist model and commands across lost responses',async(t)=>{
 const commands:any[]=[];let lose=true;let saved=0,reads=0;const config=modelConfig();
 const original=globalThis.WebSocket;t.after(()=>{globalThis.WebSocket=original;});
 globalThis.WebSocket=settingsSocket(()=>config,()=>{reads++;}) as any;
 const fetcher=async(u:any,o:any)=>{
  if(u.endsWith('/.well-known/t3/environment'))return response(descriptor);
  assert.equal(o.headers.Authorization,'Bearer device-token');
  if(u.endsWith('/websocket-ticket'))return response({ticket:'ephemeral'});
  if(u.endsWith('/shell'))return response({projects:[{id:'p',defaultModelSelection:{instanceId:'codex',model:'stale'}}],threads:[{projectId:'unrelated',runtimeMode:'approval-required',updatedAt:'2026-09-19',modelSelection:{instanceId:'codex',model:'gpt-6-astra',options:[{id:'reasoningEffort',value:'xhigh'}]}}]});
  assert.ok(saved>0);const cmd=JSON.parse(o.body);commands.push(cmd);
  if(cmd.type==='thread.turn.start'&&lose){lose=false;throw Error('lost reply');}return response({});
 };
 const request:Request={id:'98e4d70e-cbd5-4a23-aad0-a50732a59bf2',project:{id:'p',title:'P',workspaceRoot:'/'},connection:{transport:'direct',connectionId:'c',environmentId:eid,url,host:'direct',executable:''},title:'literal $(whoami)',prompt:'image here',attachments:[{type:'image',id:'i',name:'i.png',mimeType:'image/png',sizeBytes:1,dataUrl:'data:image/png;base64,YQ=='}]};
 const save=async()=>{saved++;};
 await assert.rejects(sendDirect(request,session,save,fetcher as any),/Cannot reach/);
 assert.equal(reads,1);assert.equal(commands[0].runtimeMode,'full-access');assert.equal(commands[1].runtimeMode,'full-access');assert.deepEqual(commands[0].modelSelection,config.settings.defaultModelSelection);assert.deepEqual(commands[1].modelSelection,commands[0].modelSelection);
 config.settings.defaultModelSelection.model='changed-default';
 config.settings.defaultRuntimeMode='approval-required';
 const restored=JSON.parse(JSON.stringify(request));const result=await sendDirect(restored,session,save,fetcher as any);assert.equal(result.threadId,commandId(request.id,'thread'));assert.equal(commands.length,3);assert.deepEqual(commands[1],commands[2]);
 assert.equal(reads,1,'Saved retries must not reselect the model');
 await sendDirect(restored,session,save,fetcher as any);assert.equal(commands.length,3);
 await assert.rejects(sendDirect({...restored,prompt:'changed'},session,save,fetcher as any),/no longer matches/);
 let dispatched=false;await assert.rejects(sendDirect({...request,directPlan:undefined},session,async()=>{throw Error('disk full');},(async(u:any,o:any)=>{if(u.endsWith('/dispatch'))dispatched=true;return fetcher(u,o);}) as any),/disk full/);assert.equal(dispatched,false);
 const fresh={...request,id:'7619d88f-320d-4882-8824-e45d930715db',directPlan:undefined};
 await sendDirect(fresh,session,save,fetcher as any);assert.equal(commands.at(-1).modelSelection.model,'changed-default');assert.equal(commands.at(-1).runtimeMode,'approval-required');
});
test('new direct sends never dispatch or copy history when settings cannot be read',async()=>{
 const request:Request={id:'98e4d70e-cbd5-4a23-aad0-a50732a59bf2',project:{id:'p',title:'P',workspaceRoot:'/'},connection:{transport:'direct',connectionId:'c',environmentId:eid,url,host:'direct',executable:''},title:'Note',prompt:'Content'};
 let dispatched=false,saved=false;
 const fetcher=async(u:any)=>{
  if(u.endsWith('/environment'))return response(descriptor);
  if(u.endsWith('/shell'))return response({projects:[{id:'p',defaultModelSelection:{instanceId:'codex',model:'stale'}}],threads:[]});
  if(u.endsWith('/websocket-ticket'))return response({},503);
  dispatched=true;return response({});
 };
 await assert.rejects(sendDirect(request,session,async()=>{saved=true;},fetcher as any),/503/);
 assert.equal(dispatched,false);assert.equal(saved,false);assert.equal(request.directPlan,undefined);
});

test('direct credentials are bound to origin/environment and expired sessions require re-pairing',async()=>{
 const c={transport:'direct' as const,url,environmentId:eid,host:'direct',executable:''};let calls=0;
 const wrong=async()=>{calls++;return response({...descriptor,environmentId:'someone-else'});};
 await assert.rejects(readDirect(c,['projects'],session,wrong as any),/different T3 environment/);assert.equal(calls,1);
 await assert.rejects(readDirect(c,['projects'],{...session,expiresAt:1},wrong as any),/expired/);assert.equal(calls,1);
 await assert.rejects(readDirect({...c,url:'https://other.example'},['projects'],session,wrong as any),/Pair this connection/);assert.equal(calls,1);
});

test('existing-thread sends preserve conversation settings and retry one immutable message without creating a thread',async()=>{
 const commands:any[]=[];let lose=true,saves=0,reads=0;
 const thread={id:'existing-thread',projectId:'p',title:'Ongoing',runtimeMode:'approval-required',interactionMode:'plan',modelSelection:{instanceId:'codex',model:'existing-model'},session:{status:'running',runtimeMode:'approval-required'},hasPendingApprovals:false,hasPendingUserInput:false};
 const fetcher=async(u:any,o:any)=>{
  if(u.endsWith('/environment'))return response(descriptor);
  if(u.includes('/threads/')){reads++;return response({thread});}
  assert.ok(saves>0);const command=JSON.parse(o.body);commands.push(command);
  if(lose){lose=false;throw Error('Lost ack');}return response({});
 };
 const request:Request={id:'98e4d70e-cbd5-4a23-aad0-a50732a59bf2',threadId:thread.id,project:{id:'p',title:'P',workspaceRoot:'/'},connection:{transport:'direct',connectionId:'c',environmentId:eid,url,host:'direct',executable:''},title:'Note',prompt:'Markdown with image',attachments:[{type:'image',id:'i',name:'i.png',mimeType:'image/png',sizeBytes:1,dataUrl:'data:image/png;base64,YQ=='}]};
 const save=async()=>{saves++;};
 await assert.rejects(sendDirect(request,session,save,fetcher as any),/Cannot reach/);
 const restored=JSON.parse(JSON.stringify(request));
 const result=await sendDirect(restored,session,save,fetcher as any);
 assert.equal(result.threadId,thread.id);assert.equal(reads,1);
 assert.equal(commands.length,2);assert.deepEqual(commands[0],commands[1]);
 assert.equal(commands[0].type,'thread.turn.start');assert.equal(commands[0].runtimeMode,'approval-required');assert.equal(commands[0].interactionMode,'plan');
 assert.equal(commands[0].modelSelection,undefined,'Omitting a model preserves the existing conversation selection');
 assert.deepEqual(commands[0].message.attachments,request.attachments);
 await assert.rejects(sendDirect({...restored,threadId:'different'},session,save,fetcher as any),/no longer matches/);
});

test('existing-thread validation rejects other projects, archived threads, and pending input before dispatch',async()=>{
 for(const overrides of [{projectId:'other'},{archivedAt:'2026-09-19'},{hasPendingApprovals:true},{hasPendingUserInput:true}]){
  let dispatched=false;
  const request:Request={id:'98e4d70e-cbd5-4a23-aad0-a50732a59bf2',threadId:'existing',project:{id:'p',title:'P',workspaceRoot:'/'},connection:{transport:'direct',connectionId:'c',environmentId:eid,url,host:'direct',executable:''},title:'Note',prompt:'Content'};
  const fetcher=async(u:any)=>{if(u.endsWith('/environment'))return response(descriptor);if(u.includes('/threads/'))return response({thread:{id:'existing',projectId:'p',...overrides}});dispatched=true;return response({});};
  await assert.rejects(sendDirect(request,session,async()=>{},fetcher as any),/thread|approval|input/i);
  assert.equal(dispatched,false);
 }
});

test('direct acknowledgement persists exact prompt delivery and the observed active run across a retry',async()=>{
  const request:Request={id:'c3b04c8e-f340-4202-bfa2-ae65ed4e2a3a',threadId:'thread',project:{id:'p',title:'P',workspaceRoot:'/'},connection:{transport:'direct',connectionId:'c',environmentId:eid,url,host:'direct',executable:''},title:'Steer',prompt:'Ordinary mid-run input'};
  const snapshots:any[]=[];let dispatches=0;
  const fetcher=async(u:any)=>{
    if(u.endsWith('/.well-known/t3/environment'))return response(descriptor);
    if(u.includes('/threads/'))return response({thread:{id:'thread',projectId:'p',session:{status:'running',activeTurnId:'existing',runtimeMode:'approval-required'}}});
    dispatches++;return response({sequence:123});
  };
  await sendDirect(request,session,async()=>{snapshots.push(structuredClone(request));},fetcher as any);
  assert.deepEqual(request.directPlan?.delivery,{messageId:commandId(request.id,'message'),requestedAt:request.directPlan!.turn.createdAt,sequence:123,activeTurnId:'existing'});
  const restored=structuredClone(snapshots.at(-1));await sendDirect(restored,session,async()=>{},fetcher as any);
  assert.equal(dispatches,1);assert.deepEqual(restored.directPlan.delivery,request.directPlan?.delivery);
});
