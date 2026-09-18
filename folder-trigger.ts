import {App, Notice, TFile, TFolder, getAllTags} from 'obsidian';
import {contentHash} from './completion';
import type {Project, Request} from './bridge';
import {makeTriggerReceipt,matchFolderTriggers,normalizeFolderTrigger,type FolderTrigger,type FolderTriggerState,type TriggerEvent} from './folder-trigger-model';

type EventKind='create'|'rename'|'modify'|'scan';
export interface FolderTriggerHost {
  app:App;
  getState():FolderTriggerState;
  save():Promise<void>;
  createId():string;
  resolveProject(trigger:FolderTrigger):Project|undefined;
  ensureConnection(project:Project):Promise<void>;
  send(file:TFile,project:Project,id:string):Promise<boolean>;
  isBusy():boolean;
  isStopped():boolean;
}

export class FolderTriggerService{
  error='';private claims=new Set<string>();private timers=new Map<string,number>();private lastNotice='';private lastNoticeAt=0;
  constructor(private host:FolderTriggerHost){}
  register(register:(event:any)=>void){const on=(this.host.app.vault as any)?.on?.bind(this.host.app.vault);if(!on)return;register(on('create',(file:any)=>{if(file instanceof TFile)this.schedule(file,'create');}));register(on('rename',(file:any,oldPath:string)=>{if(file instanceof TFile)this.schedule(file,'rename',oldPath);}));register(on('modify',(file:any)=>{if(file instanceof TFile)this.schedule(file,'modify');}));}
  stop(){for(const timer of this.timers.values())window.clearTimeout(timer);this.timers.clear();}
  project(trigger:FolderTrigger){return this.host.resolveProject(trigger);}
  async add(folder:TFolder,project:Project,tag:string){const trigger=normalizeFolderTrigger({id:this.host.createId(),folderPath:folder.path,connectionId:project.connectionId??'',projectId:project.id,tag,enabled:true});const state=this.host.getState();const retained=state.triggers.filter(existing=>!(existing.folderPath===trigger.folderPath&&existing.connectionId===trigger.connectionId&&existing.projectId===trigger.projectId));state.triggers.splice(0,state.triggers.length,...retained,trigger);await this.host.save();new Notice(`${folder.path} linked to ${project.title} for #${trigger.tag}.`);void this.scan();}
  async scan(){const blocked=new Set<string>();this.error='';for(const file of this.host.app.vault.getMarkdownFiles())await this.handle(file,'scan',undefined,blocked);}
  schedule(file:TFile,kind:EventKind,previousPath?:string){const old=this.timers.get(file.path);if(old!==undefined)window.clearTimeout(old);const timer=window.setTimeout(()=>{this.timers.delete(file.path);void this.handle(file,kind,previousPath);},1500);this.timers.set(file.path,timer);}
  requestId(triggerId:string,noteId:string){const h=contentHash(`${triggerId}\0${noteId}`).slice(0,32).split('');h[12]='5';h[16]=((parseInt(h[16],16)&3)|8).toString(16);return `${h.slice(0,8).join('')}-${h.slice(8,12).join('')}-${h.slice(12,16).join('')}-${h.slice(16,20).join('')}-${h.slice(20).join('')}`;}
  ownsPending(request:Request){const file=request.completion&&this.host.app.vault.getAbstractFileByPath(request.completion.notePath);return file instanceof TFile&&this.host.getState().triggers.some(trigger=>trigger.projectId===request.project.id&&trigger.connectionId===(request.project.connectionId??'')&&this.requestId(trigger.id,String(file.stat.ctime))===request.id);}
  private async handle(file:TFile,kind:EventKind,previousPath?:string,blocked?:Set<string>){const state=this.host.getState();if(this.host.isStopped()||!state.triggers.length)return;const cache=this.host.app.metadataCache.getFileCache(file);const event:TriggerEvent={kind,path:file.path,previousPath,noteId:String(file.stat.ctime),tags:cache?(getAllTags(cache)??[]):[]};const matches=matchFolderTriggers(event,state.triggers,new Set(state.receipts.map(item=>item.key)));
    for(const match of matches){const connectionId=match.trigger.connectionId;if(blocked?.has(connectionId)||this.claims.has(match.receiptKey))continue;this.claims.add(match.receiptKey);try{const project=this.project(match.trigger);if(!project)throw Error('The folder trigger project is unavailable. Refresh T3 projects.');await this.host.ensureConnection(project);while(this.host.isBusy()&&!this.host.isStopped())await new Promise(resolve=>window.setTimeout(resolve,250));if(this.host.isStopped())return;const sent=await this.host.send(file,project,this.requestId(match.trigger.id,event.noteId));if(!sent)continue;state.receipts.push(makeTriggerReceipt(match,event));this.error='';await this.host.save();new Notice(`Folder trigger created “${file.basename}” in ${project.title}.`);}catch(error){if(blocked)blocked.add(connectionId);this.report(error);}finally{this.claims.delete(match.receiptKey);}}
  }
  private report(error:unknown){const detail=error instanceof Error?error.message:String(error);this.error=detail;const now=Date.now();if(detail===this.lastNotice&&now-this.lastNoticeAt<30_000)return;this.lastNotice=detail;this.lastNoticeAt=now;new Notice(`Send to T3 Code folder triggers paused: ${detail}`,12000);}
}
