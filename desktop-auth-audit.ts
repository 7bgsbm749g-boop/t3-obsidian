import {promises as fs} from 'node:fs';
import {join} from 'node:path';
import type {ThreadAccessCloseReason} from './thread-stream';

export const DESKTOP_AUTH_AUDIT_MAX_BYTES=256*1024;
type AuthEvent='issued'|'rejected'|'closing'|'revoke-completed'|'revoke-failed'|'borrow-released'|'recovered';
export interface DesktopAuthRecord {
  event:AuthEvent;sessionId:string;component:'response-host'|'thread-reader';
  issuedAt:number;expiresAt?:number;reason?:ThreadAccessCloseReason;caller?:string[];
}
const queues=new Map<string,Promise<void>>();

/** Small, event-driven local auth audit; no vault writes, timers, or Sync. */
export function recordDesktopAuth(baseDir:string,record:DesktopAuthRecord):Promise<void>{
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
      await fs.rename(path,path+'.1').catch((error:any)=>{if(error.code!=='ENOENT')throw error;});
    }
    await fs.appendFile(path,line,{mode:0o600});
  }).catch(()=>{/* Audit availability never changes delivery or credential cleanup. */});
  queues.set(path,work);void work.finally(()=>{if(queues.get(path)===work)queues.delete(path);});return work;
}
