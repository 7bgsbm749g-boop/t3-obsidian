import {connectT3Rpc,T3RpcError as VaultRpcError,type SocketFactory} from './t3-rpc';
export {T3RpcError as VaultRpcError} from './t3-rpc';
import type {Connection,Project} from './bridge';
import {parseProjects} from './bridge';
import {environmentApi,endpoint,commandId,type PairedSession,type Fetcher} from './direct';
import {sameWorkspacePath} from './folder-link';

export interface VaultLocation {environmentId:string;workspaceRoot:string}
export interface VaultRegistration {type:'project.create';commandId:string;projectId:string;title:string;workspaceRoot:string;createdAt:string}
export function loadVaultLocations(data:any):VaultLocation[]{
  return Array.isArray(data?.vaultLocations)?data.vaultLocations.filter((x:any)=>typeof x?.environmentId==='string'&&x.environmentId&&typeof x?.workspaceRoot==='string'&&x.workspaceRoot):[];
}
export function vaultIdentity(data:any):string|undefined{
  if(typeof data?.vaultId==='string'&&data.vaultId)return data.vaultId;
  // Reuse a synced legacy root link's identity during upgrade on different devices.
  return Array.isArray(data?.folderLinks)?data.folderLinks.find((x:any)=>x?.folderPath==='/'&&typeof x.id==='string')?.id:undefined;
}
export interface VaultRemote {
  projects():Promise<Project[]>;
  browse(path:string):Promise<{parentPath:string;entries:{name:string;fullPath:string}[]}>;
  matches(root:string,settingsPath:string,vaultId:string):Promise<boolean>;
  hasNote(root:string,path:string):Promise<boolean>;
  readFile(root:string,path:string):Promise<string|undefined>;
  writeFile(root:string,path:string,contents:string):Promise<void>;
  deleteFile(root:string,path:string):Promise<void>;
  ensureProject(registration:VaultRegistration):Promise<Project>;
  close():void;
}

export async function connectVaultRemote(c:Connection,s:PairedSession|undefined,fetcher?:Fetcher,makeSocket?:SocketFactory):Promise<VaultRemote>{
  const api=await environmentApi(c,s,fetcher);
  const transport=await connectT3Rpc(api,endpoint(c.url||''),makeSocket);
  const rpc=transport.call;
  const projects=async()=>parseProjects(await api('/api/orchestration/shell'));
  return {
    projects,
    browse:async path=>{const result=await rpc('filesystem.browse',{partialPath:path==='~'?path:path.replace(/[\\/]+$/,'')+'/'});if(typeof result?.parentPath!=='string'||!Array.isArray(result.entries)||result.entries.some((x:any)=>typeof x.name!=='string'||typeof x.fullPath!=='string'))throw Error('Invalid folder list from T3.');return result;},
    matches:async(root,settingsPath,id)=>{
      try{const result=await rpc('projects.readFile',{cwd:root,relativePath:settingsPath});if(result.truncated||typeof result.contents!=='string')return false;let data;try{data=JSON.parse(result.contents);}catch{return false;}return vaultIdentity(data)===id;}
      catch(error){if(error instanceof VaultRpcError&&error.kind==='ProjectReadFileError')return false;throw error;}
    },
    hasNote:async(root,path)=>{
      const directoryPath=path.includes('/')?path.slice(0,path.lastIndexOf('/')):'';
      try{const result=await rpc('projects.listEntries',{cwd:root,directoryPath});return Array.isArray(result?.entries)&&result.entries.some((x:any)=>x.path===path&&x.kind==='file');}
      catch(error){if(error instanceof VaultRpcError&&['ProjectListEntriesError','ProjectEntriesError'].includes(error.kind))return false;throw error;}
    },
    readFile:async(root,path)=>{
      try{const result=await rpc('projects.readFile',{cwd:root,relativePath:path});if(result.truncated||typeof result.contents!=='string')throw Error(`T3 could not read the complete file: ${path}`);return result.contents;}
      catch(error){if(error instanceof VaultRpcError&&error.kind==='ProjectReadFileError')return undefined;throw error;}
    },
    writeFile:async(root,path,contents)=>{await rpc('projects.writeFile',{cwd:root,relativePath:path,contents});},
    deleteFile:async(root,path)=>{await rpc('projects.deleteEntry',{cwd:root,relativePath:path});},
    ensureProject:async registration=>{
      const root=registration.workspaceRoot;
      const existing=(await projects()).find(p=>sameWorkspacePath(p.workspaceRoot,root));if(existing)return existing;
      await api('/api/orchestration/dispatch',registration);
      const project=(await projects()).find(p=>sameWorkspacePath(p.workspaceRoot,root));if(!project)throw Error('The project was created, but discovery has not returned it yet. Try again.');return project;
    },
    close:transport.close,
  };
}

export function vaultRegistration(environmentId:string,root:string,id:string,title:string):VaultRegistration{
  const normalized=root.replace(/\\/g,'/').replace(/\/+$/,'');
  const key=commandId('107f7a18-6d4d-4d99-8bbc-d8cd5d64d732',id+':'+environmentId+':'+(/^[a-z]:\//i.test(normalized)?normalized.toLowerCase():normalized));
  return {type:'project.create',commandId:commandId(key,'create'),projectId:commandId(key,'project'),title,workspaceRoot:root,createdAt:new Date().toISOString()};
}

export async function discoverVaultRoots(remote:VaultRemote,roots:string[],settingsPath:string,id:string):Promise<string[]>{
  const unique=roots.filter((root,index)=>roots.findIndex(other=>sameWorkspacePath(root,other))===index).slice(0,100);
  const found:string[]=[];let cursor=0;
  await Promise.all(Array.from({length:Math.min(4,unique.length)},async()=>{while(cursor<unique.length){const root=unique[cursor++];if(await remote.matches(root,settingsPath,id))found.push(root);}}));
  return found;
}

export async function waitForVaultNote(remote:VaultRemote,root:string,path:string,active:()=>boolean,onWait:()=>void,pause:(ms:number)=>Promise<void>=ms=>new Promise(resolve=>setTimeout(resolve,ms))):Promise<void>{
  for(let attempt=0;attempt<6;attempt++){
    if(!active())throw Error('The chat was cancelled before sending.');
    if(await remote.hasNote(root,path))return;
    if(attempt===0)onWait();
    if(attempt<5)await pause(2000);
  }
  throw Error('This note has not reached the selected machine yet. Let Obsidian Sync finish, then send again. Your message is still ready.');
}
