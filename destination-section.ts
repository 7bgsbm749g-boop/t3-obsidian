import {markdownCodeRanges} from './reply-html';
import {endInsertionOffset} from './inline-thread';
export function validateDestinationSection(value:unknown):string|undefined {
  if(value===undefined)return;
  if(typeof value!=='string'||!value.trim()||value!==value.trim()||value.length>200||/[\r\n\x00-\x1f]/.test(value))throw Error('Choose an exact unique Markdown heading for the destination section.');
  return value;
}
/** Exact unique ATX heading, outside code. Inserts before the next sibling or
 * parent heading; all existing text and independent bindings stay in place. */
export function destinationOffset(document:string,section?:string){
  validateDestinationSection(section);if(!section)return endInsertionOffset(document);
  const code=markdownCodeRanges(document);
  const headings=[...document.matchAll(/^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/gm)].filter(match=>!code.some(([from,to])=>match.index!>=from&&match.index!<to));
  const matches=headings.filter(match=>match[2].trim()===section);
  if(matches.length!==1)throw Error('Destination section is missing or ambiguous; choose a unique exact heading.');
  const target=matches[0],next=headings.find(match=>match.index!>target.index!&&match[1].length<=target[1].length);
  const end=next?.index??document.length;
  // Preserve frontmatter/anchor validation and avoid nested response insertion.
  endInsertionOffset(document);
  return end;
}
