import {hostedPaths,hostedRequestHash,safeNotePath,validateHostedRequest,type HostedInlineRequest,type HostedInlineState,type InlineFiles} from './hosted-inline';
import {sameWorkspacePath} from './folder-link';

export const LEASE_MS=15_000;
export const HEARTBEAT_MS=3000;
export const LEASE_MARGIN_MS=2000;
export type LeaseIdentity={vaultId:string;environmentId:string;workspaceRoot:string;directory:string};
export interface LeaseRecord {request:HostedInlineRequest;owner:string;epoch:number;expiresAt:number;revision:number;state?:HostedInlineState}
export interface LeaseCommand {id:string;jobId:string;actor:string;kind:'register'|'claim'|'heartbeat'|'checkpoint'|'follow';epoch?:number;revision?:number;request?:HostedInlineRequest;state?:HostedInlineState;fallback?:boolean;previousMessageId?:string;messageId?:string}
export interface LeaseReply {id:string;ok:boolean;error?:string;record?:LeaseRecord;ttlMs:number;answeredAt?:number}
export interface LeaseFiles extends InlineFiles {list(directory:string):Promise<string[]>;remove(path:string):Promise<void>}
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export const leasePaths=(directory:string,id:string)=>({record:`${directory}/leases/${id}.json`,command:`${directory}/mailbox/${id}.json`,reply:`${directory}/replies/${id}.json`,catalog:`${directory}/lease-catalog.json`});
export const terminalLease=(record:LeaseRecord)=>!!record.state&&['complete','interrupted','conflict'].includes(record.state.status);

/** The existing desktop host lock admits exactly one authority. Clients only
 * submit commands; only this serialized coordinator mutates lease records. */
export class InlineLeaseAuthority {
  private work?:Promise<void>;
  private stopped=false;
  private recovered=false;
  private lastCleanup=0;
  constructor(private identity:LeaseIdentity,private files:LeaseFiles,private now=()=>Date.now()){}
  stop(){this.stopped=true;}
  tick(){if(this.work)return this.work;if(this.stopped)return Promise.resolve();const work=this.scan();this.work=work;void work.finally(()=>{if(this.work===work)this.work=undefined;}).catch(()=>{});return work;}
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
    for(const path of await this.files.list(`${directory}/mailbox`)){
      if(this.stopped)return;
      let command:LeaseCommand;
      try{command=JSON.parse((await this.files.read(path))??'');}catch{continue;}
      if(![command.id,command.jobId,command.actor].every(value=>uuid.test(value))||path!==leasePaths(directory,command.id).command)continue;
      const replyPath=leasePaths(directory,command.id).reply;
      if(!await this.files.read(replyPath)){
        const reply=await this.apply(command);
        if(this.stopped)return;
        await this.files.write(replyPath,JSON.stringify(reply));
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
        record={request,owner:command.actor,epoch:1,expiresAt:this.now()+LEASE_MS,revision:0};
        await this.files.write(hostedPaths(directory,request.id).request,JSON.stringify(request));
      }else{
        if(!record)throw Error('The response is not registered.');
        if(command.kind==='follow'&&record.state?.messageId===command.messageId&&command.previousMessageId!==command.messageId)return respond(true);
        if(command.kind==='follow'){
          const state=record.state,previous=state?.messageId??record.request.messageId;
          if(state?.status!=='error'||!uuid.test(command.messageId??'')||command.messageId===previous||command.previousMessageId!==previous)throw Error('This response is no longer waiting for that continuation.');
          if(state.pendingMessageId&&state.pendingMessageId!==command.messageId)throw Error('A continuation is already waiting for its T3 turn.');
          if(!state.pendingMessageId)record={...record,revision:record.revision+1,state:{...state,pendingMessageId:command.messageId}};
        }else if(command.kind==='claim'){
          if(terminalLease(record))return respond(false,'The response is finished.');
          if(record.expiresAt>this.now())return respond(false,'Another writer still owns this response.');
          // Give clients with the note open a short head start over closed-note
          // fallback writers. Healthy ownership is never preempted.
          if(command.fallback&&record.expiresAt+2000>this.now())return respond(false,'Waiting for an open-note writer.');
          record={...record,owner:command.actor,epoch:record.epoch+1,expiresAt:this.now()+LEASE_MS};
        }else{
          if(record.owner!==command.actor||record.epoch!==command.epoch||record.expiresAt<=this.now())return respond(false,'Writer ownership expired.');
          if(command.kind==='heartbeat')record={...record,expiresAt:this.now()+LEASE_MS};
          else if(command.kind==='checkpoint'){
            if(command.revision!==record.revision)return respond(false,'Response checkpoint changed.');
            const state=command.state;
            if(!state||state.requestHash!==hostedRequestHash(record.request)||!safeNotePath(state.notePath)||!Array.isArray(state.hashes)||state.hashes.some(hash=>!/^([0-9a-f]{64})$/.test(hash))||!['waiting','running','complete','interrupted','error','conflict'].includes(state.status)||state.messageId!==undefined&&!uuid.test(state.messageId)||state.pendingMessageId!==undefined&&!uuid.test(state.pendingMessageId))throw Error('Invalid response checkpoint.');
            if(record.state?.pendingMessageId&&state.pendingMessageId!==record.state.pendingMessageId&&state.messageId!==record.state.pendingMessageId)throw Error('The pending continuation changed.');
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
  private async publishCatalog(record:LeaseRecord){
    const path=leasePaths(this.identity.directory,record.request.id).catalog;
    const raw=await this.files.read(path),catalog:HostedInlineRequest[]=raw?JSON.parse(raw):[];
    if(!terminalLease(record)&&catalog.some(item=>item.id===record.request.id))return;
    const next=catalog.filter(item=>item.id!==record.request.id);
    if(!terminalLease(record))next.push(record.request);
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
    await this.files.write(paths.command,JSON.stringify(command));
    for(let attempt=0;attempt<50&&!this.stopped;attempt++){
      const raw=await this.files.read(paths.reply);
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
        return reply;
      }
      await this.pause(100);
    }
    throw Error('The ownership coordinator did not answer. The saved request can be retried.');
  }
}
