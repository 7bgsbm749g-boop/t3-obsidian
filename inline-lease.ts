import {logEvent,logFailure} from './diagnostics';
import {legacyQuestionReply,pendingCompletionCleanup,hostedPaths,hostedRequestHash,safeNotePath,validateHostedRequest,type HostedInlineRequest,type HostedInlineState,type InlineFiles} from './hosted-inline';
import {sameWorkspacePath} from './folder-link';
import {steeringBoundary,validSteeringInput,type SteeringInput} from './inline-steering';

export const LEASE_MS=15_000;
export const HEARTBEAT_MS=3000;
export const LEASE_MARGIN_MS=2000;
export type LeaseIdentity={vaultId:string;environmentId:string;workspaceRoot:string;directory:string};
export interface LeaseRecord {request:HostedInlineRequest;owner:string;epoch:number;expiresAt:number;revision:number;stopRequestedAt?:number;state?:HostedInlineState}
export interface LeaseCommand {id:string;jobId:string;actor:string;kind:'register'|'claim'|'heartbeat'|'checkpoint'|'follow'|'steer'|'stop';epoch?:number;revision?:number;request?:HostedInlineRequest;state?:HostedInlineState;fallback?:boolean;previousMessageId?:string;messageId?:string;notePath?:string;steering?:SteeringInput}
export interface LeaseReply {id:string;ok:boolean;error?:string;record?:LeaseRecord;ttlMs:number;answeredAt?:number}
export interface LeaseFiles extends InlineFiles {list(directory:string):Promise<string[]>;remove(path:string):Promise<void>}
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export const leasePaths=(directory:string,id:string)=>({record:`${directory}/leases/${id}.json`,command:`${directory}/mailbox/${id}.json`,reply:`${directory}/replies/${id}.json`,catalog:`${directory}/lease-catalog.json`});
export const terminalLease=(record:LeaseRecord)=>!!record.state&&['complete','interrupted','conflict'].includes(record.state.status)&&!legacyQuestionReply(record.state)&&!pendingCompletionCleanup(record.request,record.state);

/** The existing desktop host lock admits exactly one authority. Clients only
 * submit commands; only this serialized coordinator mutates lease records. */
export class InlineLeaseAuthority {
  private work?:Promise<void>;
  private stopped=false;
  private recovered=false;
  private lastCleanup=0;
  private scanFailed=false;private lastScanFailure=0;
  constructor(private identity:LeaseIdentity,private files:LeaseFiles,private now=()=>Date.now()){}
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
      // Repair a crash between the durable grant and its discovery index.
      for(const path of await this.files.list(`${directory}/leases`)){
        if(this.stopped)return;
        const raw=await this.files.read(path);if(raw)await this.publishCatalog(JSON.parse(raw));
      }
      this.recovered=true;
    }
    if(this.now()-this.lastCleanup>30_000){
      this.lastCleanup=this.now();
      for(const path of await this.files.list(`${directory}/replies`)){
        if(this.stopped)return;
        const raw=await this.files.read(path);if(!raw)continue;
        try{const reply:LeaseReply=JSON.parse(raw);if(reply.answeredAt!==undefined&&reply.answeredAt<this.now()-60_000&&!await this.files.read(leasePaths(directory,reply.id).command))await this.files.remove(path);}catch{/* Leave unfamiliar files alone. */}
      }
    }
    const mailbox=await this.files.list(`${directory}/mailbox`);
    for(const path of mailbox){
      if(this.stopped)return;
      let command:LeaseCommand;
      try{command=JSON.parse((await this.files.read(path))??'');}catch{continue;}
      if(![command.id,command.jobId,command.actor].every(value=>uuid.test(value))||path!==leasePaths(directory,command.id).command)continue;
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
  }
  private async apply(command:LeaseCommand):Promise<LeaseReply>{
    const {directory}=this.identity,paths=leasePaths(directory,command.jobId);
    let record:LeaseRecord|undefined;
    const respond=(ok:boolean,error?:string):LeaseReply=>({id:command.id,ok,answeredAt:this.now(),...(error?{error}:{}),...(record?{record}:{}),ttlMs:record?Math.max(0,record.expiresAt-this.now()):0});
    try{
      const raw=await this.files.read(paths.record);if(raw)record=JSON.parse(raw);
      if(command.kind==='register'){
        const request=validateHostedRequest(command.request);
        if(request.version!==2||request.id!==command.jobId||request.vaultId!==this.identity.vaultId||request.host.environmentId!==this.identity.environmentId||!sameWorkspacePath(request.host.workspaceRoot,this.identity.workspaceRoot)||request.host.directory!==directory)throw Error('The response belongs to another host or vault.');
        if(record){if(hostedRequestHash(record.request)!==hostedRequestHash(request))throw Error('This response ID already belongs to another request.');await this.publishCatalog(record);return respond(true);}
        if(command.actor!==request.initialOwner)throw Error('Only the sending instance can register a response.');
        const writer=await this.noteWriter(request.notePath,request.id);
        record={request,owner:writer??command.actor,epoch:1,expiresAt:this.now()+LEASE_MS,revision:0};
        await this.files.write(hostedPaths(directory,request.id).request,JSON.stringify(request));
      }else{
        if(!record)throw Error('The response is not registered.');
        if(command.kind==='follow'&&record.state?.messageId===command.messageId&&command.previousMessageId!==command.messageId)return respond(true);
        if(command.kind==='stop'){
          if(!record.stopRequestedAt)record={...record,stopRequestedAt:this.now(),revision:record.revision+1};
        }else if(command.kind==='steer'){
          if(record.stopRequestedAt)throw Error('The response was stopped.');
          const input=command.steering,state=record.state;
          if(!validSteeringInput(input))throw Error('Invalid steering message.');
          const existing=state?.steering?.find(item=>item.messageId===input.messageId);
          if(existing){if(existing.text!==input.text||JSON.stringify(existing.selection)!==JSON.stringify(input.selection))throw Error('This steering ID already belongs to another message.');if(terminalLease(record)&&!existing.confirmed)throw Error('The response stopped before this message reached T3.');return respond(true);}
          if(!state||state.status!=='running'||!state.turnId||state.finalDocumentHash)throw Error('Wait for a running response before steering. If it finished or paused, ask again after it finishes.');
          record={...record,revision:record.revision+1,state:{...state,steering:[...state.steering??[],{...input,before:steeringBoundary(state.prose??[])}]}};
        }else if(command.kind==='follow'){
          if(record.stopRequestedAt)throw Error('The response was stopped.');
          const state=record.state,previous=state?.messageId??record.request.messageId;
          if(state?.status!=='error'||!uuid.test(command.messageId??'')||command.messageId===previous||command.previousMessageId!==previous)throw Error('This response is no longer waiting for that continuation.');
          if(command.notePath!==undefined&&!safeNotePath(command.notePath))throw Error('Invalid continuation note path.');
          if(state.pendingMessageId&&state.pendingMessageId!==command.messageId)throw Error('A continuation is already waiting for its T3 turn.');
          if(state.pendingMessageId&&command.notePath&&command.notePath!==state.notePath)throw Error('The continuation note changed after it was attached.');
          if(!state.pendingMessageId)record={...record,revision:record.revision+1,state:{...state,pendingMessageId:command.messageId,notePath:command.notePath??state.notePath}};
        }else if(command.kind==='claim'){
          if(terminalLease(record))return respond(false,'The response is finished.');
          if(record.expiresAt>this.now())return respond(false,'Another writer still owns this response.');
          // Give clients with the note open a short head start over closed-note
          // fallback writers. Healthy ownership is never preempted.
          if(command.fallback&&record.expiresAt+2000>this.now())return respond(false,'Waiting for an open-note writer.');
          const notePath=command.notePath??record.state?.notePath??record.request.notePath;
          if(!safeNotePath(notePath))throw Error('Invalid response note path.');
          const writer=await this.noteWriter(notePath,record.request.id);
          if(writer&&writer!==command.actor)return respond(false,'Another device owns a response in this note.');
          const moved=notePath!==(record.state?.notePath??record.request.notePath);
          record={...record,owner:command.actor,epoch:record.epoch+1,expiresAt:this.now()+LEASE_MS,
            ...(moved?{revision:record.revision+1,state:{...record.state??{requestHash:hostedRequestHash(record.request),accepted:false,status:'waiting' as const,hashes:[record.request.initialHash],updatedAt:new Date(this.now()).toISOString()},notePath}}:{})};
        }else{
          if(record.owner!==command.actor||record.epoch!==command.epoch||record.expiresAt<=this.now())return respond(false,'Writer ownership expired.');
          if(command.kind==='heartbeat')record={...record,expiresAt:this.now()+LEASE_MS};
          else if(command.kind==='checkpoint'){
            if(command.revision!==record.revision)return respond(false,'Response checkpoint changed.');
            const state=command.state;
            if(state?.userStopped!==undefined&&typeof state.userStopped!=='boolean')throw Error('Invalid response stop checkpoint.');
            if(record.state?.userStopped&&!state?.userStopped)throw Error('The response was stopped.');
            if(record.stopRequestedAt&&!state?.userStopped)throw Error('The response was stopped.');
            if(!state||state.requestHash!==hostedRequestHash(record.request)||!safeNotePath(state.notePath)||!Array.isArray(state.hashes)||state.hashes.some(hash=>!/^([0-9a-f]{64})$/.test(hash))||!['waiting','running','complete','interrupted','error','conflict','paused'].includes(state.status)||state.messageId!==undefined&&!uuid.test(state.messageId)||state.pendingMessageId!==undefined&&!uuid.test(state.pendingMessageId))throw Error('Invalid response checkpoint.');
            if(record.state?.pendingMessageId&&state.pendingMessageId!==record.state.pendingMessageId&&state.messageId!==record.state.pendingMessageId)throw Error('The pending continuation changed.');
            if(state.steering!==undefined&&(!Array.isArray(state.steering)||state.steering.length!==(record.state?.steering?.length??0)||state.steering.some(input=>!validSteeringInput(input)||!Array.isArray(input.before))))throw Error('Invalid steering checkpoint.');
            if(state.status==='complete'&&state.steering?.some(input=>!input.confirmed))throw Error('Waiting for steering delivery before finalizing.');
            if(state.finalSaved!==undefined&&typeof state.finalSaved!=='boolean'||state.cleanupComplete!==undefined&&typeof state.cleanupComplete!=='boolean'||state.finalSaved&&(state.finalBody===undefined||!['complete','interrupted'].includes(state.finalPhase??''))||state.cleanupComplete&&!state.finalSaved||record.state?.finalSaved&&!state.finalSaved)throw Error('Invalid completion cleanup checkpoint.');
            if(record.state?.steering?.some(input=>{
              const next=state.steering?.find(item=>item.messageId===input.messageId);
              return !next||next.text!==input.text||JSON.stringify(next.before)!==JSON.stringify(input.before)||JSON.stringify(next.selection)!==JSON.stringify(input.selection)||input.confirmed&&!next.confirmed||input.selectionApplied&&!next.selectionApplied;
            }))throw Error('The saved steering message changed.');
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
  private async noteWriter(notePath:string,except:string):Promise<string|undefined>{
    for(const path of await this.files.list(`${this.identity.directory}/leases`)){
      const raw=await this.files.read(path);if(!raw)continue;
      const record:LeaseRecord=JSON.parse(raw);
      if(record.request.id!==except&&!terminalLease(record)&&record.expiresAt>this.now()&&(record.state?.notePath??record.request.notePath)===notePath)return record.owner;
    }
  }
  private async publishCatalog(record:LeaseRecord){
    const path=leasePaths(this.identity.directory,record.request.id).catalog;
    const raw=await this.files.read(path),catalog:HostedInlineRequest[]=raw?JSON.parse(raw):[];
    const discoverable=!terminalLease(record);
    if(discoverable&&catalog.some(item=>item.id===record.request.id))return;
    const next=catalog.filter(item=>item.id!==record.request.id);
    if(discoverable)next.push(record.request);
    if(JSON.stringify(next)!==JSON.stringify(catalog))await this.files.write(path,JSON.stringify(next));
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
  async command(input:Omit<LeaseCommand,'id'|'actor'>){
    if(this.stopped)throw Error('Response writer stopped.');
    const command:LeaseCommand={...input,id:crypto.randomUUID(),actor:this.actor},paths=leasePaths(this.directory,command.id),wall=this.now(),monotonic=this.monotonic();
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
    throw Error('The ownership coordinator did not answer. The saved request can be retried.');
    }catch(error){logFailure('ownership.command.failed',error,{...fields,...timing()});throw error;}
  }
}
