import {destinationOffset} from './destination-section';
import {responseAnchor} from './native-response-projection';
import {intermediateMode} from './response-presentation';
import {commandId} from './direct';
import {initialRegion,endInsertionOffset,regionBody,startMarker} from './inline-thread';
import {safeNotePath,validateResponseRequest,type ResponseRequest} from './response-model';
import {resolveCursorInsertion,type CursorInsertion} from './cursor-insertion';

export interface StreamNoteIO {
  updateNote(path:string,change:(document:string)=>string,allowed:()=>boolean):Promise<string|undefined>;
  completed?(id:string):Promise<boolean>;
  beforeInsert?(request:ResponseRequest):Promise<void>;
}
/** Attach a single response to a note without dispatching another prompt.
 * Stable IDs make registration/recovery retries reuse the same block. */
export async function editorStream(source:ResponseRequest,notePath:string,io:StreamNoteIO,allowed:()=>boolean,bindingId?:string,insertion?:CursorInsertion):Promise<ResponseRequest>{
  if(!safeNotePath(notePath))throw Error('Choose a vault-relative Markdown note path.');
  const id=bindingId??commandId(source.id,`binding:${notePath}`),region=initialRegion(id,source.initialInput,source.threadTitle,intermediateMode(source.intermediateMode,source.keepIntermediate),{startedAt:source.createdAt});
  const request:ResponseRequest={...source,id,notePath,initialHash:region.bodyHash,independent:true};
  // Registration persists this contract after insertion. Reject invalid data
  // before invoking note IO, so a failed request cannot leave an empty slot.
  validateResponseRequest(request);
  if(await io.completed?.(id))return request;
  await io.beforeInsert?.(request);
  const document=await io.updateNote(notePath,current=>{
    if(regionBody(current,id)||current.includes(`<!-- t3-response:start:${id} -->`))return current;
    const offset=insertion&&!source.destinationSection?resolveCursorInsertion(current,insertion):destinationOffset(current,source.destinationSection);
    const before=current.slice(0,offset);
    const anchor=responseAnchor(id,source.responseContainer?undefined:startMarker(id));
    if(insertion&&!source.destinationSection&&source.nativeProjection){
      const after=current.slice(offset),prefix=!before||/\n[ \t]*\n[ \t]*$/.test(before)?'':before.endsWith('\n')?'\n':'\n\n';
      const suffix=after.startsWith('\n\n')?'':after.startsWith('\n')?'\n':'\n\n';
      return before+prefix+anchor+suffix+after;
    }
    return before+(source.nativeProjection?(before&&!before.endsWith('\n')?'\n':'')+anchor+'\n':region.text)+current.slice(offset);
  },allowed);
  if(document===undefined)throw Error(`Destination note unavailable: ${notePath}`);
  return request;
}
