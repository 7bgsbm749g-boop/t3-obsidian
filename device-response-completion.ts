import {contentHash} from './completion';
import {GeneratedNoteCoordinator,type GenerationJournal,type NoteGeneration,type GeneratedNoteIO} from './generated-note-coordinator';
import type {FinalResponseGrant,LeaseRecord} from './inline-lease';
import type {NativeCommitProof} from './native-response-commit';
import {deviceState} from './device-state';
import {openStateDatabase} from './local-state';
import {completedSelectionDraft} from './inline-steering';
import {hostedRequestHash} from './hosted-inline';
import type {FinalAttemptAbort} from './completion-attempt';

export interface DeviceGeneration extends NoteGeneration {deviceGrant:FinalResponseGrant}
export interface DeviceCompletionStore {
  read(id:string):Promise<DeviceGeneration|undefined>;
  write(id:string,record:DeviceGeneration):Promise<void>;
  retired?(id:string):Promise<{receipt:DeviceCompletionReceipt;proof?:NativeCommitProof}|undefined>;
  retire?(lease:LeaseRecord):Promise<void>;
  renameRetired?(before:string,after:string):Promise<void>;
}
export interface DeviceCompletionReceipt {version:1;id:string;actor:string;vaultId:string;notePath:string;commitId:string;hash:string;token:string;requestHash:string;at:number}
export interface DeviceCompletionPhase {id:string;host:DeviceGeneration['request']['host'];notePath:string;status:DeviceGeneration['status'];journalRevision:number;attemptPhase?:string;hash?:string;at:number}
export const COMPLETED_DEVICE_PROOFS=32;
export const COMPLETED_DEVICE_PROOF_CHARACTERS=8_000_000;
export const COMPLETED_DEVICE_PROOF_AGE_MS=30*24*60*60*1000;
/** Keep recovery inputs once, rather than repeating the complete original and
 * proposed note in every historical conflict snapshot. */
function compactCompletion(record:DeviceGeneration){
  const conflicts=record.conflicts.length>2?[record.conflicts[0],record.conflicts.at(-1)!]:record.conflicts;
  return {...record,conflicts:conflicts.map(conflict=>{
    const proposedFrom=conflict.proposed!==undefined?(conflict.proposed===record.attempt?.expected?'attempt':conflict.proposed===record.staged?'staged':undefined):undefined;
    return {...conflict,...(conflict.original===record.original?{original:undefined}:{}),...(proposedFrom?{proposed:undefined,proposedFrom}:{})};
  })};
}
function expandCompletion(record:DeviceGeneration){
  const conflicts=(record.conflicts.length>2?[record.conflicts[0],record.conflicts.at(-1)!]:record.conflicts).map((conflict:any)=>{
    const {proposedFrom,...rest}=conflict;return {...rest,original:conflict.original??record.original,...(proposedFrom?{proposed:proposedFrom==='attempt'?record.attempt?.expected:record.staged}:{})};
  });return {...record,conflicts};
}
export interface DeviceCompletionNoteIO extends GeneratedNoteIO {
  recover?(path:string,expected:string,ids:string[]):Promise<void>;
  reviewRead?(path:string):Promise<string|undefined>;
  resumeReviewed?(path:string,currentHash:string):Promise<void>;
}

/** Full private journals use IndexedDB, not Sync or localStorage's small quota.
 * Record and discovery index are committed in the same local transaction. */
export function deviceCompletionStore(actor:string,vaultId:string,now=()=>Date.now()){
  const prefix=`response-completion:${actor}:${vaultId}:`,indexKey=prefix+'index',phaseKey=prefix+'phase-index';
  let conflictCursor=0;
  const phase=(record:DeviceGeneration):DeviceCompletionPhase=>({id:record.request.id,host:record.request.host,notePath:record.notePath,status:record.status,journalRevision:record.journalRevision??0,attemptPhase:record.attempt?.superseding?'superseding':record.attempt?.writeState??(record.attempt?'unknown':undefined),hash:record.attempt?.hash??record.verified?.hash,at:now()});
  const valid=(record:DeviceGeneration|undefined,id:string)=>{
    if(record&&(record.request.id!==id||record.request.vaultId!==vaultId||record.deviceGrant?.actor!==actor||record.request.deviceCompletion?.actor!==actor))throw Error('Invalid local completion identity.');
    return record&&expandCompletion(record);
  };
  const pruneProofs=async()=>{
    const db=await openStateDatabase();try{await new Promise<void>((resolve,reject)=>{const transaction=db.transaction('devices','readwrite'),objects=transaction.objectStore('devices'),index=objects.get(prefix+'proof-index');index.onsuccess=()=>{const entries:Array<{id:string;at:number}>=Array.isArray(index.result)?index.result:[];for(const entry of entries)if(entry.at<now()-COMPLETED_DEVICE_PROOF_AGE_MS)objects.delete(prefix+'proof:'+entry.id);objects.put(entries.filter(entry=>entry.at>=now()-COMPLETED_DEVICE_PROOF_AGE_MS),prefix+'proof-index');};transaction.oncomplete=()=>resolve();transaction.onabort=transaction.onerror=()=>reject(Error('Cannot prune expired completion proofs.'));});}finally{db.close();}
    const ids=await deviceState(indexKey) as string[]|undefined,phases=await deviceState(phaseKey) as Record<string,DeviceCompletionPhase>|undefined;
    const conflicts=(ids??[]).filter(id=>!phases?.[id]||phases[id].status==='conflict'),selected=conflicts.slice(conflictCursor,conflictCursor+8);
    conflictCursor=conflictCursor+8>=conflicts.length?0:conflictCursor+8;
    if(!selected.length)return;
    const compactDb=await openStateDatabase();try{await new Promise<void>((resolve,reject)=>{
      const transaction=compactDb.transaction('devices','readwrite'),objects=transaction.objectStore('devices');
      for(const id of selected){const request=objects.get(prefix+id);request.onsuccess=()=>{const record=request.result;if(!record)return;const before=JSON.stringify(record),compact=compactCompletion(valid(record,id)!);if(JSON.stringify(compact)!==before)objects.put(compact,prefix+id);};}
      transaction.oncomplete=()=>resolve();transaction.onabort=transaction.onerror=()=>reject(Error('Cannot compact retained completion conflicts.'));
    });}finally{compactDb.close();}
  };
  const store:DeviceCompletionStore={
    read:async id=>valid(await deviceState(prefix+id),id),
    write:async(id,record)=>{
      valid(record,id);const db=await openStateDatabase();
      try{await new Promise<void>((resolve,reject)=>{
        const transaction=db.transaction('devices','readwrite'),objects=transaction.objectStore('devices'),previous=objects.get(prefix+id),retired=objects.get(prefix+'retired:'+id),phases=objects.get(phaseKey),index=objects.get(indexKey);
        index.onsuccess=()=>{
          if(retired.result||(previous.result?.journalRevision??0)!==(record.journalRevision??0)-1){transaction.abort();return;}
          const ids=new Set<string>(Array.isArray(index.result)?index.result:[]);ids.add(id);objects.put([...ids],indexKey);objects.put(compactCompletion(record),prefix+id);objects.put({...phases.result??{},[id]:phase(record)},phaseKey);
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
        const transaction=db.transaction('devices','readwrite'),objects=transaction.objectStore('devices'),previous=objects.get(prefix+id),existing=objects.get(prefix+'retired:'+id),proofIndex=objects.get(prefix+'proof-index'),phases=objects.get(phaseKey),index=objects.get(indexKey),receipts=objects.get(prefix+'retired-index');
        receipts.onsuccess=()=>{
          if(!previous.result&&existing.result?.commitId===receipt.commitId&&existing.result?.hash===receipt.hash&&existing.result?.token===receipt.token)return;
          if(previous.result?.journalRevision!==record.journalRevision){transaction.abort();return;}
          const ids=Array.isArray(index.result)?index.result:[];objects.put(ids.filter((value:string)=>value!==id),indexKey);
          const nextPhases={...phases.result??{}};delete nextPhases[id];objects.put(nextPhases,phaseKey);
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
    const ids=await deviceState(indexKey) as string[]|undefined,selected=(Array.isArray(ids)?ids:[]).slice(offset,offset+limit),phases=await deviceState(phaseKey) as Record<string,DeviceCompletionPhase>|undefined,records:DeviceCompletionPhase[]=[],legacy:DeviceGeneration[]=[];
    for(const id of selected){let metadata=phases?.[id];if(!metadata){const record=valid(await deviceState(prefix+id),id);if(record){metadata=phase(record);legacy.push(record);}}if(metadata&&metadata.status!=='removed')records.push(metadata);}
    if(legacy.length){const db=await openStateDatabase();try{await new Promise<void>((resolve,reject)=>{
      const transaction=db.transaction('devices','readwrite'),objects=transaction.objectStore('devices'),current=objects.get(phaseKey),requests=legacy.map(record=>({record,request:objects.get(prefix+record.request.id)}));
      requests.at(-1)!.request.onsuccess=()=>{const next={...current.result??{}};for(const {record,request} of requests)if(request.result?.journalRevision===record.journalRevision)next[record.request.id]=phase(record);objects.put(next,phaseKey);};
      transaction.oncomplete=()=>resolve();transaction.onabort=transaction.onerror=()=>reject(Error('Cannot migrate completion phase metadata.'));
    });}finally{db.close();}}
    return {records,next:offset+limit>=(ids?.length??0)?0:offset+limit};
  },restorePending:async(offset=0,limit=16)=>{
    const ids=await deviceState(indexKey) as string[]|undefined,selected=(Array.isArray(ids)?ids:[]).slice(offset,offset+limit),records:DeviceGeneration[]=[];let consumed=0,characters=0;
    for(const id of selected){const record=valid(await deviceState(prefix+id),id);if(record&&!['verified','removed'].includes(record.status)){
      const size=JSON.stringify(record).length;if(records.length&&characters+size>COMPLETED_DEVICE_PROOF_CHARACTERS)break;
      records.push(record);characters+=size;
    }consumed++;}
    return {records,next:offset+consumed>=(ids?.length??0)?0:offset+consumed};
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
  private waitingForEdits=new Set<string>();
  private coordinator:GeneratedNoteCoordinator;
  constructor(private actor:string,private store:DeviceCompletionStore,private notes:DeviceCompletionNoteIO,private committed:(path:string,proof:NativeCommitProof)=>void,private conflict?:(record:NoteGeneration)=>void,private retired?:(receipt:DeviceCompletionReceipt)=>void){
    const journal:GenerationJournal={
      read:async id=>{const record=await store.read(id);if(record&&(record.deviceGrant.actor!==actor||contentHash(record.original)!==record.request.deviceCompletion?.originalHash))throw Error('A local completion belongs to another device or original.');return record;},
      append:async(id,record,event)=>{
        const previous=await store.read(id),grant=this.grants.get(id)??previous?.deviceGrant;
        if(!grant||grant.actor!==actor||previous&&JSON.stringify(previous.deviceGrant)!==JSON.stringify(grant))throw Error('The local final-write grant changed.');
        if(previous&&(previous.journalRevision??0)!==(record.journalRevision??0))throw Error('The local completion revision changed.');
        record.journalRevision=(previous?.journalRevision??0)+1;
        await store.write(id,{...structuredClone(record),deviceGrant:structuredClone(grant)});
        if(event==='commit-pending'&&record.attempt)await this.preparations.get(id)?.(this.intentProof(record));
      },
    };
    this.coordinator=new GeneratedNoteCoordinator(journal,notes);
  }
  restore(record:DeviceGeneration){this.paths.set(record.request.id,record.notePath);this.committed(record.notePath,this.coordinator.materialization(record));}
  restorePending(record:DeviceGeneration){
    if(record.deviceGrant.actor!==this.actor||record.request.deviceCompletion?.actor!==this.actor||contentHash(record.original)!==record.request.deviceCompletion.originalHash)throw Error('A pending completion belongs to another device or original.');
    if(['verified','removed'].includes(record.status))throw Error('Only unfinished local completions can be resumed.');
    this.paths.set(record.request.id,record.notePath);this.grants.set(record.request.id,record.deviceGrant);
  }
  changed(path:string){for(const [id,notePath] of this.paths)if(notePath===path)this.waitingForEdits.delete(id);}
  restoreReceipt(record:{receipt:DeviceCompletionReceipt;proof?:NativeCommitProof}){this.paths.set(record.receipt.id,record.receipt.notePath);if(record.proof)this.committed(record.receipt.notePath,record.proof);else this.retired?.(record.receipt);}
  async acknowledged(lease:LeaseRecord){
    const id=lease.request.id,delivery=lease.state?.delivery;
    if(delivery&&lease.state?.cleanupComplete&&lease.finalWriter?.actor===this.actor){
      const record=await this.store.read(id);
      if(record?.attempt&&record.status==='conflict'&&record.attempt.id===delivery.commitId&&record.attempt.hash===delivery.hash){
        const recovered=await this.coordinator.recoverSaved(id);if(recovered.status==='verified')this.waitingForEdits.delete(id);
      }
    }
    await this.store.retire?.(lease);
  }
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
  private abortEvidence(record:NoteGeneration):FinalAttemptAbort{
    const proof=this.intentProof(record),base={version:1 as const,commitId:proof.commitId,hash:proof.hash,proofHash:contentHash(JSON.stringify(proof)),journalRevision:record.journalRevision!};
    return record.attempt?.reviewedCurrentHash?{...base,writeState:'reviewed-conflict',reviewedCurrentHash:record.attempt.reviewedCurrentHash}:{...base,writeState:'no-write'};
  }
  private async abortAttempt(record:NoteGeneration,abort:(proof:NativeCommitProof,evidence:FinalAttemptAbort)=>Promise<void>){
    const evidence=this.abortEvidence(record);await abort(this.intentProof(record),evidence);
    if(evidence.writeState==='reviewed-conflict')await this.notes.resumeReviewed?.(record.notePath,evidence.reviewedCurrentHash);
  }
  async recoveryCandidate(id:string){
    const record=await this.store.read(id);if(!record||record.deviceGrant.actor!==this.actor)return;
    if(record.request.deviceCompletion?.actor!==this.actor||contentHash(record.original)!==record.request.deviceCompletion.originalHash)throw Error('The completion original changed.');
    const latest=await (this.notes.reviewRead??this.notes.read.bind(this.notes))(record.notePath);if(latest===undefined)return;
    const candidate=this.coordinator.recoveryCandidate(record,latest);return candidate&&{id,notePath:record.notePath,...candidate};
  }
  previewRecovery(id:string){return this.recoveryCandidate(id);}
  async reviewRecovery(id:string,currentHash:string,abort:(proof:NativeCommitProof,evidence:FinalAttemptAbort)=>Promise<void>){
    if(!/^[0-9a-f]{64}$/.test(currentHash))throw Error('Invalid reviewed note hash.');
    const record=await this.store.read(id);if(!record||record.deviceGrant.actor!==this.actor)throw Error('This device does not own the pending final save.');
    this.restorePending(record);
    const result=await this.coordinator.supersedeAttempt(id,record=>this.abortAttempt(record,abort),currentHash,this.notes.reviewRead);this.waitingForEdits.delete(id);return result;
  }
  async complete(lease:LeaseRecord,original?:string,stagedDocument?:string,prepare?:(proof:NativeCommitProof)=>Promise<void>,abort?:(proof:NativeCommitProof,evidence:FinalAttemptAbort)=>Promise<void>){
    const request=lease.request,grant=lease.finalWriter;
    if(this.waitingForEdits.has(request.id))return;
    if(!request.deviceCompletion||!grant||grant.actor!==this.actor||request.deviceCompletion.actor!==this.actor)throw Error('This device does not own the final response write.');
    const retired=await this.store.retired?.(request.id);
    if(retired){if(retired.receipt.token!==grant.token||retired.receipt.requestHash!==hostedRequestHash(request))throw Error('The completed response identity changed.');if(retired.proof)return retired.proof;throw Error('This response is already saved and acknowledged. Its recovery payload has been retired; no note write is permitted.');}
    this.grants.set(request.id,grant);
    if(prepare)this.preparations.set(request.id,prepare);
    let record=await this.store.read(request.id);
    if(record&&JSON.stringify(record.deviceGrant)!==JSON.stringify(grant))throw Error('The saved final-write grant changed.');
    if(!record){if(original===undefined||contentHash(original)!==request.deviceCompletion.originalHash)throw Error('The private completion original changed.');record=await this.coordinator.accept(request,original) as DeviceGeneration;}
    const reportedPath=lease.state?.notePath??request.notePath,knownPath=this.paths.get(request.id)??record.notePath;
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
    let pending=await this.store.read(request.id);
    if(pending?.attempt&&!['verified','removed'].includes(pending.status)){await this.coordinator.recoverSaved(request.id);pending=await this.store.read(request.id);}
    if(pending?.status==='verified'&&pending.verified){const proof=this.coordinator.materialization(pending);this.reportedConflicts.delete(request.id);this.committed(path,proof);return proof;}
    if(pending?.attempt&&abort){await this.coordinator.supersedeAttempt(request.id,record=>this.abortAttempt(record,abort),undefined,pending.attempt.reviewedCurrentHash?this.notes.reviewRead:undefined);pending=await this.store.read(request.id);}
    if(pending?.status==='commit-pending'&&pending.attempt){await prepare?.(this.intentProof(pending));await this.notes.recover?.(path,pending.attempt.expected,[request.id]);}
    if(pending?.status==='conflict')await this.coordinator.recheckSeparatedConflict(request.id);
    const result=await this.coordinator.commit(request.id);
    if(result.status==='conflict'){
      this.waitingForEdits.add(request.id);
      const fingerprint=contentHash(JSON.stringify(result.conflicts.at(-1)));
      if(this.reportedConflicts.get(request.id)!==fingerprint){this.reportedConflicts.set(request.id,fingerprint);this.conflict?.(result);}
      return undefined;
    }
    if(result.status!=='verified'||!result.verified)return undefined;
    const proof=this.coordinator.materialization(result);
    this.reportedConflicts.delete(request.id);
    this.waitingForEdits.delete(request.id);
    this.committed(path,proof);return proof;
  }
}
