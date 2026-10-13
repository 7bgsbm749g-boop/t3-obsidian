import {promises as fs} from 'node:fs';
import {join} from 'node:path';
import lockfile from 'proper-lockfile';
import type {App} from 'obsidian';
import manifest from './manifest.json';
import {InlineLeaseAuthority,InlineLeaseClient,leasePaths,type LeaseIdentity} from './inline-lease';
import {CoordinatedHost} from './coordinated-host-desktop';
import {localInlineFiles} from './inline-host-storage-desktop';
import {ensurePrivateStorage} from './private-storage-desktop';
import {responseHostFilesystem} from './response-host-filesystem';
import {HostedInlineWriter,hostedPaths,validateHostedRequest,type HostedWriterIO} from './hosted-inline';
import {InlineResponseFeeds} from './inline-response-feed';
import {ThreadAccessCache} from './thread-access-cache';
import {readInlineEvents,readInlineSnapshot,type ThreadAccess} from './thread-stream';
import {desktopDefaults,desktopEnvironment,desktopThreadAccess} from './desktop';
import {isResponseCommand,validateResponseCommand} from './response-command';
import {regionBody,finalizeRegion} from './inline-thread';
import {responseRegion} from './native-response-projection';
import {contentHash} from './completion';
import {environmentApi,endpoint} from './direct';
import {nativeRelayAccount} from './native-account';
import {discoverMachines,connectMachine} from './cloud';
import {backgroundNoteSend} from './background-note-send';
import {commandId} from './direct';
import {removeFailedResponse} from './failed-response-cleanup';
import {responseIds} from './response-container';

/** No Obsidian process, renderer, or editor is part of this host's lifetime. */
export class BackgroundResponseHost {
  private stopped=false;
  private timers:Array<ReturnType<typeof setInterval>>=[];
  private work?:Promise<void>;
  private commandWork=new Map<string,Promise<void>>();
  private accessCache:ThreadAccessCache;
  private feeds:InlineResponseFeeds;
  private writer!:HostedInlineWriter;
  private legacy!:HostedInlineWriter;
  private coordinated!:CoordinatedHost;
  private authority:InlineLeaseAuthority;
  private notes:ReturnType<typeof responseHostFilesystem>;
  private files:ReturnType<typeof localInlineFiles>;
  private remoteAccess=new Map<string,Promise<ThreadAccess>>();
  private nextFailedCopyAudit=0;
  private constructor(private identity:LeaseIdentity,private storageRoot:string,private release:()=>Promise<void>,access?:(environmentId:string)=>Promise<ThreadAccess>){
    this.files=localInlineFiles(identity.workspaceRoot,identity.directory,storageRoot);
    this.notes=responseHostFilesystem(identity.workspaceRoot,()=>!this.stopped);
    this.authority=new InlineLeaseAuthority(identity,this.files);
    this.accessCache=new ThreadAccessCache(access??(environment=>this.access(environment)));
    this.feeds=new InlineResponseFeeds(environment=>this.accessCache.get(environment));
  }
  static async open(identity:LeaseIdentity,options?:{access?:(environmentId:string)=>Promise<ThreadAccess>;journalRoot?:string;timers?:boolean}){
    const configDir=identity.directory.slice(0,identity.directory.indexOf('/t3-code/'));
    const route=await ensurePrivateStorage(identity.workspaceRoot,configDir),base=join(route.storageRoot,identity.directory);
    await fs.mkdir(base,{recursive:true});let host:BackgroundResponseHost|undefined;
    const release=await lockfile.lock(base,{realpath:true,stale:30_000,update:5000,onCompromised:()=>{void host?.dispose();}});
    host=new BackgroundResponseHost(identity,route.storageRoot,release,options?.access);
    try{
      host.coordinated=await CoordinatedHost.open(host.notes.app,identity,host.files,host.authority,{journalRoot:options?.journalRoot,runtime:host.notes.runtime});
      const io:HostedWriterIO={...host.files,requests:async()=>host!.coordinated.legacyRequests(await host!.files.requests()),locateNote:host.notes.runtime.notes.locateNote,access:environment=>host!.accessCache.get(environment),replayBindings:(request,access,signal,sequence)=>readInlineEvents(access,request.threadId,sequence,signal),threadState:(request,access,refresh,failure)=>host!.feeds.state(request,access,refresh,failure),readFailure:request=>host!.feeds.failure(request),adoptFinalResponse:(request,state,turn,key)=>host!.feeds.adopt(request,state,turn,key),updateNote:async(path,change)=>host!.notes.runtime.notes.updateNote(path,change,()=>!host!.stopped)};
      host.writer=new HostedInlineWriter(identity,host.coordinated.io(io));host.legacy=new HostedInlineWriter(identity,io);
      await host.files.write(`${identity.directory}/coordinated-capabilities.json`,JSON.stringify({version:1,nativeProjection:true,responseContainers:1,deviceCompletion:1,stopReceipts:1,backgroundHost:1}));
      await host.heartbeat();
      if(options?.timers!==false){
        host.timers.push(setInterval(()=>void host!.authority.tick().catch(()=>{}),100));
        host.timers.push(setInterval(()=>void host!.tick().catch(()=>{}),500));
        host.timers.push(setInterval(()=>void host!.heartbeat().catch(()=>{}),1000));
      }
      return host;
    }catch(error){await host.dispose();throw error;}
  }
  private async access(environment:string):Promise<ThreadAccess>{
    if(environment===this.identity.environmentId)return desktopThreadAccess(desktopDefaults(),'response-host');
    let work=this.remoteAccess.get(environment);if(work)return work;
    work=(async()=>{
      const path=join(this.storageRoot,this.identity.directory,'background-connections.json'),credentials=JSON.parse(await fs.readFile(path,'utf8'));
      const connection=credentials.paired?.find((item:any)=>item.environmentId===environment);if(!connection)throw Error('The response machine has no saved connection.');
      let session=credentials.sessions?.[connection.id];
      if((!session||session.expiresAt<Date.now()+60_000)&&connection.managed&&credentials.nativeAccount){
        const persist=async()=>{const temporary=path+'.tmp';await fs.writeFile(temporary,JSON.stringify(credentials),{mode:0o600});await fs.rename(temporary,path);};
        const account=await nativeRelayAccount(credentials.nativeAccount,persist),machine=(await discoverMachines(account)).find(item=>item.environmentId===environment);
        if(!machine)throw Error('The response machine is not available in the signed-in account.');
        session=await connectMachine(account,machine,connection.id);credentials.sessions??={};credentials.sessions[connection.id]=session;await persist();
      }
      if(!session||session.expiresAt<=Date.now())throw Error('The saved response connection needs to be renewed.');
      return {origin:endpoint(connection.url),expiresAt:session.expiresAt,api:await environmentApi({transport:'direct',host:'direct',executable:'',url:connection.url,connectionId:connection.id,environmentId:environment},session)};
    })();this.remoteAccess.set(environment,work);void work.finally(()=>this.remoteAccess.delete(environment)).catch(()=>{});return work;
  }
  private heartbeat(){return this.files.write(`${this.identity.directory}/background-host.json`,JSON.stringify({version:1,pluginVersion:manifest.version,pid:process.pid,identity:this.identity,updatedAt:new Date().toISOString(),active:!this.stopped}));}
  status(){return {active:!this.stopped,version:manifest.version,identity:this.identity,authority:this.authority.status(),journal:this.coordinated.journalStatus()};}
  dispatch(command:Parameters<InlineLeaseAuthority['dispatch']>[0]){return this.authority.dispatch(command);}
  async responseCommand(...args:Parameters<CoordinatedHost['command']>){return this.coordinated.command(...args);}
  private async responseCommands(){
    const base=join(this.storageRoot,this.identity.directory.replace(/inline\/v1$/,'commands/v1'));await fs.mkdir(join(base,'requests'),{recursive:true});await fs.mkdir(join(base,'results'),{recursive:true});
    for(const name of await fs.readdir(join(base,'requests'))){
      if(!/^[0-9a-f-]{36}\.json$/i.test(name)||this.commandWork.has(name))continue;
      const resultPath=join(base,'results',name);try{await fs.access(resultPath);continue;}catch{}
      const raw=await fs.readFile(join(base,'requests',name),'utf8');if(raw.length>64_000)continue;let input:any;try{input=JSON.parse(raw);}catch{continue;}
      let sendNote=false;
      if(input?.kind==='send-note'){
        const client=await this.files.read(`${this.identity.directory}/desktop-client.json`);if(client&&Date.now()-Date.parse(JSON.parse(client).updatedAt)<5000)continue;
        sendNote=true;
      }
      if(!sendNote&&!isResponseCommand(input))continue;
      const work=(async()=>{
        let result:any;
        try{
          if(sendNote)result=await backgroundNoteSend(input,this.identity,this.files,{...this.notes.runtime.notes,register:async request=>{const client=new InlineLeaseClient(request.initialOwner!,{...this.files,dispatch:command=>this.authority.dispatch(command)},this.identity.directory);try{const reply=await client.command({kind:'register',jobId:request.id,request},{id:commandId(request.id,'register'),actor:request.initialOwner!});if(!reply.ok)throw Error(reply.error??'The background host rejected response registration.');}finally{client.dispose();}}});
          else{const command=validateResponseCommand(input);if(command.id+'.json'!==name)throw Error('Response command identity changed.');result={id:command.id,ok:true,...await this.coordinated.command(command.kind,command.kind==='response-import-records'?command.id:command.kind==='close-stream-block'?command.foldKey:command.bindingId,'hash' in command?command.hash:undefined,'notePath' in command?command.notePath:undefined,command.kind==='response-import-records'?command:undefined)};}
        }catch(error){result={id:name.slice(0,-5),ok:false,error:error instanceof Error?error.message:String(error)};}
        const temporary=resultPath+'.background.tmp';await fs.writeFile(temporary,JSON.stringify(result),{mode:0o600});await fs.rename(temporary,resultPath);
      })();this.commandWork.set(name,work);void work.finally(()=>this.commandWork.delete(name)).catch(()=>{});
    }
  }
  /** Explicit failures retry checked removal even if the sending app closed. */
  private async failedSends(){
    const tombstones=new Set<string>();
    for(const path of await this.files.list(`${this.identity.directory}/send-guards`)){
      const raw=await this.files.read(path);if(!raw)continue;const guard=JSON.parse(raw),request=validateHostedRequest(guard.request);
      if(guard.status==='accepted'||request.vaultId!==this.identity.vaultId||request.host.workspaceRoot!==this.identity.workspaceRoot||path!==`${this.identity.directory}/send-guards/${request.id}.json`)continue;
      if(guard.status==='cleaned'){
        tombstones.add(request.id);
        const saved=await this.notes.readNote(request.notePath);if(saved===undefined||!responseIds(saved).includes(request.id))continue;
        await this.notes.runtime.notes.updateNote(request.notePath,document=>removeFailedResponse(document,request.id),()=>!this.stopped);continue;
      }
      const stop=await this.files.read(hostedPaths(this.identity.directory,request.id).stop);
      if(guard.status!=='failed'&&!stop&&Date.now()-Date.parse(guard.createdAt)<120_000)continue;
      if(guard.uncertain||guard.status==='prepared'&&!stop){
        let absent=false;
        try{const access=await this.accessCache.get(request.threadEnvironmentId),state=await readInlineSnapshot(access,request.threadId,request.projectId,undefined,true,true);if(state.thread.messages.some((item:any)=>item.id===request.messageId&&item.role==='user')){guard.status='accepted';await this.files.write(path,JSON.stringify(guard));continue;}absent=true;}catch(error:any){if(error.status===404||error.kind==='not-found')absent=true;}
        if(!absent)continue;
      }
      const locations=this.notes.getMarkdownFiles();
      for(const file of locations){
        const current=await this.notes.readNote(file.path);if(current===undefined||!responseIds(current).includes(request.id))continue;
        await this.notes.runtime.notes.updateNote(file.path,document=>removeFailedResponse(document,request.id),()=>!this.stopped);
      }
      guard.status='cleaned';guard.cleanedAt=new Date().toISOString();await this.files.write(path,JSON.stringify(guard));
      tombstones.add(request.id);
    }
    if(tombstones.size&&Date.now()>=this.nextFailedCopyAudit){this.nextFailedCopyAudit=Date.now()+30_000;for(const file of this.notes.getMarkdownFiles()){const saved=await this.notes.readNote(file.path);if(saved===undefined)continue;const ids=responseIds(saved).filter(id=>tombstones.has(id));if(ids.length)await this.notes.runtime.notes.updateNote(file.path,document=>ids.reduce(removeFailedResponse,document),()=>!this.stopped);}}
  }
  tick(){
    if(this.stopped)return Promise.resolve();if(this.work)return this.work;
    const work=(async()=>{await this.authority.tick();await this.coordinated.scan(true);await Promise.all([this.writer.tick(),this.legacy.tick(),this.responseCommands(),this.failedSends()]);await Promise.all([this.coordinated.maintain?.(),this.authority.cleanupReplies()]);this.feeds.prune();})();this.work=work;void work.finally(()=>{if(this.work===work)this.work=undefined;}).catch(()=>{});return work;
  }
  async dispose(){
    if(this.stopped)return;this.stopped=true;for(const timer of this.timers)clearInterval(timer);this.feeds.stop();this.writer?.stop();this.legacy?.stop();this.authority.stop();
    try{await Promise.allSettled([this.work,...this.commandWork.values(),this.coordinated?.stop()]);await this.accessCache.dispose();await this.files.close?.();}finally{await this.release();}
  }
}

export async function runBackgroundResponseHost(root:string,configDir='.obsidian'){
  const settings=JSON.parse(await fs.readFile(join(root,configDir,'plugins','send-to-t3-code','data.json'),'utf8'));
  const identity={vaultId:settings.vaultId,environmentId:await desktopEnvironment(desktopDefaults()),workspaceRoot:root,directory:`${configDir}/t3-code/inline/v1`};
  let host:BackgroundResponseHost|undefined;
  while(!host)try{host=await BackgroundResponseHost.open(identity);}catch(error:any){if(error.code!=='ELOCKED')throw error;await new Promise(resolve=>setTimeout(resolve,1000));}
  console.log(JSON.stringify({event:'response-host-started',version:manifest.version,pid:process.pid,identity}));
  const stop=()=>{void host!.dispose().then(()=>process.exit(0));};process.once('SIGTERM',stop);process.once('SIGINT',stop);
}
