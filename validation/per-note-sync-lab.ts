import {Plugin,MarkdownView,setIcon} from 'obsidian';
import SendToT3 from '../main';
import {LocalResponseManager} from '../local-response-manager';
import {deviceNoteIO,deviceFinalNoteIO} from '../inline-note-io';
import {nativeResponses} from '../native-response-manager';
import {hiddenInlineMarkerExtension} from '../inline-markers';
import {installResponsePresentation} from '../response-presentation';
import {updateResponseBindingData,responseBindingRequests} from '../response-binding-data';
import {localSyncReady} from '../local-sync-state';
import {contentHash} from '../completion';
import type {ThreadAccess} from '../thread-stream';
import {configureDiagnostics} from '../diagnostics';
import {t3Api} from '../t3-api';
const fs=require('node:fs'),path=require('node:path');
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

/** Isolated native editor/file IO, a real retained T3 result, and explicitly
 * controlled Sync metadata. This does not claim a live core Sync connection. */
export default class PerNoteSyncLab extends Plugin {
  async onload(){
    const root=path.dirname((this.app.vault.adapter as any).getFullPath(''));
    if(!fs.existsSync(path.join(root,'ISOLATED-NATIVE-LAB')))throw Error('An isolated test vault is required.');
    const write=(name:string,value:any)=>fs.writeFileSync(path.join(root,name),JSON.stringify(value,(_key,item)=>item instanceof Error?{name:item.name,message:item.message,stack:item.stack}:item,2));
    const events:unknown[]=[];configureDiagnostics({record:(event:string,fields:unknown)=>{events.push({event,fields});write('TRACE.json',events);}} as any);
    this.register(()=>configureDiagnostics());
    this.app.workspace.onLayoutReady(()=>void this.run(root,write).catch(error=>write('ERROR.json',{error:String(error),stack:error.stack})).finally(async()=>{
      for(const leaf of this.app.workspace.getLeavesOfType('markdown'))leaf.detach();
      for(const file of this.app.vault.getMarkdownFiles())await this.app.vault.delete(file);
      write('CLEANUP.json',{temporaryThreadIds:[],retainedSourceThreadWasReadOnly:true,remainingNotes:this.app.vault.getMarkdownFiles().map(file=>file.path)});
      await pause(250);require('@electron/remote').app.quit();
    }));
  }
  private async run(root:string,write:(name:string,value:any)=>void){
    const config=JSON.parse(fs.readFileSync(path.join(root,'ACCESS.json'),'utf8'));
    const calls:Array<{route:string;at:string}>=[];
    const access:ThreadAccess={origin:config.origin,api:t3Api(async(route,payload)=>{
      if(!route.startsWith('/api/orchestration/threads/')&&!['/api/orchestration/shell','/api/auth/websocket-ticket'].includes(route))throw Error('Non-read operation refused by the lab.');
      calls.push({route,at:new Date().toISOString()});
      const response=await fetch(config.origin+route,{method:payload?'POST':'GET',headers:{Authorization:'Bearer '+config.token,'Content-Type':'application/json','x-t3-orchestration-protocol':'2'},...(payload?{body:JSON.stringify(payload)}:{})});
      if(!response.ok)throw Error('T3 read failed: '+response.status);return response.json();
    },config.origin)};
    const native=nativeResponses(this.app);this.register(()=>native.dispose());
    this.registerEditorExtension(hiddenInlineMarkerExtension());
    const {EditorState}=require('@codemirror/state');this.registerEditorExtension(EditorState.transactionFilter.of((tr:any)=>native.filter(tr)));
    this.register(installResponsePresentation(document,setIcon));
    const subject:any=new SendToT3(this.app,this.manifest);
    subject.settings={vaultId:'per-note-sync-synthetic-vault',inlineStreaming:{enabled:true},responseBindings:{}};
    subject.connection=()=>({environmentId:config.environmentId});subject.inlineThreadAccess=async()=>access;
    subject.localResponseTarget=async()=>({environmentId:config.environmentId,workspaceRoot:'/synthetic',directory:'.obsidian/t3-code/inline/v1'});
    const note='Per-note Sync.md',pluginPath='.obsidian/plugins/example/main.js';
    const sync:any={vaultId:'synthetic-remote',initialized:true,initial:false,ready:true,pause:false,syncing:true,syncingPath:pluginPath,getStatus:()=> 'syncing',
      server:{isConnected:()=>true,lastMessageTs:Date.now(),notifyQueue:{promise:Promise.resolve()}},localFiles:{},serverFiles:{},newServerFiles:[{path:pluginPath},{path:note,uid:11}],fileRetry:{}};
    const syncApp={vault:this.app.vault,internalPlugins:{getEnabledPluginById:()=>sync}};
    const rememberStats=()=>{const file=this.app.vault.getFileByPath(note),local=sync.localFiles[note];if(file&&local){local.mtime=Math.ceil(file.stat.mtime);local.size=file.stat.size;local.hash='';}};
    this.registerEvent(this.app.vault.on('modify',file=>{if(file.path===note)rememberStats();}));
    const baseline=async()=>{const file=this.app.vault.getFileByPath(note)!;const hash=contentHash(await this.app.vault.read(file));sync.localFiles[note]={path:note,previouspath:'',folder:false,synchash:hash,synctime:Date.now()};sync.serverFiles[note]={path:note,folder:false,deleted:false,hash,uid:10};rememberStats();};
    const local=new LocalResponseManager('native-sync-lab',subject.settings.vaultId,{
      ...deviceNoteIO(this.app),localBindings:()=>responseBindingRequests(subject.settings.responseBindings),
      saveLocalBinding:async request=>{subject.settings.responseBindings=updateResponseBindingData(subject.settings.responseBindings,request,'lab');await baseline();},
      openedNotes:()=>this.app.workspace.getLeavesOfType('markdown').map(leaf=>leaf.view as MarkdownView).filter(view=>view.file).map(view=>({path:view.file!.path,document:native.view(view)?.saved()??view.getViewData()})),
      syncReady:target=>localSyncReady(syncApp,target),receiveCoordinated:record=>native.receive(record),receiveDirect:update=>native.stream(update),
      localCompleted:(id,target)=>native.localCompleted(id,target),completionFailed:error=>write('SAVE-ERROR.json',{error:String(error)}),access:async()=>access,
    },deviceFinalNoteIO(this.app,()=>true));
    this.register(()=>local.dispose());this.registerInterval(window.setInterval(()=>{native.refresh();local.tick();},100));
    subject.deviceInline={register:(request:any)=>local.register(request),waitForSave:(id:string)=>local.waitForSave(id,3000)};
    const file=await this.app.vault.create(note,'# Per-note Sync\n\nOrdinary text.\n\nTyping stays here.\n');
    const leaf=this.app.workspace.getLeaf(false);await leaf.openFile(file);await leaf.setViewState({type:'markdown',state:{file:note,mode:'source',source:false}});
    const imported=await subject.importRun(note,{id:config.projectId},config.threadId,config.messageId,false);
    const request=responseBindingRequests(subject.settings.responseBindings)[0];
    const pending=await local.waitForSave(request.id,1000),before=await this.app.vault.read(file);
    write('PENDING.json',{imported,pending,globalStatus:sync.getStatus(),noteStillHasPlaceholder:before.includes(':::send-to-t3-response'),state:local.record(request.id)?.state,calls});
    if(pending.saved||pending.reason!=='sync'||!before.includes(':::send-to-t3-response'))throw Error('The pending note update did not block saving.');
    await this.capture(root,'pending.png');
    // The incoming file arrives before metadata acknowledgement. It must still
    // be combined with current native ordinary edits by the product note IO.
    await this.app.vault.modify(file,before.replace('Ordinary text.','Ordinary text.\n\nIncoming remote paragraph.'));await pause(250);
    const editor=(leaf.view as MarkdownView).editor;editor.replaceRange(' Local typing retained.',editor.offsetToPos(editor.getValue().indexOf('Typing stays here.')+'Typing stays here.'.length));
    let release!:()=>void;sync.server.notifyQueue.promise=new Promise<void>(resolve=>{release=resolve;});
    sync.newServerFiles=sync.newServerFiles.filter((item:any)=>item.path!==note);await baseline();
    local.tick();await pause(250);if(!(await this.app.vault.read(file)).includes(':::send-to-t3-response'))throw Error('Unprocessed metadata allowed an early write.');
    release();const result=await local.waitForSave(request.id,8000),saved=await this.app.vault.read(file);
    const visible=(leaf.view as MarkdownView).editor.getValue();
    const checks={saved:result.saved,realAnswer:saved.includes(config.expectedAnswer),placeholderRemoved:!saved.includes(':::send-to-t3-response'),
      remoteParagraph:saved.includes('Incoming remote paragraph.'),localTyping:saved.includes('Local typing retained.'),visibleFinal:visible.includes(config.expectedAnswer),
      unrelatedPluginStillPending:sync.newServerFiles.some((item:any)=>item.path===pluginPath),globalStillSyncing:sync.getStatus()==='syncing'};
    write('RESULT.json',{checks,sourceThreadId:config.threadId,sourceMessageId:config.messageId,temporaryThreadIds:[],calls,
      coverage:'Real retained T3 final item, production verification and local save path, native desktop editor/file IO; controlled Sync metadata; no live core Sync or native mobile claim.'});
    await this.capture(root,'saved.png');if(Object.values(checks).some(value=>!value))throw Error('The native per-note save checks failed.');
  }
  private async capture(root:string,name:string){fs.writeFileSync(path.join(root,name),(await require('@electron/remote').getCurrentWebContents().capturePage()).toPNG());}
}
