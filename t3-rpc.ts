import {Buffer} from 'buffer';
import {T3_PROTOCOL_VERSION} from './orchestration-v2';

export type T3Api=(path:string,payload?:any)=>Promise<any>;
export type SocketFactory=(url:string)=>WebSocket;
export const RPC_REQUEST_TIMEOUT_MS=15_000,RPC_HEALTH_INTERVAL_MS=5_000,RPC_HEALTH_TIMEOUT_MS=3_000;
export interface RpcClock {now():number;timer(callback:()=>void,milliseconds:number):ReturnType<typeof setTimeout>;clear(timer:ReturnType<typeof setTimeout>):void}
const clock:RpcClock={now:()=>globalThis.performance?.now()??Date.now(),timer:(callback,milliseconds)=>{const timer=setTimeout(callback,milliseconds);(timer as any).unref?.();return timer;},clear:timer=>clearTimeout(timer)};
export class T3ConnectionTimeoutError extends Error {
  readonly name='T3ConnectionTimeoutError';readonly kind='ConnectionTimeout';readonly confirmed=true;
  constructor(readonly connectionId:string,readonly rpcMethod:string,readonly elapsedMs:number,readonly pendingCount:number,readonly idleMs:number){super('The selected machine stopped responding. Reconnecting.');}
}
export class T3RequestTimeoutError extends Error {
  readonly name='T3RequestTimeoutError';readonly kind='RpcTimeout';
  constructor(readonly rpcMethod:string,readonly elapsedMs:number){super('The selected machine took too long to complete this request. Its connection is responding.');}
}
let connections=0;
export class T3RpcError extends Error {
  constructor(public kind:string,public requiredPermission?:string,public rpcMethod?:string){super(kind==='EnvironmentAuthorizationError'&&['filesystem:read','filesystem:write'].includes(requiredPermission??'')?'The T3 connection does not permit note access. Reconnect this machine in Send to T3 Code settings with filesystem read and write access.':kind==='ProjectReadFileError'?'Cannot read the synced vault settings in this folder.':kind==='FilesystemBrowseError'?'Cannot open this folder on the selected machine.':'The selected machine could not complete the T3 request.');}
}

/** Unary requests over T3's authenticated Effect RPC protocol. */
export async function connectT3Rpc(api:T3Api,origin:string,makeSocket:SocketFactory=url=>new WebSocket(url),time:RpcClock=clock){
  const issued=await api('/api/auth/websocket-ticket',{});
  if(typeof issued?.ticket!=='string'||!issued.ticket)throw Error('T3 did not issue a connection ticket.');
  const url=new URL('/ws',origin);url.protocol=url.protocol==='https:'?'wss:':'ws:';
  url.searchParams.set('wsTicket',issued.ticket);url.searchParams.set('orchestrationProtocol',String(T3_PROTOCOL_VERSION));
  const socket=makeSocket(url.href),connectionId=`rpc-${++connections}`;let closed=false,nextId=0,lastReply=time.now(),healthTimer:ReturnType<typeof setTimeout>|undefined;
  const pending=new Map<string,{resolve:(value:any)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>;method:string;started:number}>();
  let probe:{work:Promise<void>;resolve():void;reject(error:Error):void;timer:ReturnType<typeof setTimeout>}|undefined;
  const finish=(error:Error)=>{for(const task of pending.values()){time.clear(task.timer);task.reject(error instanceof T3ConnectionTimeoutError?new T3ConnectionTimeoutError(connectionId,task.method,Math.max(0,time.now()-task.started),error.pendingCount,error.idleMs):error);}pending.clear();};
  const fail=(error:Error)=>{
    if(closed)return;closed=true;if(healthTimer!==undefined)time.clear(healthTimer);healthTimer=undefined;
    if(probe){time.clear(probe.timer);probe.reject(error);probe=undefined;}finish(error);
    try{socket.close();}catch{/* The dead socket cannot prevent recovery. */}
  };
  const scheduleHealth=()=>{
    if(closed||probe)return;if(healthTimer!==undefined)time.clear(healthTimer);
    healthTimer=time.timer(()=>{healthTimer=undefined;void check().catch(()=>{});},Math.max(1,RPC_HEALTH_INTERVAL_MS-(time.now()-lastReply)));
  };
  const received=()=>{lastReply=time.now();if(probe){time.clear(probe.timer);probe.resolve();probe=undefined;}scheduleHealth();};
  const check=():Promise<void>=>{
    if(closed)return Promise.reject(Error('The machine connection closed.'));
    if(probe)return probe.work;
    let resolve!:()=>void,reject!:(error:Error)=>void;const work=new Promise<void>((yes,no)=>{resolve=yes;reject=no;});
    // Effect RPC's server answers client Ping with Pong. A valid request reply
    // also proves the shared transport is alive; a slow file alone must not
    // cancel concurrent requests or cause an app reload.
    probe={work,resolve,reject,timer:time.timer(()=>fail(new T3ConnectionTimeoutError(connectionId,'health.ping',RPC_HEALTH_TIMEOUT_MS,pending.size,Math.max(0,time.now()-lastReply))),RPC_HEALTH_TIMEOUT_MS)};
    try{socket.send(JSON.stringify({_tag:'Ping'}));}catch{fail(Error('Cannot reach the selected machine.'));}
    return work;
  };
  let opened=false,resolveOpen!:()=>void,rejectOpen!:(e:Error)=>void;
  const ready=new Promise<void>((resolve,reject)=>{resolveOpen=resolve;rejectOpen=reject;});
  const openTimer=time.timer(()=>{const error=Error('The selected machine did not connect. Try again when it is online.');rejectOpen(error);fail(error);},RPC_REQUEST_TIMEOUT_MS);
  socket.onopen=()=>{if(closed)return;opened=true;time.clear(openTimer);lastReply=time.now();scheduleHealth();resolveOpen();};
  socket.onerror=()=>{const error=Error('Cannot reach the selected machine. Your message is still in Obsidian.');time.clear(openTimer);rejectOpen(error);fail(error);};
  socket.onclose=()=>{time.clear(openTimer);const error=Error('The connection to the selected machine closed. Try again.');if(!opened)rejectOpen(error);fail(error);};
  socket.onmessage=event=>{
    try{
      if(typeof event.data!=='string'||Buffer.byteLength(event.data)>4_000_000)throw Error('T3 returned an oversized response.');
      const decoded=JSON.parse(event.data);const frames=Array.isArray(decoded)?decoded:[decoded];
      for(const frame of frames){
        if(closed)return;
        if(frame._tag==='Pong'){received();continue;}
        if(frame._tag==='Ping'){received();socket.send(JSON.stringify({_tag:'Pong'}));continue;}
        if(frame._tag==='Defect')throw Error('This T3 version could not process the request.');
        const id=String(frame.requestId),task=pending.get(id);if(!task||frame._tag!=='Exit')continue;
        received();pending.delete(id);time.clear(task.timer);
        if(frame.exit?._tag==='Success')task.resolve(frame.exit.value);
        else {const causes=frame.exit?.cause;const failure=Array.isArray(causes)?causes.find((x:any)=>x._tag==='Fail')?.error:undefined;const permission=['filesystem:read','filesystem:write','orchestration:read','orchestration:operate'].includes(failure?.requiredPermission)?failure.requiredPermission:undefined;task.reject(new T3RpcError(failure?._tag??'RpcError',permission,task.method));}
      }
    }catch{fail(Error('T3 returned an incompatible response.'));}
  };
  try{await ready;}catch(error){fail(error instanceof Error?error:Error(String(error)));throw error;}
  const rpc=async(tag:string,payload:any)=>{
    // A laptop waking from sleep checks the old socket before putting another
    // file request on it, even if the browser never emitted onclose.
    if(!closed&&time.now()-lastReply>=RPC_HEALTH_INTERVAL_MS)await check();
    return new Promise<any>((resolve,reject)=>{
    if(closed){reject(Error('The machine connection closed. Choose the machine again.'));return;}
    const id=String(++nextId),started=time.now(),timer=time.timer(()=>{
      void check().then(()=>{const task=pending.get(id);if(!task)return;pending.delete(id);task.reject(new T3RequestTimeoutError(tag,Math.max(0,time.now()-started)));},()=>{});
    },RPC_REQUEST_TIMEOUT_MS);
    pending.set(id,{resolve,reject,timer,method:tag,started});
    try{socket.send(JSON.stringify({_tag:'Request',id,tag,payload,headers:[]}));}catch{fail(Error('Cannot send the request to this machine.'));}
    });
  };
  return {call:rpc,get closed(){return closed;},close(){time.clear(openTimer);fail(Error('T3 connection closed.'));}};
}
