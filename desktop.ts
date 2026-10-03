// Loaded only on desktop. T3's official CLI issues short-lived credentials;
// all project/thread traffic goes directly to its authenticated loopback API.
import {spawn} from 'node:child_process';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {promises as fs, existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as http from 'node:http';
import lockfile from 'proper-lockfile';
import type {Connection} from './bridge';
import type {ThreadAccess} from './thread-stream';
import {existingThreadTurn} from './thread-target';
import {readNewThreadDefaults,type NewThreadDefaults} from './model-defaults';

export function desktopDefaults():Connection {return {executable:'',host:'local',native:true,baseDir:join(homedir(),'.t3')};}
export function cli(command:string[],args:string[]):Promise<string> {
 return new Promise((resolve,reject)=>{
  const child=spawn(command[0],[...command.slice(1),...args],{shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let output='';let size=0;let settled=false;
  const finish=(error?:Error)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(output);};
  const timer=setTimeout(()=>{child.kill();finish(new Error('T3 CLI timed out.'));},45_000);
  child.on('error',()=>finish(new Error('Cannot run the official T3 CLI. Set its executable path in plugin settings.')));
  child.stderr.on('data',()=>{});
  child.stdout.setEncoding('utf8');child.stdout.on('data',(s:string)=>{size+=Buffer.byteLength(s);if(size>4_000_000){child.kill();finish(new Error('T3 response too large.'));}else output+=s;});
  child.on('close',code=>finish(code===0?undefined:new Error('T3 CLI failed. Check that the official CLI matches your T3 installation.')));
 });
}
export function findCli(connection:Connection):string[] {
 if(connection.native && connection.executable.trim())return [connection.executable];
 const paths=process.platform==='win32'?[join(homedir(),'.t3','bin','t3.exe'),join(homedir(),'AppData','Local','Programs','t3-code-desktop','resources','t3.exe')]:[join(homedir(),'.local','bin','t3'),'/usr/local/bin/t3','/opt/homebrew/bin/t3'];
 const found=paths.find(p=>existsSync(p));return [found??'t3'];
}
export async function addDesktopProject(connection:Connection,workspaceRoot:string,title:string):Promise<string>{
 if(connection.host!=='local')throw Error('A folder can only become a project on the computer that stores it.');
 if(!workspaceRoot.trim()||!title.trim())throw Error('The folder path or project title is empty.');
 const output=await cli(findCli(connection),['project','add','--base-dir',connection.baseDir||join(homedir(),'.t3'),'--title',title,workspaceRoot]);
 const match=/Added project ([0-9a-f-]{36})\b/i.exec(output);if(!match)throw Error('T3 did not confirm the new project.');return match[1];
}
export async function browseDesktopFolder(path:string){
 const root=await fs.realpath(path==='~'?homedir():path);
 const entries=(await fs.readdir(root,{withFileTypes:true})).filter(entry=>entry.isDirectory()).sort((a,b)=>a.name.localeCompare(b.name));
 return {parentPath:root,entries:entries.map(entry=>({name:entry.name,fullPath:join(root,entry.name)}))};
}
export function uuid5(id:string,name:string):string {
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))throw new Error('Invalid request ID.');
 const b=createHash('sha1').update(Buffer.from(id.replace(/-/g,''),'hex')).update(name).digest().subarray(0,16);b[6]=(b[6]&15)|80;b[8]=(b[8]&63)|128;
 const h=b.toString('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
// Compatible with earlier persisted Python request fingerprints, including Unicode.
export function canonical(value:any):string {
 if(Array.isArray(value))return '['+value.map(canonical).join(', ')+']';
 if(value && typeof value==='object')return '{'+Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>canonical(k)+': '+canonical(value[k])).join(', ')+'}';
 return JSON.stringify(value).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
}
export function parseOperation(args:string[],input:string):any {
 if(args.length===1 && ['projects','capabilities'].includes(args[0]))return {action:args[0]};
 if(args.length===2 && args[0]==='read'){uuid5(args[1],'validate');return {action:'read',threadId:args[1]};}
 if(args.length===3 && args[0]==='threads' && args[1]==='--project')return {action:'threads',project:args[2]};
 if(args.length!==9 || args[0]!=='start' || args[1]!=='--project' || args[3]!=='--title' || args[5]!=='--request-id' || !['--prompt-file','--payload-file'].includes(args[7]) || args[8]!=='-')throw new Error('Unsupported T3 operation.');
 const req:any={action:'start',project:args[2],title:args[4],requestId:args[6]};uuid5(req.requestId,'validate');
 if(args[7]==='--payload-file'){const p=JSON.parse(input);req.prompt=p.prompt;req.attachments=p.attachments??[];if(p.context)req.context=p.context;if(p.threadId){uuid5(p.threadId,'validate');req.threadId=p.threadId;}}else req.prompt=input;
 if(typeof req.prompt!=='string' || !req.prompt.trim() || req.prompt.length>120000 || !req.title.trim() || req.title.length>160)throw new Error('Invalid prompt or title.');
 return req;
}
export function requestJson(origin:string,token:string,path:string,payload?:any):Promise<any> {
 const url=new URL(origin);if(url.protocol!=='http:' || !['localhost','127.0.0.1','[::1]'].includes(url.hostname) || url.username || url.password || url.pathname!=='/' || url.search || url.hash)throw new Error('T3 runtime must use a loopback HTTP origin.');
 const apiPath=path.startsWith('/api/')||path==='/.well-known/t3/environment'?path:'/api/orchestration/'+path;
 if(apiPath.includes('..')||apiPath.includes('\\')||apiPath.includes('#'))throw new Error('Invalid T3 API path.');
 return new Promise((resolve,reject)=>{
  const data=payload===undefined?undefined:JSON.stringify(payload);
  const r=http.request(new URL(apiPath,origin),{method:data===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...(data?{'Content-Length':Buffer.byteLength(data)}:{})}},res=>{
   let out='';let bytes=0;res.setEncoding('utf8');res.on('data',(s:string)=>{bytes+=Buffer.byteLength(s);if(bytes>4_000_000)r.destroy(new Error('T3 response too large.'));else out+=s;});
   res.on('error',reject);res.on('end',()=>{if(res.statusCode!==200){reject(new Error(`T3 API returned HTTP ${res.statusCode}. Retry the saved request if sending.`));return;}try{resolve(JSON.parse(out));}catch{reject(new Error('Invalid T3 API response.'));}});
  });
  r.setTimeout(20_000,()=>r.destroy(new Error('T3 API timed out. Retry the saved request.')));r.on('error',reject);r.end(data);
 });
}
async function save(path:string,value:any){const temp=path+'.tmp';const f=await fs.open(temp,'w',0o600);try{await f.writeFile(JSON.stringify(value));await f.sync();}finally{await f.close();}await fs.rename(temp,path);}
const locks=new Map<string,Promise<any>>();
export async function start(api:(path:string,payload?:any)=>Promise<any>,req:any,stateDir:string,loadDefaults?:(project:any)=>Promise<NewThreadDefaults>){
 const id=req.requestId;const path=join(stateDir,'requests',id+'.json');
 if(locks.has(path))throw new Error('This request is in progress. Retry its original ID later.');
 const work=(async()=>{
  await fs.mkdir(join(stateDir,'requests'),{recursive:true,mode:0o700});
  let compromised:Error|undefined;
  const release=await lockfile.lock(path,{realpath:false,lockfilePath:path+'.desktop-lock',stale:120000,update:10000,onCompromised:e=>{compromised=e;}});
  try{
  const hash=createHash('sha256').update(canonical(req)).digest('hex');let ledger:any;
  try{ledger=JSON.parse(await fs.readFile(path,'utf8'));if(ledger.requestHash!==hash)throw new Error('Request ID already belongs to different parameters.');}catch(e:any){if(e.code!=='ENOENT')throw e;}
  if(!ledger){
   if(req.threadId){
    const thread=(await api('threads/'+encodeURIComponent(req.threadId)+'?turnLimit=1')).thread;
    const turn=existingThreadTurn(thread,{threadId:req.threadId,projectId:req.project},uuid5(id,'turn'),{messageId:uuid5(id,'message'),role:'user',text:req.prompt,attachments:req.attachments??[],...(req.context?{context:req.context}:{})});
    ledger={requestHash:hash,requestId:id,threadId:req.threadId,project:{id:req.project},phase:'created',create:null,turn};
    await save(path,ledger);
   }else{
   const shell=await api('shell');const project=shell.projects.find((p:any)=>p.id===req.project);if(!project)throw new Error('Project no longer exists. Scan projects again.');
   if(!loadDefaults)throw new Error('Cannot read T3 thread defaults. Retry from the updated plugin.');
   const defaults=await loadDefaults(project);
   const stamp=new Date().toISOString();const threadId=uuid5(id,'thread');
   const common={threadId,...defaults,interactionMode:'default',createdAt:stamp};
   ledger={requestHash:hash,requestId:id,threadId,project,phase:'prepared',create:{...common,type:'thread.create',commandId:uuid5(id,'create'),projectId:project.id,title:req.title,branch:null,worktreePath:null},turn:{...common,type:'thread.turn.start',commandId:uuid5(id,'turn'),message:{messageId:uuid5(id,'message'),role:'user',text:req.prompt,attachments:req.attachments??[],...(req.context?{context:req.context}:{})}}};await save(path,ledger);
   }
  }
  if(compromised)throw compromised;
  if(ledger.phase==='prepared'){await api('dispatch',ledger.create);ledger.phase='created';await save(path,ledger);}
  if(compromised)throw compromised;
  if(ledger.phase==='created'){await api('dispatch',ledger.turn);ledger.phase='started';await save(path,ledger);}
  if(ledger.phase==='started'&&(ledger.create||ledger.turn)){
   ledger={requestHash:ledger.requestHash,requestId:ledger.requestId,threadId:ledger.threadId,project:{id:ledger.project.id},phase:'started'};await save(path,ledger);
  }
  return {ok:true,requestId:id,threadId:ledger.threadId,projectId:ledger.project.id,phase:ledger.phase};
  }finally{await release();}
 })();locks.set(path,work);try{return await work;}finally{locks.delete(path);}
}
export async function runDesktop(connection:Connection,args:string[],input=''):Promise<any> {
 if(connection.host!=='local')throw new Error('Use Direct T3 pairing for remote destinations. Local T3 connects only to this computer.');
 const req=parseOperation(args,input);
 if(req.action==='capabilities')return {imagePayloadVersion:1,imageContextVersion:1,native:true};
 const base=connection.baseDir||join(homedir(),'.t3');const runtime=JSON.parse(await fs.readFile(join(base,'userdata','server-runtime.json'),'utf8'));
 const command=findCli(connection);let session:any;
 try{
  const issued=await cli(command,['auth','session','issue','--base-dir',base,'--ttl','5m','--label','send-to-t3-code','--json']);
  try{session=JSON.parse(issued);}catch{throw new Error('Invalid T3 session response; credential output withheld.');}
  if(!session.token || !session.sessionId)throw new Error('Unexpected T3 session response.');
  const api=(path:string,payload?:any)=>requestJson(runtime.origin,session.token,path,payload);
  if(req.action==='start')return await start(api,req,connection.stateDir||join(base,'send-to-t3-code','desktop'),project=>readNewThreadDefaults(api,runtime.origin,project));
  if(req.action==='read')return (await api('threads/'+encodeURIComponent(req.threadId)+'?turnLimit=10')).thread;
  const shell=await api('shell');if(req.action==='projects')return {projects:shell.projects};
  return {threads:shell.threads.filter((t:any)=>t.projectId===req.project)};
 } finally {if(session?.sessionId)try{await cli(command,['auth','session','revoke','--base-dir',base,session.sessionId]);}catch{/* Five-minute expiry bounds failed revocation. */}}
}

/** A short-lived local session dedicated to one live thread subscription. */
export async function desktopThreadAccess(connection:Connection):Promise<ThreadAccess>{
  if(connection.host!=='local')throw Error('Local T3 is available only on this computer.');
  const base=connection.baseDir||join(homedir(),'.t3');
  const runtime=JSON.parse(await fs.readFile(join(base,'userdata','server-runtime.json'),'utf8'));
  const command=findCli(connection);
  const issued=JSON.parse(await cli(command,['auth','session','issue','--base-dir',base,'--ttl','5m','--label','send-to-t3-code-inline','--json']));
  if(typeof issued.token!=='string'||typeof issued.sessionId!=='string')throw Error('T3 did not issue a local stream session.');
  let closed=false;
  return {origin:runtime.origin,api:(path,payload)=>requestJson(runtime.origin,issued.token,path,payload),async close(){if(closed)return;closed=true;try{await cli(command,['auth','session','revoke','--base-dir',base,issued.sessionId]);}catch{/* Session expires after five minutes. */}}};
}

export async function desktopEnvironment(connection:Connection):Promise<string>{
  const base=connection.baseDir||join(homedir(),'.t3');
  const runtime=JSON.parse(await fs.readFile(join(base,'userdata','server-runtime.json'),'utf8'));
  const descriptor=await requestJson(runtime.origin,'','/.well-known/t3/environment');
  if(typeof descriptor?.environmentId!=='string'||descriptor.orchestrationProtocolVersion!==1)throw Error('Local T3 environment is unavailable.');
  return descriptor.environmentId;
}
