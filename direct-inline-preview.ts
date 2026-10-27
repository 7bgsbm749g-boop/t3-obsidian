import type {ResponseRecord} from './response-record';
import type {ResponseRequest} from './response-model';
import {applyThreadItem,inlineBindingCheckpoint,inlineTurnMessages,restoreInlineBindings,turnForMessage,renderInlineTurn,rememberInlineTurns,type InlineThreadState,type InlineStartRequest,type InlineActivity} from './inline-thread';
import {followInlineQuestions,inlineQuestionPhase,questionConversationInputs} from './inline-questions';
import {mergeProse,observeIncoming,steeringBoundary} from './inline-steering';
import {completionTime,finalAnswerFormat,intermediateMode} from './response-presentation';
import {watchThread,readInlineSnapshot,type ThreadAccess,type ThreadStreamItem} from './thread-stream';
import {logFailure} from './diagnostics';
import {checkFinalResponse,finalResponseKey} from './final-response';
import {responseTooLarge,type StreamReadFailure} from './t3-response-limits';
import {signInRequired,type ResponseConnectionIssue} from './sign-in-state';
import {delegatedWork} from './inline-delegation';

export interface DirectInlineUpdate {request:ResponseRequest;messageId:string;sequence:number;body:string;turnId?:string;turnIds?:string[];phase?:'running'|'complete'|'interrupted'|'error';completionVerified?:boolean;questionsPending?:boolean;resume?:NonNullable<ResponseRequest['localResume']>&{prose:InlineThreadState['messages']};failure?:StreamReadFailure;checkpoint?:ReturnType<typeof inlineBindingCheckpoint>;questionActivities?:InlineActivity[]}
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
  private verifiedSequence=-1;
  private verifiedKey?:string;
  private completionTurnId?:string;
  private failure?:StreamReadFailure;
  private verification?:Promise<void>;
  private nextVerification=0;
  private terminal=false;
  private interruptedTurnId?:string;
  private verifiedInterruptions=new Set<string>();
  private interruptionVerification?:Promise<void>;
  private nextInterruptionVerification=0;
  private connectionIssue?:ResponseConnectionIssue;
  constructor(record:ResponseRecord,private access:()=>Promise<ThreadAccess>,private receive:(update:DirectInlineUpdate)=>void,private watch:Watch=watchThread,private clock:PreviewClock=displayClock,private connectionChanged?:(issue?:ResponseConnectionIssue)=>void){this.record=record;this.minimumSequence=record.state?.bindingCheckpoint?.sequence??0;this.update(record);}
  private connectionFailed(error:unknown){
    const issue:ResponseConnectionIssue={kind:signInRequired(error)?'sign-in-required':'reconnecting'};
    if(this.connectionIssue?.kind!==issue.kind){this.connectionIssue=issue;this.connectionChanged?.(issue);}
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
  tick(open:boolean){
    if(this.stopped||this.connectionIssue?.kind==='sign-in-required')return;
    const record=this.record;
    if(!open||record.responseRemovedAt!==undefined||record.stopRequestedAt||record.state?.userStopped||record.state?.cleanupComplete||record.state?.locationConflict||record.state?.status==='conflict'){this.suspend();return;}
    if(this.monitor){if(this.interruptedTurnId)this.verifyInterruption();if(this.terminal&&(record.request.deviceCompletion||record.request.localOnly))this.verifyCompletion();return;}
    const generation=++this.generation;
    this.monitor=this.watch(record.request.threadId,this.access,{
      item:item=>{if(!this.stopped&&this.generation===generation)this.item(item);},
      reconnecting:error=>{if(!this.stopped&&this.generation===generation){logFailure('stream.direct.reconnecting',error,{bindingId:record.request.id});this.connectionFailed(error);}},
      failure:error=>{if(!this.stopped&&this.generation===generation&&responseTooLarge(error)){this.failure??={kind:'response-too-large',operation:'snapshot'};if(!this.render())this.receive({request:this.record.request,messageId:this.messageId(),sequence:this.state.sequence??0,body:this.record.state?.body??'> **T3 · Working**',failure:this.failure,completionVerified:false});}},
    },undefined,()=>({messageIds:[this.messageId(),...this.record.state?.steering?.map(input=>input.messageId)??[],...this.follows?.filter(item=>!item.dismissed).map(item=>`async-answer:${item.requestId}`)??[]],turnIds:this.turnIds}),{afterSequence:()=>this.state.sequence??0,pollImmediately:true,pollSnapshots:()=>this.state.protocolVersion!==2&&this.failure?.operation!=='snapshot'});
  }
  private messageId(){return this.record.state?.pendingMessageId??this.record.state?.messageId??this.record.request.messageId;}
  private item(item:ThreadStreamItem){
    const request=this.record.request;
    if(item.kind==='synchronized')return;
    const sequence=item.kind==='snapshot'?item.snapshot?.snapshotSequence:item.event?.sequence;
    if(!Number.isSafeInteger(sequence)||sequence<0)return;
    if(item.kind==='snapshot'&&(item.snapshot?.thread?.id!==request.threadId||item.snapshot?.thread?.projectId!==request.projectId))return;
    if(item.kind==='event'&&item.event?.aggregateId!==undefined&&item.event.aggregateId!==request.threadId)return;
    if(this.connectionIssue){this.connectionIssue=undefined;this.connectionChanged?.();}
    const next=applyThreadItem(this.state,item).state;if(next===this.state)return;this.state=next;
    this.schedule(item.kind==='event'&&((item.event?.type==='thread.run-updated'&&['completed','interrupted'].includes(item.event.payload?.status))||(item.event?.type==='thread.session-set'&&item.event.payload?.session?.status!=='running')||(item.event?.type==='thread.message-sent'&&item.event.payload?.streaming===false)));
  }
  private schedule(urgent=false){
    const elapsed=this.clock.now()-this.lastRender;
    if(urgent||elapsed>=DIRECT_DISPLAY_INTERVAL_MS){if(this.pending!==undefined)this.clock.cancel(this.pending);this.pending=undefined;if(this.render())this.lastRender=this.clock.now();return;}
    if(this.pending!==undefined)return;
    this.pending=this.clock.later(()=>{this.pending=undefined;if(this.stopped)return;if(this.render())this.lastRender=this.clock.now();},DIRECT_DISPLAY_INTERVAL_MS-elapsed);
  }
  private render(){
    if((this.state.sequence??-1)<this.minimumSequence)return false;
    const request=this.record.request,messageId=this.messageId();
    let turnId=turnForMessage(this.state,messageId);
    // A bare user message or the thread's latest turn is not evidence that
    // this response owns that output. Retain Working until the exact binding.
    if(!turnId)return false;
    this.turnIds=[...new Set([...this.turnIds,turnId])];
    const steering=(this.record.state?.steering??[]).map(input=>({...input}));
    for(const input of steering){const turn=turnForMessage(this.state,input.messageId);if(!turn)continue;input.confirmed=true;turnId=turn;if(!this.turnIds.includes(turn))this.turnIds.push(turn);}
    const questions=followInlineQuestions(this.state,this.turnIds,this.follows,this.prose);
    this.follows=questions.follows;this.turnIds=questions.turnIds;turnId=questions.turnId??turnId;
    this.incoming=observeIncoming(this.state,this.turnIds,this.incoming,steering,[request.messageId,request.initialInput?.messageId??'',...Object.values(this.state.turns??{}).filter(turn=>this.turnIds.includes(turn.turnId)).map(turn=>turn.messageId??''),...this.follows.flatMap(follow=>follow.input?[follow.input.messageId]:[])]);
    this.prose=mergeProse(this.prose,this.state.messages,this.turnIds);
    const inputs=questionConversationInputs(this.state,this.incoming??[],this.follows,this.prose);
    const conversation=this.turnIds.length>1||inputs.length?{messages:this.prose,steering:inputs,preserveHistory:questions.continued}:undefined;
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
    const title=request.localOnly&&(phase==='complete'||phase==='interrupted')?request.threadTitle:this.state.title??request.threadTitle;
    const body=renderInlineTurn(current,turnId,request.threadId,phase,intermediateMode(request.intermediateMode,request.keepIntermediate),request.threadEnvironmentId,conversation,request.initialInput,title,{startedAt:request.createdAt,finishedAt:phase==='complete'||phase==='interrupted'?completionTime(this.state,turnId):undefined},finalAnswerFormat(request.finalAnswerFormat));
    this.completionTurnId=turnId;
    const key=finalResponseKey(this.state,turnId);
    const exactStopped=this.state.protocolVersion===2&&phase==='interrupted'&&this.state.turns?.[turnId]?.state==='interrupted';
    const terminal=phase==='complete'||phase==='interrupted',completionVerified=terminal&&(exactStopped||(this.state.protocolVersion===2?!!key&&key===this.verifiedKey:this.verifiedSequence>=(this.state.sequence??0)));
    this.terminal=terminal;
    const questionActivities=current.activities.filter(activity=>activity.kind.startsWith('user-input.')||activity.kind==='provider.user-input.respond.failed');
    const checkpoint=inlineBindingCheckpoint(this.state);
    this.receive({request:{...request,notePath:this.record.state?.notePath??request.notePath},messageId,sequence:this.state.sequence??0,body,turnId,turnIds:this.turnIds.slice(),phase:this.failure&&!completionVerified?'error':phase,completionVerified,questionsPending:questions.waiting,resume:{bindingCheckpoint:checkpoint,turnIds:this.turnIds.slice(),questionFollows:this.follows,prose:this.prose,incoming:this.incoming,presentationTurns:current.turns},failure:completionVerified?undefined:this.failure,checkpoint,...(questionActivities.length?{questionActivities}:{})});
    if((request.deviceCompletion||request.localOnly)&&terminal&&!completionVerified)this.verifyCompletion();
    if(this.interruptedTurnId)this.verifyInterruption();
    return true;
  }
  private verifyInterruption(){
    if(this.interruptionVerification||this.clock.now()<this.nextInterruptionVerification||this.stopped||this.failure?.operation==='snapshot')return;
    const turnId=this.interruptedTurnId;if(!turnId)return;
    if(this.verifiedInterruptions.has(turnId)&&!delegatedWork(this.state,this.turnIds).moving)return;
    const generation=this.generation,request=this.record.request;
    let timeout:unknown;
    const work=Promise.race([
      this.access().then(async access=>{try{return await readInlineSnapshot(access,request.threadId,request.projectId,{messageIds:[this.messageId()],turnIds:this.turnIds});}finally{await access.close?.();}}),
      new Promise<never>((_resolve,reject)=>{timeout=this.clock.later(()=>reject(Error('T3 interruption verification timed out.')),10_000);}),
    ]).then(snapshot=>{
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
    }).catch(error=>{if(!this.stopped&&generation===this.generation){logFailure('stream.direct.interruption-verification',error,{bindingId:request.id});if(responseTooLarge(error)){this.failure={kind:'response-too-large',operation:'snapshot'};this.schedule(true);}else this.connectionFailed(error);}})
      .finally(()=>{this.clock.cancel(timeout);if(this.interruptionVerification===work){this.interruptionVerification=undefined;this.nextInterruptionVerification=this.clock.now()+1200;}});
    this.interruptionVerification=work;
  }
  private verifyCompletion(){
    if(this.verification||this.clock.now()<this.nextVerification||this.stopped)return;
    const generation=this.generation,request=this.record.request,sequence=this.state.sequence??0;
    const turnId=this.completionTurnId!,key=finalResponseKey(this.state,turnId),state=this.state;
    if(state.protocolVersion===2&&(!key||key===this.verifiedKey||this.failure?.operation==='final-reply'&&this.failure.key===key))return;
    if(state.protocolVersion!==2&&this.failure)return;
    let timeout:unknown;
    const work=Promise.race([
      this.access().then(async access=>state.protocolVersion===2?checkFinalResponse(access,request.threadId,state,turnId):readInlineSnapshot(access,request.threadId,request.projectId,{messageIds:[this.messageId()],turnIds:this.turnIds})),
      new Promise<never>((_resolve,reject)=>{timeout=this.clock.later(()=>reject(Error('T3 completion verification timed out.')),10_000);}),
    ]).then(result=>{
      if(this.stopped||generation!==this.generation)return;
      if(state.protocolVersion===2){
        if(finalResponseKey(this.state,turnId)!==key)return;
        const checked=result as Awaited<ReturnType<typeof checkFinalResponse>>;
        const final=inlineTurnMessages(checked.state,turnId).at(-1)!;
        this.state={...this.state,messages:this.state.messages.map(m=>m.id===final.id?final:m)};
        this.verifiedKey=checked.verified?finalResponseKey(this.state,turnId):undefined;
        if(checked.verified)this.failure=undefined;
      }else{
        if(result.snapshotSequence<sequence)return;
        this.state=applyThreadItem(this.state,{kind:'snapshot',snapshot:result}).state;
        this.verifiedSequence=result.snapshotSequence;
      }
      this.schedule(true);
    }).catch(error=>{if(!this.stopped&&generation===this.generation){logFailure('stream.direct.completion-verification',error,{bindingId:request.id});if(responseTooLarge(error)){this.failure={kind:'response-too-large',operation:state.protocolVersion===2?'final-reply':'snapshot',key};this.schedule(true);}else this.connectionFailed(error);}}).finally(()=>{this.clock.cancel(timeout);if(this.verification===work){this.verification=undefined;this.nextVerification=this.clock.now()+1000;}});
    this.verification=work;
  }
  reconnect(open:boolean){if(this.stopped)return;this.suspend();this.connectionIssue=undefined;this.connectionChanged?.();this.tick(open);}
  suspend(){this.generation++;this.monitor?.stop();this.monitor=undefined;this.verification=undefined;this.interruptionVerification=undefined;this.nextInterruptionVerification=0;this.nextVerification=0;if(this.pending!==undefined)this.clock.cancel(this.pending);this.pending=undefined;this.lastRender=-Infinity;}
  dispose(){this.stopped=true;this.suspend();}
}
