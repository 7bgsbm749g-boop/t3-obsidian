import {logEvent,logFailure} from './diagnostics';
import {Buffer} from 'buffer';
import {applyThreadItem,turnForMessage,type InlineThreadState} from './inline-thread';

export interface ThreadAccess {origin:string;api:(path:string,payload?:any)=>Promise<any>;close?:()=>Promise<void>|void}
export type ThreadAccessFactory=()=>Promise<ThreadAccess>;
export type ThreadStreamItem={kind:'snapshot';snapshot:any}|{kind:'event';event:any}|{kind:'synchronized'};
export interface ThreadStreamCallbacks {item:(item:ThreadStreamItem)=>void;reconnecting:(error:Error)=>void}
export interface InlineHistoryTargets {messageIds:string[];turnIds:string[]}

export function needsInlineHistory(state:InlineThreadState,targets:InlineHistoryTargets):boolean {
  return state.historyComplete===false&&(targets.messageIds.some(id=>!turnForMessage(state,id))||targets.turnIds.some(id=>id!==state.latestTurn?.turnId));
}

/** Recent polling stays small. A stranded response can request the complete
 * canonical transcript, including prompts older than the polling window. */
export async function readInlineSnapshot(access:ThreadAccess,threadId:string,projectId?:string,targets?:InlineHistoryTargets,full=false):Promise<any> {
  const read=async(all:boolean)=>{
    const snapshot=await access.api(`/api/orchestration/threads/${encodeURIComponent(threadId)}?reasoningMessages=true${all?'':'&turnLimit=20'}`);
    if(snapshot?.thread?.id!==threadId||projectId&&snapshot.thread.projectId!==projectId)throw Error('Waiting for the requested T3 thread.');
    return snapshot;
  };
  const snapshot=await read(full);
  if(!full&&targets&&needsInlineHistory(applyThreadItem({messages:[],activities:[]},{kind:'snapshot',snapshot}).state,targets))return read(true);
  return snapshot;
}

/** The Effect RPC stream stays open until stopped. Every reconnect asks for a
 * fresh snapshot, so lost deltas cannot duplicate text or leave a gap. */
export function watchThread(threadId:string,accessFactory:ThreadAccessFactory,callbacks:ThreadStreamCallbacks,makeSocket:(url:string)=>WebSocket=url=>new WebSocket(url),historyTargets?:()=>InlineHistoryTargets,replay?:{afterSequence:()=>number|undefined}) {
  let stopped=false,socket:WebSocket|undefined,timer:ReturnType<typeof setTimeout>|undefined,rotation:ReturnType<typeof setTimeout>|undefined,pollTimer:ReturnType<typeof setTimeout>|undefined,attempt=0;
  let access:ThreadAccess|undefined;
  const closeAccess=()=>{if(pollTimer)clearTimeout(pollTimer);pollTimer=undefined;const old=access;access=undefined;if(old?.close)void Promise.resolve(old.close()).catch(()=>{});};
  const retry=(error:Error)=>{
    if(stopped)return;
    if(rotation)clearTimeout(rotation);
    logFailure('stream.reconnecting',error,{threadId,attempt});logEvent('stream.disconnected',{threadId});
    callbacks.reconnecting(error);closeAccess();
    const delay=Math.min(30_000,1000*2**Math.min(attempt++,5));
    timer=setTimeout(()=>{void connect();},delay);
  };
  const connect=async()=>{
    if(stopped)return;
    let ready:ThreadAccess;
    try{
      ready=await accessFactory();
      if(stopped){await ready.close?.();return;}
      access=ready;
      const issued=await ready.api('/api/auth/websocket-ticket',{});
      if(typeof issued?.ticket!=='string'||!issued.ticket)throw Error('T3 did not issue a stream ticket.');
      const url=new URL('/ws',ready.origin);url.protocol=url.protocol==='https:'?'wss:':'ws:';
      url.searchParams.set('wsTicket',issued.ticket);url.searchParams.set('orchestrationProtocol','1');
      const ws=socket=makeSocket(url.href);let ended=false;
      const fail=(error:Error)=>{if(ended||stopped)return;ended=true;ws.close();retry(error);};
      const poll=async()=>{
        if(stopped||ended||access!==ready)return;
        try{
          const snapshot=historyTargets?await readInlineSnapshot(ready,threadId,undefined,historyTargets()):await ready.api(`/api/orchestration/threads/${encodeURIComponent(threadId)}?reasoningMessages=true&turnLimit=20`);
          if(!stopped&&!ended&&access===ready&&snapshot?.thread)callbacks.item({kind:'snapshot',snapshot});
        }catch(error){logFailure('stream.poll.failed',error,{threadId});}
        if(!stopped&&!ended&&access===ready)pollTimer=setTimeout(()=>{void poll();},1200);
      };
      const opening=setTimeout(()=>fail(Error('T3 thread stream did not connect.')),15_000);
      ws.onopen=()=>{
        clearTimeout(opening);if(stopped){ws.close();return;}
        logEvent('stream.connected',{threadId});attempt=0;
        rotation=setTimeout(()=>fail(Error('Refreshing the T3 stream session.')),4*60_000);
        ws.send(JSON.stringify({_tag:'Request',id:'1',tag:'orchestration.subscribeThread',payload:{threadId,reasoningMessages:true,...(replay?{afterSequence:replay.afterSequence(),requestCompletionMarker:true}:{})},headers:[]}));
        pollTimer=setTimeout(()=>{void poll();},1200);
      };
      ws.onmessage=message=>{
        try{
          if(typeof message.data!=='string'||Buffer.byteLength(message.data)>16_000_000)throw Error('T3 stream frame is too large.');
          const decoded=JSON.parse(message.data),frames=Array.isArray(decoded)?decoded:[decoded];
          for(const frame of frames){
            if(frame._tag==='Ping'){ws.send(JSON.stringify({_tag:'Pong'}));continue;}
            if(frame._tag==='Defect')throw Error('T3 thread stream failed.');
            if(String(frame.requestId)!=='1')continue;
            if(frame._tag==='Chunk'){
              if(!Array.isArray(frame.values))throw Error('T3 returned an invalid stream chunk.');
              logEvent('stream.chunk',{threadId,count:frame.values.length,sequence:frame.values.at(-1)?.event?.sequence??frame.values.at(-1)?.snapshot?.snapshotSequence});
              for(const value of frame.values)callbacks.item(value);
              ws.send(JSON.stringify({_tag:'Ack',requestId:'1'}));
            }else if(frame._tag==='Exit'){
              throw Error('T3 thread stream ended.');
            }
          }
        }catch(error){fail(error instanceof Error?error:Error('T3 returned an invalid thread stream.'));}
      };
      ws.onerror=()=>fail(Error('T3 thread stream connection failed.'));
      ws.onclose=()=>{clearTimeout(opening);fail(Error('T3 thread stream closed.'));};
    }catch(error){retry(error instanceof Error?error:Error('Cannot open T3 thread stream.'));}
  };
  void connect();
  return {stop(){logEvent('stream.stopped',{threadId});stopped=true;if(timer)clearTimeout(timer);if(rotation)clearTimeout(rotation);if(socket){try{socket.send(JSON.stringify({_tag:'Interrupt',requestId:'1'}));}catch{/* Connection is already gone. */}socket.close();}closeAccess();}};
}
