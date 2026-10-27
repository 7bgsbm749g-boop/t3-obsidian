import {Plugin,MarkdownView,setIcon} from 'obsidian';
import {nativeResponses} from '../native-response-manager';
import {deviceNoteIO,deviceFinalNoteIO} from '../inline-note-io';
import {hiddenInlineMarkerExtension} from '../inline-markers';
import {installResponsePresentation} from '../response-presentation';
import {LocalResponseManager} from '../local-response-manager';
import {responseBindingRequests,updateResponseBindingData} from '../response-binding-data';
import {desktopDefaults,desktopEnvironment,desktopThreadAccess,start,uuid5} from '../desktop';
import {readNewThreadDefaults} from '../model-defaults';
import {applyThreadItem} from '../inline-thread';
import {responseAnchor} from '../native-response-projection';
import {contentHash} from '../completion';
import type {ResponseRequest} from '../response-model';
import type {ThreadAccess} from '../thread-stream';
const fs=require('node:fs'),path=require('node:path');
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

/** One bounded real steer in a private native test vault. No production
 * settings or notes are copied; every temporary note and thread is deleted. */
export default class SteeringConsumptionLab extends Plugin {
  private root='';private access?:ThreadAccess;private threadId?:string;
  private local?:LocalResponseManager;private timer?:number;private errors:string[]=[];
  async onload(){
    this.root=path.dirname((this.app.vault.adapter as any).getFullPath(''));
    if(!fs.existsSync(path.join(this.root,'ISOLATED-NATIVE-LAB')))throw Error('An isolated test vault is required.');
    const native=nativeResponses(this.app);this.register(()=>native.dispose());
    this.registerEditorExtension(hiddenInlineMarkerExtension());
    const {EditorState}=require('@codemirror/state');this.registerEditorExtension(EditorState.transactionFilter.of((transaction:any)=>native.filter(transaction)));
    this.register(installResponsePresentation(document,setIcon));
    this.app.workspace.onLayoutReady(()=>void this.run().catch(error=>this.write('ERROR.json',{error:String(error),stack:error.stack})).finally(()=>this.cleanup()));
  }
  private write(name:string,value:any){fs.writeFileSync(path.join(this.root,name),JSON.stringify(value,null,2));}
  private async until(check:()=>Promise<boolean>|boolean,label:string,timeout=120_000){const deadline=Date.now()+timeout;do{if(await check())return;await pause(100);}while(Date.now()<deadline);throw Error('Timed out: '+label);}
  private async capture(name:string){await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));fs.writeFileSync(path.join(this.root,name),(await require('@electron/remote').getCurrentWebContents().capturePage()).toPNG());}
  private async run(){
    const connection=desktopDefaults(),environmentId=await desktopEnvironment(connection);this.access=await desktopThreadAccess(connection);
    const api=(route:string,payload?:any)=>this.access!.api(route.startsWith('/api/')?route:'/api/orchestration/'+route,payload);
    const project=(await api('shell')).projects.find((item:any)=>item.workspaceRoot==='/home/ubuntu/projects/send-to-t3-code');if(!project)throw Error('The plugin project is unavailable.');
    const requestId=crypto.randomUUID(),messageId=uuid5(requestId,'message'),id=crypto.randomUUID(),text='STEER_MOVE_CONFIRMED: Keep the final answer brief.';
    this.threadId=uuid5(requestId,'thread');this.write('TEMPORARY-T3.json',{threadId:this.threadId,notePath:'Steering removal.md',requestId});
    const native=nativeResponses(this.app),notes=deviceNoteIO(this.app);let records:any={};
    this.local=new LocalResponseManager('steering-lab','synthetic-steering-vault',{
      ...notes,localBindings:()=>responseBindingRequests(records),saveLocalBinding:async request=>{records=updateResponseBindingData(records,request,'lab');},
      openedNotes:()=>this.app.workspace.getLeavesOfType('markdown').map(leaf=>leaf.view as MarkdownView).filter(view=>view.file).map(view=>({path:view.file!.path,document:native.view(view)?.recoveryDocument()??view.getViewData()})),syncReady:()=>true,
      receiveCoordinated:record=>native.receive(record),receiveDirect:update=>native.stream(update),localCompleted:(key,note)=>native.localCompleted(key,note),completionFailed:error=>this.errors.push(String(error)),access:()=>desktopThreadAccess(connection),
    },deviceFinalNoteIO(this.app,()=>true));
    this.timer=window.setInterval(()=>{native.refresh();this.local?.tick();},100);
    const original='# Steering removal\n\nKeep this note text.\n\n'+responseAnchor(id)+'\n\n'+text+'\n\nKeep the note tail.\n';
    const file=await this.app.vault.create('Steering removal.md',original),leaf=this.app.workspace.getLeaf(false);await leaf.openFile(file);await leaf.setViewState({type:'markdown',state:{file:file.path,mode:'source',source:false}});
    const binding:ResponseRequest={version:4,localOnly:true,nativeProjection:true,responseContainer:true,independent:true,id,initialOwner:crypto.randomUUID(),vaultId:'synthetic-steering-vault',host:{environmentId,workspaceRoot:project.workspaceRoot,directory:'.obsidian/t3-code/inline/v1'},notePath:file.path,threadId:this.threadId,messageId,projectId:project.id,threadEnvironmentId:environmentId,initialHash:contentHash(''),createdAt:new Date().toISOString(),intermediateMode:'collapse',threadTitle:'Steering removal test'};
    await this.local.register(binding);
    await start(api,{requestId,project:project.id,title:'Synthetic steering removal '+requestId.slice(0,8),prompt:'This is a bounded synthetic plugin test. Do not inspect or edit files, delegate, create tasks, or use tools except one shell sleep. First send the commentary STEER_BASE_READY. Then run sleep 90 with exec_command and yield_time_ms 1000, and wait for it to finish. Accept incoming steering during that wait. After the wait, reply STEER_FINAL_OK and acknowledge the incoming STEER_MOVE_CONFIRMED instruction.'},path.join(this.root,'t3-state'),item=>readNewThreadDefaults(this.access!.api,this.access!.origin,item));
    const view=leaf.view as MarkdownView;
    await this.until(()=>view.editor.getValue().includes('STEER_BASE_READY'),'initial real commentary');
    const adapter=native.view(view)!,document=adapter.canonicalDisplayed(),from=document.indexOf(text),selection=adapter.sourceSelections(document,[[from,from+text.length]])[0],steerRequest=crypto.randomUUID(),steerId=uuid5(steerRequest,'message');
    await this.local.steer(id,{messageId:steerId,text,selection,sourceResponseId:id});
    await this.capture('before-confirmation.png');
    if(!adapter.saved().includes(text))throw Error('An unconfirmed steer removed its source.');
    await start(api,{requestId:steerRequest,project:project.id,threadId:this.threadId,title:'Steering removal test',prompt:text},path.join(this.root,'t3-state'));
    await this.until(async()=>!adapter.saved().includes(text)&&!(await this.app.vault.read(file)).includes(text)&&view.editor.getValue().includes('[!t3-steering] You'),'confirmed source removal and native save');
    const state=applyThreadItem({messages:[],activities:[]},{kind:'snapshot',snapshot:await api('threads/'+this.threadId)}).state;
    const saved=await this.app.vault.read(file),display=adapter.canonicalDisplayed(),checks={sourceRemovedWhileRunning:Object.values(state.turns??{}).some(turn=>turn.state==='running'),exactInputPresent:state.messages.some(message=>message.id===steerId&&message.text.includes(text)),sourceAbsentOnDisk:!saved.includes(text),oneVisibleCopy:display.split(text).length-1===1,youQuoteVisible:view.contentEl.innerText.includes(text),ordinaryTextPreserved:saved.includes('Keep this note text.')&&saved.includes('Keep the note tail.'),noConflict:!adapter.conflictRecord(),noErrors:this.errors.length===0};
    this.write('RESULT.json',{checks,bindingId:id,threadId:this.threadId,messageId:steerId,saved,display,errors:this.errors,coverage:'Real T3 steering confirmation, native Obsidian rendering and native autosave in a separate unsynced test vault. Unit checks cover delayed saved-source restoration and reload recovery. No real remote Sync or native mobile coverage.'});
    await this.capture('confirmed-steer.png');if(Object.values(checks).some(pass=>!pass))throw Error('The steering checks failed.');
  }
  private async cleanup(){
    if(this.timer!==undefined)window.clearInterval(this.timer);this.local?.dispose();const remainingThreadIds:string[]=[];
    try{if(this.threadId&&this.access){
      const state=applyThreadItem({messages:[],activities:[]},{kind:'snapshot',snapshot:await this.access.api('/api/orchestration/threads/'+this.threadId+'?controlOnly=true')}).state;
      for(const turn of Object.values(state.turns??{})){
        if(turn.state==='running')await this.access.api('/api/orchestration/dispatch',{type:'thread.turn.interrupt',commandId:crypto.randomUUID(),threadId:this.threadId,turnId:turn.turnId,createdAt:new Date().toISOString()});
        if(turn.state==='queued')await this.access.api('/api/orchestration/dispatch',{type:'queued-run.cancel',commandId:crypto.randomUUID(),threadId:this.threadId,runId:turn.turnId});
      }
      await this.access.api('/api/orchestration/dispatch',{type:'thread.delete',commandId:crypto.randomUUID(),threadId:this.threadId});
      let deleted=false;try{deleted=!!(await this.access.api('/api/orchestration/threads/'+this.threadId+'?controlOnly=true')).thread.deletedAt;}catch(error){deleted=(error as any)?.status===404;}if(!deleted)remainingThreadIds.push(this.threadId);
    }}catch(error){this.errors.push('Thread cleanup: '+String(error));if(this.threadId)remainingThreadIds.push(this.threadId);}
    await this.access?.close?.();for(const leaf of this.app.workspace.getLeavesOfType('markdown'))leaf.detach();for(const file of this.app.vault.getMarkdownFiles())await this.app.vault.delete(file);
    this.write('CLEANUP.json',{temporaryThreadIds:this.threadId?[this.threadId]:[],remainingThreadIds,remainingNotes:this.app.vault.getMarkdownFiles().map(file=>file.path),errors:this.errors});
    await pause(250);require('@electron/remote').app.quit();
  }
}
