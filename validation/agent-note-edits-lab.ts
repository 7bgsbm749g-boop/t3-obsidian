import {Plugin,MarkdownView,setIcon} from 'obsidian';
import SendToT3 from '../main';
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
import {localStageCommand,localStagedDraft} from '../local-response-staging';
import {loadSmartSend,rememberNoteEdits,rememberResponse,prepareSmartSend,confirmSmartSend,smartDestination} from '../smart-send';
import {obsidianFooter} from '../obsidian-prompt';
import {configureBridge,sendRequest} from '../bridge';
import type {ResponseRequest} from '../response-model';
import type {ThreadAccess} from '../thread-stream';
const fs=require('node:fs'),path=require('node:path');
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

/** Real staged native note write followed by one bounded Smart Send delivery.
 * Uses synthetic content in a private unsynced vault and deletes all fixtures. */
export default class AgentNoteEditsLab extends Plugin {
  private root='';private access?:ThreadAccess;private threadId?:string;private stagingPath?:string;
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
  private write(name:string,value:unknown){fs.writeFileSync(path.join(this.root,name),JSON.stringify(value,null,2));}
  private async until(check:()=>Promise<boolean>|boolean,label:string,timeout=90_000){const deadline=Date.now()+timeout;do{if(await check())return;await pause(100);}while(Date.now()<deadline);throw Error('Timed out: '+label);}
  private async run(){
    const connection=desktopDefaults(),environmentId=await desktopEnvironment(connection);this.access=await desktopThreadAccess(connection);
    const api=(route:string,payload?:any)=>this.access!.api(route.startsWith('/api/')?route:'/api/orchestration/'+route,payload);
    const subject:any=new SendToT3(this.app,this.manifest);
    subject.settings={connection,vaultId:'synthetic-agent-note-edits',projects:[],directProjects:[],folderLinks:[],vaultLocations:[],paired:[{id:'synthetic-vps',name:'Synthetic VPS',environmentId:'synthetic-remote',url:'https://synthetic.invalid'}],vaultHost:{connectionId:'synthetic-vps',environmentId:'synthetic-remote',workspaceRoot:'/synthetic-remote-vault'}};
    configureBridge({mobile:false,localAccess:()=>subject.desktopAccess()});
    const health=await subject.refreshLocalNoProject();await subject.desktopAccess();this.write('LOCAL-HEALTH.json',{environmentId:health,expected:environmentId});
    const readProject=subject.readNoProjectProject.bind(subject);
    subject.readNoProjectProject=async(connection:any,signal?:AbortSignal)=>{
      const started=performance.now();
      try{const project=await readProject(connection,signal);this.write('ROUTE-'+connection.host+'.json',{elapsedMs:performance.now()-started,project});return project;}
      catch(error){this.write('ROUTE-'+connection.host+'.json',{elapsedMs:performance.now()-started,error:String(error)});throw error;}
    };
    const routingStarted=performance.now();
    const {project}=await subject.noProjectTarget(),routingMs=performance.now()-routingStarted;
    const localHost=await subject.localResponseTarget({connection:subject.connection(project)});
    const actualRoot=(this.app.vault.adapter as any).getFullPath('');
    if(project.connectionId||localHost.workspaceRoot!==actualRoot||localHost.environmentId!==environmentId)throw Error('The real No project route or staged edit host was not local.');
    const requestId=crypto.randomUUID(),messageId=uuid5(requestId,'message'),id=crypto.randomUUID(),note='Agent note edits.md';
    this.threadId=uuid5(requestId,'thread');this.write('TEMPORARY-T3.json',{threadId:this.threadId,notePath:note,requestId});
    const native=nativeResponses(this.app),notes=deviceNoteIO(this.app),smart=loadSmartSend(undefined),stored=new Map<string,string>();let records:any={};
    const files={read:async(name:string)=>stored.get(name),write:async(name:string,value:string)=>{stored.set(name,value);}};
    const persist=()=>this.write('SMART-SEND.json',smart);
    this.local=new LocalResponseManager('agent-note-edits-lab','synthetic-agent-note-edits',{
      ...notes,localBindings:()=>responseBindingRequests(records),saveLocalBinding:async request=>{records=updateResponseBindingData(records,request,'lab');},
      openedNotes:()=>this.app.workspace.getLeavesOfType('markdown').map(leaf=>leaf.view as MarkdownView).filter(view=>view.file).map(view=>({path:view.file!.path,document:native.view(view)?.recoveryDocument()??view.getViewData()})),syncReady:()=>true,
      localFinalDraft:(document,request)=>localStagedDraft(document,request,files),
      rememberNoteEdits:async(request,before,after)=>{await rememberNoteEdits(smart,request.notePath,request.id,before,after);persist();},
      rememberResponse:async(request,body,before,after,offset)=>{await rememberResponse(smart,request.notePath,request.id,body,before,after,offset);persist();},
      receiveCoordinated:record=>native.receive(record),receiveDirect:update=>native.stream(update),localCompleted:(key,target)=>native.localCompleted(key,target),completionFailed:error=>this.errors.push(String(error)),access:()=>desktopThreadAccess(connection),
    },deviceFinalNoteIO(this.app,()=>true));
    this.timer=window.setInterval(()=>{native.refresh();this.local?.tick();},100);
    const initial='# Agent note edits\n\nInitial user text.\n\nOld wording.\n\n'+responseAnchor(id)+'\n\nUser tail.\n';
    const file=await this.app.vault.create(note,initial),leaf=this.app.workspace.getLeaf(false);await leaf.openFile(file);await leaf.setViewState({type:'markdown',state:{file:note,mode:'source',source:false}});
    const binding:ResponseRequest={version:4,localOnly:true,nativeProjection:true,responseContainer:true,independent:true,id,initialOwner:crypto.randomUUID(),vaultId:'synthetic-agent-note-edits',host:localHost,notePath:note,threadId:this.threadId,messageId,projectId:project.id,threadEnvironmentId:environmentId,initialHash:contentHash(''),createdAt:new Date().toISOString(),intermediateMode:'collapse',threadTitle:'Synthetic agent note edits'};
    await this.local.register(binding);
    const target=smartDestination(environmentId,project.id,this.threadId),first=await prepareSmartSend(smart,note,target,initial);
    const stage=await localStageCommand('stage-note-edit',binding,initial,files);this.stagingPath=stage.stagingPath;
    fs.writeFileSync(this.stagingPath!,initial.replace('Old wording.','Agent first line.\nAgent final line.'));
    const submitted=await localStageCommand('submit-note-edit',binding,initial,files,stage.originalHash);
    if(!submitted.request)throw Error('The checked staging command did not return its binding.');
    records=updateResponseBindingData(records,submitted.request,'lab');this.local.resume();
    const deliveryStarted=performance.now();
    await sendRequest({id:requestId,project,connection:{...subject.connection(project),stateDir:path.join(this.root,'t3-state')},title:'Synthetic agent note edits '+requestId.slice(0,8),prompt:'This is a bounded synthetic plugin test. Do not inspect or edit files, delegate, or use tools. Source note:\n'+first.text+'\nReply exactly NOTE_EDIT_FINAL_OK.'});
    const deliveryMs=performance.now()-deliveryStarted;
    confirmSmartSend(smart,requestId,target,first.capture,[id]);persist();
    await this.until(()=>this.local!.status(id)?.finalSaved===true,'checked staged note and final reply save');
    const saved=await this.app.vault.read(file),view=leaf.view as MarkdownView,visible=view.editor.getValue();
    const user='NOTE_EDIT_USER_FOLLOWUP: Reply exactly NOTE_EDIT_FOLLOWUP_OK.';
    view.editor.replaceRange('Agent first line.\n'+user,view.editor.offsetToPos(view.editor.getValue().indexOf('Agent first line.')),view.editor.offsetToPos(view.editor.getValue().indexOf('Agent first line.')+'Agent first line.'.length));
    await view.save();const current=await this.app.vault.read(file);
    const reloaded=loadSmartSend(JSON.parse(fs.readFileSync(path.join(this.root,'SMART-SEND.json'),'utf8'))),plan=await prepareSmartSend(reloaded,note,target,current);
    const followRequest=crypto.randomUUID(),followMessage=uuid5(followRequest,'message');
    if(plan.text.trim()!==user)throw Error('Smart Send did not isolate the user follow-up: '+JSON.stringify(plan.text));
    await start(api,{requestId:followRequest,project:project.id,threadId:this.threadId,title:'Synthetic agent note edits',prompt:plan.text+obsidianFooter(this.app.vault.getName(),note)},path.join(this.root,'t3-state'));
    const snapshot=await api('threads/'+this.threadId),state=applyThreadItem({messages:[],activities:[]},{kind:'snapshot',snapshot}).state;
    const delivered=state.messages.find(message=>message.id===followMessage)?.text??'';
    const shell=await api('shell');
    const checks={localNoProjectDefault:!project.connectionId,nativeNoProjectThread:snapshot.thread.projectId===project.id,localStagingHost:localHost.workspaceRoot===actualRoot,noVaultRootProject:!shell.projects.some((item:any)=>item.workspaceRoot===actualRoot),stagedEditSaved:saved.includes('Agent first line.\nAgent final line.'),realFinalSaved:saved.includes('NOTE_EDIT_FINAL_OK'),visibleEdit:visible.includes('Agent first line.')&&visible.includes('NOTE_EDIT_FINAL_OK'),userTailKept:saved.includes('User tail.'),provenancePersisted:Object.keys(reloaded.noteEdits??{}).length>0,onlyUserAdditionPrepared:plan.text.trim()===user,realFollowupAccepted:delivered.includes(user),agentTextNotEchoed:!delivered.includes('Agent first line.')&&!delivered.includes('Agent final line.')&&!delivered.includes('NOTE_EDIT_FINAL_OK'),noErrors:this.errors.length===0};
    this.write('RESULT.json',{checks,routingMs,deliveryMs,project,localHost,threadId:this.threadId,messageId:followMessage,prepared:plan.text,delivered,saved,errors:this.errors,coverage:'Real local No project thread through the production send bridge and warmed local credential cache, with a remote vault connection configured; checked local staging protocol, native Obsidian editor/file save, settings reload, and real Smart Send follow-up delivery in a separate unsynced test vault. Unit checks cover silent remote fallback. No remote Sync or native mobile coverage.'});
    await subject.localDesktopAccess?.dispose();
    fs.writeFileSync(path.join(this.root,'saved-and-filtered.png'),(await require('@electron/remote').getCurrentWebContents().capturePage()).toPNG());
    if(Object.values(checks).some(pass=>!pass))throw Error('The agent note edit checks failed.');
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
    if(this.stagingPath)fs.rmSync(path.dirname(this.stagingPath),{recursive:true,force:true});
    this.write('CLEANUP.json',{temporaryThreadIds:this.threadId?[this.threadId]:[],remainingThreadIds,remainingNotes:this.app.vault.getMarkdownFiles().map(file=>file.path),errors:this.errors});
    await pause(250);require('@electron/remote').app.quit();
  }
}
