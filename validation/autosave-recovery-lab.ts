import {Plugin,MarkdownView,setIcon} from 'obsidian';
import SendToT3 from '../main';
import {nativeResponses} from '../native-response-manager';
import {deviceNoteIO,deviceFinalNoteIO} from '../inline-note-io';
import {responseAnchor} from '../native-response-projection';
import {hiddenInlineMarkerExtension} from '../inline-markers';
import {installResponsePresentation} from '../response-presentation';
import {LocalResponseManager} from '../local-response-manager';
import {responseBindingRequests,updateResponseBindingData} from '../response-binding-data';
import {desktopDefaults,desktopEnvironment,desktopThreadAccess,start} from '../desktop';
import {readNewThreadDefaults} from '../model-defaults';
import {applyThreadItem} from '../inline-thread';
import {importRuns} from '../run-import';
import {contentHash} from '../completion';
import type {ResponseRequest} from '../response-model';
import type {DirectInlineUpdate} from '../direct-inline-preview';
import type {ThreadAccess} from '../thread-stream';
const fs=require('node:fs'),path=require('node:path');
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

/** An isolated native desktop fixture. Native autosave and final file writes
 * are real; the first two replies are synthetic. The final import uses one
 * bounded real T3 run and deletes that exact temporary thread afterwards. */
export default class AutosaveRecoveryLab extends Plugin {
  private root='';private threadId?:string;private access?:ThreadAccess;
  private checks:Record<string,boolean>={};private errors:string[]=[];
  private local?:LocalResponseManager;private interval?:number;
  async onload(){
    this.root=path.dirname((this.app.vault.adapter as any).getFullPath(''));
    if(!fs.existsSync(path.join(this.root,'ISOLATED-NATIVE-LAB')))throw Error('An isolated test vault is required.');
    const native=nativeResponses(this.app);this.register(()=>native.dispose());
    this.registerEditorExtension(hiddenInlineMarkerExtension());
    const {EditorState}=require('@codemirror/state');this.registerEditorExtension(EditorState.transactionFilter.of((tr:any)=>native.filter(tr)));
    this.register(installResponsePresentation(document,setIcon));
    this.app.workspace.onLayoutReady(()=>void this.run().catch(error=>this.write('ERROR.json',{error:String(error),stack:error.stack})).finally(()=>this.cleanup()));
  }
  private write(name:string,value:any){fs.writeFileSync(path.join(this.root,name),JSON.stringify(value,null,2));}
  private check(name:string,value:boolean){this.checks[name]=value;this.write('CHECKS.json',this.checks);if(!value)throw Error(name);}
  private async until(check:()=>Promise<boolean>|boolean,label:string,timeout=10_000){
    const deadline=Date.now()+timeout;
    do{if(await check())return;await pause(25);}while(Date.now()<deadline);
    throw Error('Timed out: '+label);
  }
  private async capture(name:string){
    await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
    fs.writeFileSync(path.join(this.root,name),(await require('@electron/remote').getCurrentWebContents().capturePage()).toPNG());
  }
  private async open(name:string,id:string){
    const file=await this.app.vault.create(name,'# Native autosave\n\nType here: \n\n'+responseAnchor(id)+'\n\nTail.\n');
    const leaf=this.app.workspace.getLeaf('tab');await leaf.openFile(file);await leaf.setViewState({type:'markdown',state:{file:name,mode:'source',source:false}});
    return {file,view:leaf.view as MarkdownView,leaf};
  }
  private type(view:MarkdownView,text:string){const value=view.editor.getValue(),at=value.indexOf('Type here: '),end=value.indexOf('\n',at);view.editor.replaceRange(text,view.editor.offsetToPos(end));}
  private async run(){
    await pause(1200);const native=nativeResponses(this.app),io=deviceFinalNoteIO(this.app,()=>true),id=crypto.randomUUID();
    const first=await this.open('Autosave typing.md',id);native.preview(first.view,id,'Synthetic visible reply');await io.read(first.file.path);
    this.type(first.view,'a');
    await this.until(async()=>!(first.view as any).saving&&(await this.app.vault.read(first.file)).includes('Type here: a\n'),'real native autosave');
    this.type(first.view,'b');const before=await io.read(first.file.path);
    this.check('nativeAutosaveThenNextKeystroke',!!before?.includes('Type here: ab\n')&&!native.view(first.view)?.conflictRecord());
    const final=before!.replace(responseAnchor(id),'SYNTHETIC_FINAL_REPLY'),original=this.app.vault.process;
    let injected=false;
    this.app.vault.process=async(file,change,options)=>{const result=await original.call(this.app.vault,file,change,options);if(file===first.file&&!injected){injected=true;this.type(first.view,'c');}return result;};
    try{this.check('finalWriteVerified',await io.compareAndSet(first.file.path,before!,final));}finally{this.app.vault.process=original;}
    await this.until(async()=>(await this.app.vault.read(first.file)).includes('Type here: abc\n'),'typing during final write saved');
    this.check('typingDuringFinalWriteVisible',first.view.editor.getValue().includes('Type here: abc\n')&&first.view.editor.getValue().includes('SYNTHETIC_FINAL_REPLY'));
    const subject:any=new SendToT3(this.app,this.manifest);
    subject.notePromptDocument(first.view);first.view.editor.setCursor(first.view.editor.offsetToPos(first.view.editor.getValue().length));subject.noteSendInsertion(first.file);
    const next=crypto.randomUUID(),notes=deviceNoteIO(this.app);
    const registered=await notes.updateNote(first.file.path,text=>text+'\n\n'+responseAnchor(next),()=>true);
    this.check('nextNoteSendCanReadAndRegister',!!registered?.includes(responseAnchor(next))&&(await this.app.vault.read(first.file))===registered);
    await this.capture('typing-and-next-send.png');

    const recoveryId=crypto.randomUUID(),second=await this.open('Stale conflict.md',recoveryId),at=new Date().toISOString();
    const binding:ResponseRequest={version:4,id:recoveryId,vaultId:'synthetic-autosave-vault',localOnly:true,nativeProjection:true,responseContainer:true,independent:true,initialOwner:crypto.randomUUID(),host:{environmentId:'synthetic',workspaceRoot:'/synthetic',directory:'.obsidian/t3-code/inline/v1'},notePath:second.file.path,threadId:crypto.randomUUID(),projectId:crypto.randomUUID(),messageId:crypto.randomUUID(),threadEnvironmentId:'synthetic',createdAt:at,initialHash:contentHash('')};
    let records:any={},emit!:(update:DirectInlineUpdate)=>void,ready=false;
    const openedNotes=()=>this.app.workspace.getLeavesOfType('markdown').map(leaf=>leaf.view as MarkdownView).filter(view=>view.file).map(view=>({path:view.file!.path,document:native.view(view)?.recoveryDocument()??view.getViewData()}));
    this.local=new LocalResponseManager('native-lab',binding.vaultId,{
      ...notes,localBindings:()=>responseBindingRequests(records),saveLocalBinding:async request=>{records=updateResponseBindingData(records,request,'lab');},openedNotes,syncReady:()=>ready,
      receiveCoordinated:record=>native.receive(record),receiveDirect:update=>native.stream(update),localCompleted:(key,note)=>native.localCompleted(key,note),completionFailed:error=>this.errors.push(String(error)),
      access:async()=>{throw Error('Synthetic reply has no network.');},
    },io,Date.now,((_record:any,_access:any,receive:any)=>{emit=receive;return {tick(){},update(){},delivery(){},suspend(){},reconnect(){},dispose(){}};}) as any);
    await this.local.register(binding);await io.read(second.file.path);const base=native.view(second.view)!.saved();
    this.type(second.view,'a');await this.until(async()=>!(second.view as any).saving&&(await this.app.vault.read(second.file)).includes('Type here: a\n'),'recovery native autosave');
    this.type(second.view,'b');emit({request:binding,body:'RECOVERED_FINAL_REPLY',phase:'complete',sequence:1,completionVerified:true,messageId:binding.messageId,turnId:crypto.randomUUID()});
    const adapter=native.view(second.view)!;adapter.preserveConflict({base,local:adapter.saved(),incoming:await this.app.vault.read(second.file),reason:'Generated and ordinary edits overlap or touch. Both versions are preserved.'});
    ready=true;this.local.tick();const recovered=await this.local.waitForSave(binding.id,10_000);
    this.check('staleConflictRetriesAutomatically',recovered.saved&&!adapter.conflictRecord());
    this.check('recoveryPreservesTyping',(await this.app.vault.read(second.file)).includes('Type here: ab\n')&&second.view.editor.getValue().includes('RECOVERED_FINAL_REPLY'));
    await this.capture('recovered.png');this.local.dispose();this.local=undefined;

    const config=JSON.parse(fs.readFileSync(path.join(this.root,'TEST-CONFIG.json'),'utf8')),connection=desktopDefaults();
    this.access=await desktopThreadAccess(connection);const api=(route:string,payload?:any)=>this.access!.api(route.startsWith('/api/')?route:'/api/orchestration/'+route,payload);
    const source=await api('threads/'+config.sourceThreadId+'?controlOnly=true'),project={id:source.thread.projectId};
    const requestId=crypto.randomUUID(),stateDir=path.join(this.root,'t3-state');this.write('TEMPORARY-T3.json',{requestId,stateDir});
    const started=await start(api,{requestId,project:project.id,title:'Synthetic autosave recovery delivery '+requestId.slice(0,8),prompt:'This is a synthetic delivery test. Do not use tools, read or change files, create tasks, or call other agents. Reply with exactly AUTOSAVE_RECOVERY_LIVE_OK.'},stateDir,item=>readNewThreadDefaults(this.access!.api,this.access!.origin,item));
    this.threadId=started.threadId;this.write('TEMPORARY-T3.json',{requestId,stateDir,threadId:this.threadId});
    let run:any;
    await this.until(async()=>{const snapshot=await api('threads/'+this.threadId+'?importRuns=true');const state=applyThreadItem({messages:[],activities:[]},{kind:'snapshot',snapshot}).state;run=importRuns(state).find(item=>item.status==='Completed'&&!item.unavailable);return !!run;},'bounded real T3 completion',120_000);
    const environmentId=await desktopEnvironment(connection);
    subject.settings={vaultId:'synthetic-live-import',inlineStreaming:{enabled:true},responseBindings:{}};
    subject.connection=()=>({...connection,environmentId});subject.inlineThreadAccess=()=>desktopThreadAccess(connection);
    subject.localResponseTarget=async()=>({environmentId,workspaceRoot:'/synthetic',directory:'.obsidian/t3-code/inline/v1'});subject.rememberNoteThread=()=>{};subject.save=async()=>{};
    this.local=new LocalResponseManager('native-live-lab',subject.settings.vaultId,{
      ...notes,localBindings:()=>responseBindingRequests(subject.settings.responseBindings),saveLocalBinding:async request=>{subject.settings.responseBindings=updateResponseBindingData(subject.settings.responseBindings,request,'lab');},openedNotes,syncReady:()=>true,
      receiveCoordinated:record=>native.receive(record),receiveDirect:update=>native.stream(update),localCompleted:(key,note)=>native.localCompleted(key,note),completionFailed:error=>this.errors.push(String(error)),access:()=>desktopThreadAccess(connection),
    },io);
    this.interval=window.setInterval(()=>{try{native.refresh();this.local?.tick();}catch(error){this.errors.push(String(error));}},100);
    subject.deviceInline={register:(request:any)=>this.local!.register(request),waitForSave:(key:string)=>this.local!.waitForSave(key,20_000)};
    const live=await this.app.vault.create('Real delivery.md','# Synthetic real delivery\n\nType here: \n');const leaf=this.app.workspace.getLeaf('tab');await leaf.openFile(live);
    const imported=await subject.importRun(live.path,project,this.threadId,run.messageId,false);
    this.app.workspace.setActiveLeaf(leaf,{focus:true});
    await this.until(()=>(leaf.view as MarkdownView).contentEl.innerText.includes('AUTOSAVE_RECOVERY_LIVE_OK'),'painted real T3 reply');
    this.check('realT3FinalReplySaved',imported.saveState==='saved'&&(await this.app.vault.read(live)).includes('AUTOSAVE_RECOVERY_LIVE_OK'));
    this.check('realT3ReplyVisible',(leaf.view as MarkdownView).editor.getValue().includes('AUTOSAVE_RECOVERY_LIVE_OK')&&(leaf.view as MarkdownView).contentEl.innerText.includes('AUTOSAVE_RECOVERY_LIVE_OK'));
    this.check('noCompletionErrors',this.errors.length===0);await this.capture('real-delivery.png');
    this.write('RESULT.json',{checks:this.checks,errors:this.errors,temporaryThreadIds:[this.threadId],coverage:'Real native Obsidian editor transactions, constructor-bound autosaves, final writes, stale-conflict recovery, next-send preparation, and one real synthetic T3 delivery. No live Obsidian Sync contention or native mobile claim.'});
    await pause(1000);
  }
  private async cleanup(){
    if(this.interval!==undefined)window.clearInterval(this.interval);this.local?.dispose();
    const remainingThreadIds:string[]=[];
    try{
      if(!this.threadId&&fs.existsSync(path.join(this.root,'TEMPORARY-T3.json'))){const saved=JSON.parse(fs.readFileSync(path.join(this.root,'TEMPORARY-T3.json'),'utf8')),ledger=path.join(saved.stateDir,'requests',saved.requestId+'.json');if(fs.existsSync(ledger))this.threadId=JSON.parse(fs.readFileSync(ledger,'utf8')).threadId;}
      if(this.threadId&&this.access){
        await this.access.api('/api/orchestration/dispatch',{type:'thread.delete',commandId:crypto.randomUUID(),threadId:this.threadId});
        let deleted=false;try{const snapshot=await this.access.api('/api/orchestration/threads/'+this.threadId+'?controlOnly=true');deleted=!!snapshot.thread.deletedAt;}catch(error){deleted=(error as any)?.status===404;}
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
