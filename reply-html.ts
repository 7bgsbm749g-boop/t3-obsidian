import {unified} from 'unified';
import remarkParse from 'remark-parse';
import type {Root,RootContent} from 'mdast';

const parser=unified().use(remarkParse);

/** Treat response HTML as literal Markdown, without changing code or link targets.
 * Edit source offsets rather than serializing the tree: quote/paragraph layout
 * belongs to the inline renderer. Partial tags are escaped during streaming too. */
export function escapeReplyHtml(markdown:string):string {
  if(!markdown.includes('<'))return markdown;
  const protectedRanges:Array<[number,number]>=[];
  // Raw HTML blocks can swallow following Markdown code in the first parse.
  // Mask angle openings for a code-only parse, preserving all source offsets.
  function protectCode(node:Root|RootContent){
    if(node.type==='code'||node.type==='inlineCode'){
      const from=node.position?.start.offset,to=node.position?.end.offset;
      if(from!==undefined&&to!==undefined)protectedRanges.push([from,to]);
      return;
    }
    if('children' in node)for(const child of node.children)protectCode(child as RootContent);
  }
  protectCode(parser.parse(markdown.replace(/</g,' ')) as Root);
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
