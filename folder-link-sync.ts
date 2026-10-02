import {normalizeFolderLink,normalizeFolderPath,type FolderLink} from './folder-link';
/** One latest mutation per folder, including unlink tombstones, travels through Sync. */
export interface FolderLinkChange {folderPath:string;id:string;at:string;link:FolderLink|null}
export function loadFolderLinkChanges(value:unknown):FolderLinkChange[]{
  if(!Array.isArray(value))return [];
  const result:FolderLinkChange[]=[];
  for(const item of value)try{
    if(typeof item.id!=='string'||!item.id||typeof item.at!=='string'||!Number.isFinite(Date.parse(item.at)))continue;
    const folderPath=normalizeFolderPath(item.folderPath),link=item.link===null?null:normalizeFolderLink(item.link);
    if(link&&link.folderPath!==folderPath)continue;
    result.push({folderPath,id:item.id,at:new Date(item.at).toISOString(),link});
  }catch{/* Ignore malformed Sync records. */}
  return mergeFolderLinkChanges(result);
}
export function mergeFolderLinkChanges(...groups:FolderLinkChange[][]):FolderLinkChange[]{
  const result=new Map<string,FolderLinkChange>();
  for(const group of groups)for(const change of group){
    const previous=result.get(change.folderPath);
    if(!previous||change.at>previous.at||change.at===previous.at&&change.id>previous.id)result.set(change.folderPath,change);
  }
  return [...result.values()].sort((a,b)=>a.folderPath.localeCompare(b.folderPath));
}
export function applyFolderLinkChanges(links:FolderLink[],changes:FolderLinkChange[]):FolderLink[]{
  const changed=new Set(changes.map(change=>change.folderPath));
  return [...links.filter(link=>!changed.has(link.folderPath)),...changes.flatMap(change=>change.link?[change.link]:[])];
}
const same=(a:FolderLink|undefined,b:FolderLink|undefined)=>JSON.stringify(a&&normalizeFolderLink(a))===JSON.stringify(b&&normalizeFolderLink(b));
export function changedFolderLinks(before:FolderLink[],after:FolderLink[],known:FolderLinkChange[],id:()=>string,now=Date.now()):FolderLinkChange[]{
  // Advance beyond known timestamps even if a desktop's clock moves backwards.
  const at=new Date(Math.max(now,...known.map(change=>Date.parse(change.at)+1))).toISOString();
  return [...new Set([...before,...after].map(link=>link.folderPath))].flatMap(folderPath=>{
    const previous=before.find(link=>link.folderPath===folderPath),link=after.find(link=>link.folderPath===folderPath);
    return same(previous,link)?[]:[{folderPath,id:id(),at,link:link?normalizeFolderLink(link):null}];
  });
}
/** Unmodified legacy links adopt disk changes rather than overwriting another client. */
export function mergeLegacyFolderLinks(before:FolderLink[],disk:FolderLink[],intended:FolderLink[]):FolderLink[]{
  return [...new Set([...before,...disk,...intended].map(link=>link.folderPath))].flatMap(path=>{
    const previous=before.find(link=>link.folderPath===path),next=intended.find(link=>link.folderPath===path);
    const chosen=same(previous,next)?disk.find(link=>link.folderPath===path):next;
    return chosen?[chosen]:[];
  });
}
