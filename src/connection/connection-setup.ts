import {scheduleTimeout,cancelTimeout} from '../shared/clock';
import {abortableRead,requestAborted} from './t3-api';
import type {Fetcher} from './direct';

export const CONNECTION_SETUP_MS=8000;
export type SessionSetupStage='account-credential'|'machine-discovery'|'proof-key'|'relay-token'|'relay-connect'|'descriptor'|'environment-token'|'save-session';

export class ConnectionSetupTimeout extends Error {
 constructor(readonly stage?:SessionSetupStage){
  super('T3 connection setup timed out. Try another route or check the connection.');
 }
}
/** Only establishment is bounded here. A deadline never replays an operation
 * or establishes whether a dispatched mutation was accepted. */
export async function connectionDeadline<T>(open:(signal:AbortSignal)=>Promise<T>,parent?:AbortSignal,stage?:()=>SessionSetupStage):Promise<T>{
 const controller=new AbortController(),cancel=()=>controller.abort(parent?.reason);
 if(parent?.aborted)cancel();else parent?.addEventListener('abort',cancel,{once:true});
 const timer=scheduleTimeout(()=>controller.abort(new ConnectionSetupTimeout(stage?.())),CONNECTION_SETUP_MS);
 try{requestAborted(controller.signal);return await abortableRead(Promise.resolve().then(()=>{requestAborted(controller.signal);return open(controller.signal);}),controller.signal);}
 finally{cancelTimeout(timer);parent?.removeEventListener('abort',cancel);}
}
/** Native HTTP may ignore cancellation. Reject its late response before token
 * rotation, parsing or another exchange. Used only for small setup responses. */
export function setupFetcher(fetcher:Fetcher,signal:AbortSignal):Fetcher{
 return async(input,options)=>{
  requestAborted(signal);
  const response=await abortableRead(fetcher(input,{...options,signal}),signal);
  const text=await abortableRead(response.text(),signal);
  requestAborted(signal);return new Response(text,{status:response.status,statusText:response.statusText,headers:response.headers});
 };
}

/** Activity bursts share one preparation. Failures cool down until a later
 * activity event; this schedules no refresh timer or background loop. */
export class ConnectionPreparation {
 private work?:Promise<void>;
 private next=0;
 constructor(private now=()=>Date.now()){}
 prepare(run:()=>Promise<void>):Promise<void>{
  if(this.work)return this.work;
  if(this.now()<this.next)return Promise.resolve();
  this.next=this.now()+30_000;
  const work=Promise.resolve().then(run).finally(()=>{if(this.work===work)this.work=undefined;});
  this.work=work;return work;
 }
}
