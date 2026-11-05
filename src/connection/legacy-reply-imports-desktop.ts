import {Platform} from 'obsidian';
let fs:typeof import('node:fs').promises;
let resolve:typeof import('node:path').resolve;
let join:typeof import('node:path').join;
let sep:typeof import('node:path').sep;
let createHash:typeof import('node:crypto').createHash;
let desktopReady:Promise<void>|undefined;
function loadDesktop():Promise<void>{
  if(Platform.isDesktop){
    return desktopReady??=(async()=>{
    ({promises:fs}=await import('node:fs'));
    const nativePath=await import('node:path');
    resolve=nativePath.resolve.bind(nativePath);
    join=nativePath.join.bind(nativePath);
    sep=nativePath.sep;
    ({createHash}=await import('node:crypto'));
    })();
  }
  throw Error('This feature requires Obsidian on desktop.');
}
import {errorCode,toError} from '../shared/values';
import {TFolder,type App,type TFile} from 'obsidian';

import type {CodebaseScope} from '../projects/codebase-core';
import {relativeCodebasePath} from '../projects/codebase-core';

export const LEGACY_REPLY_ROOT='T3 Code Attachments';
export function legacyReplyPath(path:string){return /^T3 Code Attachments\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\/[0-9a-f]{16}-[^/]+$/i.test(path);}
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
/** Copy first, persist link identities, then remove only the checked imports.
 * This explicit maintenance operation never runs during response delivery. */
export async function archiveLegacyReplyImports(app:App,scope:CodebaseScope,directory:string,remember:(files:Array<{source:string;path:string;sha256:string}>)=>Promise<void>){
 await loadDesktop();
 relativeCodebasePath(directory);
 const vault=app.vault,adapter=vault.adapter as typeof vault.adapter&{getBasePath():string};
 const vaultRoot=await fs.realpath(adapter.getBasePath()),projectRoot=await fs.realpath(scope.root);
 if(projectRoot===vaultRoot||projectRoot.startsWith(vaultRoot+sep)||vaultRoot.startsWith(projectRoot+sep))throw Error('Choose a project outside the vault.');
 const folder=vault.getAbstractFileByPath(LEGACY_REPLY_ROOT);
 if(!folder)return {files:0,removed:0,directory};
 if(!(folder instanceof TFolder))throw Error('The old attachment path is not a folder.');
 const files:TFile[]=[],folders:TFolder[]=[];
 function visit(item:TFile|TFolder){
  if('children' in item){if(item.path!==LEGACY_REPLY_ROOT&&!/^T3 Code Attachments\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(item.path))throw Error('The attachment folder contains unrelated folders.');folders.push(item);for(const child of item.children)visit(child as TFile|TFolder);}
  else {if(!legacyReplyPath(item.path))throw Error('The attachment folder contains unrelated files.');files.push(item);}
 }
 visit(folder);
 app.workspace.iterateAllLeaves(leaf=>{const path=(leaf.view as typeof leaf.view&{file?:TFile}).file?.path;if(path===LEGACY_REPLY_ROOT||path?.startsWith(LEGACY_REPLY_ROOT+'/'))throw Error('Close the old attachment file before moving it.');});
 const copies:Array<{file:TFile;source:string;path:string;sha256:string}>=[];
 for(const file of files){
  const source=file.path,path=directory+'/'+source;
  const sourceDisk=join(vaultRoot,source);
  if(await fs.realpath(sourceDisk)!==sourceDisk||(await fs.lstat(sourceDisk)).isSymbolicLink())throw Error('Symlinked imports cannot be moved.');
  const bytes=new Uint8Array(await vault.readBinary(file)),destination=resolve(projectRoot,path);
  let parent=projectRoot;
  for(const part of path.split('/').slice(0,-1)){parent=join(parent,part);try{await fs.mkdir(parent,{mode:0o700});}catch(error:unknown){if(errorCode(error)!=='EEXIST')throw toError(error);}if(await fs.realpath(parent)!==parent||!(await fs.lstat(parent)).isDirectory())throw Error('The archive directory is not a normal project folder.');}
  try{await fs.writeFile(destination,bytes,{flag:'wx',mode:0o600});}catch(error:unknown){if(errorCode(error)!=='EEXIST')throw toError(error);}
  if(await fs.realpath(destination)!==destination||!(await fs.lstat(destination)).isFile()||hash(await fs.readFile(destination))!==hash(bytes))throw Error('The archived copy does not match the vault file.');
  copies.push({file,source,path,sha256:hash(bytes)});
 }
 await remember(copies);
 let removed=0;
 for(const copy of copies){
  if(copy.file.path!==copy.source||vault.getAbstractFileByPath(copy.source)!==copy.file||hash(new Uint8Array(await vault.readBinary(copy.file)))!==copy.sha256)throw Error('A vault attachment changed during the move. The archive and links are retained.');
  if(hash(await fs.readFile(resolve(projectRoot,copy.path)))!==copy.sha256)throw Error('An archived attachment changed during the move.');
  await app.fileManager.trashFile(copy.file);removed++;
 }
 // Prune only empty directories after the user's preferred trash operation.
 // Nonrecursive removal means stale watcher children cannot block it,
 // and a newly created file makes rmdir fail instead of deleting that file.
 for(const old of folders.reverse())if(vault.getAbstractFileByPath(old.path)===old)try{await fs.rmdir(join(vaultRoot,old.path));}catch(error:unknown){if(errorCode(error)!=='ENOENT')throw toError(error);}
 return {files:copies.length,removed,directory,sha256:Object.fromEntries(copies.map(copy=>[copy.source,copy.sha256]))};
}
