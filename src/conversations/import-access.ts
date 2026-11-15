import {abortableRead,requestAborted} from '../connection/t3-api';
import type {ThreadAccess,ThreadAccessCloseReason} from './thread-stream';

/** Abandon a caller's read without cancelling shared connection setup. Release
 * its access even when setup finishes after the caller has stopped waiting. */
export async function readImportAccess<T>(open:()=>Promise<ThreadAccess>,read:(access:ThreadAccess)=>Promise<T>,signal?:AbortSignal):Promise<T>{
  requestAborted(signal);
  let access:ThreadAccess|undefined,finished=false,closed=false;
  const close=(reason:ThreadAccessCloseReason)=>{if(!access||closed)return;closed=true;return access.close?.(reason);};
  const opening=open().then(ready=>{
    access=ready;
    if(finished||signal?.aborted){void Promise.resolve().then(()=>close('late-access')).catch(()=>{});requestAborted(signal);}
    return ready;
  });
  try{
    const ready=await abortableRead(opening,signal);requestAborted(signal);
    return await abortableRead(read(ready),signal);
  }finally{finished=true;await close('caller-closed');}
}
