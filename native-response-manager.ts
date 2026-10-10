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
import type {DeviceCompletionReceipt} from './device-response-completion';
import type {NativeStoppedResponse,NativeStoppedStore} from './native-stop-store';

const managers=new WeakMap<App,NativeResponseManager>();
export function nativeResponses(app:App){let manager=managers.get(app);if(!manager){manager=new NativeResponseManager(app);managers.set(app,manager);}return manager;}
interface FinalSaveFence {
  path:string;review:boolean;released:boolean;sealed:boolean;invalid:boolean;failure?:unknown;
  panes:Map<MarkdownView,MarkdownView['file']>;
  members:Map<NativeResponseView,{ready:boolean;work:Promise<void>;release?:()=>void}>;
}
/** Each native view owns its projection, history and selection. Saved content
 * is compared independently across views; streaming never copies an editor
 * buffer over a competing view. Conflict snapshots are device-local. */
export class NativeResponseManager {
  private localStops=new Map<string,NativeStoppedResponse>();
  private stopKey?:string;
  private stoppedStore?:NativeStoppedStore;
  private stoppedRestore?:Promise<void>;
  private stoppedRestoreFailure?:unknown;
  private pendingStops=new Map<string,Promise<void>>();
  private stopFailures=new Map<string,unknown>();
  private views=new Map<MarkdownView,NativeResponseView>();
  private uninitializedViews=new WeakSet<NativeResponseView>();
  private provisional=new Map<string,{path:string;body:string}>();
  private streams=new Map<string,DirectInlineUpdate>();
  private records=new Map<string,LeaseRecord>();
  private titles=new Map<string,string>();
  private proofs=new Map<string,NativeCommitProof>();
  private deviceCommits=new Map<string,{path:string;proof:NativeCommitProof}>();
  private completionIdentities=new Map<string,{id:string;path:string;hash:string;commitId:string}>();
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
  private previewSaveFailed=false;
  private recoverConflict?:(view:MarkdownView)=>void;
  private conflictKeys=new WeakMap<MarkdownView,string>();
  private preserveViewConflict(view:MarkdownView,path:string,conflict:Parameters<NativeResponseView['preserveConflict']>[0]){
    let key=this.conflictKeys.get(view);if(!key){key=`t3-native-conflict:${path}:${crypto.randomUUID()}`;this.conflictKeys.set(view,key);}
    this.app.saveLocalStorage(key,conflict);
  }
  private async clearViewConflict(view:MarkdownView){
    const adapter=this.view(view),file=view.file,key=this.conflictKeys.get(view);if(!adapter||!file||!key||adapter.conflictRecord())return;
    // A pane transition can precede its native save. Keep recovery bytes until
    // the selected ordinary text has actually reached the saved file.
    if(await this.app.vault.read(file)!==adapter.saved()||this.view(view)!==adapter||adapter.conflictRecord()||this.conflictKeys.get(view)!==key)return;
    this.app.saveLocalStorage(key,null);this.conflictKeys.delete(view);
  }
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
  async configureStoppedStore(store:NativeStoppedStore){
    this.stoppedStore=store;const legacy=[...this.localStops.values()].map(stop=>({...stop})),lifetime=this.lifetime;
    const work=(async()=>{
      const restored=await store.readAll(),ids=new Set(restored.map(stop=>stop.id));
      for(const stop of restored)this.localStops.set(stop.id,stop);
      // Retain the old full bodies until each missing IndexedDB body/index is
      // committed. A crash between migration and clearing is harmless.
      for(const stop of legacy)if(!ids.has(stop.id))await store.write(stop);
      if(this.stopKey&&legacy.length)this.app.saveLocalStorage(this.stopKey,[]);
      this.stoppedRestoreFailure=undefined;if(this.lifetime===lifetime)this.refresh();
    })().catch(error=>{this.stoppedRestoreFailure=error;throw error;});
    this.stoppedRestore=work;try{await work;}finally{if(this.stoppedRestore===work)this.stoppedRestore=undefined;}
  }
  private retainStop(stop:NativeStoppedResponse){
    const previous=this.pendingStops.get(stop.id),snapshot={...stop},store=this.stoppedStore!,lifetime=this.lifetime;
    const work=(async()=>{
      if(previous)await previous.catch(()=>{});
      await store.write(snapshot);
      this.stopFailures.delete(stop.id);
      // Keep all recovery copies until body and index are durable.
      this.streams.delete(stop.id);this.forgetPreview(stop.id);if(this.lifetime===lifetime)this.refresh();
    })().catch(error=>{this.stopFailures.set(stop.id,error);throw error;});
    this.pendingStops.set(stop.id,work);void work.finally(()=>{if(this.pendingStops.get(stop.id)===work)this.pendingStops.delete(stop.id);}).catch(()=>{});return work;
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
    const work=this.savePreviews(snapshot).then(()=>{this.previewSaveFailed=false;}).catch(error=>{this.previewSaveFailed=true;this.previewDirty=true;logFailure('note.preview.cache-save',error);});this.previewWork=work;
    try{await work;}finally{if(this.previewWork===work)this.previewWork=undefined;}
  }
  async prepareReload(){
    if(this.finalSaveQueues.size)throw Error('Waiting for a final response save before reloading.');
    await this.flushPreviewCache();
    if(this.stoppedRestore)await this.stoppedRestore.catch(()=>{});
    while(this.pendingStops.size)await Promise.allSettled([...this.pendingStops.values()]);
    if(this.stoppedRestoreFailure||this.stopFailures.size)throw Error('Waiting for durable frozen response storage before reloading.');
    await this.flushPreviewCache();
    if(this.pendingStops.size||this.stoppedRestore)throw Error('Waiting for durable frozen response storage before reloading.');
    if(this.finalSaveQueues.size)throw Error('Waiting for a final response save before reloading.');
    if(this.previewSaveFailed)throw Error('Waiting for durable response recovery before reloading.');
    for(const [view,adapter] of this.views){
      if(adapter.conflictRecord())throw Error('Resolve the preserved note conflict before reloading.');
      for(const id of adapter.responseIds()){
        if(this.localStops.has(id)||this.cached.has(id)||this.records.get(id)?.finalWriter||this.deviceCommits.has(id))continue;
        throw Error('Waiting for this response to retain its recovery state before reloading.');
      }
    }
  }
  private forgetPreview(id:string){if(this.cached.delete(id))this.dirtyPreview();this.reconnecting.delete(id);}
  private rememberPreview(record:LeaseRecord,body:string){
    if(!this.previewVault||record.request.vaultId!==this.previewVault||this.reconnecting.has(record.request.id)||record.finalWriter||record.responseRemovedAt!==undefined||record.stopRequestedAt||record.state?.userStopped||record.state?.finalSaved||record.state?.cleanupComplete||record.state?.locationConflict)return;
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
  reconnectingResponseIds(){
    const opened=new Set([...this.views.keys()].map(view=>view.file?.path));
    const ids=[...this.cached.values()].filter(entry=>this.reconnecting.has(entry.id)&&opened.has(entry.notePath)).map(entry=>entry.id);
    for(const receipt of this.completionIdentities.values())if(!this.deviceCommits.has(receipt.id)&&[...this.views].some(([view,adapter])=>view.file?.path===receipt.path&&!!responseRegion(adapter.saved(),receipt.id)))ids.push(receipt.id);
    return [...new Set(ids)];
  }
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
    const movedStops:NativeStoppedResponse[]=[];for(const stop of this.localStops.values()){const path=moved(stop.path);if(path!==stop.path){stop.path=path;movedStops.push(stop);}}
    for(const commit of this.deviceCommits.values())commit.path=moved(commit.path);
    for(const receipt of this.completionIdentities.values())receipt.path=moved(receipt.path);
    if(this.stoppedStore){for(const stop of movedStops)void this.retainStop(stop).catch(error=>logFailure('note.stop.rename-storage',error,{bindingId:stop.id}));}
    else if(this.stopKey&&this.localStops.size)this.app.saveLocalStorage(this.stopKey,[...this.localStops.values()]);
    for(const item of this.provisional.values())item.path=moved(item.path);
    for(const entry of this.cached.values()){const path=moved(entry.notePath);if(path!==entry.notePath){entry.notePath=path;this.dirtyPreview();}}
    for(const item of this.streams.values())item.request={...item.request,notePath:moved(item.request.notePath)};
    for(const [id,record] of this.records){const current=record.state?.notePath??record.request.notePath,next=moved(current);if(next!==current)this.records.set(id,{...record,state:{...record.state??{requestHash:'',accepted:false,status:'waiting',hashes:[],updatedAt:''},notePath:next}});}
    this.refresh();
  }
  view(view:MarkdownView){const adapter=this.views.get(view);return adapter&&!adapter.isDisposed()?adapter:undefined;}
  toolGroup(element:HTMLElement,ref:string){for(const [view,adapter] of this.views)if(view.contentEl?.contains(element))return adapter.toolGroup(ref);}
  conflictedView(path:string){return [...this.views].find(([view,adapter])=>view.file?.path===path&&!adapter.isDisposed()&&adapter.conflictRecord())?.[0];}
  preview(view:MarkdownView,id:string,body:string){this.provisional.set(id,{path:view.file!.path,body});this.refresh();}
  stoppedBody(id:string){return this.localStops.get(id)?.body;}
  stop(id:string,path?:string,hidden=false,sourceView?:MarkdownView):Promise<void>|void{
    const record=this.records.get(id),provisional=this.provisional.get(id),cached=this.cached.get(id);
    const previous=this.localStops.get(id),nextPath=path??previous?.path??provisional?.path??cached?.notePath??record?.state?.notePath??record?.request.notePath??'',nextHidden=hidden||previous?.hidden===true;
    if(previous&&previous.path===nextPath&&previous.hidden===nextHidden){const pending=this.pendingStops.get(id);if(pending)return pending;if(this.stopFailures.has(id)&&this.stoppedStore)return this.retainStop(previous);return;}
    // A host-retained Stop already names the frozen bytes. Restore them
    // unchanged, even if this pane or a permanent final grant is newer.
    const retained=record?.stopRequestedAt!==undefined?record.stoppedBody:undefined;
    const current=retained??(sourceView?this.view(sourceView)?.responseBody(id):undefined)??[...this.views.values()].map(view=>view.responseBody(id)).find(body=>body!==undefined)??record?.finalWriter?.body??this.streams.get(id)?.body??provisional?.body??cached?.body??record?.state?.body??'';
    this.localStops.set(id,{id,path:nextPath,body:nextHidden?'':previous?.body??(retained!==undefined?retained:stoppedResponseBody(current)),hidden:nextHidden});
    if(this.stoppedStore){this.refresh();return this.retainStop(this.localStops.get(id)!);}
    if(this.stopKey)try{this.app.saveLocalStorage(this.stopKey,[...this.localStops.values()]);}catch(error){if(previous)this.localStops.set(id,previous);else this.localStops.delete(id);throw error;}
    this.streams.delete(id);this.forgetPreview(id);
    // The display is sealed synchronously, before persistence or remote work.
    this.refresh();
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
  deviceCommitted(path:string,proof:NativeCommitProof,refresh=true){
    this.deviceCommits.set(proof.bindingId,{path,proof});this.streams.delete(proof.bindingId);this.provisional.delete(proof.bindingId);this.forgetPreview(proof.bindingId);
    this.completionIdentities.set(proof.bindingId,{id:proof.bindingId,path,hash:proof.hash,commitId:proof.commitId});
    let characters=[...this.deviceCommits.values()].reduce((n,item)=>n+JSON.stringify(item.proof).length,0);
    for(const [id,item] of this.deviceCommits){if(this.deviceCommits.size<=32&&characters<=8_000_000)break;const protectedPane=[...this.views].some(([view,adapter])=>view.file?.path===item.path&&adapter.conflictRecord());if(protectedPane)continue;this.deviceCommits.delete(id);characters-=JSON.stringify(item.proof).length;}
    if(refresh){this.refresh();void this.flushPreviewCache();}
  }
  retiredCommitted(receipt:DeviceCompletionReceipt){this.completionIdentities.set(receipt.id,{id:receipt.id,path:receipt.notePath,hash:receipt.hash,commitId:receipt.commitId});}
  completionConflict(path:string,base:string,local:string,incoming:string,reason:string){
    this.refresh();
    for(const [view,adapter] of this.views)if(view.file?.path===path)adapter.preserveConflict({base,local,incoming,reason});
  }
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
      if(!previewMatches(cached,record)||record.finalWriter||record.responseRemovedAt!==undefined||record.stopRequestedAt||record.state?.userStopped||record.state?.finalSaved||record.state?.cleanupComplete||record.state?.locationConflict)this.forgetPreview(record.request.id);
      else if(cached.sequence===-1&&record.state?.body!==undefined)this.reconnecting.delete(record.request.id);
    }
    this.provisional.delete(record.request.id);this.records.set(record.request.id,record);
    if(record.state?.status==='conflict')for(const [view,adapter] of this.views)if(view.file?.path===path&&adapter.responseIds().includes(record.request.id))adapter.confirmPendingConflict(record.state.detail??'The response could not verify its saved note. Both versions are preserved.');
    if(record.stopRequestedAt!==undefined&&!record.state?.cleanupComplete&&(!this.localStops.has(record.request.id)||record.discardResponse&&!this.localStops.get(record.request.id)?.hidden))await this.stop(record.request.id,path,record.discardResponse===true);
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
    // A single incoming file can finish several responses. Do not retire one
    // while another missing anchor still awaits its independent proof.
    return [...pending].some(id=>!responseRegion(document,id)&&!ids.includes(id))?[]:ids;
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
        for(const [view,adapter] of this.views){
          if(view.file!==file||!adapter.conflictRecord()?.awaitingCompletion)continue;
          const unmatched=[...this.records.values()].some(record=>adapter.responseIds().includes(record.request.id)&&!responseRegion(disk,record.request.id)&&record.state?.notePath===path&&record.state.cleanupComplete&&record.state.delivery&&this.proofs.has(record.request.id)&&!this.completed(path,disk,new Set([record.request.id])).includes(record.request.id));
          if(unmatched)adapter.confirmPendingConflict('The saved note differs from the verified completed response. Both versions are preserved.');
        }
        this.refresh();
      }while(this.changedDuringRead.has(path));
    })();
    this.reads.set(path,work);void work.finally(()=>{if(this.reads.get(path)===work)this.reads.delete(path);}).catch(()=>{});return work;
  }
  private normalize(path:string,document:string){
    const ids=[...this.records.values()].filter(record=>(record.state?.notePath??record.request.notePath)===path).map(record=>record.request.id);
    ids.push(...[...this.provisional].filter(([,item])=>item.path===path).map(([id])=>id));
    for(const id of new Set(ids)){if(this.deviceCommits.has(id)||!document.includes(startMarker(id))&&!document.includes(endMarker(id)))continue;const region=responseRegion(document,id);if(region)document=document.slice(0,region.from)+responseAnchor(id)+document.slice(region.to);}
    return document;
  }
  private wrap(view:MarkdownView,saved=view.getViewData()){
    const existing=this.view(view);if(existing)return existing;
    const file=view.file;if(!file)throw Error('The native response note closed before final delivery.');
    let adapter!:NativeResponseView;
    adapter=new NativeResponseView(view,saved,conflict=>{
      this.preserveViewConflict(view,file.path,conflict);
      logFailure('note.projection.conflict',Error(conflict.reason),{notePath:file.path});
      this.recoverConflict?.(view);
    },async()=>view.file===file?this.app.vault.read(file):undefined,incoming=>this.normalize(file.path,incoming),incoming=>this.completed(file.path,incoming,new Set(adapter.responseIds())),()=>{void this.clearViewConflict(view).catch(error=>logFailure('note.conflict-cleanup.failed',error));this.recoverConflict?.(view);});
    this.views.set(view,adapter);this.uninitializedViews.add(adapter);
    const fence=this.activeFinalSaves.get(file.path);if(fence)this.joinFinalSave(fence,adapter);
    return adapter;
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
        let adapter=this.view(view);
        const fence=this.activeFinalSaves.get(view.file.path);if(adapter&&fence)this.joinFinalSave(fence,adapter);
        let saved=adapter?adapter.saved():view.getViewData();
        const commits=[...this.deviceCommits.values()].filter(commit=>commit.path===view.file!.path),retired=[...this.completionIdentities.values()].filter(receipt=>receipt.path===view.file!.path&&!this.deviceCommits.has(receipt.id));
        let savedHash:string|undefined;
        const settled=[...this.records.values()].filter(record=>(record.state?.notePath??record.request.notePath)===view.file!.path&&record.state?.cleanupComplete&&record.state.delivery&&!adapter?.hasMaterialized(record.request.id)&&!responseRegion(saved,record.request.id)&&((savedHash??=contentHash(saved))===record.state.delivery.hash||this.proofs.has(record.request.id)&&nativeCommitMatches(this.proofs.get(record.request.id)!,saved))).map(record=>record.request.id);
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
          if(this.deviceCommits.has(id))continue;
          if(!saved.includes(startMarker(id))&&!saved.includes(endMarker(id)))continue;
          const region=responseRegion(saved,id);
          if(!region||saved.slice(region.from,region.to)!==responseAnchor(id))continue;
          if(record.state?.cleanupComplete&&adapter?.hasMaterialized(id))continue;
          const body=(record.state?.cleanupComplete?record.state.finalBody:undefined)??record.finalWriter?.body??this.streams.get(id)?.body??record.state?.body??regionBody(initialRegion(id,record.request.initialInput,record.request.threadTitle,record.request.intermediateMode,{startedAt:record.request.createdAt}).text,id)!.body;
          const cached=this.cached.get(id),restoring=!record.finalWriter&&cached&&this.reconnecting.has(id)&&previewMatches(cached,record);
          const displayed=record.state?.cleanupComplete||record.finalWriter?body:this.titled(id,body);
          if(!restoring)this.rememberPreview(record,displayed);
          responses.push({id,body:restoring?this.reconnectingBody(cached):displayed});
        }
        for(const stop of this.localStops.values()){
          if(stop.path!==view.file.path||!responseRegion(saved,stop.id)||adapter?.hasMaterialized(stop.id))continue;
          const index=responses.findIndex(response=>response.id===stop.id);
          const sealed={id:stop.id,body:stop.hidden?'':stop.body};
          if(index>=0)responses[index]=sealed;else responses.push(sealed);
        }
        if(!adapter&&(fence||responses.length||commits.length||retired.length||settled.length||saved.includes('data-t3-tool-group=')&&saved.includes('send-to-t3-tool-group-content'))){
          const file=view.file;
          adapter=this.wrap(view,saved);
          opened.add(file.path);
        }
        if(adapter){
          for(const id of settled)adapter.markMaterialized(id);
          for(const receipt of retired){adapter.markMaterialized(receipt.id);if(responseRegion(saved,receipt.id))adapter.preserveConflict({base:saved,local:saved,incoming:saved,reason:'An incoming note contains an already completed response anchor. The completion identity is retained; recovery requires the host proof.'});}
          for(const {proof} of commits){
            adapter.markMaterialized(proof.bindingId);
            if(responseRegion(saved,proof.bindingId))adapter.preserveConflict({base:proof.document,local:proof.document,incoming:saved,reason:'An incoming note resurrected an already completed response anchor.'});
          }
          adapter.setResponses(responses);
        }
      }catch(error){logFailure('note.projection.retry',error,{notePath:view.file.path});}
    }
    for(const path of opened)void this.changed(path).catch(error=>logFailure('note.projection.open',error,{notePath:path}));
  }
  async resolve(view:MarkdownView,reviewed:string,choice:'saved'|'local'){
    const adapter=this.view(view),file=view.file,conflict=adapter?.conflictRecord();if(!adapter||!file||!conflict)throw Error('This view has no preserved conflict.');
    if(await this.app.vault.read(file)!==reviewed)throw Error('The saved conflict version changed. Review it again.');
    const chosen=choice==='local'?conflict.local:reviewed;
    adapter.resolveConflict(reviewed,choice);
    try{if(choice==='local')await view.save();if(await this.app.vault.read(file)!==chosen)throw Error('The chosen conflict version has not reached the saved file.');}
    catch(error){adapter.preserveConflict(conflict);throw error;}
    const key=`t3-native-resolutions:${this.previewVault??'local'}`,previous=this.app.loadLocalStorage?.(key),receipts=Array.isArray(previous)?previous:[];
    this.app.saveLocalStorage(key,[...receipts,{path:file.path,choice,at:Date.now(),baseHash:contentHash(conflict.base),localHash:contentHash(conflict.local),incomingHash:contentHash(conflict.incoming),savedHash:contentHash(chosen)}].slice(-64));await this.clearViewConflict(view);this.refresh();
  }
  filter(transaction:Transaction){for(const adapter of this.views.values()){const result=adapter.filterTransaction(transaction);if(Array.isArray(result))return result;}return transaction;}
  savedViews(path:string){return this.app.workspace.getLeavesOfType('markdown').map(leaf=>leaf.view as MarkdownView).filter(view=>view.file?.path===path&&(view.getMode?.()!=='preview'||!!this.view(view))).map(view=>({view,saved:()=>this.view(view)?.saved()??view.getViewData?.()??view.editor.getValue()}));}
  private finalSaveQueues=new Map<string,Promise<void>>();
  private activeFinalSaves=new Map<string,FinalSaveFence>();
  private nativePanes(path:string){return this.app.workspace.getLeavesOfType('markdown').map(leaf=>leaf.view as MarkdownView).filter(view=>view.file?.path===path&&typeof view.getViewData==='function');}
  private joinFinalSave(fence:FinalSaveFence,adapter:NativeResponseView){
    if(fence.released||fence.members.has(adapter))return;
    if(fence.sealed)fence.invalid=true;
    const member:{ready:boolean;work:Promise<void>;release?:()=>void}={ready:false,work:Promise.resolve()};fence.members.set(adapter,member);
    // beginFinalSave installs the constructor-bound save gate synchronously,
    // before its first awaited drain. A pane opened during a held write joins
    // immediately; its pending captured save can never count as verified.
    member.work=adapter.beginFinalSave(fence.review).then(async release=>{
      if(fence.released){release();return;}member.release=release;
      if(this.uninitializedViews.has(adapter)&&!fence.review){
        const file=adapter.view.file;if(!file||file.path!==fence.path)throw Error('The native response note moved before final delivery.');
        const disk=await this.app.vault.read(file);if(fence.released)return;
        if(adapter.view.file!==file||file.path!==fence.path||adapter.isDisposed())throw Error('The native response note changed during final delivery.');
        adapter.initializeDiskBaseline(disk);this.uninitializedViews.delete(adapter);
      }
      member.ready=true;
    }).catch(error=>{fence.failure=error;fence.invalid=true;});
  }
  private admitFinalSavePanes(fence:FinalSaveFence){
    for(const view of this.nativePanes(fence.path))this.joinFinalSave(fence,this.view(view)??this.wrap(view));
  }
  /** Recheck actual pane identity and native save capture, not just equal
   * bytes. A split/file switch after the final snapshot defers this attempt. */
  finalSaveReady(path:string){
    const fence=this.activeFinalSaves.get(path);if(!fence||fence.released)return false;
    try{this.admitFinalSavePanes(fence);}catch(error){fence.failure=error;fence.invalid=true;}
    const panes=this.nativePanes(path);
    if(panes.length!==fence.panes.size||panes.some(view=>fence.panes.get(view)!==view.file))fence.invalid=true;
    return fence.sealed&&!fence.invalid&&!fence.failure&&panes.every(view=>{
      const adapter=this.view(view),member=adapter&&fence.members.get(adapter);return !!member?.ready&&!(view as any).saving;
    });
  }
  reviewSaved(path:string,disk:string){
    const values=this.savedViews(path).map(({view,saved})=>{const adapter=this.view(view);return adapter?adapter.reviewSaved(disk):saved()===disk?disk:undefined;});
    if(!values.length)return disk;const first=values[0];return first!==undefined&&values.every(value=>value===first)?first:undefined;
  }
  resumeReviewed(path:string,disk:string,reviewed:string){
    if(this.reviewSaved(path,disk)!==reviewed)throw Error('The reviewed note changed on this device.');
    for(const {view} of this.savedViews(path))this.view(view)?.resumeReviewed(disk,reviewed);
  }
  async beginFinalSave(path:string,review=false):Promise<()=>void>{
    const previous=this.finalSaveQueues.get(path)??Promise.resolve();let unlock!:()=>void;
    const lock=new Promise<void>(resolve=>{unlock=resolve;}),tail=previous.then(()=>lock);this.finalSaveQueues.set(path,tail);
    await previous;
    const fence:FinalSaveFence={path,review,released:false,sealed:false,invalid:false,panes:new Map(),members:new Map()};this.activeFinalSaves.set(path,fence);
    const release=()=>{if(fence.released)return;fence.released=true;for(const member of [...fence.members.values()].reverse())member.release?.();if(this.activeFinalSaves.get(path)===fence)this.activeFinalSaves.delete(path);unlock();if(this.finalSaveQueues.get(path)===tail)this.finalSaveQueues.delete(path);};
    try{
      for(;;){
        this.admitFinalSavePanes(fence);await Promise.all([...fence.members.values()].map(member=>member.work));
        if(fence.failure)throw fence.failure;
        const panes=this.nativePanes(path);
        if(panes.some(view=>!this.view(view)||!fence.members.get(this.view(view)!)?.ready))continue;
        fence.panes=new Map(panes.map(view=>[view,view.file]));fence.sealed=true;
        if(!this.finalSaveReady(path))throw Error('The native panes changed before final delivery.');
        return release;
      }
    }catch(error){release();throw error;}
  }
  prepare(path:string,before:string,after:string,ids:string[]){if(this.activeFinalSaves.has(path)&&!this.finalSaveReady(path))throw Error('The native panes changed before final delivery.');for(const [view,adapter] of this.views)if(view.file?.path===path)adapter.prepareMaterialization(before,after,ids);}
  cancel(path:string){for(const [view,adapter] of this.views)if(view.file?.path===path)adapter.cancelMaterialization();}
  committed(path:string,saved:string,ids:string[]){for(const [view,adapter] of this.views)if(view.file?.path===path){if(this.uninitializedViews.has(adapter)){adapter.initializeDiskBaseline(saved,true);this.uninitializedViews.delete(adapter);}if(!adapter.acceptCommitted(saved,ids))throw Error('A native pane did not adopt the saved result.');}}
  dispose(){this.recoverConflict=undefined;void this.flushPreviewCache();this.lifetime++;for(const adapter of this.views.values())adapter.dispose();for(const warnings of this.warnings.values())for(const warning of warnings.values())warning.remove();this.warnings.clear();this.views.clear();this.records.clear();this.titles.clear();this.provisional.clear();this.streams.clear();this.proofs.clear();this.deviceCommits.clear();this.completionIdentities.clear();this.reads.clear();this.changedDuringRead.clear();this.relocations.clear();this.reconnecting.clear();}
}
