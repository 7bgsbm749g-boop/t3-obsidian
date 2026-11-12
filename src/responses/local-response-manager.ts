import {toError} from '../shared/values';
import {contentHash} from './completion';
import {scheduleTimeout as setTimeout} from '../shared/clock';
import {DirectInlinePreview,type DirectInlineUpdate} from './direct-inline-preview';
import {localResponseBindings,localResponseRange,withoutLocalResponseBinding} from './local-response-binding';
import {responseIds} from './response-container';
import {compactResponseBinding} from './response-binding-data';
import type {ResponseRequest} from './response-model';
import type {ResponseRecord} from './response-record';
import type {InlineStartRequest} from '../conversations/inline-thread';
import type {DeviceResponseIO} from './device-local-responses';
import {streamMemory} from '../app/stream-memory-diagnostics';
import {logEvent,logFailure,diagnosticEnabled} from '../app/diagnostics';
import {SharedThreadStreams} from '../conversations/shared-thread-stream';
import type {ResponseStopReceipt} from './response-stop-receipt';
import {localFinalIdentity} from './local-final-cache';
import {completionSource} from './explorer-responses';
import {interruptStoppedResponse} from './response-stop';
import {completedSelectionDraft,validSteeringInput,type SteeringInput} from '../conversations/inline-steering';
import type {ResponseConnectionIssue} from '../connection/sign-in-state';
import type {LocalResponseSaveResult,LocalSavePendingReason} from './local-response-save';
import type {ThreadSnapshot} from '../connection/wire-types';

export interface LocalFinalNoteIO {
  read(path:string):Promise<string|undefined>;
  compareAndSet(path:string,before:string,after:string,guard?:()=>boolean):Promise<boolean>;
}
type Runtime={request:ResponseRequest;record:ResponseRecord;preview:DirectInlinePreview;update?:DirectInlineUpdate;restoring?:boolean;retained?:Promise<void>;work?:Promise<void>;stopped?:boolean;stopBody?:string;stopAcknowledged?:boolean;done?:boolean;saved?:boolean;detached?:boolean;pendingSave?:LocalSavePendingReason;retryAt:number;watchWanted?:boolean;attemptRevision?:number;diagnosticState?:string};
type NoteCache={document:string;bindings:ResponseRequest[];references:Map<string,ResponseRequest|undefined>};
type RecoveryNote={requests:ResponseRequest[];version:number;pending:boolean;retryAt:number};
/** A saved anchor and its synced settings record reconnect independently of
 * any remote writer. Identical device final writes converge through Sync. */
export class LocalResponseManager {
  private jobs=new Map<string,Runtime>();
  private migrations=new Map<string,Promise<void>>();
  private documents=new Map<string,NoteCache[]>();
  private recoveryStored?:readonly ResponseRequest[];
  private indexedStored?:readonly ResponseRequest[];
  private storedIndex=new Map<string,ResponseRequest>();
  private recoveryNotes=new Map<string,RecoveryNote>();
  private recoveryWork?:Promise<void>;
  private stoppedIds:Set<string>;
  private closed=false;
  private sources=new SharedThreadStreams();
  private moves=new Map<string,{from:Set<string>;to:string}>();
  private blockedLocations=new Set<string>();
  private finalQueues=new Map<string,Set<Runtime>>();
  private finalWorkers=new Map<string,Promise<void>>();
  private finalWaiters=new Map<Runtime,()=>void>();
  private noteVersions=new Map<string,number>();
  private noteWrites=new Map<string,Promise<unknown>>();
  constructor(private actor:string,private vaultId:string,private io:DeviceResponseIO,private notes:LocalFinalNoteIO,private now=()=>Date.now(),private makePreview=(record:ResponseRecord,access:()=>ReturnType<DeviceResponseIO['access']>,receive:(update:DirectInlineUpdate)=>void,connection:(issue?:ResponseConnectionIssue)=>void)=>new DirectInlinePreview(record,access,receive,this.sources.forSource(JSON.stringify([record.request.threadEnvironmentId,record.request.projectId,record.request.threadId]),this.io.knownCompleted?.(record.request),()=>this.io.isVisible?.(record.request.notePath)?2:this.io.isOpen(record.request.notePath)?1:0),undefined,connection)){const stopped=io.loadStops?.();this.stoppedIds=new Set(Array.isArray(stopped)?stopped:[]);}
  has(id:string){return this.jobs.has(id);}
  request(id:string){return this.jobs.get(id)?.request;}
  record(id:string){return this.jobs.get(id)?.record;}
  private stored(){return this.io.localBindings?.()??[];}
  private index(stored:readonly ResponseRequest[]){if(stored!==this.indexedStored){this.indexedStored=stored;this.storedIndex=new Map(stored.map(request=>[request.id,request]));}return this.storedIndex;}
  private range(document:string,id:string){return localResponseRange(document,id,this.stored());}
  private destination(request:ResponseRequest){const move=this.moves.get(request.id);return move?.from.has(request.notePath)?move.to:request.notePath;}
  private watch(runtime:Runtime,open:boolean){
    this.reportState(runtime);runtime.watchWanted=open;
    if(runtime.restoring)return;
    if(runtime.done||runtime.stopped||runtime.detached||runtime.update?.completionVerified&&!runtime.update.questionsPending){runtime.preview.suspend();return;}
    runtime.preview.tick(open);
  }
  private current(runtime:Runtime){const stored=this.stored().find(request=>request.id===runtime.request.id);return !stored||JSON.stringify(compactResponseBinding({...stored,notePath:this.destination(stored)}))===JSON.stringify(compactResponseBinding(runtime.request));}
  private adopt(request:ResponseRequest){
    request={...request,notePath:this.destination(request)};
    const retained=this.jobs.get(request.id);
    if(retained?.done){if(localFinalIdentity(retained.request)===localFinalIdentity(request))return retained;retained.preview.dispose();this.jobs.delete(request.id);}
    const old=this.jobs.get(request.id);if(old){
      old.detached=false;
      if(JSON.stringify(compactResponseBinding(old.request))!==JSON.stringify(compactResponseBinding(request))){
        const changed=localFinalIdentity(old.request)!==localFinalIdentity(request);
        old.attemptRevision=undefined;old.request=request;old.record={...old.record,revision:old.record.revision+1,request,state:{...old.record.state!,notePath:request.notePath,messageId:request.localMessageId??request.messageId,steering:request.localSteering}};old.preview.update(old.record);
        void Promise.resolve(this.io.receiveCoordinated?.(old.record)).catch(error=>logFailure('response.local.update',error,{bindingId:request.id}));
        if(changed){old.update=undefined;old.preview.reconnect(this.io.isOpen(request.notePath));}
      }
      return old;
    }
    const record:ResponseRecord={request,epoch:1,revision:1,owner:this.actor,expiresAt:0,coordinated:true,state:{...request.localResume,requestHash:'',accepted:true,notePath:request.notePath,messageId:request.localMessageId??request.messageId,steering:request.localSteering,status:'waiting',hashes:[],updatedAt:request.createdAt}};
    const runtime={request,record,retryAt:0,restoring:true} as Runtime;
    runtime.preview=this.makePreview(record,()=>this.sources.access(()=>this.io.access(request.threadEnvironmentId),JSON.stringify([request.threadEnvironmentId,request.projectId,request.threadId])),update=>{
      if(this.closed||runtime.done||runtime.stopped)return;
      const same=runtime.update?.completionVerified&&update.completionVerified&&runtime.update.turnId===update.turnId&&runtime.update.messageId===update.messageId&&runtime.update.body===update.body&&runtime.update.phase===update.phase&&runtime.update.questionsPending===update.questionsPending;
      if(!same)runtime.update=update;this.io.receiveDirect?.(update);
      runtime.record.state={...runtime.record.state!,...update.resume,body:update.body,status:update.phase==='error'?'error':update.phase??'running',turnId:update.turnId,bindingCheckpoint:update.checkpoint};
      streamMemory.sample('sample',()=>{const status=this.sources.status();return {bindingId:request.id,threadId:request.threadId,turnId:update.turnId,bodyLength:update.body.length,sourceCount:status.sources,readerCount:status.readers,openingCount:status.opening,queuedCount:status.queued,canonicalReadCount:status.canonicalReads,cacheCharacters:status.cacheCharacters,attachmentCount:this.jobs.size,saveWorkerCount:this.finalWorkers.size,saveQueueCount:this.finalQueues.size};});
      if(update.questionActivities)this.io.localQuestions?.(update);
      if(update.completionVerified&&['complete','interrupted'].includes(update.phase??'')){
        if(!same)runtime.retained=this.io.retainLocalFinal?.(update).catch(error=>logFailure('response.local.final-cache',error,{bindingId:request.id}));
        if(!update.questionsPending)runtime.preview.suspend();
        logEvent('response.lifecycle.result-ready',{bindingId:request.id,threadId:request.threadId,turnId:update.turnId,questionsPending:update.questionsPending});
        this.finish(runtime);
      }
    },issue=>{if(!this.closed&&!runtime.done&&!runtime.stopped)this.io.localConnection?.(request.id,issue);});
    this.jobs.set(request.id,runtime);
    if(diagnosticEnabled('response.recovery.adopted'))logEvent('response.recovery.adopted',{bindingId:request.id,noteAlias:contentHash(request.notePath),environmentId:request.threadEnvironmentId,projectId:request.projectId,threadId:request.threadId,messageId:request.localMessageId??request.messageId,open:this.io.isOpen(request.notePath)});
    void Promise.resolve(this.io.receiveCoordinated?.(record)).catch(error=>logFailure('response.local.adopt',error,{bindingId:request.id}));
    void Promise.all([this.io.loadLocalFinal?.(request),this.io.loadLocalCompletion?.(request)]).then(async([update,receipt])=>{
      if(receipt&&!receipt.saved&&!receipt.removed){
        // Earlier versions persisted an editor's temporary absence as a final
        // removal. It cannot prove deletion. A checked save still requires the
        // exact empty anchor; saved receipts, explicit removals and Stop retain
        // their authority even when an old anchor returns through Sync.
        receipt=undefined;logEvent('response.recovery.unsaved-anchor',{bindingId:request.id});
      }
      if(receipt&&!this.closed&&!runtime.stopped){runtime.done=true;runtime.saved=receipt.saved;runtime.preview.dispose();this.io.localCompleted?.(request.id,request.notePath);logEvent('response.recovery.retired',{bindingId:request.id,saved:receipt.saved});return;}
      if(!update||this.closed||runtime.done||runtime.stopped)return;
      if(!runtime.update){runtime.update={...update,request:runtime.record.request};runtime.record.state={...runtime.record.state!,...update.resume,body:update.body,bindingCheckpoint:update.checkpoint};runtime.preview.update(runtime.record);this.io.receiveDirect?.(runtime.update);}
      runtime.preview.restore?.(update.resume);
    }).catch(error=>logFailure('response.local.final-restore',error,{bindingId:request.id})).finally(()=>{runtime.restoring=false;if(runtime.watchWanted)this.watch(runtime,true);this.finish(runtime);});
    return runtime;
  }
  async register(request:ResponseRequest,explicitLocation=false,importedSnapshot?:ThreadSnapshot){
    if(this.closed||request.vaultId!==this.vaultId)throw Error('This response belongs to another vault.');
    const current=await this.io.readNote(request.notePath);if(current===undefined)throw Error('The response note is unavailable.');
    if(!localResponseRange(current,request.id,[request]))throw Error('The response block changed before registration.');
    if(!this.io.saveLocalBinding)throw Error('Shared response storage is unavailable.');
    // Persist the settings record before removing any older in-note record.
    await this.io.saveLocalBinding(request);if(explicitLocation)this.moves.delete(request.id);
    if(this.closed)return;
    const after=withoutLocalResponseBinding(current,request.id);
    if(after!==current){
      const saved=await this.io.updateNote(request.notePath,value=>{if(value!==current)throw Error('The response note changed before registration.');return after;},()=>!this.closed);
      if(saved!==after)throw Error('Save the response note before sending.');
      await this.io.saveLocalNote?.(request.notePath);
    }
    this.documents.set(request.notePath,[{document:after,bindings:localResponseBindings(after,this.stored()),references:new Map(responseIds(after).map(id=>[id,this.index(this.stored()).get(id)]))}]);
    const runtime=this.adopt(request);if(importedSnapshot)runtime.preview.seedImport?.(importedSnapshot);this.watch(runtime,true);
  }
  delivered(id:string,delivery:InlineStartRequest){this.jobs.get(id)?.preview.delivery(delivery);}
  resume(){
    if(this.closed)return;
    const documents=this.io.openedNotes?.()??[],locations=new Map<string,ResponseRequest[]>(),stored=this.stored(),byId=this.index(stored),blocked=new Set<string>(),paneCounts=new Map<string,number>();
    for(const path of this.documents.keys())if(!documents.some(note=>note.path===path)){this.documents.delete(path);const note=this.recoveryNotes.get(path);if(note){note.version++;note.pending=true;note.retryAt=0;}}
    for(const {path,document} of documents){
      const pane=paneCounts.get(path)??0;paneCounts.set(path,pane+1);const panes=this.documents.get(path)??[];let cached=panes[pane];
      if(!cached||cached.document!==document||[...cached.references].some(([id,request])=>byId.get(id)!==request)){if(cached&&cached.document!==document)this.noteVersions.set(path,(this.noteVersions.get(path)??0)+1);cached={document,bindings:localResponseBindings(document,stored),references:new Map(responseIds(document).map(id=>[id,byId.get(id)]))};panes[pane]=cached;this.documents.set(path,panes);}
      for(const binding of cached.bindings){
      if(binding.vaultId!==this.vaultId||this.stoppedIds.has(binding.id))continue;
      if(this.destination(binding)!==path){const key=JSON.stringify([path,binding.id]);blocked.add(key);if(!this.blockedLocations.has(key)&&diagnosticEnabled('response.recovery.location-blocked'))logEvent('response.recovery.location-blocked',{bindingId:binding.id,candidateAlias:contentHash(path),destinationAlias:contentHash(this.destination(binding)),reason:'copied-anchor'});continue;}
      if(document.includes(`<!-- t3-response-binding:${binding.id}:`)){
        if(!this.migrations.has(binding.id)){
          const request=stored.find(request=>request.id===binding.id)??binding;
          const work=this.register({...request,notePath:path}).catch(error=>logFailure('response.local.migration',error,{bindingId:binding.id})).finally(()=>this.migrations.delete(binding.id));
          this.migrations.set(binding.id,work);
        }
        continue;
      }
      const list=locations.get(binding.id)??[];if(!list.some(item=>item.notePath===path))list.push({...binding,notePath:path});locations.set(binding.id,list);
    }}
    for(const [path,count] of paneCounts)this.documents.get(path)!.length=count;
    for(const [id,bindings] of locations){
      if(bindings.length!==1){this.jobs.get(id)?.preview.suspend();continue;}
      const runtime=this.adopt(bindings[0]);if(!runtime.done&&!runtime.stopped)this.watch(runtime,true);
    }
    for(const runtime of this.jobs.values()){
      const latest=this.index(stored).get(runtime.request.id);
      if(!runtime.done&&!runtime.work&&latest&&this.io.savedResponse&&this.io.knownCompleted?.(latest)&&localFinalIdentity(latest)===localFinalIdentity(runtime.request))this.adopt(latest);
      // Note and completion metadata can arrive in either order. A new shared
      // receipt invalidates the earlier refusal even when disk did not change.
      if(stored!==this.recoveryStored&&this.io.savedResponse&&this.io.knownCompleted?.(runtime.request))runtime.attemptRevision=undefined;
      const loaded=locations.get(runtime.request.id);
      if(!loaded){
        // A temporary missing editor projection is not evidence of deletion.
        // Keep recovery text and let an exact returning anchor reattach it.
        if(documents.some(note=>note.path===runtime.request.notePath)&&!runtime.work&&!this.migrations.has(runtime.request.id))this.detach(runtime);
        if(!runtime.done&&!runtime.stopped&&(!runtime.update?.completionVerified||runtime.update.questionsPending))this.watch(runtime,true);
        else runtime.preview.suspend();
        // A final commit removes the anchor before its file IO resolves. Let
        // that pending commit report its own success or conflict.
        this.finish(runtime);
        continue;
      }
      if(this.io.syncReady?.(runtime.request.notePath)===false)runtime.attemptRevision=undefined;
      if(loaded.length===1)this.finish(runtime);
    }
    this.blockedLocations=blocked;this.recoverClosed(stored);
  }
  /** Read each recorded destination once, serially. Timer ticks reuse the
   * result; only changed bindings/files invalidate it. Retain no closed note
   * text, and never attach a historical record without its exact empty anchor. */
  private recoverClosed(stored:readonly ResponseRequest[]){
    if(stored!==this.recoveryStored){
      this.recoveryStored=stored;
      const grouped=new Map<string,ResponseRequest[]>();
      for(const request of stored)if(request.localOnly&&request.vaultId===this.vaultId&&!this.stoppedIds.has(request.id)){
        const list=grouped.get(request.notePath)??[];list.push(request);grouped.set(request.notePath,list);
      }
      const next=new Map<string,RecoveryNote>();
      for(const [path,requests] of grouped){const old=this.recoveryNotes.get(path);next.set(path,old&&old.requests.length===requests.length&&old.requests.every((request,index)=>request===requests[index])?old:{requests,version:0,pending:true,retryAt:0});}
      this.recoveryNotes=next;
    }
    if(this.recoveryWork||![...this.recoveryNotes.values()].some(note=>note.pending&&note.retryAt<=this.now()))return;
    this.recoveryWork=this.recoverNotes().catch(error=>logFailure('response.local.recovery',error)).finally(()=>{this.recoveryWork=undefined;});
  }
  private async recoverNotes(){
    while(!this.closed){
      const next=[...this.recoveryNotes].find(([,note])=>note.pending&&note.retryAt<=this.now());if(!next)return;
      const [path,note]=next,version=note.version;note.pending=false;
      if(this.io.openedNotes?.().some(open=>open.path===path))continue;
      try{
        const document=await this.io.readNote(path);
        if(this.closed||this.recoveryNotes.get(path)!==note||note.version!==version)continue;
        if(this.io.openedNotes?.().some(open=>open.path===path))continue;
        if(document===undefined)continue;
        const bindings=localResponseBindings(document,note.requests);
        const present=new Set(bindings.map(binding=>binding.id));
        for(const runtime of this.jobs.values())if(runtime.request.notePath===path&&!present.has(runtime.request.id)&&!runtime.done&&!runtime.work&&!this.migrations.has(runtime.request.id)){
          this.detach(runtime);
        }
        for(const binding of bindings){
          if(this.stoppedIds.has(binding.id)||binding.vaultId!==this.vaultId)continue;
          // Legacy descriptor migration keeps its existing loaded-editor path.
          if(document.includes(`<!-- t3-response-binding:${binding.id}:`))continue;
          const runtime=this.adopt({...binding,notePath:path});if(!runtime.done&&!runtime.stopped)this.watch(runtime,true);
        }
      }catch(error){if(this.recoveryNotes.get(path)===note){note.pending=true;note.retryAt=this.now()+5000;}logFailure('response.local.recovery-read',error,{notePath:path});}
      // Yield between files so large saved histories cannot monopolize startup.
      await new Promise<void>(resolve=>setTimeout(resolve,0));
    }
  }
  changed(path:string){this.noteVersions.set(path,(this.noteVersions.get(path)??0)+1);const note=this.recoveryNotes.get(path);if(note){note.version++;note.pending=true;note.retryAt=0;}this.resume();}
  savedResponsesChanged(){
    for(const runtime of this.jobs.values())if(!runtime.done&&this.io.savedResponse&&this.io.knownCompleted?.(runtime.request)&&(runtime.stopped||runtime.detached||runtime.update?.completionVerified))runtime.attemptRevision=undefined;
    this.resume();
  }
  tick(){this.resume();}
  reconnect(){if(this.closed)return;for(const runtime of this.jobs.values())if(!runtime.done&&!runtime.stopped&&(!runtime.update?.completionVerified||runtime.update.questionsPending))runtime.preview.suspend();for(const runtime of this.jobs.values())if(!runtime.done&&!runtime.stopped){runtime.attemptRevision=undefined;if(!runtime.restoring&&(!runtime.update?.completionVerified||runtime.update.questionsPending))runtime.preview.reconnect(this.io.isOpen(runtime.request.notePath));}this.resume();}
  private detach(runtime:Runtime){if(runtime.done||runtime.stopped)return;runtime.detached=true;runtime.pendingSave='note-changed';runtime.preview.suspend();this.reportState(runtime);}
  private saveResult(runtime?:Runtime):LocalResponseSaveResult {
    if(this.closed||!runtime)return {saved:false,reason:'plugin-unavailable'};
    if(runtime.saved)return {saved:true};
    if(runtime.done)return {saved:false,reason:'note-changed'};
    if(runtime.stopped)return {saved:false,reason:'stopped'};
    if(runtime.detached)return {saved:false,reason:'note-changed'};
    if(runtime.update?.questionsPending)return {saved:false,reason:'answer'};
    if(!runtime.update?.completionVerified)return {saved:false,reason:'verification'};
    if(this.io.syncReady?.(runtime.request.notePath)===false)return {saved:false,reason:'sync'};
    return {saved:false,reason:runtime.pendingSave??'saving'};
  }
  /** A blocked save reports its state; active saves retain their checked write. */
  async waitForSave(id:string,_legacyWait?:number):Promise<LocalResponseSaveResult>{
    for(;;){
      const runtime=this.jobs.get(id);if(runtime)this.finish(runtime);
      const result=this.saveResult(runtime);
      if(result.saved||!runtime||runtime.done||runtime.stopped||this.closed||result.reason!=='saving')return result;
      // A checked save already owns its completion promise. Wake when that
      // operation finishes instead of delaying completion through a timer.
      if(runtime.work)await runtime.work;else return result;
    }
  }
  private reportState(runtime:Runtime){
    if(!diagnosticEnabled('response.lifecycle.state'))return;
    const save=this.saveResult(runtime),state=JSON.stringify([save,runtime.restoring,runtime.done,runtime.stopped]);if(state===runtime.diagnosticState)return;runtime.diagnosticState=state;
    logEvent('response.lifecycle.state',{bindingId:runtime.request.id,threadId:runtime.request.threadId,messageId:runtime.request.localMessageId??runtime.request.messageId,turnId:runtime.update?.turnId,saved:save.saved,pendingReason:save.saved?undefined:save.reason,restoring:runtime.restoring,done:runtime.done});
  }
  private finish(runtime:Runtime){
    this.reportState(runtime);
    if(this.closed||runtime.done||(runtime.stopped||runtime.detached)&&!this.io.savedResponse||runtime.restoring||runtime.work||this.now()<runtime.retryAt||this.io.syncReady?.(runtime.request.notePath)===false)return;
    const update=runtime.update,proofOnly=!!this.io.savedResponse&&(runtime.stopped||runtime.detached);if((!update?.completionVerified||update.questionsPending)&&!proofOnly)return;
    const path=runtime.request.notePath,revision=this.noteVersions.get(path)??0;
    if(runtime.attemptRevision===revision)return;
    runtime.attemptRevision=revision;runtime.pendingSave='saving';
    runtime.work=new Promise<void>(resolve=>this.finalWaiters.set(runtime,resolve));
    const queue=this.finalQueues.get(path)??new Set<Runtime>();queue.add(runtime);this.finalQueues.set(path,queue);
    if(this.finalWorkers.has(path))return;
    const work=Promise.resolve().then(async()=>{
      while(queue.size&&!this.closed){
        const batch=[...queue];queue.clear();
        try{await this.writeNote(path,()=>this.saveBatch(path,batch));}
        catch(error){for(const item of batch){item.pendingSave='save-error';logFailure('response.save.failed',error,{bindingId:item.request.id});this.io.completionFailed?.(error,item.request.id);}}
        finally{for(const item of batch){item.work=undefined;this.finalWaiters.get(item)?.();this.finalWaiters.delete(item);}}
      }
    }).finally(()=>{this.finalWorkers.delete(path);this.finalQueues.delete(path);});
    this.finalWorkers.set(path,work);
  }
  private writeNote<T>(path:string,operation:()=>Promise<T>):Promise<T>{
    const work=(this.noteWrites.get(path)??Promise.resolve()).catch(()=>{}).then(operation);
    this.noteWrites.set(path,work);void work.finally(()=>{if(this.noteWrites.get(path)===work)this.noteWrites.delete(path);}).catch(()=>{});return work;
  }
  private async settle(runtime:Runtime,saved:boolean,localWrite=true,savedBody?:string){
    runtime.done=true;runtime.saved=saved;runtime.preview.dispose();this.io.localCompleted?.(runtime.request.id,runtime.request.notePath);
    try{await this.io.retainLocalCompletion?.(runtime.request,saved,localWrite?runtime.update:undefined,localWrite?savedBody:undefined);}catch(error){logFailure('response.lifecycle.receipt-failed',error,{bindingId:runtime.request.id,saved});}
    runtime.request=compactResponseBinding(runtime.request);
    const turn=runtime.update?.turnId?runtime.update.checkpoint?.turns?.[runtime.update.turnId]:undefined,checkpoint=turn?{turns:{[turn.turnId]:turn}}:undefined;
    if(runtime.update)runtime.update={...runtime.update,request:runtime.request,body:'',resume:undefined,questionActivities:undefined,checkpoint};
    runtime.record={...runtime.record,state:{requestHash:'',accepted:true,notePath:runtime.request.notePath,status:runtime.update?.phase??'complete',hashes:[],updatedAt:runtime.request.createdAt,bindingCheckpoint:checkpoint}};
    logEvent('response.lifecycle.settled',{bindingId:runtime.request.id,saved});
  }
  private async saveBatch(path:string,batch:Runtime[]){
    const started=Date.now();await Promise.all(batch.flatMap(runtime=>runtime.retained?[runtime.retained]:[]));
    const current=await this.notes.read(path);
    if(current===undefined){for(const runtime of batch)runtime.pendingSave='note-unavailable';return;}
    let document=current;
    const changes:Array<{runtime:Runtime;update:DirectInlineUpdate;request:string;body:string}>=[];
    for(const runtime of batch){
      const update=runtime.update;
      // A peer may have materialized this exact reply while our checked write
      // was refused. Verify its portable receipt against the current note;
      // missing anchors alone never prove a save or removal.
      const proofRequest=runtime.request;
      if(!this.closed&&!runtime.done&&proofRequest.notePath===path&&this.current(runtime)&&await this.io.savedResponse?.(proofRequest,current)){
        if(await this.notes.read(path)===current&&!this.closed&&runtime.request===proofRequest&&this.current(runtime)&&this.io.syncReady?.(path)!==false)await this.settle(runtime,true,false);
        continue;
      }
      if(this.closed||runtime.stopped||runtime.done||runtime.detached||runtime.request.notePath!==path||!this.current(runtime)||!update?.completionVerified||update.questionsPending||this.io.syncReady?.(path)===false){runtime.pendingSave='note-changed';continue;}
      let range=this.range(document,runtime.request.id);
      if(!range){this.detach(runtime);continue;}
      if(range.request.threadId!==runtime.request.threadId||(range.request.localMessageId??range.request.messageId)!==update.messageId){runtime.pendingSave='note-changed';continue;}
      const request=JSON.stringify(compactResponseBinding(runtime.request));
      const draft=await this.io.localFinalDraft?.(document,range.request)??document;
      if(draft!==document)await this.io.rememberNoteEdits?.(runtime.request,document,draft);
      const confirmed=(runtime.request.localSteering??[]).map(input=>({...input,confirmed:!!update.checkpoint?.bindings?.[input.messageId]&&!!update.displayedInputIds?.includes(input.messageId)}));
      document=completedSelectionDraft(draft,runtime.request.id,confirmed);range=this.range(document,runtime.request.id);
      if(!range){runtime.pendingSave='note-changed';return;}
      const body=await this.io.localFinalBody?.(update)??update.body;
      await this.io.rememberResponse?.(runtime.request,body,document.slice(0,range.from),document.slice(range.to),range.from);
      document=document.slice(0,range.from)+body+document.slice(range.to);changes.push({runtime,update,request,body});
    }
    if(!changes.length)return;
    const guard=()=>!this.closed&&changes.every(({runtime,update,request})=>!runtime.stopped&&!runtime.detached&&runtime.update===update&&runtime.request.notePath===path&&this.current(runtime)&&JSON.stringify(compactResponseBinding(runtime.request))===request)&&this.io.syncReady?.(path)!==false;
    if(diagnosticEnabled('response.save.prepared'))logEvent('response.save.prepared',{noteAlias:contentHash(path),bindingIds:changes.map(change=>change.runtime.request.id),attachments:changes.length,documentLength:current.length,proposedLength:document.length,elapsedMs:Date.now()-started});
    if(!guard()||!await this.notes.compareAndSet(path,current,document,guard)){for(const {runtime} of changes)runtime.pendingSave='note-changed';if(diagnosticEnabled('response.save.pending'))logEvent('response.save.pending',{noteAlias:contentHash(path),bindingIds:changes.map(change=>change.runtime.request.id),reason:'note-changed',attachments:changes.length});return;}
    for(const {runtime,body} of changes){
      if(runtime.request.localStage)await this.io.localEditSaved?.(runtime.request,document).catch(error=>logFailure('response.edit.receipt',error,{bindingId:runtime.request.id}));
      await this.settle(runtime,true,true,body);
    }
    streamMemory.sample('save',()=>({documentLength:document.length,attachmentCount:changes.length,elapsedMs:Date.now()-started,saveWorkerCount:this.finalWorkers.size,saveQueueCount:this.finalQueues.size}));
    if(diagnosticEnabled('response.save.verified'))logEvent('response.save.verified',{noteAlias:contentHash(path),bindingIds:changes.map(change=>change.runtime.request.id),attachments:changes.length,elapsedMs:Date.now()-started});
  }
  status(id:string):ResponseStopReceipt|undefined{
    const runtime=this.jobs.get(id);if(!runtime)return;
    const save=this.saveResult(runtime);
    return {version:1,bindingId:id,commandId:'',epoch:1,revision:1,hostRecorded:!!runtime.stopAcknowledged,runTerminal:!!runtime.update?.completionVerified&&['complete','interrupted'].includes(runtime.update.phase??''),finalSaved:runtime.saved===true,finalWriterPending:!!runtime.update?.completionVerified&&!runtime.update.questionsPending&&!runtime.done,...(!save.saved&&!runtime.done?{pendingSaveReason:save.reason}:{})};
  }
  stopLocally(id:string){this.stoppedIds.add(id);const runtime=this.jobs.get(id);if(runtime){runtime.stopped=true;runtime.preview.dispose();}}
  async stop(id:string,body?:string){
    const runtime=this.jobs.get(id);if(!runtime)throw Error('The response is not loaded.');
    const turnId=runtime.update?.turnId;this.stopLocally(id);
    runtime.stopBody=body??runtime.update?.body??'';
    let saveFailure:unknown;
    try{await this.saveStopped(runtime,runtime.stopBody);}catch(error){saveFailure=error;}
    let failure:unknown;
    try{if(!runtime.stopAcknowledged&&!runtime.update?.completionVerified)await interruptStoppedResponse(()=>this.io.access(runtime.request.threadEnvironmentId),id,runtime.request.threadId,turnId,10_000,runtime.request.localMessageId??runtime.request.messageId,runtime.request.projectId,runtime.request.createdAt);runtime.stopAcknowledged=true;}catch(error){failure=error;}
    if(failure)throw toError(failure);
    if(saveFailure)throw toError(saveFailure);
    return this.status(id)!;
  }
  async cancel(id:string){const runtime=this.jobs.get(id);if(!runtime)return;this.stopLocally(id);await this.saveStopped(runtime,'');}
  frozenBody(id:string){return this.jobs.get(id)?.stopBody;}
  async retrySave(binding:ResponseRequest,expectedHash:string,frozenBody?:string):Promise<LocalResponseSaveResult>{
    if(this.closed||binding.vaultId!==this.vaultId)throw Error('This reply is unavailable on this client.');
    const current=await this.notes.read(binding.notePath);if(current===undefined||contentHash(current)!==expectedHash)throw Error('The reviewed note changed.');
    if(!this.range(current,binding.id)){
      if(!await this.io.savedResponse?.(binding,current))throw Error('The reply anchor is missing. No content was replaced.');
      if(this.closed||await this.notes.read(binding.notePath)!==current)throw Error('The reviewed note changed.');
      const prior=this.jobs.get(binding.id);
      if(prior&&localFinalIdentity(prior.request)!==localFinalIdentity(binding))throw Error('The response binding changed.');
      const runtime=this.adopt(binding);
      if(!this.current(runtime)||JSON.stringify(compactResponseBinding(runtime.request))!==JSON.stringify(compactResponseBinding(binding)))throw Error('The response binding changed.');
      await this.settle(runtime,true,false);return this.saveResult(runtime);
    }
    const prior=this.jobs.get(binding.id),body=prior?.stopBody??frozenBody;
    if(prior?.stopped&&body===undefined)throw Error('The frozen reply is unavailable on this device.');
    const runtime=this.adopt(binding);
    if(body!==undefined){runtime.stopBody=body;this.stopLocally(binding.id);await this.saveStopped(runtime,body,expectedHash);return this.saveResult(runtime);}
    runtime.retryAt=0;runtime.attemptRevision=undefined;this.finish(runtime);return this.waitForSave(binding.id);
  }
  private async saveStopped(runtime:Runtime,body:string,expectedHash?:string){
    await runtime.work;if(runtime.done)return;
    return this.writeNote(runtime.request.notePath,()=>this.saveStoppedNote(runtime,body,expectedHash));
  }
  private async saveStoppedNote(runtime:Runtime,body:string,expectedHash?:string){
    if(this.closed||runtime.done)return;
    const path=runtime.request.notePath,current=await this.notes.read(path);if(current===undefined)throw Error('The frozen response note is unavailable.');
    if(expectedHash!==undefined&&contentHash(current)!==expectedHash)throw Error('The reviewed note changed.');
    const document=await this.io.localFinalDraft?.(current,this.range(current,runtime.request.id)?.request??runtime.request)??current;
    if(document!==current)await this.io.rememberNoteEdits?.(runtime.request,current,document);
    const range=this.range(document,runtime.request.id);
    if(!range&&runtime.request.localStage)throw Error('The reply was removed before its proposed note edit could be saved. The proposal is retained.');
    if(range)await this.io.rememberResponse?.(runtime.request,body,document.slice(0,range.from),document.slice(range.to),range.from);
    const after=range?document.slice(0,range.from)+body+document.slice(range.to):document;
    if(range&&!await this.notes.compareAndSet(path,current,after))throw Error('The frozen response is waiting for its local save.');
    if(range?.request.localStage)await this.io.localEditSaved?.(range.request,after).catch(error=>logFailure('response.edit.receipt',error));
    await this.settle(runtime,!!range,true,body);
  }
  private async changeBinding(id:string,change:(request:ResponseRequest)=>ResponseRequest){
    const runtime=this.jobs.get(id);if(!runtime||runtime.done||runtime.stopped)throw Error('The response is no longer active.');
    const before=runtime.request,next=change(before),document=await this.io.readNote(before.notePath);
    if(document===undefined||!this.range(document,id))throw Error('The response block is missing.');
    if(!this.io.saveLocalBinding)throw Error('Shared response storage is unavailable.');
    await this.io.saveLocalBinding(next);this.adopt(next);
  }
  follow(id:string,messageId:string,_path?:string,previousMessageId?:string){return this.changeBinding(id,request=>{if(previousMessageId&&previousMessageId!==(request.localMessageId??request.messageId))throw Error('The response has advanced to another message.');return {...request,localMessageId:messageId};});}
  steer(id:string,input:SteeringInput){
    if(!validSteeringInput(input))throw Error('Invalid response steering input.');
    const existing=this.jobs.get(id)?.request.localSteering?.find(item=>item.messageId===input.messageId);
    if(existing){if(existing.text!==input.text||JSON.stringify([existing.selection,existing.selections,existing.sourceResponseId])!==JSON.stringify([input.selection,input.selections,input.sourceResponseId]))throw Error('This steering ID already belongs to another message.');return Promise.resolve();}
    return this.changeBinding(id,request=>({...request,localSteering:[...request.localSteering??[],{...input,confirmed:false,before:this.jobs.get(id)?.preview.steeringProse?.()??[]}]}));
  }
  discardSteering(id:string,messageId:string){
    const request=this.jobs.get(id)?.request;
    if(!request?.localSteering?.some(input=>input.messageId===messageId&&!input.confirmed))return Promise.resolve();
    return this.changeBinding(id,request=>({...request,localSteering:request.localSteering?.filter(input=>input.messageId!==messageId||input.confirmed)}));
  }
  renamed(before:string,after:string){
    for(const request of [...this.stored(),...[...this.jobs.values()].map(runtime=>runtime.request)]){const path=this.destination(request);if(path===before||path.startsWith(before+'/')){const old=this.moves.get(request.id),from=old?.from??new Set<string>();from.add(request.notePath);from.add(path);this.moves.set(request.id,{from,to:after+path.slice(before.length)});}}for(const [path,note] of [...this.recoveryNotes])if(path===before||path.startsWith(before+'/')){note.version++;this.recoveryNotes.delete(path);this.recoveryNotes.set(after+path.slice(before.length),{...note,pending:true,retryAt:0});}for(const runtime of this.jobs.values())if(runtime.request.notePath===before||runtime.request.notePath.startsWith(before+'/')){runtime.request={...runtime.request,notePath:after+runtime.request.notePath.slice(before.length)};runtime.retryAt=0;}}
  deleted(path:string){for(const [notePath,note] of this.recoveryNotes)if(notePath===path||notePath.startsWith(path+'/')){note.version++;note.pending=false;}for(const runtime of this.jobs.values())if(runtime.request.notePath===path||runtime.request.notePath.startsWith(path+'/'))this.stopLocally(runtime.request.id);}
  responses(){return [...this.jobs.values()].filter(runtime=>!runtime.stopped&&!runtime.detached&&(!runtime.done||runtime.update?.completionVerified&&runtime.update.phase==='complete')).map(runtime=>({id:runtime.request.id,notePath:runtime.request.notePath,epoch:1,revision:1,completionId:JSON.stringify([runtime.update?.messageId??runtime.request.localMessageId??runtime.request.messageId,runtime.update?.turnId??'']),completion:completionSource(runtime.request,runtime.update?.turnId?runtime.update.checkpoint?.turns?.[runtime.update.turnId]??(runtime.request.importTurn?.turnId===runtime.update.turnId?runtime.request.importTurn:undefined):undefined),active:!runtime.update?.completionVerified&&runtime.update?.phase!=='error',input:!!runtime.update?.questionsPending||!runtime.update?.completionVerified&&!!runtime.update?.questionActivities?.length,complete:!!runtime.update?.completionVerified&&!runtime.update.questionsPending&&runtime.update.phase==='complete'}));}
  health(){return {...this.sources.status(),attachments:this.jobs.size,saveQueued:[...this.finalQueues.values()].reduce((n,queue)=>n+queue.size,0),saveWorkers:this.finalWorkers.size,pending:[...this.jobs.values()].filter(runtime=>!runtime.done).map(runtime=>({bindingId:runtime.request.id,reason:this.saveResult(runtime)})).slice(0,64)};}
  dispose(){this.closed=true;this.sources.dispose();for(const resolve of this.finalWaiters.values())resolve();this.finalWaiters.clear();for(const runtime of this.jobs.values())runtime.preview.dispose();this.jobs.clear();}
}
