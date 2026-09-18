import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { sha256 } from '@noble/hashes/sha256';
import { Buffer } from 'buffer';
import type { Root, RootContent } from 'mdast';
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_TOTAL_IMAGE_BYTES = 20 * 1024 * 1024;
export interface ImageEmbed {link:string; original:string; line:number; offset:number; wiki:boolean}
export interface ImageContext {version:1;records:{version:1;contextId:string;label:string;kind:'image';attachmentId:string;name:string;mimeType:string;sizeBytes:number}[]}
export interface ImageAttachment {type:'image'; id:string; name:string; mimeType:string; sizeBytes:number; dataUrl:string}
export function findImageEmbeds(markdown:string):ImageEmbed[] {
  const root=unified().use(remarkParse).parse(markdown) as Root;
  const definitions=new Map<string,string>();
  const output:ImageEmbed[]=[];
  const frontmatterEnd=/^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/.exec(markdown)?.[0].length ?? 0;
  function walk(node:Root|RootContent, visit:(node:any)=>void){visit(node);if('children' in node) for(const child of node.children) walk(child as RootContent,visit);}
  walk(root,node=>{if(node.type==='definition' && !definitions.has(node.identifier)) definitions.set(node.identifier,node.url);});
  walk(root,node=>{
    const start=node.position?.start.offset; const end=node.position?.end.offset;
    if(start===undefined || end===undefined || start<frontmatterEnd) return;
    if(node.type==='image' || node.type==='imageReference') {
      const link=node.url ?? definitions.get(node.identifier);
      if(link) output.push({link,original:markdown.slice(start,end),line:node.position.start.line,offset:start,wiki:false});
    }
    if(node.type==='html' && /<img\b/i.test(node.value)) throw new Error('HTML <img> embeds are not supported. Use ![[image.png]] or ![alt](image.png).');
    if(node.type!=='text') return;
    const raw=markdown.slice(start,end);
    for(const match of raw.matchAll(/!\[\[([^\]\n]+)\]\]/g)) {
      const index=match.index!; let slashes=0; for(let i=index-1;i>=0&&raw[i]==='\\';i--) slashes++;
      if(slashes%2) continue;
      const link=match[1].split('|')[0].split('#')[0].trim();
      // Obsidian also embeds notes/audio/PDFs. Only image wiki embeds are attachments.
      if(!/\.(?:png|jpe?g|gif|webp|svg|bmp|avif|heic|tiff?)$/i.test(link)) continue;
      output.push({link,original:match[0],line:node.position.start.line+(raw.slice(0,index).match(/\n/g)?.length??0),offset:start+index,wiki:true});
    }
  });
  return output.sort((a,b)=>a.offset-b.offset);
}
export function imageMime(bytes:Buffer):string {
  if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255) return 'image/jpeg';
  if(/^GIF8[79]a$/.test(bytes.subarray(0,6).toString('ascii'))) return 'image/gif';
  if(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP') return 'image/webp';
  throw new Error('Unsupported or invalid image. Use PNG, JPEG, GIF, or WebP.');
}
export async function collectImages(markdown:string, read:(embed:ImageEmbed)=>Promise<{bytes:Buffer;name:string}>):Promise<{attachments:ImageAttachment[];context:ImageContext;markdown:string}> {
  const embeds=findImageEmbeds(markdown); const attachments:ImageAttachment[]=[];const byHash=new Map<string,ImageAttachment>();const byLink=new Map<string,ImageAttachment>();const replacements:{offset:number;length:number;text:string}[]=[];let total=0;
  for(const embed of embeds) {
    let attachment=byLink.get(embed.link);
    if(!attachment) {
      let loaded;
      try{loaded=await read(embed);}catch(e){throw new Error(`Image on line ${embed.line}: ${e instanceof Error?e.message:String(e)}`);}
      const {bytes,name}=loaded;
      if(!bytes.length||bytes.length>MAX_IMAGE_BYTES) throw new Error(`Image on line ${embed.line} must be between 1 byte and 10 MiB.`);
      const hash=Buffer.from(sha256(bytes)).toString('hex');attachment=byHash.get(hash);
      if(!attachment){
        if(attachments.length>=8) throw new Error('T3 supports at most 8 distinct images per note. No thread was created.');
        total+=bytes.length;if(total>MAX_TOTAL_IMAGE_BYTES) throw new Error('Embedded images exceed the 20 MiB total limit. No thread was created.');
        let mimeType;try{mimeType=imageMime(bytes);}catch(e){throw new Error(`Image on line ${embed.line}: ${(e as Error).message}`);}
        attachment={type:'image',id:`obsidian-${hash.slice(0,48)}`,name:`image-${attachments.length+1}-${name}`.slice(0,255),mimeType,sizeBytes:bytes.length,dataUrl:`data:${mimeType};base64,${bytes.toString('base64')}`};
        attachments.push(attachment);byHash.set(hash,attachment);
      }
      byLink.set(embed.link,attachment);
    }
    const label=attachment.name.slice(0,200).replace(/[\\[\]]/g,'\\$&');
    replacements.push({offset:embed.offset,length:embed.original.length,text:`[${label}](t3-context://v1/image/${attachment.id})`});
  }
  let result=markdown;
  for(const replacement of replacements.reverse()) result=result.slice(0,replacement.offset)+replacement.text+result.slice(replacement.offset+replacement.length);
  return {attachments,markdown:result,context:{version:1,records:attachments.map(a=>({version:1,contextId:a.id,label:a.name.slice(0,200),kind:'image',attachmentId:a.id,name:a.name,mimeType:a.mimeType,sizeBytes:a.sizeBytes}))}};
}
