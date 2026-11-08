import {Plugin,MarkdownView,setIcon} from 'obsidian';
import SendToT3 from '../../src/app/main';
import {DeviceResponseManager,type DeviceResponseIO} from '../../src/responses/device-local-responses';
import {nativeResponses} from '../../src/responses/native-response-manager';
import {deviceNoteIO,deviceFinalNoteIO} from '../../src/conversations/inline-note-io';
import {hiddenInlineMarkerExtension} from '../../src/conversations/inline-markers';
import {installResponsePresentation} from '../../src/responses/response-presentation';
import {responseBindingRequests,updateResponseBindingData,completeResponseBinding} from '../../src/responses/response-binding-data';
import {desktopDefaults,desktopEnvironment,desktopThreadAccess,start,uuid5} from '../fixtures/baseline-native/desktop';
import {readNewThreadDefaults} from '../../src/conversations/model-defaults';
import {readMetadataSnapshot,readWireShell} from '../../src/connection/wire-readers';
import {responseAnchor} from '../../src/responses/native-response-projection';
import {contentHash} from '../../src/responses/completion';
import {localFinalIdentity} from '../../src/responses/local-final-cache';
import {configureDiagnostics,redact} from '../../src/app/diagnostics';
import type {ResponseRequest} from '../../src/responses/response-model';
import type {ThreadAccess} from '../../src/conversations/thread-stream';
const fs=require('node:fs'),path=require('node:path');
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

/** Real T3 delivery and native editor IO. All notes, settings and output are
 * synthetic and confined to this uniquely owned, unsynced vault. */
export default class ConflictRecoveryLab extends Plugin {
  private root='';private access?:ThreadAccess;private device?:DeviceResponseManager;
  private timer?:number;private threadId?:string;private errors:string[]=[];
  private trace:Array<{event:string;fields:unknown}>=[];
  async onload(){
    this.root=path.dirname((this.app.vault.adapter as any).getFullPath(''));
    if(!fs.existsSync(path.join(this.root,'ISOLATED-NATIVE-LAB')))throw Error('Isolated vault required.');
    this.app.workspace.onLayoutReady(()=>void this.run().catch(error=>this.write('ERROR.json',{error:String(error),stack:error.stack})).finally(()=>this.cleanup()));
  }
  private write(name:string,value:unknown){fs.writeFileSync(path.join(this.root,name),JSON.stringify(value,null,2));}
  private async until(check:()=>boolean|Promise<boolean>,label:string,timeout=120_000){const end=Date.now()+timeout;do{if(await check())return;await pause(100);}while(Date.now()<end);throw Error('Timed out: '+label);}
  private check(value:unknown,label:string):asserts value {if(!value)throw Error(label);}
  private async shot(name:string){fs.writeFileSync(path.join(this.root,name),(await require('@electron/remote').getCurrentWebContents().capturePage()).toPNG());}
  private async run(){
    const config=JSON.parse(fs.readFileSync(path.join(this.root,'TEST-CONFIG.json'),'utf8')),connection=await desktopDefaults();
    this.access=await desktopThreadAccess(connection);
    const project=readWireShell(await this.access.api('/api/orchestration/shell')).projects.find(item=>item.id===config.projectId);
    this.check(project?.workspaceRoot===path.join(this.root,'workspace'),'Dedicated synthetic project required.');
    const environmentId=await desktopEnvironment(connection),seed=crypto.randomUUID(),native=nativeResponses(this.app),notes=deviceNoteIO(this.app);
    this.threadId=uuid5(seed,'thread');this.write('TEMPORARY.json',{threadIds:[this.threadId],notePaths:['Original.md','Copy.md']});
    const subject:any=new SendToT3(this.app,this.manifest);
    subject.settings={vaultId:'conflict-lab-'+crypto.randomUUID(),responseBindings:{},noteThreads:[],smartSend:undefined};subject.deviceId='conflict-lab';subject.responseBindingReplica={};subject.save=async()=>this.saveData(subject.settings);
    configureDiagnostics({accepts:()=>true,record:((event:string,fields:unknown)=>{this.trace.push({event,fields:redact(fields)});if(this.trace.length>1000)this.trace.shift();}) as any});
    this.registerEditorExtension(hiddenInlineMarkerExtension());
    this.registerEditorExtension(require('@codemirror/state').EditorState.transactionFilter.of((transaction:any)=>native.filter(transaction)));
    this.register(installResponsePresentation(document,setIcon));
    const requests:ResponseRequest[]=Array.from({length:12},()=>({version:4,localOnly:true,nativeProjection:true,responseContainer:true,independent:true,id:crypto.randomUUID(),initialOwner:crypto.randomUUID(),vaultId:subject.settings.vaultId,notePath:'Original.md',host:{environmentId,workspaceRoot:project!.workspaceRoot,directory:'.obsidian/t3-code/inline/v1'},threadId:this.threadId!,messageId:uuid5(seed,'message'),projectId:project!.id,threadEnvironmentId:environmentId,initialHash:contentHash(''),createdAt:new Date().toISOString()}));
    const initial='# Original\n\nOrdinary text.\n\n'+requests.map(request=>responseAnchor(request.id)).join('\n\n')+'\n';
    const original=await this.app.vault.create('Original.md',initial),leaf=this.app.workspace.getLeaf(false);await leaf.openFile(original);
    let ready=false,finalWrites=0;
    const receipts=new Map<string,{identity:string;saved:boolean}>(),finalNotes=deviceFinalNoteIO(this.app,()=>true);
    const io:DeviceResponseIO={...notes,
      localFinalNotes:{read:finalNotes.read,compareAndSet:async(...args)=>{const result=await finalNotes.compareAndSet(...args);if(result)finalWrites++;return result;}},
      localBindings:()=>responseBindingRequests(subject.settings.responseBindings),
      saveLocalBinding:async request=>{subject.settings.responseBindings=updateResponseBindingData(subject.settings.responseBindings,request,'lab');await subject.save();},
      loadLocalCompletion:async request=>{const receipt=receipts.get(request.id);return receipt?.identity===localFinalIdentity(request)?receipt:undefined;},
      retainLocalCompletion:async(request,saved,update)=>{receipts.set(request.id,{identity:localFinalIdentity(request),saved});if(saved&&update?.turnId)subject.settings.responseBindings=completeResponseBinding(subject.settings.responseBindings,request,update.turnId,contentHash(update.body),'lab');},
      knownCompleted:request=>!!subject.settings.responseBindings[request.id]?.completion,
      openedNotes:()=>this.app.workspace.getLeavesOfType('markdown').map(item=>item.view as MarkdownView).filter(item=>item.file).map(item=>({path:item.file!.path,document:native.view(item)?.recoveryDocument()??item.getViewData()})),
      syncReady:()=>ready,receiveCoordinated:record=>native.receive(record),receiveDirect:update=>native.stream(update),localCompleted:(id,note)=>native.localCompleted(id,note),completionFailed:error=>this.errors.push(String(error)),access:async()=>({...this.access!,close:undefined}),
    };
    this.device=new DeviceResponseManager('conflict-lab',subject.settings.vaultId,io);
    this.timer=window.setInterval(()=>{native.refresh();this.device?.tick();},150);
    for(const request of requests)await this.device.register(request);
    await this.until(()=>this.device?.health()?.readers===12,'twelve shared readers');
    const beforeCopy=this.device.health();this.check(beforeCopy?.sources===1,'Attachments opened several sources.');
    const copy=await this.app.vault.create('Copy.md',initial);await leaf.openFile(copy);this.device.resume();await pause(200);
    this.check(requests.every(request=>this.device!.localResponse(request.id)?.record.request.notePath==='Original.md'),'Opening a copied anchor changed routing.');
    const api=(route:string,payload?:any)=>this.access!.api(route.startsWith('/api/')?route:'/api/orchestration/'+route,payload);
    await start(api,{requestId:seed,project:project!.id,title:'Synthetic conflict recovery verification',prompt:'Write exactly 20 numbered lines. Each line must say "Native stream delivery verified" after its number. Do not use tools, inspect files, or change files. This is a bounded synthetic test.'},path.join(this.root,'t3-state'),item=>readNewThreadDefaults(api,this.access!.origin,item));
    await leaf.openFile(original);const secondLeaf=this.app.workspace.getLeaf('split');await secondLeaf.openFile(original);native.refresh();await pause(100);
    const first=leaf.view as MarkdownView,second=secondLeaf.view as MarkdownView;
    first.editor.replaceRange('User prefix.\n',first.editor.offsetToPos(0));second.editor.replaceRange('\nUser suffix.',second.editor.offsetToPos(second.editor.getValue().length));
    if(config.taskFlow){const flow=(this.app as any).plugins.plugins['task-flow'];this.check(flow,'Task Flow test candidate is not loaded.');let transformed=false;await flow.editFile(original,()=>{transformed=true;return '';});this.check(!transformed,'Task Flow replaced divergent native panes.');}
    await this.until(()=>requests.every(request=>this.device!.responseStatus(request.id)?.runTerminal),'verified terminal response');
    this.check(this.device.health()?.sources===0,'Terminal responses retained a live source.');
    ready=true;this.device.resume();
    await this.until(()=>requests.every(request=>this.device!.responseStatus(request.id)?.finalSaved),'one checked batch save');
    const saved=await this.app.vault.read(original);
    this.check(saved.includes('User prefix.')&&saved.includes('User suffix.'),'Compatible pane edits were lost.');
    this.check(finalWrites===1,'Final responses used several note writes.');
    this.check(await this.app.vault.read(copy)===initial,'The copied note was modified.');
    this.check(!saved.includes(':::send-to-t3-response'),'A final response anchor survived saving.');
    await this.until(()=>first.contentEl.innerText.includes('Native stream delivery verified'),'native final output');
    await subject.ensureNoteIdentity(original.path);this.check(!/t3-note-id|^t3[-_]note[-_]id:/m.test(await this.app.vault.read(original)),'New identity was written into note content.');
    const sourcesStarted=new Set(this.trace.filter(item=>item.event==='stream.connecting'&&(item.fields as any)?.role==='shared-response').map(item=>(item.fields as any).monitorId)).size;
    this.check(sourcesStarted===1,'The native test opened duplicate live watchers.');
    await this.shot('native-checked-save.png');fs.writeFileSync(path.join(this.root,'SAVED-NOTE.md'),saved);
    this.device.dispose();this.device=new DeviceResponseManager('conflict-lab',subject.settings.vaultId,io);
    native.refresh();this.device.resume();await pause(200);
    this.check(this.device.health()?.sources===0,'Reload watched stale copied anchors.');
    this.write('RESULT.json',{ok:true,checks:{taskFlowDeferred:!!config.taskFlow,realT3Delivery:true,twelveAttachmentsOneSource:true,copiedAnchorsInert:true,closedOriginalRetainsDestination:true,terminalSourcesRetired:true,compatiblePaneEditsPreserved:true,twelveFinalsOneCheckedWrite:true,registryOnlyIdentity:true,reloadHasNoHistoricalWatch:true},beforeCopy,after:this.device.health(),sourcesStarted,finalWrites,errors:this.errors,coverage:'Native Obsidian desktop and one bounded real T3 run in an isolated vault. Uses two native panes and a copied file; no real Sync transport or native mobile coverage.'});
  }
  private async cleanup(){
    if(this.timer!==undefined)window.clearInterval(this.timer);this.device?.dispose();configureDiagnostics();
    const remainingThreadIds:string[]=[];
    try{if(this.threadId&&this.access){
      const snapshot=readMetadataSnapshot(await this.access.api('/api/orchestration/threads/'+this.threadId+'?controlOnly=true'));
      for(const turn of Object.values(snapshot.thread.turns??{}) as any[])if(turn.state==='running')await this.access.api('/api/orchestration/dispatch',{type:'thread.turn.interrupt',commandId:crypto.randomUUID(),threadId:this.threadId,turnId:turn.turnId,createdAt:new Date().toISOString()});
      await this.access.api('/api/orchestration/dispatch',{type:'thread.delete',commandId:crypto.randomUUID(),threadId:this.threadId});
      try{if(!(readMetadataSnapshot(await this.access.api('/api/orchestration/threads/'+this.threadId+'?controlOnly=true'))).thread.deletedAt)remainingThreadIds.push(this.threadId);}catch(error){if((error as any)?.status!==404)remainingThreadIds.push(this.threadId);}
    }}catch(error){this.errors.push(String(error));if(this.threadId)remainingThreadIds.push(this.threadId);}
    await this.access?.close?.();for(const leaf of this.app.workspace.getLeavesOfType('markdown'))leaf.detach();for(const file of this.app.vault.getMarkdownFiles())await this.app.vault.delete(file);
    nativeResponses(this.app).dispose();this.write('TRACE.json',this.trace);this.write('CLEANUP.json',{remainingThreadIds,remainingNotes:this.app.vault.getMarkdownFiles().map(file=>file.path),errors:this.errors});await pause(200);require('@electron/remote').app.quit();
  }
}
