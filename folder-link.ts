import {normalizeTriggerTag} from './tag-trigger';

export interface FolderLink {
  id:string;
  folderPath:string;
  connectionId:string;
  projectId:string;
  projectTitle:string;
  workspaceRoot:string;
  self:boolean;
  vaultId?:string;
  environmentId?:string;
  tagTrigger?:{enabled:boolean;tag:string;deviceId:string};
}

function cleanPath(value:string){return value.trim().replace(/\\/g,'/').replace(/^\/+|\/+$/g,'').replace(/\/{2,}/g,'/');}

export function normalizeFolderPath(value:string){
  if(value.trim().replace(/\\/g,'/')==='/')return '/';
  const path=cleanPath(value);
  if(!path||path.split('/').some(part=>!part||part==='.'||part==='..'))throw Error('Choose a folder inside the vault.');
  return path;
}

/** The nearest saved association owns a note, independently of its tag switch. */
export function folderLinkForPath(links:FolderLink[],path:string):FolderLink|undefined{
  return links.filter(link=>link.folderPath==='/'||path.startsWith(link.folderPath+'/'))
    .sort((a,b)=>(b.folderPath==='/'?0:b.folderPath.length)-(a.folderPath==='/'?0:a.folderPath.length))[0];
}

export function sameWorkspacePath(a:string,b:string):boolean{
  const clean=(path:string)=>path.replace(/\\/g,'/').replace(/\/+$/,'');
  const left=clean(a),right=clean(b);
  return /^[a-z]:\//i.test(left)||left.startsWith('//')?left.toLowerCase()===right.toLowerCase():left===right;
}

export function normalizeFolderLink(value:FolderLink):FolderLink{
  const link:FolderLink={id:value.id.trim(),folderPath:normalizeFolderPath(value.folderPath),connectionId:value.connectionId.trim(),projectId:value.projectId.trim(),projectTitle:value.projectTitle.trim(),workspaceRoot:value.workspaceRoot.trim(),self:value.self===true};
  if(!link.id||!link.projectId||!link.projectTitle||!link.workspaceRoot)throw Error('The folder link is incomplete.');
  if(typeof value.vaultId==='string'&&value.vaultId)link.vaultId=value.vaultId;
  if(typeof value.environmentId==='string'&&value.environmentId)link.environmentId=value.environmentId;
  if(value.tagTrigger)try{
    const tag=normalizeTriggerTag(value.tagTrigger.tag);
    const deviceId=typeof value.tagTrigger.deviceId==='string'?value.tagTrigger.deviceId:'';
    link.tagTrigger={tag,deviceId,enabled:value.tagTrigger.enabled===true&&!!deviceId};
  }catch{/* Invalid optional rules leave the saved link inert. */}
  return link;
}

/** Migrates the final tag-trigger format into inert saved links. */
export function loadFolderLinks(data:any):FolderLink[]{
  const source=Array.isArray(data?.folderLinks)?data.folderLinks:Array.isArray(data?.folderTriggers)?data.folderTriggers.map((item:any)=>({...item,projectTitle:item.projectTitle??item.projectId,workspaceRoot:item.workspaceRoot??item.folderPath,self:false})):[];
  const links:FolderLink[]=[];
  for(const item of source)try{links.push(normalizeFolderLink(item));}catch{/* Drop malformed legacy data. */}
  return links;
}

export function upsertFolderLink(links:FolderLink[],link:FolderLink){
  const normalized=normalizeFolderLink(link);
  return [...links.filter(item=>item.folderPath!==normalized.folderPath),normalized];
}
