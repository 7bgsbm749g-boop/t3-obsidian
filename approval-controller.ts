import {logEvent,logFailure} from './diagnostics';
import {approvalKey,pendingApprovals,closedThreadApprovals,staleApprovalFailure,type ApprovalTarget,type ApprovalDecision,type PendingApproval} from './approvals';
import type {InlineActivity} from './inline-thread';
import type {ThreadAccess} from './thread-stream';

export interface ApprovalCommand {type:'thread.approval.respond';commandId:string;threadId:string;requestId:string;decision:ApprovalDecision;createdAt:string}
export interface ApprovalRecord {target:ApprovalTarget;command?:ApprovalCommand;failureIds?:string[];uncertain?:boolean;resolved?:boolean}
export interface ApprovalView {request?:PendingApproval;status:'loading'|'pending'|'submitting'|'resolved'|'unavailable'|'error';detail?:string;fresh?:boolean}
export interface ApprovalStore {load():ApprovalRecord[];save(records:ApprovalRecord[]):void}

/** Device-local write-ahead decisions. Refresh and reconnect never submit a command. */
export class ApprovalController {
  private records=new Map<string,ApprovalRecord>();
  private views=new Map<string,ApprovalView>();
  private listeners=new Set<()=>void>();
  private reads=new Map<string,Promise<void>>();
  private sends=new Map<string,Promise<void>>();
  private watched=new Map<string,{target:ApprovalTarget;count:number}>();
  private stopped=false;
  constructor(private access:(environmentId:string)=>Promise<ThreadAccess>,private store:ApprovalStore,private newId:()=>string,private now=()=>new Date().toISOString()){
    for(const record of store.load()){
      if(!record?.target||![record.target.environmentId,record.target.threadId,record.target.requestId].every(v=>typeof v==='string'&&v.length))continue;
      const command=record.command;
      if(command&&(command.type!=='thread.approval.respond'||command.threadId!==record.target.threadId||command.requestId!==record.target.requestId||!['accept','decline'].includes(command.decision)||typeof command.commandId!=='string'||!command.commandId||typeof command.createdAt!=='string'||!command.createdAt))continue;
      this.records.set(approvalKey(record.target),record);
    }
  }
  dispose(){this.stopped=true;this.listeners.clear();this.watched.clear();}
  subscribe(listener:()=>void){this.listeners.add(listener);return ()=>{this.listeners.delete(listener);};}
  /** Native response projections need controls refreshed before their text reaches disk. */
  watch(target:ApprovalTarget){
    const key=approvalKey(target),old=this.watched.get(key);
    if(old)old.count++;
    else{this.watched.set(key,{target,count:1});void this.refresh([target]);}
    let closed=false;
    return ()=>{if(closed)return;closed=true;const entry=this.watched.get(key);if(entry&&--entry.count===0)this.watched.delete(key);};
  }
  watchedTargets(){return [...this.watched.values()].map(entry=>entry.target);}
  private notify(){if(!this.stopped)for(const listener of this.listeners)listener();}
  private persist(){this.store.save([...this.records.values()]);}
  record(target:ApprovalTarget){const key=approvalKey(target);let record=this.records.get(key);if(!record){record={target};this.records.set(key,record);}return record;}
  view(target:ApprovalTarget):ApprovalView{return this.views.get(approvalKey(target))??(this.records.get(approvalKey(target))?.resolved?{status:'resolved'}:{status:'loading'});}
  async refresh(targets:ApprovalTarget[]){
    const groups=new Map<string,ApprovalTarget[]>();
    for(const target of targets){const key=JSON.stringify([target.environmentId,target.threadId]),group=groups.get(key)??[];if(!group.some(t=>t.requestId===target.requestId))group.push(target);groups.set(key,group);}
    await Promise.all([...groups].map(async([key,group])=>{
      const old=this.reads.get(key),work=(async()=>{await old;if(!this.stopped)await this.read(group);})();this.reads.set(key,work);
      try{await work;}finally{if(this.reads.get(key)===work)this.reads.delete(key);}
    }));
  }
  private async read(targets:ApprovalTarget[]){
    let access:ThreadAccess|undefined;
    try{
      const first=targets[0];access=await this.access(first.environmentId);
      const snapshot=await access.api(`/api/orchestration/threads/${encodeURIComponent(first.threadId)}`);
      if(snapshot?.thread?.id!==first.threadId||!Array.isArray(snapshot.thread.activities))throw Error('T3 returned an invalid approval snapshot.');
      if(this.stopped)return;
      const activities:InlineActivity[]=snapshot.thread.activities,pending=pendingApprovals(activities),closed=closedThreadApprovals(snapshot.thread);
      for(const target of targets){
        const key=approvalKey(target),record=this.record(target),request=pending.find(a=>a.requestId===target.requestId&&a.kind==='command');
        const related=activities.filter(a=>a.payload?.requestId===target.requestId);
        const terminal=closed.has(target.requestId)||related.some(a=>a.kind==='approval.resolved'||staleApprovalFailure(a));
        const failure=related.find(a=>a.kind==='provider.approval.respond.failed'&&!staleApprovalFailure(a)&&record.command&&!record.failureIds?.includes(a.id));
        if(terminal||record.resolved){record.resolved=true;delete record.command;delete record.failureIds;delete record.uncertain;this.views.set(key,{status:'resolved',fresh:true});}
        else if(failure){delete record.command;delete record.failureIds;delete record.uncertain;this.views.set(key,{request,status:'error',fresh:true,detail:String(failure.payload?.detail??'T3 could not apply the decision. Try again.')});}
        else this.views.set(key,{request,fresh:true,status:request?(record.command?(record.uncertain&&!this.sends.has(key)?'error':'submitting'):'pending'):'unavailable',...(record.uncertain?{detail:'Connection lost during submission. Retry the saved decision.'}:!request?{detail:'This command approval is unavailable. Check the thread in T3.'}:{})});
      }
      this.persist();
    }catch(error){if(!this.stopped)for(const target of targets){const old=this.view(target);if(old.status!=='resolved')this.views.set(approvalKey(target),{...old,status:'error',fresh:false,detail:error instanceof Error?error.message:'Cannot refresh T3 approvals.'});}}
    finally{await access?.close?.();this.notify();}
  }
  submit(target:ApprovalTarget,decision:ApprovalDecision):Promise<void>{
    const key=approvalKey(target),old=this.sends.get(key);if(old)return old;
    const work=this.send(target,decision);this.sends.set(key,work);
    void work.finally(()=>{if(this.sends.get(key)===work)this.sends.delete(key);}).catch(()=>{});return work;
  }
  private async send(target:ApprovalTarget,decision:ApprovalDecision){
    if(decision!=='accept'&&decision!=='decline')throw Error('Unsupported approval decision.');
    await this.refresh([target]);if(this.stopped)return;
    const view=this.view(target),record=this.record(target);
    if(view.status==='resolved')return;
    if(!view.request||!view.fresh)throw Error(view.detail??'Refresh this approval before responding.');
    if(record.command&&record.command.decision!==decision)throw Error('Retry the saved decision before choosing a different response.');
    if(record.command&&!record.uncertain)return;
    if(!record.command){
      let access:ThreadAccess|undefined;
      try{
        access=await this.access(target.environmentId);
        const snapshot=await access.api(`/api/orchestration/threads/${encodeURIComponent(target.threadId)}`);
        if(snapshot?.thread?.id!==target.threadId||!Array.isArray(snapshot.thread.activities))throw Error('T3 returned an invalid approval snapshot.');
        const activities:InlineActivity[]=snapshot.thread.activities;
        if(this.stopped||record.resolved||closedThreadApprovals(snapshot.thread).has(target.requestId)||!pendingApprovals(activities).some(a=>a.requestId===target.requestId&&a.kind==='command')){await this.refresh([target]);return;}
        record.command={type:'thread.approval.respond',commandId:this.newId(),threadId:target.threadId,requestId:target.requestId,decision,createdAt:this.now()};
        record.uncertain=true;
        // Existing failures must not be mistaken for failures of this new command.
        record.failureIds=activities.filter(a=>a.kind==='provider.approval.respond.failed'&&a.payload?.requestId===target.requestId).map(a=>a.id);
        this.persist();
      }catch(error){delete record.command;delete record.failureIds;delete record.uncertain;throw error;}
      finally{await access?.close?.();}
    }
    if(this.stopped)return;
    this.views.set(approvalKey(target),{request:view.request,status:'submitting'});this.notify();
    let access:ThreadAccess|undefined;
    try{
      access=await this.access(target.environmentId);
      // A refresh may resolve the request while access is being established.
      if(this.stopped||record.resolved||!record.command)return;
      const command=record.command;
      await access.api('/api/orchestration/dispatch',command);
      logEvent('approval.submit.acknowledged',{...target,decision,commandId:command.commandId});
      if(record.command===command&&!record.resolved){delete record.uncertain;this.persist();}
    }
    catch(error){if(record.resolved)return;logFailure('approval.submit.failed',error,{...target,commandId:record.command?.commandId});record.uncertain=true;try{this.persist();}catch{/* Preserve the exact command in memory. */}this.views.set(approvalKey(target),{request:view.request,status:'error',detail:`${error instanceof Error?error.message:'Submission failed.'} Retry the saved decision.`});this.notify();throw error;}
    finally{await access?.close?.();}
    await this.refresh([target]);
  }
}
