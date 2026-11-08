import {openStateDatabase} from '../storage/local-state';
import {contentHash} from '../responses/completion';
import {redact,validEvent,type DiagnosticEvent} from './diagnostics';
import type {CommandFiles} from '../notes/connect-command-host';

const PAGE_EVENTS=32,UPLOAD_PAGES=4,UPLOAD_INTERVAL_MS=5000;
interface Page {path:string;events:DiagnosticEvent[];revision:number}
interface Pending {page:string;revision:number}
interface Counts {events:number;pages:number}
export interface DiagnosticLogTarget {environmentId:string;workspaceRoot:string;directory:string}
/** Unlimited retained history on disk; fixed-size pages, never a full-history
 * read/rewrite. T3's existing file RPCs materialize ordinary JSONL automatically. */
export class DiagnosticArchive {
  private prefix:string;
  private opening?:Promise<IDBDatabase>;
  private writes=new Set<Promise<void>>();
  private uploading?:Promise<void>;
  private uploadAt=-Infinity;
  private stopped=false;
  private manifestDirty=true;
  private localError='';private remoteError='';
  private target?:DiagnosticLogTarget;
  private counts:Counts={events:0,pages:0};
  constructor(vaultId:string,deviceId:string,private open=openStateDatabase,private now=()=>Date.now()){
    this.prefix=`diagnostic-archive-v1:${vaultId}:${deviceId}:`;
  }
  private db(){if(this.opening)return this.opening;const opening=this.open();this.opening=opening;void opening.catch(()=>{if(this.opening===opening)this.opening=undefined;});return opening;}
  private error(error:unknown){return JSON.stringify(redact(error));}
  record(event:DiagnosticEvent){
    if(this.stopped||!validEvent(event)||event.sequence<1)return;
    const work=this.append({...event,fields:redact(event.fields) as Record<string,unknown>});this.writes.add(work);
    void work.then(()=>{this.localError='';},error=>{this.localError=this.error(error);}).finally(()=>this.writes.delete(work));
  }
  private async append(event:DiagnosticEvent){
    const db=await this.db(),pageNumber=Math.floor((event.sequence-1)/PAGE_EVENTS),day=new Date(event.at).toISOString().slice(0,10);
    const suffix=`${day}/${contentHash(event.sessionId)}-${String(pageNumber).padStart(12,'0')}.jsonl`,page=this.prefix+'page:'+suffix;
    await new Promise<void>((resolve,reject)=>{
      const tx=db.transaction('devices','readwrite'),store=tx.objectStore('devices'),read=store.get(page),meta=store.get(this.prefix+'counts');
      let old:Page|undefined,counts:Counts|undefined,ready=0;
      const put=()=>{
        if(++ready!==2)return;
        const events=old?.events??[],exists=events.some(item=>item.sessionId===event.sessionId&&item.sequence===event.sequence);
        if(exists){this.counts=counts??{events:0,pages:0};return;}
        events.push(event);events.sort((a,b)=>a.sequence-b.sequence);
        const revision=Math.max(old?.revision??0,event.sequence),value:Page={path:suffix,events,revision};
        store.put(value,page);store.put({page,revision} satisfies Pending,this.prefix+'pending:'+suffix);
        this.counts={events:(counts?.events??0)+1,pages:(counts?.pages??0)+Number(!old)};store.put(this.counts,this.prefix+'counts');
      };
      read.onsuccess=()=>{old=read.result as Page|undefined;put();};meta.onsuccess=()=>{counts=meta.result as Counts|undefined;put();};
      tx.oncomplete=()=>resolve();tx.onabort=tx.onerror=()=>reject(Error('Cannot retain diagnostic history on this device.'));
    });
  }
  async settle(){await Promise.allSettled([...this.writes]);}
  private async pending(){
    const db=await this.db(),prefix=this.prefix+'pending:';
    return new Promise<Array<{key:IDBValidKey;pending:Pending;page:Page}>>((resolve,reject)=>{
      const tx=db.transaction('devices','readonly'),store=tx.objectStore('devices'),items:Array<{key:IDBValidKey;pending:Pending;page:Page}>=[];
      const request=store.openCursor(IDBKeyRange.bound(prefix,prefix+'\uffff'));
      request.onsuccess=()=>{
        const cursor=request.result;if(!cursor||items.length>=UPLOAD_PAGES)return;
        const pending=cursor.value as Pending,key=cursor.key,read=store.get(pending.page);
        read.onsuccess=()=>{if(read.result)items.push({key,pending,page:read.result as Page});cursor.continue();};
      };
      tx.oncomplete=()=>resolve(items);tx.onabort=tx.onerror=()=>reject(Error('Cannot read retained diagnostic pages.'));
    });
  }
  private async acknowledge(key:IDBValidKey,revision:number){
    const db=await this.db();await new Promise<void>((resolve,reject)=>{
      const tx=db.transaction('devices','readwrite'),store=tx.objectStore('devices'),read=store.get(key);
      read.onsuccess=()=>{if((read.result as Pending|undefined)?.revision===revision)store.delete(key);};
      tx.oncomplete=()=>resolve();tx.onabort=tx.onerror=()=>reject(Error('Cannot confirm diagnostic file delivery.'));
    });
  }
  /** Called by the existing connection tick, never a new timer. Network
   * outages leave every page on disk. Retry overwrites the same page path. */
  sync(files:CommandFiles,target:DiagnosticLogTarget){
    if(this.stopped||this.uploading||this.now()-this.uploadAt<UPLOAD_INTERVAL_MS)return this.uploading??Promise.resolve();
    if(this.target&&(this.target.environmentId!==target.environmentId||this.target.workspaceRoot!==target.workspaceRoot))return Promise.resolve();
    this.target=target;this.uploadAt=this.now();
    const work=this.upload(files,target).catch(error=>{this.remoteError=this.error(error);throw error;}).finally(()=>{if(this.uploading===work)this.uploading=undefined;});
    this.uploading=work;void work.catch(()=>{});return work;
  }
  private async upload(files:CommandFiles,target:DiagnosticLogTarget){
    await this.settle();const pages=await this.pending();
    for(const item of pages){
      if(this.stopped)return;
      await files.write(target.directory+'/'+item.page.path,item.page.events.map(event=>JSON.stringify(event)).join('\n')+'\n');
      await this.acknowledge(item.key,item.pending.revision);this.manifestDirty=true;
    }
    const db=await this.db();await new Promise<void>((resolve,reject)=>{
      const tx=db.transaction('devices','readonly'),read=tx.objectStore('devices').get(this.prefix+'counts');read.onsuccess=()=>{this.counts=(read.result as Counts|undefined)??this.counts;};tx.oncomplete=()=>resolve();tx.onabort=tx.onerror=()=>reject(Error('Cannot read diagnostic log counts.'));
    });
    if(this.manifestDirty){await files.write(target.directory+'/log.json',JSON.stringify({...this.status(),fileError:'',updatedAt:new Date(this.now()).toISOString()},null,2)+'\n');this.manifestDirty=false;}
    this.remoteError='';
  }
  status(){return {format:'jsonl',retention:'until-user-deletes',...this.target,storedEvents:this.counts.events,storedPages:this.counts.pages,localError:this.localError,fileError:this.remoteError,pendingWrites:this.writes.size};}
  async close(){this.stopped=true;await this.settle();await this.uploading?.catch(()=>{});if(this.opening)(await this.opening).close();}
}
