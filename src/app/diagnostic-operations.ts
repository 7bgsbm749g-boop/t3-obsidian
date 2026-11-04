import {isRecord,toError} from '../shared/values';
import {contentHash} from '../responses/completion';
import {logEvent,logFailure} from './diagnostics';

function promiseLike(value:unknown):value is PromiseLike<unknown>{return isRecord(value)&&typeof value.then==='function';}
const identity=(value:unknown)=>typeof value==='string'?value:undefined;

/** Log exact operation identities without serializing prompts or credentials. */
export function instrumentOperations(target:object,names:string[]):()=>void {
  const operations=target as Record<string,unknown>,undo:Array<()=>void>=[];
  for(const name of names){
    const value=operations[name];if(typeof value!=='function')continue;
    const original=value as (...args:unknown[])=>unknown;
    const own=Object.getOwnPropertyDescriptor(target,name);
    operations[name]=function(this:unknown,...args:unknown[]){
      const operationId=(typeof crypto==='undefined'?undefined:crypto.randomUUID?.())??`${Date.now()}-${Math.random()}`;
      const first=isRecord(args[0])?args[0]:undefined,second=isRecord(args[1])?args[1]:undefined;
      const project=isRecord(first?.project)?first.project:undefined;
      const metadata={requestId:project&&first?.connection?identity(first.id):undefined,projectId:identity(project?.id),threadId:identity(first?.threadId),notePath:identity(first?.path??second?.path),jobId:['sendInlineSteering','continueInline','stopHostedInline'].includes(name)?identity(args[0]):undefined,...(typeof args[0]==='string'&&['sendChat','sendInlineChat'].includes(name)?{promptHash:contentHash(args[0]),promptLength:args[0].length}:{})};
      const started=Date.now();logEvent(`operation.${name}.started`,{...metadata,operationId});
      const done=(result:unknown)=>{logEvent(`operation.${name}.completed`,{...metadata,operationId,durationMs:Date.now()-started});return result;};
      const failed=(error:unknown)=>{logFailure(`operation.${name}.failed`,error,{...metadata,operationId,durationMs:Date.now()-started});throw toError(error);};
      try{const result=original.apply(this,args);return promiseLike(result)?result.then(done,failed):done(result);}catch(error){return failed(error);}
    };
    undo.push(()=>{if(own)Object.defineProperty(target,name,own);else delete operations[name];});
  }
  return ()=>{for(const dispose of undo)dispose();};
}
