import {replaceControlCharacters} from '../shared/values';
/** The only plugin-authored suffix on a sent user message. */
export function obsidianFooter(vault:string,notePath?:string,taskIds:readonly string[]=[]):string {
  const line=(value:string)=>replaceControlCharacters(value,true);
  return `\n\nSent from Obsidian.\nVault: ${line(vault)}\nNote: ${line(notePath??'(no note open)')}${[...new Set(taskIds)].filter(id=>/^[\w-]{1,256}$/.test(id)).sort().map(id=>`\nTaskflow task ID: ${id}`).join('')}`;
}
