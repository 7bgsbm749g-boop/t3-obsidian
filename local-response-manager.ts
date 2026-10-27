import {DirectInlinePreview,type DirectInlineUpdate} from './direct-inline-preview';
import {localResponseBindings,localResponseRange,withoutLocalResponseBinding} from './local-response-binding';
import {compactResponseBinding} from './response-binding-data';
import type {ResponseRequest} from './response-model';
import type {ResponseRecord} from './response-record';
import type {InlineStartRequest} from './inline-thread';
import type {DeviceResponseIO} from './device-local-responses';
import {logFailure} from './diagnostics';
import type {ResponseStopReceipt} from './response-stop-receipt';
import {localFinalIdentity} from './local-final-cache';
import {completionSource} from './explorer-responses';
import {interruptStoppedResponse} from './response-stop';
import {completedSelectionDraft,validSteeringInput,type SteeringInput} from './inline-steering';
import type {ResponseConnectionIssue} from './sign-in-state';
import type {LocalResponseSaveResult,LocalSavePendingReason} from './local-response-save';

export interface LocalFinalNoteIO {
  read(path:string):Promise<string|undefined>;
  compareAndSet(path:string,before:string,after:string,guard?:()=>boolean):Promise<boolean>;
}
type Runtime={request:ResponseRequest;record:ResponseRecord;preview:DirectInlinePreview;update?:DirectInlineUpdate;retained?:Promise<void>;work?:Promise<void>;stopped?:boolean;stopAcknowledged?:boolean;done?:boolean;saved?:boolean;pendingSave?:LocalSavePendingReason;retryAt:number};
/** A loaded anchor and its synced settings record reconnect independently of
 * any remote writer. Identical device final writes converge through Sync. */
export class LocalResponseManager {
  private jobs=new Map<string,Runtime>();
  private migrations=new Map<string,Promise<void>>();
  private documents=new Map<string,{document:string;stored:readonly ResponseRequest[];bindings:ResponseRequest[]}>();
  private closed=false;
  constructor(private actor:string,private vaultId:string,private io:DeviceResponseIO,private notes:LocalFinalNoteIO,private now=()=>Date.now(),private makePreview=(record:ResponseRecord,access:()=>ReturnType<DeviceResponseIO['access']>,receive:(update:DirectInlineUpdate)=>void,connection:(issue?:ResponseConnectionIssue)=>void)=>new DirectInlinePreview(record,access,receive,undefined,undefined,connection)){}
  has(id:string){return this.jobs.has(id);}
  request(id:string){return this.jobs.get(id)?.request;}
  record(id:string){return this.jobs.get(id)?.record;}
  private stored(){return this.io.localBindings?.()??[];}
  private range(document:string,id:string){return localResponseRange(document,id,this.stored());}
  private adopt(request:ResponseRequest){
    if(this.jobs.get(request.id)?.done){this.jobs.delete(request.id);}
    const old=this.jobs.get(request.id);if(old){
      if(JSON.stringify(compactResponseBinding(old.request))!==JSON.stringify(compactResponseBinding(request))){
        const changed=localFinalIdentity(old.request)!==localFinalIdentity(request);
        old.request=request;old.record={...old.record,revision:old.record.revision+1,request,state:{...old.record.state!,notePath:request.notePath,messageId:request.localMessageId??request.messageId,steering:request.localSteering}};old.preview.update(old.record);
        void Promise.resolve(this.io.receiveCoordinated?.(old.record)).catch(error=>logFailure('response.local.update',error,{bindingId:request.id}));
        if(changed){old.update=undefined;old.preview.reconnect(this.io.isOpen(request.notePath));}
      }
      return old;
    }
    const record:ResponseRecord={request,epoch:1,revision:1,owner:this.actor,expiresAt:0,coordinated:true,state:{...request.localResume,requestHash:'',accepted:true,notePath:request.notePath,messageId:request.localMessageId??request.messageId,steering:request.localSteering,status:'waiting',hashes:[],updatedAt:request.createdAt}};
    const runtime={request,record,retryAt:0} as Runtime;
    runtime.preview=this.makePreview(record,()=>this.io.access(request.threadEnvironmentId),update=>{
      if(this.closed||runtime.done||runtime.stopped)return;
      const same=runtime.update?.completionVerified&&update.completionVerified&&runtime.update.turnId===update.turnId&&runtime.update.messageId===update.messageId&&runtime.update.body===update.body&&runtime.update.phase===update.phase;
      if(!same)runtime.update=update;this.io.receiveDirect?.(update);
      runtime.record.state={...runtime.record.state!,body:update.body,status:update.phase==='error'?'error':update.phase??'running',turnId:update.turnId,bindingCheckpoint:update.checkpoint};
      if(update.questionActivities)this.io.localQuestions?.(update);
      if(update.completionVerified&&['complete','interrupted'].includes(update.phase??'')){
        if(!same)runtime.retained=this.io.retainLocalFinal?.(update).catch(error=>logFailure('response.local.final-cache',error,{bindingId:request.id}));
        this.finish(runtime);
      }
    },issue=>{if(!this.closed&&!runtime.done&&!runtime.stopped)this.io.localConnection?.(request.id,issue);});
    this.jobs.set(request.id,runtime);
    void Promise.resolve(this.io.receiveCoordinated?.(record)).catch(error=>logFailure('response.local.adopt',error,{bindingId:request.id}));
    void this.io.loadLocalFinal?.(request).then(update=>{if(!update||this.closed||runtime.done||runtime.stopped||runtime.update?.completionVerified)return;runtime.update={...update,request:runtime.record.request};this.io.receiveDirect?.(runtime.update);this.finish(runtime);}).catch(error=>logFailure('response.local.final-restore',error,{bindingId:request.id}));
    return runtime;
  }
  async register(request:ResponseRequest){
    if(this.closed||request.vaultId!==this.vaultId)throw Error('This response belongs to another vault.');
    const current=await this.io.readNote(request.notePath);if(current===undefined)throw Error('The response note is unavailable.');
    if(!localResponseRange(current,request.id,[request]))throw Error('The response block changed before registration.');
    if(!this.io.saveLocalBinding)throw Error('Shared response storage is unavailable.');
    // Persist the settings record before removing any older in-note record.
    await this.io.saveLocalBinding(request);
    if(this.closed)return;
    const after=withoutLocalResponseBinding(current,request.id);
    if(after!==current){
      const saved=await this.io.updateNote(request.notePath,value=>{if(value!==current)throw Error('The response note changed before registration.');return after;},()=>!this.closed);
      if(saved!==after)throw Error('Save the response note before sending.');
      await this.io.saveLocalNote?.(request.notePath);
    }
    const runtime=this.adopt(request);runtime.preview.tick(this.canFinishClosed(runtime)||this.io.isOpen(request.notePath));
  }
  delivered(id:string,delivery:InlineStartRequest){this.jobs.get(id)?.preview.delivery(delivery);}
  resume(){
    if(this.closed)return;
    const documents=this.io.openedNotes?.()??[],locations=new Map<string,ResponseRequest[]>(),stored=this.stored();
    for(const path of this.documents.keys())if(!documents.some(note=>note.path===path))this.documents.delete(path);
    for(const {path,document} of documents){
      let cached=this.documents.get(path);
      if(!cached||cached.document!==document||cached.stored!==stored){cached={document,stored,bindings:localResponseBindings(document,stored)};this.documents.set(path,cached);}
      for(const binding of cached.bindings){
      if(binding.vaultId!==this.vaultId)continue;
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
    for(const [id,bindings] of locations){
      if(bindings.length!==1){this.jobs.get(id)?.preview.suspend();continue;}
      const runtime=this.adopt(bindings[0]);if(!runtime.done&&!runtime.stopped)runtime.preview.tick(true);
    }
    for(const runtime of this.jobs.values()){
      const loaded=locations.get(runtime.request.id);
      if(!loaded){
        // Imported runs may complete through checked file IO after their tab
        // closes. Ordinary replies keep their existing open-editor boundary.
        if(!runtime.done&&!runtime.stopped&&!runtime.update?.completionVerified)runtime.preview.tick(true);
        else runtime.preview.suspend();
        if(!runtime.done&&!this.migrations.has(runtime.request.id)&&documents.some(note=>note.path===runtime.request.notePath)){runtime.done=true;runtime.preview.dispose();this.io.localCompleted?.(runtime.request.id,runtime.request.notePath);}
        if(!runtime.done&&this.canFinishClosed(runtime)&&runtime.update?.completionVerified)this.finish(runtime);
        continue;
      }
      if(loaded.length===1&&runtime.update?.completionVerified)this.finish(runtime);
    }
  }
  tick(){this.resume();}
  reconnect(){if(this.closed)return;for(const runtime of this.jobs.values())if(!runtime.done&&!runtime.stopped)runtime.preview.reconnect(this.io.isOpen(runtime.request.notePath));this.resume();}
  private canFinishClosed(runtime:Runtime){return !!runtime.request.importTurn;}
  private saveResult(runtime?:Runtime):LocalResponseSaveResult {
    if(this.closed||!runtime)return {saved:false,reason:'plugin-unavailable'};
    if(runtime.saved)return {saved:true};
    if(runtime.done)return {saved:false,reason:'note-changed'};
    if(runtime.stopped)return {saved:false,reason:'stopped'};
    if(!runtime.update?.completionVerified)return {saved:false,reason:'verification'};
    if(this.io.syncReady?.(runtime.request.notePath)===false)return {saved:false,reason:'sync'};
    if(!this.canFinishClosed(runtime)&&!this.io.isOpen(runtime.request.notePath))return {saved:false,reason:'note-closed'};
    return {saved:false,reason:runtime.pendingSave??'saving'};
  }
  /** Imports report success only after the checked note write. The bounded
   * wait leaves the registered response running when Sync or verification waits. */
  async waitForSave(id:string,timeoutMs=15_000):Promise<LocalResponseSaveResult>{
    const deadline=Date.now()+Math.max(0,timeoutMs);
    for(;;){
      const runtime=this.jobs.get(id);if(runtime)this.finish(runtime);
      const result=this.saveResult(runtime);
      if(result.saved||!runtime||runtime.done||runtime.stopped||this.closed||Date.now()>=deadline)return result;
      await new Promise<void>(resolve=>setTimeout(resolve,Math.min(100,Math.max(1,deadline-Date.now()))));
    }
  }
  private finish(runtime:Runtime){
    if(this.closed||runtime.done||runtime.stopped||runtime.work||this.now()<runtime.retryAt||!this.canFinishClosed(runtime)&&!this.io.isOpen(runtime.request.notePath)||this.io.syncReady?.(runtime.request.notePath)===false)return;
    const update=runtime.update;if(!update?.completionVerified)return;
    runtime.pendingSave='saving';
    runtime.work=(async()=>{
      await runtime.retained;
      const path=runtime.request.notePath,current=await this.notes.read(path);
      if(current===undefined){runtime.pendingSave='note-unavailable';return;}
      if(this.closed||runtime.stopped||!this.canFinishClosed(runtime)&&!this.io.isOpen(path)||this.io.syncReady?.(path)===false)return;
      if(!this.range(current,runtime.request.id)){runtime.done=true;runtime.saved=!!update.body&&current.includes(update.body);runtime.preview.dispose();this.io.localCompleted?.(runtime.request.id,path);return;}
      let document=await this.io.localFinalDraft?.(current,this.range(current,runtime.request.id)!.request)??current;
      const confirmed=(runtime.request.localSteering??[]).map(input=>({...input,confirmed:!!update.checkpoint?.bindings?.[input.messageId]}));
      document=completedSelectionDraft(document,runtime.request.id,confirmed);
      const range=this.range(document,runtime.request.id);
      // Incoming final text or explicit deletion ends this local attachment.
      if(!range){runtime.done=true;runtime.preview.dispose();this.io.localCompleted?.(runtime.request.id,path);return;}
      if(range.request.threadId!==runtime.request.threadId||(range.request.localMessageId??range.request.messageId)!==update.messageId){runtime.pendingSave='note-changed';return;}
      const body=await this.io.localFinalBody?.(update)??update.body;
      await this.io.rememberResponse?.(runtime.request,body,document.slice(0,range.from),document.slice(range.to),range.from);
      if(this.closed||runtime.stopped||runtime.update!==update||runtime.request.notePath!==path||this.io.syncReady?.(path)===false||JSON.stringify(this.range(document,runtime.request.id)?.request)!==JSON.stringify(range.request)){runtime.pendingSave='note-changed';return;}
      const after=document.slice(0,range.from)+body+document.slice(range.to);
      const expected=JSON.stringify(range.request),guard=()=>!this.closed&&!runtime.stopped&&runtime.update===update&&runtime.request.notePath===path&&this.io.syncReady?.(path)!==false&&JSON.stringify(this.range(document,runtime.request.id)?.request)===expected;
      if(!await this.notes.compareAndSet(path,current,after,guard)){runtime.pendingSave='note-changed';return;}
      runtime.done=true;runtime.saved=true;runtime.preview.dispose();this.io.localCompleted?.(runtime.request.id,path);
    })().catch(error=>{runtime.pendingSave='save-error';logFailure('response.local.final-save',error,{bindingId:runtime.request.id});this.io.completionFailed?.(error,runtime.request.id);}).finally(()=>{runtime.work=undefined;runtime.retryAt=this.now()+1000;});
  }
  status(id:string):ResponseStopReceipt|undefined{
    const runtime=this.jobs.get(id);if(!runtime)return;
    const save=this.saveResult(runtime);
    return {version:1,bindingId:id,commandId:'',epoch:1,revision:1,hostRecorded:!!runtime.stopAcknowledged,runTerminal:!!runtime.update?.completionVerified&&['complete','interrupted'].includes(runtime.update.phase??''),finalSaved:!!runtime.done,finalWriterPending:!!runtime.update?.completionVerified&&!runtime.done,...(!save.saved&&!runtime.done?{pendingSaveReason:save.reason}:{})};
  }
  stopLocally(id:string){const runtime=this.jobs.get(id);if(runtime){runtime.stopped=true;runtime.preview.dispose();}}
  async stop(id:string,body?:string){
    const runtime=this.jobs.get(id);if(!runtime)throw Error('The response is not loaded.');
    const turnId=runtime.update?.turnId;this.stopLocally(id);
    await this.saveStopped(runtime,body??runtime.update?.body??'');
    let failure:unknown;
    try{if(!runtime.stopAcknowledged&&!runtime.update?.completionVerified)await interruptStoppedResponse(()=>this.io.access(runtime.request.threadEnvironmentId),id,runtime.request.threadId,turnId,10_000,runtime.request.localMessageId??runtime.request.messageId,runtime.request.projectId,runtime.request.createdAt);runtime.stopAcknowledged=true;}catch(error){failure=error;}
    if(failure)throw failure;
    return this.status(id)!;
  }
  async cancel(id:string){const runtime=this.jobs.get(id);if(!runtime)return;this.stopLocally(id);await this.saveStopped(runtime,'');}
  private async saveStopped(runtime:Runtime,body:string){
    await runtime.work;if(runtime.done)return;
    const path=runtime.request.notePath,current=await this.notes.read(path);if(current===undefined)throw Error('The frozen response note is unavailable.');
    const range=this.range(current,runtime.request.id);
    if(range)await this.io.rememberResponse?.(runtime.request,body,current.slice(0,range.from),current.slice(range.to),range.from);
    if(range&&!await this.notes.compareAndSet(path,current,current.slice(0,range.from)+body+current.slice(range.to)))throw Error('The frozen response is waiting for its local save.');
    runtime.done=true;this.io.localCompleted?.(runtime.request.id,path);
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
    if(existing){if(existing.text!==input.text||JSON.stringify(existing.selection)!==JSON.stringify(input.selection))throw Error('This steering ID already belongs to another message.');return Promise.resolve();}
    return this.changeBinding(id,request=>({...request,localSteering:[...request.localSteering??[],{...input,confirmed:false,before:this.jobs.get(id)?.preview.steeringProse?.()??[]}]}));
  }
  discardSteering(id:string,messageId:string){
    const request=this.jobs.get(id)?.request;
    if(!request?.localSteering?.some(input=>input.messageId===messageId&&!input.confirmed))return Promise.resolve();
    return this.changeBinding(id,request=>({...request,localSteering:request.localSteering?.filter(input=>input.messageId!==messageId||input.confirmed)}));
  }
  renamed(before:string,after:string){for(const runtime of this.jobs.values())if(runtime.request.notePath===before||runtime.request.notePath.startsWith(before+'/')){runtime.request={...runtime.request,notePath:after+runtime.request.notePath.slice(before.length)};runtime.retryAt=0;}}
  deleted(path:string){for(const runtime of this.jobs.values())if(runtime.request.notePath===path||runtime.request.notePath.startsWith(path+'/'))this.stopLocally(runtime.request.id);}
  responses(){return [...this.jobs.values()].filter(runtime=>!runtime.stopped&&(!runtime.done||runtime.update?.completionVerified&&runtime.update.phase==='complete')).map(runtime=>({id:runtime.request.id,notePath:runtime.request.notePath,epoch:1,revision:1,completionId:JSON.stringify([runtime.update?.messageId??runtime.request.localMessageId??runtime.request.messageId,runtime.update?.turnId??'']),completion:completionSource(runtime.request,runtime.update?.turnId?runtime.update.checkpoint?.turns?.[runtime.update.turnId]??(runtime.request.importTurn?.turnId===runtime.update.turnId?runtime.request.importTurn:undefined):undefined),active:!runtime.update?.completionVerified&&runtime.update?.phase!=='error',input:!runtime.update?.completionVerified&&!!runtime.update?.questionActivities?.length,complete:!!runtime.update?.completionVerified&&runtime.update.phase==='complete'}));}
  dispose(){this.closed=true;for(const runtime of this.jobs.values())runtime.preview.dispose();this.jobs.clear();}
}
