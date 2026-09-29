// Desktop-only host storage. Hidden configuration files are reached directly
// through T3's authenticated file API, not transported by Obsidian Sync.
import {promises as fs} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import lockfile from 'proper-lockfile';
import type {App} from 'obsidian';
import {createHash} from 'node:crypto';
import {HostedInlineWriter,type HostedInlineRequest,type InlineFiles} from './hosted-inline';
import type {ThreadAccess} from './thread-stream';
import type {ReplyReference} from './reply-assets';
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
  const key=createHash('sha256').update(source).digest('hex').slice(0,16);
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

export function localInlineFiles(root:string,directory:string):InlineFiles&{requests():Promise<string[]>}{
  const base=resolve(root,directory);
  const full=(path:string)=>{
    if(!path.startsWith(directory+'/')||path.includes('\\')||path.split('/').some(p=>p==='..'||p==='.'))throw Error('Invalid hosted response storage path.');
    const result=resolve(root,path);if(!result.startsWith(base+require('node:path').sep))throw Error('Invalid hosted response storage path.');return result;
  };
  return {
    async read(path){try{return await fs.readFile(full(path),'utf8');}catch(error:any){if(error.code==='ENOENT')return undefined;throw error;}},
    async write(path,contents){const target=full(path);await fs.mkdir(dirname(target),{recursive:true});const temporary=target+'.'+require('node:crypto').randomUUID()+'.tmp';try{await fs.writeFile(temporary,contents,{mode:0o600});await fs.rename(temporary,target);}finally{await fs.rm(temporary,{force:true});}},
    async requests(){try{return (await fs.readdir(join(base,'requests'))).filter(p=>p.endsWith('.json')).map(p=>`${directory}/requests/${p}`);}catch(error:any){if(error.code==='ENOENT')return [];throw error;}},
  };
}

export class DesktopInlineHost {
  private writer:HostedInlineWriter;
  private work=new Set<Promise<void>>();
  private opening=new Map<string,Promise<ThreadAccess>>();
  private stopped=false;
  private accesses=new Map<string,{access:ThreadAccess;expires:number}>();
  private constructor(private release:()=>Promise<void>,app:App,identity:{vaultId:string;environmentId:string;workspaceRoot:string;directory:string},files:ReturnType<typeof localInlineFiles>,access:(environmentId:string)=>Promise<ThreadAccess>){
    this.writer=new HostedInlineWriter(identity,{
      ...files,
      access:async environmentId=>{
        const cached=this.accesses.get(environmentId);
        if(cached&&cached.expires>Date.now())return cached.access;
        const pending=this.opening.get(environmentId);if(pending)return pending;
        const work=(async()=>{
          this.accesses.delete(environmentId);await cached?.access.close?.();
          const fresh=await access(environmentId);this.accesses.set(environmentId,{access:fresh,expires:Date.now()+180_000});return fresh;
        })();
        this.opening.set(environmentId,work);
        try{return await work;}finally{this.opening.delete(environmentId);}
      },
      importReplyAsset:(reference,request,threadAccess)=>importReplyAsset(app,reference,request,threadAccess),
      updateNote:async(path,change)=>{
        const file=app.vault.getFileByPath(path);if(!file)return undefined;
        const current=await app.vault.read(file);
        const saved=(value:string)=>app.workspace.getLeavesOfType('markdown').every(leaf=>{const view=leaf.view as any;return view.file?.path!==path||!view.editor||view.editor.getValue()===value;});
        if(this.stopped||!saved(current))return undefined;
        const next=change(current);
        // Probes and unchanged progress must not touch mtime or wake Sync.
        if(next===current)return current;
        return app.vault.process(file,value=>{
          if(this.stopped||value!==current||!saved(value))throw Error('The note changed during the host update; retrying.');
          return next;
        });
      },
    });
  }
  static async open(app:App,identity:{vaultId:string;environmentId:string;workspaceRoot:string;directory:string},access:(environmentId:string)=>Promise<ThreadAccess>){
    const base=join(identity.workspaceRoot,identity.directory);await fs.mkdir(base,{recursive:true});
    let host:DesktopInlineHost|undefined;
    const release=await lockfile.lock(base,{realpath:true,stale:30_000,update:5000,onCompromised:()=>{host?.dispose();}});
    host=new DesktopInlineHost(release,app,identity,localInlineFiles(identity.workspaceRoot,identity.directory),access);return host;
  }
  tick(){if(this.stopped)return Promise.resolve();const work=this.writer.tick();this.work.add(work);void work.finally(()=>this.work.delete(work)).catch(()=>{});return work;}
  renamed(before:string,after:string){this.writer.renamed(before,after);}
  dispose(){if(this.stopped)return;this.stopped=true;this.writer.stop();void (async()=>{try{await Promise.allSettled([...this.work]);}catch{}finally{for(const {access} of this.accesses.values())await access.close?.();this.accesses.clear();await this.release();}})().catch(()=>{});}
}
