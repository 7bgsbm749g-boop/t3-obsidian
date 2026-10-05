import {resolveJobOptions,overrideCount,type JobOverrides,type ResolvedJobOptions,type InlineDefaults} from './job-options';
import {logEvent,logFailure} from './diagnostics';
import {App, FuzzySuggestModal, Modal, Notice, Setting} from 'obsidian';
import {RequestDeliveryError} from './bridge';
import {ProjectCreationCancelled} from './project-create-ui';

export interface ChatDestination {
  threadId?:string;
  responseId?:string;
  projectKey?:string;
  label:string;
  unavailable?:boolean;
  detail?:string;
}
export interface ChatHost {
  steering?:boolean;
  getInlineDefaults?():InlineDefaults;
  busy?:boolean;
  getNotePath():string;
  getProjectName(projectKey?:string):string;
  getTargetDescription(projectKey?:string):string;
  onProjectChange?(listener:()=>void):()=>void;
  getProjectChoices():{key:string;label:string}[];
  getDefaultThread(projectKey?:string):string|undefined;
  getDefaultDestination?(projectKey?:string):Promise<ChatDestination>;
  sendChat(prompt:string,projectKey?:string,resolve?:()=>ResolvedJobOptions,returnToDraft?:()=>void,destination?:ChatDestination):Promise<void>;
  sendToNew(prompt:string,projectKey?:string,resolve?:()=>ResolvedJobOptions,returnToDraft?:()=>void):Promise<void>;
  sendToExisting(prompt:string,projectKey?:string,resolve?:()=>ResolvedJobOptions,returnToDraft?:()=>void):Promise<void>;
}

class ChatProjectModal extends FuzzySuggestModal<{key:string;label:string}> {
  constructor(app:App,private choices:()=>{key:string;label:string}[],private choose:(key:string)=>void,private watch?:(listener:()=>void)=>()=>void){super(app);this.setPlaceholder('Choose a T3 Code project');this.emptyStateText='Discovering projects… Connect T3 if no projects appear.';}
  private unwatch?:()=>void;
  onOpen(){super.onOpen?.();this.unwatch=this.watch?.(()=>this.inputEl?.dispatchEvent(new Event('input')));}
  onClose(){this.unwatch?.();super.onClose?.();}
  getItems(){return this.choices();}
  getItemText(item:{key:string;label:string}){return item.label;}
  onChooseItem(item:{key:string;label:string}){this.choose(item.key);}
}

/** Child edits are isolated until Apply. Closing or Cancel leaves the parent draft intact. */
export class JobOverridesModal extends Modal {
  private draft:JobOverrides;
  constructor(app:App,draft:JobOverrides,private defaults:InlineDefaults,private apply:(draft:JobOverrides)=>void){super(app);this.draft={inline:{...draft.inline}};}
  onOpen(){
    this.titleEl.setText('Overrides for this send');this.contentEl.empty();
    this.contentEl.createEl('p',{text:'Use default inherits your settings. Explicit choices apply to this new job only.'});
    const base=resolveJobOptions(this.defaults).inline,enabled=resolveJobOptions(this.defaults,this.draft).inline.enabled;
    const inline=this.draft.inline!;
    new Setting(this.contentEl).setName('Stream replies into the editor').addDropdown(d=>{
      d.addOption('default',`Use default — ${base.enabled?'On':'Off'}`).addOption('on','On').addOption('off','Off').setValue(inline.enabled===undefined?'default':inline.enabled?'on':'off').onChange(value=>{inline.enabled=value==='default'?undefined:value==='on';this.onOpen();});
    });
    new Setting(this.contentEl).setName('Intermediate agent responses').setDesc('Applies when streaming is On.').addDropdown(d=>{
      d.addOption('default',`Use default — ${base.intermediateMode}`).addOption('remove','Remove').addOption('keep','Keep').addOption('collapse','Collapse').setValue(inline.intermediateMode??'default').setDisabled(!enabled).onChange(value=>{inline.intermediateMode=value==='default'?undefined:value as NonNullable<typeof inline.intermediateMode>;});
    });
    new Setting(this.contentEl).setName('Final answer format').addDropdown(d=>{
      d.addOption('default',`Use default — ${base.finalAnswerFormat==='formatted'?'Current formatting':'Raw Markdown'}`).addOption('formatted','Current formatting').addOption('raw-markdown','Raw Markdown').setValue(inline.finalAnswerFormat??'default').setDisabled(!enabled).onChange(value=>{inline.finalAnswerFormat=value==='default'?undefined:value as NonNullable<typeof inline.finalAnswerFormat>;});
    });
    new Setting(this.contentEl).addButton(b=>b.setButtonText('Reset overrides').onClick(()=>{this.draft={inline:{}};this.onOpen();})).addButton(b=>b.setButtonText('Cancel').onClick(()=>this.close())).addButton(b=>b.setButtonText('Apply').setCta().onClick(()=>{this.apply(this.draft);this.close();}));
  }
}

type Destination='default'|'new'|'existing';

/** The same compact destination UI handles whole notes, selections, and typed asks. */
class SendDestinationModal extends Modal {
  ready:Promise<ChatDestination|undefined>=Promise.resolve(undefined);
  private revision=0;
  private opened=false;
  private defaultButton?:HTMLButtonElement;
  private defaultDisabled=false;
  private checkingDefault=false;
  private choosing=false;
  private overrides:JobOverrides={};
  private actions!:Setting;
  private field?:HTMLTextAreaElement;
  private projectKey?:string;
  private composing:boolean;
  constructor(app:App,private host:ChatHost,private prompt?:string){super(app);this.composing=prompt===undefined;}
  onOpen(){
    this.opened=true;const revision=++this.revision;
    logEvent('ui.destination.opened',{notePath:this.host.getNotePath(),steering:this.host.steering,composing:this.composing,projectKey:this.projectKey});
    this.titleEl.setText('Send to T3 Code');this.contentEl.empty();
    const row=this.contentEl.createEl('p',{cls:'send-to-t3-destination-top'});
    const projectButton=row.createEl('button',{text:this.host.getProjectName(this.projectKey),cls:'send-to-t3-note-project',attr:{'aria-label':`Change project for this send: ${this.host.getProjectName(this.projectKey)}`,title:this.host.getTargetDescription(this.projectKey)}});
    projectButton.disabled=Boolean(this.host.busy);
    projectButton.addEventListener('click',()=>{
      if(this.field)this.prompt=this.field.value;
      new ChatProjectModal(this.app,()=>this.host.getProjectChoices(),key=>{logEvent('ui.destination.project-selected',{projectKey:key});this.projectKey=key;this.onOpen();},this.host.onProjectChange).open();
    });
    const count=overrideCount(this.overrides);
    const overridesButton=row.createEl('button',{text:count?`Overrides · ${count}`:'Overrides',attr:{'aria-label':`Overrides for this send: ${count} explicit choices`}});
    overridesButton.disabled=Boolean(this.host.busy);
    overridesButton.addEventListener('click',()=>{
      if(this.field)this.prompt=this.field.value;
      new JobOverridesModal(this.app,this.overrides,this.host.getInlineDefaults?.()??{enabled:false},draft=>{this.overrides=draft;this.onOpen();}).open();
    });
    const detail=this.contentEl.createEl('p',{text:''});
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
    this.ready=Promise.resolve(undefined);this.defaultDisabled=false;this.defaultButton=undefined;this.checkingDefault=false;
    if(remembered||this.host.steering)this.actions.addButton(button=>{
      defaultButton=button.buttonEl;
      this.defaultButton=defaultButton;
      button.setButtonText(this.host.getDefaultDestination?'Checking thread…':this.host.steering?'Send to running thread':'Previous thread').setCta().onClick(()=>this.choose('default'));
      if(this.host.getDefaultDestination){
        this.checkingDefault=true;
        this.defaultDisabled=true;button.setDisabled(true);detail.setText('Checking the selected T3 conversation…');
        this.ready=this.host.getDefaultDestination(this.projectKey).catch(()=>({label:'Thread unavailable',unavailable:true,detail:'Cannot check this conversation. Reconnect T3 or choose another thread.'})).then(destination=>{
          if(this.opened&&revision===this.revision){this.defaultDisabled=Boolean(destination.unavailable);button.setButtonText(destination.label).setDisabled(Boolean(this.host.busy||this.defaultDisabled));detail.setText(destination.detail??'');}
          return destination;
        });
      }
    });
    this.actions.addButton(button=>{
      button.setButtonText('New thread');
      if(!defaultButton){defaultButton=button.buttonEl;button.setCta();}
      button.onClick(()=>this.choose('new'));
    });
    this.actions.addButton(button=>button.setButtonText('Existing thread…').onClick(()=>this.choose('existing')));
    this.actions.setDisabled(Boolean(this.host.busy));
    const checkedButton=this.defaultButton as HTMLButtonElement|undefined;
    if(checkedButton)checkedButton.disabled=Boolean(this.host.busy||this.defaultDisabled);
    if(this.field)this.field.focus();
    else setTimeout(()=>{if(defaultButton?.isConnected)defaultButton.focus();},0);
  }
  onClose(){this.opened=false;logEvent('ui.destination.closed',{notePath:this.host.getNotePath(),submitted:this.choosing});}
  private async choose(target:Destination|boolean='default'){
    if(this.choosing||this.host.busy)return;
    target=target===false?'default':target===true?'existing':target;
    if(this.field){this.prompt=this.field.value;if(!this.prompt.trim())return;}
    logEvent('ui.destination.submitted',{notePath:this.host.getNotePath(),target,projectKey:this.projectKey,steering:this.host.steering});
    const revision=this.revision;this.choosing=true;this.actions.setDisabled(true);
    const prompt=this.prompt??'';
    const resolve=()=>resolveJobOptions(this.host.getInlineDefaults?.()??{enabled:false},this.overrides);
    const returnToDraft=()=>this.open();
    try{
      const destination=target==='default'&&this.checkingDefault?await this.ready:undefined;
      if(!this.opened||revision!==this.revision)return;
      if(destination?.unavailable)throw new RequestDeliveryError(destination.detail??'This conversation is unavailable. Choose another thread.',false);
      this.close();
      if(target==='existing')await this.host.sendToExisting(prompt,this.projectKey,resolve,returnToDraft);
      else if(target==='new')await this.host.sendToNew(prompt,this.projectKey,resolve);
      else await this.host.sendChat(prompt,this.projectKey,resolve,undefined,destination);
    }catch(error){
      if(error instanceof ProjectCreationCancelled)return;
      logFailure('ui.destination.failed',error,{notePath:this.host.getNotePath(),target});
      new Notice(`T3 Code: ${error instanceof Error?error.message:String(error)}`,10000);
      if(!this.opened&&!(error instanceof RequestDeliveryError&&error.requestSaved))this.open();
    }finally{this.choosing=false;this.actions.setDisabled(Boolean(this.host.busy));if(this.defaultButton)this.defaultButton.disabled=Boolean(this.host.busy||this.defaultDisabled);}
  }
}

/** Both entry points preserve the note captured when the send was opened. */
export async function openChatFlow(app:App,host:ChatHost,prompt?:string):Promise<void>{
  if(prompt!==undefined&&!prompt.trim())return;
  const modal=new SendDestinationModal(app,host,prompt);modal.open();await modal.ready;
}
export function openNoteSendFlow(app:App,host:ChatHost):void{
  new SendDestinationModal(app,host,'').open();
}
