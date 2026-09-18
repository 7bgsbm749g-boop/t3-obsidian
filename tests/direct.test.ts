import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pair, pairingInput,sendDirect,readDirect,commandId} from '../direct';
import type {Request} from '../bridge';
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
test('direct sends persist plans before dispatch and recover a lost turn response without duplicate commands',async()=>{
 const commands:any[]=[];let lose=true;let saved=0;
 const fetcher=async(u:any,o:any)=>{
  if(u.endsWith('/.well-known/t3/environment'))return response(descriptor);
  assert.equal(o.headers.Authorization,'Bearer device-token');
  if(u.endsWith('/shell'))return response({projects:[{id:'p',defaultModelSelection:{instanceId:'codex',model:'default'}}],threads:[]});
  assert.ok(saved>0);const cmd=JSON.parse(o.body);commands.push(cmd);
  if(cmd.type==='thread.turn.start'&&lose){lose=false;throw Error('lost reply');}return response({});
 };
 const request:Request={id:'98e4d70e-cbd5-4a23-aad0-a50732a59bf2',project:{id:'p',title:'P',workspaceRoot:'/'},connection:{transport:'direct',connectionId:'c',environmentId:eid,url,host:'direct',executable:''},title:'literal $(whoami)',prompt:'image here',attachments:[{type:'image',id:'i',name:'i.png',mimeType:'image/png',sizeBytes:1,dataUrl:'data:image/png;base64,YQ=='}]};
 const save=async()=>{saved++;};
 await assert.rejects(sendDirect(request,session,save,fetcher as any),/Cannot reach/);
 const restored=JSON.parse(JSON.stringify(request));const result=await sendDirect(restored,session,save,fetcher as any);assert.equal(result.threadId,commandId(request.id,'thread'));assert.equal(commands.length,3);assert.deepEqual(commands[1],commands[2]);
 await sendDirect(restored,session,save,fetcher as any);assert.equal(commands.length,3);
 await assert.rejects(sendDirect({...restored,prompt:'changed'},session,save,fetcher as any),/no longer matches/);
 let dispatched=false;await assert.rejects(sendDirect({...request,directPlan:undefined},session,async()=>{throw Error('disk full');},(async(u:any,o:any)=>{if(u.endsWith('/dispatch'))dispatched=true;return fetcher(u,o);}) as any),/disk full/);assert.equal(dispatched,false);
});
test('direct credentials are bound to origin/environment and expired sessions require re-pairing',async()=>{
 const c={transport:'direct' as const,url,environmentId:eid,host:'direct',executable:''};let calls=0;
 const wrong=async()=>{calls++;return response({...descriptor,environmentId:'someone-else'});};
 await assert.rejects(readDirect(c,['projects'],session,wrong as any),/different T3 environment/);assert.equal(calls,1);
 await assert.rejects(readDirect(c,['projects'],{...session,expiresAt:1},wrong as any),/expired/);assert.equal(calls,1);
 await assert.rejects(readDirect({...c,url:'https://other.example'},['projects'],session,wrong as any),/Pair this connection/);assert.equal(calls,1);
});
