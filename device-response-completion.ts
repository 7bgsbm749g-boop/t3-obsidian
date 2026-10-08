import {contentHash} from './completion';
import {GeneratedNoteCoordinator,type GenerationJournal,type NoteGeneration,type GeneratedNoteIO} from './generated-note-coordinator';
import type {FinalResponseGrant,LeaseRecord} from './inline-lease';
import type {NativeCommitProof} from './native-response-commit';
import {deviceState} from './device-state';
import {openStateDatabase} from './local-state';
import {completedSelectionDraft} from './inline-steering';
import {hostedRequestHash} from './hosted-inline';

export interface DeviceGeneration extends NoteGeneration {deviceGrant:FinalResponseGrant}
export interface DeviceCompletionStore {
  read(id:string):Promise<DeviceGeneration|undefined>;
  write(id:string,record:DeviceGeneration):Promise<void>;
  retired?(id:string):Promise<{receipt:DeviceCompletionReceipt;proof?:NativeCommitProof}|undefined>;
  retire?(lease:LeaseRecord):Promise<void>;
  renameRetired?(before:string,after:string):Promise<void>;
}
export interface DeviceCompletionReceipt {version:1;id:string;actor:string;vaultId:string;notePath:string;commitId:string;hash:string;token:string;requestHash:string;at:number}
export const COMPLETED_DEVICE_PROOFS=32;
export const COMPLETED_DEVICE_PROOF_CHARACTERS=8_000_000;
export const COMPLETED_DEVICE_PROOF_AGE_MS=30*24*60*60*1000;
export interface DeviceCompletionNoteIO extends GeneratedNoteIO {recover?(path:string,expected:string,ids:string[]):Promise<void>}

/** Full private journals use IndexedDB, not Sync or localStorage's small quota.
 * Record and discovery index are committed in the same local transaction. */
export function deviceCompletionStore(actor:string,vaultId:string,now=()=>Date.now()){
  const prefix=`response-completion:${actor}:${vaultId}:`,indexKey=prefix+'index';
  const valid=(record:DeviceGeneration|undefined,id:string)=>{
    if(record&&(record.request.id!==id||record.request.vaultId!==vaultId||record.deviceGrant?.actor!==actor||record.request.deviceCompletion?.actor!==actor))throw Error('Invalid local completion identity.');
    return record;
  };
  const pruneProofs=async()=>{
    const db=await openStateDatabase();try{await new Promise<void>((resolve,reject)=>{const transaction=db.transaction('devices','readwrite'),objects=transaction.objectStore('devices'),index=objects.get(prefix+'proof-index');index.onsuccess=()=>{const entries:Array<{id:string;at:number}>=Array.isArray(index.result)?index.result:[];for(const entry of entries)if(entry.at<now()-COMPLETED_DEVICE_PROOF_AGE_MS)objects.delete(prefix+'proof:'+entry.id);objects.put(entries.filter(entry=>entry.at>=now()-COMPLETED_DEVICE_PROOF_AGE_MS),prefix+'proof-index');};transaction.oncomplete=()=>resolve();transaction.onabort=transaction.onerror=()=>reject(Error('Cannot prune expired completion proofs.'));});}finally{db.close();}
  };
  const store:DeviceCompletionStore={
    read:async id=>valid(await deviceState(prefix+id),id),
    write:async(id,record)=>{
      valid(record,id);const db=await openStateDatabase();
      try{await new Promise<void>((resolve,reject)=>{
        const transaction=db.transaction('devices','readwrite'),objects=transaction.objectStore('devices'),previous=objects.get(prefix+id),retired=objects.get(prefix+'retired:'+id),index=objects.get(indexKey);
        index.onsuccess=()=>{
          if(retired.result||(previous.result?.journalRevision??0)!==(record.journalRevision??0)-1){transaction.abort();return;}
          const ids=new Set<string>(Array.isArray(index.result)?index.result:[]);ids.add(id);objects.put([...ids],indexKey);objects.put(record,prefix+id);
        };
        transaction.oncomplete=()=>resolve();transaction.onabort=transaction.onerror=()=>reject(Error('Cannot save the local response completion.'));
      });}finally{db.close();}
    },
    retired:async id=>{const receipt=await deviceState(prefix+'retired:'+id) as DeviceCompletionReceipt|undefined;if(!receipt)return;if(receipt.version!==1||receipt.id!==id||receipt.actor!==actor||receipt.vaultId!==vaultId)throw Error('Invalid retired completion identity.');return {receipt,proof:receipt.at>=now()-COMPLETED_DEVICE_PROOF_AGE_MS?await deviceState(prefix+'proof:'+id) as NativeCommitProof|undefined:undefined};},
    retire:async lease=>{
      const id=lease.request.id,record=valid(await deviceState(prefix+id),id),delivery=lease.state?.delivery;
      if(!record||record.status!=='verified'||record.pendingRename||record.historyRemoval?.status==='pending'||!record.verified||!delivery||!lease.state?.cleanupComplete||lease.state.status==='conflict'||!delivery.observedBy.includes(actor)||record.verified.commitId!==delivery.commitId||record.verified.hash!==delivery.hash||record.deviceGrant.token!==lease.finalWriter?.token||hostedRequestHash(record.request)!==hostedRequestHash(lease.request))return;
      const coordinator=new GeneratedNoteCoordinator({read:async()=>undefined,append:async()=>{throw Error('Read-only materialization');}},{read:async()=>undefined,compareAndSet:async()=>false});
      const proof=coordinator.materialization(record),receipt:DeviceCompletionReceipt={version:1,id,actor,vaultId,notePath:lease.state.notePath,commitId:proof.commitId,hash:proof.hash,token:record.deviceGrant.token,requestHash:hostedRequestHash(record.request),at:now()},characters=JSON.stringify(proof).length;
      const db=await openStateDatabase();try{await new Promise<void>((resolve,reject)=>{
        const transaction=db.transaction('devices','readwrite'),objects=transaction.objectStore('devices'),previous=objects.get(prefix+id),existing=objects.get(prefix+'retired:'+id),proofIndex=objects.get(prefix+'proof-index'),index=objects.get(indexKey),receipts=objects.get(prefix+'retired-index');
        receipts.onsuccess=()=>{
          if(!previous.result&&existing.result?.commitId===receipt.commitId&&existing.result?.hash===receipt.hash&&existing.result?.token===receipt.token)return;
          if(previous.result?.journalRevision!==record.journalRevision){transaction.abort();return;}
          const ids=Array.isArray(index.result)?index.result:[];objects.put(ids.filter((value:string)=>value!==id),indexKey);
          const retiredIds=new Set<string>(Array.isArray(receipts.result)?receipts.result:[]);retiredIds.add(id);objects.put([...retiredIds],prefix+'retired-index');objects.put(receipt,prefix+'retired:'+id);objects.delete(prefix+id);
          const entries:Array<{id:string;characters:number;at:number}>=Array.isArray(proofIndex.result)?proofIndex.result.filter((entry:any)=>entry.id!==id):[];entries.push({id,characters,at:receipt.at});objects.put(proof,prefix+'proof:'+id);
          let count=entries.reduce((n,entry)=>n+entry.characters,0);
          while(entries.length&&(entries.length>COMPLETED_DEVICE_PROOFS||count>COMPLETED_DEVICE_PROOF_CHARACTERS||entries[0].at<now()-COMPLETED_DEVICE_PROOF_AGE_MS)){const entry=entries.shift()!;objects.delete(prefix+'proof:'+entry.id);count-=entry.characters;}
          objects.put(entries,prefix+'proof-index');
        };
        transaction.oncomplete=()=>resolve();transaction.onabort=transaction.onerror=()=>reject(Error('Cannot retire the acknowledged device completion.'));
      });}finally{db.close();}
    },
    renameRetired:async(before,after)=>{
      const db=await openStateDatabase();try{await new Promise<void>((resolve,reject)=>{
        const transaction=db.transaction('devices','readwrite'),objects=transaction.objectStore('devices'),index=objects.get(prefix+'retired-index');index.onsuccess=()=>{for(const id of index.result??[]){const request=objects.get(prefix+'retired:'+id);request.onsuccess=()=>{const receipt=request.result;if(receipt&&(receipt.notePath===before||receipt.notePath.startsWith(before+'/')))objects.put({...receipt,notePath:after+receipt.notePath.slice(before.length)},prefix+'retired:'+id);};}};transaction.oncomplete=()=>resolve();transaction.onabort=transaction.onerror=()=>reject(Error('Cannot rename completion identities.'));
      });}finally{db.close();}
    },
  };
  return {store,pruneProofs,candidates:async(offset:number,limit=16)=>{
    const ids=await deviceState(indexKey) as string[]|undefined,selected=(Array.isArray(ids)?ids:[]).slice(offset,offset+limit),records=[];
    for(const id of selected){const record=valid(await deviceState(prefix+id),id);if(record?.status==='verified')records.push({id,host:record.request.host});}
    return {records,next:offset+limit>=(ids?.length??0)?0:offset+limit};
  },restoreReceipts:async()=>{
    await pruneProofs();
    const ids=await deviceState(prefix+'retired-index') as string[]|undefined,records=[];
    for(const id of Array.isArray(ids)?ids:[]){const record=await store.retired!(id);if(record&&record.receipt.actor===actor&&record.receipt.vaultId===vaultId&&record.receipt.id===id)records.push(record);}
    return records;
  },restore:async()=>{
    const db=await openStateDatabase();
    try{return await new Promise<DeviceGeneration[]>((resolve,reject)=>{
      const transaction=db.transaction('devices','readonly'),objects=transaction.objectStore('devices'),index=objects.get(indexKey),records:DeviceGeneration[]=[];
      index.onsuccess=()=>{if(Array.isArray(index.result))for(const id of index.result.slice(-COMPLETED_DEVICE_PROOFS)){if(typeof id!=='string')continue;const request=objects.get(prefix+id);request.onsuccess=()=>{
        try{const record=valid(request.result,id);if(record?.status==='verified'&&record.verified)records.push(record);}catch{transaction.abort();}
      };}};
      transaction.oncomplete=()=>{let count=0;resolve(records.reverse().filter(record=>(count+=JSON.stringify(record).length)<=COMPLETED_DEVICE_PROOF_CHARACTERS));};transaction.onabort=transaction.onerror=()=>reject(Error('Cannot restore local response completions.'));
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
  constructor(private actor:string,private store:DeviceCompletionStore,private notes:DeviceCompletionNoteIO,private committed:(path:string,proof:NativeCommitProof)=>void,private conflict?:(record:NoteGeneration)=>void,private retired?:(receipt:DeviceCompletionReceipt)=>void){
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
  restoreReceipt(record:{receipt:DeviceCompletionReceipt;proof?:NativeCommitProof}){this.paths.set(record.receipt.id,record.receipt.notePath);if(record.proof)this.committed(record.receipt.notePath,record.proof);else this.retired?.(record.receipt);}
  acknowledged(lease:LeaseRecord){return this.store.retire?.(lease)??Promise.resolve();}
  async renamed(before:string,after:string){
    await this.store.renameRetired?.(before,after);
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
    const retired=await this.store.retired?.(request.id);
    if(retired){if(retired.receipt.token!==grant.token||retired.receipt.requestHash!==hostedRequestHash(request))throw Error('The completed response identity changed.');if(retired.proof)return retired.proof;throw Error('This response is already saved and acknowledged. Its recovery payload has been retired; no note write is permitted.');}
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
