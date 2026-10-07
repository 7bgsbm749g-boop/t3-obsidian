import {promises as fs} from 'node:fs';
import {basename,dirname,resolve,relative,isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';
import {contentHash} from './completion';
import type {GenerationJournal,NoteGeneration} from './generated-note-coordinator';

interface Revision {version:1;index:number;previous:string|null;event:string;at:string;state:NoteGeneration;hash:string}
type FileIdentity={dev:bigint;ino:bigint;size:bigint;mtimeNs:bigint;ctimeNs:bigint;mode:bigint};
type VerifiedFile={name:string;path:string;identity:FileIdentity};
type VerifiedPrefix={files:VerifiedFile[];hashes:string[];latest?:Revision};
const sameFile=(a:FileIdentity,b:FileIdentity)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs&&a.mode===b.mode;
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const inside=(root:string,path:string)=>{const part=relative(root,path);return !part||!isAbsolute(part)&&part!=='..'&&!part.startsWith('../');};
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
  private constructor(readonly root:string){}
  static async open(root:string,syncedVaultRoots:readonly string[]){
    if(!isAbsolute(root)||!syncedVaultRoots.length||syncedVaultRoots.some(path=>!isAbsolute(path)))throw Error('Explicit absolute private storage and vault roots are required.');
    const actual=await canonical(root),vaults=await Promise.all(syncedVaultRoots.map(canonical));
    if(vaults.some(vault=>inside(vault,actual)))throw Error('The response journal must be outside synced vaults.');
    await fs.mkdir(actual,{recursive:true,mode:0o700});
    if(await fs.realpath(actual)!==actual)throw Error('Journal location changed while opening.');
    return new DesktopGenerationJournal(actual);
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
    const paths=names.filter(name=>name.endsWith('.json')).sort(),cached=this.verified.get(id),prefix:VerifiedPrefix={files:[],hashes:[],latest:cached?.latest};
    if(cached&&paths.length<cached.hashes.length)throw Error('Journal revisions are missing.');
    for(const [index,name] of paths.entries()){
      const prior=cached?.files[index];
      if(name!==(prior?.name??`${String(index).padStart(10,'0')}.json`))throw Error('Journal revisions are missing or malformed.');
      const path=prior?.path??resolve(directory,name),stat=await fs.lstat(path,{bigint:true});if(!stat.isFile()||stat.isSymbolicLink())throw Error('Invalid journal revision file.');
      // Every file still gets a fresh nanosecond identity check. Reuse verified
      // path/identity records instead of rebuilding strings for the whole chain.
      if(prior&&sameFile(prior.identity,stat)){prefix.files.push(prior);prefix.hashes.push(cached!.hashes[index]);continue;}
      prefix.files.push({name,path,identity:{dev:stat.dev,ino:stat.ino,size:stat.size,mtimeNs:stat.mtimeNs,ctimeNs:stat.ctimeNs,mode:stat.mode}});
      const revision:Revision=JSON.parse(await fs.readFile(path,'utf8'));
      const {hash,...body}=revision;
      if(revision.version!==1||revision.index!==index||revision.state.journalRevision!==index||revision.previous!==(prefix.hashes.at(-1)??null)||hash!==contentHash(JSON.stringify(body))||revision.state.request.id!==id||revision.state.originalHash!==contentHash(revision.state.original)||cached?.hashes[index]!==undefined&&cached.hashes[index]!==hash)throw Error('Response journal integrity check failed.');
      prefix.hashes.push(hash);if(index===paths.length-1)prefix.latest=revision;
    }
    this.verified.set(id,prefix);return prefix;
  }
  async read(id:string){const state=(await this.revisions(id)).latest?.state;return state?structuredClone(state):undefined;}
  async append(id:string,state:NoteGeneration,event:string){
    const work=(this.queues.get(id)??Promise.resolve()).catch(()=>{}).then(async()=>{
      if(state.request.id!==id||state.originalHash!==contentHash(state.original))throw Error('Journal state identity or original checksum changed.');
      const revisions=await this.revisions(id),last=revisions.latest;
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
    });
    this.queues.set(id,work);try{await work;}finally{if(this.queues.get(id)===work)this.queues.delete(id);}
  }
}
