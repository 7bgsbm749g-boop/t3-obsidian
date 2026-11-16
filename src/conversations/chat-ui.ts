import type {ThreadSummary} from './thread-target';
import {resolveJobOptions,type JobOverrides,type ResolvedJobOptions,type InlineDefaults} from './job-options';
import {logEvent,logFailure} from '../app/diagnostics';
import {App, FuzzySuggestModal, Menu, Modal, Notice, Setting, setIcon} from 'obsidian';
import {composerModelLabel,type ComposerModel} from './composer-models';
import type {ModelSelection} from './model-defaults';
import {NoteTabPanel} from '../notes/note-tab-panel';
import {RequestDeliveryError} from '../app/bridge';
import {ProjectCreationCancelled} from '../projects/project-create-ui';
import {abortableRead,cancelledRequest} from '../connection/t3-api';


/** Display/preparation evidence only. Dispatch always reads authoritative control. */
export interface SendPreparation {connectionId?:string;environmentId?:string;thread:Pick<ThreadSummary,'id'|'projectId'|'title'|'archivedAt'|'deletedAt'>}
export interface ChatDestination {
  preparation?:SendPreparation;
  threadId?:string;
  responseId?:string;
  projectKey?:string;
  label:string;
  unavailable?:boolean;
  empty?:boolean;
  detail?:string;
}
export interface ChatHost {
  draftChanged?(text:string):void;
  contextLabel?:string;
  chooseExisting?(projectKey:string|undefined,choose:(destination:ChatDestination)=>void,back:()=>void,signal?:AbortSignal):Promise<void>;
  getModels?(projectKey?:string,destination?:ChatDestination):Promise<{models:ComposerModel[];selection?:ModelSelection}>;
  getThreadChoiceRestriction?():string|undefined;
  steering?:boolean;
  getInlineDefaults?():InlineDefaults;
  busy?:boolean;
  onBusyChange?(listener:()=>void):()=>void;
  runDefaultSend?(send:()=>Promise<void>):Promise<void>;
  beginSend?(options:ResolvedJobOptions):()=>void;
  /** Submission feedback; does not imply a destination or dispatch. */
  beginPreparing?():()=>void;
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

/** The model draft uses only capabilities advertised by the selected T3 machine. */
class SendModelModal extends Modal {
  private selection?:ModelSelection;
  constructor(app:App,private models:ComposerModel[],selection:ModelSelection|undefined,private apply:(selection:ModelSelection|undefined)=>void,private defaultLabel='Use T3 default'){super(app);this.selection=selection?structuredClone(selection):undefined;}
  onOpen(){
    this.titleEl.setText('Model for this send');this.contentEl.empty();
    new Setting(this.contentEl).setName('Model').addDropdown(dropdown=>{
      dropdown.addOption('',this.defaultLabel);
      this.models.forEach((model,index)=>dropdown.addOption(String(index),`${model.provider} · ${model.label}`));
      const index=this.models.findIndex(model=>model.selection.instanceId===this.selection?.instanceId&&model.selection.model===this.selection.model);
      dropdown.setValue(index<0?'':String(index)).onChange(value=>{this.selection=value===''?undefined:{...this.models[Number(value)].selection};this.onOpen();});
    });
    const model=this.models.find(model=>model.selection.instanceId===this.selection?.instanceId&&model.selection.model===this.selection.model);
    for(const option of model?.options??[]){
      const saved=this.selection?.options?.find(value=>value.id===option.id)?.value??option.currentValue;
      const change=(value:string|boolean|undefined)=>{const selection=this.selection!;selection.options=[...(selection.options??[]).filter(item=>item.id!==option.id),...(value===undefined?[]:[{id:option.id,value}])];};
      const setting=new Setting(this.contentEl).setName(option.label);
      if(option.type==='boolean')setting.addToggle(toggle=>toggle.setValue(saved===true).onChange(change));
      else setting.addDropdown(dropdown=>{dropdown.addOption('','Use default');for(const choice of option.options)dropdown.addOption(choice.id,choice.label);dropdown.setValue(typeof saved==='string'?saved:'').onChange(value=>change(value||undefined));});
    }
    new Setting(this.contentEl).addButton(button=>button.setButtonText('Cancel').onClick(()=>this.close())).addButton(button=>button.setButtonText('Apply').setCta().onClick(()=>{this.apply(this.selection);this.close();}));
  }
}

type Destination='default'|'new'|'existing';

/** One draft and one submit action for notes, selections, questions and steering. */
export class SendComposer extends NoteTabPanel {
  ready:Promise<ChatDestination|undefined>=Promise.resolve(undefined);
  private revision=0;
  private opened=false;
  private choosing=false;
  private unwatchBusy?:()=>void;
  private refreshAvailability?:()=>void;
  private overrides:JobOverrides={};
  private field?:HTMLTextAreaElement;
  private projectKey?:string;
  private target:Destination='new';
  private destination?:ChatDestination;
  private check?:{key?:string;controller:AbortController;work:Promise<ChatDestination>};
  private models:ComposerModel[]=[];
  private picker?:AbortController;
  constructor(app:App,private host:ChatHost,private prompt=''){super(app,host.getNotePath());this.projectKey=host.getDefaultProjectKey?.();if(host.steering||host.getThreadChoiceRestriction?.())this.target='default';}
  private cancelCheck(){this.check?.controller.abort(cancelledRequest('Conversation check cancelled.'));this.check=undefined;}
  private checkDestination(){
    const key=this.projectKey;
    if(this.check&&this.check.key===key&&!this.check.controller.signal.aborted)return this.check.work;
    this.cancelCheck();const controller=new AbortController();
    const work=abortableRead(Promise.resolve().then(()=>{if(controller.signal.aborted)throw controller.signal.reason;return this.host.getDefaultDestination!(key,controller.signal);}),controller.signal)
      .catch((error):ChatDestination=>({label:'Thread unavailable',unavailable:true,detail:error instanceof Error?error.message:'Cannot check this conversation. Choose another thread.'}));
    this.check={key,controller,work};return work;
  }
  private button(parent:HTMLElement,label:string,icon:string,run:()=>void,cls=''){
    const button=parent.createEl('button',{cls:`clickable-icon t3-send-control ${cls}`,attr:{type:'button','aria-label':label,title:label}});setIcon(button,icon);button.addEventListener('click',run);return button;
  }
  private capture(){if(this.field){this.prompt=this.field.value;this.host.draftChanged?.(this.prompt);}}
  onOpen(){
    this.capture();this.opened=true;const revision=++this.revision;
    logEvent('ui.destination.opened',{notePath:this.host.getNotePath(),steering:this.host.steering,projectKey:this.projectKey});
    this.titleEl.setText('Send composer');this.titleEl.hidden=true;this.modalEl.classList.add('t3-send-panel');this.contentEl.empty();
    const composer=this.contentEl.createDiv({cls:'t3-send-composer'});
    const context=composer.createDiv({cls:'t3-send-context'});
    setIcon(context.createSpan(),'file-text');context.createSpan({text:this.host.contextLabel??this.host.getNotePath().split('/').at(-1)??'Note',cls:'t3-send-source'});
    const project=this.button(context,'Change project','folder',()=>{
      this.capture();new ChatProjectModal(this.app,()=>this.host.getProjectChoices(),key=>{if(!this.opened||this.choosing)return;this.projectKey=key;this.target='new';this.destination=undefined;this.overrides.modelSelection=undefined;this.models=[];this.cancelCheck();this.onOpen();},this.host.onProjectChange?.bind(this.host)).open();
    },'t3-send-project');
    project.createSpan({text:this.host.getProjectName(this.projectKey)});setIcon(project.createSpan(),'chevron-down');project.title=this.host.getTargetDescription(this.projectKey);
    this.field=composer.createEl('textarea',{cls:'t3-send-input',attr:{'aria-label':'Ask about this note or selection',placeholder:'Ask about this context, or leave empty to send it…',rows:'3'}});this.field.value=this.prompt;
    this.field.addEventListener('input',()=>{this.capture();this.refreshAvailability?.();});
    this.field.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();void this.choose();}});
    const controls=composer.createDiv({cls:'t3-send-controls'});
    const options=controls.createDiv({cls:'t3-send-options'});
    const resolved=()=>resolveJobOptions(this.host.getInlineDefaults?.()??{enabled:false},this.overrides);
    const streaming=this.button(options,'Stream replies into the editor','text-cursor-input',()=>{this.overrides.inline={...this.overrides.inline,enabled:!resolved().inline.enabled};this.refreshAvailability?.();});streaming.setAttribute('role','switch');
    const format=this.button(options,'Final answer format','pilcrow',()=>{this.overrides.inline={...this.overrides.inline,finalAnswerFormat:resolved().inline.finalAnswerFormat==='formatted'?'raw-markdown':'formatted'};this.refreshAvailability?.();},'t3-send-format');format.createSpan();
    const actions=controls.createDiv({cls:'t3-send-actions'});
    const model=this.button(actions,'Choose model','sparkles',()=>{void this.chooseModel();},'t3-send-model');
    model.createSpan({text:this.overrides.modelSelection?composerModelLabel(this.overrides.modelSelection,this.models):this.target==='new'?'T3 default':'Thread model'});setIcon(model.createSpan(),'chevron-down');
    const thread=this.button(actions,'Choose thread','message-circle',()=>{
      const menu=new Menu();
      menu.addItem(item=>item.setTitle('New thread').setIcon('plus').setChecked(this.target==='new').onClick(()=>this.select('new')));
      if(this.host.getDefaultThread(this.projectKey)||this.host.steering)menu.addItem(item=>item.setTitle('Previous thread').setIcon('history').setChecked(this.target==='default').onClick(()=>this.select('default')));
      menu.addItem(item=>item.setTitle('Existing thread…').setIcon('messages-square').onClick(()=>{void this.pickExisting();}));const rect=thread.getBoundingClientRect();menu.showAtPosition({x:rect.left,y:rect.bottom});
    },'t3-send-thread');
    const threadLabel=thread.createSpan();setIcon(thread.createSpan(),'chevron-down');
    const send=this.button(actions,'Send context','arrow-up',()=>{void this.choose();},'t3-send-submit');
    const detail=this.contentEl.createDiv({cls:'t3-send-detail',attr:{role:'status','aria-live':'polite'}});
    const busyDetail=this.contentEl.createDiv({cls:'t3-send-detail',text:'Another send is in progress. This composer will become available when it finishes.',attr:{role:'status'}});
    const restriction=this.host.getThreadChoiceRestriction?.();
    this.ready=Promise.resolve(this.destination);
    if(this.target==='default'&&this.host.getDefaultDestination){
      this.ready=this.checkDestination().then(destination=>{
        if(this.opened&&revision===this.revision){
          if(this.projectKey===undefined&&destination.projectKey){this.projectKey=destination.projectKey;if(this.check)this.check.key=destination.projectKey;project.querySelector('span')!.setText(this.host.getProjectName(this.projectKey));project.title=this.host.getTargetDescription(this.projectKey);}
          this.destination={...destination,preparation:undefined};this.refreshAvailability?.();
        }
        return destination;
      });
    }
    this.refreshAvailability=()=>{
      const disabled=Boolean(this.host.busy||this.choosing),inline=resolved().inline,continuing=Boolean(this.target==='default'&&this.destination?.responseId);
      project.disabled=disabled||Boolean(restriction);thread.disabled=disabled||Boolean(restriction);model.disabled=disabled||!this.host.getModels;
      streaming.disabled=disabled||continuing;streaming.setAttribute('aria-checked',String(inline.enabled));streaming.title=continuing?'This running response keeps its streaming choices':`Stream replies into the editor: ${inline.enabled?'On':'Off'}`;
      format.disabled=disabled||continuing||!inline.enabled;const formatLabel=inline.finalAnswerFormat==='formatted'?'Quoted Markdown':'Raw Markdown';format.querySelector('span')!.setText(formatLabel);format.title=`Final answer format: ${formatLabel}`;format.setAttribute('aria-label',format.title);
      threadLabel.setText(this.target==='new'?'New thread':this.destination?.label??'Previous thread');
      thread.title=this.target==='new'?'Send to a new thread':this.destination?.detail??threadLabel.textContent??'';
      send.disabled=disabled||this.target!=='new'&&Boolean(this.destination?.unavailable);
      const label=this.prompt.trim()?'Send ask':'Send context';send.setAttribute('aria-label',label);send.title=label;
      this.field!.readOnly=disabled;busyDetail.hidden=!this.host.busy;
      detail.setText(restriction??(this.target!=='new'?(this.destination?.detail??'Checking selected conversation…'):''));detail.hidden=!detail.textContent;
    };
    this.unwatchBusy?.();this.unwatchBusy=this.host.onBusyChange?.(()=>{if(this.opened&&revision===this.revision)this.refreshAvailability?.();});this.refreshAvailability();this.field.focus();
  }
  private select(target:Destination,destination?:ChatDestination){
    if(!this.opened||this.choosing||this.host.busy)return;
    this.capture();this.target=target;this.destination=destination;this.cancelCheck();this.onOpen();
  }
  private async chooseModel(){
    if(this.choosing||this.host.busy||!this.host.getModels)return;
    const revision=this.revision;this.capture();
    try{
      const destination=this.target==='default'?await this.ready:this.destination;
      if(!this.opened||revision!==this.revision)return;
      if(destination?.unavailable)throw Error(destination.detail??'Choose an available thread.');
      const result=await this.host.getModels(this.projectKey,this.target==='new'?undefined:destination);
      if(!this.opened||revision!==this.revision)return;this.models=result.models;
      if(!this.models.length)throw Error('No models are available on this T3 machine. Check its provider settings.');
      new SendModelModal(this.app,this.models,this.overrides.modelSelection??result.selection,selection=>{if(!this.opened||revision!==this.revision||this.choosing)return;this.overrides.modelSelection=selection;this.onOpen();},this.target==='new'?'Use T3 default':'Keep thread model').open();
    }catch(error){new Notice(`T3 Code: ${error instanceof Error?error.message:String(error)}`);}
  }
  private async pickExisting(){
    if(this.choosing||this.host.busy||this.host.getThreadChoiceRestriction?.()||!this.host.chooseExisting)return;
    this.capture();if(this.projectKey===undefined&&this.host.steering)this.projectKey=this.host.getAlternativeProjectKey?.();
    const revision=this.revision;this.picker?.abort();const controller=this.picker=new AbortController();this.choosing=true;this.refreshAvailability?.();
    try{await this.host.chooseExisting(this.projectKey,destination=>{if(this.opened&&revision===this.revision){this.choosing=false;this.select('existing',destination);}},()=>this.field?.focus(),controller.signal);}
    catch(error){new Notice(`T3 Code: ${error instanceof Error?error.message:String(error)}`);}
    finally{this.choosing=false;this.refreshAvailability?.();}
  }
  onClose(){this.picker?.abort();this.capture();this.opened=false;this.unwatchBusy?.();this.unwatchBusy=undefined;this.cancelCheck();logEvent('ui.destination.closed',{notePath:this.host.getNotePath(),submitted:this.choosing});}
  private async choose(){
    if(this.choosing||this.host.busy||!this.opened)return;
    this.capture();const target=this.target,revision=this.revision;this.choosing=true;this.refreshAvailability?.();
    const resolve=()=>resolveJobOptions(this.host.getInlineDefaults?.()??{enabled:false},this.overrides);
    let finishPreview:(()=>void)|undefined;let finishPreparing:(()=>void)|undefined;
    try{
      finishPreparing=this.host.beginPreparing?.();
      if(target!=='new')finishPreview=this.host.beginSend?.(resolve());
      const restriction=this.host.getThreadChoiceRestriction?.();if(target!=='default'&&restriction)throw new RequestDeliveryError(restriction,false);
      if(target!=='default'&&this.projectKey===undefined&&this.host.steering){this.projectKey=this.host.getAlternativeProjectKey?.();if(this.projectKey===undefined)throw Error('Choose a project before selecting another conversation.');}
      const destination=target==='default'?await this.ready:this.destination;
      if(!this.opened||revision!==this.revision)return;
      if(target!=='new'&&(!destination||destination.unavailable))throw Error(destination?.detail??'Choose an available thread.');
      if(!this.prompt.trim()&&target!=='new'&&this.host.hasNewContent&&!await this.host.hasNewContent(destination!,this.prompt)){new Notice('Nothing new to send.');return;}
      if(!this.opened||revision!==this.revision)return;
      this.close();
      if(target==='new')await this.host.sendToNew(this.prompt,this.projectKey,resolve);
      else await this.host.sendChat(this.prompt,this.projectKey,resolve,undefined,{...destination!,preparation:undefined});
    }catch(error){
      if(error instanceof ProjectCreationCancelled)return;
      logFailure('ui.destination.failed',error,{notePath:this.host.getNotePath(),target});new Notice(`T3 Code: ${error instanceof Error?error.message:String(error)}`,10000);
      if(!this.opened&&!(error instanceof RequestDeliveryError&&(error.requestSaved||error.terminal)))this.open();
    }finally{finishPreview?.();finishPreparing?.();this.choosing=false;this.refreshAvailability?.();}
  }
}

/** Resolve the same default as the selector, without creating a panel. */
async function sendDefault(app:App,host:ChatHost,prompt:string):Promise<void>{
  const send=async()=>{
    const key=host.getDefaultProjectKey?.();
    if(!(host.hasConfirmedNoteSend?.()??Boolean(host.getDefaultThread(key)||host.steering))){
      new SendComposer(app,host,prompt).open();return;
    }
    const finishPreparing=host.beginPreparing?.();
    let finishPreview:(()=>void)|undefined;
    try{
      finishPreview=host.getDefaultThread(key)||host.steering?host.beginSend?.(resolveJobOptions(host.getInlineDefaults?.()??{enabled:false})):undefined;
      const options=resolveJobOptions(host.getInlineDefaults?.()??{enabled:false});
      const resolve=()=>options;
      if(!host.getDefaultThread(key)&&!host.steering){
        if(host.hasNewContent&&!await host.hasNewContent({label:'New thread',projectKey:key},prompt)){new SendComposer(app,host,prompt).open();return;}
        await host.sendToNew(prompt,key,resolve);return;
      }
      let destination:ChatDestination|undefined;
      if(host.getDefaultDestination){
        const controller=new AbortController();
        destination=await abortableRead(host.getDefaultDestination(key,controller.signal),controller.signal);
        if(destination.unavailable)throw new RequestDeliveryError(destination.detail??'This conversation is unavailable. Hold Control and send again to choose another thread.',false);
        if(host.hasNewContent&&!await host.hasNewContent(destination,prompt)){new SendComposer(app,host,prompt).open();return;}
      }
      await host.sendChat(prompt,key,resolve,undefined,destination);
    }finally{finishPreview?.();finishPreparing?.();}
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
  const modal=new SendComposer(app,host,prompt);modal.open();await modal.ready;
}
export async function openNoteSendFlow(app:App,host:ChatHost,showSelector=false):Promise<void>{
  if(showSelector){new SendComposer(app,host,'').open();return;}
  await sendDefault(app,host,'');
}
