import {promises as fs} from 'node:fs';
import {join} from 'node:path';
import {createServer,type Server,type IncomingMessage,type ServerResponse} from 'node:http';
import {randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import lockfile from 'proper-lockfile';
import {desktopInterval} from './desktop-timers';
import {validateAgentCommand,type AgentCommand,type AgentCommandResult} from './note-command';
import {ensurePrivateStorage} from './private-storage-desktop';

/** Direct loopback requests; saved inputs/results are receipts, never a queue. */
export class NoteCommandServer {
  private stopped=false;
  private server?:Server;
  private endpoint?:string;
  private token=randomBytes(32).toString('hex');
  private work=new Map<string,{command:AgentCommand;promise:Promise<AgentCommandResult>}>();
  private reloads=new Map<string,{command:AgentCommand;result:AgentCommandResult}>();
  private stopTimer?:()=>void;
  private received=0;private executed=0;private replayed=0;
  status(){return {transport:'direct',received:this.received,executed:this.executed,replayed:this.replayed,activeRequests:this.work.size,pendingReloads:this.reloads.size};}
  get active(){return !this.stopped;}
  private constructor(private base:string,private release:()=>Promise<void>,private execute:(command:AgentCommand)=>Promise<AgentCommandResult>,private ready:()=>boolean,private onStopped?:()=>void,private acknowledged?:(command:AgentCommand,result:AgentCommandResult)=>Promise<boolean>){}
  static async open(root:string,configDir:string,execute:(command:AgentCommand)=>Promise<AgentCommandResult>,ready:()=>boolean,onStopped?:()=>void,acknowledged?:(command:AgentCommand,result:AgentCommandResult)=>Promise<boolean>){
    const route=await ensurePrivateStorage(root,configDir),base=join(route.storageRoot,configDir,'t3-code','commands','v1');
    for(const directory of ['requests','results'])await fs.mkdir(join(base,directory),{recursive:true,mode:0o700});
    let instance:NoteCommandServer|undefined;
    const release=await lockfile.lock(base,{realpath:true,stale:30_000,update:5000,onCompromised:()=>void instance?.dispose()});
    instance=new NoteCommandServer(base,release,execute,ready,onStopped,acknowledged);
    try{await instance.listen();return instance;}catch(error){await instance.dispose();throw error;}
  }
  private async listen(){
    this.server=createServer((request,response)=>void this.handle(request,response));
    this.server.requestTimeout=15_000;this.server.headersTimeout=10_000;
    await new Promise<void>((resolve,reject)=>{this.server!.once('error',reject);this.server!.listen(0,'127.0.0.1',()=>{this.server!.off('error',reject);resolve();});});
    const address=this.server.address();if(!address||typeof address==='string')throw Error('Cannot open the direct Obsidian command endpoint.');
    this.endpoint=JSON.stringify({version:1,url:`http://127.0.0.1:${address.port}/commands`,token:this.token});
    await this.atomic(join(this.base,'endpoint.json'),this.endpoint);
  }
  private async atomic(path:string,text:string){const temporary=path+'.'+randomUUID()+'.tmp';try{await fs.writeFile(temporary,text,{mode:0o600,flag:'wx'});await fs.rename(temporary,path);}finally{await fs.rm(temporary,{force:true});}}
  private async read(path:string){try{return await fs.readFile(path,'utf8');}catch(error:any){if(error.code==='ENOENT')return;throw error;}}
  private async handle(request:IncomingMessage,response:ServerResponse){
    const send=(status:number,value:unknown)=>{response.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});response.end(JSON.stringify(value));};
    const supplied=Buffer.from(request.headers.authorization??''),expected=Buffer.from('Bearer '+this.token);
    if(request.method!=='POST'||request.url!=='/commands'||request.headers.origin||supplied.length!==expected.length||!timingSafeEqual(supplied,expected)){send(403,{ok:false,error:'Direct command access denied.'});request.resume();return;}
    if(this.stopped||!this.ready()){send(503,{ok:false,error:'The Obsidian plugin is not ready.'});request.resume();return;}
    let id:string|undefined;
    try{
      const chunks:Buffer[]=[];let size=0;for await(const chunk of request){size+=chunk.length;if(size>64_000){send(413,{ok:false,error:'Command is too large.'});return;}chunks.push(chunk);}
      const input=JSON.parse(Buffer.concat(chunks).toString('utf8')),command=validateAgentCommand(input.command);id=command.id;this.received++;
      const result=await this.dispatch(command,input.retry===true);
      send(200,result);
      // A reload can destroy this renderer. Acknowledge only after its durable
      // receipt and HTTP response are written, and retry only this live request.
      if(this.acknowledged&&result.ok&&'reloadScheduled' in result&&result.reloadScheduled){
        this.reloads.set(command.id,{command,result});
        this.stopTimer??=desktopInterval(()=>void this.tick().catch(()=>{}),250);
        setImmediate(()=>void this.tick().catch(()=>{}));
      }
    }catch(error){if(!response.headersSent)send(400,{id,ok:false,error:error instanceof Error?error.message:String(error)});}
  }
  private dispatch(command:AgentCommand,retry:boolean):Promise<AgentCommandResult>{
    const old=this.work.get(command.id);
    if(old){if(!isDeepStrictEqual(old.command,command))return Promise.reject(Error('This request ID already belongs to different input.'));return old.promise;}
    const promise=this.perform(command,retry);this.work.set(command.id,{command,promise});
    void promise.finally(()=>this.work.delete(command.id)).catch(()=>{});return promise;
  }
  private async perform(command:AgentCommand,retry:boolean){
    const requestPath=join(this.base,'requests',command.id+'.json'),resultPath=join(this.base,'results',command.id+'.json');
    const previous=await this.read(requestPath);
    if(previous!==undefined&&!isDeepStrictEqual(JSON.parse(previous),command))throw Error('This request ID already belongs to different input.');
    if(previous===undefined)await this.atomic(requestPath,JSON.stringify(command));
    const saved=await this.read(resultPath);
    if(saved!==undefined){const result:AgentCommandResult=JSON.parse(saved);if(result.ok||!retry){this.replayed++;return result;}}
    if(this.stopped||!this.ready())throw Error('The Obsidian plugin is not ready.');
    let result:AgentCommandResult;
    try{this.executed++;result=await this.execute(command);if(result.id!==command.id)throw Error('The command returned a different request ID.');}
    catch(error){result={id:command.id,ok:false,error:error instanceof Error?error.message:String(error)};}
    await this.atomic(resultPath,JSON.stringify(result));return result;
  }
  async tick(){
    for(const [id,pending] of this.reloads){
      if(this.stopped||!this.ready())return;
      if(await this.acknowledged?.(pending.command,pending.result))this.reloads.delete(id);
    }
    if(!this.reloads.size){this.stopTimer?.();this.stopTimer=undefined;}
  }
  private closing?:Promise<void>;
  dispose(){
    if(this.closing)return this.closing;
    this.stopped=true;this.stopTimer?.();this.onStopped?.();
    this.closing=(async()=>{
      const server=this.server;
      if(server)await new Promise<void>(resolve=>{server.close(()=>resolve());server.closeIdleConnections();});
      await Promise.allSettled([...this.work.values()].map(value=>value.promise));
      if(this.endpoint&&await this.read(join(this.base,'endpoint.json'))===this.endpoint)await fs.rm(join(this.base,'endpoint.json'),{force:true});
      await this.release();
    })();return this.closing;
  }
}
