import type {App} from 'obsidian';
import type {HostedInlineRequest} from './hosted-inline';
import type {ReplyReference} from './reply-assets';
import type {ThreadAccess} from './thread-stream';
import {contentHash} from './completion';
import {connectT3Rpc} from './t3-rpc';
import {DEFAULT_REPLY_FOLDERS,validateReplyFolders} from './reply-locations';

const MAX_REPLY_ASSET_BYTES=25*1024*1024;
export function assetSource(value:string):string|undefined {
  let source=value.trim().replace(/^<|>$/g,'');
  if(/^file:\/\//i.test(source)){try{return decodeURIComponent(new URL(source).pathname);}catch{return undefined;}}
  source=source.replace(/^sandbox:/i,'');
  if(source.startsWith('#')||source.startsWith('//')||/^[a-z][a-z0-9+.-]*:/i.test(source)&&!(/^[a-z]:[\\/]/i.test(source)))return undefined;
  let path:string;try{path=decodeURIComponent(source.split('#')[0].split('?')[0]).replace(/:\d+(?::\d+)?$/,'');}catch{throw Error('The linked file has invalid percent encoding.');}
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
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}

const TEXT_FILE=/\.(?:txt|md|markdown|csv|tsv|json|jsonl|yaml|yml|xml|svg|html?|css|[cm]?jsx?|tsx?|py|sh|sql|toml|ini|log|r|rs|go|java|c|cpp|h|hpp)$/i;
const IMAGE_FILE=/\.(?:png|jpe?g|gif|webp|svg|bmp|avif|tiff?|ico|heic)$/i;
const pending=new WeakMap<App,Map<string,Promise<import('obsidian').TFile>>>();
async function downloadReplyFile(source:string,request:HostedInlineRequest,access:ThreadAccess):Promise<Uint8Array>{
  // A local desktop can retain ZIPs and other binary documents byte-for-byte.
  // Remote access never receives this capability or reads this host's paths.
  if(access.readReplyFile)return access.readReplyFile(source,request.projectId);
  const rpc=await connectT3Rpc(access.api,access.origin);
  try{
    try{
      const result=await rpc.call('assets.createUrl',{resource:{_tag:'media-file',threadId:request.threadId,path:source}});
      if(typeof result?.relativeUrl!=='string'||!result.relativeUrl.startsWith('/api/assets/'))throw Error('T3 did not return a signed file URL.');
      return await boundedAsset(new URL(result.relativeUrl,access.origin).href);
    }catch(mediaError){
      if(!TEXT_FILE.test(source))throw Error('T3 cannot download this file type from a remote computer yet. The original link is retained.');
      const shell=await access.api('/api/orchestration/shell');
      const project=shell?.projects?.find((entry:any)=>entry.id===request.projectId);
      if(typeof project?.workspaceRoot!=='string')throw mediaError;
      const result=await rpc.call('projects.readFile',{cwd:project.workspaceRoot,relativePath:source});
      if(result?.truncated||typeof result?.contents!=='string')throw Error(`T3 could not read the complete linked file: ${source}`);
      const bytes=new TextEncoder().encode(result.contents);
      if(bytes.length>MAX_REPLY_ASSET_BYTES)throw Error('The linked file exceeds 25 MiB.');
      if(result.byteLength!==undefined&&result.byteLength!==bytes.length)throw Error('T3 did not return the exact linked text file bytes.');
      return bytes;
    }
  }finally{rpc.close();}
}

export async function importReplyAsset(app:App,reference:ReplyReference,request:HostedInlineRequest,access:ThreadAccess):Promise<string|undefined>{
  const source=assetSource(reference.source);if(!source)return undefined;
  const subpath=reference.source.includes('#')?'#'+reference.source.split('#').slice(1).join('#'):undefined;
  const absolute=/^(?:\/|[a-z]:[\\/])/i.test(source);
  const root=request.host?.workspaceRoot?.replace(/\\/g,'/').replace(/\/+$/,''),normalized=source.replace(/\\/g,'/');
  const inside=root&&( /^[a-z]:/i.test(root)?normalized.toLowerCase().startsWith(root.toLowerCase()+'/'):normalized.startsWith(root+'/'));
  const existingVaultFile=absolute?(inside?app.vault.getFileByPath(normalized.slice(root!.length+1)):null):app.metadataCache.getFirstLinkpathDest(source,request.notePath);
  if(existingVaultFile){
    const link=app.fileManager.generateMarkdownLink(existingVaultFile,request.notePath,subpath,reference.label||'');
    return reference.image?`!${link}`:link;
  }
  const folders=request.replyFolders?validateReplyFolders(request.replyFolders):DEFAULT_REPLY_FOLDERS;
  const base=folders[IMAGE_FILE.test(source)?'images':'files'];
  const response=request.replyFolders?contentHash(JSON.stringify([request.threadId,request.messageId])).slice(0,20):request.id;
  const folder=`${base}/${response}`;
  const key=contentHash(source).slice(0,16);
  const path=`${folder}/${key}-${assetName(source)}`;
  let file=app.vault.getFileByPath(path);
  if(!file){
    let tasks=pending.get(app);if(!tasks){tasks=new Map();pending.set(app,tasks);}
    let task=tasks.get(path);
    if(!task){
      task=(async()=>{
        const bytes=await downloadReplyFile(source,request,access);
        if(bytes.length>MAX_REPLY_ASSET_BYTES)throw Error('The linked file exceeds 25 MiB.');
        const parts=folder.split('/');
        for(let i=1;i<=parts.length;i++){
          const part=parts.slice(0,i).join('/');
          if(!app.vault.getAbstractFileByPath(part))try{await app.vault.createFolder(part);}catch(error){if(!app.vault.getAbstractFileByPath(part))throw error;}
        }
        const occupied=app.vault.getFileByPath(path);
        if(occupied){const before=new Uint8Array(await app.vault.readBinary(occupied));if(before.length!==bytes.length||!before.every((value,index)=>value===bytes[index]))throw Error(`A different file already occupies ${path}.`);return occupied;}
        try{return await app.vault.createBinary(path,bytes.slice().buffer as ArrayBuffer);}catch(error){
          const raced=app.vault.getFileByPath(path);if(!raced)throw error;
          const before=new Uint8Array(await app.vault.readBinary(raced));if(before.length!==bytes.length||!before.every((value,index)=>value===bytes[index]))throw error;return raced;
        }
      })();tasks.set(path,task);
      void task.finally(()=>tasks!.delete(path)).catch(()=>{});
    }
    file=await task;
  }
  const link=app.fileManager.generateMarkdownLink(file,request.notePath,subpath,reference.label||'');
  return reference.image?`!${link}`:link;
}
