import type {MarkdownView} from 'obsidian';
import type {Extension,Transaction as CMTransaction} from '@codemirror/state';
import {changedInterval,mergeSavedEdits} from './coordinated-merge';
import {displayToSaved,editableDisplayRange,projectResponses,savedProjection,type LocalResponse,type ResponseProjection,ProjectionConflict} from './native-response-projection';

export interface NativeViewConflict {base:string;local:string;incoming:string;reason:string}
/** Source-only adapter. It is not registered by main.ts until the execution,
 * migration and physical-iPhone delivery gates have actually been satisfied. */
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
  private blocked?:NativeViewConflict;
  private disposed=false;
  private materialization?:{before:string;after:string;ids:string[]};
  constructor(readonly view:MarkdownView,saved:string,private conflict:(record:NativeViewConflict)=>void,private readSaved:()=>Promise<string|undefined>){
    this.base=saved;this.projection=projectResponses(saved,[]);
    this.originalGet=view.getViewData;this.originalSet=view.setViewData;
    this.originalSave=view.save;
    this.getWrapper=()=>this.saved();
    this.setWrapper=(incoming,clear)=>this.incoming(incoming,clear);
    this.saveWrapper=async clear=>{
      const intended=this.saved(),file=view.file,previousBase=this.base;
      await this.originalSave.call(view,clear);
      const disk=await this.readSaved();
      // Save return alone is not proof. Without adopting a verified own save,
      // a later external edit containing the same ordinary edit could be
      // misclassified as an overlap against an old baseline.
      if(!this.blocked&&view.file===file&&disk===intended&&this.base===previousBase)this.base=intended;
    };
    view.getViewData=this.getWrapper;view.setViewData=this.setWrapper;view.save=this.saveWrapper;
  }
  private displayed(){return this.originalGet.call(this.view);}
  saved(){
    if(this.blocked)throw new ProjectionConflict(this.blocked.reason);
    return savedProjection(this.displayed(),this.projection);
  }
  currentProjection(){
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
    const saved=this.saved(),projection=projectResponses(saved,responses);
    this.responses=responses.map(response=>({...response}));this.projection=projection;
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
  }
  private incoming(incoming:string,clear:boolean){
    if(this.disposed)return this.originalSet.call(this.view,incoming,clear);
    if(this.blocked)throw new ProjectionConflict(this.blocked.reason);
    if(this.materialization?.after===incoming){
      const intent=this.materialization;
      this.acceptCommitted(incoming,intent.ids);this.materialization=undefined;return;
    }
    const local=this.saved(),edit=changedInterval(this.base,local);
    // Obsidian may load our own just-saved projection during a mode switch or
    // echo. Identical local/incoming edits are already the same revision.
    const merge=incoming===local?{ok:true as const,text:local}:mergeSavedEdits(this.base,incoming,edit?[edit]:[]);
    if(!merge.ok){this.block({base:this.base,local,incoming,reason:merge.reason});return;}
    try{
      // A disappearance is not sufficient proof of final materialization or
      // deletion. Do not let a stale Sync version erase an active registration.
      const projection=projectResponses(merge.text,this.responses);
      if(projection.ranges.length!==this.responses.length)throw new ProjectionConflict('An incoming note lost an active response anchor.');
      this.base=incoming;this.projection=projection;
      this.render(projection.display,clear);
      if(merge.text!==incoming)this.view.requestSave();
    }catch(error){this.block({base:this.base,local,incoming,reason:error instanceof Error?error.message:String(error)});}
  }
  private block(record:NativeViewConflict){this.blocked=record;this.conflict(record);}
  /** Install only AFTER the coordinator's immutable write intent is durable,
   * before vault.process can synchronously notify native views. The incoming
   * exact bytes may be displayed, but coordinator delivery remains pending
   * until its independent disk readback succeeds. */
  prepareMaterialization(before:string,after:string,ids:readonly string[]){
    if(this.saved()!==before)throw new ProjectionConflict('The native saved projection changed before materialization.');
    this.materialization={before,after,ids:[...ids]};
  }
  cancelMaterialization(){this.materialization=undefined;}
  /** Call only with a coordinator-verified saved document. Ordinary unsaved
   * edits still take part in the same conservative three-way merge. */
  acceptCommitted(saved:string,ids:readonly string[]){
    if(this.blocked)throw new ProjectionConflict(this.blocked.reason);
    const local=this.saved(),edit=changedInterval(this.base,local),merge=mergeSavedEdits(this.base,saved,edit?[edit]:[]);
    if(!merge.ok){this.block({base:this.base,local,incoming:saved,reason:merge.reason});return;}
    const responses=this.responses.filter(r=>!ids.includes(r.id));
    const projection=projectResponses(merge.text,responses);
    this.base=saved;this.responses=responses;this.projection=projection;this.render(projection.display,false);
    if(merge.text!==saved)this.view.requestSave();
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
    if(cm?.state&&cm.state!==transaction.startState)return transaction;
    const current=transaction.startState.doc.toString();
    const projection=projectResponses(savedProjection(current,this.projection),this.responses);
    let allowed=true;
    transaction.changes.iterChangedRanges((from,to)=>{if(!editableDisplayRange(projection,from,to))allowed=false;});
    return allowed?transaction:[];
  }
  /** Remove local output before unwrapping the save boundary. A conflict must
   * first be journaled/resolved; unwrapping a blocked view could save bad data. */
  dispose(){
    if(this.disposed)return;
    if(this.blocked)throw new ProjectionConflict('Resolve and journal the view conflict before unloading the adapter.');
    const saved=this.saved();this.responses=[];this.projection=projectResponses(saved,[]);this.render(saved,false);
    if(this.view.getViewData===this.getWrapper)this.view.getViewData=this.originalGet;
    if(this.view.setViewData===this.setWrapper)this.view.setViewData=this.originalSet;
    if(this.view.save===this.saveWrapper)this.view.save=this.originalSave;
    this.disposed=true;
  }
}
