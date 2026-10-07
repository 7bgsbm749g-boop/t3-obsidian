import {logEvent,logFailure} from './diagnostics';
import {explorerResponsePath,leaseExplorerResponse,loadExplorerResponses,relocateExplorerResponses,type ExplorerResponse} from './explorer-responses';
import {legacyQuestionReply,pendingCompletionCleanup,hostedPaths,hostedRequestHash,safeNotePath,validateHostedRequest,type HostedInlineRequest,type HostedInlineState,type InlineFiles} from './hosted-inline';
import type {InlineStartRequest} from './inline-thread';
import {sameWorkspacePath} from './folder-link';
import {steeringBoundary,validSteeringInput,type SteeringInput} from './inline-steering';

export const LEASE_MS=15_000;
export const HEARTBEAT_MS=3000;
export const LEASE_MARGIN_MS=2000;
export type LeaseIdentity={vaultId:string;environmentId:string;workspaceRoot:string;directory:string};
export const COORDINATED_OWNER="00000000-0000-5000-8000-000000000001";
export interface LeaseRecord {relocations?:Array<{before:string;after:string}>;coordinated?:boolean;migrating?:boolean;legacyFenceUntil?:number;request:HostedInlineRequest;owner:string;epoch:number;expiresAt:number;revision:number;responseRemovedAt?:number;stopRequestedAt?:number;discardResponse?:boolean;stoppedBody?:string;state?:HostedInlineState}
export interface LeaseCommand {stoppedBody?:string;discardResponse?:boolean;id:string;jobId:string;actor:string;kind:'relocate'|'register'|'claim'|'heartbeat'|'checkpoint'|'follow'|'steer'|'delivery'|'stop'|'observe';previousNotePath?:string;observed?:{commitId:string;hash:string};delivery?:InlineStartRequest;epoch?:number;revision?:number;request?:HostedInlineRequest;state?:HostedInlineState;fallback?:boolean;previousMessageId?:string;messageId?:string;notePath?:string;steering?:SteeringInput}
export interface LeaseReply {id:string;ok:boolean;error?:string;record?:LeaseRecord;ttlMs:number;answeredAt?:number;retryAfterMs?:number}
export interface LeaseFiles extends InlineFiles {list(directory:string):Promise<string[]>;remove(path:string):Promise<void>}
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export const leasePaths=(directory:string,id:string)=>({record:`${directory}/leases/${id}.json`,command:`${directory}/mailbox/${id}.json`,reply:`${directory}/replies/${id}.json`,catalog:`${directory}/lease-catalog.json`});
export const terminalLease=(record:LeaseRecord)=>record.responseRemovedAt!==undefined||!!record.state&&['complete','interrupted','conflict'].includes(record.state.status)&&!legacyQuestionReply(record.state)&&!pendingCompletionCleanup(record.request,record.state);

/** The existing desktop host lock admits exactly one authority. Clients only
 * submit commands; only this serialized coordinator mutates lease records. */
export class InlineLeaseAuthority {
  private work?:Promise<void>;
  private stopped=false;
  private recovered=false;
  private explorerResponses:ExplorerResponse[]=[];
  private records=new Map<string,LeaseRecord>();
  private catalog=new Map<string,HostedInlineRequest>();
  private explorerDirty=false;private catalogDirty=false;
  private relocations:Array<{before:string;after?:string}>=[];
  renamed(before:string,after:string){this.relocations.push({before,after});}
  deleted(before:string){this.relocations.push({before});}
  private lastCleanup=0;private cleanupCursor=0;
  private scanFailed=false;private lastScanFailure=0;
  constructor(private identity:LeaseIdentity,private files:LeaseFiles,private now=()=>Date.now()){}
  status(){return {busy:!!this.work,stopped:this.stopped,recovered:this.recovered};}
  stop(){this.stopped=true;}
  tick(){
    if(this.work)return this.work;if(this.stopped)return Promise.resolve();
    const work=this.scan().then(()=>{if(this.scanFailed)logEvent('ownership.coordinator.recovered',this.identity);this.scanFailed=false;}).catch(error=>{
      if(!this.scanFailed||this.now()-this.lastScanFailure>=30_000){logFailure('ownership.coordinator.scan.failed',error,this.identity);this.lastScanFailure=this.now();}
      this.scanFailed=true;throw error;
    });
    this.work=work;void work.finally(()=>{if(this.work===work)this.work=undefined;}).catch(()=>{});return work;
  }
  private async scan(){
    const directory=this.identity.directory;
    if(!this.recovered){
      try{this.explorerResponses=loadExplorerResponses(JSON.parse((await this.files.read(explorerResponsePath(directory)))??'[]'));}catch{this.explorerResponses=[];}
      const catalog=JSON.parse((await this.files.read(leasePaths(directory,'').catalog))??'[]') as HostedInlineRequest[];
      this.catalog=new Map(catalog.map(request=>[request.id,request]));
      // Repair a crash between the durable grant and its discovery index.
      // Build both indexes once; rewriting them for every historical lease
      // delays the first interactive registration after a cold start.
      for(const path of await this.files.list(`${directory}/leases`)){
        if(this.stopped)return;
        const raw=await this.files.read(path);if(raw)this.indexRecord(JSON.parse(raw));
      }
      await this.flushIndexes();
      this.recovered=true;
    }
    while(this.relocations.length){
      const {before,after}=this.relocations[0];
      const next=relocateExplorerResponses(this.explorerResponses,before,after);
      await this.files.write(explorerResponsePath(directory),JSON.stringify(next));
      this.explorerResponses=next;this.relocations.shift();
    }
    const mailbox=await this.files.list(`${directory}/mailbox`);
    const commands:Array<{path:string;command:LeaseCommand}>=[];
    for(const path of mailbox){
      if(this.stopped)return;
      let command:LeaseCommand;
      try{command=JSON.parse((await this.files.read(path))??'');}catch{continue;}
      if(![command.id,command.jobId,command.actor].every(value=>uuid.test(value))||path!==leasePaths(directory,command.id).command)continue;
      commands.push({path,command});
    }
    // A legacy claim backlog must not gate sends or hold the authority lock
    // for an entire mailbox. Leave background capacity in every batch.
    const interactive=(command:LeaseCommand)=>!['claim','heartbeat'].includes(command.kind);
    const foreground=commands.filter(({command})=>interactive(command));
    const background=commands.filter(({command})=>!interactive(command));
    const batch=foreground.slice(0,24).concat(background.slice(0,8));
    for(const {path,command} of batch){
      if(this.stopped)return;
      const replyPath=leasePaths(directory,command.id).reply;
      if(!await this.files.read(replyPath)){
        const started=this.now(),trace=['register','follow','steer'].includes(command.kind);
        const fields={...this.identity,commandId:command.id,jobId:command.jobId,actor:command.actor,kind:command.kind,pendingCommands:mailbox.length};
        if(trace)logEvent('ownership.coordinator.received',fields);
        const reply=await this.apply(command);
        if(this.stopped)return;
        await this.files.write(replyPath,JSON.stringify(reply));
        if(trace||command.kind==='claim'&&reply.ok)logEvent('ownership.coordinator.replied',{...fields,ok:reply.ok,error:reply.error,durationMs:this.now()-started,epoch:reply.record?.epoch,revision:reply.record?.revision,owner:reply.record?.owner},reply.ok?'info':'warning');
      }
      await this.files.remove(path);
    }
    // Receipt cleanup is maintenance, never a prerequisite for answering a
    // send. Rotate a bounded slice so retained replies cannot stall the lock.
    if(this.now()-this.lastCleanup>30_000){
      this.lastCleanup=this.now();const replies=await this.files.list(`${directory}/replies`);
      if(this.cleanupCursor>=replies.length)this.cleanupCursor=0;
      const slice=replies.slice(this.cleanupCursor,this.cleanupCursor+32);this.cleanupCursor+=slice.length;
      for(const path of slice){
        if(this.stopped)return;
        const raw=await this.files.read(path);if(!raw)continue;
        try{const reply:LeaseReply=JSON.parse(raw);if(reply.answeredAt!==undefined&&reply.answeredAt<this.now()-60_000&&!await this.files.read(leasePaths(directory,reply.id).command))await this.files.remove(path);}catch{/* Leave unfamiliar files alone. */}
      }
    }
  }
  async exclusive<T>(run:()=>Promise<T>):Promise<T>{
    while(this.work)await this.work.catch(()=>{});
    if(this.stopped)throw Error('Host authority stopped.');
    const work=run();this.work=work.then(()=>{},()=>{});
    try{return await work;}finally{this.work=undefined;}
  }
  async checkpoint(id:string,state:HostedInlineState,fence?:{epoch:number;revision:number}){return this.exclusive(async()=>{
    const raw=await this.files.read(leasePaths(this.identity.directory,id).record);if(!raw)throw Error('Unknown host registration.');
    const record:LeaseRecord=JSON.parse(raw);
    if(fence&&(record.epoch!==fence.epoch||record.revision!==fence.revision))throw Error('The response ownership or revision changed before recovery.');
    if(!record.coordinated||record.migrating)throw Error('The native writer is not fenced and migrated.');
    const reply=await this.apply({id:crypto.randomUUID(),jobId:id,actor:COORDINATED_OWNER,kind:'checkpoint',epoch:record.epoch,revision:record.revision,state});
    if(!reply.ok)throw Error(reply.error);return reply.record!;
  });}
  /** Intentional note removal ends delivery only. Retain the complete lease
   * and journal evidence, and never invoke the remote thread stop control. */
  async removeResponse(id:string){return this.exclusive(async()=>{
    const path=leasePaths(this.identity.directory,id).record,raw=await this.files.read(path);if(!raw)throw Error('Unknown response binding.');
    const record:LeaseRecord=JSON.parse(raw);
    if(!record.coordinated||record.migrating)throw Error('The response is not coordinated.');
    if(record.responseRemovedAt!==undefined)return record;
    record.responseRemovedAt=this.now();record.revision++;
    await this.files.write(path,JSON.stringify(record));await this.publishCatalog(record);return record;
  });}
  async fence(id:string){return this.exclusive(async()=>{
    const path=leasePaths(this.identity.directory,id).record,raw=await this.files.read(path);if(!raw)return;
    let record:LeaseRecord=JSON.parse(raw);
    if(!record.coordinated){record={...record,coordinated:true,migrating:true,legacyFenceUntil:record.expiresAt+LEASE_MARGIN_MS,owner:COORDINATED_OWNER,epoch:record.epoch+1,expiresAt:Number.MAX_SAFE_INTEGER,revision:record.revision+1};await this.files.write(path,JSON.stringify(record));await this.publishCatalog(record);}
    return record;
  });}
  async renameNative(before:string,after:string){return this.exclusive(async()=>{
    for(const path of await this.files.list(`${this.identity.directory}/leases`)){
      const raw=await this.files.read(path);if(!raw)continue;const record:LeaseRecord=JSON.parse(raw),current=record.state?.notePath??record.request.notePath;
      if(!record.coordinated||!(current===before||current.startsWith(before+'/')))continue;
      const notePath=after+current.slice(before.length);if(!safeNotePath(notePath))throw Error('Invalid renamed note path.');
      record.relocations=[...record.relocations??[],{before:current,after:notePath}];
      record.state={...record.state??{requestHash:hostedRequestHash(record.request),accepted:false,status:'waiting' as const,hashes:[record.request.initialHash],updatedAt:new Date().toISOString()},notePath};record.revision++;await this.files.write(path,JSON.stringify(record));await this.publishCatalog(record);
    }
  });}
  async resume(id:string){return this.exclusive(async()=>{
    const path=leasePaths(this.identity.directory,id).record,raw=await this.files.read(path);if(!raw)throw Error('Unknown response binding.');
    const record:LeaseRecord=JSON.parse(raw);if(record.responseRemovedAt!==undefined||!record.state||!['paused','conflict'].includes(record.state.status)||record.state.finalSaved)throw Error('This response is not awaiting intact-boundary recovery.');
    record.state={...record.state,status:'waiting'};delete record.state.detail;delete record.state.locationConflict;record.revision++;await this.files.write(path,JSON.stringify(record));await this.publishCatalog(record);return record;
  });}
  async relocate(id:string,before:string,after:string){return this.exclusive(async()=>{
    const reply=await this.apply({id:crypto.randomUUID(),jobId:id,actor:COORDINATED_OWNER,kind:'relocate',previousNotePath:before,notePath:after});
    if(!reply.ok)throw Error(reply.error);return reply.record!;
  });}
  async migrated(id:string){return this.exclusive(async()=>{
    const path=leasePaths(this.identity.directory,id).record,raw=await this.files.read(path);if(!raw)throw Error('Missing migration record.');
    const record:LeaseRecord=JSON.parse(raw);if(!record.coordinated)throw Error('Writer is not fenced.');
    record.migrating=false;record.revision++;await this.files.write(path,JSON.stringify(record));await this.publishCatalog(record);return record;
  });}
  private async apply(command:LeaseCommand):Promise<LeaseReply>{
    const {directory}=this.identity,paths=leasePaths(directory,command.jobId);
    let record:LeaseRecord|undefined;
    const respond=(ok:boolean,error?:string):LeaseReply=>({id:command.id,ok,answeredAt:this.now(),...(error?{error}:{}),...(record?{record}:{}),ttlMs:record?Math.max(0,record.expiresAt-this.now()):0});
    try{
      const raw=await this.files.read(paths.record);if(raw)record=JSON.parse(raw);
      if(command.kind==='register'){
        const request=validateHostedRequest(command.request);
        if(![2,3,4].includes(request.version)||request.id!==command.jobId||request.vaultId!==this.identity.vaultId||request.host.environmentId!==this.identity.environmentId||!sameWorkspacePath(request.host.workspaceRoot,this.identity.workspaceRoot)||request.host.directory!==directory)throw Error('The response belongs to another host or vault.');
        if(record){if(hostedRequestHash(record.request)!==hostedRequestHash(request))throw Error('This response ID already belongs to another request.');await this.publishCatalog(record);return respond(true);}
        if(command.actor!==request.initialOwner)throw Error('Only the sending instance can register a response.');
        const writer=request.nativeProjection?undefined:this.noteWriter(request.notePath,request.id);
        record={request,owner:request.nativeProjection?COORDINATED_OWNER:writer??command.actor,epoch:1,expiresAt:request.nativeProjection?Number.MAX_SAFE_INTEGER:this.now()+LEASE_MS,revision:0,...(request.nativeProjection?{coordinated:true,migrating:true}:{})};
        await this.files.write(hostedPaths(directory,request.id).request,JSON.stringify(request));
        const stop=await this.files.read(hostedPaths(directory,request.id).stop);
        if(stop!==undefined){record.stopRequestedAt=this.now();try{const intent=JSON.parse(stop);record.discardResponse=intent.discardResponse===true;if(typeof intent.stoppedBody==='string')record.stoppedBody=intent.stoppedBody;}catch{/* Legacy stop files are valid. */}}
      }else{
        if(!record)throw Error('The response is not registered.');
        if(command.kind==='observe'){
          if(!record.coordinated||!record.state?.delivery||command.observed?.commitId!==record.state.delivery.commitId||command.observed?.hash!==record.state.delivery.hash)throw Error('Observed delivery does not match a host-verified commit.');
          record={...record,revision:record.revision+1,state:{...record.state,delivery:{...record.state.delivery,observedBy:[...new Set([...record.state.delivery.observedBy,command.actor])]}}};
          await this.files.write(paths.record,JSON.stringify(record));return respond(true);
        }
        if(command.kind==='follow'&&record.state?.messageId===command.messageId&&command.previousMessageId!==command.messageId)return respond(true);
        if(command.kind==='relocate'){
          const before=command.previousNotePath,after=command.notePath,current=record.state?.notePath??record.request.notePath;
          if(record.stopRequestedAt)throw Error('This response was canceled.');
          if(!record.coordinated||!safeNotePath(before)||!safeNotePath(after))throw Error('A coordinated response and exact rename paths are required.');
          if(current===after){
            const destination=record.relocations?.at(-1)?.after;
            if(!destination||destination===after)return respond(true);
            // Older checkpoints could overwrite state.notePath after a rename.
            // A reviewed same-path recovery must also correct its durable trail.
            if(before!==current)throw Error('The response moved again. Refresh its destination before retrying.');
            record={...record,relocations:[...record.relocations!,{before:destination,after}],revision:record.revision+1};
          }else{
            if(current!==before)throw Error('The response moved again. Refresh its destination before retrying.');
            record={...record,relocations:[...record.relocations??[],{before,after}],revision:record.revision+1,state:{...record.state??{requestHash:hostedRequestHash(record.request),accepted:false,status:'waiting',hashes:[record.request.initialHash],updatedAt:new Date().toISOString()},notePath:after}};
          }
        }else if(command.kind==='stop'){
          if(command.stoppedBody!==undefined&&typeof command.stoppedBody!=='string')throw Error('Invalid stopped response body.');
          if(record.responseRemovedAt!==undefined)return respond(true);
          if(!record.stopRequestedAt||command.discardResponse&&!record.discardResponse||command.stoppedBody!==undefined&&record.stoppedBody===undefined)record={...record,stopRequestedAt:record.stopRequestedAt??this.now(),...(command.discardResponse?{discardResponse:true}:{}),...(command.stoppedBody!==undefined&&record.stoppedBody===undefined?{stoppedBody:command.stoppedBody}:{}),revision:record.revision+1};
        }else if(command.kind==='steer'){
          if(record.responseRemovedAt!==undefined)throw Error('The response was removed from its note.');
          if(record.stopRequestedAt)throw Error('The response was stopped.');
          const input=command.steering,state=record.state;
          if(!validSteeringInput(input))throw Error('Invalid steering message.');
          const existing=state?.steering?.find(item=>item.messageId===input.messageId);
          if(existing){if(existing.text!==input.text||JSON.stringify(existing.selection)!==JSON.stringify(input.selection))throw Error('This steering ID already belongs to another message.');if(terminalLease(record)&&!existing.confirmed)throw Error('The response stopped before this message reached T3.');return respond(true);}
          if(!state||state.status!=='running'||!state.turnId||state.finalDocumentHash)throw Error('Wait for a running response before steering. If it finished or paused, ask again after it finishes.');
          record={...record,revision:record.revision+1,state:{...state,steering:[...state.steering??[],{...input,before:steeringBoundary(state.prose??[])}]}};
        }else if(command.kind==='delivery'){
          const delivery=command.delivery,state=record.state;
          const messageId=delivery?.messageId;
          if(!delivery||!uuid.test(messageId??'')||!Number.isSafeInteger(delivery.sequence)||delivery.sequence<0||!Number.isFinite(Date.parse(delivery.requestedAt))||delivery.activeTurnId!==undefined&&(typeof delivery.activeTurnId!=='string'||!delivery.activeTurnId))throw Error('Invalid T3 delivery evidence.');
          if(messageId!==record.request.messageId&&messageId!==state?.pendingMessageId&&messageId!==state?.messageId&&!state?.steering?.some(input=>input.messageId===messageId))throw Error('Delivery evidence belongs to another prompt.');
          const existing=state?.bindingCheckpoint?.starts?.[messageId!];
          if(existing){if(existing.requestedAt!==delivery.requestedAt)throw Error('The prompt delivery timestamp changed.');return respond(true);}
          if(terminalLease(record)||record.stopRequestedAt)return respond(true);
          const checkpoint=state?.bindingCheckpoint;
          record={...record,revision:record.revision+1,state:{...state??{requestHash:hostedRequestHash(record.request),accepted:false,status:'waiting' as const,hashes:[record.request.initialHash],notePath:record.request.notePath,updatedAt:new Date(this.now()).toISOString()},bindingCheckpoint:{...checkpoint,starts:{...checkpoint?.starts,[messageId!]:delivery}}}};
        }else if(command.kind==='follow'){
          if(record.responseRemovedAt!==undefined)throw Error('The response was removed from its note.');
          if(record.stopRequestedAt)throw Error('The response was stopped.');
          const state=record.state,previous=state?.messageId??record.request.messageId;
          if(state?.status!=='error'||!uuid.test(command.messageId??'')||command.messageId===previous||command.previousMessageId!==previous)throw Error('This response is no longer waiting for that continuation.');
          if(command.notePath!==undefined&&!safeNotePath(command.notePath))throw Error('Invalid continuation note path.');
          if(state.pendingMessageId&&state.pendingMessageId!==command.messageId)throw Error('A continuation is already waiting for its T3 turn.');
          if(state.pendingMessageId&&command.notePath&&command.notePath!==state.notePath)throw Error('The continuation note changed after it was attached.');
          if(!state.pendingMessageId)record={...record,revision:record.revision+1,state:{...state,pendingMessageId:command.messageId,notePath:command.notePath??state.notePath}};
        }else if(command.kind==='claim'){
          if(record.coordinated)return respond(false,'Generated changes are coordinated by the host.');
          if(terminalLease(record))return respond(false,'The response is finished.');
          if(record.expiresAt>this.now())return {...respond(false,'Another writer still owns this response.'),retryAfterMs:record.expiresAt-this.now()};
          // Give clients with the note open a short head start over closed-note
          // fallback writers. Healthy ownership is never preempted.
          if(command.fallback&&record.expiresAt+2000>this.now())return {...respond(false,'Waiting for an open-note writer.'),retryAfterMs:record.expiresAt+2000-this.now()};
          const notePath=command.notePath??record.state?.notePath??record.request.notePath;
          if(!safeNotePath(notePath))throw Error('Invalid response note path.');
          const writer=this.noteWriter(notePath,record.request.id);
          if(writer&&writer!==command.actor)return {...respond(false,'Another device owns a response in this note.'),retryAfterMs:LEASE_MS};
          const moved=notePath!==(record.state?.notePath??record.request.notePath);
          record={...record,owner:command.actor,epoch:record.epoch+1,expiresAt:this.now()+LEASE_MS,
            ...(moved?{revision:record.revision+1,state:{...record.state??{requestHash:hostedRequestHash(record.request),accepted:false,status:'waiting' as const,hashes:[record.request.initialHash],updatedAt:new Date(this.now()).toISOString()},notePath}}:{})};
        }else{
          if(record.owner!==command.actor||record.epoch!==command.epoch||record.expiresAt<=this.now())return respond(false,'Writer ownership expired.');
          if(command.kind==='heartbeat')record={...record,expiresAt:this.now()+LEASE_MS};
          else if(command.kind==='checkpoint'){
            if(record.responseRemovedAt!==undefined)throw Error('The response was removed from its note.');
            if(command.revision!==record.revision)return respond(false,'Response checkpoint changed.');
            const state=command.state;
            if(state?.userStopped!==undefined&&typeof state.userStopped!=='boolean')throw Error('Invalid response stop checkpoint.');
            if(record.state?.userStopped&&!state?.userStopped)throw Error('The response was stopped.');
            if(record.stopRequestedAt&&!state?.userStopped)throw Error('The response was stopped.');
            if(!state||state.requestHash!==hostedRequestHash(record.request)||!safeNotePath(state.notePath)||!Array.isArray(state.hashes)||state.hashes.some(hash=>!/^([0-9a-f]{64})$/.test(hash))||!['waiting','running','complete','interrupted','error','conflict','paused'].includes(state.status)||state.messageId!==undefined&&!uuid.test(state.messageId)&&!/^async-answer:[^\s\x00-\x1f]{1,200}$/.test(state.messageId)||state.pendingMessageId!==undefined&&!uuid.test(state.pendingMessageId))throw Error('Invalid response checkpoint.');
            // Destination ownership belongs to native rename/relocation records.
            // A writer's cached body checkpoint must not undo that decision.
            if(record.coordinated)state.notePath=record.state?.notePath??record.request.notePath;
            if(record.state?.pendingMessageId&&state.pendingMessageId!==record.state.pendingMessageId&&state.messageId!==record.state.pendingMessageId)throw Error('The pending continuation changed.');
            if(state.steering!==undefined&&(!Array.isArray(state.steering)||state.steering.length!==(record.state?.steering?.length??0)||state.steering.some(input=>!validSteeringInput(input)||!Array.isArray(input.before))))throw Error('Invalid steering checkpoint.');
            if(state.status==='complete'&&state.steering?.some(input=>!input.confirmed))throw Error('Waiting for steering delivery before finalizing.');
            if(state.finalSaved!==undefined&&typeof state.finalSaved!=='boolean'||state.cleanupComplete!==undefined&&typeof state.cleanupComplete!=='boolean'||state.finalSaved&&(state.finalBody===undefined||!['complete','interrupted'].includes(state.finalPhase??''))||state.cleanupComplete&&!state.finalSaved||record.state?.finalSaved&&!state.finalSaved)throw Error('Invalid completion cleanup checkpoint.');
            if(record.state?.steering?.some(input=>{
              const next=state.steering?.find(item=>item.messageId===input.messageId);
              return !next||next.text!==input.text||JSON.stringify(next.before)!==JSON.stringify(input.before)||JSON.stringify(next.selection)!==JSON.stringify(input.selection)||input.confirmed&&!next.confirmed||input.selectionApplied&&!next.selectionApplied;
            }))throw Error('The saved steering message changed.');
            if(record.state?.delivery&&state.delivery?.commitId===record.state.delivery.commitId&&state.delivery.hash===record.state.delivery.hash)state.delivery={...state.delivery,observedBy:[...new Set([...record.state.delivery.observedBy,...state.delivery.observedBy])]};
            const previous=record.state?.bindingCheckpoint,incoming=state.bindingCheckpoint;
            if(previous||incoming){
              const starts={...previous?.starts};
              for(const [id,start] of Object.entries(incoming?.starts??{}))starts[id]={...starts[id],...start};
              // A dispatch acknowledgement can arrive during a writer read.
              // The next checkpoint must retain it even when that read began
              // before delivery, just as steering reservations are retained.
              state.bindingCheckpoint={...previous,...incoming,starts,bindings:{...previous?.bindings,...incoming?.bindings},turns:{...previous?.turns,...incoming?.turns},sequence:Math.max(previous?.sequence??-1,incoming?.sequence??-1)};
              if(state.bindingCheckpoint.sequence===-1)delete state.bindingCheckpoint.sequence;
            }
            record={...record,revision:record.revision+1,state:{...state,hashes:[...new Set([record.request.initialHash,...record.state?.hashes??[],...state.hashes])]}};
          }else throw Error('Unknown ownership command.');
        }
      }
      if(this.stopped)throw Error('Ownership coordinator stopped.');
      await this.files.write(paths.record,JSON.stringify(record));
      await this.publishCatalog(record);
      return respond(true);
    }catch(error){return respond(false,error instanceof Error?error.message:'Ownership command failed.');}
  }
  private noteWriter(notePath:string,except:string):string|undefined{
    // This authority is the sole lease writer under the host lock. Its index
    // is rebuilt from durable records on restart and updated after every write.
    for(const record of this.records.values()){
      if(record.request.id!==except&&!terminalLease(record)&&record.expiresAt>this.now()&&(record.state?.notePath??record.request.notePath)===notePath)return record.owner;
    }
  }
  private async publishCatalog(record:LeaseRecord){
    this.indexRecord(record);await this.flushIndexes();
  }
  private indexRecord(record:LeaseRecord){
    this.records.set(record.request.id,record);
    const projected=leaseExplorerResponse(record),previous=this.explorerResponses.find(r=>r.id===projected.id);
    // Keep vault rename/delete observations across recovery until a newer
    // writer checkpoint supplies its canonical destination location.
    const moved=previous&&(previous.sourceNotePath===projected.notePath||previous.epoch===projected.epoch&&previous.revision===projected.revision);
    const response={...projected,...(moved?{notePath:previous.notePath,sourceNotePath:previous.sourceNotePath}:{}),...(previous?.deleted?{deleted:true}:{})};
    if(JSON.stringify(previous)!==JSON.stringify(response)){
      const next=this.explorerResponses.filter(r=>r.id!==response.id).concat(response);
      this.explorerResponses=next;this.explorerDirty=true;
    }
    const discoverable=!terminalLease(record);
    if(discoverable&&!this.catalog.has(record.request.id)){this.catalog.set(record.request.id,record.request);this.catalogDirty=true;}
    else if(!discoverable&&this.catalog.delete(record.request.id))this.catalogDirty=true;
  }
  private async flushIndexes(){
    if(this.explorerDirty){await this.files.write(explorerResponsePath(this.identity.directory),JSON.stringify(this.explorerResponses));this.explorerDirty=false;}
    if(this.catalogDirty){await this.files.write(leasePaths(this.identity.directory,'').catalog,JSON.stringify([...this.catalog.values()]));this.catalogDirty=false;}
  }
}

/** Mailbox transport uses the authenticated T3 file API; no synced locks,
 * credentials, additional ports, or background/visibility notifications. */
export class InlineLeaseClient {
  private stopped=false;
  private grants=new Map<string,{epoch:number;wall:number;monotonic:number}>();
  constructor(readonly actor:string,readonly files:InlineFiles,readonly directory:string,private now=()=>Date.now(),private monotonic=()=>performance.now(),private pause=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms))){}
  dispose(){this.stopped=true;this.grants.clear();} // Never release ownership.
  valid(id:string,epoch:number){const grant=this.grants.get(id);return !this.stopped&&grant?.epoch===epoch&&this.now()<grant.wall&&this.monotonic()<grant.monotonic;}
  async command(input:Omit<LeaseCommand,'id'|'actor'>,identity?:{id:string;actor:string}){
    if(this.stopped)throw Error('Response writer stopped.');
    const command:LeaseCommand={...input,id:identity?.id??crypto.randomUUID(),actor:identity?.actor??this.actor},paths=leasePaths(this.directory,command.id),wall=this.now(),monotonic=this.monotonic();
    const fields={jobId:input.jobId,commandId:command.id,actor:this.actor,directory:this.directory,kind:input.kind,epoch:input.epoch,revision:input.revision,messageId:input.steering?.messageId??input.request?.messageId,notePath:input.notePath??input.request?.notePath,threadId:input.request?.threadId,environmentId:input.request?.host.environmentId};
    const trace=input.kind!=='heartbeat'&&input.kind!=='claim';
    let phase='writing-command',attempts=0,writeMs=0,readMs=0,maxReadMs=0;
    const timing=()=>({phase,attempts,elapsedMs:Math.max(0,this.monotonic()-monotonic),writeMs,readMs,maxReadMs,stopped:this.stopped});
    if(trace)logEvent('ownership.command.started',fields);
    try{
    await this.files.write(paths.command,JSON.stringify(command));
    writeMs=Math.max(0,this.monotonic()-monotonic);phase='waiting-for-reply';
    if(trace)logEvent('ownership.command.sent',{...fields,writeMs});
    for(let attempt=0;attempt<50&&!this.stopped;attempt++){
      attempts++;const reading=this.monotonic();
      let raw:string|undefined;
      try{raw=await this.files.read(paths.reply);}finally{const duration=Math.max(0,this.monotonic()-reading);readMs+=duration;maxReadMs=Math.max(maxReadMs,duration);}
      if(raw){
        const reply:LeaseReply=JSON.parse(raw);
        if(reply.id!==command.id)throw Error('Invalid ownership acknowledgement.');
        const record=reply.record;
        if(reply.ok&&record?.owner===this.actor&&record.request.id===input.jobId){
          const duration=Math.max(0,Math.min(LEASE_MS,reply.ttlMs)-LEASE_MARGIN_MS);
          // Anchor expiry before the request, not at receipt: a delayed grant
          // cannot authorize writes after the server has reassigned the job.
          const previous=this.grants.get(input.jobId);
          if(!previous||record.epoch>previous.epoch||record.epoch===previous.epoch&&wall+duration>previous.wall)this.grants.set(input.jobId,{epoch:record.epoch,wall:wall+duration,monotonic:monotonic+duration});
        }else if(record?.owner!==this.actor||record.epoch!==input.epoch||reply.ttlMs===0)this.grants.delete(input.jobId);
        if(trace||input.kind==='claim'&&reply.ok||input.kind==='heartbeat'&&!reply.ok)logEvent('ownership.command.completed',{...fields,...timing(),ok:reply.ok,error:reply.error,owner:record?.owner,epoch:record?.epoch,revision:record?.revision,status:record?.state?.status,ttlMs:reply.ttlMs,answeredAt:reply.answeredAt},reply.ok?'info':'warning');
        return reply;
      }
      await this.pause(100);
    }
    throw Error(input.request?.nativeProjection?'The response host did not acknowledge registration. The saved request can be retried.':'The ownership coordinator did not answer. The saved request can be retried.');
    }catch(error){logFailure('ownership.command.failed',error,{...fields,...timing()});throw error;}
  }
}
