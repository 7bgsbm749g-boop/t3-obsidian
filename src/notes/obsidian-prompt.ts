import {replaceControlCharacters} from '../shared/values';
/** The only plugin-authored suffix on a sent user message. */
export function obsidianFooter(vault:string,notePath?:string,sharedVaultId?:string):string {
  const line=(value:string)=>replaceControlCharacters(value,true);
  const scope=notePath&&sharedVaultId&&/^[a-zA-Z0-9_-]{1,128}$/.test(sharedVaultId)?`\nShared vault ID: ${sharedVaultId}`:'';
  return `\n\nSent from Obsidian.\nVault: ${line(vault)}\nNote: ${line(notePath??'(no note open)')}${scope}`;
}
