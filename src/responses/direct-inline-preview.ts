import {scheduleTimeout as setTimeout,cancelTimeout as clearTimeout} from '../shared/clock';
import type {ResponseRecord} from './response-record';
import type {ResponseRequest} from './response-model';
import {applyThreadItem,inlineBindingCheckpoint,inlineTurnMessages,restoreInlineBindings,turnForMessage,renderInlineTurn,rememberInlineTurns,type InlineThreadState,type InlineStartRequest,type InlineActivity} from '../conversations/inline-thread';
import {followInlineQuestions,inlineQuestionPhase,questionConversationInputs} from '../interaction/inline-questions';
import {mergeProse,observeIncoming,steeringBoundary} from '../conversations/inline-steering';
import {completionTime,finalAnswerFormat,intermediateMode} from './response-presentation';
import {watchThread,readInlineSnapshot,type ThreadAccess,type ThreadStreamItem} from '../conversations/thread-stream';
import {logEvent,logFailure,diagnosticEnabled} from '../app/diagnostics';
import {streamMemory} from '../app/stream-memory-diagnostics';
import {checkFinalResponse,finalResponseKey} from './final-response';
import {responseTooLarge,type StreamReadFailure} from '../connection/t3-response-limits';
import {signInRequired,type ResponseConnectionIssue} from '../connection/sign-in-state';
import {delegatedWork} from '../conversations/inline-delegation';
import {failedContinuations} from './failed-continuation';
import {readImportRun} from '../conversations/import-source';
import type {ThreadSnapshot} from '../connection/wire-types';

export interface DirectInlineUpdate {request:ResponseRequest;messageId:string;sequence:number;body:string;displayedInputIds?:string[];turnId?:string;turnIds?:string[];phase?:'running'|'complete'|'interrupted'|'error';completionVerified?:boolean;questionsPending?:boolean;resume?:NonNullable<ResponseRequest['localResume']>&{prose:InlineThreadState['messages']};failure?:StreamReadFailure;checkpoint?:ReturnType<typeof inlineBindingCheckpoint>;questionActivities?:InlineActivity[]}
type Watch=typeof watchThread;
export interface PreviewClock {now():number;later(callback:()=>void,ms:number):unknown;cancel(handle:unknown):void}
const displayClock:PreviewClock={now:()=>performance.now(),later:(callback,ms)=>setTimeout(callback,ms),cancel:handle=>clearTimeout(handle as ReturnType<typeof setTimeout>)};
export const DIRECT_DISPLAY_INTERVAL_MS=80;

/** Read-only T3 rendering and exact canonical completion evidence. The caller
 * can request a durable final-write grant for a negotiated device completion;
 * this preview itself never mutates the note or grants write authority. */
export class DirectInlinePreview {
  private state:InlineThreadState={messages:[],activities:[]};
  private record:ResponseRecord;
  private monitor?:{stop():void};
  private generation=0;
  private prose:InlineThreadState['messages']=[];
  private turnIds:string[]=[];
  private follows:Parameters<typeof followInlineQuestions>[2];
  private incoming:Parameters<typeof observeIncoming>[2];
  private stopped=false;
  private minimumSequence:number;
  private pending?:unknown;
  private lastRender=-Infinity;
  private lastRenderDiagnostic=-Infinity;
  private receivedAt=0;
  private verifiedSequence=-1;
  private verifiedKey?:string;
  private completionTurnId?:string;
  private completionOptions(){return {historicalImport:this.record.request.importTurn?.state==='completed'};}
  private failure?:StreamReadFailure;
  private verification?:Promise<void>;
  private closeVerification?:()=>void;
  private nextVerification=0;
  private terminal=false;
  private questionsPending=false;
  private interruptedTurnId?:string;
  private verifiedInterruptions=new Set<string>();
  private interruptionVerification?:Promise<void>;
  private nextInterruptionVerification=0;
  private connectionIssue?:ResponseConnectionIssue;
  private importedRead=false;
  private nextImportedRead=0;
  private importedSnapshot?:ThreadSnapshot;
  constructor(record:ResponseRecord,private access:()=>Promise<ThreadAccess>,private receive:(update:DirectInlineUpdate)=>void,private watch:Watch=watchThread,private clock:PreviewClock=displayClock,private connectionChanged?:(issue?:ResponseConnectionIssue)=>void,private readImported=readImportRun){this.record=record;this.minimumSequence=record.state?.bindingCheckpoint?.sequence??0;this.update(record);}
  private diagnosticContext(){const request=this.record.request;return {role:'response' as const,bindingId:request.id,threadId:request.threadId,environmentId:request.threadEnvironmentId,projectId:request.projectId,messageId:this.messageId(),turnId:turnForMessage(this.state,this.messageId()),afterSequence:this.state.sequence,generation:this.generation};}
  private connectionFailed(error:unknown,cause:string){
    const issue:ResponseConnectionIssue={kind:signInRequired(error)?'sign-in-required':'reconnecting'};
    if(this.connectionIssue?.kind!==issue.kind){logEvent('stream.direct.reconnecting',{...this.diagnosticContext(),cause,issue:issue.kind,error},'warning');this.connectionIssue=issue;this.connectionChanged?.(issue);}
    if(issue.kind==='sign-in-required')this.suspend();
  }
  update(record:ResponseRecord){
    if(record.epoch<this.record.epoch||record.epoch===this.record.epoch&&record.revision<this.record.revision)return;
    this.record=record;
    this.failure??=record.state?.streamFailure;
    if(record.responseRemovedAt!==undefined){this.dispose();return;}
    if(record.state?.status==='conflict')this.suspend();
    // A durable host cursor must not skip lifecycle events the device has not
    // read, or discard newer local prose while importing binding evidence.
    const imported=record.request.importTurn;
    if(imported)this.state=restoreInlineBindings(this.state,{bindings:{[imported.messageId!]:{turnId:imported.turnId,kind:'explicit'}},turns:{[imported.turnId]:imported}});
    const checkpoint=record.state?.bindingCheckpoint;
    if(checkpoint)this.state=restoreInlineBindings(this.state,{...checkpoint,sequence:undefined});
    this.prose=mergeProse(record.state?.prose??[],this.prose,[...new Set([...record.state?.turnIds??[],...this.turnIds])]);
    this.turnIds=[...new Set([...this.turnIds,...record.state?.turnIds??[],...(imported?[imported.turnId]:[])])];
    if(record.state?.questionFollows)this.follows=[...new Map([...record.state.questionFollows,...this.follows??[]].map(item=>[item.requestId,item])).values()];
    if(record.state?.incoming)this.incoming=[...new Map([...record.state.incoming,...this.incoming??[]].map(item=>[item.messageId,item])).values()];
  }
  restore(resume:DirectInlineUpdate['resume']){if(this.stopped||!resume)return;this.update({...this.record,state:{...this.record.state!,...resume}});if(this.state.messages.length)this.schedule(true);}
  get notePath(){return this.record.state?.notePath??this.record.request.notePath;}
  steeringProse(){return steeringBoundary(this.prose);}
  delivery(delivery:InlineStartRequest){
    if(this.stopped)return;
    this.state=restoreInlineBindings(this.state,{starts:{[delivery.messageId]:delivery}});
    this.schedule(true);
  }
  seedImport(snapshot:ThreadSnapshot){
    const request=this.record.request,turn=request.importTurn;
    if(!this.stopped&&turn?.state==='completed'&&snapshot.thread.id===request.threadId&&snapshot.thread.projectId===request.projectId&&snapshot.thread.turns?.[turn.turnId]?.messageId===request.messageId&&snapshot.thread.turns[turn.turnId]?.state==='completed'&&(snapshot.snapshotSequence??-1)>=this.minimumSequence)this.importedSnapshot=snapshot;
  }
  tick(open:boolean){
    if(this.stopped||this.connectionIssue?.kind==='sign-in-required')return;
    const record=this.record;
    if(!open||record.responseRemovedAt!==undefined||record.stopRequestedAt||record.state?.userStopped||record.state?.cleanupComplete||record.state?.locationConflict||record.state?.status==='conflict'){this.suspend();return;}
    if(this.monitor){if(this.interruptedTurnId)this.verifyInterruption();if(this.terminal&&(record.request.deviceCompletion||record.request.localOnly))this.verifyCompletion();return;}
    if(record.request.importTurn?.state==='completed'&&!this.importedRead){
      if(this.failure?.operation==='snapshot'||this.clock.now()<this.nextImportedRead)return;
      const generation=++this.generation,abort=new AbortController(),request=record.request;
      this.monitor={stop:()=>abort.abort()};
      void this.access().then(async access=>{
        try{
          const seeded=this.importedSnapshot;this.importedSnapshot=undefined;
          let result=seeded?{snapshot:seeded,state:applyThreadItem({messages:[],activities:[]},{kind:'snapshot',snapshot:seeded}).state}:await this.readImported(access,request.threadId,request.projectId,request.importTurn!.turnId,{signal:abort.signal,firstPageOnly:true});
          if(this.stopped||generation!==this.generation)return;
          this.importedRead=true;
          if(result.state.turns?.[request.importTurn!.turnId]?.state!=='completed'){this.monitor=undefined;this.tick(open);return;}
          // The selected canonical run owns this import. A general thread
          // snapshot can omit it and replace it with a later continuation.
          this.item({kind:'snapshot',snapshot:result.snapshot},true);
          if(result.state.historyComplete===false){
            result=await this.readImported(access,request.threadId,request.projectId,request.importTurn!.turnId,{signal:abort.signal});
            if(this.stopped||generation!==this.generation)return;
            this.item({kind:'snapshot',snapshot:result.snapshot},true);
          }
        }finally{await access.close?.();}
      }).then(()=>{
        // The import reader is a one-shot placeholder, not a live monitor.
        // Pending questions need the shared stream to observe their resolution.
        if(!this.stopped&&generation===this.generation&&this.questionsPending){this.monitor=undefined;this.watchLive(generation);}
      }).catch(error=>{
        if(this.stopped||generation!==this.generation)return;
        logFailure('stream.direct.import-read',error,{bindingId:request.id});
        this.monitor=undefined;this.importedRead=false;this.nextImportedRead=this.clock.now()+1000;
        if(responseTooLarge(error)){this.failure={kind:'response-too-large',operation:'snapshot'};this.receive({request,messageId:this.messageId(),sequence:this.state.sequence??0,body:this.record.state?.body??'> **T3 · Working**',failure:this.failure,completionVerified:false});}
        else this.connectionFailed(error,'import-read');
      });
      return;
    }
    this.watchLive();
  }
  private watchLive(generation=++this.generation){
    const record=this.record;
    this.monitor=this.watch(record.request.threadId,this.access,{
      item:item=>{if(!this.stopped&&this.generation===generation)this.item(item);},
      reconnecting:error=>{if(!this.stopped&&this.generation===generation)this.connectionFailed(error,'stream-or-snapshot');},
      failure:error=>{if(!this.stopped&&this.generation===generation&&responseTooLarge(error)){this.failure??={kind:'response-too-large',operation:'snapshot'};if(!this.render())this.receive({request:this.record.request,messageId:this.messageId(),sequence:this.state.sequence??0,body:this.record.state?.body??'> **T3 · Working**',failure:this.failure,completionVerified:false});}},
    },undefined,()=>({messageIds:[this.messageId(),...this.record.state?.steering?.map(input=>input.messageId)??[],...this.follows?.filter(item=>!item.dismissed).map(item=>`async-answer:${item.requestId}`)??[]],turnIds:this.turnIds}),{afterSequence:()=>this.state.sequence??0,pollImmediately:true,pollSnapshots:()=>this.state.protocolVersion!==2&&this.failure?.operation!=='snapshot',diagnostics:()=>this.diagnosticContext()});
  }
  private messageId(){return this.record.state?.pendingMessageId??this.record.state?.messageId??this.record.request.messageId;}
  private item(item:ThreadStreamItem,urgent=false){
    const request=this.record.request;
    if(item.kind==='synchronized')return;
    const sequence=item.kind==='snapshot'?item.snapshot?.snapshotSequence:item.event?.sequence;
    if(item.kind!=='event'||item.event?.type!=='thread.worktree-setup')if(typeof sequence!=='number'||!Number.isSafeInteger(sequence)||sequence<0)return;
    if(item.kind==='snapshot'&&(item.snapshot?.thread?.id!==request.threadId||item.snapshot?.thread?.projectId!==request.projectId))return;
    if(item.kind==='event'&&item.event?.aggregateId!==undefined&&item.event.aggregateId!==request.threadId)return;
    if(this.connectionIssue){logEvent('stream.direct.recovered',{...this.diagnosticContext(),source:item.kind,receivedSequence:sequence});this.connectionIssue=undefined;this.connectionChanged?.();}
    this.receivedAt=this.clock.now();
    const next=applyThreadItem(this.state,item).state;if(next===this.state)return;this.state=next;
    this.schedule(urgent||item.kind==='event'&&((item.event?.type==='thread.run-updated'&&['completed','interrupted'].includes(item.event.payload?.status))||(item.event?.type==='thread.session-set'&&item.event.payload?.session?.status!=='running')||(item.event?.type==='thread.message-sent'&&item.event.payload?.streaming===false)));
  }
  private schedule(urgent=false){
    const elapsed=this.clock.now()-this.lastRender;
    if(urgent||elapsed>=DIRECT_DISPLAY_INTERVAL_MS){if(this.pending!==undefined)this.clock.cancel(this.pending);this.pending=undefined;if(this.render())this.lastRender=this.clock.now();return;}
    if(this.pending!==undefined)return;
    this.pending=this.clock.later(()=>{this.pending=undefined;if(this.stopped)return;if(this.render())this.lastRender=this.clock.now();},DIRECT_DISPLAY_INTERVAL_MS-elapsed);
  }
  private render(){
    const renderStarted=this.clock.now();
    if((this.state.sequence??-1)<this.minimumSequence)return false;
    const request=this.record.request,messageId=this.messageId();
    let turnId=turnForMessage(this.state,messageId);
    // A bare user message or the thread's latest turn is not evidence that
    // this response owns that output. Retain Working until the exact binding.
    if(!turnId)return false;
    this.turnIds=[...new Set([...this.turnIds,turnId])];
    const steering=(this.record.state?.steering??[]).map(input=>({...input}));
    for(const input of steering){const turn=turnForMessage(this.state,input.messageId);if(!turn)continue;input.confirmed=true;turnId=turn;if(!this.turnIds.includes(turn))this.turnIds.push(turn);}
    const recovery=failedContinuations(this.state,this.turnIds,this.prose);this.state=recovery.state;this.turnIds=recovery.turnIds;
    const questions=followInlineQuestions(this.state,this.turnIds,this.follows,this.prose);
    this.questionsPending=questions.waiting;
    this.follows=questions.follows;this.turnIds=questions.turnIds;turnId=questions.turnId??turnId;
    this.incoming=observeIncoming(this.state,this.turnIds,this.incoming,steering,[request.messageId,request.initialInput?.messageId??'',...Object.values(this.state.turns??{}).filter(turn=>this.turnIds.includes(turn.turnId)&&!recovery.messageIds.has(turn.messageId??'')).map(turn=>turn.messageId??''),...this.follows.flatMap(follow=>follow.input?[follow.input.messageId]:[])]);
    this.prose=mergeProse(this.prose,this.state.messages,this.turnIds);
    const inputs=questionConversationInputs(this.state,this.incoming??[],this.follows,this.prose);
    const conversation=this.turnIds.length>1||inputs.length?{messages:this.prose,steering:inputs,preserveHistory:questions.continued||recovery.continued}:undefined;
    let phase=inlineQuestionPhase(this.state,turnId,this.follows);
    const work=delegatedWork(this.state,this.turnIds);
    const interrupted=this.state.protocolVersion===2&&phase==='interrupted';
    this.interruptedTurnId=interrupted?turnId:work.moving?Object.values(this.state.worktreeHandoffs??{}).find(handoff=>this.turnIds.includes(handoff.sourceTurnId)&&this.state.turns?.[handoff.sourceTurnId]?.state==='interrupted')?.sourceTurnId:undefined;
    // An interrupt can arrive ahead of the tool result and continuation
    // message. A canonical read must settle that gap before a final save.
    if(interrupted&&!this.verifiedInterruptions.has(turnId))phase='running';
    if(steering.some(input=>!input.confirmed||!turnForMessage(this.state,input.messageId)))phase='running';
    // Session-ready can precede the final assistant message. Display can
    // update immediately, but completion requires non-streaming final prose.
    if(phase==='complete'&&(!inlineTurnMessages(this.state,turnId).length||inlineTurnMessages(this.state,turnId).at(-1)!.streaming))phase='running';
    // Prose retention is assistant-only. Keep public thought items and input
    // boundaries in the display state as well, without treating them as prose.
    const restoredQuestions=this.follows.filter(item=>!item.answered&&!item.dismissed&&item.questions?.length&&!this.state.activities.some(activity=>activity.payload?.requestId===item.requestId&&activity.kind==='user-input.requested')).map(item=>({id:`restored-question:${item.requestId}`,kind:'user-input.requested',summary:'Question',turnId:item.turnId,createdAt:item.createdAt,payload:{requestId:item.requestId,questions:item.questions,responseMode:item.responseMode}}));
    const resolvedQuestions=this.follows.flatMap(item=>{const remote=this.state.v2Requests?.[item.requestId];return remote&&typeof remote.status==='string'&&(remote.status!=='pending'||remote.responseCapability?.type==='not_resumable')&&!this.state.activities.some(activity=>activity.kind==='user-input.resolved'&&activity.payload?.requestId===item.requestId)?[{id:`resolved-question:${item.requestId}`,kind:'user-input.resolved',summary:'Question resolved',turnId:item.turnId,createdAt:remote.resolvedAt,payload:{requestId:item.requestId,answers:remote.answers}}]:[];});
    const current={...this.state,activities:[...this.state.activities,...restoredQuestions,...resolvedQuestions],messages:[...this.prose,...this.state.messages.filter(message=>message.role!=='assistant'&&this.turnIds.includes(message.turnId??''))],turns:{...this.record.state?.presentationTurns,...this.state.turns}};
    if(request.finalAnswerFormat==='raw-markdown')current.turns=rememberInlineTurns(current,this.turnIds,current.turns);
    const title=this.state.title??request.threadTitle;
    const body=renderInlineTurn(current,turnId,request.threadId,phase,intermediateMode(request.intermediateMode,request.keepIntermediate),request.threadEnvironmentId,conversation,request.initialInput,title,{startedAt:request.createdAt,finishedAt:phase==='complete'||phase==='interrupted'?completionTime(this.state,turnId):undefined},finalAnswerFormat(request.finalAnswerFormat));
    this.completionTurnId=turnId;
    const key=finalResponseKey(this.state,turnId,this.completionOptions());
    const exactStopped=this.state.protocolVersion===2&&phase==='interrupted'&&this.state.turns?.[turnId]?.state==='interrupted';
    const terminal=phase==='complete'||phase==='interrupted',historyPending=request.importTurn?.state==='completed'&&this.state.historyComplete===false,completionVerified=terminal&&!historyPending&&(exactStopped||(this.state.protocolVersion===2?!!key&&key===this.verifiedKey:this.verifiedSequence>=(this.state.sequence??0)));
    this.terminal=terminal;
    const questionActivities=current.activities.filter(activity=>activity.kind.startsWith('user-input.')||activity.kind==='provider.user-input.respond.failed');
    const checkpoint=inlineBindingCheckpoint(this.state);
    this.receive({request:{...request,notePath:this.record.state?.notePath??request.notePath},messageId,sequence:this.state.sequence??0,body,displayedInputIds:inputs.map(input=>input.messageId),turnId,turnIds:this.turnIds.slice(),phase:this.failure&&!completionVerified?'error':phase,completionVerified,questionsPending:questions.waiting,resume:{bindingCheckpoint:checkpoint,turnIds:this.turnIds.slice(),questionFollows:this.follows,prose:this.prose,incoming:this.incoming,presentationTurns:current.turns},failure:completionVerified?undefined:this.failure,checkpoint,...(questionActivities.length?{questionActivities}:{})});
    if((request.deviceCompletion||request.localOnly)&&terminal&&!completionVerified)this.verifyCompletion();
    if(this.interruptedTurnId)this.verifyInterruption();
    if(diagnosticEnabled('response.render.batch')&&this.clock.now()-this.lastRenderDiagnostic>=1000){this.lastRenderDiagnostic=this.clock.now();logEvent('response.render.batch',{bindingId:request.id,threadId:request.threadId,turnId,sequence:this.state.sequence,phase,bodyLength:body.length,messageCount:this.state.messages.length,activityCount:this.state.activities.length,receivedToRenderMs:this.lastRenderDiagnostic-this.receivedAt,renderMs:this.lastRenderDiagnostic-renderStarted});}
    streamMemory.sample('sample',()=>({bindingId:request.id,threadId:request.threadId,turnId,bodyLength:body.length,messageCount:this.state.messages.length,activityCount:this.state.activities.length,proseCount:this.prose.length,turnCount:this.turnIds.length,pendingRenderCount:this.pending===undefined?0:1,verificationCount:Number(!!this.verification)+Number(!!this.interruptionVerification),renderMs:this.clock.now()-renderStarted}));
    return true;
  }
  private verifyInterruption(){
    if(this.interruptionVerification||this.clock.now()<this.nextInterruptionVerification||this.stopped||this.failure?.operation==='snapshot')return;
    const turnId=this.interruptedTurnId;if(!turnId)return;
    if(this.verifiedInterruptions.has(turnId)&&!delegatedWork(this.state,this.turnIds).moving)return;
    const generation=this.generation,request=this.record.request;
    const work=this.access().then(async access=>{try{return await readInlineSnapshot(access,request.threadId,request.projectId,{messageIds:[this.messageId()],turnIds:this.turnIds});}finally{await access.close?.();}}).then(snapshot=>{
      if(this.stopped||generation!==this.generation)return;
      const checked=applyThreadItem({messages:[],activities:[]},{kind:'snapshot',snapshot}).state;
      if(checked.turns?.[turnId]?.state!=='interrupted')return;
      this.verifiedInterruptions.add(turnId);
      // Preserve live prose/cursors when the canonical read raced newer
      // events, while retaining its exact durable continuation identities.
      this.state=restoreInlineBindings(this.state,inlineBindingCheckpoint(checked));
      const next=applyThreadItem(this.state,{kind:'snapshot',snapshot}).state;this.state=next;
      this.nextInterruptionVerification=this.clock.now()+1200;
      this.schedule(true);
    }).catch(error=>{if(!this.stopped&&generation===this.generation){if(!this.connectionIssue)logFailure('stream.direct.interruption-verification',error,this.diagnosticContext());if(responseTooLarge(error)){this.failure={kind:'response-too-large',operation:'snapshot'};this.schedule(true);}else this.connectionFailed(error,'interruption-verification');}})
      .finally(()=>{if(this.interruptionVerification===work){this.interruptionVerification=undefined;this.nextInterruptionVerification=this.clock.now()+1200;}});
    this.interruptionVerification=work;
  }
  private verifyCompletion(){
    if(this.verification||this.clock.now()<this.nextVerification||this.stopped)return;
    if(this.record.request.importTurn?.state==='completed'&&this.state.historyComplete===false)return;
    const generation=this.generation,request=this.record.request,sequence=this.state.sequence??0;
    const turnId=this.completionTurnId!,key=finalResponseKey(this.state,turnId,this.completionOptions()),state=this.state;
    if(state.protocolVersion===2&&(!key||key===this.verifiedKey||this.failure?.operation==='final-reply'&&this.failure.key===key))return;
    if(state.protocolVersion!==2&&this.failure)return;
    let access:ThreadAccess|undefined,closed=false,expired=false;
    const close=()=>{
      if(!access||closed)return;closed=true;
      try{void Promise.resolve(access.close?.(expired?'late-access':'caller-closed')).catch(error=>logFailure('stream.direct.verification-close',error,{bindingId:request.id}));}catch(error){logFailure('stream.direct.verification-close',error,{bindingId:request.id});}
    };
    const cancel=()=>{expired=true;close();};this.closeVerification=cancel;
    const work=this.access().then(async ready=>{
        access=ready;
        try{
          if(expired||this.stopped||generation!==this.generation)throw Error('T3 completion verification cancelled.');
          return await (state.protocolVersion===2?checkFinalResponse(ready,request.threadId,state,turnId,this.completionOptions()):readInlineSnapshot(ready,request.threadId,request.projectId,{messageIds:[this.messageId()],turnIds:this.turnIds}));
        }finally{close();}
      }).then(result=>{
      if(this.stopped||generation!==this.generation)return;
      if(state.protocolVersion===2){
        if(finalResponseKey(this.state,turnId,this.completionOptions())!==key)return;
        const checked=result as Awaited<ReturnType<typeof checkFinalResponse>>;
        const final=inlineTurnMessages(checked.state,turnId).at(-1)!;
        this.state={...this.state,messages:this.state.messages.map(m=>m.id===final.id?final:m)};
        this.verifiedKey=checked.verified?finalResponseKey(this.state,turnId,this.completionOptions()):undefined;
        if(checked.verified)this.failure=undefined;
      }else{
        if(!('thread' in result)||typeof result.snapshotSequence!=='number'||result.snapshotSequence<sequence)return;
        this.state=applyThreadItem(this.state,{kind:'snapshot',snapshot:result}).state;
        this.verifiedSequence=result.snapshotSequence;
      }
      this.schedule(true);
    }).catch(error=>{if(!this.stopped&&generation===this.generation){if(!this.connectionIssue)logFailure('stream.direct.completion-verification',error,this.diagnosticContext());if(responseTooLarge(error)){this.failure={kind:'response-too-large',operation:state.protocolVersion===2?'final-reply':'snapshot',key};this.schedule(true);}else this.connectionFailed(error,'completion-verification');}}).finally(()=>{cancel();if(this.closeVerification===cancel)this.closeVerification=undefined;if(this.verification===work){this.verification=undefined;this.nextVerification=this.clock.now()+1000;}});
    this.verification=work;
  }
  reconnect(open:boolean){if(this.stopped)return;logEvent('stream.direct.reset',{...this.diagnosticContext(),cause:'requested-reconnect',open});this.suspend();this.connectionIssue=undefined;this.connectionChanged?.();this.tick(open);}
  suspend(){this.generation++;this.monitor?.stop();this.monitor=undefined;this.importedRead=false;this.importedSnapshot=undefined;this.nextImportedRead=0;this.closeVerification?.();this.closeVerification=undefined;this.verification=undefined;this.interruptionVerification=undefined;this.nextInterruptionVerification=0;this.nextVerification=0;if(this.pending!==undefined)this.clock.cancel(this.pending);this.pending=undefined;this.lastRender=-Infinity;}
  dispose(){streamMemory.sample('end',()=>({bindingId:this.record.request.id,threadId:this.record.request.threadId,messageCount:this.state.messages.length,activityCount:this.state.activities.length}));this.stopped=true;this.suspend();this.state={messages:[],activities:[]};this.prose=[];this.turnIds=[];this.follows=[];this.incoming=[];this.verifiedInterruptions.clear();this.record={...this.record,request:{...this.record.request,localResume:undefined},state:undefined};streamMemory.sample('dispose',()=>({bindingId:this.record.request.id,messageCount:0,activityCount:0}));}
}
