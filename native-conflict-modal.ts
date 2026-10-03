import {Modal,Notice,Setting,type App,type MarkdownView} from 'obsidian';
import {nativeResponses} from './native-response-manager';
export class NativeConflictModal extends Modal {
  constructor(app:App,private view:MarkdownView){super(app);}
  onOpen(){
    this.titleEl.setText('Resolve response view conflict');const manager=nativeResponses(this.app),conflict=manager.view(this.view)?.conflictRecord();
    if(!conflict){this.contentEl.setText('This view has no unresolved response conflict.');return;}
    this.contentEl.createEl('p',{text:conflict.reason});this.contentEl.createEl('p',{text:'Both versions are preserved on this device. Choose which ordinary note text this view should use. Streaming text will remain local.'});
    const file=this.view.file;if(!file)return;
    void this.app.vault.read(file).then(reviewed=>{
      if(this.view.file!==file)return;
      const resolve=async(choice:'saved'|'local')=>{try{await manager.resolve(this.view,reviewed,choice);this.close();}catch(error){new Notice(error instanceof Error?error.message:String(error));}};
      new Setting(this.contentEl).addButton(button=>button.setButtonText('Use saved note').onClick(()=>void resolve('saved'))).addButton(button=>button.setButtonText('Use preserved local edits').onClick(()=>void resolve('local')));
    });
  }
  onClose(){this.contentEl.empty();}
}
