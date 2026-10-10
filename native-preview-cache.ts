import {safeNotePath} from './hosted-inline';
import {projectResponses,responseAnchor} from './native-response-projection';
import type {LeaseRecord} from './inline-lease';

/** Display evidence only. These entries cannot register a job, acquire a
 * writer lease, restore a marker or authorize a native final commit. */
export interface NativePreviewEntry {
  id:string;vaultId:string;notePath:string;threadId:string;projectId:string;
  threadEnvironmentId:string;messageId:string;epoch:number;revision:number;
  sequence:number;body:string;
}
export interface NativePreviewSnapshot {version:1;vaultId:string;entries:NativePreviewEntry[]}
export const MAX_NATIVE_PREVIEWS=32;
export const MAX_NATIVE_PREVIEW_CHARACTERS=8_000_000;
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export const previewMessageId=(record:LeaseRecord)=>record.state?.pendingMessageId??record.state?.messageId??record.request.messageId;
export function previewMatches(entry:NativePreviewEntry,record:LeaseRecord){
  const request=record.request;
  return entry.id===request.id&&entry.vaultId===request.vaultId&&entry.notePath===(record.state?.notePath??request.notePath)&&entry.threadId===request.threadId&&entry.projectId===request.projectId&&entry.threadEnvironmentId===request.threadEnvironmentId&&entry.messageId===previewMessageId(record);
}
export function sameNativePreview(a:NativePreviewEntry,b:NativePreviewEntry){
  return a.id===b.id&&a.vaultId===b.vaultId&&a.notePath===b.notePath&&a.threadId===b.threadId&&a.projectId===b.projectId&&a.threadEnvironmentId===b.threadEnvironmentId&&a.messageId===b.messageId&&a.epoch===b.epoch&&a.revision===b.revision&&a.sequence===b.sequence&&a.body===b.body;
}
/** Only the owning manager may supply its already validated, in-memory entry.
 * Persisted snapshots always validate their body again. Metadata is checked
 * on every update, even when that exact body's projection is already known. */
export function checkedNativePreview(entry:any,vaultId:string,previous?:NativePreviewEntry):NativePreviewEntry|undefined {
  if(!entry||!uuid.test(entry.id??'')||entry.vaultId!==vaultId||!safeNotePath(entry.notePath)||entry.notePath.length>4096||![entry.threadId,entry.projectId,entry.threadEnvironmentId,entry.messageId].every(text=>typeof text==='string'&&text.length>0&&text.length<=256)||![entry.epoch,entry.revision].every(n=>Number.isSafeInteger(n)&&n>=0)||!Number.isSafeInteger(entry.sequence)||entry.sequence< -1||typeof entry.body!=='string'||!entry.body||entry.body.length>MAX_NATIVE_PREVIEW_CHARACTERS)return;
  if(previous?.id!==entry.id||previous?.body!==entry.body){try{projectResponses(responseAnchor(entry.id),[{id:entry.id,body:entry.body}]);}catch{return;}}
  const {id,notePath,threadId,projectId,threadEnvironmentId,messageId,epoch,revision,sequence,body}=entry;
  return {id,vaultId,notePath,threadId,projectId,threadEnvironmentId,messageId,epoch,revision,sequence,body};
}
export function loadNativePreviews(value:any,vaultId:string):NativePreviewEntry[]{
  if(value?.version!==1||value.vaultId!==vaultId||!Array.isArray(value.entries))return [];
  const entries:NativePreviewEntry[]=[],seen=new Set<string>();let characters=0;
  for(const entry of value.entries.slice(-MAX_NATIVE_PREVIEWS)){
    if(!entry||seen.has(entry.id)||typeof entry.body!=='string'||characters+entry.body.length>MAX_NATIVE_PREVIEW_CHARACTERS)continue;
    const checked=checkedNativePreview(entry,vaultId);if(!checked)continue;
    entries.push(checked);seen.add(checked.id);characters+=checked.body.length;
  }
  return entries;
}
