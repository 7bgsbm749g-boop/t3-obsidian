import {contentHash} from './completion';
import {finalizeRegion,regionBody} from './inline-thread';
import type {HostedInlineRequest,HostedInlineState} from './hosted-inline';
import {hostedRequestHash,validateHostedRequest} from './hosted-inline';
import {changedEdits,changedInterval,mergeSavedEdits,type SavedEdit} from './coordinated-merge';
import {responseAnchor,responseRegion} from './native-response-projection';
import type {NativeCommitProof} from './native-response-commit';
import {nativeCommitMatches} from './native-response-commit';
import {streamBlock,removeStreamBlock} from './stream-block';

export function validateFinalResponseBody(body:string){if(/<!-- t3-(?:inline|response):/.test(body))throw Error('A finished response cannot introduce tracking boundaries.');}

export interface NoteGeneration {
  journalRevision?:number;
  request:HostedInlineRequest;notePath:string;original:string;originalHash:string;
  checkpoint?:HostedInlineState;sequence?:number;stagedDraft?:string;staged?:string;finalBody?:string;
  attempt?:{id:string;before:string;expected:string;hash:string;kind:'commit'|'repair'};
  verified?:{commitId:string;hash:string;document:string;responseAnchor?:{length:number;hash:string}};
  status:'accepted'|'streaming'|'result-ready'|'commit-pending'|'verified'|'conflict'|'removed';
  conflicts:Array<{original:string;latest:string;proposed?:string;reason:string}>;
  acknowledgements:Array<{deviceId:string;commitId:string;hash:string;observedAt:string}>;
  pendingRename?:{before:string;after:string};
  historyRemoval?:{key:string;blockHash:string;before:string;proof:NativeCommitProof;status:'pending'|'verified'};
}
export interface GenerationJournal {
  read(id:string):Promise<NoteGeneration|undefined>;
  /** Append a new immutable revision; implementations must persist it before
   * returning and reject a changed or skipped predecessor. */
  append(id:string,state:NoteGeneration,event:string):Promise<void>;
  /** Audit, derive and publish a private checkpoint under the append queue.
   * A different verified note path must return its unchanged record so the
   * coordinator can first join that note's save/staging/rename queue. */
  checkpoint?(id:string,sequence:number,state:HostedInlineState,notePath:string):Promise<NoteGeneration>;
}

export function applyGenerationCheckpoint(record:NoteGeneration,sequence:number,state:HostedInlineState){
  if(!Number.isSafeInteger(sequence)||sequence<0)throw Error('Invalid response sequence.');
  if(sequence<=(record.sequence??-1)||!['accepted','streaming'].includes(record.status))return false;
  record.sequence=sequence;record.checkpoint=structuredClone(state);record.status='streaming';return true;
}
export interface GeneratedNoteIO {
  read(path:string):Promise<string|undefined>;
  /** Atomic compare-and-set, including unsaved native buffers, note identity
   * and host-lock validity. Returns false if any of those changed. */
  compareAndSet(path:string,before:string,after:string):Promise<boolean>;
}

/** Serial checked commits for supported staged edits and generated replies. */
export class GeneratedNoteCoordinator {
  private queues=new Map<string,Promise<unknown>>();
  constructor(private journal:GenerationJournal,private notes:GeneratedNoteIO,private id=()=>crypto.randomUUID()){}
  private serial<T>(path:string,run:()=>Promise<T>):Promise<T>{
    const work=(this.queues.get(path)??Promise.resolve()).catch(()=>{}).then(run);
    this.queues.set(path,work);void work.finally(()=>{if(this.queues.get(path)===work)this.queues.delete(path);}).catch(()=>{});return work;
  }
  private async require(id:string){const record=await this.journal.read(id);if(!record)throw Error('Unknown response registration.');return record;}
  async accept(request:HostedInlineRequest,original:string){
    validateHostedRequest(request);
    return this.serial(request.notePath,async()=>{
      const old=await this.journal.read(request.id);
      if(old){if(hostedRequestHash(old.request)!==hostedRequestHash(request)||old.original!==original)throw Error('Response identity already belongs to another request or original.');return old;}
      const region=responseRegion(original,request.id);
      if(!region||original.slice(region.from,region.to)!==responseAnchor(request.id))throw Error('A unique durable response anchor is required.');
      const record:NoteGeneration={request,notePath:request.notePath,original,originalHash:contentHash(original),status:'accepted',conflicts:[],acknowledgements:[]};
      await this.journal.append(request.id,record,'accepted');return record;
    });
  }
  async checkpoint(id:string,sequence:number,state:HostedInlineState){
    if(this.journal.checkpoint){
      let path=state.notePath;
      for(let attempt=0;attempt<8;attempt++){
        const record=await this.serial(path,()=>this.journal.checkpoint!(id,sequence,state,path));
        if(record.notePath===path)return record;
        // The freshly audited path differs (for example after a rename).
        // No checkpoint was written; join its actual note queue before retry.
        path=record.notePath;
      }
      throw Error('The response note keeps moving; reload before retrying.');
    }
    const initial=await this.require(id);
    return this.serial(initial.notePath,async()=>{
      const record=await this.require(id);
      if(!applyGenerationCheckpoint(record,sequence,state))return record;
      await this.journal.append(id,record,'checkpoint');return record;
    });
  }
  async stage(id:string,staged:string,originalHash:string){
    const initial=await this.require(id);
    return this.serial(initial.notePath,async()=>{
      const record=await this.require(id);if(record.originalHash!==originalHash||!['accepted','streaming'].includes(record.status))throw Error('The staged original or result state changed.');
      const region=responseRegion(staged,id),edits=changedEdits(record.original,staged);
      if(!region||staged.slice(region.from,region.to)!==responseAnchor(id)||edits.some(edit=>/<!-- t3-(?:inline|response):/.test(record.original.slice(edit.from,edit.to)+edit.text)))throw Error('Staging changed response boundaries.');
      record.stagedDraft=staged;await this.journal.append(id,record,'staged-edit');return record;
    });
  }
  async result(id:string,staged:string,finalBody:string){
    const initial=await this.require(id);
    return this.serial(initial.notePath,async()=>{
      const record=await this.require(id);
      if(record.staged!==undefined){if(record.staged!==staged||record.finalBody!==finalBody)throw Error('Finished results are immutable.');return record;}
      if(!['accepted','streaming'].includes(record.status))throw Error('This response is no longer accepting a result.');
      const originalRegion=responseRegion(record.original,id),stagedRegion=responseRegion(staged,id);
      if(!originalRegion||!stagedRegion||staged.slice(stagedRegion.from,stagedRegion.to)!==responseAnchor(id))throw Error('Staging changed the response anchor.');
      const edits=changedEdits(record.original,staged);
      // The execution boundary will stage ordinary note changes only. No
      // staging edit may cross any active response registration's boundaries.
      if(edits.some(edit=>/<!-- t3-(?:inline|response):/.test(record.original.slice(edit.from,edit.to))))throw Error('Staged edits overlap response registrations.');
      if(edits.some(edit=>/<!-- t3-(?:inline|response):/.test(edit.text)))throw Error('Staged edits cannot introduce response registrations.');
      if(edits.some(edit=>!(edit.to<originalRegion.from||edit.from>originalRegion.to)))throw Error('Staged edits touch the response anchor.');
      validateFinalResponseBody(finalBody);
      record.staged=staged;record.finalBody=finalBody;record.status='result-ready';
      await this.journal.append(id,record,'result-ready');return record;
    });
  }
  private edits(record:NoteGeneration):SavedEdit[]{
    if(record.staged===undefined||record.finalBody===undefined)throw Error('The result is not ready.');
    const region=regionBody(record.original,record.request.id);
    const final=region&&finalizeRegion(record.original,record.request.id,contentHash(region.body),record.finalBody);
    if(!final)throw Error('Response placement is ambiguous.');
    return [...changedEdits(record.original,record.staged),{...final,preserveBoundaryInsertions:true}];
  }
  materialization(record:NoteGeneration):NativeCommitProof {
    if(record.historyRemoval?.status==='verified')return record.historyRemoval.proof;
    if(record.status!=='verified'||!record.verified||!record.attempt)throw Error('Native materialization requires a verified journal commit.');
    const merged=mergeSavedEdits(record.original,record.attempt.before,this.edits(record));
    if(!merged.ok||merged.text!==record.verified.document)throw Error('Native materialization does not match the verified result.');
    let shift=0;
    const ranges=[...merged.edits].sort((a,b)=>a.from-b.from).map(edit=>{
      const from=edit.from+shift;shift+=edit.text.length-(edit.to-edit.from);return {from,to:from+edit.text.length};
    });
    return {version:1,bindingId:record.request.id,commitId:record.verified.commitId,hash:record.verified.hash,document:record.verified.document,ranges};
  }
  private async conflict(record:NoteGeneration,latest:string,reason:string){
    record.status='conflict';record.conflicts.push({original:record.original,latest,proposed:record.attempt?.expected??record.staged,reason});
    await this.journal.append(record.request.id,record,'conflict');return record;
  }
  async commit(id:string){
    const initial=await this.require(id);
    return this.serial(initial.notePath,async()=>{
      const record=await this.require(id);
      if(['verified','removed','conflict'].includes(record.status))return record;
      const latest=await this.notes.read(record.notePath);
      if(latest===undefined)return record;
      // Restart after the vault write but before the verified journal append.
      if(record.attempt&&latest===record.attempt.expected)return this.verify(record,latest);
      if(record.attempt&&latest!==record.attempt.before)return this.conflict(record,latest,'A pending commit changed before verification.');
      const merged=mergeSavedEdits(record.original,latest,this.edits(record));
      if(!merged.ok)return this.conflict(record,latest,merged.reason);
      if(!record.attempt){
        record.attempt={id:this.id(),before:latest,expected:merged.text,hash:contentHash(merged.text),kind:'commit'};record.status='commit-pending';
        await this.journal.append(id,record,'commit-pending');
      }else if(record.attempt.expected!==merged.text)throw Error('The pending commit intent changed.');
      if(!await this.notes.compareAndSet(record.notePath,latest,merged.text))return record;
      const readback=await this.notes.read(record.notePath);
      if(readback!==merged.text)return this.conflict(record,readback??'',readback===undefined?'Note disappeared during readback.':'Saved result did not survive readback.');
      return this.verify(record,readback);
    });
  }
  private async verify(record:NoteGeneration,document:string){
    if(!record.attempt||contentHash(document)!==record.attempt.hash)throw Error('Commit readback does not match its journaled intent.');
    const merged=mergeSavedEdits(record.original,record.attempt.before,this.edits(record));
    if(!merged.ok)throw Error('Verified placement cannot be proven.');
    const final=merged.edits.at(-1)!,offset=final.from+1+merged.edits.filter(edit=>edit.from<final.from).reduce((delta,edit)=>delta+edit.text.length-(edit.to-edit.from),0);
    record.verified={commitId:record.attempt.id,hash:record.attempt.hash,document,responseAnchor:{length:offset,hash:contentHash(document.slice(0,offset))}};record.status='verified';
    await this.journal.append(record.request.id,record,record.attempt.kind==='repair'?'repair-verified':'saved-and-verified');return record;
  }
  /** Device acknowledgements must originate from an authenticated device read
   * of the actual saved file. VPS readback never manufactures an acknowledgement. */
  async acknowledge(id:string,deviceId:string,commitId:string,document:string){
    const initial=await this.require(id);
    return this.serial(initial.notePath,async()=>{
      const record=await this.require(id),hash=contentHash(document);
      const evidence=record.historyRemoval?.status==='verified'&&record.historyRemoval.proof.commitId===commitId?record.historyRemoval.proof:record.verified;
      if(record.status!=='verified'||!evidence||evidence.commitId!==commitId||evidence.hash!==hash)throw Error('Device observed a different or unverified result.');
      if(!deviceId.trim())throw Error('Missing authenticated device identity.');
      if(!record.acknowledgements.some(ack=>ack.deviceId===deviceId&&ack.commitId===commitId)){record.acknowledgements.push({deviceId,commitId,hash,observedAt:new Date().toISOString()});await this.journal.append(id,record,'device-observed');}
      return record;
    });
  }
  async remove(id:string){
    const initial=await this.require(id);
    return this.serial(initial.notePath,async()=>{const record=await this.require(id);if(record.status!=='removed'){record.status='removed';await this.journal.append(id,record,'intentional-removal');}return record;});
  }
  /** A history-only deletion is an explicit checked user edit. Preserve the
   * original response and commit evidence; publish a derived proof for clients
   * that receive the shortened note before adopting the original delivery. */
  async closeHistory(id:string,key:string,blockHash:string){
    const initial=await this.require(id);
    return this.serial(initial.notePath,async()=>{
      const record=await this.require(id);
      if(!record.verified||!['verified','conflict'].includes(record.status))throw Error('The response has not finished saving.');
      const originalBlock=record.finalBody?streamBlock(record.finalBody,key):undefined;
      if(!originalBlock?.complete||contentHash(originalBlock.text)!==blockHash)throw Error('The streaming history differs from its saved response.');
      const latest=await this.notes.read(record.notePath);if(latest===undefined)throw Error('The response note is unavailable.');
      let intent=record.historyRemoval;
      if(intent){
        if(intent.key!==key||intent.blockHash!==blockHash)throw Error('A different history removal is already recorded.');
        if(intent.status==='verified'){
          if(nativeCommitMatches(intent.proof,latest))return record;
          // Native undo may restore the exact original history. A new close
          // is a new intentional edit, preserving the earlier immutable proof.
          if(!streamBlock(latest,key))throw Error('The shortened response changed.');
          intent=undefined;record.historyRemoval=undefined;
        }
        if(intent&&latest!==intent.before&&latest!==intent.proof.document)throw Error('The note changed during history removal.');
      }
      if(!intent){
        // Exact protected ranges, rather than the old whole-note checksum,
        // permit unrelated edits and other responses in the same note.
        const base=this.materialization({...record,status:'verified',historyRemoval:undefined});
        if(!nativeCommitMatches(base,latest))throw Error('The saved response changed. Save or reload the note before removing its history.');
        const removal=removeStreamBlock(latest,key,blockHash),outside=changedEdits(base.document,latest);
        const ranges=base.ranges.map(range=>{
          const shift=outside.filter(edit=>edit.to<range.from).reduce((sum,edit)=>sum+edit.text.length-(edit.to-edit.from),0);
          const from=range.from+shift,to=range.to+shift;
          const map=(offset:number)=>offset<=removal.from?offset:offset>=removal.to?offset-(removal.to-removal.from):removal.from;
          return {from:map(from),to:map(to)};
        });
        const proof:NativeCommitProof={version:1,bindingId:id,commitId:this.id(),hash:contentHash(removal.text),document:removal.text,ranges};
        record.status='verified';intent=record.historyRemoval={key,blockHash,before:latest,proof,status:'pending'};
        await this.journal.append(id,record,'history-removal-pending');
      }
      if(latest!==intent.proof.document&&!await this.notes.compareAndSet(record.notePath,intent.before,intent.proof.document)){
        if(await this.notes.read(record.notePath)!==intent.proof.document){record.historyRemoval=undefined;await this.journal.append(id,record,'history-removal-not-applied');throw Error('The note changed before history removal. Save the note and try again.');}
      }
      if(await this.notes.read(record.notePath)!==intent.proof.document)throw Error('History removal has not reached the saved note.');
      intent.status='verified';await this.journal.append(id,record,'history-removal-verified');return record;
    });
  }
  /** Explicit conflict resolution, never an inference from missing text. A
   * frontend must bind this to a user's restore choice for the displayed
   * revision. A changed revision or overlapping edit preserves the conflict. */
  async restore(id:string,reviewedLatestHash:string){
    const initial=await this.require(id);
    return this.serial(initial.notePath,async()=>{
      const record=await this.require(id);
      if(record.status!=='conflict')throw Error('Only a preserved conflict can be explicitly restored.');
      const latest=await this.notes.read(record.notePath);
      if(latest===undefined||contentHash(latest)!==reviewedLatestHash)throw Error('The reviewed conflict version changed.');
      const merged=mergeSavedEdits(record.original,latest,this.edits(record));
      if(!merged.ok)return this.conflict(record,latest,merged.reason);
      record.attempt={id:this.id(),before:latest,expected:merged.text,hash:contentHash(merged.text),kind:'repair'};record.status='commit-pending';
      await this.journal.append(id,record,'explicit-repair-pending');
      if(!await this.notes.compareAndSet(record.notePath,latest,merged.text))return record;
      const readback=await this.notes.read(record.notePath);
      if(readback!==merged.text)return this.conflict(record,readback??'','The repaired result did not survive readback.');
      return this.verify(record,readback);
    });
  }
  /** Missing final output alone cannot distinguish a stale overwrite from an
   * intentional delete/undo. Until trusted revision provenance is available,
   * detect and preserve it rather than silently restoring the user's text. */
  async observe(id:string){
    const initial=await this.require(id);
    return this.serial(initial.notePath,async()=>{
      const record=await this.require(id);if(record.status!=='verified'||!record.verified)return record;
      const latest=await this.notes.read(record.notePath);
      if(record.historyRemoval){
        const intent=record.historyRemoval;
        if(intent.status==='pending'){
          if(latest===intent.before)return record;
          if(latest===intent.proof.document){intent.status='verified';await this.journal.append(id,record,'history-removal-verified');return record;}
          const base=this.materialization({...record,historyRemoval:undefined});
          if(latest!==undefined&&nativeCommitMatches(base,latest)){record.historyRemoval=undefined;await this.journal.append(id,record,'history-removal-not-applied');return record;}
        }else if(latest!==undefined&&nativeCommitMatches(intent.proof,latest))return record;
        return this.conflict(record,latest??'','A later note version changed the explicitly shortened response.');
      }
      if(latest===record.verified.document)return record;
      if(latest!==undefined){
        const user=changedInterval(record.verified.document,latest);
        const generated=mergeSavedEdits(record.original,record.attempt!.before,this.edits(record));
        if(user&&generated.ok&&generated.edits.every(edit=>{
          // Map the committed ranges through earlier generated edits.
          const delta=generated.edits.filter(previous=>previous.from<edit.from).reduce((sum,previous)=>sum+previous.text.length-(previous.to-previous.from),0);
          const from=edit.from+delta,to=from+edit.text.length;
          return user.to<from||user.from>to;
        }))return record; // ordinary edits outside the complete result
      }
      return this.conflict(record,latest??'','A later note version changed or removed a committed result. Deletion intent and stale Sync ancestry are not established.');
    });
  }
  /** Rename is admitted only after the note identity has been verified by the
   * caller; existing request IDs, thread/run registrations and checkpoints stay. */
  async renamed(id:string,before:string,after:string){
    const initial=await this.require(id);
    return this.serial(initial.notePath,async()=>{
      const record=await this.require(id);if(record.notePath!==before)throw Error('Rename does not match this registration.');
      validateHostedRequest({...record.request,notePath:after});record.notePath=after;
      if(record.status==='verified')record.pendingRename={before,after};
      await this.journal.append(id,record,'renamed');return record;
    });
  }
  async settleRename(id:string){
    const initial=await this.require(id);
    return this.serial(initial.notePath,async()=>{
      const record=await this.require(id);if(!record.pendingRename)return record;
      delete record.pendingRename;await this.journal.append(id,record,'rename-observed');return record;
    });
  }
}
