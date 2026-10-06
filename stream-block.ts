import {unified} from 'unified';
import remarkParse from 'remark-parse';
import {contentHash} from './completion';
import {markdownCodeRanges} from './reply-html';

export interface StreamBlock {key:string;from:number;to:number;text:string;complete:boolean;tracked:boolean}
const parser=unified().use(remarkParse);
const cache=new Map<string,StreamBlock[]>();
let cachedCharacters=0;
const maxCachedCharacters=2_000_000;
/** The native Markdown boundary owns nested tool output and input quotes.
 * A fenced example, nested example or following final answer is not a block. */
export function streamBlocks(document:string):StreamBlock[] {
  const cached=cache.get(document);if(cached)return cached;
  const blocks:StreamBlock[]=[];
  const codeRanges=markdownCodeRanges(document);
  for(const node of parser.parse(document).children){
    if(node.type!=='blockquote')continue;
    const from=node.position?.start.offset,to=node.position?.end.offset;if(from===undefined||to===undefined)continue;
    const text=document.slice(from,to),header=text.split('\n')[0];
    if(!/^> \[!t3-progress\][+-] /.test(header))continue;
    const key=/<span class="send-to-t3-fold-key" data-t3-fold="([^"]+)"><\/span>/.exec(header)?.[1];if(!key)continue;
    // Tracking lines disappear only after the saved result is adopted. A
    // terminal-looking direct preview must never offer a destructive action.
    const markers=[...document.slice(0,from).matchAll(/^<!-- t3-(?:inline|response):(start|end):([0-9a-f-]{36}) -->$/gm)];
    const open=new Set<string>();for(const marker of markers){if(codeRanges.some(([start,end])=>marker.index!>=start&&marker.index!<end))continue;if(marker[1]==='start')open.add(marker[2]);else open.delete(marker[2]);}
    blocks.push({key,from,to,text,complete:key.endsWith(':complete'),tracked:open.size>0});
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
