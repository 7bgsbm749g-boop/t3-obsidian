import {isRecord,parseJson} from '../shared/values';
import {validateResponseRequest,type ResponseRequest} from './response-model';
import {validSteeringInput} from '../conversations/inline-steering';
import {localFinalIdentity} from './local-final-cache';

export interface ResponseCompletion {identity:string;turnId:string;outputHash:string}
export interface ResponseBindingEntry {version:1;clock:number;actor:string;request:ResponseRequest;completion?:ResponseCompletion}
export type ResponseBindingData=Record<string,ResponseBindingEntry>;
const keys=['initialOwner','localMessageId','localStage','importTurn','replyFolders','keepIntermediate','intermediateMode','finalAnswerFormat','initialInput','independent','destinationSection','threadTitle','id','vaultId','notePath','threadId','messageId','projectId','threadEnvironmentId','initialHash','createdAt'] as const;
/** Shared routing and user choices only. Checkpoints, received prose and final
 * recovery bodies remain in the device's existing local stores. */
export function compactResponseBinding(request:ResponseRequest):ResponseRequest {
  const value:Record<string,unknown>={version:4,localOnly:true,nativeProjection:true,responseContainer:true};
  for(const key of keys)if(request[key]!==undefined)value[key]=request[key];
  value.host={environmentId:request.host.environmentId,workspaceRoot:request.host.workspaceRoot,directory:request.host.directory,...(request.host.connectionId?{connectionId:request.host.connectionId}:{})};
  if(request.localSteering?.length)value.localSteering=request.localSteering.map(input=>{
    if(!validSteeringInput(input))throw Error('Invalid saved response input.');
    return {messageId:input.messageId,text:input.text,before:[],...(input.selection?{selection:input.selection}:{}),...(input.selections?{selections:input.selections}:{}),...(input.sourceResponseId?{sourceResponseId:input.sourceResponseId}:{}),...(input.confirmed?{confirmed:true}:{}),...(input.label?{label:input.label}:{}),...(input.createdAt?{createdAt:input.createdAt}:{})};
  });
  return validateResponseRequest(parseJson(JSON.stringify(validateResponseRequest(value))));
}
export function loadResponseBindingData(value:unknown):ResponseBindingData {
  const result:ResponseBindingData={};
  if(!isRecord(value))return result;
  for(const [id,entry] of Object.entries(value))try{
    if(!isRecord(entry)||entry.version!==1||typeof entry.clock!=='number'||!Number.isSafeInteger(entry.clock)||entry.clock<0||typeof entry.actor!=='string'||!entry.actor||entry.actor.length>200||!isRecord(entry.request)||entry.request.localOnly!==true)continue;
    const request=compactResponseBinding(validateResponseRequest(entry.request));if(request.id!==id)continue;
    const completion=entry.completion;
    result[id]={version:1,clock:entry.clock,actor:entry.actor,request,...(isRecord(completion)&&completion.identity===localFinalIdentity(request)&&typeof completion.turnId==='string'&&completion.turnId.length>0&&completion.turnId.length<=1000&&typeof completion.outputHash==='string'&&/^[a-f0-9]{64}$/.test(completion.outputHash)?{completion:{identity:completion.identity,turnId:completion.turnId,outputHash:completion.outputHash}}:{})};
    if(canonical(entry)===canonical(result[id]))result[id]=entry as unknown as ResponseBindingEntry;
  }catch{/* Invalid settings never create a response or replace note text. */}
  return result;
}
const canonical=(value:unknown):string=>JSON.stringify(value,(_key,child:unknown)=>isRecord(child)?Object.fromEntries(Object.keys(child).sort().map(key=>[key,child[key]])):child);
export function mergeResponseBindingData(...sources:unknown[]):ResponseBindingData {
  const result:ResponseBindingData={};
  for(const source of sources)for(const [id,next] of Object.entries(loadResponseBindingData(source))){
    const old=result[id];
    const winner=!old||next.clock>old.clock||next.clock===old.clock&&(next.actor>old.actor||next.actor===old.actor&&canonical(next.request)>canonical(old.request))?next:old;
    const receipts=[old?.completion,next.completion].filter((receipt):receipt is ResponseCompletion=>!!receipt&&receipt.identity===localFinalIdentity(winner.request)).sort((a,b)=>canonical(a).localeCompare(canonical(b)));
    result[id]={...winner,...(receipts.length?{completion:receipts.at(-1)}:{})};
  }
  return Object.fromEntries(Object.entries(result).sort(([a],[b])=>a.localeCompare(b)));
}
export function updateResponseBindingData(data:ResponseBindingData,request:ResponseRequest,actor:string,now=Date.now()):ResponseBindingData {
  const compact=compactResponseBinding(request),old=data[request.id];
  if(old&&canonical(old.request)===canonical(compact))return data;
  return {...data,[request.id]:{version:1,clock:Math.max(now,(old?.clock??0)+1),actor,request:compact,...(old?.completion?.identity===localFinalIdentity(compact)?{completion:old.completion}:{})}};
}
/** A portable terminal hint avoids a live watch. The receiving device still
 * verifies the canonical result and its own note before any materialization. */
export function completeResponseBinding(data:ResponseBindingData,request:ResponseRequest,turnId:string,outputHash:string,actor:string){
  const entry=data[request.id];if(!entry||localFinalIdentity(entry.request)!==localFinalIdentity(request))return data;
  const completion={identity:localFinalIdentity(request),turnId,outputHash};
  if(canonical(entry.completion)===canonical(completion))return data;
  return {...data,[request.id]:{...entry,clock:Math.max(Date.now(),entry.clock+1),actor,completion}};
}
const requests=new WeakMap<ResponseBindingData,readonly ResponseRequest[]>();
export function responseBindingRequests(data:ResponseBindingData){let value=requests.get(data);if(!value){value=Object.values(data).map(entry=>entry.request);requests.set(data,value);}return value;}
