import {logEvent,logFailure} from './diagnostics';
import {App, FuzzySuggestModal, Modal, Notice, Setting} from 'obsidian';
import {RequestDeliveryError} from './bridge';

export interface ChatHost {
  steering?:boolean;
  busy?:boolean;
  getNotePath():string;
  getProjectName(projectKey?:string):string;
  getTargetDescription(projectKey?:string):string;
  getProjectChoices():{key:string;label:string}[];
  getDefaultThread(projectKey?:string):string|undefined;
  sendChat(prompt:string,projectKey?:string):Promise<void>;
  sendToNew(prompt:string,projectKey?:string):Promise<void>;
  sendToExisting(prompt:string,projectKey?:string):Promise<void>;
}

class ChatProjectModal extends FuzzySuggestModal<{key:string;label:string}> {
  constructor(app:App,private choices:{key:string;label:string}[],private choose:(key:string)=>void){super(app);this.setPlaceholder('Choose a T3 Code project');this.emptyStateText='No T3 Code projects available. Refresh projects in settings.';}
  getItems(){return this.choices;}
  getItemText(item:{key:string;label:string}){return item.label;}
  onChooseItem(item:{key:string;label:string}){this.choose(item.key);}
}

type Destination='default'|'new'|'existing';

/** The same compact destination UI handles whole notes, selections, and typed asks. */
class SendDestinationModal extends Modal {
  private choosing=false;
  private actions!:Setting;
  private field?:HTMLTextAreaElement;
  private projectKey?:string;
  private composing:boolean;
  constructor(app:App,private host:ChatHost,private prompt?:string){super(app);this.composing=prompt===undefined;}
  onOpen(){
    logEvent('ui.destination.opened',{notePath:this.host.getNotePath(),steering:this.host.steering,composing:this.composing,projectKey:this.projectKey});
    this.titleEl.setText('Send to T3 Code');this.contentEl.empty();
    const row=this.contentEl.createEl('p');
    const projectButton=row.createEl('button',{text:this.host.getProjectName(this.projectKey),cls:'send-to-t3-note-project',attr:{'aria-label':`Change project for this send: ${this.host.getProjectName(this.projectKey)}`,title:this.host.getTargetDescription(this.projectKey)}});
    projectButton.disabled=Boolean(this.host.busy);
    projectButton.addEventListener('click',()=>{
      if(this.field)this.prompt=this.field.value;
      new ChatProjectModal(this.app,this.host.getProjectChoices(),key=>{logEvent('ui.destination.project-selected',{projectKey:key});this.projectKey=key;this.onOpen();}).open();
    });
    if(this.composing){
      this.field=this.contentEl.createEl('textarea',{attr:{'aria-label':'Message for T3',placeholder:'What would you like to do?',rows:'5'}});
      this.field.style.width='100%';this.field.value=this.prompt??'';
      this.field.addEventListener('keydown',event=>{
        if(event.key==='Enter'&&(event.metaKey||event.ctrlKey)&&!event.isComposing){event.preventDefault();void this.choose('default');}
      });
    }
    const remembered=this.host.getDefaultThread(this.projectKey);
    let defaultButton:HTMLButtonElement|undefined;
    this.actions=new Setting(this.contentEl).setClass('send-to-t3-destination-actions');
    if(remembered||this.host.steering)this.actions.addButton(button=>{defaultButton=button.buttonEl;button.setButtonText(this.host.steering?'Send to running thread':'Previous thread').setCta().onClick(()=>this.choose('default'));});
    this.actions.addButton(button=>{
      button.setButtonText('New thread');
      if(!defaultButton){defaultButton=button.buttonEl;button.setCta();}
      button.onClick(()=>this.choose('new'));
    });
    this.actions.addButton(button=>button.setButtonText('Existing thread…').onClick(()=>this.choose('existing')));
    this.actions.setDisabled(Boolean(this.host.busy));
    if(this.field)this.field.focus();
    else setTimeout(()=>{if(defaultButton?.isConnected)defaultButton.focus();},0);
  }
  onClose(){logEvent('ui.destination.closed',{notePath:this.host.getNotePath(),submitted:this.choosing});}
  private async choose(target:Destination|boolean='default'){
    if(this.choosing||this.host.busy)return;
    if(this.field){this.prompt=this.field.value;if(!this.prompt.trim())return;}
    logEvent('ui.destination.submitted',{notePath:this.host.getNotePath(),target,projectKey:this.projectKey,steering:this.host.steering});
    this.choosing=true;this.actions.setDisabled(true);this.close();
    const prompt=this.prompt??'';
    try{
      if(target===true||target==='existing')await this.host.sendToExisting(prompt,this.projectKey);
      else if(target==='new')await this.host.sendToNew(prompt,this.projectKey);
      else await this.host.sendChat(prompt,this.projectKey);
    }catch(error){
      logFailure('ui.destination.failed',error,{notePath:this.host.getNotePath(),target});
      new Notice(`T3 Code: ${error instanceof Error?error.message:String(error)}`,10000);
      if(!(error instanceof RequestDeliveryError&&error.requestSaved))this.open();
    }finally{this.choosing=false;this.actions.setDisabled(Boolean(this.host.busy));}
  }
}

/** Both entry points preserve the note captured when the send was opened. */
export async function openChatFlow(app:App,host:ChatHost,prompt?:string):Promise<void>{
  if(prompt!==undefined&&!prompt.trim())return;
  new SendDestinationModal(app,host,prompt).open();
}
export function openNoteSendFlow(app:App,host:ChatHost):void{
  new SendDestinationModal(app,host,'').open();
}
