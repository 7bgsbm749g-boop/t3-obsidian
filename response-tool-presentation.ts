import {markdownFlowContext} from './markdown-flow';
import {streamBlocks} from './stream-block';
type CachedPresentation={collapsed?:ToolPresentation;expanded?:ToolPresentation;characters:number};
const presentationCache=new Map<string,CachedPresentation>();
const maxPresentationCharacters=8_000_000;
let presentationCharacters=0;
const copyPresentation=(value:ToolPresentation):ToolPresentation=>({...value,groups:value.groups.map(group=>({...group}))});
import {contentHash} from './completion';
import {markdownCodeRanges} from './reply-html';

export interface PresentedToolGroup {ref:string;canonicalFrom:number;canonicalTo:number;displayFrom:number;displayTo:number;placeholder:string}
export interface ToolPresentation {canonical:string;display:string;groups:PresentedToolGroup[]}
export interface CompactToolGroup {from:number;to:number;ref:string;text:string;complete:boolean}
interface Tag {from:number;to:number;name:string;closing:boolean;attrs:Record<string,string>;raw:string}
const allowedTags=new Set(['details','summary','div','span','p','pre','code','strong','em','a','img','br','hr','blockquote','ul','ol','li','h1','h2','h3','h4','h5','h6']);
const voidTags=new Set(['img','br','hr']);
const allowedAttrs=new Set(['class','aria-hidden','aria-label','href','src','alt','title','start','data-t3-thought-at','data-t3-tool-group','data-t3-tool-summary','data-t3-live-tool','data-t3-tool-icon','data-t3-tool-id','data-t3-tool-key','data-t3-tool-status','data-t3-tool-ref']);
/** Quoted attributes and escaped output cannot create a false closing tag. */
function tagAt(text:string,from:number,unknownAttributes=false):Tag|undefined{
 if(text[from]!=='<')return;
 let quote='',end=from+1;for(;end<text.length;end++){const c=text[end];if(quote){if(c===quote)quote='';}else if(c==='"'||c==="'")quote=c;else if(c==='>')break;}
 if(end===text.length)return;
 const raw=text.slice(from,end+1),match=/^<(\/)?([a-z][a-z0-9]*)([\s\S]*?)>$/.exec(raw);if(!match||!allowedTags.has(match[2]))return;
 const attrs:Record<string,string>={};let suffix=match[3];if(voidTags.has(match[2]))suffix=suffix.replace(/\/$/,'');
 while(suffix.trim()){
  const attribute=(unknownAttributes?/^\s+([a-z][a-z0-9-]*)=(["'])([\s\S]*?)\2/:/^\s+([a-z][a-z0-9-]*)="([^"]*)"/).exec(suffix);
  if(!attribute||!unknownAttributes&&!allowedAttrs.has(attribute[1])||Object.hasOwn(attrs,attribute[1]))return;
  attrs[attribute[1]]=attribute[unknownAttributes?3:2];suffix=suffix.slice(attribute[0].length);
 }
 if(match[1]&&Object.keys(attrs).length)return;
 return {from,to:end+1,name:match[2],closing:!!match[1],attrs,raw};
}
function generatedStart(first:Tag|undefined,placeholder:boolean):first is Tag {
 return !!first&&!first.closing&&first.name==='details'&&['send-to-t3-tool-group','send-to-t3-response-activity','send-to-t3-response-history'].includes(first.attrs.class)&&!!first.attrs['data-t3-tool-group']&&first.attrs['data-t3-tool-summary']!==undefined&&Object.hasOwn(first.attrs,'data-t3-tool-ref')===placeholder;
}
function groupAt(text:string,from:number,placeholder=false){
 const first=tagAt(text,from);if(!generatedStart(first,placeholder))return;
 const summary=tagAt(text,first.to);if(!summary||summary.closing||summary.name!=='summary')return;
 const stack=['details'];let cursor=first.to,summaryTo=0,content=false,tools=0;
 while(cursor<text.length){
  const next=text.indexOf('<',cursor);if(next<0)return;
  const tag=tagAt(text,next);if(!tag)return;
  if((stack.length===1||!placeholder&&stack.length===2&&stack[1]==='div')&&text.slice(cursor,next).trim())return;
  if(tag.closing){if(stack.pop()!==tag.name)return;if(tag.name==='summary'&&stack.length===1)summaryTo=tag.to;if(!stack.length)return summaryTo&&content&&(placeholder||tools)?{first,to:tag.to,summary:text.slice(summary.from,summaryTo),complete:true}:undefined;}
  else {
   if(stack.length===1){if(!summaryTo){if(tag.name!=='summary'||next!==summary.from)return;}else {if(content||tag.name!=='div'||tag.attrs.class!=='send-to-t3-tool-group-content')return;content=true;}}
   if(stack.length===2&&stack[1]==='div'&&!placeholder){
    const tool=tag.attrs.class==='send-to-t3-tool'&&!!tag.attrs['data-t3-tool-id']&&!!tag.attrs['data-t3-tool-status'];
    const thought=tag.attrs.class==='send-to-t3-thought';
    if(tag.name!=='details'||!tag.attrs['data-t3-tool-key']||!tool&&!thought)return;tools++;
   }
   if(!voidTags.has(tag.name))stack.push(tag.name);
  }
  cursor=tag.to;
 }
}

/** Parse the generated shell, then exclude literal examples using a compact
 * Markdown analysis. Tool output cannot supply false code-span boundaries. */
function recognizedGroups(text:string,placeholder:boolean){
 const candidates:Array<{from:number;found:NonNullable<ReturnType<typeof groupAt>>;analysisFrom:number}>=[];
 let search=0,analysis='',cursor=0;
 while(search<text.length){
  const from=text.indexOf('<details',search);if(from<0)break;search=from+8;
  let slashes=0;for(let i=from-1;i>=0&&text[i]==='\\';i--)slashes++;if(slashes%2)continue;
  let found=groupAt(text,from,placeholder)??groupAt(text,from,!placeholder);
  // A malformed reserved shell is still unsafe to save. Its end is unknown,
  // so it can be detected but cannot recover output by guessing a range.
  if(!found&&placeholder){const first=tagAt(text,from,true);if(generatedStart(first,true))found={first,to:first.to,summary:'',complete:false};}
  if(!found)continue;
  analysis+=text.slice(cursor,from);const analysisFrom=analysis.length;analysis+='T3_TOOL_GROUP';
  if(Object.hasOwn(found.first.attrs,'data-t3-tool-ref')===placeholder)candidates.push({from,found,analysisFrom});cursor=found.to;search=found.to;
 }
 if(!candidates.length)return candidates;
 analysis+=text.slice(cursor);
 // Generated groups usually start their own paragraph, including inside a
 // quote. Flow context proves these cannot be inside inline code. Unusual
 // inline examples retain the full code-span grammar.
 const flow=markdownFlowContext(analysis.replace(/</g,' ')),code=candidates.every(candidate=>flow.paragraphStarts.has(candidate.analysisFrom)||flow.code.some(([from,to])=>candidate.analysisFrom>=from&&candidate.analysisFrom<to))?flow.code:markdownCodeRanges(analysis);
 const excluded=[...code,...literalHtmlRanges(analysis)];
 return candidates.filter(({analysisFrom})=>!excluded.some(([start,end])=>start<=analysisFrom&&analysisFrom<end));
}
/** Only reserved generated containers outside literal Markdown/HTML count as
 * compact references. Ordinary attributes and quoted examples stay intact. */
export function compactToolGroups(text:string):CompactToolGroup[]{
 // Escaped tool output often quotes this attribute as source code. Only an
 // actual quoted attribute can be a reserved compact shell; plain mentions
 // and &quot; must not trigger a scan of every retained tool group.
 if(!/\bdata-t3-tool-ref=["']/.test(text))return [];
 return recognizedGroups(text,true).map(({from,found})=>({from,to:found.to,ref:found.first.attrs['data-t3-tool-ref'],text:text.slice(from,found.to),complete:found.complete}));
}
export function assertCanonicalToolGroups(text:string){
 if(compactToolGroups(text).length)throw Error('A compact tool summary has no canonical saved output.');
}
/** Literal HTML containers can include an example of a generated group. */
function literalHtmlRanges(text:string){
 const result:Array<[number,number]>=[];const tags=/<!--[\s\S]*?(?:-->|$)|<\/?(?:pre|code|script|style|textarea)(?=[\s>])[^>]*>/gi,stack:Array<{name:string;from:number}>=[];let match:RegExpExecArray|null;
 while((match=tags.exec(text))){if(match[0].startsWith('<!--')){result.push([match.index,tags.lastIndex]);continue;}const name=/^<\/?([a-z]+)/i.exec(match[0])![1].toLowerCase();if(match[0][1]!=='/')stack.push({name,from:match.index});else {let index=-1;for(let i=stack.length-1;i>=0;i--)if(stack[i].name===name){index=i;break;}if(index>=0){const start=stack[index];stack.splice(index);result.push([start.from,tags.lastIndex]);}}}
 for(const item of stack)result.push([item.from,text.length]);return result;
}

/** Presentation only. The canonical body and final-write grant remain exact.
 * Only complete, recognized generated groups are replaced; malformed or
 * arbitrary Markdown is returned intact. Call on body updates, not keystrokes. */
/** Find complete runs of quoted history lines before asking the flow grammar
 * for their context. A quoted line cannot close a surrounding Markdown fence.
 * Keep raw-HTML terminators for literal HTML contexts. Only runs ending at a
 * physical blank line or EOF are shortened, so lazy paragraph continuation
 * cannot absorb the final answer. Notes with response boundaries retain the
 * full grammar, including tracking comments inside literal code examples. */
function toolFlowProjection(text:string){
 const bodies=new Map<number,{from:number;to:number}>(),spans:Array<{from:number;to:number;originalFrom:number;originalTo:number}>=[],parts:string[]=[];
 const identity={text,originalOffset:(position:number)=>position,bodies};
 if(text.includes('<!-- t3-inline:')||text.includes('<!-- t3-response:')||text.includes('data-t3-response=')||text.includes(':::/send-to-t3-response'))return identity;
 const headers=/^ {0,3}> \[!t3-progress\]- [^\r\n]*data-t3-fold="[^"\r\n]+"[^\r\n]*/gm;
 let match:RegExpExecArray|null,cursor=0,length=0;
 while((match=headers.exec(text))){
  const newline=text.indexOf('\n',headers.lastIndex);if(newline<0)continue;
  const start=newline+1;let at=start,to=start;
  while(at<text.length){const next=text.indexOf('\n',at),end=next<0?text.length:next,line=text.slice(at,end);if(!/^ {0,3}>/.test(line))break;to=end-(text[end-1]==='\r'?1:0);at=next<0?text.length:next+1;}
  if(to===start||at<text.length&&text.slice(at,text.indexOf('\n',at)<0?text.length:text.indexOf('\n',at)).trim())continue;
  const body=text.slice(start,to),prefix=/^(?:>[ \t]*\r?\n)*> ?/.exec(body)?.[0];if(!prefix)continue;
  const endings=body.match(/-->|\?>|\]\]>|<\/(?:pre|script|style|textarea)\s*>/gi)??[];
  const replacement='> T3_HISTORY_FLOW '+endings.join(''),ordinary=text.slice(cursor,start);parts.push(ordinary,replacement);length+=ordinary.length;
  spans.push({from:length,to:length+replacement.length,originalFrom:start,originalTo:to});length+=replacement.length;cursor=to;
  bodies.set(match.index+match[0].indexOf('>'),{from:start+prefix.length,to});headers.lastIndex=at;
 }
 if(!spans.length)return identity;
 parts.push(text.slice(cursor));
 return {text:parts.join(''),bodies,originalOffset:(position:number)=>{let delta=0;for(const span of spans){if(position<span.to){if(position>span.from)throw Error('A history boundary entered retained output.');break;}delta+=(span.originalTo-span.originalFrom)-(span.to-span.from);}return position+delta;}};
}
/** Remove one generated quote level when a retained history body is opened. */
export function historyToolBody(body:string){
 return ('> '+body).split('\n').map(line=>{
  if(/^ {0,3}>/.test(line))return line.replace(/^ {0,3}> ?/,'');
  if(!line.trim())return line;
  throw Error('The retained history body changed its quote context.');
 }).join('\n');
}
export function presentToolGroups(canonical:string,collapseHistory=true):ToolPresentation{
 const mode=collapseHistory?'collapsed':'expanded',cached=presentationCache.get(canonical),existing=cached?.[mode];
 if(existing){presentationCache.delete(canonical);presentationCache.set(canonical,cached!);return copyPresentation(existing);}
 const replacements:Array<{from:number;to:number;ref:string;placeholder:string}>=[];
 const flow=collapseHistory?toolFlowProjection(canonical):undefined;
 if(flow)for(const block of streamBlocks(flow.text)){
  if(!block.complete||block.tracked||!block.text.startsWith('> [!t3-progress]- '))continue;
  const header=block.text.indexOf('\n');if(header<0)continue;
  const retained=flow.bodies.get(flow.originalOffset(block.from));
  const body=block.text.slice(header+1),prefix=/^(?:>[ \t]*\r?\n)*> ?/.exec(body)?.[0];if(!prefix)continue;
  const from=retained?.from??flow.originalOffset(block.from+header+1+prefix.length),to=flow.originalOffset(block.to);if(retained&&retained.to!==to)continue;
  const original=canonical.slice(from,to);if(!original.trim())continue;
  try{historyToolBody(original);}catch{continue;}
  const ref=contentHash(original),placeholder='<details class="send-to-t3-response-history" data-t3-tool-group="history" data-t3-tool-summary="History" data-t3-tool-ref="'+ref+'"><summary>History</summary><div class="send-to-t3-tool-group-content"><p>Loading history…</p></div></details>';
  replacements.push({from,to,ref,placeholder});
 }
 // Mask retained histories before looking for individual tools. Their output
 // stays in canonical backing and is parsed only if the user opens the fold.
 let intermediate='',cursor=0;const mapped:Array<{from:number;to:number;delta:number}>=[];
 for(const item of replacements){intermediate+=canonical.slice(cursor,item.from);const from=intermediate.length;intermediate+=item.placeholder;mapped.push({from,to:intermediate.length,delta:item.to-item.from-item.placeholder.length});cursor=item.to;}
 intermediate+=canonical.slice(cursor);
 const originalOffset=(position:number)=>{let delta=0;for(const item of mapped){if(position<item.to)break;delta+=item.delta;}return position+delta;};
 for(const {from,found} of recognizedGroups(intermediate,false)){
  const start=originalOffset(from),to=originalOffset(found.to),original=canonical.slice(start,to),ref=contentHash(original);
  const placeholder=found.first.raw.slice(0,-1)+` data-t3-tool-ref="${ref}">`+found.summary+'<div class="send-to-t3-tool-group-content"></div></details>';
  replacements.push({from:start,to,ref,placeholder});
 }
 if(!replacements.length)return {canonical,display:canonical,groups:[]};
 replacements.sort((a,b)=>a.from-b.from);
 const groups:PresentedToolGroup[]=[],parts:string[]=[];cursor=0;let displayLength=0;
 for(const item of replacements){
  if(item.from<cursor)throw Error('Overlapping retained presentation ranges.');
  const ordinary=canonical.slice(cursor,item.from);parts.push(ordinary,item.placeholder);displayLength+=ordinary.length;
  groups.push({ref:item.ref,canonicalFrom:item.from,canonicalTo:item.to,displayFrom:displayLength,displayTo:displayLength+item.placeholder.length,placeholder:item.placeholder});displayLength+=item.placeholder.length;cursor=item.to;
 }
 parts.push(canonical.slice(cursor));const result={canonical,display:parts.join(''),groups};
 const entry=cached??{characters:canonical.length};
 const characters=canonical.length+(mode==='collapsed'?result.display.length:entry.collapsed?.display.length??0)+(mode==='expanded'?result.display.length:entry.expanded?.display.length??0);
 if(characters<=maxPresentationCharacters){
  presentationCharacters+=characters-(cached?.characters??0);entry[mode]=result;entry.characters=characters;presentationCache.delete(canonical);presentationCache.set(canonical,entry);
  while(presentationCharacters>maxPresentationCharacters||presentationCache.size>8){const [source,old]=presentationCache.entries().next().value!;presentationCache.delete(source);presentationCharacters-=old.characters;}
 }
 return copyPresentation(result);
}
export function canonicalToolGroup(presentation:ToolPresentation,ref:string){
 const group=presentation.groups.find(group=>group.ref===ref);if(!group)return;
 const html=presentation.canonical.slice(group.canonicalFrom,group.canonicalTo);if(contentHash(html)!==ref)throw Error('The retained tool details changed.');return html;
}
/** Offsets inside hidden content identify the exact canonical range. They
 * never pretend that a compact summary has the same length as the output. */
export function toolDisplayOffset(presentation:ToolPresentation,offset:number):{kind:'canonical';offset:number}|{kind:'tool';ref:string;from:number;to:number}{
 if(!Number.isSafeInteger(offset)||offset<0||offset>presentation.display.length)throw Error('Invalid tool presentation offset.');
 let shift=0;for(const group of presentation.groups){if(offset<group.displayFrom)break;if(offset<group.displayTo)return {kind:'tool',ref:group.ref,from:group.canonicalFrom,to:group.canonicalTo};shift+=(group.canonicalTo-group.canonicalFrom)-(group.displayTo-group.displayFrom);}
 return {kind:'canonical',offset:offset+shift};
}
/** Restore exact generated bytes while retaining ordinary edits around them.
 * Missing, duplicated, reordered or changed placeholders require conflict review. */
export function restoreToolGroups(display:string,presentation:ToolPresentation){
 if(display===presentation.display)return presentation.canonical;
 const compact=compactToolGroups(display);
 if(compact.length!==presentation.groups.length)throw Error('The tool summary was copied, duplicated, changed or removed.');
 let cursor=0;const parts:string[]=[];
 for(let index=0;index<compact.length;index++){
  const group=presentation.groups[index],actual=compact[index];if(actual.text!==group.placeholder)throw Error('The tool summary changed or was removed.');
  parts.push(display.slice(cursor,actual.from),presentation.canonical.slice(group.canonicalFrom,group.canonicalTo));cursor=actual.to;
 }
 parts.push(display.slice(cursor));
 return parts.join('');
}

/** Conflict review only. An intact identity/order can recover the old exact
 * bytes even when its protected summary changed. Preserve the raw attempt
 * separately; an unknown, duplicated or reordered identity has no safe result. */
export function recoverToolGroups(display:string,presentation:ToolPresentation){
 const compact=compactToolGroups(display);
 if(!compact.length||compact.length!==presentation.groups.length||compact.some(group=>!group.complete))throw Error('The compact tool output cannot be recovered.');
 let cursor=0;const parts:string[]=[];
 for(let index=0;index<compact.length;index++){
  const actual=compact[index],group=presentation.groups[index];if(actual.ref!==group.ref)throw Error('The compact tool identity changed.');
  const canonical=canonicalToolGroup(presentation,group.ref);if(canonical===undefined)throw Error('The retained tool details are unavailable.');
  parts.push(display.slice(cursor,actual.from),canonical);cursor=actual.to;
 }
 parts.push(display.slice(cursor));return parts.join('');
}

/** Inject the existing sanitized Markdown renderer. Details are fetched and
 * rendered only when a group is expanded; cancelled/detached views stay inert. */
export function mountToolGroups(root:HTMLElement,resolve:(ref:string)=>string|undefined|Promise<string|undefined>,render:(canonical:string,target:HTMLElement)=>void|Promise<void>,failure?:(error:unknown)=>void){
 let disposed=false;const cleanups:Array<()=>void>=[];
 const selector='details[data-t3-tool-ref]',nodes=Array.from(root.querySelectorAll<HTMLDetailsElement>(selector));
 if(root.matches?.(selector))nodes.unshift(root as HTMLDetailsElement);
 for(const details of nodes){
  let pending=false,loadedRef:string|undefined;
  const alive=(ref:string)=>!disposed&&root.contains(details)&&details.isConnected&&details.getAttribute('data-t3-tool-ref')===ref;
  const toggle=async()=>{
   const ref=details.getAttribute('data-t3-tool-ref')??'',history=details.getAttribute('class')==='send-to-t3-response-history';
   if(!details.open||pending||loadedRef===ref||!alive(ref))return;pending=true;
   try{
    const original=await resolve(ref);if(!alive(ref)||!details.open)return;if(!original||contentHash(original)!==ref||!history&&(!groupAt(original,0)||groupAt(original,0)!.to!==original.length))throw Error('The retained tool details are unavailable.');
    const temporary=root.ownerDocument.createElement('div');await render(history?historyToolBody(original):original,temporary);if(!alive(ref)||!details.open)return;
    const content=history?temporary:temporary.querySelector('.send-to-t3-tool-group-content'),target=details.querySelector('.send-to-t3-tool-group-content');if(!content||!target)throw Error('Cannot render the retained tool details.');
    target.replaceChildren(...Array.from(content.childNodes));loadedRef=ref;
   }catch(error){if(alive(ref))failure?.(error);}finally{pending=false;if(alive(details.getAttribute('data-t3-tool-ref')??'')&&details.open&&ref!==details.getAttribute('data-t3-tool-ref'))void toggle();}
  };
  // Retained open nodes do not emit toggle when their canonical content changes.
  // Reload that exact new reference, rejecting any pending result for the old one.
  const Observer=root.ownerDocument.defaultView?.MutationObserver;
  if(Observer){const observer=new Observer(()=>{void toggle();});observer.observe(details,{attributes:true,attributeFilter:['data-t3-tool-ref']});cleanups.push(()=>observer.disconnect());}
  details.addEventListener('toggle',toggle);cleanups.push(()=>details.removeEventListener('toggle',toggle));if(details.open)void toggle();
 }
 return ()=>{disposed=true;for(const cleanup of cleanups)cleanup();};
}
