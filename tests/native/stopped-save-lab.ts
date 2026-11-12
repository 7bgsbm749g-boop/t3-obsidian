import {Plugin,MarkdownView} from 'obsidian';
import {LocalResponseManager} from '../../src/responses/local-response-manager';
import {nativeResponses} from '../../src/responses/native-response-manager';
import {deviceNoteIO,deviceFinalNoteIO} from '../../src/conversations/inline-note-io';
import {responseAnchor} from '../../src/responses/native-response-projection';
import {completeResponseBinding,responseBindingRequests,updateResponseBindingData} from '../../src/responses/response-binding-data';
import {loadSmartSend,rememberResponse} from '../../src/notes/smart-send';
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
   syncReady:()=>true,access:async()=>{throw Error('Offline synthetic test');},
   savedResponse:async(request,document)=>{checks++;return savedResponseProof(request,document,records,data);},
   retainLocalCompletion:async(_request,saved,update)=>{receipt={saved,update};},
  },{read:final.read,compareAndSet:async()=>{attempts++;return false;}},Date.now,((_record:any,_access:any,receive:any)=>{emit=receive;return {tick(){},update(){},delivery(){},suspend(){},reconnect(){},dispose(){}};}) as any);
  await this.local.register(binding);emit({request:binding,messageId:binding.messageId,turnId:'exact-turn',sequence:1,body:'Different retained local rendering',phase:'complete',completionVerified:true});await drain();
  this.check(attempts===1&&!this.local.status(binding.id)?.finalSaved,'Initial checked refusal did not retain the pending reply');
  this.local.stopLocally(binding.id);
  await rememberResponse(data,binding.notePath,binding.id,body,'User prefix\n\n','\n\nUser suffix\n',13);
  // Native Vault API models an incoming peer save. Re-open to load disk into
  // the real MarkdownView before proving the note through deviceFinalNoteIO.
  leaf.detach();const saved=initial.replace(responseAnchor(binding.id),body)+'Compatible later user content\n';await this.app.vault.modify(file,saved);
  const next=this.app.workspace.getLeaf(false);await next.openFile(file);await drain();
  this.local.changed(binding.notePath);await drain();
  this.check(!this.local.status(binding.id)?.finalSaved,'Note alone was treated as proof');
  records=completeResponseBinding(records,binding,'exact-turn',contentHash(body),'peer');this.local.resume();await drain();
  this.check(this.local.status(binding.id)?.finalSaved,'Peer save not reconciled');
  this.check(!this.local.health().pending.length,'Stopped save remains pending');
  this.check(receipt?.saved&&receipt.update===undefined,'Peer completion was replaced with local rendering');
  this.check(await this.app.vault.read(file)===saved,'Proof changed disk bytes');
  this.check((next.view as MarkdownView).editor.getValue()===saved,'Proof changed native editor bytes');
  this.check(attempts===1,'Proof attempted another write');
  this.write('RESULT.json',{ok:true,checks:{checkedRefusalRetained:true,stoppedPeerSaveReconciled:true,nativeDiskAndEditorUnchanged:true,noExtraWrites:true,portableReceiptPreserved:true},attempts,proofChecks:checks,nativeDesktop:true,nativeMobile:false,network:false,temporaryThreads:[]});
 }
 private async cleanup(){
  this.local?.dispose();for(const leaf of this.app.workspace.getLeavesOfType('markdown'))leaf.detach();
  for(const file of this.app.vault.getMarkdownFiles())await this.app.vault.delete(file);
  nativeResponses(this.app).dispose();this.write('CLEANUP.json',{remainingNotes:this.app.vault.getMarkdownFiles().map(file=>file.path),temporaryThreads:[]});
  require('@electron/remote').app.quit();
 }
}
