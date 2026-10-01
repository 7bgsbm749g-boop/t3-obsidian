import {logEvent,logFailure,settleWatch} from './diagnostics';
import type {App,Editor,MarkdownFileInfo,MarkdownView} from 'obsidian';
import {Notice} from 'obsidian';
import type {Connection,Request} from './bridge';
import {commandId,endpoint,environmentApi,type PairedSession} from './direct';
import {contentHash} from './completion';
import {activeInlineIds,applyThreadItem,endInsertionOffset,endMarker,finalizeRegion,initialRegion,insertionOffset,regionBody,renderInlineTurn,replaceRegion,selectionAnchor,startMarker,turnForMessage,turnPhase,type InitialInlineInput,type InlineThreadState,type SelectionAnchor} from './inline-thread';
import {readInlineSnapshot,watchThread,type ThreadAccess,type ThreadStreamItem} from './thread-stream';
import type {InlineHostTarget} from './hosted-inline';
import {replaceInlineEditorText} from './inline-editor';
import {pendingQuestions} from './questions';
import {mergeProse,selectionRange,steeringBoundary,validSteeringInput,type InlineSteering,type SteeringInput} from './inline-steering';
import type {InlineMessage} from './inline-thread';
import {replaceChangedText} from './inline-note-io';

export interface InlineJob {
  id:string;path:string;requestId:string;threadId?:string;turnId?:string;messageId?:string;projectId?:string;connection?:Connection;
  bodyHash:string;phase:'sending'|'running'|'reconnecting'|'complete'|'interrupted'|'error'|'cancelled'|'conflict';createdAt:string;finalized?:boolean;
  hosted?:boolean;
  keepIntermediate?:boolean;
  hostTarget?:InlineHostTarget;
  initialInput?:InitialInlineInput;
  steering?:InlineSteering[];prose?:InlineMessage[];turnIds?:string[];
}
interface EditorSource {editor:Editor;info:MarkdownView|MarkdownFileInfo}
interface Runtime {state:InlineThreadState;sequence:number;monitor?:{stop():void};source?:EditorSource;timer?:ReturnType<typeof setTimeout>;alerted?:string;refreshing?:boolean;completionChecked?:boolean}

export class InlineChatManager {
  private jobs:InlineJob[]=[];
  private runtimes=new Map<string,Runtime>();
  private stopped=false;
  constructor(private app:App,private key:string,private sessionFor:(id:string)=>Promise<PairedSession|undefined>,private hosted?:{prepare(job:InlineJob,request:Request):Promise<void>;stop(job:InlineJob):Promise<void>},private keepIntermediate:()=>boolean=()=>false) {
    const saved=this.app.loadLocalStorage(key);
    if(Array.isArray(saved))this.jobs=saved.filter(validJob).map(job=>{
      // 2.12.6 mistook the client command ID for T3's provider-assigned turn ID.
      if(job.turnId===commandId(job.requestId,'turn'))delete job.turnId;
      job.messageId??=commandId(job.requestId,'message');
      return job;
    });
  }
  resume(){for(const job of this.jobs)if(!job.hosted&&job.threadId&&job.connection&&!job.finalized&&!['conflict','cancelled'].includes(job.phase))this.start(job);this.flushAvailable();}
  dispose(){this.stopped=true;for(const runtime of this.runtimes.values()){runtime.monitor?.stop();if(runtime.timer)clearTimeout(runtime.timer);}this.runtimes.clear();}
  activeFor(path:string){this.reconcileHosted();return this.jobs.filter(j=>j.path===path&&!j.finalized&&!['cancelled','conflict'].includes(j.phase));}
  find(id:string){return this.jobs.find(job=>job.id===id&&!job.finalized);}
  steeringJob(id:string,messageId:string){return this.jobs.find(job=>job.id===id&&job.steering?.some(input=>input.messageId===messageId&&input.confirmed));}
  settlementStatus(id:string):'wait'|'ready'|'discard'{
    const job=this.jobs.find(item=>item.id===id);
    if(!job)return 'wait';
    if(['conflict','interrupted','error','cancelled'].includes(job.phase))return 'discard';
    return job.phase==='complete'&&job.finalized?'ready':'wait';
  }
  private reconcileHosted(){let changed=false;for(const job of this.jobs){if(!job.hosted||job.finalized)continue;const editor=this.editorFor(job);if(!editor)continue;const region=regionBody(editor.getValue(),job.id);if(!region){job.finalized=true;changed=true;}else if(/^\*\*T3 · Error\*\*/m.test(region.body)&&job.phase!=='error'){job.phase='error';changed=true;}else if(/^\*\*T3 · (?:Working|Reconnecting)\*\*/m.test(region.body)&&job.phase==='error'){job.phase='running';changed=true;}}if(changed)this.persist();}
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
  private persist(){this.app.saveLocalStorage(this.key,this.jobs.map(j=>({...j})));}
  private runtime(job:InlineJob){let runtime=this.runtimes.get(job.id);if(!runtime){runtime={state:{messages:[],activities:[]},sequence:-1};this.runtimes.set(job.id,runtime);}return runtime;}

  reserve(editor:Editor,info:MarkdownView|MarkdownFileInfo,anchor:SelectionAnchor,requestId:string,expectedPath:string,initialInput?:InitialInlineInput):InlineJob {
    return this.reserveAt(editor,info,insertionOffset(editor.getValue(),anchor),requestId,expectedPath,initialInput);
  }
  reserveAtEnd(editor:Editor,info:MarkdownView|MarkdownFileInfo,requestId:string,expectedPath:string,initialInput?:InitialInlineInput):InlineJob {
    return this.reserveAt(editor,info,endInsertionOffset(editor.getValue()),requestId,expectedPath,initialInput);
  }
  private reserveAt(editor:Editor,info:MarkdownView|MarkdownFileInfo,offset:number,requestId:string,expectedPath:string,initialInput?:InitialInlineInput):InlineJob {
    if(this.stopped)throw Error('The plugin was disabled.');
    const file=info.file;if(!file||file.path!==expectedPath||file.extension.toLowerCase()!=='md')throw Error('The original Markdown note is no longer open. Reopen it and ask T3 again.');
    if(this.activeFor(file.path).length||activeInlineIds(editor.getValue()).length)throw Error('This note already has an active T3 response. Wait for it or stop it first.');
    const id=requestId,region=initialRegion(id,initialInput);
    const job:InlineJob={id,path:file.path,requestId,bodyHash:region.bodyHash,phase:'sending',createdAt:new Date().toISOString(),keepIntermediate:this.keepIntermediate()===true,...(initialInput?{initialInput}:{})};
    this.jobs.push(job);this.runtime(job).source={editor,info};
    try{this.persist();replaceInlineEditorText(editor,region.text,offset);}
    catch(error){this.jobs=this.jobs.filter(item=>item!==job);this.runtimes.delete(job.id);try{this.persist();}catch{/* Original storage error remains primary. */}throw error;}
    return job;
  }
  async prepare(job:InlineJob,request:Request){
    job.connection=request.connection;job.projectId=request.project.id;job.threadId=request.threadId??commandId(request.id,'thread');job.messageId=commandId(request.id,'message');this.persist();
    if(this.hosted){await this.hosted.prepare(job,request);job.hosted=true;this.persist();}
  }
  deliveryFailed(job:InlineJob,uncertain:boolean){
    if(!uncertain){
      const editor=this.editorFor(job),found=editor&&regionBody(editor.getValue(),job.id);
      if(editor&&found&&contentHash(found.body)===job.bodyHash){
        const start=editor.getValue().indexOf(`<!-- t3-inline:start:${job.id} -->`);
        const end=editor.getValue().indexOf(`<!-- t3-inline:end:${job.id} -->`,found.to);
        if(start>=0&&end>=0)replaceInlineEditorText(editor,'',start-1,end+`<!-- t3-inline:end:${job.id} -->`.length+1);
      }
      this.jobs=this.jobs.filter(j=>j!==job);this.runtimes.delete(job.id);this.persist();return;
    }
    job.phase='reconnecting';this.persist();
    if(job.threadId&&job.connection)this.start(job);
  }
  start(job:InlineJob){
    if(this.stopped||job.hosted||!job.threadId||!job.connection)return;
    const runtime=this.runtime(job);runtime.monitor?.stop();
    const access=async()=>{
      if(!job.connection!.environmentId&&job.connection!.transport!=='direct'){job.connection!.environmentId=await (await import('./desktop')).desktopEnvironment(job.connection!);this.persist();}
      return this.access(job.connection!);
    };
    runtime.monitor=watchThread(job.threadId,access,{
      item:item=>this.receive(job,item),
      reconnecting:()=>{if(this.stopped||job.phase==='complete'||job.phase==='conflict')return;job.phase='reconnecting';this.schedule(job);},
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
    if(this.stopped||!this.jobs.includes(job))return;
    const runtime=this.runtime(job);
    if(item.kind==='snapshot'&&Number.isSafeInteger(item.snapshot?.snapshotSequence)&&item.snapshot.snapshotSequence<runtime.sequence){logEvent('stream.snapshot.stale',{jobId:job.id,sequence:item.snapshot.snapshotSequence,lastSequence:runtime.sequence});return;}
    if(item.kind==='event'&&Number.isSafeInteger(item.event?.sequence)&&item.event.sequence<=runtime.sequence)return;
    const applied=applyThreadItem(runtime.state,item);runtime.state=applied.state;
    runtime.completionChecked=item.kind==='snapshot';
    if(!job.turnId&&job.messageId){
      const turnId=turnForMessage(runtime.state,job.messageId);
      if(turnId){job.turnId=turnId;this.persist();}
    }
    if(job.turnId){
      job.turnIds??=[job.turnId];
      if(!job.turnIds.includes(job.turnId))job.turnIds.push(job.turnId);
      for(const input of job.steering??[]){
        if(!runtime.state.messages.some(m=>m.role==='user'&&m.id===input.messageId))continue;
        if(!input.confirmed)logEvent('steering.confirmed',{jobId:job.id,messageId:input.messageId,threadId:job.threadId,turnId:turnForMessage(runtime.state,input.messageId)});
        settleWatch(`steering:${input.messageId}`);input.confirmed=true;
        job.messageId=input.messageId;
        const turn=turnForMessage(runtime.state,input.messageId);
        if(turn){job.turnId=turn;if(!job.turnIds.includes(turn))job.turnIds.push(turn);}
      }
      job.prose=mergeProse(job.prose??[],runtime.state.messages,job.turnIds);
    }
    if(item.kind==='snapshot')runtime.sequence=Number.isSafeInteger(applied.sequence)?applied.sequence!:runtime.sequence;
    else if(applied.sequence!==undefined)runtime.sequence=applied.sequence;
    const activity=job.turnId&&runtime.state.activities.filter(a=>a.turnId===job.turnId&&a.kind==='approval.requested').at(-1);
    const question=pendingQuestions(runtime.state.activities).find(q=>q.turnId===job.turnId);
    if(question&&question.requestId!==runtime.alerted){runtime.alerted=question.requestId;new Notice('T3 has a question. Use Answer in the note when you are ready.',8000);}
    if(activity&&activity.id!==runtime.alerted){runtime.alerted=activity.id;new Notice(`T3 needs your response in thread ${job.threadId}: ${activity.summary.slice(0,140)}`,12000);}
    const phase=job.turnId?turnPhase(runtime.state,job.turnId):'running';
    if(job.phase==='error'&&phase==='running'&&runtime.state.latestTurn?.turnId!==job.turnId&&runtime.state.session?.activeTurnId!==job.turnId)return;
    if(job.phase==='error'&&phase==='error')return;
    const nextPhase=job.steering?.some(input=>!input.confirmed)?'running':phase;
    if(job.phase!==nextPhase)logEvent('response.phase.changed',{jobId:job.id,threadId:job.threadId,turnId:job.turnId,from:job.phase,to:nextPhase});
    job.phase=nextPhase;this.schedule(job);
  }
  private schedule(job:InlineJob){
    const runtime=this.runtime(job);if(runtime.timer)clearTimeout(runtime.timer);
    runtime.timer=setTimeout(()=>{runtime.timer=undefined;this.flush(job);},100);
  }
  flushAvailable(){this.reconcileHosted();for(const job of this.jobs)if(!job.hosted&&job.threadId&&!job.finalized&&job.phase!=='conflict')this.schedule(job);}
  renamed(oldPath:string,newPath:string){let changed=false;for(const job of this.jobs)if(!job.finalized&&(job.path===oldPath||job.path.startsWith(oldPath+'/'))){job.path=newPath+job.path.slice(oldPath.length);changed=true;}if(changed){this.persist();this.flushAvailable();}}
  deleted(path:string){let changed=false;for(const job of this.jobs)if(!job.finalized&&(job.path===path||job.path.startsWith(path+'/'))){job.phase='conflict';this.runtimes.get(job.id)?.monitor?.stop();changed=true;}if(changed)this.persist();}
  private editorFor(job:InlineJob):Editor|undefined {
    const leaves=this.app.workspace.getLeavesOfType?.('markdown')??[];
    for(const leaf of leaves){const view=leaf.view as MarkdownView;if(view.file?.path===job.path&&view.editor)return view.editor;}
    const source=this.runtimes.get(job.id)?.source;
    return source?.info.file?.path===job.path?source.editor:undefined;
  }
  private flush(job:InlineJob){
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
        }catch(error){logFailure('response.final-snapshot.failed',error,{jobId:job.id,threadId:job.threadId},false);this.schedule(job);}
        finally{runtime.refreshing=false;await access?.close?.();}
      })();
      return;
    }
    const conversation=(job.turnIds?.length??0)>1||job.steering?.length?{messages:job.prose??[],steering:job.steering??[]}:undefined;
    const next=renderInlineTurn(runtime.state,job.turnId??'',job.threadId,job.phase==='conflict'?'error':job.phase,job.keepIntermediate===true,job.connection?.environmentId,conversation,job.initialInput);
    const original=editor.getValue();let document=original;
    const current=regionBody(document,job.id);
    const terminal=['complete','interrupted','cancelled'].includes(job.phase);
    if(!terminal&&current&&current.body===next&&!job.steering?.some(input=>input.confirmed&&input.selection&&!input.selectionApplied))return;
    if(current&&contentHash(current.body)===job.bodyHash)for(const input of job.steering??[]){
      if(!input.confirmed||!input.selection||input.selectionApplied)continue;
      const range=selectionRange(document,input.selection),region=regionBody(document,job.id)!;
      if(range&&(range.to<=region.from-startMarker(job.id).length-1||range.from>=region.to+endMarker(job.id).length+1))document=document.slice(0,range.from)+document.slice(range.to);
      input.selectionApplied=true;
    }
    const change=terminal?finalizeRegion(document,job.id,job.bodyHash,next):replaceRegion(document,job.id,job.bodyHash,next);
    if(!change){logFailure('note.write.conflict',new Error('Response block was edited or removed.'),{jobId:job.id,notePath:job.path,expectedHash:job.bodyHash,actualHash:current?contentHash(current.body):undefined});job.phase='conflict';runtime.monitor?.stop();this.persist();new Notice(`T3 stopped writing to ${job.path} because its inline response was edited or removed. The T3 thread remains available.`,12000);return;}
    logEvent('note.response.write',{jobId:job.id,notePath:job.path,fromHash:contentHash(original),toHash:contentHash(document.slice(0,change.from)+change.text+document.slice(change.to)),terminal});
    replaceChangedText(editor,original,document.slice(0,change.from)+change.text+document.slice(change.to));
    if(terminal)job.finalized=true;
    else job.bodyHash=contentHash(next);
    this.persist();
    if(['complete','interrupted','cancelled'].includes(job.phase))runtime.monitor?.stop();
  }
  async stop(job:InlineJob){
    if(job.hosted&&this.hosted){await this.hosted.stop(job);return;}
    if(!job.threadId||!job.connection)return;
    const access=await this.access(job.connection);
    try{await access.api('/api/orchestration/dispatch',{type:'thread.turn.interrupt',commandId:commandId(job.requestId,'interrupt'),threadId:job.threadId,...(job.turnId?{turnId:job.turnId}:{}),createdAt:new Date().toISOString()});}
    finally{await access.close?.();}
    this.runtime(job).monitor?.stop();job.phase='cancelled';this.persist();this.schedule(job);
  }
}
function validJob(value:any):value is InlineJob{return value&&typeof value.id==='string'&&typeof value.path==='string'&&typeof value.requestId==='string'&&typeof value.bodyHash==='string'&&typeof value.phase==='string'&&typeof value.createdAt==='string';}

export function captureEditorSelection(editor:Editor):SelectionAnchor {
  const document=editor.getValue(),from=editor.posToOffset(editor.getCursor('from')),to=editor.posToOffset(editor.getCursor('to'));
  return selectionAnchor(document,editor.getSelection(),from,to);
}
