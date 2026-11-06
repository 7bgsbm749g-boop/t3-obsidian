import {Notice,Setting} from 'obsidian';
import {scheduleTimeout,cancelTimeout} from '../shared/clock';
import {toError} from '../shared/values';
import {AgentFleet,type FleetHost} from './fleet';
export type AgentToolsHost=FleetHost;
/** Status reads run in the background. Only explicit buttons change setup. */
export class AgentToolsSettings {
  private fleet:AgentFleet;private busy=false;private checking=false;private element?:HTMLElement;
  private expanded=new Set<string>();private notified='';private timer?:ReturnType<typeof scheduleTimeout>;private lastScan=0;
  constructor(host:AgentToolsHost){this.fleet=new AgentFleet(host);}
  dispose(){if(this.timer!==undefined)cancelTimeout(this.timer);this.element=undefined;}
  private refresh(){if(this.element?.isConnected)this.render(this.element);}
  private details(el:HTMLElement,name:string){
    const details=el.createEl('details',{cls:'t3-settings-details'}),summary=details.createEl('summary',{text:name});
    details.open=this.expanded.has(name);
    // Native settings can consume the default click. Keep the ordinary
    // summary keyboard/click behavior explicit and retain expansion on refresh.
    summary.addEventListener('click',event=>{event.preventDefault();details.open=!details.open;if(details.open)this.expanded.add(name);else this.expanded.delete(name);});
    details.addEventListener('toggle',()=>{if(details.open)this.expanded.add(name);else this.expanded.delete(name);});
    return details;
  }
  render(el:HTMLElement){
    this.element=el;el.empty();if(this.timer!==undefined)cancelTimeout(this.timer);
    new Setting(el).setName('Agent note editing').setHeading();
    const machines=this.fleet.snapshot,targets=machines.flatMap(machine=>machine.targets);
    const active=targets.filter(target=>target.available!==false);
    const configured=active.filter(target=>target.installed&&!target.needsUpdate&&!target.error&&!target.custom).length;
    const needed=active.filter(target=>!target.custom&&(!target.installed||target.needsUpdate||target.error)).length;
    const unresolved=machines.some(machine=>machine.error||machine.unsupported.length>0)||targets.some(target=>target.custom||target.error);
    const state=!this.lastScan?'checking':needed||unresolved?'needed':active.length?'ready':'empty';
    const status=el.createDiv({cls:'t3-agent-status'});status.dataset.state=state;status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    status.createEl('strong',{text:state==='checking'?'Checking MCP setup…':state==='needed'?'MCP setup needs attention':state==='ready'?'MCP is configured':machines.length?'No available agents found in T3':'Connect a T3 computer in the Connection section'});
    status.createEl('p',{text:state==='needed'?'Connect MCP to set up agent note editing on your connected computers. Existing setups are kept.':state==='ready'?`${configured} agent ${configured===1?'setup':'setups'} across ${machines.length} ${machines.length===1?'computer':'computers'}. Start a new agent session after setup.`:'Checks run automatically while this section is open.'});
    const run=async(kind:'connect'|'disconnect')=>{
      if(this.busy)return;this.busy=true;this.refresh();
      try{await this.fleet.run(kind);this.lastScan=Date.now();}catch(error){new Notice(toError(error).message,12000);}
      finally{this.busy=false;this.refresh();}
    };
    new Setting(el).setName('MCP connection').setDesc('Applies to all connected computers and available agents. Does not disconnect your T3 account or stop current sessions.')
      .addButton(button=>button.setButtonText('Connect MCP').setCta().setDisabled(this.busy||this.checking||!needed&&!machines.some(machine=>machine.error||!machine.manual)).onClick(()=>run('connect')))
      .addButton(button=>button.setButtonText('Disconnect MCP').setDisabled(this.busy||this.checking||!targets.some(target=>target.owned)).onClick(()=>run('disconnect')));
    if(this.busy)el.createEl('p',{text:'Updating MCP setup…',cls:'t3-agent-progress'});
    if(machines.length){
      const details=this.details(el,'Computers and agents');
      for(const machine of machines){
        new Setting(details).setName(machine.name).setDesc(machine.error??(machine.targets.length?`${machine.targets.filter(target=>target.installed&&!target.custom).length} of ${machine.targets.length} configured`:'No enabled, installed agents found.'));
        for(const target of machine.targets)details.createEl('p',{text:`${target.provider.name}: ${target.error??(target.available===false?'Disabled or unavailable; Disconnect MCP can remove the retained setup.':target.custom?'Existing custom setup kept; connection not verified.':target.needsUpdate?'Update available':target.installed?'Configured'+(target.lastConnected?' · An agent has loaded the tools.':' · Start a new session to load the tools.'):'Needs setup')}`,cls:target.error?'t3-error':undefined});
        for(const target of machine.unsupported)details.createEl('p',{text:`${target.name}: automatic setup is not available for this harness yet.`,cls:'t3-agent-warning'});
      }
      details.createEl('p',{text:'The tools use Python 3.10 or later on the T3 computer. Custom or conflicting settings need review and are never replaced.'});
    }
    const advanced=this.details(el,'Advanced');
    new Setting(advanced).setName('Manual setup').setHeading();
    advanced.createEl('p',{text:'For other MCP clients or a custom agent configuration, use the server definition for the computer where the agent runs. Connect MCP prepares these files. Keep your other servers and approve only this server in your agent.'});
    for(const machine of machines){
      new Setting(advanced).setName(machine.name).setDesc(machine.manual?machine.manual.path:'Use Connect MCP when this computer is online to prepare the shared tools.');
      if(machine.manual){const config=advanced.createEl('textarea',{cls:'t3-agent-config'});config.readOnly=true;config.value=machine.manual.config;config.setAttribute('aria-label',machine.name+' MCP configuration');}
    }
    advanced.createEl('p',{text:'Python 3.10 or later must be available on that computer. Add the definition using your harness’s MCP settings, then start a new agent session. This prepares the same editing tools and skill.'});
    const signature=machines.flatMap(machine=>machine.targets.filter(target=>target.available!==false&&!target.custom&&!target.installed).map(target=>machine.id+':'+target.provider.id)).sort().join('|');
    if(signature&&signature!==this.notified){this.notified=signature;new Notice('MCP is not set up for all connected agents. Use Connect MCP in the Agent tools settings.',8000);}
    const scan=async()=>{
      if(this.busy||this.checking||!this.element?.isConnected)return;this.checking=true;
      const before=JSON.stringify(this.fleet.snapshot);let changed=!this.lastScan;
      try{await this.fleet.scan();changed||=before!==JSON.stringify(this.fleet.snapshot);this.lastScan=Date.now();}catch(error){if(this.element?.isConnected)new Notice(toError(error).message,8000);}
      finally{this.checking=false;if(this.element?.isConnected){if(changed)this.refresh();else this.timer=scheduleTimeout(()=>{void scan();},30_000);}}
    };
    this.timer=scheduleTimeout(()=>{void scan();},this.lastScan?30_000:0);
  }
}
