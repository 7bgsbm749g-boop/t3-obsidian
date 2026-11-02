import {markdownCodeRanges} from './reply-html';
import {insideResponse} from './response-container';

/** A note-local identity, separate from a response or its current path. */
export const noteIdentityMarker=(id:string)=>`<!-- t3-note-id:${id} -->`;
export function noteIdentityRanges(document:string){
  const candidates=[...document.matchAll(/^<!-- t3-note-id:([a-f0-9]{64}) -->\r?$/gm)];
  if(!candidates.length)return [];
  const code=markdownCodeRanges(document);
  return candidates.filter(match=>!code.some(([from,to])=>match.index!>=from&&match.index!<to)&&!insideResponse(document,match.index!))
    .map(match=>({id:match[1],from:match.index!,to:match.index!+match[0].length}));
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

/** Only missed moves require a bounded, sequential vault scan. Never pick the
 * first of several copies, including copies not open in an editor. */
export async function uniqueNoteLocation(matches:(document:string)=>boolean,paths:string[],read:(path:string)=>Promise<string|undefined>){
  let found:string|undefined;const deadline=Date.now()+20000;
  for(const path of paths){
    if(Date.now()>deadline)throw Error('The T3 note identity check took too long. Send again or choose an existing thread.');
    const document=await read(path);
    if(document===undefined||!matches(document))continue;
    if(found)throw Error(`This T3 note identity appears in several notes: ${found}; ${path}. Choose separate note identities before sending.`);
    found=path;
  }
  return found;
}
