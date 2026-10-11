import {markdownCodeRanges} from './reply-html';

export const containerStart=(id:string)=>`:::send-to-t3-response data-t3-response="${id}"`;
export const containerEnd=':::/send-to-t3-response';
export const containerBody=(id:string,body:string)=>`${containerStart(id)}\n\n${body}\n\n${containerEnd}`;
export interface ResponseBoundary {id:string;kind:'start'|'end';format:'inline'|'response'|'container';from:number;to:number;text:string}
export interface ResponseFrame {from:number;to:number;bodyFrom:number;bodyTo:number;body:string;format:ResponseBoundary['format']}

/** Parse a complete Markdown container, excluding literal code. Its directive
 * lines leave the body's native Markdown grammar unchanged. Legacy comments
 * remain readable. Ordinary directives cannot close a response container. */
export function responseBoundaries(document:string):ResponseBoundary[]{
  if(!document.includes('<!-- t3-')&&!document.includes('data-t3-response='))return [];
  const code=markdownCodeRanges(document),boundaries:ResponseBoundary[]=[],sections:Array<ResponseBoundary|undefined>=[];
  const expression=/<!-- t3-(inline|response):(start|end):([a-z0-9-]+) -->|:::[A-Za-z][\w-]* data-t3-response="[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}"|:::\/send-to-t3-response/g;
  for(const match of document.matchAll(expression)){
    const from=match.index!,to=from+match[0].length;
    if(code.some(([start,end])=>from>=start&&from<end))continue;
    let escapes=0;for(let at=from-1;at>=0&&document[at]==='\\';at--)escapes++;if(escapes%2)continue;
    if(match[1]){boundaries.push({id:match[3],kind:match[2] as 'start'|'end',format:match[1] as 'inline'|'response',from,to,text:match[0]});continue;}
    if(match[0]===containerEnd){
      const opening=sections.pop();if(opening)boundaries.push({...opening,kind:'end',from,to,text:match[0]});
    }else{
      const id=/\bdata-t3-response="([0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12})"/.exec(match[0])?.[1];
      const opening=id?{id,kind:'start' as const,format:'container' as const,from,to,text:match[0]}:undefined;
      sections.push(opening);if(opening)boundaries.push(opening);
    }
  }
  return boundaries.sort((a,b)=>a.from-b.from);
}

export function responseIds(document:string):string[]{return [...new Set(responseBoundaries(document).filter(token=>token.kind==='start').map(token=>token.id))];}
export function insideResponse(document:string,offset:number):boolean{
  const open=new Set<string>();for(const boundary of responseBoundaries(document)){if(boundary.from>=offset)break;if(boundary.kind==='start')open.add(boundary.id);else open.delete(boundary.id);}return open.size>0;
}
export function containsResponseBoundary(document:string,id:string):boolean {
  return document.includes(`data-t3-response="${id}"`)||document.includes(`<!-- t3-inline:start:${id} -->`)||document.includes(`<!-- t3-inline:end:${id} -->`)||document.includes(`<!-- t3-response:start:${id} -->`)||document.includes(`<!-- t3-response:end:${id} -->`);
}
export function responseFrame(document:string,id:string,format?:ResponseBoundary['format']):ResponseFrame|undefined{
  if(!containsResponseBoundary(document,id))return;
  const boundaries=responseBoundaries(document),own=boundaries.filter(token=>token.id===id&&(!format||token.format===format));
  if(!own.length)return;
  if(own.length!==2||own[0].kind!=='start'||own[1].kind!=='end'||own[0].format!==own[1].format)throw Error('Missing, duplicate or reversed response boundaries.');
  const [start,end]=own;
  if(start.format==='container'&&(start.text!==containerStart(id)||end.text!==containerEnd))throw Error('Malformed response container boundaries.');
  if(boundaries.some(token=>token.from>start.from&&token.from<end.from))throw Error('Nested response boundaries.');
  const padding=start.format==='container'?'\n\n':'\n';
  // Structural identity survives text typed beside an inner edge. Projection
  // still requires the exact empty anchor; explicit checked repair can retain
  // every such byte outside it instead of losing the user's text.
  const bodyFrom=start.to+(document.slice(start.to,start.to+padding.length)===padding?padding.length:0),bodyTo=end.from-(document.slice(end.from-padding.length,end.from)===padding?padding.length:0);
  if(bodyTo<bodyFrom)throw Error('Malformed response container spacing.');
  return {from:start.from,to:end.to,bodyFrom,bodyTo,body:document.slice(bodyFrom,bodyTo),format:start.format};
}
