import {Plugin,MarkdownView,setIcon} from 'obsidian';
import SendToT3 from '../main';
import {nativeResponses} from '../native-response-manager';
import {deviceNoteIO,deviceFinalNoteIO} from '../inline-note-io';
import {hiddenInlineMarkerExtension} from '../inline-markers';
import {installResponsePresentation} from '../response-presentation';
import {LocalResponseManager} from '../local-response-manager';
import {DirectInlinePreview} from '../direct-inline-preview';
import {responseBindingRequests,updateResponseBindingData} from '../response-binding-data';
import {desktopDefaults,desktopEnvironment,desktopThreadAccess,start,uuid5} from '../desktop';
import {readNewThreadDefaults} from '../model-defaults';
import {applyThreadItem} from '../inline-thread';
import {delegatedTurnIds} from '../inline-delegation';
import {watchThread,type ThreadAccess,type ThreadStreamItem} from '../thread-stream';
const fs=require('node:fs'),path=require('node:path');
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

/** One real worktree handoff and saved reply in an isolated native vault.
 * TEST-CONFIG.json must identify a dedicated synthetic Git project. */
export default class WorktreeContinuationLab extends Plugin {
  private root='';private access?:ThreadAccess;private threadId?:string;
  private local?:LocalResponseManager;private interval?:number;
  private errors:string[]=[];
  async onload(){
    this.root=path.dirname((this.app.vault.adapter as any).getFullPath(''));
    if(!fs.existsSync(path.join(this.root,'ISOLATED-NATIVE-LAB')))throw Error('An isolated test vault is required.');
    const native=nativeResponses(this.app);this.register(()=>native.dispose());
    this.registerEditorExtension(hiddenInlineMarkerExtension());
    const {EditorState}=require('@codemirror/state');
    this.registerEditorExtension(EditorState.transactionFilter.of((transaction:any)=>native.filter(transaction)));
    this.register(installResponsePresentation(document,setIcon));
    this.app.workspace.onLayoutReady(()=>void this.run().catch(error=>this.write('ERROR.json',{error:String(error),stack:error.stack})).finally(()=>this.cleanup()));
  }
  private write(name:string,data:any){fs.writeFileSync(path.join(this.root,name),JSON.stringify(data,null,2));}
  private async until(check:()=>Promise<boolean>|boolean,label:string,timeout=120_000){
    const end=Date.now()+timeout;do{if(await check())return;await pause(200);}while(Date.now()<end);throw Error('Timed out: '+label);
  }
  // Fault injection is local to this isolated reader. Preserve the real T3
  // message/run identities and timestamps; discard only the tool success proof.
  private loseResult(snapshot:any){
    if(!snapshot?.thread?.worktreeHandoffs)return snapshot;
    return {...snapshot,thread:{...snapshot.thread,worktreeHandoffs:Object.fromEntries(Object.entries(snapshot.thread.worktreeHandoffs).map(([id,item]:[string,any])=>[id,item.status==='scheduled'?{...item,status:'interrupted'}:item]))}};
  }
  private loseItemResult(item:ThreadStreamItem):ThreadStreamItem {
    if(item.kind==='snapshot')return {...item,snapshot:this.loseResult(item.snapshot)};
    if(item.kind==='event'&&item.event.type==='v2.turn-item.updated'&&/t3_worktree_handoff$/.test(item.event.payload?.toolName??''))return {...item,event:{...item.event,payload:{...item.event.payload,status:'interrupted',output:undefined}}};
    return item;
  }
  private async reader():Promise<ThreadAccess>{
    const access=await desktopThreadAccess(desktopDefaults());
    return {...access,api:async(route,payload)=>this.loseResult(await access.api(route,payload))};
  }
  private async run(){
    const config=JSON.parse(fs.readFileSync(path.join(this.root,'TEST-CONFIG.json'),'utf8'));
    const connection=desktopDefaults(),environmentId=await desktopEnvironment(connection);
    this.access=await desktopThreadAccess(connection);
    const api=(route:string,payload?:any)=>this.access!.api(route.startsWith('/api/')?route:'/api/orchestration/'+route,payload);
    const project=(await api('shell')).projects.find((item:any)=>item.id===config.projectId);
    if(!project?.workspaceRoot?.startsWith(this.root+path.sep))throw Error('A dedicated synthetic project inside this lab is required.');
    const requestId=crypto.randomUUID(),messageId=uuid5(requestId,'message');this.threadId=uuid5(requestId,'thread');
    this.write('TEMPORARY-T3.json',{threadId:this.threadId,requestId,messageId,notePath:'Worktree delivery.md'});
    await start(api,{requestId,project:project.id,title:'Synthetic worktree continuation '+requestId.slice(0,8),
      prompt:'This is a bounded synthetic plugin test. Do not inspect files, run shell commands, edit source, or call other agents. Call t3_worktree_handoff once with branch "smoke/'+requestId+'", baseRef "HEAD", startFromOrigin false, runSetupScript false, and continuationPrompt exactly "Reply with exactly WORKTREE_CONTINUATION_LIVE_OK. Do not use tools or change files.". Call that tool as your final action. The continuation must return that exact marker.'},path.join(this.root,'t3-state'),item=>readNewThreadDefaults(this.access!.api,this.access!.origin,item));
    await this.until(async()=>!!(await api('threads/'+this.threadId)).thread.messages.find((item:any)=>item.id===messageId),'original input');
    const native=nativeResponses(this.app),subject:any=new SendToT3(this.app,this.manifest),notes=deviceNoteIO(this.app);
    subject.settings={vaultId:'synthetic-worktree-'+requestId,inlineStreaming:{enabled:true,intermediateMode:'collapse'},responseBindings:{}};
    subject.connection=()=>({...connection,environmentId});subject.inlineThreadAccess=()=>desktopThreadAccess(connection);
    subject.localResponseTarget=async()=>({environmentId,workspaceRoot:project.workspaceRoot,directory:'.obsidian/t3-code/inline/v1'});
    subject.rememberNoteThread=()=>{};subject.save=async()=>{};
    this.local=new LocalResponseManager('worktree-lab',subject.settings.vaultId,{
      ...notes,localBindings:()=>responseBindingRequests(subject.settings.responseBindings),
      saveLocalBinding:async request=>{subject.settings.responseBindings=updateResponseBindingData(subject.settings.responseBindings,request,'lab');},
      openedNotes:()=>this.app.workspace.getLeavesOfType('markdown').map(leaf=>leaf.view as MarkdownView).filter(view=>view.file).map(view=>({path:view.file!.path,document:native.view(view)?.recoveryDocument()??view.getViewData()})),syncReady:()=>true,
      receiveCoordinated:record=>native.receive(record),receiveDirect:update=>native.stream(update),localCompleted:(key,note)=>native.localCompleted(key,note),completionFailed:error=>this.errors.push(String(error)),access:()=>this.reader(),
    },deviceFinalNoteIO(this.app,()=>true),Date.now,(record,access,receive,changed)=>new DirectInlinePreview(record,access,receive,(thread,factory,callbacks,...rest)=>watchThread(thread,factory,{...callbacks,item:item=>callbacks.item(this.loseItemResult(item))},...rest),undefined,changed));
    this.interval=window.setInterval(()=>{native.refresh();this.local?.tick();},100);
    subject.deviceInline={register:(request:any)=>this.local!.register(request),waitForSave:(key:string)=>this.local!.waitForSave(key,20_000)};
    const file=await this.app.vault.create('Worktree delivery.md','# Worktree continuation\n\nOne real synthetic response across a worktree move.\n'),leaf=this.app.workspace.getLeaf(false);
    await leaf.openFile(file);
    const imported=await subject.importRun(file.path,project,this.threadId,messageId,false);
    const binding=responseBindingRequests(subject.settings.responseBindings)[0];
    if(!binding)throw Error('The original response was not registered.');
    const finalSave=await this.local.waitForSave(binding.id,120_000);
    if(!finalSave.saved)throw Error('The continuation was not saved: '+finalSave.reason);
    await this.until(()=>(leaf.view as MarkdownView).contentEl.innerText.includes('WORKTREE_CONTINUATION_LIVE_OK'),'visible continuation');
    const snapshot=await api('threads/'+this.threadId),projected=this.loseResult(snapshot),state=applyThreadItem({messages:[],activities:[]},{kind:'snapshot',snapshot:projected}).state;
    const source=Object.values(state.turns??{}).find(turn=>turn.messageId===messageId),handoffs=Object.values(state.worktreeHandoffs??{});
    const saved=await this.app.vault.read(file),visible=(leaf.view as MarkdownView).contentEl.innerText;
    const checks={originalInterrupted:source?.state==='interrupted',exactContinuation:!!source&&delegatedTurnIds(state,[source.turnId]).length===2,
      recoveredWithoutToolResult:Object.values(projected.thread.worktreeHandoffs??{}).some((item:any)=>item.status==='interrupted')&&handoffs.some(item=>item.status==='scheduled'&&item.turnId),
      saved:saved.includes('WORKTREE_CONTINUATION_LIVE_OK'),visible:visible.includes('WORKTREE_CONTINUATION_LIVE_OK'),noFalseError:!visible.includes('Worktree continuation failed'),noErrors:this.errors.length===0};
    // The raw tool's interrupted terminal time may also be retained. Record the
    // canonical history independently of the compact, recovered association.
    this.write('CANONICAL.json',snapshot);this.write('INTERRUPTED-PROJECTION.json',projected);
    this.write('RESULT.json',{threadId:this.threadId,imported,finalSave,checks,handoffs,errors:this.errors,coverage:'Real T3 worktree handoff and native Obsidian saved/editor reply, with controlled loss of tool success only in this isolated reader. Server records unchanged. No Sync or native mobile coverage.'});
    fs.writeFileSync(path.join(this.root,'saved-note.md'),saved);
    fs.writeFileSync(path.join(this.root,'real-worktree-delivery.png'),(await require('@electron/remote').getCurrentWebContents().capturePage()).toPNG());
    if(Object.values(checks).some(pass=>!pass))throw Error('Worktree continuation checks failed.');
    await this.until(()=>fs.existsSync(path.join(this.root,'finish-test.json')),'external visual inspection',90_000);
  }
  private async cleanup(){
    if(this.interval!==undefined)window.clearInterval(this.interval);this.local?.dispose();
    const remainingThreadIds:string[]=[];
    try{
      if(this.threadId&&this.access){
        const state=applyThreadItem({messages:[],activities:[]},{kind:'snapshot',snapshot:await this.access.api('/api/orchestration/threads/'+this.threadId+'?controlOnly=true')}).state;
        for(const turn of Object.values(state.turns??{})){
          if(turn.state==='running')await this.access.api('/api/orchestration/dispatch',{type:'thread.turn.interrupt',commandId:crypto.randomUUID(),threadId:this.threadId,turnId:turn.turnId,createdAt:new Date().toISOString()});
          if(turn.state==='queued')await this.access.api('/api/orchestration/dispatch',{type:'queued-run.cancel',commandId:crypto.randomUUID(),threadId:this.threadId,runId:turn.turnId});
        }
        await this.access.api('/api/orchestration/dispatch',{type:'thread.delete',commandId:crypto.randomUUID(),threadId:this.threadId});
        let deleted=false;try{deleted=!!(await this.access.api('/api/orchestration/threads/'+this.threadId+'?controlOnly=true')).thread.deletedAt;}catch(error){deleted=(error as any)?.status===404;}
        if(!deleted)remainingThreadIds.push(this.threadId);
      }
    }catch(error){this.errors.push('Thread cleanup: '+String(error));if(this.threadId)remainingThreadIds.push(this.threadId);}
    await this.access?.close?.();
    for(const leaf of this.app.workspace.getLeavesOfType('markdown'))leaf.detach();
    for(const file of this.app.vault.getMarkdownFiles())await this.app.vault.delete(file);
    this.write('CLEANUP.json',{temporaryThreadIds:this.threadId?[this.threadId]:[],remainingThreadIds,remainingNotes:this.app.vault.getMarkdownFiles().map(file=>file.path),errors:this.errors});
    await pause(250);require('@electron/remote').app.quit();
  }
}
