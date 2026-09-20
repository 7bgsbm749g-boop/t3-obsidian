import {App, Modal, Notice, Setting} from 'obsidian';
import {RequestDeliveryError} from './bridge';

export interface ChatHost {
  getTargetDescription(): string;
  sendChat(prompt: string): Promise<void>;
  sendToExisting(prompt: string): Promise<void>;
  openSettings(): void;
}

function reportError(error: unknown) {
  new Notice(`T3 Chat: ${error instanceof Error ? error.message : String(error)}`, 10000);
}

class ChatPromptModal extends Modal {
  private submitting = false;
  private field!: HTMLTextAreaElement;
  private actions!: Setting;

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
    this.field.addEventListener('keydown', event => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.isComposing) {
        event.preventDefault();
        void this.submit();
      }
    });
    this.actions = new Setting(this.contentEl)
      .setDesc('Choose a new thread or an existing thread. The thread picker shows whether each conversation is active or idle.')
      .addButton(button => button.setButtonText('New thread').setCta().onClick(() => { void this.submit(false); }))
      .addButton(button => button.setButtonText('Existing thread…').onClick(() => { void this.submit(true); }));
    this.field.focus();
  }

  private async submit(existing = false) {
    if (this.submitting || !this.field.value.trim()) return;
    this.submitting = true;
    this.field.disabled = true;
    this.actions.setDisabled(true);
    try {
      if(existing)await this.host.sendToExisting(this.field.value);
      else await this.host.sendChat(this.field.value);
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
  constructor(app:App,private host:ChatHost,private prompt:string){super(app);}
  onOpen(){
    this.titleEl.setText('Send T3 chat');this.contentEl.empty();
    this.contentEl.createEl('p',{text:this.host.getTargetDescription()});
    this.actions=new Setting(this.contentEl)
      .setDesc('Choose where to send this message. The thread picker shows whether each conversation is active or idle.')
      .addButton(button=>button.setButtonText('New thread').setCta().onClick(()=>{void this.choose(false);}))
      .addButton(button=>button.setButtonText('Existing thread…').onClick(()=>{void this.choose(true);}));
  }
  private async choose(existing:boolean){
    if(this.choosing)return;this.choosing=true;this.actions.setDisabled(true);
    try{if(existing)await this.host.sendToExisting(this.prompt);else await this.host.sendChat(this.prompt);this.close();}
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
