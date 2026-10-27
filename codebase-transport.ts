import {connectT3Rpc} from './t3-rpc';
import {ThreadAccessCache} from './thread-access-cache';
import type {ThreadAccess,ThreadAccessCloseReason} from './thread-stream';
import type {CodebaseIO,CodebaseScope} from './codebase-core';
import {relativeCodebasePath,catalogCodebases} from './codebase-core';

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
  async function measured<T>(operation:string,work:()=>Promise<T>):Promise<T>{const start=now();try{return await work();}finally{timings.push({operation,milliseconds:now()-start});if(timings.filter(value=>value.operation===operation).length>200)timings.splice(timings.findIndex(value=>value.operation===operation),1);}}
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
    const pending=catalogPending.get(environmentId);if(pending){if(!fresh)return pending;try{await pending;}catch{}if(stopped)throw Error('The project connection is stopped.');}
    const work=measured('catalog',async()=>{const borrowed=await bounded(access.get(environmentId)),value=await bounded(borrowed.api('/api/orchestration/shell'));if(stopped)throw Error('The project connection is stopped.');catalogs.set(environmentId,{value,at:now()});return value;});
    catalogPending.set(environmentId,work);try{return await work;}finally{if(catalogPending.get(environmentId)===work)catalogPending.delete(environmentId);}
  }
  async function verify(scope:CodebaseScope,fresh=false,allowMissing=false){const shell=await catalog(scope.environmentId,fresh),project=shell.projects?.find((p:any)=>p.id===scope.projectId&&!p.deletedAt),thread=scope.threadId?shell.threads?.find((t:any)=>t.id===scope.threadId&&t.projectId===scope.projectId&&!t.deletedAt):undefined;if(!project&&allowMissing)return undefined;const known=catalogCodebases(scope.environmentId,shell).some(value=>value.projectId===scope.projectId&&value.threadId===scope.threadId&&value.root===scope.root);if(!project||!known||scope.threadId&&!thread)throw Error('The project workspace changed or is unavailable. Refresh project locations before opening files.');return project;}
  async function call(scope:CodebaseScope,tag:string,payload:unknown){return measured(tag,async()=>{const [socket]=await Promise.all([connection(scope.environmentId),verify(scope,tag==='projects.writeFile')]);return bounded(socket.rpc.call(tag,payload));});}
  async function projectCommand(scope:CodebaseScope,change:{title:string}|{deleted:true}){
    if(scope.threadId)throw Error('Choose the project root to change a project.');
    const current=await verify(scope,true,'deleted' in change);
    if('deleted' in change&&!current||'title' in change&&current?.title===change.title)return;
    if(stopped)throw Error('The project connection is stopped.');
    const borrowed=await bounded(access.get(scope.environmentId));
    const command={commandId:crypto.randomUUID(),projectId:scope.projectId,...('title' in change?{type:'project.meta.update',title:change.title}:{type:'project.delete',force:true})};
    // One attempt only. A lost reply is reconciled by the fresh project catalog.
    let failure:unknown;
    try{await bounded(borrowed.api('/api/orchestration/dispatch',command));}catch(error){failure=error;}
    catalogs.delete(scope.environmentId);
    const shell=await catalog(scope.environmentId,true),project=shell.projects?.find((p:any)=>p.id===scope.projectId);
    const confirmed='title' in change?project?.workspaceRoot===scope.root&&project?.title===change.title:!project;
    if(!confirmed)throw failure??Error('The project change could not be confirmed. Refresh before trying again.');
  }
  return {
    timings,
    async catalog(environmentId){return catalogCodebases(environmentId,await catalog(environmentId));},
    dispose(){stopped=true;for(const socket of sockets.values())socket.rpc.close();sockets.clear();catalogs.clear();void access.dispose();},
    async workspaces(scope){await verify(scope);const shell=await catalog(scope.environmentId);return (shell.threads??[]).filter((t:any)=>t.projectId===scope.projectId&&t.worktreePath).map((t:any)=>({...scope,root:t.worktreePath,threadId:t.id,title:t.title??t.id}));},
    list:(scope,directory)=>{if(directory)relativeCodebasePath(directory);return call(scope,'projects.listEntries',{cwd:scope.root,directoryPath:directory});},
    async search(scope,name){const result=await call(scope,'projects.searchEntries',{cwd:scope.root,query:name,limit:200,kind:'file'});if(result.truncated)throw Error('T3 returned incomplete file matches. Use Codebase view to choose the file.');return result.entries??[];},
    async read(scope,path){relativeCodebasePath(path);const result=await call(scope,'projects.readFile',{cwd:scope.root,relativePath:path});if(result.truncated||typeof result.contents!=='string'||new TextEncoder().encode(result.contents).length!==result.byteLength)throw Error('T3 cannot return the complete text file. Editing is disabled.');return result.contents;},
    async write(scope,path,contents){relativeCodebasePath(path);await call(scope,'projects.writeFile',{cwd:scope.root,relativePath:path,contents});},
    async resource(scope,path){relativeCodebasePath(path);const result=await call(scope,'assets.createUrl',{resource:{_tag:'draft-workspace-file',cwd:scope.root,path}});if(!result.relativeUrl?.startsWith('/api/assets/'))throw Error('T3 did not return a file preview.');const socket=await connection(scope.environmentId);return {url:new URL(result.relativeUrl,socket.origin).href,expiresAt:Number(result.expiresAt)};},
    async renameProject(scope,title){title=title.trim();if(!title||/[\x00-\x1f]/.test(title))throw Error('Enter a project name.');await projectCommand(scope,{title});},
    async deleteProject(scope){await projectCommand(scope,{deleted:true});}
  };
}
