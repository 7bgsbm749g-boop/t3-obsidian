import {promises as fs} from 'node:fs';
import {join} from 'node:path';
import {randomUUID,createHmac,timingSafeEqual} from 'node:crypto';
import {contentHash} from './completion';
import {DesktopGenerationJournal} from './generation-journal-desktop';
import {applyGenerationCheckpoint,type GenerationJournal,type NoteGeneration} from './generated-note-coordinator';
import type {HostedInlineState} from './hosted-inline';

const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
type Reference={path:Array<string|number>;hash:string};
type Event={index:number;event:string;at:string;previous:string|null};
type Head={version:2;id:string;index:number;previous:string|null;state:any;references:Reference[];events:Event[];hash:string;mac:string};
const identity=(stat:any)=>[stat.dev,stat.ino,stat.size,stat.mtimeNs,stat.ctimeNs,stat.mode].join(':');

/** One authenticated, atomic recovery head. Large repeated strings are stored
 * once by checksum. The old reader is used only to verify an initial migration;
 * old revisions are removed only after the new head is read back and audited. */
export class CurrentGenerationJournal implements GenerationJournal {
  private queues=new Map<string,Promise<unknown>>();
  private cache=new Map<string,{state:NoteGeneration;head:Head;identities:Map<string,string>;characters:number}>();
  private maintenance?:Promise<void>;
  private cursor=0;
  private constructor(readonly root:string,private legacy:DesktopGenerationJournal,private key:Buffer){}
  static async open(root:string,vaultRoots:readonly string[]){
    const legacy=await DesktopGenerationJournal.open(root,vaultRoots);
    const keyPath=join(legacy.root,'.verified-prefix-key'),stat=await fs.lstat(keyPath);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==32||process.platform!=='win32'&&(stat.mode&0o077)!==0)throw Error('Invalid private recovery authentication key.');
    return new CurrentGenerationJournal(legacy.root,legacy,await fs.readFile(keyPath));
  }
  private directory(id:string){if(!uuid.test(id))throw Error('Invalid journal identity.');return join(this.root,id);}
  private async serial<T>(id:string,run:()=>Promise<T>){
    const work=(this.queues.get(id)??Promise.resolve()).catch(()=>{}).then(run);this.queues.set(id,work);
    try{return await work;}finally{if(this.queues.get(id)===work)this.queues.delete(id);}
  }
  private async safeDirectory(path:string){await fs.mkdir(path,{recursive:true,mode:0o700});if(await fs.realpath(path)!==path)throw Error('Symlinked recovery storage.');}
  private async durable(path:string,bytes:string){
    const temporary=path+'.'+randomUUID()+'.tmp';
    try{const file=await fs.open(temporary,'wx',0o600);try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}await fs.rename(temporary,path);await this.syncDirectory(path.slice(0,path.lastIndexOf(require('node:path').sep)));}
    finally{await fs.rm(temporary,{force:true});}
  }
  private async syncDirectory(path:string){if(process.platform==='win32')return;const directory=await fs.open(path,'r');try{await directory.sync();}finally{await directory.close();}}
  private async file(path:string){const stat=await fs.lstat(path,{bigint:true});if(!stat.isFile()||stat.isSymbolicLink())throw Error('Invalid recovery file.');return stat;}
  private remember(id:string,entry:{state:NoteGeneration;head:Head;identities:Map<string,string>;characters:number}){
    this.cache.delete(id);this.cache.set(id,entry);
    let characters=[...this.cache.values()].reduce((n,item)=>n+item.characters,0);
    while(this.cache.size>32||characters>8_000_000){const first=this.cache.keys().next().value!;characters-=this.cache.get(first)!.characters;this.cache.delete(first);}
  }
  private async audit(id:string):Promise<{state:NoteGeneration;head:Head}|undefined>{
    const directory=this.directory(id),path=join(directory,'current','state.json');let stat;
    for(const folder of [directory,join(directory,'current'),join(directory,'current','objects')])try{if(await fs.realpath(folder)!==folder)throw Error('Symlinked recovery storage.');}catch(error:any){if(error.code!=='ENOENT')throw error;}
    try{stat=await this.file(path);}catch(error:any){
      if(error.code!=='ENOENT')throw error;
      if(this.cache.has(id)||await fs.access(join(directory,'.current-format')).then(()=>true,()=>false))throw Error('The current recovery head is missing.');
      const state=await this.legacy.read(id);if(!state)return;
      // Persist exactly the verified state and predecessor index. Migration
      // does not invent a new generation or authorize a note write.
      await this.publish(id,state,'legacy-migrated',undefined,true);return this.audit(id);
    }
    const cached=this.cache.get(id),identities=new Map<string,string>([[path,identity(stat)]]);
    let unchanged=cached?.identities.get(path)===identity(stat);
    const bytes=unchanged?undefined:await fs.readFile(path,'utf8'),head:Head=unchanged?cached!.head:JSON.parse(bytes!);
    const {hash,mac,...body}=head,expected=createHmac('sha256',this.key).update(JSON.stringify({...body,hash})).digest();
    if(head.version!==2||head.id!==id||!Number.isSafeInteger(head.index)||head.index<0||!Array.isArray(head.references)||!Array.isArray(head.events)||head.events.length>64||! /^[a-f0-9]{64}$/.test(mac)||!timingSafeEqual(expected,Buffer.from(mac,'hex'))||hash!==contentHash(JSON.stringify(body)))throw Error('Current recovery integrity check failed.');
    if(cached&&(head.index<cached.head.index||head.index===cached.head.index&&head.hash!==cached.head.hash))throw Error('The verified recovery head was replaced.');
    try{const anchor=JSON.parse(await fs.readFile(join(directory,'.current-format'),'utf8')),{mac,...body}=anchor,expected=createHmac('sha256',this.key).update(JSON.stringify(body)).digest();if(anchor.version!==2||! /^[a-f0-9]{64}$/.test(mac)||!timingSafeEqual(expected,Buffer.from(mac,'hex'))||head.index<anchor.index||head.index===anchor.index&&head.hash!==anchor.hash)throw Error('Recovery publication anchor integrity check failed.');}catch(error:any){if(error.code!=='ENOENT')throw error;}
    const objects=new Map<string,string>();
    for(const reference of head.references){
      if(! /^[a-f0-9]{64}$/.test(reference.hash)||!Array.isArray(reference.path)||!reference.path.length||reference.path.some(key=>typeof key!=='string'&&typeof key!=='number'))throw Error('Invalid recovery reference.');
      const object=join(directory,'current','objects',reference.hash+'.blob');
      if(identities.has(object))continue;
      const stat=await this.file(object);identities.set(object,identity(stat));
      if(cached?.identities.get(object)!==identity(stat))unchanged=false;
    }
    if(unchanged)return {state:structuredClone(cached!.state),head};
    const state=structuredClone(head.state);
    for(const reference of head.references){
      let text=objects.get(reference.hash);if(text===undefined){text=await fs.readFile(join(directory,'current','objects',reference.hash+'.blob'),'utf8');if(contentHash(text)!==reference.hash)throw Error('Recovery object integrity check failed.');objects.set(reference.hash,text);}
      let parent=state;for(const key of reference.path.slice(0,-1)){if(parent===null||typeof parent!=='object'||!Object.hasOwn(parent,key))throw Error('Invalid recovery reference path.');parent=parent[key];}
      const key=reference.path.at(-1)!;if(!parent||!Object.hasOwn(parent,key)||parent[key]!==null)throw Error('Invalid recovery reference slot.');parent[key]=text;
    }
    if(state.request?.id!==id||state.journalRevision!==head.index||state.originalHash!==contentHash(state.original))throw Error('Current recovery identity check failed.');
    this.remember(id,{state,head,identities,characters:JSON.stringify(state).length});return {state:structuredClone(state),head};
  }
  private async publish(id:string,state:NoteGeneration,event:string,previous?:Head,migration=false){
    if(state.request.id!==id||state.originalHash!==contentHash(state.original))throw Error('Journal state identity or original checksum changed.');
    if(!migration&&state.journalRevision!==previous?.index)throw Error('The journal predecessor changed; reload before retrying.');
    const directory=this.directory(id),current=join(directory,'current'),objects=join(current,'objects');await this.safeDirectory(objects);
    const references:Reference[]=[],written=new Map<string,string>();
    const encode=(value:any,path:Array<string|number>):any=>{
      if(typeof value==='string'&&value.length>=4096){const hash=contentHash(value);written.set(hash,value);references.push({path,hash});return null;}
      if(Array.isArray(value))return value.map((item,index)=>encode(item,path.concat(index)));
      if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([,item])=>item!==undefined).map(([key,item])=>[key,encode(item,path.concat(key))]));return value;
    };
    const index=migration?state.journalRevision??0:(previous?.index??-1)+1,copy={...structuredClone(state),journalRevision:index};
    const encoded=encode(copy,[]);
    for(const [hash,text] of written){const path=join(objects,hash+'.blob');let existing:string|undefined;try{await this.file(path);existing=await fs.readFile(path,'utf8');}catch(error:any){if(error.code!=='ENOENT')throw error;}if(existing!==undefined&&existing!==text)throw Error('Recovery object integrity check failed.');if(existing===undefined)await this.durable(path,text);}
    const at=new Date().toISOString(),body={version:2 as const,id,index,previous:previous?.hash??null,state:encoded,references,events:[...(previous?.events??[]),{index,event,at,previous:previous?.hash??null}].slice(-64)},hash=contentHash(JSON.stringify(body));
    const head={...body,hash,mac:createHmac('sha256',this.key).update(JSON.stringify({...body,hash})).digest('hex')};
    await this.durable(join(current,'state.json'),JSON.stringify(head));this.cache.delete(id);
    const audited=await this.audit(id);if(audited?.head.hash!==hash)throw Error('Recovery publication readback failed.');
    const anchor={version:2,index,hash};await this.durable(join(directory,'.current-format'),JSON.stringify({...anchor,mac:createHmac('sha256',this.key).update(JSON.stringify(anchor)).digest('hex')}));state.journalRevision=index;
    this.legacy.forget(id);
    await this.collect(id,audited.head);
  }
  private async collect(id:string,head:Head){
    // A bounded maintenance slice; the current head already replaces the old
    // chain. Interrupted deletion can resume without depending on its tail.
    const directory=this.directory(id),objects=join(directory,'current','objects'),live=new Set(head.references.map(reference=>reference.hash+'.blob'));
    let budget=512;
    for(const name of await fs.readdir(directory))if(budget&&/^\d{10}\.json$/.test(name)){await this.file(join(directory,name));await fs.unlink(join(directory,name));budget--;}
    for(const name of await fs.readdir(objects))if(budget&&/^[a-f0-9]{64}\.blob$/.test(name)&&!live.has(name)){await this.file(join(objects,name));await fs.unlink(join(objects,name));budget--;}
    for(const path of [join(directory,'current'),objects])for(const name of await fs.readdir(path))if(budget&&/\.[0-9a-f-]{36}\.tmp$/.test(name)){await this.file(join(path,name));await fs.unlink(join(path,name));budget--;}
    await fs.rm(join(directory,'.verified-prefix.cache'),{force:true});
  }
  private async retireRemoved(current:{state:NoteGeneration;head:Head}){
    const record=current.state;if(record.status!=='removed'||record.pendingRename||record.historyRemoval?.status==='pending'||record.retiredOriginalHash!==undefined)return;
    record.retiredOriginalHash=record.originalHash;record.original='';record.originalHash=contentHash('');record.conflicts=[];record.acknowledgements=[];
    delete record.checkpoint;delete record.stagedDraft;delete record.staged;delete record.finalBody;delete record.attempt;delete record.verified;delete record.deviceProof;delete record.historyRemoval;delete record.pendingRename;
    await this.publish(record.request.id,record,'removed-recovery-retired',current.head);
  }
  private async retireSidecars(record:NoteGeneration){
    const directory=this.directory(record.request.id),path=join(directory,'staged.md');
    try{await this.file(path);const draft=await fs.readFile(path,'utf8');if([record.original,record.stagedDraft,record.staged].includes(draft))await fs.unlink(path);}catch(error:any){if(error.code!=='ENOENT')throw error;}
    const migration=join(directory,'migration-original.md');try{await this.file(migration);await fs.unlink(migration);}catch(error:any){if(error.code!=='ENOENT')throw error;}
  }
  read(id:string){return this.serial(id,async()=>{const current=await this.audit(id);return current?.state;});}
  append(id:string,state:NoteGeneration,event:string){return this.serial(id,async()=>{
    const previous=await this.audit(id);
    if(previous&&(previous.state.original!==state.original||JSON.stringify(previous.state.request)!==JSON.stringify(state.request)))throw Error('The original request and note snapshot are immutable.');
    await this.publish(id,state,event,previous?.head);
  });}
  checkpoint(id:string,sequence:number,state:HostedInlineState,notePath:string){return this.serial(id,async()=>{const current=await this.audit(id);if(!current)throw Error('Unknown response registration.');if(current.state.notePath===notePath&&applyGenerationCheckpoint(current.state,sequence,state))await this.publish(id,current.state,'checkpoint',current.head);return current.state;});}
  /** Clear settled conflict versions only after the exact committed result is
   * acknowledged. Original/proof data needed by repair/history remains useful. */
  settle(id:string,commitId:string,hash:string){return this.serial(id,async()=>{
    const current=await this.audit(id);if(!current)return;
    const record=current.state,proof=record.historyRemoval?.status==='verified'?record.historyRemoval.proof:record.verified;
    if(record.status!=='verified'||record.pendingRename||record.historyRemoval?.status==='pending'||proof?.commitId!==commitId||proof.hash!==hash||!record.acknowledgements.some(ack=>ack.commitId===commitId&&ack.hash===hash))return;
    await this.retireSidecars(record);
    if(record.conflicts.length||record.checkpoint||record.stagedDraft!==undefined){record.conflicts=[];delete record.checkpoint;delete record.stagedDraft;await this.publish(id,record,'settled-recovery-cleanup',current.head);}
    else await this.collect(id,current.head);
  });}
  maintain(){
    if(this.maintenance)return this.maintenance;
    const work=(async()=>{const ids=(await fs.readdir(this.root)).filter(name=>uuid.test(name));if(this.cursor>=ids.length)this.cursor=0;const batch=ids.slice(this.cursor,this.cursor+4);this.cursor+=batch.length;await Promise.allSettled(batch.map(id=>this.serial(id,async()=>{const current=await this.audit(id);if(current){await this.retireRemoved(current);const latest=await this.audit(id);if(latest)await this.collect(id,latest.head);}})));})();
    this.maintenance=work;void work.finally(()=>{if(this.maintenance===work)this.maintenance=undefined;}).catch(()=>{});return work;
  }
}
