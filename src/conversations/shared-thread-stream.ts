import {watchThread,readInlineSnapshot,type InlineHistoryTargets,type ThreadAccess,type ThreadStreamCallbacks} from './thread-stream';
import type {ThreadStreamItem} from '../connection/thread-events';
import {scheduleTimeout,cancelTimeout} from '../shared/clock';
import {logEvent,logFailure} from '../app/diagnostics';
import {streamMemory} from '../app/stream-memory-diagnostics';
import {responseTooLarge} from '../connection/t3-response-limits';

type Watch=typeof watchThread;
type Reader={callbacks:ThreadStreamCallbacks;targets?:()=>InlineHistoryTargets;replay?:Parameters<Watch>[5];completed:boolean;priority:()=>number};
type Source={key:string;threadId:string;access:Parameters<Watch>[1];readers:Set<Reader>;watch?:ReturnType<Watch>;snapshot?:ThreadStreamItem;events:ThreadStreamItem[];characters:number;slot?:()=>void;timeout?:ReturnType<typeof scheduleTimeout>;refresh?:Promise<void>;started:boolean;retry?:ReturnType<typeof scheduleTimeout>;attempt?:number;refreshAgain?:boolean;controller?:AbortController};

/** One source connection per authenticated environment/project/thread. Each
 * consumer still owns its exact run binding, projection and final save. */
export class SharedThreadStreams {
  private sources=new Map<string,Source>();
  private pending:Source[]=[];
  private opening=0;
  private stopped=false;
  private reads=new WeakMap<ThreadAccess['api'],Map<string,Promise<unknown>>>();
  private scopedReads=new Map<string,Map<string,Promise<unknown>>>();
  constructor(private watch:Watch=watchThread,private maxOpening=2){}

  access=async(factory:()=>Promise<ThreadAccess>,scope?:string):Promise<ThreadAccess>=>{
    const access=await factory(),api=access.api,scopeKey=scope?JSON.stringify([scope,access.origin,access.diagnosticRoute?.routeId]):undefined;
    const routed:ThreadAccess['api']=(path,payload,options)=>{
      // Signals remain owned by their caller. Never combine cancellable reads,
      // dispatches, decisions, tickets or credential mutations.
      if(options?.signal||!(payload===undefined&&path.startsWith('/api/orchestration/threads/')||path==='/api/orchestration/turn-item'))return api(path,payload,options);
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
      if(!source){source={key,threadId,access,readers:new Set(),events:[],characters:0,started:false};this.sources.set(key,source);}
      const current=source,reader:Reader={callbacks,targets,replay,completed,priority};current.readers.add(reader);this.memory('start',current);
      logEvent('response.source.readers',{threadId,sourceKey:key,readers:current.readers.size,sources:this.sources.size});
      if(current.started&&!current.watch&&!completed){current.slot?.();if(current.retry)cancelTimeout(current.retry);current.retry=undefined;current.started=false;}
      if(!current.started){if(!this.pending.includes(current))this.pending.push(current);queueMicrotask(()=>this.drain());}
      else queueMicrotask(()=>{
        if(!current.readers.has(reader)||this.stopped)return;
        if(current.snapshot){callbacks.item(current.snapshot);for(const item of current.events){if(!current.readers.has(reader))break;callbacks.item(item);}}
        // A joining old run may lie outside the retained recent snapshot.
        // A union-target read supplies it without opening another watcher.
        if(current.readers.has(reader))this.refresh(current);
      });
      return {stop:()=>{
        if(!current.readers.delete(reader)||current.readers.size)return;
        this.sources.delete(key);this.pending=this.pending.filter(value=>value!==current);
        current.watch?.stop();current.slot?.();current.controller?.abort();if(current.retry)cancelTimeout(current.retry);if(current.timeout)cancelTimeout(current.timeout);
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
    return {messageIds:[...new Set(targets.flatMap(target=>target?.messageIds??[]))],turnIds:[...new Set(targets.flatMap(target=>target?.turnIds??[]))]};
  }
  private deliver(source:Source,item:ThreadStreamItem){
    source.slot?.();
    // Bound late-reader replay. Existing readers have already consumed earlier
    // events; new readers use a canonical read if this window is exceeded.
    const size=JSON.stringify(item).length;
    if(item.kind==='snapshot'){
      const sequence=item.snapshot?.snapshotSequence??0,previous=source.snapshot?.kind==='snapshot'?source.snapshot.snapshot.snapshotSequence??0:0;
      if(sequence>=previous){
        source.snapshot=size<=8_000_000?item:undefined;
        source.events=source.events.filter(event=>event.kind==='event'&&(event.event.sequence??0)>sequence);
        source.characters=size+source.events.reduce((total,event)=>total+JSON.stringify(event).length,0);
        if(source.characters>8_000_000){source.snapshot=undefined;source.events=[];source.characters=0;}
      }
    }
    else if(source.snapshot){source.events.push(item);source.characters+=size;if(source.events.length>256||source.characters>8_000_000){source.snapshot=undefined;source.events=[];source.characters=0;}}
    for(const reader of [...source.readers])if(source.readers.has(reader))try{reader.callbacks.item(item);}catch(error){logFailure('response.render.failed',error,{threadId:source.threadId});}
  }
  private issue(source:Source,error:Error,fatal=false){
    for(const reader of [...source.readers])try{if(fatal)reader.callbacks.failure?.(error);else reader.callbacks.reconnecting(error);}catch(failure){logFailure('response.render.failed',failure,{threadId:source.threadId});}
  }
  private refresh(source:Source){
    if(!source.readers.size||this.stopped)return;
    if(source.refresh){source.refreshAgain=true;return;}
    const controller=source.controller=new AbortController(),timeout=scheduleTimeout(()=>controller.abort(),20_000);
    const work=source.access().then(async access=>{
      try{
        if(controller.signal.aborted)throw Error('T3 response recovery read timed out or was cancelled.');
        const snapshot=await readInlineSnapshot({...access,api:(path,payload)=>access.api(path,payload,{signal:controller.signal})},source.threadId,undefined,this.targets(source));
        source.attempt=0;if(source.readers.size&&!this.stopped&&!controller.signal.aborted)this.deliver(source,{kind:'snapshot',snapshot});
      }finally{await access.close?.();}
    }).catch(error=>{
      source.slot?.();if(!source.readers.size||this.stopped)return;
      if(responseTooLarge(error)){this.issue(source,error as Error,true);return;}
      this.issue(source,error instanceof Error?error:Error(String(error)));
      if(!source.watch&&[...source.readers].every(reader=>reader.completed)){
        const delay=Math.min(30_000,1000*2**Math.min(source.attempt??0,5));source.attempt=(source.attempt??0)+1;
        logEvent('response.source.retry',{threadId:source.threadId,delayMs:delay,reason:'completed-read-failed'});
        source.retry=scheduleTimeout(()=>{source.retry=undefined;if(!source.readers.size||this.stopped||source.watch)return;source.started=false;this.pending.push(source);this.drain();},delay);
      }
    }).finally(()=>{
      cancelTimeout(timeout);if(source.controller===controller)source.controller=undefined;
      if(source.refresh===work)source.refresh=undefined;
      if(source.refreshAgain){source.refreshAgain=false;if(!source.retry)this.refresh(source);}
    });
    source.refresh=work;void work.catch(()=>{});
  }
  private drain(){
    while(!this.stopped&&this.opening<this.maxOpening&&this.pending.length){
      this.pending.sort((a,b)=>Math.max(...[...b.readers].map(reader=>reader.priority()),0)-Math.max(...[...a.readers].map(reader=>reader.priority()),0));
      const source=this.pending.shift()!;if(!source.readers.size||source.started)continue;
      source.started=true;this.opening++;let released=false;
      source.slot=()=>{if(released)return;released=true;this.opening--;if(source.timeout)cancelTimeout(source.timeout);source.timeout=undefined;queueMicrotask(()=>this.drain());};
      source.timeout=scheduleTimeout(()=>source.slot?.(),20_000);
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
  dispose(){this.stopped=true;for(const source of this.sources.values()){source.readers.clear();source.watch?.stop();source.slot?.();source.controller?.abort();if(source.retry)cancelTimeout(source.retry);if(source.timeout)cancelTimeout(source.timeout);}this.sources.clear();this.scopedReads.clear();this.pending=[];this.memory('dispose');}
}
