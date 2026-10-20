import {Buffer} from 'buffer';
import {contentHash} from './completion';
import {responseIds,responseFrame} from './response-container';
import {streamBlocks} from './stream-block';
import {runImportReceipts} from './run-import-receipt';
import {markdownCodeRanges} from './reply-html';

export type Span=[number,number];
export interface PackedText {hash:string;encoding:'text'|'gzip';data:string}
interface NoteIdentity {path:string;revision:number;deleted?:boolean;renamedAt?:number}
interface ResponseText {noteId:string;body:string;before:string;after:string;offset:number}
export interface SmartCapture {noteId:string;source:PackedText;covered:Span[];parents:string[];bindings?:string[]}
interface SentText extends SmartCapture {destination:string}
export interface SmartSendData {version:1;notes:Record<string,NoteIdentity>;responses:Record<string,ResponseText>;bodies:Record<string,PackedText>;heads:Record<string,SentText>;retired:string[]}
const empty=():SmartSendData=>({version:1,notes:{},responses:{},bodies:{},heads:{},retired:[]});
const decoded=new Map<string,string>();
function cache(hash:string,text:string){
  decoded.delete(hash);if(text.length>2_000_000)return text;
  let size=text.length;for(const body of decoded.values())size+=body.length;
  while(decoded.size&&(decoded.size>=24||size>2_000_000)){const id=decoded.keys().next().value!;size-=decoded.get(id)!.length;decoded.delete(id);}
  decoded.set(hash,text);return text;
}
export async function packText(text:string):Promise<PackedText>{
  const hash=contentHash(text);cache(hash,text);
  if(text.length>512&&typeof CompressionStream!=='undefined'&&typeof DecompressionStream!=='undefined'){
    const bytes=new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
    const data=Buffer.from(bytes).toString('base64');if(data.length<text.length)return {hash,encoding:'gzip',data};
  }
  return {hash,encoding:'text',data:text};
}
export async function unpackText(packed:PackedText){
  const cached=decoded.get(packed.hash);if(cached!==undefined)return cached;
  let text:string;
  if(packed.encoding==='gzip'){
    if(typeof DecompressionStream==='undefined')throw Error('This client cannot read the Smart Send record. Update Obsidian before sending.');
    text=await new Response(new Blob([new Uint8Array(Buffer.from(packed.data,'base64'))]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  }else text=packed.data;
  if(contentHash(text)!==packed.hash)throw Error('The Smart Send record failed its content check.');
  return cache(packed.hash,text);
}
const packed=(p:any):p is PackedText=>p&&/^[0-9a-f]{64}$/.test(p.hash)&&['text','gzip'].includes(p.encoding)&&typeof p.data==='string';
const spans=(s:any):s is Span[]=>Array.isArray(s)&&s.every(v=>Array.isArray(v)&&v.length===2&&Number.isSafeInteger(v[0])&&Number.isSafeInteger(v[1])&&v[0]>=0&&v[1]>=v[0]);
export function loadSmartSend(value:any):SmartSendData{
  const out=empty();if(value?.version!==1)return out;
  for(const [id,n] of Object.entries(value.notes??{}) as [string,any][])if(typeof n?.path==='string'&&Number.isSafeInteger(n.revision)&&(n.renamedAt===undefined||Number.isSafeInteger(n.renamedAt)&&n.renamedAt<=n.revision))out.notes[id]=n;
  for(const [id,b] of Object.entries(value.bodies??{}))if(packed(b)&&b.hash===id)out.bodies[id]=b;
  for(const [id,r] of Object.entries(value.responses??{}) as [string,any][])if(typeof r?.noteId==='string'&&typeof r.body==='string'&&typeof r.before==='string'&&typeof r.after==='string'&&Number.isSafeInteger(r.offset))out.responses[id]=r;
  for(const [id,h] of Object.entries(value.heads??{}) as [string,any][])if(typeof h?.noteId==='string'&&typeof h.destination==='string'&&packed(h.source)&&spans(h.covered)&&Array.isArray(h.parents)&&h.parents.every((p:any)=>typeof p==='string')&&(h.bindings===undefined||Array.isArray(h.bindings)&&h.bindings.every((id:any)=>typeof id==='string')))out.heads[id]=h;
  out.retired=Array.isArray(value.retired)?value.retired.filter((id:any)=>typeof id==='string'):[];return out;
}
/** Immutable receipts merge by union. A confirmed successor retires only the
 * exact predecessors it read; simultaneous device branches both survive. */
export function mergeSmartSend(...values:unknown[]):SmartSendData{
  const out=empty(),retired=new Set<string>();
  for(const value of values){const data=loadSmartSend(value);Object.assign(out.bodies,data.bodies);Object.assign(out.responses,data.responses);Object.assign(out.heads,data.heads);for(const id of data.retired)retired.add(id);
    for(const [id,n] of Object.entries(data.notes)){const old=out.notes[id];
      // A client can see a remote rename as delete/create before settings
      // arrive. Its deletion of the old location cannot erase a known move.
      const move=n.renamedAt??0,previous=old?.renamedAt??0;
      if(!old||move>previous||move===previous&&(n.revision>old.revision||n.revision===old.revision&&JSON.stringify(n)>JSON.stringify(old)))out.notes[id]=n;}}
  for(const h of Object.values(out.heads))for(const id of h.parents)retired.add(id);
  for(const id of retired)delete out.heads[id];out.retired=[...retired].sort();return out;
}
export function smartNote(data:SmartSendData,path:string){
  const existing=Object.entries(data.notes).find(([,n])=>n.path===path&&!n.deleted);if(existing)return existing[0];
  let id=contentHash(path);while(data.notes[id]){const old=data.notes[id];id=contentHash(JSON.stringify([id,old.path,old.revision,old.deleted]));}
  data.notes[id]={path,revision:Date.now()};return id;
}
export function moveSmartNotes(data:SmartSendData,before:string,after?:string,folder=false){
  const revision=Math.max(Date.now(),...Object.values(data.notes).map(n=>n.revision+1));
  for(const [id,n] of Object.entries(data.notes))if(!n.deleted&&(n.path===before||folder&&n.path.startsWith(before+'/')))data.notes[id]={...n,path:after===undefined?n.path:after+n.path.slice(before.length),revision,...(after===undefined?{deleted:true}:{renamedAt:revision})};
}
/** Call only with source IDs proven by a uniquely located response binding.
 * A copy whose original is still present keeps independent source coverage. */
export function recoverSmartNote(data:SmartSendData,path:string,ids:string[],exists:(path:string)=>boolean){
  const candidates=[...new Set(ids)].filter(id=>data.notes[id]&&data.notes[id].path!==path);
  if(!candidates.length||new Set(candidates.map(id=>data.notes[id].path)).size!==1||candidates.some(id=>exists(data.notes[id].path)))return false;
  const revision=Math.max(Date.now(),...Object.values(data.notes).map(n=>n.revision+1));
  for(const id of candidates)data.notes[id]={path,revision,renamedAt:revision};
  return true;
}
function noteIdentities(data:SmartSendData,id:string){
  const note=data.notes[id];return new Set([id,...Object.entries(data.notes).filter(([,n])=>!n.deleted&&n.path===note?.path).map(([id])=>id)]);
}
export const smartDestination=(environment:string,project:string,thread:string)=>JSON.stringify([environment,project,thread]);
function union(items:Span[]):Span[]{const out:Span[]=[];for(const [from,to] of items.filter(([a,b])=>b>a).sort((a,b)=>a[0]-b[0])){const last=out.at(-1);if(last&&from<=last[1])last[1]=Math.max(to,last[1]);else out.push([from,to]);}return out;}
function lines(text:string){let offset=0;return text.split('\n').map(value=>{const item={text:value,from:offset,to:offset+value.length};offset+=value.length+1;return item;});}
/** Hunt–Szymanski line matching, with bounded work for pathological repeated
 * lines. Blank separators carry no delivery information. */
function matchingLines(before:string,after:string):Array<[number,number]>{
  const a=lines(before),b=lines(after),positions=new Map<string,number[]>();
  a.forEach((line,index)=>{if(line.text.trim()){const p=positions.get(line.text)??[];p.push(index);positions.set(line.text,p);}});
  const tails:number[]=[],nodes:Array<{a:number;b:number;prev?:number}>=[],ends:number[]=[];let work=0;
  for(let j=0;j<b.length;j++)for(const i of [...(positions.get(b[j].text)??[])].reverse()){
    if(++work>2_000_000){const result:Array<[number,number]>=[];let previous=-1;b.forEach((line,index)=>{const p=positions.get(line.text)?.find(n=>n>previous);if(p!==undefined){result.push([p,index]);previous=p;}});return result;}
    let l=0,r=tails.length;while(l<r){const m=(l+r)>>>1;if(tails[m]<i)l=m+1;else r=m;}
    if(tails[l]===i)continue;const node=nodes.push({a:i,b:j,prev:l?ends[l-1]:undefined})-1;tails[l]=i;ends[l]=node;
  }
  const out:Array<[number,number]>=[];let at=ends.at(-1);while(at!==undefined){const node=nodes[at];out.push([node.a,node.b]);at=node.prev;}return out.reverse();
}
function mappedCoverage(before:string,after:string,covered:Span[]){
  if(before===after)return covered;
  const a=lines(before),b=lines(after),out:Span[]=[],unchanged:Array<[number,number,number]>=[];
  let l=0,r=0;
  for(const [i,j] of [...matchingLines(before,after),[a.length,b.length]]){
    const endA=a[i]?.from??before.length,endB=b[j]?.from??after.length;
    let prefix=0;while(l+prefix<endA&&r+prefix<endB&&before[l+prefix]===after[r+prefix])prefix++;
    if(prefix)unchanged.push([l,l+prefix,r]);
    let suffix=0;while(endA-suffix>l+prefix&&endB-suffix>r+prefix&&before[endA-suffix-1]===after[endB-suffix-1])suffix++;
    if(suffix)unchanged.push([endA-suffix,endA,endB-suffix]);
    if(i<a.length&&j<b.length){unchanged.push([a[i].from,a[i].to,b[j].from]);l=a[i].to;r=b[j].to;}
  }
  for(const [start,end,target] of unchanged)for(const [from,to] of covered){const l=Math.max(start,from),r=Math.min(end,to);if(r>l)out.push([target+l-start,target+r-start]);}
  return out;
}
/** Keep exact rendered output once, compressed and addressed by content. The
 * surrounding text locates later edits without adding anything to Markdown. */
export async function rememberResponse(data:SmartSendData,path:string,id:string,body:string,before:string,after:string,offset:number){
  if(!body.trim())return;
  const noteId=smartNote(data,path),packedBody=await packText(body);data.bodies[packedBody.hash]=packedBody;
  const key=`${id}:${packedBody.hash}`,next={noteId,body:packedBody.hash,before:before.slice(-160),after:after.slice(0,160),offset};
  if(JSON.stringify(data.responses[key])===JSON.stringify(next))return false;
  data.responses[key]=next;return true;
}
export async function sourceProjection(data:SmartSendData,noteId:string,document:string){
  const removed:Span[]=[],known:Span[]=[],identities=noteIdentities(data,noteId);
  const receipts=[...runImportReceipts(document)],code=receipts.length?markdownCodeRanges(document):[];
  for(const {from,to} of receipts)if(!code.some(([start,end])=>from<end&&to>start))removed.push([from,to]);
  for(const id of responseIds(document)){const frame=responseFrame(document,id);if(frame)removed.push([frame.from,frame.to]);}
  for(const record of Object.values(data.responses).filter(r=>identities.has(r.noteId))){
    const body=await unpackText(data.bodies[record.body]??(()=>{throw Error('The saved agent response is missing.');})());
    const matches:number[]=[];let at=document.indexOf(body);while(at>=0){matches.push(at);at=document.indexOf(body,at+Math.max(1,body.length));}
    if(matches.length){
      const matching=matches.filter(at=>(!record.before||document.slice(0,at).endsWith(record.before))&&(!record.after||document.slice(at+body.length).startsWith(record.after)));
      const chosen=matching.length===1?matching[0]:matches.length===1?matches[0]:undefined;
      if(chosen!==undefined){removed.push([chosen,chosen+body.length]);known.push([chosen,chosen+body.length]);}continue;
    }
    // Only unchanged, unique surrounding text may bound an edited response.
    const from=record.before?document.indexOf(record.before):0;
    const left=from>=0?from+record.before.length:-1;
    const right=record.after&&left>=0?document.indexOf(record.after,left):record.after?-1:document.length;
    if(left<0||right<left||record.before&&document.lastIndexOf(record.before)!==from||record.after&&document.lastIndexOf(record.after)!==right)continue;
    const current=document.slice(left,right);
    known.push([left,right]);
    for(const [from,to] of mappedCoverage(body,current,[[0,body.length]]))removed.push([left+from,left+to]);
  }
  // A known edited response is handled by its recorded text, so additions
  // inside its completed history remain ordinary source. Legacy histories
  // without a rendered response record retain their generated-callout rule.
  for(const block of streamBlocks(document))if(!known.some(([from,to])=>from<block.to&&to>block.from))removed.push([block.from,block.to]);
  const ranges=union(removed),segments:Array<{rawFrom:number;rawTo:number;from:number}>=[];let text='',cursor=0;
  for(const [from,to] of [...ranges,[document.length,document.length] as Span]){if(from>cursor){segments.push({rawFrom:cursor,rawTo:from,from:text.length});text+=document.slice(cursor,from);}cursor=Math.max(cursor,to);}
  return {text,segments};
}
export async function prepareSmartSend(data:SmartSendData,path:string,destination:string,document:string,scope?:Span){
  const noteId=smartNote(data,path),projection=await sourceProjection(data,noteId,document),current=projection.text;
  const identities=noteIdentities(data,noteId),heads=Object.entries(data.heads).filter(([,h])=>identities.has(h.noteId)&&h.destination===destination);
  let covered:Span[]=[];for(const [,head] of heads)covered.push(...mappedCoverage(await unpackText(head.source),current,head.covered));covered=union(covered);
  const requested:Span[]=scope?projection.segments.flatMap(segment=>{const from=Math.max(scope[0],segment.rawFrom),to=Math.min(scope[1],segment.rawTo);return to>from?[[segment.from+from-segment.rawFrom,segment.from+to-segment.rawFrom] as Span]:[];}):[[0,current.length]];
  const added:Span[]=[];for(const [from,to] of requested){let cursor=from;for(const [l,r] of covered){if(r<=cursor||l>=to)continue;if(l>cursor)added.push([cursor,l]);cursor=Math.max(cursor,r);}if(cursor<to)added.push([cursor,to]);}
  const text=added.map(([from,to])=>current.slice(from,to)).filter(text=>text.trim()).join('\n');
  const capture:SmartCapture={noteId,source:await packText(current),covered:union([...covered,...added]),parents:heads.map(([id])=>id),bindings:[...new Set(heads.flatMap(([,h])=>h.bindings??[]))]};
  return {text,capture};
}
export function confirmSmartSend(data:SmartSendData,id:string,destination:string,capture:SmartCapture,bindings:string[]=[]){
  if(data.heads[id]||data.retired.includes(id))return;
  data.heads[id]={...capture,destination,bindings:[...new Set([...(capture.bindings??[]),...bindings])]};data.retired=[...new Set([...data.retired,...capture.parents])].sort();for(const parent of data.retired)delete data.heads[parent];
}
