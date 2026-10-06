import {connectT3Rpc} from './t3-rpc';
import type {ThreadAccess} from './thread-stream';
import type {CodebaseIO,CodebaseScope} from './codebase-core';
async function verifyScope(access:ThreadAccess,scope:CodebaseScope){const shell=await access.api('/api/orchestration/shell');const project=shell.projects?.find((p:any)=>p.id===scope.projectId),thread=scope.threadId?shell.threads?.find((t:any)=>t.id===scope.threadId&&t.projectId===scope.projectId):undefined;if(!project||scope.threadId&&!thread||(thread?.worktreePath??project.workspaceRoot)!==scope.root)throw Error('The project workspace changed or is unavailable. Refresh its folder link before opening files.');}
export function codebaseTransport(access:(environmentId:string)=>Promise<ThreadAccess>):CodebaseIO {
  const call=async(scope:CodebaseScope,tag:string,payload:unknown)=>{const connection=await access(scope.environmentId);let rpc:Awaited<ReturnType<typeof connectT3Rpc>>|undefined;try{await verifyScope(connection,scope);rpc=await connectT3Rpc(connection.api,connection.origin);return await rpc.call(tag,payload);}finally{rpc?.close();connection.close?.();}};
  return {
    async workspaces(scope){const connection=await access(scope.environmentId);try{const shell=await connection.api('/api/orchestration/shell');return (shell.threads??[]).filter((t:any)=>t.projectId===scope.projectId&&t.worktreePath).map((t:any)=>({...scope,root:t.worktreePath,threadId:t.id,title:t.title??t.id}));}finally{connection.close?.();}},
    list:(scope,directory)=>call(scope,'projects.listEntries',{cwd:scope.root,directoryPath:directory}),
    async search(scope,name){const result=await call(scope,'projects.searchEntries',{cwd:scope.root,query:name,limit:200,kind:'file'});if(result.truncated)throw Error('T3 returned incomplete file matches. Use Codebase view to choose the file.');return result.entries??[];},
    async read(scope,path){const result=await call(scope,'projects.readFile',{cwd:scope.root,relativePath:path});if(result.truncated||typeof result.contents!=='string'||new TextEncoder().encode(result.contents).length!==result.byteLength)throw Error('T3 cannot return the complete text file. Editing is disabled.');return result.contents;},
    async write(scope,path,contents){await call(scope,'projects.writeFile',{cwd:scope.root,relativePath:path,contents});},
    async resource(scope,path){const connection=await access(scope.environmentId);let rpc:Awaited<ReturnType<typeof connectT3Rpc>>|undefined;try{await verifyScope(connection,scope);rpc=await connectT3Rpc(connection.api,connection.origin);const result=await rpc.call('assets.createUrl',{resource:{_tag:'draft-workspace-file',cwd:scope.root,path}});if(!result.relativeUrl?.startsWith('/api/assets/'))throw Error('T3 did not return a file preview.');return {url:new URL(result.relativeUrl,connection.origin).href,expiresAt:Number(result.expiresAt)};}finally{rpc?.close();connection.close?.();}}
  };
}
