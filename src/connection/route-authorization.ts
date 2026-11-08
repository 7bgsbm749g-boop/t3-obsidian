import {isRecord} from '../shared/values';
import type {T3Api} from './t3-rpc';

/** Cache only identity and authorization setup. Each operation still reads its
 * current server state, and a failed setup never remains a usable candidate. */
export class RouteAuthorizationCache<T> {
 private entries=new Map<string,{work:Promise<T>;until:number}>();
 constructor(private now=()=>Date.now()){}
 open(key:string,create:()=>Promise<T>,force=false,validUntil=Infinity):Promise<T>{
  const current=this.entries.get(key);
  if(!force&&current&&current.until>this.now())return current.work;
  const work=Promise.resolve().then(create),entry={work,until:Math.min(this.now()+30_000,validUntil)};
  this.entries.set(key,entry);
  while(this.entries.size>16)this.entries.delete(this.entries.keys().next().value!);
  void work.catch(()=>{if(this.entries.get(key)===entry)this.entries.delete(key);});
  return work;
 }
 delete(key:string){this.entries.delete(key);}
}

/** Verify the candidate before exposing it to operations, without reading its
 * thread catalog. Older or unfamiliar session responses use the server's
 * existing scoped read, which retains its exact authorization errors. */
export async function verifyOrchestrationRead(api:T3Api):Promise<void>{
  try{
    const state=await api('/api/auth/session');
    if(isRecord(state)&&state.authenticated===true){
      const grants=state.permissions===undefined?state.scopes:state.permissions;
      if(Array.isArray(grants)&&grants.includes('orchestration:read'))return;
    }
  }catch(error){
    if(!isRecord(error)||error.status!==404)throw error;
  }
  await api('/api/orchestration/shell');
}
