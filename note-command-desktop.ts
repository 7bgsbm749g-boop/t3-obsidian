import {promises as fs} from 'node:fs';
import {join} from 'node:path';
import lockfile from 'proper-lockfile';
import {desktopInterval} from './desktop-timers';
import {validateAgentCommand,type AgentCommand,type AgentCommandResult} from './note-command';
/** Local, private, unsynced mailbox. One plugin instance consumes it. */
export class NoteCommandServer {
  private stopped=false;private work?:Promise<void>;private stopTimer:()=>void;
  private inspected=new Set<string>();
  private reloads=new Map<string,{command:AgentCommand;result:AgentCommandResult}>();
  get active(){return !this.stopped;}
  private constructor(private base:string,private release:()=>Promise<void>,private execute:(command:AgentCommand)=>Promise<AgentCommandResult>,private ready:()=>boolean,private onStopped?:()=>void,private acknowledged?:(command:AgentCommand,result:AgentCommandResult)=>Promise<boolean>){
    this.stopTimer=desktopInterval(()=>void this.tick().catch(()=>{}),250);
  }
  static async open(root:string,configDir:string,execute:(command:AgentCommand)=>Promise<AgentCommandResult>,ready:()=>boolean,onStopped?:()=>void,acknowledged?:(command:AgentCommand,result:AgentCommandResult)=>Promise<boolean>){
    const base=join(root,configDir,'t3-code','commands','v1');
    for(const directory of ['requests','results'])await fs.mkdir(join(base,directory),{recursive:true,mode:0o700});
    let server:NoteCommandServer|undefined;
    const release=await lockfile.lock(base,{realpath:true,stale:30_000,update:5000,onCompromised:()=>server?.dispose()});
    server=new NoteCommandServer(base,release,execute,ready,onStopped,acknowledged);return server;
  }
  tick(){if(this.work)return this.work;if(this.stopped||!this.ready())return Promise.resolve();const work=this.scan();this.work=work;void work.finally(()=>{this.work=undefined;}).catch(()=>{});return work;}
  private async scan(){
    for(const name of (await fs.readdir(join(this.base,'requests'))).sort()){
      if(this.stopped||!this.ready())return;
      if(!/^[0-9a-f-]{36}\.json$/i.test(name))continue;
      const resultPath=join(this.base,'results',name);
      let command:AgentCommand|undefined;
      try{
        await fs.access(resultPath);
        // Native reload has a durable acknowledgement before it changes the
        // renderer. Recover that narrow gap without reexecuting a note send.
        if(this.acknowledged&&!this.inspected.has(name)){
          const result=JSON.parse(await fs.readFile(resultPath,'utf8'));
          if(result.ok&&result.reloadScheduled){
            const value=validateAgentCommand(JSON.parse(await fs.readFile(join(this.base,'requests',name),'utf8')));
            if(value.kind==='reload-client'&&value.id+'.json'===name)this.reloads.set(name,{command:value,result});
          }
          this.inspected.add(name);
        }
        const pending=this.reloads.get(name);
        if(pending&&await this.acknowledged?.(pending.command,pending.result))return;
        continue;
      }catch(error:any){if(error.code!=='ENOENT')continue;this.inspected.delete(name);this.reloads.delete(name);}
      let result:AgentCommandResult;
      try{
        const raw=await fs.readFile(join(this.base,'requests',name),'utf8');if(raw.length>64_000)throw Error('Command is too large.');
        command=validateAgentCommand(JSON.parse(raw));if(name!==command.id+'.json')throw Error('Command ID does not match its filename.');
        result=await this.execute(command);
      }catch(error){result={id:name.slice(0,-5),ok:false,error:error instanceof Error?error.message:String(error)};}
      const temporary=resultPath+'.tmp';await fs.writeFile(temporary,JSON.stringify(result),{mode:0o600});await fs.rename(temporary,resultPath);
      if(command&&this.acknowledged&&await this.acknowledged(command,result))return;
    }
  }
  dispose(){if(this.stopped)return Promise.resolve();this.stopped=true;this.stopTimer();this.onStopped?.();return Promise.resolve(this.work).finally(()=>this.release()).catch(()=>{});}
}
