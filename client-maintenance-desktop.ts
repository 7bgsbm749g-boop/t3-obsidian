import {promises as fs} from 'node:fs';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import type {App} from 'obsidian';
import {nativeResponses} from './native-response-manager';
import {validateClientCommand,type ClientCommand,type ClientCommandResult} from './client-command';

/** Private command mailbox only; it never saves a view or changes settings. */
export class DesktopClientMaintenance {
  readonly client:{instanceId:string;loadedVersion:string};
  private initiated=false;
  constructor(private app:App,private root:string,private configDir:string,loadedVersion:string,private codeViewTypes:()=>readonly string[]=()=>[]){this.client={instanceId:randomUUID(),loadedVersion};}
  private async ready(command:ClientCommand){
    const directory=join(this.root,this.configDir,'plugins','send-to-t3-code');
    for(const name of ['main.js','manifest.json','styles.css'] as const){
      const bytes=await fs.readFile(join(directory,name));
      if(createHash('sha256').update(bytes).digest('hex')!==command.runtimeSha256![name])throw Error('Waiting for the exact release files to reach this client.');
      if(name==='manifest.json'&&JSON.parse(bytes.toString('utf8')).version!==command.releaseVersion)throw Error('The synced manifest does not match the requested release.');
    }
    const leaves=new Set(['markdown',...this.codeViewTypes()].flatMap(type=>this.app.workspace.getLeavesOfType(type)));
    for(const leaf of leaves){
      const view=leaf.view as any;if(!view.file||view.getMode?.()==='preview'||typeof view.getViewData!=='function')continue;
      const saved=nativeResponses(this.app).view(view)?.saved()??view.getViewData();
      if(saved!==await this.app.vault.read(view.file))throw Error('Waiting for unsaved edits to reach disk before reloading without saving.');
    }
    const commands=(this.app as any).commands;
    if(!commands?.commands?.['app:reload']||typeof commands.executeCommandById!=='function')throw Error('Obsidian Reload app without saving is unavailable.');
  }
  async execute(input:ClientCommand):Promise<ClientCommandResult>{
    const command=validateClientCommand(input);
    if(command.kind==='reload-client')await this.ready(command);
    return {id:command.id,ok:true,client:this.client,...(command.kind==='reload-client'?{reloadScheduled:true}:{})};
  }
  /** Called only after the acknowledgement is durable. Replayed requests are
   * harmless on a new instance, and a crash before dispatch can recover. */
  async acknowledged(command:ClientCommand,result:ClientCommandResult){
    if(command.kind!=='reload-client'||!result.ok||!result.reloadScheduled||result.client?.instanceId!==this.client.instanceId||this.initiated)return false;
    await this.ready(command);
    this.initiated=true;
    try{
      if(!(this.app as any).commands.executeCommandById('app:reload'))throw Error('Obsidian refused the native reload command.');
    }catch(error){this.initiated=false;throw error;}
    return true;
  }
}
