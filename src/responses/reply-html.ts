import {unified} from 'unified';
import remarkParse from 'remark-parse';
import {parse,preprocess} from 'micromark';
import {subtokenize} from 'micromark-util-subtokenize';
import type {Root,RootContent} from 'mdast';

const parser=unified().use(remarkParse);
// Bound retained source text as well as entry count. Callers receive copies
// because reply escaping adds its own protected ranges.
const codeCache=new Map<string,Array<[number,number]>>();
let cachedCharacters=0,cachedRanges=0;
let codeCacheHits=0,codeSourceParses=0,codeSkippedTextGroups=0;
const maxCachedCharacters=8_000_000;
const maxCachedEntries=128,maxCachedRanges=65_536;
export function markdownCodeCacheStatus(){return {entries:codeCache.size,characters:cachedCharacters,ranges:cachedRanges,maxCharacters:maxCachedCharacters,maxEntries:maxCachedEntries,maxRanges:maxCachedRanges,hits:codeCacheHits,sourceParses:codeSourceParses,skippedTextGroups:codeSkippedTextGroups};}

/** Source ranges remain stable even when HTML would swallow Markdown code. */
export function markdownCodeRanges(markdown:string):Array<[number,number]> {
  const cached=codeCache.get(markdown);
  if(cached){codeCache.delete(markdown);codeCache.set(markdown,cached);codeCacheHits++;return cached.map(([from,to])=>[from,to]);}
  codeSourceParses++;
  const ranges:Array<[number,number]>=[];
  // Keep the same CommonMark flow grammar and offset-preserving HTML mask.
  // A complete linked text group without a literal backtick cannot contain
  // inline code. Its other inline nodes are unnecessary for this code-only
  // query, so do not allocate them. Groups with backticks use the full inline
  // grammar, including links, escapes and spans across soft/container lines.
  // eslint-disable-next-line no-unsanitized/method -- micromark's document() is a Markdown tokenizer, not the DOM Document API.
  const events=parse().document().write(preprocess()(markdown.replace(/</g,' '),undefined,true));
  for(;;){
    const checked=new Set<object>();
    for(const [kind,token,context] of events){
      if(kind!=='enter'||token.contentType!=='text'||checked.has(token))continue;
      let first=token;while(first.previous)first=first.previous;
      const group:Array<typeof token>=[];let current:typeof token|undefined=first,backticks=false;
      while(current){checked.add(current);group.push(current);if(context.sliceSerialize(current).includes('`'))backticks=true;current=current.next;}
      if(!backticks){for(const part of group)part.contentType=undefined;codeSkippedTextGroups++;}
    }
    if(subtokenize(events))break;
  }
  for(const [kind,token] of events){
    if(kind==='enter'&&(token.type==='codeFenced'||token.type==='codeIndented'||token.type==='codeText')){
      const from=token.start.offset,to=token.end.offset;
      if(from!==undefined&&to!==undefined)ranges.push([from,to]);
    }
  }
  if(markdown.length<=maxCachedCharacters&&ranges.length<=maxCachedRanges){
    codeCache.set(markdown,ranges);cachedCharacters+=markdown.length;cachedRanges+=ranges.length;
    while(codeCache.size>maxCachedEntries||cachedCharacters>maxCachedCharacters||cachedRanges>maxCachedRanges){
      const oldest=codeCache.keys().next().value!;cachedCharacters-=oldest.length;cachedRanges-=codeCache.get(oldest)!.length;codeCache.delete(oldest);
    }
  }
  return ranges.map(([from,to])=>[from,to]);
}

/** Treat response HTML as literal Markdown, without changing code or link targets.
 * Edit source offsets rather than serializing the tree: quote/paragraph layout
 * belongs to the inline renderer. Partial tags are escaped during streaming too. */
export function escapeReplyHtml(markdown:string):string {
  if(!markdown.includes('<'))return markdown;
  const protectedRanges=markdownCodeRanges(markdown);
  // Raw HTML blocks can swallow following Markdown code in the first parse.
  // Mask angle openings for a code-only parse, preserving all source offsets.
  function walk(node:Root|RootContent){
    const start=node.position?.start.offset,end=node.position?.end.offset;
    if(start!==undefined&&end!==undefined){
      if(node.type==='code'||node.type==='inlineCode'||node.type==='definition'){
        protectedRanges.push([start,end]);return;
      }
      if(node.type==='link'||node.type==='image'){
        if(markdown[start]==='<')protectedRanges.push([start,end]);
        else {
          // Link labels can contain prose HTML; only protect the destination.
          const children='children' in node?node.children:[];
          const labelEnd=children.at(-1)?.position?.end.offset;
          if(labelEnd!==undefined)protectedRanges.push([labelEnd,end]);
          else if(node.type==='image')protectedRanges.push([start,end]);
        }
      }
    }
    if('children' in node)for(const child of node.children)walk(child as RootContent);
  }
  walk(parser.parse(markdown) as Root);
  const offsets:number[]=[];
  for(const match of markdown.matchAll(/<(?:\/?[a-z][a-z0-9-]*(?=[\s/>]|$)|!--|[!?])/gi)){
    const offset=match.index!;
    if(protectedRanges.some(([from,to])=>offset>=from&&offset<to))continue;
    let slashes=0;for(let index=offset-1;index>=0&&markdown[index]==='\\';index--)slashes++;
    if(slashes%2===0)offsets.push(offset);
  }
  for(const offset of offsets.reverse())markdown=markdown.slice(0,offset)+'\\'+markdown.slice(offset);
  return markdown;
}
