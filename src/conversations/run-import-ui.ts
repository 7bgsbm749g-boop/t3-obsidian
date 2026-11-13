import {Component,FuzzySuggestModal,Modal,Notice,Setting,setIcon,type App,type FuzzyMatch} from 'obsidian';
import {projectKey,type Project} from '../app/bridge';
import {abortableRead,requestAborted} from '../connection/t3-api';
import {clockForDocument} from '../shared/clock';
import type {ThreadChoice} from './thread-target';
import {availableImportRun,runImportResultMessage,type ImportRun,type RunImportResult} from './run-import';
import type {ThreadDisplay} from './thread-display';
import type {CatchUpThread} from './response-catch-up';

export interface RunImportHost {
  projects():Project[];projectLabel(project:Project):string;machineKey?(project:Project):string;
  threads(project:Project,signal?:AbortSignal):Promise<ThreadChoice[]>;
  watchThreads?(project:Project,changed:(threads:ThreadChoice[])=>void):()=>void;
  runs(project:Project,thread:ThreadChoice,signal?:AbortSignal,progress?:(runs:ImportRun[])=>void):Promise<ImportRun[]>;
  prepareSelection?(project:Project,thread:ThreadChoice,run:ImportRun):Promise<void>;
  attach(project:Project,thread:ThreadChoice,run:ImportRun,follow:boolean):Promise<RunImportResult>;
  attachAll?(project:Project,thread:ThreadChoice,runs:ImportRun[],follow:boolean):Promise<RunImportResult>;
  preview?(project:Project,thread:ThreadChoice,run:ImportRun,element:HTMLElement,component:Component,signal:AbortSignal):Promise<void>;
}
export const RUN_PREVIEW_DELAY=150;
export const IMPORT_THREAD_READ_TIMEOUT=15_000;
/** The native fuzzy picker keeps its search, selection and Enter behavior.
 * Only its run rows and the owned preview have a custom presentation. */
export class RunImportPicker extends FuzzySuggestModal<ImportRun>{
  private allAvailable=true;
  private all:ImportRun={messageId:'all-runs',prompt:'All runs',createdAt:'',status:'Completed'};
  private active?:{run:ImportRun;row:HTMLElement;root:HTMLElement;child:Component;abort:AbortController};
  private timer?:number;
  private exitTimer?:number;
  private observer?:MutationObserver;
  private closed=false;
  private keyboardPreview=false;
  private names=new WeakMap<ImportRun,{prompt:string;name:string}>();
  private status?:HTMLElement;private restoreSelection?:{messageId:string;query:string};
  constructor(app:App,private runs:ImportRun[],private choose:(run:ImportRun)=>void,private preview:(run:ImportRun,el:HTMLElement,child:Component,signal:AbortSignal)=>Promise<void>,private exited?:()=>void,private loading=false,private options?:{all:(runs:ImportRun[])=>void;project:string;thread:string;back:()=>void}){
    super(app);this.setPlaceholder('Choose a T3 response');this.emptyStateText=loading?'Loading T3 runs…':'No available runs.';
  }
  setRuns(runs:ImportRun[],loading=false,error?:string){
    if(this.closed)return;
    const selected=this.modalEl.querySelector<HTMLElement>('.suggestion-item.is-selected')?.dataset.t3ImportRun;
    this.restoreSelection=selected?{messageId:selected,query:this.inputEl.value}:undefined;
    this.clear();this.runs=runs;this.loading=loading;this.allAvailable=!error;this.emptyStateText=error??(loading?'Loading T3 runs…':'No available runs.');
    this.updateStatus(error);this.inputEl.dispatchEvent(new Event('input'));
  }
  private updateStatus(error?:string){if(this.status){this.status.hidden=!this.loading&&!error;this.status.setText(error??'Loading earlier runs…');}}
  private restoreSelected(){
    const saved=this.restoreSelection;if(!saved||this.inputEl.value!==saved.query){this.restoreSelection=undefined;return;}
    const rows=Array.from(this.modalEl.querySelectorAll<HTMLElement>('.suggestion-item')),index=rows.findIndex(row=>row.dataset.t3ImportRun===saved.messageId);
    if(index<0)return;
    const chooser=(this as unknown as {chooser?:{setSelectedItem?:(index:number,scroll:boolean)=>void}}).chooser;
    if(typeof chooser?.setSelectedItem==='function')chooser.setSelectedItem(index,false);
    this.restoreSelection=undefined;
  }
  getItems(){const runs=this.runs.filter(availableImportRun);return this.options&&this.allAvailable&&!this.loading&&runs.length?[this.all,...runs]:runs;}
  getItemText(run:ImportRun){
    const cached=this.names.get(run);if(cached?.prompt===run.prompt)return cached.name;
    const name=run.prompt.replace(/\s+/g,' ').trim();this.names.set(run,{prompt:run.prompt,name});return name;
  }
  renderSuggestion(match:FuzzyMatch<ImportRun>,el:HTMLElement){
    const run=match.item;
    if(run===this.all){el.addClass('send-to-t3-all-runs');const heading=el.createDiv({cls:'send-to-t3-run-heading'});setIcon(heading.createSpan({cls:'send-to-t3-import-icon'}),'list-checks');heading.createSpan({cls:'send-to-t3-run-name',text:'All runs'});el.createDiv({cls:'send-to-t3-import-meta',text:`Import all ${this.runs.filter(availableImportRun).length} available responses · oldest first`});el.addEventListener('pointerenter',()=>this.clear());return;}
    el.dataset.t3ImportRun=run.messageId;el.addClass('send-to-t3-run-row');
    const heading=el.createDiv({cls:'send-to-t3-run-heading',attr:{title:run.status}}),icon=heading.createSpan({cls:'send-to-t3-run-status',attr:{'aria-hidden':'true'}});
    icon.dataset.status=run.status;
    if(run.status!=='Running')setIcon(icon,run.status==='Completed'?'check':run.status==='Failed'?'x':'pause');
    // The picker searches the complete prompt. Its two-line row needs only a
    // short title, including in the native accessibility tree.
    const name=this.getItemText(run),title=name.length>360?name.slice(0,359).replace(/[\uD800-\uDBFF]$/,'')+'…':name;
    const label=heading.createSpan({cls:'send-to-t3-run-name',text:title});
    label.createSpan({cls:'send-to-t3-run-status-text',text:` (${run.status})`});
    el.createDiv({cls:'send-to-t3-import-meta',text:importDate(run.createdAt)});
    el.addEventListener('pointerenter',()=>{if(!this.keyboardPreview)this.prepare(run,el);});
    el.addEventListener('pointermove',event=>{if(event.movementX||event.movementY){this.keyboardPreview=false;this.prepare(run,el);}});
    el.addEventListener('pointerleave',()=>{if(!this.keyboardPreview)this.exitTimer=el.ownerDocument.defaultView!.setTimeout(()=>this.clear(),140);});
    el.addEventListener('focusin',()=>this.prepare(run,el));
  }
  onOpen(){
    void super.onOpen();this.modalEl.addClass('send-to-t3-run-picker');
    if(this.options){const header=this.modalEl.createDiv({cls:'send-to-t3-import-context'});this.modalEl.insertBefore(header,this.inputEl.parentElement);const back=header.createEl('button',{text:'Back to threads',cls:'send-to-t3-import-back'});back.addEventListener('click',()=>{const action=this.options!.back;this.close();action();});header.createDiv({cls:'send-to-t3-import-project',text:this.options.project});header.createDiv({cls:'send-to-t3-import-title',text:this.options.thread});}
    this.status=this.modalEl.createDiv({cls:'send-to-t3-import-status',attr:{role:'status','aria-live':'polite'}});this.updateStatus();
    const doc=this.modalEl.ownerDocument,win=doc.defaultView!;
    this.observer=new win.MutationObserver(()=>{
      if(this.active&&!this.active.row.isConnected)this.clear();
      this.restoreSelected();
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
      if(row&&run)this.prepare(run,row);else this.clear();
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
  onChooseItem(run:ImportRun){if(run===this.all){if(!this.loading&&this.allAvailable)this.options?.all(this.runs.filter(availableImportRun));}else if(availableImportRun(run))this.choose(run);}
  onClose(){this.closed=true;this.clear();this.observer?.disconnect();this.modalEl.ownerDocument.defaultView!.removeEventListener('keydown',this.keyboard,true);queueMicrotask(()=>this.exited?.());super.onClose();}
}
export interface ImportThread extends ThreadChoice {project:Project;projectLabel:string}
export function importDate(value:string){const date=new Date(value);return Number.isFinite(date.getTime())?date.toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'Unknown date';}
export function recentImportThreads(groups:Array<{project:Project;label:string;threads:ThreadChoice[]}>):ImportThread[]{
  return groups.flatMap(group=>group.threads.map(thread=>({...thread,project:group.project,projectLabel:group.label})))
    .sort((a,b)=>(Date.parse(b.updatedAt)||0)-(Date.parse(a.updatedAt)||0)||projectKey(a.project).localeCompare(projectKey(b.project))||a.id.localeCompare(b.id));
}
export class ImportThreadPicker extends FuzzySuggestModal<ImportThread>{
  private selected=false;private closed=false;private stops:Array<()=>void>=[];
  private reads=new AbortController();
  private items:ImportThread[]=[];private status?:HTMLElement;private observer?:MutationObserver;private restoreSelection?:{key:string;query:string};
  constructor(app:App,private host:RunImportHost,private flow:AbortController,private choose:(item:ImportThread)=>Promise<void>,private prepare:(item:ImportThread|undefined)=>void){super(app);this.setPlaceholder('Search recent threads, projects or machines…');this.emptyStateText='Loading T3 threads…';}
  getItems(){return this.items;}
  getItemText(item:ImportThread){return `${item.title} ${item.projectLabel} ${item.branch??''} ${item.status} ${item.id}`;}
  getSuggestions(query:string){const matches=super.getSuggestions(query);this.prepare(query.trim()&&matches.length===1?matches[0].item:undefined);return matches;}
  renderSuggestion(match:FuzzyMatch<ImportThread>,el:HTMLElement){
    const item=match.item;el.addClass('send-to-t3-import-thread');el.dataset.t3ImportThread=`${projectKey(item.project)}:${item.id}`;
    el.createDiv({cls:'send-to-t3-import-project',text:item.project.title});
    el.createDiv({cls:'send-to-t3-import-title',text:item.title});
    const meta=el.createDiv({cls:'send-to-t3-import-meta'}),status=meta.createSpan({cls:'send-to-t3-import-thread-status',text:item.status==='Active'?'Working':'Idle'});status.dataset.status=item.status;
    if(item.branch)meta.createSpan({text:item.branch});
    meta.createSpan({text:`${item.project.connectionName??'T3'} · ${importDate(item.updatedAt)} · ${item.id.slice(0,8)}`});
  }
  onOpen(){
    void super.onOpen();this.modalEl.addClass('send-to-t3-thread-picker');
    this.status=this.modalEl.createDiv({cls:'send-to-t3-import-status',attr:{role:'status','aria-live':'polite'}});this.status.setText('Recent threads · all projects');
    const win=this.modalEl.ownerDocument?.defaultView;
    if(win){this.observer=new win.MutationObserver(()=>{const saved=this.restoreSelection;if(!saved)return;if(this.inputEl.value!==saved.query){this.restoreSelection=undefined;return;}const rows=Array.from(this.modalEl.querySelectorAll<HTMLElement>('[data-t3-import-thread]')),index=rows.findIndex(row=>row.dataset.t3ImportThread===saved.key);if(index<0)return;const chooser=(this as unknown as {chooser?:{setSelectedItem?:(index:number,scroll:boolean)=>void}}).chooser;chooser?.setSelectedItem?.(index,false);this.restoreSelection=undefined;});this.observer.observe(this.modalEl,{childList:true,subtree:true});}
    this.flow.signal.addEventListener('abort',this.stopLoading,{once:true});void this.load();
  }
  private stopWatching=()=>{for(const stop of this.stops)stop();this.stops=[];};
  private stopLoading=()=>{this.reads.abort(this.flow.signal.reason);this.stopWatching();};
  private async load(){
    const projects=this.host.projects(),groups:Array<{project:Project;label:string;threads:ThreadChoice[]}>=[];let pending=projects.length;const failed:string[]=[];
    const machines=new Map<string,Project[]>(),clock=clockForDocument(this.modalEl.ownerDocument);
    for(const project of projects){const key=this.host.machineKey?.(project)??project.connectionId??'local',queue=machines.get(key)??[];queue.push(project);machines.set(key,queue);}
    const publish=()=>{
      if(this.closed||this.flow.signal.aborted)return;
      const selected=this.modalEl.querySelector<HTMLElement>('.suggestion-item.is-selected')?.dataset.t3ImportThread;this.restoreSelection=selected?{key:selected,query:this.inputEl.value}:undefined;
      this.items=recentImportThreads(groups);this.emptyStateText=pending?'Loading T3 threads…':failed.length?'Threads could not be loaded. Check the T3 connection and reopen import.':'No recent threads in your connected projects.';
      this.status?.setText(pending?`Recent threads · loading ${pending} projects…`:failed.length?`Could not load ${failed.join(', ')}. Other projects are shown. Reopen import to retry.`:`Recent threads · all ${projects.length} projects`);
      this.inputEl.dispatchEvent(new Event('input'));
    };
    // Only one read per machine can hold a slot. Requeue that machine after
    // each project so healthy machines can continue without a round barrier.
    const queued=[...machines.values()];
    await Promise.all(Array.from({length:Math.min(4,queued.length)},async()=>{for(;;){
      if(this.closed||this.flow.signal.aborted)return;
      const queue=queued.shift();if(!queue)return;
      const project=queue.shift()!;
      const controller=new AbortController(),cancel=()=>controller.abort(this.reads.signal.reason);
      this.reads.signal.addEventListener('abort',cancel,{once:true});
      const timer=clock.setTimeout(()=>controller.abort(Error('Thread loading timed out.')),IMPORT_THREAD_READ_TIMEOUT);
      try{
        requestAborted(this.reads.signal);
        const threads=await abortableRead(this.host.threads(project,controller.signal),controller.signal);if(this.closed||this.flow.signal.aborted)return;
        const group={project,label:this.host.projectLabel(project),threads};groups.push(group);
        const stop=this.host.watchThreads?.(project,threads=>{group.threads=threads;publish();});if(stop)this.stops.push(stop);
      }catch{if(!this.flow.signal.aborted)failed.push(this.host.projectLabel(project));}
      finally{clock.clearTimeout(timer);this.reads.signal.removeEventListener('abort',cancel);pending--;publish();}
      if(queue.length)queued.push(queue);
    }}));if(!projects.length)publish();
  }
  onChooseItem(item:ImportThread){this.selected=true;void this.choose(item).catch(error=>{if(!this.flow.signal.aborted)new Notice(`Import T3 run: ${error instanceof Error?error.message:String(error)}`,10000);});}
  onClose(){this.closed=true;this.observer?.disconnect();this.stopLoading();this.flow.signal.removeEventListener('abort',this.stopLoading);queueMicrotask(()=>{if(!this.selected)this.flow.abort();});super.onClose();}
}
const importFlows=new WeakMap<App,AbortController>();
export function openRunImport(app:App,notePath:string,host:RunImportHost){
  importFlows.get(app)?.abort();const flow=new AbortController();importFlows.set(app,flow);
  const current=()=>!flow.signal.aborted&&importFlows.get(app)===flow;
  const finish=()=>{flow.abort();if(importFlows.get(app)===flow)importFlows.delete(app);};
  const failure=(error:unknown)=>error instanceof Error?error.message:String(error);
  let prepared:{key:string;controller:AbortController;work:Promise<ImportRun[]>;runs:ImportRun[]}|undefined;
  let publish:((runs:ImportRun[])=>void)|undefined;
  const prepare=(thread:ImportThread|undefined)=>{
    const key=thread?`${projectKey(thread.project)}:${thread.id}`:undefined;if(prepared?.key===key)return;
    prepared?.controller.abort();prepared=undefined;
    if(!thread||!current())return;
    const controller=new AbortController(),cancel=()=>controller.abort(flow.signal.reason);
    flow.signal.addEventListener('abort',cancel,{once:true});
    const progress=(runs:ImportRun[])=>{if(prepared?.controller!==controller||controller.signal.aborted||!current())return;prepared.runs=runs;publish?.(runs);};
    const work=Promise.resolve().then(()=>{if(controller.signal.aborted)throw controller.signal.reason;return host.runs(thread.project,thread,controller.signal,progress);}).finally(()=>flow.signal.removeEventListener('abort',cancel));
    void work.catch(()=>{});prepared={key: key!,controller,work,runs:[]};
  };
  new ImportThreadPicker(app,host,flow,async thread=>{
    prepare(thread);if(!current()||!prepared)return;
    const project=thread.project;
    const picker=new RunImportPicker(app,prepared.runs,run=>{
      if(!current())return;finish();
      void Promise.resolve().then(()=>host.prepareSelection?.(project,thread,run)).catch(()=>{});
      new ImportRunModal(app,notePath,thread,run,follow=>host.attach(project,thread,run,follow)).open();
    },(run,el,child,signal)=>host.preview?host.preview(project,thread,run,el,child,signal):Promise.resolve().then(()=>{el.setText('No preview available.');}),()=>{if(current())finish();},true,host.attachAll?{
      project:thread.projectLabel,thread:thread.title,back:()=>openRunImport(app,notePath,host),
      all:runs=>{if(!current()||!runs.length)return;finish();new ImportRunModal(app,notePath,thread,runs[runs.length-1],follow=>host.attachAll!(project,thread,runs,follow),runs.length).open();},
    }:undefined);
    publish=runs=>picker.setRuns(runs,true);picker.open();
    try{const runs=await prepared.work;if(current())picker.setRuns(runs);}catch(error){if(current())picker.setRuns(prepared.runs,false,failure(error));}
  },prepare).open();
}
export class ImportRunModal extends Modal {
  private follow=false;
  private submitted=false;
  constructor(app:App,private notePath:string,private thread:ThreadChoice,private run:ImportRun,private attach:(follow:boolean)=>Promise<RunImportResult>,private allCount?:number){super(app);}
  onOpen(){
    this.titleEl.setText(this.allCount?'Import all T3 runs into this note':'Import T3 run into this note');
    this.contentEl.createEl('p',{text:this.allCount?`${this.thread.title} · ${this.allCount} responses`:`${this.thread.title} · ${this.run.status} · ${this.run.createdAt||'Unknown date'}`});
    this.contentEl.createEl('p',{text:`Destination: ${this.notePath}`});
    if(this.allCount)this.contentEl.createEl('p',{text:`Append all ${this.allCount} available responses to the end of this note, oldest first. Existing imports are not duplicated. New runs are included only if you turn on follow below.`});
    else this.contentEl.createEl('pre',{text:this.run.prompt.slice(0,4000),cls:'send-to-t3-import-prompt'});
    if(this.run.unavailable){this.contentEl.createEl('p',{text:this.run.unavailable});new Setting(this.contentEl).addButton(button=>button.setButtonText('Close').onClick(()=>this.close()));return;}
    this.contentEl.createEl('p',{text:this.allCount?'Running responses catch up and stream until they finish. No new prompt is sent.':'Copy this response into the note. A running response catches up and streams until it finishes. No new prompt is sent.'});
    new Setting(this.contentEl).setName('Follow future runs in this thread').setDesc(this.allCount?'Also stream new responses after this import. Use “Manage T3 streams in this note…” to pause or remove this.':'Also import every response after the selected run, including responses that have already finished, then stream new responses. Earlier runs are not imported. Use “Manage T3 streams in this note…” to pause or remove this.').addToggle(toggle=>toggle.setValue(false).onChange(value=>{this.follow=value;}));
    new Setting(this.contentEl).addButton(button=>button.setButtonText('Cancel').onClick(()=>this.close())).addButton(button=>button.setButtonText(this.allCount?`Import all ${this.allCount} runs`:'Import response').setCta().onClick(()=>{
      if(this.submitted)return;
      this.submitted=true;
      const follow=this.follow;
      button.setDisabled(true);
      this.close();
      new Notice(this.allCount?`Importing ${this.allCount} T3 responses…`:'Importing T3 response…',2000);
      void (async()=>{
        try{const result=await this.attach(follow);const text=this.allCount?`${result.duplicate?'All responses were already imported.':result.saveState==='saved'?`All ${this.allCount} responses imported and saved.`:`All ${this.allCount} responses attached; waiting for running responses to finish.`}${result.following?' Following future runs.':''}`:runImportResultMessage(result);new Notice(text,result.saveState==='pending'?10000:5000);}
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

export function openResponseCatchUp(app:App,notePath:string,threads:CatchUpThread[],execute:(threads:CatchUpThread[])=>Promise<void>){
  const run=(selected:CatchUpThread[])=>{
    void execute(selected).catch(error=>new Notice(`Catch up on responses: ${error instanceof Error?error.message:String(error)}`,10000));
  };
  if(threads.length===1){run(threads);return;}
  if(threads.length)new ResponseCatchUpModal(app,notePath,threads,run).open();
}
export class ResponseCatchUpModal extends Modal {
  private selected:Set<CatchUpThread>;
  private submitted=false;
  constructor(app:App,private notePath:string,private threads:CatchUpThread[],private execute:(threads:CatchUpThread[])=>void){super(app);this.selected=new Set(threads);}
  onOpen(){
    this.titleEl.setText('Catch up on responses');
    this.contentEl.createEl('p',{text:`Import responses after the last response streamed from each selected thread into ${this.notePath}. No new prompt is sent. Future stream settings stay the same.`});
    let update=()=>{};
    for(const thread of this.threads)new Setting(this.contentEl).setName(thread.title).setDesc(`${thread.environmentId} · ${thread.threadId}`).addToggle(toggle=>toggle.setValue(this.selected.has(thread)).onChange(value=>{if(value)this.selected.add(thread);else this.selected.delete(thread);update();}));
    new Setting(this.contentEl).addButton(button=>button.setButtonText('Cancel').onClick(()=>this.close())).addButton(button=>{
      update=()=>button.setDisabled(!this.selected.size);update();
      button.setButtonText('Catch up on responses').setCta().onClick(()=>{
        if(this.submitted||!this.selected.size)return;
        this.submitted=true;button.setDisabled(true);
        const selected=this.threads.filter(thread=>this.selected.has(thread));this.close();this.execute(selected);
      });
    });
  }
  onClose(){this.contentEl.empty();}
}
