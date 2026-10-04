export interface NewWorkspaceFolder {parentPath:string;name:string}

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
