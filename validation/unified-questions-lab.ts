import {Plugin,MarkdownView,MarkdownRenderChild,setIcon} from 'obsidian';
import {nativeResponses} from '../native-response-manager';
import {deviceNoteIO,deviceFinalNoteIO} from '../inline-note-io';
import {responseAnchor} from '../native-response-projection';
import {hiddenInlineMarkerExtension} from '../inline-markers';
import {installResponsePresentation} from '../response-presentation';
import {LocalResponseManager} from '../local-response-manager';
import {responseBindingRequests,updateResponseBindingData,type ResponseBindingData} from '../response-binding-data';
import {desktopDefaults,desktopEnvironment,desktopThreadAccess,start,uuid5} from '../desktop';
import {readNewThreadDefaults} from '../model-defaults';
import {contentHash} from '../completion';
import {QuestionController} from '../question-controller';
import {questionEditorExtension,questionButton,QuestionModal,installQuestionLinks} from '../question-ui';
import {parseQuestionToken} from '../questions';
import {continueQuestionAnswer} from '../question-continuation';
import {retainedLocalFinal,restoredLocalFinal} from '../local-final-cache';
import type {ResponseRequest} from '../response-model';
import type {DirectInlineUpdate} from '../direct-inline-preview';
import type {ThreadAccess} from '../thread-stream';
const fs=require('node:fs'),path=require('node:path');
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
/** Real desktop, one bounded T3 question/late answer, and a device-manager
 * restart in an isolated unsynced vault. No production state is copied. */
export default class UnifiedQuestionsLab extends Plugin {
  private root='';private threadId?:string;private access?:ThreadAccess;private local?:LocalResponseManager;private questions?:QuestionController;private interval?:number;private modal?:QuestionModal;
  private records:ResponseBindingData={};private update?:DirectInlineUpdate;private checks:Record<string,boolean>={};private errors:string[]=[];
  async onload(){
    this.root=path.dirname((this.app.vault.adapter as any).getFullPath(''));
    if(!fs.existsSync(path.join(this.root,'ISOLATED-NATIVE-LAB')))throw Error('An isolated test vault is required.');
    this.registerEditorExtension(hiddenInlineMarkerExtension());this.register(installResponsePresentation(document,setIcon));
    const {EditorState}=require('@codemirror/state');this.registerEditorExtension(EditorState.transactionFilter.of((tr:any)=>nativeResponses(this.app).filter(tr)));
    this.app.workspace.onLayoutReady(()=>void this.run().catch(error=>this.write('ERROR.json',{error:String(error),stack:error.stack})).finally(()=>this.cleanup()));
  }
  private write(name:string,value:any){fs.writeFileSync(path.join(this.root,name),JSON.stringify(value,null,2));}
  private check(name:string,value:boolean){this.checks[name]=value;this.write('CHECKS.json',this.checks);if(!value)throw Error(name);}
  private async until(check:()=>Promise<boolean>|boolean,label:string,timeout=30_000){const end=Date.now()+timeout;do{if(await check())return;await pause(100);}while(Date.now()<end);throw Error('Timed out: '+label);}
  private async capture(name:string){await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));fs.writeFileSync(path.join(this.root,name),(await require('@electron/remote').getCurrentWebContents().capturePage()).toPNG());}
  private makeManager(binding:ResponseRequest){
    const native=nativeResponses(this.app),notes=deviceNoteIO(this.app);
    return new LocalResponseManager('question-lab',binding.vaultId,{
      ...notes,localBindings:()=>responseBindingRequests(this.records),saveLocalBinding:async request=>{this.records=updateResponseBindingData(this.records,request,'lab');},
      openedNotes:()=>this.app.workspace.getLeavesOfType('markdown').map(leaf=>leaf.view as MarkdownView).filter(view=>view.file).map(view=>({path:view.file!.path,document:native.view(view)?.recoveryDocument()??view.getViewData()})),
      syncReady:()=>true,receiveCoordinated:record=>native.receive(record),receiveDirect:update=>{this.update=update;if(update.questionActivities)this.questions?.observe(update.request.threadEnvironmentId,update.request.threadId,update.questionActivities,update.sequence);native.stream(update);},
      retainLocalFinal:async update=>this.write('RECOVERY.json',retainedLocalFinal(update)),loadLocalFinal:async request=>fs.existsSync(path.join(this.root,'RECOVERY.json'))?restoredLocalFinal(JSON.parse(fs.readFileSync(path.join(this.root,'RECOVERY.json'),'utf8')),request):undefined,
      localCompleted:(id,note)=>native.localCompleted(id,note),completionFailed:error=>this.errors.push(String(error)),access:()=>desktopThreadAccess(desktopDefaults()),
    },deviceFinalNoteIO(this.app,()=>true));
  }
  private async run(){
    await pause(900);const config=JSON.parse(fs.readFileSync(path.join(this.root,'TEST-CONFIG.json'),'utf8')),connection=desktopDefaults();this.access=await desktopThreadAccess(connection);
    const api=(route:string,payload?:any)=>this.access!.api(route.startsWith('/api/')?route:'/api/orchestration/'+route,payload),source=await api('threads/'+config.sourceThreadId+'?controlOnly=true');
    const requestId=crypto.randomUUID(),stateDir=path.join(this.root,'t3-state');this.write('TEMPORARY-T3.json',{requestId,stateDir});
    const prompt='This is a bounded synthetic plugin delivery test. Do not read or change files, run commands, create tasks, or call other agents. Your only permitted tool call is request_user_input_async. Call it once with the question "Choose the test value." and options "Resume" and "Pause". Do not wait for an answer in this turn. After the tool call, finish this turn with exactly QUESTION_SOURCE_FINAL. When the user later answers Resume, use no tools and finish with exactly QUESTION_FOLLOWUP_OK.';
    const started=await start(api,{requestId,project:source.thread.projectId,title:'Synthetic unified question '+requestId.slice(0,8),prompt},stateDir,item=>readNewThreadDefaults(this.access!.api,this.access!.origin,item));
    this.threadId=started.threadId;this.write('TEMPORARY-T3.json',{requestId,stateDir,threadId:this.threadId});
    const environmentId=await desktopEnvironment(connection),id=crypto.randomUUID(),note='Unified question.md';
    const binding:ResponseRequest={version:4,localOnly:true,nativeProjection:true,responseContainer:true,independent:true,id,initialOwner:crypto.randomUUID(),vaultId:'synthetic-question-vault',host:{environmentId,workspaceRoot:'/synthetic',directory:'.obsidian/t3-code/inline/v1'},notePath:note,threadId:this.threadId!,projectId:source.thread.projectId,messageId:uuid5(requestId,'message'),threadEnvironmentId:environmentId,createdAt:new Date().toISOString(),initialHash:contentHash(''),intermediateMode:'collapse',threadTitle:'Unified question test'};
    const file=await this.app.vault.create(note,'# Unified question test\n\nUser text before.\n\n'+responseAnchor(id)+'\n\nUser text after.\n'),leaf=this.app.workspace.getLeaf('tab');await leaf.openFile(file);const view=leaf.view as MarkdownView;
    const notes=deviceNoteIO(this.app),open=(target:any)=>{this.modal?.close();this.modal=new QuestionModal(this.app,this.questions!,target,note);this.modal.open();void this.capture('answer-form.png');};
    this.questions=new QuestionController(()=>desktopThreadAccess(connection),{load:()=>[],save:records=>this.write('QUESTION-RECORDS.json',records)},()=>crypto.randomUUID(),()=>new Date().toISOString(),(target,follow)=>continueQuestionAnswer(target,follow,{...notes,vaultId:binding.vaultId,owner:binding.initialOwner!,access:()=>desktopThreadAccess(connection),bindings:()=>responseBindingRequests(this.records),notePaths:()=>[note],host:async()=>binding.host,policy:()=>({intermediateMode:'collapse',finalAnswerFormat:'formatted'}),register:request=>this.local!.register(request),followed:(request,requestId)=>!!this.local?.record(request.id)?.state?.questionFollows?.some(item=>item.requestId===requestId&&item.replyTurnId),allowed:()=>true}));
    this.registerEditorExtension(questionEditorExtension(this.questions,open));
    this.register(installQuestionLinks(document,this.questions,open));
    this.registerMarkdownPostProcessor((element,ctx)=>{for(const link of Array.from(element.querySelectorAll<HTMLAnchorElement>('a[href^="t3-question:"]'))){const target=parseQuestionToken(link.getAttribute('href')!.slice('t3-question:'.length));if(!target)continue;const control=questionButton(this.questions!,target,open);link.replaceWith(control.button);const row=control.button.closest<HTMLElement>('[data-t3-question]');if(row)row.hidden=this.questions!.isHidden(target);const child=new MarkdownRenderChild(control.button);child.register(control.unsubscribe);ctx.addChild(child);}});
    this.local=this.makeManager(binding);await this.local.register(binding);
    this.interval=window.setInterval(()=>{nativeResponses(this.app).refresh();this.local?.tick();void this.questions?.recoverAnswerStreams();},200);
    await this.until(()=>!!this.update?.completionVerified&&!!this.update.questionsPending,'real question and source completion',180_000);
    await this.until(()=>view.contentEl.innerText.includes('Choose the test value.')&&!!view.contentEl.querySelector('button.send-to-t3-question-answer'),'painted pending question and native answer button');
    this.check('sourceFinalVisibleWhilePending',view.contentEl.innerText.includes('QUESTION_SOURCE_FINAL'));
    this.check('oneOriginalBinding',responseBindingRequests(this.records).length===1);
    this.check('pendingWithoutSpinner',!view.contentEl.querySelector('.send-to-t3-inline-spinner'));
    this.check('pendingQuestionInsideResponse',!!view.contentEl.querySelector('.send-to-t3-question')&&!view.contentEl.querySelector('.send-to-t3-question')?.closest('blockquote'));
    this.check('originalAnchorStillSaved',(await this.app.vault.read(file)).includes(responseAnchor(id)));await this.capture('pending.png');
    this.local.dispose();this.update=undefined;this.local=this.makeManager(binding);this.local.resume();
    await this.until(()=>!!this.update?.questionsPending&&view.contentEl.innerText.includes('Choose the test value.'),'question after manager restart');this.check('managerRestartRetainsQuestion',true);
    this.write('WAITING-FOR-NATIVE-ANSWER.json',{threadId:this.threadId,note,id});
    await this.until(()=>!!this.local?.status(id)?.finalSaved,'native answer and follow-up final save',600_000);
    await this.until(()=>view.contentEl.innerText.includes('QUESTION_FOLLOWUP_OK'),'painted same-stream follow-up');
    const saved=await this.app.vault.read(file);this.write('FINAL-NOTE.json',{text:saved});
    this.check('sameOriginalBindingAfterAnswer',responseBindingRequests(this.records).length===1&&responseBindingRequests(this.records)[0].id===id);
    this.check('questionRemoved',!view.contentEl.querySelector('.send-to-t3-question')&&!saved.includes('t3-question:')&&!saved.includes('Question answered'));
    this.check('followupSavedWithOriginal',saved.includes('QUESTION_SOURCE_FINAL')&&saved.includes('QUESTION_FOLLOWUP_OK')&&saved.includes('data-t3-answer-id='));
    this.check('finalTrackingRemoved',!saved.includes('data-t3-response='));this.check('surroundingTextPreserved',saved.includes('User text before.')&&saved.includes('User text after.'));this.check('noErrors',!this.errors.length);
    await this.capture('answered.png');this.write('RESULT.json',{pass:true,checks:this.checks,threadId:this.threadId,coverage:'Real T3 async question and late answer, original response identity, actual Obsidian Live Preview rendering, device-manager restart and final save. Isolated test vault; no Sync or native mobile claim.'});await pause(1200);
  }
  private async cleanup(){
    if(this.interval!==undefined)window.clearInterval(this.interval);this.modal?.close();this.local?.dispose();this.questions?.dispose();
    const remainingThreadIds:string[]=[];
    try{if(this.threadId){await this.access?.close?.();this.access=await desktopThreadAccess(desktopDefaults());await this.access.api('/api/orchestration/dispatch',{type:'thread.delete',commandId:crypto.randomUUID(),threadId:this.threadId});let deleted=false;try{deleted=!!(await this.access.api('/api/orchestration/threads/'+this.threadId+'?controlOnly=true')).thread.deletedAt;}catch(error){deleted=(error as any)?.status===404;}if(!deleted)remainingThreadIds.push(this.threadId);}}catch(error){this.errors.push(String(error));if(this.threadId)remainingThreadIds.push(this.threadId);}
    await this.access?.close?.();for(const leaf of this.app.workspace.getLeavesOfType('markdown'))leaf.detach();for(const file of this.app.vault.getMarkdownFiles())await this.app.vault.delete(file);
    this.write('CLEANUP.json',{temporaryThreadIds:this.threadId?[this.threadId]:[],remainingThreadIds,remainingNotes:this.app.vault.getMarkdownFiles().map(file=>file.path),errors:this.errors});await pause(250);require('@electron/remote').app.quit();
  }
}
