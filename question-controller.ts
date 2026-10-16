import {logEvent,logFailure} from './diagnostics';
import {pendingQuestions,questionAnswers,questionKey,staleQuestionFailure,type PendingQuestion,type QuestionTarget,type QuestionDraft,type QuestionDrafts} from './questions';
import type {InlineActivity} from './inline-thread';
import type {ThreadAccess} from './thread-stream';
import {abortableRead} from './t3-api';

export const QUESTION_READ_TIMEOUT_MS=8000;

export interface QuestionCommand {type:'thread.user-input.respond'|'thread.user-input.dismiss';commandId:string;threadId:string;requestId:string;answers?:Record<string,string|string[]>;createdAt:string}
export interface QuestionAnswerFollow {request:PendingQuestion;command:QuestionCommand;notePath?:string;accepted?:boolean}
export interface QuestionRecord {target:QuestionTarget;drafts:QuestionDrafts;command?:QuestionCommand;failureIds?:string[];uncertain?:boolean;resolved?:boolean;dismissed?:boolean;answerFollow?:QuestionAnswerFollow}
export interface QuestionView {request?:PendingQuestion;status:'loading'|'pending'|'submitting'|'resolved'|'unavailable'|'error';detail?:string;fresh?:boolean;accepted?:boolean}
export interface QuestionStore {load():QuestionRecord[];save(records:QuestionRecord[]):void}

/** Device-local drafts and write-ahead commands; no credentials are synced in notes. */
export class QuestionController {
  private records=new Map<string,QuestionRecord>();
  private views=new Map<string,QuestionView>();
  private listeners=new Set<()=>void>();
  private reads=new Map<string,{targets:Map<string,QuestionTarget>;work:Promise<void>}>();
  private tracked=new Map<string,{target:QuestionTarget;count:number}>();
  private sequences=new Map<string,number>();
  private checkedAt=new Map<string,number>();
  private failures=new Map<string,string[]>();
  private readControllers=new Set<AbortController>();
  private draftTimer?:ReturnType<typeof setTimeout>;
  private saved='';
  private dismissedKeys=new Set<string>();
  dismissalRevision=0;
  private sends=new Map<string,Promise<void>>();
  private dismissalRetries=new Map<string,number>();
  private stopped=false;
  private following=new Map<string,Promise<void>>();
  constructor(private access:(environmentId:string)=>Promise<ThreadAccess>,private store:QuestionStore,private newId:()=>string,private now=()=>new Date().toISOString(),private followAnswer?:(target:QuestionTarget,follow:QuestionAnswerFollow)=>Promise<boolean>){
    for(const record of store.load())if(record?.target&&typeof record.target.environmentId==='string'&&typeof record.target.threadId==='string'&&typeof record.target.requestId==='string'&&record.drafts&&typeof record.drafts==='object')this.records.set(questionKey(record.target),{...record,drafts:Object.assign(Object.create(null),record.drafts)});
    this.saved=JSON.stringify([...this.records.values()]);this.updateDismissals();
  }
  dispose(){this.stopped=true;for(const controller of this.readControllers)controller.abort(Error('Question controls closed.'));try{this.flushDrafts();}catch(error){logFailure('question.draft.flush',error);}finally{this.listeners.clear();this.tracked.clear();}}
  subscribe(listener:()=>void){this.listeners.add(listener);return ()=>{this.listeners.delete(listener);};}
  private updateDismissals(){const keys=new Set([...this.records.values()].filter(record=>this.isDismissed(record.target)).map(record=>questionKey(record.target)));if(keys.size!==this.dismissedKeys.size||[...keys].some(key=>!this.dismissedKeys.has(key))){this.dismissedKeys=keys;this.dismissalRevision++;}}
  private notify(){this.updateDismissals();if(!this.stopped)for(const listener of this.listeners)listener();}
  private persist(){if(this.draftTimer)clearTimeout(this.draftTimer);this.draftTimer=undefined;const records=[...this.records.values()],bytes=JSON.stringify(records);if(bytes===this.saved)return;this.store.save(records);this.saved=bytes;}
  flushDrafts(){this.persist();}
  /** Rendering and open forms retain a target even when disk has only anchors. */
  track(target:QuestionTarget){const key=questionKey(target),entry=this.tracked.get(key)??{target,count:0};entry.count++;this.tracked.set(key,entry);let released=false;return ()=>{if(released)return;released=true;if(--entry.count===0)this.tracked.delete(key);};}
  watchedTargets():QuestionTarget[]{return [...new Map([...this.tracked.values()].map(entry=>[questionKey(entry.target),entry.target] as const).concat([...this.records.values()].filter(record=>record.command&&!record.resolved).map(record=>[questionKey(record.target),record.target] as const))).values()];}
  record(target:QuestionTarget){const key=questionKey(target);let record=this.records.get(key);if(!record){record={target,drafts:Object.create(null)};this.records.set(key,record);}return record;}
  view(target:QuestionTarget):QuestionView{return this.views.get(questionKey(target))??(this.records.get(questionKey(target))?.resolved?{status:'resolved'}:{status:'loading'});}
  isDismissed(target:QuestionTarget){const record=this.records.get(questionKey(target));return !!(record?.dismissed||record?.command?.type==='thread.user-input.dismiss');}
  hasDismissals(){return [...this.records.values()].some(record=>this.isDismissed(record.target));}
  pendingDismissals(){return [...this.records.values()].filter(record=>this.isDismissed(record.target)&&!record.resolved).map(record=>record.target);}
  /** Dismiss is an explicit durable intent, safe to finish without another click. */
  retryDismissals(){for(const target of this.pendingDismissals())if((this.dismissalRetries.get(questionKey(target))??0)<=Date.now())void this.submit(target,true).catch(()=>{});}
  /** Retain accepted answers until their exact stream is attached. Recovery
   * never dispatches an answer again, including after a lost acknowledgement. */
  async recoverAnswerStreams(){
    if(this.stopped||!this.followAnswer)return;
    await Promise.all([...this.records.values()].filter(record=>record.answerFollow?.accepted&&!record.dismissed).map(record=>{
      const key=questionKey(record.target),old=this.following.get(key);if(old)return old;
      const follow=record.answerFollow!;
      const work=Promise.resolve().then(async()=>{
        if(this.stopped)return;
        if(await this.followAnswer!(record.target,follow)&&!this.stopped&&record.answerFollow===follow){delete record.answerFollow;this.persist();}
      }).catch(error=>logFailure('question.answer-stream',error,{...record.target})).finally(()=>{if(this.following.get(key)===work)this.following.delete(key);});
      this.following.set(key,work);return work;
    }));
  }
  draft(target:QuestionTarget,questionId:string,value:QuestionDraft){
    const record=this.record(target);if(record.command)throw Error('Retry the saved submission before changing this answer.');
    record.drafts[questionId]=value;
    if(this.draftTimer)clearTimeout(this.draftTimer);
    if(typeof setTimeout!=='function'){this.persist();return;}
    this.draftTimer=setTimeout(()=>{this.draftTimer=undefined;try{this.persist();}catch(error){this.views.set(questionKey(target),{...this.view(target),status:'error',detail:`${error instanceof Error?error.message:'Cannot save the draft.'} Keep this form open and retry.`});this.notify();}},250);
  }
  async refresh(targets:QuestionTarget[],maxAge=0){
    const groups=new Map<string,QuestionTarget[]>();
    for(const target of targets){const key=JSON.stringify([target.environmentId,target.threadId]),group=groups.get(key)??[];if(!group.some(t=>t.requestId===target.requestId))group.push(target);groups.set(key,group);}
    await Promise.all([...groups].map(async([key,group])=>{
      if(maxAge>0&&Date.now()-(this.checkedAt.get(key)??0)<maxAge&&group.every(target=>this.view(target).fresh))return;
      const old=this.reads.get(key);
      if(old){for(const target of group)old.targets.set(questionKey(target),target);await old.work;return;}
      const batch={targets:new Map(group.map(target=>[questionKey(target),target])),work:Promise.resolve()};
      batch.work=Promise.resolve().then(()=>this.read(batch.targets));this.reads.set(key,batch);
      try{await batch.work;}finally{if(this.reads.get(key)===batch)this.reads.delete(key);}
    }));
  }
  private async read(targetMap:Map<string,QuestionTarget>){
    let access:ThreadAccess|undefined;
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(Error('The question check took too long. Reconnect T3 and retry.')),QUESTION_READ_TIMEOUT_MS);
    this.readControllers.add(controller);
    try{
      if(this.stopped)return;const first=targetMap.values().next().value!;
      const currentAccess=await abortableRead<ThreadAccess>(this.access(first.environmentId).then(async ready=>{if(controller.signal.aborted){try{await ready.close?.('late-access');}catch(error){logFailure('question.read.close',error);}throw controller.signal.reason;}return ready;}),controller.signal);access=currentAccess;
      const snapshot=await abortableRead(currentAccess.api(`/api/orchestration/threads/${encodeURIComponent(first.threadId)}?controlOnly=true`,undefined,{signal:controller.signal}),controller.signal);
      if(snapshot?.thread?.id!==first.threadId||!Array.isArray(snapshot.thread.activities))throw Error('T3 returned an invalid question snapshot.');
      if(this.stopped)return;
      const sequenceKey=JSON.stringify([first.environmentId,first.threadId]);
      if(Number.isSafeInteger(snapshot.snapshotSequence)){
        if(snapshot.snapshotSequence<(this.sequences.get(sequenceKey)??-1))return;
        this.sequences.set(sequenceKey,snapshot.snapshotSequence);
      }
      this.apply([...targetMap.values()],snapshot.thread.activities,snapshot.thread.v2Requests);
      this.checkedAt.set(sequenceKey,Date.now());
    }catch(error){if(!this.stopped)for(const target of targetMap.values()){const old=this.view(target);if(old.status==='resolved')continue;this.views.set(questionKey(target),{...old,status:'error',fresh:false,detail:error instanceof Error?error.message:'Cannot refresh T3 questions.'});}}
    finally{clearTimeout(timer);this.readControllers.delete(controller);try{await access?.close?.();}catch(error){logFailure('question.read.close',error);}this.notify();}
  }
  /** Consume the existing direct response feed; never open a second tool stream. */
  observe(environmentId:string,threadId:string,activities:InlineActivity[],sequence?:number){
    if(this.stopped)return;const key=JSON.stringify([environmentId,threadId]);
    if(Number.isSafeInteger(sequence)){if(sequence!<(this.sequences.get(key)??-1))return;this.sequences.set(key,sequence!);}
    const observed=new Set(activities.map(activity=>activity.payload?.requestId));
    const targets=[...new Map([...this.watchedTargets(),...pendingQuestions(activities).map(request=>({environmentId,threadId,requestId:request.requestId}))].filter(target=>target.environmentId===environmentId&&target.threadId===threadId&&observed.has(target.requestId)).map(target=>[questionKey(target),target])).values()];
    if(!targets.length)return;
    try{this.apply(targets,activities);this.checkedAt.set(key,Date.now());}catch(error){logFailure('question.observe',error);}this.notify();
  }
  private apply(targets:QuestionTarget[],activities:InlineActivity[],requests?:Record<string,any>){
      let changed=false;
      const pending=pendingQuestions(activities);
      for(const target of targets){
        const key=questionKey(target),record=this.record(target),request=pending.find(q=>q.requestId===target.requestId);
        const related=activities.filter(a=>a.payload?.requestId===target.requestId);
        this.failures.set(key,related.filter(a=>a.kind==='provider.user-input.respond.failed').map(a=>a.id));
        const remote=requests?.[target.requestId];
        const terminal=related.some(a=>a.kind==='user-input.resolved'||staleQuestionFailure(a))||remote&&typeof remote.status==='string'&&remote.status!=='pending';
        const failure=related.find(a=>a.kind==='provider.user-input.respond.failed'&&!staleQuestionFailure(a)&&record.command&&!record.failureIds?.includes(a.id));
        if(terminal||record.resolved){if(!record.resolved){changed=true;logEvent('question.resolved',{...target});}if(related.some(a=>a.kind==='user-input.resolved'&&!a.payload?.answers||staleQuestionFailure(a)))record.dismissed=true;if(record.answerFollow){if(record.dismissed)delete record.answerFollow;else record.answerFollow.accepted=true;changed=true;}record.resolved=true;delete record.command;delete record.failureIds;delete record.uncertain;record.drafts=Object.create(null);this.views.set(key,{status:'resolved',fresh:true});}
        else if(failure){changed=true;delete record.command;delete record.answerFollow;delete record.failureIds;delete record.uncertain;this.views.set(key,{request,status:'error',fresh:true,detail:String(failure.payload?.detail??'T3 could not submit the answer. Your draft is saved.')});}
        else {
          const current=request??(remote?.status==='pending'?this.view(target).request:undefined);
          this.views.set(key,{request:current,fresh:true,accepted:!!record.command&&!record.uncertain,status:current?(this.sends.has(key)?'submitting':record.command?(record.uncertain?'error':'submitting'):'pending'):'unavailable',...(record.uncertain?{detail:this.isDismissed(target)?'Dismissal saved; waiting for T3.':'Connection lost during submission. Your answer is saved; retry safely.'}:!current?{detail:'This question is unavailable. Refresh the thread in T3.'}:{})});
        }
      }
      if(changed)this.persist();
  }
  submit(target:QuestionTarget,dismiss=false,notePath?:string):Promise<void>{
    const key=questionKey(target),old=this.sends.get(key);if(old)return old;
    if(dismiss){
      const record=this.record(target),view=this.view(target);
      if(view.status==='resolved')return Promise.resolve();
      if(record.command&&record.command.type!=='thread.user-input.dismiss')return Promise.reject(Error('Retry the saved answer before dismissing this question.'));
      if(!this.isDismissed(target)){
        if(view.request?.responseMode!=='message')return Promise.reject(Error('This blocking question cannot be dismissed.'));
        record.command={type:'thread.user-input.dismiss',commandId:this.newId(),threadId:target.threadId,requestId:target.requestId,createdAt:this.now()};record.dismissed=true;record.uncertain=true;
        try{this.persist();}catch(error){delete record.command;delete record.dismissed;delete record.uncertain;return Promise.reject(error);}
        this.notify();
      }
      this.dismissalRetries.set(key,Date.now()+30_000);
    }
    logEvent('question.submit.requested',{...target,dismiss});
    const view=this.view(target);if(view.status==='resolved')return Promise.resolve();
    const work=Promise.resolve().then(()=>this.send(target,dismiss,notePath));this.sends.set(key,work);
    this.views.set(key,{...view,status:'submitting',detail:undefined});this.notify();
    void work.finally(()=>{if(this.sends.get(key)===work)this.sends.delete(key);}).catch(()=>{});return work;
  }
  private async send(target:QuestionTarget,dismiss:boolean,notePath?:string){
    const key=questionKey(target);
    try{
    await this.refresh([target]);if(this.stopped)return;
    const view=this.view(target),record=this.record(target);
    if(view.status==='resolved')return;
    if(!view.request||!view.fresh||view.status==='unavailable')throw Error(view.detail??'Refresh this question before answering.');
    if(record.command?.type==='thread.user-input.dismiss'&&view.request.responseMode!=='message')throw Error('This blocking question cannot be dismissed.');
    // Transport retries reuse the exact accepted-or-not command, including timestamp.
    if(!record.command){
      if(dismiss&&view.request.responseMode!=='message')throw Error('This blocking question cannot be dismissed.');
        const command:QuestionCommand={type:dismiss?'thread.user-input.dismiss':'thread.user-input.respond',commandId:this.newId(),threadId:target.threadId,requestId:target.requestId,...(!dismiss?{answers:questionAnswers(view.request,record.drafts)}:{}),createdAt:this.now()};
        record.command=command;record.uncertain=true;record.failureIds=this.failures.get(key)??[];
        if(this.followAnswer&&!dismiss&&view.request.responseMode==='message')record.answerFollow={request:view.request,command,notePath};
        try{this.persist();}catch(error){delete record.command;delete record.answerFollow;delete record.failureIds;delete record.uncertain;throw error;}
    }
    if(this.followAnswer&&!record.answerFollow&&record.command?.type==='thread.user-input.respond'&&view.request.responseMode==='message'){
      record.answerFollow={request:view.request,command:record.command,notePath};this.persist();
    }
    if(this.stopped)return;
    this.views.set(questionKey(target),{request:view.request,status:'submitting'});this.notify();
    let access:ThreadAccess|undefined;
    const command=record.command;
    try{
      access=await this.access(target.environmentId);
      if(this.stopped||record.resolved||record.command!==command)return;
      await access.api('/api/orchestration/dispatch',command);logEvent('question.submit.acknowledged',{...target,commandId:command?.commandId});
    }
    catch(error){
      if(record.resolved)return;
      logFailure('question.submit.failed',error,{...target,commandId:command?.commandId});record.uncertain=true;try{this.persist();}catch{/* Keep the original write-ahead command. */}this.views.set(questionKey(target),{request:view.request,status:'error',detail:`${error instanceof Error?error.message:'Submission failed.'} Your answer is saved; retry safely.`});this.notify();throw error;
    }
    finally{try{await access?.close?.();}catch(error){logFailure('question.send.close',error);}}
    if(this.stopped)return;
    if(record.answerFollow)record.answerFollow.accepted=true;
    delete record.uncertain;
    try{this.persist();}catch(error){logFailure('question.accepted.save',error,{...target});}
    if(record.command)this.views.set(key,{...this.view(target),accepted:true});this.notify();
    await this.refresh([target]);
    await this.recoverAnswerStreams();
    }catch(error){if(!this.stopped&&this.view(target).status!=='resolved'){this.views.set(key,{...this.view(target),status:'error',detail:error instanceof Error?error.message:'Cannot submit the answer.'});this.notify();}throw error;}
  }
}
