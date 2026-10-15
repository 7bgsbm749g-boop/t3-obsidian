import {contentHash} from './completion';
import {htmlRenderFromToolItem,htmlResultIdentity,htmlResultKey,HTML_RESULT_MAX_BYTES,readHtmlResult,type HtmlResultReference} from './html-results';
import type {ThreadAccess} from './thread-stream';

interface CachedPage {version:1;identity:string;html:string;hash:string;bytes:number}
export interface HtmlResultStorage {read(key:string):Promise<unknown>;write(key:string,value:unknown):Promise<void>}
export interface HtmlResultDownload {status:number;mimeType:string;bytes:ArrayBuffer}
export const HTML_CACHE_MAX_BYTES=100*1024*1024,HTML_CACHE_MAX_ENTRIES=64;

/** No credentials or expiring URLs enter notes, frames, or persistent storage.
 * Every network fill checks the exact canonical item before fetching bytes. */
export class HtmlResultStore {
  private pending=new Map<string,Promise<string>>();
  private warm=new Map<string,string>();private characters=0;
  private writes=Promise.resolve();private stopped=false;
  constructor(private storage:HtmlResultStorage,private access:(environmentId:string)=>Promise<ThreadAccess>,private download:(url:string)=>Promise<HtmlResultDownload>){}
  get(reference:HtmlResultReference):Promise<string>{
    const checked=readHtmlResult(reference);if(!checked||this.stopped)return Promise.reject(Error('The HTML result is unavailable.'));
    const key=htmlResultKey(checked),warm=this.warm.get(key);if(warm!==undefined){this.warm.delete(key);this.warm.set(key,warm);return Promise.resolve(warm);}
    const pending=this.pending.get(key);if(pending)return pending;
    const work=this.load(checked,key).then(html=>{
      if(this.stopped)throw Error('The HTML viewer closed.');
      if(html.length<=32_000_000){this.warm.set(key,html);this.characters+=html.length;while(this.warm.size>8||this.characters>32_000_000){const oldest=this.warm.keys().next().value!;this.characters-=this.warm.get(oldest)!.length;this.warm.delete(oldest);}}
      return html;
    }).finally(()=>{this.pending.delete(key);});this.pending.set(key,work);return work;
  }
  private async load(reference:HtmlResultReference,key:string):Promise<string>{
    const identity=htmlResultIdentity(reference),cached=await this.storage.read(key).catch(()=>undefined) as CachedPage|undefined;
    if(cached?.version===1&&cached.identity===identity&&typeof cached.html==='string'&&cached.html.length<=HTML_RESULT_MAX_BYTES&&cached.hash===contentHash(cached.html)&&new TextEncoder().encode(cached.html).byteLength<=HTML_RESULT_MAX_BYTES)return cached.html;
    const access=await this.access(reference.environmentId);
    try{
      const item=await access.api('/api/orchestration/turn-item',{threadId:reference.threadId,itemId:reference.itemId,...(reference.revision?{revision:reference.revision}:{})});
      const verified=htmlRenderFromToolItem(item);
      if(!verified||item.id!==reference.itemId||item.threadId!==reference.threadId||item.runId!==reference.runId||verified.attachmentId!==reference.attachmentId||reference.revision&&item.updatedAt!==reference.revision)throw Error('T3 could not verify this HTML result.');
      const signed=await access.api('/api/assets/create-url',{resource:{_tag:'attachment',attachmentId:verified.attachmentId,fileName:'result.html',mimeType:'text/html',disposition:'inline'}});
      const origin=new URL(access.origin),url=new URL(signed?.relativeUrl??'',origin);
      if(typeof signed?.relativeUrl!=='string'||!signed.relativeUrl.startsWith('/api/assets/')||!url.pathname.startsWith('/api/assets/')||signed.relativeUrl.includes('\\')||url.hash||url.origin!==origin.origin||url.username||url.password||!/^https?:$/.test(url.protocol)||!Number.isFinite(signed.expiresAt)||signed.expiresAt<=Date.now())throw Error('T3 returned an invalid HTML attachment URL.');
      const response=await this.download(url.href);
      if(response.status!==200||response.mimeType.split(';',1)[0].trim().toLowerCase()!=='text/html')throw Error('The HTML attachment could not be loaded.');
      if(!response.bytes.byteLength||response.bytes.byteLength>HTML_RESULT_MAX_BYTES)throw Error('The HTML attachment exceeds the size limit.');
      const html=new TextDecoder('utf-8',{fatal:true}).decode(response.bytes);
      if(this.stopped)throw Error('The HTML viewer closed.');
      await this.save(key,{version:1,identity,html,hash:contentHash(html),bytes:response.bytes.byteLength});
      return html;
    }finally{await access.close?.();}
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
