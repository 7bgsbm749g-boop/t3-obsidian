import {contentHash} from './completion';
import {regionBody,finalizeRegion} from './inline-thread';
import {responseBoundaries} from './response-container';
import {stoppedResponseBody} from './response-stop';

/** A confirmed failed identity owns no active tags, including duplicate copies.
 * Preserve ordinary text and any reply prose while removing live controls. */
export function removeFailedResponse(document:string,id:string){
  try{const region=regionBody(document,id);if(region){const change=finalizeRegion(document,id,contentHash(region.body),stoppedResponseBody(region.body));if(change)return document.slice(0,change.from)+change.text+document.slice(change.to);}}catch{/* Damaged/duplicate boundaries can still be removed without deleting prose. */}
  const boundaries=responseBoundaries(document).filter(boundary=>boundary.id===id),changes:Array<{from:number;to:number;text:string}>=[];
  let start:typeof boundaries[number]|undefined;
  for(const boundary of boundaries){
    if(boundary.kind==='start'){if(start)changes.push({from:start.from,to:start.to,text:''});start=boundary;}
    else if(start){changes.push({from:start.from,to:boundary.to,text:stoppedResponseBody(document.slice(start.to,boundary.from))});start=undefined;}
    else changes.push({from:boundary.from,to:boundary.to,text:''});
  }
  if(start)changes.push({from:start.from,to:start.to,text:''});
  for(const change of changes.sort((a,b)=>b.from-a.from))document=document.slice(0,change.from)+change.text+document.slice(change.to);
  return document;
}
