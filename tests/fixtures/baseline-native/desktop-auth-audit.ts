// Historical test/lab adapter only. Never import this file from src or ship it in the plugin.
import {Platform} from 'obsidian';
let fs:typeof import('node:fs').promises;
let join:typeof import('node:path').join;
let desktopReady:Promise<void>|undefined;
function loadDesktop():Promise<void>{
  if(Platform.isDesktop){
    return desktopReady??=(async()=>{
    ({promises:fs}=await import('node:fs'));
    const nativePath=await import('node:path');
    join=nativePath.join.bind(nativePath);
    })();
  }
  throw Error('This feature requires Obsidian on desktop.');
}
import {errorCode} from '../../../src/shared/values';

import type {ThreadAccessCloseReason} from '../../../src/conversations/thread-stream';

export const DESKTOP_AUTH_AUDIT_MAX_BYTES=256*1024;
type AuthEvent='issued'|'verified'|'rejected'|'closing'|'revoke-completed'|'revoke-failed'|'borrow-released'|'recovered';
export interface DesktopAuthRecord {
  event:AuthEvent;sessionId:string;component:'response-host'|'thread-reader';
  issuedAt:number;expiresAt?:number;reason?:ThreadAccessCloseReason;caller?:string[];
}
const queues=new Map<string,Promise<void>>();

/** Small, event-driven local auth audit; no vault writes, timers, or Sync. */
export async function recordDesktopAuth(baseDir:string,record:DesktopAuthRecord):Promise<void>{
  await loadDesktop();
  const directory=join(baseDir,'userdata','logs'),path=join(directory,'obsidian-stream-auth.jsonl');
  const at=Date.now();
  // Allowlisted fields only. Never accept a request, response, token, or URL.
  const line=JSON.stringify({at:new Date(at).toISOString(),event:record.event,sessionId:record.sessionId,component:record.component,
    issuedAt:new Date(record.issuedAt).toISOString(),...(record.expiresAt===undefined?{}:{expiresAt:new Date(record.expiresAt).toISOString()}),
    ageMs:Math.max(0,at-record.issuedAt),...(record.reason?{reason:record.reason}:{}),...(record.caller?{caller:record.caller.slice(0,5).map(frame=>frame.slice(0,240))}:{})})+'\n';
  const work=(queues.get(path)??Promise.resolve()).then(async()=>{
    await fs.mkdir(directory,{recursive:true,mode:0o700});
    const size=await fs.stat(path).then(stat=>stat.size).catch(()=>0);
    if(size+Buffer.byteLength(line)>DESKTOP_AUTH_AUDIT_MAX_BYTES){
      await fs.rename(path,path+'.1').catch((error:unknown)=>{if(errorCode(error)!=='ENOENT')throw error;});
    }
    await fs.appendFile(path,line,{mode:0o600});
  }).catch(()=>{/* Audit availability never changes delivery or credential cleanup. */});
  queues.set(path,work);void work.finally(()=>{if(queues.get(path)===work)queues.delete(path);});return work;
}
