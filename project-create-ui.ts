import {App,Modal,Setting} from 'obsidian';
import type {Project} from './bridge';
import type {VaultMachine} from './vault-setup-ui';
import {sameWorkspacePath} from './folder-link';

export class ProjectCreationCancelled extends Error {constructor(){super('Project creation cancelled.');}}

export function workspaceInsideVault(path:string,root:string):boolean {
  const normalize=(value:string)=>{
    const parts=value.replace(/\\/g,'/').split('/'),out:string[]=[];
    for(const part of parts){if(part==='.')continue;if(part==='..'){out.pop();continue;}out.push(part);}
    return out.join('/').replace(/\/+$/,'');
  };
  let target=normalize(path),vault=normalize(root);
  if(/^[a-z]:\//i.test(vault)||vault.startsWith('//')){target=target.toLowerCase();vault=vault.toLowerCase();}
  return target===vault||target.startsWith(vault+'/');
}

export interface ProjectLocation {
  browse(path:string):Promise<{parentPath:string;entries:{name:string;fullPath:string}[]}>;
  create(path:string,title:string):Promise<Project>;
  close():void;
}
export interface ProjectCreateHost {
  machines():VaultMachine[];
  connect(machine:VaultMachine):Promise<ProjectLocation>;
  link(project:Project):Promise<void>;
  closed?():void;
}
export class ProjectCreateModal extends Modal {
  private machineId='';private location?:ProjectLocation;
  private folder='~';private entries:{name:string;fullPath:string}[]=[];
  private working=false;private ended=false;private status='';
  constructor(app:App,private name:string,private host:ProjectCreateHost){super(app);}
  onOpen(){this.draw();}
  onClose(){this.ended=true;this.location?.close();this.contentEl.empty();this.host.closed?.();}
  private draw(){
    if(this.ended)return;
    this.titleEl.setText('Create T3 project');this.contentEl.empty();
    this.contentEl.createEl('p',{text:'Choose an existing workspace folder, then create the project and link this Obsidian folder to it.'});
    const machines=this.host.machines();
    if(!machines.some(m=>m.id===this.machineId))this.machineId=machines[0]?.id??'';
    new Setting(this.contentEl).setName('Machine').addDropdown(d=>{
      if(!machines.length)d.addOption('','No connected machines');
      for(const machine of machines)d.addOption(machine.id,machine.name);
      d.setValue(this.machineId).setDisabled(this.working).onChange(id=>{
        this.machineId=id;this.location?.close();this.location=undefined;this.folder='~';this.entries=[];this.status='';this.draw();
      });
    });
    new Setting(this.contentEl).setName('Project name').addText(t=>t.setValue(this.name).setDisabled(this.working).onChange(value=>{this.name=value;}));
    new Setting(this.contentEl).setName('Workspace location').addText(t=>t.setValue(this.folder).setPlaceholder('Folder path').setDisabled(this.working).onChange(value=>{this.folder=value;}));
    new Setting(this.contentEl)
      .addButton(b=>b.setButtonText('Browse').setDisabled(this.working||!this.machineId).onClick(()=>this.browse(this.folder)))
      .addButton(b=>b.setButtonText('Home').setDisabled(this.working||!this.machineId).onClick(()=>this.browse('~')))
      .addButton(b=>b.setButtonText('Parent folder').setDisabled(this.working||!this.location).onClick(()=>this.browse(this.folder.replace(/[\\/]+$/,'')+'/..')));
    for(const entry of this.entries)new Setting(this.contentEl).setName(entry.name).addButton(b=>b.setButtonText('Open').setDisabled(this.working).onClick(()=>this.browse(entry.fullPath)));
    new Setting(this.contentEl)
      .addButton(b=>b.setButtonText('Cancel').setDisabled(this.working).onClick(()=>this.close()))
      .addButton(b=>b.setButtonText('Create and link').setCta().setDisabled(this.working||!this.machineId).onClick(()=>this.create()));
    if(!machines.length)this.contentEl.createEl('p',{text:'Sign in or pair a machine in connection settings first.'});
    if(this.status)this.contentEl.createEl('p',{text:this.status,attr:{role:'status'}});
  }
  private async connect(){
    if(this.location)return this.location;
    const machine=this.host.machines().find(m=>m.id===this.machineId);if(!machine)throw Error('Choose a connected machine.');
    const location=await this.host.connect(machine);
    if(this.ended){location.close();return;}
    return this.location=location;
  }
  private async work(action:()=>Promise<void>){
    if(this.working||this.ended)return;this.working=true;this.status='Working…';this.draw();
    try{await action();}catch(error){if(!this.ended)this.status=error instanceof Error?error.message:'Cannot create this project. Try again.';}
    finally{this.working=false;this.draw();}
  }
  async browse(path:string){await this.work(async()=>{
    const location=await this.connect();if(!location||this.ended)return;
    const list=await location.browse(path);if(this.ended)return;
    this.folder=list.parentPath;this.entries=list.entries;this.status='';
  });}
  async create(){await this.work(async()=>{
    if(!this.name.trim())throw Error('Enter a project name.');
    if(!this.folder.trim()||this.folder==='~')throw Error('Choose a workspace folder first.');
    const location=await this.connect();if(!location||this.ended)return;
    const list=await location.browse(this.folder);if(this.ended)return;
    if(!sameWorkspacePath(this.folder,list.parentPath))throw Error('Browse to an existing workspace folder before creating the project.');
    this.folder=list.parentPath;
    const project=await location.create(this.folder,this.name.trim());if(this.ended)return;
    await this.host.link(project);this.close();
  });}
}
