export interface FolderTrigger {
  id:string;
  folderPath:string;
  connectionId:string;
  projectId:string;
  tag:string;
  enabled:boolean;
}

export interface FolderTriggerReceipt {
  key:string;
  triggerId:string;
  noteId:string;
  path:string;
  sentAt:number;
}

export interface FolderTriggerState {triggers:FolderTrigger[];receipts:FolderTriggerReceipt[]}
type EventKind='create'|'rename'|'modify'|'scan';
export interface TriggerEvent {kind:EventKind;path:string;previousPath?:string;noteId:string;tags?:Iterable<string>}
interface Match {trigger:FolderTrigger;receiptKey:string}

function cleanPath(value:string){return value.trim().replace(/\\/g,'/').replace(/^\/+|\/+$/g,'').replace(/\/{2,}/g,'/');}
export function normalizeFolderPath(value:string){
  const path=cleanPath(value);
  if(!path||path.split('/').some(part=>!part||part==='.'||part==='..'))throw Error('Choose a folder inside the vault.');
  return path;
}
export function normalizeTriggerTag(value:string){
  const tag=value.trim().replace(/^#+/,'').toLocaleLowerCase();
  if(!tag||/[\s#,[\]|]/u.test(tag))throw Error('Enter one tag, such as #ready.');
  return tag;
}
export function normalizeFolderTrigger(value:FolderTrigger):FolderTrigger{
  const trigger={id:value.id.trim(),folderPath:normalizeFolderPath(value.folderPath),connectionId:value.connectionId.trim(),projectId:value.projectId.trim(),tag:normalizeTriggerTag(value.tag??''),enabled:value.enabled!==false};
  if(!trigger.id||!trigger.connectionId||!trigger.projectId)throw Error('The folder trigger is incomplete.');
  return trigger;
}
export function isPathInFolder(path:string,folderPath:string){const file=cleanPath(path),folder=cleanPath(folderPath);return !!folder&&file.startsWith(`${folder}/`);}
export function triggerReceiptKey(triggerId:string,noteId:string){return `${encodeURIComponent(triggerId)}:${encodeURIComponent(noteId)}`;}
function hasTag(tags:Iterable<string>|undefined,required:string){if(!tags)return false;for(const value of tags)try{if(normalizeTriggerTag(value)===required)return true;}catch{/* Ignore malformed metadata. */}return false;}
export function matchFolderTriggers(event:TriggerEvent,triggers:readonly FolderTrigger[],receiptKeys:ReadonlySet<string>):Match[]{
  if(!event.path.toLocaleLowerCase().endsWith('.md')||!event.noteId)return [];
  const matches:Match[]=[];
  for(const raw of triggers){let trigger:FolderTrigger;try{trigger=normalizeFolderTrigger(raw);}catch{continue;}
    if(!trigger.enabled||!isPathInFolder(event.path,trigger.folderPath)||!hasTag(event.tags,trigger.tag))continue;
    const entered=event.kind==='create'||event.kind==='scan'||(event.kind==='rename'&&!isPathInFolder(event.previousPath??'',trigger.folderPath));
    if(!entered&&event.kind!=='modify')continue;
    const receiptKey=triggerReceiptKey(trigger.id,event.noteId);if(!receiptKeys.has(receiptKey))matches.push({trigger,receiptKey});
  }
  return matches;
}
export function makeTriggerReceipt(match:Match,event:TriggerEvent,sentAt=Date.now()):FolderTriggerReceipt{return {key:match.receiptKey,triggerId:match.trigger.id,noteId:event.noteId,path:cleanPath(event.path),sentAt};}

/** Reads the old workflow keys once, retaining only the supported tag rules. */
export function loadFolderTriggerState(data:any):FolderTriggerState{
  const source=Array.isArray(data?.folderTriggers)?data.folderTriggers:Array.isArray(data?.workflowLinks)?data.workflowLinks.filter((item:any)=>item?.mode==='trigger').map((item:any)=>({...item,tag:item.tag})):[];
  const triggers:FolderTrigger[]=[];for(const item of source)try{triggers.push(normalizeFolderTrigger(item));}catch{/* Drop obsolete or malformed rules. */}
  const ids=new Set(triggers.map(item=>item.id));const sourceReceipts=Array.isArray(data?.folderTriggerReceipts)?data.folderTriggerReceipts:Array.isArray(data?.workflowReceipts)?data.workflowReceipts.map((item:any)=>({...item,triggerId:item.linkId})):[];
  const receipts=sourceReceipts.filter((item:any)=>ids.has(item?.triggerId)&&typeof item.key==='string'&&typeof item.noteId==='string').map((item:any)=>({key:item.key,triggerId:item.triggerId,noteId:item.noteId,path:cleanPath(item.path??''),sentAt:Number(item.sentAt)||0}));
  return {triggers,receipts};
}
