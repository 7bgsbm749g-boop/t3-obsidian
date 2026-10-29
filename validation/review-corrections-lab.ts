import {Plugin,MarkdownView,setIcon} from 'obsidian';
import {nativeResponses} from '../native-response-manager';
import {nativeStoppedStore} from '../native-stop-store';
import {deviceNoteIO,deviceFinalNoteIO} from '../inline-note-io';
import {hiddenInlineMarkerExtension} from '../inline-markers';
import {installResponsePresentation} from '../response-presentation';
import {LocalResponseManager} from '../local-response-manager';
import {responseBindingRequests,updateResponseBindingData} from '../response-binding-data';
import {desktopDefaults,desktopEnvironment,desktopThreadAccess,runDesktopWithAccess,uuid5} from '../desktop';
import {responseAnchor} from '../native-response-projection';
import {contentHash} from '../completion';
import {loadSmartSend,rememberResponse} from '../smart-send';
import {EventSubscriptions} from '../event-subscriptions';
import {projectEventNote} from '../event-note-projection';
import {AUTO_THREAD_TITLE} from '../thread-title';
import {CodebaseBridge} from '../codebase-native';
import type {ResponseRequest} from '../response-model';
import type {ThreadAccess} from '../thread-stream';
const fs=require('node:fs'),path=require('node:path');
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
class BridgeHost extends Plugin {async onload(){}}

/** Bounded real local delivery and native recovery checks in a private vault.
 * No notification is dispatched. Cleanup uses native thread and vault APIs. */
export default class ReviewCorrectionsLab extends Plugin {
  private root='';private access?:ThreadAccess;private threadId?:string;
  private local?:LocalResponseManager;private events?:EventSubscriptions;
  private timer?:number;private errors:string[]=[];private running=false;
  async onload(){
    this.root=path.dirname((this.app.vault.adapter as any).getFullPath(''));
    if(!fs.existsSync(path.join(this.root,'ISOLATED-NATIVE-LAB')))throw Error('An isolated test vault is required.');
    const native=nativeResponses(this.app);this.register(()=>native.dispose());
    this.registerEditorExtension(hiddenInlineMarkerExtension());
    const {EditorState}=require('@codemirror/state');this.registerEditorExtension(EditorState.transactionFilter.of((transaction:any)=>native.filter(transaction)));
    this.register(installResponsePresentation(document,setIcon));
    this.addCommand({id:'run-review-corrections',name:'Run review corrections checks',callback:()=>{
      if(this.running)return;this.running=true;void this.run().catch(error=>this.write('ERROR.json',{error:String(error),stack:error.stack}));
    }});
    this.addCommand({id:'cleanup-review-corrections',name:'Delete review test fixtures',callback:()=>void this.cleanup().catch(error=>this.write('CLEANUP-ERROR.json',{error:String(error)}))});
  }
  private write(name:string,value:unknown){fs.writeFileSync(path.join(this.root,name),JSON.stringify(value,null,2));}
  private async until(check:()=>Promise<boolean>|boolean,label:string,timeout=120_000){const deadline=Date.now()+timeout;do{if(await check())return;await pause(100);}while(Date.now()<deadline);throw Error('Timed out: '+label);}
  private async run(){
    const connection={...desktopDefaults(),stateDir:path.join(this.root,'t3-state')},environmentId=await desktopEnvironment(connection);
    this.access=await desktopThreadAccess(connection);
    const project=await runDesktopWithAccess(connection,['no-project'],'',this.access);
    const requestId=crypto.randomUUID(),id=crypto.randomUUID(),note='Review corrections.md',vaultId='synthetic-review-corrections';
    this.threadId=uuid5(requestId,'thread');this.write('TEMPORARY-T3.json',{threadId:this.threadId,notePath:note,requestId});
    const native=nativeResponses(this.app),notes=deviceNoteIO(this.app),smart=loadSmartSend(undefined);let bindings:any={};
    let issued=0,closed=0,provenance=0;
    this.local=new LocalResponseManager('review-corrections-lab',vaultId,{
      ...notes,localBindings:()=>responseBindingRequests(bindings),saveLocalBinding:async request=>{bindings=updateResponseBindingData(bindings,request,'lab');},
      openedNotes:()=>this.app.workspace.getLeavesOfType('markdown').map(leaf=>leaf.view as MarkdownView).filter(view=>view.file).map(view=>({path:view.file!.path,document:native.view(view)?.recoveryDocument()??view.getViewData()})),syncReady:()=>true,
      rememberResponse:async(request,body,before,after,offset)=>{await rememberResponse(smart,request.notePath,request.id,body,before,after,offset);provenance++;},
      receiveCoordinated:record=>native.receive(record),receiveDirect:update=>native.stream(update),localCompleted:(key,target)=>native.localCompleted(key,target),completionFailed:error=>this.errors.push(String(error)),
      access:async()=>{const access=await desktopThreadAccess(connection);issued++;let done=false;return {...access,close:async reason=>{if(done)return;done=true;await access.close?.(reason);closed++;}};},
    },deviceFinalNoteIO(this.app,()=>true));
    const initial='# Review corrections\n\nUser source.\n\n'+responseAnchor(id)+'\n\nUser tail.\n';
    const file=await this.app.vault.create(note,initial),leaf=this.app.workspace.getLeaf(false);await leaf.openFile(file);await leaf.setViewState({type:'markdown',state:{file:note,mode:'source',source:false}});
    const snapshot=async()=>({path:note,content:await this.app.vault.read(file),properties:{}});
    this.events=new EventSubscriptions({load:async()=>undefined,save:async()=>{},notes:async()=>[await snapshot()],projectNote:value=>projectEventNote(value,smart,responseBindingRequests(bindings)),validateTarget:async()=>{},isBusy:async()=>false,prepare:async()=>{throw Error('No external event work is allowed.');},deliver:async()=>{throw Error('No external event work is allowed.');},recording(){},now:Date.now,id:()=>crypto.randomUUID()});
    await this.events.initialize();await this.events.command({version:1,id:crypto.randomUUID(),kind:'subscribe',target:{threadId:'synthetic-unrelated-observer',projectId:project.id,environmentId},scope:{path:note,kind:'note',recursive:false},filter:{events:['modify']}});
    this.registerEvent(this.app.vault.on('modify',changed=>{if(changed.path===note)void snapshot().then(value=>this.events?.observe('modify',note,value)).catch(error=>this.errors.push(String(error)));}));
    const binding:ResponseRequest={version:4,localOnly:true,nativeProjection:true,responseContainer:true,independent:true,id,initialOwner:crypto.randomUUID(),vaultId,host:{environmentId,workspaceRoot:(this.app.vault.adapter as any).getFullPath(''),directory:'.obsidian/inline'},notePath:note,threadId:this.threadId,messageId:uuid5(requestId,'message'),projectId:project.id,threadEnvironmentId:environmentId,initialHash:contentHash(''),createdAt:new Date().toISOString(),intermediateMode:'collapse',threadTitle:AUTO_THREAD_TITLE};
    await this.local.register(binding);this.timer=window.setInterval(()=>{native.refresh();this.local?.tick();},100);
    const prompt='This is a bounded synthetic plugin release test. Do not use tools, inspect files, delegate, or change settings. Reply exactly REVIEW_CORRECTIONS_OK.';
    await runDesktopWithAccess(connection,['start','--project',project.id,'--title',AUTO_THREAD_TITLE,'--request-id',requestId,'--prompt-file','-'],prompt,this.access);
    await this.until(()=>this.local!.status(id)?.finalSaved===true,'native final save');
    await this.events.observe('modify',note,await snapshot());
    const silentFinal=this.events.snapshot.notifications.length===0,saved=await this.app.vault.read(file),view=leaf.view as MarkdownView;
    await this.until(()=>issued===closed,'completion access revocation');
    let title='';await this.until(async()=>{const state=await this.access!.api('/api/orchestration/threads/'+this.threadId+'?controlOnly=true');title=state.thread.title;return !!title&&title!==AUTO_THREAD_TITLE;},'automatic local title');
    view.editor.replaceRange('\nIndependent user edit.',view.editor.offsetToPos(view.editor.getValue().length));await view.save();await this.events.observe('modify',note,await snapshot());
    const userObserved=this.events.snapshot.notifications.length===1;
    const result:any={checks:{finalVisible:view.editor.getValue().includes('REVIEW_CORRECTIONS_OK'),finalSaved:saved.includes('REVIEW_CORRECTIONS_OK'),finalAnchorRemoved:!saved.includes(responseAnchor(id)),finalSaveSilent:silentFinal,userEditObserved:userObserved,provenanceSaved:provenance>0,completionAccessClosed:issued>0&&issued===closed,localAutomaticTitle:title!==AUTO_THREAD_TITLE},title,issued,closed,threadId:this.threadId};
    this.write('DELIVERY.json',result);this.events.stop();this.local.dispose();window.clearInterval(this.timer);this.timer=undefined;
    await this.storageChecks(result);
    result.checks.noErrors=this.errors.length===0;result.errors=this.errors;
    this.write('RESULT.json',result);fs.writeFileSync(path.join(this.root,'result.png'),(await require('@electron/remote').getCurrentWebContents().capturePage()).toPNG());
    if(Object.values(result.checks).some(pass=>!pass))throw Error('Review correction checks failed.');
  }
  private async storageChecks(result:any){
    const native=nativeResponses(this.app),store=nativeStoppedStore(crypto.randomUUID(),'synthetic-review-recovery'),id=crypto.randomUUID(),stop={id,path:'Frozen.md',body:'Frozen recovery text.\n'.repeat(4000),hidden:false};
    await store.write(stop);await native.configureStoppedStore(store);result.checks.closedHistoryNotLoaded=native.stoppedBody(id)===undefined;
    const file=await this.app.vault.create(stop.path,'# Frozen recovery\n\n'+responseAnchor(id)),leaf=this.app.workspace.getLeaf('tab');await leaf.openFile(file);native.refresh();await this.until(()=>native.stoppedBody(id)===stop.body,'selective native stopped-body restore');
    result.checks.openAnchorRestored=(leaf.view as MarkdownView).editor.getValue().includes('Frozen recovery text.');
    leaf.detach();native.refresh();result.checks.closedBodyReleased=native.stoppedBody(id)===undefined;
    await this.app.vault.delete(file);native.deleted(stop.path);result.checks.durableRecoveryPreserved=(await store.readAll([id]))[0].body===stop.body;
    const io={list:async()=>({entries:[],truncated:false}),search:async()=>[],read:async()=> 'Synthetic external file.',write:async()=>{},resource:async()=>{throw Error('No media in this fixture.');}};
    let stable:unknown;for(let cycle=0;cycle<3;cycle++){
      const host=new BridgeHost(this.app,{...this.manifest,id:'review-bridge-'+cycle}),bridge=new CodebaseBridge(this.app,host,io,()=>[],'review-reload',{environments:()=>['synthetic'],load:()=>undefined,save:async()=>{}});host.load();
      const registered=bridge.register({environmentId:'synthetic',projectId:'synthetic',root:'/synthetic',title:'Synthetic'},'sample.md');
      try{await bridge.install();await bridge.open(registered);const wrapper=this.app.vault.adapter.read;if(cycle&&wrapper!==stable)throw Error('Adapter wrappers grew on reload.');stable=wrapper;}
      finally{bridge.dispose();host.unload();}
      let blocked=false;try{await this.app.vault.adapter.write(registered.file.path,'Late unload save');}catch{blocked=true;}if(!blocked)throw Error('An unloaded bridge accepted a virtual write.');
    }
    result.checks.stableAdapterAcrossReloads=true;result.checks.physicalNoteReadable=(await this.app.vault.read(this.app.vault.getFileByPath('Review corrections.md')!)).includes('REVIEW_CORRECTIONS_OK');
    await this.app.workspace.getLeaf(false).openFile(this.app.vault.getFileByPath('Review corrections.md')!);
  }
  private async cleanup(){
    if(this.timer!==undefined)window.clearInterval(this.timer);this.events?.stop();this.local?.dispose();const remainingThreadIds:string[]=[];
    if(this.threadId&&this.access){
      const state=await this.access.api('/api/orchestration/threads/'+this.threadId+'?controlOnly=true');
      for(const turn of Object.values(state.thread.turns??{}) as any[])if(turn.state==='running')await this.access.api('/api/orchestration/dispatch',{type:'thread.turn.interrupt',commandId:crypto.randomUUID(),threadId:this.threadId,turnId:turn.turnId,createdAt:new Date().toISOString()});
      await this.access.api('/api/orchestration/dispatch',{type:'thread.delete',commandId:crypto.randomUUID(),threadId:this.threadId});
      try{if(!(await this.access.api('/api/orchestration/threads/'+this.threadId+'?controlOnly=true')).thread.deletedAt)remainingThreadIds.push(this.threadId);}catch(error){if((error as any)?.status!==404)throw error;}
    }
    await this.access?.close?.();for(const leaf of this.app.workspace.getLeavesOfType('markdown'))leaf.detach();for(const file of this.app.vault.getMarkdownFiles())await this.app.vault.delete(file);
    nativeResponses(this.app).dispose();this.write('CLEANUP.json',{temporaryThreadIds:this.threadId?[this.threadId]:[],remainingThreadIds,remainingNotes:this.app.vault.getMarkdownFiles().map(file=>file.path)});
  }
}
