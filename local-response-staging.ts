import {contentHash} from './completion';
import {changedEdits,mergeSavedEdits} from './coordinated-merge';
import {localResponseRange,withoutLocalResponseBinding} from './local-response-binding';
import {responseIds} from './response-container';
import type {ResponseRequest,ResponseFiles} from './response-model';

export const localStagePaths=(request:ResponseRequest,hash:string)=>({original:`${request.host.directory}/local-staging/${request.id}/${hash}.original.md`,staged:`${request.host.directory}/local-staging/${request.id}/${hash}.staged.md`});
const normalized=(document:string)=>{for(const id of responseIds(document))document=withoutLocalResponseBinding(document,id);return document;};
export async function localStagedDraft(document:string,request:ResponseRequest,files:ResponseFiles){
  if(!request.localStage)return document;
  const {originalHash,stagedHash}=request.localStage;
  const original=await files.read(localStagePaths(request,originalHash).original),staged=await files.read(localStagePaths(request,stagedHash).staged);
  if(original===undefined||staged===undefined||contentHash(original)!==originalHash||contentHash(staged)!==stagedHash)throw Error('The checked staged note edit is unavailable.');
  const before=localResponseRange(original,request.id,[request]),current=localResponseRange(document,request.id,[request]);
  if(!before||!current)throw Error('The staged response block changed.');
  const canonical=normalized(original),merged=mergeSavedEdits(canonical,normalized(document),changedEdits(canonical,normalized(staged)));
  if(!merged.ok)throw Error(merged.reason);
  return merged.text;
}
/** Load desktop built-ins through a bundled relative module. Native dynamic
 * node: imports use the renderer's browser loader and cannot resolve there. */
export async function localStageCommand(kind:'stage-note-edit'|'submit-note-edit',request:ResponseRequest,document:string,files:ResponseFiles,expectedHash?:string){
  return (await import('./local-response-staging-desktop')).localStageCommand(kind,request,document,files,expectedHash);
}
