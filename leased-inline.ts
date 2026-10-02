import {explorerResponsePath,leaseExplorerResponse,loadExplorerResponses,relocateExplorerResponses,type ExplorerResponse} from './explorer-responses';
import {contentHash} from './completion';
import {HostedInlineWriter,hostedPaths,validateHostedRequest,pendingCompletionCleanup,type HostedInlineRequest,type HostedInlineState,type InlineFiles,type InlineHostTarget} from './hosted-inline';
import {InlineLeaseClient,HEARTBEAT_MS,leasePaths,terminalLease,type LeaseRecord,type LeaseReply} from './inline-lease';
import {applyThreadItem,hasCompletionProof,hasResponseMarkers,regionBody,type InlineThreadState} from './inline-thread';
import {readInlineSnapshot,watchThread,type ThreadAccess,type ThreadStreamItem} from './thread-stream';
import type {ReplyReference} from './reply-assets';
import type {SteeringInput} from './inline-steering';
import {logFailure} from './diagnostics';

export const INLINE_SNAPSHOT_INTERVAL_MS=10_000;
export const INLINE_SNAPSHOT_TIMEOUT_MS=30_000;

export interface DeviceInlineIO {
  access(environmentId:string):Promise<ThreadAccess>;
  readNote(path:string):Promise<string|undefined>;
  locateNote?(id:string,path:string):Promise<string|undefined>;
  noteChanged?(path:string):void;
  noteRenamed?(before:string,after:string):void;
  noteDeleted?(path:string):void;
  isOpen(path:string):boolean;
  isSaved?(path:string,hash:string,proof?:{id:string;body:string;cleaned?:boolean}):Promise<boolean>;
  updateNote(path:string,change:(current:string)=>string,allowed:()=>boolean):Promise<string|undefined>;
  importReplyAsset?(reference:ReplyReference,request:HostedInlineRequest,access:ThreadAccess):Promise<string|undefined>;
}
type SnapshotRefresh={epoch:number;startedAt:number;work:Promise<InlineThreadState|undefined>;cancel(error:Error):void};
type Runtime={record:LeaseRecord;host:Host;writer:HostedInlineWriter;work?:Promise<void>;heartbeat?:Promise<void>;lastHeartbeat:number;nextTick:number;nextSnapshot:number;snapshotFailures:number;refresh?:SnapshotRefresh;writeEpoch?:number;state?:InlineThreadState;awaitingNote?:boolean;sequence:number;monitor?:{stop():void}};
type Host={target:InlineHostTarget;files:InlineFiles;client:InlineLeaseClient;close():void;discovery?:Promise<void>;lastDiscovery:number;responses:ExplorerResponse[]};
const hostKey=(target:InlineHostTarget)=>JSON.stringify([target.environmentId,target.workspaceRoot,target.directory]);
const comparable=(state:HostedInlineState|undefined)=>state?JSON.stringify({...state,updatedAt:''}):'';

/** One writer per granted epoch. Disposing or backgrounding never releases it:
 * only missing heartbeats allow another instance to take ownership. */
export class DeviceInlineManager {
  private stopped=false;
  private hosts=new Map<string,Host>();
  private jobs=new Map<string,Runtime>();
  private accesses=new Map<string,{value:Promise<ThreadAccess>;expires:number}>();
  constructor(readonly actor:string,private vaultId:string,private io:DeviceInlineIO,private open:(target:InlineHostTarget)=>Promise<{files:InlineFiles;close():void}>,private now=()=>Date.now(),private monotonic=()=>performance.now(),private pause?:(milliseconds:number)=>Promise<void>){}
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
    let current=this.accesses.get(environmentId);
    if(current&&current.expires<=this.now()){void current.value.then(access=>access.close?.()).catch(()=>{});this.accesses.delete(environmentId);current=undefined;}
    if(!current){
      const value=this.io.access(environmentId);current={value,expires:this.now()+180_000};this.accesses.set(environmentId,current);
      void value.catch(()=>{if(this.accesses.get(environmentId)?.value===value)this.accesses.delete(environmentId);});
    }
    return current.value;
  }
  async register(request:HostedInlineRequest){
    if(this.stopped)throw Error('The plugin stopped before registering the response.');
    const host=this.host(request.host),reply=await host.client.command({kind:'register',jobId:request.id,request});
    if(!reply.ok||!reply.record)throw Error(reply.error??'Response registration failed.');
    this.receiveRecord(host,reply.record);const runtime=this.jobs.get(request.id);if(runtime)runtime.lastHeartbeat=this.now();this.tick();
  }
  async stopResponse(target:InlineHostTarget,id:string){
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
          if(![2,3].includes(request.version)||request.vaultId!==this.vaultId||hostKey(request.host)!==hostKey(host.target)||this.jobs.has(request.id))return;
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
  private receiveRecord(host:Host,record:LeaseRecord){
    if(this.stopped||record.request.vaultId!==this.vaultId||hostKey(record.request.host)!==hostKey(host.target))return;
    const projected=leaseExplorerResponse(record),previous=host.responses.find(r=>r.id===projected.id);
    if(!previous||projected.epoch>previous.epoch||projected.epoch===previous.epoch&&projected.revision>previous.revision)host.responses=host.responses.filter(r=>r.id!==projected.id).concat(projected);
    const old=this.jobs.get(record.request.id);
    if(old){if(record.epoch>old.record.epoch||record.epoch===old.record.epoch&&record.revision>=old.record.revision){old.record=record;if(record.stopRequestedAt)old.writer.requestStop(record.request.id);}return;}
    if(terminalLease(record))return;
    const runtime={} as Runtime;
    Object.assign(runtime,{record,host,lastHeartbeat:-Infinity,nextTick:0,nextSnapshot:0,snapshotFailures:0,sequence:-1});
    const paths=hostedPaths(host.target.directory,record.request.id);
    let stopping=false;
    const allowed=()=>!this.stopped&&(!runtime.record.stopRequestedAt||stopping)&&runtime.writeEpoch===runtime.record.epoch&&runtime.record.owner===this.actor&&host.client.valid(record.request.id,runtime.record.epoch);
    runtime.writer=new HostedInlineWriter({vaultId:this.vaultId,...host.target},{
      requests:async()=>[paths.request],accepts:request=>{if(runtime.record.stopRequestedAt)stopping=true;return [2,3].includes(request.version)&&allowed();},
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
        if(!refresh&&runtime.state)return runtime.state;
        return this.refreshSnapshot(runtime,access);
      },
      updateNote:async(path,change)=>{
        if(this.io.locateNote&&await this.io.locateNote(record.request.id,path)!==path)throw Error('The response note moved during the update; retrying.');
        return this.io.updateNote(path,change,allowed);
      },
      importReplyAsset:this.io.importReplyAsset?(reference,request,access)=>this.io.importReplyAsset!(reference,{...request,notePath:runtime.record.state?.notePath??request.notePath},access):undefined,
    });
    this.jobs.set(record.request.id,runtime);
  }
  private reply(runtime:Runtime,reply:LeaseReply){if(reply.record)this.receiveRecord(runtime.host,reply.record);}
  private owns(runtime:Runtime){return !this.stopped&&!runtime.record.stopRequestedAt&&runtime.record.owner===this.actor&&runtime.host.client.valid(runtime.record.request.id,runtime.record.epoch);}
  /** Driven by the same desktop tick as lease renewal, independently of the
   * stream's browser polling/reconnect timers and cached running/complete phase.
   * The tick also bounds a hung read; late results cannot cross ownership epochs. */
  private refreshSnapshot(runtime:Runtime,access?:ThreadAccess):Promise<InlineThreadState|undefined>{
    if(!this.owns(runtime))return Promise.resolve(undefined);
    if(runtime.refresh?.epoch===runtime.record.epoch)return runtime.refresh.work;
    if(runtime.snapshotFailures&&this.monotonic()<runtime.nextSnapshot)return Promise.reject(Error('Waiting to retry the T3 response freshness check.'));
    runtime.refresh?.cancel(Error('Response ownership changed.'));
    const epoch=runtime.record.epoch,request=runtime.record.request;
    let resolve!:(state:InlineThreadState|undefined)=>void,reject!:(error:Error)=>void;
    const work=new Promise<InlineThreadState|undefined>((done,fail)=>{resolve=done;reject=fail;});
    const refresh:SnapshotRefresh={epoch,startedAt:this.monotonic(),work,cancel:error=>{
      if(runtime.refresh!==refresh)return;
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
      runtime.refresh=undefined;runtime.snapshotFailures=0;runtime.nextSnapshot=this.monotonic()+INLINE_SNAPSHOT_INTERVAL_MS;
      runtime.nextTick=0;resolve(runtime.state);this.tick();
    })().catch(error=>refresh.cancel(error instanceof Error?error:Error(String(error))));
    return work;
  }
  tick(){
    if(this.stopped)return;
    for(const runtime of this.jobs.values()){
      const {record,host}=runtime,id=record.request.id;
      if(terminalLease(record)){runtime.refresh?.cancel(Error('Response completed.'));runtime.monitor?.stop();runtime.writer.stop();this.jobs.delete(id);continue;}
      const owns=record.owner===this.actor&&host.client.valid(id,record.epoch);
      if(!runtime.heartbeat&&this.now()-runtime.lastHeartbeat>=HEARTBEAT_MS){
        runtime.lastHeartbeat=this.now();
        const work=this.maintain(runtime);runtime.heartbeat=work;void work.finally(()=>{runtime.heartbeat=undefined;}).catch(()=>{});
      }
      if(!owns){runtime.refresh?.cancel(Error('Response ownership changed.'));runtime.monitor?.stop();runtime.monitor=undefined;runtime.state=undefined;runtime.sequence=-1;runtime.nextSnapshot=0;continue;}
      if(record.stopRequestedAt){runtime.refresh?.cancel(Error('Response stopped.'));runtime.monitor?.stop();runtime.monitor=undefined;runtime.writer.requestStop(id);}
      if(runtime.refresh&&this.monotonic()-runtime.refresh.startedAt>=INLINE_SNAPSHOT_TIMEOUT_MS)runtime.refresh.cancel(Error('T3 response freshness check timed out.'));
      if(!record.stopRequestedAt&&!runtime.refresh&&this.monotonic()>=runtime.nextSnapshot){
        void this.refreshSnapshot(runtime).catch(error=>{if(this.owns(runtime))logFailure('stream.freshness.failed',error,{jobId:id,threadId:record.request.threadId});});
      }
      if(!record.stopRequestedAt&&!runtime.monitor)runtime.monitor=watchThread(record.request.threadId,async()=>{
        // A stream owns its own access lifetime. Its reconnect must not revoke
        // the independently cached access used for note checkpoints/assets.
        return this.io.access(record.request.threadEnvironmentId);
      },{item:item=>this.item(runtime,item),reconnecting:()=>{runtime.state=undefined;}});
      if(runtime.work&&this.now()>=runtime.nextTick){runtime.nextTick=this.now()+150;void runtime.writer.tick().catch(()=>{});}
      if(!runtime.work&&this.now()>=runtime.nextTick){
        runtime.nextTick=this.now()+150;runtime.writeEpoch=record.epoch;
        const work=runtime.writer.tick();runtime.work=work;void work.finally(()=>{runtime.work=undefined;}).catch(()=>{});
      }
    }
  }
  private async maintain(runtime:Runtime){
    const {host}=runtime;let record=runtime.record;
    // Read authoritative state before claiming. A suspended process cannot
    // renew an old epoch just because it has resumed its timers.
    const raw=await host.files.read(leasePaths(host.target.directory,record.request.id).record);
    if(!raw||this.stopped)return;
    record=JSON.parse(raw);this.receiveRecord(host,record);
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
    const applied=applyThreadItem(runtime.state??{messages:[],activities:[]},item);
    runtime.state=applied.state;if(applied.sequence!==undefined)runtime.sequence=applied.sequence;
    if(item.kind==='snapshot'){runtime.nextSnapshot=this.monotonic()+INLINE_SNAPSHOT_INTERVAL_MS;runtime.snapshotFailures=0;}
  }
  changed(path:string){this.io.noteChanged?.(path);}
  deleted(path:string){this.io.noteDeleted?.(path);for(const host of this.hosts.values())host.responses=relocateExplorerResponses(host.responses,path);}
  renamed(before:string,after:string){this.io.noteRenamed?.(before,after);for(const host of this.hosts.values())host.responses=relocateExplorerResponses(host.responses,before,after);for(const runtime of this.jobs.values()){runtime.writer.renamed(before,after);runtime.nextTick=0;}this.tick();}
  dispose(){
    this.stopped=true;
    for(const runtime of this.jobs.values()){runtime.refresh?.cancel(Error('Response writer stopped.'));runtime.monitor?.stop();runtime.writer.stop();}
    for(const host of this.hosts.values())host.close();
    for(const access of this.accesses.values())void access.value.then(value=>value.close?.()).catch(()=>{});
    this.jobs.clear();this.hosts.clear();this.accesses.clear();
  }
}
