import {expectRecord} from './wire-fixture';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {codebaseTransport} from '../src/projects/codebase-transport';
import {CodebaseDocument} from '../src/projects/codebase-core';
import {filesystemReference} from '../src/projects/codebase-links';
const scope={environmentId:'env',projectId:'project',root:'/outside',title:'Project'};
test('machine file RPCs need authentication and filesystem access but no registered project',async()=>{
 let catalogs=0,remote='original';const calls:Array<{tag:string;payload:any}>=[];
 const io=codebaseTransport(async environmentId=>{assert.equal(environmentId,'env');return {origin:'https://t3.example',api:async()=>{catalogs++;throw Error('No catalog');}};},{connect:async()=>({closed:false,close(){},call:async(tag,payload:any)=>{
  calls.push({tag,payload});
  if(tag==='projects.readFile')return {contents:remote,byteLength:remote.length,truncated:false};
  if(tag==='projects.writeFile'){remote=payload.contents;return {};}
  if(tag==='assets.createUrl')return {relativeUrl:'/api/assets/file?key=signed',expiresAt:Date.now()+300000};
  throw Error('Unexpected RPC');
 }})});
 try{
  for(const path of ['/srv/reports/report.md','/srv/a%23b%3Fc%25d/report.md','C:/Reports/report.md','/report.md','C:/report.md']){
   const reference=filesystemReference(path,'env')!,doc=new CodebaseDocument(reference.scope,reference.path,io,()=>{});
   await doc.read();await doc.save('edited '+path);assert.equal(remote,'edited '+path);
   assert.equal(calls.at(-1)!.payload.cwd,reference.scope.root);assert.equal(calls.at(-1)!.payload.relativePath,reference.path);
   const resource=await io.resource(reference.scope,'chart.png');assert.match(resource.url,/^https:\/\/t3.example\/api\/assets\//);assert.equal(calls.at(-1)!.payload.resource.cwd,reference.scope.root);
  }
  assert.equal(catalogs,0);
  const file=filesystemReference('/srv/reports/report.md','env')!.scope,before=calls.length;
  for(const root of ['relative','/srv/../etc','//host/share','/srv\n'])await assert.rejects(io.read({...file,root},'file.md'),/Invalid/);
  for(const path of ['../secret','/etc/passwd','a//b','a\\b'])await assert.rejects(io.read(file,path),/Invalid/);
  await assert.rejects(io.read({...file,projectId:'project'},'file.md'),/Invalid/);
  await assert.rejects(io.deleteProject!(file),/project root/);assert.equal(calls.length,before);
 }finally{io.dispose!();}
});

test('machine file access propagates connection permission errors before any file RPC',async()=>{
 let calls=0;const io=codebaseTransport(async()=>{throw Error('Filesystem access denied');},{connect:async()=>{calls++;throw Error('Must not connect');}});
 try{const reference=filesystemReference('/srv/reports/report.md','env')!;await assert.rejects(io.read(reference.scope,reference.path),/Filesystem access denied/);assert.equal(calls,0);}finally{io.dispose!();}
});
function fixture(){let connects=0,catalogs=0,accesses=0,closes=0,remote='original',root='/outside',time=0;const calls:string[]=[];let closed=false;const io=codebaseTransport(async()=>{accesses++;return {origin:'http://localhost',api:async path=>{assert.equal(path,'/api/orchestration/shell');catalogs++;return {projects:[{id:'project',workspaceRoot:root}],threads:[]};},close:()=>{closes++;}};},{now:()=>time,connect:async()=>{connects++;closed=false;return {get closed(){return closed;},close(){closed=true;},call:async(tag,payload:any)=>{calls.push(tag);if(tag==='projects.readFile')return {contents:remote,byteLength:remote.length,truncated:false};if(tag==='projects.writeFile'){remote=String(expectRecord(payload).contents);return {};}return {entries:[],truncated:false};}};}});return {io,calls,get connects(){return connects;},get catalogs(){return catalogs;},get accesses(){return accesses;},get closes(){return closes;},setRoot(value:string){root=value;},closeSocket(){closed=true;},advance(ms:number){time+=ms;}};}
test('100 concurrent folders share one credential, catalog fetch, and socket; closed sockets reconnect',async()=>{const f=fixture();await Promise.all(Array.from({length:100},(_,i)=>f.io.list(scope,`folder${i}`)));assert.equal(f.connects,1);assert.equal(f.catalogs,1);assert.equal(f.accesses,1);assert.equal(f.calls.length,100);f.closeSocket();await f.io.list(scope,'');assert.equal(f.connects,2);assert.equal(f.catalogs,1);f.io.dispose!();await Promise.resolve();assert.equal(f.closes,1);await assert.rejects(f.io.list(scope,''),/stopped/);});
test('warm reads reuse memory but every save checks fresh bytes and verifies current project root',async()=>{const f=fixture(),doc=new CodebaseDocument(scope,'file.md',f.io,()=>{});await Promise.all([doc.read(),doc.read()]);await doc.read();assert.equal(f.calls.filter(t=>t==='projects.readFile').length,1);await doc.save('edited');assert.deepEqual(f.calls.slice(1),['projects.readFile','projects.writeFile','projects.readFile']);assert.equal(f.catalogs,2);f.setRoot('/moved');await assert.rejects(doc.save('new edit'),/workspace changed/);assert.equal(f.calls.filter(t=>t==='projects.writeFile').length,1);f.io.dispose!();});
test('a slow connection remains pending and disposal closes its late socket',async()=>{
 let resolve!:(value:any)=>void,closes=0;
 const io=codebaseTransport(async()=>({origin:'http://localhost',api:async()=>({projects:[{id:'project',workspaceRoot:'/outside'}]})}),{connect:()=>new Promise(r=>{resolve=r;})});
 const pending=io.list(scope,'');for(let i=0;i<30;i++)await Promise.resolve();
 const rejected=assert.rejects(pending,/stopped/);io.dispose!();resolve({closed:false,call:async()=>({}),close:()=>{closes++;}});await rejected;assert.equal(closes,1);
});
test('project rename and delete send one exact command and reconcile a lost reply from a fresh catalog',async()=>{
 let title='Project',deleted=false,lost=false,root='/outside';const commands:any[]=[];
 const io=codebaseTransport(async()=>({origin:'http://localhost',api:async(path,payload)=>{
  if(path==='/api/orchestration/shell')return {projects:deleted?[]:[{id:'project',title,workspaceRoot:root}],threads:[]};
  assert.equal(path,'/api/orchestration/dispatch');commands.push(payload);
  if(expectRecord(payload).type==='project.meta.update')title=String(expectRecord(payload).title);else deleted=true;
  if(lost)throw Error('Lost reply');return {sequence:1};
 }}));
 await io.renameProject!(scope,' New name ');assert.equal(title,'New name');assert.equal(commands.length,1);assert.equal(commands[0].projectId,'project');assert.equal(commands[0].type,'project.meta.update');assert.match(commands[0].commandId,/^[0-9a-f-]{36}$/);assert.equal('workspaceRoot' in commands[0],false);
 root='/moved';await assert.rejects(io.renameProject!(scope,'Wrong root'),/workspace changed/);assert.equal(commands.length,1);root='/outside';lost=true;
 await io.deleteProject!(scope);assert.equal(commands.length,2);assert.equal(commands[1].type,'project.delete');assert.equal(commands[1].force,true);assert.equal(deleted,true);await io.deleteProject!(scope);assert.equal(commands.length,2,'An already deleted project only needs its local link removed');
 await assert.rejects(io.deleteProject!({...scope,threadId:'thread'}),/project root/);assert.equal(commands.length,2);io.dispose!();
});

test('catalog access needs no folder link, preserves the thread cwd, and rejects forged or moved roots before file RPC',async()=>{
 let root='/scratch/thread-a';const calls:Array<{tag:string;payload:any}>=[];
 const io=codebaseTransport(async environmentId=>{assert.equal(environmentId,'env');return {origin:'https://t3.example',api:async()=>({projects:[{id:'scratch',title:'No project',workspaceRoot:'/scratch'}],threads:[{id:'thread',projectId:'scratch',worktreePath:root}]})};},{connect:async()=>({closed:false,close(){},call:async(tag,payload)=>{calls.push({tag,payload});return {relativeUrl:'/api/assets/preview?key=signed',expiresAt:Date.now()+300000};}})});
 try{
  const scopes=await io.catalog!('env'),thread=scopes.find(value=>value.threadId==='thread')!;
  assert.equal(thread.root,'/scratch/thread-a');assert.equal(scopes.length,2);
  const resource=await io.resource(thread,'evidence/chart.png');assert.match(resource.url,/^https:\/\/t3\.example\/api\/assets\//);
  assert.equal(calls[0].payload.resource.cwd,'/scratch/thread-a');assert.equal(calls[0].payload.resource.path,'evidence/chart.png');
  await assert.rejects(io.resource({...thread,root:'/etc'},'passwd'),/workspace changed/);assert.equal(calls.length,1);
  root='/scratch/thread-b';await assert.rejects(io.write(thread,'report.md','stale edit'),/workspace changed/);assert.equal(calls.length,1,'Fresh save verification must reject a moved thread before sending bytes');
 }finally{io.dispose!();}
});
