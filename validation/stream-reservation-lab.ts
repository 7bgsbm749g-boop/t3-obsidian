import {Plugin,MarkdownView,setIcon} from 'obsidian';
import SendToT3 from '../main';
import {DeviceResponseManager} from '../device-local-responses';
import {nativeResponses} from '../native-response-manager';
import {deviceNoteIO,deviceFinalNoteIO} from '../inline-note-io';
import {hiddenInlineMarkerExtension} from '../inline-markers';
import {installResponsePresentation} from '../response-presentation';
import {responseBindingRequests,updateResponseBindingData} from '../response-binding-data';
import {desktopDefaults,desktopEnvironment,desktopThreadAccess,start,uuid5} from '../desktop';
import {readNewThreadDefaults} from '../model-defaults';
import {responseFrame} from '../response-container';
import type {ThreadAccess} from '../thread-stream';
const fs=require('node:fs'),path=require('node:path');
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

/** Real import, future-run subscription and note send. Only the watcher's
 * settings discovery is withheld to reproduce a delayed cross-device Sync. */
export default class StreamReservationLab extends Plugin {
  private root='';private access?:ThreadAccess;private threadId?:string;
  private subject:any;private device?:DeviceResponseManager;private timer?:number;
  private errors:string[]=[];private notePath='Stream reservation.md';
  async onload(){
    this.root=path.dirname((this.app.vault.adapter as any).getFullPath(''));
    if(!fs.existsSync(path.join(this.root,'ISOLATED-NATIVE-LAB')))throw Error('An isolated test vault is required.');
    this.app.workspace.onLayoutReady(()=>void this.run().catch(error=>this.write('ERROR.json',{error:String(error),stack:error.stack})).finally(()=>this.cleanup()));
  }
  private write(name:string,value:unknown){fs.writeFileSync(path.join(this.root,name),JSON.stringify(value,null,2));}
  private async until(check:()=>Promise<boolean>|boolean,label:string,timeout=120_000){const end=Date.now()+timeout;do{if(await check())return;await pause(200);}while(Date.now()<end);throw Error('Timed out: '+label);}
  private answerCount(document:string,marker:string){return document.split('\n').filter(line=>line.replace(/^(?:> ?)+/,'').trim()===marker).length;}
  private async savedReply(id:string,marker:string){
    const runtimeResult=await this.device!.waitForSave(id,120_000);let proof:any;
    // The native test host may retire its local slot after materialization.
    // Independently require saved bytes, a removed frame, native adoption and
    // the canonical terminal run, while retaining the original runtime result.
    await this.until(async()=>{
      const file=this.app.vault.getFileByPath(this.notePath);if(!file)return false;
      const saved=await this.app.vault.read(file),snapshot=await this.access!.api('/api/orchestration/threads/'+this.threadId+'?controlOnly=true');
      const visible=this.app.workspace.getLeavesOfType('markdown').some(leaf=>(leaf.view as MarkdownView).file?.path===this.notePath&&(leaf.view as MarkdownView).contentEl.innerText.includes(marker));
      proof={savedAnswerCount:this.answerCount(saved,marker),frameRemoved:!responseFrame(saved,id),nativeAdopted:visible,terminalRun:snapshot.thread.latestTurn?.state==='completed',turnId:snapshot.thread.latestTurn?.turnId};
      return proof.savedAnswerCount===1&&proof.frameRemoved&&proof.nativeAdopted&&proof.terminalRun;
    },'saved and native '+marker,15_000);
    const result={runtimeResult,proof};this.write('SAVE-'+marker+'.json',result);return result;
  }
  private async run(){
    const config=JSON.parse(fs.readFileSync(path.join(this.root,'TEST-CONFIG.json'),'utf8'));
    const connection=desktopDefaults(),environmentId=await desktopEnvironment(connection);
    this.access=await desktopThreadAccess(connection);
    const api=(route:string,payload?:any)=>this.access!.api(route.startsWith('/api/')?route:'/api/orchestration/'+route,payload);
    const project=(await this.access.api('/api/orchestration/shell')).projects.find((entry:any)=>entry.id===config.projectId);
    if(project?.workspaceRoot!==path.join(this.root,'workspace'))throw Error('A dedicated synthetic project is required.');
    const seed=crypto.randomUUID();this.threadId=uuid5(seed,'thread');
    this.write('TEMPORARY-T3.json',{threadId:this.threadId,notePaths:[this.notePath]});
    await start(api,{requestId:seed,project:project.id,title:'Synthetic duplicate stream regression',prompt:'Reply with exactly STREAM_IMPORT_SEED_OK. Do not use tools or modify files.'},path.join(this.root,'t3-state'),item=>readNewThreadDefaults(api,this.access!.origin,item));
    await this.until(async()=>{const snapshot=await this.access!.api('/api/orchestration/threads/'+this.threadId+'?controlOnly=true');return snapshot.thread.latestTurn?.state==='completed';},'seed run completion');
    const native=nativeResponses(this.app),notes=deviceNoteIO(this.app),subject:any=new SendToT3(this.app,this.manifest);this.subject=subject;
    const root=(this.app.vault.adapter as any).getFullPath('');
    subject.settings={vaultId:'stream-lab-'+crypto.randomUUID(),threadNoteMode:'free',projects:[project],directProjects:[],paired:[],connection,autoSettleThreads:false,completion:{action:'keep'},completionJobs:[],settlementJobs:[],pending:[],noteThreads:[],noteContexts:[],vaultLocations:[],folderLinkChanges:[],projectCreationLocations:[],responseBindings:{},inlineStreaming:{enabled:true,intermediateMode:'collapse',keepIntermediate:true,finalAnswerFormat:'formatted'},folderLinks:[{id:crypto.randomUUID(),folderPath:'/',projectId:project.id,projectTitle:project.title,workspaceRoot:project.workspaceRoot,connectionId:'',environmentId,self:false}]};
    subject.mode='desktop';subject.eventLocalEnvironmentId=environmentId;
    subject.localInlineEnvironment=async()=>environmentId;subject.inlineThreadAccess=()=>desktopThreadAccess(connection);
    subject.vaultConnection=()=>({workspaceRoot:root,connectionId:'',environmentId});
    subject.save=async()=>{await this.saveData(subject.settings);};
    let bindingDiscoveryReads=0;
    subject.displayResponseBindings=async()=>{bindingDiscoveryReads++;return [];};
    this.registerEditorExtension(hiddenInlineMarkerExtension());
    const {EditorState}=require('@codemirror/state');this.registerEditorExtension(EditorState.transactionFilter.of((transaction:any)=>native.filter(transaction)));
    this.register(installResponsePresentation(document,setIcon));
    this.device=new DeviceResponseManager('stream-reservation-lab',subject.settings.vaultId,{
      ...notes,localFinalNotes:deviceFinalNoteIO(this.app,()=>true),localBindings:()=>responseBindingRequests(subject.settings.responseBindings),saveLocalBinding:async request=>{subject.settings.responseBindings=updateResponseBindingData(subject.settings.responseBindings,request,'lab');await subject.save();},
      openedNotes:()=>this.app.workspace.getLeavesOfType('markdown').map(leaf=>leaf.view as MarkdownView).filter(view=>view.file).map(view=>({path:view.file!.path,document:native.view(view)?.recoveryDocument()??view.getViewData()})),syncReady:()=>true,receiveCoordinated:record=>native.receive(record),receiveDirect:update=>native.stream(update),localCompleted:(id,note)=>native.localCompleted(id,note),completionFailed:error=>this.errors.push(String(error)),access:()=>desktopThreadAccess(connection),
    });subject.deviceInline=this.device;
    this.timer=window.setInterval(()=>{native.refresh();this.device?.tick();},100);
    const file=await this.app.vault.create(this.notePath,'# Stream reservation\n\nSynthetic ordinary text.\n');const leaf=this.app.workspace.getLeaf(false);await leaf.openFile(file);
    const imported=await subject.importRun(file.path,project,this.threadId,uuid5(seed,'message'),true);
    if(imported.saveState!=='saved')throw Error('The selected seed run was not saved.');
    await notes.updateNote(file.path,document=>document+'\nReply with exactly STREAM_NOTE_SEND_OK. Do not use tools or modify files.\n',()=>true);
    const sent=await subject.executeNoteCommand({version:1,id:crypto.randomUUID(),kind:'send-note',notePath:file.path,threadId:this.threadId,destinations:[file.path],streamReply:true});
    if(sent.bindingIds.length!==1)throw Error('Send did not prepare one stream.');
    const saved=await this.savedReply(sent.bindingIds[0],'STREAM_NOTE_SEND_OK');
    await this.until(()=>subject.eventSubscriptions.snapshot.displays[0].bindings.some((binding:any)=>binding.messageId===sent.messageId&&binding.status==='skipped'),'watcher skipping the sent reply');
    await this.until(()=>(leaf.view as MarkdownView).contentEl.innerText.includes('STREAM_NOTE_SEND_OK'),'visible saved reply');
    const records=responseBindingRequests(subject.settings.responseBindings).filter(request=>request.messageId===sent.messageId),watcher=subject.eventSubscriptions.snapshot.displays[0];
    this.write('NOTE-SEND.json',{sent,saved,watcher,bindingDiscoveryReads,responseCount:records.length});
    fs.writeFileSync(path.join(this.root,'sent-note.md'),await this.app.vault.read(file));
    // Restart the service against its real durable host state before a replay.
    await subject.eventHostServer.dispose();await subject.refreshEventHost();await subject.eventSubscriptions.tick();
    const future=crypto.randomUUID();
    await start(api,{requestId:future,project:project.id,threadId:this.threadId,title:'Synthetic future run',prompt:'Reply with exactly STREAM_FUTURE_RUN_OK. Do not use tools or modify files.'},path.join(this.root,'t3-state'),item=>readNewThreadDefaults(api,this.access!.origin,item));
    await this.until(()=>responseBindingRequests(subject.settings.responseBindings).some(request=>request.messageId===uuid5(future,'message')),'ordinary future run attachment');
    const futureBinding=responseBindingRequests(subject.settings.responseBindings).find(request=>request.messageId===uuid5(future,'message'))!;
    const futureSave=await this.savedReply(futureBinding.id,'STREAM_FUTURE_RUN_OK');
    await this.until(()=>(leaf.view as MarkdownView).contentEl.innerText.includes('STREAM_FUTURE_RUN_OK'),'visible future reply');
    const savedDocument=await this.app.vault.read(file),visible=(leaf.view as MarkdownView).contentEl.innerText;
    const checks={importAndFutureEnabled:imported.following,settingsDiscoveryWithheld:bindingDiscoveryReads>0,sentReplyHasOneBinding:records.length===1,sentReplySkippedByWatcher:watcher.bindings.find((binding:any)=>binding.messageId===sent.messageId)?.bindingId===sent.bindingIds[0],sentReplyAppearsOnce:this.answerCount(savedDocument,'STREAM_NOTE_SEND_OK')===1,futureReplyAppearsOnce:this.answerCount(savedDocument,'STREAM_FUTURE_RUN_OK')===1,bothVisible:visible.includes('STREAM_NOTE_SEND_OK')&&visible.includes('STREAM_FUTURE_RUN_OK'),ordinaryTextPreserved:savedDocument.includes('Synthetic ordinary text.'),noErrors:this.errors.length===0};
    this.write('RESULT.json',{checks,sent,imported,saved,futureSave,bindingDiscoveryReads,watcher,threadId:this.threadId,errors:this.errors,coverage:'Three bounded real T3 runs, real Obsidian import and note Send, private event-host acknowledgements, durable restart and native saved/editor results. Watcher settings discovery deliberately withheld. No real Sync transport or native mobile coverage.'});
    fs.writeFileSync(path.join(this.root,'saved-note.md'),savedDocument);fs.writeFileSync(path.join(this.root,'single-stream.png'),(await require('@electron/remote').getCurrentWebContents().capturePage()).toPNG());
    if(Object.values(checks).some(pass=>!pass))throw Error('Duplicate stream checks failed.');
    this.write('READY-FOR-INSPECTION.json',{threadId:this.threadId});
    await this.until(()=>fs.existsSync(path.join(this.root,'finish-test.json')),'external visual inspection',90_000);
  }
  private async cleanup(){
    if(this.timer!==undefined)window.clearInterval(this.timer);this.device?.dispose();this.subject?.eventSubscriptions?.stop();await this.subject?.eventHostServer?.dispose();
    const remainingThreadIds:string[]=[];
    try{if(this.threadId&&this.access){
      const snapshot=await this.access.api('/api/orchestration/threads/'+this.threadId+'?controlOnly=true');
      for(const turn of Object.values(snapshot.thread.turns??{}) as any[]){
        if(turn.state==='running')await this.access.api('/api/orchestration/dispatch',{type:'thread.turn.interrupt',commandId:crypto.randomUUID(),threadId:this.threadId,turnId:turn.turnId,createdAt:new Date().toISOString()});
        if(turn.state==='queued')await this.access.api('/api/orchestration/dispatch',{type:'queued-run.cancel',commandId:crypto.randomUUID(),threadId:this.threadId,runId:turn.turnId});
      }
      await this.access.api('/api/orchestration/dispatch',{type:'thread.delete',commandId:crypto.randomUUID(),threadId:this.threadId});
      let deleted=false;try{deleted=!!(await this.access.api('/api/orchestration/threads/'+this.threadId+'?controlOnly=true')).thread.deletedAt;}catch(error){deleted=(error as any)?.status===404;}if(!deleted)remainingThreadIds.push(this.threadId);
    }}catch(error){this.errors.push('Thread cleanup: '+String(error));if(this.threadId)remainingThreadIds.push(this.threadId);}
    await this.access?.close?.();for(const leaf of this.app.workspace.getLeavesOfType('markdown'))leaf.detach();for(const file of this.app.vault.getMarkdownFiles())await this.app.vault.delete(file);
    nativeResponses(this.app).dispose();this.write('CLEANUP.json',{temporaryThreadIds:this.threadId?[this.threadId]:[],remainingThreadIds,remainingNotes:this.app.vault.getMarkdownFiles().map(file=>file.path),errors:this.errors});await pause(250);require('@electron/remote').app.quit();
  }
}
