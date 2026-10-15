import {validateHostedRequest,type HostedInlineRequest} from './hosted-inline';
import {responseAnchor,responseRegion} from './native-response-projection';
import {responseIds} from './response-container';

const prefix='<!-- t3-response-binding:';
const indexed=new WeakMap<readonly HostedInlineRequest[],Map<string,HostedInlineRequest>>();
export function responseBindingComment(request:HostedInlineRequest){
  if(!request.localOnly)throw Error('This response is not local.');
  const encoded=encodeURIComponent(JSON.stringify(request)).replace(/-/g,'%2D');
  return `${prefix}${request.id}:${encoded} -->`;
}
/** The saved note carries routing identities, never a credential or a stream. */
export function localResponseBindings(document:string,stored:readonly HostedInlineRequest[]=[]):HostedInlineRequest[]{
  const result:HostedInlineRequest[]=[],seen=new Set<string>();
  let byId=indexed.get(stored);if(!byId){byId=new Map(stored.map(request=>[request.id,request]));indexed.set(stored,byId);}
  const pattern=/<!-- t3-response-binding:([0-9a-f-]{36}):([^\n]*?) -->/gi;
  for(const match of document.matchAll(pattern)){
    if(match[2].length>1_000_000)continue;
    try{
      const request=validateHostedRequest(JSON.parse(decodeURIComponent(match[2])));
      const region=responseRegion(document,request.id);
      if(request.id!==match[1]||!request.localOnly||seen.has(request.id)||!region||region.from<match.index!+match[0].length||document.slice(match.index!+match[0].length,region.from).trim())continue;
      if(document.slice(region.from,region.to)!==responseAnchor(request.id,document))continue;
      seen.add(request.id);result.push(byId.get(request.id)??request);
    }catch{/* Ordinary Markdown and malformed descriptors cannot start work. */}
  }
  for(const id of stored.length?responseIds(document):[]){
    const request=byId.get(id);if(!request)continue;
    if(!request.localOnly||seen.has(request.id))continue;
    try{const region=responseRegion(document,request.id);if(region&&document.slice(region.from,region.to)===responseAnchor(request.id,document)){seen.add(request.id);result.push(request);}}catch{/* Copied or damaged anchors remain ordinary note text. */}
  }
  return result;
}
export function localResponseRange(document:string,id:string,stored:readonly HostedInlineRequest[]=[]){
  const request=localResponseBindings(document,stored).find(request=>request.id===id);
  if(!request)return;
  const region=responseRegion(document,id)!;
  const match=[...document.matchAll(/<!-- t3-response-binding:([0-9a-f-]{36}):[^\n]*? -->/gi)].find(match=>match[1]===id&&match.index!+match[0].length<=region.from&&!document.slice(match.index!+match[0].length,region.from).trim());
  return {from:match?.index??region.from,to:region.to,request};
}
/** Remove only a validated legacy descriptor beside its exact empty anchor. */
export function withoutLocalResponseBinding(document:string,id:string){
  if(!document.includes(prefix))return document;
  const legacy=localResponseBindings(document).find(request=>request.id===id);if(!legacy)return document;
  const range=localResponseRange(document,id)!,region=responseRegion(document,id)!;
  return document.slice(0,range.from)+document.slice(region.from);
}
export function withLocalResponseBinding(document:string,request:HostedInlineRequest){
  const region=responseRegion(document,request.id);if(!region)throw Error('The response block is missing.');
  if(localResponseBindings(document).some(binding=>binding.id===request.id))return document;
  return document.slice(0,region.from)+responseBindingComment(request)+'\n'+document.slice(region.from);
}
