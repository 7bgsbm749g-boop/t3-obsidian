import {markdownCodeRanges} from '../responses/reply-html';
import {insideResponse} from '../responses/response-container';

/** A note-local identity, separate from a response or its current path. */
export const noteIdentityMarker=(id:string)=>`<!-- t3-note-id:${id} -->`;
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
export function withNoteIdentity(document:string,id:string){
  if(!/^[a-f0-9]{64}$/.test(id))throw Error('Invalid T3 note ID.');
  noteIdentity(document);
  const marker=noteIdentityRanges(document)[0];
  if(marker)return document.slice(0,marker.from)+noteIdentityMarker(id)+document.slice(marker.to);
  return document+(document.endsWith('\n')?'':'\n')+'\n'+noteIdentityMarker(id)+'\n';
}
