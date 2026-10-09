import {promises as fs} from 'node:fs';
import {basename,dirname,resolve,isAbsolute} from 'node:path';
import {randomUUID,randomBytes,createHmac,timingSafeEqual} from 'node:crypto';
import {contentHash} from './completion';
import {applyGenerationCheckpoint,type GenerationJournal,type NoteGeneration} from './generated-note-coordinator';
import type {HostedInlineState} from './hosted-inline';
import {isPathInsideDirectory} from './desktop-path';

interface Revision {version:1;index:number;previous:string|null;event:string;at:string;state:NoteGeneration;hash:string}
type FileIdentity={dev:bigint;ino:bigint;size:bigint;mtimeNs:bigint;ctimeNs:bigint;mode:bigint};
type VerifiedFile={name:string;path:string;identity:FileIdentity};
type VerifiedPrefix={files:VerifiedFile[];hashes:string[];latest?:Revision};
const sameFile=(a:FileIdentity,b:FileIdentity)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs&&a.mode===b.mode;
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
async function canonical(path:string):Promise<string>{
  try{return await fs.realpath(path);}catch(error:any){if(error.code!=='ENOENT')throw error;const parent=dirname(path);if(parent===path)throw error;return resolve(await canonical(parent),basename(path));}
}
/** Immutable hash-chained revisions in a private directory OUTSIDE every
 * synced vault. No data.json or plugin installation is touched. The enclosing
 * runtime must hold the existing host lock for its entire lifecycle. */
export class DesktopGenerationJournal implements GenerationJournal {
  private queues=new Map<string,Promise<unknown>>();
  private verified=new Map<string,VerifiedPrefix>();
  private audits=new Map<string,Promise<VerifiedPrefix>>();
  private auditing=0;
  private auditWaiters:Array<()=>void>=[];
  private prefixKey?:Buffer;
  private constructor(readonly root:string){}
  forget(id:string){this.verified.delete(id);}
  static async open(root:string,syncedVaultRoots:readonly string[]){
    if(!isAbsolute(root)||!syncedVaultRoots.length||syncedVaultRoots.some(path=>!isAbsolute(path)))throw Error('Explicit absolute private storage and vault roots are required.');
    const actual=await canonical(root),vaults=await Promise.all(syncedVaultRoots.map(canonical));
    if(vaults.some(vault=>isPathInsideDirectory(vault,actual)))throw Error('The response journal must be outside synced vaults.');
    await fs.mkdir(actual,{recursive:true,mode:0o700});
    if(await fs.realpath(actual)!==actual)throw Error('Journal location changed while opening.');
    const journal=new DesktopGenerationJournal(actual);
    await journal.openPrefixKey();return journal;
  }
  private async openPrefixKey(){
    // This device-local key authenticates derived fingerprints, not journals.
    // Keep it outside individual response directories and every synced vault.
    const path=resolve(this.root,'.verified-prefix-key');
    try{
      try{await fs.writeFile(path,randomBytes(32),{flag:'wx',mode:0o600});}catch(error:any){if(error.code!=='EEXIST')throw error;}
      const stat=await fs.lstat(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==32||process.platform!=='win32'&&(stat.mode&0o077)!==0)return;
      this.prefixKey=await fs.readFile(path);
    }catch{/* Derived caching is optional; full verification remains available. */}
  }
  private async loadPrefix(id:string,directory:string):Promise<VerifiedPrefix|undefined>{
    if(!this.prefixKey)return;
    try{
      const path=resolve(directory,'.verified-prefix.cache'),stat=await fs.lstat(path);
      if(!stat.isFile()||stat.isSymbolicLink()||stat.size>32_000_000)return;
      const {mac,...body}=JSON.parse(await fs.readFile(path,'utf8'));
      if(body.version!==1||body.id!==id||!Array.isArray(body.files)||typeof mac!=='string'||! /^[a-f0-9]{64}$/.test(mac))return;
      const expected=createHmac('sha256',this.prefixKey).update(JSON.stringify(body)).digest();
      if(!timingSafeEqual(expected,Buffer.from(mac,'hex')))return;
      const files:VerifiedFile[]=[],hashes:string[]=[];
      for(const [index,file] of body.files.entries()){
        if(file.name!==`${String(index).padStart(10,'0')}.json`||! /^[a-f0-9]{64}$/.test(file.hash))return;
        const identity={} as FileIdentity;
        for(const field of ['dev','ino','size','mtimeNs','ctimeNs','mode'] as const){const value=file.identity?.[field];if(typeof value!=='string'||! /^\d{1,24}$/.test(value))return;identity[field]=BigInt(value);}
        files.push({name:file.name,path:resolve(directory,file.name),identity});hashes.push(file.hash);
      }
      return {files,hashes};
    }catch{/* A missing or invalid index never substitutes for a full audit. */}
  }
  private async savePrefix(id:string,directory:string,prefix:VerifiedPrefix){
    if(!this.prefixKey||prefix.files.length>100_000)return;
    const temporary=resolve(directory,`.${randomUUID()}.cache.tmp`);
    try{
      const body={version:1,id,files:prefix.files.map((file,index)=>({name:file.name,hash:prefix.hashes[index],identity:Object.fromEntries(Object.entries(file.identity).map(([key,value])=>[key,String(value)]))}))};
      const mac=createHmac('sha256',this.prefixKey).update(JSON.stringify(body)).digest('hex');
      const bytes=JSON.stringify({...body,mac});if(Buffer.byteLength(bytes)>32_000_000)return;
      await fs.writeFile(temporary,bytes,{flag:'wx',mode:0o600});
      await fs.rename(temporary,resolve(directory,'.verified-prefix.cache'));
    }catch{/* Cache IO failure cannot change a verified journal result. */}
    finally{await fs.rm(temporary,{force:true}).catch(()=>{});}
  }
  private directory(id:string){if(!uuid.test(id))throw Error('Invalid journal identity.');return resolve(this.root,id);}
  private revisions(id:string):Promise<VerifiedPrefix>{
    const pending=this.audits.get(id);if(pending)return pending;
    const work=this.audit(id);this.audits.set(id,work);
    void work.finally(()=>{if(this.audits.get(id)===work)this.audits.delete(id);}).catch(()=>{});
    return work;
  }
  private async audit(id:string):Promise<VerifiedPrefix>{
    if(this.auditing>=4)await new Promise<void>(resolve=>this.auditWaiters.push(resolve));
    else this.auditing++;
    try{return await this.verifyRevisions(id);}finally{const next=this.auditWaiters.shift();if(next)next();else this.auditing--;}
  }
  private async verifyRevisions(id:string):Promise<VerifiedPrefix>{
    const directory=this.directory(id);let names:string[];
    try{names=await fs.readdir(directory);}catch(error:any){if(error.code==='ENOENT'){if(this.verified.get(id)?.hashes.length)throw Error('Journal revisions are missing.');return {files:[],hashes:[]};}throw error;}
    if(await fs.realpath(directory)!==directory)throw Error('Symlinked journal registration.');
    const paths=names.filter(name=>name.endsWith('.json')).sort(),cached=this.verified.get(id)??await this.loadPrefix(id,directory),prefix:VerifiedPrefix={files:[],hashes:[],latest:cached?.latest};
    if(cached&&paths.length<cached.hashes.length)throw Error('Journal revisions are missing.');
    for(const [index,name] of paths.entries()){
      const prior=cached?.files[index];
      if(name!==(prior?.name??`${String(index).padStart(10,'0')}.json`))throw Error('Journal revisions are missing or malformed.');
      const path=prior?.path??resolve(directory,name),stat=await fs.lstat(path,{bigint:true});if(!stat.isFile()||stat.isSymbolicLink())throw Error('Invalid journal revision file.');
      // Every file still gets a fresh nanosecond identity check. Reuse verified
      // path/identity records instead of rebuilding strings for the whole chain.
      if(prior&&sameFile(prior.identity,stat)&&(prefix.latest||index<paths.length-1)){prefix.files.push(prior);prefix.hashes.push(cached!.hashes[index]);continue;}
      prefix.files.push({name,path,identity:{dev:stat.dev,ino:stat.ino,size:stat.size,mtimeNs:stat.mtimeNs,ctimeNs:stat.ctimeNs,mode:stat.mode}});
      const revision:Revision=JSON.parse(await fs.readFile(path,'utf8'));
      const {hash,...body}=revision;
      if(revision.version!==1||revision.index!==index||revision.state.journalRevision!==index||revision.previous!==(prefix.hashes.at(-1)??null)||hash!==contentHash(JSON.stringify(body))||revision.state.request.id!==id||revision.state.originalHash!==contentHash(revision.state.original)||cached?.hashes[index]!==undefined&&cached.hashes[index]!==hash)throw Error('Response journal integrity check failed.');
      prefix.hashes.push(hash);if(index===paths.length-1)prefix.latest=revision;
    }
    this.verified.set(id,prefix);
    if(!cached||prefix.files.length!==cached.files.length||prefix.files.some((file,index)=>!sameFile(file.identity,cached.files[index].identity)))await this.savePrefix(id,directory,prefix);
    return prefix;
  }
  async read(id:string){const state=(await this.revisions(id)).latest?.state;return state?structuredClone(state):undefined;}
  private async queued<T>(id:string,run:()=>Promise<T>):Promise<T>{
    const work=(this.queues.get(id)??Promise.resolve()).catch(()=>{}).then(run);
    this.queues.set(id,work);try{return await work;}finally{if(this.queues.get(id)===work)this.queues.delete(id);}
  }
  async checkpoint(id:string,sequence:number,state:HostedInlineState,notePath?:string){
    return this.queued(id,async()=>{
      // Derive only private checkpoint fields from this freshly audited head.
      // No cached time window and no asynchronous note mutation is involved.
      const revisions=await this.revisions(id),record=revisions.latest?structuredClone(revisions.latest.state):undefined;
      if(!record)throw Error('Unknown response registration.');
      if(notePath!==undefined&&record.notePath!==notePath)return record;
      if(applyGenerationCheckpoint(record,sequence,state))await this.publish(id,record,'checkpoint',revisions);
      return record;
    });
  }
  async append(id:string,state:NoteGeneration,event:string){
    return this.queued(id,async()=>{
      if(state.request.id!==id||state.originalHash!==contentHash(state.original))throw Error('Journal state identity or original checksum changed.');
      await this.publish(id,state,event,await this.revisions(id));
    });
  }
  private async publish(id:string,state:NoteGeneration,event:string,revisions:VerifiedPrefix){
      const last=revisions.latest;
      if(state.journalRevision!==last?.index)throw Error('The journal predecessor changed; reload before retrying.');
      if(last&&(last.state.original!==state.original||JSON.stringify(last.state.request)!==JSON.stringify(state.request)))throw Error('The original request and note snapshot are immutable.');
      const directory=this.directory(id);await fs.mkdir(directory,{recursive:true,mode:0o700});
      if(await fs.realpath(directory)!==directory)throw Error('Symlinked journal registration.');
      const body={version:1 as const,index:revisions.hashes.length,previous:last?.hash??null,event,at:new Date().toISOString(),state:{...state,journalRevision:revisions.hashes.length}};
      const value=JSON.stringify({...body,hash:contentHash(JSON.stringify(body))});
      const target=resolve(directory,`${String(body.index).padStart(10,'0')}.json`),temporary=resolve(directory,`.${randomUUID()}.tmp`);
      const handle=await fs.open(temporary,'wx',0o600);
      try{await handle.writeFile(value,'utf8');await handle.sync();}finally{await handle.close();}
      try{
        // link is an atomic exclusive publication: no existing revision can
        // ever be replaced, including by a second mistaken host instance.
        await fs.link(temporary,target);
        const parent=await fs.open(directory,'r');try{await parent.sync();}finally{await parent.close();}
        state.journalRevision=body.index;
      }finally{await fs.rm(temporary,{force:true});}
  }
}
