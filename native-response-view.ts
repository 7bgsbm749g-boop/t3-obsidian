import type {MarkdownView,TFile} from 'obsidian';
import {regionBody} from './inline-thread';
import type {Extension,Transaction as CMTransaction} from '@codemirror/state';
import {changedEdits,changedInterval,mergeSavedEdits} from './coordinated-merge';
import {displayToSaved,editableDisplayRange,projectResponses,savedProjection,responseRegion,type LocalResponse,type ResponseProjection,ProjectionConflict} from './native-response-projection';
import {ResponseScroll} from './response-scroll';

export interface NativeViewConflict {base:string;local:string;incoming:string;reason:string;awaitingCompletion?:boolean}
/** Native rendering with a separate saved projection. */
export class NativeResponseView {
  private originalGet:MarkdownView['getViewData'];
  private originalSet:MarkdownView['setViewData'];
  private originalSave:MarkdownView['save'];
  private getWrapper:MarkdownView['getViewData'];
  private setWrapper:MarkdownView['setViewData'];
  private saveWrapper:MarkdownView['save'];
  private projection:ResponseProjection;
  private responses:LocalResponse[]=[];
  private base:string;
  private diskBase:string;
  private blocked?:NativeViewConflict;
  private disposed=false;
  private file:TFile|null;
  private materialized=new Set<string>();
  private ownSave?:{text:string};
  private materialization?:{before:string;after:string;ids:string[]};
  private scroll:ResponseScroll;
  constructor(readonly view:MarkdownView,saved:string,private conflict:(record:NativeViewConflict)=>void,private readSaved:()=>Promise<string|undefined>,private normalizeIncoming?:(text:string)=>string,private committedIncoming?:(text:string)=>readonly string[],private reconciled?:()=>void){
    this.file=view.file;this.base=saved;this.diskBase=saved;this.projection=projectResponses(saved,[]);
    this.scroll=new ResponseScroll(view,()=>this.currentProjection());
    this.originalGet=view.getViewData;this.originalSet=view.setViewData;
    this.originalSave=view.save;
    this.getWrapper=()=>this.saved();
    this.setWrapper=(incoming,clear)=>this.incoming(incoming,clear);
    this.saveWrapper=async clear=>{
      const file=view.file;
      const previousDisk=await this.readSaved();
      if(this.disposed||view.file!==file)return;
      // Obsidian's save can return before its debounce reaches disk. Recognize
      // that exact own intent on the next read before merging a later edit or
      // undo against the older baseline. The actual disk bytes remain proof.
      if(this.ownSave&&previousDisk===this.ownSave.text){this.base=previousDisk;this.diskBase=previousDisk;this.ownSave=undefined;}
      // A completed file can arrive before its native notification or lease.
      // Check only previously saved response anchors here. Ordinary autosave
      // can bypass view.save, and cross-pane echoes can be ahead of disk; an
      // ordinary difference alone must never overwrite edits or native undo.
      if(previousDisk!==undefined){
        const lost=this.responses.some(response=>{
          try{return !!responseRegion(this.diskBase,response.id)&&!responseRegion(previousDisk,response.id);}catch{return true;}
        });
        if(lost)this.incoming(previousDisk,false);
        this.diskBase=previousDisk;
      }
      const intended=this.saved(),previousBase=this.base;
      // Native document changes schedule autosave for local streaming too.
      // Do not touch the file when its saved projection is already identical.
      if(clear||previousDisk!==this.saved()){this.ownSave={text:intended};await this.originalSave.call(view,clear);}
      const disk=await this.readSaved();
      // Save return alone is not proof. Without adopting a verified own save,
      // a later external edit containing the same ordinary edit could be
      // misclassified as an overlap against an old baseline.
      if(!this.blocked&&view.file===file&&disk===intended){this.diskBase=disk;if(this.base===previousBase)this.base=intended;if(this.ownSave?.text===intended)this.ownSave=undefined;}
    };
    view.getViewData=this.getWrapper;view.setViewData=this.setWrapper;view.save=this.saveWrapper;
  }
  responseBody(id:string){return regionBody(this.displayed(),id)?.body??this.responses.find(response=>response.id===id)?.body;}
  private displayed(){return this.originalGet.call(this.view);}
  saved(){
    if(this.blocked)throw new ProjectionConflict(this.blocked.reason);
    const display=this.displayed();
    // Reuse only this view's already validated projection and only when its
    // actual native bytes are identical. Every ordinary edit takes the full
    // projection path; a cached whole-note snapshot never strips changed text.
    return display===this.projection.display?this.projection.saved:savedProjection(display,this.projection);
  }
  currentProjection(){
    if(this.blocked)throw new ProjectionConflict(this.blocked.reason);
    if(this.displayed()===this.projection.display)return this.projection;
    const saved=this.saved();
    this.projection=projectResponses(saved,this.responses);
    return this.projection;
  }
  mapSelection(from:number,to:number){
    const projection=this.currentProjection();
    return {from:displayToSaved(projection,from),to:displayToSaved(projection,to),text:this.displayed().slice(from,to)};
  }
  setResponses(responses:readonly LocalResponse[]){
    if(this.disposed)throw Error('Native response view is disposed.');
    if(this.blocked)throw new ProjectionConflict(this.blocked.reason);
    if(responses.length===this.responses.length&&responses.every((response,index)=>response.id===this.responses[index].id&&response.body===this.responses[index].body)&&this.displayed()===this.projection.display)return;
    const saved=this.saved(),projection=projectResponses(saved,responses);
    this.responses=responses.map(response=>({...response}));this.projection=projection;
    for(const response of responses)this.materialized.delete(response.id);
    this.render(projection.display,false);
  }
  private render(display:string,clear:boolean){
    const current=this.displayed(),change=changedInterval(current,display);
    if(!change)return;
    const cm=(this.view.editor as any)?.cm;
    if(!clear&&this.view.getMode()!=='preview'&&cm){
      const {Transaction}=require('@codemirror/state') as typeof import('@codemirror/state');
      // Streaming updates map selections and ordinary undo history without
      // becoming user undo steps. Native rendering and folds stay in place.
      cm.dispatch({changes:{from:change.from,to:change.to,insert:change.text},annotations:[Transaction.addToHistory.of(false),Transaction.userEvent.of('send-to-t3-projection')],filter:false,scrollIntoView:false});
    }else this.originalSet.call(this.view,display,clear);
    this.scroll.updated();
  }
  private incoming(incoming:string,clear:boolean){
    if(this.disposed)return this.originalSet.call(this.view,incoming,clear);
    if(this.view.file!==this.file){this.unwrap();return this.originalSet.call(this.view,incoming,clear);}
    // Another pane can echo the committed file with remaining local response
    // bodies still displayed. Compare the exact saved projection to the
    // durable materialization intent, rather than those transient bodies.
    if(this.normalizeIncoming){try{incoming=this.normalizeIncoming(incoming);}catch{/* Preserve ambiguous boundaries for the conflict path. */}}
    if(this.materialization?.after===incoming){
      const intent=this.materialization;
      if(this.resolveCommitted(incoming,intent.ids,clear))this.materialization=undefined;return;
    }
    const committed=this.committedIncoming?.(incoming)??[];
    if(committed.length){this.resolveCommitted(incoming,committed,clear);return;}
    if(this.blocked)throw new ProjectionConflict(this.blocked.reason);
    // Obsidian synchronizes native editor data between panes before disk
    // autosave. Its setViewData payload can therefore be a displayed document.
    // Strip only this view's exact registered marker pairs; malformed/missing
    // pairs still take the preserved-conflict path below.
    if(this.projection.ranges.length){try{incoming=savedProjection(incoming,this.projection);}catch{/* Final materialization or damaged boundaries: retain exact incoming bytes. */}}
    const local=this.saved();
    if(this.ownSave?.text===incoming)this.base=incoming;
    const edits=changedEdits(this.base,local);
    if([...this.materialized].some(id=>responseRegion(incoming,id))){this.block({base:this.base,local,incoming,reason:'An incoming note resurrected an already materialized response anchor.'});return;}
    // Obsidian may load our own just-saved projection during a mode switch or
    // echo. Identical local/incoming edits are already the same revision.
    const merge=incoming===local?{ok:true as const,text:local}:mergeSavedEdits(this.base,incoming,edits);
    if(!merge.ok){this.block({base:this.base,local,incoming,reason:merge.reason});return;}
    try{
      // A disappearance is not sufficient proof of final materialization or
      // deletion. Do not let a stale Sync version erase an active registration.
      const projection=projectResponses(merge.text,this.responses);
      if(projection.ranges.length!==this.responses.length)throw new ProjectionConflict('An incoming note lost an active response anchor.');
      this.base=incoming;this.projection=projection;
      this.render(projection.display,clear);
      if(merge.text!==incoming)this.view.requestSave();
    }catch(error){
      const reason=error instanceof Error?error.message:String(error);
      // Sync can deliver the final note before its independent completion
      // receipt. Preserve both versions and fence autosave while the manager
      // obtains proof; a missing marker alone is not a user-edit conflict.
      const awaitingCompletion=reason==='The exact durable response anchor is missing.';
      this.block({base:this.base,local,incoming,reason,...(awaitingCompletion?{awaitingCompletion:true}:{})});
    }
  }
  editSaved(saved:string){
    if(this.blocked)throw new ProjectionConflict(this.blocked.reason);
    this.projection=projectResponses(saved,this.responses);this.render(this.projection.display,false);this.view.requestSave();
  }
  conflictRecord(){return this.blocked;}
  confirmPendingConflict(reason:string){if(this.blocked?.awaitingCompletion)this.block({...this.blocked,reason,awaitingCompletion:false});}
  reconcileDisk(document:string){if(document!==this.diskBase){this.incoming(document,false);if(!this.blocked)this.diskBase=document;}}
  markMaterialized(id:string){this.materialized.add(id);}
  preserveConflict(record:NativeViewConflict){if(!this.blocked)this.block(record);}
  resolveConflict(saved:string,choice:'saved'|'local'){
    if(!this.blocked)throw Error('This native view has no preserved conflict.');
    const chosen=choice==='local'?this.blocked.local:saved;
    const responses=this.responses.filter(response=>{try{return !!responseRegion(chosen,response.id);}catch{return false;}});
    this.projection=projectResponses(chosen,responses);this.responses=responses;this.base=saved;this.blocked=undefined;this.render(this.projection.display,false);
    this.reconciled?.();
    if(chosen!==saved)this.view.requestSave();
  }
  hasMaterialized(id:string){return this.materialized.has(id);}
  responseIds(){return this.responses.map(response=>response.id);}
  resolveCommitted(saved:string,ids:readonly string[],clear=false){
    if(this.disposed)return false;
    const base=this.blocked?.base??this.base;
    const local=this.blocked?.local??(this.displayed()===saved?this.base:this.saved());
    const merge=mergeSavedEdits(base,saved,changedEdits(base,local));
    if(!merge.ok){if(!this.blocked||this.blocked.awaitingCompletion)this.block({base,local,incoming:saved,reason:merge.reason});return false;}
    const responses=this.responses.filter(r=>!ids.includes(r.id));
    let projection:ResponseProjection;
    try{
      if(ids.some(id=>responseRegion(saved,id)))throw new ProjectionConflict('The saved result still contains a response anchor.');
      projection=projectResponses(merge.text,responses);
    }catch(error){if(!this.blocked||this.blocked.awaitingCompletion)this.block({base,local,incoming:saved,reason:error instanceof Error?error.message:String(error)});return false;}
    // All validation precedes this single transition. A failed merge cannot
    // retire a response, clear a conflict or briefly render an empty anchor.
    this.blocked=undefined;this.base=saved;this.diskBase=saved;this.ownSave=undefined;this.responses=responses;this.projection=projection;
    for(const id of ids)this.materialized.add(id);
    this.render(projection.display,clear);
    this.reconciled?.();
    if(merge.text!==saved)this.view.requestSave();return true;
  }
  isDisposed(){return this.disposed;}
  private unwrap(){
    this.scroll.dispose();
    if(this.view.getViewData===this.getWrapper)this.view.getViewData=this.originalGet;
    if(this.view.setViewData===this.setWrapper)this.view.setViewData=this.originalSet;
    if(this.view.save===this.saveWrapper)this.view.save=this.originalSave;
    this.disposed=true;
  }
  private block(record:NativeViewConflict){this.scroll.suspend();this.blocked=record;this.conflict(record);}
  /** Install only AFTER the coordinator's immutable write intent is durable,
   * before vault.process can synchronously notify native views. The incoming
   * exact bytes may be displayed, but coordinator delivery remains pending
   * until its independent disk readback succeeds. */
  prepareMaterialization(before:string,after:string,ids:readonly string[]){
    if(this.saved()!==before)throw new ProjectionConflict('The native saved projection changed before materialization.');
    // The host has read this exact saved revision and checked every pane.
    // Another pane may have saved a new registration before this pane's own
    // save acknowledgement advanced its baseline. Materialize against that
    // checked revision, not the earlier document without the registration.
    this.base=before;
    this.materialization={before,after,ids:[...ids]};
  }
  cancelMaterialization(){this.materialization=undefined;}
  /** Call only with a coordinator-verified saved document. Ordinary unsaved
   * edits still take part in the same conservative three-way merge. */
  acceptCommitted(saved:string,ids:readonly string[]){
    // A native file update can load the exact verified bytes before our
    // materialization callback runs. The old projection no longer has anchors
    // in that document; it is already the authoritative committed version.
    // A save hook can preserve a transient projection conflict during that
    // update. Recheck its preserved versions with the same conservative merge;
    // disk verification does not justify discarding competing ordinary edits.
    return this.resolveCommitted(saved,ids);
  }
  /** Registered only on this view's native CodeMirror instance by the lab.
   * Ordinary edits, selection and history use Obsidian's normal commands. */
  extension():Extension {
    const {EditorState}=require('@codemirror/state') as typeof import('@codemirror/state');
    return EditorState.transactionFilter.of(transaction=>this.filterTransaction(transaction));
  }
  filterTransaction(transaction:CMTransaction):CMTransaction|[] {
    if(this.disposed||!transaction.docChanged)return transaction;
    const cm=(this.view.editor as any)?.cm;
    if(!cm?.state||cm.state!==transaction.startState)return transaction;
    const current=transaction.startState.doc.toString();
    const projection=projectResponses(savedProjection(current,this.projection),this.responses);
    let allowed=true;
    transaction.changes.iterChangedRanges((from,to)=>{if(!editableDisplayRange(projection,from,to))allowed=false;});
    if(allowed&&projection.ranges.length){
      // A paste outside the response can duplicate a marker or enclose it in
      // code. Reject that transaction before it can break the save boundary.
      try{savedProjection(transaction.newDoc.toString(),projection);}catch{allowed=false;}
    }
    return allowed?transaction:[];
  }
  /** Remove local output before unwrapping the save boundary. A conflict must
   * first be journaled/resolved; unwrapping a blocked view could save bad data. */
  dispose(){
    if(this.disposed)return;
    // The competing local version is already preserved by the conflict callback.
    // Unload must not silently save it over the incoming version.
    const saved=this.blocked?this.blocked.incoming:this.saved();this.responses=[];this.projection=projectResponses(saved,[]);this.render(saved,false);
    this.unwrap();
  }
}
