import {isRecord,parseJson,toError,records} from '../shared/values';
import {scheduleTimeout as setTimeout,cancelTimeout as clearTimeout} from '../shared/clock';
import {T3_PROTOCOL_VERSION} from './orchestration-v2';
import type {RouteConnection} from './route-status';

export type T3Api=((path:string,payload?:unknown,options?:{signal?:AbortSignal;compactImport?:boolean})=>Promise<unknown>)&{trackConnection?:(connection:RouteConnection)=>void;cachedImportThreads?:(projectId:string)=>import('../conversations/thread-target').ThreadChoice[]|undefined;importCacheIdentity?:object;prepareImportCatalog?:(signal?:AbortSignal)=>Promise<void>;watchImportThreads?:(projectId:string,changed:()=>void)=>()=>void};
export interface T3RpcConnection extends RouteConnection {call(tag:string,payload:unknown):Promise<unknown>;close():void}
export type SocketFactory=(url:string)=>WebSocket;
export interface RpcClock {now():number;timer(callback:()=>void,milliseconds:number):ReturnType<typeof setTimeout>;clear(timer:ReturnType<typeof setTimeout>):void}
const clock:RpcClock={now:()=>typeof performance==='undefined'?Date.now():performance.now(),timer:(callback,milliseconds)=>{const timer=setTimeout(callback,milliseconds);if(typeof timer!=='number')timer.unref?.();return timer;},clear:timer=>clearTimeout(timer)};
export class T3ConnectionTimeoutError extends Error {
  readonly name='T3ConnectionTimeoutError';readonly kind='ConnectionTimeout';readonly confirmed=true;
  constructor(readonly connectionId:string,readonly rpcMethod:string,readonly elapsedMs:number,readonly pendingCount:number,readonly idleMs:number){super('The selected machine stopped responding. Reconnecting.');}
}
export class T3RequestTimeoutError extends Error {
  readonly name='T3RequestTimeoutError';readonly kind='RpcTimeout';
  constructor(readonly rpcMethod:string,readonly elapsedMs:number){super('The selected machine took too long to complete this request. Its connection is responding.');}
}
export class T3RpcError extends Error {
  constructor(public kind:string,public requiredPermission?:string,public rpcMethod?:string){super(kind==='EnvironmentAuthorizationError'&&['settings:write','providers:manage'].includes(requiredPermission??'')?'This T3 connection does not permit MCP setup. Reconnect it with agent configuration access or use your T3 account.':kind==='EnvironmentAuthorizationError'&&['filesystem:read','filesystem:write'].includes(requiredPermission??'')?'The T3 connection does not permit note access. Reconnect this machine in T3 Code settings with filesystem read and write access.':kind==='ProjectReadFileError'?'Cannot read the synced vault settings in this folder.':kind==='FilesystemBrowseError'?'Cannot open this folder on the selected machine.':'The selected machine could not complete the T3 request.');}
}

/** Unary requests over T3's authenticated Effect RPC protocol. */
export async function connectT3Rpc(api:T3Api,origin:string,makeSocket:SocketFactory=url=>new WebSocket(url),time:RpcClock=clock):Promise<T3RpcConnection>{
  const issued=await api('/api/auth/websocket-ticket',{});
  if(!isRecord(issued)||typeof issued.ticket!=='string'||!issued.ticket)throw Error('T3 did not issue a connection ticket.');
  const url=new URL('/ws',origin);url.protocol=url.protocol==='https:'?'wss:':'ws:';
  url.searchParams.set('wsTicket',issued.ticket);url.searchParams.set('orchestrationProtocol',String(T3_PROTOCOL_VERSION));
  const socket=makeSocket(url.href);let closed=false,failure:Error|undefined,nextId=0;
  const pending=new Map<string,{resolve:(value:unknown)=>void;reject:(error:Error)=>void;method:string;started:number}>();
  const fail=(error:Error)=>{
    if(closed)return;closed=true;failure=error;
    for(const task of pending.values())task.reject(error);pending.clear();
    try{socket.close();}catch{/* The closed socket cannot prevent cleanup. */}
  };
  let opened=false,resolveOpen!:()=>void,rejectOpen!:(e:Error)=>void;
  const ready=new Promise<void>((resolve,reject)=>{resolveOpen=resolve;rejectOpen=reject;});
  socket.onopen=()=>{if(closed)return;opened=true;resolveOpen();};
  socket.onerror=()=>{const error=Error('Cannot reach the selected machine. Your message is still in Obsidian.');rejectOpen(error);fail(error);};
  socket.onclose=()=>{const error=Error('The connection to the selected machine closed. Try again.');if(!opened)rejectOpen(error);fail(error);};
  socket.onmessage=event=>{
    try{
      if(typeof event.data!=='string')throw Error('T3 returned an incompatible response.');
      const decoded=parseJson(event.data);const frames:unknown[]=Array.isArray(decoded)?decoded:[decoded];
      for(const frame of frames){
        if(closed)return;
        if(!isRecord(frame))throw Error('Invalid RPC frame.');
        if(frame._tag==='Pong'){continue;}
        if(frame._tag==='Ping'){socket.send(JSON.stringify({_tag:'Pong'}));continue;}
        if(frame._tag==='Defect')throw Error('This T3 version could not process the request.');
        const id=String(frame.requestId),task=pending.get(id);if(!task||frame._tag!=='Exit')continue;
        pending.delete(id);
        if(isRecord(frame.exit)&&frame.exit._tag==='Success')task.resolve(frame.exit.value);
        else {const causes=isRecord(frame.exit)?frame.exit.cause:undefined;const cause=records(causes).find(x=>x._tag==='Fail')?.error,failure=isRecord(cause)?cause:undefined;const required=failure?.requiredPermission;const permission=typeof required==='string'&&['filesystem:read','filesystem:write','orchestration:read','orchestration:operate','settings:write','providers:manage'].includes(required)?required:undefined;task.reject(new T3RpcError(typeof failure?._tag==='string'?failure._tag:'RpcError',permission,task.method));}
      }
    }catch{fail(Error('T3 returned an incompatible response.'));}
  };
  try{await ready;}catch(error){fail(error instanceof Error?error:Error(String(error)));throw toError(error);}
  const rpc=async(tag:string,payload:unknown):Promise<unknown>=>{
    const result=await new Promise<unknown>((resolve,reject)=>{
    if(closed){reject(Error('The machine connection closed. Choose the machine again.'));return;}
    const id=String(++nextId),started=time.now();
    pending.set(id,{resolve,reject,method:tag,started});
    try{socket.send(JSON.stringify({_tag:'Request',id,tag,payload,headers:[]}));}catch{fail(Error('Cannot send the request to this machine.'));}
    });
    return result;
  };
  const connection={call:rpc,get closed(){return closed;},get error(){return failure;},close(){if(closed)return;fail(Error('T3 connection closed.'));failure=undefined;}};
  api.trackConnection?.(connection);
  return connection;
}
