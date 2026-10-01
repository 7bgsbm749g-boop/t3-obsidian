import {contentHash} from './completion';
import {logEvent,logFailure} from './diagnostics';
/** Explicit operation boundaries: no arguments/results containing note text or
 * credentials are serialized, and the original return/throw behavior is kept. */
export function instrumentOperations(target:object,names:string[]):()=>void {
  const undo:Array<()=>void>=[];
  for(const name of names){
    const original=(target as any)[name];if(typeof original!=='function')continue;
    const own=Object.getOwnPropertyDescriptor(target,name);
    (target as any)[name]=function(...args:unknown[]){
      const operationId=globalThis.crypto?.randomUUID?.()??`${Date.now()}-${Math.random()}`;
      const first=args[0] as any,second=args[1] as any;
      const metadata={requestId:first?.project&&first?.connection?first.id:undefined,projectId:first?.project?.id,threadId:first?.threadId,notePath:first?.path??second?.path,jobId:['sendInlineSteering','continueInline','stopHostedInline'].includes(name)?first:undefined,...(typeof first==='string'&&['sendChat','sendInlineChat'].includes(name)?{promptHash:contentHash(first),promptLength:first.length}:{})};
      const started=Date.now();logEvent(`operation.${name}.started`,{...metadata,operationId});
      const done=(value:unknown)=>{logEvent(`operation.${name}.completed`,{...metadata,operationId,durationMs:Date.now()-started});return value;};
      const failed=(error:unknown)=>{logFailure(`operation.${name}.failed`,error,{...metadata,operationId,durationMs:Date.now()-started});throw error;};
      try{const value=original.apply(this,args);return value&&typeof value.then==='function'?value.then(done,failed):done(value);}catch(error){return failed(error);}
    };
    undo.push(()=>{if(own)Object.defineProperty(target,name,own);else delete (target as any)[name];});
  }
  return ()=>{for(const fn of undo)fn();};
}
