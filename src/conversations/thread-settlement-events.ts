import {isRecord,parseJson,toError} from '../shared/values';
import {scheduleTimeout,cancelTimeout} from '../shared/clock';
import {T3_PROTOCOL_VERSION} from '../connection/orchestration-v2';
import type {ThreadAccess} from './thread-stream';
import type {ThreadSettlementJob} from './thread-settlement';

type Subscription={stop():void};
type Watch=(access:()=>Promise<ThreadAccess>,changed:(threadId?:string)=>void)=>Subscription;

/** Shell subscriptions carry lifecycle metadata, without another copy of reply history. */
export function watchSettlementShell(access:()=>Promise<ThreadAccess>,changed:(threadId?:string)=>void,makeSocket:(url:string)=>WebSocket=url=>new WebSocket(url)):Subscription {
  let stopped=false,attempt=0,generation=0,socket:WebSocket|undefined,release:(()=>void)|undefined,timer:ReturnType<typeof scheduleTimeout>|undefined;
  const close=()=>{const old=socket;socket=undefined;if(old){try{old.send(JSON.stringify({_tag:'Interrupt',requestId:'1'}));}catch{/* The socket may already be closed. */}old.close();}release?.();release=undefined;};
  const connect=async()=>{
    const current=++generation;let ended=false;
    const live=()=>!stopped&&!ended&&current===generation;
    const fail=()=>{if(!live())return;ended=true;close();timer=scheduleTimeout(()=>{timer=undefined;void connect();},Math.min(30_000,1000*2**Math.min(attempt++,5)));};
    try{
      const ready=await access();
      if(!live()){await ready.close?.('late-access');return;}
      release=()=>{void Promise.resolve(ready.close?.('stream-stopped')).catch(()=>{});};
      const issued=await ready.api('/api/auth/websocket-ticket',{});if(!live())return;
      if(!isRecord(issued)||typeof issued.ticket!=='string'||!issued.ticket)throw Error('T3 did not issue a settlement stream ticket.');
      const url=new URL('/ws',ready.origin);url.protocol=url.protocol==='https:'?'wss:':'ws:';url.searchParams.set('wsTicket',issued.ticket);url.searchParams.set('orchestrationProtocol',String(T3_PROTOCOL_VERSION));
      const opened=socket=makeSocket(url.href);
      opened.onopen=()=>{if(!live()){opened.close();return;}ready.api.trackConnection?.({get closed(){return !live();}});opened.send(JSON.stringify({_tag:'Request',id:'1',tag:'orchestration.subscribeShell',payload:{},headers:[]}));};
      opened.onmessage=message=>{
        if(!live())return;
        try{
          if(typeof message.data!=='string')throw Error('Invalid T3 settlement stream frame.');
          const value=parseJson(message.data);
          for(const frame of Array.isArray(value)?value:[value]){
            if(!isRecord(frame))throw Error('Invalid T3 settlement stream frame.');
            if(frame._tag==='Ping'){opened.send(JSON.stringify({_tag:'Pong'}));continue;}
            if(frame._tag==='Defect')throw Error('T3 settlement subscription failed.');
            if(String(frame.requestId)!=='1')continue;
            if(frame._tag==='Exit')throw Error('T3 settlement subscription ended.');
            if(frame._tag!=='Chunk')continue;
            if(!Array.isArray(frame.values))throw Error('Invalid T3 settlement stream chunk.');
            for(const item of frame.values){
              if(!isRecord(item))continue;
              if(item.kind==='snapshot'){attempt=0;changed();}
              else if(item.kind==='thread.removed'&&typeof item.threadId==='string')changed(item.threadId);
              else if(item.kind==='thread.updated'&&isRecord(item.thread)){
                const thread=item.thread,id=thread.id;
                if(typeof id==='string'&&(thread.archivedAt||thread.deletedAt||thread.settledOverride==='settled'||['idle','completed','failed','interrupted','cancelled','rolled_back'].includes(String(thread.status))))changed(id);
              }
            }
            opened.send(JSON.stringify({_tag:'Ack',requestId:'1'}));
          }
        }catch{fail();}
      };
      opened.onclose=fail;opened.onerror=fail;
    }catch{fail();}
  };
  void connect();
  return {stop(){if(stopped)return;stopped=true;generation++;if(timer)cancelTimeout(timer);timer=undefined;close();}};
}

type Feed={jobs:ThreadSettlementJob[];subscription?:Subscription};
export class ThreadSettlementEvents {
  private feeds=new Map<string,Feed>();
  private pending=new Set<ThreadSettlementJob>();
  private running=false;
  private stopped=false;
  constructor(private access:(job:ThreadSettlementJob)=>Promise<ThreadAccess>,private check:(job:ThreadSettlementJob)=>Promise<void>,private blocked:()=>boolean,private error:(error:Error)=>void,private watch:Watch=watchSettlementShell){}
  sync(jobs:ThreadSettlementJob[]){
    if(this.stopped)return;
    const groups=new Map<string,ThreadSettlementJob[]>();
    for(const job of jobs){const c=job.connection,key=JSON.stringify([c.environmentId,c.connectionId,c.url,c.host]);groups.set(key,[...groups.get(key)??[],job]);}
    for(const [key,feed] of this.feeds)if(!groups.has(key)){this.feeds.delete(key);feed.subscription?.stop();}
    for(const job of this.pending)if(!jobs.includes(job))this.pending.delete(job);
    for(const [key,targets] of groups){
      const old=this.feeds.get(key);if(old){for(const job of targets)if(!old.jobs.includes(job))this.pending.add(job);old.jobs=targets;continue;}
      const feed:Feed={jobs:targets};this.feeds.set(key,feed);
      for(const job of targets)this.pending.add(job);
      feed.subscription=this.watch(()=>this.access(feed.jobs[0]),threadId=>{if(this.feeds.get(key)!==feed)return;for(const job of feed.jobs)if(!threadId||job.threadId===threadId)this.pending.add(job);this.drain();});
    }
    this.drain();
  }
  wake(bindingId?:string){
    if(this.stopped)return;
    for(const feed of this.feeds.values())for(const job of feed.jobs)if(!bindingId||job.inlineJobId===bindingId||job.inlineBindings?.some(binding=>binding.id===bindingId))this.pending.add(job);
    this.drain();
  }
  reconnect(){const jobs=[...this.feeds.values()].flatMap(feed=>feed.jobs);for(const feed of this.feeds.values())feed.subscription?.stop();this.feeds.clear();this.sync(jobs);this.wake();}
  private drain(){
    if(this.running||this.stopped||this.blocked()||!this.pending.size)return;
    this.running=true;
    queueMicrotask(()=>{void this.flush().catch(error=>this.error(toError(error)));});
  }
  private async flush(){
    try{while(!this.stopped&&!this.blocked()&&this.pending.size){const job=this.pending.values().next().value!;this.pending.delete(job);try{await this.check(job);}catch(error){this.error(toError(error));}}}
    finally{this.running=false;this.drain();}
  }
  dispose(){this.stopped=true;for(const feed of this.feeds.values())feed.subscription?.stop();this.feeds.clear();this.pending.clear();}
}
