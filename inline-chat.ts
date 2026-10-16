import type {DirectInlineUpdate} from './direct-inline-preview';
import {nativeResponses} from './native-response-manager';
import {responseAnchor} from './native-response-projection';
import type {ExplorerResponse} from './explorer-responses';
import type {ResolvedJobOptions} from './job-options';
import {intermediateMode,completionTime,finalAnswerFormat,type IntermediateMode,type FinalAnswerFormat} from './response-presentation';
import {followInlineQuestions,inlineQuestionPhase,questionConversationInputs,type InlineQuestionFollow} from './inline-questions';
import {logEvent,logFailure} from './diagnostics';
import type {App,Editor,MarkdownFileInfo,MarkdownView} from 'obsidian';
import {Notice} from 'obsidian';
import type {Connection,Request} from './bridge';
import {commandId,endpoint,environmentApi,type PairedSession} from './direct';
import {contentHash} from './completion';
import {activeInlineIds,failedInlineIds,applyThreadItem,inlineBindingCheckpoint,restoreInlineBindings,rememberInlineTurns,endInsertionOffset,endMarker,finalizeRegion,hasResponseMarkers,initialRegion,insertionOffset,inlineResponseRange,regionBody,renderInlineTurn,replaceRegion,selectionAnchor,startMarker,turnForMessage,turnPhase,type InitialInlineInput,type InlineThreadState,type InlineTurn,type SelectionAnchor} from './inline-thread';
import {readInlineSnapshot,watchThread,type ThreadAccess,type ThreadStreamItem} from './thread-stream';
import type {ResponseStorageTarget} from './response-model';
import {replaceInlineEditorText} from './inline-editor';
import {pendingQuestions} from './questions';
import {pendingApprovals} from './approvals';
import {observeIncoming,mergeProse,selectionRange,steeringBoundary,validSteeringInput,type InlineSteering,type SteeringInput} from './inline-steering';
import type {InlineMessage,InlineBindingCheckpoint} from './inline-thread';
import {replaceChangedText} from './inline-note-io';
import {interruptStoppedResponse,stopResponseEdit,stoppedResponseBody} from './response-stop';
import type {ResponseStopReceipt} from './response-stop-receipt';

export interface InlineJob {
  id:string;path:string;requestId:string;threadId?:string;turnId?:string;messageId?:string;projectId?:string;connection?:Connection;
  bodyHash:string;phase:'sending'|'running'|'reconnecting'|'complete'|'interrupted'|'error'|'cancelled'|'conflict';createdAt:string;finalized?:boolean;
  hosted?:boolean;localOnly?:boolean;threadEnvironmentId?:string;bindingCheckpoint?:InlineBindingCheckpoint;
  remoteStopPending?:boolean;
  remoteStopOperationId?:string;remoteStopFailures?:number;remoteStopNextAt?:number;stopReceipt?:ResponseStopReceipt;stopRunTerminal?:boolean;
  keepIntermediate?:boolean;intermediateMode?:IntermediateMode;finalAnswerFormat?:FinalAnswerFormat;presentationTurns?:Record<string,InlineTurn>;finishedAt?:string;
  hostTarget?:ResponseStorageTarget;
  initialInput?:InitialInlineInput;
  steering?:InlineSteering[];incoming?:InlineSteering[];prose?:InlineMessage[];turnIds?:string[];questionFollows?:InlineQuestionFollow[];
}
interface EditorSource {editor:Editor;info:MarkdownView|MarkdownFileInfo}
interface Runtime {state:InlineThreadState;sequence:number;monitor?:{stop():void};source?:EditorSource;timer?:ReturnType<typeof setTimeout>;alerted?:string;refreshing?:boolean;completionChecked?:boolean;stopWork?:Promise<void>;stopRetryAt?:number;stopRetryTimer?:ReturnType<typeof setTimeout>}

export class InlineChatManager {
  private jobs:InlineJob[]=[];
  private runtimes=new Map<string,Runtime>();
  private stopped=false;
  constructor(private app:App,private key:string,private sessionFor:(id:string)=>Promise<PairedSession|undefined>,private hosted?:{prepare(job:InlineJob,request:Request):Promise<void>;stop(job:InlineJob):Promise<void|ResponseStopReceipt>;status?(job:Pick<InlineJob,'id'>):ResponseStopReceipt|undefined},private keepIntermediate:()=>boolean|IntermediateMode=()=>false,private answerFormat:()=>FinalAnswerFormat=()=> 'formatted') {
    const saved=this.app.loadLocalStorage(key);
    if(Array.isArray(saved))this.jobs=saved.filter(validJob).filter(job=>!job.hosted||job.localOnly===true||job.phase==='cancelled').map(job=>{
      if(job.hosted&&!job.localOnly)job.remoteStopPending=false;
      // 2.12.6 mistook the client command ID for T3's provider-assigned turn ID.
      if(job.turnId===commandId(job.requestId,'turn'))delete job.turnId;
      job.messageId??=commandId(job.requestId,'message');
      return job;
    });
  }
  resume(){for(const job of this.jobs)if(!job.hosted&&job.threadId&&job.connection&&!job.finalized&&!['conflict','cancelled'].includes(job.phase))this.start(job);this.flushAvailable();}
  dispose(){this.stopped=true;for(const runtime of this.runtimes.values()){runtime.monitor?.stop();if(runtime.timer)clearTimeout(runtime.timer);if(runtime.stopRetryTimer)clearTimeout(runtime.stopRetryTimer);}this.runtimes.clear();}
  activeFor(path:string){this.reconcileHosted();return this.jobs.filter(j=>j.path===path&&!j.finalized&&!j.stopRunTerminal&&!['cancelled','conflict'].includes(j.phase));}
  find(id:string){return this.jobs.find(job=>job.id===id&&!job.finalized);}
  steeringJob(id:string,messageId:string){return this.jobs.find(job=>job.id===id&&job.steering?.some(input=>input.messageId===messageId&&input.confirmed));}
  settlementStatus(id:string):'wait'|'ready'|'discard'{
    const job=this.jobs.find(item=>item.id===id);
    if(!job)return 'wait';
    if(['conflict','interrupted','error','cancelled'].includes(job.phase))return 'discard';
    return job.phase==='complete'&&job.finalized?'ready':'wait';
  }
  private reconcileHosted(){let changed=false;for(const job of this.jobs){
    if(!job.hosted)continue;
    const status=this.hosted?.status?.(job);
    if(status){
      if(status.hostRecorded&&job.remoteStopPending){job.remoteStopPending=false;job.stopReceipt=status;delete job.remoteStopNextAt;changed=true;}
      if(status.runTerminal&&!job.stopRunTerminal){job.stopRunTerminal=true;changed=true;}
      if(status.runTerminal&&job.phase!=='cancelled'&&job.phase!=='conflict'&&job.phase!=='complete'){job.phase='complete';changed=true;}
      if(status.finalSaved&&!job.finalized){job.finalized=true;changed=true;}
    }
    if(job.finalized||job.phase==='cancelled'||job.stopRunTerminal)continue;
    const editor=this.editorFor(job);if(!editor)continue;const region=regionBody(editor.getValue(),job.id);if(!region){job.finalized=true;changed=true;}else if(/^(?:> \[!t3-progress\][+-] )?\*\*[^\n]+ · Error\*\*/m.test(region.body)&&job.phase!=='error'){job.phase='error';changed=true;}else if(/^(?:> \[!t3-progress\][+-] )?\*\*[^\n]+ · (?:Working|Reconnecting)\*\*/m.test(region.body)&&job.phase==='error'){job.phase='running';changed=true;}
  }if(changed)this.persist();}
  follow(job:InlineJob,messageId:string){
    if(job.hosted)throw Error('Hosted responses need their owner to attach the continuation.');
    if(job.messageId===messageId&&job.phase!=='error')return;
    if(job.phase!=='error'||job.finalized)throw Error('This response is no longer waiting for a continuation.');
    job.messageId=messageId;delete job.turnId;job.phase='reconnecting';this.persist();this.start(job);
  }
  steer(job:InlineJob,input:SteeringInput){
    if(!validSteeringInput(input))throw Error('Invalid steering message.');
    const existing=job.steering?.find(item=>item.messageId===input.messageId);
    if(existing){if(existing.text!==input.text||JSON.stringify(existing.selection)!==JSON.stringify(input.selection))throw Error('This steering ID already belongs to another message.');return;}
    if(job.hosted||job.finalized||!job.turnId||!['running','reconnecting'].includes(job.phase))throw Error('Wait for a running response before steering.');
    const editor=this.editorFor(job),region=editor&&regionBody(editor.getValue(),job.id);
    if(!region||contentHash(region.body)!==job.bodyHash)throw Error('The response block changed. Your edits are preserved.');
    job.steering=[...job.steering??[],{...input,before:steeringBoundary(job.prose??this.runtime(job).state.messages.filter(m=>m.role==='assistant'&&m.turnId===job.turnId))}];
    this.persist();
  }
  discardSteering(job:InlineJob,messageId:string){job.steering=job.steering?.filter(input=>input.messageId!==messageId||input.confirmed);this.persist();}
  explorerResponses():ExplorerResponse[]{return this.jobs.filter(job=>!job.hosted||job.phase==='sending'&&!job.finalized).map(job=>{
    const input=!!job.questionFollows?.some(q=>!q.answered&&!q.dismissed);
    return {id:job.id,notePath:job.path,epoch:0,revision:0,active:['sending','running','reconnecting'].includes(job.phase),input,complete:job.phase==='complete'&&!!job.finalized&&!input};
  });}
  observeLocal(update:DirectInlineUpdate){
    if(!update.request.localOnly)return;
    const request=update.request;
    let job=this.jobs.find(item=>item.id===request.id);
    if(!job){job={id:request.id,path:request.notePath,requestId:request.id,bodyHash:request.initialHash,phase:'running',createdAt:request.createdAt,hosted:true,localOnly:true,threadEnvironmentId:request.threadEnvironmentId,hostTarget:request.host};this.jobs.push(job);}
    if(job.phase==='cancelled'||job.finalized)return;
    const before=JSON.stringify([job.threadId,job.projectId,job.messageId,job.turnId,job.phase]);
    job.threadId=request.threadId;job.projectId=request.projectId;job.messageId=update.messageId;job.turnId=update.turnId;job.turnIds=update.turnIds;job.threadEnvironmentId=request.threadEnvironmentId;
    job.phase=update.completionVerified&&(update.phase==='complete'||update.phase==='interrupted')?update.phase:update.phase==='error'?'error':'running';
    if(before!==JSON.stringify([job.threadId,job.projectId,job.messageId,job.turnId,job.phase]))this.persist();
  }
  private persist(){this.app.saveLocalStorage(this.key,this.jobs.map(j=>({...j})));}
  private runtime(job:InlineJob){let runtime=this.runtimes.get(job.id);if(!runtime){runtime={state:restoreInlineBindings({messages:[],activities:[]},job.bindingCheckpoint),sequence:-1};this.runtimes.set(job.id,runtime);}return runtime;}

  reserve(editor:Editor,info:MarkdownView|MarkdownFileInfo,anchor:SelectionAnchor,requestId:string,expectedPath:string,initialInput?:InitialInlineInput,threadTitle?:string,options?:ResolvedJobOptions):InlineJob {
    return this.reserveAt(editor,info,insertionOffset(editor.getValue(),anchor),requestId,expectedPath,initialInput,threadTitle,options);
  }
  reserveAtEnd(editor:Editor,info:MarkdownView|MarkdownFileInfo,requestId:string,expectedPath:string,initialInput?:InitialInlineInput,threadTitle?:string,options?:ResolvedJobOptions):InlineJob {
    return this.reserveAt(editor,info,endInsertionOffset(editor.getValue()),requestId,expectedPath,initialInput,threadTitle,options);
  }
  private reserveAt(editor:Editor,info:MarkdownView|MarkdownFileInfo,offset:number,requestId:string,expectedPath:string,initialInput?:InitialInlineInput,threadTitle?:string,options?:ResolvedJobOptions):InlineJob {
    if(this.stopped)throw Error('The plugin was disabled.');
    const file=info.file;if(!file||file.path!==expectedPath||file.extension.toLowerCase()!=='md')throw Error('The original Markdown note is no longer open. Reopen it and ask T3 again.');
    const id=requestId,createdAt=new Date().toISOString(),mode=options?.inline.intermediateMode??intermediateMode(this.keepIntermediate()),region=initialRegion(id,initialInput,threadTitle,mode,{startedAt:createdAt});
    const job:InlineJob={id,path:file.path,requestId,bodyHash:region.bodyHash,phase:'sending',createdAt,keepIntermediate:mode!=='remove',intermediateMode:mode,finalAnswerFormat:options?.inline.finalAnswerFormat??finalAnswerFormat(this.answerFormat()),...(initialInput?{initialInput}:{})};
    this.jobs.push(job);this.runtime(job).source={editor,info};
    try{this.persist();replaceInlineEditorText(editor,region.text,offset);}
    catch(error){this.jobs=this.jobs.filter(item=>item!==job);this.runtimes.delete(job.id);try{this.persist();}catch{/* Original storage error remains primary. */}throw error;}
    return job;
  }
  async prepare(job:InlineJob,request:Request){
    job.connection=request.connection;job.projectId=request.project.id;job.threadId=request.threadId??commandId(request.id,'thread');job.messageId=commandId(request.id,'message');this.persist();
    if(this.hosted){await this.hosted.prepare(job,request);job.hosted=true;job.localOnly=request.inlineHost?.localOnly;job.threadEnvironmentId=request.inlineHost?.threadEnvironmentId;this.persist();
      const source=this.runtime(job).source,sourceView=source?.info as MarkdownView;
      const view=typeof sourceView?.getViewData==='function'?sourceView:this.app.workspace.getLeavesOfType('markdown').map(leaf=>leaf.view as MarkdownView).find(view=>view.file?.path===job.path&&view.editor===source?.editor);
      if(request.inlineHost?.nativeProjection&&source&&view&&typeof view.getViewData==='function'){
        const document=source.editor.getValue(),region=regionBody(document,job.id);
        if(region){const start=document.indexOf(startMarker(job.id)),end=document.indexOf(endMarker(job.id),region.to)+endMarker(job.id).length;
          const anchor=responseAnchor(job.id,request.inlineHost.responseContainer?undefined:document);
          replaceChangedText(source.editor,document,document.slice(0,start)+anchor+document.slice(end));await view.save();nativeResponses(this.app).preview(view,job.id,region.body);}
      }
    }
  }
  async deliveryFailed(job:InlineJob,_uncertain=false){
    const runtime=this.runtime(job),native=nativeResponses(this.app);
    if(job.hosted&&this.nativeViewFor(job))await native.stop(job.id,job.path,true);
    else {
      const editor=this.editorFor(job),document=editor?.getValue(),found=document&&regionBody(document,job.id);
      if(editor&&document&&found){
        const body=contentHash(found.body)===job.bodyHash?'':stoppedResponseBody(found.body);
        const change=finalizeRegion(document,job.id,contentHash(found.body),body);
        if(change)replaceChangedText(editor,document,document.slice(0,change.from)+change.text+document.slice(change.to));
      }
    }
    runtime.monitor?.stop();if(runtime.timer)clearTimeout(runtime.timer);
    this.jobs=this.jobs.filter(j=>j!==job);this.runtimes.delete(job.id);this.persist();
  }
  start(job:InlineJob){
    if(this.stopped||job.hosted||job.finalized||job.phase==='cancelled'||!job.threadId||!job.connection)return;
    const runtime=this.runtime(job);runtime.monitor?.stop();
    const access=async()=>{
      if(!job.connection!.environmentId&&job.connection!.transport!=='direct'){job.connection!.environmentId=await (await import('./desktop')).desktopEnvironment(job.connection!);this.persist();}
      return this.access(job.connection!);
    };
    runtime.monitor=watchThread(job.threadId,access,{
      item:item=>this.receive(job,item),
      reconnecting:()=>{if(this.stopped||job.finalized||['complete','conflict','cancelled'].includes(job.phase))return;job.phase='reconnecting';this.schedule(job);},
    },undefined,()=>({messageIds:job.messageId?[job.messageId]:[],turnIds:job.turnIds??(job.turnId?[job.turnId]:[])}));
    if(!['reconnecting','complete','interrupted','error'].includes(job.phase))job.phase='running';this.persist();this.schedule(job);
  }
  async access(connection:Connection):Promise<ThreadAccess>{
    if(connection.transport==='direct'){
      const session=await this.sessionFor(connection.connectionId??'');
      const api=await environmentApi(connection,session);
      return {origin:endpoint(connection.url??''),api};
    }
    const desktop=await import('./desktop');return desktop.desktopThreadAccess(connection);
  }
  private receive(job:InlineJob,item:ThreadStreamItem){
    if(this.stopped||job.finalized||job.phase==='cancelled'||!this.jobs.includes(job))return;
    const runtime=this.runtime(job);
    if(item.kind==='snapshot'&&Number.isSafeInteger(item.snapshot?.snapshotSequence)&&item.snapshot.snapshotSequence<runtime.sequence){logEvent('stream.snapshot.stale',{jobId:job.id,sequence:item.snapshot.snapshotSequence,lastSequence:runtime.sequence});return;}
    if(item.kind==='event'&&Number.isSafeInteger(item.event?.sequence)&&item.event.sequence<=runtime.sequence)return;
    const applied=applyThreadItem(runtime.state,item);runtime.state=job.finalAnswerFormat==='raw-markdown'?{...applied.state,turns:{...job.presentationTurns,...applied.state.turns}}:applied.state;
    runtime.completionChecked=item.kind==='snapshot';
    const previousBinding=job.messageId?job.bindingCheckpoint?.bindings?.[job.messageId]:undefined;
    const checkpoint=inlineBindingCheckpoint(runtime.state);
    if(JSON.stringify(checkpoint)!==JSON.stringify(job.bindingCheckpoint)){job.bindingCheckpoint=checkpoint;this.persist();}
    if(job.messageId){
      const turnId=turnForMessage(runtime.state,job.messageId);
      if(turnId&&(!job.turnId||previousBinding?.kind==='steer'&&previousBinding.turnId!==turnId)){job.turnId=turnId;this.persist();}
    }
    if(job.turnId){
      job.turnIds??=[job.turnId];
      if(!job.turnIds.includes(job.turnId))job.turnIds.push(job.turnId);
      for(const input of job.steering??[]){
        if(!runtime.state.messages.some(m=>m.role==='user'&&m.id===input.messageId))continue;
        if(!input.confirmed)logEvent('steering.confirmed',{jobId:job.id,messageId:input.messageId,threadId:job.threadId,turnId:turnForMessage(runtime.state,input.messageId)});
        input.confirmed=true;
        job.messageId=input.messageId;
        const turn=turnForMessage(runtime.state,input.messageId);
        if(turn){job.turnId=turn;if(!job.turnIds.includes(turn))job.turnIds.push(turn);}
      }
      const questions=followInlineQuestions(runtime.state,job.turnIds,job.questionFollows,job.prose);
      job.questionFollows=questions.follows;job.turnIds=questions.turnIds;job.turnId=questions.turnId;
      job.incoming=observeIncoming(runtime.state,job.turnIds,job.incoming,job.steering,[commandId(job.requestId,'message'),job.initialInput?.messageId??'',...Object.values(runtime.state.turns??{}).filter(turn=>job.turnIds!.includes(turn.turnId)).map(turn=>turn.messageId??''),...job.questionFollows.flatMap(follow=>follow.input?[follow.input.messageId]:[])]);
      job.prose=mergeProse(job.prose??[],runtime.state.messages,job.turnIds);
    }
    if(item.kind==='snapshot')runtime.sequence=Number.isSafeInteger(applied.sequence)?applied.sequence!:runtime.sequence;
    else if(applied.sequence!==undefined)runtime.sequence=applied.sequence;
    const activity=job.turnId&&pendingApprovals(runtime.state.activities).filter(a=>a.turnId===job.turnId).at(-1);
    const question=pendingQuestions(runtime.state.activities).find(q=>q.turnId===job.turnId);
    if(question&&question.requestId!==runtime.alerted){runtime.alerted=question.requestId;new Notice('T3 has a question. Use Answer in the note when you are ready.',8000);}
    if(activity&&activity.requestId!==runtime.alerted){runtime.alerted=activity.requestId;new Notice(activity.kind==='command'?'T3 needs command approval. Use Approve or Deny in the note.':`T3 needs your response in thread ${job.threadId}: ${activity.summary.slice(0,140)}`,12000);}
    const phase=job.turnId?inlineQuestionPhase(runtime.state,job.turnId,job.questionFollows):'running';
    if(job.phase==='error'&&phase==='running'&&runtime.state.latestTurn?.turnId!==job.turnId&&runtime.state.session?.activeTurnId!==job.turnId)return;
    if(job.phase==='error'&&phase==='error')return;
    const nextPhase=job.steering?.some(input=>!input.confirmed||!turnForMessage(runtime.state,input.messageId))?'running':phase;
    if(job.phase!==nextPhase)logEvent('response.phase.changed',{jobId:job.id,threadId:job.threadId,turnId:job.turnId,from:job.phase,to:nextPhase});
    job.phase=nextPhase;this.schedule(job);
  }
  private schedule(job:InlineJob){
    const runtime=this.runtime(job);if(runtime.timer)clearTimeout(runtime.timer);
    runtime.timer=setTimeout(()=>{runtime.timer=undefined;this.flush(job);},100);
  }
  flushAvailable(){this.reconcileHosted();for(const job of this.jobs){if(job.phase==='cancelled'){void this.finishStopped(job).catch(error=>logFailure('response.stop.cleanup.failed',error,{jobId:job.id})).finally(()=>this.requestRemoteStop(job));}else if(!job.hosted&&job.threadId&&!job.finalized&&job.phase!=='conflict')this.schedule(job);}}
  renamed(oldPath:string,newPath:string){let changed=false;for(const job of this.jobs)if((job.path===oldPath||job.path.startsWith(oldPath+'/'))){job.path=newPath+job.path.slice(oldPath.length);changed=true;}if(changed){this.persist();this.flushAvailable();}}
  deleted(path:string){let changed=false;for(const job of this.jobs)if((job.path===path||job.path.startsWith(path+'/'))){job.phase='conflict';this.runtimes.get(job.id)?.monitor?.stop();changed=true;}if(changed)this.persist();}
  private nativeViewFor(job:InlineJob){
    const native=nativeResponses(this.app),source=this.runtimes.get(job.id)?.source?.info as MarkdownView;
    return native.view(source)??(this.app.workspace.getLeavesOfType?.('markdown')??[]).map(leaf=>leaf.view as MarkdownView).filter(view=>view.file?.path===job.path).map(view=>native.view(view)).find(Boolean);
  }
  private editorFor(job:InlineJob):Editor|undefined {
    const leaves=this.app.workspace.getLeavesOfType?.('markdown')??[];
    for(const leaf of leaves){const view=leaf.view as MarkdownView;if(view.file?.path===job.path&&view.editor)return view.editor;}
    const source=this.runtimes.get(job.id)?.source;
    return source?.info.file?.path===job.path?source.editor:undefined;
  }
  private flush(job:InlineJob){
    if(job.phase==='cancelled'){void this.finishStopped(job).catch(error=>logFailure('response.stop.cleanup.failed',error,{jobId:job.id}));return;}
    if(this.stopped||job.hosted||!this.jobs.includes(job)||job.finalized||!job.threadId)return;
    const editor=this.editorFor(job);if(!editor)return;
    const runtime=this.runtime(job);
    if(runtime.sequence<0&&['complete','interrupted','error'].includes(job.phase))return;
    if(job.phase==='complete'&&job.connection&&!runtime.completionChecked){
      if(runtime.refreshing)return;
      runtime.refreshing=true;
      void (async()=>{
        let access:ThreadAccess|undefined;
        try{
          access=await this.access(job.connection!);
          const snapshot=await readInlineSnapshot(access,job.threadId!,undefined,{messageIds:job.messageId?[job.messageId]:[],turnIds:job.turnIds??(job.turnId?[job.turnId]:[])});
          this.receive(job,{kind:'snapshot',snapshot});
        }catch(error){logFailure('response.final-snapshot.failed',error,{jobId:job.id,threadId:job.threadId});this.schedule(job);}
        finally{runtime.refreshing=false;await access?.close?.();}
      })();
      return;
    }
    if(job.finalAnswerFormat==='raw-markdown'){
      job.presentationTurns=rememberInlineTurns({...runtime.state,messages:job.prose??runtime.state.messages},job.turnIds??[],job.presentationTurns);
      runtime.state={...runtime.state,turns:{...job.presentationTurns,...runtime.state.turns}};
    }
    const questions=followInlineQuestions(runtime.state,job.turnIds??[],job.questionFollows,job.prose);
    const inputs=questionConversationInputs(runtime.state,job.incoming??[],questions.follows,job.prose??[]);
    const conversation=(job.turnIds?.length??0)>1||inputs.length?{messages:job.prose??[],steering:inputs,preserveHistory:questions.continued}:undefined;
    if(job.phase==='complete'||job.phase==='interrupted')job.finishedAt??=completionTime(runtime.state,job.turnId??'');else delete job.finishedAt;
    const next=renderInlineTurn(runtime.state,job.turnId??'',job.threadId,job.phase==='conflict'?'error':job.phase,intermediateMode(job.intermediateMode,job.keepIntermediate),job.connection?.environmentId,conversation,job.initialInput,undefined,{startedAt:job.createdAt,finishedAt:job.finishedAt},finalAnswerFormat(job.finalAnswerFormat));
    const original=editor.getValue();let document=original;
    const current=regionBody(document,job.id);
    const terminal=job.phase==='complete'&&!questions.waiting||['interrupted','cancelled'].includes(job.phase);
    const outside=current?inlineResponseRange(document,job.id):undefined;
    if(!terminal&&current&&current.body===next&&!job.steering?.some(input=>input.confirmed&&input.selection&&(!input.selectionApplied||selectionRange(document,input.selection,outside))))return;
    const selectionsApplied:InlineSteering[]=[];
    if(current)for(const input of job.steering??[]){
      if(!input.confirmed||!input.selection)continue;
      const region=regionBody(document,job.id)!;
      const range=selectionRange(document,input.selection,inlineResponseRange(document,job.id));
      if(range&&(range.to<=inlineResponseRange(document,job.id)!.from||range.from>=inlineResponseRange(document,job.id)!.to))document=document.slice(0,range.from)+document.slice(range.to);
      selectionsApplied.push(input);
    }
    const expectedHash=current?contentHash(current.body):job.bodyHash;
    const change=terminal?finalizeRegion(document,job.id,expectedHash,next):replaceRegion(document,job.id,expectedHash,next);
    if(!change){logFailure('note.write.conflict',new Error('Response markers were removed or malformed.'),{jobId:job.id,notePath:job.path,expectedHash:job.bodyHash,actualHash:current?contentHash(current.body):undefined});job.phase='conflict';runtime.monitor?.stop();this.persist();new Notice(`T3 stopped writing to ${job.path} because its response markers were removed or malformed. The T3 thread remains available.`,12000);return;}
    logEvent('note.response.write',{jobId:job.id,notePath:job.path,fromHash:contentHash(original),toHash:contentHash(document.slice(0,change.from)+change.text+document.slice(change.to)),terminal});
    replaceChangedText(editor,original,document.slice(0,change.from)+change.text+document.slice(change.to));
    for(const input of selectionsApplied)input.selectionApplied=true;
    if(terminal)job.finalized=true;
    else job.bodyHash=contentHash(next);
    this.persist();
    if(terminal)runtime.monitor?.stop();
  }
  /** Menu cleanup also works for an orphaned block with no runtime or connection. */
  stopAt(id:string,editor:Editor,info:MarkdownView|MarkdownFileInfo,hostTarget?:ResponseStorageTarget){
    const path=info.file?.path;if(!path)return Promise.resolve();
    let job=this.jobs.find(item=>item.id===id);
    if(!job){job={id,path,requestId:id,bodyHash:'',phase:'running',createdAt:new Date().toISOString(),hosted:true,...(hostTarget?{hostTarget}:{})};this.jobs.push(job);}
    if(hostTarget)job.hostTarget=hostTarget;
    this.runtime(job).source={editor,info};
    return this.stop(job);
  }
  /** Palette cleanup needs neither a selection nor a device-local job record. */
  async stopAllAt(editor:Editor,info:MarkdownView|MarkdownFileInfo,hosted:Array<{id:string;hostTarget:ResponseStorageTarget}>=[]){
    const path=info.file?.path;if(!path)return 0;
    const document=editor.getValue(),targets=new Map(hosted.map(job=>[job.id,job.hostTarget]));
    const ids=[...new Set([...this.activeFor(path).map(job=>job.id),...activeInlineIds(document),...failedInlineIds(document),...targets.keys()])].filter(id=>!this.hosted?.status?.({id})?.runTerminal);
    const results=await Promise.allSettled(ids.map(id=>this.stopAt(id,editor,info,targets.get(id))));
    const failures=results.filter((result):result is PromiseRejectedResult=>result.status==='rejected');
    if(failures.length)throw Error(`Could not finish ${failures.length} of ${ids.length} T3 responses: ${failures.map(result=>result.reason instanceof Error?result.reason.message:String(result.reason)).join('; ')}`);
    return ids.length;
  }
  private async finishStopped(job:InlineJob){
    if(this.stopped)return;
    const editor=this.editorFor(job);if(!editor)return;
    const nativeView=job.hosted?this.nativeViewFor(job):undefined;
    if(nativeView){const source=this.runtimes.get(job.id)?.source?.info as MarkdownView|undefined;await nativeResponses(this.app).stop(job.id,job.path,false,source);job.finalized=true;this.persist();return;}
    const document=editor.getValue();
    if(job.finalized&&!hasResponseMarkers(document,job.id))return;
    const change=stopResponseEdit(document,job.id);
    if(!change){
      if(hasResponseMarkers(document,job.id))throw Error('Response boundaries are incomplete. Your text is preserved.');
    }else replaceChangedText(editor,document,document.slice(0,change.from)+change.text+document.slice(change.to));
    job.finalized=true;this.persist();
  }
  private requestRemoteStop(job:InlineJob){
    if(this.stopped||!job.remoteStopPending)return;
    const runtime=this.runtime(job);
    if(runtime.stopWork)return;
    const retryAt=job.remoteStopNextAt??runtime.stopRetryAt??0;
    if(retryAt>Date.now()){
      if(!runtime.stopRetryTimer)runtime.stopRetryTimer=setTimeout(()=>{runtime.stopRetryTimer=undefined;this.requestRemoteStop(job);},Math.min(300_000,retryAt-Date.now()));return;
    }
    job.remoteStopOperationId??=commandId(job.id,'stop');
    const started=Date.now();
    const work=(async()=>{
      try{
        if(job.hosted&&this.hosted){const receipt=await this.hosted.stop(job);if(receipt){job.stopReceipt=receipt;job.stopRunTerminal=receipt.runTerminal;}}
        else if(job.threadId&&job.connection)await interruptStoppedResponse(()=>this.access(job.connection!),job.requestId,job.threadId,job.turnId,10_000,job.messageId,job.projectId,job.createdAt,job.stopRunTerminal);
        job.remoteStopPending=false;job.remoteStopFailures=0;delete job.remoteStopNextAt;this.persist();
      }catch(error){
        if(job.stopReceipt?.hostRecorded){job.remoteStopPending=false;this.persist();return;}
        job.remoteStopFailures=(job.remoteStopFailures??0)+1;job.remoteStopNextAt=Date.now()+Math.min(300_000,30_000*2**Math.min(job.remoteStopFailures-1,4));this.persist();
        logFailure('response.stop.remote.failed',error,{jobId:job.id,operationId:job.remoteStopOperationId,elapsedMs:Math.max(0,Date.now()-started),attempt:job.remoteStopFailures,nextRetryAt:job.remoteStopNextAt});
        if(job.remoteStopFailures===1)new Notice('The response is frozen in this note. Host Stop confirmation is pending; it will retry automatically.',10000);
      }
    })();
    // Keep the original hosted operation single-flight. A UI wait deadline
    // must not detach its mutation and start a second large payload upload.
    runtime.stopWork=work;void work.finally(()=>{runtime.stopWork=undefined;if(!this.stopped&&job.remoteStopPending)this.requestRemoteStop(job);});
  }
  async stop(job:InlineJob){
    if(job.phase!=='cancelled'){
      job.stopRunTerminal=['complete','interrupted'].includes(job.phase);job.remoteStopOperationId??=commandId(job.id,'stop');
      job.phase='cancelled';job.remoteStopPending=Boolean(job.hosted&&this.hosted||job.threadId&&job.connection);this.persist();
    }
    const runtime=this.runtime(job);runtime.monitor?.stop();if(runtime.timer){clearTimeout(runtime.timer);runtime.timer=undefined;}
    try{await this.finishStopped(job);}finally{this.requestRemoteStop(job);}
  }
}
function validJob(value:any):value is InlineJob{return value&&typeof value.id==='string'&&typeof value.path==='string'&&typeof value.requestId==='string'&&typeof value.bodyHash==='string'&&typeof value.phase==='string'&&typeof value.createdAt==='string';}

export function captureEditorSelection(editor:Editor):SelectionAnchor {
  const document=editor.getValue(),from=editor.posToOffset(editor.getCursor('from')),to=editor.posToOffset(editor.getCursor('to'));
  return selectionAnchor(document,editor.getSelection(),from,to);
}
