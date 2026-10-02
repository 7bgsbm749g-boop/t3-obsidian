import {contentHash} from './completion';
import {HostedInlineWriter,hostedPaths,validateHostedRequest,pendingCompletionCleanup,type HostedInlineRequest,type HostedInlineState,type InlineFiles,type InlineHostTarget} from './hosted-inline';
import {InlineLeaseClient,HEARTBEAT_MS,leasePaths,terminalLease,type LeaseRecord,type LeaseReply} from './inline-lease';
import {applyThreadItem,hasCompletionProof,hasResponseMarkers,regionBody,type InlineThreadState} from './inline-thread';
import {readInlineSnapshot,watchThread,type ThreadAccess,type ThreadStreamItem} from './thread-stream';
import type {ReplyReference} from './reply-assets';
import type {SteeringInput} from './inline-steering';

export interface DeviceInlineIO {
  access(environmentId:string):Promise<ThreadAccess>;
  readNote(path:string):Promise<string|undefined>;
  isOpen(path:string):boolean;
  isSaved?(path:string,hash:string,proof?:{id:string;body:string;cleaned?:boolean}):Promise<boolean>;
  updateNote(path:string,change:(current:string)=>string,allowed:()=>boolean):Promise<string|undefined>;
  importReplyAsset?(reference:ReplyReference,request:HostedInlineRequest,access:ThreadAccess):Promise<string|undefined>;
}
type Runtime={record:LeaseRecord;host:Host;writer:HostedInlineWriter;work?:Promise<void>;heartbeat?:Promise<void>;lastHeartbeat:number;nextTick:number;writeEpoch?:number;state?:InlineThreadState;sequence:number;monitor?:{stop():void}};
type Host={target:InlineHostTarget;files:InlineFiles;client:InlineLeaseClient;close():void;discovery?:Promise<void>;lastDiscovery:number};
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
    const host:Host={target,files,client:new InlineLeaseClient(this.actor,files,target.directory,this.now,this.monotonic,this.pause),lastDiscovery:0,close:()=>{host.client.dispose();void connection?.then(value=>value.close()).catch(()=>{});}};
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
        const raw=await host.files.read(leasePaths(host.target.directory,'').catalog);if(!raw||this.stopped)return;
        const requests=JSON.parse(raw);if(!Array.isArray(requests))return;
        await Promise.allSettled(requests.map(async value=>{
          const request=validateHostedRequest(value);
          if(request.version!==2||request.vaultId!==this.vaultId||hostKey(request.host)!==hostKey(host.target)||this.jobs.has(request.id))return;
          const bytes=await host.files.read(leasePaths(host.target.directory,request.id).record);if(!bytes||this.stopped)return;
          const record:LeaseRecord=JSON.parse(bytes);
          const path=record.state?.notePath??request.notePath,document=await this.io.readNote(path);
          if(document===undefined||!this.available(record,document))return;
          this.receiveRecord(host,record);
        }));
        this.tick();
      })();host.discovery=work;void work.finally(()=>{host.discovery=undefined;}).catch(()=>{});
    }
  }
  private receiveRecord(host:Host,record:LeaseRecord){
    if(this.stopped||record.request.vaultId!==this.vaultId||hostKey(record.request.host)!==hostKey(host.target))return;
    const old=this.jobs.get(record.request.id);
    if(old){if(record.epoch>old.record.epoch||record.epoch===old.record.epoch&&record.revision>=old.record.revision)old.record=record;return;}
    if(terminalLease(record))return;
    const runtime={} as Runtime;
    Object.assign(runtime,{record,host,lastHeartbeat:-Infinity,nextTick:0,sequence:-1});
    const paths=hostedPaths(host.target.directory,record.request.id);
    const allowed=()=>!this.stopped&&runtime.writeEpoch===runtime.record.epoch&&runtime.record.owner===this.actor&&host.client.valid(record.request.id,runtime.record.epoch);
    runtime.writer=new HostedInlineWriter({vaultId:this.vaultId,...host.target},{
      requests:async()=>[paths.request],accepts:request=>request.version===2&&allowed(),
      canResume:path=>this.io.isOpen(path),
      read:async path=>path===paths.request?JSON.stringify(runtime.record.request):path===paths.state?(runtime.record.state?JSON.stringify(runtime.record.state):undefined):host.files.read(path),
      write:async(path,value)=>{
        if(path!==paths.state||!allowed())throw Error('Writer ownership expired.');
        const state:HostedInlineState=JSON.parse(value);
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
        if(!refresh)return runtime.state;
        const state=runtime.record.state;
        const snapshot=await readInlineSnapshot(access,request.threadId,request.projectId,{messageIds:[state?.pendingMessageId??state?.messageId??request.messageId],turnIds:state?.turnIds??(state?.turnId?[state.turnId]:[])});
        if(snapshot?.thread?.id!==request.threadId||snapshot.thread.projectId!==request.projectId)throw Error('Waiting for the requested T3 thread.');
        return applyThreadItem({messages:[],activities:[]},{kind:'snapshot',snapshot}).state;
      },
      updateNote:(path,change)=>this.io.updateNote(path,change,allowed),
      importReplyAsset:this.io.importReplyAsset?(reference,request,access)=>this.io.importReplyAsset!(reference,{...request,notePath:runtime.record.state?.notePath??request.notePath},access):undefined,
    });
    this.jobs.set(record.request.id,runtime);
  }
  private reply(runtime:Runtime,reply:LeaseReply){if(reply.record)this.receiveRecord(runtime.host,reply.record);}
  tick(){
    if(this.stopped)return;
    for(const runtime of this.jobs.values()){
      const {record,host}=runtime,id=record.request.id;
      if(terminalLease(record)){runtime.monitor?.stop();runtime.writer.stop();this.jobs.delete(id);continue;}
      const owns=record.owner===this.actor&&host.client.valid(id,record.epoch);
      if(!runtime.heartbeat&&this.now()-runtime.lastHeartbeat>=HEARTBEAT_MS){
        runtime.lastHeartbeat=this.now();
        const work=this.maintain(runtime);runtime.heartbeat=work;void work.finally(()=>{runtime.heartbeat=undefined;}).catch(()=>{});
      }
      if(!owns){runtime.monitor?.stop();runtime.monitor=undefined;runtime.state=undefined;runtime.sequence=-1;continue;}
      if(!runtime.monitor)runtime.monitor=watchThread(record.request.threadId,async()=>{
        // A stream owns its own access lifetime. Its reconnect must not revoke
        // the independently cached access used for note checkpoints/assets.
        return this.io.access(record.request.threadEnvironmentId);
      },{item:item=>this.item(runtime,item),reconnecting:()=>{runtime.state=undefined;}});
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
    const path=record.state?.notePath??record.request.notePath;
    const document=await this.io.readNote(path);
    if(document===undefined||!this.available(record,document))return;
    const renewing=record.owner===this.actor&&host.client.valid(record.request.id,record.epoch);
    const reply=await host.client.command({kind:renewing?'heartbeat':'claim',jobId:record.request.id,epoch:record.epoch,fallback:!this.io.isOpen(path)});
    this.reply(runtime,reply);
  }
  private available(record:LeaseRecord,document:string){
    const {request,state}=record;
    return state?.finalSaved===true||pendingCompletionCleanup(request,state)&&hasResponseMarkers(document,request.id)||!!regionBody(document,request.id)||contentHash(document)===state?.finalDocumentHash||state?.finalBody!==undefined&&hasCompletionProof(document,request.id,state.finalBody);
  }
  private item(runtime:Runtime,item:ThreadStreamItem){
    if(this.stopped||runtime.record.owner!==this.actor||!runtime.host.client.valid(runtime.record.request.id,runtime.record.epoch))return;
    if(item.kind==='snapshot'){
      if(item.snapshot?.thread?.id!==runtime.record.request.threadId||item.snapshot.thread.projectId!==runtime.record.request.projectId)return;
      if(Number.isSafeInteger(item.snapshot.snapshotSequence)&&item.snapshot.snapshotSequence<runtime.sequence)return;
    }
    if(item.kind==='event'&&Number.isSafeInteger(item.event?.sequence)&&item.event.sequence<=runtime.sequence)return;
    const applied=applyThreadItem(runtime.state??{messages:[],activities:[]},item);
    runtime.state=applied.state;if(applied.sequence!==undefined)runtime.sequence=applied.sequence;
  }
  renamed(before:string,after:string){for(const runtime of this.jobs.values())runtime.writer.renamed(before,after);}
  dispose(){
    this.stopped=true;
    for(const runtime of this.jobs.values()){runtime.monitor?.stop();runtime.writer.stop();}
    for(const host of this.hosts.values())host.close();
    for(const access of this.accesses.values())void access.value.then(value=>value.close?.()).catch(()=>{});
    this.jobs.clear();this.hosts.clear();this.accesses.clear();
  }
}
