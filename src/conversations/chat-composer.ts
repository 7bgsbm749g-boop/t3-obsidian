import {Component,FuzzySuggestModal,Modal,Notice,Setting,setIcon,type App} from 'obsidian';
import type {OutgoingAttachment,OutgoingContext} from '../connection/send-contracts';
import {composerModelLabel,type ComposerModel,type ComposerSettings} from './composer-models';
import type {RuntimeMode} from './model-defaults';
import {clockForDocument,type TimerHandle} from '../shared/clock';
import {renderProviderIcon} from './provider-icons';

export interface ComposerHost {uuid():string;changed(text:string):void;send():Promise<void>;stop():Promise<void>;models():Promise<ComposerModel[]>;configure(settings:ComposerSettings):Promise<void>;files(query:string):Promise<string[]>}
class ModelChoice extends FuzzySuggestModal<ComposerModel>{
 constructor(app:App,private choices:ComposerModel[],private choose:(model:ComposerModel)=>void){super(app);this.setPlaceholder('Choose provider and model');}
 getItems(){return this.choices;}getItemText(model:ComposerModel){return `${model.provider} · ${model.label}`;}onChooseItem(model:ComposerModel){this.choose(model);}
}
class ModelSettings extends Modal {
 constructor(app:App,private models:ComposerModel[],private settings:ComposerSettings,private apply:(value:ComposerSettings)=>Promise<void>){super(app);this.settings={...settings,modelSelection:settings.modelSelection?{...settings.modelSelection,options:settings.modelSelection.options?.map(value=>({...value}))}:undefined};}
 onOpen(){
  this.titleEl.setText('Model and permissions');this.contentEl.empty();
  const selected=this.settings.modelSelection,model=this.models.find(model=>model.selection.instanceId===selected?.instanceId&&model.selection.model===selected.model);
  new Setting(this.contentEl).setName('Model').setDesc(model?.provider??'Choose a connected provider').addButton(button=>button.setButtonText(model?.label??selected?.model??'Choose model').onClick(()=>new ModelChoice(this.app,this.models,choice=>{this.settings.modelSelection={...choice.selection};this.onOpen();}).open()));
  for(const option of model?.options??[]){
   const saved=selected?.options?.find(value=>value.id===option.id)?.value??option.currentValue;
   const change=(value:string|boolean)=>{const selection=this.settings.modelSelection!;selection.options=[...(selection.options??[]).filter(item=>item.id!==option.id),{id:option.id,value}];};
   const setting=new Setting(this.contentEl).setName(option.label);
   if(option.type==='boolean')setting.addToggle(toggle=>toggle.setValue(saved===true).onChange(change));
   else setting.addDropdown(dropdown=>{dropdown.addOption('','Use default');for(const choice of option.options)dropdown.addOption(choice.id,choice.label);dropdown.setValue(typeof saved==='string'?saved:'').onChange(value=>{if(value)change(value);else if(this.settings.modelSelection)this.settings.modelSelection.options=this.settings.modelSelection.options?.filter(item=>item.id!==option.id);});});
  }
  const names:Record<RuntimeMode,string>={'approval-required':'Ask before changes','auto-accept-edits':'Allow edits','auto':'Automatic','full-access':'Full access'};
  new Setting(this.contentEl).setName('Permissions').addDropdown(dropdown=>{for(const mode of model?.runtimeModes??[])dropdown.addOption(mode,names[mode]);dropdown.setValue(this.settings.runtimeMode??'full-access').onChange(mode=>{this.settings.runtimeMode=mode as RuntimeMode;});});
  if(model?.plan)new Setting(this.contentEl).setName('Plan mode').addToggle(toggle=>toggle.setValue(this.settings.interactionMode==='plan').onChange(plan=>{this.settings.interactionMode=plan?'plan':'default';}));
  new Setting(this.contentEl).addButton(button=>button.setButtonText('Cancel').onClick(()=>this.close())).addButton(button=>button.setButtonText('Apply').setCta().onClick(async()=>{button.setDisabled(true);try{await this.apply(this.settings);this.close();}catch(error){new Notice(error instanceof Error?error.message:String(error));button.setDisabled(false);}}));
 }
}
interface SpeechResult {results:ArrayLike<ArrayLike<{transcript:string}>>}
interface Speech {interimResults:boolean;onresult:((event:SpeechResult)=>void)|null;onend:(()=>void)|null;onerror:(()=>void)|null;start():void;abort():void}
export class ChatComposer extends Component {
 readonly input:HTMLTextAreaElement;private submit:HTMLButtonElement;private modelButton:HTMLButtonElement;private mic:HTMLButtonElement;private attach:HTMLButtonElement;private chips:HTMLElement;private suggestions:HTMLElement;private fileInput:HTMLInputElement;
 private catalog:ComposerModel[]=[];private settings:ComposerSettings={};private running=false;private busy=false;private available=false;private recognition?:Speech;private timer?:TimerHandle;private dead=false;private readers=new Set<FileReader>();private locked=false;private search=0;private references=new Map<string,Record<string,unknown>>();private candidates:string[]=[];private selection=0;private token?:RegExpMatchArray;
 attachments:OutgoingAttachment[]=[];
 private resizer?:ResizeObserver;
 constructor(private app:App,readonly el:HTMLElement,private host:ComposerHost,draft:string){
  super();el.addClass('t3-chat-composer');this.chips=el.createDiv({cls:'t3-composer-attachments'});this.suggestions=el.createDiv({cls:'t3-composer-suggestions',attr:{role:'listbox','aria-label':'Prompt suggestions'}});this.suggestions.hidden=true;
  this.input=el.createEl('textarea',{cls:'t3-composer-input',attr:{'aria-label':'Message T3',placeholder:'Ask anything. @ files, $ skills, / commands',rows:'2'}});this.input.value=draft;
  const controls=el.createDiv({cls:'t3-composer-controls'});this.attach=this.icon(controls,'paperclip','Attach images',()=>this.fileInput.click());
  const spacer=controls.createSpan({cls:'t3-composer-spacer'});spacer.setAttribute('aria-hidden','true');
  this.modelButton=controls.createEl('button',{cls:'clickable-icon t3-composer-model',attr:{type:'button','aria-label':'Choose model and permissions'}});this.modelButton.addEventListener('click',()=>{void this.openSettings();});
  this.mic=this.icon(controls,'mic','Voice input',()=>this.speech());this.submit=this.icon(controls,'arrow-up','Send message',()=>{void (this.running&&!this.hasInput()?this.host.stop():this.host.send()).catch(error=>this.failure(error));});this.submit.addClass('t3-composer-submit');
  this.fileInput=el.createEl('input',{attr:{type:'file',accept:'image/png,image/jpeg,image/gif,image/webp',multiple:'','aria-label':'Choose images'}});this.fileInput.hidden=true;this.fileInput.addEventListener('change',()=>{void this.addFiles(Array.from(this.fileInput.files??[]));this.fileInput.value='';});
  this.input.addEventListener('input',()=>{this.host.changed(this.input.value);this.resizeInput();this.controls();this.suggest();});
  this.input.addEventListener('keydown',event=>{
   if(event.isComposing)return;
   if(this.candidates.length&&!this.suggestions.hidden){if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();this.selection=(this.selection+(event.key==='ArrowDown'?1:this.candidates.length-1))%this.candidates.length;this.drawSuggestions();return;}if(event.key==='Escape'){this.hideSuggestions();return;}if(event.key==='Enter'){event.preventDefault();this.insertCandidate(this.candidates[this.selection]);return;}}
   if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();if(!this.busy&&this.available&&this.hasInput())void this.host.send().catch(error=>this.failure(error));}
  });
  el.addEventListener('dragover',event=>{if(event.dataTransfer?.types.includes('Files'))event.preventDefault();});el.addEventListener('drop',event=>{if(event.dataTransfer?.files.length){event.preventDefault();void this.addFiles(Array.from(event.dataTransfer.files));}});
  this.controls();
 }
 onload(){
  this.resizeInput();let width=this.el.clientWidth;
  const Observer=this.el.ownerDocument.defaultView?.ResizeObserver;
  if(Observer){this.resizer=new Observer(()=>{const next=this.el.clientWidth;if(next!==width){width=next;this.resizeInput();}});this.resizer.observe(this.el);}
 }
 private resizeInput(){this.input.setCssProps({'--t3-composer-height':'auto'});this.input.setCssProps({'--t3-composer-height':this.input.scrollHeight+'px'});}
 private icon(parent:HTMLElement,icon:string,label:string,action:()=>void){const button=parent.createEl('button',{cls:'clickable-icon t3-chat-icon',attr:{type:'button','aria-label':label,title:label}});setIcon(button,icon);button.addEventListener('click',action);return button;}
 private failure(error:unknown){if(this.dead)return;new Notice(error instanceof Error?error.message:String(error),8000);}
 update(available:boolean,running:boolean,busy:boolean,settings?:ComposerSettings,locked=false){this.locked=locked;this.available=available;this.running=running;this.busy=busy;if(settings)this.settings={...settings};this.controls();}
 async refreshModels(){this.catalog=await this.host.models();this.controls();}
 private async openSettings(){try{await this.refreshModels();if(!this.catalog.length)throw Error('No models are available on this machine. Check T3 provider settings.');new ModelSettings(this.app,this.catalog,this.settings,async value=>{await this.host.configure(value);this.settings=value;this.controls();}).open();}catch(error){this.failure(error);}}
 private speechConstructor(){const owner=this.el.ownerDocument.defaultView as unknown as {SpeechRecognition?:new()=>Speech;webkitSpeechRecognition?:new()=>Speech};return owner?.SpeechRecognition??owner?.webkitSpeechRecognition;}
 private speech(){
  if(this.recognition){this.recognition.abort();this.recognition=undefined;this.controls();return;}
  const Speech=this.speechConstructor();if(!Speech)return;const recognition=this.recognition=new Speech();recognition.interimResults=false;
  recognition.onresult=event=>{const text=Array.from(event.results).map(result=>result[0]?.transcript??'').join(' ');this.input.value+=(this.input.value?' ':'')+text;this.host.changed(this.input.value);this.resizeInput();this.controls();};
  recognition.onend=()=>{this.recognition=undefined;this.controls();};recognition.onerror=()=>{this.recognition=undefined;this.controls();this.failure(Error('Voice input is unavailable. Check microphone access on this device.'));};
  try{recognition.start();this.controls();}catch(error){this.recognition=undefined;this.controls();this.failure(error);}
 }
 private controls(){
  this.input.readOnly=this.busy||this.locked;
  this.submit.disabled=this.busy||!this.available||!this.running&&!this.hasInput();this.attach.disabled=this.busy||this.locked||!this.available;this.modelButton.disabled=this.busy||this.locked||!this.available;
  this.mic.disabled=this.busy||this.locked||!this.available||!this.speechConstructor();this.mic.title=this.speechConstructor()?'Voice input':'Voice input is not available on this device';
  setIcon(this.submit,this.running&&!this.hasInput()?'square':'arrow-up');this.submit.setAttribute('aria-label',this.running&&!this.hasInput()?'Stop response':this.running?'Steer response':'Send message');this.submit.title=this.submit.getAttribute('aria-label')!;
  setIcon(this.mic,this.recognition?'mic-off':'mic');this.modelButton.empty();
  const selection=this.settings.modelSelection,provider=this.catalog.find(model=>model.selection.instanceId===selection?.instanceId);
  renderProviderIcon(this.modelButton,provider?.driver,provider?.provider??selection?.instanceId??'');
  this.modelButton.createSpan({text:composerModelLabel(selection,this.catalog)});
 }
 private hasInput(){return !!this.input.value.trim()||this.attachments.length>0;}
 async addFiles(files:File[]){
  try{
   if(this.busy||this.locked||this.dead)return;if(this.attachments.length+files.length>4)throw Error('Attach up to four images.');
   if(files.some(file=>!['image/png','image/jpeg','image/gif','image/webp'].includes(file.type)))throw Error('Choose PNG, JPEG, GIF, or WebP images.');
   if([...this.attachments.map(file=>file.sizeBytes??0),...files.map(file=>file.size)].reduce((a,b)=>a+b,0)>10*1024*1024)throw Error('Keep attached images below 10 MiB in total.');
   const prepared:OutgoingAttachment[]=[];for(const file of files){const dataUrl=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();this.readers.add(reader);reader.onloadend=()=>this.readers.delete(reader);reader.onabort=()=>reject(Error('Image loading cancelled.'));reader.onload=()=>typeof reader.result==='string'?resolve(reader.result):reject(Error('Cannot decode this image.'));reader.onerror=()=>reject(Error('Cannot read this image.'));reader.readAsDataURL(file);});prepared.push({id:this.host.uuid(),name:file.name,mimeType:file.type,sizeBytes:file.size,dataUrl,type:'image'});}
   if(this.dead)return;this.attachments.push(...prepared);this.host.changed(this.input.value);this.drawAttachments();this.controls();
  }catch(error){this.failure(error);}
 }
 private drawAttachments(){this.chips.empty();for(const item of this.attachments){const chip=this.chips.createSpan({cls:'t3-composer-attachment',text:item.name});if(item.dataUrl)chip.createEl('img',{cls:'t3-composer-thumbnail',attr:{src:item.dataUrl,alt:item.name??'Attached image'}});this.icon(chip,'x','Remove '+item.name,()=>{if(this.busy||this.locked)return;this.attachments=this.attachments.filter(value=>value.id!==item.id);this.host.changed(this.input.value);this.drawAttachments();this.controls();});}}
 options(){const records=[...this.references.values()].filter(record=>this.input.value.includes(String(record.kind==='mention'?'@'+String(record.path):'$'+String(record.name)))||this.input.value.includes('/'+String(record.name)));for(const item of this.attachments)records.push({version:1,contextId:item.id,label:(item.name??'Image').slice(0,200),kind:'image',attachmentId:item.id,name:item.name,mimeType:item.mimeType,sizeBytes:item.sizeBytes});return {...this.settings,attachments:this.attachments.map(item=>({...item})),...(records.length?{context:{version:1,records}}:{})};}
 restoreContext(context?:OutgoingContext){for(const record of context?.records??[])if((record.kind==='mention'||record.kind==='skill')&&typeof record.contextId==='string')this.references.set(record.contextId,{...record});}
 restoreAttachments(attachments:OutgoingAttachment[]){this.attachments=attachments.map(item=>({...item}));this.drawAttachments();this.controls();}
 clear(){this.input.value='';this.attachments=[];this.references.clear();this.host.changed('');this.resizeInput();this.drawAttachments();this.hideSuggestions();this.controls();}
 private hideSuggestions(){this.search++;this.suggestions.hidden=true;this.candidates=[];}
 private suggest(){
  const token=this.input.value.slice(0,this.input.selectionStart??this.input.value.length).match(/(?:^|\s)([@$/])([^\s]*)$/);this.token=token??undefined;if(!token){this.hideSuggestions();return;}
  const clock=clockForDocument(this.el.ownerDocument);clock.clearTimeout(this.timer);const search=++this.search;
  this.timer=clock.setTimeout(()=>{void (async()=>{
   if(!this.catalog.length)await this.refreshModels();let values:string[]=[];const query=token[2].toLowerCase(),model=this.catalog.find(model=>model.selection.instanceId===this.settings.modelSelection?.instanceId&&model.selection.model===this.settings.modelSelection.model);
   if(token[1]==='@')values=await this.host.files(query);else if(token[1]==='$')values=model?.skills.map(skill=>skill.name)??[];else values=[...(model?.commands.map(command=>command.name)??[]),...(model?.skills.map(skill=>skill.name)??[])];
   if(search!==this.search)return;this.candidates=[...new Set(values.filter(value=>value.toLowerCase().includes(query)))].slice(0,8);this.selection=0;this.drawSuggestions();
  })().catch(error=>{this.hideSuggestions();this.failure(error);});},180);
 }
 private drawSuggestions(){this.suggestions.empty();this.suggestions.hidden=!this.candidates.length;for(const [index,text] of this.candidates.entries()){const button=this.suggestions.createEl('button',{cls:'suggestion-item',text:(this.token?.[1]??'')+text,attr:{type:'button',role:'option','aria-selected':String(index===this.selection)}});button.addEventListener('mousedown',event=>{event.preventDefault();this.insertCandidate(text);});}}
 private insertCandidate(text:string){const token=this.token;if(!token)return;if(token[1]==='@'||token[1]==='$'){const id=this.host.uuid();if(this.references.size<100)this.references.set(id,{version:1,contextId:id,label:text.slice(0,200),kind:token[1]==='@'?'mention':'skill',...(token[1]==='@'?{path:text}:{name:text})});}const end=this.input.selectionStart??this.input.value.length,start=end-token[2].length;this.input.setRangeText(text+' ',start,end,'end');this.host.changed(this.input.value);this.resizeInput();this.hideSuggestions();this.input.focus();this.controls();}
 onunload(){this.dead=true;this.resizer?.disconnect();for(const reader of this.readers)reader.abort();this.readers.clear();this.recognition?.abort();clockForDocument(this.el.ownerDocument).clearTimeout(this.timer);this.search++;}
}
