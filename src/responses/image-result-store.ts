import {sha256} from '@noble/hashes/sha2';
import {Buffer} from 'buffer/';
import {imageMime} from '../notes/images';
import {isRecord} from '../shared/values';
import type {ThreadAccess} from '../conversations/thread-stream';
import {imageResultKey,readImageResult,toolImageSources,MAX_IMAGE_BYTES,type ImageResultReference} from './image-results';

export interface ImageResultStorage {read(key:string):Promise<unknown>;write(key:string,value:unknown):Promise<void>}
export interface ImageResultBytes {bytes:ArrayBuffer;mimeType:string}
interface CachedImage extends ImageResultBytes {version:1;identity:string;hash:string}
const hash=(bytes:ArrayBuffer)=>Buffer.from(sha256(new Uint8Array(bytes))).toString('hex');
export const IMAGE_CACHE_MAX_ENTRIES=64,IMAGE_CACHE_MAX_BYTES=100*1024*1024;
export class ImageResultError extends Error {
  constructor(readonly code:'unavailable'|'connection'|'verification'|'invalid-url'|'download'|'image'|'decode'|'closed'){
    super({unavailable:'This T3 image reference is invalid.',connection:'Cannot load the image. Check your T3 connection and sign-in, then retry.',verification:'T3 could not verify this image.', 'invalid-url':'T3 returned an invalid image URL.',download:'The image could not be downloaded.',image:'The image is invalid, unsupported, or larger than 10 MiB.',decode:'The image could not be displayed. Retry to download it again.',closed:'The image viewer closed.'}[code]);
  }
}

/** Device-local bytes, never a signed URL. Limit network fills to two at once;
 * concurrent note panes share the same pending fill. */
export class ImageResultStore {
  private pending=new Map<string,Promise<ImageResultBytes>>();
  private rejected=new Set<string>();
  private active=0;private queue:Array<()=>void>=[];
  private writes=Promise.resolve();private stopped=false;
  constructor(private storage:ImageResultStorage,private access:(environmentId:string)=>Promise<ThreadAccess>,private download:(url:string)=>Promise<ImageResultBytes&{status:number}> ){}
  get(value:ImageResultReference):Promise<ImageResultBytes>{
    const reference=readImageResult(value);if(!reference||this.stopped)return Promise.reject(new ImageResultError('unavailable'));
    const key=imageResultKey(reference),pending=this.pending.get(key);if(pending)return pending;
    const work=this.load(reference,key).catch(error=>{throw error instanceof ImageResultError?error:new ImageResultError('connection');}).finally(()=>this.pending.delete(key));
    this.pending.set(key,work);return work;
  }
  private valid(bytes:unknown,mimeType:unknown):bytes is ArrayBuffer {
    if(!(bytes instanceof ArrayBuffer)||!bytes.byteLength||bytes.byteLength>MAX_IMAGE_BYTES)return false;
    try{return imageMime(new Uint8Array(bytes))===mimeType;}catch{return false;}
  }
  private async load(reference:ImageResultReference,key:string):Promise<ImageResultBytes>{
    const cached=await this.storage.read(key).catch(()=>undefined) as CachedImage|undefined;
    if(!this.rejected.has(key)&&cached?.version===1&&cached.identity===key&&this.valid(cached.bytes,cached.mimeType)&&cached.hash===hash(cached.bytes))return {bytes:cached.bytes,mimeType:cached.mimeType};
    if(this.active>=2)await new Promise<void>(resolve=>this.queue.push(resolve));
    else this.active++;
    if(this.stopped){this.release();throw new ImageResultError('closed');}
    let access:ThreadAccess|undefined;
    try{
      access=await this.access(reference.environmentId);
      const item=await access.api('/api/orchestration/turn-item',{threadId:reference.threadId,itemId:reference.itemId,...(reference.revision?{revision:reference.revision}:{})});
      if(!isRecord(item)||item.id!==reference.itemId||item.threadId!==reference.threadId||item.runId!==reference.runId||reference.revision&&item.updatedAt!==reference.revision||!toolImageSources(item).some(source=>JSON.stringify(source)===JSON.stringify(reference.source)))throw new ImageResultError('verification');
      const source=reference.source,resource=source.kind==='output'?{_tag:'tool-output-image',threadId:reference.threadId,itemId:reference.itemId,index:source.index}:{_tag:'media-file',threadId:reference.threadId,path:source.path};
      const signed=await access.api('/api/assets/create-url',{resource});
      if(!isRecord(signed)||typeof signed.relativeUrl!=='string'||!signed.relativeUrl.startsWith('/api/assets/')||signed.relativeUrl.includes('\\')||typeof signed.expiresAt!=='number'||!Number.isFinite(signed.expiresAt)||signed.expiresAt<=Date.now())throw new ImageResultError('invalid-url');
      let origin:URL,url:URL;
      try{origin=new URL(access.origin);url=new URL(signed.relativeUrl,origin);}catch{throw new ImageResultError('invalid-url');}
      if(url.origin!==origin.origin||!/^https?:$/.test(url.protocol)||!url.pathname.startsWith('/api/assets/')||url.username||url.password||url.hash)throw new ImageResultError('invalid-url');
      if(this.stopped)throw new ImageResultError('closed');
      const response=await this.download(url.href);
      if(response.status!==200)throw new ImageResultError('download');
      const mimeType=response.mimeType.split(';',1)[0].trim().toLowerCase();
      if(!this.valid(response.bytes,mimeType)||source.kind==='output'&&source.mimeType!==mimeType)throw new ImageResultError('image');
      if(this.stopped)throw new ImageResultError('closed');
      const page:CachedImage={version:1,identity:key,bytes:response.bytes,mimeType,hash:hash(response.bytes)};
      await this.save(key,page).catch(()=>{/* Verified bytes can display if local storage is full. */});
      return {bytes:response.bytes,mimeType};
    }finally{
      try{await access?.close?.();}catch{/* A close failure must not discard a verified image. */}
      this.release();
    }
  }
  private release(){const next=this.queue.shift();if(next)next();else this.active--;}
  /** A valid header cannot prove that a browser can decode all image bytes.
   * Serialize eviction after pending writes; retry waits for this operation. */
  invalidate(value:ImageResultReference):Promise<void>{
    const reference=readImageResult(value);if(!reference||this.stopped)return Promise.resolve();
    const key=imageResultKey(reference);this.rejected.add(key);
    while(this.rejected.size>IMAGE_CACHE_MAX_ENTRIES)this.rejected.delete(this.rejected.values().next().value!);
    const work=this.writes.catch(()=>{}).then(async()=>{
      if(this.stopped)return;
      await this.storage.write(key,null);
      const raw=await this.storage.read('index');
      if(Array.isArray(raw))await this.storage.write('index',(raw as unknown[]).filter(entry=>isRecord(entry)&&entry.key!==key));
    });
    this.writes=work;return work;
  }
  private save(key:string,page:CachedImage){
    const work=this.writes.catch(()=>{}).then(async()=>{
      if(this.stopped)return;
      const raw=await this.storage.read('index'),entries=Array.isArray(raw)?raw.filter((entry):entry is {key:string;bytes:number}=>isRecord(entry)&&typeof entry.key==='string'&&/^[a-f0-9]{64}$/.test(entry.key)&&entry.key!==key&&Number.isSafeInteger(entry.bytes)&&Number(entry.bytes)>0&&Number(entry.bytes)<=MAX_IMAGE_BYTES).slice(-IMAGE_CACHE_MAX_ENTRIES):[];
      entries.push({key,bytes:page.bytes.byteLength});let total=entries.reduce((sum,entry)=>sum+entry.bytes,0);
      const retired:string[]=[];while(entries.length>IMAGE_CACHE_MAX_ENTRIES||total>IMAGE_CACHE_MAX_BYTES){const first=entries.shift()!;total-=first.bytes;retired.push(first.key);}
      await this.storage.write(key,page);this.rejected.delete(key);await this.storage.write('index',entries);for(const old of retired)await this.storage.write(old,null);
    });
    this.writes=work;return work;
  }
  dispose(){this.stopped=true;this.rejected.clear();for(const resume of this.queue.splice(0))resume();}
}
