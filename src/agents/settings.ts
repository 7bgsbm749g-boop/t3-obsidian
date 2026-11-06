import {Notice,Setting} from 'obsidian';
import {toError} from '../shared/values';
import type {AgentProvider,AgentSetupState} from './setup';

export interface AgentToolsHost {
  machines():{id:string;name:string}[];
  inspect(environmentId:string):Promise<AgentSetupState>;
  install(environmentId:string,provider:AgentProvider,runtime:string):Promise<unknown>;
  remove(environmentId:string,provider:AgentProvider):Promise<void>;
  status(environmentId:string,provider:AgentProvider):Promise<{installed:boolean;lastConnected?:number}>;
}
/** Settings state is device-local and does not change synced plugin settings. */
export class AgentToolsSettings {
  private machine='';private provider='';private runtime='';private runtimeEdited=false;
  private choices?:AgentSetupState;private busy=false;private status='';private generation=0;
  constructor(private host:AgentToolsHost){}
  render(el:HTMLElement){
    const generation=++this.generation;el.empty();
    const machines=this.host.machines();
    if(!machines.some(machine=>machine.id===this.machine)){this.machine=machines[0]?.id??'';this.choices=undefined;this.provider='';}
    el.createEl('p',{text:'Set up the editing tools and skill for an agent on a connected T3 computer. Python 3.10 or later must be available on that computer. Obsidian stays in control of note edits.'});
    if(!machines.length){el.createEl('p',{text:'Connect a T3 computer first.'});return;}
    new Setting(el).setName('Computer').addDropdown(dropdown=>{
      for(const machine of machines)dropdown.addOption(machine.id,machine.name);
      dropdown.setValue(this.machine).setDisabled(this.busy).onChange(value=>{this.machine=value;this.choices=undefined;this.status='';this.runtimeEdited=false;this.render(el);});
    });
    const run=async(action:()=>Promise<void>)=>{if(this.busy)return;this.busy=true;this.render(el);try{await action();}catch(error){this.status=toError(error).message;new Notice(this.status,12000);}finally{this.busy=false;this.render(el);}};
    if(!this.choices){
      el.createEl('p',{text:'Reading available agents…'});
      const machine=this.machine;
      void this.host.inspect(machine).then(state=>{
        if(this.generation!==generation||this.machine!==machine)return;
        this.choices=state;if(!this.runtimeEdited)this.runtime=state.windows?'python':'python3';this.render(el);
      },error=>{
        if(this.generation!==generation)return;
        this.status=toError(error).message;el.createEl('p',{text:this.status,cls:'t3-error'});
        new Setting(el).addButton(button=>button.setButtonText('Retry').onClick(()=>this.render(el)));
      });return;
    }
    const providers=this.choices.providers;
    if(!providers.some(provider=>provider.id===this.provider))this.provider=providers[0]?.id??'';
    if(!providers.length){el.createEl('p',{text:'Automatic setup supports enabled Codex and Claude Code agents. Enable one in T3 settings, then refresh.'});}
    else {
      new Setting(el).setName('Agent').addDropdown(dropdown=>{for(const provider of providers)dropdown.addOption(provider.id,provider.name);dropdown.setValue(this.provider).setDisabled(this.busy).onChange(value=>{this.provider=value;this.status='';this.render(el);});});
      new Setting(el).setName('Python executable').setDesc('The name or full path on the selected T3 computer. No package installation is needed.').addText(input=>input.setPlaceholder(this.choices?.windows?'python':'python3').setValue(this.runtime).setDisabled(this.busy).onChange(value=>{this.runtime=value;this.runtimeEdited=true;}));
      const selected=providers.find(provider=>provider.id===this.provider)!;
      new Setting(el).setName('Editing tools and skill').setDesc('Installs the bundled tools and adds this MCP server to the selected agent’s launch settings. Existing agent sessions keep running.').addButton(button=>button.setButtonText('Set up agent').setCta().setDisabled(this.busy).onClick(()=>run(async()=>{await this.host.install(this.machine,selected,this.runtime);this.status='Installed. Start a new agent session to load the tools and skill, then check the connection. If startup fails, check the Python executable.';}))).addButton(button=>button.setButtonText('Check connection').setDisabled(this.busy).onClick(()=>run(async()=>{
        const status=await this.host.status(this.machine,selected);
        this.status=!status.installed?'This agent is not configured.':status.lastConnected?`Configured. An agent loaded these tools at ${new Date(status.lastConnected).toLocaleString()}.`:'Configured. No agent connection has been confirmed yet. Start a new agent session and check its MCP status.';
      }))).addButton(button=>button.setButtonText('Remove setup').setDisabled(this.busy).onClick(()=>run(async()=>{await this.host.remove(this.machine,selected);this.status='Agent setup removed. Existing sessions finish with their current tools.';})));
    }
    new Setting(el).addButton(button=>button.setButtonText('Refresh agents').setDisabled(this.busy).onClick(()=>{this.choices=undefined;this.render(el);}));
    if(this.status)el.createEl('p',{text:this.status});
  }
}
