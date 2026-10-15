import {destinationOffset} from './destination-section';
import {responseAnchor} from './native-response-projection';
import {intermediateMode} from './response-presentation';
import {commandId} from './direct';
import {initialRegion,endInsertionOffset,regionBody,startMarker} from './inline-thread';
import {safeNotePath,type HostedInlineRequest} from './hosted-inline';

export interface StreamNoteIO {
  updateNote(path:string,change:(document:string)=>string,allowed:()=>boolean):Promise<string|undefined>;
  completed?(id:string):Promise<boolean>;
  beforeInsert?(request:HostedInlineRequest):Promise<void>;
}
/** Attach a single response to a note without dispatching another prompt.
 * Stable IDs make registration/recovery retries reuse the same block. */
export async function editorStream(source:HostedInlineRequest,notePath:string,io:StreamNoteIO,allowed:()=>boolean,bindingId?:string):Promise<HostedInlineRequest>{
  if(!safeNotePath(notePath))throw Error('Choose a vault-relative Markdown note path.');
  const id=bindingId??commandId(source.id,`binding:${notePath}`),region=initialRegion(id,source.initialInput,source.threadTitle,intermediateMode(source.intermediateMode,source.keepIntermediate),{startedAt:source.createdAt});
  const request:HostedInlineRequest={...source,id,notePath,initialHash:region.bodyHash,independent:true};
  if(await io.completed?.(id))return request;
  await io.beforeInsert?.(request);
  const document=await io.updateNote(notePath,current=>{
    if(regionBody(current,id)||current.includes(`<!-- t3-response:start:${id} -->`))return current;
    const offset=destinationOffset(current,source.destinationSection);
    const before=current.slice(0,offset);
    const anchor=responseAnchor(id,source.responseContainer?undefined:startMarker(id));
    return before+(source.nativeProjection?(before&&!before.endsWith('\n')?'\n':'')+anchor+'\n':region.text)+current.slice(offset);
  },allowed);
  if(document===undefined)throw Error(`Destination note unavailable: ${notePath}`);
  return request;
}
