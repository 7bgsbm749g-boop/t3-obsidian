import {contentHash} from './completion';
import {unified} from 'unified';
import remarkParse from 'remark-parse';
import type {Root} from 'mdast';
import {inlineResponseRange,regionBody} from './inline-thread';
import type {SelectionAnchor} from './inline-thread';
import {findImageEmbeds} from './images';
import type {LeaseRecord} from './inline-lease';

export interface ResponseEvidence {id:string;threadId:string;projectId:string;environmentId:string;body:string;active?:boolean;prefix?:{length:number;hash:string}}
export interface SourceBlock {responseId:string;offset:number;markdown:string}
export interface NoteDelivery {id:string;notePath:string;threadId:string;projectId:string;environmentId:string;blocks:SourceBlock[]}
export type MissingThreeResult = {kind:'none';blocks:SourceBlock[]} | {kind:'found';markdown:string;blocks:SourceBlock[]} | {kind:'uncertain';reason:string;markdown:string;blocks:SourceBlock[]};
export interface MissingThreeInput {document:string;anchor:SelectionAnchor;prompt:string;responses:ResponseEvidence[];coverage:SourceBlock[];threadId:string;projectId:string;environmentId:string;unavailable?:boolean}

/** Existing authoritative lease state is durable provenance. Completion markers
 * remain temporary and are never retained or reintroduced for this feature. */
export function leaseResponseEvidence(record:LeaseRecord,vaultId:string,notePath:string,originPath?:string):ResponseEvidence|undefined {
  const {request,state}=record;
  if(request.vaultId!==vaultId||![notePath,originPath].some(path=>path!==undefined&&(path===(state?.notePath??request.notePath)||path===request.notePath))||!state?.turnId)return;
  const messageId=state.messageId??request.messageId;
  if(state.bindingCheckpoint?.bindings?.[messageId]?.turnId!==state.turnId)return;
  if(state.status==='complete'&&state.finalSaved&&state.cleanupComplete&&state.finalBody!==undefined&&state.responseAnchor&&!state.userStopped)
    return {id:request.id,threadId:request.threadId,projectId:request.projectId,environmentId:request.threadEnvironmentId,body:state.finalBody.replace(/\n+$/,''),prefix:state.responseAnchor};
  if(['running','waiting'].includes(state.status)&&state.body)
    return {id:request.id,threadId:request.threadId,projectId:request.projectId,environmentId:request.threadEnvironmentId,body:state.body,active:true};
}

export function mergeNoteDeliveries(...groups:NoteDelivery[][]):NoteDelivery[]{
  const values=new Map<string,NoteDelivery>();
  for(const entries of groups)for(const entry of entries)values.set(entry.id,entry);
  return [...values.values()];
}
export function loadNoteDeliveries(value:unknown):NoteDelivery[]{
  if(!Array.isArray(value))return [];
  return value.filter((item):item is NoteDelivery=>item&&['id','notePath','threadId','projectId','environmentId'].every(key=>typeof item[key]==='string')&&Array.isArray(item.blocks)&&item.blocks.every((b:any)=>typeof b.responseId==='string'&&Number.isSafeInteger(b.offset)&&b.offset>=0&&typeof b.markdown==='string'));
}

/** Positional identity is relative to the exact response, plus exact Markdown.
 * Shifted blocks conservatively resend; matching identical text elsewhere is
 * never coverage. Image blocks resend because source text cannot prove bytes. */
export function detectMissingThree(input:MissingThreeInput):MissingThreeResult {
  const {document,anchor}=input;
  const none:MissingThreeResult={kind:'none',blocks:[]};
  if(anchor.start===0)return none;
  if(document.slice(anchor.start,anchor.end)!==anchor.text)return {kind:'uncertain',reason:'The captured selection does not match the note.',markdown:'',blocks:[]};
  const root=unified().use(remarkParse).parse(document) as Root;
  const nodes=root.children.map(node=>({type:node.type,from:node.position!.start.offset!,to:node.position!.end.offset!}));
  const matches:Array<{evidence:ResponseEvidence;from:number;to:number}>=[];
  let ambiguous=input.unavailable===true;
  for(const evidence of input.responses){
    if(evidence.active){
      const region=regionBody(document,evidence.id);
      if(!region||region.body!==evidence.body){ambiguous=true;continue;}
      matches.push({evidence,...inlineResponseRange(document,evidence.id)!});
      continue;
    }
    if(!evidence.body.trim())continue;
    const positions:number[]=[];
    for(let at=document.indexOf(evidence.body);at>=0;at=document.indexOf(evidence.body,at+1))positions.push(at);
    // Complete Markdown boundaries prevent a copied quotation or code literal
    // from impersonating the original response.
    if(positions.length!==1){ambiguous=true;continue;}
    const from=positions[0],to=from+evidence.body.length;
    if(evidence.prefix&&(evidence.prefix.length!==from||evidence.prefix.hash!==contentHash(document.slice(0,from)))){ambiguous=true;continue;}
    if(!nodes.some(n=>n.from===from)||!nodes.some(n=>n.to===to)){ambiguous=true;continue;}
    matches.push({evidence,from,to});
  }
  if(matches.some(m=>m.from<anchor.end&&m.to>anchor.start))return none;
  const preceding=matches.filter(m=>m.to<=anchor.start).sort((a,b)=>b.to-a.to);
  const boundary=preceding[0];
  if(!boundary)return ambiguous?{kind:'uncertain',reason:'A response cannot be verified uniquely in this note. Select the surrounding context explicitly.',markdown:'',blocks:[]}:none;
  if(preceding.some(m=>m!==boundary&&m.to===boundary.to))ambiguous=true;
  const passage=nodes.filter(n=>n.from>=boundary.to&&n.from<anchor.end);
  const selectedIncluded=input.prompt.includes(anchor.text);
  const blocks=passage.filter(n=>n.type!=='heading'&&((n.from>=anchor.start&&n.to<=anchor.end&&selectedIncluded)||n.from<anchor.start)).map(n=>({responseId:boundary.evidence.id,offset:n.from-boundary.to,markdown:document.slice(n.from,n.to)}));
  const omitted=passage.filter(n=>n.from<anchor.start&&!(n.from>=anchor.start&&n.to<=anchor.end&&selectedIncluded));
  const missing=omitted.filter(n=>!input.coverage.some(b=>b.responseId===boundary.evidence.id&&b.offset===n.from-boundary.to&&b.markdown===document.slice(n.from,n.to)&&!findImageEmbeds(b.markdown).length));
  const markdown=missing.map(n=>document.slice(n.from,n.to)).join('\n\n');
  const same=boundary.evidence.threadId===input.threadId&&boundary.evidence.projectId===input.projectId&&boundary.evidence.environmentId===input.environmentId;
  if(markdown&&(ambiguous||!same||passage.some(n=>n.type==='heading')))
    return {kind:'uncertain',reason:ambiguous?'Response provenance is ambiguous or unavailable.':!same?'The preceding response belongs to another thread.':'A heading separates this request from the preceding response.',markdown,blocks};
  return markdown?{kind:'found',markdown,blocks}:{kind:'none',blocks};
}
export function withMissingThree(prompt:string,markdown:string){return markdown?`Additional context preceding your selection:\n${markdown}\n\nYour selected request:\n${prompt}`:prompt;}

/** A whole-note send already supplies the passage. Record it without changing
 * the prompt; there is no diff or inference about what the thread has read. */
export function suppliedNoteBlocks(input:Omit<MissingThreeInput,'anchor'|'prompt'>):SourceBlock[]{
  const end=input.document.trimEnd().length;if(!end)return [];
  const start=end-1,text=input.document.slice(start,end);
  const result=detectMissingThree({...input,prompt:input.document,anchor:{start,end,text,before:input.document.slice(Math.max(0,start-24),start),after:input.document.slice(end,end+24)}});
  return result.kind==='uncertain'?[]:result.blocks;
}
