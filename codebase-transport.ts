import {connectT3Rpc} from './t3-rpc';
import {ThreadAccessCache} from './thread-access-cache';
import type {ThreadAccess,ThreadAccessCloseReason} from './thread-stream';
import type {CodebaseIO,CodebaseScope} from './codebase-core';
import {relativeCodebasePath} from './codebase-core';

export interface CodebaseTiming {operation:string;milliseconds:number}
export interface CodebaseTransport extends CodebaseIO {timings:CodebaseTiming[]}
interface Options {connect?:typeof connectT3Rpc;now?:()=>number;timeout?:number}
/** One credential owner and multiplexed socket per machine. No file bytes persist. */
export function codebaseTransport(createAccess:(environmentId:string,reason?:ThreadAccessCloseReason)=>Promise<ThreadAccess>,options:Options={}):CodebaseTransport {
  const now=options.now??Date.now,connect=options.connect??connectT3Rpc,timeout=options.timeout??10000;
  const access=new ThreadAccessCache(createAccess,now),timings:CodebaseTiming[]=[];
  type Rpc=Awaited<ReturnType<typeof connectT3Rpc>>;
  const sockets=new Map<string,{rpc:Rpc;origin:string;until:number}>(),opening=new Map<string,Promise<{rpc:Rpc;origin:string;until:number}>>();
  const catalogs=new Map<string,{value:any;at:number}>(),catalogPending=new Map<string,Promise<any>>();
  let stopped=false;
  async function measured<T>(operation:string,work:()=>Promise<T>):Promise<T>{const start=now();try{return await work();}finally{timings.push({operation,milliseconds:now()-start});if(timings.length>200)timings.shift();}}
  function bounded<T>(work:Promise<T>,late?:(value:T)=>void):Promise<T>{return new Promise((resolve,reject)=>{let expired=false;const timer=setTimeout(()=>{expired=true;reject(Error('The project machine did not respond. Cached folders remain available.'));},timeout);work.then(value=>{clearTimeout(timer);if(expired)late?.(value);else resolve(value);},error=>{clearTimeout(timer);reject(error);});});}
  async function connection(environmentId:string){
    if(stopped)throw Error('The project connection is stopped.');
    const cached=sockets.get(environmentId);if(cached&&!cached.rpc.closed&&cached.until>now())return cached;
    const pending=opening.get(environmentId);if(pending)return pending;
    const work=measured('connect',async()=>{
      cached?.rpc.close();sockets.delete(environmentId);
      const borrowed=await bounded(access.get(environmentId));
      const rpc=await bounded(connect((path,payload)=>bounded(borrowed.api(path,payload)),borrowed.origin),late=>late.close());
      if(stopped){rpc.close();throw Error('The project connection is stopped.');}
      const result={rpc,origin:borrowed.origin,until:now()+170000};sockets.set(environmentId,result);return result;
    });
    opening.set(environmentId,work);try{return await work;}finally{if(opening.get(environmentId)===work)opening.delete(environmentId);}
  }
  async function catalog(environmentId:string,fresh=false){
    const cached=catalogs.get(environmentId);if(!fresh&&cached&&now()-cached.at<15000)return cached.value;
    const pending=catalogPending.get(environmentId);if(pending)return pending;
    const work=measured('catalog',async()=>{const borrowed=await bounded(access.get(environmentId)),value=await bounded(borrowed.api('/api/orchestration/shell'));if(stopped)throw Error('The project connection is stopped.');catalogs.set(environmentId,{value,at:now()});return value;});
    catalogPending.set(environmentId,work);try{return await work;}finally{if(catalogPending.get(environmentId)===work)catalogPending.delete(environmentId);}
  }
  async function verify(scope:CodebaseScope,fresh=false){const shell=await catalog(scope.environmentId,fresh),project=shell.projects?.find((p:any)=>p.id===scope.projectId),thread=scope.threadId?shell.threads?.find((t:any)=>t.id===scope.threadId&&t.projectId===scope.projectId):undefined;if(!project||scope.threadId&&!thread||(thread?.worktreePath??project.workspaceRoot)!==scope.root)throw Error('The project workspace changed or is unavailable. Refresh its folder link before opening files.');}
  async function call(scope:CodebaseScope,tag:string,payload:unknown){return measured(tag,async()=>{const [socket]=await Promise.all([connection(scope.environmentId),verify(scope,tag==='projects.writeFile')]);return bounded(socket.rpc.call(tag,payload));});}
  return {
    timings,
    dispose(){stopped=true;for(const socket of sockets.values())socket.rpc.close();sockets.clear();catalogs.clear();void access.dispose();},
    async workspaces(scope){await verify(scope);const shell=await catalog(scope.environmentId);return (shell.threads??[]).filter((t:any)=>t.projectId===scope.projectId&&t.worktreePath).map((t:any)=>({...scope,root:t.worktreePath,threadId:t.id,title:t.title??t.id}));},
    list:(scope,directory)=>{if(directory)relativeCodebasePath(directory);return call(scope,'projects.listEntries',{cwd:scope.root,directoryPath:directory});},
    async search(scope,name){const result=await call(scope,'projects.searchEntries',{cwd:scope.root,query:name,limit:200,kind:'file'});if(result.truncated)throw Error('T3 returned incomplete file matches. Use Codebase view to choose the file.');return result.entries??[];},
    async read(scope,path){relativeCodebasePath(path);const result=await call(scope,'projects.readFile',{cwd:scope.root,relativePath:path});if(result.truncated||typeof result.contents!=='string'||new TextEncoder().encode(result.contents).length!==result.byteLength)throw Error('T3 cannot return the complete text file. Editing is disabled.');return result.contents;},
    async write(scope,path,contents){relativeCodebasePath(path);await call(scope,'projects.writeFile',{cwd:scope.root,relativePath:path,contents});},
    async resource(scope,path){relativeCodebasePath(path);const result=await call(scope,'assets.createUrl',{resource:{_tag:'draft-workspace-file',cwd:scope.root,path}});if(!result.relativeUrl?.startsWith('/api/assets/'))throw Error('T3 did not return a file preview.');const socket=await connection(scope.environmentId);return {url:new URL(result.relativeUrl,socket.origin).href,expiresAt:Number(result.expiresAt)};}
  };
}
