import {Plugin,apiVersion,MarkdownView,setIcon,type Component} from 'obsidian';
import SendToT3 from '../../src/app/main';
import {DeviceResponseManager} from '../../src/responses/device-local-responses';
import {deviceNoteIO,deviceFinalNoteIO} from '../../src/conversations/inline-note-io';
import {nativeResponses} from '../../src/responses/native-response-manager';
import {hiddenInlineMarkerExtension} from '../../src/conversations/inline-markers';
import {installResponsePresentation} from '../../src/responses/response-presentation';
import {updateResponseBindingData,responseBindingRequests} from '../../src/responses/response-binding-data';
import {environmentApi,type PairedSession} from '../../src/connection/direct';
import {openRunImport} from '../../src/conversations/run-import-ui';
import {readInlineSnapshot,type ThreadAccess} from '../../src/conversations/thread-stream';
import {applyThreadItem,inlineTurnMessages,quoteResponse} from '../../src/conversations/inline-thread';
import {availableImportRun,importRuns,importRunPreview} from '../../src/conversations/run-import';
import {projectThreads} from '../../src/conversations/thread-target';
import {readThreadList,readWireProjects} from '../../src/connection/wire-readers';
import type {Project} from '../../src/app/bridge';
import {renderRunImportPreview} from '../../src/conversations/run-import-preview';
import {readImportThreads,readImportRuns,readImportPreview} from '../../src/conversations/import-source';
import {HtmlResultStore} from '../../src/responses/html-result-store';
import {HtmlResultViews} from '../../src/responses/html-result-view';
import {configureDiagnostics,EventJournal} from '../../src/app/diagnostics';

const fs=require('node:fs'),path=require('node:path');
interface Source {label:string;session:PairedSession;threadId:string;projectId:string;runId?:string}

/** External read-only credentials and original records stay outside the source
 * tree. Native input drives the production pickers; no original is changed. */
export default class ImportPerformanceLab extends Plugin {
 private root='';private sources:Source[]=[];private projects:Project[]=[];
 private start=0;private action=0;private measured=new WeakSet<Element>();private source?:Source;
 private rowsMeasured=new WeakSet<Element>();
 private paneStarts=new Map<string,{start:number;action:number;source?:string}>();
 private inputBoundaries=new WeakMap<Event,{start:number;action:number}>();
 private optimized=false;
 private productionAccess=false;
 private htmlViews?:HtmlResultViews;
 private accesses=new Map<string,Awaited<ReturnType<typeof environmentApi>>>();
 private catalogs=new Map<string,Project[]>();
 private local?:DeviceResponseManager;
 private notes=new Set<string>();private trial=0;
 private importing?:{start:number;action:number;source:string;view:MarkdownView;expected?:string;bindingId?:string;measured?:boolean};
 private write(value:unknown){fs.appendFileSync(path.join(this.root,'PANES.ndjson'),JSON.stringify(value)+'\n');}
 private captureInput(event:Event){
  if(!event.isTrusted)return;
  let boundary=this.inputBoundaries.get(event);
  if(!boundary){boundary={start:event.timeStamp,action:++this.action};this.inputBoundaries.set(event,boundary);this.write({kind:'input',source:this.source?.label,action:boundary.action,startTime:boundary.start,event:event.type,key:event instanceof KeyboardEvent&&['ArrowDown','ArrowUp','Enter','Escape'].includes(event.key)?event.key:undefined});}
  this.start=boundary.start;
 }
 private paneOrigin(){
  // Obsidian can invoke a chooser before the lab's window listener. Reuse
  // that exact trusted event, including across listener microtask checkpoints.
  const event=window.event;if(event?.isTrusted&&['keydown','pointerdown'].includes(event.type))this.captureInput(event);
  return {start:this.start,action:this.action,source:this.source?.label};
 }
 async onload(){
  this.root=path.dirname((this.app.vault.adapter as any).getFullPath(''));
  if(!fs.existsSync(path.join(this.root,'ISOLATED-NATIVE-LAB')))throw Error('Use an isolated vault.');
  const config=JSON.parse(fs.readFileSync(path.join(this.root,'LAB.json'),'utf8'));
  const journal=new EventJournal({load:async()=>undefined,save:async()=>{},id:()=>this.manifest.id,context:{deviceId:'isolated-import-performance'}}),record=journal.record.bind(journal);
  journal.record=(event,fields={},level='info')=>{if(event==='import.index.cache')this.write({kind:'index-cache',...fields});return record(event,fields,level);};
  configureDiagnostics(journal);this.register(()=>configureDiagnostics());
  this.write({kind:'runtime',obsidianVersion:apiVersion,userAgent:navigator.userAgent});
  for(const entryType of ['longtask','resource']){
   const observer=new PerformanceObserver(list=>{for(const entry of list.getEntries()){
    if(entryType==='resource'){
     const url=new URL(entry.name);if(!url.pathname.includes('/orchestration/')&&url.pathname!=='/api/auth/session')continue;
     this.write({kind:'resource',route:url.pathname,startTime:entry.startTime,elapsedMs:entry.duration});
    }else this.write({kind:'longtask',startTime:entry.startTime,elapsedMs:entry.duration});
   }});observer.observe({type:entryType,buffered:true});this.register(()=>observer.disconnect());
  }
  this.sources=config.sources;this.optimized=config.optimized===true;
  this.productionAccess=config.productionAccess===true;
  // These names are generated only by this guarded private lab. Retain their
  // ownership across reloads so the cleanup command removes every trial.
  for(const file of this.app.vault.getMarkdownFiles())if(/^(?:Reference|Virtual|Import-(?:vps-0|vps-1|vps-largest-run|laptop-largest(?:-run)?)-\d+)\.md$/.test(file.path))this.notes.add(file.path);
  const native=nativeResponses(this.app);this.register(()=>native.dispose());
  this.registerEditorExtension(hiddenInlineMarkerExtension());
  const {EditorState}=require('@codemirror/state');this.registerEditorExtension(EditorState.transactionFilter.of((tr:any)=>native.filter(tr)));
  this.register(installResponsePresentation(document,setIcon));
  this.registerInterval(window.setInterval(()=>{native.refresh();this.local?.tick();},100));
  this.register(()=>this.local?.dispose());
  const pages=new Map<string,unknown>();
  const store=new HtmlResultStore({read:async key=>pages.get(key),write:async(key,value)=>{pages.set(key,value);}},async environmentId=>{
   const source=this.sources.find(source=>source.session.environmentId===environmentId);if(!source)throw Error('Unknown test source.');
   const session=source.session;
   return {origin:session.url,api:await environmentApi({transport:'direct',host:'direct',executable:'',url:session.url,environmentId},session)};
  },async url=>{const result=await fetch(url);return {status:result.status,mimeType:result.headers.get('content-type')??'',bytes:await result.arrayBuffer()};});
  const views=new HtmlResultViews(this.app,store);views.install(this);this.htmlViews=views;this.register(()=>{views.dispose();store.dispose();pages.clear();});
  const capture=(event:Event)=>this.captureInput(event);
  let hovered:Element|null=null;
  const hover=(event:PointerEvent)=>{const row=(event.target as Element).closest?.('[data-t3-import-run]')??null;if(event.isTrusted&&(event.movementX||event.movementY)&&row!==hovered){hovered=row;if(row)capture(event);}};
  window.addEventListener('pointerdown',capture,true);window.addEventListener('keydown',capture,true);
  document.addEventListener('pointermove',hover,true);
  this.register(()=>{window.removeEventListener('pointerdown',capture,true);window.removeEventListener('keydown',capture,true);document.removeEventListener('pointermove',hover,true);});
  const observer=new MutationObserver(()=>this.measure());observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class','aria-label','data-t3-html-state','data-t3-html-painted']});this.register(()=>observer.disconnect());
  for(const [index,source] of this.sources.entries())this.addCommand({id:'source-'+index,name:'Measure import '+index,callback:()=>void this.show(source)});
  this.addCommand({id:'cleanup',name:'Delete owned import test notes',callback:()=>void (async()=>{this.local?.dispose();for(const file of this.app.vault.getMarkdownFiles())if(/^(?:Reference|Virtual|Import-(?:vps-0|vps-1|vps-largest-run|laptop-largest(?:-run)?)-\d+)\.md$/.test(file.path))this.notes.add(file.path);for(const leaf of this.app.workspace.getLeavesOfType('markdown'))if(this.notes.has((leaf.view as MarkdownView).file?.path??''))leaf.detach();for(const path of this.notes){const file=this.app.vault.getFileByPath(path);if(file)await this.app.vault.delete(file);}this.write({kind:'cleanup',deletedNotes:[...this.notes],remainingOwnedNotes:[...this.notes].filter(path=>this.app.vault.getFileByPath(path))});})()});
  this.app.workspace.onLayoutReady(()=>void (async()=>{
   for(const source of this.sources){const session=source.session;if(this.accesses.has(session.environmentId))continue;const api=await environmentApi({transport:'direct',host:'direct',executable:'',url:session.url,environmentId:session.environmentId},session);this.accesses.set(session.environmentId,api);this.catalogs.set(session.environmentId,readWireProjects(await api('/api/orchestration/shell')));}
   this.write({kind:'setup-ready',environments:this.accesses.size});
  })().catch(error=>this.write({kind:'setup-failed',error:String(error)})));
 }
 private measure(){
  const input=document.querySelector<HTMLInputElement>('.prompt-input'),placeholder=input?.placeholder;
  const confirmation=Array.from(document.querySelectorAll<HTMLElement>('.modal-title')).find(el=>el.textContent==='Import T3 run into this note')?.closest('.modal');
  const preview=document.querySelector<HTMLElement>('.is-previewing .send-to-t3-run-preview-body');
  const record=(element:Element,label:string)=>{
   if(this.measured.has(element))return;this.measured.add(element);
   const rows=document.querySelectorAll('.suggestion-item').length;
   // A read can begin during a typed filter. The pane belongs to the later
   // explicit Enter, including when Obsidian handles it before our listener.
   const stored=this.paneStarts.get(label),current=this.paneOrigin(),origin=stored&&stored.action>=current.action?stored:current;
   this.paneStarts.set(label,origin);
   requestAnimationFrame(()=>requestAnimationFrame(()=>{if(element.isConnected)this.write({kind:'pane',source:origin.source,action:origin.action,placeholder:label,elapsedMs:performance.now()-origin.start,rows,interactive:element instanceof HTMLInputElement?!element.disabled:undefined,at:new Date().toISOString()});}));
  };
  if(input&&placeholder&&!input.disabled){
   record(input,placeholder);
   if(document.querySelector('.suggestion-item')&&!this.rowsMeasured.has(input)){
    this.rowsMeasured.add(input);const origin=this.paneStarts.get(placeholder)??this.paneOrigin(),rows=document.querySelectorAll('.suggestion-item').length;
    requestAnimationFrame(()=>requestAnimationFrame(()=>{if(input.isConnected)this.write({kind:'rows-ready',source:origin.source,action:origin.action,placeholder,elapsedMs:performance.now()-origin.start,rows});}));
   }
  }
  if(confirmation&&Array.from(confirmation.querySelectorAll('button')).some(button=>button.textContent==='Import response'))record(confirmation,'Import T3 run into this note');
  const frames=preview?Array.from(preview.querySelectorAll<HTMLElement>('.send-to-t3-html-result')):[];
  if(preview&&!preview.querySelector('.send-to-t3-run-preview-loading')&&!preview.textContent?.includes('Preview could not be loaded.')&&(preview.textContent?.trim()||frames.length)&&frames.every(frame=>frame.dataset.t3HtmlState==='ready'&&frame.dataset.t3HtmlPainted==='true'))record(preview,'Response preview');
  const importing=this.importing;
  const plain=(text:string)=>text.replace(/\[([^\]]+)\]\([^)]+\)/g,'$1').replace(/[*_`>#]/g,'').replace(/\s+/g,' ').trim();
  const answerLine=importing?.expected?.split('\n').map(plain).find(Boolean)?.slice(0,100);
  const visible=(element:HTMLElement)=>{const box=element.getBoundingClientRect();return box.bottom>0&&box.top<innerHeight&&box.width>0&&box.height>0;};
  const prosePainted=!!answerLine&&Array.from(importing?.view.contentEl.querySelectorAll<HTMLElement>('.cm-line,.callout-content p,.callout-content li,.callout-content h1,.callout-content h2,.callout-content h3')??[]).some(line=>visible(line)&&plain(line.textContent??'').includes(answerLine));
  const htmlFrames=Array.from(importing?.view.contentEl.querySelectorAll<HTMLElement>('.send-to-t3-html-result')??[]).filter(visible);
  const htmlReady=htmlFrames.every(frame=>frame.dataset.t3HtmlState==='ready'&&frame.dataset.t3HtmlPainted==='true');
  const rawHtml=Array.from(importing?.view.contentEl.querySelectorAll<HTMLElement>('.cm-line.HyperMD-codeblock,pre code')??[]).some(line=>visible(line)&&(line.textContent??'').includes('"environmentId"')&&(line.textContent??'').includes('"attachmentId"'));
  const painted=!document.querySelector('.modal')&&!rawHtml&&htmlReady&&(prosePainted||htmlFrames.length>0);
  const displayed=importing?.bindingId?nativeResponses(this.app).view(importing.view)?.responseBody(importing.bindingId):undefined;
  if(importing&&!importing.measured&&importing.expected&&painted&&displayed&&(displayed.includes(importing.expected)||displayed.includes(quoteResponse(importing.expected)))){
   importing.measured=true;requestAnimationFrame(()=>requestAnimationFrame(()=>this.write({kind:'pane',source:importing.source,action:importing.action,placeholder:'Imported response',elapsedMs:performance.now()-importing.start,visibleHtmlFrames:htmlFrames.length,htmlPainted:htmlReady,at:new Date().toISOString()})));
  }
 }
 private async show(source:Source){
  this.source=source;
  try{
   const session=source.session,connection={transport:'direct' as const,host:'direct',executable:'',url:session.url,environmentId:session.environmentId};
   const api=this.accesses.get(session.environmentId);if(!api)throw Error('Wait for the isolated lab setup.');
   // Include the real route selection, session lookup and authorization cache.
   // This instance owns only the private fixture's read-only paired credential.
   let routing:any;
   if(this.productionAccess){
    routing=new SendToT3(this.app,this.manifest);
    const paired={id:'isolated-import-route',name:'Isolated import source',url:session.url,environmentId:session.environmentId,routeKind:session.url.startsWith('https:')?'https':'local'};
    routing.settings={paired:[paired],directProjects:[],folderLinks:[],vaultId:'isolated-import-performance',responseBindings:{},noteThreads:[]};
    routing.pairedSessions={[paired.id]:session};routing.routeOrder=[paired.id];
   }
   const accessFor=async():Promise<ThreadAccess>=>routing?await routing.inlineThreadAccess(session.environmentId):{origin:session.url,api};
   const read=async<T>(work:(access:ThreadAccess)=>Promise<T>)=>{const access=await accessFor();try{return await work(access);}finally{await access.close?.();}};
   this.projects=this.catalogs.get(session.environmentId)!;
   let notePath:string;do{notePath=`Import-${source.label}-${++this.trial}.md`;}while(this.app.vault.getFileByPath(notePath));this.notes.add(notePath);const file=await this.app.vault.create(notePath,'# Imported run\n\nOrdinary text before.\n\n');const leaf=this.app.workspace.getLeaf(false);await leaf.openFile(file);await leaf.setViewState({type:'markdown',state:{file:notePath,mode:'source',source:false}});
   const timed=async<T>(step:string,work:()=>Promise<T>)=>{const start=performance.now(),pane=step==='threads'?'Choose the source T3 thread':step==='runs'?'Choose a T3 response':undefined;if(pane)this.paneStarts.set(pane,this.paneOrigin());try{const result=await work();this.write({kind:'read',source:source.label,step,startTime:start,elapsedMs:performance.now()-start});return result;}catch(error){this.write({kind:'failure',source:source.label,step,startTime:start,elapsedMs:performance.now()-start,error:String(error)});throw error;}};
   routing?.prepareImportAccess();
   this.start=performance.now();this.action++;
   let catalog:ReturnType<typeof importRuns>|undefined;
   let threadApi:ThreadAccess['api']|undefined;
   openRunImport(this.app,notePath,{
    projects:()=>this.projects,projectLabel:project=>project.title+(this.projects.filter(other=>other.title===project.title).length>1?' · '+project.id.slice(0,8):''),
    threads:(project,signal)=>timed('threads',()=>read(async access=>{threadApi=access.api;return this.optimized?readImportThreads(access,project.id,signal):projectThreads({threads:readThreadList(await access.api('/api/orchestration/shell'))},project.id);})),
    watchThreads:(project,changed)=>threadApi?.watchImportThreads?.(project.id,()=>{const threads=threadApi?.cachedImportThreads?.(project.id);if(threads)changed(threads);})??(()=>{}),
    runs:(_project,thread,signal,progress)=>timed('runs',async()=>{
     const record=(runs:ReturnType<typeof importRuns>,partial=false)=>{catalog=runs;this.write({kind:'run-catalog',source:source.label,threadId:thread.id,projectId:thread.projectId,partial,runs:runs.map(run=>({runId:run.turnId,messageId:run.messageId,ordinal:run.turn?.ordinal}))});if(partial)progress?.(runs);return runs;};
     if(this.optimized)return record(await read(access=>readImportRuns(access,thread.id,thread.projectId,signal,runs=>record(runs,true))));
     const snapshot=await read(access=>readInlineSnapshot(access,thread.id,thread.projectId,undefined,true,true));
     const state=applyThreadItem({messages:[],activities:[]},{kind:'snapshot',snapshot}).state;
     return record(importRuns(state).filter(availableImportRun).map(run=>({...run,preview:importRunPreview(state,run,session.environmentId,thread.id)})));
    }),
    prepareSelection:async(project,thread,run)=>{
     if(!this.htmlViews||!run.turnId)return;
     run.preview??=await read(access=>readImportPreview(access,thread.id,project.id,run,session.environmentId));
     const first=run.preview.html[0];if(first)await this.htmlViews.prefetch(first,document);
    },
    preview:async(project,thread,run,el,child:Component,signal)=>{
     this.paneStarts.set('Response preview',this.paneOrigin());
     this.write({kind:'preview-source',source:source.label,threadId:thread.id,runId:run.turnId,messageId:run.messageId});
     if(this.optimized&&run.turnId&&!run.preview){
      run.preview=await timed('preview-read',()=>read(access=>readImportPreview(access,thread.id,project.id,run,session.environmentId,signal)));
     }
     await timed('preview-render',()=>renderRunImportPreview(this.app,run,el,child,signal,this.htmlViews));
    },
    attach:async(project,thread,run,follow)=>{
     if(follow)throw Error('This lab does not dispatch future-run subscriptions.');
     this.local?.dispose();const native=nativeResponses(this.app),subject:any=new SendToT3(this.app,this.manifest);
     subject.settings={vaultId:'isolated-import-performance',inlineStreaming:{enabled:true},responseBindings:{},noteThreads:[]};
     subject.connection=()=>connection;subject.inlineThreadAccess=accessFor;
     subject.localResponseTarget=async()=>({environmentId:session.environmentId,workspaceRoot:(this.app.vault.adapter as any).getFullPath(''),directory:'.obsidian/t3-code/inline/v1'});
     subject.save=async()=>this.saveData(subject.settings);
     const importing={start:this.start,action:this.action,source:source.label,view:leaf.view as MarkdownView,expected:undefined as string|undefined,bindingId:undefined as string|undefined};this.importing=importing;
     const original=subject.readImportHistory.bind(subject);
     subject.readImportHistory=async(...args:unknown[])=>{const history:any=await timed('registration-read',()=>original(...args));importing.expected=inlineTurnMessages(history.state,history.run.turnId).at(-1)?.text;return history;};
     const local=new DeviceResponseManager('isolated-import-performance-client',subject.settings.vaultId,{
      ...deviceNoteIO(this.app),localFinalNotes:deviceFinalNoteIO(this.app,()=>true),localBindings:()=>responseBindingRequests(subject.settings.responseBindings),saveLocalBinding:async request=>{subject.settings.responseBindings=updateResponseBindingData(subject.settings.responseBindings,request,'isolated');},
      openedNotes:()=>this.app.workspace.getLeavesOfType('markdown').map(leaf=>leaf.view as MarkdownView).filter(view=>view.file).map(view=>({path:view.file!.path,document:native.view(view)?.saved()??view.getViewData()})),
      syncReady:()=>true,receiveCoordinated:record=>{importing.bindingId=record.request.id;native.receive(record);},receiveDirect:update=>{const start=performance.now();native.stream(update);this.write({kind:'native-receive',source:source.label,startTime:start,elapsedMs:performance.now()-start,bodyCharacters:update.body.length,phase:update.phase});},localCompleted:(id,path)=>{native.localCompleted(id,path);void this.app.vault.read(this.app.vault.getFileByPath(path)!).then(document=>this.write({kind:'import-saved',source:source.label,elapsedMs:performance.now()-importing.start,ordinaryTextPreserved:document.includes('Ordinary text before.'),completeAnswerPreserved:!!importing.expected&&(document.includes(importing.expected)||document.includes(quoteResponse(importing.expected))),notePath:path}));},
      completionFailed:error=>this.write({kind:'save-failed',error:String(error)}),access:accessFor,
     });this.local=local;subject.deviceInline=local;
     const result=await subject.importRun(notePath,project,thread.id,run.messageId,false,undefined,catalog);this.write({kind:'import-result',source:source.label,result,elapsedMs:performance.now()-importing.start});return result;
    },
   });
   this.write({kind:'ready',source:source.label,targetThreadId:source.threadId,targetProjectId:source.projectId,targetRunId:source.runId});
  }catch(error){this.write({kind:'setup-failed',error:String(error)});}
 }
}
