import {Plugin,MarkdownView,Menu,setIcon} from 'obsidian';
import SendToT3 from '../../src/app/main';
import {LocalResponseManager} from '../../src/responses/local-response-manager';
import {DirectInlinePreview} from '../../src/responses/direct-inline-preview';
import {deviceNoteIO,deviceFinalNoteIO} from '../../src/conversations/inline-note-io';
import {nativeResponses} from '../../src/responses/native-response-manager';
import {hiddenInlineMarkerExtension} from '../../src/conversations/inline-markers';
import {installResponsePresentation} from '../../src/responses/response-presentation';
import {applyThreadItem} from '../../src/conversations/inline-thread';
import {updateResponseBindingData,responseBindingRequests} from '../../src/responses/response-binding-data';
import {initialRegion} from '../../src/conversations/inline-thread';
import {readThreadSnapshot} from '../../src/connection/wire-types';
import {normalizeV2Snapshot} from '../../src/connection/orchestration-v2';
const fs=require('node:fs'),path=require('node:path');
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
/** Native Obsidian UI and checked note saves, with synthetic T3 source data.
 * No production data, network dispatch, or T3 test thread is created. */
export default class CatchUpLab extends Plugin{
 async onload(){
  const root=path.dirname((this.app.vault.adapter as any).getFullPath(''));
  if(!fs.existsSync(path.join(root,'ISOLATED-NATIVE-LAB')))throw Error('Isolated test vault required.');
  const write=(name:string,value:any)=>fs.writeFileSync(path.join(root,name),JSON.stringify(value,null,2));
  this.app.workspace.onLayoutReady(()=>void this.run(root,write).catch(error=>write('ERROR.json',{error:String(error),stack:error.stack})).finally(async()=>{
   for(const file of this.app.vault.getMarkdownFiles())await this.app.vault.delete(file);
   write('CLEANUP.json',{remainingNotes:this.app.vault.getMarkdownFiles().map(file=>file.path),testThreads:[]});
  }));
 }
 private async run(root:string,write:(name:string,value:any)=>void){
  const shot=async(name:string,owner=document)=>{const win=owner.defaultView as any,remote=win.require?win.require('@electron/remote'):require('@electron/remote');fs.writeFileSync(path.join(root,name),(await remote.getCurrentWebContents().capturePage()).toPNG());};
  const native=nativeResponses(this.app);this.register(()=>native.dispose());this.registerEditorExtension(hiddenInlineMarkerExtension());
  this.registerEditorExtension(require('@codemirror/state').EditorState.transactionFilter.of((tr:any)=>native.filter(tr)));
  this.register(installResponsePresentation(document,setIcon));
  const p:any=new SendToT3(this.app,this.manifest),environmentId='synthetic-machine',projectId='synthetic-project',at='2026-11-01T00:00:00Z',ids=[crypto.randomUUID(),crypto.randomUUID(),crypto.randomUUID()];
  const snapshots=new Map<string,any>();
  const snapshot=(threadId:string)=>{
   let value=snapshots.get(threadId);if(value)return value;
   const runs=ids.map((messageId,index)=>({id:'run-'+messageId,ordinal:index+1,userMessageId:messageId,status:'completed',requestedAt:at,completedAt:at,assistantMessageId:'answer-'+messageId}));
   const messages=ids.flatMap((id,index)=>[{id,role:'user',runId:'run-'+id,text:`Synthetic prompt ${index}`,streaming:false,createdAt:at},{id:'answer-'+id,role:'assistant',runId:'run-'+id,itemId:'item-'+id,text:`CATCH_UP_FINAL_${index}`,streaming:false,createdAt:at}]);
   value={snapshotSequence:3,hasMoreHistory:false,projection:{thread:{id:threadId,projectId,title:'Native catch-up thread'},runs,messages,turnItems:[]}};snapshots.set(threadId,value);return value;
  };
  p.settings={vaultId:crypto.randomUUID(),threadNoteMode:'free',inlineStreaming:{enabled:true},responseBindings:{},noteThreads:[]};p.save=async()=>{};
  p.connection=()=>({environmentId});p.recoveryProject=async()=>({id:projectId});p.localResponseTarget=async()=>({environmentId,workspaceRoot:'/synthetic',directory:'.obsidian/inline'});
  p.inlineThreadAccess=async()=>({origin:'https://synthetic.invalid',api:async(route:string)=>snapshot(decodeURIComponent(route.split('/threads/')[1].split('?')[0]))});
  const local=new LocalResponseManager('catch-up-lab',p.settings.vaultId,{
   ...deviceNoteIO(this.app),localBindings:()=>responseBindingRequests(p.settings.responseBindings),saveLocalBinding:async request=>{p.settings.responseBindings=updateResponseBindingData(p.settings.responseBindings,request,'lab');},
   openedNotes:()=>this.app.workspace.getLeavesOfType('markdown').map(leaf=>leaf.view as MarkdownView).filter(view=>view.file).map(view=>({path:view.file!.path,document:native.view(view)?.saved()??view.getViewData()})),
   syncReady:()=>true,receiveCoordinated:record=>native.receive(record),receiveDirect:update=>native.stream(update),localCompleted:(id,note)=>native.localCompleted(id,note),completionFailed:error=>write('SAVE-ERROR.json',{error:String(error)}),
   access:async()=>({origin:'https://synthetic.invalid',api:async(_route,payload:any)=>{const id=payload.itemId.slice('item-'.length);return {id:payload.itemId,threadId:'thread-one',runId:'run-'+id,messageId:'answer-'+id,type:'assistant_message',text:`CATCH_UP_FINAL_${ids.indexOf(id)}`,streaming:false,status:'completed',updatedAt:at};}}),
  },deviceFinalNoteIO(this.app,()=>true),Date.now,(record,access,receive)=>new DirectInlinePreview(record,access,receive,(_thread,_access,callbacks)=>{queueMicrotask(async()=>{callbacks.item({kind:'snapshot',snapshot:readThreadSnapshot(normalizeV2Snapshot(snapshot(record.request.threadId)))});});return {stop(){}};},undefined,undefined,async()=>{const value=readThreadSnapshot(normalizeV2Snapshot(snapshot(record.request.threadId)));return {snapshot:value,state:applyThreadItem({messages:[],activities:[]},{kind:'snapshot',snapshot:value}).state};}));
  p.deviceInline={cachedResponse:()=>undefined,register:(request:any,value:any)=>local.register(request,false,value),waitForSave:(id:string)=>local.waitForSave(id,10000)};
  this.register(()=>local.dispose());this.registerInterval(window.setInterval(()=>{native.refresh();local.tick();},100));
  const file=await this.app.vault.create('Catch up.md','# Catch up\n\nCATCH_UP_FINAL_0\n\nUser edit stays.\n'),leaf=this.app.workspace.getLeaf(false);await leaf.openFile(file);
  await leaf.setViewState({type:'markdown',state:{file:file.path,mode:'source',source:false}});const view=leaf.view as MarkdownView;await pause(750);
  const doc=view.containerEl.ownerDocument;
  this.registerEvent(this.app.workspace.on('editor-menu',(menu,editor,info)=>{if(info.file?.path===file.path)p.addResponseCatchUpMenu(menu,info.file,editor.getValue());}));
  const menu=()=>{const value=new Menu().setUseNativeMenu(false).setParentElement(doc.body);(this.app.workspace as any).trigger('editor-menu',value,view.editor,view);value.showAtPosition({x:160,y:160},doc);return value;};
  const click=async(text:string)=>{await pause(150);const root=(shown as any).dom as HTMLElement,el=Array.from(root.querySelectorAll<HTMLElement>('.menu-item')).find(el=>el.textContent?.includes(text));if(!el)throw Error('Missing menu '+text);el.click();shown.hide();await pause(100);};
  const seed=(threadId:string)=>{const id=crypto.randomUUID();p.settings.responseBindings=updateResponseBindingData(p.settings.responseBindings,{version:4,localOnly:true,nativeProjection:true,responseContainer:true,initialOwner:crypto.randomUUID(),id,vaultId:p.settings.vaultId,host:{environmentId,workspaceRoot:'/synthetic',directory:'.obsidian/inline'},notePath:file.path,threadId,projectId,threadEnvironmentId:environmentId,messageId:ids[0],createdAt:at,initialHash:initialRegion(id).bodyHash,threadTitle:threadId},'lab');};
  let shown=menu();await pause(150);if(Array.from(document.querySelectorAll('.menu-item')).some(el=>el.textContent?.includes('Catch up on responses')))throw Error('Catch-up visible without a stream');shown.hide();await pause(300);
  seed('thread-one');shown=menu();await pause(150);await shot('single-thread-menu.png');await click('Catch up on responses');
  for(let n=0;n<150&&p.busy;n++)await pause(100);if(p.busy)throw Error('Catch-up did not finish');
  const saved=await this.app.vault.read(file);if(!saved.includes('CATCH_UP_FINAL_1')||!saved.includes('CATCH_UP_FINAL_2')||!saved.includes('User edit stays.')||saved.includes(':::send-to-t3-response'))throw Error('Native checked save failed');
  if(saved.indexOf('CATCH_UP_FINAL_1')>saved.indexOf('CATCH_UP_FINAL_2'))throw Error('Wrong response order');
  await shot('saved-responses.png');await p.catchUpResponses(file,p.noteCatchUpThreads(file.path));if(await this.app.vault.read(file)!==saved)throw Error('Repeat catch-up changed saved note');
  seed('thread-two');p.openResponseCatchUp(file);await pause(250);
  // Obsidian can host a modal in its active UI document, separate from the editor.
  const modal=Array.from(activeDocument.querySelectorAll<HTMLElement>('.modal')).find(el=>el.querySelector('.modal-title')?.textContent==='Catch up on responses');
  if(!modal?.textContent?.includes('Native catch-up thread')||!modal.textContent?.includes('thread-two'))throw Error('Missing thread choices');
  await shot('thread-picker.png',modal.ownerDocument);
  const toggles=modal.querySelectorAll<HTMLElement>('.checkbox-container');if(toggles.length!==2)throw Error('Missing thread toggles');toggles[1].click();
  if(toggles[1].classList.contains('is-enabled'))throw Error('Could not deselect thread');
  Array.from(modal.querySelectorAll('button')).find(button=>button.textContent==='Catch up on responses')!.click();await pause(200);
  if(await this.app.vault.read(file)!==saved)throw Error('Deselected thread was imported');
  write('RESULT.json',{nativeEditorMenu:{hiddenWithoutStream:true,visibleAfterStream:true},singleThreadOneClick:true,nativeCheckedSave:true,chronologicalOrder:true,userEditPreserved:true,repeatNoOp:true,multipleThreadPicker:true,deselectedThreadExcluded:true,source:'Synthetic T3 history; no network or native mobile check'});
 }
}
