import {promises as fs} from 'node:fs';
import {join} from 'node:path';
import lockfile from 'proper-lockfile';
import {desktopInterval} from './desktop-timers';
import {validateAgentCommand,type AgentCommand,type AgentCommandResult} from './note-command';
/** Local, private, unsynced mailbox. One plugin instance consumes it. */
export class NoteCommandServer {
  private stopped=false;private work?:Promise<void>;private stopTimer:()=>void;
  private constructor(private base:string,private release:()=>Promise<void>,private execute:(command:AgentCommand)=>Promise<AgentCommandResult>,private ready:()=>boolean,private onStopped?:()=>void){
    this.stopTimer=desktopInterval(()=>void this.tick().catch(()=>{}),250);
  }
  static async open(root:string,configDir:string,execute:(command:AgentCommand)=>Promise<AgentCommandResult>,ready:()=>boolean,onStopped?:()=>void){
    const base=join(root,configDir,'t3-code','commands','v1');
    for(const directory of ['requests','results'])await fs.mkdir(join(base,directory),{recursive:true,mode:0o700});
    let server:NoteCommandServer|undefined;
    const release=await lockfile.lock(base,{realpath:true,stale:30_000,update:5000,onCompromised:()=>server?.dispose()});
    server=new NoteCommandServer(base,release,execute,ready,onStopped);return server;
  }
  tick(){if(this.work)return this.work;if(this.stopped||!this.ready())return Promise.resolve();const work=this.scan();this.work=work;void work.finally(()=>{this.work=undefined;}).catch(()=>{});return work;}
  private async scan(){
    for(const name of (await fs.readdir(join(this.base,'requests'))).sort()){
      if(this.stopped||!this.ready())return;
      if(!/^[0-9a-f-]{36}\.json$/i.test(name))continue;
      const resultPath=join(this.base,'results',name);try{await fs.access(resultPath);continue;}catch{}
      let result:AgentCommandResult;
      try{
        const raw=await fs.readFile(join(this.base,'requests',name),'utf8');if(raw.length>64_000)throw Error('Command is too large.');
        const command=validateAgentCommand(JSON.parse(raw));if(name!==command.id+'.json')throw Error('Command ID does not match its filename.');
        result=await this.execute(command);
      }catch(error){result={id:name.slice(0,-5),ok:false,error:error instanceof Error?error.message:String(error)};}
      const temporary=resultPath+'.tmp';await fs.writeFile(temporary,JSON.stringify(result),{mode:0o600});await fs.rename(temporary,resultPath);
    }
  }
  dispose(){if(this.stopped)return Promise.resolve();this.stopped=true;this.stopTimer();this.onStopped?.();return Promise.resolve(this.work).finally(()=>this.release()).catch(()=>{});}
}
