import {Modal,Notice,Setting,type App,type MarkdownView,type TFile} from 'obsidian';
import {nativeResponses} from './native-response-manager';
import type {NativeViewConflict} from './native-response-view';

/** Defer until the native update has finished, then offer each unresolved
 * conflict once. Multiple panes share one dialog at a time. Closing it leaves
 * manual recovery available without repeatedly interrupting the user. */
export class NativeConflictRecovery {
  private manager;
  private pending=new Map<MarkdownView,{file:TFile;conflict:NativeViewConflict}>();
  private shown=new WeakSet<NativeViewConflict>();
  private active?:NativeConflictModal;
  private activeView?:MarkdownView;
  private activeConflict?:NativeViewConflict;
  private timer?:ReturnType<typeof setTimeout>;
  private disposed=false;
  constructor(private app:App){this.manager=nativeResponses(app);}
  queue(view:MarkdownView,manual=false){
    const file=view.file,conflict=this.manager.view(view)?.conflictRecord();
    if(this.disposed)return;
    if(this.activeView===view&&(!file||this.activeConflict!==conflict))this.active?.close();
    if(!file||!conflict||!manual&&conflict.awaitingCompletion){this.pending.delete(view);return;}
    if(!manual&&this.shown.has(conflict))return;
    if(this.activeView===view){if(this.activeConflict===conflict)return;this.active?.close();}
    this.pending.set(view,{file,conflict});this.schedule();
  }
  private schedule(){
    if(this.disposed||this.active||this.timer!==undefined||!this.pending.size)return;
    this.timer=setTimeout(()=>{this.timer=undefined;this.openNext();},0);
  }
  private openNext(){
    if(this.disposed||this.active)return;
    const live=new Set(this.app.workspace.getLeavesOfType('markdown').map(leaf=>leaf.view));
    for(const [view,{file,conflict}] of this.pending){
      this.pending.delete(view);
      if(!live.has(view)||view.file!==file||this.manager.view(view)?.conflictRecord()!==conflict)continue;
      this.shown.add(conflict);this.activeView=view;this.activeConflict=conflict;
      const modal=new NativeConflictModal(this.app,view,()=>{
        if(this.active!==modal)return;
        this.active=undefined;this.activeView=undefined;this.activeConflict=undefined;this.schedule();
      });
      this.active=modal;modal.open();return;
    }
  }
  dispose(){
    this.disposed=true;this.pending.clear();
    if(this.timer!==undefined){clearTimeout(this.timer);this.timer=undefined;}
    this.active?.close();this.active=undefined;this.activeView=undefined;this.activeConflict=undefined;
  }
}

export class NativeConflictModal extends Modal {
  private closed=false;
  constructor(app:App,private view:MarkdownView,private closedCallback?:()=>void){super(app);}
  onOpen(){
    this.titleEl.setText('Resolve response view conflict');const manager=nativeResponses(this.app),conflict=manager.view(this.view)?.conflictRecord();
    if(!conflict){this.contentEl.setText('This view has no unresolved response conflict.');return;}
    const file=this.view.file;if(!file)return;
    this.contentEl.createEl('p',{text:`Note: ${file.path}`});
    this.contentEl.createEl('p',{text:conflict.reason});this.contentEl.createEl('p',{text:'Both versions are preserved on this device. Choose which ordinary note text this view should use. Streaming text will remain local.'});
    void this.app.vault.read(file).then(reviewed=>{
      if(this.closed||this.view.file!==file||manager.view(this.view)?.conflictRecord()!==conflict)return;
      let resolving=false;
      const resolve=async(choice:'saved'|'local')=>{if(resolving||this.closed)return;resolving=true;try{if(this.view.file!==file||manager.view(this.view)?.conflictRecord()!==conflict)throw Error('The response conflict changed. Open recovery again.');await manager.resolve(this.view,reviewed,choice);this.close();}catch(error){new Notice(error instanceof Error?error.message:String(error));}finally{resolving=false;}};
      new Setting(this.contentEl).addButton(button=>button.setButtonText('Use saved note').onClick(()=>void resolve('saved'))).addButton(button=>button.setButtonText('Use preserved local edits').onClick(()=>void resolve('local')));
    }).catch(error=>{if(!this.closed)new Notice(error instanceof Error?error.message:String(error));});
  }
  onClose(){this.closed=true;this.contentEl.empty();this.closedCallback?.();}
}
