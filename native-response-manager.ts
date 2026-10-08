import {contentHash} from './completion';
import {stoppedResponseBody} from './response-stop';
import type {App,MarkdownView} from 'obsidian';
import type {Transaction} from '@codemirror/state';
import {NativeResponseView} from './native-response-view';
import {responseAnchor,responseRegion,type LocalResponse} from './native-response-projection';
import type {LeaseRecord} from './inline-lease';
import {regionBody,initialRegion,startMarker,endMarker,renameInlineHeader} from './inline-thread';
import {logFailure} from './diagnostics';
import {nativeCommitMatches,readNativeCommitProof,type NativeCommitProof} from './native-response-commit';
import type {DirectInlineUpdate} from './direct-inline-preview';
import {loadNativePreviews,previewMatches,previewMessageId,MAX_NATIVE_PREVIEWS,MAX_NATIVE_PREVIEW_CHARACTERS,type NativePreviewEntry,type NativePreviewSnapshot} from './native-preview-cache';

const managers=new WeakMap<App,NativeResponseManager>();
export function nativeResponses(app:App){let manager=managers.get(app);if(!manager){manager=new NativeResponseManager(app);managers.set(app,manager);}return manager;}
/** Each native view owns its projection, history and selection. Saved content
 * is compared independently across views; streaming never copies an editor
 * buffer over a competing view. Conflict snapshots are device-local. */
export class NativeResponseManager {
  private localStops=new Map<string,{id:string;path:string;body:string;hidden:boolean}>();
  private stopKey?:string;
  private views=new Map<MarkdownView,NativeResponseView>();
  private provisional=new Map<string,{path:string;body:string}>();
  private streams=new Map<string,DirectInlineUpdate>();
  private records=new Map<string,LeaseRecord>();
  private titles=new Map<string,string>();
  private proofs=new Map<string,NativeCommitProof>();
  private reads=new Map<string,Promise<void>>();
  private changedDuringRead=new Set<string>();
  private lifetime=0;
  private relocations=new Map<string,Map<string,string>>();
  private warnings=new Map<MarkdownView,Map<string,HTMLElement>>();
  private previewVault?:string;
  private cached=new Map<string,NativePreviewEntry>();
  private reconnecting=new Set<string>();
  private savePreviews?:(snapshot:NativePreviewSnapshot)=>Promise<void>;
  private previewDirty=false;
  private previewTimer?:ReturnType<typeof setTimeout>;
  private previewWork?:Promise<void>;
  private recoverConflict?:(view:MarkdownView)=>void;
  constructor(private app:App){}
  configureConflictRecovery(recover:(view:MarkdownView)=>void){
    this.recoverConflict=recover;
    for(const [view,adapter] of this.views)if(adapter.conflictRecord())recover(view);
  }
  configurePreviewCache(vaultId:string,saved:unknown,save:(snapshot:NativePreviewSnapshot)=>Promise<void>){
    this.stopKey=`t3-local-response-stops-v1:${vaultId}`;
    const stops=this.app.loadLocalStorage?.(this.stopKey);
    if(Array.isArray(stops))for(const stop of stops)if(typeof stop?.id==='string'&&typeof stop.path==='string'&&typeof stop.body==='string'&&typeof stop.hidden==='boolean')this.localStops.set(stop.id,stop);
    this.previewVault=vaultId;this.savePreviews=save;this.cached.clear();this.reconnecting.clear();
    for(const entry of loadNativePreviews(saved,vaultId)){this.cached.set(entry.id,entry);this.reconnecting.add(entry.id);}
    if(typeof this.app.workspace?.getLeavesOfType==='function')this.refresh();
  }
  private dirtyPreview(){
    this.previewDirty=true;
    if(this.previewTimer===undefined)this.previewTimer=setTimeout(()=>{this.previewTimer=undefined;void this.flushPreviewCache();},500);
  }
  async flushPreviewCache():Promise<void>{
    if(this.previewTimer!==undefined){clearTimeout(this.previewTimer);this.previewTimer=undefined;}
    if(this.previewWork){await this.previewWork;if(this.previewDirty)await this.flushPreviewCache();return;}
    if(!this.previewDirty||!this.savePreviews||!this.previewVault)return;
    this.previewDirty=false;
    const snapshot:NativePreviewSnapshot={version:1,vaultId:this.previewVault,entries:[...this.cached.values()].map(entry=>({...entry}))};
    const work=this.savePreviews(snapshot).catch(error=>logFailure('note.preview.cache-save',error));this.previewWork=work;
    try{await work;}finally{if(this.previewWork===work)this.previewWork=undefined;}
  }
  private forgetPreview(id:string){if(this.cached.delete(id))this.dirtyPreview();this.reconnecting.delete(id);}
  private rememberPreview(record:LeaseRecord,body:string){
    if(!this.previewVault||record.request.vaultId!==this.previewVault||this.reconnecting.has(record.request.id)||record.responseRemovedAt!==undefined||record.stopRequestedAt||record.state?.userStopped||record.state?.finalSaved||record.state?.cleanupComplete||record.state?.locationConflict)return;
    if(this.localStops.has(record.request.id))return;
    const request=record.request,stream=this.streams.get(request.id);
    const entry:NativePreviewEntry={id:request.id,vaultId:request.vaultId,notePath:record.state?.notePath??request.notePath,threadId:request.threadId,projectId:request.projectId,threadEnvironmentId:request.threadEnvironmentId,messageId:previewMessageId(record),epoch:record.epoch,revision:record.revision,sequence:stream?.sequence??-1,body};
    const old=this.cached.get(entry.id);if(old&&JSON.stringify(old)===JSON.stringify(entry))return;
    if(!loadNativePreviews({version:1,vaultId:this.previewVault,entries:[entry]},this.previewVault).length)return;
    this.cached.delete(entry.id);this.cached.set(entry.id,entry);
    let characters=[...this.cached.values()].reduce((n,item)=>n+item.body.length,0);
    while(this.cached.size>MAX_NATIVE_PREVIEWS||characters>MAX_NATIVE_PREVIEW_CHARACTERS){const oldest=this.cached.values().next().value!;characters-=oldest.body.length;this.cached.delete(oldest.id);this.reconnecting.delete(oldest.id);}
    this.dirtyPreview();
  }
  private reconnectingBody(entry:NativePreviewEntry){return `> **T3 · Reconnecting…**\n\n${this.titled(entry.id,entry.body)}`;}
  deleted(path:string){for(const entry of [...this.cached.values()])if(entry.notePath===path||entry.notePath.startsWith(path+'/'))this.forgetPreview(entry.id);void this.flushPreviewCache();}
  /** A real vault rename keeps the TFile and response identity. Host leases
   * can lag behind that event (particularly across mobile Sync). */
  renamed(before:string,after:string){
    const moved=(path:string)=>path===before||path.startsWith(before+'/')?after+path.slice(before.length):path;
    const ids=new Set([...this.provisional].filter(([,item])=>moved(item.path)!==item.path).map(([id])=>id));
    for(const [id,record] of this.records)if(moved(record.state?.notePath??record.request.notePath)!==(record.state?.notePath??record.request.notePath))ids.add(id);
    for(const id of ids){
      const aliases=this.relocations.get(id)??new Map<string,string>();
      for(const [path,destination] of aliases)aliases.set(path,moved(destination));
      aliases.set(before,after);this.relocations.set(id,aliases);
    }
    for(const stop of this.localStops.values())stop.path=moved(stop.path);
    if(this.stopKey&&this.localStops.size)this.app.saveLocalStorage(this.stopKey,[...this.localStops.values()]);
    for(const item of this.provisional.values())item.path=moved(item.path);
    for(const entry of this.cached.values()){const path=moved(entry.notePath);if(path!==entry.notePath){entry.notePath=path;this.dirtyPreview();}}
    for(const item of this.streams.values())item.request={...item.request,notePath:moved(item.request.notePath)};
    for(const [id,record] of this.records){const current=record.state?.notePath??record.request.notePath,next=moved(current);if(next!==current)this.records.set(id,{...record,state:{...record.state??{requestHash:'',accepted:false,status:'waiting',hashes:[],updatedAt:''},notePath:next}});}
    this.refresh();
  }
  view(view:MarkdownView){const adapter=this.views.get(view);return adapter&&!adapter.isDisposed()?adapter:undefined;}
  conflictedView(path:string){return [...this.views].find(([view,adapter])=>view.file?.path===path&&!adapter.isDisposed()&&adapter.conflictRecord())?.[0];}
  preview(view:MarkdownView,id:string,body:string){this.provisional.set(id,{path:view.file!.path,body});this.refresh();}
  stoppedBody(id:string){return this.localStops.get(id)?.body;}
  stop(id:string,path?:string,hidden=false){
    const record=this.records.get(id),provisional=this.provisional.get(id),cached=this.cached.get(id);
    const current=[...this.views.values()].map(view=>view.responseBody(id)).find(body=>body!==undefined)??this.streams.get(id)?.body??provisional?.body??cached?.body??record?.state?.body??'';
    const previous=this.localStops.get(id);
    this.localStops.set(id,{id,path:path??previous?.path??provisional?.path??cached?.notePath??record?.state?.notePath??record?.request.notePath??'',body:hidden?'':previous?.body??stoppedResponseBody(current),hidden:hidden||previous?.hidden===true});
    this.streams.delete(id);this.forgetPreview(id);
    // The display is sealed synchronously, before persistence or remote work.
    this.refresh();
    if(this.stopKey)try{this.app.saveLocalStorage(this.stopKey,[...this.localStops.values()]);}catch(error){logFailure('response.stop.local-save.failed',error,{bindingId:id});}
  }
  stream(update:DirectInlineUpdate){
    if(this.localStops.has(update.request.id))return;
    const record=this.records.get(update.request.id),previous=this.streams.get(update.request.id);
    if(record&&(record.responseRemovedAt!==undefined||record.stopRequestedAt||record.state?.userStopped||record.state?.cleanupComplete||record.state?.locationConflict||record.request.vaultId!==update.request.vaultId||record.request.threadId!==update.request.threadId||record.request.projectId!==update.request.projectId||record.request.threadEnvironmentId!==update.request.threadEnvironmentId))return;
    if(previous&&previous.sequence>update.sequence)return;
    const cached=this.cached.get(update.request.id);
    if(record&&update.messageId!==previewMessageId(record))return;
    if(cached&&this.reconnecting.has(update.request.id)){
      if(!record||!previewMatches(cached,record)||update.sequence<cached.sequence)return;
      this.reconnecting.delete(update.request.id);
    }
    const path=record?.state?.notePath??update.request.notePath;
    this.streams.set(update.request.id,{...update,request:{...update.request,notePath:path}});this.refresh();
  }
  title(id:string,title:string){if(!title.trim()||this.titles.get(id)===title)return;this.titles.set(id,title);this.refresh();}
  private titled(id:string,body:string){const title=this.titles.get(id);return title?renameInlineHeader(body,title):body;}
  async receive(record:LeaseRecord,proofBytes?:string){
    if(!record.coordinated)return;
    const cached=this.cached.get(record.request.id);
    if(cached&&previewMatches(cached,record)&&(cached.epoch>record.epoch||cached.epoch===record.epoch&&cached.revision>record.revision))return;
    const old=this.records.get(record.request.id);if(old&&(old.epoch>record.epoch||old.epoch===record.epoch&&old.revision>record.revision))return;
    if(proofBytes&&record.state?.delivery)this.proofs.set(record.request.id,readNativeCommitProof(proofBytes,record.request.id,record.state.delivery));
    const path=record.state?.notePath??record.request.notePath;
    const move=[...this.relocations.get(record.request.id)??[]].sort((a,b)=>b[0].length-a[0].length).find(([before])=>path===before||path.startsWith(before+'/'));
    if(move)record={...record,state:{...record.state??{requestHash:'',accepted:false,status:'waiting',hashes:[],updatedAt:''},notePath:move[1]+path.slice(move[0].length)}};
    if(cached){
      if(!previewMatches(cached,record)||record.responseRemovedAt!==undefined||record.stopRequestedAt||record.state?.userStopped||record.state?.finalSaved||record.state?.cleanupComplete||record.state?.locationConflict)this.forgetPreview(record.request.id);
      else if(cached.sequence===-1&&record.state?.body!==undefined)this.reconnecting.delete(record.request.id);
    }
    this.provisional.delete(record.request.id);this.records.set(record.request.id,record);
    if(record.stopRequestedAt&&!record.state?.cleanupComplete&&(!this.localStops.has(record.request.id)||record.discardResponse&&!this.localStops.get(record.request.id)?.hidden))this.stop(record.request.id,path,record.discardResponse===true);
    if(record.responseRemovedAt!==undefined||record.stopRequestedAt||record.state?.userStopped||record.state?.cleanupComplete)this.streams.delete(record.request.id);
    this.refresh();
    if(record.state?.delivery&&record.state.cleanupComplete)await this.changed(record.state.notePath);
    if(cached&&!this.cached.has(record.request.id))await this.flushPreviewCache();
  }
  private completed(path:string,document:string,pending:ReadonlySet<string>){
    if(!pending.size)return [];
    const hash=contentHash(document),ids:string[]=[];
    for(const record of this.records.values()){
      const delivery=record.state?.delivery,id=record.request.id,proof=this.proofs.get(id);
      if(!pending.has(id)||record.state?.notePath!==path||!record.state.cleanupComplete||!delivery)continue;
      if((document.includes(startMarker(id))||document.includes(endMarker(id)))&&responseRegion(document,id))continue;
      if(hash===delivery.hash||proof?.commitId===delivery.commitId&&proof.hash===delivery.hash&&nativeCommitMatches(proof,document))ids.push(id);
    }
    return ids;
  }
  /** File events keep adoption alive even after the device's disk observation
   * has stopped lease polling. Reads are coalesced per note, never per pane. */
  changed(path:string):Promise<void>{
    const existing=this.reads.get(path);if(existing){this.changedDuringRead.add(path);return existing;}
    if(![...this.records.values()].some(record=>record.state?.notePath===path&&record.state.cleanupComplete&&record.state.delivery))return Promise.resolve();
    const file=this.app.vault.getFileByPath(path);if(!file)return Promise.resolve();
    if(![...this.views].some(([view,adapter])=>view.file===file&&adapter.responseIds().length))return Promise.resolve();
    const lifetime=this.lifetime;
    const work=(async()=>{
      do{
        this.changedDuringRead.delete(path);
        const disk=await this.app.vault.read(file);
        if(this.lifetime!==lifetime||file.path!==path||this.app.vault.getFileByPath(path)!==file)return;
        const pending=new Set([...this.views].filter(([view])=>view.file===file).flatMap(([,adapter])=>adapter.responseIds()));
        const ids=this.completed(path,disk,pending);
        if(ids.length)for(const [view,adapter] of this.views)if(view.file===file&&!adapter.isDisposed())adapter.resolveCommitted(disk,ids);
        this.refresh();
      }while(this.changedDuringRead.has(path));
    })();
    this.reads.set(path,work);void work.finally(()=>{if(this.reads.get(path)===work)this.reads.delete(path);}).catch(()=>{});return work;
  }
  private normalize(path:string,document:string){
    const ids=[...this.records.values()].filter(record=>(record.state?.notePath??record.request.notePath)===path).map(record=>record.request.id);
    ids.push(...[...this.provisional].filter(([,item])=>item.path===path).map(([id])=>id));
    for(const id of new Set(ids)){if(!document.includes(startMarker(id))&&!document.includes(endMarker(id)))continue;const region=responseRegion(document,id);if(region)document=document.slice(0,region.from)+responseAnchor(id)+document.slice(region.to);}
    return document;
  }
  refresh(){
    const opened=new Set<string>();
    const live=new Set(this.app.workspace.getLeavesOfType('markdown').map(leaf=>leaf.view as MarkdownView));
    for(const [view,warnings] of this.warnings)if(!live.has(view)){for(const element of warnings.values())element.remove();this.warnings.delete(view);}
    for(const [view,adapter] of this.views)if(!live.has(view)||adapter.isDisposed()){if(!adapter.isDisposed())adapter.dispose();this.views.delete(view);}
    for(const view of live){
      if(!view.file||typeof view.getViewData!=='function')continue;
      const blocked=[...this.records.values()].filter(record=>!record.stopRequestedAt&&!record.state?.cleanupComplete&&record.state?.locationConflict?.includes(view.file!.path));
      let warnings=this.warnings.get(view);if(!warnings){warnings=new Map();this.warnings.set(view,warnings);}
      for(const [id,element] of warnings)if(!element.isConnected||!blocked.some(record=>record.request.id===id)){element.remove();warnings.delete(id);}
      for(const record of blocked){
        if(warnings.has(record.request.id)||!view.contentEl)continue;
        const banner=view.contentEl.createDiv({cls:'send-to-t3-location-conflict'});banner.setAttribute('role','alert');
        banner.createEl('strong',{text:'Response blocked: duplicate destinations'});
        banner.createEl('p',{text:'Choose the intended note to resume this response. The prompt will not be sent again.'});
        const list=banner.createEl('ul');for(const path of record.state!.locationConflict!)list.createEl('li',{text:path});
        banner.createEl('button',{text:'Review response destination…'}).onclick=()=>banner.dispatchEvent(new CustomEvent('t3-review-response-location',{bubbles:true,detail:{bindingId:record.request.id}}));
        view.contentEl.prepend(banner);warnings.set(record.request.id,banner);
      }
      try{
        let adapter=this.view(view),saved=adapter?adapter.saved():view.getViewData();
        const responses:LocalResponse[]=[...this.provisional.entries()].filter(([,item])=>item.path===view.file!.path).map(([id,item])=>({id,body:this.titled(id,item.body)}));
        for(const entry of [...this.cached.values()]){
          if(!this.reconnecting.has(entry.id)||entry.notePath!==view.file.path)continue;
          const region=responseRegion(saved,entry.id);
          if(!region||saved.slice(region.from,region.to)!==responseAnchor(entry.id)){this.forgetPreview(entry.id);continue;}
          if(!this.records.has(entry.id)&&!responses.some(response=>response.id===entry.id))responses.push({id:entry.id,body:this.reconnectingBody(entry)});
        }
        for(const record of this.records.values()){
          if(record.responseRemovedAt!==undefined||(record.state?.notePath??record.request.notePath)!==view.file.path)continue;
          const id=record.request.id;
          if(!saved.includes(startMarker(id))&&!saved.includes(endMarker(id)))continue;
          const region=responseRegion(saved,id);
          if(!region||saved.slice(region.from,region.to)!==responseAnchor(id))continue;
          if(record.state?.cleanupComplete&&adapter?.hasMaterialized(id))continue;
          const body=(record.state?.cleanupComplete?record.state.finalBody:undefined)??this.streams.get(id)?.body??record.state?.body??regionBody(initialRegion(id,record.request.initialInput,record.request.threadTitle,record.request.intermediateMode,{startedAt:record.request.createdAt}).text,id)!.body;
          const cached=this.cached.get(id),restoring=cached&&this.reconnecting.has(id)&&previewMatches(cached,record);
          const displayed=record.state?.cleanupComplete?body:this.titled(id,body);
          if(!restoring)this.rememberPreview(record,displayed);
          responses.push({id,body:restoring?this.reconnectingBody(cached):displayed});
        }
        for(const stop of this.localStops.values()){
          if(stop.path!==view.file.path||!responseRegion(saved,stop.id)||adapter?.hasMaterialized(stop.id))continue;
          const index=responses.findIndex(response=>response.id===stop.id);
          const sealed={id:stop.id,body:stop.hidden?'':stop.body};
          if(index>=0)responses[index]=sealed;else responses.push(sealed);
        }
        if(!adapter&&responses.length){
          const file=view.file;
          adapter=new NativeResponseView(view,saved,conflict=>{
            this.app.saveLocalStorage(`t3-native-conflict:${file.path}:${Date.now()}`,conflict);
            logFailure('note.projection.conflict',Error(conflict.reason),{notePath:file.path});
            this.recoverConflict?.(view);
          },async()=>view.file===file?this.app.vault.read(file):undefined,incoming=>this.normalize(file.path,incoming),incoming=>this.completed(file.path,incoming,new Set(adapter!.responseIds())));
          this.views.set(view,adapter);
          opened.add(file.path);
        }
        if(adapter){
          adapter.setResponses(responses);
        }
      }catch(error){logFailure('note.projection.retry',error,{notePath:view.file.path});}
    }
    for(const path of opened)void this.changed(path).catch(error=>logFailure('note.projection.open',error,{notePath:path}));
  }
  async resolve(view:MarkdownView,reviewed:string,choice:'saved'|'local'){
    const adapter=this.view(view),file=view.file,conflict=adapter?.conflictRecord();if(!adapter||!file||!conflict)throw Error('This view has no preserved conflict.');
    if(await this.app.vault.read(file)!==reviewed)throw Error('The saved conflict version changed. Review it again.');
    this.app.saveLocalStorage(`t3-native-resolution:${file.path}:${Date.now()}`,{conflict,reviewed,choice});
    adapter.resolveConflict(reviewed,choice);if(choice==='local')await view.save();this.refresh();
  }
  filter(transaction:Transaction){for(const adapter of this.views.values()){const result=adapter.filterTransaction(transaction);if(Array.isArray(result))return result;}return transaction;}
  savedViews(path:string){return this.app.workspace.getLeavesOfType('markdown').map(leaf=>leaf.view as MarkdownView).filter(view=>view.file?.path===path&&(view.getMode?.()!=='preview'||!!this.view(view))).map(view=>({view,saved:()=>this.view(view)?.saved()??view.getViewData?.()??view.editor.getValue()}));}
  prepare(path:string,before:string,after:string,ids:string[]){for(const [view,adapter] of this.views)if(view.file?.path===path)adapter.prepareMaterialization(before,after,ids);}
  cancel(path:string){for(const [view,adapter] of this.views)if(view.file?.path===path)adapter.cancelMaterialization();}
  committed(path:string,saved:string,ids:string[]){for(const [view,adapter] of this.views)if(view.file?.path===path&&!adapter.acceptCommitted(saved,ids))throw Error('A native pane did not adopt the saved result.');}
  dispose(){this.recoverConflict=undefined;void this.flushPreviewCache();this.lifetime++;for(const adapter of this.views.values())adapter.dispose();for(const warnings of this.warnings.values())for(const warning of warnings.values())warning.remove();this.warnings.clear();this.views.clear();this.records.clear();this.titles.clear();this.provisional.clear();this.streams.clear();this.proofs.clear();this.reads.clear();this.changedDuringRead.clear();this.relocations.clear();this.reconnecting.clear();}
}
