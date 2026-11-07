import {markdownCodeRanges} from '../responses/reply-html';
import {insideResponse} from '../responses/response-container';

/** Read-only compatibility for retiring old in-note identities. */
export function noteIdentityRanges(document:string){
  const candidates=[...document.matchAll(/^<!-- t3-note-id:([a-f0-9]{64}) -->\r?$/gm)];
  if(!candidates.length)return [];
  const code=markdownCodeRanges(document);
  return candidates.filter(match=>!code.some(([from,to])=>match.index>=from&&match.index<to)&&!insideResponse(document,match.index))
    .map(match=>({id:match[1],from:match.index,to:match.index+match[0].length}));
}
export function noteIdentity(document:string){
  const markers=noteIdentityRanges(document);
  if(markers.length>1)throw Error('This note has several T3 note IDs. Keep one note ID before sending.');
  return markers[0]?.id;
}
/** Compatibility cleanup only. New identities live in the synced registry. */
export function withoutNoteIdentity(document:string){
  const ranges=noteIdentityRanges(document);let result=document;
  for(const range of ranges.reverse())result=result.slice(0,range.from)+result.slice(range.to);
  return result;
}
