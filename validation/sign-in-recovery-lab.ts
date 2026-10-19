import {Plugin,MarkdownView,setIcon} from 'obsidian';
import SendToT3,{T3Settings} from '../main';
import {nativeResponses} from '../native-response-manager';
import {LocalResponseManager} from '../local-response-manager';
import {deviceNoteIO,deviceFinalNoteIO} from '../inline-note-io';
import {responseAnchor} from '../native-response-projection';
import {hiddenInlineMarkerExtension} from '../inline-markers';
import {installResponsePresentation} from '../response-presentation';
import {installStreamBlockControls} from '../stream-block-controls';
import {SignInRequiredError} from '../sign-in-state';
import type {ResponseRequest} from '../response-model';
const fs=require('node:fs'),path=require('node:path');
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
/** Synthetic authentication in an unsynced native client. No credentials,
 * accounts or external T3 requests are used. Native controls drive the flow. */
export default class SignInRecoveryLab extends Plugin {
 async onload(){
  const root=path.dirname((this.app.vault.adapter as any).getFullPath(''));
  if(!fs.existsSync(path.join(root,'ISOLATED-NATIVE-LAB')))throw Error('An isolated vault is required.');
  const write=(name:string,value:any)=>fs.writeFileSync(path.join(root,name),JSON.stringify(value,null,2));
  const capture=async(name:string)=>fs.writeFileSync(path.join(root,name),(await require('@electron/remote').getCurrentWebContents().capturePage()).toPNG());
  const native=nativeResponses(this.app);this.register(()=>native.dispose());
  this.registerEditorExtension(hiddenInlineMarkerExtension());
  const {EditorState}=require('@codemirror/state');this.registerEditorExtension(EditorState.transactionFilter.of((tr:any)=>native.filter(tr)));
  this.register(installResponsePresentation(document,setIcon));
  const plugin:any=new SendToT3(this.app,this.manifest);plugin.signInExpired=true;plugin.signInEmail='synthetic@example.invalid';plugin.mode='direct';
  const tab=new T3Settings(this.app,plugin);tab.display=()=>{tab.containerEl.empty();tab.cloudUI(tab.containerEl);};this.addSettingTab(tab);
  this.register(installStreamBlockControls(this.app,document,setIcon,error=>write('ERROR.json',{error:String(error)}),()=>{write('SIGN-IN-OPENED.json',{opened:true});plugin.openSettings();}));
  let authenticated=false,savedEmailReused=false,local:LocalResponseManager|undefined;
  plugin.startEmailSignIn=async(email:string)=>{savedEmailReused=email==='synthetic@example.invalid';plugin.emailLogin={clientToken:'synthetic',signInId:'synthetic',email,expiresAt:Date.now()+600_000};plugin.cloudChanged?.();await pause(100);await capture('settings-code.png');write('CODE-READY.json',{savedEmailReused});};
  plugin.finishEmailSignIn=async(code:string)=>{if(code!=='123456')throw Error('Use the synthetic fixture code.');plugin.emailLogin=null;plugin.signInExpired=false;authenticated=true;(this.app as any).setting.close();local!.reconnect();};
  this.app.workspace.onLayoutReady(()=>void (async()=>{
   const request:ResponseRequest={version:4,id:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',vaultId:'synthetic',localOnly:true,nativeProjection:true,responseContainer:true,initialOwner:'bbbbbbbb-cccc-dddd-eeee-ffffffffffff',host:{environmentId:'synthetic',workspaceRoot:'/synthetic',directory:'.obsidian/t3-code/inline/v1'},notePath:'Recovery.md',threadId:'thread',projectId:'project',messageId:'cccccccc-dddd-eeee-ffff-aaaaaaaaaaaa',threadEnvironmentId:'synthetic',initialHash:'0'.repeat(64),createdAt:'2026-10-19T00:00:00Z',threadTitle:'Synthetic phone response',keepIntermediate:true,intermediateMode:'collapse'};
   const file=await this.app.vault.create(request.notePath,'# Device switch recovery\n\nOrdinary text before.\n\n'+responseAnchor(request.id)+'\n\nOrdinary text after.\n');
   const leaf=this.app.workspace.getLeaf(false);await leaf.openFile(file);await leaf.setViewState({type:'markdown',state:{file:file.path,mode:'source',source:false}});
   const view=leaf.view as MarkdownView;
   const run={turnId:'run',state:'completed',messageId:request.messageId,assistantMessageId:'answer',completedAt:'2026-10-19T00:01:00Z'};
   const snapshot={snapshotSequence:2,thread:{protocolVersion:2,id:'thread',projectId:'project',title:request.threadTitle,latestTurn:run,turns:{run},session:{status:'ready',activeTurnId:null},activities:[],messages:[{id:request.messageId,role:'user',turnId:'run',text:'Synthetic prompt',streaming:false},{id:'answer',role:'assistant',turnId:'run',itemId:'final-item',text:'Recovered final reply.',streaming:false,updatedAt:run.completedAt}]}};
   local=new LocalResponseManager('synthetic-receiver',request.vaultId,{
    ...deviceNoteIO(this.app),localBindings:()=>[request],openedNotes:()=>[{path:file.path,document:native.view(view)?.saved()??view.getViewData()}],isOpen:()=>true,syncReady:()=>true,
    receiveCoordinated:record=>native.receive(record),receiveDirect:update=>native.stream(update),localConnection:(id,issue)=>native.connection(id,issue),localCompleted:(id,note)=>native.localCompleted(id,note),
    access:async()=>{if(!authenticated)throw new SignInRequiredError();return {origin:'https://synthetic.invalid',api:async route=>{if(route==='/api/auth/websocket-ticket')return new Promise(()=>{});if(route==='/api/orchestration/turn-item')return {id:'final-item',threadId:'thread',runId:'run',messageId:'answer',type:'assistant_message',text:'Recovered final reply.',streaming:false,status:'completed',updatedAt:run.completedAt};return snapshot;}};},
   },deviceFinalNoteIO(this.app,()=>true));
   this.register(()=>local?.dispose());local.resume();await pause(600);
   view.editor.replaceRange('A new line entered while waiting.\n',{line:2,ch:0});await view.save();
   await capture('response-sign-in.png');write('READY.json',{signInButton:!!view.contentEl.querySelector('.send-to-t3-stream-sign-in:not([hidden])'),diskHasOnlyAnchor:(await this.app.vault.read(file)).includes(responseAnchor(request.id))});
   let done=false;this.registerInterval(window.setInterval(()=>{local!.tick();if(done||!local!.status(request.id)?.finalSaved)return;done=true;void (async()=>{await pause(200);const disk=await this.app.vault.read(file);await capture('response-recovered.png');write('RESULT.json',{checks:{savedEmailReused,canonicalFinalSaved:disk.includes('Recovered final reply.'),newLinePreserved:disk.includes('A new line entered while waiting.'),anchorRemoved:!disk.includes('data-t3-response='),noSignInButton:!view.contentEl.querySelector('.send-to-t3-stream-sign-in:not([hidden])')},status:local!.status(request.id)});})().catch(error=>write('ERROR.json',{error:String(error)}));},100));
  })().catch(error=>write('ERROR.json',{error:String(error),stack:error.stack})));
 }
}
