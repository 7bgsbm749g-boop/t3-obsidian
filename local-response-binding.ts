import {validateHostedRequest,type HostedInlineRequest} from './hosted-inline';
import {responseAnchor,responseRegion} from './native-response-projection';

const prefix='<!-- t3-response-binding:';
export function responseBindingComment(request:HostedInlineRequest){
  if(!request.localOnly)throw Error('This response is not local.');
  const encoded=encodeURIComponent(JSON.stringify(request)).replace(/-/g,'%2D');
  return `${prefix}${request.id}:${encoded} -->`;
}
/** The saved note carries routing identities, never a credential or a stream. */
export function localResponseBindings(document:string):HostedInlineRequest[]{
  const result:HostedInlineRequest[]=[],seen=new Set<string>();
  const pattern=/<!-- t3-response-binding:([0-9a-f-]{36}):([^\n]*?) -->/gi;
  for(const match of document.matchAll(pattern)){
    if(match[2].length>1_000_000)continue;
    try{
      const request=validateHostedRequest(JSON.parse(decodeURIComponent(match[2])));
      const region=responseRegion(document,request.id);
      if(request.id!==match[1]||!request.localOnly||seen.has(request.id)||!region||region.from<match.index!+match[0].length||document.slice(match.index!+match[0].length,region.from).trim())continue;
      if(document.slice(region.from,region.to)!==responseAnchor(request.id,document))continue;
      seen.add(request.id);result.push(request);
    }catch{/* Ordinary Markdown and malformed descriptors cannot start work. */}
  }
  return result;
}
export function localResponseRange(document:string,id:string){
  const request=localResponseBindings(document).find(request=>request.id===id);
  if(!request)return;
  const region=responseRegion(document,id)!;
  const comment=responseBindingComment(request),from=document.lastIndexOf(comment,region.from);
  if(from<0)return;
  return {from,to:region.to,request};
}
export function withLocalResponseBinding(document:string,request:HostedInlineRequest){
  const region=responseRegion(document,request.id);if(!region)throw Error('The response block is missing.');
  if(localResponseBindings(document).some(binding=>binding.id===request.id))return document;
  return document.slice(0,region.from)+responseBindingComment(request)+'\n'+document.slice(region.from);
}
