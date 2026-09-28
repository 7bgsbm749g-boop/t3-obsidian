/** A confirmed T3 destination for a note. Records live in synced plugin data. */
export interface NoteThread {
  notePath:string;
  threadId:string;
  projectId:string;
  workspaceRoot:string;
  connectionId:string;
  environmentId?:string;
  selectedAt:string;
  deletedAt?:string;
}

export function loadNoteThreads(value:unknown):NoteThread[]{
  if(!Array.isArray(value))return [];
  const result:NoteThread[]=[];
  for(const item of value){
    if(!item||typeof item!=='object')continue;
    const entry=item as Record<string,unknown>;
    if(!['notePath','threadId','projectId','workspaceRoot','connectionId','selectedAt'].every(key=>typeof entry[key]==='string'))continue;
    if(!entry.notePath||!entry.threadId||!entry.projectId||!entry.selectedAt)continue;
    result.push({notePath:entry.notePath as string,threadId:entry.threadId as string,projectId:entry.projectId as string,workspaceRoot:entry.workspaceRoot as string,connectionId:entry.connectionId as string,selectedAt:entry.selectedAt as string,...(typeof entry.environmentId==='string'?{environmentId:entry.environmentId}:{}),...(typeof entry.deletedAt==='string'?{deletedAt:entry.deletedAt}:{})});
  }
  return mergeNoteThreads([],result);
}

function key(entry:NoteThread){return `${entry.notePath}\0${entry.projectId}\0${entry.environmentId??entry.connectionId}\0${entry.threadId}`;}

/** Preserve records added on another device while this device was editing settings. */
export function mergeNoteThreads(...groups:NoteThread[][]):NoteThread[]{
  const merged=new Map<string,NoteThread>();
  for(const group of groups)for(const entry of group){const id=key(entry),previous=merged.get(id);if(!previous||(entry.deletedAt??entry.selectedAt)>(previous.deletedAt??previous.selectedAt))merged.set(id,{...entry});}
  return [...merged.values()];
}

export function activeNoteThread(entries:NoteThread[],path:string):NoteThread|undefined{
  return entries.filter(entry=>entry.notePath===path&&!entry.deletedAt).sort((a,b)=>b.selectedAt.localeCompare(a.selectedAt))[0];
}

export function previousNoteThreads(entries:NoteThread[],path:string):NoteThread[]{
  return entries.filter(entry=>entry.notePath===path&&!entry.deletedAt).sort((a,b)=>b.selectedAt.localeCompare(a.selectedAt));
}
