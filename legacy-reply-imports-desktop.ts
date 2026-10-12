import type {App,TFile,TFolder} from 'obsidian';
import {promises as fs} from 'node:fs';
import {resolve,join,sep} from 'node:path';
import {createHash} from 'node:crypto';
import type {CodebaseScope} from './codebase-core';
import {relativeCodebasePath} from './codebase-core';

export const LEGACY_REPLY_ROOT='T3 Code Attachments';
export function legacyReplyPath(path:string){return /^T3 Code Attachments\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\/[0-9a-f]{16}-[^/]+$/i.test(path);}
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
/** Copy first, persist link identities, then remove only the checked imports.
 * This explicit maintenance operation never runs during response delivery. */
export async function archiveLegacyReplyImports(app:App,scope:CodebaseScope,directory:string,remember:(files:Array<{source:string;path:string;sha256:string}>)=>Promise<void>){
 relativeCodebasePath(directory);
 const vault=app.vault,adapter=vault.adapter as typeof vault.adapter&{getBasePath():string};
 const vaultRoot=await fs.realpath(adapter.getBasePath()),projectRoot=await fs.realpath(scope.root);
 if(projectRoot===vaultRoot||projectRoot.startsWith(vaultRoot+sep)||vaultRoot.startsWith(projectRoot+sep))throw Error('Choose a project outside the vault.');
 const folder=vault.getAbstractFileByPath(LEGACY_REPLY_ROOT) as TFolder|null;
 if(!folder)return {files:0,removed:0,directory};
 const files:TFile[]=[],folders:TFolder[]=[];
 function visit(item:TFile|TFolder){
  if('children' in item){if(item.path!==LEGACY_REPLY_ROOT&&!/^T3 Code Attachments\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(item.path))throw Error('The attachment folder contains unrelated folders.');folders.push(item);for(const child of item.children)visit(child as TFile|TFolder);}
  else {if(!legacyReplyPath(item.path))throw Error('The attachment folder contains unrelated files.');files.push(item);}
 }
 visit(folder);
 app.workspace.iterateAllLeaves(leaf=>{const path=(leaf.view as any).file?.path;if(path===LEGACY_REPLY_ROOT||path?.startsWith(LEGACY_REPLY_ROOT+'/'))throw Error('Close the old attachment file before moving it.');});
 const copies:Array<{file:TFile;source:string;path:string;sha256:string}>=[];
 for(const file of files){
  const source=file.path,path=directory+'/'+source;
  const sourceDisk=join(vaultRoot,source);
  if(await fs.realpath(sourceDisk)!==sourceDisk||(await fs.lstat(sourceDisk)).isSymbolicLink())throw Error('Symlinked imports cannot be moved.');
  const bytes=new Uint8Array(await vault.readBinary(file)),destination=resolve(projectRoot,path);
  let parent=projectRoot;
  for(const part of path.split('/').slice(0,-1)){parent=join(parent,part);try{await fs.mkdir(parent,{mode:0o700});}catch(error:any){if(error.code!=='EEXIST')throw error;}if(await fs.realpath(parent)!==parent||!(await fs.lstat(parent)).isDirectory())throw Error('The archive directory is not a normal project folder.');}
  try{await fs.writeFile(destination,bytes,{flag:'wx',mode:0o600});}catch(error:any){if(error.code!=='EEXIST')throw error;}
  if(await fs.realpath(destination)!==destination||!(await fs.lstat(destination)).isFile()||hash(await fs.readFile(destination))!==hash(bytes))throw Error('The archived copy does not match the vault file.');
  copies.push({file,source,path,sha256:hash(bytes)});
 }
 await remember(copies);
 let removed=0;
 for(const copy of copies){
  if(copy.file.path!==copy.source||vault.getAbstractFileByPath(copy.source)!==copy.file||hash(new Uint8Array(await vault.readBinary(copy.file)))!==copy.sha256)throw Error('A vault attachment changed during the move. The archive and links are retained.');
  if(hash(await fs.readFile(resolve(projectRoot,copy.path)))!==copy.sha256)throw Error('An archived attachment changed during the move.');
  await vault.delete(copy.file);removed++;
 }
 for(const old of folders.reverse())if(!old.children.length&&vault.getAbstractFileByPath(old.path)===old)await vault.delete(old);
 return {files:copies.length,removed,directory,sha256:Object.fromEntries(copies.map(copy=>[copy.source,copy.sha256]))};
}
