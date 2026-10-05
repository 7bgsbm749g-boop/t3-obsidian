import {loadReplyFolders,type ReplyFolders} from './reply-locations';
export interface FolderLink {
  replyFolders?:ReplyFolders;
  id:string;
  folderPath:string;
  connectionId:string;
  projectId:string;
  projectTitle:string;
  workspaceRoot:string;
  self:boolean;
  vaultId?:string;
  environmentId?:string;
}

function cleanPath(value:string){return value.trim().replace(/\\/g,'/').replace(/^\/+|\/+$/g,'').replace(/\/{2,}/g,'/');}

export function normalizeFolderPath(value:string){
  if(value.trim().replace(/\\/g,'/')==='/')return '/';
  const path=cleanPath(value);
  if(!path||path.split('/').some(part=>!part||part==='.'||part==='..'))throw Error('Choose a folder inside the vault.');
  return path;
}

/** The nearest saved association owns a note. */
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
  if(value.replyFolders!==undefined)link.replyFolders=loadReplyFolders(value.replyFolders);
  return link;
}

export function loadFolderLinks(data:any):FolderLink[]{
  const source=Array.isArray(data?.folderLinks)?data.folderLinks:[];
  const links:FolderLink[]=[];
  for(const item of source)try{links.push(normalizeFolderLink(item));}catch{/* Drop malformed links. */}
  return links;
}

export function upsertFolderLink(links:FolderLink[],link:FolderLink){
  const normalized=normalizeFolderLink(link);
  return [...links.filter(item=>item.folderPath!==normalized.folderPath),normalized];
}
