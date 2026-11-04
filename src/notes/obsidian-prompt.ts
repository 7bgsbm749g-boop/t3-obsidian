/** The only plugin-authored suffix on a sent user message. */
export function obsidianFooter(vault:string,notePath?:string):string {
  const line=(value:string)=>value.replace(/[\r\n\x00-\x1f\x7f]/g,' ');
  return `\n\nSent from Obsidian.\nVault: ${line(vault)}\nNote: ${line(notePath??'(no note open)')}`;
}
