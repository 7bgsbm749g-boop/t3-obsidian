import {isRecord,toError} from '../shared/values';
import {contentHash} from '../responses/completion';

export const COMMAND_DIRECTORY='.t3-obsidian/clients';
export const COMMAND_MAX_BYTES=2_000_000;
const REQUEST_LIFETIME=5*60*1000;
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
export interface CommandFiles {
  read(path:string):Promise<string|undefined>;
  write(path:string,text:string):Promise<void>;
  list(path:string):Promise<string[]>;
}
export interface CommandRoute {environmentId:string;workspaceRoot:string;base:string}
export interface CommandIdentity {vaultId:string;vaultName:string;vaultPath?:string;clientId:string;instanceId:string;loadedVersion:string}
export interface CommandEnvelope {version:1;id:string;vaultId:string;clientId:string;instanceId:string;token:string;expiresAt:number;command:Record<string,unknown>;retry?:boolean}
interface Receipt {hash:string;startedAt:number;phase:'executing'|'complete';result?:Record<string,unknown>}
interface HostIO {
  files:CommandFiles;route:CommandRoute;identity:CommandIdentity;
  load(id:string):Promise<Receipt|undefined>;save(id:string,receipt:Receipt):Promise<void>;
  validate(command:unknown):void;
  execute(command:unknown,route:CommandRoute):Promise<Record<string,unknown>>;
  acknowledged?(command:unknown,result:Record<string,unknown>):Promise<void>;
  serialize?<T>(action:()=>Promise<T>):Promise<T>;
  now?():number;
}
function sameToken(a:string,b:string){let difference=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)difference|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return difference===0;}
export function commandBase(vaultId:string,clientId:string){if(!uuid(vaultId)||!uuid(clientId))throw Error('Invalid Obsidian client identity.');return `${COMMAND_DIRECTORY}/${vaultId}/${clientId}`;}

/** The plugin only performs authenticated T3 file RPCs. Notes and credentials
 * never enter a synced command directory. One client serializes its commands;
 * a durable pre-dispatch receipt prevents an ambiguous retry from dispatching
 * again after a renderer crash. */
export class ConnectCommandHost {
  private token=Array.from(crypto.getRandomValues(new Uint8Array(32)),byte=>byte.toString(16).padStart(2,'0')).join('');
  private stopped=false;
  private work?:Promise<void>;
  private readyAt=-Infinity;
  private cursor=0;
  private received=0;private executed=0;private replayed=0;
  constructor(private io:HostIO){
    if(io.route.base!==commandBase(io.identity.vaultId,io.identity.clientId))throw Error('The command route belongs to another client.');
  }
  status(){return {transport:'t3-connect',received:this.received,executed:this.executed,replayed:this.replayed,activeRequests:this.work?1:0,pendingReloads:0};}
  get active(){return !this.stopped;}
  get route(){return this.io.route;}
  private now(){return this.io.now?.()??Date.now();}
  private ready(){return {version:1,...this.io.identity,token:this.token,environmentId:this.io.route.environmentId,workspaceRoot:this.io.route.workspaceRoot,base:this.io.route.base,expiresAt:this.now()+30_000,capabilities:['checked-note-edits','client-status','reload-client']};}
  tick():Promise<void>{
    if(this.stopped)return Promise.resolve();if(this.work)return this.work;
    const work=this.poll();this.work=work;void work.finally(()=>{if(this.work===work)this.work=undefined;}).catch(()=>{});return work;
  }
  private async poll(){
    const {files,route}=this.io;
    if(this.readyAt===-Infinity)await files.write(route.base+'/requests/.keep','');
    if(this.now()-this.readyAt>=10_000){await files.write(route.base+'/ready.json',JSON.stringify(this.ready()));this.readyAt=this.now();}
    if(this.stopped)return;
    const paths=await files.list(route.base+'/requests');
    if(paths.length>512)throw Error('Too many pending Obsidian requests. Remove expired requests before continuing.');
    const requests=paths.filter(path=>/\/[0-9a-f-]{36}\.json$/i.test(path)).sort();
    const batch=[...requests.slice(this.cursor),...requests.slice(0,this.cursor)].slice(0,32);this.cursor=requests.length?(this.cursor+batch.length)%requests.length:0;
    for(const path of batch){
      if(this.stopped)return;
      const name=path.slice(path.lastIndexOf('/')+1),id=name.slice(0,-5);
      if(!uuid(id)||name!==id+'.json'||path!==route.base+'/requests/'+name)continue;
      const ready=await files.read(path+'.ready');if(!ready||!/[a-f0-9]{64}/.test(ready)||ready.startsWith('consumed:'))continue;
      const raw=await files.read(path);if(raw===undefined)continue;
      if(new TextEncoder().encode(raw).length>COMMAND_MAX_BYTES)continue;
      let input:unknown;try{input=JSON.parse(raw) as unknown;}catch{continue;}
      // A partially uploaded request is never executable. The immutable ready
      // marker binds its complete bytes; it is uploaded after the JSON file.
      if(ready!==contentHash(raw))continue;
      if(!isRecord(input)||input.version!==1||input.retry!==undefined&&typeof input.retry!=='boolean'||input.id!==id||input.vaultId!==this.io.identity.vaultId||input.clientId!==this.io.identity.clientId||typeof input.token!=='string'||!sameToken(input.token,this.token)||!isRecord(input.command)||input.command.id!==id||typeof input.expiresAt!=='number'||input.expiresAt<=this.now()||input.expiresAt>this.now()+REQUEST_LIFETIME)continue;
      const envelope=input as unknown as CommandEnvelope;
      const result=await (this.io.serialize?this.io.serialize(()=>this.dispatch(envelope)):this.dispatch(envelope));
      if(this.stopped)return;
      await files.write(route.base+'/results/'+id+'.json',JSON.stringify({version:1,requestHash:contentHash(raw),...result}));
      // The result and durable receipt precede a native reload. Replaying this
      // request returns the original instance's result and cannot reload again.
      await files.write(path+'.ready','consumed:'+contentHash(raw));
      await this.io.acknowledged?.(envelope.command,result);
    }
  }
  private async dispatch(input:CommandEnvelope):Promise<Record<string,unknown>>{
    this.received++;
    const hash=contentHash(JSON.stringify(input.command));
    const prior=await this.io.load(input.id);
    if(prior){
      if(prior.hash!==hash)return {id:input.id,ok:false,error:'This request ID already belongs to different input.'};
      if(prior.phase==='executing')return prior.result??{id:input.id,ok:false,pending:true,error:'A previous execution was interrupted. Inspect its outcome before submitting another command.'};
      if(prior.result?.ok||!input.retry||prior.result?.retryable!==true){this.replayed++;return prior.result??{id:input.id,ok:false,error:'The command receipt is incomplete.'};}
    }
    if(input.instanceId!==this.io.identity.instanceId)return {id:input.id,ok:false,error:'The Obsidian client changed. Refresh its ready record before creating a new request.'};
    try{this.io.validate(input.command);}catch(error){const result={id:input.id,ok:false,error:toError(error).message};await this.io.save(input.id,{hash,startedAt:this.now(),phase:'complete',result});return result;}
    await this.io.save(input.id,{hash,startedAt:this.now(),phase:'executing'});
    let result:Record<string,unknown>;
    try{
      if(this.stopped)throw Error('The Obsidian client is stopping.');
      this.executed++;result=await this.io.execute(input.command,this.io.route);
      if(typeof result.ok!=='boolean')throw Error('The command returned an invalid outcome.');
      if(result.id!==input.id)throw Error('The command returned a different request ID.');
    }catch(error){result={id:input.id,ok:false,pending:true,error:toError(error).message};await this.io.save(input.id,{hash,startedAt:prior?.startedAt??this.now(),phase:'executing',result});return result;}
    await this.io.save(input.id,{hash,startedAt:prior?.startedAt??this.now(),phase:'complete',result});return result;
  }
  async dispose(){
    if(this.stopped)return;this.stopped=true;await this.work?.catch(()=>{});
    // Registrations expire after thirty seconds. Never overwrite a newer
    // instance's ready record during unload; agent-side tools own file cleanup.
  }
}
