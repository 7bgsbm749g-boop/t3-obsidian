import {validateHostedRequest,type HostedInlineRequest} from './hosted-inline';
import {validSteeringInput} from './inline-steering';

export interface ResponseBindingEntry {version:1;clock:number;actor:string;request:HostedInlineRequest}
export type ResponseBindingData=Record<string,ResponseBindingEntry>;
const keys=['initialOwner','localMessageId','localStage','importTurn','replyFolders','keepIntermediate','intermediateMode','finalAnswerFormat','initialInput','independent','destinationSection','threadTitle','id','vaultId','notePath','threadId','messageId','projectId','threadEnvironmentId','initialHash','createdAt'] as const;
/** Shared routing and user choices only. Checkpoints, received prose and final
 * recovery bodies remain in the device's existing local stores. */
export function compactResponseBinding(request:HostedInlineRequest):HostedInlineRequest {
  const value:any={version:4,localOnly:true,nativeProjection:true,responseContainer:true};
  for(const key of keys)if(request[key]!==undefined)value[key]=request[key];
  value.host={environmentId:request.host.environmentId,workspaceRoot:request.host.workspaceRoot,directory:request.host.directory,...(request.host.connectionId?{connectionId:request.host.connectionId}:{})};
  if(request.localSteering?.length)value.localSteering=request.localSteering.map(input=>{
    if(!validSteeringInput(input))throw Error('Invalid saved response input.');
    return {messageId:input.messageId,text:input.text,before:[],...(input.selection?{selection:input.selection}:{}),...(input.confirmed?{confirmed:true}:{}),...(input.label?{label:input.label}:{}),...(input.createdAt?{createdAt:input.createdAt}:{})};
  });
  return JSON.parse(JSON.stringify(validateHostedRequest(value)));
}
export function loadResponseBindingData(value:unknown):ResponseBindingData {
  const result:ResponseBindingData={};
  if(!value||typeof value!=='object'||Array.isArray(value))return result;
  for(const [id,entry] of Object.entries(value))try{
    if(entry?.version!==1||!Number.isSafeInteger(entry.clock)||entry.clock<0||typeof entry.actor!=='string'||!entry.actor||entry.actor.length>200||entry.request?.localOnly!==true)continue;
    const request=compactResponseBinding(entry.request);if(request.id!==id)continue;
    result[id]={version:1,clock:entry.clock,actor:entry.actor,request};
  }catch{/* Invalid settings never create a response or replace note text. */}
  return result;
}
const canonical=(value:any):string=>JSON.stringify(value,(_key,child)=>child&&typeof child==='object'&&!Array.isArray(child)?Object.fromEntries(Object.keys(child).sort().map(key=>[key,child[key]])):child);
export function mergeResponseBindingData(...sources:unknown[]):ResponseBindingData {
  const result:ResponseBindingData={};
  for(const source of sources)for(const [id,next] of Object.entries(loadResponseBindingData(source))){
    const old=result[id];
    if(!old||next.clock>old.clock||next.clock===old.clock&&(next.actor>old.actor||next.actor===old.actor&&canonical(next.request)>canonical(old.request)))result[id]=next;
  }
  return Object.fromEntries(Object.entries(result).sort(([a],[b])=>a.localeCompare(b)));
}
export function updateResponseBindingData(data:ResponseBindingData,request:HostedInlineRequest,actor:string,now=Date.now()):ResponseBindingData {
  const compact=compactResponseBinding(request),old=data[request.id];
  if(old&&canonical(old.request)===canonical(compact))return data;
  return {...data,[request.id]:{version:1,clock:Math.max(now,(old?.clock??0)+1),actor,request:compact}};
}
const requests=new WeakMap<ResponseBindingData,readonly HostedInlineRequest[]>();
export function responseBindingRequests(data:ResponseBindingData){let value=requests.get(data);if(!value){value=Object.values(data).map(entry=>entry.request);requests.set(data,value);}return value;}
