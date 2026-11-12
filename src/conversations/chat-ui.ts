import {modelButton,type ModelChoice} from './model-picker';
import {clockForDocument} from '../shared/clock';
import {resolveJobOptions,overrideCount,type JobOverrides,type ResolvedJobOptions,type InlineDefaults} from './job-options';
import {logEvent,logFailure} from '../app/diagnostics';
import {App, FuzzySuggestModal, Modal, Notice, Setting} from 'obsidian';
import {NoteTabPanel} from '../notes/note-tab-panel';
import {RequestDeliveryError} from '../app/bridge';
import {ProjectCreationCancelled} from '../projects/project-create-ui';
import {abortableRead,cancelledRequest} from '../connection/t3-api';


export interface ChatDestination {
  threadId?:string;
  responseId?:string;
  projectKey?:string;
  label:string;
  unavailable?:boolean;
  empty?:boolean;
  detail?:string;
}
export interface ChatHost {
  getJobOverrides?():JobOverrides;
  loadModels?(projectKey?:string):Promise<ModelChoice[]>;
  getPreview?():string;
  getThreadChoiceRestriction?():string|undefined;
  steering?:boolean;
  getInlineDefaults?():InlineDefaults;
  busy?:boolean;
  onBusyChange?(listener:()=>void):()=>void;
  runDefaultSend?(send:()=>Promise<void>):Promise<void>;
  beginSend?(options:ResolvedJobOptions):()=>void;
  getNotePath():string;
  getProjectName(projectKey?:string):string;
  getDefaultProjectKey?():string|undefined;
  getTargetDescription(projectKey?:string):string;
  onProjectChange?(listener:()=>void):()=>void;
  getProjectChoices():{key:string;label:string}[];
  getDefaultThread(projectKey?:string):string|undefined;
  /** Imports and folder links do not establish a confirmed send from a note. */
  hasConfirmedNoteSend?():boolean;
  getDefaultDestination?(projectKey?:string,signal?:AbortSignal):Promise<ChatDestination>;
  hasNewContent?(destination:ChatDestination,prompt:string):Promise<boolean>;
  /** Captured routing metadata, not an active-turn authorization. */
  getAlternativeProjectKey?(projectKey?:string):string|undefined;
  sendChat(prompt:string,projectKey?:string,resolve?:()=>ResolvedJobOptions,returnToDraft?:()=>void,destination?:ChatDestination):Promise<void>;
  sendToNew(prompt:string,projectKey?:string,resolve?:()=>ResolvedJobOptions,returnToDraft?:()=>void):Promise<void>;
  sendToExisting(prompt:string,projectKey?:string,resolve?:()=>ResolvedJobOptions,returnToDraft?:()=>void):Promise<void>;
}

class ChatProjectModal extends FuzzySuggestModal<{key:string;label:string}> {
  constructor(app:App,private choices:()=>{key:string;label:string}[],private choose:(key:string)=>void,private watch?:(listener:()=>void)=>()=>void){super(app);this.setPlaceholder('Choose a T3 Code project');this.emptyStateText='Discovering projects… Connect T3 if no projects appear.';}
  private unwatch?:()=>void;
  onOpen(){void super.onOpen?.();this.unwatch=this.watch?.(()=>this.inputEl?.dispatchEvent(new Event('input')));}
  onClose(){this.unwatch?.();super.onClose?.();}
  getItems(){return this.choices();}
  getItemText(item:{key:string;label:string}){return item.label;}
  onChooseItem(item:{key:string;label:string}){this.choose(item.key);}
}

/** Child edits are isolated until Apply. Closing or Cancel leaves the parent draft intact. */
export class JobOverridesModal extends Modal {
  private draft:JobOverrides;
  constructor(app:App,draft:JobOverrides,private defaults:InlineDefaults,private apply:(draft:JobOverrides)=>void){super(app);this.draft={...draft,inline:{...draft.inline}};}
  onOpen(){
    this.titleEl.setText('Overrides for this send');this.contentEl.empty();
    this.contentEl.createEl('p',{text:'Use default inherits your settings. Explicit choices apply to this new job only.'});
    const base=resolveJobOptions(this.defaults).inline,enabled=resolveJobOptions(this.defaults,this.draft).inline.enabled;
    const inline=this.draft.inline!;
    new Setting(this.contentEl).setName('Stream replies into the editor').addDropdown(d=>{
      d.addOption('default',`Use default — ${base.enabled?'On':'Off'}`).addOption('on','On').addOption('off','Off').setValue(inline.enabled===undefined?'default':inline.enabled?'on':'off').onChange(value=>{inline.enabled=value==='default'?undefined:value==='on';this.onOpen();});
    });
    new Setting(this.contentEl).setName('Intermediate agent responses').setDesc('Progress stays in an open box until the final answer is complete. Click the header to open or close it.');
    new Setting(this.contentEl).setName('Final answer format').addDropdown(d=>{
      d.addOption('default',`Use default — ${base.finalAnswerFormat==='formatted'?'Current formatting':'Raw Markdown'}`).addOption('formatted','Current formatting').addOption('raw-markdown','Raw Markdown').setValue(inline.finalAnswerFormat??'default').setDisabled(!enabled).onChange(value=>{inline.finalAnswerFormat=value==='default'?undefined:value as NonNullable<typeof inline.finalAnswerFormat>;});
    });
    new Setting(this.contentEl).addButton(b=>b.setButtonText('Reset overrides').onClick(()=>{this.draft={...this.draft,inline:{}};this.onOpen();})).addButton(b=>b.setButtonText('Cancel').onClick(()=>this.close())).addButton(b=>b.setButtonText('Apply').setCta().onClick(()=>{this.apply(this.draft);this.close();}));
  }
}

type Destination='default'|'new'|'existing';

/** The same compact destination UI handles whole notes, selections, and typed asks. */
export class SendDestinationModal extends NoteTabPanel {
  ready:Promise<ChatDestination|undefined>=Promise.resolve(undefined);
  private revision=0;
  private opened=false;
  private defaultButton?:HTMLButtonElement;
  private defaultDisabled=false;
  private checkingDefault=false;
  private choosing=false;
  private unwatchBusy?:()=>void;
  private refreshAvailability?:()=>void;
  private overrides:JobOverrides={};
  private actions!:Setting;
  private field?:HTMLTextAreaElement;
  private projectKey?:string;
  private composing:boolean;
  private check?:{key?:string;controller:AbortController;work:Promise<ChatDestination>};
  constructor(app:App,private host:ChatHost,private prompt?:string){super(app,host.getNotePath());this.composing=prompt===undefined;this.projectKey=host.getDefaultProjectKey?.();this.overrides=host.getJobOverrides?.()??{};}
  private cancelCheck(){this.check?.controller.abort(cancelledRequest('Conversation check cancelled.'));this.check=undefined;}
  private checkDestination(key?:string){
    if(this.check&&this.check.key===key&&!this.check.controller.signal.aborted)return this.check.work;
    this.cancelCheck();const controller=new AbortController();
    const work=abortableRead(Promise.resolve().then(async()=>{if(controller.signal.aborted)throw controller.signal.reason;const destination=await this.host.getDefaultDestination!(key,controller.signal);if(!destination.unavailable&&this.host.hasNewContent&&!await this.host.hasNewContent(destination,this.prompt??''))return {...destination,empty:true};return destination;}),controller.signal)
      .catch((error):ChatDestination=>({label:'Thread unavailable',unavailable:true,detail:controller.signal.aborted&&!this.opened?'Conversation check cancelled.':error instanceof Error?error.message:'Cannot check this conversation. Reconnect T3 or choose another thread.'}));
    this.check={key,controller,work};return work;
  }
  onOpen(){
    this.opened=true;const revision=++this.revision;
    logEvent('ui.destination.opened',{notePath:this.host.getNotePath(),steering:this.host.steering,composing:this.composing,projectKey:this.projectKey});
    this.titleEl.setText(this.composing?'Message T3':'Send to T3');this.contentEl.empty();this.modalEl?.classList.add('t3-send-composer');
    const row=this.contentEl.createEl('p',{cls:'send-to-t3-destination-top'});
    const projectButton=row.createEl('button',{text:this.host.getProjectName(this.projectKey),cls:'send-to-t3-note-project',attr:{'aria-label':`Change project for this send: ${this.host.getProjectName(this.projectKey)}`,title:this.host.getTargetDescription(this.projectKey)}});
    projectButton.disabled=Boolean(this.host.busy);
    projectButton.addEventListener('click',()=>{
      if(this.field)this.prompt=this.field.value;
      new ChatProjectModal(this.app,()=>this.host.getProjectChoices(),key=>{logEvent('ui.destination.project-selected',{projectKey:key});this.projectKey=key;this.overrides.modelSelection=undefined;this.onOpen();},this.host.onProjectChange?.bind(this.host)).open();
    });
    if(this.host.loadModels&&!this.host.steering)modelButton(this.app,row,()=>this.overrides.modelSelection,()=>this.host.loadModels!(this.projectKey),selection=>{this.overrides.modelSelection=selection;});
    const count=overrideCount(this.overrides);
    const overridesButton=row.createEl('button',{text:count?`Overrides · ${count}`:'Overrides',attr:{'aria-label':`Overrides for this send: ${count} explicit choices`}});
    overridesButton.disabled=Boolean(this.host.busy);
    overridesButton.addEventListener('click',()=>{
      if(this.field)this.prompt=this.field.value;
      new JobOverridesModal(this.app,this.overrides,this.host.getInlineDefaults?.()??{enabled:false},draft=>{this.overrides=draft;this.onOpen();}).open();
    });
    const preview=this.contentEl.createEl('details',{cls:'t3-composer-context'});preview.createEl('summary',{text:`Note context · ${this.host.getNotePath().split('/').at(-1)}`});preview.createEl('pre',{text:(this.host.getPreview?.()??this.host.getNotePath()).slice(0,12000)});
    const detail=this.contentEl.createEl('p',{text:'',cls:'t3-composer-status'});
    const busyDetail=this.contentEl.createEl('p',{text:'Another send is in progress. This window will become available when it finishes.',attr:{role:'status'}});
    if(this.composing){
      this.field=this.contentEl.createEl('textarea',{cls:'send-to-t3-destination-prompt',attr:{'aria-label':'Message for T3',placeholder:'What would you like to do?',rows:'5'}});
      this.field.value=this.prompt??'';
      this.field.addEventListener('keydown',event=>{
        if(event.key==='Enter'&&(event.metaKey||event.ctrlKey)&&!event.isComposing){event.preventDefault();void this.choose('default');}
      });
    }
    else this.contentEl.createEl('p',{text:this.prompt?.trim()||'Send the current note, its new edits and supported note images.',cls:'t3-composer-hint'});
    const remembered=this.host.getDefaultThread(this.projectKey);
    const restriction=this.host.getThreadChoiceRestriction?.();
    if(restriction)this.contentEl.createEl('p',{text:restriction});
    let defaultButton:HTMLButtonElement|undefined;
    let newThreadButton:HTMLButtonElement|undefined;
    let existingThreadButton:HTMLButtonElement|undefined;
    this.actions=new Setting(this.contentEl).setClass('send-to-t3-destination-actions');
    this.ready=Promise.resolve(undefined);this.defaultDisabled=false;this.defaultButton=undefined;this.checkingDefault=false;
    if(remembered||this.host.steering)this.actions.addButton(button=>{
      defaultButton=button.buttonEl;
      this.defaultButton=defaultButton;
      button.setButtonText(this.host.steering?'Send to running thread':'Previous thread').setCta().onClick(()=>this.choose('default'));
      if(this.host.getDefaultDestination){
        this.checkingDefault=true;
        detail.setText('Checking the selected T3 conversation…');
        const started=Date.now();
        this.ready=this.checkDestination(this.projectKey).then(destination=>{
          if(this.opened&&revision===this.revision&&this.projectKey===undefined&&destination.projectKey){this.projectKey=destination.projectKey;if(this.check)this.check.key=destination.projectKey;projectButton.setText(this.host.getProjectName(this.projectKey));}
          if(this.opened&&revision===this.revision){
            this.defaultDisabled=Boolean(destination.unavailable||destination.empty);button.buttonEl.hidden=Boolean(destination.empty);button.setButtonText(destination.label).setDisabled(Boolean(this.host.busy||this.defaultDisabled||this.choosing));detail.setText(destination.empty?'':destination.detail??'');
            if(destination.empty){newThreadButton?.classList?.add('mod-cta');newThreadButton?.focus();}
            logEvent('ui.destination.checked',{notePath:this.host.getNotePath(),elapsedMs:Date.now()-started,unavailable:destination.unavailable,threadId:destination.threadId});
            if(destination.unavailable){const retry=detail.createEl('button',{text:'Retry'});retry.addEventListener('click',()=>{if(this.field)this.prompt=this.field.value;this.cancelCheck();this.onOpen();});}
          }
          return destination;
        });
      }
    });
    this.actions.addButton(button=>{
      newThreadButton=button.buttonEl;
      button.setButtonText('New thread');
      if(!defaultButton){defaultButton=button.buttonEl;button.setCta();}
      button.onClick(()=>this.choose('new'));
    });
    this.actions.addButton(button=>{existingThreadButton=button.buttonEl;button.setButtonText('Existing thread…').onClick(()=>this.choose('existing'));});
    this.refreshAvailability=()=>{
      const busy=Boolean(this.host.busy),disabled=busy||this.choosing;
      projectButton.disabled=disabled||Boolean(restriction);overridesButton.disabled=disabled;
      this.actions.setDisabled(disabled);
      if(newThreadButton){newThreadButton.hidden=Boolean(restriction);newThreadButton.disabled=disabled||Boolean(restriction);}
      if(existingThreadButton){existingThreadButton.hidden=Boolean(restriction);existingThreadButton.disabled=disabled||Boolean(restriction);}
      if(this.defaultButton)this.defaultButton.disabled=disabled||this.defaultDisabled;
      busyDetail.hidden=!busy;
    };
    this.unwatchBusy?.();
    this.unwatchBusy=this.host.onBusyChange?.(()=>{if(this.opened&&revision===this.revision)this.refreshAvailability?.();});
    this.refreshAvailability();
    if(this.field)this.field.focus();
    else clockForDocument(this.contentEl.ownerDocument).setTimeout(()=>{if(defaultButton?.isConnected)defaultButton.focus();},0);
  }
  onClose(){this.opened=false;this.unwatchBusy?.();this.unwatchBusy=undefined;this.cancelCheck();logEvent('ui.destination.closed',{notePath:this.host.getNotePath(),submitted:this.choosing});}
  private async choose(target:Destination|boolean='default'){
    if(this.choosing||this.host.busy)return;
    target=target===false?'default':target===true?'existing':target;
    if(this.field){this.prompt=this.field.value;if(!this.prompt.trim()&&this.composing&&this.host.getPreview===undefined)return;}
    logEvent('ui.destination.submitted',{notePath:this.host.getNotePath(),target,projectKey:this.projectKey,steering:this.host.steering});
    const revision=this.revision;this.choosing=true;this.refreshAvailability?.();
    const prompt=this.prompt??'';
    const resolve=()=>resolveJobOptions(this.host.getInlineDefaults?.()??{enabled:false},this.overrides);
    const returnToDraft=()=>this.open();
    let finishPreview:(()=>void)|undefined;
    try{
      // New destinations can still need a machine or workspace choice.
      // Their send path starts the preview once that choice is resolved.
      if(target==='default'&&(this.host.getDefaultThread(this.projectKey)||this.host.steering))finishPreview=this.host.beginSend?.(resolve());
      const restriction=this.host.getThreadChoiceRestriction?.();
      if(target!=='default'&&restriction)throw new RequestDeliveryError(restriction,false);
      if(target!=='default'&&this.projectKey===undefined&&this.host.steering){
        this.projectKey=this.host.getAlternativeProjectKey?.(this.projectKey);
        if(this.projectKey===undefined)throw new RequestDeliveryError('Choose a project before selecting another conversation. Your message is still ready.',false);
      }
      const checked=this.checkingDefault&&target==='default'?await this.ready:undefined;
      const destination=target==='default'?checked:undefined;
      if(!this.opened||revision!==this.revision)return;
      if(destination?.unavailable)throw new RequestDeliveryError(destination.detail??'This conversation is unavailable. Choose another thread.',false);
      if(destination?.empty){new Notice('Nothing new to send.');return;}
      this.close();
      if(target==='existing')await this.host.sendToExisting(prompt,this.projectKey,resolve,returnToDraft);
      else if(target==='new')await this.host.sendToNew(prompt,this.projectKey,resolve);
      else await this.host.sendChat(prompt,this.projectKey,resolve,undefined,destination);
    }catch(error){
      if(error instanceof ProjectCreationCancelled)return;
      logFailure('ui.destination.failed',error,{notePath:this.host.getNotePath(),target});
      new Notice(`T3 Code: ${error instanceof Error?error.message:String(error)}`,10000);
      if(!this.opened&&!(error instanceof RequestDeliveryError&&(error.requestSaved||error.terminal)))this.open();
    }finally{finishPreview?.();this.choosing=false;this.refreshAvailability?.();}
  }
}

/** Resolve the same default as the selector, without creating a panel. */
async function sendDefault(app:App,host:ChatHost,prompt:string):Promise<void>{
  const send=async()=>{
    const key=host.getDefaultProjectKey?.();
    if(!(host.hasConfirmedNoteSend?.()??Boolean(host.getDefaultThread(key)||host.steering))){
      new SendDestinationModal(app,host,prompt).open();return;
    }
    const finishPreview=host.getDefaultThread(key)||host.steering?host.beginSend?.(resolveJobOptions(host.getInlineDefaults?.()??{enabled:false},host.getJobOverrides?.())):undefined;
    try{
      const options=resolveJobOptions(host.getInlineDefaults?.()??{enabled:false},host.getJobOverrides?.());
      const resolve=()=>options;
      if(!host.getDefaultThread(key)&&!host.steering){
        if(host.hasNewContent&&!await host.hasNewContent({label:'New thread',projectKey:key},prompt)){new SendDestinationModal(app,host,prompt).open();return;}
        await host.sendToNew(prompt,key,resolve);return;
      }
      let destination:ChatDestination|undefined;
      if(host.getDefaultDestination){
        const controller=new AbortController();
        destination=await abortableRead(host.getDefaultDestination(key,controller.signal),controller.signal);
        if(destination.unavailable)throw new RequestDeliveryError(destination.detail??'This conversation is unavailable. Hold Control and send again to choose another thread.',false);
        if(host.hasNewContent&&!await host.hasNewContent(destination,prompt)){new SendDestinationModal(app,host,prompt).open();return;}
      }
      await host.sendChat(prompt,key,resolve,undefined,destination);
    }finally{finishPreview?.();}
  };
  try{
    if(host.busy)throw new RequestDeliveryError('Another send is in progress. Wait for it to finish.',false);
    if(host.runDefaultSend)await host.runDefaultSend(send);else await send();
  }catch(error){
    if(error instanceof ProjectCreationCancelled)return;
    logFailure('ui.default-send.failed',error,{notePath:host.getNotePath()});
    new Notice(`T3 Code: ${error instanceof Error?error.message:String(error)}`,10000);
  }
}

/** Both entry points preserve the note captured when the action was activated. */
export async function openChatFlow(app:App,host:ChatHost,prompt?:string,showSelector=false):Promise<void>{
  if(prompt!==undefined&&!prompt.trim())return;
  if(prompt!==undefined&&!showSelector)return sendDefault(app,host,prompt);
  const modal=new SendDestinationModal(app,host,prompt);modal.open();await modal.ready;
}
export async function openNoteSendFlow(app:App,host:ChatHost,showSelector=false):Promise<void>{
  if(showSelector){new SendDestinationModal(app,host,undefined).open();return;}
  await sendDefault(app,host,'');
}

/** The command bar remains a direct Ask surface. */
export class AskComposer extends NoteTabPanel {
  private field?:HTMLTextAreaElement;
  private sending=false;
  constructor(app:App,path:string,private draft:string,private saveDraft:(text:string)=>void,private submit:(text:string,choose:boolean)=>Promise<void>){super(app,path);}
  onOpen(){
    this.titleEl.setText('Ask agent');this.titleEl.hidden=true;this.contentEl.empty();this.modalEl?.classList.add('send-to-t3-ask-composer');
    this.field=this.contentEl.createEl('textarea',{attr:{'aria-label':'Ask agent',placeholder:'Ask agent…',rows:'3'}});this.field.value=this.draft;
    this.field.addEventListener('input',()=>{this.draft=this.field!.value;this.saveDraft(this.draft);});
    this.field.addEventListener('keydown',event=>{if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)&&!event.isComposing){event.preventDefault();void this.send(false);}});
    const actions=this.contentEl.createDiv({cls:'send-to-t3-ask-actions'});
    actions.createEl('button',{text:'Choose destination…'}).addEventListener('click',()=>void this.send(true));
    actions.createEl('button',{text:'Send',cls:'mod-cta'}).addEventListener('click',()=>void this.send(false));this.field.focus();
  }
  onClose(){if(this.field){this.draft=this.field.value;this.saveDraft(this.draft);}}
  private async send(choose:boolean){if(this.sending||!this.field?.value.trim())return;this.sending=true;this.draft=this.field.value;this.close();try{await this.submit(this.draft,choose);}catch(error){new Notice(error instanceof Error?error.message:String(error));this.open();}finally{this.sending=false;}}
}
