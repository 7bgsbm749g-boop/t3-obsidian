import {startMarker,endMarker} from './inline-thread';
import {containerBody,containerStart,containerEnd,containsResponseBoundary,responseFrame,responseBoundaries} from './response-container';
import type {Transaction} from '@codemirror/state';

export interface LocalResponse {id:string;body:string}
export interface ProjectionRange {id:string;savedFrom:number;savedTo:number;displayFrom:number;displayTo:number;anchor:string}
export interface ResponseProjection {saved:string;display:string;ranges:ProjectionRange[]}
export class ProjectionConflict extends Error {}

/** New responses use one complete container. Existing journaled comment
 * anchors keep their original bytes until their checked final save. */
const usesLegacyAnchor=(id:string,document?:string)=>document!==undefined&&responseBoundaries(document).some(boundary=>boundary.id===id&&boundary.format==='inline'&&boundary.kind==='start');
export const responseAnchor=(id:string,document?:string)=>usesLegacyAnchor(id,document)?`${startMarker(id)}\n\n${endMarker(id)}`:containerBody(id,'');
export const renderResponse=(id:string,body:string,document?:string)=>usesLegacyAnchor(id,document)?`${startMarker(id)}\n${body}\n${endMarker(id)}`:containerBody(id,body);
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export function responseRegion(text:string,id:string):{from:number;to:number;body:string}|undefined {
  if(!uuid.test(id))throw new ProjectionConflict('Invalid response identity.');
  // A single present boundary must still pass the normal malformed-boundary
  // check. Only a completely absent identity can skip Markdown parsing.
  if(!containsResponseBoundary(text,id))return;
  try{const frame=responseFrame(text,id);if(frame)return {from:frame.from,to:frame.to,body:text.slice(frame.from+(frame.format==='container'?containerStart(id).length:startMarker(id).length),frame.to-(frame.format==='container'?containerEnd.length:endMarker(id).length))};}
  catch(error){throw new ProjectionConflict((error as Error).message);}
}

export function projectResponses(saved:string,responses:readonly LocalResponse[]):ResponseProjection {
  if(new Set(responses.map(r=>r.id)).size!==responses.length)throw new ProjectionConflict('Duplicate local response identity.');
  const located=responses.map(response=>{const region=responseRegion(saved,response.id);if(!region)throw new ProjectionConflict('The exact durable response anchor is missing.');return {response,region};}).sort((a,b)=>a.region.from-b.region.from);
  let display='',cursor=0;const ranges:ProjectionRange[]=[];
  for(const {response,region} of located){
    if(region.from<cursor)throw new ProjectionConflict('Overlapping response anchors.');
    const anchor=saved.slice(region.from,region.to);
    if(anchor!==responseAnchor(response.id,saved))throw new ProjectionConflict('Legacy response must be journaled and migrated before local projection.');
    // Validate output as well, so generated text cannot create a save escape.
    const rendered=renderResponse(response.id,response.body,saved);
    const output=responseRegion(rendered,response.id);
    if(!output||output.from!==0||output.to!==rendered.length)throw new ProjectionConflict('Generated text changed the response container boundaries.');
    display+=saved.slice(cursor,region.from);
    const displayFrom=display.length;display+=rendered;
    ranges.push({id:response.id,savedFrom:region.from,savedTo:region.to,displayFrom,displayTo:display.length,anchor});cursor=region.to;
  }
  display+=saved.slice(cursor);
  return {saved,display,ranges};
}

/** Read the current native document, preserving ordinary edits. Never use an
 * old whole-note snapshot to strip transient output. Lost boundaries fail
 * closed; explicit deletion is handled by the coordinator's tombstone path. */
export function savedProjection(display:string,projection:ResponseProjection):string {
  const edits=projection.ranges.map(range=>{
    const region=responseRegion(display,range.id);
    if(!region)throw new ProjectionConflict('An active response was removed without an explicit deletion record.');
    return {...region,anchor:range.anchor};
  }).sort((a,b)=>a.from-b.from);
  let result='',cursor=0;
  for(const edit of edits){if(edit.from<cursor)throw new ProjectionConflict('Overlapping displayed responses.');result+=display.slice(cursor,edit.from)+edit.anchor;cursor=edit.to;}
  return result+display.slice(cursor);
}

/** Map a validated native transaction. The protected response bytes cannot
 * change, so only ordinary Markdown and the small durable anchors need to be
 * parsed again. Document identity, rather than an old note snapshot, scopes
 * this result to the exact transaction that was checked. */
export function advanceProjection(transaction:Transaction,projection:ResponseProjection):ResponseProjection {
  let allowed=true;
  transaction.changes.iterChangedRanges((from,to)=>{if(!editableDisplayRange(projection,from,to))allowed=false;});
  if(!allowed)throw new ProjectionConflict('Generated response text is protected.');
  const ranges=projection.ranges.map(range=>({...range,displayFrom:transaction.changes.mapPos(range.displayFrom,1),displayTo:transaction.changes.mapPos(range.displayTo,-1)}));
  let saved='',cursor=0;
  for(const range of ranges){
    saved+=transaction.newDoc.sliceString(cursor,range.displayFrom);
    range.savedFrom=saved.length;saved+=range.anchor;range.savedTo=saved.length;cursor=range.displayTo;
  }
  saved+=transaction.newDoc.sliceString(cursor);
  // This also rejects duplicate markers and edits that hide a marker in code.
  const checked=projectResponses(saved,ranges.map(range=>({id:range.id,body:''})));
  if(checked.ranges.some((range,index)=>range.savedFrom!==ranges[index].savedFrom||range.savedTo!==ranges[index].savedTo))throw new ProjectionConflict('The response boundary moved outside its checked range.');
  return {saved,display:transaction.newDoc.toString(),ranges};
}

export function displayToSaved(projection:ResponseProjection,offset:number):{kind:'saved';offset:number}|{kind:'response';id:string;offset:number} {
  if(!Number.isSafeInteger(offset)||offset<0||offset>projection.display.length)throw new RangeError('Invalid displayed offset.');
  let delta=0;
  for(const range of projection.ranges){
    if(offset<=range.displayFrom)break;
    if(offset<range.displayTo)return {kind:'response',id:range.id,offset:offset-range.displayFrom};
    delta+=(range.displayTo-range.displayFrom)-(range.savedTo-range.savedFrom);
  }
  return {kind:'saved',offset:offset-delta};
}

export function savedToDisplay(projection:ResponseProjection,offset:number):number {
  if(!Number.isSafeInteger(offset)||offset<0||offset>projection.saved.length)throw new RangeError('Invalid saved offset.');
  let delta=0;
  for(const range of projection.ranges){
    if(offset<=range.savedFrom)break;
    if(offset<range.savedTo)throw new ProjectionConflict('Saved position is inside a response anchor.');
    delta+=(range.displayTo-range.displayFrom)-(range.savedTo-range.savedFrom);
  }
  return offset+delta;
}

export function editableDisplayRange(projection:ResponseProjection,from:number,to:number):boolean {
  return from>=0&&to>=from&&to<=projection.display.length&&!projection.ranges.some(range=>from<range.displayTo&&to>range.displayFrom||from===to&&from>range.displayFrom&&from<range.displayTo);
}
