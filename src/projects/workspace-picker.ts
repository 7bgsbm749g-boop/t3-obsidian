export interface NewWorkspaceFolder {parentPath:string;name:string}

/** Keep the machine and path together: a Windows path must never follow a Linux selection. */
export interface ProjectCreationLocation {connectionId:string;environmentId?:string;deviceId?:string;parentPath:string;selectedAt:string}
export interface WorkspaceMachine {id:string;local?:boolean;environmentId?:string}

export function workspaceParentPath(path:string):string {
  const clean=path.replace(/[\\/]+$/,'');
  if(!clean)return path.startsWith('\\\\')?'\\\\':'/';
  if(/^[a-z]:$/i.test(clean))return clean+(path.includes('\\')?'\\':'/');
  if(/^(?:\\\\|\/\/)[^\\/]+[\\/][^\\/]+$/.test(clean))return clean;
  const index=Math.max(clean.lastIndexOf('/'),clean.lastIndexOf('\\'));
  if(index<0)return '~';
  if(index===0)return clean[0];
  const parent=clean.slice(0,index);
  return /^[a-z]:$/i.test(parent)?parent+clean[index]:parent;
}

export function loadProjectCreationLocations(value:unknown):ProjectCreationLocation[] {
  if(!Array.isArray(value))return [];
  return value.filter((v):v is ProjectCreationLocation=>!!v&&typeof v.connectionId==='string'&&typeof v.parentPath==='string'&&!!v.parentPath.trim()&&typeof v.selectedAt==='string'&&Number.isFinite(Date.parse(v.selectedAt))&&(v.environmentId===undefined||typeof v.environmentId==='string')&&(v.deviceId===undefined||typeof v.deviceId==='string'));
}
export function rememberProjectCreationLocation(locations:ProjectCreationLocation[],location:ProjectCreationLocation):ProjectCreationLocation[] {
  const key=(v:ProjectCreationLocation)=>v.environmentId?'environment:'+v.environmentId:v.connectionId||'device:'+v.deviceId;
  return [...locations.filter(v=>key(v)!==key(location)),location].sort((a,b)=>Date.parse(b.selectedAt)-Date.parse(a.selectedAt)).slice(0,30);
}
export function projectCreationDefaults(locations:ProjectCreationLocation[],machines:WorkspaceMachine[],deviceId:string,machineId?:string):{machineId:string;parentPath:string} {
  for(const location of [...locations].sort((a,b)=>Date.parse(b.selectedAt)-Date.parse(a.selectedAt))){
    const candidates=machines.filter(m=>!machineId||m.id===machineId);
    const machine=candidates.find(m=>m.local?!location.connectionId&&location.deviceId===deviceId:m.id===location.connectionId&&(!location.environmentId||m.environmentId===location.environmentId))
      ??candidates.find(m=>!!location.environmentId&&m.environmentId===location.environmentId);
    if(machine)return {machineId:machine.id,parentPath:location.parentPath};
  }
  return {machineId:machineId??machines[0]?.id??'',parentPath:'~'};
}

export function workspaceChildPath(parentPath:string,name:string):string {
  if(!parentPath.trim()||parentPath==='~')throw Error('Browse to a parent folder first.');
  if(!name||name!==name.trim()||name==='.'||name==='..'||/[\\/<>:"|?*\u0000-\u001f\u007f]/.test(name)||/[. ]$/.test(name))throw Error('Enter a valid folder name without path separators.');
  if(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))throw Error('Choose a folder name that is not reserved by Windows.');
  const separator=parentPath.includes('\\')&&!parentPath.includes('/')?'\\':'/';
  return parentPath.replace(/[\\/]+$/,'')+separator+name;
}

export function filterWorkspaceFolders<T extends {name:string}>(entries:T[],query:string):T[] {
  const needle=query.toLowerCase();
  return entries.filter(entry=>entry.name.toLowerCase().includes(needle));
}
