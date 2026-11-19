import {isRecord,parseJson,toError,records} from '../shared/values';
import {scheduleTimeout as setTimeout,cancelTimeout as clearTimeout} from '../shared/clock';
import {T3_PROTOCOL_VERSION} from './orchestration-v2';
import type {RouteConnection} from './route-status';

export type T3Api=((path:string,payload?:unknown,options?:import('./t3-api').T3RequestOptions)=>Promise<unknown>)&{acquireUnaryRpc?:(signal?:AbortSignal)=>Promise<T3RpcConnection>;disposeUnaryRpc?:()=>void;trackConnection?:(connection:RouteConnection)=>void;cachedImportThreads?:(projectId:string)=>import('../conversations/thread-target').ThreadChoice[]|undefined;importCacheIdentity?:object;prepareImportCatalog?:(signal?:AbortSignal)=>Promise<void>;watchImportThreads?:(projectId:string,changed:()=>void)=>()=>void};
export interface T3RpcConnection extends RouteConnection {call(tag:string,payload:unknown,onSent?:()=>void):Promise<unknown>;close():void}
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
export async function connectT3Rpc(api:T3Api,origin:string,makeSocket:SocketFactory=url=>new WebSocket(url),time:RpcClock=clock,signal?:AbortSignal,maxPending=Infinity):Promise<T3RpcConnection>{
  if(signal?.aborted)throw toError(signal.reason??Error('Request cancelled.'));
  const ticket=api('/api/auth/websocket-ticket',{},signal?{signal}:undefined);
  const issued=signal?await unaryRead(ticket,signal):await ticket;
  if(signal?.aborted)throw toError(signal.reason??Error('Request cancelled.'));
  if(!isRecord(issued)||typeof issued.ticket!=='string'||!issued.ticket)throw Error('T3 did not issue a connection ticket.');
  const url=new URL('/ws',origin);url.protocol=url.protocol==='https:'?'wss:':'ws:';
  url.searchParams.set('wsTicket',issued.ticket);url.searchParams.set('orchestrationProtocol',String(T3_PROTOCOL_VERSION));
  const socket=makeSocket(url.href);let closed=false,failure:Error|undefined,nextId=0;
  const pending=new Map<string,{resolve:(value:unknown)=>void;reject:(error:Error)=>void;method:string;started:number}>();
  const fail=(error:Error)=>{
    if(closed)return;closed=true;failure=error;signal?.removeEventListener('abort',cancel);rejectOpen(error);
    for(const task of pending.values())task.reject(error);pending.clear();
    try{socket.close();}catch{/* The closed socket cannot prevent cleanup. */}
  };
  let opened=false,resolveOpen!:()=>void,rejectOpen!:(e:Error)=>void;
  const ready=new Promise<void>((resolve,reject)=>{resolveOpen=resolve;rejectOpen=reject;});
  const cancel=()=>fail(toError(signal?.reason??Error('Request cancelled.')));
  signal?.addEventListener('abort',cancel,{once:true});
  if(signal?.aborted)cancel();
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
  const rpc=async(tag:string,payload:unknown,onSent?:()=>void):Promise<unknown>=>{
    const result=await new Promise<unknown>((resolve,reject)=>{
    if(closed){reject(Error('The machine connection closed. Choose the machine again.'));return;}
    if(pending.size>=maxPending){reject(Error('Too many pending unary requests. Retry when the current work finishes.'));return;}
    const id=String(++nextId),started=time.now();
    pending.set(id,{resolve,reject,method:tag,started});
    try{socket.send(JSON.stringify({_tag:'Request',id,tag,payload,headers:[]}));}catch{fail(Error('Cannot send the request to this machine.'));}
    if(!closed)onSent?.();
    });
    return result;
  };
  const connection={call:rpc,get closed(){return closed;},get error(){return failure;},close(){if(closed)return;fail(Error('T3 connection closed.'));failure=undefined;}};
  api.trackConnection?.(connection);
  return connection;
}

/** Credential-scoped ownership survives short-lived API authorization adapters. */
export class T3UnaryRpcOwner {
  private pool?:T3UnaryRpcPool;
  private disposed=false;
  connection(api:T3Api,origin:string,makeSocket:SocketFactory|undefined,validUntil:number){
    if(this.disposed)throw Error('The unary connection owner stopped.');
    return this.pool??=new T3UnaryRpcPool(api,origin,makeSocket,undefined,validUntil);
  }
  dispose(){this.disposed=true;this.pool?.dispose();}
}

/** One authenticated unary socket per API/credential owner. A lease releases
 * only its own reader; streams and command-file hosts never borrow this pool.
 * There is no retry here: a lost mutation result remains uncertain. */
export class T3UnaryRpcPool {
  private entry?:{controller:AbortController;work:Promise<T3RpcConnection>;rpc?:T3RpcConnection;users:Set<()=>void>};
  private idle?:ReturnType<typeof setTimeout>;
  private disposed=false;
  private expiry?:ReturnType<typeof setTimeout>;
  constructor(private api:T3Api,private origin:string,private makeSocket?:SocketFactory,private time:RpcClock=clock,private validUntil=Infinity){}
  async acquire(signal?:AbortSignal):Promise<T3RpcConnection>{
    if(Date.now()>=this.validUntil)this.dispose();
    if(this.disposed)throw Error('The unary connection owner stopped.');
    if(signal?.aborted)throw toError(signal.reason??Error('Request cancelled.'));
    if(this.idle!==undefined){this.time.clear(this.idle);this.idle=undefined;}
    if(this.entry?.rpc?.closed)this.entry=undefined;
    if(!this.entry){
      const controller=new AbortController();
      const entry={controller,users:new Set<()=>void>(),work:undefined! as Promise<T3RpcConnection>,rpc:undefined as T3RpcConnection|undefined};
      this.entry=entry;
      if(this.expiry===undefined&&Number.isFinite(this.validUntil))this.expiry=this.time.timer(()=>this.dispose(),Math.min(2_147_483_647,Math.max(0,this.validUntil-Date.now())));
      const opening=this.time.timer(()=>controller.abort(Error('The unary connection did not open in time.')),15_000);
      entry.work=connectT3Rpc(this.api,this.origin,this.makeSocket,this.time,controller.signal,8).then(rpc=>{entry.rpc=rpc;return rpc;}).finally(()=>this.time.clear(opening));
      void entry.work.catch(()=>{if(this.entry===entry)this.entry=undefined;});
    }
    const entry=this.entry;
    if(entry.users.size>=8)throw Error('Too many concurrent unary operations. Retry when the current work finishes.');
    const reader=new AbortController();let released=false;
    const release=()=>{
      if(released)return;released=true;signal?.removeEventListener('abort',cancel);reader.abort(signal?.reason??Error('Unary reader released.'));entry.users.delete(release);
      if(entry.users.size||this.entry!==entry)return;
      if(!entry.rpc){entry.controller.abort(Error('Unary connection opening cancelled.'));this.entry=undefined;}
      else this.idle=this.time.timer(()=>{this.idle=undefined;if(this.entry===entry){this.entry=undefined;entry.rpc?.close();if(this.expiry!==undefined)this.time.clear(this.expiry);this.expiry=undefined;}},5_000);
    };
    const cancel=()=>release();entry.users.add(release);signal?.addEventListener('abort',cancel,{once:true});
    try{
      const rpc=await unaryRead(entry.work,reader.signal);
      return {get closed(){return released||rpc.closed;},get error(){return rpc.error;},call:(tag,payload,onSent)=>{
        if(released)return Promise.reject(Error('Unary reader released.'));
        return unaryRead(rpc.call(tag,payload,onSent),reader.signal);
      },close:release};
    }catch(error){release();throw error;}
  }
  dispose(){
    this.disposed=true;if(this.expiry!==undefined)this.time.clear(this.expiry);this.expiry=undefined;if(this.idle!==undefined)this.time.clear(this.idle);this.idle=undefined;
    const entry=this.entry;this.entry=undefined;if(!entry)return;
    entry.controller.abort(Error('The unary connection owner stopped.'));
    for(const release of entry.users)release();entry.rpc?.close();
  }
}

function unaryRead<T>(work:Promise<T>,signal:AbortSignal):Promise<T>{
  return new Promise((resolve,reject)=>{
    const cancel=()=>{signal.removeEventListener('abort',cancel);reject(toError(signal.reason??Error('Request cancelled.')));};
    work.then(value=>{signal.removeEventListener('abort',cancel);if(signal.aborted)cancel();else resolve(value);},error=>{signal.removeEventListener('abort',cancel);reject(toError(error));});
    if(signal.aborted)cancel();else signal.addEventListener('abort',cancel,{once:true});
  });
}

/** Unowned callers keep the original one-shot connection semantics. */
export function acquireT3UnaryRpc(api:T3Api,origin:string,makeSocket?:SocketFactory,signal?:AbortSignal):Promise<T3RpcConnection>{
  return api.acquireUnaryRpc?.(signal)??connectT3Rpc(api,origin,makeSocket,clock,signal);
}
