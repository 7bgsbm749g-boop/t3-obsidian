import {Component,FuzzySuggestModal,Modal,Notice,Setting,setIcon,type App,type FuzzyMatch} from 'obsidian';
import type {Project} from '../app/bridge';
import type {ThreadChoice} from './thread-target';
import {availableImportRun,runImportResultMessage,type ImportRun,type RunImportResult} from './run-import';
import type {ThreadDisplay} from './thread-display';

export interface RunImportHost {
  projects():Project[];projectLabel(project:Project):string;
  threads(project:Project):Promise<ThreadChoice[]>;
  runs(project:Project,thread:ThreadChoice):Promise<ImportRun[]>;
  attach(project:Project,thread:ThreadChoice,run:ImportRun,follow:boolean):Promise<RunImportResult>;
  preview?(project:Project,thread:ThreadChoice,run:ImportRun,element:HTMLElement,component:Component,signal:AbortSignal):Promise<void>;
}
export const RUN_PREVIEW_DELAY=500;
/** The native fuzzy picker keeps its search, selection and Enter behavior.
 * Only its run rows and the owned preview have a custom presentation. */
export class RunImportPicker extends FuzzySuggestModal<ImportRun>{
  private active?:{run:ImportRun;row:HTMLElement;root:HTMLElement;child:Component;abort:AbortController};
  private timer?:number;
  private exitTimer?:number;
  private observer?:MutationObserver;
  private closed=false;
  private keyboardPreview=false;
  constructor(app:App,private runs:ImportRun[],private choose:(run:ImportRun)=>void,private preview:(run:ImportRun,el:HTMLElement,child:Component,signal:AbortSignal)=>Promise<void>){
    super(app);this.setPlaceholder('Choose a T3 response');this.emptyStateText='No available runs.';
  }
  getItems(){return this.runs.filter(availableImportRun);}
  getItemText(run:ImportRun){return run.prompt.replace(/\s+/g,' ').trim();}
  renderSuggestion(match:FuzzyMatch<ImportRun>,el:HTMLElement){
    const run=match.item;el.dataset.t3ImportRun=run.messageId;el.addClass('send-to-t3-run-row');
    const heading=el.createDiv({cls:'send-to-t3-run-heading'}),icon=heading.createSpan({cls:'send-to-t3-run-status',attr:{'aria-label':run.status,'title':run.status}});
    icon.dataset.status=run.status;
    if(run.status!=='Running')setIcon(icon,run.status==='Completed'?'check':run.status==='Failed'?'x':'pause');
    heading.createSpan({cls:'send-to-t3-run-name',text:this.getItemText(run)});
    el.addEventListener('pointerenter',()=>{if(!this.keyboardPreview)this.prepare(run,el);});
    el.addEventListener('pointermove',event=>{if(event.movementX||event.movementY){this.keyboardPreview=false;this.prepare(run,el);}});
    el.addEventListener('pointerleave',()=>{if(!this.keyboardPreview)this.exitTimer=el.ownerDocument.defaultView!.setTimeout(()=>this.clear(),140);});
    el.addEventListener('focusin',()=>this.prepare(run,el));
  }
  onOpen(){
    super.onOpen();this.modalEl.addClass('send-to-t3-run-picker');
    const doc=this.modalEl.ownerDocument,win=doc.defaultView!;
    this.observer=new win.MutationObserver(()=>{
      if(this.active&&!this.active.row.isConnected)this.clear();
      // Arrow keys change the native selected class. Pointer selection is
      // handled by pointerenter, so layout changes never restart the dwell.
    });this.observer.observe(this.modalEl,{childList:true,subtree:true});
    win.addEventListener('keydown',this.keyboard,true);
  }
  private keyboard=(event:KeyboardEvent)=>{
    if(!['ArrowDown','ArrowUp'].includes(event.key))return;
    this.keyboardPreview=true;
    queueMicrotask(()=>{
      const row=this.modalEl.querySelector<HTMLElement>('.suggestion-item.is-selected'),id=row?.dataset.t3ImportRun,run=this.runs.find(item=>item.messageId===id);
      if(row&&run)this.prepare(run,row);
    });
  };
  private prepare(run:ImportRun,row:HTMLElement){
    const win=row.ownerDocument.defaultView!;
    if(this.exitTimer)win.clearTimeout(this.exitTimer);this.exitTimer=undefined;
    if(this.closed||this.active?.row===row)return;
    this.clear();const child=new Component();child.load();const abort=new AbortController();
    const root=row.createDiv({cls:'send-to-t3-run-preview'}),body=root.createDiv({cls:'send-to-t3-run-preview-body'});
    const panel=this.modalEl.querySelector<HTMLElement>('.prompt-results');
    const following=row.nextElementSibling,second=following?.nextElementSibling;
    const reserved=row.getBoundingClientRect().height+(following?.getBoundingClientRect().height??44)+(second?.getBoundingClientRect().height??44)+12;
    root.style.setProperty('--t3-run-preview-height',Math.min(280,Math.max(32,(panel?.clientHeight??400)-reserved))+'px');
    const active={run,row,root,child,abort};this.active=active;
    body.createDiv({cls:'send-to-t3-run-preview-loading',text:'Loading preview…'});
    void this.preview(run,body,child,abort.signal).catch(()=>{if(!abort.signal.aborted)body.setText('Preview could not be loaded. You can still import this run.');});
    this.timer=win.setTimeout(()=>{
      if(this.active!==active||!row.isConnected)return;
      row.addClass('is-previewing');row.setAttribute('aria-expanded','true');
      // Keep up to two following rows in view, within the existing scroll box.
      if(panel){const last=row.nextElementSibling?.nextElementSibling??row.nextElementSibling??row;
        const bottom=last.getBoundingClientRect().bottom,box=panel.getBoundingClientRect();
        if(bottom>box.bottom)panel.scrollTop+=bottom-box.bottom;
        if(row.getBoundingClientRect().top<box.top)panel.scrollTop+=row.getBoundingClientRect().top-box.top;
      }
    },RUN_PREVIEW_DELAY);
  }
  private clear(){
    const win=this.modalEl.ownerDocument.defaultView!;
    if(this.timer)win.clearTimeout(this.timer);if(this.exitTimer)win.clearTimeout(this.exitTimer);this.timer=undefined;this.exitTimer=undefined;
    const previous=this.active;this.active=undefined;
    if(previous){previous.abort.abort();previous.child.unload();previous.root.remove();previous.row.removeClass('is-previewing');previous.row.removeAttribute('aria-expanded');}
  }
  onChooseItem(run:ImportRun){if(availableImportRun(run))this.choose(run);}
  onClose(){this.closed=true;this.clear();this.observer?.disconnect();this.modalEl.ownerDocument.defaultView!.removeEventListener('keydown',this.keyboard,true);super.onClose();}
}
class ImportPicker<T> extends FuzzySuggestModal<T>{
  constructor(app:App,private items:T[],private label:(item:T)=>string,private choose:(item:T)=>Promise<void>,placeholder:string){super(app);this.setPlaceholder(placeholder);this.emptyStateText='No available items. Check the T3 connection.';}
  getItems(){return this.items;}
  getItemText(item:T){return this.label(item);}
  onChooseItem(item:T){void this.choose(item).catch(error=>new Notice(`Import T3 run: ${error instanceof Error?error.message:String(error)}`,10000));}
}
export function openRunImport(app:App,notePath:string,host:RunImportHost){
  new ImportPicker(app,host.projects(),project=>host.projectLabel(project),async project=>{
    new Notice('Loading T3 threads…',2000);
    const threads=await host.threads(project);
    new ImportPicker(app,threads,thread=>`${thread.title} · ${thread.status} · ${thread.id.slice(0,8)}`,async thread=>{
      new Notice('Reading T3 run history…',2000);
      const runs=await host.runs(project,thread);
      new RunImportPicker(app,runs,run=>{
        new ImportRunModal(app,notePath,thread,run,follow=>host.attach(project,thread,run,follow)).open();
      },(run,el,child,signal)=>host.preview?host.preview(project,thread,run,el,child,signal):Promise.resolve().then(()=>{el.setText('No preview available.');})).open();
    },'Choose the source T3 thread').open();
  },'Choose the source T3 project and machine').open();
}
export class ImportRunModal extends Modal {
  private follow=false;
  private submitted=false;
  constructor(app:App,private notePath:string,private thread:ThreadChoice,private run:ImportRun,private attach:(follow:boolean)=>Promise<RunImportResult>){super(app);}
  onOpen(){
    this.titleEl.setText('Import T3 run into this note');
    this.contentEl.createEl('p',{text:`${this.thread.title} · ${this.run.status} · ${this.run.createdAt||'Unknown date'}`});
    this.contentEl.createEl('p',{text:`Destination: ${this.notePath}`});
    this.contentEl.createEl('pre',{text:this.run.prompt.slice(0,4000),cls:'send-to-t3-import-prompt'});
    if(this.run.unavailable){this.contentEl.createEl('p',{text:this.run.unavailable});new Setting(this.contentEl).addButton(button=>button.setButtonText('Close').onClick(()=>this.close()));return;}
    this.contentEl.createEl('p',{text:'Copy this response into the note. A running response catches up and streams until it finishes. No new prompt is sent.'});
    new Setting(this.contentEl).setName('Follow future runs in this thread').setDesc('Also import every response after the selected run, including responses that have already finished, then stream new responses. Earlier runs are not imported. Use “Manage T3 streams in this note…” to pause or remove this.').addToggle(toggle=>toggle.setValue(false).onChange(value=>{this.follow=value;}));
    new Setting(this.contentEl).addButton(button=>button.setButtonText('Cancel').onClick(()=>this.close())).addButton(button=>button.setButtonText('Import response').setCta().onClick(()=>{
      if(this.submitted)return;
      this.submitted=true;
      const follow=this.follow;
      button.setDisabled(true);
      this.close();
      new Notice('Importing T3 response…',2000);
      void (async()=>{
        try{const result=await this.attach(follow);new Notice(runImportResultMessage(result),result.saveState==='pending'?10000:5000);}
        catch(error){new Notice(`Import T3 run: ${error instanceof Error?error.message:String(error)}`,10000);}
      })();
    }));
  }
  onClose(){this.contentEl.empty();}
}
export class ImportStreamsModal extends Modal {
  constructor(app:App,private notePath:string,private displays:Array<ThreadDisplay&{title:string}>,private execute:(display:ThreadDisplay,kind:'pause-thread-stream'|'resume-thread-stream'|'remove-stream-destination')=>Promise<ThreadDisplay>){super(app);}
  onOpen(){
    this.titleEl.setText('Manage T3 streams in this note');this.contentEl.empty();
    this.contentEl.createEl('p',{text:'These controls change future attachments. Existing responses finish normally; T3 work is not stopped.'});
    const visible=this.displays.filter(display=>!display.cancelled&&display.destinations.some(destination=>destination.path===this.notePath&&!destination.removed));
    if(!visible.length)this.contentEl.createEl('p',{text:'No future thread streams are registered for this note.'});
    for(const display of visible){
      const apply=(kind:'pause-thread-stream'|'resume-thread-stream'|'remove-stream-destination')=>async()=>{
        try{Object.assign(display,await this.execute(display,kind));this.onOpen();}catch(error){new Notice(`T3 streams: ${error instanceof Error?error.message:String(error)}`,10000);}
      };
      const count=display.destinations.filter(destination=>!destination.removed).length;
      new Setting(this.contentEl).setName(display.title).setDesc(`${display.enabled?'Following future runs':'Paused; runs started while paused are skipped'}${count>1?`. Pause and resume affect all ${count} destination notes. Remove affects only this note.`:''}`).addButton(button=>button.setButtonText(display.enabled?'Pause':'Resume').onClick(apply(display.enabled?'pause-thread-stream':'resume-thread-stream'))).addButton(button=>button.setButtonText('Remove from this note').onClick(apply('remove-stream-destination')));
    }
  }
  onClose(){this.contentEl.empty();}
}
