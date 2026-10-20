import {FuzzySuggestModal,Modal,Notice,Setting,type App} from 'obsidian';
import type {Project} from './bridge';
import type {ThreadChoice} from './thread-target';
import type {ImportRun} from './run-import';
import type {ThreadDisplay} from './thread-display';

export interface RunImportHost {
  projects():Project[];projectLabel(project:Project):string;
  threads(project:Project):Promise<ThreadChoice[]>;
  runs(project:Project,thread:ThreadChoice):Promise<ImportRun[]>;
  attach(project:Project,thread:ThreadChoice,run:ImportRun,follow:boolean):Promise<{duplicate:boolean;following:boolean}>;
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
      new ImportPicker(app,runs,run=>`${run.status} · ${run.createdAt||'Unknown date'} · ${run.prompt.replace(/\s+/g,' ').slice(0,110)}`,async run=>{
        new ImportRunModal(app,notePath,thread,run,follow=>host.attach(project,thread,run,follow)).open();
      },'Choose a completed or running T3 response').open();
    },'Choose the source T3 thread').open();
  },'Choose the source T3 project and machine').open();
}
export class ImportRunModal extends Modal {
  private follow=false;
  constructor(app:App,private notePath:string,private thread:ThreadChoice,private run:ImportRun,private attach:(follow:boolean)=>Promise<{duplicate:boolean;following:boolean}>){super(app);}
  onOpen(){
    this.titleEl.setText('Import T3 run into this note');
    this.contentEl.createEl('p',{text:`${this.thread.title} · ${this.run.status} · ${this.run.createdAt||'Unknown date'}`});
    this.contentEl.createEl('p',{text:`Destination: ${this.notePath}`});
    this.contentEl.createEl('pre',{text:this.run.prompt.slice(0,4000),cls:'send-to-t3-import-prompt'});
    if(this.run.unavailable){this.contentEl.createEl('p',{text:this.run.unavailable});new Setting(this.contentEl).addButton(button=>button.setButtonText('Close').onClick(()=>this.close()));return;}
    this.contentEl.createEl('p',{text:'Copy this response into the note. A running response catches up and streams until it finishes. No new prompt is sent.'});
    new Setting(this.contentEl).setName('Follow future runs in this thread').setDesc('Also import every response after the selected run, including responses that have already finished, then stream new responses. Earlier runs are not imported. Use “Manage T3 streams in this note…” to pause or remove this.').addToggle(toggle=>toggle.setValue(false).onChange(value=>{this.follow=value;}));
    new Setting(this.contentEl).addButton(button=>button.setButtonText('Cancel').onClick(()=>this.close())).addButton(button=>button.setButtonText('Import response').setCta().onClick(()=>{
      button.setDisabled(true);
      void this.attach(this.follow).then(result=>{new Notice(`${result.duplicate?'This response is already in the note.':'Response attached; catching up with T3.'}${result.following?' Later responses are also attached, including completed runs.':''}`);this.close();}).catch(error=>{button.setDisabled(false);new Notice(`Import T3 run: ${error instanceof Error?error.message:String(error)}`,10000);});
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
