import {T3_RESPONSE_MAX_BYTES,T3ResponseTooLargeError} from './t3-response-limits';
import {Buffer} from 'buffer';
import {sha1} from '@noble/hashes/sha1';
import {sha256} from '@noble/hashes/sha256';
import {proofKey,proof} from './dpop';
import type {Connection,Request} from './bridge';
import type {InlineStartRequest} from './inline-thread';
import {existingThreadTurn} from './thread-target';
import {readNewThreadDefaults} from './model-defaults';
import {T3HttpError} from './thread-access-cache';
import {t3Api,abortableRead,requestAborted,type AbortableT3Api,type T3RequestOptions} from './t3-api';
import {T3_PROTOCOL_VERSION,T3_PROTOCOL_HEADER} from './orchestration-v2';
import type {SocketFactory} from './t3-rpc';
import {PLUGIN_SCOPE,hasPluginPermissions} from './environment-permissions';
import {ensureNoProject} from './no-project';
export interface PairedConnection {id:string;name:string;url:string;environmentId:string;managed?:boolean}
export interface PairedSession {token:string;expiresAt:number;environmentId:string;url:string;dpopKeyId?:string;accountId?:string;permissions?:string[]}
export interface DirectPlan {protocolVersion?:2;hash:string;environmentId:string;phase:'prepared'|'created'|'started';create:any;turn:any;observedActiveTurnId?:string;delivery?:InlineStartRequest}
export type Fetcher=typeof fetch;
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
export async function jsonHttp(url:string,options:RequestInit={},fetcher:Fetcher=fetch):Promise<any>{
 const controller=new AbortController(),cancel=()=>controller.abort(options.signal?.reason);const timer=setTimeout(()=>controller.abort(),30000);
 if(options.signal?.aborted)cancel();else options.signal?.addEventListener('abort',cancel,{once:true});
 try{
  requestAborted(controller.signal);
  const r=await abortableRead(fetcher(url,{...options,credentials:'omit',redirect:'error',cache:'no-store',signal:controller.signal}),controller.signal);
  if(!r.ok){if(r.status===401||r.status===403)throw new T3HttpError(r.status,'T3 access denied or expired. Create a fresh pairing link in T3 and pair this device again.');throw new T3HttpError(r.status,`T3 returned HTTP ${r.status}.`);}
  if(Number(r.headers.get('content-length')||0)>T3_RESPONSE_MAX_BYTES){controller.abort();throw new T3ResponseTooLargeError();}
  let body='';
  if(r.body?.getReader){const reader=r.body.getReader();const parts:Uint8Array[]=[];let size=0;try{for(;;){const {done,value}=await abortableRead(reader.read(),controller.signal);if(done)break;size+=value.byteLength;if(size>T3_RESPONSE_MAX_BYTES){await reader.cancel();throw new T3ResponseTooLargeError();}parts.push(value);}}finally{if(controller.signal.aborted)void reader.cancel().catch(()=>{});reader.releaseLock();}
   // The platform decoder avoids the browser Buffer polyfill's large temporary
   // code-point arrays. Preserve BOM handling and the existing byte limit.
   body=new TextDecoder('utf-8',{ignoreBOM:true}).decode(Buffer.concat(parts));}
  else {body=await abortableRead(r.text(),controller.signal);if(Buffer.byteLength(body)>T3_RESPONSE_MAX_BYTES)throw new T3ResponseTooLargeError();}
  try{return JSON.parse(body);}catch{throw Error('T3 returned an invalid response; response contents withheld.');}
 }catch(e){requestAborted(options.signal??undefined);if(e instanceof Error && (e.message.startsWith('T3 ')||e.message.startsWith('Use ')))throw e;throw Object.assign(Error('Cannot reach T3 directly. Check its public address, network access, and that T3 is running. Nothing is queued.'),{cause:e});}
 finally{clearTimeout(timer);options.signal?.removeEventListener('abort',cancel);}
}
export async function descriptor(url:string,fetcher?:Fetcher,signal?:AbortSignal){
 const d=await jsonHttp(endpoint(url)+'/.well-known/t3/environment',{signal},fetcher);
 if(typeof d?.environmentId!=='string'||typeof d?.label!=='string')throw Error('This address is not a compatible T3 environment. Use its T3 pairing link.');
 if(d.orchestrationProtocolVersion!==T3_PROTOCOL_VERSION)throw Error('Update this T3 machine to Orchestrator v2 before connecting.');
 return d;
}
export async function pair(address:string,code:string,fetcher?:Fetcher,expectedEnvironmentId?:string):Promise<{descriptor:any;session:PairedSession}>{
 const input=pairingInput(address,code);if(!input.code)throw Error('Paste a fresh one-time pairing link or pairing code from T3 Settings → Connections.');
 const d=await descriptor(input.url,fetcher);if(expectedEnvironmentId&&d.environmentId!==expectedEnvironmentId)throw Error("The address no longer matches the selected T3 machine. Discover machines again; no pairing code was sent.");
 const body=new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:token-exchange',subject_token:input.code,subject_token_type:'urn:t3:params:oauth:token-type:environment-bootstrap',requested_token_type:'urn:ietf:params:oauth:token-type:access_token',scope:PLUGIN_SCOPE,client_label:'Send to T3 Code (Obsidian)'}).toString();
 const token=await jsonHttp(input.url+'/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body},fetcher);
 if(token.token_type!=='Bearer'||typeof token.access_token!=='string'||!Number.isFinite(token.expires_in)||token.expires_in<=0)throw Error('T3 returned an unsupported pairing session.');
 const permissions=String(token.scope).split(/\s+/);
 if(!hasPluginPermissions({permissions}))throw Error('This pairing link does not permit thread and note access. Create a new T3 pairing link with filesystem read and write access, then reconnect this machine.');
 return {descriptor:d,session:{token:token.access_token,expiresAt:Date.now()+token.expires_in*1000,environmentId:d.environmentId,url:input.url,permissions}};
}
export async function environmentApi(c:Connection,s:PairedSession|undefined,fetcher?:Fetcher,makeSocket?:SocketFactory,signal?:AbortSignal){
 const url=endpoint(c.url||'');
 if(!s||!s.token||s.url!==url||s.environmentId!==c.environmentId)throw Error('Pair this connection on this device first. Session credentials do not sync.');
 if(s.expiresAt<=Date.now()+5000)throw Error('T3 pairing session expired. Pair this device again using a fresh T3 link.');
 const d=await descriptor(url,fetcher,signal);if(d.environmentId!==c.environmentId)throw Error('The address now points to a different T3 environment. Nothing was sent; add it as a new connection.');
 const key=s.dpopKeyId?await proofKey(s.dpopKeyId,false):undefined;
 return t3Api(async(path:string,payload?:any,options?:T3RequestOptions)=>{requestAborted(options?.signal);if(!path.startsWith('/api/')||path.includes('..')||path.includes('\\'))throw Error('Invalid T3 API path.');const target=url+path;const method=payload===undefined?'GET':'POST';return jsonHttp(target,{method,signal:options?.signal,headers:{Authorization:(key?'DPoP ':'Bearer ')+s.token,'Content-Type':'application/json',[T3_PROTOCOL_HEADER]:String(T3_PROTOCOL_VERSION),...(key?{DPoP:await proof(key,method,target,s.token)}:{})},...(payload===undefined?{}:{body:JSON.stringify(payload)})},fetcher);},url,makeSocket);
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
  const controller=new AbortController();entry={controller,users:0,settled:false,expires:Math.min(Date.now()+30_000,s.expiresAt-5000),work:Promise.resolve(undefined as any)};
  const selected=entry;entry.work=environmentApi(c,{...s},fetcher,undefined,controller.signal).then(api=>{selected.settled=true;return api;},error=>{selected.settled=true;if(cache!.get(identity)===selected)cache!.delete(identity);throw error;});cache.set(identity,entry);
  while(cache.size>16)cache.delete(cache.keys().next().value!);
 }
 entry.users++;
 try{const api=await abortableRead(entry.work,signal);requestAborted(signal);return {api,invalidate:()=>{if(cache!.get(identity)===entry)cache!.delete(identity);}};}
 finally{if(--entry.users===0&&!entry.settled){entry.controller.abort();if(cache.get(identity)===entry)cache.delete(identity);}}
}
export interface DirectReadOptions extends T3RequestOptions {control?:boolean}
export async function readDirect(c:Connection,args:string[],s?:PairedSession,fetcher:Fetcher=fetch,options:DirectReadOptions={}){
 const access=await readApi(c,s,fetcher,options.signal),api=(path:string)=>access.api('/api/orchestration/'+path,undefined,options);
 try{
 if(args[0]==='no-project'&&args.length===1)return await ensureNoProject(access.api);
 if(args[0]==='projects'&&args.length===1)return {projects:(await api('shell')).projects};
 if(args[0]==='threads'&&args[1]==='--project'&&args.length===3)return {threads:(await api('shell')).threads.filter((t:any)=>t.projectId===args[2])};
 if(args[0]==='read'&&args.length===2)return (await api('threads/'+encodeURIComponent(args[1])+(options.control?'?controlOnly=true':'?turnLimit=10'))).thread;
 throw Error('Unsupported direct T3 operation.');
 }catch(error){if(error instanceof T3HttpError&&(error.status===401||error.status===403))access.invalidate();throw error;}
}
export function commandId(id:string,name:string){
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))throw Error('Invalid request ID.');
 const b=Buffer.from(sha1(Buffer.concat([Buffer.from(id.replace(/-/g,''),'hex'),Buffer.from(name)]))).subarray(0,16);b[6]=(b[6]&15)|80;b[8]=(b[8]&63)|128;const h=b.toString('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
export async function sendDirect(r:Request,s:PairedSession|undefined,save:()=>Promise<void>,fetcher?:Fetcher){
 const environment=await environmentApi(r.connection,s,fetcher);
 const api=(path:string,payload?:any)=>environment('/api/orchestration/'+path,payload);
 const hash=Buffer.from(sha256(Buffer.from(JSON.stringify({project:r.project.id,title:r.title,prompt:r.prompt,attachments:r.attachments??[],context:r.context??null,...(r.threadId?{threadId:r.threadId}:{})})))).toString('hex');
 if(r.directPlan&&(r.directPlan.hash!==hash||r.directPlan.environmentId!==r.connection.environmentId))throw Error('Saved request no longer matches its original content or environment.');
 if(!r.directPlan){
  if(r.threadId){
   const thread=(await api('threads/'+encodeURIComponent(r.threadId)+'?controlOnly=true')).thread;
   const turn=existingThreadTurn(thread,{threadId:r.threadId,projectId:r.project.id},commandId(r.id,'turn'),{messageId:commandId(r.id,'message'),role:'user',text:r.prompt,attachments:r.attachments??[],...(r.context?{context:r.context}:{})});
   r.directPlan={protocolVersion:2,hash,environmentId:r.connection.environmentId!,phase:'created',create:null,turn,...(thread.session?.status==='running'&&thread.session.activeTurnId?{observedActiveTurnId:thread.session.activeTurnId}:{})};
  }else{
  const shell=await api('shell');const project=shell.projects.find((p:any)=>p.id===r.project.id);if(!project)throw Error('Project no longer exists. Scan this connection again.');
  const defaults=await readNewThreadDefaults(environment,endpoint(r.connection.url||''),project);
  const common={threadId:commandId(r.id,'thread'),...defaults,interactionMode:'default',createdAt:new Date().toISOString()};
  r.directPlan={protocolVersion:2,hash,environmentId:r.connection.environmentId!,phase:'prepared',create:{...common,type:'thread.create',commandId:commandId(r.id,'create'),projectId:project.id,title:r.title,branch:null,worktreePath:null},turn:{...common,type:'thread.turn.start',commandId:commandId(r.id,'turn'),message:{messageId:commandId(r.id,'message'),role:'user',text:r.prompt,attachments:r.attachments??[],...(r.context?{context:r.context}:{})}}};
  }
 }
 // Persist the complete commands before their first attempt AND on every retry.
 // A lost reply can only replay the same commands, including timestamps/model.
 await save();const plan=r.directPlan;
 if(plan.phase==='prepared'){await api('dispatch',{...plan.create,...(plan.protocolVersion===2?{}:{__legacyV1:true})});plan.phase='created';await save();}
 if(plan.phase==='created'){const acknowledged=await api('dispatch',{...plan.turn,...(plan.protocolVersion===2?{}:{__legacyV1:true})});if(Number.isSafeInteger(acknowledged?.sequence)&&acknowledged.sequence>=0)plan.delivery={messageId:plan.turn.message.messageId,requestedAt:plan.turn.createdAt,sequence:acknowledged.sequence,activeTurnId:plan.observedActiveTurnId};plan.phase='started';await save();}
 return {threadId:plan.turn.threadId as string,phase:'started' as const};
}
