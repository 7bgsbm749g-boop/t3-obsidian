import {parse,preprocess} from 'micromark';
import {subtokenize} from 'micromark-util-subtokenize';
import {contentHash} from './completion';
import {responseBoundaries} from './response-container';

export interface StreamBlock {key:string;from:number;to:number;text:string;/** Terminal history, including an interrupted run. */complete:boolean;tracked:boolean}
const cache=new Map<string,StreamBlock[]>();
let cachedCharacters=0;
const maxCachedCharacters=8_000_000;
let sourceParses=0,cacheHits=0;
export function streamBlockCacheStatus(){return {entries:cache.size,characters:cachedCharacters,maxCharacters:maxCachedCharacters,sourceParses,hits:cacheHits};}
/** The native Markdown boundary owns nested tool output and input quotes.
 * A fenced example, nested example or following final answer is not a block. */
export function streamBlocks(document:string):StreamBlock[] {
  const cached=cache.get(document);if(cached){cache.delete(document);cache.set(document,cached);cacheHits++;return cached;}
  const blocks:StreamBlock[]=[];
  // Ordinary notes need no Markdown parse. The flow grammar below still owns
  // context: candidate text in a fence, HTML or a nested quote is not history.
  if(!/^ {0,3}> \[!t3-progress\][+-] .*data-t3-fold="/m.test(document))return blocks;
  sourceParses++;
  const boundaries=responseBoundaries(document);
  // Only top-level blockquote extents are needed. Do not expand the inline
  // AST of megabytes of escaped tool output on every native layout refresh.
  // eslint-disable-next-line no-unsanitized/method -- Markdown tokenizer, not DOM Document.write.
  const events=parse().document().write(preprocess()(document,undefined,true));
  for(;;){for(const [kind,token] of events)if(kind==='enter'&&(token.contentType==='text'||token.contentType==='string'))token.contentType=undefined;if(subtokenize(events))break;}
  let depth=0,opening:number|undefined;
  for(const [kind,token] of events){
    if(kind==='exit')depth--;
    if(kind==='enter'&&depth===0&&token.type==='blockQuote')opening=token.start.offset;
    if(kind==='enter')depth++;
    if(kind!=='exit'||depth!==0||token.type!=='blockQuote'||opening===undefined)continue;
    const from=opening,to=token.end.offset;opening=undefined;
    const text=document.slice(from,to),header=text.split('\n')[0];
    if(!/^ {0,3}> \[!t3-progress\][+-] /.test(header))continue;
    const key=/<span class="send-to-t3-fold-key" data-t3-fold="([^"]+)"><\/span>/.exec(header)?.[1];if(!key)continue;
    // Tracking lines disappear only after the saved result is adopted. A
    // terminal-looking direct preview must never offer a destructive action.
    const open=new Set<string>();for(const boundary of boundaries){if(boundary.from>=from)break;if(boundary.kind==='start')open.add(boundary.id);else open.delete(boundary.id);}
    // Interrupted runs keep their live fold identity so the user's expansion
    // choice survives Stop. Their generated heading still identifies terminal
    // history, including notes saved by older plugin versions.
    const interrupted=key.endsWith(':active')&&/^> \[!t3-progress\][+-] \*\*(?:\\.|[^*\\])* · Interrupted\*\*(?: |$)/.test(header);
    blocks.push({key,from,to,text,complete:key.endsWith(':complete')||interrupted,tracked:open.size>0});
  }
  if(document.length<=maxCachedCharacters){
    cache.set(document,blocks);cachedCharacters+=document.length;
    while(cache.size>8||cachedCharacters>maxCachedCharacters){const oldest=cache.keys().next().value!;cachedCharacters-=oldest.length;cache.delete(oldest);}
  }
  return blocks;
}
export function streamBlock(document:string,key:string):StreamBlock|undefined {
  const matches=streamBlocks(document).filter(block=>block.key===key);return matches.length===1?matches[0]:undefined;
}
export function removeStreamBlock(document:string,key:string,hash?:string):{text:string;from:number;to:number} {
  const block=streamBlock(document,key);
  if(!block||!block.complete||block.tracked||hash!==undefined&&contentHash(block.text)!==hash)throw Error('The completed streaming block changed. Reload the note and try again.');
  // Consume its terminating newline, retaining the existing separator before
  // the final answer and all other note content byte for byte.
  const to=block.to+(document[block.to]==='\n'?1:0);
  return {text:document.slice(0,block.from)+document.slice(to),from:block.from,to};
}
