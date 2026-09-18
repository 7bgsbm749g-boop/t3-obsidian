import { sha256 } from '@noble/hashes/sha256';
import { sha1 } from '@noble/hashes/sha1';
import { Buffer } from 'buffer';
import type { Connection } from './bridge';
export type CompletionAction = 'keep' | 'archive' | 'delete';
export interface CompletionSettings {action: CompletionAction; archiveFolder: string}
export interface NoteCompletion {
  notePath: string; contentHash: string; ctime: number; action: CompletionAction; archiveFolder: string;
}
export interface CompletionJob extends NoteCompletion {
  requestId: string; threadId: string; projectId: string; connection: Connection;
  status: 'watching' | 'kept'; detail?: string; destination?: string;
}
export function contentHash(text: string) {return Buffer.from(sha256(new TextEncoder().encode(text))).toString('hex');}
export function archiveFolder(value: string): string {
  const path=value.trim().replace(/\\/g,'/');
  if (!path || path.startsWith('/') || /[:\x00-\x1f]/.test(path) || path.split('/').some(p=>!p || p==='.' || p==='..' || p.startsWith('.') || /[<>"|?*]/.test(p) || /[. ]$/.test(p))) {
    throw new Error('Choose a normal folder inside the vault, such as Archive/T3 Code.');
  }
  return path;
}
// The integration derives the initial user-message ID from the request ID using UUID v5.
export function initialMessageId(requestId: string): string {
  const bytes=Buffer.from(sha1(Buffer.concat([Buffer.from(requestId.replace(/-/g,''),'hex'),Buffer.from('message')]))).subarray(0,16);
  bytes[6]=(bytes[6]&15)|80;bytes[8]=(bytes[8]&63)|128;
  const h=bytes.toString('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
export function completionState(thread: any, job: CompletionJob): 'wait'|'complete'|'keep' {
  if(thread?.id!==job.threadId || thread.projectId!==job.projectId) return 'wait';
  if(['error','interrupted'].includes(thread.latestTurn?.state) || thread.session?.status==='error' || thread.session?.lastError) return 'keep';
  if(thread.latestTurn?.state!=='completed' || !['ready','stopped'].includes(thread.session?.status) || thread.session?.activeTurnId || thread.hasPendingApprovals!==false || thread.hasPendingUserInput!==false) return 'wait';
  return 'complete';
}
export function isOriginalCompletedTurn(thread: any, job: CompletionJob): boolean {
  const users=thread?.messages?.filter((m:any)=>m.role==='user');
  return thread?.id===job.threadId && thread.projectId===job.projectId && thread.latestTurn?.state==='completed' && ['ready','stopped'].includes(thread.session?.status) && !thread.session?.activeTurnId && !thread.session?.lastError && users?.length===1 && users[0].id===initialMessageId(job.requestId) && thread.messages.some((m:any)=>m.role==='assistant' && m.id===thread.latestTurn?.assistantMessageId && m.streaming===false);
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
export async function cleanCompletedNote(job:CompletionJob, io:CleanupIO):Promise<string> {
  if(!io.active()) throw new Error('Monitoring stopped.');
  const file=io.find(job.notePath);
  if(!file) return 'Note no longer at its original path; no action taken.';
  const unchanged=async()=>file.ctime===job.ctime && contentHash(await io.read(file))===job.contentHash && !io.hasUnsavedChanges(file,job.contentHash);
  if(!await unchanged()) return 'Kept note because it changed after sending.';
  if(job.action==='keep') return 'Kept note.';
  if(job.action==='archive') {
    const folder=archiveFolder(job.archiveFolder);
    if(job.notePath.startsWith(folder+'/')) return 'Note is already in the archive folder.';
    if(!job.destination){
      const base=`${folder}/${job.notePath}`;let candidate=base;let suffix=1;
      while(io.exists(candidate)) candidate=base.replace(/\.md$/i,` (${suffix++}).md`);
      job.destination=candidate;await io.save();
    }
    if(io.exists(job.destination)) return 'Kept note because the archive destination is occupied.';
    const parts=job.destination.split('/').slice(0,-1);let path='';
    for(const part of parts){path=path?`${path}/${part}`:part;if(!io.exists(path))await io.mkdir(path);}
    if(!io.active())throw new Error('Monitoring stopped.');
    if(!await unchanged())return 'Kept note because it changed during completion handling.';
    if(!io.active())throw new Error('Monitoring stopped.');
    await io.move(file,job.destination);return `Archived to ${job.destination}`;
  }
  if(!io.active())throw new Error('Monitoring stopped.');
  await io.trash(file);return 'Moved note to vault trash.';
}
