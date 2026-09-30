import {Buffer} from 'buffer';

export interface ThreadAccess {origin:string;api:(path:string,payload?:any)=>Promise<any>;close?:()=>Promise<void>|void}
export type ThreadAccessFactory=()=>Promise<ThreadAccess>;
export type ThreadStreamItem={kind:'snapshot';snapshot:any}|{kind:'event';event:any}|{kind:'synchronized'};
export interface ThreadStreamCallbacks {item:(item:ThreadStreamItem)=>void;reconnecting:(error:Error)=>void}

/** The Effect RPC stream stays open until stopped. Every reconnect asks for a
 * fresh snapshot, so lost deltas cannot duplicate text or leave a gap. */
export function watchThread(threadId:string,accessFactory:ThreadAccessFactory,callbacks:ThreadStreamCallbacks,makeSocket:(url:string)=>WebSocket=url=>new WebSocket(url)) {
  let stopped=false,socket:WebSocket|undefined,timer:ReturnType<typeof setTimeout>|undefined,rotation:ReturnType<typeof setTimeout>|undefined,pollTimer:ReturnType<typeof setTimeout>|undefined,attempt=0;
  let access:ThreadAccess|undefined;
  const closeAccess=()=>{if(pollTimer)clearTimeout(pollTimer);pollTimer=undefined;const old=access;access=undefined;if(old?.close)void Promise.resolve(old.close()).catch(()=>{});};
  const retry=(error:Error)=>{
    if(stopped)return;
    if(rotation)clearTimeout(rotation);
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
          const snapshot=await ready.api(`/api/orchestration/threads/${encodeURIComponent(threadId)}?turnLimit=20`);
          if(!stopped&&!ended&&access===ready&&snapshot?.thread)callbacks.item({kind:'snapshot',snapshot});
        }catch{/* The socket may still be healthy; the next bounded read can recover. */}
        if(!stopped&&!ended&&access===ready)pollTimer=setTimeout(()=>{void poll();},1200);
      };
      const opening=setTimeout(()=>fail(Error('T3 thread stream did not connect.')),15_000);
      ws.onopen=()=>{
        clearTimeout(opening);if(stopped){ws.close();return;}
        attempt=0;
        rotation=setTimeout(()=>fail(Error('Refreshing the T3 stream session.')),4*60_000);
        ws.send(JSON.stringify({_tag:'Request',id:'1',tag:'orchestration.subscribeThread',payload:{threadId},headers:[]}));
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
  return {stop(){stopped=true;if(timer)clearTimeout(timer);if(rotation)clearTimeout(rotation);if(socket){try{socket.send(JSON.stringify({_tag:'Interrupt',requestId:'1'}));}catch{/* Connection is already gone. */}socket.close();}closeAccess();}};
}
