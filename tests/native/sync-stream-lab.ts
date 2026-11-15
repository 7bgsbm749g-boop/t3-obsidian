import {Plugin,MarkdownView,setIcon,apiVersion} from 'obsidian';
import {LocalResponseManager} from '../../src/responses/local-response-manager';
import {SharedThreadStreams} from '../../src/conversations/shared-thread-stream';
import {deviceNoteIO,deviceFinalNoteIO} from '../../src/conversations/inline-note-io';
import {nativeResponses} from '../../src/responses/native-response-manager';
import {responseAnchor} from '../../src/responses/native-response-projection';
import {hiddenInlineMarkerExtension} from '../../src/conversations/inline-markers';
import {installResponsePresentation} from '../../src/responses/response-presentation';
import {updateResponseBindingData,responseBindingRequests} from '../../src/responses/response-binding-data';
import {contentHash} from '../../src/responses/completion';
import type {ResponseRequest} from '../../src/responses/response-model';
import type {ThreadSnapshot} from '../../src/connection/wire-types';
const fs=require('node:fs'),path=require('node:path');
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
export default class SyncStreamLab extends Plugin {
 async onload(){
  const runtime=path.dirname((this.app.vault.adapter as any).getFullPath('')),config=JSON.parse(fs.readFileSync(path.join(runtime,'REPORT.json'),'utf8'));
  const write=(name:string,value:unknown)=>fs.writeFileSync(path.join(config.evidence,name),JSON.stringify(value,null,2));
  this.app.workspace.onLayoutReady(()=>void this.run(config,write).catch(error=>write('ERROR.json',{error:String(error),stack:error.stack})).finally(async()=>{
   for(const leaf of this.app.workspace.getLeavesOfType('markdown')){await (leaf.view as MarkdownView).save();leaf.detach();}
   // Native constructor-bound autosaves can outlive a detached leaf. Let them
   // drain before deleting the fixture files, then verify again after deletion.
   await pause(1500);
   const notes=this.app.vault.getMarkdownFiles();for(const note of notes)await this.app.vault.delete(note);
   await pause(1000);
   write('CLEANUP.json',{remainingNotes:this.app.vault.getMarkdownFiles().map(file=>file.path),temporaryThreads:[],syntheticOnly:true});
   await pause(200);require('@electron/remote').app.quit();
  }));
 }
 private async run(config:any,write:(name:string,value:unknown)=>void){
  const native=nativeResponses(this.app);this.register(()=>native.dispose());
  this.registerEditorExtension(hiddenInlineMarkerExtension());const {EditorState}=require('@codemirror/state');
  this.registerEditorExtension(EditorState.transactionFilter.of((tr:any)=>native.filter(tr)));
  this.register(installResponsePresentation(document,setIcon));
  const results:unknown[]=[];
  for(const foreground of [true,false]){
   const id=crypto.randomUUID(),note=foreground?'Foreground.md':'Busy Sync.md',threadId=crypto.randomUUID(),messageId=crypto.randomUUID(),turnId='synthetic-turn',answer='Confirmed synthetic final answer.';
   const binding:ResponseRequest={version:4,initialOwner:crypto.randomUUID(),localOnly:true,nativeProjection:true,responseContainer:true,id,vaultId:'synthetic-native-vault',host:{environmentId:'synthetic-env',workspaceRoot:'/synthetic',directory:'.obsidian/t3-code/inline/v1'},notePath:note,threadId,messageId,projectId:'synthetic-project',threadEnvironmentId:'synthetic-env',initialHash:contentHash(''),createdAt:new Date().toISOString()};
   const snapshot=(complete:boolean,sequence:number):ThreadSnapshot=>({snapshotSequence:sequence,thread:{protocolVersion:2,id:threadId,projectId:binding.projectId,title:'Synthetic native check',turns:{[turnId]:{turnId,messageId,state:complete?'completed':'running',assistantMessageId:'answer',completedAt:complete?'2026-11-15T00:00:10Z':undefined}},latestTurn:{turnId,messageId,state:complete?'completed':'running',assistantMessageId:'answer'},session:{status:complete?'ready':'running',activeTurnId:complete?null:turnId},activities:[],messages:[{id:messageId,role:'user',turnId,text:'Synthetic prompt',streaming:false},{id:'answer',role:'assistant',turnId,itemId:'final-item',updatedAt:'2026-11-15T00:00:10Z',text:complete?answer:'Old progress',streaming:!complete}]}});
   const starts:any[]=[],calls:string[]=[],state:any={bindings:{},syncHintCalls:0,attempts:0,race:false};
   const access=async()=>({origin:'https://synthetic.invalid',api:async(route:string)=>{calls.push(route);return route==='/api/orchestration/turn-item'?{id:'final-item',threadId,runId:turnId,messageId:'answer',type:'assistant_message',text:answer,streaming:false,status:'completed',updatedAt:'2026-11-15T00:00:10Z'}:snapshot(true,3);}});
   const source=new SharedThreadStreams((_thread,_access,callbacks)=>{starts.push(callbacks);if(starts.length===1)queueMicrotask(()=>callbacks.item({kind:'snapshot',snapshot:snapshot(false,1)}));return {stop(){}};});
   const io=deviceFinalNoteIO(this.app,()=>true),file=await this.app.vault.create(note,`# Native check\n\nOrdinary original text.\n\n${responseAnchor(id)}\n\nUser tail.\n`);
   const leaf=this.app.workspace.getLeaf(false);await leaf.openFile(file);await leaf.setViewState({type:'markdown',state:{file:note,mode:'source',source:false}});
   const local=new LocalResponseManager('synthetic-native',binding.vaultId,{
    ...deviceNoteIO(this.app),localBindings:()=>responseBindingRequests(state.bindings),saveLocalBinding:async request=>{state.bindings=updateResponseBindingData(state.bindings,request,'synthetic');},
    openedNotes:()=>this.app.workspace.getLeavesOfType('markdown').map(leaf=>leaf.view as MarkdownView).filter(view=>view.file).map(view=>({path:view.file!.path,document:native.view(view)?.recoveryDocument()??view.getViewData()})),
    syncReady:()=>{state.syncHintCalls++;return false;},receiveCoordinated:record=>native.receive(record),receiveDirect:update=>native.stream(update),localCompleted:(id,target)=>native.localCompleted(id,target),access,
   },{...io,compareAndSet:async(target,before,after,guard)=>{
    (state.preparations??=[]).push({beforeTyping:before.includes('Local typing retained.'),afterTyping:after.includes('Local typing retained.'),viewTyping:native.view(leaf.view as MarkdownView)?.saved().includes('Local typing retained.')});state.attempts++;if(!state.race){state.race=true;await this.app.vault.process(file,value=>value.replace('Ordinary original text.','Incoming remote paragraph.'));}
    const result=await io.compareAndSet(target,before,after,guard);(state.mutations??=[]).push(result);return result;
   }});
   (local as any).sources=source;(this as any).activeCase={local,native,state,calls};
   const timer=window.setInterval(()=>{native.refresh();local.tick();},100);
   let releaseAutosave:(()=>void)|undefined;
   try{
    await local.register(binding);await pause(300);
    // Hold the real native autosave fence so this case tests unsaved typing,
    // not a deliberate remote deletion of text already acknowledged on disk.
    releaseAutosave=await native.view(leaf.view as MarkdownView)!.beginFinalSave();
    const editor=(leaf.view as MarkdownView).editor;editor.replaceRange(' Local typing retained.',editor.offsetToPos(editor.getValue().indexOf('User tail.')+'User tail.'.length));
    state.initialTyping=editor.getValue().includes('Local typing retained.');state.initialSavedTyping=native.view(leaf.view as MarkdownView)?.saved().includes('Local typing retained.');state.initialDiskTyping=(await this.app.vault.read(file)).includes('Local typing retained.');const start=performance.now();if(foreground)(local as any).foreground?.();else starts[0].item({kind:'snapshot',snapshot:snapshot(true,3)});
    const deadline=start+(config.baseline?2000:10000);let result=await Promise.race([local.waitForSave(id),pause(100).then(()=>({saved:false as const,reason:'saving' as const}))]);
    while(!result.saved&&performance.now()<deadline){await pause(50);local.tick();write('PROGRESS.json',{case:note,health:local.health(),native:native.memoryStatus(),state,calls});result=await Promise.race([local.waitForSave(id),pause(100).then(()=>({saved:false as const,reason:'saving' as const}))]);}
    const saved=await this.app.vault.read(file),visible=editor.getValue();
    const record={trace:{...state,bindings:undefined},case:foreground?'foreground recovery':'busy Sync final save',saved:result.saved,pendingReason:result.saved?undefined:result.reason,elapsedMs:performance.now()-start,canonicalReads:calls.filter(route=>route.startsWith('/api/orchestration/threads/')).length,finalItemReads:calls.filter(route=>route==='/api/orchestration/turn-item').length,syncHintCalls:state.syncHintCalls,atomicAttempts:state.attempts,remoteParagraph:saved.includes('Incoming remote paragraph.'),localTyping:saved.includes('Local typing retained.'),visibleFinal:visible.includes(answer),diskFinal:saved.includes(answer),placeholderRemoved:!saved.includes(':::send-to-t3-response')};results.push(record);write('RESULT.json',{syntheticOnly:true,apiVersion,baseline:config.baseline,results});
    fs.writeFileSync(path.join(config.evidence,foreground?'foreground.png':'busy-sync.png'),(await require('@electron/remote').getCurrentWebContents().capturePage()).toPNG());
    if(!config.baseline&&(!record.saved||!record.remoteParagraph||!record.localTyping||!record.visibleFinal||!record.diskFinal||!record.placeholderRemoved||record.syncHintCalls!==0||record.atomicAttempts<2||state.initialDiskTyping))throw Error('Native response checks failed: '+JSON.stringify(record));
   }finally{releaseAutosave?.();delete (this as any).activeCase;window.clearInterval(timer);local.dispose();await (leaf.view as MarkdownView).save();leaf.detach();}
  }
 }
}
