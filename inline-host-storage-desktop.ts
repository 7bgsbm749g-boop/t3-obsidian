import {promises as fs} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {DesktopInlineReadCache,inlineFileVersion} from './inline-file-cache-desktop';
import {existingPrivateStorage} from './private-storage-desktop';
import type {LeaseFiles} from './inline-lease';
const inlineReadCache=new DesktopInlineReadCache();

export function localInlineFiles(root:string,directory:string,storageRoot?:string):LeaseFiles&{requests():Promise<string[]>;listSidecars(path:string):Promise<string[]>}{
  const cursors=new Map<string,import('node:fs').Dir>();
  const configDir=directory.includes('/t3-code/')?directory.slice(0,directory.indexOf('/t3-code/')):directory.split('/')[0]!;
  let selectedRoot=storageRoot;
  const storage=async()=>{if(selectedRoot)return selectedRoot;const route=await existingPrivateStorage(root,configDir);if(route)selectedRoot=route.storageRoot;return selectedRoot??root;};
  const full=async(path:string)=>{
    if(!path.startsWith(directory+'/')||path.includes('\\')||path.split('/').some(p=>p==='..'||p==='.'))throw Error('Invalid hosted response storage path.');
    const localRoot=await storage(),base=resolve(localRoot,directory),result=resolve(localRoot,path);if(!result.startsWith(base+require('node:path').sep))throw Error('Invalid hosted response storage path.');return result;
  };
  return {
    // Body-bearing evidence stays durable but does not leave a second full
    // copy in the raw cache after its parsed working record is released.
    async read(path){return inlineReadCache.read(await full(path),!['leases','materializations','originals','staged-results','stopped-bodies'].some(folder=>path.startsWith(`${directory}/${folder}/`)));},
    async version(path){return inlineFileVersion(await full(path));},
    async forget(path){inlineReadCache.invalidate(await full(path));},
    async write(path,contents){const target=await full(path);inlineReadCache.invalidate(target);await fs.mkdir(dirname(target),{recursive:true});const temporary=target+'.'+require('node:crypto').randomUUID()+'.tmp';try{await fs.writeFile(temporary,contents,{mode:0o600});await fs.rename(temporary,target);}finally{inlineReadCache.invalidate(target);await fs.rm(temporary,{force:true});}},
    async remove(path){const target=await full(path);inlineReadCache.invalidate(target);try{await fs.unlink(target);}catch(error:any){if(error.code!=='ENOENT')throw error;}finally{inlineReadCache.invalidate(target);}},
    async list(directoryPath){try{return (await fs.readdir(await full(directoryPath))).filter(p=>p.endsWith('.json')).map(p=>`${directoryPath}/${p}`);}catch(error:any){if(error.code==='ENOENT')return [];throw error;}},
    async listSidecars(path){try{return (await fs.readdir(await full(path))).filter(name=>/^[a-f0-9]{64}\.md$/.test(name)).map(name=>path+'/'+name);}catch(error:any){if(error.code==='ENOENT')return [];throw error;}},
    async listBatch(path,limit){let cursor=cursors.get(path);if(!cursor){try{cursor=await fs.opendir(await full(path));cursors.set(path,cursor);}catch(error:any){if(error.code==='ENOENT')return [];throw error;}}const files:string[]=[];while(files.length<limit){const entry=await cursor.read();if(!entry){await cursor.close();cursors.delete(path);break;}if(entry.isFile()&&entry.name.endsWith('.json'))files.push(path+'/'+entry.name);}return files;},
    async close(){for(const cursor of cursors.values())await cursor.close();cursors.clear();},
    async requests(){try{return (await fs.readdir(join(await storage(),directory,'requests'))).filter(p=>p.endsWith('.json')).map(p=>`${directory}/requests/${p}`);}catch(error:any){if(error.code==='ENOENT')return [];throw error;}},
  };
}

export const inlineHostReadCache=inlineReadCache;
