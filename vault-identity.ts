/** A small host identity record avoids downloading the growing settings file. */
export const vaultIdentityPath=(configDir:string)=>`${configDir}/t3-code/vault-identity.json`;
export function identityPathForSettings(settingsPath:string):string|undefined{
  const configDir=/^(.+)\/plugins\/[^/]+\/data\.json$/.exec(settingsPath)?.[1];
  if(!configDir||configDir.startsWith('/')||configDir.includes('\\')||configDir.includes(':')||configDir.split('/').some(part=>!part||part==='.'||part==='..'))return undefined;
  return vaultIdentityPath(configDir);
}
export function readVaultIdentityRecord(contents:string):string|undefined{
  try{const record=JSON.parse(contents);return record?.version===1&&typeof record.vaultId==='string'&&record.vaultId.length>0&&record.vaultId.length<=512?record.vaultId:undefined;}catch{return undefined;}
}
export interface VaultIdentityFiles {
  exists(path:string):Promise<boolean>;
  read(path:string):Promise<string>;
  mkdir(path:string):Promise<void>;
  write(path:string,contents:string):Promise<void>;
}
export async function ensureVaultIdentityRecord(files:VaultIdentityFiles,configDir:string,vaultId:string):Promise<void>{
  if(!vaultId||vaultId.length>512)throw Error('Invalid vault identity.');
  const path=vaultIdentityPath(configDir),contents=JSON.stringify({version:1,vaultId})+'\n';
  if(await files.exists(path)&&await files.read(path)===contents)return;
  const directory=path.slice(0,path.lastIndexOf('/'));
  if(!await files.exists(directory))try{await files.mkdir(directory);}catch(error){if(!await files.exists(directory))throw error;}
  await files.write(path,contents);
}
