import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {uuid5,canonical,start,cli,parseOperation,requestJson} from '../desktop';
import {resolveNewThreadModel} from '../model-defaults';
import {modelConfig} from './rpc-fixture';
const id='98e4d70e-cbd5-4a23-aad0-a50732a59bf2';
test('native IDs and fingerprints match old durable requests',()=>{
 assert.equal(uuid5(id,'thread'),'6732c96c-84e7-5252-8c8a-ce9bb2d9ad50');
 assert.equal(canonical({z:'🧪',a:['é',true]}),'{"a": ["\\u00e9", true], "z": "\\ud83e\\uddea"}');
 assert.throws(()=>parseOperation(['rpc'],''));
 const r=parseOperation(['start','--project','p','--title','$(touch /tmp/unsafe); `whoami`','--request-id',id,'--prompt-file','-'],'🧪');assert.equal(r.prompt,'🧪');
});
test('durable native retry replays identical commands after a lost response',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'native-ledger-'));let fail=true;const calls:any[]=[];
 const config=modelConfig();let reads=0;
 const loadModel=async(project:any)=>{reads++;return resolveNewThreadModel(config,project);};
 const api=async(path:string,payload?:any)=>{if(path==='shell')return {projects:[{id:'p',defaultModelSelection:{instanceId:'codex',model:'stale'}}],threads:[{projectId:'unrelated',runtimeMode:'full-access',updatedAt:'2026-09-19',modelSelection:{instanceId:'codex',model:'gpt-6-astra',options:[{id:'reasoningEffort',value:'xhigh'}]}}]};calls.push(payload);if(payload.type==='thread.turn.start'&&fail){fail=false;throw Error('lost ack');}return {};};
 const req={action:'start',requestId:id,project:'p',title:'T',prompt:'🧪',attachments:[{id:'i',dataUrl:'data:image/png;base64,YQ=='}],context:{version:1}};
 try{
 await assert.rejects(start(api,req,dir,loadModel),/lost ack/);
 assert.equal(calls[0].runtimeMode,'approval-required');assert.equal(calls[1].runtimeMode,'approval-required');assert.deepEqual(calls[0].modelSelection,config.settings.defaultModelSelection);assert.deepEqual(calls[1].modelSelection,calls[0].modelSelection);
 config.settings.defaultModelSelection.model='changed-default';
 const result=await start(api,req,dir);assert.equal(result.phase,'started');assert.equal(calls.length,3);assert.deepEqual(calls[1],calls[2]);assert.deepEqual(calls[2].message.attachments,req.attachments);
 assert.equal(reads,1);
 await start(api,req,dir);assert.equal(calls.length,3);
 const terminal=JSON.parse(await readFile(join(dir,'requests',id+'.json'),'utf8'));assert.equal(terminal.turn,undefined);assert.equal(terminal.create,undefined);assert.ok(terminal.requestHash);
 await assert.rejects(start(api,{...req,prompt:'changed'},dir),/different parameters/);
 await start(api,{...req,requestId:'7619d88f-320d-4882-8824-e45d930715db'},dir,loadModel);assert.equal(calls.at(-1).modelSelection.model,'changed-default');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('native settings failures leave no plan and retry reads the current default',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'native-model-failure-'));const calls:any[]=[];
 const api=async(path:string,payload?:any)=>{if(path==='shell')return {projects:[{id:'p'}],threads:[]};calls.push(payload);return {};};
 const req={action:'start',requestId:id,project:'p',title:'Note',prompt:'Content'};
 try{
  await assert.rejects(start(api,req,dir,async()=>{throw Error('Settings unavailable');}),/Settings unavailable/);
  assert.equal(calls.length,0);
  await start(api,req,dir,async project=>resolveNewThreadModel(modelConfig(),project));
  assert.equal(calls.length,2);assert.equal(calls[0].modelSelection.model,'gpt-5.6-sol');
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('official CLI receives literal arguments with no shell',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'native-cli-'));
 try{const path=join(dir,'CLI with spaces.cjs');await writeFile(path,'console.log(JSON.stringify(process.argv.slice(2)))');const args=['$(touch /tmp/unsafe)','`whoami`','; & "quoted"'];assert.deepEqual(JSON.parse(await cli([process.execPath,path],args)),args);}finally{await rm(dir,{recursive:true,force:true});}
});
test('direct HTTP refuses remote origins and does not follow credential redirects',async()=>{
 assert.throws(()=>requestJson('https://example.com','secret','shell'),/loopback/);
 const server=createServer((_req,res)=>{res.writeHead(302,{Location:'http://example.com'});res.end();});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 try{const port=(server.address() as any).port;await assert.rejects(requestJson('http://127.0.0.1:'+port,'secret','shell'),/302/);}finally{server.close();}
});

test('native existing-thread delivery preserves the target and retries only its original turn',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'native-existing-'));let lose=true,reads=0;const calls:any[]=[];
 const threadId='7619d88f-320d-4882-8824-e45d930715db';
 const api=async(path:string,payload?:any)=>{
  if(path.startsWith('threads/')){reads++;return {thread:{id:threadId,projectId:'p',runtimeMode:'approval-required',interactionMode:'plan'}};}
  calls.push(payload);if(lose){lose=false;throw Error('lost ack');}return {};
 };
 const req=parseOperation(['start','--project','p','--title','Note','--request-id',id,'--payload-file','-'],JSON.stringify({threadId,prompt:'New note content',attachments:[]}));
 try{
  await assert.rejects(start(api,req,dir),/lost ack/);
  const result=await start(api,req,dir);
  assert.equal(result.threadId,threadId);assert.equal(reads,1);assert.equal(calls.length,2);
  assert.deepEqual(calls[0],calls[1]);assert.equal(calls[0].type,'thread.turn.start');
  assert.equal(calls[0].runtimeMode,'approval-required');assert.equal(calls[0].interactionMode,'plan');assert.equal(calls[0].modelSelection,undefined);
  await assert.rejects(start(api,{...req,threadId:id},dir),/different parameters/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
