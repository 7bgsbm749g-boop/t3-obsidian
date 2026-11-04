/** A thread used by a confirmed send or attached run import. Records live in synced plugin data. */
export interface NoteThread {
  notePath:string;
  noteId?:string;
  threadId:string;
  projectId:string;
  workspaceRoot:string;
  connectionId:string;
  environmentId?:string;
  selectedAt:string;
  updatedAt?:string;
  deletedAt?:string;
  renamedAt?:string;
}

export function loadNoteThreads(value:unknown):NoteThread[]{
  if(!Array.isArray(value))return [];
  const result:NoteThread[]=[];
  for(const item of value){
    if(!item||typeof item!=='object')continue;
    const entry=item as Record<string,unknown>;
    if(!['notePath','threadId','projectId','workspaceRoot','connectionId','selectedAt'].every(key=>typeof entry[key]==='string'))continue;
    if(!entry.notePath||!entry.threadId||!entry.projectId||!entry.selectedAt)continue;
    result.push({notePath:entry.notePath as string,threadId:entry.threadId as string,projectId:entry.projectId as string,workspaceRoot:entry.workspaceRoot as string,connectionId:entry.connectionId as string,selectedAt:entry.selectedAt as string,...(typeof entry.noteId==='string'&&/^[a-f0-9]{64}$/.test(entry.noteId)?{noteId:entry.noteId}:{}),...(typeof entry.renamedAt==='string'&&Number.isFinite(Date.parse(entry.renamedAt))?{renamedAt:entry.renamedAt}:{}),...(typeof entry.updatedAt==='string'&&Number.isFinite(Date.parse(entry.updatedAt))?{updatedAt:entry.updatedAt}:{}),...(typeof entry.environmentId==='string'?{environmentId:entry.environmentId}:{}),...(typeof entry.deletedAt==='string'?{deletedAt:entry.deletedAt}:{})});
  }
  return mergeNoteThreads([],result);
}

function key(entry:NoteThread){return `${entry.noteId?'id:'+entry.noteId:'path:'+entry.notePath}\0${entry.projectId}\0${entry.environmentId??entry.connectionId}\0${entry.threadId}`;}

/** Preserve records added on another device while this device was editing settings. */
export function mergeNoteThreads(...groups:NoteThread[][]):NoteThread[]{
  const merged=new Map<string,NoteThread>();
  for(const group of groups)for(const entry of group){const id=key(entry),previous=merged.get(id),move=entry.noteId?entry.renamedAt??'':'',oldMove=previous?.noteId?previous.renamedAt??'':'';if(!previous||move>oldMove||move===oldMove&&(revision(entry)>revision(previous)||revision(entry)===revision(previous)&&!!entry.deletedAt&&!previous.deletedAt))merged.set(id,{...entry});}
  return [...merged.values()];
}

const revision=(entry:NoteThread)=>entry.updatedAt??entry.deletedAt??entry.selectedAt;
export function mutateNoteThreads(entries:NoteThread[],before:string,after?:string,folder=false,now=Date.now()):NoteThread[]{
  const at=new Date(Math.max(now,...entries.map(entry=>Date.parse(revision(entry))+1).filter(Number.isFinite))).toISOString();
  const affected=entries.filter(entry=>!entry.deletedAt&&(entry.notePath===before||folder&&entry.notePath.startsWith(before+'/')));
  return mergeNoteThreads(entries,affected.filter(entry=>!entry.noteId||after===undefined).map(entry=>({...entry,updatedAt:at,deletedAt:at})),after===undefined?[]:affected.map(entry=>({...entry,notePath:after+entry.notePath.slice(before.length),updatedAt:at,...(entry.noteId?{renamedAt:at}:{})})));
}

type NoteIdentities=Record<string,{path:string;deleted?:boolean;renamedAt?:number}>;
/** Migrate existing live path links without adding source or changing which
 * conversation was last selected. Existing stable links keep their identity. */
export function bindNoteThreadIds(entries:NoteThread[],notes:NoteIdentities):NoteThread[]{
  const paths=new Map<string,string>();
  for(const [id,note] of Object.entries(notes).sort(([a],[b])=>a.localeCompare(b)))if(!note.deleted&&!paths.has(note.path))paths.set(note.path,id);
  return mergeNoteThreads(entries.map(entry=>!entry.noteId&&!entry.deletedAt&&paths.has(entry.notePath)?{...entry,noteId:paths.get(entry.notePath)}:entry));
}
/** Resolve the stable identity before Free/1:1 selection. A receiving client's
 * old-path deletion cannot erase a separately proven move. */
export function resolveNoteThreadPaths(entries:NoteThread[],notes:NoteIdentities):NoteThread[]{
  return mergeNoteThreads(entries.map(entry=>{
    const note=entry.noteId&&notes[entry.noteId];
    if(!note)return entry;
    if(note.deleted)return {...entry,deletedAt:entry.deletedAt??entry.updatedAt??entry.selectedAt};
    if(note.path===entry.notePath)return entry;
    if(entry.deletedAt&&(!note.renamedAt||note.renamedAt<=(Date.parse(entry.renamedAt??'')||0)))return entry;
    const {deletedAt,...live}=entry;
    return {...live,notePath:note.path,...(note.renamedAt?{renamedAt:new Date(note.renamedAt).toISOString()}:{} )};
  }));
}

export function lastUsedNoteThread(entries:NoteThread[],path:string):NoteThread|undefined{
  return entries.filter(entry=>entry.notePath===path&&!entry.deletedAt).sort((a,b)=>b.selectedAt.localeCompare(a.selectedAt))[0];
}

export function previousNoteThreads(entries:NoteThread[],path:string):NoteThread[]{
  return entries.filter(entry=>entry.notePath===path&&!entry.deletedAt).sort((a,b)=>b.selectedAt.localeCompare(a.selectedAt));
}
