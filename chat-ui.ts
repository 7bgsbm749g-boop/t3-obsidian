import {App, Modal, Notice, Setting} from 'obsidian';
import {RequestDeliveryError} from './bridge';

export interface ChatHost {
  getTargetDescription(): string;
  getLinkedThread():string|undefined;
  hasPreviousThreads():boolean;
  defaultRemember():boolean;
  sendChat(prompt: string,remember:boolean): Promise<void>;
  sendToNew(prompt:string,remember:boolean):Promise<void>;
  sendToExisting(prompt: string,remember:boolean): Promise<void>;
  sendToPrevious(prompt:string,remember:boolean):Promise<void>;
  openSettings(): void;
}

function reportError(error: unknown) {
  new Notice(`T3 Chat: ${error instanceof Error ? error.message : String(error)}`, 10000);
}

class ChatPromptModal extends Modal {
  private submitting = false;
  private field!: HTMLTextAreaElement;
  private actions!: Setting;
  private remember=false;

  constructor(app: App, private host: ChatHost, private prompt = '') { super(app); }

  onOpen() {
    this.titleEl.setText('T3 chat');
    this.contentEl.empty();
    this.contentEl.createEl('p', {text: this.host.getTargetDescription()});
    this.field = this.contentEl.createEl('textarea', {
      attr: {'aria-label': 'Message for T3', placeholder: 'What would you like to do?', rows: '5'},
    });
    this.field.style.width = '100%';
    this.field.value = this.prompt;
    this.remember=this.host.defaultRemember();
    if(this.host.getTargetDescription().startsWith('No note open')===false)new Setting(this.contentEl).setName('Remember this thread for this note').addToggle(toggle=>toggle.setValue(this.remember).onChange(value=>{this.remember=value;}));
    this.field.addEventListener('keydown', event => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.isComposing) {
        event.preventDefault();
        void this.submit();
      }
    });
    this.actions = new Setting(this.contentEl)
      .setDesc('Choose a destination. The thread picker shows whether each conversation is active or idle.')
      .addButton(button => button.setButtonText(this.host.getLinkedThread()?'Linked thread':'New thread').setCta().onClick(() => { void this.submit('default'); }))
      .addButton(button => button.setButtonText('Existing thread…').onClick(() => { void this.submit('existing'); }));
    if(this.host.getLinkedThread())this.actions.addButton(button=>button.setButtonText('New thread').onClick(()=>{void this.submit('new');}));
    if(this.host.hasPreviousThreads())this.actions.addButton(button=>button.setButtonText('Previous threads…').onClick(()=>{void this.submit('previous');}));
    this.field.focus();
  }

  private async submit(target:'default'|'existing'|'new'|'previous'|boolean = 'default') {
    if (this.submitting || !this.field.value.trim()) return;
    this.submitting = true;
    this.field.disabled = true;
    this.actions.setDisabled(true);
    try {
      if(target===true||target==='existing')await this.host.sendToExisting(this.field.value,this.remember);
      else if(target==='previous')await this.host.sendToPrevious(this.field.value,this.remember);
      else if(target==='new')await this.host.sendToNew(this.field.value,this.remember);
      else await this.host.sendChat(this.field.value,this.remember);
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
  constructor(app:App,private host:ChatHost,private prompt:string){super(app);}
  onOpen(){
    this.titleEl.setText('Send T3 chat');this.contentEl.empty();
    this.contentEl.createEl('p',{text:this.host.getTargetDescription()});
    this.remember=this.host.defaultRemember();
    if(this.host.getTargetDescription().startsWith('No note open')===false)new Setting(this.contentEl).setName('Remember this thread for this note').addToggle(toggle=>toggle.setValue(this.remember).onChange(value=>{this.remember=value;}));
    this.actions=new Setting(this.contentEl)
      .setDesc('Choose where to send this message. The thread picker shows whether each conversation is active or idle.')
      .addButton(button=>button.setButtonText(this.host.getLinkedThread()?'Linked thread':'New thread').setCta().onClick(()=>{void this.choose('default');}))
      .addButton(button=>button.setButtonText('Existing thread…').onClick(()=>{void this.choose('existing');}));
    if(this.host.getLinkedThread())this.actions.addButton(button=>button.setButtonText('New thread').onClick(()=>{void this.choose('new');}));
    if(this.host.hasPreviousThreads())this.actions.addButton(button=>button.setButtonText('Previous threads…').onClick(()=>{void this.choose('previous');}));
  }
  private async choose(target:'default'|'existing'|'new'|'previous'|boolean){
    if(this.choosing)return;this.choosing=true;this.actions.setDisabled(true);
    try{if(target===true||target==='existing')await this.host.sendToExisting(this.prompt,this.remember);else if(target==='previous')await this.host.sendToPrevious(this.prompt,this.remember);else if(target==='new')await this.host.sendToNew(this.prompt,this.remember);else await this.host.sendChat(this.prompt,this.remember);this.close();}
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
