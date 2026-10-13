import {logEvent,logFailure} from './diagnostics';
import {Buffer} from 'buffer';
import {contentHash} from './completion';
import {applyThreadItem,turnForMessage,type InlineThreadState} from './inline-thread';
import {T3_PROTOCOL_VERSION,normalizeV2StreamItem,normalizeV2Snapshot,normalizeV2TitleItem} from './orchestration-v2';
import {responseTooLarge} from './t3-response-limits';

export type ThreadAccessCloseReason='cache-expired'|'auth-rejected'|'host-disposed'|'stop-complete'|'stop-timeout'|'stream-reconnect'|'stream-stopped'|'late-access'|'caller-closed';
export interface ThreadAccess {origin:string;api:(path:string,payload?:any,options?:{signal?:AbortSignal})=>Promise<any>;expiresAt?:number;close?:(reason?:ThreadAccessCloseReason)=>Promise<void>|void;trace?:(event:'borrow-released'|'recovered',reason?:ThreadAccessCloseReason)=>void}
export type ThreadAccessFactory=()=>Promise<ThreadAccess>;
export type ThreadStreamItem={kind:'snapshot';snapshot:any}|{kind:'event';event:any}|{kind:'synchronized'};
export interface ThreadStreamCallbacks {item:(item:ThreadStreamItem)=>void;reconnecting:(error:Error)=>void;failure?:(error:Error)=>void}
export interface InlineHistoryTargets {messageIds:string[];turnIds:string[]}

export function needsInlineHistory(state:InlineThreadState,targets:InlineHistoryTargets):boolean {
  return state.historyComplete===false&&(targets.messageIds.some(id=>!turnForMessage(state,id))||targets.turnIds.some(id=>id!==state.latestTurn?.turnId));
}

/** Recent polling stays small. A stranded response can request the complete
 * canonical transcript, including prompts older than the polling window. */
export async function readInlineSnapshot(access:ThreadAccess,threadId:string,projectId?:string,targets?:InlineHistoryTargets,full=false,importOnly=false,importRunId?:string):Promise<any> {
  const read=async(all:boolean)=>{
    const snapshot=normalizeV2Snapshot(await access.api(`/api/orchestration/threads/${encodeURIComponent(threadId)}?reasoningMessages=true${all?'':'&turnLimit=20'}${importOnly?'&importRuns=true':''}${importRunId?'&importRunId='+encodeURIComponent(importRunId):''}`));
    if(snapshot?.thread?.id!==threadId||projectId&&snapshot.thread.projectId!==projectId)throw Error('Waiting for the requested T3 thread.');
    return snapshot;
  };
  const snapshot=await read(full);
  if(!full&&targets&&needsInlineHistory(applyThreadItem({messages:[],activities:[]},{kind:'snapshot',snapshot}).state,targets))return read(true);
  return snapshot;
}

/** Bounded, one-shot protocol replay for exact start/turn evidence absent from
 * canonical latestTurn. The caller's native freshness deadline owns aborting
 * this operation; no renderer timer, polling loop, or database is involved. */
export async function readInlineEvents(access:ThreadAccess,threadId:string,afterSequence:number,signal:AbortSignal,makeSocket:(url:string)=>WebSocket=url=>new WebSocket(url)):Promise<ThreadStreamItem[]> {
  const issued=await access.api('/api/auth/websocket-ticket',{});
  if(signal.aborted)throw Error('T3 binding recovery canceled.');
  if(typeof issued?.ticket!=='string'||!issued.ticket)throw Error('T3 did not issue a stream ticket.');
  const url=new URL('/ws',access.origin);url.protocol=url.protocol==='https:'?'wss:':'ws:';
  url.searchParams.set('wsTicket',issued.ticket);url.searchParams.set('orchestrationProtocol',String(T3_PROTOCOL_VERSION));
  return new Promise((resolve,reject)=>{
    const socket=makeSocket(url.href),items:ThreadStreamItem[]=[];let finished=false;
    const abort=()=>finish(Error('T3 binding recovery canceled.'));
    const finish=(error?:Error)=>{if(finished)return;finished=true;signal.removeEventListener('abort',abort);try{socket.send(JSON.stringify({_tag:'Interrupt',requestId:'1'}));}catch{}socket.close();error?reject(error):resolve(items);};
    signal.addEventListener('abort',abort,{once:true});
    socket.onopen=()=>{if(signal.aborted){abort();return;}socket.send(JSON.stringify({_tag:'Request',id:'1',tag:'orchestration.subscribeThread',payload:{threadId,afterSequence,requestCompletionMarker:true,acceptBoundedSnapshot:true,acceptCompactTurnItems:true},headers:[]}));};
    socket.onmessage=message=>{try{
      if(typeof message.data!=='string'||Buffer.byteLength(message.data)>16_000_000)throw Error('T3 stream frame is too large.');
      const decoded=JSON.parse(message.data);
      for(const frame of Array.isArray(decoded)?decoded:[decoded]){
        if(frame._tag==='Ping'){socket.send(JSON.stringify({_tag:'Pong'}));continue;}
        if(frame._tag==='Defect')throw Error('T3 binding replay failed.');
        if(String(frame.requestId)!=='1')continue;
        if(frame._tag==='Chunk'){
          if(!Array.isArray(frame.values))throw Error('Invalid T3 binding replay.');
          for(const item of frame.values){if(item.kind==='synchronized'){finish();return;}if(items.length>=1001)throw Error('T3 binding replay exceeded its event limit.');items.push(normalizeV2StreamItem(item));}
          socket.send(JSON.stringify({_tag:'Ack',requestId:'1'}));
        }else if(frame._tag==='Exit')throw Error('T3 binding replay ended before synchronization.');
      }
    }catch(error){finish(error instanceof Error?error:Error(String(error)));}};
    socket.onerror=()=>finish(Error('T3 binding replay connection failed.'));
    socket.onclose=()=>{if(!finished)finish(Error('T3 binding replay closed before synchronization.'));};
  });
}

/** The Effect RPC stream stays open until stopped. Every reconnect asks for a
 * fresh snapshot, so lost deltas cannot duplicate text or leave a gap. */
export function watchThread(threadId:string,accessFactory:ThreadAccessFactory,callbacks:ThreadStreamCallbacks,makeSocket:(url:string)=>WebSocket=url=>new WebSocket(url),historyTargets?:()=>InlineHistoryTargets,replay?:{afterSequence:()=>number|undefined;pollSnapshots?:boolean|(()=>boolean);pollImmediately?:boolean;titleOnly?:boolean}) {
  let stopped=false,socket:WebSocket|undefined,timer:ReturnType<typeof setTimeout>|undefined,rotation:ReturnType<typeof setTimeout>|undefined,pollTimer:ReturnType<typeof setTimeout>|undefined,attempt=0;
  let access:ThreadAccess|undefined;
  let snapshotBlocked=false;
  const pollEnabled=()=>!snapshotBlocked&&(typeof replay?.pollSnapshots==='function'?replay.pollSnapshots():replay?.pollSnapshots!==false);
  const closeAccess=(reason:ThreadAccessCloseReason)=>{if(pollTimer)clearTimeout(pollTimer);pollTimer=undefined;const old=access;access=undefined;if(old?.close)void Promise.resolve(old.close(reason)).catch(()=>{});};
  const retry=(error:Error)=>{
    if(stopped)return;
    if(rotation)clearTimeout(rotation);
    logFailure('stream.reconnecting',error,{threadId,attempt});logEvent('stream.disconnected',{threadId});
    callbacks.reconnecting(error);closeAccess('stream-reconnect');
    const delay=Math.min(30_000,1000*2**Math.min(attempt++,5));
    timer=setTimeout(()=>{void connect();},delay);
  };
  const connect=async()=>{
    if(stopped)return;
    let ready:ThreadAccess;
    try{
      ready=await accessFactory();
      if(stopped){await ready.close?.('late-access');return;}
      access=ready;
      let ws:WebSocket|undefined,ended=false,polling=false,pollDue=0,pollDelay=1200,activityVersion=0,lastSnapshotHash:string|undefined;
      const fail=(error:Error)=>{if(ended||stopped)return;ended=true;ws?.close();retry(error);};
      const schedulePoll=(delay:number)=>{
        if(stopped||ended||access!==ready||!pollEnabled())return;
        const due=Date.now()+delay;
        // Frequent live deltas must never postpone an already due canonical read.
        if(pollTimer&&pollDue<=due)return;
        if(pollTimer)clearTimeout(pollTimer);
        pollDue=due;pollTimer=setTimeout(()=>{pollTimer=undefined;void poll();},delay);
      };
      const poll=async()=>{
        if(stopped||ended||access!==ready||polling||!pollEnabled())return;
        polling=true;const beforeActivity=activityVersion;
        try{
          const snapshot=historyTargets?await readInlineSnapshot(ready,threadId,undefined,historyTargets()):normalizeV2Snapshot(await ready.api(`/api/orchestration/threads/${encodeURIComponent(threadId)}?reasoningMessages=true&turnLimit=20`));
          if(!stopped&&!ended&&access===ready&&snapshot?.thread){
            // The global snapshot cursor can advance for unrelated threads.
            // Keep only a small digest; still deliver every canonical snapshot
            // so replay cursors and binding evidence continue to advance.
            const hash=contentHash(JSON.stringify({thread:snapshot.thread,historyComplete:snapshot.historyComplete}));
            pollDelay=beforeActivity===activityVersion&&hash===lastSnapshotHash?Math.min(5000,pollDelay*2):1200;
            lastSnapshotHash=hash;callbacks.item({kind:'snapshot',snapshot});
          }else pollDelay=1200;
        }catch(error){pollDelay=1200;logFailure('stream.poll.failed',error,{threadId});if(!stopped&&!ended&&access===ready&&responseTooLarge(error)){snapshotBlocked=true;callbacks.failure?.(error as Error);}}
        finally{polling=false;schedulePoll(pollDelay);}
      };
      // A browser timer can delay even a zero-delay read after app suspension.
      // Current text does not depend on a socket ticket or socket opening.
      if(replay?.pollImmediately&&pollEnabled())void poll();
      const issued=await ready.api('/api/auth/websocket-ticket',{});
      if(stopped||access!==ready)return;
      if(typeof issued?.ticket!=='string'||!issued.ticket)throw Error('T3 did not issue a stream ticket.');
      const url=new URL('/ws',ready.origin);url.protocol=url.protocol==='https:'?'wss:':'ws:';
      url.searchParams.set('wsTicket',issued.ticket);url.searchParams.set('orchestrationProtocol',String(T3_PROTOCOL_VERSION));
      const openedSocket=socket=ws=makeSocket(url.href);
      const opening=setTimeout(()=>fail(Error('T3 thread stream did not connect.')),15_000);
      openedSocket.onopen=()=>{
        clearTimeout(opening);if(stopped){openedSocket.close();return;}
        logEvent('stream.connected',{threadId});attempt=0;
        rotation=setTimeout(()=>fail(Error('Refreshing the T3 stream session.')),4*60_000);
        openedSocket.send(JSON.stringify({_tag:'Request',id:'1',tag:'orchestration.subscribeThread',payload:{threadId,acceptBoundedSnapshot:true,acceptCompactTurnItems:true,...(replay?{afterSequence:replay.afterSequence(),requestCompletionMarker:true}:{})},headers:[]}));
        // Subscription hosts already own a full canonical polling loop. A second
        // recent-history poll would repeatedly replace it with partial history.
        if(replay?.pollImmediately&&pollEnabled())void poll();else schedulePoll(1200);
      };
      openedSocket.onmessage=message=>{
        try{
          if(typeof message.data!=='string'||Buffer.byteLength(message.data)>16_000_000)throw Error('T3 stream frame is too large.');
          const decoded=JSON.parse(message.data),frames=Array.isArray(decoded)?decoded:[decoded];
          for(const frame of frames){
            if(frame._tag==='Ping'){openedSocket.send(JSON.stringify({_tag:'Pong'}));continue;}
            if(frame._tag==='Defect')throw Error('T3 thread stream failed.');
            if(String(frame.requestId)!=='1')continue;
            if(frame._tag==='Chunk'){
              if(!Array.isArray(frame.values))throw Error('T3 returned an invalid stream chunk.');
              logEvent('stream.chunk',{threadId,count:frame.values.length,sequence:frame.values.at(-1)?.event?.sequence??frame.values.at(-1)?.snapshot?.snapshotSequence});
              for(const value of frame.values){
                if(value.kind==='event'||value.kind==='snapshot'){
                  activityVersion++;pollDelay=1200;lastSnapshotHash=undefined;schedulePoll(1200);
                }
                callbacks.item(replay?.titleOnly?normalizeV2TitleItem(value):normalizeV2StreamItem(value));
              }
              openedSocket.send(JSON.stringify({_tag:'Ack',requestId:'1'}));
            }else if(frame._tag==='Exit'){
              throw Error('T3 thread stream ended.');
            }
          }
        }catch(error){fail(error instanceof Error?error:Error('T3 returned an invalid thread stream.'));}
      };
      openedSocket.onerror=()=>fail(Error('T3 thread stream connection failed.'));
      openedSocket.onclose=()=>{clearTimeout(opening);fail(Error('T3 thread stream closed.'));};
    }catch(error){retry(error instanceof Error?error:Error('Cannot open T3 thread stream.'));}
  };
  void connect();
  return {stop(){logEvent('stream.stopped',{threadId});stopped=true;if(timer)clearTimeout(timer);if(rotation)clearTimeout(rotation);if(socket){try{socket.send(JSON.stringify({_tag:'Interrupt',requestId:'1'}));}catch{/* Connection is already gone. */}socket.close();}closeAccess('stream-stopped');}};
}
