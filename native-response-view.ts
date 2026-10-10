import type {MarkdownView,TFile} from 'obsidian';
import {regionBody} from './inline-thread';
import type {Extension,Transaction as CMTransaction} from '@codemirror/state';
import {changedEdits,changedInterval,mergeSavedEdits} from './coordinated-merge';
import {advanceProjection,projectResponses,savedProjection,savedToDisplay,responseRegion,type LocalResponse,type ResponseProjection,ProjectionConflict} from './native-response-projection';
import {ResponseScroll} from './response-scroll';
import {presentToolGroups,restoreToolGroups,recoverToolGroups,compactToolGroups,assertCanonicalToolGroups,canonicalToolGroup,type ToolPresentation} from './response-tool-presentation';
import {toolDisplayOffset} from './response-tool-presentation';
import {startMarker} from './inline-thread';

export interface NativeViewConflict {base:string;local:string;incoming:string;reason:string;awaitingCompletion?:boolean;attemptedIncoming?:string;unsafeIncoming?:boolean}
/** Native rendering with a separate saved projection. */
export class NativeResponseView {
  private originalGet:MarkdownView['getViewData'];
  private originalSet:MarkdownView['setViewData'];
  private originalSave:MarkdownView['save'];
  private originalRequestSave:MarkdownView['requestSave'];
  private requestSaveWrapper:MarkdownView['requestSave'];
  private saveFences=0;
  private deferredSave=false;
  private saveBaseline?:{descriptor:PropertyDescriptor;value:unknown};
  private checkedDocuments=new WeakMap<object,ResponseProjection>();
  private getWrapper:MarkdownView['getViewData'];
  private setWrapper:MarkdownView['setViewData'];
  private saveWrapper:MarkdownView['save'];
  private projection:ResponseProjection;
  private responses:LocalResponse[]=[];
  private savedTools:ToolPresentation={canonical:'',display:'',groups:[]};
  private responseTools=new Map<string,ToolPresentation>();
  private compactTools=true;
  private base:string;
  private diskBase:string;
  private blocked?:NativeViewConflict;
  private disposed=false;
  private unloading=false;
  private file:TFile|null;
  private materialized=new Set<string>();
  private ownSave?:{text:string};
  private materialization?:{before:string;after:string;ids:string[]};
  private scroll:ResponseScroll;
  constructor(readonly view:MarkdownView,saved:string,private conflict:(record:NativeViewConflict)=>void,private readSaved:()=>Promise<string|undefined>,private normalizeIncoming?:(text:string)=>string,private committedIncoming?:(text:string)=>readonly string[],private reconciled?:()=>void){
    this.file=view.file;this.base=saved;this.diskBase=saved;this.projection=this.buildProjection(saved,[]);
    this.scroll=new ResponseScroll(view,()=>this.currentProjection());
    this.originalGet=view.getViewData;this.originalSet=view.setViewData;
    this.originalSave=view.save;
    this.originalRequestSave=view.requestSave;
    this.requestSaveWrapper=()=>{if(this.unloading&&this.blocked)return;if(this.saveFences){this.deferredSave=true;return;}return this.originalRequestSave.call(view);};
    this.getWrapper=()=>this.saved();
    this.setWrapper=(incoming,clear)=>this.incoming(incoming,clear);
    this.saveWrapper=async clear=>{
      if(this.unloading&&this.blocked)return;
      if(this.saveFences){this.deferredSave=true;return;}
      const file=view.file;
      const previousDisk=await this.readSaved();
      if(this.saveFences){this.deferredSave=true;return;}
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
    view.getViewData=this.getWrapper;view.setViewData=this.setWrapper;view.save=this.saveWrapper;view.requestSave=this.requestSaveWrapper;
  }
  responseBody(id:string){return this.responses.find(response=>response.id===id)?.body??regionBody(this.displayed(),id)?.body;}
  toolGroup(ref:string){return canonicalToolGroup(this.savedTools,ref)??[...this.responseTools.values()].map(presentation=>canonicalToolGroup(presentation,ref)).find(body=>body!==undefined);}
  private canonicalOffset(display:string,offset:number,presentation=this.savedTools){
    const compact=compactToolGroups(display);let shift=0;
    if(compact.length!==presentation.groups.length)throw new ProjectionConflict('The retained tool summary is missing.');
    for(let index=0;index<compact.length;index++){const actual=compact[index],group=presentation.groups[index];if(actual.text!==group.placeholder)throw new ProjectionConflict('The retained tool summary changed.');if(offset<=actual.from)break;if(offset<actual.to)throw new ProjectionConflict('The saved offset is inside a tool summary.');shift+=(group.canonicalTo-group.canonicalFrom)-(actual.to-actual.from);}
    return offset+shift;
  }
  private canonicalProjection(projection:ResponseProjection,presentation=this.savedTools):ResponseProjection {
    const saved=restoreToolGroups(projection.saved,presentation);
    return {...projection,saved,ranges:projection.ranges.map(range=>({...range,savedFrom:this.canonicalOffset(projection.saved,range.savedFrom,presentation),savedTo:this.canonicalOffset(projection.saved,range.savedTo,presentation)}))};
  }
  private buildProjection(saved:string,responses:readonly LocalResponse[]):ResponseProjection {
    assertCanonicalToolGroups(saved);for(const response of responses)assertCanonicalToolGroups(response.body);
    const compact=(this.view as any).getState?.().source!==true;
    const savedTools=compact?presentToolGroups(saved):{canonical:saved,display:saved,groups:[]},responseTools=new Map<string,ToolPresentation>();
    const displayed=responses.map(response=>{const presentation=compact?presentToolGroups(response.body):{canonical:response.body,display:response.body,groups:[]};responseTools.set(response.id,presentation);return {...response,body:presentation.display};});
    const projection=this.canonicalProjection(projectResponses(savedTools.display,displayed),savedTools);
    this.savedTools=savedTools;this.responseTools=responseTools;this.compactTools=compact;
    this.checkedDocuments=new WeakMap();
    return projection;
  }
  private restoreSaved(display:string){return restoreToolGroups(savedProjection(display,this.projection),this.savedTools);}
  private displayed(){return this.originalGet.call(this.view);}
  saved():string {
    if(this.blocked)throw new ProjectionConflict(this.blocked.reason);
    const display=this.displayed();
    if(!this.projection.ranges.length&&display===this.projection.saved)return display;
    const doc=(this.view.editor as any)?.cm?.state?.doc,cached=doc&&this.checkedDocuments.get(doc);
    if(cached&&cached.display===display){this.projection=cached;return cached.saved;}
    // Reuse only this view's already validated projection and only when its
    // actual native bytes are identical. Every ordinary edit takes the full
    // projection path; a cached whole-note snapshot never strips changed text.
    return display===this.projection.display?this.projection.saved:this.restoreSaved(display);
  }
  currentProjection(){
    if(this.blocked)throw new ProjectionConflict(this.blocked.reason);
    if(this.displayed()===this.projection.display)return this.projection;
    const saved=this.saved();
    this.projection=this.buildProjection(saved,this.responses);
    return this.projection;
  }
  /** Prompt/context reads retain full tool output and local response bodies.
   * This is deliberately separate from the saved projection and CM offsets. */
  canonicalDisplayed(){return projectResponses(this.saved(),this.responses).display;}
  canonicalSelection(from:number,to:number){
    const projection=this.currentProjection();
    if(!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||from<0||to<from||to>projection.display.length)throw new ProjectionConflict('The selected display range changed.');
    const groups=compactToolGroups(projection.display),reference=groups.some(group=>from<group.to&&to>group.from);
    // A partial compact summary names its complete retained tool group. Never
    // treat a few placeholder characters as the selected canonical output.
    let expandedFrom=from,expandedTo=to;
    for(const group of groups){if(from>group.from&&from<group.to)expandedFrom=group.from;if(to>group.from&&to<group.to)expandedTo=group.to;}
    const mapped=this.mapSelection(expandedFrom,expandedTo),canonical=projectResponses(projection.saved,this.responses);
    const position=(value:typeof mapped.from)=>{
      if(value.kind==='saved')return savedToDisplay(canonical,value.offset);
      const range=canonical.ranges.find(range=>range.id===value.id);if(!range)throw new ProjectionConflict('The selected response changed.');
      const offset=range.displayFrom+value.offset;if(offset<range.displayFrom||offset>range.displayTo)throw new ProjectionConflict('The selected response offset changed.');return offset;
    };
    const start=position(mapped.from),end=position(mapped.to);if(start>end||end>canonical.display.length)throw new ProjectionConflict('The canonical selection changed.');
    return {document:canonical.display,start,end,text:canonical.display.slice(start,end),reference:reference||mapped.from.kind==='response'||mapped.to.kind==='response'};
  }
  mapSelection(from:number,to:number){
    const projection=this.currentProjection();
    const position=(offset:number,end:boolean)=>{
      let delta=0;
      for(const range of projection.ranges){
        if(offset<=range.displayFrom)break;
        if(offset<range.displayTo){const local=offset-range.displayFrom,prefix=startMarker(range.id).length+1,presentation=this.responseTools.get(range.id);if(!presentation||local<prefix||local>prefix+presentation.display.length)return {kind:'response' as const,id:range.id,offset:local};const mapped=toolDisplayOffset(presentation,local-prefix);return {kind:'response' as const,id:range.id,offset:prefix+(mapped.kind==='canonical'?mapped.offset:end?mapped.to:mapped.from)};}
        delta+=range.displayTo-range.displayFrom-range.anchor.length;
      }
      const smallSaved=savedProjection(projection.display,projection);return {kind:'saved' as const,offset:this.canonicalOffset(smallSaved,offset-delta)};
    };
    return {from:position(from,false),to:position(to,true),text:this.displayed().slice(from,to)};
  }
  setResponses(responses:readonly LocalResponse[]){
    if(this.disposed)throw Error('Native response view is disposed.');
    if(this.blocked)throw new ProjectionConflict(this.blocked.reason);
    if(this.compactTools===((this.view as any).getState?.().source!==true)&&responses.length===this.responses.length&&responses.every((response,index)=>response.id===this.responses[index].id&&response.body===this.responses[index].body)&&this.displayed()===this.projection.display)return;
    const saved=this.saved(),projection=this.buildProjection(saved,responses);
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
    const attemptedIncoming=incoming;
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
    if(compactToolGroups(incoming).length){
      try{incoming=restoreToolGroups(incoming,this.savedTools);}catch(error){
        const local=this.saved();let canonical=local,unsafeIncoming=true;
        try{canonical=recoverToolGroups(incoming,this.savedTools);assertCanonicalToolGroups(canonical);projectResponses(canonical,this.responses);unsafeIncoming=false;}catch{/* Retain the save boundary until recovery or a file switch. */}
        this.block({base:this.base,local,incoming:canonical,attemptedIncoming,unsafeIncoming,reason:error instanceof Error?error.message:String(error)});return;
      }
    }
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
      const projection=this.buildProjection(merge.text,this.responses);
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
    this.projection=this.buildProjection(saved,this.responses);this.render(this.projection.display,false);this.view.requestSave();
  }
  conflictRecord(){return this.blocked;}
  reviewSaved(disk:string):string|undefined {
    const base=this.blocked?.base??this.base,local=this.blocked?.local??this.saved();
    const merge=disk===local?{ok:true as const,text:local}:mergeSavedEdits(base,disk,changedEdits(base,local));
    if(!merge.ok)return;
    try{const projection=projectResponses(merge.text,this.responses);if(projection.ranges.length!==this.responses.length)return;return merge.text;}catch{return;}
  }
  resumeReviewed(disk:string,reviewed:string){
    if(this.reviewSaved(disk)!==reviewed)throw Error('The reviewed native recovery changed.');
    const projection=this.buildProjection(reviewed,this.responses);
    this.base=disk;this.diskBase=disk;this.blocked=undefined;this.unloading=false;this.ownSave=undefined;this.projection=projection;this.render(projection.display,false);
    // The conflict journal remains until the final verified disk save.
  }
  confirmPendingConflict(reason:string){if(this.blocked?.awaitingCompletion)this.block({...this.blocked,reason,awaitingCompletion:false});}
  reconcileDisk(document:string){if(document!==this.diskBase){this.incoming(document,false);if(!this.blocked)this.diskBase=document;}}
  /** A newly attached pane can already contain unsaved ordinary text. Use
   * the native saved baseline and a fenced full disk read before treating its
   * creation bytes as a final-write snapshot. Compact summaries never supply
   * canonical backing for this boundary. */
  initializeDiskBaseline(disk:string,materializing=false){
    if(this.blocked){if(materializing)return;throw new ProjectionConflict(this.blocked.reason);}
    const local=this.saved(),baseline=typeof this.saveBaseline?.value==='string'?this.saveBaseline.value:this.base;
    try{assertCanonicalToolGroups(baseline);assertCanonicalToolGroups(disk);}catch(error){
      const reason=error instanceof Error?error.message:String(error);
      this.block({base:this.base,local,incoming:local,attemptedIncoming:disk,unsafeIncoming:true,reason});throw error;
    }
    // A separately verified pending commit can have removed its anchor before
    // the native file notification. Retain the full original native baseline
    // for resolveCommitted's ordinary-edit merge; this does not adopt bytes.
    if(materializing){this.base=baseline;this.diskBase=baseline;return;}
    const merge=disk===local?{ok:true as const,text:local}:mergeSavedEdits(baseline,disk,changedEdits(baseline,local));
    if(!merge.ok){this.block({base:baseline,local,incoming:disk,reason:merge.reason});throw new ProjectionConflict(merge.reason);}
    try{
      const projection=this.buildProjection(merge.text,this.responses);
      if(projection.ranges.length!==this.responses.length)throw new ProjectionConflict('The exact durable response anchor is missing.');
      this.base=disk;this.diskBase=disk;this.projection=projection;this.render(projection.display,false);
      if(merge.text!==disk)this.view.requestSave();
    }catch(error){const reason=error instanceof Error?error.message:String(error);this.block({base:baseline,local,incoming:disk,reason});throw error;}
  }
  markMaterialized(id:string){this.materialized.add(id);}
  preserveConflict(record:NativeViewConflict){if(!this.blocked)this.block(record);}
  resolveConflict(saved:string,choice:'saved'|'local'){
    if(!this.blocked)throw Error('This native view has no preserved conflict.');
    const chosen=choice==='local'?this.blocked.local:saved;
    const responses=this.responses.filter(response=>{try{return !!responseRegion(chosen,response.id);}catch{return false;}});
    this.projection=this.buildProjection(chosen,responses);this.responses=responses;this.base=saved;this.blocked=undefined;this.unloading=false;this.render(this.projection.display,false);
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
      projection=this.buildProjection(merge.text,responses);
    }catch(error){if(!this.blocked||this.blocked.awaitingCompletion)this.block({base,local,incoming:saved,reason:error instanceof Error?error.message:String(error)});return false;}
    // All validation precedes this single transition. A failed merge cannot
    // retire a response, clear a conflict or briefly render an empty anchor.
    this.blocked=undefined;this.unloading=false;this.base=saved;this.diskBase=saved;this.ownSave=undefined;this.responses=responses;this.projection=projection;
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
    if(this.view.requestSave===this.requestSaveWrapper)this.view.requestSave=this.originalRequestSave;
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
  /** Cancel the constructor-bound debounce and drain any save that already
   * captured bytes before taking the final-write snapshot. New autosaves wait
   * until checked materialization and disk readback have both finished. */
  async beginFinalSave(review=false):Promise<()=>void>{
    this.saveFences++;let released=false;
    const release=()=>{if(released)return;released=true;if(--this.saveFences===0){
      const baseline=this.saveBaseline;if(baseline){Object.defineProperty(this.view,'lastSavedData',{...baseline.descriptor,value:baseline.value});this.saveBaseline=undefined;}
      if(this.deferredSave){this.deferredSave=false;this.originalRequestSave.call(this.view);}
    }};
    try{
      (this.originalRequestSave as any)?.cancel?.();
      if(!review)this.saved();
      if(this.saveFences===1){
        // TextFileView's requestSave closes over its constructor-bound save.
        // That debounce cannot be cancelled through requestSave. While held,
        // its unchanged-data check must see the same honest saved projection
        // as getViewData. Keep the real baseline separately for later saves.
        const descriptor=Object.getOwnPropertyDescriptor(this.view,'lastSavedData');
        if(descriptor){
          if(!descriptor.configurable||!('value' in descriptor))throw Error('This native save cannot be fenced safely.');
          this.saveBaseline={descriptor,value:descriptor.value};
          Object.defineProperty(this.view,'lastSavedData',{configurable:true,enumerable:descriptor.enumerable,get:()=>this.blocked?this.saveBaseline!.value:this.saved(),set:value=>{this.saveBaseline!.value=value;}});
        }
        if((this.view as any).dirty)this.deferredSave=true;
      }
      const deadline=Date.now()+5000;
      const drain=async()=>{while((this.view as any).saving){if(Date.now()>=deadline)throw Error('Waiting for a native save before final delivery.');await new Promise(resolve=>setTimeout(resolve,10));}};
      await drain();
      await this.readSaved();
      if(this.disposed)throw Error('The native view closed before final delivery.');
      return release;
    }catch(error){release();throw error;}
  }
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
    if(this.unloading)return [];
    const cm=(this.view.editor as any)?.cm;
    if(!cm?.state||cm.state!==transaction.startState)return transaction;
    try{
      let projection=this.checkedDocuments.get(transaction.startState.doc);
      if(!projection){const current=transaction.startState.doc.toString();projection=current===this.projection.display?this.projection:this.buildProjection(this.restoreSaved(current),this.responses);this.checkedDocuments.set(transaction.startState.doc,projection);}
      this.checkedDocuments.set(transaction.newDoc,this.canonicalProjection(advanceProjection(transaction,projection)));return transaction;
    }catch{return [];}
  }
  /** Remove local output before unwrapping the save boundary. A conflict must
   * first be journaled/resolved; unwrapping a blocked view could save bad data. */
  dispose(){
    if(this.disposed)return;
    if(this.blocked?.unsafeIncoming){this.unloading=true;this.scroll.dispose();return;}
    // The competing local version is already preserved by the conflict callback.
    // Unload must not silently save it over the incoming version.
    const saved=this.blocked?this.blocked.incoming:this.saved();
    try{assertCanonicalToolGroups(saved);}catch{this.unloading=true;this.scroll.dispose();return;}
    this.responses=[];this.projection=projectResponses(saved,[]);this.render(saved,false);
    this.unwrap();
  }
}
