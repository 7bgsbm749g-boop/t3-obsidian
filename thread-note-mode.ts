import {mergeNoteThreads,type NoteThread} from './note-threads';

export type ThreadNoteMode='free'|'one-to-one';
export const threadNoteMode=(value:unknown):ThreadNoteMode=>value==='one-to-one'?'one-to-one':'free';
export interface ModeThread {threadId?:string;projectId:string;environmentId?:string;connectionId?:string}
const identity=(entry:ModeThread)=>JSON.stringify([entry.environmentId??entry.connectionId??'',entry.projectId,entry.threadId]);
const order=(a:string,b:string)=>a<b?-1:a>b?1:0;

/** A reversible view of history. Most recent confirmed use wins; equal times
 * use stable identities so devices select the same pairs regardless of order.
 * No historical links, tombstones, or response text are changed. */
export function oneToOneNoteThreads(entries:NoteThread[]):NoteThread[]{
  const notes=new Set<string>(),threads=new Set<string>();
  return mergeNoteThreads(entries).filter(entry=>!entry.deletedAt)
    .sort((a,b)=>order(b.selectedAt,a.selectedAt)||order(a.notePath,b.notePath)||order(identity(a),identity(b)))
    .filter(entry=>{const key=identity(entry);if(notes.has(entry.notePath)||threads.has(key))return false;notes.add(entry.notePath);threads.add(key);return true;});
}

/** Check before writing a response or sending input. An unpaired note can
 * create a thread or select an unpaired thread. Existing pairs continue only.
 * Free mode retains the full historical graph and all destination choices. */
export function assertThreadNoteMode(mode:ThreadNoteMode,entries:NoteThread[],notePath:string|undefined,target:ModeThread,destinations:string[]=[]):void{
  if(mode!=='one-to-one')return;
  if(destinations.length>1||notePath&&destinations.some(path=>path!==notePath))throw Error('1:1 mode sends replies only to the source note. Switch to Free mode to use other destinations.');
  const path=notePath??destinations[0];if(!path)return;
  const pairs=oneToOneNoteThreads(entries),note=pairs.find(entry=>entry.notePath===path);
  if(note&&(!target.threadId||identity(note)!==identity(target)))throw Error('1:1 mode keeps this note in its linked thread. Continue that thread, or switch to Free mode to choose another.');
  const thread=target.threadId&&pairs.find(entry=>identity(entry)===identity(target));
  if(thread&&thread.notePath!==path)throw Error(`1:1 mode links this thread to ${thread.notePath}. Open that note, choose an unlinked thread, or switch to Free mode.`);
}
