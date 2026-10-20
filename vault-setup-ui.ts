import {App,Modal,Setting} from 'obsidian';
import type {Project} from './bridge';
import type {VaultRemote} from './vault-connection';
import {discoverVaultRoots} from './vault-connection';

export interface VaultMachine {id:string;name:string;detail?:string;local?:boolean;environmentId?:string}
export interface VaultSetupHost {
  vaultId:string;vaultName:string;settingsPath:string;
  machines():VaultMachine[];
  refresh():Promise<void>;
  connect(machine:VaultMachine):Promise<VaultRemote>;
  roots(machine:VaultMachine):string[];
  link(machine:VaultMachine,root?:string,remote?:VaultRemote):Promise<Project>;
}
export class VaultSetupCancelled extends Error {constructor(){super('Vault setup closed. Your message is still ready to send.');}}

export class VaultSetupModal extends Modal {
  private machineId='';private machine?:VaultMachine;private remote?:VaultRemote;
  private roots:string[]=[];private folder='~';private entries:{name:string;fullPath:string}[]=[];
  private status='';private working=false;private ended=false;private generation=0;private completed=false;
  private resolve!:(project:Project)=>void;private reject!:(error:Error)=>void;
  private readonly result=new Promise<Project>((resolve,reject)=>{this.resolve=resolve;this.reject=reject;});
  constructor(app:App,private host:VaultSetupHost){super(app);}
  wait(){this.open();return this.result;}
  get isClosed(){return this.ended;}
  onOpen(){this.draw();}
  onClose(){this.ended=true;this.generation++;this.remote?.close();this.contentEl.empty();if(!this.completed)this.reject(new VaultSetupCancelled());}
  private draw(){
    if(this.ended)return;
    this.titleEl.setText(`Connect ${this.host.vaultName}`);this.contentEl.empty();
    this.contentEl.createEl('p',{text:'Choose the computer that has a synced copy of this vault. Its T3 project will become the default for chat outside linked folders.'});
    const machines=this.host.machines();
    if(!machines.some(m=>m.id===this.machineId))this.machineId=machines[0]?.id??'';
    new Setting(this.contentEl).setName('Machine').addDropdown(d=>{
      if(!machines.length)d.addOption('','No connected machines');
      for(const m of machines)d.addOption(m.id,m.name+(m.detail?` · ${m.detail}`:''));
      d.setValue(this.machineId).setDisabled(this.working).onChange(id=>{this.machineId=id;this.generation++;this.remote?.close();this.remote=undefined;this.machine=undefined;this.roots=[];this.entries=[];this.status='';this.draw();});
    });
    new Setting(this.contentEl)
      .addButton(b=>b.setButtonText('Refresh machines').setDisabled(this.working).onClick(()=>void this.work(async()=>{this.remote?.close();this.remote=undefined;this.machine=undefined;this.roots=[];this.entries=[];await this.host.refresh();this.status='Choose a machine, then select Find vault.';})))
      .addButton(b=>b.setButtonText('Find vault').setCta().setDisabled(this.working||!this.machineId).onClick(()=>void this.find()));
    if(!machines.length)this.contentEl.createEl('p',{text:'Sign in to T3 in this plugin’s connection settings, then refresh machines here. Your message will stay open.'});
    if(this.remote&&this.machine){
      for(const root of this.roots)new Setting(this.contentEl).setName('Synced vault found').setDesc(root).addButton(b=>b.setButtonText('Use this folder').setCta().setDisabled(this.working).onClick(()=>void this.use(root)));
      new Setting(this.contentEl).setName(`Vault folder on ${this.machine.name}`).setDesc('Browse to the vault already synced to this computer. Obsidian Sync must include this plugin’s settings.').addText(t=>t.setValue(this.folder).setPlaceholder('Folder path').setDisabled(this.working).onChange(value=>{this.folder=value;}));
      new Setting(this.contentEl)
        .addButton(b=>b.setButtonText('Browse').setDisabled(this.working).onClick(()=>void this.browse(this.folder)))
        .addButton(b=>b.setButtonText('Home').setDisabled(this.working).onClick(()=>void this.browse('~')))
        .addButton(b=>b.setButtonText('Parent folder').setDisabled(this.working).onClick(()=>void this.browse(this.folder.replace(/[\\/]+$/,'')+'/..')))
        .addButton(b=>b.setButtonText('Use this folder').setDisabled(this.working||this.folder==='~').onClick(()=>void this.use(this.folder)));
      for(const entry of this.entries)new Setting(this.contentEl).setName(entry.name).addButton(b=>b.setButtonText('Open').setDisabled(this.working).onClick(()=>void this.browse(entry.fullPath)));
    }
    if(this.status)this.contentEl.createEl('p',{text:this.status,attr:{role:'status'}});
  }
  private async work(action:()=>Promise<void>){
    if(this.working||this.ended)return;this.working=true;this.status='Connecting…';this.draw();
    try{await action();}catch(error){if(!this.ended)this.status=error instanceof Error?error.message:'Cannot connect this vault. Try again.';}
    finally{this.working=false;this.draw();}
  }
  async find(){await this.work(async()=>{
    const machine=this.host.machines().find(m=>m.id===this.machineId);if(!machine)return;
    const generation=++this.generation;this.remote?.close();this.remote=undefined;this.machine=machine;this.entries=[];this.roots=[];
    if(machine.local){const project=await this.host.link(machine);if(!this.ended)this.finish(project);return;}
    const remote=await this.host.connect(machine);
    if(this.ended||generation!==this.generation){remote.close();return;}this.remote=remote;
    const projects=await remote.projects();
    this.roots=await discoverVaultRoots(remote,[...this.host.roots(machine),...projects.map(p=>p.workspaceRoot)],this.host.settingsPath,this.host.vaultId);
    if(this.ended)return;
    if(this.roots.length===1){this.folder=this.roots[0];this.status='Found the synced vault. Use this folder to continue.';}
    else {const list=await remote.browse('~');if(this.ended)return;this.folder=list.parentPath;this.entries=list.entries;this.status=this.roots.length?'Choose which synced copy to use.':'Choose the synced vault folder below. If it has just synced, select Find vault again.';}
  });}
  async browse(path:string){await this.work(async()=>{if(!this.remote)return;const list=await this.remote.browse(path);this.folder=list.parentPath;this.entries=list.entries;this.status='Choose the vault folder, then select Use this folder.';});}
  async use(root:string){await this.work(async()=>{
    const remote=this.remote,machine=this.machine;if(!remote||!machine)return;
    // Browsing canonicalizes typed paths and catches nonexistent directories.
    const folder=(await remote.browse(root)).parentPath;
    if(!await remote.matches(folder,this.host.settingsPath,this.host.vaultId))throw Error('This folder has not synced this vault’s plugin settings yet, or belongs to another vault. Finish Obsidian Sync on both devices, then try Use this folder again.');
    if(this.ended)return;
    const project=await this.host.link(machine,folder,remote);if(!this.ended)this.finish(project);
  });}
  private finish(project:Project){this.completed=true;this.resolve(project);this.close();}
}
