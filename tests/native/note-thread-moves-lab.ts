import {readThreadSnapshot} from '../../src/connection/wire-types';
import {readWireShell,readMetadataSnapshot} from '../../src/connection/wire-readers';
import {Plugin,MarkdownView,TFolder,Notice,setIcon} from 'obsidian';
import SendToT3 from '../../src/app/main';
import {DeviceResponseManager} from '../../src/responses/device-local-responses';
import {nativeResponses} from '../../src/responses/native-response-manager';
import {deviceNoteIO,deviceFinalNoteIO} from '../../src/conversations/inline-note-io';
import {hiddenInlineMarkerExtension} from '../../src/conversations/inline-markers';
import {installResponsePresentation} from '../../src/responses/response-presentation';
import {responseBindingRequests,updateResponseBindingData} from '../../src/responses/response-binding-data';
import {desktopDefaults,desktopEnvironment,desktopThreadAccess,uuid5} from '../../src/connection/desktop';
import {noteIdentity} from '../../src/notes/note-identity';
import {configureBridge} from '../../src/app/bridge';
import {rememberResponse} from '../../src/notes/smart-send';
import type {ThreadAccess} from '../../src/conversations/thread-stream';
const fs=require('node:fs'),path=require('node:path');
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

/** Bounded real delivery in a native editor, with synthetic settings only. */
export default class NoteThreadMovesLab extends Plugin {
  private root='';private subject:any;private access?:ThreadAccess;private device?:DeviceResponseManager;
  private tick?:number;private thread?:string;private observeMoves=true;private failures:string[]=[];
  async onload(){
    this.root=path.dirname((this.app.vault.adapter as any).getFullPath(''));
    if(!fs.existsSync(path.join(this.root,'ISOLATED-NATIVE-LAB')))throw Error('Isolated vault required.');
    this.app.workspace.onLayoutReady(()=>void this.run().catch(error=>{this.write('ERROR.json',{error:String(error),stack:error.stack});return this.cleanup();}));
  }
  private write(name:string,data:unknown){fs.writeFileSync(path.join(this.root,name),JSON.stringify(data,null,2));}
  private async until(check:()=>boolean|Promise<boolean>,label:string){const deadline=Date.now()+150000;do{if(await check())return;await pause(200);}while(Date.now()<deadline);throw Error('Timed out: '+label);}
  private async shot(name:string){fs.writeFileSync(path.join(this.root,name),(await require('@electron/remote').getCurrentWebContents().capturePage()).toPNG());}
  private async run(){
    const config=JSON.parse(fs.readFileSync(path.join(this.root,'TEST-CONFIG.json'),'utf8'));
    this.access=await desktopThreadAccess(desktopDefaults());
    const project=(readWireShell(await this.access.api('/api/orchestration/shell'))).projects.find((item:any)=>item.id===config.projectId);
    if(!project||project.workspaceRoot!==path.join(this.root,'workspace'))throw Error('Dedicated synthetic project required.');
    const environmentId=await desktopEnvironment(desktopDefaults()),native=nativeResponses(this.app),p:any=new SendToT3(this.app,this.manifest);this.subject=p;
    const recordFailure=p.recordSendFailure.bind(p);p.recordSendFailure=(...args:any[])=>{this.write('SEND-FAILURE.json',args.map(value=>value instanceof Error?{error:String(value),stack:value.stack}:value));return recordFailure(...args);};
    p.settings={vaultId:crypto.randomUUID(),threadNoteMode:'free',projects:[project],directProjects:[],paired:[],connection:desktopDefaults(),autoSettleThreads:false,completion:{action:'keep',archiveFolder:'Archive'},completionJobs:[],settlementJobs:[],pending:[],noteThreads:[],noteContexts:[],vaultLocations:[],folderLinkChanges:[],projectCreationLocations:[],responseBindings:{},inlineStreaming:{enabled:true,intermediateMode:'collapse',keepIntermediate:true,finalAnswerFormat:'formatted'},folderLinks:[{id:crypto.randomUUID(),folderPath:'Fixture',projectId:project.id,projectTitle:project.title,workspaceRoot:project.workspaceRoot,connectionId:'',environmentId,self:false}]};
    p.mode='desktop';p.localNoProjectId=environmentId;p.eventLocalEnvironmentId=environmentId;p.localInlineEnvironment=async()=>environmentId;p.inlineThreadAccess=()=>desktopThreadAccess(desktopDefaults());p.save=async()=>this.saveData(p.settings);
    configureBridge({mobile:false,localAccess:async()=>this.access!});
    this.registerEditorExtension(hiddenInlineMarkerExtension());
    this.registerEditorExtension(require('@codemirror/state').EditorState.transactionFilter.of((transaction:any)=>native.filter(transaction)));
    this.register(installResponsePresentation(document,setIcon));
    this.device=new DeviceResponseManager('moves-lab',p.settings.vaultId,{
      ...deviceNoteIO(this.app),localFinalNotes:deviceFinalNoteIO(this.app,()=>true),
      rememberResponse:async(request,body,before,after,offset)=>{if(await rememberResponse(p.smartData(),request.notePath,request.id,body,before,after,offset))await p.save();},
      localBindings:()=>responseBindingRequests(p.settings.responseBindings),
      saveLocalBinding:async request=>{p.settings.responseBindings=updateResponseBindingData(p.settings.responseBindings,request,'moves-lab');await p.save();},
      openedNotes:()=>this.app.workspace.getLeavesOfType('markdown').map(leaf=>leaf.view as MarkdownView).filter(view=>view.file).map(view=>({path:view.file!.path,document:native.view(view)?.recoveryDocument()??view.getViewData()})),
      syncReady:()=>true,receiveCoordinated:record=>native.receive(record),receiveDirect:update=>native.stream(update),localCompleted:(id,note)=>native.localCompleted(id,note),completionFailed:error=>this.failures.push(String(error)),access:()=>desktopThreadAccess(desktopDefaults()),
    });p.deviceInline=this.device;this.tick=window.setInterval(()=>{native.refresh();this.device?.tick();},150);
    this.register(()=>{if(this.tick!==undefined)window.clearInterval(this.tick);this.device?.dispose();native.dispose();});
    this.registerEvent(this.app.vault.on('rename',(file,before)=>{if(this.observeMoves)void p.relocateNoteThreads(before,file.path,file instanceof TFolder);}));
    await this.app.vault.createFolder('Fixture');await this.app.vault.createFolder('Destination');
    const file=await this.app.vault.create('Fixture/Note.md','Reply with exactly NOTE_MOVE_FIRST_OK. Do not use tools, inspect files, or change files. This is a bounded synthetic test.\n');
    await this.app.workspace.getLeaf(false).openFile(file);
    const sendId=crypto.randomUUID();this.thread=uuid5(sendId,'thread');this.write('TEMPORARY.json',{projectId:project.id,threadIds:[this.thread],notePaths:[file.path]});
    const first=await p.executeNoteCommand({version:1,id:sendId,kind:'send-note',notePath:file.path,destinations:[file.path],streamReply:true});this.thread=first.threadId;
    await this.until(async()=>{const status=p.deviceInline.responseStatus(first.bindingIds[0]);return !!status?.runTerminal&&(await this.app.vault.read(file)).includes('> NOTE_MOVE_FIRST_OK');},'first real saved reply');
    const id=noteIdentity(await this.app.vault.read(file));if(!id)throw Error('First delivery did not retain its note ID.');
    await this.shot('first-delivery.png');
    await this.app.vault.rename(file,'Fixture/Renamed.md');await this.until(()=>p.noteThread(file.path)?.threadId===this.thread,'file rename');
    const folder=this.app.vault.getFolderByPath('Fixture')!;await this.app.vault.rename(folder,'RenamedFolder');await this.until(()=>p.noteThread(file.path)?.threadId===this.thread,'folder rename');
    await this.app.vault.rename(file,'Destination/Note.md');await this.until(()=>p.noteThread(file.path)?.threadId===this.thread,'file move');
    // Deliberately miss the next event, as a closed plugin or Sync receiver can.
    this.observeMoves=false;await this.app.vault.rename(file,'Destination/Offline.md');this.observeMoves=true;
    const oldPath='Destination/Note.md';if(p.noteThread(file.path))throw Error('Missed-move precondition did not reproduce.');
    const view=this.app.workspace.getActiveViewOfType(MarkdownView)!;
    view.editor.replaceRange('\nReply with exactly NOTE_MOVE_SECOND_OK. Do not use tools or change files.\n',view.editor.offsetToPos(view.editor.getValue().length));await view.save();
    p.settings.threadNoteMode='one-to-one';
    await p.recoverNoteThread(file.path);
    const context=p.destinationContext({path:file.path}),destination=await context.getDefaultDestination(context.getDefaultProjectKey());
    this.write('DESTINATION.json',destination);if(destination.unavailable)throw Error('Default destination unavailable: '+destination.detail);
    await p.openNoteSend(file);
    await this.until(()=>p.settings.noteContexts.length===2,'default Send acceptance');
    const second=p.settings.noteContexts[1];if(second.threadId!==this.thread)throw Error('Default Send created another thread.');
    await this.until(async()=>{const status=p.deviceInline.responseStatus(second.bindingIds[0]);return !!status?.runTerminal&&(await this.app.vault.read(file)).includes('> NOTE_MOVE_SECOND_OK');},'second real saved reply');
    const current=await this.app.vault.read(file);if(noteIdentity(current)!==id)throw Error('The move replaced the note identity.');
    const snapshot=readThreadSnapshot(await this.access.api('/api/orchestration/threads/'+this.thread));
    const prompts=snapshot.thread.messages.filter((message:any)=>message.role==='user').map((message:any)=>message.text);
    if(prompts.length!==2||prompts[1].includes('NOTE_MOVE_FIRST_OK')||prompts.some((text:string)=>text.includes('t3-note-id')))throw Error('Source coverage or identity exclusion failed.');
    await this.shot('same-thread-after-offline-move.png');
    fs.writeFileSync(path.join(this.root,'SAVED-NOTE.md'),current);
    this.write('RESULT.json',{checks:{realFirstDelivery:true,fileRename:true,folderRename:true,fileMove:true,missedMoveRecoveredBeforeDefaultSend:true,sameThreadInOneToOne:true,stableIdPreserved:true,onlyNewSourceSent:true,identityExcludedFromPrompts:true},threadId:this.thread,first,second,previousPath:oldPath,currentPath:file.path,noteId:id,prompts,failures:this.failures,coverage:'Real native desktop editor and two bounded T3 deliveries in an isolated test vault. Missed rename event simulated; no real Sync transport or native mobile coverage claimed.'});
    await this.cleanup();
  }
  private async cleanup(){
    if(this.tick!==undefined)window.clearInterval(this.tick);this.device?.dispose();let remainingThreadIds:string[]=[];
    try{
      if(this.thread){
        await this.access?.close?.();this.access=await desktopThreadAccess(desktopDefaults());
        const snapshot=readMetadataSnapshot(await this.access.api('/api/orchestration/threads/'+this.thread+'?controlOnly=true'));
        for(const run of snapshot.thread.runs??[])if(run.status==='running'||run.status==='waiting')await this.access.api('/api/orchestration/dispatch',{type:'thread.turn.interrupt',commandId:crypto.randomUUID(),threadId:this.thread,turnId:run.id,createdAt:new Date().toISOString()});
        await this.access.api('/api/orchestration/dispatch',{type:'thread.delete',commandId:crypto.randomUUID(),threadId:this.thread});
        try{if(!(readMetadataSnapshot(await this.access.api('/api/orchestration/threads/'+this.thread+'?controlOnly=true'))).thread.deletedAt)remainingThreadIds.push(this.thread);}catch(error){if((error as any)?.status!==404)remainingThreadIds.push(this.thread);}
      }
    }catch(error){this.failures.push(String(error));if(this.thread)remainingThreadIds.push(this.thread);}
    await this.access?.close?.();
    for(const leaf of this.app.workspace.getLeavesOfType('markdown'))leaf.detach();
    for(const file of this.app.vault.getMarkdownFiles())await this.app.vault.delete(file);
    this.write('CLEANUP.json',{temporaryThreadIds:this.thread?[this.thread]:[],remainingThreadIds,remainingNotes:this.app.vault.getMarkdownFiles().map(file=>file.path),failures:this.failures});
    new Notice('Move test cleanup complete.');await pause(250);require('@electron/remote').app.quit();
  }
}
