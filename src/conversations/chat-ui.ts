import type {ComposerActivity} from './inline-agent-edit';
import type {ThreadSummary} from './thread-target';
import {resolveJobOptions,type JobOverrides,type ResolvedJobOptions,type InlineDefaults} from './job-options';
import {logEvent,logFailure} from '../app/diagnostics';
import {App, FuzzySuggestModal, Menu, Notice, setIcon} from 'obsidian';
import {composerModelLabel,type ComposerModel} from './composer-models';
import {ComposerModelPicker} from './composer-model-picker';
import {ComposerSuggestions} from './composer-suggestions';
import {setComposerProviderIcon} from './composer-provider';
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
  status?:string;
}
export interface ChatHost {
  acceptedDestination?():ChatDestination|undefined;
  renderInlineRequests?(element:HTMLElement):(()=>void)|undefined;
  composerActivity?():ComposerActivity|undefined;
  draftChanged?(text:string):void;
  contextLabel?:string;
  chooseProject?(key:string):Promise<string>;
  chooseExisting?(projectKey:string|undefined,choose:(destination:ChatDestination)=>void,back:()=>void,signal?:AbortSignal):Promise<void>;
  searchFiles?(query:string,projectKey?:string,destination?:ChatDestination):Promise<string[]>;
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
  getDefaultDestination?(projectKey?:string,signal?:AbortSignal):Promise<ChatDestination>;
  hasNewContent?(destination:ChatDestination,prompt:string):Promise<boolean>;
  /** Captured routing metadata, not an active-turn authorization. */
  getAlternativeProjectKey?(projectKey?:string):string|undefined;
  sendChat(prompt:string,projectKey?:string,resolve?:()=>ResolvedJobOptions,returnToDraft?:()=>void,destination?:ChatDestination):Promise<void>;
  sendToNew(prompt:string,projectKey?:string,resolve?:()=>ResolvedJobOptions,returnToDraft?:()=>void):Promise<void>;
}

class ChatProjectModal extends FuzzySuggestModal<{key:string;label:string}> {
  constructor(app:App,private choices:()=>{key:string;label:string}[],private choose:(key:string)=>void|Promise<void>,private watch?:(listener:()=>void)=>()=>void){super(app);this.setPlaceholder('Choose a T3 Code project');this.emptyStateText='Discovering projects… Connect T3 if no projects appear.';}
  private unwatch?:()=>void;
  onOpen(){void super.onOpen?.();this.unwatch=this.watch?.(()=>this.inputEl?.dispatchEvent(new Event('input')));}
  onClose(){this.unwatch?.();super.onClose?.();}
  getItems(){return this.choices();}
  getItemText(item:{key:string;label:string}){return item.label;}
  onChooseItem(item:{key:string;label:string}){void this.choose(item.key);}
}

/** Explicit routing for a note send. Its captured content cannot become a composer draft. */
export class NoteSendDestination extends NoteTabPanel {
  private key?:string;
  private destination?:ChatDestination;
  private sending=false;
  private controller=new AbortController();
  constructor(app:App,private host:ChatHost,private prompt:string){super(app,host.getNotePath());this.key=host.getDefaultProjectKey?.();}
  onOpen(){
    this.titleEl.setText('Send to T3');this.contentEl.empty();
    const button=(label:string,action:()=>void)=>{const el=this.contentEl.createEl('button',{text:label,attr:{type:'button'}});el.addEventListener('click',action);return el;};
    const restriction=this.host.getThreadChoiceRestriction?.();
    button(this.host.getProjectName(this.key),()=>new ChatProjectModal(this.app,()=>this.host.getProjectChoices(),async key=>{
      this.key=await this.host.chooseProject?.(key)??key;this.destination=undefined;this.onOpen();
    }).open()).disabled=Boolean(restriction);
    button(this.destination?.label??'New thread',()=>{
      const menu=new Menu();
      menu.addItem(item=>item.setTitle('New thread').onClick(()=>{this.destination=undefined;this.onOpen();}));
      menu.addItem(item=>item.setTitle('Existing thread').onClick(()=>void this.pickExisting().catch(error=>new Notice(String(error)))));
      menu.showAtPosition({x:this.contentEl.getBoundingClientRect().left,y:this.contentEl.getBoundingClientRect().bottom});
    }).disabled=Boolean(restriction);
    button(restriction?'Send to linked thread':'Send',()=>void this.choose().catch(error=>new Notice(String(error))));
  }
  async pickExisting(){
    await this.host.chooseExisting?.(this.key,destination=>{if(!this.controller.signal.aborted){this.destination=destination;this.onOpen();}},()=>{},this.controller.signal);
  }
  async choose(){
    if(this.sending||this.host.busy)return;this.sending=true;
    try{
      const destination=this.host.getThreadChoiceRestriction?.()?await this.host.getDefaultDestination?.(this.key,this.controller.signal):this.destination;
      if(this.controller.signal.aborted)return;
      if(destination?.unavailable)throw Error(destination.detail??'Thread unavailable.');
      const options=()=>resolveJobOptions(this.host.getInlineDefaults?.()??{enabled:false});
      if(destination)await this.host.sendChat(this.prompt,this.key,options,undefined,destination);
      else await this.host.sendToNew(this.prompt,this.key,options);
      this.close();
    }catch(error){if(error instanceof RequestDeliveryError&&(error.requestSaved||error.terminal||error.deliveryUnconfirmed))this.close();throw error;}finally{this.sending=false;}
  }
  onClose(){this.controller.abort();}
}

type Destination='default'|'new'|'existing';

/** One draft and one submit action for notes, selections, questions and steering. */
export class SendComposer extends NoteTabPanel {
  ready:Promise<ChatDestination|undefined>=Promise.resolve(undefined);
  private revision=0;
  private opened=false;
  private choosing=false;
  private disposeRequests?:()=>void;
  private unwatchBusy?:()=>void;
  private refreshAvailability?:()=>void;
  private overrides:JobOverrides={};
  private field?:HTMLTextAreaElement;
  private projectKey?:string;
  private target:Destination='new';
  private destination?:ChatDestination;
  private check?:{key?:string;controller:AbortController;work:Promise<ChatDestination>};
  private models:ComposerModel[]=[];
  private modelPicker?:ComposerModelPicker;
  private modelOpening?:HTMLButtonElement;
  private picker?:AbortController;
  private suggestions?:ComposerSuggestions;
  private defaultSelection?:ModelSelection;
  private modelLoadKey?:string;
  private modelError?:string;
  private modelTask?:Promise<void>;
  modelReady:Promise<void>=Promise.resolve();
  constructor(app:App,private host:ChatHost,private prompt=''){
    super(app,host.getNotePath());
    this.projectKey=host.getDefaultProjectKey?.();
    if(host.steering||host.getThreadChoiceRestriction?.()||(host.composerActivity&&host.getDefaultThread(this.projectKey)))this.target='default';
  }
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
  private selectedModel(){const selection=this.overrides.modelSelection??this.defaultSelection;return this.models.find(model=>model.selection.instanceId===selection?.instanceId&&model.selection.model===selection?.model);}
  private resolvedOptions(){
    const command=this.prompt.trimStart().match(/^\/(\S+)/)?.[1]?.toLowerCase();
    return resolveJobOptions(this.host.getInlineDefaults?.()??{enabled:false},{...this.overrides,modelSelection:this.overrides.modelSelection??this.defaultSelection,...(command&&this.selectedModel()?.commands.some(item=>item.name.replace(/^\//,'').toLowerCase()===command)?{providerCommand:command}:{})});
  }
  private capture(){if(this.field){this.prompt=this.field.value;if(this.suggestions)this.overrides.context=this.suggestions.context();this.host.draftChanged?.(this.prompt);}}
  private async changeProject(key:string){
    if(!this.opened||this.choosing||this.host.busy)return;
    this.capture();this.choosing=true;this.refreshAvailability?.();
    try{
      const selected=this.host.chooseProject?await this.host.chooseProject(key):key;
      if(!this.opened)return;
      this.capture();this.suggestions?.dispose();this.suggestions=undefined;
      this.projectKey=selected;this.target='new';this.destination=undefined;
      this.overrides.modelSelection=undefined;this.overrides.interactionMode=undefined;this.overrides.context=undefined;
      this.models=[];this.defaultSelection=undefined;this.modelLoadKey=undefined;this.cancelCheck();
    }catch(error){if(!(error instanceof ProjectCreationCancelled))new Notice(error instanceof Error?error.message:String(error));}
    finally{this.choosing=false;if(this.opened)this.onOpen();}
  }
  onOpen(){
    this.modelPicker?.close(false);
    this.capture();this.suggestions?.dispose();this.suggestions=undefined;this.opened=true;const revision=++this.revision;
    logEvent('ui.destination.opened',{notePath:this.host.getNotePath(),steering:this.host.steering,projectKey:this.projectKey});
    this.titleEl.setText('Send composer');this.titleEl.hidden=true;this.modalEl.classList.add('t3-send-panel');this.contentEl.empty();
    this.titleEl.id||=`t3-send-title-${crypto.randomUUID()}`;this.modalEl.setAttribute('aria-labelledby',this.titleEl.id);this.modalEl.removeAttribute('aria-label');
    const composer=this.contentEl.createDiv({cls:'t3-send-composer'});
    const context=composer.createDiv({cls:'t3-send-context'});
    setIcon(context.createSpan(),'file-text');context.createSpan({text:this.host.contextLabel??this.host.getNotePath().split('/').at(-1)??'Note',cls:'t3-send-source'});
    const project=this.button(context,'Change project','folder',()=>{
      this.capture();new ChatProjectModal(this.app,()=>this.host.getProjectChoices(),key=>this.changeProject(key),this.host.onProjectChange?.bind(this.host)).open();
    },'t3-send-project');
    project.createSpan({text:this.host.getProjectName(this.projectKey)});setIcon(project.createSpan(),'chevron-down');project.title=this.host.getTargetDescription(this.projectKey);
    const promptName=composer.createSpan({text:'Ask about this note or selection',attr:{id:`t3-send-prompt-${crypto.randomUUID()}`,hidden:''}});
    this.field=composer.createEl('textarea',{cls:'t3-send-input',attr:{'aria-labelledby':promptName.id,placeholder:'Ask anything. @ files, $ skills, / commands',rows:'2'}});this.field.value=this.prompt;
    this.suggestions=new ComposerSuggestions(this.field,composer,{action:name=>{if(name==='model')void this.chooseModel(model);else{this.overrides.interactionMode=name==='plan'?'plan':'default';this.refreshAvailability?.();new Notice(name==='plan'?'Plan mode enabled':'Normal mode enabled');}},catalog:async()=>{await this.modelReady;return {model:this.selectedModel()};},files:query=>this.host.searchFiles?.(query,this.projectKey,this.target==='new'?undefined:this.destination)??Promise.resolve([]),changed:()=>{this.overrides.context=this.suggestions?.context();this.capture();this.refreshAvailability?.();}},this.overrides.context);
    this.field.addEventListener('input',()=>{this.capture();this.refreshAvailability?.();});
    this.field.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();void this.choose();}});
    const activity=this.host.composerActivity?composer.createDiv({cls:'t3-composer-activity'}):undefined;
    const runStatus=activity?.createDiv({cls:'t3-composer-status',attr:{role:'status'}});
    this.disposeRequests?.();this.disposeRequests=undefined;
    const requests=activity?.createDiv();let requestKey='';
    const events=activity?.createDiv({cls:'t3-composer-events'});
    const controls=composer.createDiv({cls:'t3-send-controls'});
    const options=controls.createDiv({cls:'t3-send-options'});
    const resolved=()=>resolveJobOptions(this.host.getInlineDefaults?.()??{enabled:false},this.overrides);
    const streaming=this.button(options,'Stream replies into the editor','text-cursor-input',()=>{this.overrides.inline={...this.overrides.inline,enabled:!resolved().inline.enabled};this.refreshAvailability?.();},'t3-send-streaming');streaming.setAttribute('role','switch');if(this.host.composerActivity)streaming.classList.add('t3-composer-mode');const streamingLabel=streaming.createSpan();
    const streamingName=options.createSpan({text:this.host.composerActivity?'Composer mode':'Stream replies into the editor',attr:{id:`t3-send-streaming-${crypto.randomUUID()}`,hidden:''}});streaming.setAttribute('aria-labelledby',streamingName.id);streaming.removeAttribute('aria-label');streaming.removeAttribute('title');
    const format=this.button(options,'Final answer format','quote',()=>{this.overrides.inline={...this.overrides.inline,finalAnswerFormat:resolved().inline.finalAnswerFormat==='formatted'?'raw-markdown':'formatted'};this.refreshAvailability?.();},'t3-send-format');format.createSpan();
    // Obsidian turns aria-label into a hover tooltip. A referenced name keeps
    // this control accessible without covering its expanding visible label.
    const formatName=options.createSpan({attr:{id:`t3-send-format-${crypto.randomUUID()}`,hidden:''}});format.setAttribute('aria-labelledby',formatName.id);format.removeAttribute('aria-label');format.removeAttribute('title');
    const actions=controls.createDiv({cls:'t3-send-actions'});
    const model=this.button(actions,'Choose model','bot',()=>{void this.chooseModel(model);},'t3-send-model');
    model.empty();const providerIcon=model.createSpan({cls:'t3-send-provider'}),modelLabel=model.createSpan();setIcon(model.createSpan(),'chevron-down');
    const thread=this.button(actions,'Choose thread','message-circle',()=>{
      const menu=new Menu();
      menu.addItem(item=>item.setTitle('New thread').setIcon('plus').setChecked(this.target==='new').onClick(()=>this.select('new')));
      if(this.host.getDefaultThread(this.projectKey)||this.host.steering)menu.addItem(item=>item.setTitle('Previous thread').setIcon('history').setChecked(this.target==='default').onClick(()=>this.select('default')));
      menu.addItem(item=>item.setTitle('Existing thread…').setIcon('messages-square').onClick(()=>{void this.pickExisting();}));const rect=thread.getBoundingClientRect();menu.showAtPosition({x:rect.left,y:rect.bottom});
    },'t3-send-thread');
    thread.empty();const threadIcon=thread.createSpan({cls:'t3-send-thread-icon'});setIcon(threadIcon,'message-circle');const threadLabel=thread.createSpan();setIcon(thread.createSpan(),'chevron-down');
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
      const run=this.host.composerActivity?.();
      if(activity&&runStatus&&events){activity.hidden=!run;runStatus.setText(run?.status??'');const log=run?.lines.join('\n')??'';if(events.textContent!==log){events.setText(log);events.scrollTop=events.scrollHeight;}}
      if(requests&&requestKey!==(run?.requestKey??'')){this.disposeRequests?.();requests.empty();this.disposeRequests=this.host.renderInlineRequests?.(requests);requestKey=run?.requestKey??'';}
      const selection=this.overrides.modelSelection??this.defaultSelection;
      modelLabel.setText(selection?composerModelLabel(selection,this.models):this.modelError?'Model unavailable':'Loading model…');
      setComposerProviderIcon(providerIcon,this.models.find(item=>item.selection.instanceId===selection?.instanceId&&item.selection.model===selection?.model)?.driver);
      model.title=this.modelError??[modelLabel.textContent,this.overrides.interactionMode==='plan'?'Plan mode':undefined].filter(Boolean).join(' · ');model.setAttribute('aria-description',model.title);
      if(disabled)this.modelPicker?.close(false);
      project.disabled=thread.disabled=disabled||Boolean(run?.running)||Boolean(this.host.getThreadChoiceRestriction?.());model.disabled=disabled||Boolean(run?.running)||!this.host.getModels;
      streaming.disabled=disabled||continuing||Boolean(run?.running);streaming.setAttribute('aria-checked',String(inline.enabled));streamingLabel.setText(this.host.composerActivity?(run?.running||!inline.enabled?'Inline agent':'Editor stream'):`Stream replies into note: ${inline.enabled?'On':'Off'}`);streaming.setAttribute('aria-description',continuing?'This running response keeps its streaming choices':streamingLabel.textContent??'');
      format.disabled=disabled||continuing||!inline.enabled;const formatLabel=inline.finalAnswerFormat==='formatted'?'Quoted Markdown':'Raw Markdown';
      if(format.dataset.format!==inline.finalAnswerFormat){format.dataset.format=inline.finalAnswerFormat;format.empty();setIcon(format,inline.finalAnswerFormat==='formatted'?'quote':'code');format.createSpan();}
      format.querySelector('span')!.setText(formatLabel);formatName.setText(`Final answer format: ${formatLabel}`);
      threadLabel.setText(this.target==='new'?'New thread':this.destination?.label??'Previous thread');
      const status=this.destination?.status??this.destination?.detail?.match(/ · (Idle|Active|Running|Waiting)\b/)?.[1];thread.dataset.state=this.target==='new'?'new':this.destination?.unavailable?'unavailable':status?.toLowerCase()??'idle';setIcon(threadIcon,status&&['Active','Running'].includes(status)?'loader-circle':'message-circle');
      thread.title=this.target==='new'?'Send to a new thread':this.destination?.unavailable?this.destination.detail??'Thread unavailable':[threadLabel.textContent,status].filter(Boolean).join(' · ');thread.setAttribute('aria-description',status??'');
      send.disabled=disabled||Boolean(this.host.composerActivity&&!this.prompt.trim())||!run?.running&&this.target!=='new'&&Boolean(this.destination?.unavailable);
      const label=run?.running?'Steer run':this.host.composerActivity?'Send message':this.prompt.trim()?'Send ask':'Send context';send.setAttribute('aria-label',label);send.title=label;
      this.field!.readOnly=disabled;busyDetail.hidden=!this.host.busy;
      detail.setText(restriction??(this.destination?.unavailable?this.destination.detail??'Thread unavailable':''));detail.hidden=!detail.textContent;
    };
    this.unwatchBusy?.();this.unwatchBusy=this.host.onBusyChange?.(()=>{if(this.opened&&revision===this.revision)this.refreshAvailability?.();});this.refreshAvailability();this.modelReady=this.loadModels(revision);this.field.focus();
  }
  private select(target:Destination,destination?:ChatDestination){
    if(!this.opened||this.choosing||this.host.busy)return;
    this.capture();this.target=target;this.destination=destination;this.cancelCheck();this.onOpen();
  }
  private async loadModels(revision:number){
    if(!this.host.getModels)return;
    const destination=this.target==='default'?await this.ready:this.destination;
    if(!this.opened||revision!==this.revision)return;
    const key=JSON.stringify([this.projectKey,this.target,destination?.threadId]);
    if(this.modelLoadKey!==key){
      this.modelLoadKey=key;this.modelError=undefined;this.models=[];this.defaultSelection=undefined;
      this.modelTask=this.host.getModels(this.projectKey,this.target==='new'?undefined:destination).then(result=>{
        if(!this.opened||this.modelLoadKey!==key)return;
        this.models=result.models;this.defaultSelection=result.selection;
        if(!this.defaultSelection&&!this.overrides.modelSelection)this.modelError='T3 did not return the selected model.';
      }).catch(error=>{if(this.opened&&this.modelLoadKey===key){this.modelError=error instanceof Error?error.message:String(error);this.modelLoadKey=undefined;}});
    }
    await this.modelTask;if(this.opened&&revision===this.revision)this.refreshAvailability?.();
  }
  private async chooseModel(anchor:HTMLButtonElement){
    if(this.modelPicker){this.modelPicker.close();return;}
    if(this.choosing||this.host.busy||!this.host.getModels||this.modelOpening===anchor)return;
    const revision=this.revision;this.modelOpening=anchor;this.capture();
    try{
      if(this.modelError&&!this.models.length){this.modelLoadKey=undefined;this.modelReady=this.loadModels(revision);}
      await this.modelReady;
      if(!this.opened||revision!==this.revision||!anchor.isConnected||anchor.disabled)return;
      if(!this.models.length)throw Error(this.modelError??'No models are available on this T3 machine.');
      this.modelPicker=new ComposerModelPicker(anchor,this.models,{modelSelection:this.overrides.modelSelection??this.defaultSelection},async settings=>{
        this.overrides.modelSelection=settings.modelSelection;
        this.refreshAvailability?.();
      },()=>{this.modelPicker=undefined;},{defaultSelection:this.defaultSelection});
      this.modelPicker.open();
    }catch(error){
      this.modelPicker?.close(false);
      new Notice(`T3 Code: ${error instanceof Error?error.message:String(error)}`);
    }finally{if(this.modelOpening===anchor)this.modelOpening=undefined;}
  }
  private async pickExisting(){
    if(this.choosing||this.host.busy||this.host.getThreadChoiceRestriction?.()||!this.host.chooseExisting)return;
    this.capture();if(this.projectKey===undefined&&this.host.steering)this.projectKey=this.host.getAlternativeProjectKey?.();
    const revision=this.revision;this.picker?.abort();const controller=this.picker=new AbortController();this.choosing=true;this.refreshAvailability?.();
    try{await this.host.chooseExisting(this.projectKey,destination=>{if(this.opened&&revision===this.revision){this.choosing=false;this.select('existing',destination);}},()=>this.field?.focus(),controller.signal);}
    catch(error){new Notice(`T3 Code: ${error instanceof Error?error.message:String(error)}`);}
    finally{this.choosing=false;this.refreshAvailability?.();}
  }
  onClose(){this.disposeRequests?.();this.disposeRequests=undefined;this.modelPicker?.close(false);this.picker?.abort();this.capture();this.suggestions?.dispose();this.suggestions=undefined;this.opened=false;this.unwatchBusy?.();this.unwatchBusy=undefined;this.cancelCheck();logEvent('ui.destination.closed',{notePath:this.host.getNotePath(),submitted:this.choosing});}
  private clearMessage(){this.prompt='';if(this.field)this.field.value='';this.host.draftChanged?.('');}
  private async choose(){
    if(this.choosing||this.host.busy||!this.opened)return;
    this.capture();if(this.host.composerActivity&&!this.prompt.trim())return;
    const steer=this.host.composerActivity?.()?.running;
    const target=this.target,revision=this.revision;this.choosing=true;this.refreshAvailability?.();
    const resolve=()=>this.resolvedOptions();
    let finishPreview:(()=>void)|undefined;let finishPreparing:(()=>void)|undefined;
    try{
      if(steer){await this.host.sendChat(this.prompt,this.projectKey,resolve);this.clearMessage();return;}
      finishPreparing=this.host.beginPreparing?.();
      if(target!=='new')finishPreview=this.host.beginSend?.(resolve());
      await this.modelReady;
      if(this.modelError&&!this.overrides.modelSelection)throw Error(this.modelError);
      const restriction=this.host.getThreadChoiceRestriction?.();if(target!=='default'&&restriction)throw new RequestDeliveryError(restriction,false);
      if(target!=='default'&&this.projectKey===undefined&&this.host.steering){this.projectKey=this.host.getAlternativeProjectKey?.();if(this.projectKey===undefined)throw Error('Choose a project before selecting another conversation.');}
      const destination=target==='default'?await this.ready:this.destination;
      if(!this.opened||revision!==this.revision)return;
      if(target!=='new'&&(!destination||destination.unavailable))throw Error(destination?.detail??'Choose an available thread.');
      if(!this.prompt.trim()&&target!=='new'&&this.host.hasNewContent&&!await this.host.hasNewContent(destination!,this.prompt)){new Notice('Nothing new to send.');return;}
      if(!this.opened||revision!==this.revision)return;
      const keepOpen=Boolean(this.host.composerActivity&&!resolve().inline.enabled);
      if(!keepOpen)this.close();
      if(target==='new')await this.host.sendToNew(this.prompt,this.projectKey,resolve);
      else await this.host.sendChat(this.prompt,this.projectKey,resolve,undefined,{...destination!,preparation:undefined});
      if(keepOpen){
        this.clearMessage();const accepted=this.host.acceptedDestination?.();
        if(accepted){this.target=this.host.getThreadChoiceRestriction?.()?'default':'existing';this.projectKey=accepted.projectKey;this.destination=accepted;this.ready=Promise.resolve(accepted);}
      }
    }catch(error){
      if(!(error instanceof ProjectCreationCancelled)){logFailure('ui.destination.failed',error,{notePath:this.host.getNotePath(),target});new Notice(`T3 Code: ${error instanceof Error?error.message:String(error)}`,10000);}
      if(!this.opened&&!(error instanceof RequestDeliveryError&&(error.requestSaved||error.terminal)))this.open();
    }finally{finishPreview?.();finishPreparing?.();this.choosing=false;this.refreshAvailability?.();}
  }
}

/** Resolve the same default as the selector, without creating a panel. */
async function sendDefault(app:App,host:ChatHost,prompt:string):Promise<void>{
  const send=async()=>{
    const key=host.getDefaultProjectKey?.();
    const finishPreparing=host.beginPreparing?.();
    let finishPreview:(()=>void)|undefined;
    try{
      finishPreview=host.getDefaultThread(key)||host.steering?host.beginSend?.(resolveJobOptions(host.getInlineDefaults?.()??{enabled:false})):undefined;
      const options=resolveJobOptions(host.getInlineDefaults?.()??{enabled:false});
      const resolve=()=>options;
      if(!host.getDefaultThread(key)&&!host.steering){
        if(host.hasNewContent&&!await host.hasNewContent({label:'New thread',projectKey:key},prompt)){new Notice('Nothing new to send.');return;}
        await host.sendToNew(prompt,key,resolve);return;
      }
      let destination:ChatDestination|undefined;
      if(host.getDefaultDestination){
        const controller=new AbortController();
        destination=await abortableRead(host.getDefaultDestination(key,controller.signal),controller.signal);
        if(destination.unavailable)throw new RequestDeliveryError(destination.detail??'This conversation is unavailable. Hold Control and send again to choose another thread.',false);
        if(host.hasNewContent&&!await host.hasNewContent(destination,prompt)){new Notice('Nothing new to send.');return;}
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
  if(showSelector){new NoteSendDestination(app,host,prompt??'').open();return;}
  const modal=new SendComposer(app,host,prompt);modal.open();await modal.ready;
}
export async function openNoteSendFlow(app:App,host:ChatHost,showSelector=false):Promise<void>{
  if(showSelector){new NoteSendDestination(app,host,'').open();return;}
  await sendDefault(app,host,'');
}
