import {browserFetch} from './browser-fetch';
import type {CreateThreadCommand,TurnStartCommand} from './send-contracts';
import {isRecord,parseJson} from '../shared/values';
import {readWireProjects,readThreadList,readMetadataSnapshot} from './wire-readers';
import {StreamingJson,omitImportField} from './streaming-json';
import {Buffer} from 'buffer/';
import {sha1} from '@noble/hashes/legacy';
import {sha256} from '@noble/hashes/sha2';
import {proofKey,proof} from './dpop';
import type {Connection,Request} from '../app/bridge';
import type {InlineStartRequest} from '../conversations/inline-thread';
import {existingThreadTurn} from '../conversations/thread-target';
import {readNewThreadDefaults} from '../conversations/model-defaults';
import {T3HttpError} from '../conversations/thread-access-cache';
import {t3Api,abortableRead,requestAborted,type AbortableT3Api,type T3RequestOptions} from './t3-api';
import {T3_PROTOCOL_VERSION,T3_PROTOCOL_HEADER} from './orchestration-v2';
import type {ThreadAccess} from '../conversations/thread-stream';
import type {SocketFactory} from './t3-rpc';
import {PLUGIN_PERMISSIONS,hasPluginPermissions} from './environment-permissions';
import {ensureNoProject} from '../projects/no-project';
import {AUTO_THREAD_TITLE,promptThreadTitle} from '../conversations/thread-title';
import {ThreadCatalogCache} from './thread-catalog';
export interface RemoteEnvironmentDescriptor extends Record<string,unknown>{environmentId:string;label:string;orchestrationProtocolVersion:2}
export interface PairedConnection {id:string;name:string;url:string;environmentId:string;managed?:boolean;routeKind?:'local'|'https'|'ssh'}
export interface PairedSession {token:string;expiresAt:number;environmentId:string;url:string;dpopKeyId?:string;accountId?:string;permissions?:string[]}
export interface DirectPlan {protocolVersion?:2;launch?:boolean;generateTitle?:boolean;workspaceStrategy?:import('../conversations/model-defaults').WorkspaceStrategy;hash:string;environmentId:string;phase:'prepared'|'created'|'started';create:CreateThreadCommand|null;turn:TurnStartCommand;observedActiveTurnId?:string;delivery?:InlineStartRequest}
export type Fetcher=typeof fetch;
const threadCatalogs=new WeakMap<Fetcher,ThreadCatalogCache>();
export function endpoint(value:string):string {
 let u:URL;try{u=new URL(value.trim());}catch{throw Error('Enter a T3 HTTPS address or pairing link.');}
 const local=['localhost','127.0.0.1','[::1]'].includes(u.hostname);
 if((u.protocol!=='https:'&&!(u.protocol==='http:'&&local))||u.username||u.password||u.search||u.hash||!['','/'].includes(u.pathname))throw Error('Use a T3 HTTPS origin. HTTP is allowed only for localhost testing.');
 return u.origin;
}
export function pairingInput(address:string,code=''):{url:string;code:string}{
 let u:URL;try{u=new URL(address.trim());}catch{throw Error('Enter a T3 address or pairing link.');}
 let token=code.trim();
 if(u.hash){const p=new URLSearchParams(u.hash.slice(1));token=token||p.get('token')||'';if([...p.keys()].some(k=>k!=='token'))throw Error('Unrecognized pairing link fragment.');}
 if(u.hostname==='app.t3.codes'&&u.pathname==='/pair'&&u.searchParams.has('host')){
  const host=u.searchParams.get('host')!;return {url:endpoint(host),code:token};
 }
 if(!['/','/pair',''].includes(u.pathname)||u.search)throw Error('Use a T3 address or its /pair link. Companion addresses are not T3 pairing links.');
 u.hash='';u.pathname='/';return {url:endpoint(u.href),code:token};
}
export async function jsonHttp(url:string,options:RequestInit={},fetcher:Fetcher=browserFetch,compactImport=false):Promise<unknown>{
 const controller=new AbortController(),cancel=()=>controller.abort(options.signal?.reason);
 if(options.signal?.aborted)cancel();else options.signal?.addEventListener('abort',cancel,{once:true});
 try{
  requestAborted(controller.signal);
  const r=await abortableRead(fetcher(url,{...options,credentials:'omit',redirect:'error',cache:'no-store',signal:controller.signal}),controller.signal);
  if(!r.ok){if(r.status===401||r.status===403)throw new T3HttpError(r.status,'T3 access denied or expired. Create a fresh pairing link in T3 and pair this device again.');throw new T3HttpError(r.status,`T3 returned HTTP ${r.status}.`);}
  if(compactImport&&r.body?.getReader){
   const reader=r.body.getReader(),decoder=new TextDecoder('utf-8',{ignoreBOM:true}),parser=new StreamingJson(omitImportField);let complete=false;
   try{for(;;){const {done,value}=await abortableRead(reader.read(),controller.signal);if(done){complete=true;break;}parser.write(decoder.decode(value,{stream:true}));}parser.write(decoder.decode());return parser.finish();}
   finally{if(!complete)void reader.cancel().catch(()=>{});reader.releaseLock();}
  }
  let body='';
  if(r.body?.getReader){const reader=r.body.getReader();const parts:Uint8Array[]=[];try{for(;;){const {done,value}=await abortableRead(reader.read(),controller.signal);if(done)break;parts.push(value);}}finally{if(controller.signal.aborted)void reader.cancel().catch(()=>{});reader.releaseLock();}
   // The platform decoder avoids the browser Buffer polyfill's large temporary
   // code-point arrays. Preserve BOM handling.
   body=new TextDecoder('utf-8',{ignoreBOM:true}).decode(Buffer.concat(parts));}
  else body=await abortableRead(r.text(),controller.signal);
  try{return parseJson(body);}catch{throw Error('T3 returned an invalid response; response contents withheld.');}
 }catch(e){requestAborted(options.signal??undefined);if(e instanceof Error && (e.message.startsWith('T3 ')||e.message.startsWith('Use ')))throw e;throw Object.assign(Error('Cannot reach T3 directly. Check its public address, network access, and that T3 is running. Nothing is queued.'),{cause:e});}
 finally{options.signal?.removeEventListener('abort',cancel);}
}
export async function descriptor(url:string,fetcher?:Fetcher,signal?:AbortSignal){
 const d=await jsonHttp(endpoint(url)+'/.well-known/t3/environment',{signal},fetcher);
 if(!isRecord(d)||typeof d.environmentId!=='string'||typeof d?.label!=='string')throw Error('This address is not a compatible T3 environment. Use its T3 pairing link.');
 if(d.orchestrationProtocolVersion!==T3_PROTOCOL_VERSION)throw Error('Update this T3 machine to Orchestrator v2 before connecting.');
 return d as unknown as RemoteEnvironmentDescriptor;
}
export async function pair(address:string,code:string,fetcher?:Fetcher,expectedEnvironmentId?:string,permissions:readonly string[]=PLUGIN_PERMISSIONS):Promise<{descriptor:RemoteEnvironmentDescriptor;session:PairedSession}>{
 const input=pairingInput(address,code);if(!input.code)throw Error('Paste a fresh one-time pairing link or pairing code from T3 Settings → Connections.');
 const d=await descriptor(input.url,fetcher);if(expectedEnvironmentId&&d.environmentId!==expectedEnvironmentId)throw Error("The address no longer matches the selected T3 machine. Discover machines again; no pairing code was sent.");
 const body=new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:token-exchange',subject_token:input.code,subject_token_type:'urn:t3:params:oauth:token-type:environment-bootstrap',requested_token_type:'urn:ietf:params:oauth:token-type:access_token',scope:permissions.join(' '),client_label:'T3 Code (Obsidian)'}).toString();
 const token=await jsonHttp(input.url+'/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body},fetcher);
 if(!isRecord(token)||token.token_type!=='Bearer'||typeof token.access_token!=='string'||typeof token.expires_in!=='number'||!Number.isFinite(token.expires_in)||token.expires_in<=0)throw Error('T3 returned an unsupported pairing session.');
 const granted=typeof token.scope==='string'?token.scope.split(/\s+/):[];
 if(!hasPluginPermissions({permissions:granted}))throw Error('This pairing link does not permit thread and note access. Create a new T3 pairing link with filesystem read and write access, then reconnect this machine.');
 if(!permissions.every(scope=>granted.includes(scope)))throw Error('This pairing link does not permit MCP setup. Create a fresh T3 pairing link with agent configuration access, then reconnect this computer.');
 return {descriptor:d,session:{token:token.access_token,expiresAt:Date.now()+token.expires_in*1000,environmentId:d.environmentId,url:input.url,permissions:granted}};
}
export async function environmentApi(c:Connection,s:PairedSession|undefined,fetcher?:Fetcher,makeSocket?:SocketFactory,signal?:AbortSignal){
 const url=endpoint(c.url||'');
 if(!s||!s.token||s.url!==url||s.environmentId!==c.environmentId)throw Error('Pair this connection on this device first. Session credentials do not sync.');
 if(s.expiresAt<=Date.now()+5000)throw Error('T3 pairing session expired. Pair this device again using a fresh T3 link.');
 const d=await descriptor(url,fetcher,signal);if(d.environmentId!==c.environmentId)throw Error('The address now points to a different T3 environment. Nothing was sent; add it as a new connection.');
 const key=s.dpopKeyId?await proofKey(s.dpopKeyId,false):undefined;
 const api=t3Api(async(path:string,payload?:unknown,options?:T3RequestOptions)=>{requestAborted(options?.signal);if(!path.startsWith('/api/')||path.includes('..')||path.includes('\\'))throw Error('Invalid T3 API path.');const target=url+path;const method=payload===undefined?'GET':'POST';return jsonHttp(target,{method,signal:options?.signal,headers:{Authorization:(key?'DPoP ':'Bearer ')+s.token,'Content-Type':'application/json',[T3_PROTOCOL_HEADER]:String(T3_PROTOCOL_VERSION),...(key?{DPoP:await proof(key,method,target,s.token)}:{})},...(payload===undefined?{}:{body:JSON.stringify(payload)})},fetcher,options?.compactImport===true);},url,makeSocket);
 const transport=fetcher??browserFetch;let catalog=threadCatalogs.get(transport);if(!catalog){catalog=new ThreadCatalogCache();threadCatalogs.set(transport,catalog);}
 const identity=JSON.stringify([url,c.environmentId,s.token,s.expiresAt,s.dpopKeyId,s.accountId,s.permissions]),cache=catalog;
 const routed:import('./t3-rpc').T3Api=async(path,payload,options)=>{
  try{
   const work=api(path,payload,options).then(value=>{if(path==='/api/orchestration/shell'&&payload===undefined){try{cache.remember(identity,value,s.expiresAt);}catch{cache.delete(identity);}}return value;});
   if(path==='/api/orchestration/shell'&&payload===undefined)cache.observe(identity,work);
   return await work;
  }
  catch(error){if(error instanceof T3HttpError&&(error.status===401||error.status===403))cache.delete(identity);throw error;}
 };
 routed.cachedImportThreads=projectId=>cache.read(identity,projectId);
 routed.importCacheIdentity=cache.scope(identity);
 routed.prepareImportCatalog=signal=>{requestAborted(signal);return cache.prepare(identity,()=>routed('/api/orchestration/shell',undefined,{signal}));};
 routed.watchImportThreads=(projectId,changed)=>{
  let previous=JSON.stringify(cache.read(identity,projectId));
  return cache.watch(identity,()=>{const next=JSON.stringify(cache.read(identity,projectId));if(next!==previous){previous=next;changed();}});
 };
 return routed;
}
interface CachedReadApi {work:Promise<AbortableT3Api>;controller:AbortController;users:number;settled:boolean;expires:number}
const readApis=new WeakMap<Fetcher,Map<string,CachedReadApi>>();
/** Only connection/detail caches are reused. Thread control state is always fetched. */
async function readApi(c:Connection,s:PairedSession|undefined,fetcher:Fetcher,signal?:AbortSignal){
 requestAborted(signal);const url=endpoint(c.url||'');
 if(!s||!s.token||s.url!==url||s.environmentId!==c.environmentId)throw Error('Pair this connection on this device first. Session credentials do not sync.');
 if(s.expiresAt<=Date.now()+5000)throw Error('T3 pairing session expired. Pair this device again using a fresh T3 link.');
 let cache=readApis.get(fetcher);if(!cache){cache=new Map();readApis.set(fetcher,cache);}
 const identity=JSON.stringify([url,c.environmentId,c.connectionId,s.token,s.expiresAt,s.dpopKeyId,s.accountId,s.permissions]);
 let entry=cache.get(identity);
 if(entry&&entry.expires<=Date.now()){cache.delete(identity);entry=undefined;}
 if(!entry){
  const controller=new AbortController();
  const selected:CachedReadApi={controller,users:0,settled:false,expires:Math.min(Date.now()+30_000,s.expiresAt-5000),work:environmentApi(c,{...s},fetcher,undefined,controller.signal).then(api=>{selected.settled=true;return api;},error=>{selected.settled=true;if(cache.get(identity)===selected)cache.delete(identity);throw error;})};entry=selected;cache.set(identity,entry);
  while(cache.size>16)cache.delete(cache.keys().next().value!);
 }
 entry.users++;
 try{const api=await abortableRead(entry.work,signal);requestAborted(signal);return {api,invalidate:()=>{if(cache.get(identity)===entry)cache.delete(identity);}};}
 finally{if(--entry.users===0&&!entry.settled){entry.controller.abort();if(cache.get(identity)===entry)cache.delete(identity);}}
}
export interface DirectReadOptions extends T3RequestOptions {control?:boolean;access?:ThreadAccess}
export function readDirect(c:Connection,args:['read',string],s?:PairedSession,fetcher?:Fetcher,options?:DirectReadOptions):Promise<import('./wire-readers').ThreadMetadata>;
export function readDirect(c:Connection,args:string[],s?:PairedSession,fetcher?:Fetcher,options?:DirectReadOptions):Promise<unknown>;
export async function readDirect(c:Connection,args:string[],s?:PairedSession,fetcher:Fetcher=browserFetch,options:DirectReadOptions={}){
 const access=options.access?{api:options.access.api,invalidate:()=>{}}:await readApi(c,s,fetcher,options.signal),api=(path:string)=>access.api('/api/orchestration/'+path,undefined,options);
 try{
 if(args[0]==='no-project'&&args.length===1)return await ensureNoProject(access.api);
 if(args[0]==='projects'&&args.length===1)return {projects:readWireProjects(await api('shell'))};
 if(args[0]==='threads'&&args[1]==='--project'&&args.length===3)return {threads:readThreadList(await api('shell')).filter(t=>t.projectId===args[2])};
 if(args[0]==='read'&&args.length===2)return readMetadataSnapshot(await api('threads/'+encodeURIComponent(args[1])+(options.control?'?controlOnly=true':'?turnLimit=10'))).thread;
 throw Error('Unsupported direct T3 operation.');
 }catch(error){if(error instanceof T3HttpError&&(error.status===401||error.status===403))access.invalidate();throw error;}
}
export function commandId(id:string,name:string){
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))throw Error('Invalid request ID.');
 const b=Buffer.from(sha1(Buffer.concat([Buffer.from(id.replace(/-/g,''),'hex'),Buffer.from(name)]))).slice(0,16);b[6]=(b[6]&15)|80;b[8]=(b[8]&63)|128;const h=b.toString('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
export async function sendDirect(r:Request,s:PairedSession|undefined,save:()=>Promise<void>,fetcher?:Fetcher,access?:ThreadAccess,beforeThreadCreate?:()=>void|Promise<void>){
 const environment=access?.api??await environmentApi(r.connection,s,fetcher);
 const requestOptions=beforeThreadCreate?{beforeThreadCreate}:undefined;
 const api=(path:string,payload?:unknown)=>environment('/api/orchestration/'+path,payload,requestOptions);
 const hash=Buffer.from(sha256(Buffer.from(JSON.stringify({project:r.project.id,title:r.title,prompt:r.prompt,attachments:r.attachments??[],context:r.context??null,...(r.threadId?{threadId:r.threadId}:{})})))).toString('hex');
 if(r.directPlan&&(r.directPlan.hash!==hash||r.directPlan.environmentId!==r.connection.environmentId))throw Error('Saved request no longer matches its original content or environment.');
 if(!r.directPlan){
  if(r.threadId){
   const thread=readMetadataSnapshot(await api('threads/'+encodeURIComponent(r.threadId)+'?controlOnly=true')).thread;
   const turn=existingThreadTurn(thread,{threadId:r.threadId,projectId:r.project.id},commandId(r.id,'turn'),{messageId:commandId(r.id,'message'),role:'user',text:r.prompt,attachments:r.attachments??[],...(r.context?{context:r.context}:{})});
   r.directPlan={protocolVersion:2,hash,environmentId:r.connection.environmentId!,phase:'created',create:null,turn,...(thread.session?.status==='running'&&thread.session.activeTurnId?{observedActiveTurnId:thread.session.activeTurnId}:{})};
  }else{
  const projects=readWireProjects(await api('shell'));const project=projects.find(p=>p.id===r.project.id);if(!project)throw Error('Project no longer exists. Scan this connection again.');
  const defaults=await readNewThreadDefaults(environment,access?.origin??endpoint(r.connection.url||''),project);
  const {workspaceStrategy,...accessDefaults}=defaults;
  const common={threadId:commandId(r.id,'thread'),...accessDefaults,interactionMode:'default',createdAt:new Date().toISOString()};
  const generateTitle=r.title===AUTO_THREAD_TITLE,title=generateTitle?promptThreadTitle(r.prompt,r.attachments):r.title;
  r.directPlan={protocolVersion:2,...(generateTitle||workspaceStrategy?.type==='worktree'?{launch:true,generateTitle,workspaceStrategy}:{}),hash,environmentId:r.connection.environmentId!,phase:'prepared',create:{...common,type:'thread.create',commandId:commandId(r.id,'create'),projectId:project.id,title,branch:null,worktreePath:null},turn:{...common,type:'thread.turn.start',commandId:commandId(r.id,'turn'),message:{messageId:commandId(r.id,'message'),role:'user',text:r.prompt,attachments:r.attachments??[],...(r.context?{context:r.context}:{})}}};
  }
 }
 // Persist the complete commands before their first attempt AND on every retry.
 // A lost reply can only replay the same commands, including timestamps/model.
 await save();const plan=r.directPlan;if(!plan)throw Error('The saved T3 request plan is missing. Nothing was sent.');
 // V2 generates automatic titles only when launch receives the first message.
 // Persist the choice so old pending plans retain their original command path.
 if(plan.phase==='prepared'&&plan.launch){
  if(!plan.create)throw Error('The saved T3 creation command is missing. Nothing was sent.');
  const {commandId,threadId,projectId,title,modelSelection,runtimeMode,interactionMode}=plan.create;
  const {messageId,text,attachments,context}=plan.turn.message;
  await environment('/api/orchestration/launch',{commandId,threadId,projectId,title,generateTitle:plan.generateTitle??true,modelSelection,runtimeMode,interactionMode,creationSource:'web',workspaceStrategy:plan.workspaceStrategy??{type:'root'},initialMessage:{messageId,text,attachments,...(context?{context}:{})}},requestOptions);
  plan.phase='started';await save();
 }
 if(plan.phase==='prepared'){await api('dispatch',{...plan.create,...(plan.protocolVersion===2?{}:{__legacyV1:true})});plan.phase='created';await save();}
 if(plan.phase==='created'){const acknowledged=await api('dispatch',{...plan.turn,...(plan.protocolVersion===2?{}:{__legacyV1:true})});if(isRecord(acknowledged)&&typeof acknowledged.sequence==='number'&&Number.isSafeInteger(acknowledged.sequence)&&acknowledged.sequence>=0)plan.delivery={messageId:plan.turn.message.messageId,requestedAt:plan.turn.createdAt,sequence:acknowledged.sequence,activeTurnId:plan.observedActiveTurnId};plan.phase='started';await save();}
 return {threadId:plan.turn.threadId,phase:'started' as const};
}
