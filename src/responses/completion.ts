import {isRecord} from '../shared/values';
import type {NormalizedThread} from '../connection/wire-types';
import { sha256 } from '@noble/hashes/sha2';
import { sha1 } from '@noble/hashes/legacy';
import { Buffer } from 'buffer/';
import type { Connection } from '../app/bridge';
export type CompletionAction = 'keep' | 'archive' | 'delete';
export interface CompletionSettings {action: CompletionAction; archiveFolder: string}
export interface NoteCompletion {
  notePath: string; contentHash: string; ctime: number; action: CompletionAction; archiveFolder: string;
}
export interface CompletionJob extends NoteCompletion {
  requestId: string; threadId: string; projectId: string; connection: Connection;
  status: 'watching' | 'kept'; detail?: string; destination?: string;
}
let desktopContentHash:((text:string)=>string)|undefined;
/** Desktop installs its native implementation after the platform check. Keep
 * the portable path available without loading any Node module on mobile. */
export function installContentHasher(hash:(text:string)=>string){
  desktopContentHash=hash;
  return ()=>{if(desktopContentHash===hash)desktopContentHash=undefined;};
}
export function contentHash(text: string) {return desktopContentHash?desktopContentHash(text):Buffer.from(sha256(new TextEncoder().encode(text))).toString('hex');}
// The integration derives the initial user-message ID from the request ID using UUID v5.
export function initialMessageId(requestId: string): string {
  const bytes=Buffer.from(sha1(Buffer.concat([Buffer.from(requestId.replace(/-/g,''),'hex'),Buffer.from('message')]))).slice(0,16);
  bytes[6]=(bytes[6]&15)|80;bytes[8]=(bytes[8]&63)|128;
  const h=bytes.toString('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
export function completionState(input:unknown, job: CompletionJob): 'wait'|'complete'|'keep' {
  const thread:Partial<NormalizedThread>=isRecord(input)?input:{};
  if(thread?.id!==job.threadId || thread.projectId!==job.projectId) return 'wait';
  if(['error','interrupted'].includes(thread.latestTurn?.state??'') || thread.session?.status==='error' || thread.session?.lastError) return 'keep';
  if(thread.latestTurn?.state!=='completed' || !['ready','stopped'].includes(thread.session?.status??'') || thread.session?.activeTurnId || thread.hasPendingApprovals!==false || thread.hasPendingUserInput!==false || thread.backgroundLiveness) return 'wait';
  return 'complete';
}
export function isOriginalCompletedTurn(input:unknown, job: CompletionJob): boolean {
  const thread:Partial<NormalizedThread>=isRecord(input)?input:{};
  const users=thread?.messages?.filter(m=>m.role==='user');
  return thread?.id===job.threadId && thread.projectId===job.projectId && thread.latestTurn?.state==='completed' && ['ready','stopped'].includes(thread.session?.status??'') && !thread.session?.activeTurnId && !thread.session?.lastError && users?.length===1 && users[0].id===initialMessageId(job.requestId) && thread.messages?.some(m=>m.role==='assistant' && m.id===thread.latestTurn?.assistantMessageId && m.streaming===false)===true;
}
export interface CleanupFile {path:string;ctime:number}
export interface CleanupIO {
  find(path:string):CleanupFile|null;
  read(file:CleanupFile):Promise<string>;
  hasUnsavedChanges(file:CleanupFile, hash:string):boolean;
  exists(path:string):boolean;
  mkdir(path:string):Promise<void>;
  move(file:CleanupFile,destination:string):Promise<void>;
  trash(file:CleanupFile):Promise<void>;
  save():Promise<void>;
  active():boolean;
}
/** Legacy callers retain notes unconditionally. No archive or deletion path remains. */
export async function cleanCompletedNote(_job:CompletionJob, _io:CleanupIO):Promise<string> {
  return 'Kept note.';
}
