import type {App,Editor,MarkdownFileInfo,MarkdownView} from 'obsidian';
import {Notice} from 'obsidian';
import type {Connection,Request} from './bridge';
import {commandId,endpoint,environmentApi,type PairedSession} from './direct';
import {contentHash} from './completion';
import {applyThreadItem,initialRegion,insertionOffset,regionBody,renderInlineTurn,replaceRegion,selectionAnchor,turnForMessage,turnPhase,type InlineThreadState,type SelectionAnchor} from './inline-thread';
import {watchThread,type ThreadAccess,type ThreadStreamItem} from './thread-stream';

export interface InlineJob {
  id:string;path:string;requestId:string;threadId?:string;turnId?:string;messageId?:string;connection?:Connection;
  bodyHash:string;phase:'sending'|'running'|'reconnecting'|'complete'|'interrupted'|'error'|'cancelled'|'conflict';createdAt:string;finalized?:boolean;
}
interface EditorSource {editor:Editor;info:MarkdownView|MarkdownFileInfo}
interface Runtime {state:InlineThreadState;sequence:number;monitor?:{stop():void};source?:EditorSource;timer?:ReturnType<typeof setTimeout>;alerted?:string}

export class InlineChatManager {
  private jobs:InlineJob[]=[];
  private runtimes=new Map<string,Runtime>();
  private stopped=false;
  constructor(private app:App,private key:string,private sessionFor:(id:string)=>Promise<PairedSession|undefined>) {
    const saved=this.app.loadLocalStorage(key);
    if(Array.isArray(saved))this.jobs=saved.filter(validJob).map(job=>{
      // 2.12.6 mistook the client command ID for T3's provider-assigned turn ID.
      if(job.turnId===commandId(job.requestId,'turn'))delete job.turnId;
      job.messageId??=commandId(job.requestId,'message');
      return job;
    });
  }
  resume(){for(const job of this.jobs)if(job.threadId&&job.connection&&!job.finalized&&!['conflict','cancelled'].includes(job.phase))this.start(job);this.flushAvailable();}
  dispose(){this.stopped=true;for(const runtime of this.runtimes.values()){runtime.monitor?.stop();if(runtime.timer)clearTimeout(runtime.timer);}this.runtimes.clear();}
  activeFor(path:string){return this.jobs.filter(j=>j.path===path&&!j.finalized&&!['cancelled','conflict'].includes(j.phase));}
  private persist(){this.app.saveLocalStorage(this.key,this.jobs.map(j=>({...j})));}
  private runtime(job:InlineJob){let runtime=this.runtimes.get(job.id);if(!runtime){runtime={state:{messages:[],activities:[]},sequence:-1};this.runtimes.set(job.id,runtime);}return runtime;}

  reserve(editor:Editor,info:MarkdownView|MarkdownFileInfo,anchor:SelectionAnchor,requestId:string,expectedPath:string):InlineJob {
    if(this.stopped)throw Error('The plugin was disabled.');
    const file=info.file;if(!file||file.path!==expectedPath||file.extension.toLowerCase()!=='md')throw Error('The original Markdown note is no longer open. Reopen it and ask T3 again.');
    if(this.activeFor(file.path).length)throw Error('This note already has an active T3 response. Wait for it or stop it first.');
    const document=editor.getValue();const offset=insertionOffset(document,anchor);
    const id=requestId,region=initialRegion(id);
    const job:InlineJob={id,path:file.path,requestId,bodyHash:region.bodyHash,phase:'sending',createdAt:new Date().toISOString()};
    this.jobs.push(job);this.runtime(job).source={editor,info};
    try{this.persist();editor.replaceRange(region.text,editor.offsetToPos(offset),undefined,'send-to-t3-code');}
    catch(error){this.jobs=this.jobs.filter(item=>item!==job);this.runtimes.delete(job.id);try{this.persist();}catch{/* Original storage error remains primary. */}throw error;}
    return job;
  }
  prepare(job:InlineJob,request:Request){
    job.connection=request.connection;job.threadId=request.threadId??commandId(request.id,'thread');job.messageId=commandId(request.id,'message');this.persist();
  }
  deliveryFailed(job:InlineJob,uncertain:boolean){
    if(!uncertain){
      const editor=this.editorFor(job),found=editor&&regionBody(editor.getValue(),job.id);
      if(editor&&found&&contentHash(found.body)===job.bodyHash){
        const start=editor.getValue().indexOf(`<!-- t3-inline:start:${job.id} -->`);
        const end=editor.getValue().indexOf(`<!-- t3-inline:end:${job.id} -->`,found.to);
        if(start>=0&&end>=0)editor.replaceRange('',editor.offsetToPos(start-1),editor.offsetToPos(end+`<!-- t3-inline:end:${job.id} -->`.length+1),'send-to-t3-code');
      }
      this.jobs=this.jobs.filter(j=>j!==job);this.runtimes.delete(job.id);this.persist();return;
    }
    job.phase='reconnecting';this.persist();
    if(job.threadId&&job.connection)this.start(job);
  }
  start(job:InlineJob){
    if(this.stopped||!job.threadId||!job.connection)return;
    const runtime=this.runtime(job);runtime.monitor?.stop();
    const access=()=>this.access(job.connection!);
    runtime.monitor=watchThread(job.threadId,access,{
      item:item=>this.receive(job,item),
      reconnecting:()=>{if(this.stopped||job.phase==='complete'||job.phase==='conflict')return;job.phase='reconnecting';this.schedule(job);},
    });
    if(!['reconnecting','complete','interrupted','error'].includes(job.phase))job.phase='running';this.persist();this.schedule(job);
  }
  private async access(connection:Connection):Promise<ThreadAccess>{
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
    if(item.kind==='snapshot'&&Number.isSafeInteger(item.snapshot?.snapshotSequence)&&item.snapshot.snapshotSequence<runtime.sequence)return;
    if(item.kind==='event'&&Number.isSafeInteger(item.event?.sequence)&&item.event.sequence<=runtime.sequence)return;
    const applied=applyThreadItem(runtime.state,item);runtime.state=applied.state;
    if(!job.turnId&&job.messageId){
      const turnId=turnForMessage(runtime.state,job.messageId);
      if(turnId){job.turnId=turnId;this.persist();}
    }
    if(item.kind==='snapshot')runtime.sequence=Number.isSafeInteger(applied.sequence)?applied.sequence!:runtime.sequence;
    else if(applied.sequence!==undefined)runtime.sequence=applied.sequence;
    const activity=job.turnId&&runtime.state.activities.filter(a=>a.turnId===job.turnId&&/^(approval\.requested|user-input\.requested)$/.test(a.kind)).at(-1);
    if(activity&&activity.id!==runtime.alerted){runtime.alerted=activity.id;new Notice(`T3 needs your response in thread ${job.threadId}: ${activity.summary.slice(0,140)}`,12000);}
    const phase=job.turnId?turnPhase(runtime.state,job.turnId):'running';
    job.phase=phase;this.schedule(job);
  }
  private schedule(job:InlineJob){
    const runtime=this.runtime(job);if(runtime.timer)clearTimeout(runtime.timer);
    runtime.timer=setTimeout(()=>{runtime.timer=undefined;this.flush(job);},100);
  }
  flushAvailable(){for(const job of this.jobs)if(job.threadId&&!job.finalized&&job.phase!=='conflict')this.schedule(job);}
  renamed(oldPath:string,newPath:string){let changed=false;for(const job of this.jobs)if(!job.finalized&&(job.path===oldPath||job.path.startsWith(oldPath+'/'))){job.path=newPath+job.path.slice(oldPath.length);changed=true;}if(changed){this.persist();this.flushAvailable();}}
  deleted(path:string){let changed=false;for(const job of this.jobs)if(!job.finalized&&(job.path===path||job.path.startsWith(path+'/'))){job.phase='conflict';this.runtimes.get(job.id)?.monitor?.stop();changed=true;}if(changed)this.persist();}
  private editorFor(job:InlineJob):Editor|undefined {
    const leaves=this.app.workspace.getLeavesOfType?.('markdown')??[];
    for(const leaf of leaves){const view=leaf.view as MarkdownView;if(view.file?.path===job.path&&view.editor)return view.editor;}
    const source=this.runtimes.get(job.id)?.source;
    return source?.info.file?.path===job.path?source.editor:undefined;
  }
  private flush(job:InlineJob){
    if(this.stopped||!this.jobs.includes(job)||!job.threadId)return;
    const editor=this.editorFor(job);if(!editor)return;
    const runtime=this.runtime(job);
    if(runtime.sequence<0&&['complete','interrupted','error'].includes(job.phase))return;
    const next=renderInlineTurn(runtime.state,job.turnId??'',job.threadId,job.phase==='conflict'?'error':job.phase);
    const current=regionBody(editor.getValue(),job.id);
    if(current&&current.body===next){if(['complete','interrupted','error','cancelled'].includes(job.phase)){job.finalized=true;this.persist();runtime.monitor?.stop();}return;}
    const change=replaceRegion(editor.getValue(),job.id,job.bodyHash,next);
    if(!change){job.phase='conflict';runtime.monitor?.stop();this.persist();new Notice(`T3 stopped writing to ${job.path} because its inline response was edited or removed. The T3 thread remains available.`,12000);return;}
    editor.replaceRange(change.text,editor.offsetToPos(change.from),editor.offsetToPos(change.to),'send-to-t3-code');
    job.bodyHash=change.hash;this.persist();
    if(['complete','interrupted','error','cancelled'].includes(job.phase)){job.finalized=true;this.persist();runtime.monitor?.stop();}
  }
  async stop(job:InlineJob){
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
