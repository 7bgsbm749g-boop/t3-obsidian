import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ensureNoProject,NO_PROJECT,noProjectKey,noProjectMachine,isNoProjectKey} from '../no-project';
import {t3Api} from '../t3-api';
import {readDirect,sendDirect,commandId} from '../direct';
import type {Request} from '../bridge';
import {noteThreadTitle} from '../thread-title';
import {settingsSocket} from './rpc-fixture';
import {availableDesktopEnvironment} from '../desktop';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('local availability discovery is a bounded public loopback read and missing runtimes need no network',async()=>{
  const base=await mkdtemp(join(tmpdir(),'no-project-local-'));const connection={host:'local',executable:'',baseDir:base};
  const server=createServer((request,response)=>{assert.equal(request.url,'/.well-known/t3/environment');assert.equal(request.headers.authorization,undefined);response.end(JSON.stringify({environmentId:'local-test',orchestrationProtocolVersion:2}));});
  try{
    assert.equal(await availableDesktopEnvironment(connection),undefined);
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const port=(server.address() as any).port;
    await mkdir(join(base,'userdata'));const runtime=join(base,'userdata/server-runtime.json');await writeFile(runtime,JSON.stringify({origin:`http://127.0.0.1:${port}`}));
    assert.equal(await availableDesktopEnvironment(connection),'local-test');
    server.removeAllListeners('request');server.on('request',()=>{});
    const started=performance.now();assert.equal(await availableDesktopEnvironment(connection,40),undefined);assert.ok(performance.now()-started<500);
    await writeFile(runtime,JSON.stringify({origin:'https://remote.example'}));assert.equal(await availableDesktopEnvironment(connection),undefined);
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(base,{recursive:true,force:true});}
});

test('No project uses T3 native setup and retains its actual ID and workspace',async()=>{
  const calls:string[]=[];
  const Socket=settingsSocket(undefined,undefined,(tag,payload)=>{assert.equal(tag,'projects.ensureScratch');assert.deepEqual(payload,{});return {projectId:'scratch'};});
  const api=t3Api(async(path,payload)=>{
    calls.push(path);
    if(path==='/api/auth/websocket-ticket')return {ticket:'test-ticket'};
    assert.equal(path,'/api/orchestration/shell');assert.equal(payload,undefined);
    return {projects:[{id:'scratch',title:'Server title',workspaceRoot:'/t3/scratch'},{id:'vault',title:'Vault',workspaceRoot:'/vault'}]};
  },'https://t3.example',url=>new Socket(url) as unknown as WebSocket);
  assert.deepEqual(await ensureNoProject(api),{id:'scratch',title:'No project',workspaceRoot:'/t3/scratch'});
  assert.deepEqual(calls,['/api/auth/websocket-ticket','/api/orchestration/shell']);
});

test('No project setup refuses an invalid native identity or missing workspace',async()=>{
  await assert.rejects(ensureNoProject(async()=>({projectId:null})),/does not support/);
  await assert.rejects(ensureNoProject(async path=>path.endsWith('no-project')?{projectId:'scratch'}:{projects:[]}),/has not returned/);
});

test('No project choices retain an exact machine and cannot match ordinary project IDs',()=>{
  assert.equal(isNoProjectKey(NO_PROJECT),true);
  for(const machine of ['local','paired-id','environment:discovered'])assert.equal(noProjectMachine(noProjectKey(machine)),machine);
  assert.equal(isNoProjectKey('paired-id:project'),false);
});

test('remote setup retains connection validation before opening No project',async()=>{
  await assert.rejects(readDirect({transport:'direct',host:'direct',executable:'',url:'https://t3.example',connectionId:'c',environmentId:'env'},['no-project']),/Pair this connection/);
});

test('authenticated No project setup and automatic naming share the native launch path',async(t)=>{
  const original=globalThis.WebSocket;t.after(()=>{globalThis.WebSocket=original;});
  const url='https://t3.example',environmentId='env',nativeProject={id:'native-no-project',title:'Server title',workspaceRoot:'/t3/scratch'};
  const connection={transport:'direct' as const,host:'direct',executable:'',url,connectionId:'c',environmentId};
  const session={url,environmentId,token:'test-session',expiresAt:Date.now()+600000};
  const calls:string[]=[],launches:any[]=[];let saved=false;
  globalThis.WebSocket=settingsSocket(undefined,undefined,(tag,payload)=>{
    calls.push(tag);
    if(tag==='projects.ensureScratch'){assert.deepEqual(payload,{});return {projectId:nativeProject.id};}
    assert.equal(tag,'orchestration.launchThread');assert.equal(saved,true);launches.push(payload);return {threadId:payload.threadId};
  }) as any;
  const fetcher:any=async(path:string,options:any)=>{
    if(path.endsWith('/environment'))return new Response(JSON.stringify({environmentId,label:'Computer',orchestrationProtocolVersion:2}));
    assert.equal(options.headers.Authorization,'Bearer test-session');
    if(path.endsWith('/websocket-ticket'))return new Response(JSON.stringify({ticket:'test-ticket'}));
    assert.ok(path.endsWith('/shell'));return new Response(JSON.stringify({projects:[nativeProject]}));
  };
  const project=await readDirect(connection,['no-project'],session,fetcher);
  assert.deepEqual(project,{...nativeProject,title:'No project'});
  const request:Request={id:'98e4d70e-cbd5-4a23-aad0-a50732a59bf2',project,connection,title:noteThreadTitle('Untitled.md','untitled-only'),prompt:'A note without a linked folder'};
  const result=await sendDirect(request,session,async()=>{saved=true;},fetcher);
  assert.deepEqual(calls,['projects.ensureScratch','orchestration.launchThread']);
  assert.equal(result.threadId,commandId(request.id,'thread'));assert.equal(launches[0].projectId,nativeProject.id);
  assert.equal(launches[0].generateTitle,true);assert.deepEqual(launches[0].workspaceStrategy,{type:'root'});
  assert.equal(launches[0].initialMessage.text,request.prompt);
});
