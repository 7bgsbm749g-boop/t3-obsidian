import {isRecord,toError} from '../shared/values';
import {connectT3Rpc} from '../connection/t3-rpc';
import type {ThreadAccess} from './thread-stream';

export const OBSIDIAN_THREAD_TAG='t3-obsidian';
export const threadHiding=(value:unknown):boolean|undefined=>typeof value==='boolean'?value:undefined;
export interface ThreadTagJob {id:string;threadId:string;projectId:string;environmentId:string}
interface VisibilityStore {load():unknown;save(jobs:ThreadTagJob[]):void}
interface VisibilityRequest {access:ThreadAccess;enabled:boolean;credentialKey:string;force:boolean}
interface VisibilityWork {promise:Promise<void>;next?:VisibilityRequest}

/** Optional server metadata changes never dispatch prompts or edit local files. */
export class ThreadVisibility {
  private jobs:ThreadTagJob[]=[];
  private configured=new Map<string,boolean>();
  private work=new Map<string,VisibilityWork>();
  private stopped=false;
  constructor(private store:VisibilityStore){
    const saved=store.load();
    if(Array.isArray(saved))this.jobs=saved.slice(0,1000).filter((job):job is ThreadTagJob=>isRecord(job)&&['id','threadId','projectId','environmentId'].every(key=>typeof job[key]==='string'&&job[key]));
  }
  queue(job:ThreadTagJob){
    if(this.stopped||this.jobs.some(item=>item.id===job.id&&item.environmentId===job.environmentId))return;
    if(this.jobs.length>=1000)throw Error('Too many pending thread tags. Connect T3 before creating more hidden threads.');
    this.jobs.push(job);this.store.save(this.jobs);
  }
  discard(id:string){
    const remaining=this.jobs.filter(job=>job.id!==id);
    if(remaining.length===this.jobs.length)return;
    this.store.save(remaining);this.jobs=remaining;
  }
  apply(access:ThreadAccess,environmentId:string,enabled:boolean,credentialKey:string,force=false):Promise<void>{
    if(this.stopped)return Promise.resolve();
    const pending=this.work.get(environmentId);
    if(pending){
      // Keep the latest preference/access, but retain any queued reconnect repair.
      pending.next={access,enabled,credentialKey,force:force||pending.next?.force===true};return pending.promise;
    }
    const key=JSON.stringify([environmentId,credentialKey]);
    if(!force&&this.configured.get(key)===enabled&&!this.jobs.some(job=>job.environmentId===environmentId))return Promise.resolve();
    const work:VisibilityWork={promise:Promise.resolve(),next:{access,enabled,credentialKey,force}};
    work.promise=this.flush(environmentId,work).finally(()=>{if(this.work.get(environmentId)===work)this.work.delete(environmentId);});
    this.work.set(environmentId,work);return work.promise;
  }
  private async flush(environmentId:string,work:VisibilityWork){
    let failure:Error|undefined;
    while(work.next&&!this.stopped){
      const {access,enabled,credentialKey,force}=work.next;work.next=undefined;
      const key=JSON.stringify([environmentId,credentialKey]);
      if(!force&&this.configured.get(key)===enabled&&!this.jobs.some(job=>job.environmentId===environmentId))continue;
      try{await this.update(access,environmentId,enabled,key,force);failure=undefined;}catch(error){failure=toError(error);}
    }
    if(failure)throw failure;
  }
  private async update(access:ThreadAccess,environmentId:string,enabled:boolean,key:string,force:boolean){
    const discarded=!enabled?new Set(this.jobs.filter(job=>job.environmentId===environmentId)):undefined;
    const rpc=await connectT3Rpc(access.api,access.origin);
    try{
      if(this.stopped)return;
      if(force||this.configured.get(key)!==enabled){
        const read=async()=>{const config=await rpc.call('server.getConfig',{});if(!isRecord(config)||!isRecord(config.settings)||!Array.isArray(config.settings.hiddenThreadTags)||!config.settings.hiddenThreadTags.every(tag=>typeof tag==='string')||typeof config.settings.hideTaggedThreads!=='boolean')throw Error('Update this T3 server to use thread hiding.');return config.settings as {hiddenThreadTags:string[];hideTaggedThreads:boolean};};
        const settings=await read();if(this.stopped)return;
        const tags=enabled?(settings.hiddenThreadTags.includes(OBSIDIAN_THREAD_TAG)?[...settings.hiddenThreadTags]:[...settings.hiddenThreadTags,OBSIDIAN_THREAD_TAG]):settings.hiddenThreadTags.filter(tag=>tag.trim()!==OBSIDIAN_THREAD_TAG);
        if(JSON.stringify(tags)!==JSON.stringify(settings.hiddenThreadTags)||enabled&&!settings.hideTaggedThreads){
          await rpc.call('server.updateSettings',{patch:{hiddenThreadTags:tags,...(enabled?{hideTaggedThreads:true}:{})}});
          const after=await read();
          if(enabled?(!after.hideTaggedThreads||!after.hiddenThreadTags.includes(OBSIDIAN_THREAD_TAG)):after.hiddenThreadTags.some(tag=>tag.trim()===OBSIDIAN_THREAD_TAG))throw Error('T3 did not confirm its thread visibility setting.');
        }
        this.configured.set(key,enabled);while(this.configured.size>32)this.configured.delete(this.configured.keys().next().value!);
      }
      if(this.stopped)return;
      if(!enabled){this.jobs=this.jobs.filter(job=>!discarded!.has(job));this.store.save(this.jobs);return;}
      const failures:Error[]=[];
      for(const job of this.jobs.filter(job=>job.environmentId===environmentId)){
        if(this.stopped)return;
        try{
          const result=await rpc.call('orchestration.getThreadFamily',{threadId:job.threadId});
          if(!isRecord(result)||!Array.isArray(result.threads)||!result.threads.some(thread=>isRecord(thread)&&thread.id===job.threadId&&thread.projectId===job.projectId))throw Error('Waiting for the original Obsidian thread.');
          if(this.stopped)return;
          await rpc.call('orchestration.dispatchCommand',{type:'thread.tag.set',commandId:job.id,threadId:job.threadId,tag:OBSIDIAN_THREAD_TAG,tagged:true});
          this.jobs=this.jobs.filter(item=>item!==job);this.store.save(this.jobs);
        }catch(error){failures.push(toError(error));}
      }
      if(failures.length)throw Error(`${failures.length} thread tag(s) remain pending: ${failures[0].message}`);
    }finally{rpc.close();}
  }
  dispose(){this.stopped=true;}
}
