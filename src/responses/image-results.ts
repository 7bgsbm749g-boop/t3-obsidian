import {hasControlCharacters,isRecord,parseJson} from '../shared/values';
import type {InlineActivity} from '../conversations/inline-thread';
import {MAX_IMAGE_BYTES} from '../notes/images';
import {contentHash} from './completion';

export const IMAGE_RESULT_LANGUAGE='t3-image';
const mimes=new Set(['image/png','image/jpeg','image/gif','image/webp']);
export type ToolImageSource={kind:'output';index:number;mimeType:string}|{kind:'file';path:string};
export interface ImageResultReference {version:1;environmentId:string;threadId:string;runId:string;itemId:string;revision?:string;source:ToolImageSource}
const id=(value:unknown,max=1024):value is string=>typeof value==='string'&&value.length>0&&value.length<=max&&!hasControlCharacters(value);

/** Match T3's tool-output-image indexing, including metadata-only image blocks.
 * Never copy base64 payloads into the transcript, recovery state or note. */
export function toolImageSources(item:unknown):ToolImageSource[] {
  if(!isRecord(item)||item.type!=='dynamic_tool'||item.status!=='completed')return [];
  const output=item.output;
  if(isRecord(output)&&(output.isError===true||output.is_error===true||output.error!=null||output._tag==='OrchestratorMcpFailure'))return [];
  const blocks=Array.isArray(output)?output:isRecord(output)&&Array.isArray(output.content)?output.content:[output];
  const result:ToolImageSource[]=[];
  for(const block of blocks.slice(0,128)){
    if(!isRecord(block)||block.type!=='image')continue;
    const source=isRecord(block.source)?block.source:undefined;
    if(source&&source.type!=='base64')continue;
    const mimeType=source?source.media_type:block.mimeType;
    if(typeof mimeType!=='string'||!mimes.has(mimeType.toLowerCase()))continue;
    result.push({kind:'output',index:result.length,mimeType:mimeType.toLowerCase()});
    if(result.length===8)break;
  }
  // view_image often has no image bytes in its public result. T3 exposes the
  // exact file separately, including files outside the thread workspace.
  let path=item.viewedImagePath,input=item.input;
  if(item.toolName==='view_image'&&typeof input==='string'&&input.length<=8192){try{input=parseJson(input);}catch{/* A plain tool input is not an image path. */}}
  if(!path&&item.toolName==='view_image'&&isRecord(input))path=input.path;
  if(!result.length&&id(path)&&/\.(?:png|jpe?g|gif|webp)$/i.test(path))result.push({kind:'file',path});
  return result;
}

/** Keep tool captions but discard image bytes from normalized display state. */
export function withoutToolImageData(output:unknown):unknown {
  const compact=(block:unknown)=>{
    if(!isRecord(block)||block.type!=='image')return block;
    const source=isRecord(block.source)?block.source:undefined;
    return {type:'image',mimeType:source?.media_type??block.mimeType};
  };
  if(Array.isArray(output))return (output as unknown[]).map(compact);
  if(isRecord(output)&&Array.isArray(output.content))return {...output,content:(output.content as unknown[]).map(compact)};
  return compact(output);
}

export function readImageResult(value:unknown):ImageResultReference|undefined {
  if(!isRecord(value)||value.version!==1||!id(value.environmentId)||!id(value.threadId)||!id(value.runId)||!id(value.itemId)||value.revision!==undefined&&!id(value.revision,128)||!isRecord(value.source))return;
  const source=value.source;
  let checked:ToolImageSource;
  if(source.kind==='output'&&Number.isInteger(source.index)&&Number(source.index)>=0&&Number(source.index)<8&&typeof source.mimeType==='string'&&mimes.has(source.mimeType))checked={kind:'output',index:Number(source.index),mimeType:source.mimeType};
  else if(source.kind==='file'&&id(source.path)&&/\.(?:png|jpe?g|gif|webp)$/i.test(source.path))checked={kind:'file',path:source.path};
  else return;
  return {version:1,environmentId:value.environmentId,threadId:value.threadId,runId:value.runId,itemId:value.itemId,...(value.revision?{revision:value.revision}:{}),source:checked};
}
export function parseImageResult(text:string){if(text.length>8192)return;try{return readImageResult(parseJson(text));}catch{return;}}
export const imageResultKey=(reference:ImageResultReference)=>contentHash(JSON.stringify(reference));
export const renderImageResult=(reference:ImageResultReference)=>'```'+IMAGE_RESULT_LANGUAGE+'\n'+JSON.stringify(reference)+'\n```';
export const imageResultLabel=(reference:ImageResultReference)=>reference.source.kind==='file'?reference.source.path.split(/[\\/]/).at(-1)!:`Image ${reference.source.index+1}`;
export function responseImageResults(activity:InlineActivity,environmentId:string,threadId:string):ImageResultReference[] {
  const sources=activity.payload?.imageSources;
  if(activity.kind!=='response.image'||!Array.isArray(sources))return [];
  return (sources as unknown[]).slice(0,8).flatMap(source=>{
    const reference=readImageResult({version:1,environmentId,threadId,runId:activity.turnId,itemId:activity.payload?.itemId,revision:activity.payload?.revision,source});
    return reference?[reference]:[];
  });
}
export {MAX_IMAGE_BYTES};
