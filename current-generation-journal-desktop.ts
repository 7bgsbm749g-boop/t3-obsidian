import {promises as fs} from 'node:fs';
import {join} from 'node:path';
import {randomUUID,createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {contentHash} from './completion';
import {DesktopGenerationJournal} from './generation-journal-desktop';
import {applyGenerationCheckpoint,type GenerationJournal,type NoteGeneration} from './generated-note-coordinator';
import type {HostedInlineState} from './hosted-inline';

const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
type Reference={path:Array<string|number>;hash:string};
type Event={index:number;event:string;at:string;previous:string|null};
type Head={version:2;id:string;index:number;previous:string|null;state:any;references:Reference[];events:Event[];hash:string;mac:string};
type VerifiedHead={head:Head;identities:Map<string,string>;characters:number};
type Hydrated={hash:string;state:NoteGeneration;characters:number};
type JournalOptions={now?:()=>number;maxHeads?:number;maxHeadCharacters?:number;maxStates?:number;maxStateCharacters?:number};
const identity=(stat:any)=>[stat.dev,stat.ino,stat.size,stat.mtimeNs,stat.ctimeNs,stat.mode].join(':');
function freeze<T>(value:T):T {if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
function characters(value:any):number {if(typeof value==='string')return value.length;if(value&&typeof value==='object')return Object.entries(value).reduce((total,[key,item])=>total+key.length+characters(item),0);return 0;}

/** One authenticated, atomic recovery head. Large repeated strings are stored
 * once by checksum. The old reader is used only to verify an initial migration;
 * old revisions are removed only after the new head is read back and audited. */
export class CurrentGenerationJournal implements GenerationJournal {
  private queues=new Map<string,Promise<unknown>>();
  private heads=new Map<string,VerifiedHead>();
  private states=new Map<string,Hydrated>();
  private headCharacters=0;
  private stateCharacters=0;
  private pending=new Set<string>();
  private retryAfter=new Map<string,number>();
  private maintenance?:Promise<void>;
  private discovery?:import('node:fs').Dir;
  private collectionCursors=new Map<string,{hash:string;phase:number;directory?:import('node:fs').Dir}>();
  private nextDiscovery=0;
  private stopped=false;
  private closing?:Promise<void>;
  private counters={headChecks:0,headParses:0,objectChecks:0,objectHashes:0,hydrations:0,mutableCopies:0,collections:0,maintenanceRecords:0,maintenanceFailures:0};
  private constructor(readonly root:string,private legacy:DesktopGenerationJournal,private key:Buffer,private options:JournalOptions){}
  static async open(root:string,vaultRoots:readonly string[],options:JournalOptions={}){
    const legacy=await DesktopGenerationJournal.open(root,vaultRoots);
    const keyPath=join(legacy.root,'.verified-prefix-key'),stat=await fs.lstat(keyPath);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==32||process.platform!=='win32'&&(stat.mode&0o077)!==0)throw Error('Invalid private recovery authentication key.');
    return new CurrentGenerationJournal(legacy.root,legacy,await fs.readFile(keyPath),options);
  }
  status(){return {...this.counters,heads:this.heads.size,headCharacters:this.headCharacters,states:this.states.size,stateCharacters:this.stateCharacters,pending:this.pending.size,cleanupCursors:this.collectionCursors.size,stopped:this.stopped};}
  private now(){return (this.options.now??Date.now)();}
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
  private forgetState(id:string){const old=this.states.get(id);if(old){this.stateCharacters-=old.characters;this.states.delete(id);}}
  private rememberHead(id:string,entry:VerifiedHead){
    const old=this.heads.get(id);if(old){this.headCharacters-=old.characters;this.heads.delete(id);}
    // A sequential cold scan must not evict every warm entry when history is
    // larger than the cache. Full recovery documents have a separate budget.
    if(!this.stopped&&this.heads.size<(this.options.maxHeads??1024)&&this.headCharacters+entry.characters<=(this.options.maxHeadCharacters??8_000_000)){
      this.heads.set(id,entry);this.headCharacters+=entry.characters;
    }
  }
  private async verifyObject(path:string,expected:string,before:string){
    this.counters.objectHashes++;
    const handle=await fs.open(path,'r');
    try{
      if(identity(await handle.stat({bigint:true}))!==before)throw Error('Recovery object changed during verification.');
      const hash=createHash('sha256'),buffer=Buffer.allocUnsafe(65_536);
      for(;;){const {bytesRead}=await handle.read(buffer,0,buffer.length,null);if(!bytesRead)break;hash.update(buffer.subarray(0,bytesRead));}
      if(hash.digest('hex')!==expected)throw Error('Recovery object integrity check failed.');
      if(identity(await handle.stat({bigint:true}))!==before||identity(await this.file(path))!==before)throw Error('Recovery object changed during verification.');
    }finally{await handle.close();}
  }
  /** Verify the authenticated manifest and fresh file identities, without
   * reconstructing any document. Even a cold maintenance scan stays small. */
  private async verifyHead(id:string):Promise<VerifiedHead|undefined>{
    this.counters.headChecks++;
    const directory=this.directory(id),path=join(directory,'current','state.json');let stat;
    for(const folder of [directory,join(directory,'current'),join(directory,'current','objects')])try{if(await fs.realpath(folder)!==folder)throw Error('Symlinked recovery storage.');}catch(error:any){if(error.code!=='ENOENT')throw error;}
    try{stat=await this.file(path);}catch(error:any){
      if(error.code!=='ENOENT')throw error;
      if(this.heads.has(id)||await fs.access(join(directory,'.current-format')).then(()=>true,()=>false))throw Error('The current recovery head is missing.');
      const state=await this.legacy.read(id);if(!state)return;
      // Persist exactly the verified state and predecessor index. Migration
      // does not invent a new generation or authorize a note write.
      return this.publish(id,state,'legacy-migrated',undefined,true);
    }
    const cached=this.heads.get(id),identities=new Map<string,string>([[path,identity(stat)]]);
    const unchanged=cached?.identities.get(path)===identity(stat);
    const head:Head=unchanged?cached!.head:JSON.parse(await fs.readFile(path,'utf8'));
    if(!unchanged){
      this.counters.headParses++;
      const {hash,mac,...body}=head,expected=createHmac('sha256',this.key).update(JSON.stringify({...body,hash})).digest();
      if(head.version!==2||head.id!==id||!Number.isSafeInteger(head.index)||head.index<0||!Array.isArray(head.references)||!Array.isArray(head.events)||head.events.length>64||! /^[a-f0-9]{64}$/.test(mac)||!timingSafeEqual(expected,Buffer.from(mac,'hex'))||hash!==contentHash(JSON.stringify(body)))throw Error('Current recovery integrity check failed.');
      if(identity(await this.file(path))!==identity(stat))throw Error('Recovery head changed during verification.');
    }
    if(cached&&(head.index<cached.head.index||head.index===cached.head.index&&head.hash!==cached.head.hash))throw Error('The verified recovery head was replaced.');
    const anchorPath=join(directory,'.current-format');
    try{
      const anchorIdentity=identity(await this.file(anchorPath));
      // Anchors are small; always authenticate the actual publication fence.
      const anchor=JSON.parse(await fs.readFile(anchorPath,'utf8')),{mac,...body}=anchor,expected=createHmac('sha256',this.key).update(JSON.stringify(body)).digest();
      if(anchor.version!==2||!Number.isSafeInteger(anchor.index)||anchor.index<0||! /^[a-f0-9]{64}$/.test(mac)||!timingSafeEqual(expected,Buffer.from(mac,'hex'))||head.index<anchor.index||head.index===anchor.index&&head.hash!==anchor.hash)throw Error('Recovery publication anchor integrity check failed.');
      if(identity(await this.file(anchorPath))!==anchorIdentity)throw Error('Recovery publication anchor changed during verification.');
      identities.set(anchorPath,anchorIdentity);
    }catch(error:any){if(error.code!=='ENOENT')throw error;if(cached?.identities.has(anchorPath))throw Error('The recovery publication anchor is missing.');}
    const slots=new Set<string>();
    for(const reference of head.references){
      if(! /^[a-f0-9]{64}$/.test(reference.hash)||!Array.isArray(reference.path)||!reference.path.length||reference.path.some(key=>typeof key!=='string'&&typeof key!=='number'))throw Error('Invalid recovery reference.');
      const slot=JSON.stringify(reference.path);if(slots.has(slot))throw Error('Invalid recovery reference slot.');slots.add(slot);
      let parent=head.state;for(const key of reference.path.slice(0,-1)){if(parent===null||typeof parent!=='object'||!Object.hasOwn(parent,key))throw Error('Invalid recovery reference path.');parent=parent[key];}
      const key=reference.path.at(-1)!;if(!parent||!Object.hasOwn(parent,key)||parent[key]!==null)throw Error('Invalid recovery reference slot.');
      const object=join(directory,'current','objects',reference.hash+'.blob');
      if(identities.has(object))continue;
      this.counters.objectChecks++;
      const stamp=identity(await this.file(object));identities.set(object,stamp);
      if(cached?.identities.get(object)!==stamp)await this.verifyObject(object,reference.hash,stamp);
    }
    const original=head.references.find(reference=>reference.path.length===1&&reference.path[0]==='original');
    if(head.state?.request?.id!==id||head.state.journalRevision!==head.index||head.state.originalHash!==(original?.hash??(typeof head.state.original==='string'?contentHash(head.state.original):undefined)))throw Error('Current recovery identity check failed.');
    if(identity(await this.file(path))!==identity(stat))throw Error('Recovery head changed during verification.');
    freeze(head);
    const entry={head,identities,characters:cached?.head===head?cached.characters:Number(stat.size)};
    this.rememberHead(id,entry);return entry;
  }
  private async hydrate(id:string,current:VerifiedHead):Promise<NoteGeneration>{
    const cached=this.states.get(id);if(cached?.hash===current.head.hash)return cached.state;
    this.forgetState(id);this.counters.hydrations++;
    const {head}=current,directory=this.directory(id),objects=new Map<string,string>();
    const state=structuredClone(head.state);
    for(const reference of head.references){
      let text=objects.get(reference.hash);if(text===undefined){const path=join(directory,'current','objects',reference.hash+'.blob');text=await fs.readFile(path,'utf8');if(contentHash(text)!==reference.hash||identity(await this.file(path))!==current.identities.get(path))throw Error('Recovery object integrity check failed.');objects.set(reference.hash,text);}
      let parent=state;for(const key of reference.path.slice(0,-1)){if(parent===null||typeof parent!=='object'||!Object.hasOwn(parent,key))throw Error('Invalid recovery reference path.');parent=parent[key];}
      const key=reference.path.at(-1)!;if(!parent||!Object.hasOwn(parent,key)||parent[key]!==null)throw Error('Invalid recovery reference slot.');parent[key]=text;
    }
    if(state.request?.id!==id||state.journalRevision!==head.index||state.originalHash!==contentHash(state.original))throw Error('Current recovery identity check failed.');
    const size=characters(state);freeze(state);
    if(!this.stopped&&this.states.size<(this.options.maxStates??32)&&this.stateCharacters+size<=(this.options.maxStateCharacters??8_000_000)){this.states.set(id,{hash:head.hash,state,characters:size});this.stateCharacters+=size;}
    return state;
  }
  private async audit(id:string):Promise<{state:NoteGeneration;head:Head}|undefined>{
    const current=await this.verifyHead(id);if(!current)return;
    const state=await this.hydrate(id,current);this.counters.mutableCopies++;
    return {state:structuredClone(state),head:current.head};
  }
  private async publish(id:string,state:NoteGeneration,event:string,previous?:Head,migration=false):Promise<VerifiedHead>{
    if(state.request.id!==id||state.originalHash!==contentHash(state.original))throw Error('Journal state identity or original checksum changed.');
    if(!migration&&state.journalRevision!==previous?.index)throw Error('The journal predecessor changed; reload before retrying.');
    const directory=this.directory(id),current=join(directory,'current'),objects=join(current,'objects');await this.safeDirectory(objects);
    const references:Reference[]=[],written=new Map<string,string>();
    const encode=(value:any,path:Array<string|number>):any=>{
      if(typeof value==='string'&&value.length>=4096){const hash=contentHash(value);written.set(hash,value);references.push({path,hash});return null;}
      if(Array.isArray(value))return value.map((item,index)=>encode(item,path.concat(index)));
      if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([,item])=>item!==undefined).map(([key,item])=>[key,encode(item,path.concat(key))]));return value;
    };
    const index=migration?state.journalRevision??0:(previous?.index??-1)+1,copy={...state,journalRevision:index};
    const encoded=encode(copy,[]);
    for(const [hash,text] of written){const path=join(objects,hash+'.blob');let existing:string|undefined;try{await this.file(path);existing=await fs.readFile(path,'utf8');}catch(error:any){if(error.code!=='ENOENT')throw error;}if(existing!==undefined&&existing!==text)throw Error('Recovery object integrity check failed.');if(existing===undefined)await this.durable(path,text);}
    const at=new Date().toISOString(),body={version:2 as const,id,index,previous:previous?.hash??null,state:encoded,references,events:[...(previous?.events??[]),{index,event,at,previous:previous?.hash??null}].slice(-64)},hash=contentHash(JSON.stringify(body));
    const head={...body,hash,mac:createHmac('sha256',this.key).update(JSON.stringify({...body,hash})).digest('hex')};
    await this.durable(join(current,'state.json'),JSON.stringify(head));this.forgetState(id);
    const audited=await this.verifyHead(id);if(audited?.head.hash!==hash)throw Error('Recovery publication readback failed.');
    const anchor={version:2,index,hash};await this.durable(join(directory,'.current-format'),JSON.stringify({...anchor,mac:createHmac('sha256',this.key).update(JSON.stringify(anchor)).digest('hex')}));state.journalRevision=index;
    this.legacy.forget(id);
    audited.identities.set(join(directory,'.current-format'),identity(await this.file(join(directory,'.current-format'))));
    this.requestMaintenance(id);return audited;
  }
  private async collect(id:string,head:Head){
    // A bounded maintenance slice; the current head already replaces the old
    // chain. Interrupted deletion can resume without depending on its tail.
    const directory=this.directory(id),objects=join(directory,'current','objects'),live=new Set(head.references.map(reference=>reference.hash+'.blob'));
    this.counters.collections++;
    let cursor=this.collectionCursors.get(id);
    if(cursor&&cursor.hash!==head.hash){await cursor.directory?.close();this.collectionCursors.delete(id);cursor=undefined;}
    if(!cursor){
      // Hold only a few directory handles. Queued records resume after an
      // existing slice finishes; a large history cannot grow this cache.
      if(this.collectionCursors.size>=8)return true;
      cursor={hash:head.hash,phase:0};this.collectionCursors.set(id,cursor);
    }
    const phases=[
      [directory,(name:string)=>/^\d{10}\.json$/.test(name)],
      [objects,(name:string)=>/^[a-f0-9]{64}\.blob$/.test(name)&&!live.has(name)||/\.[0-9a-f-]{36}\.tmp$/.test(name)],
      [join(directory,'current'),(name:string)=>/\.[0-9a-f-]{36}\.tmp$/.test(name)],
    ] as const;
    let visits=512;
    try{while(cursor.phase<phases.length){
      const [path,garbage]=phases[cursor.phase];
      cursor.directory??=await fs.opendir(path);
      for(;;){
        if(this.stopped)return false;
        const entry=await cursor.directory.read();
        if(!entry){await cursor.directory.close();cursor.directory=undefined;cursor.phase++;break;}
        if(garbage(entry.name)){await this.file(join(path,entry.name));await fs.unlink(join(path,entry.name));}
        if(--visits===0)return true;
      }
    }}catch(error){await cursor.directory?.close();this.collectionCursors.delete(id);throw error;}
    this.collectionCursors.delete(id);
    await fs.rm(join(directory,'.verified-prefix.cache'),{force:true});
    return false;
  }
  private async retireRemoved(id:string,current:VerifiedHead){
    const summary=current.head.state;if(summary.status!=='removed'||summary.pendingRename||summary.historyRemoval?.status==='pending'||summary.retiredOriginalHash!==undefined)return current;
    // The one transition that changes removed recovery bytes needs a mutable
    // state. Repeated maintenance of the tombstone never hydrates it again.
    this.counters.mutableCopies++;
    const record=structuredClone(await this.hydrate(id,current));
    record.retiredOriginalHash=record.originalHash;record.original='';record.originalHash=contentHash('');record.conflicts=[];record.acknowledgements=[];
    delete record.checkpoint;delete record.stagedDraft;delete record.staged;delete record.finalBody;delete record.attempt;delete record.verified;delete record.deviceProof;delete record.historyRemoval;delete record.pendingRename;
    return this.publish(record.request.id,record,'removed-recovery-retired',current.head);
  }
  private async retireSidecars(record:NoteGeneration){
    const directory=this.directory(record.request.id),path=join(directory,'staged.md');
    try{await this.file(path);const draft=await fs.readFile(path,'utf8');if([record.original,record.stagedDraft,record.staged].includes(draft))await fs.unlink(path);}catch(error:any){if(error.code!=='ENOENT')throw error;}
    const migration=join(directory,'migration-original.md');try{await this.file(migration);await fs.unlink(migration);}catch(error:any){if(error.code!=='ENOENT')throw error;}
  }
  read(id:string){return this.serial(id,async()=>{const current=await this.audit(id);return current?.state;});}
  append(id:string,state:NoteGeneration,event:string){return this.serial(id,async()=>{
    const previous=await this.verifyHead(id),prior=previous?await this.hydrate(id,previous):undefined;
    if(prior&&(prior.original!==state.original||JSON.stringify(prior.request)!==JSON.stringify(state.request)))throw Error('The original request and note snapshot are immutable.');
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
    else this.requestMaintenance(id);
  });}
  private requestMaintenance(id:string){if(!this.stopped){this.pending.add(id);this.retryAfter.delete(id);}}
  private async discover(){
    if(!this.discovery){if(this.now()<this.nextDiscovery)return;this.discovery=await fs.opendir(this.root);}
    // Keep the directory cursor between slices, not an array of every path.
    for(let visited=0,added=0;visited<64&&added<4&&!this.stopped;visited++){
      const entry=await this.discovery.read();
      if(!entry){await this.discovery.close();this.discovery=undefined;this.nextDiscovery=this.now()+30_000;break;}
      if(uuid.test(entry.name)){this.pending.add(entry.name);added++;}
    }
  }
  maintain(){
    if(this.stopped)return Promise.resolve();
    if(this.maintenance)return this.maintenance;
    const work=(async()=>{
      await this.discover();if(this.stopped)return;
      const batch:string[]=[];
      for(const id of this.pending){
        // Delivery, save and rename operations already in the queue take
        // priority; a slow record cannot block unrelated maintenance records.
        if(this.queues.has(id)||(this.retryAfter.get(id)??0)>this.now())continue;
        this.pending.delete(id);this.retryAfter.delete(id);batch.push(id);if(batch.length===4)break;
      }
      await Promise.all(batch.map(id=>this.serial(id,async()=>{
        if(this.stopped)return;this.counters.maintenanceRecords++;
        try{
          let current=await this.verifyHead(id);if(!current)return;
          if(this.stopped)return;current=await this.retireRemoved(id,current);
          if(!this.stopped&&await this.collect(id,current.head))this.requestMaintenance(id);
        }catch{
          this.counters.maintenanceFailures++;
          const cursor=this.collectionCursors.get(id);await cursor?.directory?.close().catch(()=>{});this.collectionCursors.delete(id);
          if(!this.stopped){this.pending.add(id);this.retryAfter.set(id,this.now()+30_000);}
        }
      })));
    })();
    this.maintenance=work;void work.finally(()=>{if(this.maintenance===work)this.maintenance=undefined;}).catch(()=>{});return work;
  }
  stop(){
    if(this.closing)return this.closing;this.stopped=true;this.pending.clear();this.retryAfter.clear();
    this.closing=(async()=>{await this.maintenance?.catch(()=>{});if(this.discovery){await this.discovery.close();this.discovery=undefined;}await Promise.all([...this.collectionCursors.values()].map(cursor=>cursor.directory?.close()));this.collectionCursors.clear();this.heads.clear();this.states.clear();this.headCharacters=0;this.stateCharacters=0;})();
    return this.closing;
  }
}
