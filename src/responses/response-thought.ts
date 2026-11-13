/** These inputs are public provider reasoning summaries only. */
function plain(markdown:string):string {
  return markdown.replace(/!?\[([^\]]*)\]\([^)]*\)/g,'$1').replace(/^[ \t]*(?:#{1,6}|[-*+]|\d+\.)[ \t]+/gm,'').replace(/`+|\*\*|~~/g,'').replace(/(^|[^\w*])[*_]([^*_\n]+)[*_](?![\w*])/g,'$1$2').replace(/\s+/g,' ').trim();
}
export function liveThoughtLine(markdown:string):string {
  const first=markdown.trimStart().split(/\r?\n[ \t]*\r?\n/)[0]??'';
  const heading=/^[ \t]*(?:\*\*([^*\r\n]+)\*\*[ \t]*(?:\r?\n|$)|#{1,6}[ \t]+([^\r\n]+))/.exec(first);
  const value=plain(heading?.[1]??heading?.[2]??first);
  if(heading)return value;
  const end=/[.?!]["'”’)]?(?=\s)/.exec(value);
  return end?value.slice(0,end.index+end[0].length):value;
}
export function thoughtPresentation(markdown:string):{label:string;expandable:boolean} {
  const full=plain(markdown),characters=Array.from(full);
  // A short summary is the row itself. Longer traces get one public heading
  // or first-sentence preview, with the exact full Markdown behind disclosure.
  const summary=characters.length<=120&&!/\r?\n[ \t]*\r?\n\S/.test(markdown.trim())?full:liveThoughtLine(markdown);
  const preview=Array.from(summary),label=preview.length>120?preview.slice(0,119).join('').trimEnd()+'…':summary;
  return {label:label||'Thought',expandable:!!full&&full!==label};
}
