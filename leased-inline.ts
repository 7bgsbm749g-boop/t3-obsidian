import {explorerResponsePath,leaseExplorerResponse,loadExplorerResponses,relocateExplorerResponses,type ExplorerResponse} from './explorer-responses';
import {contentHash} from './completion';
import {HostedInlineWriter,hostedPaths,validateHostedRequest,pendingCompletionCleanup,type HostedInlineRequest,type HostedInlineState,type InlineFiles,type InlineHostTarget} from './hosted-inline';
import {InlineLeaseClient,HEARTBEAT_MS,leasePaths,terminalLease,type LeaseRecord,type LeaseReply} from './inline-lease';
import {applyThreadItem,inlineBindingCheckpoint,restoreInlineBindings,turnForMessage,hasCompletionProof,hasResponseMarkers,regionBody,type InlineThreadState,type InlineStartRequest} from './inline-thread';
import {readInlineEvents,readInlineSnapshot,watchThread,type ThreadAccess,type ThreadStreamItem,type ThreadAccessCloseReason} from './thread-stream';
import {ThreadAccessCache} from './thread-access-cache';
import type {ReplyReference} from './reply-assets';
import type {SteeringInput} from './inline-steering';
import {logFailure} from './diagnostics';
import {nativeCommitPath,readNativeCommitProof} from './native-response-commit';
import {ThreadTitleFeed} from './thread-title-feed';

export const INLINE_SNAPSHOT_INTERVAL_MS=10_000;
export const INLINE_SNAPSHOT_TIMEOUT_MS=30_000;

export interface PendingResponseRename {id:string;actor:string;bindingId:string;host:InlineHostTarget;before:string;after:string}
export interface DeviceInlineIO {
  loadRenames?():PendingResponseRename[];
  saveRenames?(renames:PendingResponseRename[]):void;
  receiveCoordinated?(record:LeaseRecord,proofBytes?:string):void|Promise<void>;
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
type Runtime={record:LeaseRecord;host:Host;writer:HostedInlineWriter;work?:Promise<void>;heartbeat?:Promise<void>;lastHeartbeat:number;maintenanceFailures?:number;nextTick:number;nextSnapshot:number;snapshotFailures:number;refresh?:SnapshotRefresh;writeEpoch?:number;state?:InlineThreadState;awaitingNote?:boolean;sequence:number;monitor?:{stop():void};proof?:{hash:string;bytes:string}};
type Host={target:InlineHostTarget;files:InlineFiles;client:InlineLeaseClient;close():void;discovery?:Promise<void>;lastDiscovery:number;responses:ExplorerResponse[]};
const hostKey=(target:InlineHostTarget)=>JSON.stringify([target.environmentId,target.workspaceRoot,target.directory]);
const comparable=(state:HostedInlineState|undefined)=>state?JSON.stringify({...state,updatedAt:''}):'';

/** One writer per granted epoch. Disposing or backgrounding never releases it:
 * only missing heartbeats allow another instance to take ownership. */
export class DeviceInlineManager {
  private stopped=false;
  private renames:PendingResponseRename[];
  private renameWork?:Promise<void>;
  private nextRenameRetry=0;
  private hosts=new Map<string,Host>();
  private jobs=new Map<string,Runtime>();
  private accessCache=new ThreadAccessCache((environmentId,reason)=>this.io.access(environmentId,reason),()=>this.now());
  private titles?:ThreadTitleFeed;
  constructor(readonly actor:string,private vaultId:string,private io:DeviceInlineIO,private open:(target:InlineHostTarget)=>Promise<{files:InlineFiles;close():void}>,private now=()=>Date.now(),private monotonic=()=>performance.now(),private pause?:(milliseconds:number)=>Promise<void>){const saved=io.loadRenames?.();this.renames=Array.isArray(saved)?saved:[];for(const rename of this.renames)this.host(rename.host);if(io.receiveThreadTitle)this.titles=new ThreadTitleFeed(environmentId=>io.access(environmentId),(id,title)=>io.receiveThreadTitle!(id,title));}
  private host(target:InlineHostTarget){
    const key=hostKey(target),existing=this.hosts.get(key);if(existing)return existing;
    let connection:Promise<{files:InlineFiles;close():void}>|undefined;
    const perform=async<T>(fn:(files:InlineFiles)=>Promise<T>)=>{
      const opened=connection??=this.open(target);
      try{return await fn((await opened).files);}catch(error){if(connection===opened)connection=undefined;void opened.then(value=>value.close()).catch(()=>{});throw error;}
    };
    const files:InlineFiles={read:path=>perform(io=>io.read(path)),write:(path,value)=>perform(io=>io.write(path,value))};
    const host:Host={target,files,client:new InlineLeaseClient(this.actor,files,target.directory,this.now,this.monotonic,this.pause),lastDiscovery:0,responses:[],close:()=>{host.client.dispose();void connection?.then(value=>value.close()).catch(()=>{});}};
    this.hosts.set(key,host);return host;
  }
  private access(environmentId:string){
    return this.accessCache.get(environmentId);
  }
  async register(request:HostedInlineRequest){
    if(this.stopped)throw Error('The plugin stopped before registering the response.');
    const host=this.host(request.host),reply=await host.client.command({kind:'register',jobId:request.id,request});
    if(!reply.ok||!reply.record)throw Error(reply.error??'Response registration failed.');
    this.receiveRecord(host,reply.record);const runtime=this.jobs.get(request.id);if(runtime)runtime.lastHeartbeat=this.now();this.tick();
  }
  async delivered(target:InlineHostTarget,id:string,delivery:InlineStartRequest){
    const host=this.host(target),reply=await host.client.command({kind:'delivery',jobId:id,delivery});
    if(!reply.ok||!reply.record)throw Error(reply.error??'Could not retain the prompt delivery evidence.');
    this.receiveRecord(host,reply.record);this.tick();
  }
  async stopResponse(target:InlineHostTarget,id:string){
    this.renames=this.renames.filter(item=>item.bindingId!==id);this.io.saveRenames?.(this.renames);
    const host=this.host(target),reply=await host.client.command({kind:'stop',jobId:id});
    if(!reply.ok||!reply.record)throw Error(reply.error??'Could not record the response stop.');
    this.receiveRecord(host,reply.record);this.tick();
  }
  async follow(target:InlineHostTarget,id:string,previousMessageId:string,messageId:string,notePath?:string){
    if(this.stopped)throw Error('The response writer is unavailable.');
    const host=this.host(target),reply=await host.client.command({kind:'follow',jobId:id,previousMessageId,messageId,notePath});
    if(!reply.ok||!reply.record)throw Error(reply.error??'Could not attach the continuation.');
    this.receiveRecord(host,reply.record);this.tick();
  }
  async steer(target:InlineHostTarget,id:string,steering:SteeringInput){
    if(this.stopped)throw Error('The response writer is unavailable.');
    const host=this.host(target),reply=await host.client.command({kind:'steer',jobId:id,steering});
    if(!reply.ok||!reply.record)throw Error(reply.error??'Could not attach the steering message.');
    this.receiveRecord(host,reply.record);this.tick();
  }
  discover(targets:InlineHostTarget[]){
    if(this.stopped)return;
    for(const target of targets)this.host(target);
    for(const host of this.hosts.values()){
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
          const bytes=await host.files.read(leasePaths(host.target.directory,request.id).record);if(!bytes||this.stopped)return;
          const record:LeaseRecord=JSON.parse(bytes);
          const path=await this.location(record);if(path===undefined)return;
          const document=await this.io.readNote(path);
          if(document===undefined||!this.available(record,document))return;
          this.receiveRecord(host,record);
        }));
        this.tick();
      })();host.discovery=work;void work.finally(()=>{host.discovery=undefined;}).catch(()=>{});
    }
  }
  explorerResponses():ExplorerResponse[]{return [...this.hosts.values()].flatMap(host=>host.responses);}
  stoppableResponses(path:string){return [...this.jobs.values()].filter(({record})=>(record.state?.notePath??record.request.notePath)===path&&!record.stopRequestedAt&&!record.state?.userStopped&&!terminalLease(record)).map(({record,host})=>({id:record.request.id,hostTarget:host.target}));}
  private receiveRecord(host:Host,record:LeaseRecord){
    if(this.stopped||record.request.vaultId!==this.vaultId||hostKey(record.request.host)!==hostKey(host.target))return;
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
      read:async path=>path===paths.request?JSON.stringify(runtime.record.request):path===paths.state?(runtime.record.state?JSON.stringify(runtime.record.state):undefined):path===paths.stop&&runtime.record.stopRequestedAt?'{}':host.files.read(path),
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
      if(!reply.ok&&reply.record?.stopRequestedAt){this.renames=this.renames.filter(item=>item.bindingId!==rename.bindingId);this.io.saveRenames?.(this.renames);return;}
      if(!reply.ok)throw Error(reply.error??'The rename was not acknowledged.');
      if(this.stopped)return;
      if(reply.record)this.receiveRecord(host,reply.record);
      this.renames=this.renames.filter(item=>item.id!==rename.id);this.io.saveRenames?.(this.renames);
    })().catch(error=>{this.nextRenameRetry=this.now()+3000;logFailure('response.rename.handoff',error,{bindingId:rename.bindingId,before:rename.before,after:rename.after});});
    this.renameWork=work;void work.finally(()=>{this.renameWork=undefined;}).catch(()=>{});
  }
  tick(){
    if(this.stopped)return;
    this.titles?.sync([...this.jobs.values()].filter(({record})=>record.coordinated&&!record.stopRequestedAt&&!terminalLease(record)&&this.io.isOpen(record.state?.notePath??record.request.notePath)).map(({record})=>record.request));
    this.flushRenames();
    for(const runtime of this.jobs.values()){
      const {record,host}=runtime,id=record.request.id;
      if(record.coordinated){
        runtime.refresh?.cancel(Error('Generated changes are coordinated by the host.'));runtime.monitor?.stop();runtime.monitor=undefined;runtime.writer.stop();
        if(record.state?.cleanupComplete&&record.state.delivery?.observedBy.includes(this.actor)){this.jobs.delete(id);continue;}
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
      if(!record.stopRequestedAt&&!runtime.refresh&&this.monotonic()>=runtime.nextSnapshot){
        void this.refreshSnapshot(runtime).catch(error=>{if(this.owns(runtime))logFailure('stream.freshness.failed',error,{jobId:id,threadId:record.request.threadId});});
      }
      if(!record.stopRequestedAt&&!runtime.monitor){
        const monitorEpoch=record.epoch;
        runtime.monitor=watchThread(record.request.threadId,async()=>{
        // A stream owns its own access lifetime. Its reconnect must not revoke
        // the independently cached access used for note checkpoints/assets.
        return this.io.access(record.request.threadEnvironmentId);
      },{item:item=>{if(runtime.record.epoch===monitorEpoch)this.item(runtime,item);},reconnecting:()=>{/* Retain exact start/turn evidence across feed reconnects. */}});
      }
      if(runtime.work&&this.now()>=runtime.nextTick){runtime.nextTick=this.now()+150;void runtime.writer.tick().catch(()=>{});}
      if(!runtime.work&&this.now()>=runtime.nextTick){
        runtime.nextTick=this.now()+150;runtime.writeEpoch=record.epoch;
        const work=runtime.writer.tick();runtime.work=work;void work.finally(()=>{runtime.work=undefined;}).catch(()=>{});
      }
    }
  }
  private async observeCoordinated(runtime:Runtime){
    const {host}=runtime,raw=await host.files.read(leasePaths(host.target.directory,runtime.record.request.id).record);if(!raw||this.stopped)return;
    const record:LeaseRecord=JSON.parse(raw);this.receiveRecord(host,record);
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
  changed(path:string){this.io.noteChanged?.(path);}
  deleted(path:string){this.io.noteDeleted?.(path);for(const host of this.hosts.values())host.responses=relocateExplorerResponses(host.responses,path);}
  renamed(before:string,after:string){
    this.io.noteRenamed?.(before,after);
    for(const host of this.hosts.values())host.responses=relocateExplorerResponses(host.responses,before,after);
    for(const runtime of this.jobs.values()){
      runtime.writer.renamed(before,after);runtime.nextTick=0;
      const current=this.renames.filter(item=>item.bindingId===runtime.record.request.id).at(-1)?.after??runtime.record.state?.notePath??runtime.record.request.notePath;
      if(runtime.record.coordinated&&!runtime.record.stopRequestedAt&&!terminalLease(runtime.record)&&(current===before||current.startsWith(before+'/'))){
        this.renames.push({id:crypto.randomUUID(),actor:this.actor,bindingId:runtime.record.request.id,host:runtime.host.target,before:current,after:after+current.slice(before.length)});
        // Preserve the exact authenticated mailbox command across offline
        // retries and reload. Successive moves are acknowledged in order.
        this.io.saveRenames?.(this.renames);this.nextRenameRetry=0;
      }
    }
    this.tick();
  }
  dispose(){
    this.stopped=true;
    this.titles?.dispose();
    for(const runtime of this.jobs.values()){runtime.refresh?.cancel(Error('Response writer stopped.'));runtime.monitor?.stop();runtime.writer.stop();}
    for(const host of this.hosts.values())host.close();
    void this.accessCache.dispose();
    this.jobs.clear();this.hosts.clear();
  }
}
