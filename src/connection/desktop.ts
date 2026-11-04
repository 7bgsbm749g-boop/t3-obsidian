import {outgoingMessage,type StartRequest,type DesktopOperation,type CreateThreadCommand,type TurnStartCommand} from './send-contracts';
import {isRecord,parseJson} from '../shared/values';
import type {WireProject} from './wire-types';
import type {T3Api} from './t3-rpc';
import {readWireProjects,readThreadList,readMetadataSnapshot} from './wire-readers';
import {clearTimeout,setTimeout} from 'node:timers';
import {errorCode,toError} from '../shared/values';
import {T3_RESPONSE_MAX_BYTES,T3ResponseTooLargeError} from './t3-response-limits';
// Loaded only on desktop. T3's official CLI issues short-lived credentials;
// all project/thread traffic goes directly to its authenticated loopback API.
import {spawn} from 'node:child_process';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {promises as fs, existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as http from 'node:http';
import lockfile from 'proper-lockfile';
import type {Connection} from '../app/bridge';
import type {ThreadAccess} from '../conversations/thread-stream';
import {existingThreadTurn} from '../conversations/thread-target';
import {readNewThreadDefaults,type NewThreadDefaults} from '../conversations/model-defaults';
import {workspaceChildPath} from '../projects/workspace-picker';
import {T3HttpError} from '../conversations/thread-access-cache';
import {recordDesktopAuth} from './desktop-auth-audit';
import {t3Api,requestAborted,cancelledRequest,type T3RequestOptions} from './t3-api';
import type {DirectReadOptions} from './direct';
import {T3_PROTOCOL_HEADER,T3_PROTOCOL_VERSION} from './orchestration-v2';
import {ensureNoProject} from '../projects/no-project';
import {AUTO_THREAD_TITLE} from '../conversations/thread-title';

export function desktopDefaults():Connection {return {executable:'',host:'local',native:true,baseDir:join(homedir(),'.t3')};}
export function cli(command:string[],args:string[],signal?:AbortSignal):Promise<string> {
 return new Promise((resolve,reject)=>{
  try{requestAborted(signal);}catch(error){reject(toError(error));return;}
  const child=spawn(command[0],[...command.slice(1),...args],{shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let output='';let size=0;let settled=false;
  const cancel=()=>{child.kill();finish(toError(signal?.reason??cancelledRequest()));};
  const finish=(error?:Error)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);error?reject(error):resolve(output);};
  const timer=setTimeout(()=>{child.kill();finish(new Error('T3 CLI timed out.'));},45_000);
  signal?.addEventListener('abort',cancel,{once:true});
  child.on('error',()=>finish(new Error('Cannot run the official T3 CLI. Set its executable path in plugin settings.')));
  child.stderr.on('data',()=>{});
  child.stdout.setEncoding('utf8');child.stdout.on('data',(s:string)=>{size+=Buffer.byteLength(s);if(size>T3_RESPONSE_MAX_BYTES){child.kill();finish(new T3ResponseTooLargeError());}else output+=s;});
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
export async function createDesktopFolder(parentPath:string,name:string):Promise<string>{
 const parent=await fs.realpath(parentPath);
 const path=workspaceChildPath(parent,name);
 try{await fs.mkdir(path);}catch(error:unknown){
  if(errorCode(error)==='EEXIST')throw Error('A file or folder with this name already exists.');
  if(errorCode(error)==='EACCES'||errorCode(error)==='EPERM')throw Error('You do not have permission to create a folder here.');
  throw Error('Cannot create this folder. Check the parent folder and try again.');
 }
 return path;
}
export function uuid5(id:string,name:string):string {
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))throw new Error('Invalid request ID.');
 const b=createHash('sha1').update(Buffer.from(id.replace(/-/g,''),'hex')).update(name).digest().subarray(0,16);b[6]=(b[6]&15)|80;b[8]=(b[8]&63)|128;
 const h=b.toString('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
// Compatible with earlier persisted Python request fingerprints, including Unicode.
export function canonical(value:unknown):string {
 if(Array.isArray(value))return '['+value.map(canonical).join(', ')+']';
 if(value && typeof value==='object')return '{'+Object.keys(value).sort().filter(k=>Reflect.get(value,k)!==undefined).map(k=>canonical(k)+': '+canonical(Reflect.get(value,k) as unknown)).join(', ')+'}';
 return JSON.stringify(value).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
}
export function parseOperation(args:['start',...string[]],input:string):StartRequest&{action:'start'};
export function parseOperation(args:string[],input:string):DesktopOperation;
export function parseOperation(args:string[],input:string):DesktopOperation {
 if(args.length===1 && (args[0]==='projects'||args[0]==='capabilities'||args[0]==='no-project'))return {action:args[0]};
 if(args.length===2 && args[0]==='read'){uuid5(args[1],'validate');return {action:'read',threadId:args[1]};}
 if(args.length===3 && args[0]==='threads' && args[1]==='--project')return {action:'threads',project:args[2]};
 if(args.length!==9 || args[0]!=='start' || args[1]!=='--project' || args[3]!=='--title' || args[5]!=='--request-id' || !['--prompt-file','--payload-file'].includes(args[7]) || args[8]!=='-')throw new Error('Unsupported T3 operation.');
 const req:StartRequest&{action:'start'}={action:'start',project:args[2],title:args[4],requestId:args[6],prompt:''};uuid5(req.requestId,'validate');
 if(args[7]==='--payload-file'){const p=parseJson(input);if(!isRecord(p)||typeof p.prompt!=='string')throw Error('Invalid prompt or title.');const message=outgoingMessage({...p,messageId:req.requestId,text:p.prompt});req.prompt=message.text;req.attachments=message.attachments;if(message.context)req.context=message.context;if(p.threadId){if(typeof p.threadId!=='string')throw Error('Invalid thread ID.');uuid5(p.threadId,'validate');req.threadId=p.threadId;}}else req.prompt=input;
 if(typeof req.prompt!=='string' || !req.prompt.trim() || req.prompt.length>120000 || !req.title.trim() || req.title.length>160)throw new Error('Invalid prompt or title.');
 return req;
}
function rawRequestJson(origin:string,token:string,path:string,payload?:unknown,options:T3RequestOptions={}):Promise<unknown> {
 requestAborted(options.signal);
 const url=new URL(origin);if(url.protocol!=='http:' || !['localhost','127.0.0.1','[::1]'].includes(url.hostname) || url.username || url.password || url.pathname!=='/' || url.search || url.hash)throw new Error('T3 runtime must use a loopback HTTP origin.');
 const apiPath=path.startsWith('/api/')||path==='/.well-known/t3/environment'?path:'/api/orchestration/'+path;
 if(apiPath.includes('..')||apiPath.includes('\\')||apiPath.includes('#'))throw new Error('Invalid T3 API path.');
 return new Promise((resolve,reject)=>{
  const data=payload===undefined?undefined:JSON.stringify(payload);
  const r=http.request(new URL(apiPath,origin),{method:data===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',[T3_PROTOCOL_HEADER]:String(T3_PROTOCOL_VERSION),...(data?{'Content-Length':Buffer.byteLength(data)}:{})}},res=>{
   let out='';let bytes=0;res.setEncoding('utf8');res.on('data',(s:string)=>{bytes+=Buffer.byteLength(s);if(bytes>T3_RESPONSE_MAX_BYTES)r.destroy(new T3ResponseTooLargeError());else out+=s;});
   res.on('error',reject);res.on('end',()=>{if(res.statusCode!==200){reject(new T3HttpError(res.statusCode??0,`T3 API returned HTTP ${res.statusCode}.`));return;}try{resolve(JSON.parse(out));}catch{reject(new Error('Invalid T3 API response.'));}});
  });
  const cancel=()=>r.destroy(toError(options.signal?.reason??cancelledRequest()));
  options.signal?.addEventListener('abort',cancel,{once:true});r.on('close',()=>options.signal?.removeEventListener('abort',cancel));
  r.setTimeout(20_000,()=>r.destroy(new Error('T3 API timed out. Retry the saved request.')));r.on('error',reject);r.end(data);
 });
}
function desktopApi(origin:string,token:string){
  const url=new URL(origin);if(url.protocol!=='http:' || !['localhost','127.0.0.1','[::1]'].includes(url.hostname) || url.username || url.password || url.pathname!=='/' || url.search || url.hash)throw new Error('T3 runtime must use a loopback HTTP origin.');
  return t3Api((target,body,options)=>rawRequestJson(origin,token,target,body,options),origin);
}
export function requestJson(origin:string,token:string,path:string,payload?:unknown):Promise<unknown> {
  const apiPath=path.startsWith('/api/')||path==='/.well-known/t3/environment'?path:'/api/orchestration/'+path;
  return desktopApi(origin,token)(apiPath,payload);
}
async function save(path:string,value:unknown){const temp=path+'.tmp';const f=await fs.open(temp,'w',0o600);try{await f.writeFile(JSON.stringify(value));await f.sync();}finally{await f.close();}await fs.rename(temp,path);}
interface DesktopLedger {
  protocolVersion?:2;launch?:boolean;requestHash:string;requestId:string;threadId:string;
  project:{id:string};phase:'prepared'|'created'|'started';create?:CreateThreadCommand|null;turn?:TurnStartCommand;
}
interface LocalSession {token:string;sessionId:string;expiresAt?:string}
function localSession(value:unknown):LocalSession{
  if(!isRecord(value)||typeof value.token!=='string'||!value.token||typeof value.sessionId!=='string'||!value.sessionId||value.expiresAt!==undefined&&typeof value.expiresAt!=='string')throw Error('Invalid T3 session response; credential output withheld.');
  return value as unknown as LocalSession;
}
function localRuntime(value:unknown):{origin:string}{
  if(!isRecord(value)||typeof value.origin!=='string')throw Error('Invalid T3 runtime address.');return {origin:value.origin};
}
function storedLedger(value:unknown):DesktopLedger{
  if(!isRecord(value)||typeof value.requestHash!=='string'||typeof value.requestId!=='string'||typeof value.threadId!=='string'||!isRecord(value.project)||typeof value.project.id!=='string'||typeof value.phase!=='string'||!['prepared','created','started'].includes(value.phase))throw Error('Invalid saved T3 request ledger.');
  if(value.phase!=='started'){
    if(!isRecord(value.turn)||value.turn.type!=='thread.turn.start'||value.turn.threadId!==value.threadId||typeof value.turn.commandId!=='string'||typeof value.turn.createdAt!=='string')throw Error('Invalid saved T3 message identity.');
    outgoingMessage(value.turn.message);
    if(value.phase==='prepared'&&(!isRecord(value.create)||value.create.type!=='thread.create'||value.create.threadId!==value.threadId||value.create.projectId!==value.project.id))throw Error('Invalid saved T3 creation identity.');
  }
  return value as unknown as DesktopLedger;
}
const locks=new Map<string,Promise<unknown>>();
export async function start(api:T3Api,req:StartRequest,stateDir:string,loadDefaults?:(project:WireProject)=>Promise<NewThreadDefaults>){
 const id=req.requestId;const path=join(stateDir,'requests',id+'.json');
 if(locks.has(path))throw new Error('This request is in progress. Retry its original ID later.');
 const work=(async()=>{
  await fs.mkdir(join(stateDir,'requests'),{recursive:true,mode:0o700});
  let compromised:Error|undefined;
  const release=await lockfile.lock(path,{realpath:false,lockfilePath:path+'.desktop-lock',stale:120000,update:10000,onCompromised:e=>{compromised=e;}});
  try{
  const hash=createHash('sha256').update(canonical(req)).digest('hex');let ledger:DesktopLedger|undefined;
  try{ledger=storedLedger(parseJson(await fs.readFile(path,'utf8')));if(ledger.requestHash!==hash)throw new Error('Request ID already belongs to different parameters.');}catch(e:unknown){if(errorCode(e)!=='ENOENT')throw toError(e);}
  if(!ledger){
   if(req.threadId){
    const thread=readMetadataSnapshot(await api('threads/'+encodeURIComponent(req.threadId)+'?controlOnly=true')).thread;
    const turn=existingThreadTurn(thread,{threadId:req.threadId,projectId:req.project},uuid5(id,'turn'),{messageId:uuid5(id,'message'),role:'user',text:req.prompt,attachments:req.attachments??[],...(req.context?{context:req.context}:{})});
    ledger={protocolVersion:2,requestHash:hash,requestId:id,threadId:req.threadId,project:{id:req.project},phase:'created',create:null,turn};
    await save(path,ledger);
   }else{
   const projects=readWireProjects(await api('shell'));const project=projects.find(p=>p.id===req.project);if(!project)throw new Error('Project no longer exists. Scan projects again.');
   if(!loadDefaults)throw new Error('Cannot read T3 thread defaults. Retry from the updated plugin.');
   const defaults=await loadDefaults(project);
   const stamp=new Date().toISOString();const threadId=uuid5(id,'thread');
   const common={threadId,...defaults,interactionMode:'default',createdAt:stamp};
   ledger={protocolVersion:2,...(req.title===AUTO_THREAD_TITLE?{launch:true}:{}),requestHash:hash,requestId:id,threadId,project,phase:'prepared',create:{...common,type:'thread.create',commandId:uuid5(id,'create'),projectId:project.id,title:req.title,branch:null,worktreePath:null},turn:{...common,type:'thread.turn.start',commandId:uuid5(id,'turn'),message:{messageId:uuid5(id,'message'),role:'user',text:req.prompt,attachments:req.attachments??[],...(req.context?{context:req.context}:{})}}};await save(path,ledger);
   }
  }
  if(compromised)throw toError(compromised);
  // Persist the launch choice before its first attempt. Existing ledgers keep
  // their original create/dispatch path and immutable retry identities.
  if(ledger.phase==='prepared'&&ledger.launch){
   if(!ledger.create||!ledger.turn)throw Error('The saved T3 launch commands are missing.');
   const {commandId,threadId,projectId,title,modelSelection,runtimeMode,interactionMode}=ledger.create;
   const {messageId,text,attachments,context}=ledger.turn.message;
   await api('/api/orchestration/launch',{commandId,threadId,projectId,title,generateTitle:true,modelSelection,runtimeMode,interactionMode,creationSource:'web',workspaceStrategy:{type:'root'},initialMessage:{messageId,text,attachments,...(context?{context}:{})}});
   ledger.phase='started';await save(path,ledger);
  }
  if(compromised)throw toError(compromised);
  if(ledger.phase==='prepared'){if(!ledger.create)throw Error('The saved T3 creation command is missing.');await api('dispatch',{...ledger.create,...(ledger.protocolVersion===2?{}:{__legacyV1:true})});ledger.phase='created';await save(path,ledger);}
  if(compromised)throw toError(compromised);
  if(ledger.phase==='created'){if(!ledger.turn)throw Error('The saved T3 message command is missing.');await api('dispatch',{...ledger.turn,...(ledger.protocolVersion===2?{}:{__legacyV1:true})});ledger.phase='started';await save(path,ledger);}
  if(ledger.phase==='started'&&(ledger.create||ledger.turn)){
   ledger={requestHash:ledger.requestHash,requestId:ledger.requestId,threadId:ledger.threadId,project:{id:ledger.project.id},phase:'started'};await save(path,ledger);
  }
  return {ok:true,requestId:id,threadId:ledger.threadId,projectId:ledger.project.id,phase:ledger.phase};
  }finally{await release();}
 })();locks.set(path,work);try{return await work;}finally{locks.delete(path);}
}
export async function runDesktop(connection:Connection,args:string[],input='',options:DirectReadOptions={}):Promise<unknown> {
 requestAborted(options.signal);
 if(connection.host!=='local')throw new Error('Use Direct T3 pairing for remote destinations. Local T3 connects only to this computer.');
 const req=parseOperation(args,input);
 if(req.action==='capabilities')return {imagePayloadVersion:1,imageContextVersion:1,native:true};
 const base=connection.baseDir||join(homedir(),'.t3');const runtime=localRuntime(parseJson(await fs.readFile(join(base,'userdata','server-runtime.json'),'utf8')));
 const command=findCli(connection);let session:LocalSession|undefined;
 try{
  const issued=await cli(command,['auth','session','issue','--base-dir',base,'--ttl','5m','--label','send-to-t3-code','--json'],options.signal);
  try{session=localSession(parseJson(issued));}catch{throw new Error('Invalid T3 session response; credential output withheld.');}
  if(!session.token || !session.sessionId)throw new Error('Unexpected T3 session response.');
  const transport=desktopApi(runtime.origin,session.token);
  const api=(path:string,payload?:unknown)=>transport(path.startsWith('/api/')?path:'/api/orchestration/'+path,payload,options);
  if(req.action==='no-project')return await ensureNoProject(api);
  if(req.action==='start')return await start(api,req,connection.stateDir||join(base,'send-to-t3-code','desktop'),project=>readNewThreadDefaults(api,runtime.origin,project));
  if(req.action==='read')return readMetadataSnapshot(await api('threads/'+encodeURIComponent(req.threadId)+(options.control?'?controlOnly=true':'?turnLimit=10'))).thread;
  if(req.action==='projects')return {projects:readWireProjects(await api('shell'))};
  if(req.action!=='threads')throw Error('Unsupported T3 operation.');return {threads:readThreadList(await api('shell')).filter(t=>t.projectId===req.project)};
 } finally {if(session?.sessionId){const sessionId=session.sessionId;
  // A closed chooser must not wait for CLI cleanup. Revocation still runs,
  // with its own deadline; the issued credential expires after five minutes.
  const cleanup=async()=>{const controller=new AbortController(),timer=setTimeout(()=>controller.abort(Error('T3 session cleanup timed out.')),5000);try{await cli(command,['auth','session','revoke','--base-dir',base,sessionId],options.signal?.aborted?controller.signal:undefined);}catch{/* Five-minute expiry bounds failed revocation. */}finally{clearTimeout(timer);}};
  if(options.signal?.aborted)void cleanup();else await cleanup();
 }}
}

/** Borrow the plugin-owned local credential, preserving the same durable
 * request ledger and native launch path without per-operation CLI startup. */
export async function runDesktopWithAccess(connection:Connection,args:string[],input:string,access:ThreadAccess,options:DirectReadOptions={}):Promise<unknown>{
  requestAborted(options.signal);
  if(connection.host!=='local')throw Error('Local T3 connects only to this computer.');
  const req=parseOperation(args,input),base=connection.baseDir||join(homedir(),'.t3');
  const api=(path:string,payload?:unknown)=>{requestAborted(options.signal);return access.api(path.startsWith('/api/')?path:'/api/orchestration/'+path,payload);};
  if(req.action==='capabilities')return {imagePayloadVersion:1,imageContextVersion:1,native:true};
  if(req.action==='no-project')return ensureNoProject(api);
  if(req.action==='start')return start(api,req,connection.stateDir||join(base,'send-to-t3-code','desktop'),project=>readNewThreadDefaults(api,access.origin,project));
  if(req.action==='read')return readMetadataSnapshot(await api('threads/'+encodeURIComponent(req.threadId)+(options.control?'?controlOnly=true':'?turnLimit=10'))).thread;
  if(req.action==='projects')return {projects:readWireProjects(await api('shell'))};if(req.action!=='threads')throw Error('Unsupported T3 operation.');return {threads:readThreadList(await api('shell')).filter(thread=>thread.projectId===req.project)};
}

/** A short-lived local session dedicated to one live thread subscription. */
export async function desktopThreadAccess(connection:Connection,component:'response-host'|'thread-reader'='thread-reader'):Promise<ThreadAccess>{
  if(connection.host!=='local')throw Error('Local T3 is available only on this computer.');
  const base=connection.baseDir||join(homedir(),'.t3');
  const runtime=localRuntime(parseJson(await fs.readFile(join(base,'userdata','server-runtime.json'),'utf8')));
  const command=findCli(connection);
  const issued=localSession(parseJson(await cli(command,['auth','session','issue','--base-dir',base,'--ttl','5m','--label','send-to-t3-code-inline','--json'])));
  if(typeof issued.token!=='string'||!issued.token||!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(issued.sessionId??''))throw Error('T3 did not issue a local stream session.');
  const issuedAt=Date.now(),expiry=Date.parse(issued.expiresAt??''),expiresAt=Number.isFinite(expiry)?expiry:undefined;
  const metadata={sessionId:issued.sessionId,component,issuedAt,expiresAt};
  const api=desktopApi(runtime.origin,issued.token);
  const audit=(event:import('./desktop-auth-audit').DesktopAuthRecord['event'],reason?:import('../conversations/thread-stream').ThreadAccessCloseReason,caller?:string[])=>recordDesktopAuth(base,{...metadata,event,reason,caller});
  void audit('issued');let closed=false,rejectionRecorded=false,recoveryRecorded=false;
  return {origin:runtime.origin,expiresAt,trace:(event,reason)=>{if(event==='recovered'){if(recoveryRecorded)return;recoveryRecorded=true;}void audit(event,reason);},async api(path,payload){
    try{return await api(path,payload);}catch(error){
      if(error instanceof T3HttpError&&error.status===401&&!rejectionRecorded){rejectionRecorded=true;void audit('rejected');}throw error;
    }
  },async close(reason='caller-closed'){
    if(closed)return;closed=true;
    const caller=(new Error('Local stream credential closure').stack??'').split('\n').slice(2,7).map(line=>line.trim());
    void audit('closing',reason,caller);
    try{await cli(command,['auth','session','revoke','--base-dir',base,issued.sessionId]);void audit('revoke-completed',reason);}
    catch{void audit('revoke-failed',reason);/* Session expires after five minutes. */}
  }};
}

export async function desktopEnvironment(connection:Connection):Promise<string>{
  const base=connection.baseDir||join(homedir(),'.t3');
  const runtime=localRuntime(parseJson(await fs.readFile(join(base,'userdata','server-runtime.json'),'utf8')));
  const descriptor=await requestJson(runtime.origin,'','/.well-known/t3/environment');
  if(!isRecord(descriptor)||typeof descriptor.environmentId!=='string'||descriptor.orchestrationProtocolVersion!==T3_PROTOCOL_VERSION)throw Error('Update local T3 to Orchestrator v2 before connecting.');
  return descriptor.environmentId;
}

/** Public loopback discovery only: no CLI, credential, or remote round trip.
 * Missing/stopped local T3 fails immediately; an unresponsive listener is bounded. */
export async function availableDesktopEnvironment(connection:Connection,timeoutMs=150):Promise<string|undefined>{
  try{
    const base=connection.baseDir||join(homedir(),'.t3'),runtime=localRuntime(parseJson(await fs.readFile(join(base,'userdata','server-runtime.json'),'utf8')));
    const origin=new URL(runtime.origin);
    if(origin.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(origin.hostname)||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)return;
    return await new Promise<string|undefined>(resolve=>{
      let done=false;const finish=(id?:string)=>{if(done)return;done=true;clearTimeout(timer);resolve(id);};
      const request=http.get(new URL('/.well-known/t3/environment',origin),response=>{
        if(response.statusCode!==200){response.resume();finish();return;}
        let body='';response.setEncoding('utf8');response.on('error',()=>finish());
        response.on('data',(text:string)=>{body+=text;if(body.length>65_536){request.destroy();finish();}});
        response.on('end',()=>{try{const descriptor=parseJson(body);finish(isRecord(descriptor)&&descriptor.orchestrationProtocolVersion===T3_PROTOCOL_VERSION&&typeof descriptor.environmentId==='string'&&descriptor.environmentId?descriptor.environmentId:undefined);}catch{finish();}});
      });
      const timer=setTimeout(()=>{request.destroy();finish();},timeoutMs);request.on('error',()=>finish());
    });
  }catch{return;}
}
