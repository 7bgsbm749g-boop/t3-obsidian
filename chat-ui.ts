import {App, FuzzySuggestModal, Modal, Notice, Setting} from 'obsidian';
import {RequestDeliveryError} from './bridge';

export interface ChatHost {
  hasNote():boolean;
  getTargetDescription(projectKey?:string): string;
  getProjectChoices():{key:string;label:string}[];
  getLinkedThread(projectKey?:string):string|undefined;
  hasPreviousThreads(projectKey?:string):boolean;
  defaultRemember():boolean;
  sendChat(prompt: string,remember:boolean,projectKey?:string): Promise<void>;
  sendToNew(prompt:string,remember:boolean,projectKey?:string):Promise<void>;
  sendToExisting(prompt: string,remember:boolean,projectKey?:string): Promise<void>;
  sendToPrevious(prompt:string,remember:boolean,projectKey?:string):Promise<void>;
  openSettings(): void;
}

class ChatProjectModal extends FuzzySuggestModal<{key:string;label:string}> {
  constructor(app:App,private choices:{key:string;label:string}[],private choose:(key:string)=>void){super(app);this.setPlaceholder('Choose a T3 Code project');this.emptyStateText='No T3 Code projects available. Refresh projects in settings.';}
  getItems(){return this.choices;}
  getItemText(item:{key:string;label:string}){return item.label;}
  onChooseItem(item:{key:string;label:string}){this.choose(item.key);}
}

function projectSetting(app:App,content:HTMLElement,host:ChatHost,onChoose:(key:string)=>void,selected?:string){
  new Setting(content).setName(host.getTargetDescription(selected))
    .addButton(button=>button.setButtonText('Change project for this send').onClick(()=>new ChatProjectModal(app,host.getProjectChoices(),onChoose).open()));
}

function reportError(error: unknown) {
  new Notice(`T3 Chat: ${error instanceof Error ? error.message : String(error)}`, 10000);
}

class ChatPromptModal extends Modal {
  private submitting = false;
  private field!: HTMLTextAreaElement;
  private actions!: Setting;
  private remember=false;
  private projectKey?:string;
  private initialized=false;

  constructor(app: App, private host: ChatHost, private prompt = '') { super(app); }

  onOpen() {
    this.titleEl.setText('T3 chat');
    this.contentEl.empty();
    projectSetting(this.app,this.contentEl,this.host,key=>{this.prompt=this.field.value;this.projectKey=key;this.onOpen();},this.projectKey);
    this.field = this.contentEl.createEl('textarea', {
      attr: {'aria-label': 'Message for T3', placeholder: 'What would you like to do?', rows: '5'},
    });
    this.field.style.width = '100%';
    this.field.value = this.prompt;
    if(!this.initialized){this.remember=this.host.defaultRemember();this.initialized=true;}
    if(this.host.hasNote())new Setting(this.contentEl).setName('Remember this thread for this note').addToggle(toggle=>toggle.setValue(this.remember).onChange(value=>{this.remember=value;}));
    this.field.addEventListener('keydown', event => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.isComposing) {
        event.preventDefault();
        void this.submit();
      }
    });
    this.contentEl.createEl('p',{text:'Choose a destination. The thread picker shows whether each conversation is active or idle.'});
    this.actions = new Setting(this.contentEl)
      .addButton(button => button.setButtonText(this.host.getLinkedThread(this.projectKey)?'Linked thread':'New thread').setCta().onClick(() => { void this.submit('default'); }))
      .addButton(button => button.setButtonText('Existing thread…').onClick(() => { void this.submit('existing'); }));
    if(this.host.getLinkedThread(this.projectKey))this.actions.addButton(button=>button.setButtonText('New thread').onClick(()=>{void this.submit('new');}));
    if(this.host.hasPreviousThreads(this.projectKey))this.actions.addButton(button=>button.setButtonText('Previous threads…').onClick(()=>{void this.submit('previous');}));
    this.field.focus();
  }

  private async submit(target:'default'|'existing'|'new'|'previous'|boolean = 'default') {
    if (this.submitting || !this.field.value.trim()) return;
    this.submitting = true;
    this.field.disabled = true;
    this.actions.setDisabled(true);
    try {
      if(target===true||target==='existing')await this.host.sendToExisting(this.field.value,this.remember,this.projectKey);
      else if(target==='previous')await this.host.sendToPrevious(this.field.value,this.remember,this.projectKey);
      else if(target==='new')await this.host.sendToNew(this.field.value,this.remember,this.projectKey);
      else await this.host.sendChat(this.field.value,this.remember,this.projectKey);
      this.close();
    } catch (error) {
      reportError(error);
      if (error instanceof RequestDeliveryError && error.requestSaved) { this.close(); this.host.openSettings(); }
    } finally {
      this.submitting = false;
      this.field.disabled = false;
      this.actions.setDisabled(false);
    }
  }
}

class ChatDestinationModal extends Modal {
  private choosing=false;
  private actions!:Setting;
  private remember=false;
  private projectKey?:string;
  private initialized=false;
  constructor(app:App,private host:ChatHost,private prompt:string){super(app);}
  onOpen(){
    this.titleEl.setText('Send T3 chat');this.contentEl.empty();
    projectSetting(this.app,this.contentEl,this.host,key=>{this.projectKey=key;this.onOpen();},this.projectKey);
    if(!this.initialized){this.remember=this.host.defaultRemember();this.initialized=true;}
    if(this.host.hasNote())new Setting(this.contentEl).setName('Remember this thread for this note').addToggle(toggle=>toggle.setValue(this.remember).onChange(value=>{this.remember=value;}));
    this.contentEl.createEl('p',{text:'Choose a destination. The thread picker shows whether each conversation is active or idle.'});
    this.actions=new Setting(this.contentEl)
      .addButton(button=>button.setButtonText(this.host.getLinkedThread(this.projectKey)?'Linked thread':'New thread').setCta().onClick(()=>{void this.choose('default');}))
      .addButton(button=>button.setButtonText('Existing thread…').onClick(()=>{void this.choose('existing');}));
    if(this.host.getLinkedThread(this.projectKey))this.actions.addButton(button=>button.setButtonText('New thread').onClick(()=>{void this.choose('new');}));
    if(this.host.hasPreviousThreads(this.projectKey))this.actions.addButton(button=>button.setButtonText('Previous threads…').onClick(()=>{void this.choose('previous');}));
  }
  private async choose(target:'default'|'existing'|'new'|'previous'|boolean){
    if(this.choosing)return;this.choosing=true;this.actions.setDisabled(true);
    try{if(target===true||target==='existing')await this.host.sendToExisting(this.prompt,this.remember,this.projectKey);else if(target==='previous')await this.host.sendToPrevious(this.prompt,this.remember,this.projectKey);else if(target==='new')await this.host.sendToNew(this.prompt,this.remember,this.projectKey);else await this.host.sendChat(this.prompt,this.remember,this.projectKey);this.close();}
    catch(error){reportError(error);if(error instanceof RequestDeliveryError&&error.requestSaved){this.close();this.host.openSettings();}}
    finally{this.choosing=false;this.actions.setDisabled(false);}
  }
}

/** Both entry points use the note context captured when the chat was opened. */
export async function openChatFlow(app: App, host: ChatHost, prompt?: string): Promise<void> {
  if (prompt !== undefined && !prompt.trim()) return;
  if (prompt === undefined) { new ChatPromptModal(app, host).open(); return; }
  new ChatDestinationModal(app,host,prompt).open();
}
