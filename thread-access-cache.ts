import type {ThreadAccess,ThreadAccessCloseReason} from './thread-stream';

/** HTTP status is retained without storing response bodies or credentials. */
export class T3HttpError extends Error {
  readonly name='T3HttpError';
  constructor(readonly status:number,message:string){super(message);}
}

interface Entry {access:ThreadAccess;borrowed:ThreadAccess;expires:number;reason?:ThreadAccessCloseReason}

/** The cache owns credentials. Consumers borrow access and cannot revoke it. */
export class ThreadAccessCache {
  private entries=new Map<string,Entry>();
  private opening=new Map<string,Promise<Entry>>();
  private blocked=new Map<string,{until:number;error:unknown}>();
  private stopped=false;
  private closing?:Promise<void>;
  constructor(private createAccess:(environmentId:string,reason?:ThreadAccessCloseReason)=>Promise<ThreadAccess>,private now=Date.now){}

  async get(environmentId:string):Promise<ThreadAccess>{return (await this.acquire(environmentId)).borrowed;}

  private async acquire(environmentId:string,failed?:Entry):Promise<Entry>{
    if(this.stopped)throw Error('The response host has stopped.');
    const current=this.entries.get(environmentId);
    if(current&&current!==failed&&current.expires>this.now())return current;
    const pending=this.opening.get(environmentId);if(pending)return pending;
    const blocked=this.blocked.get(environmentId);
    if(blocked&&blocked.until>this.now())throw blocked.error;
    // Defer the factory until the shared pending promise is registered.
    const work=Promise.resolve().then(async()=>{
      const previous=this.entries.get(environmentId);
      if(previous&&previous!==failed&&previous.expires>this.now())return previous;
      const reason=previous===failed&&previous?'auth-rejected':previous?.reason;
      if(previous){
        this.entries.delete(environmentId);
        await this.close(previous.access,previous===failed?'auth-rejected':previous.reason??'cache-expired');
      }
      if(this.stopped)throw Error('The response host has stopped.');
      const access=await this.createAccess(environmentId,reason);
      if(this.stopped){await this.close(access,'late-access');throw Error('The response host has stopped.');}
      const expires=Math.min(this.now()+180_000,access.expiresAt===undefined?Infinity:access.expiresAt-5000);
      const entry:Entry={access,expires,borrowed:{
        get origin(){return access.origin;},
        api:(path,payload)=>this.request(environmentId,path,payload),
        // Stop helpers own their borrow, never the host's underlying session.
        close:reason=>access.trace?.('borrow-released',reason??'caller-closed'),
      }};
      this.entries.set(environmentId,entry);this.blocked.delete(environmentId);return entry;
    });
    this.opening.set(environmentId,work);
    try{return await work;}finally{if(this.opening.get(environmentId)===work)this.opening.delete(environmentId);}
  }

  private invalidate(environmentId:string,entry:Entry){
    if(this.entries.get(environmentId)===entry){entry.expires=0;entry.reason='auth-rejected';}
  }

  private async request(environmentId:string,path:string,payload?:any):Promise<any>{
    const entry=await this.acquire(environmentId);
    try{return await entry.access.api(path,payload);}
    catch(error){
      if(!(error instanceof T3HttpError)||error.status!==401)throw error;
      this.invalidate(environmentId,entry);
      // Reads and stream-ticket creation are safe to retry. Dispatch never is.
      if(!(payload===undefined&&!path.split('?')[0].endsWith('/dispatch')||path==='/api/auth/websocket-ticket'))throw error;
      const fresh=await this.acquire(environmentId,entry);
      try{
        const result=await fresh.access.api(path,payload);fresh.access.trace?.('recovered');return result;
      }catch(retryError){
        if(retryError instanceof T3HttpError&&retryError.status===401&&this.entries.get(environmentId)===fresh){
          this.invalidate(environmentId,fresh);this.blocked.set(environmentId,{until:this.now()+5000,error:retryError});
        }
        throw retryError;
      }
    }
  }

  private async close(access:ThreadAccess,reason:ThreadAccessCloseReason){
    try{await access.close?.(reason);}catch{/* Failed cleanup cannot prevent fresh access or release of the host lock. */}
  }

  dispose():Promise<void>{
    if(this.closing)return this.closing;
    this.stopped=true;
    this.closing=(async()=>{
      // Late factories are fenced and close their own result. They cannot hold
      // host ownership while a CLI issuance is still waiting to finish.
      await Promise.allSettled([...this.entries.values()].map(entry=>this.close(entry.access,'host-disposed')));
      this.entries.clear();this.blocked.clear();
    })();
    return this.closing;
  }
}
