import {redact} from './diagnostics';
export interface SendFailure {at:string;stage:string;elapsedMs:number;requestId?:string;threadId?:string;messageId?:string;environmentId?:string;bindingIds?:string[];delivery:'not-started'|'unconfirmed'|'accepted';error:unknown}
export interface SendFailureLog {version:1;pluginVersion:string;deviceId:string;failures:SendFailure[]}
/** A read-only, bounded export of this device's existing failure log. Unknown
 * stored fields are excluded; export rechecks redaction without altering it. */
export function sendFailureLog(saved:unknown,pluginVersion:string,deviceId:string,since?:string):SendFailureLog {
  const error=(value:any,depth=0):unknown=>{
    if(!value||typeof value!=='object')return redact(value);
    const result:Record<string,unknown>={};
    for(const key of ['name','message','stack','kind','requiredPermission','rpcMethod'])if(typeof value[key]==='string')result[key]=redact(value[key]);
    if(value.cause!==undefined&&depth<3)result.cause=error(value.cause,depth+1);
    return result;
  };
  const failures=(Array.isArray(saved)?saved:[]).slice(-64).filter(entry=>typeof entry?.at==='string'&&Number.isFinite(Date.parse(entry.at))&&typeof entry.stage==='string'&&['not-started','unconfirmed','accepted'].includes(entry.delivery)&&(!since||Date.parse(entry.at)>=Date.parse(since))).map(entry=>{
    const result:SendFailure={at:entry.at,stage:String(redact(entry.stage)),elapsedMs:Number.isFinite(entry.elapsedMs)?entry.elapsedMs:0,delivery:entry.delivery,error:error(entry.error)};
    for(const key of ['requestId','threadId','messageId','environmentId'] as const)if(typeof entry[key]==='string')result[key]=String(redact(entry[key]));
    if(Array.isArray(entry.bindingIds))result.bindingIds=entry.bindingIds.filter((id:unknown)=>typeof id==='string').slice(0,32).map((id:string)=>String(redact(id)));
    return result;
  });
  return {version:1,pluginVersion,deviceId,failures};
}
/** Failures only. Never retain prompts, attachments, sessions or a stream log. */
export function appendSendFailure(saved:unknown,failure:SendFailure):SendFailure[]{
  const previous=Array.isArray(saved)?saved.filter(entry=>typeof entry?.at==='string'&&typeof entry.stage==='string'):[];
  const cause=(error:unknown,depth=0):unknown=>{if(error&&typeof error==='object'&&'message' in error)return {name:(error as Error).name,message:(error as Error).message,stack:(error as Error).stack,...('kind' in error?{kind:error.kind}:{}),...('requiredPermission' in error?{requiredPermission:error.requiredPermission}:{}),...('rpcMethod' in error?{rpcMethod:error.rpcMethod}:{}),...('cause' in error&&depth<3?{cause:cause(error.cause,depth+1)}:{})};return error;};
  return [...previous,{...failure,error:redact(cause(failure.error))}].slice(-64);
}
