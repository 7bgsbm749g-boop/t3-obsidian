import {contentHash} from './completion';
import {changedEdits,mergeSavedEdits} from './coordinated-merge';
import {localResponseRange,responseBindingComment,withLocalResponseBinding} from './local-response-binding';
import {responseIds} from './response-container';
import {responseRegion} from './native-response-projection';
import type {HostedInlineRequest,InlineFiles} from './hosted-inline';

export const localStagePaths=(request:HostedInlineRequest,hash:string)=>({original:`${request.host.directory}/local-staging/${request.id}/${hash}.original.md`,staged:`${request.host.directory}/local-staging/${request.id}/${hash}.staged.md`});
export async function localStagedDraft(document:string,request:HostedInlineRequest,files:InlineFiles){
  if(!request.localStage)return document;
  const {originalHash,stagedHash}=request.localStage;
  const original=await files.read(localStagePaths(request,originalHash).original),staged=await files.read(localStagePaths(request,stagedHash).staged);
  if(original===undefined||staged===undefined||contentHash(original)!==originalHash||contentHash(staged)!==stagedHash)throw Error('The checked staged note edit is unavailable.');
  const before=localResponseRange(original,request.id)??responseRegion(original,request.id),current=localResponseRange(document,request.id);
  if(!before||!current)throw Error('The staged response block changed.');
  const canonical='request' in before?document.replace(responseBindingComment(current.request),responseBindingComment(before.request)):document.slice(0,current.from)+document.slice(responseRegion(document,request.id)!.from);
  const merged=mergeSavedEdits(original,canonical,changedEdits(original,staged));
  if(!merged.ok)throw Error(merged.reason);
  const restored=localResponseRange(merged.text,request.id);
  return restored?merged.text.replace(responseBindingComment(restored.request),responseBindingComment(request)):withLocalResponseBinding(merged.text,request);
}
/** Called by the desktop plugin's existing command endpoint. Agent staging is
 * outside the live vault. Immutable checked inputs travel through T3's file
 * transport; they grant no remote writer and create no background service. */
export async function localStageCommand(kind:'stage-note-edit'|'submit-note-edit',request:HostedInlineRequest,document:string,files:InlineFiles,expectedHash?:string){
  const fs=(await import('node:fs')).promises,path=await import('node:path'),os=await import('node:os');
  const root=path.join(os.tmpdir(),'send-to-t3-code-local-staging',contentHash(request.vaultId).slice(0,24),request.id);
  const originalPath=path.join(root,'original.md'),stagingPath=path.join(root,'staged.md');
  if(kind==='stage-note-edit'){
    await fs.mkdir(root,{recursive:true,mode:0o700});
    let original:string;
    try{original=await fs.readFile(originalPath,'utf8');}catch(error:any){if(error.code!=='ENOENT')throw error;original=document;await fs.writeFile(originalPath,original,{flag:'wx',mode:0o600});}
    try{await fs.writeFile(stagingPath,original,{flag:'wx',mode:0o600});}catch(error:any){if(error.code!=='EEXIST')throw error;}
    return {stagingPath,originalHash:contentHash(original),notePath:request.notePath};
  }
  const original=await fs.readFile(originalPath,'utf8'),staged=await fs.readFile(stagingPath,'utf8');
  if(contentHash(original)!==expectedHash)throw Error('The staged original hash changed.');
  const binding=localResponseRange(original,request.id);if(!binding||!localResponseRange(document,request.id))throw Error('The staged response is no longer active.');
  const ids=responseIds(original);if(JSON.stringify(ids)!==JSON.stringify(responseIds(staged)))throw Error('Do not change response anchors in the staged note.');
  for(const id of ids){const a=localResponseRange(original,id)??responseRegion(original,id),b=localResponseRange(staged,id)??responseRegion(staged,id);if(a&&(!b||original.slice(a.from,a.to)!==staged.slice(b.from,b.to)))throw Error('Do not change response bindings in the staged note.');}
  const originalHash=contentHash(original),stagedHash=contentHash(staged);
  for(const [name,bytes] of [[localStagePaths(request,originalHash).original,original],[localStagePaths(request,stagedHash).staged,staged]]){const previous=await files.read(name);if(previous!==undefined&&previous!==bytes)throw Error('The immutable staged edit changed.');if(previous===undefined)await files.write(name,bytes);}
  const updated={...request,localStage:{originalHash,stagedHash}};
  await localStagedDraft(document.replace(responseBindingComment(request),responseBindingComment(updated)),updated,files);
  return {staged:true,originalHash,stagedHash,request:updated};
}
