import {App,Modal,Setting,setIcon} from 'obsidian';
import type {Project} from './bridge';
import type {VaultMachine} from './vault-setup-ui';
import {sameWorkspacePath} from './folder-link';
import {filterWorkspaceFolders,workspaceChildPath,workspaceParentPath,type NewWorkspaceFolder} from './workspace-picker';

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
  create(path:string,title:string,newFolder?:NewWorkspaceFolder):Promise<Project>;
  close():void;
}
export interface ProjectCreateHost {
  configure?(el:HTMLElement):void;
  validateConfiguration?():void;
  machines():VaultMachine[];
  defaults?(machineId?:string):{machineId:string;parentPath:string};
  connect(machine:VaultMachine):Promise<ProjectLocation>;
  link(project:Project):Promise<void>;
  closed?():void;
}
export class ProjectCreateModal extends Modal {
  private machineId='';private location?:ProjectLocation;
  private folder='~';private entries:{name:string;fullPath:string}[]=[];
  private working=false;private creating=false;private ended=false;private status='';
  private query='';private folderName='';private customFolderName=false;private useNewFolder=true;private showHidden=false;
  private preview?:HTMLElement;
  private created?:{key:string;project:Project};
  constructor(app:App,private name:string,private host:ProjectCreateHost){super(app);this.folderName=name;}
  onOpen(){
    const defaults=this.host.defaults?.();
    this.machineId=defaults?.machineId??this.host.machines()[0]?.id??'';this.folder=defaults?.parentPath??'~';
    this.draw();if(this.machineId)void this.browse(this.folder);
  }
  onClose(){this.ended=true;this.location?.close();this.contentEl.empty();this.host.closed?.();}
  private draw(){
    if(this.ended)return;
    this.modalEl.addClass('send-to-t3-project-create');this.titleEl.setText('Create T3 project');this.contentEl.empty();
    this.contentEl.createEl('p',{cls:'send-to-t3-project-intro',text:'Choose where the project files will live, then link this Obsidian folder.'});
    const machines=this.host.machines();
    const fields=this.contentEl.createDiv({cls:'send-to-t3-project-fields'});
    new Setting(fields).setName('Machine').addDropdown(d=>{
      if(!machines.length)d.addOption('','No connected machines');
      for(const machine of machines)d.addOption(machine.id,machine.name+(machine.detail?` · ${machine.detail}`:''));
      d.setValue(this.machineId).setDisabled(this.working).onChange(id=>{
        this.machineId=id;this.location?.close();this.location=undefined;this.folder=this.host.defaults?.(id)?.parentPath??'~';this.entries=[];this.query='';this.status='';this.draw();void this.browse(this.folder);
      });
    });
    new Setting(fields).setName('Project name').addText(t=>t.setValue(this.name).setDisabled(this.working).onChange(value=>{
      this.name=value;if(!this.customFolderName)this.folderName=value;this.updatePreview();
    }));
    const workspace=this.contentEl.createDiv({cls:'send-to-t3-project-workspace'});
    const modes=workspace.createDiv({cls:'send-to-t3-workspace-modes',attr:{role:'group','aria-label':'Workspace folder'}});
    for(const [isNew,label] of [[true,'New folder'],[false,'Existing folder']] as const){
      const button=modes.createEl('button',{text:label,cls:this.useNewFolder===isNew?'is-active':'',attr:{'aria-pressed':String(this.useNewFolder===isNew)}});
      button.disabled=this.working;button.onclick=()=>{this.useNewFolder=isNew;this.status='';this.draw();};
    }
    let list:HTMLElement;
    new Setting(workspace).setClass('send-to-t3-workspace-path').setName(this.useNewFolder?'Parent folder':'Workspace folder')
      .addText(t=>{t.setValue(this.folder).setPlaceholder('Folder path').setDisabled(this.working).onChange(value=>{this.folder=value;this.entries=[];this.updatePreview();this.drawFolders(list);});t.inputEl.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();void this.browse(this.folder);}});})
      .addButton(b=>b.setButtonText('Go').setDisabled(this.working||!this.machineId).onClick(()=>void this.browse(this.folder)));
    const toolbar=workspace.createDiv({cls:'send-to-t3-workspace-toolbar'});
    for(const [label,action] of [['Up',()=>this.browse(workspaceParentPath(this.folder))],['Home',()=>this.browse('~')]] as const){
      const button=toolbar.createEl('button',{text:label});button.disabled=this.working||!this.machineId;button.onclick=()=>action();
    }
    const search=toolbar.createEl('input',{type:'search',placeholder:'Filter folders…',attr:{'aria-label':'Filter folders'}});
    search.value=this.query;search.disabled=this.working;search.oninput=()=>{this.query=search.value;this.drawFolders(list);};
    const hidden=toolbar.createEl('button',{text:this.showHidden?'Hide hidden':'Show hidden',attr:{'aria-pressed':String(this.showHidden),'aria-label':'Show hidden folders'}});
    hidden.disabled=this.working;hidden.onclick=()=>{this.showHidden=!this.showHidden;hidden.setText(this.showHidden?'Hide hidden':'Show hidden');hidden.setAttribute('aria-pressed',String(this.showHidden));this.drawFolders(list);};
    list=workspace.createDiv({cls:'send-to-t3-workspace-folders',attr:{'aria-label':'Folders'}});this.drawFolders(list);
    this.preview=this.contentEl.createDiv({cls:'send-to-t3-workspace-preview',attr:{'aria-live':'polite'}});this.updatePreview();
    this.host.configure?.(this.contentEl);
    const status=this.contentEl.createEl('p',{cls:'send-to-t3-project-status',text:this.status,attr:{role:'status'}});
    status.hidden=!this.status;
    new Setting(this.contentEl).setClass('send-to-t3-project-actions')
      .addButton(b=>b.setButtonText('Cancel').setDisabled(this.creating).onClick(()=>this.close()))
      .addButton(b=>b.setButtonText(this.creating?'Creating…':'Create and link').setCta().setDisabled(this.working||!this.machineId).onClick(()=>this.create()));
    if(!machines.length)this.contentEl.createEl('p',{text:'Sign in or pair a machine in connection settings first.'});
  }
  private updatePreview(){
    if(!this.preview)return;this.preview.empty();
    this.preview.createEl('span',{cls:'send-to-t3-workspace-preview-label',text:this.useNewFolder?'New workspace':'Existing workspace'});
    const path=this.preview.createEl('code');
    try{path.setText(this.useNewFolder?workspaceChildPath(this.folder,this.folderName):this.folder);}
    catch{path.setText('Choose a parent folder and a valid project folder name.');}
    if(this.useNewFolder){
      const label=this.preview.createEl('label',{text:'Folder name',cls:'send-to-t3-workspace-folder-name'});
      const input=label.createEl('input',{type:'text',attr:{'aria-label':'Folder name'}});input.value=this.folderName;input.disabled=this.working;
      input.oninput=()=>{this.folderName=input.value;this.customFolderName=true;const path=this.preview?.querySelector('code');if(path){try{path.setText(workspaceChildPath(this.folder,this.folderName));}catch{path.setText('Enter a valid folder name.');}}};
    }
  }
  private drawFolders(list:HTMLElement){
    list.empty();
    const visible=this.entries.filter(entry=>this.showHidden||!entry.name.startsWith('.'));
    const entries=filterWorkspaceFolders(visible,this.query).sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true,sensitivity:'base'}));
    for(const entry of entries){
      const row=list.createEl('button',{cls:'send-to-t3-workspace-folder',attr:{'aria-label':`Open ${entry.name}`}});row.disabled=this.working;
      setIcon(row.createEl('span',{cls:'send-to-t3-workspace-folder-icon'}),'folder');row.createEl('span',{text:entry.name});setIcon(row.createEl('span',{cls:'send-to-t3-workspace-folder-arrow'}),'chevron-right');
      row.onclick=()=>void this.browse(entry.fullPath);
    }
    if(!entries.length)list.createEl('p',{text:this.working?'Loading folders…':this.query?'No matching folders':this.entries.length&&!this.showHidden?'Only hidden folders here. Select Show hidden to see them.':this.location?'No folders in this directory.':'Enter a folder path and select Go.',attr:{role:'status'}});
  }
  private async connect(){
    if(this.location)return this.location;
    const machine=this.host.machines().find(m=>m.id===this.machineId);if(!machine)throw Error('Choose a connected machine.');
    const location=await this.host.connect(machine);
    if(this.ended){location.close();return;}
    return this.location=location;
  }
  private async work(action:()=>Promise<void>){
    if(this.working||this.ended)return;this.working=true;this.status=this.creating?'Creating project…':'Loading folders…';this.draw();
    try{await action();}catch(error){if(!this.ended)this.status=error instanceof Error?error.message:'Cannot create this project. Try again.';}
    finally{this.working=false;this.creating=false;this.draw();}
  }
  async browse(path:string){await this.work(async()=>{
    const location=await this.connect();if(!location||this.ended)return;
    const list=await location.browse(path);if(this.ended)return;
    this.folder=list.parentPath;this.entries=list.entries;this.query='';this.status='';
  });}
  async create(){
    if(this.working||this.ended)return;this.creating=true;
    await this.work(async()=>{
      this.host.validateConfiguration?.();
      if(!this.name.trim())throw Error('Enter a project name.');
      if(!this.folder.trim()||this.folder==='~')throw Error('Choose a workspace folder first.');
      const location=await this.connect();if(!location||this.ended)return;
      const list=await location.browse(this.folder);if(this.ended)return;
      if(!sameWorkspacePath(this.folder,list.parentPath))throw Error('Browse to an existing folder before creating the project.');
      this.folder=list.parentPath;
      const newFolder=this.useNewFolder?{parentPath:this.folder,name:this.folderName}:undefined;
      const root=newFolder?workspaceChildPath(this.folder,this.folderName):this.folder;
      const key=JSON.stringify([this.machineId,root,this.name.trim()]);
      if(newFolder&&this.created?.key!==key&&list.entries.some(entry=>sameWorkspacePath(entry.fullPath,root)))throw Error('A folder with this name already exists. Choose Existing folder to use it, or enter another folder name.');
      const project=this.created?.key===key?this.created.project:await location.create(root,this.name.trim(),newFolder);if(this.ended)return;
      this.created={key,project};
      await this.host.link(project);this.close();
    });
  }
}
