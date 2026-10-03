import {contentHash} from './completion';
import type {App,MarkdownView} from 'obsidian';
import type {Transaction} from '@codemirror/state';
import {NativeResponseView} from './native-response-view';
import {responseAnchor,responseRegion,type LocalResponse} from './native-response-projection';
import type {LeaseRecord} from './inline-lease';
import {regionBody,initialRegion,startMarker,endMarker} from './inline-thread';
import {logFailure} from './diagnostics';
import {nativeCommitMatches,readNativeCommitProof,type NativeCommitProof} from './native-response-commit';

const managers=new WeakMap<App,NativeResponseManager>();
export function nativeResponses(app:App){let manager=managers.get(app);if(!manager){manager=new NativeResponseManager(app);managers.set(app,manager);}return manager;}
/** Each native view owns its projection, history and selection. Saved content
 * is compared independently across views; streaming never copies an editor
 * buffer over a competing view. Conflict snapshots are device-local. */
export class NativeResponseManager {
  private views=new Map<MarkdownView,NativeResponseView>();
  private provisional=new Map<string,{path:string;body:string}>();
  private records=new Map<string,LeaseRecord>();
  private proofs=new Map<string,NativeCommitProof>();
  private reads=new Map<string,Promise<void>>();
  private changedDuringRead=new Set<string>();
  private lifetime=0;
  constructor(private app:App){}
  view(view:MarkdownView){const adapter=this.views.get(view);return adapter&&!adapter.isDisposed()?adapter:undefined;}
  conflictedView(path:string){return [...this.views].find(([view,adapter])=>view.file?.path===path&&!adapter.isDisposed()&&adapter.conflictRecord())?.[0];}
  preview(view:MarkdownView,id:string,body:string){this.provisional.set(id,{path:view.file!.path,body});this.refresh();}
  async receive(record:LeaseRecord,proofBytes?:string){
    if(!record.coordinated)return;
    const old=this.records.get(record.request.id);if(old&&(old.epoch>record.epoch||old.epoch===record.epoch&&old.revision>record.revision))return;
    if(proofBytes&&record.state?.delivery)this.proofs.set(record.request.id,readNativeCommitProof(proofBytes,record.request.id,record.state.delivery));
    this.provisional.delete(record.request.id);this.records.set(record.request.id,record);
    this.refresh();
    if(record.state?.delivery&&record.state.cleanupComplete)await this.changed(record.state.notePath);
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
    for(const [view,adapter] of this.views)if(!live.has(view)||adapter.isDisposed()){if(!adapter.isDisposed())adapter.dispose();this.views.delete(view);}
    for(const view of live){
      if(!view.file||typeof view.getViewData!=='function')continue;
      try{
        let adapter=this.view(view),saved=adapter?adapter.saved():view.getViewData();
        const responses:LocalResponse[]=[...this.provisional.entries()].filter(([,item])=>item.path===view.file!.path).map(([id,item])=>({id,body:item.body}));
        for(const record of this.records.values()){
          if((record.state?.notePath??record.request.notePath)!==view.file.path)continue;
          const id=record.request.id;
          if(!saved.includes(startMarker(id))&&!saved.includes(endMarker(id)))continue;
          const region=responseRegion(saved,id);
          if(!region||saved.slice(region.from,region.to)!==responseAnchor(id))continue;
          if(record.state?.cleanupComplete&&adapter?.hasMaterialized(id))continue;
          responses.push({id,body:(record.state?.cleanupComplete?record.state.finalBody:undefined)??record.state?.body??regionBody(initialRegion(id,record.request.initialInput,record.request.threadTitle,record.request.intermediateMode,{startedAt:record.request.createdAt}).text,id)!.body});
        }
        if(!adapter&&responses.length){
          const file=view.file;
          adapter=new NativeResponseView(view,saved,conflict=>{
            this.app.saveLocalStorage(`t3-native-conflict:${file.path}:${Date.now()}`,conflict);
            logFailure('note.projection.conflict',Error(conflict.reason),{notePath:file.path});
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
  dispose(){this.lifetime++;for(const adapter of this.views.values())adapter.dispose();this.views.clear();this.records.clear();this.provisional.clear();this.proofs.clear();this.reads.clear();this.changedDuringRead.clear();}
}
