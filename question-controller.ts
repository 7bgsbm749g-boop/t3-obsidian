import {pendingQuestions,questionAnswers,questionKey,staleQuestionFailure,type PendingQuestion,type QuestionTarget,type QuestionDrafts} from './questions';
import type {InlineActivity} from './inline-thread';
import type {ThreadAccess} from './thread-stream';

export interface QuestionCommand {type:'thread.user-input.respond'|'thread.user-input.dismiss';commandId:string;threadId:string;requestId:string;answers?:Record<string,string|string[]>;createdAt:string}
export interface QuestionRecord {target:QuestionTarget;drafts:QuestionDrafts;command?:QuestionCommand;failureIds?:string[];uncertain?:boolean;resolved?:boolean}
export interface QuestionView {request?:PendingQuestion;status:'loading'|'pending'|'submitting'|'resolved'|'unavailable'|'error';detail?:string;fresh?:boolean}
export interface QuestionStore {load():QuestionRecord[];save(records:QuestionRecord[]):void}

/** Device-local drafts and write-ahead commands; no credentials are synced in notes. */
export class QuestionController {
  private records=new Map<string,QuestionRecord>();
  private views=new Map<string,QuestionView>();
  private listeners=new Set<()=>void>();
  private reads=new Map<string,Promise<void>>();
  private sends=new Map<string,Promise<void>>();
  private stopped=false;
  constructor(private access:(environmentId:string)=>Promise<ThreadAccess>,private store:QuestionStore,private newId:()=>string,private now=()=>new Date().toISOString()){
    for(const record of store.load())if(record?.target&&typeof record.target.environmentId==='string'&&typeof record.target.threadId==='string'&&typeof record.target.requestId==='string'&&record.drafts&&typeof record.drafts==='object')this.records.set(questionKey(record.target),{...record,drafts:Object.assign(Object.create(null),record.drafts)});
  }
  dispose(){this.stopped=true;this.listeners.clear();}
  subscribe(listener:()=>void){this.listeners.add(listener);return ()=>{this.listeners.delete(listener);};}
  private notify(){if(!this.stopped)for(const listener of this.listeners)listener();}
  private persist(){this.store.save([...this.records.values()]);}
  record(target:QuestionTarget){const key=questionKey(target);let record=this.records.get(key);if(!record){record={target,drafts:Object.create(null)};this.records.set(key,record);}return record;}
  view(target:QuestionTarget):QuestionView{return this.views.get(questionKey(target))??(this.records.get(questionKey(target))?.resolved?{status:'resolved'}:{status:'loading'});}
  draft(target:QuestionTarget,questionId:string,value:{selected?:string[];text?:string}){
    const record=this.record(target);if(record.command)throw Error('Retry the saved submission before changing this answer.');
    record.drafts[questionId]=value;this.persist();
  }
  async refresh(targets:QuestionTarget[]){
    const groups=new Map<string,QuestionTarget[]>();
    for(const target of targets){const key=JSON.stringify([target.environmentId,target.threadId]),group=groups.get(key)??[];if(!group.some(t=>t.requestId===target.requestId))group.push(target);groups.set(key,group);}
    await Promise.all([...groups].map(async([key,group])=>{
      // A second caller may add a request while the same thread is refreshing.
      const old=this.reads.get(key);
      const work=(async()=>{await old;if(!this.stopped)await this.read(group);})();this.reads.set(key,work);
      try{await work;}finally{if(this.reads.get(key)===work)this.reads.delete(key);}
    }));
  }
  private async read(targets:QuestionTarget[]){
    let access:ThreadAccess|undefined;
    try{
      const first=targets[0];access=await this.access(first.environmentId);
      const snapshot=await access.api(`/api/orchestration/threads/${encodeURIComponent(first.threadId)}`);
      if(snapshot?.thread?.id!==first.threadId||!Array.isArray(snapshot.thread.activities))throw Error('T3 returned an invalid question snapshot.');
      if(this.stopped)return;
      const activities:InlineActivity[]=snapshot.thread.activities,pending=pendingQuestions(activities);
      for(const target of targets){
        const key=questionKey(target),record=this.record(target),request=pending.find(q=>q.requestId===target.requestId);
        const related=activities.filter(a=>a.payload?.requestId===target.requestId);
        const terminal=related.some(a=>a.kind==='user-input.resolved'||staleQuestionFailure(a));
        const failure=related.find(a=>a.kind==='provider.user-input.respond.failed'&&!staleQuestionFailure(a)&&record.command&&!record.failureIds?.includes(a.id));
        if(terminal||record.resolved){record.resolved=true;delete record.command;delete record.failureIds;delete record.uncertain;record.drafts=Object.create(null);this.views.set(key,{status:'resolved',fresh:true});}
        else if(failure){delete record.command;delete record.failureIds;delete record.uncertain;this.views.set(key,{request,status:'error',fresh:true,detail:String(failure.payload?.detail??'T3 could not submit the answer. Your draft is saved.')});}
        else this.views.set(key,{request,fresh:true,status:request?(record.command?(record.uncertain&&!this.sends.has(key)?'error':'submitting'):'pending'):'unavailable',...(record.uncertain?{detail:'Connection lost during submission. Your answer is saved; retry safely.'}:!request?{detail:'This question is unavailable. Refresh the thread in T3.'}:{})});
      }
      this.persist();
    }catch(error){if(!this.stopped)for(const target of targets){const old=this.view(target);if(old.status==='resolved')continue;this.views.set(questionKey(target),{...old,status:'error',fresh:false,detail:error instanceof Error?error.message:'Cannot refresh T3 questions.'});}}
    finally{await access?.close?.();this.notify();}
  }
  submit(target:QuestionTarget,dismiss=false):Promise<void>{
    const key=questionKey(target),old=this.sends.get(key);if(old)return old;
    const work=this.send(target,dismiss);this.sends.set(key,work);
    void work.finally(()=>{if(this.sends.get(key)===work)this.sends.delete(key);}).catch(()=>{});return work;
  }
  private async send(target:QuestionTarget,dismiss:boolean){
    await this.refresh([target]);if(this.stopped)return;
    const view=this.view(target),record=this.record(target);
    if(view.status==='resolved')return;
    if(!view.request||!view.fresh||view.status==='unavailable')throw Error(view.detail??'Refresh this question before answering.');
    // Transport retries reuse the exact accepted-or-not command, including timestamp.
    if(!record.command){
      if(dismiss&&view.request.responseMode!=='message')throw Error('This blocking question cannot be dismissed.');
      const access=await this.access(target.environmentId);
      try{
        const snapshot=await access.api(`/api/orchestration/threads/${encodeURIComponent(target.threadId)}`);
        const activities:InlineActivity[]=snapshot?.thread?.id===target.threadId&&Array.isArray(snapshot.thread.activities)?snapshot.thread.activities:[];
        if(this.stopped)return;
        const current=pendingQuestions(activities).find(q=>q.requestId===target.requestId);
        if(!current){await this.refresh([target]);return;}
        if(dismiss&&current.responseMode!=='message')throw Error('This blocking question cannot be dismissed.');
        const command:QuestionCommand={type:dismiss?'thread.user-input.dismiss':'thread.user-input.respond',commandId:this.newId(),threadId:target.threadId,requestId:target.requestId,...(!dismiss?{answers:questionAnswers(current,record.drafts)}:{}),createdAt:this.now()};
        record.command=command;record.uncertain=true;record.failureIds=activities.filter(a=>a.kind==='provider.user-input.respond.failed'&&a.payload?.requestId===target.requestId).map(a=>a.id);
        try{this.persist();}catch(error){delete record.command;delete record.failureIds;throw error;}
      }finally{await access.close?.();}
    }
    if(this.stopped)return;
    this.views.set(questionKey(target),{request:view.request,status:'submitting'});this.notify();
    let access:ThreadAccess|undefined;
    try{access=await this.access(target.environmentId);await access.api('/api/orchestration/dispatch',record.command);delete record.uncertain;this.persist();}
    catch(error){record.uncertain=true;try{this.persist();}catch{/* Keep the original write-ahead command. */}this.views.set(questionKey(target),{request:view.request,status:'error',detail:`${error instanceof Error?error.message:'Submission failed.'} Your answer is saved; retry safely.`});this.notify();throw error;}
    finally{await access?.close?.();}
    await this.refresh([target]);
  }
}
