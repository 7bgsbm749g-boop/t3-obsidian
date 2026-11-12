import {visibleInlineInput} from '../responses/input-presentation';

export type ThreadTitleGeneration = 'untitled-only' | 'always';
export const AUTO_THREAD_TITLE = 'New thread';

export function threadTitleGeneration(value:unknown):ThreadTitleGeneration {
  return value==='always'?'always':'untitled-only';
}

/** Internal naming choice; sendDirect seeds automatic titles from the prompt. */
export function noteThreadTitle(notePath:string|undefined,mode:ThreadTitleGeneration):string {
  const basename=notePath?.split('/').at(-1)?.replace(/\.md$/i,'').trim();
  return mode==='always'||!basename||/^untitled(?: \d+)?$/i.test(basename)
    ? AUTO_THREAD_TITLE : basename.slice(0,160);
}

/** Match T3 clients' readable initial title while server generation runs. */
export function promptThreadTitle(prompt:string,attachments:readonly {type:string;name:string}[]=[]):string {
  const images=new Set<string>();
  const prose=visibleInlineInput(prompt).replace(/!?\[((?:\\.|[^\]\\\r\n])*)\]\(t3-context:\/\/([^\s)]+)\)/g,(_match,label:string,reference:string)=>{
    if(/^(?:v1\/)?image(?:\/|$)/.test(reference)){images.add(reference);return '';}
    return label.replace(/\\([\\[\]])/g,'$1');
  }).trim().replace(/\s+/gu,' ');
  if(prose){const characters=Array.from(prose);return characters.length>50?characters.slice(0,50).join('')+'...':prose;}
  const count=attachments.filter(attachment=>attachment.type==='image').length||images.size;
  if(count)return count===1?'Attached image':'Attached images';
  return AUTO_THREAD_TITLE;
}
