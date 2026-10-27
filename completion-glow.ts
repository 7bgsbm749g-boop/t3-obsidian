import type {CompletionSource,ExplorerResponse,NoteIndicator} from './explorer-responses';
import type {ResponseRequest} from './response-model';
import type {ThreadAccess,ThreadAccessCloseReason} from './thread-stream';
import {ThreadAccessCache} from './thread-access-cache';

export interface CompletionReceipt {id:string;completionId:string;notePath:string;completion?:CompletionSource;deleted?:boolean}
interface ThreadReadState {id:string;projectId:string;lastVisitedAt?:string;latestRunId?:string;latestRunCompletedAt?:string;status?:string}
interface EnvironmentRead {threads:Map<string,ThreadReadState>;nextRead:number;work?:Promise<void>}
interface Viewing {path:string;since:number;acknowledged:Set<string>;commands:Map<string,{type:'thread.visit';commandId:string;threadId:string;visitedAt:string}>}
export interface CompletionGlowIO {
  access(environmentId:string,reason?:ThreadAccessCloseReason):Promise<ThreadAccess>;
  changed():void;
}
export const COMPLETION_READ_INTERVAL_MS=15_000;
const timestamp=(value:unknown)=>typeof value==='string'?Date.parse(value):NaN;
const validSource=(value:any):value is CompletionSource=>value&&['environmentId','projectId','threadId','runId'].every(key=>typeof value[key]==='string'&&value[key].length>0)&&
  (value.completedAt===undefined||Number.isFinite(timestamp(value.completedAt)));
const threadKey=(source:CompletionSource)=>JSON.stringify([source.environmentId,source.projectId,source.threadId]);
const completionKey=(receipt:CompletionReceipt)=>JSON.stringify([receipt.id,receipt.completionId]);

/** Receipts retain note/run identity only. T3 owns every read watermark. */
export class CompletionGlow {
  private receipts=new Map<string,CompletionReceipt>();
  private viewing?:Viewing;
  private environments=new Map<string,EnvironmentRead>();
  private access:ThreadAccessCache;
  private visiting=false;
  private retryAt=0;
  private stopped=false;
  constructor(saved:unknown,private save:(receipts:CompletionReceipt[])=>void,private io:CompletionGlowIO,private now=Date.now){
    this.access=new ThreadAccessCache(io.access,now);
    if(Array.isArray(saved))for(const value of saved)if(value&&typeof value.id==='string'&&typeof value.completionId==='string'&&typeof value.notePath==='string'&&(value.deleted===undefined||typeof value.deleted==='boolean')){
      // Discard the retired device-local viewed bit, including on migration.
      this.receipts.set(value.id,{id:value.id,completionId:value.completionId,notePath:value.notePath,
        ...(validSource(value.completion)?{completion:{...value.completion}}:{}),...(value.deleted?{deleted:true}:{})});
    }
  }
  private persist(){this.save([...this.receipts.values()]);}
  observe(responses:ExplorerResponse[],bindings:readonly ResponseRequest[]=[]):void {
    if(this.stopped)return;
    let changed=false;
    for(const response of responses){
      if(response.deleted||!response.complete||response.active||response.input)continue;
      const completionId=response.completionId??response.id,old=this.receipts.get(response.id);
      const completion=validSource(response.completion)?response.completion:undefined;
      if(old?.completionId===completionId){
        if(completion){
          const next={...completion};
          if(!next.completedAt&&old.completion?.completedAt&&threadKey(next)===threadKey(old.completion)&&next.runId===old.completion.runId)next.completedAt=old.completion.completedAt;
          if(JSON.stringify(next)!==JSON.stringify(old.completion)){old.completion=next;changed=true;}
        }
        continue;
      }
      this.receipts.set(response.id,{id:response.id,completionId,notePath:response.notePath,...(completion?{completion:{...completion}}:{})});changed=true;
      if(this.viewing?.path===response.notePath)this.viewing=undefined;
    }
    // Old receipts retain exact message/run IDs. Recover their connection from
    // the existing binding; never infer a run from a note title or its age.
    const requests=new Map(bindings.map(request=>[request.id,request]));
    for(const receipt of this.receipts.values())if(!receipt.deleted&&!receipt.completion){
      const request=requests.get(receipt.id);if(!request)continue;
      try{
        const [messageId,runId]=JSON.parse(receipt.completionId);
        if(![request.messageId,request.localMessageId,...request.localSteering?.map(input=>input.messageId)??[]].includes(messageId))continue;
        const source={environmentId:request.threadEnvironmentId,projectId:request.projectId,threadId:request.threadId,runId};
        if(validSource(source)){receipt.completion=source;changed=true;}
      }catch{/* An old receipt without exact identity cannot mark a thread read. */}
    }
    if(changed)this.persist();
    void this.refresh();
  }
  private state(receipt:CompletionReceipt){
    const source=receipt.completion;if(!source)return;
    const state=this.environments.get(source.environmentId)?.threads.get(source.threadId);
    return state?.projectId===source.projectId&&Number.isFinite(timestamp(state.lastVisitedAt))?state:undefined;
  }
  private unread(receipt:CompletionReceipt){
    const state=this.state(receipt);
    return !receipt.deleted&&!!state&&timestamp(receipt.completion?.completedAt)>timestamp(state.lastVisitedAt);
  }
  private async read(environmentId:string,force=false):Promise<void>{
    let entry=this.environments.get(environmentId);
    if(!entry){entry={threads:new Map(),nextRead:0};this.environments.set(environmentId,entry);}
    if(entry.work){const previous=entry.work;await previous;if(!force||this.stopped)return;if(entry.work&&entry.work!==previous){await entry.work;return;}}
    if(this.stopped||!force&&this.now()<entry.nextRead)return;
    entry.nextRead=this.now()+COMPLETION_READ_INTERVAL_MS;
    const current=entry;
    const work=Promise.resolve().then(async()=>{
      const access=await this.access.get(environmentId);
      const shell=await access.api('/api/orchestration/shell');
      if(!Array.isArray(shell?.threads))throw Error('T3 did not return thread read state.');
      if(this.stopped)return;
      const sources=[...this.receipts.values()].filter(receipt=>!receipt.deleted&&receipt.completion?.environmentId===environmentId);
      const ids=new Set(sources.map(receipt=>receipt.completion!.threadId));
      // Keep no transcript or unrelated thread metadata after this read.
      current.threads=new Map(shell.threads.filter((thread:any)=>ids.has(thread.id)).map((thread:any)=>[thread.id,{
        id:thread.id,projectId:thread.projectId,lastVisitedAt:thread.lastVisitedAt,
        latestRunId:thread.latestRunId,latestRunCompletedAt:thread.latestRunCompletedAt,status:thread.status,
      }]));
      let changed=false;
      for(const receipt of sources){
        const source=receipt.completion!,state=this.state(receipt);
        if(!source.completedAt&&state?.latestRunId===source.runId&&state.status==='completed'&&Number.isFinite(timestamp(state.latestRunCompletedAt))){source.completedAt=state.latestRunCompletedAt;changed=true;}
      }
      if(changed)this.persist();
      this.io.changed();
    }).catch(()=>{/* Keep the last confirmed server state. Offline is never a local read receipt. */});
    current.work=work;try{await work;}finally{if(current.work===work)current.work=undefined;}
  }
  /** At most one small shell read per machine per interval, shared by all notes. */
  async refresh(force=false):Promise<void>{
    const environments=new Set([...this.receipts.values()].filter(receipt=>!receipt.deleted&&receipt.completion).map(receipt=>receipt.completion!.environmentId));
    // Sequential reads bound work when several saved machines are offline.
    for(const environmentId of environments){if(this.stopped)return;await this.read(environmentId,force);}
  }
  /** Only a focused, visible note counts; background tabs never acknowledge. */
  view(path:string|undefined,now=this.now()):void {
    if(this.stopped)return;
    if(!path){this.viewing=undefined;return;}
    if(this.viewing?.path!==path){this.viewing={path,since:now,acknowledged:new Set(),commands:new Map()};return;}
    if(now-this.viewing.since<750)return;
    if(!this.visiting&&this.now()>=this.retryAt)void this.visit(this.viewing);
  }
  private async visit(view:Viewing){
    this.visiting=true;
    try{
      // A note can show several runs of one thread. Acknowledge only the newest
      // bound completion actually displayed here, once for each thread.
      const selected=new Map<string,CompletionReceipt>();
      for(const receipt of this.receipts.values())if(receipt.notePath===view.path&&this.unread(receipt)&&!view.acknowledged.has(completionKey(receipt))){
        const key=threadKey(receipt.completion!),old=selected.get(key);
        if(!old||timestamp(receipt.completion!.completedAt)>timestamp(old.completion!.completedAt))selected.set(key,receipt);
      }
      for(const receipt of selected.values()){
        if(this.stopped||this.viewing!==view)return;
        const source=receipt.completion!,visitedAt=source.completedAt!;
        const access=await this.access.get(source.environmentId);
        if(this.stopped||this.viewing!==view||this.receipts.get(receipt.id)!==receipt||receipt.deleted||!this.unread(receipt))continue;
        const key=JSON.stringify([threadKey(source),visitedAt]);
        let command=view.commands.get(key);
        if(!command){command={type:'thread.visit',commandId:crypto.randomUUID(),threadId:source.threadId,visitedAt};view.commands.set(key,command);}
        await access.api('/api/orchestration/dispatch',command);
        if(this.stopped)return;
        // Do not re-visit an explicit mark-unread while this same note remains
        // focused. A new completion, note switch or focus starts another visit.
        for(const other of this.receipts.values())if(other.notePath===view.path&&other.completion&&threadKey(other.completion)===threadKey(source)&&timestamp(other.completion.completedAt)<=timestamp(visitedAt))view.acknowledged.add(completionKey(other));
        // Dispatch acknowledgement is not read-state evidence. Re-read after
        // any older in-flight read; only confirmed server state clears a glow.
        await this.read(source.environmentId,true);
      }
    }catch{this.retryAt=this.now()+COMPLETION_READ_INTERVAL_MS;}
    finally{this.visiting=false;}
  }
  project(notes:Map<string,NoteIndicator>,exists:(path:string)=>boolean):Map<string,NoteIndicator> {
    const result=new Map(notes);
    for(const receipt of this.receipts.values())if(this.unread(receipt)&&exists(receipt.notePath)){
      const note=result.get(receipt.notePath)??{active:0,input:0,complete:1,total:1};
      result.set(receipt.notePath,{...note,unread:(note.unread??0)+1});
    }
    return result;
  }
  relocate(before:string,after?:string):void {
    let changed=false;
    for(const receipt of this.receipts.values())if(receipt.notePath===before||receipt.notePath.startsWith(before+'/')){
      if(after===undefined)receipt.deleted=true;
      else receipt.notePath=after+receipt.notePath.slice(before.length);
      changed=true;
    }
    if(changed)this.persist();
  }
  dispose(){this.stopped=true;this.viewing=undefined;this.environments.clear();void this.access.dispose();}
}

export function unreadCompletionFolders(notes:Map<string,NoteIndicator>):Set<string> {
  const folders=new Set<string>();
  for(const [path,note] of notes)if(note.unread){
    let at=path.lastIndexOf('/');
    while(at>0){folders.add(path.slice(0,at));at=path.lastIndexOf('/',at-1);}
  }
  return folders;
}
