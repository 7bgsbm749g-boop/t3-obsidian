import type {FolderLink} from './folder-link';

export interface ReplyFolders {images:string;files:string}
export const DEFAULT_REPLY_FOLDERS:ReplyFolders={images:'T3 Code Attachments',files:'T3 Code Attachments'};

/** A destination is always a visible folder beneath its vault/project scope. */
export function replyFolder(value:unknown):string {
  if(typeof value!=='string')throw Error('Choose an attachment folder.');
  const path=value.trim().replace(/\\/g,'/').replace(/\/+$/,'');
  if(!path||path.startsWith('/')||/[\x00-\x1f\x7f<>:"|?*]/.test(path)||path.split('/').some(part=>!part||part.startsWith('.')||part.trim()!==part))throw Error('Choose a folder inside the vault or linked folder, without hidden folders or traversal.');
  return path;
}
export function validateReplyFolders(value:ReplyFolders):ReplyFolders {
  return {images:replyFolder(value?.images),files:replyFolder(value?.files)};
}
export function loadReplyFolders(value:unknown):ReplyFolders {
  const result={...DEFAULT_REPLY_FOLDERS};
  for(const key of ['images','files'] as const)try{result[key]=replyFolder((value as ReplyFolders)?.[key]);}catch{/* Preserve legacy defaults for malformed settings. */}
  return result;
}
/** Resolve from the source note, including for replies mirrored elsewhere. */
export function resolveReplyFolders(general:ReplyFolders,links:FolderLink[],sourcePath:string,intendedLink?:FolderLink):ReplyFolders {
  const candidates=intendedLink?[...links.filter(link=>link.folderPath!==intendedLink.folderPath),intendedLink]:links;
  const link=candidates.filter(link=>link.folderPath!=='/'&&sourcePath.startsWith(link.folderPath+'/')).sort((a,b)=>b.folderPath.length-a.folderPath.length)[0];
  if(!link)return validateReplyFolders(general);
  const folders=loadReplyFolders(link.replyFolders);
  return {images:`${link.folderPath}/${folders.images}`,files:`${link.folderPath}/${folders.files}`};
}
