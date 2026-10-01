import {commandId} from './direct';
import {initialRegion,endInsertionOffset,regionBody} from './inline-thread';
import {safeNotePath,type HostedInlineRequest} from './hosted-inline';

export interface StreamNoteIO {
  updateNote(path:string,change:(document:string)=>string,allowed:()=>boolean):Promise<string|undefined>;
}
/** Attach a single response to a note without dispatching another prompt.
 * Stable IDs make registration/recovery retries reuse the same block. */
export async function editorStream(source:HostedInlineRequest,notePath:string,io:StreamNoteIO,allowed:()=>boolean):Promise<HostedInlineRequest>{
  if(!safeNotePath(notePath))throw Error('Choose a vault-relative Markdown note path.');
  const id=commandId(source.id,`binding:${notePath}`),region=initialRegion(id,source.initialInput,source.threadTitle);
  const request:HostedInlineRequest={...source,id,notePath,initialHash:region.bodyHash,independent:true};
  const document=await io.updateNote(notePath,current=>{
    if(regionBody(current,id)||current.includes(`<!-- t3-response:start:${id} -->`))return current;
    const offset=endInsertionOffset(current);
    return current.slice(0,offset)+region.text+current.slice(offset);
  },allowed);
  if(document===undefined)throw Error(`Destination note unavailable: ${notePath}`);
  return request;
}
