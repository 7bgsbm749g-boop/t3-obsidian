import {Plugin,MarkdownView} from 'obsidian';
import {DirectInlinePreview} from '../../src/responses/direct-inline-preview';
import {LocalResponseManager} from '../../src/responses/local-response-manager';
import {nativeResponses} from '../../src/responses/native-response-manager';
import {deviceNoteIO,deviceFinalNoteIO} from '../../src/conversations/inline-note-io';
import {responseAnchor} from '../../src/responses/native-response-projection';
import {completeResponseBinding,responseBindingRequests,updateResponseBindingData} from '../../src/responses/response-binding-data';
import {loadSmartSend,rememberResponse,moveSmartNotes} from '../../src/notes/smart-send';
import {savedResponseProof} from '../../src/responses/saved-response-proof';
import {contentHash} from '../../src/responses/completion';
import type {ResponseRequest} from '../../src/responses/response-model';
import type {DirectInlineUpdate} from '../../src/responses/direct-inline-preview';
const fs=require('node:fs'),path=require('node:path');
const drain=async()=>{for(let n=0;n<10;n++)await new Promise(resolve=>setTimeout(resolve,25));};
/** Offline synthetic native IO: no real vault, network, or T3 thread. */
export default class StoppedSaveLab extends Plugin {
 private root='';private local?:LocalResponseManager;
 async onload(){
  this.root=path.dirname((this.app.vault.adapter as any).getFullPath(''));
  if(!fs.existsSync(path.join(this.root,'ISOLATED-NATIVE-LAB')))throw Error('Isolated vault required.');
  this.app.workspace.onLayoutReady(()=>void this.run().catch(error=>this.write('ERROR.json',{error:String(error),stack:error.stack})).finally(()=>this.cleanup()));
 }
 private write(name:string,value:unknown){fs.writeFileSync(path.join(this.root,name),JSON.stringify(value,null,2));}
 private check(value:unknown,label:string):asserts value{if(!value)throw Error(label);}
 private async run(){
  const native=nativeResponses(this.app),notes=deviceNoteIO(this.app),final=deviceFinalNoteIO(this.app,()=>true),data=loadSmartSend(undefined);
  const binding:ResponseRequest={version:4,localOnly:true,nativeProjection:true,responseContainer:true,independent:true,id:crypto.randomUUID(),initialOwner:crypto.randomUUID(),vaultId:'synthetic',notePath:'Stopped.md',threadId:crypto.randomUUID(),projectId:crypto.randomUUID(),messageId:crypto.randomUUID(),threadEnvironmentId:'synthetic',host:{environmentId:'synthetic',workspaceRoot:'/synthetic',directory:'.responses'},initialHash:contentHash(''),createdAt:new Date().toISOString()};
  const initial='User prefix\n\n'+responseAnchor(binding.id)+'\n\nUser suffix\n',body='EXACT_PEER_SAVED_REPLY\n';
  const file=await this.app.vault.create(binding.notePath,initial),leaf=this.app.workspace.getLeaf(false);await leaf.openFile(file);
  let records=updateResponseBindingData({},binding,'lab'),emit!:(update:DirectInlineUpdate)=>void,attempts=0,checks=0,receipt:any;
  this.local=new LocalResponseManager('lab',binding.vaultId,{...notes,
   localBindings:()=>responseBindingRequests(records),saveLocalBinding:async request=>{records=updateResponseBindingData(records,request,'lab');},
   openedNotes:()=>this.app.workspace.getLeavesOfType('markdown').map(item=>item.view as MarkdownView).filter(view=>view.file).map(view=>({path:view.file!.path,document:view.getViewData()})),
   knownCompleted:request=>!!records[request.id]?.completion,
   syncReady:()=>true,access:async()=>({origin:'https://synthetic.invalid',api:async(_path:string,payload?:unknown)=>payload?{}:{thread:{id:binding.threadId,projectId:binding.projectId,messages:[],activities:[],latestTurn:{turnId:'exact-turn',state:'running',requestedAt:binding.createdAt},session:{status:'running',activeTurnId:'exact-turn'}}}}),
   savedResponse:async(request,document)=>{checks++;return savedResponseProof(request,document,records,data);},
   retainLocalCompletion:async(_request,saved,update)=>{receipt={saved,update};},
  },{read:final.read,compareAndSet:async()=>{attempts++;return false;}},Date.now,((_record:any,_access:any,receive:any)=>{emit=receive;return {tick(){},update(){},delivery(){},suspend(){},reconnect(){},dispose(){}};}) as any);
  await this.local.register(binding);emit({request:binding,messageId:binding.messageId,turnId:'exact-turn',sequence:1,body:'Different retained local rendering',phase:'running',completionVerified:false});await drain();
  try{await this.local.stop(binding.id,'Frozen native reply');throw Error('Expected native checked refusal');}catch(error){this.check(String(error).includes('waiting for its local save'),'Unexpected Stop refusal');}
  this.check(attempts===1&&!this.local.status(binding.id)?.finalSaved,'Initial checked refusal did not retain the pending reply');
  this.check(this.local.status(binding.id)?.runTerminal===false,'Stop unexpectedly verified remote completion');
  // Native Vault API models an incoming peer save. Re-open to load disk into
  // the real MarkdownView before proving the note through deviceFinalNoteIO.
  leaf.detach();await this.app.fileManager.renameFile(file,'Moved.md');moveSmartNotes(data,binding.notePath,file.path);
  const moved={...binding,notePath:file.path};records=updateResponseBindingData(records,moved,'peer');
  const saved=initial.replace(responseAnchor(binding.id),body)+'Compatible later user content\n';await this.app.vault.modify(file,saved);
  const next=this.app.workspace.getLeaf(false);await next.openFile(file);await drain();
  this.local.changed(moved.notePath);await drain();
  this.check(!this.local.status(binding.id)?.finalSaved,'Note alone was treated as proof');
  records=completeResponseBinding(records,moved,'exact-turn',contentHash(body),'peer');this.local.resume();await drain();
  this.check(!this.local.status(binding.id)?.finalSaved,'A receipt without retained output proved a save');
  await rememberResponse(data,moved.notePath,binding.id,body,'User prefix\n\n','\n\nUser suffix\n',13);this.local.savedResponsesChanged();await drain();
  this.check(this.local.status(binding.id)?.finalSaved,'Peer save not reconciled');
  this.check(!this.local.health().pending.length,'Stopped save remains pending');
  this.check(receipt?.saved&&receipt.update===undefined,'Peer completion was replaced with local rendering');
  this.check(await this.app.vault.read(file)===saved,'Proof changed disk bytes');
  this.check((next.view as MarkdownView).editor.getValue()===saved,'Proof changed native editor bytes');
  this.check(attempts===1,'Proof attempted another write');
  this.check(this.local.frozenBody(binding.id)==='Frozen native reply','Frozen running reply was not retained');
  this.check(this.local.request(binding.id)?.notePath===moved.notePath,'Stopped destination did not follow the proved peer receipt');
  this.local.dispose();
  const turnId='native-question-turn',messageId=crypto.randomUUID(),questionId='synthetic-resolved-question';
  const questionBinding={...binding,id:crypto.randomUUID(),notePath:'Question.md',messageId,importTurn:{turnId,messageId,state:'completed' as const,ordinal:1,requestedAt:binding.createdAt,completedAt:binding.createdAt}},answerId=crypto.randomUUID();
  const questionFile=await this.app.vault.create(questionBinding.notePath,'User before\n\n'+responseAnchor(questionBinding.id)+'\n\nUser after'),questionLeaf=this.app.workspace.getLeaf(false);await questionLeaf.openFile(questionFile);
  const turn={turnId,messageId,state:'completed',assistantMessageId:answerId,requestedAt:binding.createdAt,completedAt:binding.createdAt};
  const snapshot:any={snapshotSequence:1,thread:{id:binding.threadId,projectId:binding.projectId,protocolVersion:2,historyComplete:true,session:{status:'ready',activeTurnId:null},turns:{[turnId]:turn},latestTurn:turn,messages:[{id:messageId,role:'user',turnId,text:'Synthetic prompt',streaming:false},{id:answerId,role:'assistant',turnId,text:'NATIVE_QUESTION_FINAL',itemId:'native-question-final',streaming:false,updatedAt:binding.createdAt}],activities:[{id:'asked',kind:'user-input.requested',turnId,summary:'Question',payload:{requestId:questionId,responseMode:'message',questions:[{id:'choice',header:'Choice',question:'Synthetic choice?',options:[]}]}}]}};
  let questionRecords=updateResponseBindingData({},questionBinding,'lab'),live:any,starts=0;
  const questionIO:any={...notes,localBindings:()=>responseBindingRequests(questionRecords),saveLocalBinding:async(request:ResponseRequest)=>{questionRecords=updateResponseBindingData(questionRecords,request,'lab');},openedNotes:()=>[{path:questionFile.path,document:(questionLeaf.view as MarkdownView).getViewData()}],localFinalBody:async(update:DirectInlineUpdate)=>update.body.replace('NATIVE_QUESTION_FINAL','NATIVE_QUESTION_FINAL_SAVED'),rememberResponse:async(request:ResponseRequest,body:string,before:string,after:string,offset:number)=>{await rememberResponse(data,request.notePath,request.id,body,before,after,offset);},retainLocalCompletion:async(request:ResponseRequest,saved:boolean,update:DirectInlineUpdate|undefined,savedBody:string|undefined)=>{if(saved&&update)questionRecords=completeResponseBinding(questionRecords,request,update.turnId!,contentHash(savedBody??update.body),'lab');},syncReady:()=>true,access:async()=>({origin:'https://synthetic.invalid',api:async()=>({id:'native-question-final',threadId:binding.threadId,runId:turnId,messageId:answerId,type:'assistant_message',text:'NATIVE_QUESTION_FINAL',status:'completed',streaming:false,updatedAt:binding.createdAt})})};
  this.local=new LocalResponseManager('lab',binding.vaultId,questionIO,final,Date.now,(record,access,receive,connection)=>new DirectInlinePreview(record,access,receive,((_id:any,_access:any,callbacks:any)=>{starts++;live=callbacks;return {stop(){}};}) as any,undefined,connection));
  await this.local.register(questionBinding,false,snapshot);await drain();
  this.check(this.local.status(questionBinding.id)?.pendingSaveReason==='answer'&&starts===1,'Imported question did not hand off to a live monitor');
  const resolved=structuredClone(snapshot);resolved.snapshotSequence=2;resolved.thread.v2Requests={[questionId]:{id:questionId,status:'dismissed',resolvedAt:binding.createdAt}};live.item({kind:'snapshot',snapshot:resolved});await drain();await this.local.waitForSave(questionBinding.id);
  this.check(this.local.status(questionBinding.id)?.finalSaved,'Resolved imported question blocked the checked save');
  const questionSaved=await this.app.vault.read(questionFile);this.check(questionSaved.includes('User before')&&questionSaved.includes('User after')&&questionSaved.includes('NATIVE_QUESTION_FINAL')&&!questionSaved.includes('Synthetic choice?'),'Question resolution changed compatible user text or retained the stale question');
  this.check(await savedResponseProof(questionBinding,questionSaved,questionRecords,data),'Rewritten native output does not match its completion receipt');
  this.write('RESULT.json',{ok:true,checks:{checkedRefusalRetained:true,stoppedPeerSaveReconciled:true,nativeDiskAndEditorUnchanged:true,noExtraWrites:true,portableReceiptPreserved:true,movedStoppedDestinationRecovered:true,importedQuestionResolutionSaved:true,unverifiedStoppedReplyReconciled:true,smartSendOnlyArrivalRechecked:true,rewrittenBodyReceiptVerified:true},attempts,proofChecks:checks,nativeDesktop:true,nativeMobile:false,network:false,temporaryThreads:[]});
 }
 private async cleanup(){
  this.local?.dispose();for(const leaf of this.app.workspace.getLeavesOfType('markdown'))leaf.detach();
  for(const file of this.app.vault.getMarkdownFiles())await this.app.vault.delete(file);
  nativeResponses(this.app).dispose();this.write('CLEANUP.json',{remainingNotes:this.app.vault.getMarkdownFiles().map(file=>file.path),temporaryThreads:[]});
  require('@electron/remote').app.quit();
 }
}
