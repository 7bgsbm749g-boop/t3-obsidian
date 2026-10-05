import {setTimeout,clearTimeout} from 'node:timers';
import type {LeaseFiles} from './inline-lease';

export interface AuthorityStorageStatus {
  pendingCount:number;
  pending:Array<{operation:string;path:string;elapsedMs:number}>;
  timeouts:number;
  lastTimeout?:{operation:string;path:string;at:string};
}

/** Reads have no authority to mutate durable state. A lost read callback may
 * therefore be abandoned; its late result must never resume an old scan.
 * Mutations retain their original promises and are always drained under the
 * host lock. Timing out a write and releasing ownership would be unsafe. */
export function interruptibleAuthorityFiles(files:LeaseFiles,timeoutMs=2000){
  let stopped=false;
  const pending=new Set<()=>void>();
  const operations=new Set<{operation:string;path:string;started:number}>();
  let timeouts=0,lastTimeout:AuthorityStorageStatus['lastTimeout'];
  const observed=<T>(operation:string,path:string,run:()=>Promise<T>)=>{
    const item={operation,path,started:performance.now()};operations.add(item);
    const work=Promise.resolve().then(run);
    return work.finally(()=>operations.delete(item));
  };
  const read=<T>(kind:string,path:string,run:()=>Promise<T>):Promise<T>=>{
    if(stopped)return Promise.reject(Error('Host authority stopped.'));
    return new Promise<T>((resolve,reject)=>{
      let done=false;
      const finish=(error:Error|undefined,value?:T)=>{
        if(done)return;done=true;clearTimeout(timer);pending.delete(cancel);
        if(error)reject(error);else resolve(value!);
      };
      const cancel=()=>finish(Error('Host authority stopped.'));
      const timer=setTimeout(()=>{
        timeouts++;lastTimeout={operation:kind,path,at:new Date().toISOString()};
        finish(Error(`Response authority ${kind} timed out; retrying durable work.`));
      },timeoutMs);
      pending.add(cancel);
      Promise.resolve().then(run).then(value=>finish(undefined,value),error=>finish(error));
    });
  };
  return {
    files:{...files,
      read:(path:string)=>observed('read',path,()=>read('read',path,()=>files.read(path))),
      list:(path:string)=>observed('list',path,()=>read('list',path,()=>files.list(path))),
      write:(path:string,value:string)=>observed('write',path,()=>files.write(path,value)),
      remove:(path:string)=>observed('remove',path,()=>files.remove(path)),
    } satisfies LeaseFiles,
    status():AuthorityStorageStatus{return {pendingCount:operations.size,pending:[...operations].slice(0,4).map(({operation,path,started})=>({operation,path,elapsedMs:Math.max(0,Math.round(performance.now()-started))})),timeouts,...(lastTimeout?{lastTimeout}: {})};},
    stop(){stopped=true;for(const cancel of [...pending])cancel();},
  };
}
