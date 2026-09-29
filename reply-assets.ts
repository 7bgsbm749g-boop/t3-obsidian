import {unified} from 'unified';
import remarkParse from 'remark-parse';
import type {Root,RootContent} from 'mdast';

export interface ReplyReference {source:string;original:string;image:boolean;label:string;offset:number}

/** Only references in the assistant's Markdown carry a reliable insertion position. */
export function replyReferences(markdown:string):ReplyReference[] {
  const root=unified().use(remarkParse).parse(markdown) as Root;
  const definitions=new Map<string,string>(),found:ReplyReference[]=[];
  function walk(node:Root|RootContent,visit:(node:any)=>void){visit(node);if('children' in node)for(const child of node.children)walk(child as RootContent,visit);}
  walk(root,node=>{if(node.type==='definition'&&!definitions.has(node.identifier))definitions.set(node.identifier,node.url);});
  walk(root,node=>{
    const start=node.position?.start.offset,end=node.position?.end.offset;
    if(start===undefined||end===undefined)return;
    if(['image','link','imageReference','linkReference'].includes(node.type)){
      const source=node.url??definitions.get(node.identifier);
      if(source)found.push({source,original:markdown.slice(start,end),image:node.type.startsWith('image'),label:node.alt??node.children?.map((child:any)=>child.value??'').join('')??'',offset:start});
      return;
    }
    if(node.type!=='text')return;
    const raw=markdown.slice(start,end);
    for(const match of raw.matchAll(/(!?)\[\[([^\]\n]+)\]\]/g)){
      const index=match.index!;let slashes=0;for(let i=index-1;i>=0&&raw[i]==='\\';i--)slashes++;
      if(slashes%2)continue;
      const [source,label]=match[2].split('|');
      if(!/\.[a-z0-9]{1,12}(?:#.*)?$/i.test(source.trim()))continue;
      found.push({source:source.trim(),original:match[0],image:match[1]==='!',label:label??'',offset:start+index});
    }
  });
  return found.sort((a,b)=>a.offset-b.offset).filter((item,index,items)=>index===0||item.offset>=items[index-1].offset+items[index-1].original.length);
}

export async function rewriteReplyReferences(markdown:string,replace:(reference:ReplyReference)=>Promise<string|undefined>):Promise<string> {
  const changes:Array<{offset:number;length:number;text:string}>=[];
  for(const reference of replyReferences(markdown)){
    const text=await replace(reference);
    if(text!==undefined)changes.push({offset:reference.offset,length:reference.original.length,text});
  }
  for(const change of changes.reverse())markdown=markdown.slice(0,change.offset)+change.text+markdown.slice(change.offset+change.length);
  return markdown;
}
