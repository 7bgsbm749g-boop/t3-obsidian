import type {LeaseRecord} from './inline-lease';
import type {HostedInlineRequest} from './hosted-inline';
import {applyThreadItem,restoreInlineBindings,turnForMessage,renderInlineTurn,rememberInlineTurns,type InlineThreadState,type InlineStartRequest} from './inline-thread';
import {followInlineQuestions,inlineQuestionPhase,questionConversationInputs} from './inline-questions';
import {mergeProse,observeIncoming} from './inline-steering';
import {completionTime,finalAnswerFormat,intermediateMode} from './response-presentation';
import {watchThread,type ThreadAccess,type ThreadStreamItem} from './thread-stream';
import {logFailure} from './diagnostics';

export interface DirectInlineUpdate {request:HostedInlineRequest;messageId:string;sequence:number;body:string}
type Watch=typeof watchThread;
export interface PreviewClock {now():number;later(callback:()=>void,ms:number):unknown;cancel(handle:unknown):void}
const displayClock:PreviewClock={now:()=>performance.now(),later:(callback,ms)=>setTimeout(callback,ms),cancel:handle=>clearTimeout(handle as ReturnType<typeof setTimeout>)};
export const DIRECT_DISPLAY_INTERVAL_MS=80;

/** A device consumes T3 events only for its native display. It never acquires
 * a writer lease, imports attachments, or saves generated Markdown. The host
 * remains responsible for durable generation and checked final commits. */
export class DirectInlinePreview {
  private state:InlineThreadState={messages:[],activities:[]};
  private record:LeaseRecord;
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
  constructor(record:LeaseRecord,private access:()=>Promise<ThreadAccess>,private receive:(update:DirectInlineUpdate)=>void,private watch:Watch=watchThread,private clock:PreviewClock=displayClock){this.record=record;this.minimumSequence=record.state?.bindingCheckpoint?.sequence??0;this.update(record);}
  update(record:LeaseRecord){
    this.record=record;
    // A durable host cursor must not skip lifecycle events the device has not
    // read, or discard newer local prose while importing binding evidence.
    const checkpoint=record.state?.bindingCheckpoint;
    if(checkpoint)this.state=restoreInlineBindings(this.state,{...checkpoint,sequence:undefined});
    this.prose=mergeProse(record.state?.prose??[],this.prose,[...new Set([...record.state?.turnIds??[],...this.turnIds])]);
    this.turnIds=[...new Set([...this.turnIds,...record.state?.turnIds??[]])];
    this.follows??=record.state?.questionFollows;
    this.incoming??=record.state?.incoming;
  }
  delivery(delivery:InlineStartRequest){
    if(this.stopped)return;
    this.state=restoreInlineBindings(this.state,{starts:{[delivery.messageId]:delivery}});
    this.schedule(true);
  }
  tick(open:boolean){
    if(this.stopped)return;
    const record=this.record;
    if(!open||record.stopRequestedAt||record.state?.userStopped||record.state?.cleanupComplete||record.state?.locationConflict){this.suspend();return;}
    if(this.monitor)return;
    const generation=++this.generation;
    this.monitor=this.watch(record.request.threadId,this.access,{
      item:item=>{if(!this.stopped&&this.generation===generation)this.item(item);},
      reconnecting:error=>{if(!this.stopped&&this.generation===generation)logFailure('stream.direct.reconnecting',error,{bindingId:record.request.id});},
    },undefined,()=>({messageIds:[this.messageId(),...this.record.state?.steering?.map(input=>input.messageId)??[]],turnIds:this.turnIds}),{afterSequence:()=>this.state.sequence??0});
  }
  private messageId(){return this.record.state?.pendingMessageId??this.record.state?.messageId??this.record.request.messageId;}
  private item(item:ThreadStreamItem){
    const request=this.record.request;
    if(item.kind==='synchronized')return;
    const sequence=item.kind==='snapshot'?item.snapshot?.snapshotSequence:item.event?.sequence;
    if(!Number.isSafeInteger(sequence)||sequence<0)return;
    if(item.kind==='snapshot'&&(item.snapshot?.thread?.id!==request.threadId||item.snapshot?.thread?.projectId!==request.projectId))return;
    if(item.kind==='event'&&item.event?.aggregateId!==undefined&&item.event.aggregateId!==request.threadId)return;
    const next=applyThreadItem(this.state,item).state;if(next===this.state)return;this.state=next;
    this.schedule(item.kind==='event'&&((item.event?.type==='thread.session-set'&&item.event.payload?.session?.status!=='running')||(item.event?.type==='thread.message-sent'&&item.event.payload?.streaming===false)));
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
    if(steering.some(input=>!input.confirmed||!turnForMessage(this.state,input.messageId)))phase='running';
    const current={...this.state,messages:mergeProse(this.prose,this.state.messages,this.turnIds),turns:{...this.record.state?.presentationTurns,...this.state.turns}};
    if(request.finalAnswerFormat==='raw-markdown')current.turns=rememberInlineTurns(current,this.turnIds,current.turns);
    const body=renderInlineTurn(current,turnId,request.threadId,phase,intermediateMode(request.intermediateMode,request.keepIntermediate),request.threadEnvironmentId,conversation,request.initialInput,this.state.title??request.threadTitle,{startedAt:request.createdAt,finishedAt:phase==='complete'||phase==='interrupted'?completionTime(this.state,turnId):undefined},finalAnswerFormat(request.finalAnswerFormat));
    this.receive({request:{...request,notePath:this.record.state?.notePath??request.notePath},messageId,sequence:this.state.sequence??0,body});
    return true;
  }
  suspend(){this.generation++;this.monitor?.stop();this.monitor=undefined;if(this.pending!==undefined)this.clock.cancel(this.pending);this.pending=undefined;this.lastRender=-Infinity;}
  dispose(){this.stopped=true;this.suspend();}
}
