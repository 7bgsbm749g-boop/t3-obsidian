import {replaceControlCharacters} from '../shared/values';
/** The only plugin-authored suffix on a sent user message. */
export function obsidianFooter(vault:string,notePath?:string):string {
  const line=(value:string)=>replaceControlCharacters(value,true);
  return `\n\nSent from Obsidian.\nVault: ${line(vault)}\nNote: ${line(notePath??'(no note open)')}`;
}
