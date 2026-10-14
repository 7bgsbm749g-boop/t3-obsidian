import {explorerResponsePath,leaseExplorerResponse,loadExplorerResponses,relocateExplorerResponses,type ExplorerResponse} from './explorer-responses';
import {contentHash} from './completion';
import {HostedInlineWriter,hostedPaths,validateHostedRequest,pendingCompletionCleanup,type HostedInlineRequest,type HostedInlineState,type InlineFiles,type InlineHostTarget} from './hosted-inline';
import {InlineLeaseClient,HEARTBEAT_MS,deviceOriginalPath,deviceStagedPath,leasePaths,terminalLease,type LeaseRecord,type LeaseReply} from './inline-lease';
import {applyThreadItem,inlineTurnMessages,inlineBindingCheckpoint,restoreInlineBindings,turnForMessage,hasCompletionProof,hasResponseMarkers,regionBody,type InlineThreadState,type InlineStartRequest} from './inline-thread';
import {readInlineEvents,readInlineSnapshot,watchThread,type ThreadAccess,type ThreadStreamItem,type ThreadAccessCloseReason} from './thread-stream';
import {ThreadAccessCache} from './thread-access-cache';
import type {ReplyReference} from './reply-assets';
import type {SteeringInput} from './inline-steering';
import {logEvent,logFailure} from './diagnostics';
import {nativeCommitPath,readNativeCommitProof,type NativeCommitProof} from './native-response-commit';
import {rewriteReplyReferences} from './reply-assets';
import {ThreadTitleFeed} from './thread-title-feed';
import {DirectInlinePreview,type DirectInlineUpdate} from './direct-inline-preview';
import {commandId} from './direct';
import {responseStopReceipt,stoppedBodyPath,stoppedBodyReference,validResponseStopReceipt,type ResponseStopReceipt} from './response-stop-receipt';
import type {FinalAttemptAbort} from './completion-attempt';
import {T3ConnectionTimeoutError} from './t3-rpc';
import {finalResponseKey} from './final-response';
import {responseTooLarge,T3ResponseTooLargeError} from './t3-response-limits';
import {LocalResponseManager,type LocalFinalNoteIO} from './local-response-manager';
import {localStagePaths} from './local-response-staging';
import {responseAnchor,responseRegion} from './native-response-projection';

export const INLINE_SNAPSHOT_INTERVAL_MS=10_000;
export const INLINE_SNAPSHOT_TIMEOUT_MS=30_000;

export interface PendingResponseRename {id:string;actor:string;bindingId:string;host:InlineHostTarget;before:string;after:string}
export interface DeviceInlineIO {
  localFinalNotes?:LocalFinalNoteIO;
  openedNotes?():Array<{path:string;document:string}>;
  saveLocalNote?(path:string):Promise<void>;
  syncReady?():boolean;
  localCompleted?(id:string,path:string):void;
  localFinalBody?(update:DirectInlineUpdate):Promise<string>;
  localFinalDraft?(document:string,request:HostedInlineRequest):Promise<string>;
  retainLocalFinal?(update:DirectInlineUpdate):Promise<void>;
  loadLocalFinal?(request:HostedInlineRequest):Promise<DirectInlineUpdate|undefined>;
  allowLocalMigration?(id:string,path:string):Promise<void>;
  localQuestions?(update:DirectInlineUpdate):void;
  connectionTimeout?(target:InlineHostTarget,error:T3ConnectionTimeoutError):void;
  connectionRecovered?(target:InlineHostTarget):void;
  completionActor?:string;
  completeResponse?(record:LeaseRecord,original:string,staged:string|undefined,prepare:(proof:NativeCommitProof)=>Promise<void>,abort?:(proof:NativeCommitProof,evidence:FinalAttemptAbort)=>Promise<void>):Promise<NativeCommitProof|undefined>;
  completionFailed?(error:unknown,id:string):void;
  completionAcknowledged?(record:LeaseRecord):void|Promise<void>;
  loadStops?():string[];
  saveStops?(ids:string[]):void;
  loadRenames?():PendingResponseRename[];
  saveRenames?(renames:PendingResponseRename[]):void;
  receiveCoordinated?(record:LeaseRecord,proofBytes?:string):void|Promise<void>;
  receiveDirect?(update:DirectInlineUpdate):void;
  receiveThreadTitle?(id:string,title:string):void;
  readSaved?(path:string):Promise<string|undefined>;
  access(environmentId:string,reason?:ThreadAccessCloseReason):Promise<ThreadAccess>;
  readNote(path:string):Promise<string|undefined>;
  locateNote?(id:string,path:string):Promise<string|undefined>;
  noteChanged?(path:string):void;
  noteRenamed?(before:string,after:string):void;
  noteDeleted?(path:string):void;
  isOpen(path:string):boolean;
  isSaved?(path:string,hash:string,proof?:{id:string;body:string;cleaned?:boolean}):Promise<boolean>;
  updateNote(path:string,change:(current:string)=>string,allowed:()=>boolean):Promise<string|undefined>;
  resolveReplyReference?(reference:ReplyReference,request:HostedInlineRequest,access:ThreadAccess):Promise<string|undefined>;
}
type SnapshotRefresh={epoch:number;startedAt:number;work:Promise<InlineThreadState|undefined>;cancel(error:Error):void};
type Runtime={snapshotBlocked?:boolean;original?:string;finalUpdate?:DirectInlineUpdate;finalWork?:Promise<void>;nextFinal?:number;nextPresence?:number;finalFailure?:string;record:LeaseRecord;host:Host;writer:HostedInlineWriter;work?:Promise<void>;heartbeat?:Promise<void>;lastHeartbeat:number;maintenanceFailures?:number;nextTick:number;nextSnapshot:number;snapshotFailures:number;refresh?:SnapshotRefresh;writeEpoch?:number;state?:InlineThreadState;awaitingNote?:boolean;sequence:number;monitor?:{stop():void};proof?:{hash:string;bytes:string};observedBytes?:string;observedRecord?:LeaseRecord};
type Host={target:InlineHostTarget;files:InlineFiles;client:InlineLeaseClient;stopReceipts?:Promise<boolean>;close():void;discovery?:Promise<void>;lastDiscovery:number;priorityDiscovery?:Promise<void>;priorityKey?:string;lastPriorityDiscovery?:number;responses:ExplorerResponse[]};
const hostKey=(target:InlineHostTarget)=>JSON.stringify([target.environmentId,target.workspaceRoot,target.directory]);
const comparable=(state:HostedInlineState|undefined)=>state?JSON.stringify({...state,updatedAt:''}):'';

/** One writer per granted epoch. Disposing or backgrounding never releases it:
 * only missing heartbeats allow another instance to take ownership. */
export class DeviceInlineManager {
  private local?:LocalResponseManager;
  private localMigrations=new Set<string>();
  private stopped=false;
  private localStops=new Set<string>();
  private stops=new Map<string,Promise<ResponseStopReceipt>>();
  private frozenBodies=new Map<string,string>();
  private statuses=new Map<string,ResponseStopReceipt>();
  private renames:PendingResponseRename[];
  private renameWork?:Promise<void>;
  private nextRenameRetry=0;
  private hosts=new Map<string,Host>();
  private jobs=new Map<string,Runtime>();
  private bindings=new Map<string,{host:Host;notePath:string;coordinated:boolean;stopped:boolean;removed?:boolean}>();
  private previews=new Map<string,DirectInlinePreview>();
  private accessCache=new ThreadAccessCache((environmentId,reason)=>this.io.access(environmentId,reason),()=>this.now());
  private titles?:ThreadTitleFeed;
  constructor(readonly actor:string,private vaultId:string,private io:DeviceInlineIO,private open:(target:InlineHostTarget)=>Promise<{files:InlineFiles;readonly closed?:boolean;close():void}>,private now=()=>Date.now(),private monotonic=()=>performance.now(),private pause?:(milliseconds:number)=>Promise<void>){const stops=io.loadStops?.();this.localStops=new Set(Array.isArray(stops)?stops:[]);const saved=io.loadRenames?.();this.renames=Array.isArray(saved)?saved:[];for(const rename of this.renames)this.host(rename.host);if(io.receiveThreadTitle)this.titles=new ThreadTitleFeed(environmentId=>io.access(environmentId),(id,title)=>io.receiveThreadTitle!(id,title));}
  private host(target:InlineHostTarget){
    const key=hostKey(target),existing=this.hosts.get(key);if(existing)return existing;
    let connection:Promise<{files:InlineFiles;readonly closed?:boolean;close():void}>|undefined;
    const perform=async<T>(fn:(files:InlineFiles)=>Promise<T>,retryRead=false):Promise<T>=>{
      for(let attempt=0; ;attempt++){
      const opened=connection??=this.open(target).then(value=>{
        if(value.files.dispatch)files.dispatch=command=>perform(io=>io.dispatch?.(command)??Promise.resolve());
        else delete files.dispatch;
        return value;
      });
      try{const result=await fn((await opened).files);this.io.connectionRecovered?.(target);return result;}catch(error){
        // A file/RPC failure belongs to this operation. Only replace a dead
        // transport; closing a healthy shared socket cancels unrelated sends.
        const value=await opened.catch(()=>undefined);
        if(!value||value.closed===true){if(connection===opened)connection=undefined;value?.close();}
        if(error instanceof T3ConnectionTimeoutError)this.io.connectionTimeout?.(target,error);
        // Reads are safe to repeat once on a new transport. Writes and prompt
        // dispatch retain their original uncertain result and durable identity.
        if(retryRead&&attempt===0&&(!value||value.closed===true)&&!this.stopped)continue;
        throw error;
      }
      }
    };
    const files:InlineFiles={read:path=>perform(io=>io.read(path),true),write:(path,value)=>perform(io=>io.write(path,value))};
    const host:Host={target,files,client:new InlineLeaseClient(this.actor,files,target.directory,this.now,this.monotonic,this.pause),lastDiscovery:0,responses:[],close:()=>{host.client.dispose();void connection?.then(value=>value.close()).catch(()=>{});}};
    this.hosts.set(key,host);return host;
  }
  private access(environmentId:string){
    return this.accessCache.get(environmentId);
  }
  async register(request:HostedInlineRequest){
    if(this.stopped)throw Error('The plugin stopped before registering the response.');
    if(request.localOnly){
      if(!this.io.localFinalNotes)throw Error('Local response saves are unavailable.');
      this.local??=new LocalResponseManager(this.io.completionActor??this.actor,this.vaultId,this.io,this.io.localFinalNotes,this.now);
      return this.local.register(request);
    }
    const host=this.host(request.host);let original:string|undefined;
    if(request.version===4&&request.nativeProjection&&!request.deviceCompletion&&this.io.completeResponse){
      const previous=await host.files.read(leasePaths(host.target.directory,request.id).record);
      if(previous){const registered:LeaseRecord=JSON.parse(previous);if(registered.request.deviceCompletion)request.deviceCompletion=registered.request.deviceCompletion;}
      else{
        const raw=await host.files.read(`${host.target.directory}/coordinated-capabilities.json`);
        if(raw&&JSON.parse(raw).deviceCompletion===1){
          original=await this.io.readNote(request.notePath);if(original===undefined)throw Error('Save the response destination before registration.');
          request.deviceCompletion={version:1,actor:this.io.completionActor??this.actor,originalHash:contentHash(original)};
        }
      }
    }
    const reply=await host.client.command({kind:'register',jobId:request.id,request,...(original!==undefined?{original}:{})});
    if(!reply.ok||!reply.record)throw Error(reply.error??'Response registration failed.');
    this.receiveRecord(host,reply.record);const runtime=this.jobs.get(request.id);if(runtime){runtime.lastHeartbeat=this.now();if(original!==undefined)runtime.original=original;}this.tick();
  }
  async delivered(target:InlineHostTarget,id:string,delivery:InlineStartRequest){
    if(this.local?.has(id)){this.local.delivered(id,delivery);return;}
    this.previews.get(id)?.delivery(delivery);
    const host=this.host(target),reply=await host.client.command({kind:'delivery',jobId:id,delivery});
    if(!reply.ok||!reply.record)throw Error(reply.error??'Could not retain the prompt delivery evidence.');
    this.receiveRecord(host,reply.record);this.tick();
  }
  stopLocally(id:string){
    this.local?.stopLocally(id);
    this.localStops.add(id);this.io.saveStops?.([...this.localStops]);
    this.previews.get(id)?.dispose();this.previews.delete(id);
  }
  async failResponse(target:InlineHostTarget,id:string){
    if(this.local?.has(id))return this.local.cancel(id);
    this.stopLocally(id);
    const host=this.host(target);
    // This survives a registration acknowledgement arriving after failure.
    await host.files.write(hostedPaths(target.directory,id).stop,JSON.stringify({id,discardResponse:true,requestedAt:new Date(this.now()).toISOString()}));
    const reply=await host.client.command({kind:'stop',jobId:id,discardResponse:true});
    if(reply.record)this.receiveRecord(host,reply.record);
    if(!reply.ok)throw Error(reply.error??'Could not confirm failed response cleanup.');
    this.tick();
  }
  stopResponse(target:InlineHostTarget,id:string,stoppedBody?:string,operationId=commandId(id,'stop')):Promise<ResponseStopReceipt>{
    if(this.local?.has(id)){
      const key=hostKey(target)+':'+id,previous=this.stops.get(key);if(previous)return previous;
      const work=this.local.stop(id,stoppedBody);this.stops.set(key,work);
      void work.finally(()=>{if(this.stops.get(key)===work)this.stops.delete(key);}).catch(()=>{});return work;
    }
    const key=hostKey(target)+':'+id,previous=this.stops.get(key);if(previous)return previous;
    const started=this.monotonic();
    const work=this.recordStop(target,id,stoppedBody,operationId).then(receipt=>{
      logEvent('response.stop.receipt',{bindingId:id,operationId,elapsedMs:Math.max(0,this.monotonic()-started),hostRecorded:receipt.hostRecorded,runTerminal:receipt.runTerminal,finalSaved:receipt.finalSaved,finalWriterPending:receipt.finalWriterPending,...(stoppedBody!==undefined?{bodyCharacters:stoppedBody.length}:{})});return receipt;
    });this.stops.set(key,work);
    void work.finally(()=>{if(this.stops.get(key)===work)this.stops.delete(key);}).catch(()=>{});return work;
  }
  private async recordStop(target:InlineHostTarget,id:string,stoppedBody:string|undefined,operationId:string){
    this.stopLocally(id);
    this.renames=this.renames.filter(item=>item.bindingId!==id);this.io.saveRenames?.(this.renames);
    const host=this.host(target),retained=await host.files.read(leasePaths(target.directory,operationId).reply);
    if(retained){const reply:LeaseReply=JSON.parse(retained);if(reply.id===operationId&&reply.ok&&validResponseStopReceipt(reply.stopReceipt,id,operationId)&&reply.stopReceipt.hostRecorded)return reply.stopReceipt;}
    const modern=await (host.stopReceipts??=host.files.read(`${target.directory}/coordinated-capabilities.json`).then(raw=>{try{return !!raw&&JSON.parse(raw).stopReceipts===1;}catch{return false;}})),reference=modern&&stoppedBody!==undefined?stoppedBodyReference(stoppedBody):undefined;
    if(reference){
      const path=stoppedBodyPath(target.directory,id,reference);
      if(this.frozenBodies.get(path)!==reference.hash){const existing=await host.files.read(path);if(existing!==undefined&&existing!==stoppedBody)throw Error('The immutable frozen response changed.');if(existing===undefined)await host.files.write(path,stoppedBody!);this.frozenBodies.set(path,reference.hash);}
    }
    const reply=await host.client.command({kind:'stop',jobId:id,...(modern?{receiptOnly:1 as const}:{}),...(reference?{stoppedBodyRef:reference}:stoppedBody!==undefined?{stoppedBody}:{})},{id:operationId,actor:this.actor});
    if(!reply.ok)throw Error(reply.error??'Could not record the response stop.');
    if(reply.record)this.receiveRecord(host,reply.record);
    const receipt=reply.stopReceipt??(reply.record?responseStopReceipt(reply.record,operationId):undefined);
    if(!receipt?.hostRecorded)throw Error('The host has not recorded this response stop.');
    // Discovery can adopt the full response later. Its large payload is never
    // a prerequisite for accepting a checked, durable Stop acknowledgement.
    this.tick();return receipt;
  }
  responseStatus(id:string){const local=this.local?.status(id);if(local)return local;const record=this.jobs.get(id)?.record;return record?responseStopReceipt(record):this.statuses.get(id);}
  localResponse(id:string){return this.local?.request(id);}
  cachedResponse(id:string){const local=this.local?.record(id);if(local)return {record:local,host:local.request.host};const runtime=this.jobs.get(id);return runtime?{record:runtime.record,host:runtime.host.target}:undefined;}
  /** Repair a verified local destination before reserving a steering input.
   * The host compares the old path and retains an idempotent acknowledgement. */
  async relocateResponse(target:InlineHostTarget,record:LeaseRecord,path:string){
    if(this.local?.has(record.request.id)){await this.local.register({...record.request,notePath:path});return this.local.record(record.request.id)!;}
    const {request}=record,before=record.state?.notePath??request.notePath;
    if(this.stopped||!record.coordinated||request.vaultId!==this.vaultId||hostKey(request.host)!==hostKey(target))throw Error('The response destination is unavailable.');
    const [document,original]=await Promise.all([this.io.readNote(path),this.io.readNote(before)]);
    if(before!==path&&original!==undefined&&hasResponseMarkers(original,request.id))throw Error('This response appears in both the previous note and this note. Remove the duplicate response before sending.');
    if(document===undefined||!hasResponseMarkers(document,request.id)||this.io.locateNote&&await this.io.locateNote(request.id,path)!==path)throw Error('The response note changed before sending.');
    const host=this.host(target),reply=await host.client.command({kind:'relocate',jobId:request.id,previousNotePath:before,notePath:path},{id:commandId(this.actor,`steering-location:${request.id}:${record.epoch}:${record.revision}:${before}:${path}`),actor:this.actor});
    if(!reply.ok||!reply.record||(reply.record.state?.notePath??reply.record.request.notePath)!==path)throw Error(reply.error??'The response destination was not acknowledged.');
    this.receiveRecord(host,reply.record);this.tick();return reply.record;
  }
  unsettledCount(){return [...this.jobs.values()].filter(({record})=>record.responseRemovedAt===undefined&&!record.state?.cleanupComplete).length;}
  hasLiveResponses(){return this.unsettledCount()>0;}
  async abortFinalAttempt(id:string,proof:NativeCommitProof,evidence:FinalAttemptAbort){
    const runtime=this.jobs.get(id),actor=this.io.completionActor??this.actor,grant=runtime?.record.finalWriter;
    if(!runtime||this.stopped||!grant||grant.actor!==actor||runtime.record.state?.finalSaved||proof.bindingId!==id||proof.commitId!==evidence.commitId||proof.hash!==evidence.hash||contentHash(JSON.stringify(proof))!==evidence.proofHash)throw Error('The final-save recovery no longer matches this device and response.');
    const reply=await runtime.host.client.command({kind:'abort-final',jobId:id,token:grant.token,abort:evidence},{id:commandId(evidence.commitId,'abort-final'),actor});
    if(reply.record)this.receiveRecord(runtime.host,reply.record);
    if(!reply.ok)throw Error(reply.error??'The superseded final-save intent is waiting for host confirmation.');
  }
  async follow(target:InlineHostTarget,id:string,previousMessageId:string,messageId:string,notePath?:string){
    if(this.local?.has(id))return this.local.follow(id,messageId,notePath,previousMessageId);
    if(this.stopped)throw Error('The response writer is unavailable.');
    const host=this.host(target),reply=await host.client.command({kind:'follow',jobId:id,previousMessageId,messageId,notePath});
    if(!reply.ok||!reply.record)throw Error(reply.error??'Could not attach the continuation.');
    this.receiveRecord(host,reply.record);this.tick();
  }
  async steer(target:InlineHostTarget,id:string,steering:SteeringInput){
    if(this.local?.has(id))return this.local.steer(id,steering);
    if(this.stopped)throw Error('The response writer is unavailable.');
    const host=this.host(target),reply=await host.client.command({kind:'steer',jobId:id,steering});
    if(!reply.ok||!reply.record)throw Error(reply.error??'Could not attach the steering message.');
    this.receiveRecord(host,reply.record);this.tick();
  }
  /** App return starts a new read-only feed without the old retry deadline.
   * Writer grants, response identity and applied event cursors remain intact. */
  resume(targets:InlineHostTarget[],priorityIds:readonly string[]=[]){
    if(this.io.localFinalNotes){this.local??=new LocalResponseManager(this.io.completionActor??this.actor,this.vaultId,this.io,this.io.localFinalNotes,this.now);this.local.resume();}
    if(this.stopped)return;
    for(const host of this.hosts.values()){host.lastDiscovery=-Infinity;host.priorityKey=undefined;}
    for(const [id,preview] of this.previews){
      const record=this.jobs.get(id)?.record;
      const open=this.io.isOpen(preview.notePath)||!!record&&!!this.io.completeResponse&&record.request.deviceCompletion?.actor===(this.io.completionActor??this.actor);
      preview.reconnect(open);
    }
    this.discover(targets,priorityIds);this.tick();
  }
  private async migrateLocal(host:Host,record:LeaseRecord):Promise<boolean>{
    const request=record.request,id=request.id;
    if(!this.io.localFinalNotes||!record.coordinated||!request.nativeProjection||record.stopRequestedAt||record.responseRemovedAt!==undefined||this.jobs.get(id)?.finalWork)return false;
    if(this.local?.has(id)||this.localMigrations.has(id))return true;
    this.localMigrations.add(id);
    try{
      for(const note of this.io.openedNotes?.()??[])await this.io.allowLocalMigration?.(id,note.path);
      const path=await this.location(record);if(path===undefined||!this.io.isOpen(path))return false;
      await this.io.allowLocalMigration?.(id,path);
      const document=await this.io.readNote(path),region=document!==undefined?responseRegion(document,id):undefined;
      if(document===undefined||!region||document.slice(region.from,region.to)!==responseAnchor(id,document))return false;
      const state=record.state;
      const localRequest:HostedInlineRequest={...request,version:4,localOnly:true,nativeProjection:true,responseContainer:true,deviceCompletion:undefined,notePath:path,localMessageId:state?.pendingMessageId??state?.messageId??request.messageId,localSteering:state?.steering,localResume:{bindingCheckpoint:state?.bindingCheckpoint,turnIds:state?.turnIds,questionFollows:state?.questionFollows,incoming:state?.incoming,presentationTurns:state?.presentationTurns}};
      if(state?.deviceStaged){
        const {originalHash,hash}=state.deviceStaged,original=await host.files.read(deviceOriginalPath(host.target.directory,id)),staged=await host.files.read(deviceStagedPath(host.target.directory,id,hash));
        if(original===undefined||staged===undefined||contentHash(original)!==originalHash||contentHash(staged)!==hash)throw Error('The existing staged response edit is unavailable for local recovery.');
        await host.files.write(localStagePaths(localRequest,originalHash).original,original);await host.files.write(localStagePaths(localRequest,hash).staged,staged);localRequest.localStage={originalHash,stagedHash:hash};
      }
      await this.register(localRequest);
      const old=this.jobs.get(id);old?.refresh?.cancel(Error('Response migrated to local completion.'));old?.monitor?.stop();old?.writer.stop();this.jobs.delete(id);this.previews.get(id)?.dispose();this.previews.delete(id);
      return true;
    }finally{this.localMigrations.delete(id);}
  }
  private async discoverResponse(host:Host,id:string){
    if(this.stopped||this.jobs.has(id)||this.local?.has(id))return;
    const bytes=await host.files.read(leasePaths(host.target.directory,id).record);if(!bytes||this.stopped)return;
    let record:LeaseRecord=JSON.parse(bytes);const request=validateHostedRequest(record.request);
    if(request.id!==id||![2,3,4].includes(request.version)||request.vaultId!==this.vaultId||hostKey(request.host)!==hostKey(host.target))return;
    if(await this.migrateLocal(host,record))return;
    void Promise.resolve(this.io.completionAcknowledged?.(record)).catch(error=>logFailure('response.completion-cleanup.failed',error,{bindingId:id}));
    // A prepared permanent grant may have an already verified local receipt.
    // Discover that exact writer even if the note was later edited or deleted;
    // completion verifies its retained proof before acknowledging the host.
    // Unprepared grants still require a unique current note location.
    const actor=this.io.completionActor??this.actor;
    if(record.preparedFinal&&record.finalWriter?.actor===actor&&request.deviceCompletion?.actor===actor){
      this.receiveRecord(host,record);this.tick();return;
    }
    // A validated host record can update an exact open native anchor before
    // local disk/location checks finish. This does not adopt a writer job.
    if(record.coordinated&&this.io.isOpen(record.state?.notePath??request.notePath)){
      this.receivePreview(record);
      void Promise.resolve(this.io.receiveCoordinated?.(record)).catch(error=>logFailure('note.projection.receive',error,{bindingId:id}));
      this.previews.get(id)?.tick(true);
    }
    const path=await this.location(record);if(path===undefined)return;
    const document=await this.io.readNote(path);
    if(this.stopped||document===undefined||!this.available(record,document))return;
    // Native observers do not take the legacy writer lease that repairs a
    // missed rename. Restore the unique saved anchor's path through the host
    // before adopting its display or direct feed. Never dispatch a prompt.
    const before=record.state?.notePath??request.notePath;
    if(record.coordinated&&path!==before&&hasResponseMarkers(document,id)&&!record.stopRequestedAt&&record.responseRemovedAt===undefined){
      const reply=await host.client.command({kind:'relocate',jobId:id,previousNotePath:before,notePath:path},{id:commandId(this.actor,`restore-location:${id}:${record.epoch}:${record.revision}:${before}:${path}`),actor:this.actor});
      if(!reply.ok||!reply.record)throw Error(reply.error??'The restored stream destination was not acknowledged.');
      record=reply.record;
      if(this.stopped||(record.state?.notePath??record.request.notePath)!==path)return;
    }
    this.receiveRecord(host,record);this.tick();
  }
  discover(targets:InlineHostTarget[],priorityIds:readonly string[]=[]){
    if(this.stopped)return;
    if(this.io.localFinalNotes){this.local??=new LocalResponseManager(this.io.completionActor??this.actor,this.vaultId,this.io,this.io.localFinalNotes,this.now);this.local.resume();for(const runtime of this.jobs.values())if(this.io.isOpen(runtime.record.state?.notePath??runtime.record.request.notePath))void this.migrateLocal(runtime.host,runtime.record).catch(error=>logFailure('response.local.migrate',error,{bindingId:runtime.record.request.id}));priorityIds=priorityIds.filter(id=>!this.local!.has(id));if(!priorityIds.length&&!this.jobs.size)return;}
    for(const target of targets)this.host(target);
    for(const host of this.hosts.values()){
      // Restored previews already identify their exact records. Completed
      // responses leave the active catalog, so recover them by ID as well.
      const ids=[...new Set(priorityIds)].filter(id=>/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)&&!this.jobs.has(id)&&!this.local?.has(id)),key=ids.join(',');
      if(ids.length&&!host.priorityDiscovery&&(host.priorityKey!==key||this.now()-(host.lastPriorityDiscovery??-Infinity)>=3000)){
        host.priorityKey=key;host.lastPriorityDiscovery=this.now();
        const work=Promise.allSettled(ids.map(id=>this.discoverResponse(host,id))).then(()=>{});
        host.priorityDiscovery=work;void work.finally(()=>{if(host.priorityDiscovery===work)host.priorityDiscovery=undefined;});
      }
      if(host.discovery||this.now()-host.lastDiscovery<3000)continue;
      host.lastDiscovery=this.now();
      const work=(async()=>{
        // Decoration availability must not gate canonical writer discovery.
        try{const indicators=await host.files.read(explorerResponsePath(host.target.directory));
          if(indicators&&!this.stopped){
            const incoming=loadExplorerResponses(JSON.parse(indicators));
            host.responses=incoming.map(response=>{const current=host.responses.find(r=>r.id===response.id);return current&&(current.epoch>response.epoch||current.epoch===response.epoch&&current.revision>response.revision)?current:response;});
          }
        }catch{/* Older/offline hosts still expose their active lease catalog. */}
        const raw=await host.files.read(leasePaths(host.target.directory,'').catalog);if(!raw||this.stopped)return;
        const requests=JSON.parse(raw);if(!Array.isArray(requests))return;
        await Promise.allSettled(requests.map(async value=>{
          const request=validateHostedRequest(value);
          if(![2,3,4].includes(request.version)||request.vaultId!==this.vaultId||hostKey(request.host)!==hostKey(host.target)||this.jobs.has(request.id))return;
          // Already materialized history needs no lease body or transport read.
          const summary=host.responses.find(response=>response.id===request.id);
          if(summary&&summary.complete&&!summary.active&&!summary.input){const note=await this.io.readNote(request.notePath);if(note===undefined||!hasResponseMarkers(note,request.id))return;}
          await this.discoverResponse(host,request.id);
        }));
        this.tick();
      })();host.discovery=work;void work.finally(()=>{host.discovery=undefined;}).catch(()=>{});
    }
  }
  explorerResponses():ExplorerResponse[]{return [...this.local?.responses()??[],...[...this.hosts.values()].flatMap(host=>host.responses)].filter(response=>!this.localStops.has(response.id));}
  stoppableResponses(path:string){return [...this.jobs.values()].filter(({record})=>(record.state?.notePath??record.request.notePath)===path&&!this.localStops.has(record.request.id)&&!record.stopRequestedAt&&!record.state?.userStopped&&!terminalLease(record)&&!responseStopReceipt(record).runTerminal).map(({record,host})=>({id:record.request.id,hostTarget:host.target}));}
  private receivePreview(record:LeaseRecord){
    if(!record.coordinated||!this.io.receiveDirect||this.localStops.has(record.request.id))return;
    let preview=this.previews.get(record.request.id);
    if(!preview){preview=new DirectInlinePreview(record,()=>this.access(record.request.threadEnvironmentId),update=>{this.io.receiveDirect!(update);const runtime=this.jobs.get(update.request.id);if(runtime&&update.completionVerified&&update.turnId&&(update.phase==='complete'||update.phase==='interrupted')){runtime.finalUpdate=update;this.finishOnDevice(runtime);}});this.previews.set(record.request.id,preview);}
    else preview.update(record);
  }
  private receiveRecord(host:Host,record:LeaseRecord){
    if(this.local?.has(record.request.id)||this.localMigrations.has(record.request.id))return;
    if(this.stopped||record.request.vaultId!==this.vaultId||hostKey(record.request.host)!==hostKey(host.target))return;
    if(this.bindings.get(record.request.id)?.removed&&record.responseRemovedAt===undefined)return;
    const current=this.jobs.get(record.request.id)?.record;
    if(current&&(current.epoch>record.epoch||current.epoch===record.epoch&&current.revision>record.revision))return;
    const previousStatus=this.statuses.get(record.request.id);
    if(previousStatus&&(previousStatus.epoch>record.epoch||previousStatus.epoch===record.epoch&&previousStatus.revision>record.revision))return;
    this.statuses.delete(record.request.id);this.statuses.set(record.request.id,responseStopReceipt(record));
    if(this.statuses.size>1024){for(const [id,status] of this.statuses){if(status.finalSaved&&!this.jobs.has(id)){this.statuses.delete(id);if(this.statuses.size<=1024)break;}}}
    void Promise.resolve(this.io.completionAcknowledged?.(record)).catch(error=>logFailure('response.completion-cleanup.failed',error,{bindingId:record.request.id}));
    this.bindings.set(record.request.id,{host,notePath:record.state?.notePath??record.request.notePath,coordinated:record.coordinated===true,removed:record.responseRemovedAt!==undefined,stopped:record.responseRemovedAt!==undefined||!!record.stopRequestedAt});
    if(record.responseRemovedAt!==undefined){
      const old=this.jobs.get(record.request.id);old?.refresh?.cancel(Error('Response removed.'));old?.monitor?.stop();old?.writer.stop();
      this.previews.get(record.request.id)?.dispose();this.previews.delete(record.request.id);this.jobs.delete(record.request.id);
      if(record.coordinated)void Promise.resolve(this.io.receiveCoordinated?.(record)).catch(error=>logFailure('note.projection.receive',error,{bindingId:record.request.id}));
      return;
    }
    this.receivePreview(record);
    const projected=leaseExplorerResponse(record),previous=host.responses.find(r=>r.id===projected.id);
    if(!previous||projected.epoch>previous.epoch||projected.epoch===previous.epoch&&projected.revision>previous.revision)host.responses=host.responses.filter(r=>r.id!==projected.id).concat(projected);
    if(record.coordinated)void Promise.resolve(this.io.receiveCoordinated?.(record)).catch(error=>logFailure('note.projection.receive',error,{bindingId:record.request.id}));
    const old=this.jobs.get(record.request.id);
    if(old){if(record.epoch>old.record.epoch||record.epoch===old.record.epoch&&record.revision>=old.record.revision){old.record=record;if(record.stopRequestedAt)old.writer.requestStop(record.request.id);}return;}
    if(terminalLease(record)&&!record.coordinated)return;
    const runtime={} as Runtime;
    Object.assign(runtime,{record,host,lastHeartbeat:-Infinity,nextTick:0,nextSnapshot:0,snapshotFailures:0,sequence:-1});
    const paths=hostedPaths(host.target.directory,record.request.id);
    let stopping=false;
    const allowed=()=>!this.stopped&&(!runtime.record.stopRequestedAt||stopping)&&runtime.writeEpoch===runtime.record.epoch&&runtime.record.owner===this.actor&&host.client.valid(record.request.id,runtime.record.epoch);
    runtime.writer=new HostedInlineWriter({vaultId:this.vaultId,...host.target},{
      monotonic:this.monotonic,requests:async()=>[paths.request],accepts:request=>{if(runtime.record.stopRequestedAt)stopping=true;return [2,3,4].includes(request.version)&&allowed();},
      canResume:path=>this.io.isOpen(path),
      locateNote:this.io.locateNote?async(id,path)=>{
        const located=await this.io.locateNote!(id,path);
        if(located===undefined)runtime.awaitingNote=true;
        else if(runtime.awaitingNote||located!==(runtime.record.state?.notePath??runtime.record.request.notePath)){
          runtime.state=undefined;runtime.awaitingNote=false;
        }
        return located;
      }:undefined,
      read:async path=>path===paths.request?JSON.stringify(runtime.record.request):path===paths.state?(runtime.record.state?JSON.stringify(runtime.record.state):undefined):path===paths.stop&&runtime.record.stopRequestedAt?JSON.stringify({discardResponse:runtime.record.discardResponse===true,stoppedBody:runtime.record.stoppedBody}):host.files.read(path),
      write:async(path,value)=>{
        if(path!==paths.state||!allowed())throw Error('Writer ownership expired.');
        const state:HostedInlineState=JSON.parse(value);
        if(runtime.record.stopRequestedAt&&!state.userStopped)throw Error('The response was stopped.');
        stopping=state.userStopped===true;
        // Editor mutations precede Obsidian's debounced disk save. Keep the
        // recovery record active until the final Markdown is actually durable.
        const proofTransition=state.finalSaved&&!runtime.record.state?.finalSaved;
        const terminal=['complete','interrupted'].includes(state.status);
        const legacySaved=['complete','interrupted'].includes(runtime.record.state?.status??'');
        if((terminal||proofTransition&&!legacySaved)&&state.finalDocumentHash&&this.io.isSaved&&!await this.io.isSaved(state.notePath,state.finalDocumentHash,state.finalBody!==undefined?{id:record.request.id,body:state.finalBody,cleaned:state.cleanupComplete===true}:undefined))throw Error('Waiting for Obsidian to save the final reply.');
        if(!allowed())throw Error('Writer ownership expired.');
        if(comparable(state)===comparable(runtime.record.state))return;
        const reply=await host.client.command({kind:'checkpoint',jobId:record.request.id,epoch:runtime.record.epoch,revision:runtime.record.revision,state});
        this.reply(runtime,reply);
        if(!reply.ok||!allowed())throw Error(reply.error??'Writer ownership expired.');
      },
      access:environmentId=>this.access(environmentId),
      threadState:async(request,access,refresh)=>{
        if(!refresh&&runtime.state)return restoreInlineBindings(runtime.state,runtime.record.state?.bindingCheckpoint);
        return this.refreshSnapshot(runtime,access);
      },
      readFailure:()=>runtime.snapshotBlocked?{kind:'response-too-large',operation:'snapshot'}:undefined,
      adoptFinalResponse:(_request,state,turnId,key)=>{
        if(!allowed()||!runtime.state||finalResponseKey(runtime.state,turnId)!==key)return false;
        const replacement=inlineTurnMessages(state,turnId).at(-1);
        if(!replacement)return false;
        runtime.state={...runtime.state,messages:runtime.state.messages.map(m=>m.id===replacement.id?replacement:m)};
        return true;
      },
      updateNote:async(path,change)=>{
        if(this.io.locateNote&&await this.io.locateNote(record.request.id,path)!==path)throw Error('The response note moved during the update; retrying.');
        return this.io.updateNote(path,change,allowed);
      },
      resolveReplyReference:this.io.resolveReplyReference?(reference,request,access)=>this.io.resolveReplyReference!(reference,{...request,notePath:runtime.record.state?.notePath??request.notePath},access):undefined,
    });
    this.jobs.set(record.request.id,runtime);
  }
  private reply(runtime:Runtime,reply:LeaseReply){
    if(reply.record)this.receiveRecord(runtime.host,reply.record);
    if(reply.ok)runtime.maintenanceFailures=0;
    else {
      runtime.maintenanceFailures=(runtime.maintenanceFailures??0)+1;
      const delay=Number.isFinite(reply.retryAfterMs)?Math.max(HEARTBEAT_MS,Math.min(30_000,reply.retryAfterMs!)):Math.min(30_000,HEARTBEAT_MS*2**Math.min(runtime.maintenanceFailures,4));
      runtime.lastHeartbeat=this.now()+delay-HEARTBEAT_MS;
    }
  }
  private owns(runtime:Runtime){return !this.stopped&&!runtime.record.stopRequestedAt&&runtime.record.owner===this.actor&&runtime.host.client.valid(runtime.record.request.id,runtime.record.epoch);}
  /** Driven by the same desktop tick as lease renewal, independently of the
   * stream's browser polling/reconnect timers and cached running/complete phase.
   * The tick also bounds a hung read; late results cannot cross ownership epochs. */
  private refreshSnapshot(runtime:Runtime,access?:ThreadAccess):Promise<InlineThreadState|undefined>{
    if(!this.owns(runtime))return Promise.resolve(undefined);
    if(runtime.snapshotBlocked||runtime.record.state?.streamFailure?.operation==='snapshot')return Promise.reject(new T3ResponseTooLargeError());
    if(runtime.refresh?.epoch===runtime.record.epoch)return runtime.refresh.work;
    if(runtime.snapshotFailures&&this.monotonic()<runtime.nextSnapshot)return Promise.reject(Error('Waiting to retry the T3 response freshness check.'));
    runtime.refresh?.cancel(Error('Response ownership changed.'));
    const epoch=runtime.record.epoch,request=runtime.record.request,abort=new AbortController();
    let resolve!:(state:InlineThreadState|undefined)=>void,reject!:(error:Error)=>void;
    const work=new Promise<InlineThreadState|undefined>((done,fail)=>{resolve=done;reject=fail;});
    const refresh:SnapshotRefresh={epoch,startedAt:this.monotonic(),work,cancel:error=>{
      if(runtime.refresh!==refresh)return;
      abort.abort();
      runtime.refresh=undefined;
      runtime.nextSnapshot=this.monotonic()+Math.min(30_000,5000*2**Math.min(runtime.snapshotFailures++,3));
      if(responseTooLarge(error)){runtime.snapshotBlocked=true;runtime.nextSnapshot=Infinity;}
      reject(error);
    }};
    runtime.refresh=refresh;runtime.nextSnapshot=this.monotonic()+INLINE_SNAPSHOT_INTERVAL_MS;
    void (async()=>{
      const ready=access??await this.access(request.threadEnvironmentId),state=runtime.record.state;
      const snapshot=await readInlineSnapshot(ready,request.threadId,request.projectId,{messageIds:[state?.pendingMessageId??state?.messageId??request.messageId],turnIds:state?.turnIds??(state?.turnId?[state.turnId]:[])});
      if(runtime.refresh!==refresh)return;
      if(!this.owns(runtime)||runtime.record.epoch!==epoch){refresh.cancel(Error('Response ownership changed.'));return;}
      this.item(runtime,{kind:'snapshot',snapshot});
      const current=runtime.state!,saved=runtime.record.state?.bindingCheckpoint;
      const ids=[state?.pendingMessageId??state?.messageId??request.messageId,...state?.steering?.map(input=>input.messageId)??[]];
      const unresolved=ids.filter(id=>!turnForMessage(current,id)).map(id=>saved?.starts?.[id]).filter((start):start is InlineStartRequest=>!!start&&!start.failed);
      if(unresolved.length){
        const items=await readInlineEvents(ready,request.threadId,Math.max(0,Math.min(...unresolved.map(start=>start.sequence))-1),abort.signal);
        if(runtime.refresh!==refresh||!this.owns(runtime)||runtime.record.epoch!==epoch)return;
        const proven=new Set(Object.values(saved?.bindings??{}).map(binding=>binding.turnId));
        let evidence:InlineThreadState={messages:current.messages.filter(message=>message.role==='user'),activities:[],starts:saved?.starts,bindings:saved?.bindings,turns:Object.fromEntries(Object.entries(saved?.turns??{}).filter(([id])=>proven.has(id)))};
        for(const item of items)evidence=applyThreadItem(evidence,item).state;
        // Historical replay supplies bindings only. Never replace newer prose,
        // session state or ownership with the replay's older projection.
        runtime.state=restoreInlineBindings(runtime.state!,inlineBindingCheckpoint(evidence));
      }
      runtime.refresh=undefined;runtime.snapshotFailures=0;runtime.nextSnapshot=this.monotonic()+INLINE_SNAPSHOT_INTERVAL_MS;
      runtime.nextTick=0;resolve(runtime.state);this.tick();
    })().catch(error=>refresh.cancel(error instanceof Error?error:Error(String(error))));
    return work;
  }
  private flushRenames(){
    if(this.renameWork||!this.renames.length||this.now()<this.nextRenameRetry)return;
    const rename=this.renames[0],host=this.host(rename.host);
    const work=(async()=>{
      const reply=await host.client.command({kind:'relocate',jobId:rename.bindingId,previousNotePath:rename.before,notePath:rename.after},{id:rename.id,actor:rename.actor});
      if(!reply.ok&&(reply.record?.stopRequestedAt||reply.stopReceipt?.hostRecorded)){this.renames=this.renames.filter(item=>item.bindingId!==rename.bindingId);this.io.saveRenames?.(this.renames);return;}
      if(!reply.ok)throw Error(reply.error??'The rename was not acknowledged.');
      if(this.stopped)return;
      if(reply.record)this.receiveRecord(host,reply.record);
      this.renames=this.renames.filter(item=>item.id!==rename.id);this.io.saveRenames?.(this.renames);
    })().catch(error=>{this.nextRenameRetry=this.now()+3000;logFailure('response.rename.handoff',error,{bindingId:rename.bindingId,before:rename.before,after:rename.after});});
    this.renameWork=work;void work.finally(()=>{this.renameWork=undefined;}).catch(()=>{});
  }
  tick(){
    this.local?.tick();
    if(this.stopped)return;
    // A synchronous tick sees one current workspace. Several independent
    // replies in the same note need only one fresh open-view query; never
    // retain this result across ticks or asynchronous work.
    const opened=new Map<string,boolean>(),isOpen=(path:string)=>{if(!opened.has(path))opened.set(path,this.io.isOpen(path));return opened.get(path)!;};
    for(const [id,preview] of this.previews)if(!this.jobs.has(id))preview.tick(isOpen(preview.notePath));
    this.titles?.sync([...this.jobs.values()].filter(({record})=>record.coordinated&&!record.stopRequestedAt&&!terminalLease(record)&&isOpen(record.state?.notePath??record.request.notePath)).map(({record})=>record.request));
    this.flushRenames();
    for(const runtime of this.jobs.values()){
      const {record,host}=runtime,id=record.request.id;
      if(record.coordinated){
        runtime.refresh?.cancel(Error('Generated changes are coordinated by the host.'));runtime.monitor?.stop();runtime.monitor=undefined;runtime.writer.stop();
        this.previews.get(id)?.tick(isOpen(record.state?.notePath??record.request.notePath)||!!this.io.completeResponse&&record.request.deviceCompletion?.actor===(this.io.completionActor??this.actor));
        this.finishOnDevice(runtime);
        if(record.state?.cleanupComplete&&(record.state.delivery?.observedBy.includes(this.actor)||record.request.deviceCompletion?.actor===(this.io.completionActor??this.actor)&&record.state.delivery?.observedBy.includes(this.io.completionActor??this.actor))){this.previews.get(id)?.dispose();this.previews.delete(id);this.jobs.delete(id);continue;}
        if(!runtime.heartbeat&&this.now()-runtime.lastHeartbeat>=1000){runtime.lastHeartbeat=this.now();const work=this.observeCoordinated(runtime);runtime.heartbeat=work;void work.finally(()=>runtime.heartbeat=undefined).catch(()=>{});}
        continue;
      }
      if(terminalLease(record)){runtime.refresh?.cancel(Error('Response completed.'));runtime.monitor?.stop();runtime.writer.stop();this.jobs.delete(id);continue;}
      const owns=record.owner===this.actor&&host.client.valid(id,record.epoch);
      if(!runtime.heartbeat&&this.now()-runtime.lastHeartbeat>=HEARTBEAT_MS){
        runtime.lastHeartbeat=this.now();
        const work=this.maintain(runtime).catch(()=>{
          runtime.maintenanceFailures=(runtime.maintenanceFailures??0)+1;
          runtime.lastHeartbeat=this.now()+Math.min(30_000,HEARTBEAT_MS*2**Math.min(runtime.maintenanceFailures,4))-HEARTBEAT_MS;
        });runtime.heartbeat=work;void work.finally(()=>{runtime.heartbeat=undefined;}).catch(()=>{});
      }
      if(!owns){runtime.refresh?.cancel(Error('Response ownership changed.'));runtime.monitor?.stop();runtime.monitor=undefined;runtime.state=undefined;runtime.sequence=-1;runtime.nextSnapshot=0;continue;}
      if(record.stopRequestedAt){runtime.refresh?.cancel(Error('Response stopped.'));runtime.monitor?.stop();runtime.monitor=undefined;runtime.writer.requestStop(id);}
      if(runtime.refresh&&this.monotonic()-runtime.refresh.startedAt>=INLINE_SNAPSHOT_TIMEOUT_MS)runtime.refresh.cancel(Error('T3 response freshness check timed out.'));
      if(!record.stopRequestedAt&&!runtime.refresh&&!runtime.snapshotBlocked&&record.state?.streamFailure?.operation!=='snapshot'&&this.monotonic()>=runtime.nextSnapshot){
        void this.refreshSnapshot(runtime).catch(error=>{if(this.owns(runtime))logFailure('stream.freshness.failed',error,{jobId:id,threadId:record.request.threadId});});
      }
      if(!record.stopRequestedAt&&!runtime.monitor){
        const monitorEpoch=record.epoch;
        runtime.monitor=watchThread(record.request.threadId,async()=>{
        // A stream owns its own access lifetime. Its reconnect must not revoke
        // the independently cached access used for note checkpoints/assets.
        return this.io.access(record.request.threadEnvironmentId);
      },{item:item=>{if(runtime.record.epoch===monitorEpoch)this.item(runtime,item);},reconnecting:()=>{/* Retain exact start/turn evidence across feed reconnects. */}},undefined,undefined,{afterSequence:()=>runtime.sequence<0?undefined:runtime.sequence,pollSnapshots:()=>runtime.state?.protocolVersion!==2&&!runtime.snapshotBlocked});
      }
      if(runtime.work&&this.now()>=runtime.nextTick){runtime.nextTick=this.now()+150;void runtime.writer.tick().catch(()=>{});}
      if(!runtime.work&&this.now()>=runtime.nextTick){
        runtime.nextTick=this.now()+150;runtime.writeEpoch=record.epoch;
        const work=runtime.writer.tick();runtime.work=work;void work.finally(()=>{runtime.work=undefined;}).catch(()=>{});
      }
    }
  }
  private finishOnDevice(runtime:Runtime){
    const record=runtime.record,actor=this.io.completionActor??this.actor;
    if(this.stopped||!this.io.completeResponse||record.request.deviceCompletion?.actor!==actor||record.state?.cleanupComplete||record.responseRemovedAt!==undefined||record.finalWriter&&record.finalWriter.actor!==actor||runtime.finalWork||this.now()<(runtime.nextFinal??0))return;
    const state=record.state,turn=state?.bindingCheckpoint?.turns?.[state.turnId??''];
    if(!runtime.finalUpdate&&state?.directFinalBody!==undefined&&state.finalPhase&&state.turnId&&!state.bindingRecoveryIssue&&(turn?.state==='completed'&&state.finalPhase==='complete'||turn?.state==='interrupted'&&state.finalPhase==='interrupted'))runtime.finalUpdate={request:record.request,messageId:state.pendingMessageId??state.messageId??record.request.messageId,turnId:state.turnId,turnIds:state.turnIds,sequence:state.bindingCheckpoint?.sequence??0,body:state.directFinalBody,phase:state.finalPhase,checkpoint:state.bindingCheckpoint,completionVerified:true};
    if(!record.finalWriter&&(!runtime.finalUpdate||this.localStops.has(record.request.id)||record.stopRequestedAt))return;
    const work=(async()=>{
      let lease=runtime.record;
      if(!lease.finalWriter){
        const update=runtime.finalUpdate!;
        let body=update.body;
        if(update.phase==='complete'&&this.io.resolveReplyReference){const access=await this.access(lease.request.threadEnvironmentId);body=await rewriteReplyReferences(body,reference=>this.io.resolveReplyReference!(reference,lease.request,access).catch(()=>undefined));}
        if(this.stopped||this.localStops.has(lease.request.id))return;
        const reply=await runtime.host.client.command({kind:'reserve-final',jobId:lease.request.id,final:{messageId:update.messageId,turnId:update.turnId!,sequence:update.sequence,body,phase:update.phase as 'complete'|'interrupted',checkpoint:update.checkpoint,turnIds:update.turnIds}},{id:crypto.randomUUID(),actor});
        if(reply.record)this.receiveRecord(runtime.host,reply.record);
        if(!reply.ok||!reply.record)throw Error(reply.error??'Could not authorize the local final save.');
        lease=reply.record;
      }
      // An unprepared grant has not crossed the final-write boundary. A reload
      // can miss the note's rename event, so locate its exact saved anchor and
      // acknowledge that path before preparing any local mutation. Prepared
      // attempts retain their path/proof: their receipt must remain replayable
      // after the user edits or deletes the completed note.
      if(!lease.preparedFinal&&!lease.state?.finalSaved){
        const before=lease.state?.notePath??lease.request.notePath,path=await this.location(lease);
        if(path===undefined||this.stopped)return;
        if(path!==before){
          const grant=lease.finalWriter!,identity=commandId(lease.request.id,`final-location:${grant.token}:${contentHash(JSON.stringify([before,path]))}`);
          const reply=await runtime.host.client.command({kind:'relocate',jobId:lease.request.id,previousNotePath:before,notePath:path},{id:identity,actor});
          if(reply.record)this.receiveRecord(runtime.host,reply.record);
          if(!reply.ok||!reply.record)throw Error(reply.error??'The final response destination is waiting for acknowledgement.');
          if(reply.record.finalWriter?.token!==grant.token||reply.record.finalWriter.actor!==actor)throw Error('The permanent final-write grant changed during the rename.');
          lease=reply.record;
        }
      }
      const directory=runtime.host.target.directory,staged=lease.state?.deviceStaged;
      const [original,draft]=await Promise.all([runtime.original!==undefined?Promise.resolve(runtime.original):runtime.host.files.read(deviceOriginalPath(directory,lease.request.id)),staged?runtime.host.files.read(deviceStagedPath(directory,lease.request.id,staged.hash)):Promise.resolve(undefined)]);
      if(original===undefined)throw Error('The private completion original is unavailable.');runtime.original=original;
      const proof=await this.io.completeResponse!(lease,original,draft,async proof=>{
        const reply=await runtime.host.client.command({kind:'prepare-final',jobId:lease.request.id,token:lease.finalWriter!.token,proof},{id:crypto.randomUUID(),actor});
        if(reply.record)this.receiveRecord(runtime.host,reply.record);
        if(!reply.ok)throw Error(reply.error??'The host did not retain the immutable final-save intent.');
      },(proof,evidence)=>this.abortFinalAttempt(lease.request.id,proof,evidence));if(!proof)return;
      if(this.stopped)return;
      const reply=await runtime.host.client.command({kind:'commit-final',jobId:lease.request.id,token:lease.finalWriter!.token,proof},{id:crypto.randomUUID(),actor});
      if(reply.record)this.receiveRecord(runtime.host,reply.record);
      if(!reply.ok)throw Error(reply.error??'The local final-save receipt is waiting for the host.');
      runtime.finalFailure=undefined;
    })().catch(error=>{const detail=error instanceof Error?error.message:String(error);if(runtime.finalFailure!==detail){runtime.finalFailure=detail;this.io.completionFailed?.(error,record.request.id);logFailure('response.device-completion.failed',error,{bindingId:record.request.id});}}).finally(()=>{runtime.finalWork=undefined;runtime.nextFinal=this.now()+1000;});
    runtime.finalWork=work;
  }
  private async observeCoordinated(runtime:Runtime){
    const {host}=runtime,raw=await host.files.read(leasePaths(host.target.directory,runtime.record.request.id).record);if(!raw||this.stopped)return;
    let record:LeaseRecord;
    if(raw===runtime.observedBytes&&runtime.observedRecord===runtime.record)record=runtime.record;
    else{
      record=JSON.parse(raw);this.receiveRecord(host,record);
      if(runtime.record===record){runtime.observedBytes=raw;runtime.observedRecord=record;}
      else{runtime.observedBytes=undefined;runtime.observedRecord=undefined;}
    }
    if(record.responseRemovedAt!==undefined)return;
    const actor=this.io.completionActor??this.actor;
    if(record.request.deviceCompletion?.actor===actor&&!record.finalWriter&&!record.stopRequestedAt&&this.now()>=(runtime.nextPresence??0)){
      runtime.nextPresence=this.now()+HEARTBEAT_MS;
      const reply=await host.client.command({kind:'presence',jobId:record.request.id},{id:crypto.randomUUID(),actor});
      if(reply.record)this.receiveRecord(host,reply.record);
    }
    const delivery=record.state?.delivery;
    if(delivery?.proofHash&&this.io.receiveCoordinated){
      if(runtime.proof?.hash!==delivery.proofHash){
        const bytes=await host.files.read(nativeCommitPath(host.target.directory,record.request.id,delivery.commitId));
        if(bytes===undefined)return;
        readNativeCommitProof(bytes,record.request.id,delivery);runtime.proof={hash:delivery.proofHash,bytes};
      }
      if(this.stopped||runtime.record.epoch!==record.epoch||runtime.record.revision!==record.revision)return;
      await this.io.receiveCoordinated(record,runtime.proof.bytes);
    }
    if(delivery&&!delivery.observedBy.includes(this.actor)&&this.io.readSaved){
      const saved=await this.io.readSaved(record.state!.notePath);
      if(saved!==undefined&&contentHash(saved)===delivery.hash)this.reply(runtime,await host.client.command({kind:'observe',jobId:record.request.id,observed:{commitId:delivery.commitId,hash:delivery.hash}}));
    }
  }
  private async maintain(runtime:Runtime){
    const {host}=runtime;let record=runtime.record;
    // Read authoritative state before claiming. A suspended process cannot
    // renew an old epoch just because it has resumed its timers.
    const raw=await host.files.read(leasePaths(host.target.directory,record.request.id).record);
    if(!raw||this.stopped)return;
    record=JSON.parse(raw);this.receiveRecord(host,record);
    if(record.coordinated)return;
    if(terminalLease(record))return;
    const renewing=record.owner===this.actor&&host.client.valid(record.request.id,record.epoch);
    // A healthy owner retains its grant while a move is arriving through Sync.
    // Actual writes still require intact response markers and a current epoch.
    if(renewing){this.reply(runtime,await host.client.command({kind:'heartbeat',jobId:record.request.id,epoch:record.epoch}));return;}
    const path=await this.location(record);if(path===undefined)return;
    const document=await this.io.readNote(path);
    if(document===undefined||!this.available(record,document))return;
    const reply=await host.client.command({kind:'claim',jobId:record.request.id,epoch:record.epoch,notePath:path,fallback:!this.io.isOpen(path)});
    this.reply(runtime,reply);
  }
  private async location(record:LeaseRecord){
    const path=record.state?.notePath??record.request.notePath;
    return this.io.locateNote?this.io.locateNote(record.request.id,path):path;
  }
  private available(record:LeaseRecord,document:string){
    const {request,state}=record;
    if(request.deviceCompletion?.actor===(this.io.completionActor??this.actor)&&record.finalWriter?.actor===request.deviceCompletion.actor&&record.preparedFinal)return true;
    return !!record.stopRequestedAt||state?.finalSaved===true||pendingCompletionCleanup(request,state)&&hasResponseMarkers(document,request.id)||!!regionBody(document,request.id)||contentHash(document)===state?.finalDocumentHash||state?.finalBody!==undefined&&hasCompletionProof(document,request.id,state.finalBody);
  }
  private item(runtime:Runtime,item:ThreadStreamItem){
    if(this.stopped||runtime.record.stopRequestedAt||runtime.record.owner!==this.actor||!runtime.host.client.valid(runtime.record.request.id,runtime.record.epoch))return;
    if(item.kind==='snapshot'){
      if(item.snapshot?.thread?.id!==runtime.record.request.threadId||item.snapshot.thread.projectId!==runtime.record.request.projectId)return;
      if(Number.isSafeInteger(item.snapshot.snapshotSequence)&&item.snapshot.snapshotSequence<runtime.sequence)return;
    }
    if(item.kind==='event'&&Number.isSafeInteger(item.event?.sequence)&&item.event.sequence<=runtime.sequence)return;
    const applied=applyThreadItem(restoreInlineBindings(runtime.state??{messages:[],activities:[]},runtime.record.state?.bindingCheckpoint),item);
    runtime.state=applied.state;if(applied.sequence!==undefined)runtime.sequence=applied.sequence;
    if(item.kind==='snapshot'){runtime.nextSnapshot=this.monotonic()+INLINE_SNAPSHOT_INTERVAL_MS;runtime.snapshotFailures=0;}
  }
  changed(path:string){this.io.noteChanged?.(path);this.local?.resume();}
  deleted(path:string){this.io.noteDeleted?.(path);for(const [id,runtime] of this.jobs){const current=runtime.record.state?.notePath??runtime.record.request.notePath;if(current===path||current.startsWith(path+'/')){this.previews.get(id)?.dispose();this.previews.delete(id);}}for(const host of this.hosts.values())host.responses=relocateExplorerResponses(host.responses,path);}
  renamed(before:string,after:string){
    this.local?.renamed(before,after);
    this.io.noteRenamed?.(before,after);
    for(const host of this.hosts.values())host.responses=relocateExplorerResponses(host.responses,before,after);
    for(const runtime of this.jobs.values()){
      runtime.writer.renamed(before,after);runtime.nextTick=0;
    }
    // Completed deliveries leave the polling jobs after disk acknowledgement,
    // but their destination must still follow a later native rename.
    for(const [bindingId,binding] of this.bindings){
      const current=this.renames.filter(item=>item.bindingId===bindingId).at(-1)?.after??binding.notePath;
      if(binding.coordinated&&!binding.stopped&&(current===before||current.startsWith(before+'/'))){
        this.renames.push({id:crypto.randomUUID(),actor:this.actor,bindingId,host:binding.host.target,before:current,after:after+current.slice(before.length)});
        // Preserve the exact authenticated mailbox command across offline
        // retries and reload. Successive moves are acknowledged in order.
        this.io.saveRenames?.(this.renames);this.nextRenameRetry=0;
      }
    }
    this.tick();
  }
  dispose(){
    this.local?.dispose();
    this.stopped=true;
    this.titles?.dispose();
    for(const preview of this.previews.values())preview.dispose();this.previews.clear();
    for(const runtime of this.jobs.values()){runtime.refresh?.cancel(Error('Response writer stopped.'));runtime.monitor?.stop();runtime.writer.stop();}
    for(const host of this.hosts.values())host.close();
    void this.accessCache.dispose();
    this.jobs.clear();this.bindings.clear();this.hosts.clear();this.statuses.clear();
  }
}
