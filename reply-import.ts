import type {App} from 'obsidian';
import type {HostedInlineRequest} from './hosted-inline';
import type {ReplyReference} from './reply-assets';
import type {ThreadAccess} from './thread-stream';
import {contentHash} from './completion';
import {connectT3Rpc} from './t3-rpc';

const MAX_REPLY_ASSET_BYTES=25*1024*1024;
function assetSource(value:string):string|undefined {
  const source=value.trim().replace(/^<|>$/g,'');
  if(/^file:\/\//i.test(source)){try{return decodeURIComponent(new URL(source).pathname);}catch{return undefined;}}
  if(/^(?:https?:|data:|blob:|t3-context:|#|mailto:)/i.test(source)||source.startsWith('//'))return undefined;
  const path=decodeURIComponent(source.split('#')[0].split('?')[0]);
  return /\.[a-z0-9]{1,12}$/i.test(path)?path:undefined;
}
function assetName(source:string):string {
  const name=source.replace(/\\/g,'/').split('/').at(-1)||'attachment';
  return name.replace(/[<>:"|?*\x00-\x1f/\\]/g,'_').slice(0,120)||'attachment';
}
async function boundedAsset(url:string):Promise<Uint8Array>{
  const response=await fetch(url,{credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(30_000)});
  if(!response.ok||!response.body)throw Error(`The linked file could not be downloaded from T3 (HTTP ${response.status}).`);
  if(Number(response.headers.get('content-length')||0)>MAX_REPLY_ASSET_BYTES)throw Error('The linked file exceeds 25 MiB.');
  const chunks:Uint8Array[]=[];let size=0;const reader=response.body.getReader();
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_REPLY_ASSET_BYTES)throw Error('The linked file exceeds 25 MiB.');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  if(!size)throw Error('The linked file is empty.');
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}

export async function importReplyAsset(app:App,reference:ReplyReference,request:HostedInlineRequest,access:ThreadAccess):Promise<string|undefined>{
  const source=assetSource(reference.source);if(!source)return undefined;
  const subpath=reference.source.includes('#')?'#'+reference.source.split('#').slice(1).join('#'):undefined;
  const existingVaultFile=app.metadataCache.getFirstLinkpathDest(source,request.notePath);
  if(existingVaultFile){
    const link=app.fileManager.generateMarkdownLink(existingVaultFile,request.notePath,subpath,reference.label||'');
    return reference.image?`!${link}`:link;
  }
  const rpc=await connectT3Rpc(access.api,access.origin);
  let bytes:Uint8Array;
  try{
    try{
      const result=await rpc.call('assets.createUrl',{resource:{_tag:'media-file',threadId:request.threadId,path:source}});
      if(typeof result?.relativeUrl!=='string'||!result.relativeUrl.startsWith('/api/assets/'))throw Error('T3 did not return a signed file URL.');
      bytes=await boundedAsset(new URL(result.relativeUrl,access.origin).href);
    }catch(mediaError){
      // T3's media route rejects plain text and source files. Its project
      // reader supplies those bytes without requiring a second file API.
      const shell=await access.api('/api/orchestration/shell');
      const project=shell?.projects?.find((entry:any)=>entry.id===request.projectId);
      if(typeof project?.workspaceRoot!=='string')throw mediaError;
      const result=await rpc.call('projects.readFile',{cwd:project.workspaceRoot,relativePath:source});
      if(result?.truncated||typeof result?.contents!=='string')throw Error(`T3 could not read the complete linked file: ${source}`);
      bytes=new TextEncoder().encode(result.contents);
      if(!bytes.length||bytes.length>MAX_REPLY_ASSET_BYTES)throw Error('The linked file is empty or exceeds 25 MiB.');
    }
  }finally{rpc.close();}
  const folder=`T3 Code Attachments/${request.id}`;
  const key=contentHash(source).slice(0,16);
  const path=`${folder}/${key}-${assetName(source)}`;
  for(const part of ['T3 Code Attachments',folder])if(!app.vault.getAbstractFileByPath(part))await app.vault.createFolder(part);
  let file=app.vault.getFileByPath(path);
  if(file){
    const existing=new Uint8Array(await app.vault.readBinary(file));
    if(existing.length!==bytes.length||!existing.every((value,index)=>value===bytes[index]))throw Error(`A different file already occupies ${path}.`);
  }else file=await app.vault.createBinary(path,bytes.buffer as ArrayBuffer);
  const link=app.fileManager.generateMarkdownLink(file,request.notePath,subpath,reference.label||'');
  return reference.image?`!${link}`:link;
}

