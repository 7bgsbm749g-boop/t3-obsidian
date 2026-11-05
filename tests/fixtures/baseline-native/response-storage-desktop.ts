// Historical test/lab adapter only. Never import this file from src or ship it in the plugin.
import {Platform} from 'obsidian';
let randomUUID:typeof import('node:crypto').randomUUID;
let fs:typeof import('node:fs').promises;
let join:typeof import('node:path').join;
let resolve:typeof import('node:path').resolve;
let dirname:typeof import('node:path').dirname;
let sep:typeof import('node:path').sep;
let desktopReady:Promise<void>|undefined;
function loadDesktop():Promise<void>{
  if(Platform.isDesktop){
    return desktopReady??=(async()=>{
    ({randomUUID}=await import('node:crypto'));
    ({promises:fs}=await import('node:fs'));
    const nativePath=await import('node:path');
    join=nativePath.join.bind(nativePath);
    resolve=nativePath.resolve.bind(nativePath);
    dirname=nativePath.dirname.bind(nativePath);
    sep=nativePath.sep;
    })();
  }
  throw Error('This feature requires Obsidian on desktop.');
}

import {errorCode,toError} from '../../../src/shared/values';

import {DesktopInlineReadCache,inlineFileVersion} from './inline-file-cache-desktop';
import {existingPrivateStorage} from './private-storage-desktop';
import type {ResponseStorageFiles} from '../../../src/responses/response-record';
const inlineReadCache=new DesktopInlineReadCache();

export function localInlineFiles(root:string,directory:string,storageRoot?:string):ResponseStorageFiles&{requests():Promise<string[]>;listSidecars(path:string):Promise<string[]>}{
  const cursors=new Map<string,import('node:fs').Dir>();
  const configDir=directory.includes('/t3-code/')?directory.slice(0,directory.indexOf('/t3-code/')):directory.split('/')[0];
  let selectedRoot=storageRoot;
  const storage=async()=>{await loadDesktop();if(selectedRoot)return selectedRoot;const route=await existingPrivateStorage(root,configDir);if(route)selectedRoot=route.storageRoot;return selectedRoot??root;};
  const full=async(path:string)=>{
    if(!path.startsWith(directory+'/')||path.includes('\\')||path.split('/').some(p=>p==='..'||p==='.'))throw Error('Invalid hosted response storage path.');
    const localRoot=await storage(),base=resolve(localRoot,directory),result=resolve(localRoot,path);if(!result.startsWith(base+sep))throw Error('Invalid hosted response storage path.');return result;
  };
  return {
    // Body-bearing evidence stays durable but does not leave a second full
    // copy in the raw cache after its parsed working record is released.
    async read(path){return inlineReadCache.read(await full(path),!['leases','materializations','originals','staged-results','stopped-bodies'].some(folder=>path.startsWith(`${directory}/${folder}/`)));},
    async version(path){return inlineFileVersion(await full(path));},
    async forget(path){inlineReadCache.invalidate(await full(path));},
    async write(path,contents){const target=await full(path);inlineReadCache.invalidate(target);await fs.mkdir(dirname(target),{recursive:true});const temporary=target+'.'+randomUUID()+'.tmp';try{await fs.writeFile(temporary,contents,{mode:0o600});await fs.rename(temporary,target);}finally{inlineReadCache.invalidate(target);await fs.rm(temporary,{force:true});}},
    async remove(path){const target=await full(path);inlineReadCache.invalidate(target);try{await fs.unlink(target);}catch(error:unknown){if(errorCode(error)!=='ENOENT')throw toError(error);}finally{inlineReadCache.invalidate(target);}},
    async list(directoryPath){await loadDesktop();try{return (await fs.readdir(await full(directoryPath))).filter(p=>p.endsWith('.json')).map(p=>`${directoryPath}/${p}`);}catch(error:unknown){if(errorCode(error)==='ENOENT')return [];throw toError(error);}},
    async listSidecars(path){await loadDesktop();try{return (await fs.readdir(await full(path))).filter(name=>/^[a-f0-9]{64}\.md$/.test(name)).map(name=>path+'/'+name);}catch(error:unknown){if(errorCode(error)==='ENOENT')return [];throw toError(error);}},
    async listBatch(path,limit){await loadDesktop();let cursor=cursors.get(path);if(!cursor){try{cursor=await fs.opendir(await full(path));cursors.set(path,cursor);}catch(error:unknown){if(errorCode(error)==='ENOENT')return [];throw toError(error);}}const files:string[]=[];while(files.length<limit){const entry=await cursor.read();if(!entry){await cursor.close();cursors.delete(path);break;}if(entry.isFile()&&entry.name.endsWith('.json'))files.push(path+'/'+entry.name);}return files;},
    async close(){for(const cursor of cursors.values())await cursor.close();cursors.clear();},
    async requests(){await loadDesktop();try{return (await fs.readdir(join(await storage(),directory,'requests'))).filter(p=>p.endsWith('.json')).map(p=>`${directory}/requests/${p}`);}catch(error:unknown){if(errorCode(error)==='ENOENT')return [];throw toError(error);}},
  };
}

export const inlineHostReadCache=inlineReadCache;
