import {startMarker,endMarker} from './inline-thread';
import {markdownCodeRanges} from './reply-html';

export interface LocalResponse {id:string;body:string}
export interface ProjectionRange {id:string;savedFrom:number;savedTo:number;displayFrom:number;displayTo:number;anchor:string}
export interface ResponseProjection {saved:string;display:string;ranges:ProjectionRange[]}
export class ProjectionConflict extends Error {}

/** An unchanged, empty marker pair supplies identity and placement. Existing
 * marker syntax keeps selection, steering, Stop/Continue and Answer targeting
 * compatible; native Obsidian renders the unmodified response Markdown. */
export const responseAnchor=(id:string)=>`${startMarker(id)}\n\n${endMarker(id)}`;
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export function responseRegion(text:string,id:string):{from:number;to:number;body:string}|undefined {
  if(!uuid.test(id))throw new ProjectionConflict('Invalid response identity.');
  const start=startMarker(id),end=endMarker(id);
  // A single present boundary must still pass the normal malformed-boundary
  // check. Only a completely absent identity can skip Markdown parsing.
  if(!text.includes(start)&&!text.includes(end))return;
  const code=markdownCodeRanges(text);
  // Ordinary text may touch either OUTER edge of a hidden comment. Matching
  // the whole line made that legal edit invalidate every later edit and save.
  const markers=[...text.matchAll(/<!-- t3-(?:inline|response):(start|end):([0-9a-fA-F-]{36}) -->/g)].filter(match=>!code.some(([from,to])=>match.index!>=from&&match.index!<to));
  const own=markers.filter(match=>match[0]===start||match[0]===end);
  if(!own.length)return;
  if(own.length!==2||own[0][0]!==start||own[1][0]!==end)throw new ProjectionConflict('Missing, duplicate or reversed response boundaries.');
  const from=own[0].index!,last=own[1].index!;
  const body=text.slice(from+start.length,last);
  if(markers.some(match=>match.index!>from&&match.index!<last))throw new ProjectionConflict('Nested response boundaries.');
  return {from,to:last+end.length,body};
}

export function projectResponses(saved:string,responses:readonly LocalResponse[]):ResponseProjection {
  if(new Set(responses.map(r=>r.id)).size!==responses.length)throw new ProjectionConflict('Duplicate local response identity.');
  const located=responses.map(response=>{const region=responseRegion(saved,response.id);if(!region)throw new ProjectionConflict('The exact durable response anchor is missing.');return {response,region};}).sort((a,b)=>a.region.from-b.region.from);
  let display='',cursor=0;const ranges:ProjectionRange[]=[];
  for(const {response,region} of located){
    if(region.from<cursor)throw new ProjectionConflict('Overlapping response anchors.');
    const anchor=saved.slice(region.from,region.to);
    if(anchor!==responseAnchor(response.id))throw new ProjectionConflict('Legacy response must be journaled and migrated before local projection.');
    // Validate output as well, so generated text cannot create a save escape.
    const rendered=`${startMarker(response.id)}\n${response.body}\n${endMarker(response.id)}`;
    responseRegion(rendered,response.id);
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
