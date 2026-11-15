import {watchThread,readInlineSnapshot,type InlineHistoryTargets,type ThreadAccess,type ThreadStreamCallbacks} from './thread-stream';
import type {ThreadStreamItem} from '../connection/thread-events';
import {scheduleTimeout,cancelTimeout} from '../shared/clock';
import {logEvent,logFailure} from '../app/diagnostics';
import {streamMemory} from '../app/stream-memory-diagnostics';
import {responseTooLarge} from '../connection/t3-response-limits';
import {applyThreadItem} from './inline-thread';
import {isRecord} from '../shared/values';
import {contentHash} from '../responses/completion';

/** JSON object key order is not a thread change. Missing optional fields and
 * undefined fields are equivalent; array order and actual values are not. */
function sameThreadValue(a:unknown,b:unknown):boolean {
  if(a===b)return true;
  if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((value,index)=>sameThreadValue(value,b[index]));
  if(isRecord(a)&&isRecord(b))return [...new Set([...Object.keys(a),...Object.keys(b)])].every(key=>sameThreadValue(a[key],b[key]));
  return false;
}
function replayState(snapshot:ThreadStreamItem,events:ThreadStreamItem[]){
  let state=applyThreadItem({messages:[],activities:[]},snapshot).state;
  for(const event of events)state=applyThreadItem(state,event).state;
  return state;
}
/** Retain 64 characters of comparison evidence when replay text is evicted.
 * Local binding checkpoints and global cursors are not canonical content. */
function threadFingerprint(state:ReturnType<typeof replayState>){
  const {sequence,bindings,starts,inputBoundaries,inputTurns,failedContinuations,...content}=state;
  return contentHash(JSON.stringify(content,(_key,value:unknown)=>isRecord(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))):value));
}

type Watch=typeof watchThread;
type Reader={callbacks:ThreadStreamCallbacks;targets?:()=>InlineHistoryTargets;replay?:Parameters<Watch>[5];completed:boolean;priority:()=>number};
type Source={acknowledgement?:string;key:string;threadId:string;access:Parameters<Watch>[1];readers:Set<Reader>;watch?:ReturnType<Watch>;snapshot?:ThreadStreamItem;events:ThreadStreamItem[];characters:number;comparison?:string;comparisonDirty?:boolean;slot?:()=>void;refresh?:Promise<void>;started:boolean;retry?:ReturnType<typeof scheduleTimeout>;attempt?:number;refreshAgain?:boolean;controller?:AbortController;freshAt:number;sequence:number;retryAt:number;readAt?:number;expire?:()=>void;refreshWanted?:boolean;recovery?:boolean;fatal?:boolean};

/** One source connection per authenticated environment/project/thread. Each
 * consumer still owns its exact run binding, projection and final save. */
export class SharedThreadStreams {
  private sources=new Map<string,Source>();
  private pending:Source[]=[];
  private opening=0;
  private refreshing=0;
  private stopped=false;
  private reads=new WeakMap<ThreadAccess['api'],Map<string,Promise<unknown>>>();
  private scopedReads=new Map<string,Map<string,Promise<unknown>>>();
  constructor(private watch:Watch=watchThread,private maxOpening=2,private now=()=>Date.now()){}

  access=async(factory:()=>Promise<ThreadAccess>,scope?:string):Promise<ThreadAccess>=>{
    const access=await factory(),api=access.api,scopeKey=scope?JSON.stringify([scope,access.origin,access.diagnosticRoute?.routeId]):undefined;
    const routed:ThreadAccess['api']=(path,payload,options)=>{
      // Signals remain owned by their caller. Never combine cancellable reads,
      // dispatches, decisions, tickets or credential mutations.
      if(options?.signal||options?.continueHistory||!(payload===undefined&&path.startsWith('/api/orchestration/threads/')||path==='/api/orchestration/turn-item'))return api(path,payload,options);
      let pending=scopeKey?this.scopedReads.get(scopeKey):this.reads.get(api);
      if(!pending){pending=new Map();if(scopeKey)this.scopedReads.set(scopeKey,pending);else this.reads.set(api,pending);}
      const key=JSON.stringify([path,payload]),old=pending.get(key);if(old)return old;
      const work=Promise.resolve().then(()=>api(path,payload,options)),current=pending;current.set(key,work);
      void work.finally(()=>{if(current.get(key)===work)current.delete(key);if(scopeKey&&!current.size&&this.scopedReads.get(scopeKey)===current)this.scopedReads.delete(scopeKey);}).catch(()=>{});
      return work;
    };
    routed.trackConnection=api.trackConnection;
    return {...access,api:routed};
  };

  forSource(key:string,completed=false,priority=()=>0):Watch {
    return (threadId,access,callbacks,_socket,targets,replay)=>{
      if(this.stopped)return {stop(){}};
      let source=this.sources.get(key);
      if(!source){source={key,threadId,access,readers:new Set(),events:[],characters:0,started:false,freshAt:this.now(),sequence:0,retryAt:0};this.sources.set(key,source);}
      const current=source,reader:Reader={callbacks,targets,replay,completed,priority};current.readers.add(reader);this.memory('start',current);
      logEvent('response.source.readers',{threadId,sourceKey:key,readers:current.readers.size,sources:this.sources.size});
      if(current.started&&!current.watch&&!completed){current.slot?.();if(current.retry)cancelTimeout(current.retry);current.retry=undefined;current.started=false;}
      if(!current.started){if(!this.pending.includes(current))this.pending.push(current);queueMicrotask(()=>this.drain());}
      else queueMicrotask(()=>{
        if(!current.readers.has(reader)||this.stopped)return;
        if(current.snapshot){callbacks.item(current.snapshot);for(const item of current.events){if(!current.readers.has(reader))break;callbacks.item(item);}}
        // A joining old run may lie outside the retained recent snapshot.
        // A union-target read supplies it without opening another watcher.
        if(current.readers.has(reader))this.refresh(current,true);
      });
      return {refresh:(_read=true,accepted)=>{
        if(this.stopped||!current.readers.has(reader)||current.fatal)return;
        if(accepted&&current.acknowledgement===accepted)return;
        current.acknowledgement=accepted;
        current.retryAt=0;current.attempt=0;
        if(current.retry)cancelTimeout(current.retry);current.retry=undefined;
        // Wake only this source. Keep the bounded canonical read queue and
        // request a fresh read after any pre-acknowledgement read settles.
        current.watch?.refresh?.(false);this.refresh(current,true);
      },stop:()=>{
        if(!current.readers.delete(reader)||current.readers.size)return;
        this.sources.delete(key);this.pending=this.pending.filter(value=>value!==current);
        current.watch?.stop();current.slot?.();current.controller?.abort();current.expire?.();if(current.retry)cancelTimeout(current.retry);
        current.events=[];current.snapshot=undefined;current.characters=0;this.memory('end',current);
      }};
    };
  }

  private memory(checkpoint:'sample'|'start'|'end'|'dispose',source?:Source){
    streamMemory.sample(checkpoint,()=>{
      const status=this.status();return {threadId:source?.threadId,sourceCount:status.sources,readerCount:status.readers,openingCount:status.opening,queuedCount:status.queued,canonicalReadCount:status.canonicalReads,retryTimerCount:status.retryTimers,cacheCharacters:status.cacheCharacters,replayEventCount:source?.events.length};
    });
  }
  private targets(source:Source):InlineHistoryTargets {
    const targets=[...source.readers].map(reader=>reader.targets?.());
    return {messageIds:[...new Set(targets.flatMap(target=>target?.messageIds??[]))],turnIds:[...new Set(targets.flatMap(target=>target?.turnIds??[]))],recoveryVersion:JSON.stringify(targets.map(target=>target?.recoveryVersion))};
  }
  private deliver(source:Source,item:ThreadStreamItem){
    source.slot?.();
    const sequence=item.kind==='snapshot'?item.snapshot.snapshotSequence:item.kind==='event'?item.event.sequence:undefined;
    if(typeof sequence==='number'&&sequence>=source.sequence){source.sequence=sequence;source.freshAt=this.now();}
    // Bound late-reader replay. Existing readers have already consumed earlier
    // events; new readers use a canonical read if this window is exceeded.
    const size=JSON.stringify(item).length;
    if(item.kind==='snapshot'){
      const sequence=item.snapshot?.snapshotSequence??0,previous=source.snapshot?.kind==='snapshot'?source.snapshot.snapshot.snapshotSequence??0:0;
      if(sequence>=previous){
        source.snapshot=item;source.comparison=undefined;source.comparisonDirty=false;
        source.events=source.events.filter(event=>event.kind==='event'&&(event.event.sequence??0)>sequence);
        source.characters=size+source.events.reduce((total,event)=>total+JSON.stringify(event).length,0);
        if(source.characters>8_000_000)this.evictReplay(source);
      }
    }
    else if(source.snapshot){source.events.push(item);source.characters+=size;if(source.events.length>256||source.characters>8_000_000)this.evictReplay(source);}
    else if(item.kind==='event')source.comparisonDirty=true;
    for(const reader of [...source.readers])if(source.readers.has(reader))try{reader.callbacks.item(item);}catch(error){logFailure('response.render.failed',error,{threadId:source.threadId});}
  }
  private evictReplay(source:Source){
    const state=replayState(source.snapshot!,source.events);
    source.comparison=threadFingerprint(state);source.comparisonDirty=(state.sequence??0)<source.sequence;
    source.snapshot=undefined;source.events=[];source.characters=0;
  }
  private issue(source:Source,error:Error,fatal=false){
    for(const reader of [...source.readers])try{if(fatal)reader.callbacks.failure?.(error);else reader.callbacks.reconnecting(error);}catch(failure){logFailure('response.render.failed',failure,{threadId:source.threadId});}
  }
  /** Foreground events and the existing response tick share one bounded read
   * per source. Socket pings do not certify that transcript data is current. */
  tick(foreground=false){
    if(this.stopped)return;
    for(const source of this.sources.values()){
      if(source.readAt!==undefined&&this.now()-source.readAt>=30_000)source.expire?.();
      if(!source.watch||source.fatal||source.retryAt>this.now())continue;
      // Enqueue the entire eligible set before assigning the limited slots so
      // a later visible source can precede earlier background sources.
      if(foreground||this.now()-source.freshAt>=10_000){source.recovery=true;if(!source.refresh)source.refreshWanted=true;}
    }
    this.drainRefresh();
  }
  private refresh(source:Source,again=false){
    if(!source.readers.size||this.stopped||source.fatal)return;
    if(source.refresh){if(again)source.refreshAgain=true;return;}
    source.refreshWanted=true;this.drainRefresh();
  }
  private priority(source:Source){return Math.max(0,...[...source.readers].map(reader=>reader.priority()));}
  /** Two optional restorations cannot consume the one reserved send slot.
   * Count real work until it settles; elapsed time never supplies capacity. */
  private available(count:number,source:Source){return count<this.maxOpening+(this.priority(source)>=3?1:0);}
  private drainRefresh(){
    const waiting=[...this.sources.values()].filter(source=>source.refreshWanted&&!source.refresh&&source.retryAt<=this.now())
      .sort((a,b)=>this.priority(b)-this.priority(a));
    for(const source of waiting)if(this.available(this.refreshing,source))this.startRefresh(source);
  }
  private missedThreadUpdate(source:Source,snapshot:Awaited<ReturnType<typeof readInlineSnapshot>>){
    if((snapshot.snapshotSequence??0)<=source.sequence)return false;
    if(!source.snapshot){
      // Live events without retained text make the digest incomplete. Adopt
      // this canonical baseline first; subsequent missed content can repair
      // the subscription without retaining the large transcript.
      return !!source.comparison&&!source.comparisonDirty&&source.comparison!==threadFingerprint(replayState({kind:'snapshot',snapshot},[]));
    }
    // Use the already bounded replay window only while checking a recovery.
    // Do not retain another transcript or compare a global cursor as content.
    const current=replayState(source.snapshot,source.events);
    const next=applyThreadItem(current,{kind:'snapshot',snapshot}).state;
    return !sameThreadValue({...current,sequence:undefined},{...next,sequence:undefined});
  }
  private startRefresh(source:Source){
    source.refreshWanted=false;this.refreshing++;source.readAt=this.now();
    const recovery=source.recovery;source.recovery=false;
    const controller=source.controller=new AbortController();
    source.expire=()=>controller.abort();
    const read=source.access().then(async access=>{
      try{
        if(controller.signal.aborted)throw Error('T3 response recovery read was cancelled.');
        return await readInlineSnapshot({...access,api:(path,payload,options)=>access.api(path,payload,{...options,signal:controller.signal})},source.threadId,undefined,()=>this.targets(source));
      }finally{await access.close?.();}
    });
    const work=read.then(snapshot=>{
      if(controller.signal.aborted)throw Error('T3 response recovery read was cancelled.');
      if(!source.readers.size||this.stopped)return;
      const behind=recovery&&this.missedThreadUpdate(source,snapshot);
      source.attempt=0;source.retryAt=0;source.freshAt=this.now();
      this.deliver(source,{kind:'snapshot',snapshot});
      if(recovery&&behind&&source.watch&&source.readers.size){
        source.watch.stop();source.watch=undefined;source.started=false;source.slot?.();
        if(!this.pending.includes(source))this.pending.push(source);this.drain();
      }
    }).catch(error=>{
      source.slot?.();if(!source.readers.size||this.stopped)return;
      if(responseTooLarge(error)){source.fatal=true;this.issue(source,error as Error,true);return;}
      this.issue(source,error instanceof Error?error:Error(String(error)));
      const delay=Math.min(30_000,(source.watch?5000:1000)*2**Math.min(source.attempt??0,5));source.attempt=(source.attempt??0)+1;
      source.retryAt=this.now()+delay;
      if(!source.watch&&[...source.readers].every(reader=>reader.completed)){
        logEvent('response.source.retry',{threadId:source.threadId,delayMs:delay,reason:'completed-read-failed'});
        source.retry=scheduleTimeout(()=>{source.retry=undefined;if(!source.readers.size||this.stopped||source.watch)return;source.retryAt=0;source.started=false;this.pending.push(source);this.drain();},delay);
      }
    }).finally(()=>{
      this.refreshing--;source.readAt=undefined;source.expire=undefined;
      if(source.controller===controller)source.controller=undefined;
      if(source.refresh===work)source.refresh=undefined;
      if(source.refreshAgain){source.refreshAgain=false;source.retryAt=0;if(!source.retry)this.refresh(source);}
      this.drainRefresh();
    });
    source.refresh=work;void work.catch(()=>{});
  }
  priorityChanged(){if(!this.stopped){this.drain();this.drainRefresh();}}
  private drain(){
    while(!this.stopped&&this.pending.length){
      this.pending.sort((a,b)=>this.priority(b)-this.priority(a));
      const index=this.pending.findIndex(source=>this.available(this.opening,source));if(index<0)break;
      const [source]=this.pending.splice(index,1);if(!source.readers.size||source.started)continue;
      source.started=true;this.opening++;let released=false;
      source.slot=()=>{if(released)return;released=true;this.opening--;queueMicrotask(()=>this.drain());};
      if([...source.readers].every(reader=>reader.completed)){this.refresh(source);continue;}
      source.watch=this.watch(source.threadId,source.access,{
        item:item=>this.deliver(source,item),
        reconnecting:error=>{source.slot?.();this.issue(source,error);},
        failure:error=>{source.slot?.();this.issue(source,error,true);},
      },undefined,()=>this.targets(source),{
        afterSequence:()=>Math.min(...[...source.readers].map(reader=>reader.replay?.afterSequence()??0)),
        pollImmediately:true,jitter:true,
        pollSnapshots:()=>[...source.readers].some(reader=>{const poll=reader.replay?.pollSnapshots;return typeof poll==='function'?poll():poll!==false;}),
        diagnostics:()=>({role:'shared-response'}),
      });
      if(!source.readers.size)source.watch.stop();
    }
  }
  status(){return {sources:this.sources.size,readers:[...this.sources.values()].reduce((count,source)=>count+source.readers.size,0),opening:this.opening,queued:this.pending.length,canonicalReads:[...this.sources.values()].filter(source=>!!source.refresh).length,retryTimers:[...this.sources.values()].filter(source=>!!source.retry).length,cacheCharacters:[...this.sources.values()].reduce((sum,source)=>sum+source.characters,0)};}
  dispose(){this.stopped=true;for(const source of this.sources.values()){source.readers.clear();source.watch?.stop();source.slot?.();source.controller?.abort();source.expire?.();if(source.retry)cancelTimeout(source.retry);}this.sources.clear();this.scopedReads.clear();this.pending=[];this.memory('dispose');}
}
