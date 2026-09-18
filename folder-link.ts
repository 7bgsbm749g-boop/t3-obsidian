export interface FolderLink {
  id:string;
  folderPath:string;
  connectionId:string;
  projectId:string;
  projectTitle:string;
  workspaceRoot:string;
  self:boolean;
}

function cleanPath(value:string){return value.trim().replace(/\\/g,'/').replace(/^\/+|\/+$/g,'').replace(/\/{2,}/g,'/');}

export function normalizeFolderPath(value:string){
  const path=cleanPath(value);
  if(!path||path.split('/').some(part=>!part||part==='.'||part==='..'))throw Error('Choose a folder inside the vault.');
  return path;
}

export function normalizeFolderLink(value:FolderLink):FolderLink{
  const link={id:value.id.trim(),folderPath:normalizeFolderPath(value.folderPath),connectionId:value.connectionId.trim(),projectId:value.projectId.trim(),projectTitle:value.projectTitle.trim(),workspaceRoot:value.workspaceRoot.trim(),self:value.self===true};
  if(!link.id||!link.projectId||!link.projectTitle||!link.workspaceRoot)throw Error('The folder link is incomplete.');
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
