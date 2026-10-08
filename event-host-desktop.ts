import {promises as fs} from 'node:fs';
import {join} from 'node:path';
import lockfile from 'proper-lockfile';
import {desktopInterval} from './desktop-timers';
import {localInlineFiles} from './hosted-inline-desktop';
import {ensurePrivateStorage} from './private-storage-desktop';
import {eventCanonical,eventRequest,type EventHostIdentity} from './event-host';
import {validateEventCommand,type EventSubscriptionCommand,type EventCommandResult,type EventState} from './event-subscriptions';
/** One designated desktop owns the private state and consumes authenticated file requests. */
export class EventHostServer {
  readonly files:ReturnType<typeof localInlineFiles>;
  private active=false;
  activate(){this.active=true;}
  private stopped=false;private work?:Promise<void>;private stopTimer:()=>void;
  private constructor(readonly identity:EventHostIdentity,private release:()=>Promise<void>,private execute:(command:EventSubscriptionCommand)=>Promise<EventCommandResult>,private ready:()=>boolean,private onStopped:()=>void){
    this.files=localInlineFiles(identity.workspaceRoot,identity.directory);
    this.stopTimer=desktopInterval(()=>void this.tick().catch(()=>{}),250);
  }
  static async open(identity:EventHostIdentity,execute:(command:EventSubscriptionCommand)=>Promise<EventCommandResult>,ready:()=>boolean,onStopped:()=>void){
    const route=await ensurePrivateStorage(identity.workspaceRoot,identity.directory.slice(0,identity.directory.indexOf('/t3-code/')));
    const base=join(route.storageRoot,identity.directory);
    for(const name of ['requests','results'])await fs.mkdir(join(base,name),{recursive:true,mode:0o700});
    let server:EventHostServer|undefined;
    const release=await lockfile.lock(base,{realpath:true,stale:30_000,update:5000,onCompromised:()=>void server?.dispose()});
    server=new EventHostServer(identity,release,execute,ready,onStopped);return server;
  }
  async load():Promise<EventState|undefined>{
    const raw=await this.files.read(this.identity.directory+'/state.json');if(!raw)return undefined;
    const saved=JSON.parse(raw);
    if(saved.version!==1||eventCanonical(saved.host)!==eventCanonical(this.identity))throw Error('Saved subscriptions belong to a different vault project machine.');
    return saved.state;
  }
  async save(state:EventState){if(this.stopped||!this.ready())throw Error('Subscription host ownership changed.');await this.files.write(this.identity.directory+'/state.json',JSON.stringify({version:1,host:this.identity,state}));}
  tick(){if(this.work)return this.work;if(this.stopped||!this.active||!this.ready())return Promise.resolve();const work=this.scan();this.work=work;void work.finally(()=>{this.work=undefined;}).catch(()=>{});return work;}
  private async scan(){
    for(const path of (await this.files.requests()).sort()){
      if(this.stopped||!this.ready())return;
      const name=path.slice(path.lastIndexOf('/')+1);if(!/^[0-9a-f-]{36}-[0-9a-f]{64}\.json$/i.test(name))continue;
      const resultPath=`${this.identity.directory}/results/${name}`;if(await this.files.read(resultPath))continue;
      let result:EventCommandResult;
      try{
        const raw=(await this.files.read(path))!;if(raw.length>64_000)throw Error('Subscription request is too large.');
        const value=JSON.parse(raw),command=validateEventCommand(value.command);
        if(value.version!==1||eventCanonical(value.host)!==eventCanonical(this.identity)||eventRequest(this.identity,command).name!==name)throw Error('Subscription request belongs to a different host or has changed bytes.');
        result=await this.execute(command);
      }catch(error){result={id:name.slice(0,36),ok:false,error:error instanceof Error?error.message:String(error)};}
      await this.files.write(resultPath,JSON.stringify({version:1,host:this.identity,request:name,result:{...result,host:this.identity}}));
    }
  }
  dispose(){if(this.stopped)return Promise.resolve();this.stopped=true;this.stopTimer();this.onStopped();return Promise.resolve(this.work).finally(()=>this.release()).catch(()=>{});}
}
