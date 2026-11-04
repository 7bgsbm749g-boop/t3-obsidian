import {randomUUID} from 'node:crypto';
import type {App} from 'obsidian';
import {validateClientCommand,type ClientCommand,type ClientCommandResult} from './client-command';

/** Private mailbox reloads invoke the native command immediately. */
export class DesktopClientMaintenance {
  readonly client:{instanceId:string;loadedVersion:string};
  private initiated=false;
  constructor(private app:App,_root:string,_configDir:string,loadedVersion:string,_codeViewTypes:()=>readonly string[]=()=>[],_beforeReload?:()=>Promise<void>){this.client={instanceId:randomUUID(),loadedVersion};}
  async reloadCurrent(beforeDispatch:()=>boolean){return this.dispatchReload(beforeDispatch);}
  async execute(input:ClientCommand):Promise<ClientCommandResult>{
    const command=validateClientCommand(input);
    return {id:command.id,ok:true,client:this.client,...(command.kind==='reload-client'?{reloadScheduled:true}:{})};
  }
  private dispatchReload(beforeDispatch?:()=>boolean){
    if(this.initiated||beforeDispatch&&!beforeDispatch())return false;
    this.initiated=true;
    try{
      if(!(this.app as any).commands.executeCommandById('app:reload'))throw Error('Obsidian refused the native reload command.');
    }catch(error){this.initiated=false;throw error;}
    return true;
  }
  /** Mailbox identity prevents replay; editor and response state never block reload. */
  async acknowledged(command:ClientCommand,result:ClientCommandResult,beforeDispatch?:()=>boolean){
    if(command.kind!=='reload-client'||!result.ok||!result.reloadScheduled||result.client?.instanceId!==this.client.instanceId)return false;
    return this.dispatchReload(beforeDispatch);
  }
}
