import type {ThreadStreamItem} from '../connection/thread-events';
export type {ThreadStreamItem} from '../connection/thread-events';
import {parseJson,isRecord} from '../shared/values';
import {readThreadSnapshot,type ThreadSnapshot} from '../connection/wire-types';
import {cancelTimeout as clearTimeout,scheduleTimeout as setTimeout} from '../shared/clock';
import {logEvent,diagnosticEnabled} from '../app/diagnostics';
import {contentHash} from '../responses/completion';
import {applyThreadItem,turnForMessage,type InlineThreadState} from './inline-thread';
import {T3_PROTOCOL_VERSION,normalizeV2StreamItem,normalizeV2Snapshot,normalizeV2TitleItem} from '../connection/orchestration-v2';
import {responseTooLarge} from '../connection/t3-response-limits';
import {readWorktreeSetup,workspacePreparation} from '../projects/worktree-setup';
import type {T3Api} from '../connection/t3-rpc';

export type ThreadAccessCloseReason='cache-expired'|'auth-rejected'|'host-disposed'|'stop-complete'|'stop-timeout'|'stream-reconnect'|'stream-stopped'|'late-access'|'caller-closed';
export interface ThreadAccess {origin:string;api:T3Api;expiresAt?:number;diagnosticRoute?:{routeId:string;environmentId:string;routeKind:'local'|'remote'};close?:(reason?:ThreadAccessCloseReason)=>Promise<void>|void;trace?:(event:'borrow-released'|'recovered',reason?:ThreadAccessCloseReason)=>void}
export type ThreadAccessFactory=()=>Promise<ThreadAccess>;
export interface ThreadStreamCallbacks {item:(item:ThreadStreamItem)=>void;reconnecting:(error:Error)=>void;failure?:(error:Error)=>void}
export interface InlineHistoryTargets {messageIds:string[];turnIds:string[]}
export interface StreamDiagnosticContext {role?:'response'|'title'|'host'|'shared-response';bindingId?:string;environmentId?:string;projectId?:string;messageId?:string;turnId?:string}
let streamMonitors=0;

export function needsInlineHistory(state:InlineThreadState,targets:InlineHistoryTargets):boolean {
  return state.historyComplete===false&&(targets.messageIds.some(id=>!turnForMessage(state,id))||targets.turnIds.some(id=>id!==state.latestTurn?.turnId));
}

/** Recent polling stays small. A stranded response can request the complete
 * canonical transcript, including prompts older than the polling window. */
export async function readInlineSnapshot(access:ThreadAccess,threadId:string,projectId?:string,targets?:InlineHistoryTargets,full=false,importOnly=false,importRunId?:string):Promise<ThreadSnapshot> {
  const read=async(all:boolean)=>{
    const started=Date.now();
    const snapshot=readThreadSnapshot(normalizeV2Snapshot(await access.api(`/api/orchestration/threads/${encodeURIComponent(threadId)}?reasoningMessages=true${all?'':'&turnLimit=20'}${importOnly?'&importRuns=true':''}${importRunId?'&importRunId='+encodeURIComponent(importRunId):''}`)));
    if(snapshot?.thread?.id!==threadId||projectId&&snapshot.thread.projectId!==projectId)throw Error('Waiting for the requested T3 thread.');
    logEvent('response.source.snapshot',{threadId,fullHistory:all,snapshotSequence:snapshot.snapshotSequence,turns:Object.keys(snapshot.thread.turns??{}).length,messages:snapshot.thread.messages?.length,elapsedMs:Date.now()-started,targets:targets?.messageIds.length});
    return snapshot;
  };
  const snapshot=await read(full);
  if(!full&&targets&&needsInlineHistory(applyThreadItem({messages:[],activities:[]},{kind:'snapshot',snapshot}).state,targets)){logEvent('response.source.history-required',{threadId,targets:targets.messageIds.length});return read(true);}
  return snapshot;
}

/** Bounded, one-shot protocol replay for exact start/turn evidence absent from
 * canonical latestTurn. The caller owns lifecycle cancellation; no elapsed
 * deadline, polling loop, or database is involved. */
export async function readInlineEvents(access:ThreadAccess,threadId:string,afterSequence:number,signal:AbortSignal,makeSocket:(url:string)=>WebSocket=url=>new WebSocket(url)):Promise<ThreadStreamItem[]> {
  const issued=await access.api('/api/auth/websocket-ticket',{});
  if(signal.aborted)throw Error('T3 binding recovery canceled.');
  if(!isRecord(issued)||typeof issued.ticket!=='string'||!issued.ticket)throw Error('T3 did not issue a stream ticket.');
  const url=new URL('/ws',access.origin);url.protocol=url.protocol==='https:'?'wss:':'ws:';
  url.searchParams.set('wsTicket',issued.ticket);url.searchParams.set('orchestrationProtocol',String(T3_PROTOCOL_VERSION));
  return new Promise((resolve,reject)=>{
    const socket=makeSocket(url.href),items:ThreadStreamItem[]=[];let finished=false;
    const abort=()=>finish(Error('T3 binding recovery canceled.'));
    const finish=(error?:Error)=>{if(finished)return;finished=true;signal.removeEventListener('abort',abort);try{socket.send(JSON.stringify({_tag:'Interrupt',requestId:'1'}));}catch{/* The closed socket needs no replay interruption. */}socket.close();error?reject(error):resolve(items);};
    signal.addEventListener('abort',abort,{once:true});
    socket.onopen=()=>{if(signal.aborted){abort();return;}access.api.trackConnection?.({get closed(){return finished;}});socket.send(JSON.stringify({_tag:'Request',id:'1',tag:'orchestration.subscribeThread',payload:{threadId,afterSequence,requestCompletionMarker:true,acceptBoundedSnapshot:true,acceptCompactTurnItems:true},headers:[]}));};
    socket.onmessage=message=>{try{
      if(typeof message.data!=='string')throw Error('T3 returned an incompatible stream frame.');
      const decoded=parseJson(message.data);
      for(const frame of Array.isArray(decoded)?decoded:[decoded]){
        if(!isRecord(frame))throw Error('Invalid T3 stream frame.');
        if(frame._tag==='Ping'){socket.send(JSON.stringify({_tag:'Pong'}));continue;}
        if(frame._tag==='Defect')throw Error('T3 binding replay failed.');
        if(String(frame.requestId)!=='1')continue;
        if(frame._tag==='Chunk'){
          if(!Array.isArray(frame.values))throw Error('Invalid T3 binding replay.');
          for(const item of frame.values as unknown[]){if(isRecord(item)&&item.kind==='synchronized'){finish();return;}if(items.length>=1001)throw Error('T3 binding replay exceeded its event limit.');items.push(normalizeV2StreamItem(item));}
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
export function watchThread(threadId:string,accessFactory:ThreadAccessFactory,callbacks:ThreadStreamCallbacks,makeSocket:(url:string)=>WebSocket=url=>new WebSocket(url),historyTargets?:()=>InlineHistoryTargets,replay?:{afterSequence:()=>number|undefined;pollSnapshots?:boolean|(()=>boolean);pollImmediately?:boolean;jitter?:boolean;titleOnly?:boolean;diagnostics?:()=>StreamDiagnosticContext}) {
  let stopped=false,socket:WebSocket|undefined,timer:ReturnType<typeof setTimeout>|undefined,pollTimer:ReturnType<typeof setTimeout>|undefined,attempt=0;
  let access:ThreadAccess|undefined;
  let snapshotBlocked=false,lastFrameDiagnostic=0;
  type Attempt={id:string;startedAt:number;openedAt?:number;lastFrameAt?:number;lastDataAt?:number;lastReceivedSequence?:number;lastEventOccurredAt?:string;recoveryAt?:number;expiresAt?:number;pollFailed?:boolean;socketData?:boolean;closeReported?:boolean;route?:ThreadAccess['diagnosticRoute'];cause?:string};
  const monitorId=`stream-${++streamMonitors}`;let generation=0,current:Attempt|undefined,recoveringAt:number|undefined;
  const report=(state:Attempt|undefined,event:string,fields:Record<string,unknown>={},level:'info'|'warning'='info')=>{
    try{const now=Date.now();logEvent(event,{threadId,monitorId,streamId:state?.id,role:replay?.titleOnly?'title':'response',...replay?.diagnostics?.(),...state?.route,afterSequence:replay?.afterSequence(),lastReceivedSequence:state?.lastReceivedSequence,lastEventOccurredAt:state?.lastEventOccurredAt,authExpiresInMs:state?.expiresAt===undefined?undefined:state.expiresAt-now,openedMs:state?.openedAt===undefined?undefined:Math.max(0,now-state.openedAt),lastFrameAgeMs:state?.lastFrameAt===undefined?undefined:Math.max(0,now-state.lastFrameAt),lastDataAgeMs:state?.lastDataAt===undefined?undefined:Math.max(0,now-state.lastDataAt),...fields},level);}catch{/* Diagnostics cannot alter stream delivery. */}
  };
  const pollEnabled=()=>!snapshotBlocked&&(typeof replay?.pollSnapshots==='function'?replay.pollSnapshots():replay?.pollSnapshots!==false);
  const closeAccess=(reason:ThreadAccessCloseReason)=>{if(pollTimer)clearTimeout(pollTimer);pollTimer=undefined;const old=access;access=undefined;if(old?.close)void Promise.resolve(old.close(reason)).catch(()=>{});};
  const retry=(error:Error,state:Attempt,cause:string,fields:Record<string,unknown>={})=>{
    if(stopped)return;
    const base=Math.min(30_000,1000*2**Math.min(attempt++,5)),delay=base+(replay?.jitter?Math.floor(Math.random()*Math.min(1000,base/4)):0);state.cause=cause;recoveringAt??=Date.now();
    report(state,'stream.reconnecting',{cause,error,attempt,retryDelayMs:delay,...fields},'warning');
    callbacks.reconnecting(error);closeAccess('stream-reconnect');
    timer=setTimeout(()=>{void connect();},delay);
  };
  const connect=async()=>{
    if(stopped)return;
    const state:Attempt=current={id:`${monitorId}:${++generation}`,startedAt:Date.now(),recoveryAt:recoveringAt};let stage='access';
    report(state,'stream.connecting',{attempt:attempt+1});
    let ready:ThreadAccess;
    try{
      ready=await accessFactory();
      if(stopped){await ready.close?.('late-access');return;}
      access=ready;
      state.route=ready.diagnosticRoute;state.expiresAt=ready.expiresAt;
      let ws:WebSocket|undefined,ended=false,polling=false,pollDue=0,pollDelay=1200,activityVersion=0,lastSnapshotHash:string|undefined;
      let setupSubscribed=false,setupWanted=false,socketOpen=false;
      const subscribeSetup=()=>{if(setupWanted&&!setupSubscribed&&socketOpen&&ws){setupSubscribed=true;ws.send(JSON.stringify({_tag:'Request',id:'2',tag:'subscribeWorktreeSetup',payload:{threadId},headers:[]}));}};
      const deliver=(item:ThreadStreamItem,source:'socket'|'snapshot'='socket')=>{
        callbacks.item(item);
        const sequence=item.kind==='snapshot'?item.snapshot?.snapshotSequence:item.kind==='event'?item.event?.sequence:undefined;
        if(typeof sequence==='number'&&Number.isSafeInteger(sequence))state.lastReceivedSequence=Math.max(state.lastReceivedSequence??0,sequence);
        if(item.kind==='event'&&item.event.occurredAt)state.lastEventOccurredAt=item.event.occurredAt;
        state.lastDataAt=Date.now();
        if(source==='socket'&&!state.socketData){state.socketData=true;report(state,'stream.recovered',{cause:state.recoveryAt===undefined?'initial-data':'first-data',recoveryMs:state.recoveryAt===undefined?undefined:Math.max(0,Date.now()-state.recoveryAt),connectMs:Date.now()-state.startedAt});recoveringAt=undefined;}
        const preparation=item.kind==='snapshot'?item.snapshot?.thread?.activities?.some(a=>a.kind==='response.worktree-setup'):item.kind==='event'&&item.event?.type==='v2.turn-item.updated'&&workspacePreparation(item.event.payload);
        if(preparation&&!replay?.titleOnly){setupWanted=true;subscribeSetup();}
      };
      const fail=(error:Error,cause:string,fields:Record<string,unknown>={})=>{if(ended||stopped)return;ended=true;state.cause=cause;ws?.close();retry(error,state,cause,fields);};
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
          const snapshot=historyTargets?await readInlineSnapshot(ready,threadId,undefined,historyTargets()):readThreadSnapshot(normalizeV2Snapshot(await ready.api(`/api/orchestration/threads/${encodeURIComponent(threadId)}?reasoningMessages=true&turnLimit=20`)));
          if(!stopped&&!ended&&access===ready&&snapshot?.thread){
            // The global snapshot cursor can advance for unrelated threads.
            // Keep only a small digest; still deliver every canonical snapshot
            // so replay cursors and binding evidence continue to advance.
            const hash=contentHash(JSON.stringify({thread:snapshot.thread,historyComplete:snapshot.thread.historyComplete??!snapshot.page?.hasMore}));
            pollDelay=beforeActivity===activityVersion&&hash===lastSnapshotHash?Math.min(5000,pollDelay*2):1200;
            lastSnapshotHash=hash;deliver({kind:'snapshot',snapshot},'snapshot');
            if(state.pollFailed){state.pollFailed=false;report(state,'stream.poll.recovered',{cause:'snapshot-read'});}
          }else pollDelay=1200;
        }catch(error){pollDelay=1200;if(!stopped&&!ended&&access===ready){if(!state.pollFailed)report(state,'stream.poll.failed',{cause:'snapshot-read',error,socketOpen},'warning');state.pollFailed=true;if(responseTooLarge(error)){snapshotBlocked=true;callbacks.failure?.(error as Error);}else callbacks.reconnecting(error instanceof Error?error:Error('Cannot read the T3 response.'));}}
        finally{polling=false;schedulePoll(pollDelay);}
      };
      // A browser timer can delay even a zero-delay read after app suspension.
      // Current text does not depend on a socket ticket or socket opening.
      if(replay?.pollImmediately&&pollEnabled())void poll();
      stage='ticket';const issued=await ready.api('/api/auth/websocket-ticket',{});
      if(stopped||access!==ready)return;
      if(!isRecord(issued)||typeof issued.ticket!=='string'||!issued.ticket)throw Error('T3 did not issue a stream ticket.');
      const url=new URL('/ws',ready.origin);url.protocol=url.protocol==='https:'?'wss:':'ws:';
      url.searchParams.set('wsTicket',issued.ticket);url.searchParams.set('orchestrationProtocol',String(T3_PROTOCOL_VERSION));
      stage='socket-create';const openedSocket=socket=ws=makeSocket(url.href);
      openedSocket.onopen=()=>{
        if(stopped||ended){openedSocket.close();return;}
        ready.api.trackConnection?.({get closed(){return ended||stopped;}});
        socketOpen=true;
        state.openedAt=Date.now();report(state,'stream.connected',{connectMs:Date.now()-state.startedAt});attempt=0;
        // Tickets authorize opening the socket. Keep a healthy subscription;
        // actual session expiry/revocation closes it through the normal retry path.
        openedSocket.send(JSON.stringify({_tag:'Request',id:'1',tag:'orchestration.subscribeThread',payload:{threadId,acceptBoundedSnapshot:true,acceptCompactTurnItems:true,...(replay?{afterSequence:replay.afterSequence(),requestCompletionMarker:true}:{})},headers:[]}));
        subscribeSetup();
        // Subscription hosts already own a full canonical polling loop. A second
        // recent-history poll would repeatedly replace it with partial history.
        if(replay?.pollImmediately&&pollEnabled())void poll();else schedulePoll(1200);
      };
      openedSocket.onmessage=message=>{
        if(stopped||ended)return;
        const diagnostic=Date.now()-lastFrameDiagnostic>=1000&&diagnosticEnabled('response.source.frame'),started=diagnostic?performance.now():0;
        try{
          if(typeof message.data!=='string')throw Error('T3 returned an incompatible stream frame.');
          const decoded=parseJson(message.data),frames=Array.isArray(decoded)?decoded:[decoded];
          state.lastFrameAt=Date.now();
          for(const frame of frames){
            if(!isRecord(frame))throw Error('Invalid T3 stream frame.');
            if(frame._tag==='Ping'){openedSocket.send(JSON.stringify({_tag:'Pong'}));continue;}
            // Optional setup progress must not fail the transcript on older hosts.
            if(String(frame.requestId)==='2'){
              if(frame._tag==='Chunk'){
                for(const value of Array.isArray(frame.values)?frame.values:[]){
                  const setup=readWorktreeSetup(value,threadId);
                  if(setup)callbacks.item({kind:'event',event:{type:'thread.worktree-setup',aggregateId:threadId,payload:setup}});
                }
                openedSocket.send(JSON.stringify({_tag:'Ack',requestId:'2'}));
              }
              continue;
            }
            if(frame._tag==='Defect')throw Error('T3 thread stream failed.');
            if(String(frame.requestId)!=='1')continue;
            if(frame._tag==='Chunk'){
              if(!Array.isArray(frame.values))throw Error('T3 returned an invalid stream chunk.');
              for(const value of frame.values as unknown[]){
                if(!isRecord(value))throw Error('Invalid T3 stream item.');
                if(value.kind==='event'||value.kind==='snapshot'){
                  activityVersion++;pollDelay=1200;lastSnapshotHash=undefined;schedulePoll(1200);
                }
                deliver(replay?.titleOnly?normalizeV2TitleItem(value):normalizeV2StreamItem(value));
              }
              openedSocket.send(JSON.stringify({_tag:'Ack',requestId:'1'}));
            }else if(frame._tag==='Exit'){
              throw Error('T3 thread stream ended.');
            }
          }
        }catch(error){fail(error instanceof Error?error:Error('T3 returned an invalid thread stream.'),'stream-frame');}
        finally{if(diagnostic){lastFrameDiagnostic=Date.now();logEvent('response.source.frame',{threadId,monitorId,streamId:state.id,lastReceivedSequence:state.lastReceivedSequence,lastEventOccurredAt:state.lastEventOccurredAt,frameLength:typeof message.data==='string'?message.data.length:undefined,processingMs:performance.now()-started});}}
      };
      openedSocket.onerror=()=>fail(Error('T3 thread stream connection failed.'),'socket-error');
      openedSocket.onclose=event=>{const fields={closeCode:event?.code,closeReason:event?.reason,wasClean:event?.wasClean};if(!state.closeReported){state.closeReported=true;report(state,'stream.closed',{cause:state.cause??(stopped?'caller-stopped':'socket-close'),...fields});}if(!ended&&!stopped)fail(Error('T3 thread stream closed.'),'socket-close',fields);};
    }catch(error){retry(error instanceof Error?error:Error('Cannot open T3 thread stream.'),state,stage);}
  };
  void connect();
  return {stop(){if(stopped)return;report(current,'stream.stopped',{cause:'caller-stopped'});stopped=true;if(timer)clearTimeout(timer);if(socket){try{socket.send(JSON.stringify({_tag:'Interrupt',requestId:'1'}));}catch{/* Connection is already gone. */}socket.close();}closeAccess('stream-stopped');}};
}
