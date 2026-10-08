import {contentHash} from './completion';
import {GeneratedNoteCoordinator,type GenerationJournal,type NoteGeneration,type GeneratedNoteIO} from './generated-note-coordinator';
import type {FinalResponseGrant,LeaseRecord} from './inline-lease';
import type {NativeCommitProof} from './native-response-commit';
import {deviceState} from './device-state';
import {openStateDatabase} from './local-state';
import {completedSelectionDraft} from './inline-steering';

export interface DeviceGeneration extends NoteGeneration {deviceGrant:FinalResponseGrant}
export interface DeviceCompletionStore {
  read(id:string):Promise<DeviceGeneration|undefined>;
  write(id:string,record:DeviceGeneration):Promise<void>;
}
export interface DeviceCompletionNoteIO extends GeneratedNoteIO {recover?(path:string,expected:string,ids:string[]):Promise<void>}

/** Full private journals use IndexedDB, not Sync or localStorage's small quota.
 * Record and discovery index are committed in the same local transaction. */
export function deviceCompletionStore(actor:string,vaultId:string){
  const prefix=`response-completion:${actor}:${vaultId}:`,indexKey=prefix+'index';
  const valid=(record:DeviceGeneration|undefined,id:string)=>{
    if(record&&(record.request.id!==id||record.request.vaultId!==vaultId||record.deviceGrant?.actor!==actor||record.request.deviceCompletion?.actor!==actor))throw Error('Invalid local completion identity.');
    return record;
  };
  const store:DeviceCompletionStore={
    read:async id=>valid(await deviceState(prefix+id),id),
    write:async(id,record)=>{
      valid(record,id);const db=await openStateDatabase();
      try{await new Promise<void>((resolve,reject)=>{
        const transaction=db.transaction('devices','readwrite'),objects=transaction.objectStore('devices'),previous=objects.get(prefix+id),index=objects.get(indexKey);
        index.onsuccess=()=>{
          if((previous.result?.journalRevision??0)!==(record.journalRevision??0)-1){transaction.abort();return;}
          const ids=new Set<string>(Array.isArray(index.result)?index.result:[]);ids.add(id);objects.put([...ids],indexKey);objects.put(record,prefix+id);
        };
        transaction.oncomplete=()=>resolve();transaction.onabort=transaction.onerror=()=>reject(Error('Cannot save the local response completion.'));
      });}finally{db.close();}
    },
  };
  return {store,restore:async()=>{
    const db=await openStateDatabase();
    try{return await new Promise<DeviceGeneration[]>((resolve,reject)=>{
      const transaction=db.transaction('devices','readonly'),objects=transaction.objectStore('devices'),index=objects.get(indexKey),records:DeviceGeneration[]=[];
      index.onsuccess=()=>{if(Array.isArray(index.result))for(const id of index.result){if(typeof id!=='string')continue;const request=objects.get(prefix+id);request.onsuccess=()=>{
        try{const record=valid(request.result,id);if(record?.status==='verified'&&record.verified)records.push(record);}catch{transaction.abort();}
      };}};
      transaction.oncomplete=()=>resolve(records);transaction.onabort=transaction.onerror=()=>reject(Error('Cannot restore local response completions.'));
    });}finally{db.close();}
  }};
}

/** The grant is permanent, including while a native save is slow. Every
 * intended mutation is durable before note IO. A verified result is reused
 * after reload; it is never restored over a later edit or intentional deletion. */
export class DeviceResponseCompletion {
  private grants=new Map<string,FinalResponseGrant>();
  private preparations=new Map<string,(proof:NativeCommitProof)=>Promise<void>>();
  private paths=new Map<string,string>();
  private reportedConflicts=new Map<string,string>();
  private coordinator:GeneratedNoteCoordinator;
  constructor(private actor:string,private store:DeviceCompletionStore,private notes:DeviceCompletionNoteIO,private committed:(path:string,proof:NativeCommitProof)=>void,private conflict?:(record:NoteGeneration)=>void){
    const journal:GenerationJournal={
      read:async id=>{const record=await store.read(id);if(record&&(record.deviceGrant.actor!==actor||contentHash(record.original)!==record.request.deviceCompletion?.originalHash))throw Error('A local completion belongs to another device or original.');return record;},
      append:async(id,record)=>{
        const previous=await store.read(id),grant=this.grants.get(id)??previous?.deviceGrant;
        if(!grant||grant.actor!==actor||previous&&JSON.stringify(previous.deviceGrant)!==JSON.stringify(grant))throw Error('The local final-write grant changed.');
        if(previous&&(previous.journalRevision??0)!==(record.journalRevision??0))throw Error('The local completion revision changed.');
        record.journalRevision=(previous?.journalRevision??0)+1;
        await store.write(id,{...structuredClone(record),deviceGrant:structuredClone(grant)});
        if(record.status==='commit-pending'&&record.attempt)await this.preparations.get(id)?.(this.intentProof(record));
      },
    };
    this.coordinator=new GeneratedNoteCoordinator(journal,notes);
  }
  restore(record:DeviceGeneration){this.paths.set(record.request.id,record.notePath);this.committed(record.notePath,this.coordinator.materialization(record));}
  async renamed(before:string,after:string){
    for(const [id,path] of this.paths){
      if(path!==before&&!path.startsWith(before+'/'))continue;
      const next=after+path.slice(before.length),record=await this.store.read(id);
      if(record&&record.notePath===path){await this.coordinator.renamed(id,path,next);await this.coordinator.settleRename(id);}
      this.paths.set(id,next);
    }
  }
  private intentProof(record:NoteGeneration){
    const attempt=record.attempt!;
    return this.coordinator.materialization({...record,status:'verified',verified:{commitId:attempt.id,hash:attempt.hash,document:attempt.expected}});
  }
  async complete(lease:LeaseRecord,original?:string,stagedDocument?:string,prepare?:(proof:NativeCommitProof)=>Promise<void>){
    const request=lease.request,grant=lease.finalWriter;
    if(!request.deviceCompletion||!grant||grant.actor!==this.actor||request.deviceCompletion.actor!==this.actor)throw Error('This device does not own the final response write.');
    this.grants.set(request.id,grant);
    if(prepare)this.preparations.set(request.id,prepare);
    let record=await this.store.read(request.id);
    if(record&&JSON.stringify(record.deviceGrant)!==JSON.stringify(grant))throw Error('The saved final-write grant changed.');
    if(!record){if(original===undefined||contentHash(original)!==request.deviceCompletion.originalHash)throw Error('The private completion original changed.');record=await this.coordinator.accept(request,original) as DeviceGeneration;}
    const reportedPath=lease.state?.notePath??request.notePath,knownPath=this.paths.get(request.id);
    const path=knownPath&&knownPath!==reportedPath&&await this.notes.read(reportedPath)===undefined?knownPath:reportedPath;
    this.paths.set(request.id,path);
    if(record.notePath!==path)record=await this.coordinator.renamed(request.id,record.notePath,path) as DeviceGeneration;
    if(record.staged===undefined){
      const staged=lease.state?.deviceStaged;
      if(staged&&staged.originalHash!==request.deviceCompletion.originalHash)throw Error('The staged original changed.');
      if(staged&&(stagedDocument===undefined||contentHash(stagedDocument)!==staged.hash))throw Error('The immutable staged completion changed.');
      const draft=completedSelectionDraft(staged?stagedDocument!:record.original,request.id,lease.state?.steering);
      await this.coordinator.result(request.id,draft,grant.body);
    }
    const pending=await this.store.read(request.id);
    if(pending?.status==='commit-pending'&&pending.attempt){await prepare?.(this.intentProof(pending));await this.notes.recover?.(path,pending.attempt.expected,[request.id]);}
    if(pending?.status==='conflict')await this.coordinator.recheckSeparatedConflict(request.id);
    const result=await this.coordinator.commit(request.id);
    if(result.status==='conflict'){
      const fingerprint=contentHash(JSON.stringify(result.conflicts.at(-1)));
      if(this.reportedConflicts.get(request.id)!==fingerprint){this.reportedConflicts.set(request.id,fingerprint);this.conflict?.(result);}
      return undefined;
    }
    if(result.status!=='verified'||!result.verified)return undefined;
    const proof=this.coordinator.materialization(result);
    this.reportedConflicts.delete(request.id);
    this.committed(path,proof);return proof;
  }
}
