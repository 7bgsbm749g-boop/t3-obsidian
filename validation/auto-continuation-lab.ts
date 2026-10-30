import {Plugin,MarkdownView,setIcon} from 'obsidian';
import {nativeResponses} from '../native-response-manager';
import {deviceNoteIO,deviceFinalNoteIO} from '../inline-note-io';
import {hiddenInlineMarkerExtension} from '../inline-markers';
import {installResponsePresentation} from '../response-presentation';
import {LocalResponseManager} from '../local-response-manager';
import {DirectInlinePreview} from '../direct-inline-preview';
import {responseBindingRequests,updateResponseBindingData} from '../response-binding-data';
import {desktopDefaults,desktopEnvironment,desktopThreadAccess,start,uuid5} from '../desktop';
import {readNewThreadDefaults} from '../model-defaults';
import {ensureNoProject} from '../no-project';
import {applyThreadItem} from '../inline-thread';
import {responseAnchor} from '../native-response-projection';
import {contentHash} from '../completion';
import {watchThread,type ThreadAccess,type ThreadStreamItem} from '../thread-stream';
import type {ResponseRequest} from '../response-model';
const fs=require('node:fs'),path=require('node:path');
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

/** Real user continuation, with the earlier failure replayed only in this
 * isolated reader. No source run or other server record is altered. */
export default class AutoContinuationLab extends Plugin {
 private root='';private access?:ThreadAccess;private threadId?:string;private sourceId?:string;
 private local?:LocalResponseManager;private timer?:number;private errors:string[]=[];
 async onload(){
  this.root=path.dirname((this.app.vault.adapter as any).getFullPath(''));
  if(!fs.existsSync(path.join(this.root,'ISOLATED-NATIVE-LAB')))throw Error('Isolated lab required.');
  const native=nativeResponses(this.app);this.register(()=>native.dispose());this.registerEditorExtension(hiddenInlineMarkerExtension());
  const {EditorState}=require('@codemirror/state');this.registerEditorExtension(EditorState.transactionFilter.of((tr:any)=>native.filter(tr)));
  this.register(installResponsePresentation(document,setIcon));
  this.app.workspace.onLayoutReady(()=>void this.run().catch(error=>this.write('ERROR.json',{message:String(error),kind:error.kind,rpcMethod:error.rpcMethod,route:error.route,stack:error.stack})).finally(()=>this.cleanup()));
 }
 private write(name:string,value:unknown){fs.writeFileSync(path.join(this.root,name),JSON.stringify(value,null,2));}
 private async until(check:()=>Promise<boolean>|boolean,label:string,timeout=120_000){const end=Date.now()+timeout;do{if(await check())return;await pause(150);}while(Date.now()<end);throw Error('Timed out: '+label);}
 private failedSource(snapshot:any){
  if(!snapshot?.thread||!this.sourceId)return snapshot;
  const thread=snapshot.thread,source=thread.turns?.[this.sourceId]??(thread.latestTurn?.turnId===this.sourceId?thread.latestTurn:undefined);if(!source)return snapshot;
  const failed={...source,state:'error'},latest=thread.latestTurn?.turnId===this.sourceId;
  return {...snapshot,thread:{...thread,turns:{...thread.turns,[this.sourceId]:failed},...(latest?{latestTurn:failed,session:{...thread.session,status:'error',activeTurnId:null,lastError:'Synthetic provider failure.'}}:{}),activities:[...(thread.activities??[]).filter((item:any)=>item.id!=='lab-source-failure'),{id:'lab-source-failure',kind:'response.notification',turnId:this.sourceId,createdAt:source.completedAt,summary:'Provider error',payload:{error:true,text:'Synthetic provider failure.'}}]}};
 }
 private replay(item:ThreadStreamItem):ThreadStreamItem {
  if(item.kind==='snapshot')return {...item,snapshot:this.failedSource(item.snapshot)};
  if(item.kind==='event'&&item.event.type==='thread.run-updated'&&item.event.payload?.id===this.sourceId)return {...item,event:{...item.event,payload:{...item.event.payload,status:'failed'}}};
  return item;
 }
 private async reader():Promise<ThreadAccess>{const access=await desktopThreadAccess(desktopDefaults());return {...access,api:async(route,payload)=>this.failedSource(await access.api(route,payload))};}
 private async run(){
  const connection=desktopDefaults(),environmentId=await desktopEnvironment(connection);this.access=await desktopThreadAccess(connection);
  const api=async(route:string,payload?:any)=>{try{return await this.access!.api(route.startsWith('/api/')?route:'/api/orchestration/'+route,payload);}catch(error){throw Object.assign(error as Error,{route});}},project=await ensureNoProject(this.access.api);
  const requestId=crypto.randomUUID(),messageId=uuid5(requestId,'message'),id=crypto.randomUUID(),note='Auto continuation.md';this.threadId=uuid5(requestId,'thread');
  this.write('TEMPORARY-T3.json',{threadId:this.threadId,requestId,messageId,notePath:note});
  await start(api,{requestId,project:project.id,title:'Synthetic automatic continuation '+requestId.slice(0,8),prompt:'This is a bounded synthetic plugin test. Do not use tools, inspect files, edit files or delegate. Reply exactly SOURCE_PROGRESS_OK.'},path.join(this.root,'t3-state'),item=>readNewThreadDefaults(this.access!.api,this.access!.origin,item));
  let original:any;const readErrors:any[]=[];
  await this.until(async()=>{try{original=await api('threads/'+this.threadId);}catch(error){readErrors.push({message:String(error),kind:(error as any).kind,method:(error as any).rpcMethod});this.write('READ-ERRORS.json',readErrors);if(readErrors.length>10)throw error;return false;}const state=applyThreadItem({messages:[],activities:[]},{kind:'snapshot',snapshot:original}).state;const source=Object.values(state.turns??{}).find(turn=>turn.messageId===messageId);if(source&&['completed','error'].includes(source.state)&&source.completedAt){this.sourceId=source.turnId;return true;}return false;},'source run terminal');
  this.write('ORIGINAL-CANONICAL.json',original);this.write('FAILED-READER-PROJECTION.json',this.failedSource(original));
  const native=nativeResponses(this.app),notes=deviceNoteIO(this.app);let records:any={};const trace:any[]=[],recordTrace=(row:any)=>{trace.push({at:new Date().toISOString(),...row});if(trace.length>80)trace.shift();this.write('TRACE.json',trace);};const finalNotes=deviceFinalNoteIO(this.app,()=>true);
  this.local=new LocalResponseManager('auto-continuation-lab','synthetic-auto-continuation',{
   ...notes,localBindings:()=>responseBindingRequests(records),saveLocalBinding:async request=>{records=updateResponseBindingData(records,request,'lab');},
   openedNotes:()=>this.app.workspace.getLeavesOfType('markdown').map(leaf=>leaf.view as MarkdownView).filter(view=>view.file).map(view=>({path:view.file!.path,document:native.view(view)?.recoveryDocument()??view.getViewData()})),syncReady:()=>true,
   receiveCoordinated:record=>native.receive(record),receiveDirect:update=>{recordTrace({kind:'display',turnId:update.turnId,phase:update.phase,verified:update.completionVerified,body:update.body});native.stream(update);},localCompleted:(key,target)=>native.localCompleted(key,target),completionFailed:error=>this.errors.push(String(error)),access:()=>this.reader(),
  },{read:async target=>{const text=await finalNotes.read(target);recordTrace({kind:'read',text});return text;},compareAndSet:async(target,before,after,guard)=>{recordTrace({kind:'compare',before,after,guard:guard?.()});const saved=await finalNotes.compareAndSet(target,before,after,guard);recordTrace({kind:'compared',saved,text:await finalNotes.read(target)});return saved;}},Date.now,(record,access,receive,changed)=>new DirectInlinePreview(record,access,receive,(thread,factory,callbacks,...rest)=>watchThread(thread,factory,{...callbacks,item:item=>callbacks.item(this.replay(item))},...rest),undefined,changed));
  this.timer=window.setInterval(()=>{native.refresh();this.local?.tick();},100);
  const file=await this.app.vault.create(note,'# Automatic continuation\n\nUser text.\n\n'+responseAnchor(id)+'\n\nUser tail.\n'),leaf=this.app.workspace.getLeaf(false);await leaf.openFile(file);
  const binding:ResponseRequest={version:4,localOnly:true,nativeProjection:true,responseContainer:true,id,initialOwner:crypto.randomUUID(),vaultId:'synthetic-auto-continuation',host:{environmentId,workspaceRoot:(this.app.vault.adapter as any).getFullPath(''),directory:'.obsidian/t3-code/inline/v1'},notePath:note,threadId:this.threadId,messageId,projectId:project.id,threadEnvironmentId:environmentId,initialHash:contentHash(''),createdAt:new Date().toISOString(),intermediateMode:'collapse',threadTitle:'Automatic continuation'};
  await this.local.register(binding);await this.until(()=>this.local!.record(id)?.state?.status==='error','failed response displayed');
  const before=await this.app.vault.read(file),followMessage=crypto.randomUUID();
  // The same native user dispatch used by T3's composer, with no Obsidian
  // follow/attach call and no new response registration.
  await api('dispatch',{type:'thread.turn.start',commandId:crypto.randomUUID(),threadId:this.threadId,message:{messageId:followMessage,role:'user',text:'Continue the same task. Do not use tools or change files. Reply exactly AUTO_CONTINUATION_LIVE_OK.',attachments:[],createdBy:'user',creationSource:'web'},runtimeMode:original.thread.runtimeMode??original.thread.session?.runtimeMode??'approval-required',interactionMode:original.thread.interactionMode??'default',createdAt:new Date().toISOString()});
  const finalSave=await this.local.waitForSave(id,120_000);if(!finalSave.saved){this.write('SAVE-FAILURE.json',{finalSave,record:this.local.record(id),disk:await this.app.vault.read(file),editor:(leaf.view as MarkdownView).editor.getValue(),recovery:native.view(leaf.view as MarkdownView)?.recoveryDocument()});throw Error('Continuation final save: '+finalSave.reason);}
  const snapshot=await api('threads/'+this.threadId),state=applyThreadItem({messages:[],activities:[]},{kind:'snapshot',snapshot}).state,saved=await this.app.vault.read(file);
  await this.until(()=>(leaf.view as MarkdownView).editor.getValue().includes('AUTO_CONTINUATION_LIVE_OK'),'visible saved reply');
  const record=this.local.record(id),next=Object.values(state.turns??{}).find(turn=>turn.messageId===followMessage);
  const checks={realContinuation:!!next&&next.state==='completed',automaticLink:record?.state?.turnId===next?.turnId&&record?.state?.turnIds?.includes(this.sourceId!)===true,
   originalBindingKept:this.local.request(id)?.messageId===messageId&&!this.local.request(id)?.localMessageId,sourceOutputKept:saved.includes('SOURCE_PROGRESS_OK'),historyOrdered:saved.indexOf('SOURCE_PROGRESS_OK')<saved.indexOf('Continue the same task.'),singleErrorRow:saved.split('Synthetic provider failure.').length===2,userInputShown:saved.includes('Continue the same task.'),finalSaved:saved.includes('AUTO_CONTINUATION_LIVE_OK'),userTextKept:saved.includes('User text.')&&saved.includes('User tail.'),singleResponse:saved.split('> AUTO_CONTINUATION_LIVE_OK').length===2,noteAnchorRemoved:!saved.includes(':::send-to-t3-response'),noEarlySave:before.includes(':::send-to-t3-response'),noErrors:this.errors.length===0};
  this.write('CANONICAL.json',snapshot);this.write('saved-note.md.json',{saved});this.write('RESULT.json',{pass:Object.values(checks).every(Boolean),checks,threadId:this.threadId,sourceRunId:this.sourceId,continuationRunId:next?.turnId,followMessage,finalSave,errors:this.errors,coverage:'Real T3 user dispatch, exact final-item verification and native Obsidian editor/file save. Source failure is replayed only in this isolated reader; server records unchanged. No Sync or native mobile coverage.'});
  (leaf.view as MarkdownView).contentEl.querySelector<HTMLElement>('.callout[data-callout="t3-progress"].is-collapsed > .callout-title')?.click();await pause(150);
  fs.writeFileSync(path.join(this.root,'automatic-continuation.png'),(await require('@electron/remote').getCurrentWebContents().capturePage()).toPNG());
  if(Object.values(checks).some(pass=>!pass))throw Error('Automatic continuation checks failed.');
  await this.until(()=>fs.existsSync(path.join(this.root,'finish-test.json')),'external visual inspection',90_000);
 }
 private async cleanup(){
  if(this.timer!==undefined)window.clearInterval(this.timer);this.local?.dispose();const remainingThreadIds:string[]=[];
  try{if(this.threadId&&this.access){
   const state=applyThreadItem({messages:[],activities:[]},{kind:'snapshot',snapshot:await this.access.api('/api/orchestration/threads/'+this.threadId+'?controlOnly=true')}).state;
   for(const turn of Object.values(state.turns??{})){if(turn.state==='running')await this.access.api('/api/orchestration/dispatch',{type:'thread.turn.interrupt',commandId:crypto.randomUUID(),threadId:this.threadId,turnId:turn.turnId,createdAt:new Date().toISOString()});if(turn.state==='queued')await this.access.api('/api/orchestration/dispatch',{type:'queued-run.cancel',commandId:crypto.randomUUID(),threadId:this.threadId,runId:turn.turnId});}
   await this.access.api('/api/orchestration/dispatch',{type:'thread.delete',commandId:crypto.randomUUID(),threadId:this.threadId});
   let deleted=false;try{deleted=!!(await this.access.api('/api/orchestration/threads/'+this.threadId+'?controlOnly=true')).thread.deletedAt;}catch(error){deleted=(error as any)?.status===404;}if(!deleted)remainingThreadIds.push(this.threadId);
  }}catch(error){this.errors.push('Thread cleanup: '+String(error));if(this.threadId)remainingThreadIds.push(this.threadId);}
  await this.access?.close?.();for(const leaf of this.app.workspace.getLeavesOfType('markdown'))leaf.detach();for(const file of this.app.vault.getMarkdownFiles())await this.app.vault.delete(file);
  this.write('CLEANUP.json',{temporaryThreadIds:this.threadId?[this.threadId]:[],remainingThreadIds,remainingNotes:this.app.vault.getMarkdownFiles().map(file=>file.path),errors:this.errors});
  await pause(250);require('@electron/remote').app.quit();
 }
}
