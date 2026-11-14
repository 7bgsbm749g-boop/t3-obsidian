import {App,Modal,Notice,Setting} from 'obsidian';
import {combinedAsks,type QueuedAsk} from './ask-queue';

export class AskQueueModal extends Modal {
  private sending=false;
  constructor(app:App,private items:QueuedAsk[],private save:(items:QueuedAsk[])=>void,private send:(prompt:string,ids:string[])=>Promise<void>){super(app);}
  onOpen(){
    this.titleEl.setText('Ask Queue');this.contentEl.empty();this.contentEl.addClass('send-to-t3-ask-queue');
    this.contentEl.createEl('p',{text:'Collect selections and questions, then send one prompt. The reply goes at the end of this note. Selection text is a saved snapshot.'});
    for(const [index,item] of this.items.entries()){
      const row=this.contentEl.createDiv();row.createEl('h4',{text:`${index+1}. ${item.notePath}`});
      row.createEl('blockquote',{text:item.selection});
      const field=row.createEl('textarea',{attr:{'aria-label':`Question ${index+1}`,placeholder:'Your question…',rows:'3'}});field.value=item.question;
      field.addEventListener('input',()=>{item.question=field.value;this.save(this.items);});
      new Setting(row).addButton(button=>button.setButtonText('Move up').setDisabled(index===0).onClick(()=>{[this.items[index-1],this.items[index]]=[this.items[index],this.items[index-1]];this.save(this.items);this.onOpen();})).addButton(button=>button.setButtonText('Remove').onClick(()=>{this.items.splice(index,1);this.save(this.items);this.onOpen();}));
    }
    new Setting(this.contentEl).addButton(button=>button.setButtonText('Send combined questions…').setCta().setDisabled(!this.items.length).onClick(()=>void this.submit()));
  }
  private async submit(){
    if(this.sending)return;this.sending=true;
    try{const prompt=combinedAsks(this.items);await this.send(prompt,this.items.map(item=>item.id));this.close();}
    catch(error){new Notice(error instanceof Error?error.message:String(error));}
    finally{this.sending=false;}
  }
}
