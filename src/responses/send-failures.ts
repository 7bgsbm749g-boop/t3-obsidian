import {isRecord,records} from '../shared/values';
import {redact} from '../app/diagnostics';
export interface SendFailure {at:string;stage:string;elapsedMs:number;requestId?:string;threadId?:string;messageId?:string;environmentId?:string;bindingIds?:string[];delivery:'not-started'|'unconfirmed'|'accepted';error:unknown}
export interface SendFailureLog {version:1;pluginVersion:string;deviceId:string;failures:SendFailure[];diagnostics?:import('../app/diagnostics').DiagnosticExport}
/** A read-only, bounded export of this device's existing failure log. Unknown
 * stored fields are excluded; export rechecks redaction without altering it. */
export function sendFailureLog(saved:unknown,pluginVersion:string,deviceId:string,since?:string):SendFailureLog {
  const error=(value:unknown,depth=0):unknown=>{
    if(!value||typeof value!=='object')return redact(value);
    if(!isRecord(value))return {};
    const result:Record<string,unknown>={};
    for(const key of ['name','message','stack','kind','requiredPermission','rpcMethod','connectionId'])if(typeof value[key]==='string')result[key]=redact(value[key]);
    for(const key of ['elapsedMs','pendingCount','idleMs'])if(Number.isFinite(value[key]))result[key]=value[key];
    if(value.confirmed===true)result.confirmed=true;
    if(value.cause!==undefined&&depth<3)result.cause=error(value.cause,depth+1);
    return result;
  };
  const failures=records(saved).slice(-64).filter((entry):entry is Record<string,unknown>&{at:string;stage:string;delivery:SendFailure['delivery']}=>typeof entry.at==='string'&&Number.isFinite(Date.parse(entry.at))&&typeof entry.stage==='string'&&typeof entry.delivery==='string'&&['not-started','unconfirmed','accepted'].includes(entry.delivery)&&(!since||Date.parse(entry.at)>=Date.parse(since))).map(entry=>{
    const result:SendFailure={at:entry.at,stage:String(redact(entry.stage)),elapsedMs:typeof entry.elapsedMs==='number'&&Number.isFinite(entry.elapsedMs)?entry.elapsedMs:0,delivery:entry.delivery,error:error(entry.error)};
    for(const key of ['requestId','threadId','messageId','environmentId'] as const)if(typeof entry[key]==='string')result[key]=String(redact(entry[key]));
    if(Array.isArray(entry.bindingIds))result.bindingIds=entry.bindingIds.filter((id:unknown)=>typeof id==='string').slice(0,32).map((id:string)=>String(redact(id)));
    return result;
  });
  return {version:1,pluginVersion,deviceId,failures};
}
/** Failures only. Never retain prompts, attachments, sessions or a stream log. */
export function appendSendFailure(saved:unknown,failure:SendFailure):SendFailure[]{
  // Keep legacy entries here; the bounded export independently validates and redacts them.
  const previous=records(saved).filter(entry=>typeof entry.at==='string'&&typeof entry.stage==='string') as unknown as SendFailure[];
  const cause=(error:unknown,depth=0):unknown=>{if(error&&typeof error==='object'&&'message' in error){const result:Record<string,unknown>={name:(error as Error).name,message:(error as Error).message,stack:(error as Error).stack};for(const key of ['kind','requiredPermission','rpcMethod','connectionId','elapsedMs','pendingCount','idleMs','confirmed'])if(key in error)result[key]=Reflect.get(error,key) as unknown;if('cause' in error&&depth<3)result.cause=cause(error.cause,depth+1);return result;}return error;};
  return [...previous,{...failure,error:redact(cause(failure.error))}].slice(-64);
}
