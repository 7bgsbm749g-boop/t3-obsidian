import {promises as fs} from 'node:fs';
import {join,resolve,dirname,relative,isAbsolute} from 'node:path';
import {homedir} from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {createReadStream} from 'node:fs';
import lockfile from 'proper-lockfile';
import {contentHash} from './completion';
import {readPrivateStorageRoute,storageRoutePath,type PrivateStorageRoute} from './private-storage';

const openings=new Map<string,Promise<PrivateStorageRoute>>();
const inside=(root:string,path:string)=>{const part=relative(root,path);return !part||!isAbsolute(part)&&part!=='..'&&!part.startsWith('../');};
async function syncDirectory(path:string){if(process.platform==='win32')return;const directory=await fs.open(path,'r');try{await directory.sync();}finally{await directory.close();}}
async function fingerprint(path:string){const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');}
async function copyChecked(source:string,destination:string){
  await fs.mkdir(destination,{recursive:true,mode:0o700});
  for(const name of await fs.readdir(source)){
    const from=join(source,name),to=join(destination,name),stat=await fs.lstat(from);if(stat.isSymbolicLink())throw Error('Symlinked legacy operational data.');
    if(stat.isDirectory())await copyChecked(from,to);
    else if(stat.isFile()){await fs.copyFile(from,to);await fs.chmod(to,stat.mode&0o777);const file=await fs.open(to,'r');try{await file.sync();}finally{await file.close();}if(await fingerprint(from)!==await fingerprint(to))throw Error('Private storage copy readback failed.');}
    else throw Error('Unsupported legacy operational file.');
  }
  await syncDirectory(destination);
}
async function sameTree(source:string,destination:string):Promise<boolean>{
  const first=(await fs.readdir(source)).sort(),second=(await fs.readdir(destination)).sort();if(JSON.stringify(first)!==JSON.stringify(second))return false;
  for(const name of first){const from=join(source,name),to=join(destination,name),stat=await fs.lstat(from),other=await fs.lstat(to);if(stat.isSymbolicLink()||other.isSymbolicLink()||stat.isDirectory()!==other.isDirectory())return false;if(stat.isDirectory()){if(!await sameTree(from,to))return false;}else if(!stat.isFile()||!other.isFile()||await fingerprint(from)!==await fingerprint(to))return false;}
  return true;
}
async function retireCopiedTrees(route:PrivateStorageRoute){
  const path=join(route.storageRoot,'verified-migration-copy.json');let receipt:any;try{receipt=JSON.parse(await fs.readFile(path,'utf8'));}catch(error:any){if(error.code==='ENOENT')return;throw error;}
  if(receipt.version!==1||receipt.workspaceRoot!==route.workspaceRoot||receipt.configDir!==route.configDir||!Array.isArray(receipt.sources))throw Error('Invalid verified storage migration.');
  const allowed=new Set(['inline/v1','events/v1','commands/v1'].map(subtree=>join(route.workspaceRoot,route.configDir,'t3-code',subtree)+'.private-migration'));
  for(const source of receipt.sources){if(!allowed.has(source))throw Error('Invalid legacy retirement path.');try{const stat=await fs.lstat(source);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Invalid migrated legacy tree.');await fs.rm(source,{recursive:true});}catch(error:any){if(error.code!=='ENOENT')throw error;}}
  await fs.rm(path,{force:true});
}
export async function existingPrivateStorage(root:string,configDir:string){
  let raw:string|undefined;try{raw=await fs.readFile(join(root,storageRoutePath(configDir)),'utf8');}catch(error:any){if(error.code!=='ENOENT')throw error;}
  return readPrivateStorageRoute(raw,root,configDir);
}
/** Move the operational subtrees under their old writer locks. The small
 * route is intentionally shared configuration, never a response payload. A
 * crash between moves resumes the same destination instead of recopying it. */
export function ensurePrivateStorage(root:string,configDir:string,options?:{storageRoot?:string}){
  const key=JSON.stringify([root,configDir]);let work=openings.get(key);if(work)return work;
  work=(async()=>{
    if(!configDir||isAbsolute(configDir)||configDir.split(/[\\/]/).some(part=>part==='..'||part==='.'||!part))throw Error('Invalid vault configuration directory.');
    root=await fs.realpath(root);
    const route:PrivateStorageRoute={version:1,workspaceRoot:root,configDir,storageRoot:resolve(options?.storageRoot??join(homedir(),'.t3','send-to-t3-code','vaults',contentHash(root+'\0'+configDir)))};
    const prior=await existingPrivateStorage(root,configDir);if(prior){if(await fs.realpath(prior.storageRoot)!==prior.storageRoot)throw Error('Symlinked private storage.');await retireCopiedTrees(prior);return prior;}
    const vaults=[root];try{const registry=JSON.parse(await fs.readFile(join(homedir(),'.config/obsidian/obsidian.json'),'utf8'));for(const item of Object.values(registry.vaults??{}) as any[])if(item.path)vaults.push(await fs.realpath(item.path));}catch{}
    if(vaults.some(vault=>inside(vault,route.storageRoot)))throw Error('Operational storage must be outside every synced vault.');
    await fs.mkdir(route.storageRoot,{recursive:true,mode:0o700});if(await fs.realpath(route.storageRoot)!==route.storageRoot)throw Error('Symlinked private storage.');
    const release=await lockfile.lock(route.storageRoot,{realpath:true,stale:30_000,update:5000,retries:{retries:8,minTimeout:250,maxTimeout:1000}}),releases:Array<()=>Promise<void>>=[];
    try{
      const prior=await existingPrivateStorage(root,configDir);if(prior)return prior;
      const originPath=join(route.storageRoot,'storage-origin.json');let origin:PrivateStorageRoute|undefined;try{origin=JSON.parse(await fs.readFile(originPath,'utf8'));}catch(error:any){if(error.code!=='ENOENT')throw error;}
      if(origin&&JSON.stringify(origin)!==JSON.stringify(route))throw Error('Private operational storage belongs to another vault.');if(!origin)await fs.writeFile(originPath,JSON.stringify(route),{flag:'wx',mode:0o600});
      const copied:Array<{source:string;destination:string}>=[];
      for(const subtree of ['inline/v1','events/v1','commands/v1']){
        const source=join(root,configDir,'t3-code',subtree),destination=join(route.storageRoot,configDir,'t3-code',subtree);
        const frozen=source+'.private-migration';
        let exists=true;try{const stat=await fs.lstat(source);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Invalid legacy storage subtree.');}catch(error:any){if(error.code==='ENOENT')exists=false;else throw error;}
        await fs.mkdir(dirname(destination),{recursive:true,mode:0o700});
        if(exists){
          releases.push(await lockfile.lock(source,{realpath:true,stale:30_000,update:5000,retries:{retries:8,minTimeout:250,maxTimeout:1000}}));
          try{await fs.access(destination);throw Error('Both legacy and private response stores exist; refusing to choose one.');}catch(error:any){if(error.code!=='ENOENT')throw error;}
          try{await fs.rename(source,destination);}
          catch(error:any){
            if(error.code!=='EXDEV')throw error;
            await fs.rename(source,frozen);const temporary=destination+'.'+randomUUID()+'.tmp';
            try{await copyChecked(frozen,temporary);await fs.rename(temporary,destination);copied.push({source:frozen,destination});}
            catch(error){await fs.rm(temporary,{recursive:true,force:true});await fs.rename(frozen,source);throw error;}
          }
          await syncDirectory(dirname(destination));await syncDirectory(dirname(source));
        }else{
          let hasFrozen=false;try{await fs.access(frozen);hasFrozen=true;}catch{}
          if(hasFrozen){
            let present=true;try{await fs.access(destination);}catch(error:any){if(error.code==='ENOENT')present=false;else throw error;}
            if(!present){const temporary=destination+'.'+randomUUID()+'.tmp';try{await copyChecked(frozen,temporary);await fs.rename(temporary,destination);await syncDirectory(dirname(destination));}finally{await fs.rm(temporary,{recursive:true,force:true});}}
            if(!await sameTree(frozen,destination))throw Error('Interrupted private storage copy differs from its original.');copied.push({source:frozen,destination});
          }
          else await fs.mkdir(destination,{recursive:true,mode:0o700});
        }
      }
      const path=join(root,storageRoutePath(configDir));await fs.mkdir(dirname(path),{recursive:true,mode:0o700});const temporary=path+'.tmp';
      if(copied.length){const migration=join(route.storageRoot,'verified-migration-copy.json'),file=await fs.open(migration,'w',0o600);try{await file.writeFile(JSON.stringify({version:1,workspaceRoot:root,configDir,sources:copied.map(item=>item.source)}));await file.sync();}finally{await file.close();}await syncDirectory(route.storageRoot);}
      const file=await fs.open(temporary,'w',0o600);try{await file.writeFile(JSON.stringify(route));await file.sync();}finally{await file.close();}await fs.rename(temporary,path);
      await syncDirectory(dirname(path));
      await retireCopiedTrees(route);
      return route;
    }finally{for(const unlock of releases.reverse())await unlock().catch(()=>{});await release();}
  })();openings.set(key,work);void work.finally(()=>{if(openings.get(key)===work)openings.delete(key);}).catch(()=>{});return work;
}
