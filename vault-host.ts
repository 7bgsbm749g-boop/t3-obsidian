import type {FolderLink} from './folder-link';

/** A vault location is independent of any T3 project or thread workspace. */
export interface VaultHost {connectionId:string;environmentId?:string;workspaceRoot:string}

export function loadVaultHost(value:unknown):VaultHost|undefined {
  if(!value||typeof value!=='object')return;
  const host=value as VaultHost;
  if(typeof host.connectionId!=='string'||typeof host.workspaceRoot!=='string'||!host.workspaceRoot.trim()||host.environmentId!==undefined&&(typeof host.environmentId!=='string'||!host.environmentId))return;
  return {connectionId:host.connectionId,workspaceRoot:host.workspaceRoot,...(host.environmentId?{environmentId:host.environmentId}:{})};
}

/** Read old root associations in place. Never rewrite or relocate old history. */
export function vaultHost(settings:{vaultHost?:VaultHost;folderLinks:FolderLink[]}):VaultHost|undefined {
  return loadVaultHost(settings.vaultHost)??loadVaultHost(settings.folderLinks.find(link=>link.folderPath==='/'));
}

/** The machine and its path form one choice; concurrent edits cannot mix them. */
export function mergeVaultHost(baseline:VaultHost|undefined,disk:VaultHost|undefined,intended:VaultHost|undefined):VaultHost|undefined {
  const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
  return same(baseline,intended)?disk:same(baseline,disk)||same(disk,intended)?intended:disk;
}
