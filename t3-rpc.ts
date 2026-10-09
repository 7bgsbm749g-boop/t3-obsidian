import {Buffer} from 'buffer';
import {T3_PROTOCOL_VERSION} from './orchestration-v2';

export type T3Api=(path:string,payload?:any)=>Promise<any>;
export type SocketFactory=(url:string)=>WebSocket;
export class T3RpcError extends Error {
  constructor(public kind:string,public requiredPermission?:string,public rpcMethod?:string){super(kind==='EnvironmentAuthorizationError'&&['filesystem:read','filesystem:write'].includes(requiredPermission??'')?'The T3 connection does not permit note access. Reconnect this machine in Send to T3 Code settings with filesystem read and write access.':kind==='ProjectReadFileError'?'Cannot read the synced vault settings in this folder.':kind==='FilesystemBrowseError'?'Cannot open this folder on the selected machine.':'The selected machine could not complete the T3 request.');}
}

/** Unary requests over T3's authenticated Effect RPC protocol. */
export async function connectT3Rpc(api:T3Api,origin:string,makeSocket:SocketFactory=url=>new WebSocket(url)){
  const issued=await api('/api/auth/websocket-ticket',{});
  if(typeof issued?.ticket!=='string'||!issued.ticket)throw Error('T3 did not issue a connection ticket.');
  const url=new URL('/ws',origin);url.protocol=url.protocol==='https:'?'wss:':'ws:';
  url.searchParams.set('wsTicket',issued.ticket);url.searchParams.set('orchestrationProtocol',String(T3_PROTOCOL_VERSION));
  const socket=makeSocket(url.href);let closed=false,nextId=0;
  const pending=new Map<string,{resolve:(value:any)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>;method:string}>();
  const finish=(error:Error)=>{for(const task of pending.values()){clearTimeout(task.timer);task.reject(error);}pending.clear();};
  let opened=false,resolveOpen!:()=>void,rejectOpen!:(e:Error)=>void;
  const ready=new Promise<void>((resolve,reject)=>{resolveOpen=resolve;rejectOpen=reject;});
  const openTimer=setTimeout(()=>{rejectOpen(Error('The selected machine did not connect. Try again when it is online.'));socket.close();},15000);
  socket.onopen=()=>{opened=true;clearTimeout(openTimer);resolveOpen();};
  socket.onerror=()=>{closed=true;const error=Error('Cannot reach the selected machine. Your message is still in Obsidian.');clearTimeout(openTimer);rejectOpen(error);finish(error);socket.close();};
  socket.onclose=()=>{closed=true;clearTimeout(openTimer);const error=Error('The connection to the selected machine closed. Try again.');if(!opened)rejectOpen(error);finish(error);};
  socket.onmessage=event=>{
    try{
      if(typeof event.data!=='string'||Buffer.byteLength(event.data)>4_000_000)throw Error('T3 returned an oversized response.');
      const decoded=JSON.parse(event.data);const frames=Array.isArray(decoded)?decoded:[decoded];
      for(const frame of frames){
        if(frame._tag==='Ping'){socket.send(JSON.stringify({_tag:'Pong'}));continue;}
        if(frame._tag==='Defect')throw Error('This T3 version could not process the request.');
        const id=String(frame.requestId),task=pending.get(id);if(!task||frame._tag!=='Exit')continue;
        pending.delete(id);clearTimeout(task.timer);
        if(frame.exit?._tag==='Success')task.resolve(frame.exit.value);
        else {const causes=frame.exit?.cause;const failure=Array.isArray(causes)?causes.find((x:any)=>x._tag==='Fail')?.error:undefined;const permission=['filesystem:read','filesystem:write','orchestration:read','orchestration:operate'].includes(failure?.requiredPermission)?failure.requiredPermission:undefined;task.reject(new T3RpcError(failure?._tag??'RpcError',permission,task.method));}
      }
    }catch{closed=true;finish(Error('T3 returned an incompatible response.'));socket.close();}
  };
  try{await ready;}catch(error){socket.close();throw error;}
  const rpc=(tag:string,payload:any)=>new Promise<any>((resolve,reject)=>{
    if(closed){reject(Error('The machine connection closed. Choose the machine again.'));return;}
    const id=String(++nextId),timer=setTimeout(()=>{pending.delete(id);reject(Error('The selected machine took too long. Try again.'));},15000);
    pending.set(id,{resolve,reject,timer,method:tag});
    try{socket.send(JSON.stringify({_tag:'Request',id,tag,payload,headers:[]}));}catch{pending.delete(id);clearTimeout(timer);reject(Error('Cannot send the request to this machine.'));}
  });
  return {call:rpc,get closed(){return closed;},close(){closed=true;finish(Error('T3 connection closed.'));socket.close();}};
}
