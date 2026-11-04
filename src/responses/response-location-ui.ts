import {Modal,Notice,Setting,type App} from 'obsidian';
import type {ResponseCommand} from './response-command';
export interface ResponseLocationReview {locations:Array<{path:string;hash:string}>;locationHash:string}
export class ResponseLocationModal extends Modal {
  private closed=false;
  constructor(app:App,private id:string,private execute:(command:ResponseCommand)=>Promise<unknown>){super(app);}
  onOpen(){
    this.closed=false;
    this.titleEl.setText('Choose response destination');this.contentEl.setText('Reading saved candidate notes…');
    void this.execute({version:1,id:crypto.randomUUID(),kind:'response-status',bindingId:this.id}).then(value=>{
      if(this.closed)return;
      const review=value as ResponseLocationReview;this.contentEl.empty();
      this.contentEl.createEl('p',{text:'Continue the existing reply in one note. Candidate notes are backed up before recovery; text in the other notes is preserved and its active markers are detached. No prompt is resent.'});
      if(!review.locations?.length){this.contentEl.createEl('p',{text:'No intact response block is currently saved. Restore its boundaries before trying again.'});return;}
      for(const location of review.locations)new Setting(this.contentEl).setName(location.path).addButton(button=>button.setButtonText('Resume here').onClick(()=>{
        button.setDisabled(true);
        void this.execute({version:1,id:crypto.randomUUID(),kind:'resolve-response-location',bindingId:this.id,notePath:location.path,hash:review.locationHash}).then(()=>{new Notice('Response destination recovered. Catching up with T3 history…');this.close();}).catch(error=>{button.setDisabled(false);new Notice(String(error),10000);});
      }));
    }).catch(error=>{this.contentEl.setText(String(error));});
  }
  onClose(){this.closed=true;this.contentEl.empty();}
}
