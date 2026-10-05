import {markdownCodeRanges} from './reply-html';

export const INLINE_REPLY_INSTRUCTION='Answer in the T3 thread. The Obsidian plugin will insert your reply.';
export const THREAD_REPLY_INSTRUCTION='Answer in the T3 thread.';

/** Hide only the generated trailing delivery footer. Canonical messages and
 * selection receipts retain their exact bytes; old checkpoints use this same
 * presentation path after recovery. Quoted/code examples remain ordinary input. */
export function visibleInlineInput(text:string):string {
  const footer=/\n\nSent from Obsidian\.\nObsidian vault: ("(?:[^"\\\r\n]|\\.)*")\nDestination note path: ("(?:[^"\\\r\n]|\\.)*")\s*$/.exec(text);
  if(!footer||!text.slice(0,footer.index).trim()||markdownCodeRanges(text).some(([from,to])=>footer.index+2>=from&&footer.index+2<to))return text;
  try{JSON.parse(footer[1]);JSON.parse(footer[2]);}catch{return text;}
  let visible=text.slice(0,footer.index);
  for(const instruction of [INLINE_REPLY_INSTRUCTION,THREAD_REPLY_INSTRUCTION]){
    const suffix=`\n\n${instruction}`;
    if(visible.endsWith(suffix)){visible=visible.slice(0,-suffix.length);break;}
  }
  return visible;
}
