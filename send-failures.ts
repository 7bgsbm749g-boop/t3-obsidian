import {redact} from './diagnostics';
export interface SendFailure {at:string;stage:string;elapsedMs:number;requestId?:string;threadId?:string;messageId?:string;environmentId?:string;bindingIds?:string[];delivery:'not-started'|'unconfirmed'|'accepted';error:unknown}
/** Failures only. Never retain prompts, attachments, sessions or a stream log. */
export function appendSendFailure(saved:unknown,failure:SendFailure):SendFailure[]{
  const previous=Array.isArray(saved)?saved.filter(entry=>typeof entry?.at==='string'&&typeof entry.stage==='string'):[];
  const cause=(error:unknown,depth=0):unknown=>{if(error&&typeof error==='object'&&'message' in error)return {name:(error as Error).name,message:(error as Error).message,stack:(error as Error).stack,...('kind' in error?{kind:error.kind}:{}),...('requiredPermission' in error?{requiredPermission:error.requiredPermission}:{}),...('rpcMethod' in error?{rpcMethod:error.rpcMethod}:{}),...('cause' in error&&depth<3?{cause:cause(error.cause,depth+1)}:{})};return error;};
  return [...previous,{...failure,error:redact(cause(failure.error))}].slice(-64);
}
