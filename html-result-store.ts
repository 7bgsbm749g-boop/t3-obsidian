import {contentHash} from './completion';
import {htmlRenderFromToolItem,htmlResultIdentity,htmlResultKey,HTML_RESULT_MAX_BYTES,readHtmlResult,type HtmlResultReference} from './html-results';
import type {ThreadAccess} from './thread-stream';

interface CachedPage {version:1;identity:string;html:string;hash:string;bytes:number}
export interface HtmlResultStorage {read(key:string):Promise<unknown>;write(key:string,value:unknown):Promise<void>}
export interface HtmlResultDownload {status:number;mimeType:string;bytes:ArrayBuffer}
export const HTML_CACHE_MAX_BYTES=100*1024*1024,HTML_CACHE_MAX_ENTRIES=64;
export type HtmlResultFailureCode='unavailable'|'closed'|'sign-in'|'connection'|'verification'|'invalid-url'|'http'|'mime'|'size'|'encoding'|'cache-read'|'cache-write'|'close';
export type HtmlResultStage='reference'|'cache'|'access'|'verification'|'url'|'download'|'close';
export interface HtmlResultDiagnostic {code:HtmlResultFailureCode;stage:HtmlResultStage;status?:number}
export interface HtmlResultStoreOptions {
  /** Recognize the host's typed sign-in error without copying its message. */
  isSignInError?:(error:unknown)=>boolean;
  /** Safe classifications only: never URLs, response bodies, tokens or causes. */
  onDiagnostic?:(diagnostic:HtmlResultDiagnostic)=>void;
}
const messages:Record<HtmlResultFailureCode,string>={
  unavailable:'The HTML result is unavailable.',closed:'The HTML viewer closed.',
  'sign-in':'Sign in to T3 to load this page on this device.',
  connection:'Cannot connect to T3. Check your connection, then retry.',
  verification:'T3 could not verify this HTML result.',
  'invalid-url':'T3 returned an invalid HTML attachment URL.',
  http:'The HTML attachment could not be loaded.',mime:'The attachment is not an HTML page.',
  size:'The HTML attachment is empty or exceeds the size limit.',encoding:'The HTML attachment has invalid UTF-8 text.',
  'cache-read':'The device HTML cache could not be read.','cache-write':'The device HTML cache could not be saved.',close:'The HTML connection could not be closed.',
};
/** Only fixed public text and safe metadata survive a failed fetch. */
export class HtmlResultError extends Error implements HtmlResultDiagnostic {
  readonly name='HtmlResultError';
  constructor(readonly code:HtmlResultFailureCode,readonly stage:HtmlResultStage,readonly status?:number){super(messages[code]+(code==='http'&&status!==undefined?` (HTTP ${status})`:''));}
  get recoverable(){return this.code==='sign-in'||this.code==='connection'||this.code==='http';}
}

/** No credentials or expiring URLs enter notes, frames, or persistent storage.
 * Every network fill checks the exact canonical item before fetching bytes. */
export class HtmlResultStore {
  private pending=new Map<string,Promise<string>>();
  private warm=new Map<string,string>();private characters=0;
  private writes=Promise.resolve();private stopped=false;
  constructor(private storage:HtmlResultStorage,private access:(environmentId:string)=>Promise<ThreadAccess>,private download:(url:string)=>Promise<HtmlResultDownload>,private options:HtmlResultStoreOptions={}){}
  private diagnostic(diagnostic:HtmlResultDiagnostic){try{this.options.onDiagnostic?.({code:diagnostic.code,stage:diagnostic.stage,...(diagnostic.status!==undefined?{status:diagnostic.status}:{})});}catch{/* Diagnostics cannot block playback. */}}
  private failure(error:unknown,stage:HtmlResultStage):HtmlResultError {
    if(error instanceof HtmlResultError)return error;
    const rawStatus=(error as {status?:unknown}|null)?.status,status=typeof rawStatus==='number'&&Number.isInteger(rawStatus)&&rawStatus>=100&&rawStatus<=599?rawStatus:undefined;
    let signIn=false;try{signIn=this.options.isSignInError?.(error)===true;}catch{/* A host classifier cannot expose the original error. */}
    return new HtmlResultError(signIn||status===401?'sign-in':status!==undefined?'http':'connection',stage,status);
  }
  get(reference:HtmlResultReference):Promise<string>{
    const checked=readHtmlResult(reference);if(!checked||this.stopped)return Promise.reject(new HtmlResultError('unavailable','reference'));
    const key=htmlResultKey(checked),warm=this.warm.get(key);if(warm!==undefined){this.warm.delete(key);this.warm.set(key,warm);return Promise.resolve(warm);}
    const pending=this.pending.get(key);if(pending)return pending;
    const work=this.load(checked,key).then(html=>{
      if(this.stopped)throw new HtmlResultError('closed','reference');
      if(html.length<=32_000_000){this.warm.set(key,html);this.characters+=html.length;while(this.warm.size>16||this.characters>32_000_000){const oldest=this.warm.keys().next().value!;this.characters-=this.warm.get(oldest)!.length;this.warm.delete(oldest);}}
      return html;
    }).catch(error=>{const failure=this.failure(error,'access');this.diagnostic(failure);throw failure;}).finally(()=>{this.pending.delete(key);});this.pending.set(key,work);return work;
  }
  private async load(reference:HtmlResultReference,key:string):Promise<string>{
    const identity=htmlResultIdentity(reference),cached=await this.storage.read(key).catch(()=>{this.diagnostic({code:'cache-read',stage:'cache'});return undefined;}) as CachedPage|undefined;
    if(cached?.version===1&&cached.identity===identity&&typeof cached.html==='string'&&cached.html.length<=HTML_RESULT_MAX_BYTES&&cached.hash===contentHash(cached.html)&&new TextEncoder().encode(cached.html).byteLength<=HTML_RESULT_MAX_BYTES)return cached.html;
    if(this.stopped)throw new HtmlResultError('closed','reference');
    let stage:HtmlResultStage='access',access:ThreadAccess|undefined;
    try{
      access=await this.access(reference.environmentId);
      if(this.stopped)throw new HtmlResultError('closed','access');
      stage='verification';
      const item=await access.api('/api/orchestration/turn-item',{threadId:reference.threadId,itemId:reference.itemId,...(reference.revision?{revision:reference.revision}:{})});
      const verified=htmlRenderFromToolItem(item);
      if(!verified||item.id!==reference.itemId||item.threadId!==reference.threadId||item.runId!==reference.runId||verified.attachmentId!==reference.attachmentId||reference.revision&&item.updatedAt!==reference.revision)throw new HtmlResultError('verification',stage);
      stage='url';
      const signed=await access.api('/api/assets/create-url',{resource:{_tag:'attachment',attachmentId:verified.attachmentId,fileName:'result.html',mimeType:'text/html',disposition:'inline'}});
      let origin:URL,url:URL;
      try{origin=new URL(access.origin);url=new URL(signed?.relativeUrl??'',origin);}catch{throw new HtmlResultError('invalid-url',stage);}
      if(typeof signed?.relativeUrl!=='string'||!signed.relativeUrl.startsWith('/api/assets/')||!url.pathname.startsWith('/api/assets/')||signed.relativeUrl.includes('\\')||url.hash||url.origin!==origin.origin||url.username||url.password||!/^https?:$/.test(url.protocol)||!Number.isFinite(signed.expiresAt)||signed.expiresAt<=Date.now())throw new HtmlResultError('invalid-url',stage);
      stage='download';
      const response=await this.download(url.href);
      if(response.status!==200)throw this.failure({status:response.status},stage);
      if(response.mimeType.split(';',1)[0].trim().toLowerCase()!=='text/html')throw new HtmlResultError('mime',stage);
      if(!response.bytes.byteLength||response.bytes.byteLength>HTML_RESULT_MAX_BYTES)throw new HtmlResultError('size',stage);
      let html:string;try{html=new TextDecoder('utf-8',{fatal:true}).decode(response.bytes);}catch{throw new HtmlResultError('encoding',stage);}
      if(this.stopped)throw new HtmlResultError('closed',stage);
      await this.save(key,{version:1,identity,html,hash:contentHash(html),bytes:response.bytes.byteLength}).catch(()=>this.diagnostic({code:'cache-write',stage:'cache'}));
      return html;
    }catch(error){throw this.failure(error,stage);}
    finally{try{await access?.close?.();}catch{this.diagnostic({code:'close',stage:'close'});}}
  }
  private save(key:string,page:CachedPage):Promise<void>{
    const work=this.writes.catch(()=>{}).then(async()=>{
      if(this.stopped)return;
      const raw=await this.storage.read('index'),entries:Array<{key:string;bytes:number}>=Array.isArray(raw)?raw.filter(row=>row&&/^[a-f0-9]{64}$/.test(row.key)&&Number.isSafeInteger(row.bytes)&&row.bytes>0&&row.bytes<=HTML_RESULT_MAX_BYTES&&row.key!==key).slice(-HTML_CACHE_MAX_ENTRIES):[];
      entries.push({key,bytes:page.bytes});let total=entries.reduce((sum,row)=>sum+row.bytes,0);
      await this.storage.write(key,page);
      const retired:string[]=[];while(total>HTML_CACHE_MAX_BYTES||entries.length>HTML_CACHE_MAX_ENTRIES){const oldest=entries.shift()!;total-=oldest.bytes;retired.push(oldest.key);}
      await this.storage.write('index',entries);for(const old of retired)await this.storage.write(old,null);
    });
    this.writes=work;return work;
  }
  dispose(){this.stopped=true;this.warm.clear();this.characters=0;}
}
