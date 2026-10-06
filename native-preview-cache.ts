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
export function loadNativePreviews(value:any,vaultId:string):NativePreviewEntry[]{
  if(value?.version!==1||value.vaultId!==vaultId||!Array.isArray(value.entries))return [];
  const entries:NativePreviewEntry[]=[],seen=new Set<string>();let characters=0;
  for(const entry of value.entries.slice(-MAX_NATIVE_PREVIEWS)){
    if(!entry||!uuid.test(entry.id??'')||entry.vaultId!==vaultId||!safeNotePath(entry.notePath)||entry.notePath.length>4096||seen.has(entry.id)||![entry.threadId,entry.projectId,entry.threadEnvironmentId,entry.messageId].every(text=>typeof text==='string'&&text.length>0&&text.length<=256)||![entry.epoch,entry.revision].every(n=>Number.isSafeInteger(n)&&n>=0)||!Number.isSafeInteger(entry.sequence)||entry.sequence< -1||typeof entry.body!=='string'||!entry.body||characters+entry.body.length>MAX_NATIVE_PREVIEW_CHARACTERS)continue;
    try{projectResponses(responseAnchor(entry.id),[{id:entry.id,body:entry.body}]);}catch{continue;}
    const {id,notePath,threadId,projectId,threadEnvironmentId,messageId,epoch,revision,sequence,body}=entry;
    entries.push({id,vaultId,notePath,threadId,projectId,threadEnvironmentId,messageId,epoch,revision,sequence,body});seen.add(id);characters+=body.length;
  }
  return entries;
}
