import {sameWorkspacePath} from './folder-link';
export interface PrivateStorageRoute {version:1;workspaceRoot:string;configDir:string;storageRoot:string}
export const storageRoutePath=(configDir:string)=>`${configDir}/t3-code/storage-route.json`;
/** Connections opened before migration must discover its route on later IO. */
export function privateStorageResolver(read:(path:string)=>Promise<string|undefined>,root:string,configDir:string){
  let selected:string|undefined;
  return async()=>{if(selected)return selected;const route=readPrivateStorageRoute(await read(storageRoutePath(configDir)),root,configDir);if(route)selected=route.storageRoot;return selected??root;};
}
export function readPrivateStorageRoute(raw:string|undefined,root:string,configDir:string){
  if(raw===undefined)return undefined;
  const route:PrivateStorageRoute=JSON.parse(raw),absolute=(path:string)=>/^(?:\/|[a-z]:[\\/])/i.test(path),inside=(parent:string,child:string)=>{parent=parent.replace(/\\/g,'/').replace(/\/+$/,'');child=child.replace(/\\/g,'/');return sameWorkspacePath(parent,child)||child.toLowerCase().startsWith(parent.toLowerCase()+'/');};
  if(route.version!==1||!sameWorkspacePath(route.workspaceRoot,root)||route.configDir!==configDir||typeof route.storageRoot!=='string'||!absolute(route.storageRoot)||inside(root,route.storageRoot))throw Error('Invalid private vault storage route.');
  return route;
}
