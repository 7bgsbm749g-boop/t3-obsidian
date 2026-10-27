import {test} from 'node:test';
import assert from 'node:assert/strict';
import {codebaseTransport} from '../codebase-transport';
import {CodebaseDocument} from '../codebase-core';
const scope={environmentId:'env',projectId:'project',root:'/outside',title:'Project'};
function fixture(){let connects=0,catalogs=0,accesses=0,closes=0,remote='original',root='/outside',time=0;const calls:string[]=[];let closed=false;const io=codebaseTransport(async()=>{accesses++;return {origin:'http://localhost',api:async path=>{assert.equal(path,'/api/orchestration/shell');catalogs++;return {projects:[{id:'project',workspaceRoot:root}],threads:[]};},close:()=>{closes++;}};},{now:()=>time,connect:async()=>{connects++;closed=false;return {get closed(){return closed;},close(){closed=true;},call:async(tag,payload:any)=>{calls.push(tag);if(tag==='projects.readFile')return {contents:remote,byteLength:remote.length,truncated:false};if(tag==='projects.writeFile'){remote=payload.contents;return {};}return {entries:[],truncated:false};}};}});return {io,calls,get connects(){return connects;},get catalogs(){return catalogs;},get accesses(){return accesses;},get closes(){return closes;},setRoot(value:string){root=value;},closeSocket(){closed=true;},advance(ms:number){time+=ms;}};}
test('100 concurrent folders share one credential, catalog fetch, and socket; closed sockets reconnect',async()=>{const f=fixture();await Promise.all(Array.from({length:100},(_,i)=>f.io.list(scope,`folder${i}`)));assert.equal(f.connects,1);assert.equal(f.catalogs,1);assert.equal(f.accesses,1);assert.equal(f.calls.length,100);f.closeSocket();await f.io.list(scope,'');assert.equal(f.connects,2);assert.equal(f.catalogs,1);f.io.dispose!();await Promise.resolve();assert.equal(f.closes,1);await assert.rejects(f.io.list(scope,''),/stopped/);});
test('warm reads reuse memory but every save checks fresh bytes and verifies current project root',async()=>{const f=fixture(),doc=new CodebaseDocument(scope,'file.md',f.io,()=>{});await Promise.all([doc.read(),doc.read()]);await doc.read();assert.equal(f.calls.filter(t=>t==='projects.readFile').length,1);await doc.save('edited');assert.deepEqual(f.calls.slice(1),['projects.readFile','projects.writeFile','projects.readFile']);assert.equal(f.catalogs,2);f.setRoot('/moved');await assert.rejects(doc.save('new edit'),/workspace changed/);assert.equal(f.calls.filter(t=>t==='projects.writeFile').length,1);f.io.dispose!();});
test('unresponsive access has a bounded failure; a late socket is closed',async()=>{const io=codebaseTransport(()=>new Promise(()=>{}),{timeout:15});await assert.rejects(io.list(scope,''),/did not respond/);io.dispose!();let closes=0;const late=codebaseTransport(async()=>({origin:'http://localhost',api:async()=>({projects:[{id:'project',workspaceRoot:'/outside'}]})}),{timeout:15,connect:async()=>{await new Promise(r=>setTimeout(r,40));return {closed:false,call:async()=>({}),close:()=>{closes++;}};}});await assert.rejects(late.list(scope,''),/did not respond/);await new Promise(r=>setTimeout(r,50));assert.equal(closes,1);late.dispose!();});
test('project rename and delete send one exact command and reconcile a lost reply from a fresh catalog',async()=>{
 let title='Project',deleted=false,lost=false,root='/outside';const commands:any[]=[];
 const io=codebaseTransport(async()=>({origin:'http://localhost',api:async(path,payload)=>{
  if(path==='/api/orchestration/shell')return {projects:deleted?[]:[{id:'project',title,workspaceRoot:root}],threads:[]};
  assert.equal(path,'/api/orchestration/dispatch');commands.push(payload);
  if(payload.type==='project.meta.update')title=payload.title;else deleted=true;
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
