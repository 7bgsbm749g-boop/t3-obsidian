import {beginLogin,pollLogin,refreshAccount,discoverMachines,connectMachine,type CloudAccount,type DeviceLogin,type CloudMachine} from './cloud';
import {beginEmailLogin,verifyEmailLogin,nativeRelayAccount,revokeNativeAccount,type NativeAccount,type EmailLogin} from './native-account';
import {pair,readDirect,commandId,environmentApi,endpoint,type PairedConnection,type PairedSession} from './direct';
import { App, Menu, MenuItem, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder, MarkdownView, Platform, FuzzySuggestModal, getAllTags, type Editor, type MarkdownFileInfo, MarkdownRenderChild } from 'obsidian';
import { Buffer } from 'buffer';
import { deviceState } from './device-state';
import { downloadImage,nativeAccountFetch } from './network';
import { collectImages, imageReferenceDefinitions, MAX_IMAGE_BYTES } from './images';
import { applyOrchestration, OrchestrationSettings } from './orchestration';
import { CompletionSettings, CompletionJob, CompletionAction, archiveFolder, contentHash, completionState, isOriginalCompletedTurn, cleanCompletedNote } from './completion';
import { Connection, Project, Request, RequestDeliveryError, parseProjects, runBridge, sendRequest, configureBridge, retiredConnection, RETIRED_MESSAGE, projectKey, projectLabel } from './bridge';
import {loadFolderLinks,upsertFolderLink,folderLinkForPath,sameWorkspacePath,type FolderLink} from './folder-link';
import {installPaletteChat,type PaletteChatController} from './palette-chat';
import {openChatFlow,openNoteSendFlow,type ChatHost} from './chat-ui';
import {selectionRange} from './inline-steering';
import {projectThreads,type ThreadChoice} from './thread-target';
import {lastUsedNoteThread,loadNoteThreads,mergeNoteThreads,previousNoteThreads,type NoteThread} from './note-threads';
import {installFolderIndicators,type FolderIndicatorController} from './folder-indicator';
import {connectVaultRemote,loadVaultLocations,vaultIdentity,vaultRegistration,waitForVaultNote,type VaultLocation,type VaultRegistration} from './vault-connection';
import {VaultSetupModal,VaultSetupCancelled,type VaultMachine} from './vault-setup-ui';
import {ObservationEngine,type ObservedNote} from './observation-engine';
import {RemoteJournalFiles} from './remote-journal';
import {releaseHash,validateWorkflowIR,type WorkflowIR} from './automation-ir';
import {folderWorkflowIR,folderForWorkflow,runnableFolderWorkflow} from './v2-folder-workflow';
import {WORKFLOW_SETUP_FOLDER,workflowSetupPath,workflowSetupRequestPath,workflowSetupPrompt,workflowSetupRequest,validateWorkflowSetupProposal} from './workflow-setup-request';
import {workflowSetupThreadId,workflowEditPath,workflowEditRequestPath,workflowEditPrompt,workflowEditDocument,validateWorkflowEditProposal,loadWorkflowEditRequests,mergeWorkflowEditRequests,type WorkflowEditRequest} from './workflow-edit-request';
import {DurableExecutionDriver} from './execution-driver';
import {exactHash} from './automation-protocol';
import type {ImmutablePlan,ExecutionEntry} from './execution-journal';
import {CoordinatorService} from './coordinator-service';
import {DeterministicWorkflowRuntime,noteSnapshot,type RuntimeRelease} from './workflow-runtime';
import {observationInterest} from './observation-interest';
import {mergeWorkflowDrafts} from './workflow-drafts';
import {DeviceInlineManager} from './leased-inline';
import {deviceNoteIO} from './inline-note-io';
import {importReplyAsset} from './reply-import';
import {InlineChatManager,captureEditorSelection,type InlineJob} from './inline-chat';
import {handoffInline,hostedPaths,type InlineHostTarget,type InlineFiles} from './hosted-inline';
import {leasePaths,type LeaseRecord} from './inline-lease';
import {installMobileSelectionAction} from './mobile-selection-action';
import {hiddenInlineMarkerExtension} from './inline-markers';
import {activeInlineIds,endMarker,failedInlineIds,regionBody,startMarker,type SelectionAnchor} from './inline-thread';
import {QuestionController} from './question-controller';
import {QuestionModal,questionButton,questionEditorExtension} from './question-ui';
import {questionTargets,parseQuestionToken,clearResolvedQuestion,type QuestionTarget} from './questions';
import {settlementState,type ThreadSettlementJob} from './thread-settlement';
type EditorChatContext={editor:Editor;view:MarkdownView|MarkdownFileInfo;anchor?:SelectionAnchor};
const INLINE_REPLY_INSTRUCTION='Answer in the T3 thread. The Obsidian plugin will insert your reply.';
const THREAD_REPLY_INSTRUCTION='Answer in the T3 thread.';
const NEW_FOLDER_PROJECT='folder:new';
const VAULT_PROJECT='vault:root';
interface InlineStreamingSettings {enabled:boolean;keepIntermediate:boolean}
type PreparedNote={content:string;images:Awaited<ReturnType<typeof collectImages>>};
interface AutomationSettings {destinationId:string;coordinatorDeviceId:string}
interface Settings { paired:PairedConnection[];directProjects:Project[];directSelected:string[];directScanId:string; connection: Connection; projects: Project[]; selected: string[]; pending: Request[]; orchestration: OrchestrationSettings; inlineStreaming:InlineStreamingSettings; completion: CompletionSettings; completionJobs: CompletionJob[]; settlementJobs:ThreadSettlementJob[];autoSettleThreads:boolean; folderLinks:FolderLink[];noteThreads:NoteThread[];vaultId:string;vaultLocations:VaultLocation[];automation:AutomationSettings;automationDrafts:WorkflowIR[];workflowEditRequests:WorkflowEditRequest[] }
export default class SendToT3 extends Plugin {
  declare settings: Settings;
  mode: 'desktop'|'direct' = 'desktop';
  private pairedSessions:Record<string,PairedSession>={};
  cloudAccount:CloudAccount|null=null;
  nativeAccount:NativeAccount|null=null;
  emailLogin:EmailLogin|null=null;
  connecting=false;
  connectionSyncComplete=false;
  machineErrors:Record<string,string>={};
  private nativeToken:CloudAccount|undefined;
  private nativeRefreshing:Promise<CloudAccount>|undefined;
  private sessionRefreshing=new Map<string,Promise<PairedSession>>();
  private machineRefreshing:Promise<void>|undefined;
  private refreshRun=0;
  cloudLogin:DeviceLogin|null=null;
  cloudMachines:CloudMachine[]=[];
  cloudError='';
  cloudChanged:(()=>void)|undefined;
  private cloudTimer:ReturnType<typeof setTimeout>|undefined;
  private cloudGeneration=0;
  private cloudRefreshing:Promise<CloudAccount>|undefined;
  private readonly localKey = 'send-to-t3-code-device-v1';
  private readonly chatDraftKey = 'send-to-t3-code-chat-draft-v1';
  private deviceId = '';
  private streamId = '';
  private coordinatorAssignmentId = '';
  busy = false;
  scanError = '';
  private monitoring = false;
  private stopped = false;
  private saving = Promise.resolve();
  private sharedBaseline='';
  private lastDiskSnapshot='';
  private checkingExternalSettings=false;
  private checkingWorkflowProposals=false;
  private proposalErrors=new Map<string,string>();
  private recentFolderGesture?:{path:string;at:number};
  private paletteChat?:PaletteChatController;
  private folderIndicators?:FolderIndicatorController;
  private vaultSetup?:Promise<Project>;
  private vaultSetupModal?:VaultSetupModal;
  private vaultRegistrations:Record<string,VaultRegistration>={};
  private observationEngine?:ObservationEngine;
  private remoteJournal?:RemoteJournalFiles;
  private retiringJournal?:Promise<void>;
  private coordinatorService?:CoordinatorService;
  private coordinatorTimer?:number;
  private journalFiles?:{exists(path:string):Promise<boolean>;read(path:string):Promise<string>;write(path:string,data:string):Promise<void>;mkdir(path:string):Promise<void>;list(path:string):Promise<{files:string[];folders:string[]}>};
  private metadataPending=new WeakSet<TFile>();
  private inlineChat?:InlineChatManager;
  private questions?:QuestionController;
  private questionModal?:QuestionModal;
  private questionPaths=new Set<string>();
  private refreshingQuestions=false;
  private deviceInline?:DeviceInlineManager;
  private inlineActor=randomId();
  private inlineTargets:InlineHostTarget[]=[];
  private inlineHostService?:import('./hosted-inline-desktop').DesktopInlineHost;
  private inlineHostKey='';
  private inlineHostRefresh?:Promise<void>;
  private inlineEnvironment?:Promise<string>;
  private mobileSelectionAction?:{dispose():void};
  async onload() {
    const data = await this.loadData();
    this.lastDiskSnapshot=JSON.stringify(data);
    const local = this.app.loadLocalStorage(this.localKey);
    this.deviceId=local?.deviceId??randomId();
    this.streamId=local?.automationStreamId??randomId();
    this.coordinatorAssignmentId=local?.coordinatorAssignmentId??randomId();
    const state=await deviceState(this.deviceId);
    const defaults:Connection = Platform.isMobile ? {executable:'',host:'local'} : (await import('./desktop')).desktopDefaults();
    this.mode=Platform.isMobile||local?.mode!=='desktop'?'direct':'desktop';
    this.pairedSessions=local?.pairedSessions??{};
    this.cloudAccount=local?.cloudAccount??null;
    this.nativeAccount=local?.nativeAccount??null;
    this.vaultRegistrations=local?.vaultRegistrations??{};
    const automationDrafts:WorkflowIR[]=[];for(const candidate of Array.isArray(data?.automationDrafts)?data.automationDrafts:[])try{automationDrafts.push(validateWorkflowIR(candidate));}catch{/* Invalid synced drafts stay inert. */}
    this.settings = {paired:data?.paired??[],directProjects:data?.directProjects??[],directSelected:data?.directSelected??[],directScanId:data?.directScanId??'',connection:local?.connection??data?.connection??defaults,projects:data?.projects??[],selected:data?.selected??[],pending:state?.pending??(!Platform.isMobile?data?.pending:[])??[],orchestration:{waitForOtherThreads:data?.orchestration?.waitForOtherThreads === true},inlineStreaming:{enabled:data?.inlineStreaming?.enabled??(data?.inlineStreaming?.askT3!==false&&data?.inlineStreaming?.sendToT3!==false),keepIntermediate:data?.inlineStreaming?.keepIntermediate===true},completion:{action:['archive','delete'].includes(data?.completion?.action)?data.completion.action:'keep',archiveFolder:data?.completion?.archiveFolder ?? 'Archive/T3 Code'},completionJobs:state?.completionJobs??(!Platform.isMobile?data?.completionJobs:[])??[],settlementJobs:Array.isArray(state?.settlementJobs)?state.settlementJobs:[],autoSettleThreads:data?.autoSettleThreads!==false,folderLinks:loadFolderLinks(data),noteThreads:loadNoteThreads(data?.noteThreads),vaultId:vaultIdentity(data)??randomId(),vaultLocations:loadVaultLocations(data),automation:{destinationId:typeof data?.automation?.destinationId==='string'?data.automation.destinationId:'qlo2-vps',coordinatorDeviceId:typeof data?.automation?.coordinatorDeviceId==='string'?data.automation.coordinatorDeviceId:''},automationDrafts,workflowEditRequests:loadWorkflowEditRequests(data?.workflowEditRequests)};
    let migratedNoteThreads=false;
    for(const job of this.settings.completionJobs){
      if(this.noteThread(job.notePath)||typeof this.app.vault?.getAbstractFileByPath!=='function'||!(this.app.vault.getAbstractFileByPath(job.notePath) instanceof TFile))continue;
      const project=[...this.settings.directProjects,...this.settings.projects].find(item=>item.id===job.projectId&&(item.connectionId??'')===(job.connection.connectionId??''));
      if(!project)continue;
      this.settings.noteThreads.push({notePath:job.notePath,threadId:job.threadId,projectId:project.id,workspaceRoot:project.workspaceRoot,connectionId:project.connectionId??'',...(job.connection.environmentId?{environmentId:job.connection.environmentId}:{}),selectedAt:new Date().toISOString()});
      migratedNoteThreads=true;
    }
    this.inlineChat=new InlineChatManager(this.app,`${this.localKey}-inline-${this.settings.vaultId}`,id=>this.sessionFor(id),{prepare:(job,request)=>this.prepareHostedInline(job,request),stop:job=>this.stopHostedInline(job.id,job.hostTarget)},()=>this.settings.inlineStreaming.keepIntermediate);
    const storedTargets=this.app.loadLocalStorage(`${this.localKey}-inline-hosts-${this.settings.vaultId}`);
    if(Array.isArray(storedTargets))this.inlineTargets=storedTargets.filter(target=>target&&typeof target.environmentId==='string'&&typeof target.workspaceRoot==='string'&&typeof target.directory==='string');
    this.deviceInline=new DeviceInlineManager(this.inlineActor,this.settings.vaultId,{...deviceNoteIO(this.app),access:environmentId=>this.inlineThreadAccess(environmentId),importReplyAsset:(reference,request,access)=>importReplyAsset(this.app,reference,request,access)},target=>this.inlineHostFiles(target));
    const questionStorage=`${this.localKey}-questions-${this.settings.vaultId}`;
    this.questions=new QuestionController(environmentId=>this.inlineThreadAccess(environmentId),{load:()=>{const saved=this.app.loadLocalStorage(questionStorage);return Array.isArray(saved)?saved:[];},save:records=>this.app.saveLocalStorage(questionStorage,records)},randomId);
    const questionPaths=this.app.loadLocalStorage(`${questionStorage}-paths`);if(Array.isArray(questionPaths))for(const path of questionPaths)if(typeof path==='string')this.questionPaths.add(path);
    if(typeof this.registerEditorExtension==='function'){this.registerEditorExtension(hiddenInlineMarkerExtension());this.registerEditorExtension(questionEditorExtension(this.questions,target=>this.openQuestion(target)));}
    if(typeof this.registerMarkdownPostProcessor==='function')this.registerMarkdownPostProcessor((element,ctx)=>{
      for(const link of Array.from(element.querySelectorAll<HTMLAnchorElement>('a[href^="t3-question:"]'))){
        const target=parseQuestionToken((link.getAttribute('href')??'').slice('t3-question:'.length));if(!target)continue;
        const control=questionButton(this.questions!,target,value=>this.openQuestion(value));link.replaceWith(control.button);
        const child=new MarkdownRenderChild(control.button);child.register(control.unsubscribe);ctx.addChild(child);
        this.questionPaths.add(ctx.sourcePath);
      }
    });
    this.addCommand({id:'answer-t3-question',name:'Answer T3 question…',checkCallback:checking=>{
      const view=this.app.workspace.getActiveViewOfType(MarkdownView);const targets=view?questionTargets(view.editor?.getValue()??''):[];
      if(!targets.length)return false;if(!checking)this.openQuestion(targets[0]);return true;
    }});
    this.app.workspace.onLayoutReady(()=>{void this.refreshQuestions();this.registerInterval(window.setInterval(()=>void this.refreshQuestions(),1500));});
    if(Platform.isMobile&&typeof document.addEventListener==='function'){
      this.mobileSelectionAction=installMobileSelectionAction(this.app,()=>this.app.workspace.getActiveViewOfType(MarkdownView),()=>!this.busy,captureEditorSelection,({editor,view,text,anchor})=>this.openEditorChat(text,view.file!,{editor,view,anchor}));
    }
    this.sharedBaseline=JSON.stringify(this.sharedSnapshot());
    if(!Platform.isMobile && !this.settings.connection.native){
      const old=this.settings.connection;
      this.settings.connection=defaults;
      if(old.host!=='local')this.mode='direct';
    }
    // Version 1.4 delivery is retired. Preserve completion tracking for its
    // already accepted threads; never automatically resend an old queued note.
    for(const entry of state?.queued??[]){
      if(!entry.superseded && entry.completion?.action!=='keep' && entry.completion && !this.settings.completionJobs.some(j=>j.requestId===entry.id))
        this.settings.completionJobs.push({...entry.completion,requestId:entry.id,threadId:entry.threadId,projectId:entry.project.id,connection:entry.connection,status:'watching'});
    }
    const migrateConnection=(c:Connection):Connection=>!retiredConnection(c)&&c.transport!=='direct'&&!c.native?{...this.settings.connection,host:'local',transport:'desktop'}:c;
    for(const request of this.settings.pending)request.connection=migrateConnection(request.connection);
    for(const job of this.settings.completionJobs){job.connection=migrateConnection(job.connection);if(retiredConnection(job.connection)&&job.status==='watching'){job.status='kept';job.detail='Kept note: the companion mode was removed. Check the original thread in T3.';}}
    this.settings.settlementJobs=this.settings.settlementJobs.filter(job=>job&&typeof job.requestId==='string'&&typeof job.messageId==='string'&&typeof job.threadId==='string'&&typeof job.projectId==='string'&&job.connection&&!retiredConnection(job.connection)).map(job=>({...job,connection:migrateConnection(job.connection)}));
    configureBridge({mobile:Platform.isMobile,pairedSession:id=>this.sessionFor(id),saveRequest:async request=>{if(!this.settings.pending.includes(request))throw Error('Saved request is missing. Nothing was sent.');await this.save();}});
    // Migrate unfinished desktop requests once, but do not rewrite the shared
    // settings file merely because this device started. Credentials and jobs
    // are device-local.
    await this.saveDeviceState();
    // A new vault must publish its stable identity before another device can
    // verify the same vault root. This is a one-time migration, not an
    // unconditional startup snapshot write, and uses the conflict-safe path.
    if(typeof data?.vaultId!=='string'||!data.vaultId)await this.save(true);
    else if(migratedNoteThreads)await this.save(true);
    this.addSettingTab(new T3Settings(this.app,this));
    this.app.workspace.onLayoutReady(()=>{
      if(this.stopped)return;
      if(Platform.isMobile&&typeof document!=='undefined'&&typeof this.registerDomEvent==='function'){
        const remember=(event:Event)=>{const target=event.target,title=target instanceof Element?target.closest('.nav-folder-title[data-path]'):null,path=title?.getAttribute('data-path');this.recentFolderGesture=path?{path,at:Date.now()}:undefined;};
        this.registerDomEvent(document,'pointerdown',remember,true);
        this.registerDomEvent(document,'touchstart',remember,true);
      }
      this.paletteChat=installPaletteChat(this.app,(prompt,selection)=>this.openPaletteAction(prompt,selection),{onError:error=>new Notice(`T3 Code: ${message(error)}`,10000),getDraft:()=>this.app.loadLocalStorage(this.chatDraftKey)??'',saveDraft:draft=>this.app.saveLocalStorage(this.chatDraftKey,draft),getSelection:()=>this.app.workspace.getActiveViewOfType(MarkdownView)?.editor?.getSelection()??''});
      this.registerInterval(window.setInterval(()=>this.paletteChat?.reconcile(),2000));
      if(typeof document!=='undefined'&&document.body&&typeof MutationObserver!=='undefined')this.folderIndicators=installFolderIndicators(document.body,()=>this.settings.folderLinks,()=>this.workflowFolders());
      void this.startObservationJournal().then(()=>this.retireLegacyWorkflowFolders()).catch(error=>new Notice(`T3 automation journal: ${message(error)}`,12000));
      this.registerInterval(window.setInterval(()=>void this.retireLegacyWorkflowFolders().catch(error=>new Notice(`T3 automation cleanup: ${message(error)}`,12000)),30_000));
      this.registerInterval(window.setInterval(()=>void this.checkExternalSettings().catch(error=>new Notice(`T3 workflow settings: ${message(error)}`,12000)),5000));
      this.registerInterval(window.setInterval(()=>void this.checkWorkflowProposals().catch(error=>new Notice(`T3 workflow setup: ${message(error)}`,12000)),5000));
    });
    this.app.workspace.onLayoutReady(()=>{if(!this.stopped){if(this.nativeAccount)void this.refreshMachines().catch(e=>{this.cloudError=message(e);this.cloudChanged?.();});void this.monitorCompletions();this.registerInterval(window.setInterval(()=>{void this.monitorCompletions();},30_000));}});
    this.app.workspace.onLayoutReady(()=>this.inlineChat?.resume());
    this.app.workspace.onLayoutReady(()=>{
      const tick=()=>{this.deviceInline?.tick();this.deviceInline?.discover(this.inlineTargets);};
      tick();this.registerInterval(window.setInterval(tick,150));
      const remember=()=>{if(this.settings.folderLinks.some(link=>link.folderPath==='/'))void this.inlineHostTarget().then(target=>this.rememberInlineTarget(target)).catch(()=>{});};
      remember();this.registerInterval(window.setInterval(remember,5000));
    });
    if(!Platform.isMobile)this.app.workspace.onLayoutReady(()=>{
      const tick=()=>void this.refreshInlineHost().then(()=>this.inlineHostService?.tick()).catch(()=>{/* The durable job retries after the host reconnects. */});
      tick();this.registerInterval(window.setInterval(tick,1500));
    });
    this.registerEvent(this.app.workspace.on('file-open',()=>this.inlineChat?.flushAvailable()));
    this.registerEvent(this.app.workspace.on('layout-change',()=>this.inlineChat?.flushAvailable()));
    if(typeof this.app.vault?.on==='function'){
      this.registerEvent(this.app.vault.on('rename',(file,oldPath)=>this.inlineChat?.renamed(oldPath,file.path)));
      this.registerEvent(this.app.vault.on('rename',(file,oldPath)=>{this.inlineHostService?.renamed(oldPath,file.path);this.deviceInline?.renamed(oldPath,file.path);}));
      this.registerEvent(this.app.vault.on('delete',file=>{this.inlineChat?.deleted(file.path);this.questionPaths.delete(file.path);}));
      this.registerEvent(this.app.vault.on('modify',file=>{if(file instanceof TFile&&file.extension==='md')void this.app.vault.read(file).then(text=>{if(questionTargets(text).length)this.questionPaths.add(file.path);}).catch(()=>{});}));
      this.registerEvent(this.app.vault.on('rename',(file,oldPath)=>{for(const path of [...this.questionPaths])if(path===oldPath||path.startsWith(oldPath+'/')){this.questionPaths.delete(path);this.questionPaths.add(file.path+path.slice(oldPath.length));}}));
      this.registerEvent(this.app.vault.on('rename',(file,oldPath)=>{void (async()=>{const moved=this.settings.noteThreads.filter(entry=>!entry.deletedAt&&(entry.notePath===oldPath||file instanceof TFolder&&entry.notePath.startsWith(oldPath+'/')));if(!moved.length)return;const stamp=new Date().toISOString();this.settings.noteThreads=mergeNoteThreads(this.settings.noteThreads,moved.map(entry=>({...entry,deletedAt:stamp})),moved.map(entry=>({...entry,notePath:file.path+entry.notePath.slice(oldPath.length)})));await this.save();})().catch(error=>new Notice(`T3 thread history: ${message(error)}`,10000));}));
      this.registerEvent(this.app.vault.on('delete',file=>{void (async()=>{const stamp=new Date().toISOString(),affected=this.settings.noteThreads.filter(entry=>entry.notePath===file.path||file instanceof TFolder&&entry.notePath.startsWith(file.path+'/'));if(!affected.length)return;this.settings.noteThreads=this.settings.noteThreads.map(entry=>affected.includes(entry)?{...entry,deletedAt:stamp}:entry);await this.save();})().catch(error=>new Notice(`T3 thread history: ${message(error)}`,10000));}));
    }
    this.registerEvent(this.app.workspace.on('file-menu',(menu,file,source) => {
      if(file instanceof TFolder){
        const folder=this.folderForMenu(file);
        menu.addItem(item=>{item.setTitle('Link to T3 Code').setIcon('link');const submenu=(item as MenuItem&{setSubmenu?:()=>Menu}).setSubmenu?.();if(!submenu){item.onClick(()=>new FolderLinkProjectModal(this.app,this,folder).open());return;}const selected=this.projects().filter(p=>this.selected().includes(projectKey(p)));for(const project of selected)submenu.addItem(i=>i.setTitle(`Link to ${projectLabel(project)}`).onClick(()=>void this.linkFolder(folder,project,false)));submenu.addSeparator();submenu.addItem(i=>i.setTitle('Link to self (create T3 project)').onClick(()=>void this.linkFolderToSelf(folder)));if(!selected.length&&Platform.isMobile)submenu.addItem(i=>i.setTitle('Select a project in settings').setDisabled(true));});
        menu.addItem(item=>{
          item.setTitle('Setup T3 workflow').setIcon('workflow');
          const submenu=(item as MenuItem&{setSubmenu?:()=>Menu}).setSubmenu?.();
          if(!submenu){item.onClick(()=>this.openV2WorkflowSetup(folder));return;}
          for(const workflow of this.settings.automationDrafts.filter(ir=>folderForWorkflow(ir)===folder.path))submenu.addItem(i=>i.setTitle(workflow.name??workflow.workflowId).setIcon(workflow.enabled?'workflow':'pause').onClick(()=>this.openV2WorkflowSetup(folder,workflow)));
          const link=folderLinkForPath(this.settings.folderLinks,`${folder.path}/placeholder.md`);
          for(const workflow of this.settings.automationDrafts.filter(ir=>ir.enabled&&folder.path!=='/'&&ir.folderPath!==folder.path&&ir.scope.path.glob.startsWith(`${folder.path}/`)&&ir.projectId===link?.projectId&&ir.connectionId===link?.connectionId))submenu.addItem(i=>i.setTitle(`Move workflow here: ${workflow.name??workflow.workflowId}`).setIcon('folder-input').onClick(()=>this.moveV2WorkflowToFolder(workflow,folder).catch(error=>new Notice(message(error),10000))));
          submenu.addItem(i=>i.setTitle('Setup new workflow…').setIcon('plus').onClick(()=>this.openV2WorkflowSetup(folder)));
        });
        return;
      }
      if (!(file instanceof TFile) || file.extension.toLowerCase() !== 'md' || (!Platform.isMobile && source !== 'file-explorer-context-menu')) return;
      menu.addItem(item => {
        item.setTitle('Open in T3 Code').setIcon('send');
        item.setDisabled(this.busy).onClick(()=>this.openNoteSend(file));
      });
    }));
    this.registerEvent(this.app.workspace.on('editor-menu',(menu,editor,view)=>{
      const selection=editor.getSelection();
      const file=view.file;
      if(!file||file.extension.toLowerCase()!=='md')return;
      const targets=questionTargets(editor.getValue());
      if(targets.length)menu.addItem(item=>item.setTitle('Answer T3 question…').setIcon('message-circle-question').onClick(()=>this.openQuestion(targets[0])));
      const active=this.inlineChat?.activeFor(file.path)??[];
      const failed=active.find(job=>job.phase==='error')?.id??failedInlineIds(editor.getValue())[0];
      if(failed){
        menu.addItem(item=>item.setTitle('Continue T3 response').setIcon('rotate-cw').setDisabled(this.busy).onClick(()=>this.continueInline(failed,file.path).catch(error=>new Notice(`T3: ${message(error)}`,12000))));
        menu.addItem(item=>item.setTitle('Attach latest T3 continuation').setIcon('link').setDisabled(this.busy).onClick(()=>{void this.attachInline(failed,file.path).catch(error=>new Notice(`T3: ${message(error)}`,12000));}));
      }else if(active.length)menu.addItem(item=>item.setTitle('Stop T3 response').setIcon('square').setDisabled(!active[0].threadId).onClick(()=>{void this.inlineChat?.stop(active[0]).catch(error=>new Notice(`T3: ${message(error)}`,10000));}));
      else {const hostedId=activeInlineIds(editor.getValue())[0];if(hostedId)menu.addItem(item=>item.setTitle('Stop T3 response').setIcon('square').onClick(()=>{void this.stopHostedInline(hostedId).catch(error=>new Notice(`T3: ${message(error)}`,10000));}));}
      if(!selection.trim())return;
      let anchor:SelectionAnchor;
      try{anchor=captureEditorSelection(editor);}catch{return;}
      menu.addItem(item=>item.setTitle('Ask T3 Code').setIcon('message-circle').setDisabled(this.busy).onClick(()=>this.openEditorChat(selection,file,{editor,view,anchor})));
    }));
  }
  private openQuestion(target:QuestionTarget){
    if(!this.questions)return;
    this.questionModal?.close();this.questionModal=new QuestionModal(this.app,this.questions,target);this.questionModal.open();
  }
  private async refreshQuestions(){
    if(this.stopped||this.refreshingQuestions||!this.questions)return;this.refreshingQuestions=true;
    try{
      for(const leaf of this.app.workspace.getLeavesOfType('markdown')){const view=leaf.view as MarkdownView;if(view.file)this.questionPaths.add(view.file.path);}
      const io=deviceNoteIO(this.app),notes=new Map<string,QuestionTarget[]>();
      for(const path of this.questionPaths){const text=await io.readNote(path),targets=text===undefined?[]:questionTargets(text);if(targets.length)notes.set(path,targets);else this.questionPaths.delete(path);}
      await this.questions.refresh([...notes.values()].flat());
      for(const [path,targets] of notes){
        const resolved=targets.filter(target=>this.questions!.view(target).status==='resolved');
        if(resolved.length)await io.updateNote(path,current=>resolved.reduce((text,target)=>clearResolvedQuestion(text,target),current),()=>!this.stopped);
      }
      this.app.saveLocalStorage(`${this.localKey}-questions-${this.settings.vaultId}-paths`,[...this.questionPaths]);
    }catch{/* Notes, authentication, and Sync are retried on the next refresh. */}finally{this.refreshingQuestions=false;}
  }
  private captureSignature='';
  private factsFor(file:TFile):Record<string,unknown>{
    const cache=this.app.metadataCache.getFileCache(file) as any;
    const frontmatter={...(cache?.frontmatter??{})};delete (frontmatter as any).position;
    return {frontmatter,tags:cache?(getAllTags(cache)??[]):[]};
  }
  private async readObservedNote(file:TFile):Promise<ObservedNote>{
    return {path:file.path,content:await this.app.vault.read(file),facts:this.factsFor(file)};
  }
  private async startObservationJournal(){
    this.journalFiles=this.app.vault.adapter as NonNullable<typeof this.journalFiles>;
    const capture=(source:'vault.create'|'vault.modify'|'metadata.changed'|'vault.rename'|'vault.delete',path:string,oldPath?:string)=>
      observationInterest(this.settings.automationDrafts).accepts(source,path,oldPath);
    this.registerEvent(this.app.vault.on('create',file=>{if(file instanceof TFile&&observationInterest(this.settings.automationDrafts).baseline(file.path)){
      this.metadataPending.add(file);const engine=this.observationEngine;
      if(engine)void this.readObservedNote(file).then(note=>capture('vault.create',file.path)?engine.observe('vault.create',note):engine.seed(note)).catch(error=>new Notice(message(error)));
    }}));
    this.registerEvent(this.app.vault.on('modify',file=>{if(file instanceof TFile&&capture('vault.modify',file.path)){
      this.metadataPending.add(file);const engine=this.observationEngine;
      if(engine)void this.readObservedNote(file).then(note=>engine.observe('vault.modify',note)).catch(error=>new Notice(message(error)));
    }}));
    this.registerEvent(this.app.metadataCache.on('changed',file=>{if(file instanceof TFile&&this.metadataPending.has(file)){
      this.metadataPending.delete(file);const engine=this.observationEngine;
      if(engine&&capture('metadata.changed',file.path))void this.readObservedNote(file).then(note=>engine.observe('metadata.changed',note)).catch(error=>new Notice(message(error)));
    }}));
    this.registerEvent(this.app.vault.on('rename',(file,oldPath)=>{void (async()=>{
      if(file instanceof TFolder){
        let updated=false;
        for(const link of this.settings.folderLinks)if(link.folderPath===oldPath||link.folderPath.startsWith(oldPath+'/')){link.folderPath=file.path+link.folderPath.slice(oldPath.length);updated=true;}
        for(const ir of this.settings.automationDrafts)if(ir.folderPath&&(ir.folderPath===oldPath||ir.folderPath.startsWith(oldPath+'/'))){
          const previous=ir.folderPath,next=file.path+previous.slice(oldPath.length),oldRoot=previous==='/'?'':`${previous}/`,newRoot=next==='/'?'':`${next}/`;
          ir.folderPath=next;ir.scope.path.glob=newRoot+ir.scope.path.glob.slice(oldRoot.length);ir.revision++;updated=true;
        }
        if(updated){await this.save();await this.refreshObservationCapture();}
        const engine=this.observationEngine;
        if(engine)for(const note of this.app.vault.getMarkdownFiles())if(note.path.startsWith(file.path+'/')&&capture('vault.rename',note.path,oldPath+note.path.slice(file.path.length)))await engine.rename(oldPath+note.path.slice(file.path.length),await this.readObservedNote(note));
      }else if(file instanceof TFile&&capture('vault.rename',file.path,oldPath))await this.observationEngine?.rename(oldPath,await this.readObservedNote(file));
    })().catch(error=>new Notice(message(error)));}));
    this.registerEvent(this.app.vault.on('delete',file=>{const engine=this.observationEngine;if(!engine)return;
      if(file instanceof TFile){if(capture('vault.delete',file.path))void engine.delete(file.path).catch(error=>new Notice(message(error)));}
      else if(file instanceof TFolder)void engine.deletePrefix(file.path,path=>capture('vault.delete',path)).catch(error=>new Notice(message(error)));
    }));
    this.registerInterval(window.setInterval(()=>{
      if(this.observationEngine)void this.observationEngine.flush();
      else if(observationInterest(this.settings.automationDrafts).active)void this.refreshObservationCapture().catch(error=>new Notice(`T3 automation journal: ${message(error)}`,12000));
    },30_000));
    await this.refreshObservationCapture();
  }
  private async refreshObservationCapture(){
    if(!this.journalFiles)return;
    const interest=observationInterest(this.settings.automationDrafts);
    const signature=JSON.stringify(this.settings.automationDrafts.filter(ir=>ir.enabled).map(ir=>({id:ir.workflowId,scope:ir.scope,trigger:ir.trigger})));
    if(signature===this.captureSignature){await this.restartCoordinator();return;}
    this.coordinatorService?.stop();this.coordinatorService=undefined;
    if(this.coordinatorTimer!==undefined){window.clearInterval(this.coordinatorTimer);this.coordinatorTimer=undefined;}
    this.observationEngine?.stop();this.observationEngine=undefined;
    this.remoteJournal?.close();this.remoteJournal=undefined;
    this.journalFiles=this.app.vault.adapter as NonNullable<typeof this.journalFiles>;
    if(!interest.active){this.captureSignature=signature;return;}
    if(Platform.isMobile){
      if(!this.settings.automation.coordinatorDeviceId||this.settings.automation.coordinatorDeviceId===this.deviceId)throw Error('Set up the workflow on the linked desktop before capturing phone events.');
      const ir=this.settings.automationDrafts.find(draft=>draft.enabled&&draft.connectionId),connectionId=ir?.connectionId;
      const paired=this.settings.paired.find(item=>item.id===connectionId);
      const root=paired&&(this.settings.folderLinks.find(item=>item.folderPath==='/'&&(item.connectionId===paired.id||item.environmentId===paired.environmentId))?.workspaceRoot??this.settings.vaultLocations.find(item=>item.environmentId===paired.environmentId)?.workspaceRoot);
      if(!paired||!root)throw Error('The workflow destination vault is not connected on this device.');
      const connection:Connection={transport:'direct',host:'direct',executable:'',url:paired.url,environmentId:paired.environmentId,connectionId:paired.id};
      const remote=this.remoteJournal=new RemoteJournalFiles(root,async()=>connectVaultRemote(connection,await this.sessionFor(paired.id)));
      this.journalFiles={exists:path=>remote.exists(path),read:path=>remote.read(path),write:(path,data)=>remote.write(path,data),mkdir:path=>remote.mkdir(path),list:async()=>{throw Error('The coordinator scans workflow files on the destination machine.');}};
    }
    this.streamId=randomId();await this.saveDeviceState();
    const engine=this.observationEngine=new ObservationEngine({vaultId:this.settings.vaultId,deviceId:this.deviceId,streamId:this.streamId,publish:true,files:this.journalFiles,report:error=>new Notice(`T3 automation journal: ${error}`,12000)});
    const files=this.app.vault.getMarkdownFiles().filter(file=>interest.baseline(file.path));
    try{await engine.initialize(await Promise.all(files.map(file=>this.readObservedNote(file))),false);await this.restartCoordinator();this.captureSignature=signature;}
    catch(error){engine.stop();this.observationEngine=undefined;this.remoteJournal?.close();this.remoteJournal=undefined;throw error;}
  }
  private async retireLegacyWorkflowFolders():Promise<void>{
    if(this.stopped)return;
    if(this.retiringJournal)return this.retiringJournal;
    this.retiringJournal=(async()=>{for(const path of ['T3 Automation','T3 Workflow Setup']){const folder=this.app.vault.getAbstractFileByPath(path);if(folder instanceof TFolder)await this.app.vault.delete(folder,true);}})().finally(()=>{this.retiringJournal=undefined;});
    await this.retiringJournal;
  }
  private async restartCoordinator(){this.coordinatorService?.stop();this.coordinatorService=undefined;if(this.coordinatorTimer!==undefined){window.clearInterval(this.coordinatorTimer);this.coordinatorTimer=undefined;}const engine=this.observationEngine,files=this.journalFiles;if(!engine||!files||this.settings.automation.coordinatorDeviceId!==this.deviceId)return;const runtime=new DeterministicWorkflowRuntime(engine.store,{currentNote:async(noteId,path)=>{let baseline=await engine.store.getBaseline(noteId);if((!baseline||baseline.tombstone)&&path)baseline=(await engine.store.baselines()).find(item=>item.path===path&&!item.tombstone);if(!baseline||baseline.tombstone)return;const file=this.app.vault.getAbstractFileByPath(baseline.path);if(!(file instanceof TFile))return;return noteSnapshot(noteId,baseline.incarnationId,baseline.path,await this.app.vault.read(file));},environmentId:destinationId=>destinationId,now:()=>new Date(),id:()=>randomId()},this.settings.vaultId),releases=():RuntimeRelease[]=>this.settings.automationDrafts.filter(runnableFolderWorkflow).map((ir,index)=>({ir,hash:releaseHash(ir),activatedAt:ir.activatedAt??new Date(0).toISOString(),activationSequence:index+1}));const driver=new DurableExecutionDriver(engine.store,{createThread:plan=>this.sendV2Plan(plan),startTurn:async()=>{},poll:(plan,threadId)=>this.pollV2Plan(plan,threadId),apply:async()=>{throw Error('Validated note application is not available in the folder workflow editor.');},emit:async()=>{throw Error('Event emission is not available in the folder workflow editor.');},now:()=>new Date().toISOString()}),service=this.coordinatorService=new CoordinatorService({driver,canExecute:()=>observationInterest(this.settings.automationDrafts).active&&!this.stopped,vaultId:this.settings.vaultId,assignment:{destinationId:this.settings.automation.destinationId,assignmentId:this.coordinatorAssignmentId,installationId:this.deviceId,epoch:1,active:true},store:engine.store,files,runtime,releases,report:error=>new Notice(`T3 automation coordinator: ${error}`,12000)});await service.initialize();await service.scan();this.coordinatorTimer=window.setInterval(()=>void service.scan().catch(error=>new Notice(`T3 automation coordinator: ${message(error)}`,12000)),30_000);}
  openV2WorkflowSetup(folder:TFolder,workflow?:WorkflowIR){
    const link=folderLinkForPath(this.settings.folderLinks,`${folder.path}/placeholder.md`);
    if(!link){new Notice('Link this folder (or a parent folder) to T3 Code before creating a workflow.',10000);return;}
    new V2FolderWorkflowModal(this.app,this,folder,link,workflow).open();
  }
  private folderForMenu(file:TFolder):TFolder{
    const gesture=this.recentFolderGesture;
    if(!Platform.isMobile||file.path!=='/'||!gesture||Date.now()-gesture.at>3000)return file;
    const folder=this.app.vault.getAbstractFileByPath(gesture.path);
    return folder instanceof TFolder?folder:file;
  }
  async saveV2Workflow(ir:WorkflowIR){
    validateWorkflowIR(ir);
    if(ir.enabled&&!runnableFolderWorkflow(ir))throw Error('Only a linked-folder T3 editing workflow can be enabled from this editor. Recreate older experimental definitions from the folder menu.');
    const before=this.settings.automationDrafts,index=before.findIndex(item=>item.workflowId===ir.workflowId),next=[...before];
    if(ir.enabled&&(!before[index]?.enabled||releaseHash(before[index])!==releaseHash(ir)))ir.activatedAt=new Date().toISOString();
    if(index<0)next.push(ir);else next[index]=ir;
    this.settings.automationDrafts=next;
    const priorAutomation=this.settings.automation;
    if(ir.enabled&&this.settings.automation.coordinatorDeviceId!==this.deviceId)this.settings.automation={...priorAutomation,coordinatorDeviceId:this.deviceId};
    try{await this.save();await this.refreshObservationCapture();await this.coordinatorService?.scan();this.refreshFolderIndicators();}catch(error){this.settings.automationDrafts=before;this.settings.automation=priorAutomation;throw error;}
  }
  async moveV2WorkflowToFolder(ir:WorkflowIR,folder:TFolder){
    const current=this.settings.automationDrafts.find(item=>item.workflowId===ir.workflowId);
    const link=folderLinkForPath(this.settings.folderLinks,`${folder.path}/placeholder.md`);
    if(!current||!current.enabled||current.revision!==ir.revision||folder.path==='/'||!current.scope.path.glob.startsWith(`${folder.path}/`)||current.projectId!==link?.projectId||current.connectionId!==link?.connectionId)throw Error('The workflow or folder link changed. Reopen the folder menu and try again.');
    await this.saveV2Workflow({...current,folderPath:folder.path,revision:current.revision+1});
    new Notice(`Workflow “${current.name??current.workflowId}” is now attached to ${folder.path}.`,10000);
  }
  async setupV2Workflow(folder:TFolder,link:FolderLink,intent:string,workflowId=randomId()):Promise<string>{
    if(this.busy)throw Error('Another T3 request is in progress.');
    if(this.settings.automationDrafts.some(ir=>ir.workflowId===workflowId))throw Error('This workflow already exists. Open it to request a change.');
    const description=intent.trim();if(!description||description.length>100_000)throw Error('Describe what the workflow should do in 100,000 characters or fewer.');
    const project=this.projectForLink(link),readiness=this.projectReadinessError(project);if(readiness)throw Error(readiness);
    const connection=this.connection(project);
    const rootLink=this.settings.folderLinks.find(item=>item.folderPath==='/'&&(!item.vaultId||item.vaultId===this.settings.vaultId)&&(item.connectionId===project.connectionId||item.environmentId===connection.environmentId));
    const vaultRoot=rootLink?.workspaceRoot??this.settings.vaultLocations.find(item=>item.environmentId===connection.environmentId)?.workspaceRoot;
    if(!vaultRoot)throw Error('Connect this vault to the selected machine before setting up a workflow.');
    const settingsRelativePath=`${this.app.vault.configDir||'.obsidian'}/plugins/${this.manifest.id}/data.json`;
    if(connection.transport==='direct'){
      const session=await this.sessionFor(connection.connectionId??'');if(!session||session.expiresAt<=Date.now())throw Error('Sign in or pair this connection before creating a workflow.');
      const remote=await connectVaultRemote(connection,session);
      try{if(!await remote.matches(vaultRoot,settingsRelativePath,this.settings.vaultId))throw Error('The destination vault mapping no longer matches this vault. Reconnect it in settings.');}
      finally{remote.close();}
    }
    const name=description.split(/\r?\n/,1)[0].replace(/\s+/g,' ').slice(0,160)||`${folder.name} workflow`;
    const requestId=randomId();
    const draft=folderWorkflowIR({id:workflowId,name,folderPath:folder.path,includeSubfolders:true,events:['create','modify'],task:description,destinationId:this.settings.automation.destinationId,projectId:link.projectId,connectionId:link.connectionId,enabled:false,order:this.settings.automationDrafts.length});
    draft.setupIntent=description;
    draft.setupRequestId=requestId;
    const separator=vaultRoot.includes('\\')&&!vaultRoot.includes('/')?'\\':'/';
    const proposalPath=vaultRoot.replace(/[\\/]+$/,'')+separator+workflowSetupPath(draft).replace(/\//g,separator);
    const requestPath=workflowSetupRequestPath(draft);
    const fullRequestPath=vaultRoot.replace(/[\\/]+$/,'')+separator+requestPath.replace(/\//g,separator);
    const requestDocument=workflowSetupRequest({vaultRoot,folderPath:folder.path,proposalPath,draft});
    const prompt=workflowSetupPrompt({intent:description,folderPath:folder.path,requestPath:fullRequestPath});
    const request:Request={id:requestId,project:{...project},title:`Set up workflow: ${name}`.slice(0,160),prompt:applyOrchestration(prompt,this.settings.orchestration),connection};
    if(request.prompt.length>120_000)throw Error('The workflow description is too long to send to T3.');
    this.busy=true;
    let requestSaved=false,requestWritten=false;
    try{
      if(!this.settings.automation.coordinatorDeviceId){
        if(Platform.isMobile)throw Error('Start the first workflow from the linked desktop so it can coordinate events from this vault.');
        this.settings.automation={...this.settings.automation,coordinatorDeviceId:this.deviceId};
      }
      await this.saveV2Workflow(draft);
      if(connection.transport==='direct'){
        const remote=await connectVaultRemote(connection,await this.sessionFor(connection.connectionId??''));
        try{if(await remote.readFile(vaultRoot,requestPath)!==undefined)throw Error('A workflow setup request with this ID already exists.');await remote.writeFile(vaultRoot,requestPath,requestDocument);if(await remote.readFile(vaultRoot,requestPath)!==requestDocument)throw Error('The workflow setup request could not be verified on the destination.');requestWritten=true;}
        finally{remote.close();}
      }else{
        const adapter=this.app.vault.adapter;
        let parent='';for(const part of WORKFLOW_SETUP_FOLDER.split('/')){parent=parent?`${parent}/${part}`:part;if(!await adapter.exists(parent))await adapter.mkdir(parent);}
        if(await adapter.exists(requestPath))throw Error('A workflow setup request with this ID already exists.');
        await adapter.write(requestPath,requestDocument);requestWritten=true;
      }
      this.settings.pending.push(request);
      try{await this.save();requestSaved=true;}catch(error){this.settings.pending=this.settings.pending.filter(item=>item!==request);throw error;}
      return await this.dispatch(request);
    }catch(error){
      if(requestWritten&&!requestSaved)try{
        if(connection.transport==='direct'){const remote=await connectVaultRemote(connection,await this.sessionFor(connection.connectionId??''));try{await remote.deleteFile(vaultRoot,requestPath);}finally{remote.close();}}
        else await this.app.vault.adapter.remove(requestPath);
      }catch{/* The unsent request file can be removed when the draft is deleted. */}
      throw error;
    }
    finally{this.busy=false;}
  }
  async editV2Workflow(folder:TFolder,link:FolderLink,existing:WorkflowIR,change:string):Promise<string>{
    if(this.busy)throw Error('Another T3 request is in progress.');
    const current=this.settings.automationDrafts.find(ir=>ir.workflowId===existing.workflowId);
    if(!current||current.revision!==existing.revision||releaseHash(current)!==releaseHash(existing))throw Error('This workflow changed. Reopen it before requesting an edit.');
    if(!current.enabled)throw Error('Finish setting up this workflow in its T3 thread before editing it.');
    if(current.folderPath!==folder.path)throw Error('The workflow folder changed. Reopen its folder menu.');
    if(this.settings.workflowEditRequests.some(item=>item.workflowId===current.workflowId))throw Error('A change request is already in progress for this workflow. Finish or cancel it before sending another.');
    const threadId=workflowSetupThreadId(current);
    if(!threadId)throw Error('This workflow has no linked setup thread. Recreate it from the folder menu.');
    const description=change.trim();if(!description||description.length>100_000)throw Error('Describe the workflow change in 100,000 characters or fewer.');
    const project=this.projectForLink(link),readiness=this.projectReadinessError(project);if(readiness)throw Error(readiness);
    if(current.projectId!==project.id||current.connectionId!==project.connectionId)throw Error('The workflow destination no longer matches this folder link. Restore its link before editing.');
    const connection=this.connection(project);
    const rootLink=this.settings.folderLinks.find(item=>item.folderPath==='/'&&(!item.vaultId||item.vaultId===this.settings.vaultId)&&(item.connectionId===project.connectionId||item.environmentId===connection.environmentId));
    const vaultRoot=rootLink?.workspaceRoot??this.settings.vaultLocations.find(item=>item.environmentId===connection.environmentId)?.workspaceRoot;
    if(!vaultRoot)throw Error('Connect this vault to the selected machine before editing its workflow.');
    if(connection.transport==='direct'){
      const remote=await connectVaultRemote(connection,await this.sessionFor(connection.connectionId??''));
      try{if(!await remote.matches(vaultRoot,`${this.app.vault.configDir||'.obsidian'}/plugins/${this.manifest.id}/data.json`,this.settings.vaultId))throw Error('The destination vault mapping no longer matches this vault. Reconnect it in settings.');}
      finally{remote.close();}
    }
    await this.verifyWorkflowSetupThread(connection,project.id,threadId);
    const request:WorkflowEditRequest={requestId:randomId(),workflowId:current.workflowId,baseRevision:current.revision,requestedAt:new Date().toISOString()};
    const requestPath=workflowEditRequestPath(request),proposalPath=workflowEditPath(request);
    const separator=vaultRoot.includes('\\')&&!vaultRoot.includes('/')?'\\':'/';
    const absolute=(path:string)=>vaultRoot.replace(/[\\/]+$/,'')+separator+path.replace(/\//g,separator);
    const document=workflowEditDocument({vaultRoot,folderPath:folder.path,proposalPath:absolute(proposalPath),current,request});
    const prompt=workflowEditPrompt({change:description,folderPath:folder.path,requestPath:absolute(requestPath)});
    const turn:Request={id:request.requestId,project:{...project},title:`Edit workflow: ${current.name??current.workflowId}`.slice(0,160),prompt:applyOrchestration(prompt,this.settings.orchestration),connection,threadId};
    if(turn.prompt.length>120_000)throw Error('The workflow change is too long to send to T3.');
    this.busy=true;
    let requestWritten=false,pendingSaved=false;
    try{
      this.settings.workflowEditRequests.push(request);
      try{await this.save();}catch(error){this.settings.workflowEditRequests=this.settings.workflowEditRequests.filter(item=>item!==request);throw error;}
      const fresh=this.settings.automationDrafts.find(ir=>ir.workflowId===current.workflowId);
      if(!fresh||releaseHash(fresh)!==releaseHash(current))throw Error('This workflow changed on another device. Reopen it before requesting an edit.');
      if(connection.transport==='direct'){
        const remote=await connectVaultRemote(connection,await this.sessionFor(connection.connectionId??''));
        try{if(await remote.readFile(vaultRoot,requestPath)!==undefined)throw Error('This workflow edit request already exists.');await remote.writeFile(vaultRoot,requestPath,document);if(await remote.readFile(vaultRoot,requestPath)!==document)throw Error('The workflow edit request could not be verified on the destination.');requestWritten=true;}
        finally{remote.close();}
      }else{
        const adapter=this.app.vault.adapter;
        let parent='';for(const part of WORKFLOW_SETUP_FOLDER.split('/')){parent=parent?`${parent}/${part}`:part;if(!await adapter.exists(parent))await adapter.mkdir(parent);}
        if(await adapter.exists(requestPath))throw Error('This workflow edit request already exists.');
        await adapter.write(requestPath,document);requestWritten=true;
      }
      this.settings.pending.push(turn);
      try{await this.save();pendingSaved=true;}catch(error){this.settings.pending=this.settings.pending.filter(item=>item!==turn);throw error;}
      return await this.dispatch(turn,true);
    }catch(error){
      if(!pendingSaved){
        this.settings.workflowEditRequests=this.settings.workflowEditRequests.filter(item=>item.requestId!==request.requestId);
        try{await this.save();}catch(cleanupError){new Notice(`T3 workflow edit cleanup: ${message(cleanupError)}`,12000);}
        if(requestWritten)try{
          if(connection.transport==='direct'){const remote=await connectVaultRemote(connection,await this.sessionFor(connection.connectionId??''));try{await remote.deleteFile(vaultRoot,requestPath);}finally{remote.close();}}
          else await this.app.vault.adapter.remove(requestPath);
        }catch(cleanupError){new Notice(`T3 workflow edit cleanup: ${message(cleanupError)}`,12000);}
      }
      throw error;
    }finally{this.busy=false;}
  }
  private async verifyWorkflowSetupThread(connection:Connection,projectId:string,threadId:string):Promise<void>{
    const thread=await runBridge(connection,['read',threadId]);
    if(thread?.id!==threadId||thread.projectId!==projectId||thread.archivedAt||thread.deletedAt)throw Error('The original setup thread is no longer available in the linked T3 project.');
  }
  async removeV2Workflow(ir:WorkflowIR){
    const before=this.settings.automationDrafts,beforeEdits=this.settings.workflowEditRequests,beforePending=this.settings.pending;
    const edits=beforeEdits.filter(item=>item.workflowId===ir.workflowId);
    this.settings.automationDrafts=before.filter(item=>item.workflowId!==ir.workflowId);
    this.settings.workflowEditRequests=beforeEdits.filter(item=>item.workflowId!==ir.workflowId);
    this.settings.pending=beforePending.filter(item=>!edits.some(edit=>edit.requestId===item.id));
    try{await this.save();await this.refreshObservationCapture();this.refreshFolderIndicators();}catch(error){this.settings.automationDrafts=before;this.settings.workflowEditRequests=beforeEdits;this.settings.pending=beforePending;throw error;}
    if(ir.setupRequestId||edits.length){
      const paths=[...(ir.setupRequestId?[workflowSetupRequestPath(ir),workflowSetupPath(ir)]:[]),...edits.flatMap(edit=>[workflowEditRequestPath(edit),workflowEditPath(edit)])];
      const paired=this.settings.paired.find(item=>item.id===ir.connectionId);
      const root=paired&&(this.settings.folderLinks.find(item=>item.folderPath==='/'&&(item.connectionId===paired.id||item.environmentId===paired.environmentId))?.workspaceRoot??this.settings.vaultLocations.find(item=>item.environmentId===paired.environmentId)?.workspaceRoot);
      if(paired&&root){
        try{const remote=await connectVaultRemote({transport:'direct',host:'direct',executable:'',url:paired.url,environmentId:paired.environmentId,connectionId:paired.id},await this.sessionFor(paired.id));try{for(const path of paths)if(await remote.readFile(root,path)!==undefined)await remote.deleteFile(root,path);}finally{remote.close();}}
        catch(error){new Notice(`Workflow removed, but its setup file could not be deleted: ${message(error)}`,12000);}
      }else for(const path of paths)try{if(await this.app.vault.adapter.exists(path))await this.app.vault.adapter.remove(path);}catch(error){new Notice(`Workflow removed, but its setup file could not be deleted: ${message(error)}`,12000);}
    }
  }
  async cancelV2WorkflowEdit(ir:WorkflowIR):Promise<void>{
    const edit=this.settings.workflowEditRequests.find(item=>item.workflowId===ir.workflowId);
    if(!edit)return;
    const before=this.settings.workflowEditRequests,beforePending=this.settings.pending;
    this.settings.workflowEditRequests=before.filter(item=>item.requestId!==edit.requestId);
    this.settings.pending=beforePending.filter(item=>item.id!==edit.requestId);
    try{await this.save();}catch(error){this.settings.workflowEditRequests=before;this.settings.pending=beforePending;throw error;}
    const paths=[workflowEditRequestPath(edit),workflowEditPath(edit)];
    const paired=this.settings.paired.find(item=>item.id===ir.connectionId);
    const root=paired&&(this.settings.folderLinks.find(item=>item.folderPath==='/'&&(item.connectionId===paired.id||item.environmentId===paired.environmentId))?.workspaceRoot??this.settings.vaultLocations.find(item=>item.environmentId===paired.environmentId)?.workspaceRoot);
    try{
      const adapter=this.app.vault.adapter;
      if(await adapter.exists(paths[0])){
        for(const path of paths)if(await adapter.exists(path))await adapter.remove(path);
      }else if(paired&&root){
        // T3 exposes remote writes but no file deletion. The coordinator consumes this marker.
        const remote=await connectVaultRemote({transport:'direct',host:'direct',executable:'',url:paired.url,environmentId:paired.environmentId,connectionId:paired.id},await this.sessionFor(paired.id));
        try{await remote.writeFile(root,paths[0],JSON.stringify({schemaVersion:1,kind:'workflow.edit.cancelled',workflowId:edit.workflowId,editRequestId:edit.requestId}));}finally{remote.close();}
      }
    }catch(error){new Notice(`Workflow change cancelled, but its setup file could not be deleted: ${message(error)}`,12000);}
  }
  paletteChatStatus(){return this.paletteChat?.status??'unavailable';}
  workflowFolders(){return this.settings.automationDrafts.map(ir=>folderForWorkflow(ir)??(ir.scope.path.glob.split(/[*?]/,1)[0].replace(/\/$/,'')||'/'));}
  refreshFolderIndicators(){this.folderIndicators?.refresh();}
  private async checkExternalSettings(){
    if(this.stopped||this.checkingExternalSettings)return;
    this.checkingExternalSettings=true;
    try{await this.saving;const data=await this.loadData(),serialized=JSON.stringify(data);if(serialized!==this.lastDiskSnapshot)await this.onExternalSettingsChange(data);}
    finally{this.checkingExternalSettings=false;}
  }
  private async checkWorkflowProposals(){
    if(this.stopped||this.checkingWorkflowProposals||this.settings.automation.coordinatorDeviceId!==this.deviceId)return;
    this.checkingWorkflowProposals=true;
    try{
      await this.saving;
      const adapter=this.app.vault.adapter;
      if(!await adapter.exists(WORKFLOW_SETUP_FOLDER))return;
      const paths=(await adapter.list(WORKFLOW_SETUP_FOLDER)).files.filter(path=>path.endsWith('.json')).sort();
      for(const path of paths.filter(path=>path.endsWith('.request.json'))){
        let marker:any;
        try{marker=JSON.parse(await adapter.read(path));}catch{continue;}
        if(marker?.kind!=='workflow.edit.cancelled'||typeof marker.workflowId!=='string'||typeof marker.editRequestId!=='string')continue;
        const request:WorkflowEditRequest={requestId:marker.editRequestId,workflowId:marker.workflowId,baseRevision:1,requestedAt:new Date(0).toISOString()};
        if(!loadWorkflowEditRequests([request]).length)continue;
        if(workflowEditRequestPath(request)!==path)continue;
        const before=this.settings.workflowEditRequests;
        if(before.some(item=>item.requestId===request.requestId&&item.workflowId===request.workflowId)){
          this.settings.workflowEditRequests=before.filter(item=>item.requestId!==request.requestId||item.workflowId!==request.workflowId);
          try{await this.save();}catch(error){this.settings.workflowEditRequests=before;throw error;}
        }
        const proposalPath=workflowEditPath(request);
        if(await adapter.exists(proposalPath))await adapter.remove(proposalPath);
        await adapter.remove(path);
      }
      for(const path of paths){
        if(!await adapter.exists(path))continue;
        const draft=this.settings.automationDrafts.find(ir=>ir.setupRequestId&&workflowSetupPath(ir)===path);
        const edit=this.settings.workflowEditRequests.find(request=>workflowEditPath(request)===path);
        if(!draft&&!edit)continue;
        if(edit){
          try{
            const current=this.settings.automationDrafts.find(ir=>ir.workflowId===edit.workflowId);
            if(!current||!current.enabled||current.revision!==edit.baseRevision)throw Error('Workflow changed since this edit was requested. Cancel the old request and try again.');
            const requestPath=workflowEditRequestPath(edit);
            if(!await adapter.exists(requestPath))throw Error('Workflow edit instructions are missing.');
            const context=JSON.parse(await adapter.read(requestPath));
            if(context?.kind!=='workflow.edit'||context?.editRequestId!==edit.requestId||context?.current?.workflowId!==current.workflowId||releaseHash(validateWorkflowIR(context.current))!==releaseHash(current))throw Error('Workflow edit instructions do not match the current workflow.');
            const bytes=await adapter.read(path);
            if(new TextEncoder().encode(bytes).byteLength>262_144)throw Error('Workflow edit result exceeds 256 KiB.');
            const ir=validateWorkflowEditProposal(JSON.parse(bytes),current,edit);
            const before=this.settings.workflowEditRequests;
            this.settings.workflowEditRequests=before.filter(item=>item.requestId!==edit.requestId);
            try{await this.saveV2Workflow(ir);}catch(error){this.settings.workflowEditRequests=before;throw error;}
            await adapter.remove(path);if(await adapter.exists(requestPath))await adapter.remove(requestPath);
            this.proposalErrors.delete(path);
            new Notice(`Workflow “${ir.name??ir.workflowId}” was updated.`,10000);
          }catch(error){const detail=message(error);if(this.proposalErrors.get(path)!==detail){this.proposalErrors.set(path,detail);new Notice(`T3 workflow edit: ${detail}`,12000);}}
          continue;
        }
        if(!draft)continue;
        if(draft.enabled){await adapter.remove(path);this.proposalErrors.delete(path);continue;}
        const bytes=await adapter.read(path);
        try{
          if(new TextEncoder().encode(bytes).byteLength>262_144)throw Error('Workflow setup proposal exceeds 256 KiB.');
          const ir=validateWorkflowSetupProposal(JSON.parse(bytes),draft);
          await this.saveV2Workflow(ir);
          await adapter.remove(path);
          const requestPath=workflowSetupRequestPath(ir);
          if(await adapter.exists(requestPath))await adapter.remove(requestPath);
          this.proposalErrors.delete(path);
          new Notice(`Workflow “${ir.name??ir.workflowId}” is active.`,10000);
        }catch(error){
          const detail=message(error);
          if(this.proposalErrors.get(path)!==detail){this.proposalErrors.set(path,detail);new Notice(`T3 workflow setup: ${detail}`,12000);}
        }
      }
      for(const draft of this.settings.automationDrafts.filter(ir=>ir.enabled&&ir.setupRequestId)){
        const requestPath=workflowSetupRequestPath(draft);
        if(await adapter.exists(requestPath))await adapter.remove(requestPath);
      }
      if(!(await adapter.list(WORKFLOW_SETUP_FOLDER)).files.length)try{await adapter.rmdir(WORKFLOW_SETUP_FOLDER,false);}catch{/* Another proposal may be arriving. */}
    }finally{this.checkingWorkflowProposals=false;}
  }
  async onExternalSettingsChange(loaded?:any){
    await this.saving;
    const data=loaded??await this.loadData();if(this.stopped||!data)return;
    this.lastDiskSnapshot=JSON.stringify(data);
    this.settings.folderLinks=loadFolderLinks(data);
    const remoteThreads=loadNoteThreads(data.noteThreads);
    const mergedThreads=mergeNoteThreads(remoteThreads,this.settings.noteThreads);
    this.settings.noteThreads=remoteThreads;
    this.settings.autoSettleThreads=data.autoSettleThreads!==false;
    if(!this.settings.autoSettleThreads&&this.settings.settlementJobs.length){this.settings.settlementJobs=[];await this.saveDeviceState();}
    this.settings.automationDrafts=[];
    for(const candidate of Array.isArray(data.automationDrafts)?data.automationDrafts:[])try{this.settings.automationDrafts.push(validateWorkflowIR(candidate));}catch{/* Invalid definitions remain inert. */}
    this.settings.automation={destinationId:data?.automation?.destinationId??'qlo2-vps',coordinatorDeviceId:data?.automation?.coordinatorDeviceId??''};
    this.settings.workflowEditRequests=loadWorkflowEditRequests(data?.workflowEditRequests);
    this.settings.vaultId=vaultIdentity(data)??this.settings.vaultId;
    this.settings.vaultLocations=loadVaultLocations(data);
    if(Array.isArray(data.paired))this.settings.paired=data.paired;
    if(Array.isArray(data.directProjects))this.settings.directProjects=data.directProjects;
    this.sharedBaseline=JSON.stringify(this.sharedSnapshot());
    this.settings.noteThreads=mergedThreads;
    if(JSON.stringify(mergedThreads)!==JSON.stringify(remoteThreads))await this.save();
    this.refreshFolderIndicators();
    await this.refreshObservationCapture();
  }
  openSettings(){
    const settings=(this.app as App & {setting?:{open():void;openTabById(id:string):void}}).setting;
    if(settings){settings.open();settings.openTabById(this.manifest.id);}
    else new Notice('Open Settings → Send to T3 Code to sign in and select projects.');
  }
  chatReadinessError():string|undefined {
    if(this.stopped)return 'The plugin has been disabled. Re-enable it before sending.';
    if(this.mode==='desktop')return;
    const hasDeviceSession=this.settings.paired.some(c=>{const session=this.pairedSessions[c.id];return session?.environmentId===c.environmentId&&session.url===c.url&&session.expiresAt>Date.now()+5000;});
    if(hasDeviceSession)return;
    if(this.connecting)return 'T3 is still connecting your computers. Wait for connection sync to finish.';
    if(this.nativeAccount&&!this.connectionSyncComplete)return 'Refresh connections in Send to T3 Code settings before sending.';
    if(!this.nativeAccount)return 'Sign in to T3 on this device first. Synced project names do not sign this device in.';
  }
  private chatNote():{path:string;absolutePath?:string}|undefined {
    const file=this.app.workspace.getActiveViewOfType(MarkdownView)?.file??this.app.workspace.getActiveFile();
    if(!file||file.extension.toLowerCase()!=='md')return;
    return this.noteContext(file);
  }
  private noteContext(file:TFile):{path:string;absolutePath?:string} {
    const adapter=this.app.vault.adapter as {getFullPath?:(path:string)=>string};
    return {path:file.path,...(!Platform.isMobile&&typeof adapter?.getFullPath==='function'?{absolutePath:adapter.getFullPath(file.path)}:{})};
  }
  private noteThread(path?:string){return path?lastUsedNoteThread(this.settings.noteThreads,path):undefined;}
  private previousNoteThread(path:string,threadId:string){return previousNoteThreads(this.settings.noteThreads,path).find(entry=>entry.threadId===threadId);}
  private olderNoteThreads(path:string){const active=this.noteThread(path);return previousNoteThreads(this.settings.noteThreads,path).filter(entry=>entry.threadId!==active?.threadId);}
  private projectForNoteThread(entry:NoteThread):Project{
    const candidates=[...this.settings.directProjects,...this.settings.projects].filter(item=>item.id===entry.projectId&&sameWorkspacePath(item.workspaceRoot,entry.workspaceRoot)&&(!Platform.isMobile||Boolean(item.connectionId)));
    const sameConnection=candidates.find(item=>(item.connectionId??'')===entry.connectionId);
    const sameEnvironment=entry.environmentId?candidates.find(item=>this.settings.paired.find(connection=>connection.id===item.connectionId)?.environmentId===entry.environmentId):undefined;
    const project=sameConnection??sameEnvironment??(candidates.length===1?candidates[0]:undefined);
    if(!project)throw Error('The last used thread’s T3 project is unavailable on this device. Reconnect that project or choose another thread.');
    return project;
  }
  private noteThreadIntent(path:string,project:Project,connection:Connection):NonNullable<Request['noteThread']>{
    return {notePath:path,projectId:project.id,workspaceRoot:project.workspaceRoot,connectionId:project.connectionId??'',...(connection.environmentId?{environmentId:connection.environmentId}:{})};
  }
  private async editorForNoteSend(file:TFile):Promise<MarkdownView|undefined> {
    if(typeof this.app.workspace.getLeaf!=='function')return;
    const existing=this.app.workspace.getLeavesOfType('markdown').map(leaf=>leaf.view).find(view=>view instanceof MarkdownView && view.file?.path===file.path);
    if(existing instanceof MarkdownView)return existing;
    const leaf=this.app.workspace.getLeaf('tab');
    await leaf.openFile(file);
    if(!(leaf.view instanceof MarkdownView)||leaf.view.file?.path!==file.path)throw Error('The note could not be opened in a Markdown editor for inline streaming.');
    return leaf.view;
  }
  private projectForLink(link:FolderLink):Project {
    if(link.connectionId){
      const connection=this.settings.paired.find(c=>c.id===link.connectionId)||this.settings.paired.find(c=>c.environmentId===link.environmentId);
      const project=this.settings.directProjects.find(p=>p.id===link.projectId&&p.connectionId===(connection?.id??link.connectionId));
      if(project)return project;
    }else{
      // A synced local link may be reachable through this device's paired catalog.
      const paired=this.settings.directProjects.filter(p=>p.id===link.projectId&&sameWorkspacePath(p.workspaceRoot,link.workspaceRoot));
      if((this.mode==='direct'||Platform.isMobile)&&paired.length===1)return paired[0];
      if(!Platform.isMobile){const project=this.settings.projects.find(p=>p.id===link.projectId);if(project)return project;}
    }
    throw Error('The linked T3 project is unavailable on this device. Refresh projects or relink the folder in settings.');
  }
  private projectReadinessError(project:Project):string|undefined {
    if(this.stopped)return 'The plugin has been disabled. Re-enable it before sending.';
    if(!project.connectionId)return Platform.isMobile?'This folder is linked to a local desktop project. Link it to a connected computer first.':undefined;
    return this.chatReadinessError();
  }
  private noteSendMenu(menu:Menu,file:TFile){
    if(this.noteThread(file.path))menu.addItem(item=>item.setTitle('Send to previous thread').setIcon('history').setDisabled(this.busy).onClick(()=>this.sendNote(file)));
    if(this.olderNoteThreads(file.path).length)menu.addItem(item=>item.setTitle('Previous threads…').setIcon('history').setDisabled(this.busy).onClick(()=>this.openPreviousNoteThreads(file)));
    menu.addItem(item=>item.setTitle('Send to new thread').setIcon('message-square-plus').setDisabled(this.busy).onClick(()=>this.sendNote(file,undefined,undefined,true)));
    menu.addItem(item=>item.setTitle('Send to existing thread…').setIcon('messages-square').setDisabled(this.busy).onClick(()=>this.openNoteThreads(file)));
  }
  openNoteSend(file:TFile){
    const host:ChatHost={...this.destinationContext(this.noteContext(file)),busy:this.busy,
      sendChat:(_text,key)=>this.sendNote(file,undefined,undefined,false,key),
      sendToNew:(_text,key)=>this.sendNote(file,undefined,undefined,true,key),
      sendToExisting:(_text,key)=>this.openNoteThreads(file,key),
      sendToPrevious:async(_text,key)=>{this.openPreviousNoteThreads(file,key);},
    };
    openNoteSendFlow(this.app,host);
  }
  private openPreviousNoteThreads(file:TFile,overrideKey?:string){new PreviousNoteThreadModal(this.app,this.olderNoteThreads(file.path).filter(entry=>!overrideKey||overrideKey===`${entry.connectionId?entry.connectionId+':':''}${entry.projectId}`),entry=>this.sendNote(file,entry.threadId,undefined,false,overrideKey)).open();}
  async openNoteThreads(file:TFile,overrideKey?:string){
    if(this.busy)return;
    try{
      const target=await this.existingTarget(file.path,overrideKey);
      if(!target){new ExistingThreadModal(this.app,[],async()=>{},'Existing threads','No project exists for this folder yet. Use New thread.').open();return;}
      const {project}=target;
      const readiness=this.projectReadinessError(project);if(readiness)throw Error(readiness);
      new Notice('Loading threads…',2000);
      const threads=projectThreads(await runBridge(this.connection(project),['threads','--project',project.id]),project.id);
      if(this.stopped)return;
      new ExistingThreadModal(this.app,threads,thread=>this.sendNote(file,thread.id,projectKey(project),false,overrideKey)).open();
    }catch(error){new Notice(`Send to T3 Code: ${message(error)}`,10000);}
  }
  async sendNote(file:TFile,threadId?:string,expectedProjectKey?:string,newThread=false,overrideKey?:string){
    if(this.busy)return;
    try{
      const active=this.app.workspace.getActiveViewOfType(MarkdownView);
      const content=active?.file?.path===file.path&&active.editor?active.editor.getValue():await this.app.vault.read(file);
      if(!content.trim()){new Notice('This note is empty. Add Markdown before sending.');return;}
      const images=await this.prepareImages(content,file.path);
      if(images.markdown.length+this.messageFooter(this.noteContext(file).absolutePath??file.path).length+(this.settings.inlineStreaming.enabled?INLINE_REPLY_INSTRUCTION.length+2:0)>120_000)throw Error('The note and image context exceed T3’s 120,000-character limit. Split the note before sending.');
      const saved=this.noteThread(file.path);
      const chosen=expectedProjectKey?undefined:threadId?this.previousNoteThread(file.path,threadId):!newThread?saved:undefined;
      const {project,link}=await this.chatTarget(file.path,chosen,Boolean(newThread||expectedProjectKey),overrideKey);
      if(expectedProjectKey&&projectKey(project)!==expectedProjectKey)throw Error('The folder’s linked project changed. Choose a thread again.');
      const readiness=this.projectReadinessError(project);if(readiness)throw Error(readiness);
      await this.send(file,project,{threadId,newThread,projectOverrideKey:overrideKey,folderPicker:Boolean(expectedProjectKey),folderLink:link,prepared:{content,images}});
    }catch(error){new Notice(`Send to T3 Code: ${message(error)}`,10000);}
  }
  openChat(prompt?:string){
    return this.openChatWithNote(this.chatNote(),prompt);
  }
  private async openPaletteAction(prompt:string,selection:string){
    const file=this.app.workspace.getActiveFile();
    if(!file||file.extension.toLowerCase()!=='md')throw Error('Open a Markdown note before using T3 Code from the command palette.');
    if(!prompt.trim()&&!selection.trim()){
      return this.openNoteSend(file);
    }
    const active=this.app.workspace.getActiveViewOfType(MarkdownView);
    const view=this.settings.inlineStreaming.enabled?(active?.file?.path===file.path?active:await this.editorForNoteSend(file)):active;
    const selected=selection.trim();
    const question=selected&&prompt.trim()?`Selected text:\n${selection}\n\nQuestion:\n${prompt}`:selected||prompt;
    let context:EditorChatContext|undefined;
    if(view?.file&&view.file.extension.toLowerCase()==='md'&&view.editor){
      context={editor:view.editor,view};
      if(selected&&view.editor.getSelection()===selection){try{context.anchor=captureEditorSelection(view.editor);}catch{/* Append when selection changed while palette was open. */}}
    }
    return this.openChatWithNote(this.noteContext(file),question,this.settings.inlineStreaming.enabled?context:undefined,true);
  }
  private openEditorChat(selection:string,file:TFile,context:EditorChatContext){
    return this.openChatWithNote(this.noteContext(file),selection,this.settings.inlineStreaming.enabled?context:undefined,true);
  }
  private needsFolderProject(notePath?:string):boolean {
    return Boolean(notePath?.includes('/')&&!folderLinkForPath(this.settings.folderLinks.filter(link=>link.folderPath!=='/'),notePath));
  }
  private destinationContext(note?:{path:string;absolutePath?:string},inline?:EditorChatContext):Pick<ChatHost,'steering'|'getNotePath'|'getProjectName'|'getTargetDescription'|'getProjectChoices'|'getDefaultThread'|'hasPreviousThreads'>{
    const projectName=(key?:string)=>{
      const link=note?folderLinkForPath(this.settings.folderLinks,note.path):this.settings.folderLinks.find(item=>item.folderPath==='/');
      if(key===VAULT_PROJECT)return this.settings.folderLinks.find(item=>item.folderPath==='/')?.projectTitle??this.app.vault.getName();
      if(key===NEW_FOLDER_PROJECT)return `New project: ${note!.path.split('/').at(-2)}`;
      if(key)return [...this.projects(),...this.settings.directProjects,...this.settings.projects].find(project=>projectKey(project)===key)?.title??'Unavailable project';
      const remembered=this.noteThread(note?.path);
      if(remembered)return [...this.settings.directProjects,...this.settings.projects].find(project=>project.id===remembered.projectId&&sameWorkspacePath(project.workspaceRoot,remembered.workspaceRoot))?.title??`T3 project ${remembered.projectId.slice(0,8)}`;
      return this.needsFolderProject(note?.path)?`New project: ${note!.path.split('/').at(-2)}`:link?.projectTitle??this.app.vault.getName();
    };
    return {
      steering:!!inline&&activeInlineIds(inline.editor.getValue()).length>0,
      getNotePath:()=>note?.path??'No note open',
      getProjectName:projectName,
      getTargetDescription:key=>`${note?.path??'No note open'} → ${projectName(key)}`,
      getProjectChoices:()=>{
        const root=this.settings.folderLinks.find(item=>item.folderPath==='/');
        return [...(this.needsFolderProject(note?.path)?[{key:NEW_FOLDER_PROJECT,label:`New project: ${note!.path.split('/').at(-2)}`}]:[]),{key:VAULT_PROJECT,label:`Vault project: ${root?.projectTitle??this.app.vault.getName()}`},...this.projects().filter(project=>!root||project.id!==root.projectId||!sameWorkspacePath(project.workspaceRoot,root.workspaceRoot)).map(project=>({key:projectKey(project),label:projectLabel(project)}))];
      },
      getDefaultThread:key=>{const remembered=this.noteThread(note?.path),job=note?this.inlineChat?.activeFor(note.path).find(job=>job.threadId&&['sending','running','reconnecting'].includes(job.phase)):undefined;return !key||remembered&&key===`${remembered.connectionId?remembered.connectionId+':':''}${remembered.projectId}`?job?.threadId??remembered?.threadId:undefined;},
      hasPreviousThreads:key=>Boolean(note&&this.olderNoteThreads(note.path).some(entry=>!key||key===`${entry.connectionId?entry.connectionId+':':''}${entry.projectId}`)),
    };
  }
  private openChatWithNote(note:{path:string;absolutePath?:string}|undefined,prompt?:string,inline?:EditorChatContext,answerOnly=false){
    const send=(text:string,options?:{threadId?:string;newThread?:boolean;expectedProjectKey?:string;projectOverrideKey?:string})=>inline&&note?this.sendInlineChat(text,note,inline,options):this.sendChat(answerOnly?`${text}\n\n${THREAD_REPLY_INSTRUCTION}`:text,note,options);
    const host:ChatHost={...this.destinationContext(note,inline),
      sendChat:(text,key)=>send(text,{projectOverrideKey:key}),
      sendToNew:(text,key)=>send(text,{newThread:true,projectOverrideKey:key}),
      sendToExisting:(text,key)=>this.openChatThreads(text,note,inline,answerOnly,key),
      sendToPrevious:(text,key)=>this.openPreviousChatThreads(text,note,inline,answerOnly,key),
    };
    return openChatFlow(this.app,host,prompt);
  }
  private async openChatThreads(prompt:string,note?:{path:string;absolutePath?:string},inline?:EditorChatContext,answerOnly=false,overrideKey?:string){
    const target=await this.existingTarget(note?.path,overrideKey);
    if(!target){new ExistingThreadModal(this.app,[],async()=>{},'Existing threads','No project exists for this folder yet. Use New thread.').open();return;}
    const {project}=target;
    const readiness=this.projectReadinessError(project);if(readiness)throw Error(readiness);
    new Notice('Loading threads…',2000);
    const threads=projectThreads(await runBridge(this.connection(project),['threads','--project',project.id]),project.id);
    if(this.stopped)return;
    new ExistingThreadModal(this.app,threads,thread=>inline&&note?this.sendInlineChat(prompt,note,inline,{threadId:thread.id,expectedProjectKey:projectKey(project),projectOverrideKey:overrideKey}):this.sendChat(answerOnly?`${prompt}\n\n${THREAD_REPLY_INSTRUCTION}`:prompt,note,{threadId:thread.id,expectedProjectKey:projectKey(project),projectOverrideKey:overrideKey}),'Ask in an existing thread','No existing threads in this project. Use New thread.').open();
  }
  private async openPreviousChatThreads(prompt:string,note?:{path:string;absolutePath?:string},inline?:EditorChatContext,answerOnly=false,overrideKey?:string){
    if(!note)return;
    const entries=this.olderNoteThreads(note.path).filter(entry=>!overrideKey||overrideKey===`${entry.connectionId?entry.connectionId+':':''}${entry.projectId}`);
    new PreviousNoteThreadModal(this.app,entries,entry=>inline?this.sendInlineChat(prompt,note,inline,{threadId:entry.threadId,projectOverrideKey:overrideKey}):this.sendChat(answerOnly?`${prompt}\n\n${THREAD_REPLY_INSTRUCTION}`:prompt,note,{threadId:entry.threadId,projectOverrideKey:overrideKey})).open();
  }
  private async sendInlineChat(prompt:string,note:{path:string;absolutePath?:string},context:EditorChatContext,options?:{threadId?:string;newThread?:boolean;expectedProjectKey?:string;projectOverrideKey?:string}){
    const manager=this.inlineChat;if(!manager)throw Error('Inline T3 response is unavailable. Reload the plugin.');
    if(context.view.file?.path!==note.path)throw Error('The original note is no longer open. Reopen it before asking T3.');
    const activeId=activeInlineIds(context.editor.getValue())[0];
    if(activeId&&!options?.newThread)return this.sendInlineSteering(activeId,prompt,note,context,options);
    const requestId=randomId(),job=context.anchor?manager.reserve(context.editor,context.view,context.anchor,requestId,note.path):manager.reserveAtEnd(context.editor,context.view,requestId,note.path);
    let delivered=false;
    try{await this.sendChat(`${prompt}\n\n${INLINE_REPLY_INSTRUCTION}`,note,{...options,requestId,onPrepared:request=>manager.prepare(job,request)});delivered=true;manager.start(job);}
    catch(error){manager.deliveryFailed(job,delivered||(error instanceof RequestDeliveryError&&error.requestSaved));throw error;}
  }
  private async sendInlineSteering(id:string,prompt:string,note:{path:string;absolutePath?:string},context:EditorChatContext,options?:{threadId?:string;expectedProjectKey?:string;projectOverrideKey?:string}){
    const job=this.inlineChat?.find(id);let hosted:{record:LeaseRecord;host:InlineHostTarget}|undefined;
    const targets=[job?.hostTarget,...this.inlineTargets].filter((value):value is InlineHostTarget=>!!value);
    if(!job||job.hosted)try{const current=await this.inlineHostTarget();if(!targets.some(target=>JSON.stringify(target)===JSON.stringify(current)))targets.push(current);}catch{}
    for(const host of targets){
      let opened:{files:InlineFiles;close():void};try{opened=await this.inlineHostFiles(host);}catch{continue;}
      try{const raw=await opened.files.read(leasePaths(host.directory,id).record);if(raw){const record:LeaseRecord=JSON.parse(raw);if(record.request.id===id&&record.request.vaultId===this.settings.vaultId){hosted={record,host};break;}}}finally{opened.close();}
    }
    if(job?.hosted&&!hosted||!hosted&&!job)throw Error('The active response is unavailable. Reconnect its vault project machine.');
    const threadId=hosted?.record.request.threadId??job?.threadId,projectId=hosted?.record.request.projectId??job?.projectId,environmentId=hosted?.record.request.threadEnvironmentId??job?.connection?.environmentId;
    if(!threadId||!projectId)throw Error('Wait for the first message to reach T3 before steering.');
    if(options?.threadId&&options.threadId!==threadId)throw Error('This note has a running response in another thread. Finish or stop it first.');
    if(hosted&&(hosted.record.state?.notePath??hosted.record.request.notePath)!==note.path)throw Error('The response note moved. Wait for the writer to catch up.');
    await this.checkRecoveryBlock(id,note.path,hosted?.record.state?.hashes??[job!.bodyHash]);
    if(context.anchor){const range=selectionRange(context.editor.getValue(),context.anchor),region=regionBody(context.editor.getValue(),id)!;if(!range)throw Error('The selected text changed. Select it again.');if(range.to>region.from-startMarker(id).length-1&&range.from<region.to+endMarker(id).length+1)throw Error('Select your message outside the running response, or type it in the palette.');}
    const project=await this.recoveryProject(projectId,environmentId),key=projectKey(project);
    if(options?.expectedProjectKey&&options.expectedProjectKey!==key||options?.projectOverrideKey&&options.projectOverrideKey!==key)throw Error('Steering must use the running thread’s project.');
    await this.sendChat(`${prompt}\n\n${INLINE_REPLY_INSTRUCTION}`,note,{threadId,projectOverrideKey:key,onPrepared:request=>{
      request.inlineSteering={jobId:id,...(hosted?{host:hosted.host}:{}),input:{messageId:commandId(request.id,'message'),text:prompt,...(context.anchor?{selection:context.anchor}:{})}};
    }});
  }
  private async recoveryRecord(id:string,path:string):Promise<{record:LeaseRecord;host:InlineHostTarget}|undefined>{
    const targets=[...this.inlineTargets];
    try{const current=await this.inlineHostTarget();if(!targets.some(target=>JSON.stringify(target)===JSON.stringify(current)))targets.push(current);}catch{}
    for(const host of targets){
      let opened:{files:InlineFiles;close():void};
      try{opened=await this.inlineHostFiles(host);}catch{continue;}
      try{
        const raw=await opened.files.read(leasePaths(host.directory,id).record);
        if(!raw)continue;
        const record:LeaseRecord=JSON.parse(raw);
        if(record.request.id!==id||record.request.vaultId!==this.settings.vaultId)throw Error('This response belongs to another vault.');
        if(record.state?.status!=='error')throw Error('This response is no longer waiting for a continuation.');
        if(record.state.pendingMessageId)throw Error('A continuation is already attached and waiting for its T3 turn.');
        if(record.state.notePath!==path){
          if(this.app.vault.getFileByPath(record.state.notePath))throw Error('The original response note still exists at its previous path. Resolve the duplicate before continuing.');
          await this.checkRecoveryBlock(id,path,record.state.hashes);
        }
        return {record,host};
      }finally{opened.close();}
    }
  }
  private async checkRecoveryBlock(id:string,path:string,hashes:string[]){
    const leaf=this.app.workspace.getLeavesOfType('markdown').find(leaf=>(leaf.view as MarkdownView).file?.path===path);
    const file=this.app.vault.getFileByPath(path);
    if(!file)throw Error('The original note is no longer available.');
    const document=leaf?(leaf.view as MarkdownView).editor.getValue():await this.app.vault.read(file);
    const block=regionBody(document,id);
    if(!block||!hashes.includes(contentHash(block.body)))throw Error('The response block changed. Your edits are preserved; continue in the T3 thread instead.');
  }
  private async recoveryProject(projectId:string,environmentId?:string){
    for(const project of [...this.settings.directProjects,...this.settings.projects]){
      if(project.id!==projectId)continue;
      try{
        const connection=this.connection(project),selected=connection.environmentId??(!Platform.isMobile?await this.localInlineEnvironment():undefined);
        if(!environmentId||selected===environmentId)return project;
      }catch{}
    }
    throw Error('The original T3 project is unavailable on this device. Refresh projects and reconnect its machine.');
  }
  private async continueInline(id:string,path:string){
    const hosted=await this.recoveryRecord(id,path),job=hosted?undefined:this.inlineChat?.find(id);
    if(!hosted&&(!job||job.hosted||job.path!==path||job.phase!=='error'||!job.threadId||!job.projectId||!job.messageId))throw Error('The streaming host is unavailable or this response is no longer waiting for a continuation.');
    await this.checkRecoveryBlock(id,path,hosted?.record.state?.hashes??[job!.bodyHash]);
    const threadId=hosted?.record.request.threadId??job!.threadId!,projectId=hosted?.record.request.projectId??job!.projectId!;
    const environmentId=hosted?.record.request.threadEnvironmentId??job!.connection?.environmentId;
    const project=await this.recoveryProject(projectId,environmentId),previousMessageId=hosted?.record.state?.messageId??hosted?.record.request.messageId??job!.messageId!;
    const file=this.app.vault.getFileByPath(path);
    if(!file)throw Error('The original note is no longer available.');
    await this.sendChat('Continue.',this.noteContext(file),{
      threadId,projectOverrideKey:projectKey(project),barePrompt:true,
      onPrepared:async request=>{
        const selectedEnvironment=request.connection.environmentId??(hosted?await this.localInlineEnvironment():undefined);
        if(request.threadId!==threadId||request.project.id!==projectId||selectedEnvironment!==environmentId)throw Error('The continuation target changed.');
        request.inlineFollow={jobId:id,...(hosted?{host:hosted.host, notePath:path}:{}),previousMessageId,messageId:commandId(request.id,'message')};
      },
    });
  }
  private async attachInline(id:string,path:string){
    const hosted=await this.recoveryRecord(id,path),job=hosted?undefined:this.inlineChat?.find(id);
    if(!hosted&&(!job||job.hosted||job.path!==path||job.phase!=='error'||!job.threadId||!job.messageId||!job.connection))throw Error('The streaming host is unavailable or this response is no longer waiting for a continuation.');
    await this.checkRecoveryBlock(id,path,hosted?.record.state?.hashes??[job!.bodyHash]);
    const threadId=hosted?.record.request.threadId??job!.threadId!,projectId=hosted?.record.request.projectId??job!.projectId!;
    let thread:any;
    if(hosted){const access=await this.inlineThreadAccess(hosted.record.request.threadEnvironmentId);try{thread=(await access.api(`/api/orchestration/threads/${encodeURIComponent(threadId)}?turnLimit=20`)).thread;}finally{await access.close?.();}}
    else thread=await runBridge(job!.connection!,['read',threadId]);
    const oldTurnId=hosted?.record.state?.turnId??job?.turnId;
    const latest=thread?.latestTurn;
    const user=thread?.messages?.find((item:any)=>item.role==='user'&&item.createdAt===latest?.requestedAt);
    if(thread?.id!==threadId||thread.projectId!==projectId||!latest?.turnId||latest.turnId===oldTurnId||!user?.id)throw Error('No newer T3 turn is available to attach to this response. Continue the thread in T3 first.');
    if(hosted){if(!this.deviceInline)throw Error('Response ownership is unavailable. Reload the plugin.');await this.deviceInline.follow(hosted.host,id,hosted.record.state?.messageId??hosted.record.request.messageId,user.id,path);}
    else this.inlineChat!.follow(job!,user.id);
    new Notice('The latest T3 turn is attached to this response.');
  }
  private rememberInlineTarget(target:InlineHostTarget){
    if(this.inlineTargets.some(value=>value.environmentId===target.environmentId&&sameWorkspacePath(value.workspaceRoot,target.workspaceRoot)&&value.directory===target.directory))return;
    this.inlineTargets.push(target);this.app.saveLocalStorage(`${this.localKey}-inline-hosts-${this.settings.vaultId}`,this.inlineTargets);
  }
  private async inlineThreadAccess(environmentId:string){
    const paired=this.settings.paired.find(connection=>connection.environmentId===environmentId);
    // A known connection is sufficient, even when this desktop's T3 server
    // is stopped. Local discovery is only needed for an unpaired local thread.
    if(!paired&&!Platform.isMobile&&environmentId===await this.localInlineEnvironment())return (await import('./desktop')).desktopThreadAccess({...this.settings.connection,host:'local'});
    if(!paired)throw Error('Connect this device to the thread machine to take over responses.');
    const connection:Connection={transport:'direct',host:'direct',executable:'',url:paired.url,environmentId,connectionId:paired.id};
    return {origin:endpoint(paired.url),api:await environmentApi(connection,await this.sessionFor(paired.id))};
  }
  private localInlineEnvironment():Promise<string>{
    if(Platform.isMobile)return Promise.reject(Error('A phone cannot host vault responses.'));
    return this.inlineEnvironment??=import('./desktop').then(d=>d.desktopEnvironment(this.settings.connection)).catch(error=>{this.inlineEnvironment=undefined;throw error;});
  }
  private async refreshInlineHost():Promise<void>{
    if(Platform.isMobile||this.stopped)return;
    if(this.inlineHostRefresh)return this.inlineHostRefresh;
    const work=(async()=>{
      const adapter=this.app.vault.adapter as {getFullPath?:(path:string)=>string};
      const localRoot=adapter.getFullPath?.('');
      // Each desktop accepts only jobs explicitly addressed to its own T3
      // environment and vault path. A new default host does not strand jobs
      // already handed to the old host.
      const key=localRoot?JSON.stringify([localRoot,this.settings.vaultId,this.app.vault.configDir]):'';
      if(this.inlineHostKey!==key){this.inlineHostService?.dispose();this.inlineHostService=undefined;this.inlineHostKey='';}
      if(!key||!localRoot||this.inlineHostService)return;
      const environmentId=await this.localInlineEnvironment();
      if(this.stopped)return;
      const {DesktopInlineHost}=await import('./hosted-inline-desktop');
      const host=await DesktopInlineHost.open(this.app,{vaultId:this.settings.vaultId,environmentId,workspaceRoot:localRoot,directory:`${this.app.vault.configDir||'.obsidian'}/t3-code/inline/v1`},async target=>{
        if(target===environmentId)return (await import('./desktop')).desktopThreadAccess({...this.settings.connection,host:'local'});
        const paired=this.settings.paired.find(c=>c.environmentId===target);
        if(!paired)throw Error('Connect the thread machine in the streaming host’s T3 settings.');
        const connection:Connection={transport:'direct',host:'direct',executable:'',url:paired.url,environmentId:paired.environmentId,connectionId:paired.id};
        return {origin:endpoint(paired.url),api:await environmentApi(connection,await this.sessionFor(paired.id))};
      });
      if(this.stopped){host.dispose();return;}this.inlineHostService=host;this.inlineHostKey=key;
    })();
    this.inlineHostRefresh=work;try{await work;}finally{if(this.inlineHostRefresh===work)this.inlineHostRefresh=undefined;}
  }
  private async inlineHostTarget():Promise<InlineHostTarget>{
    let root=this.settings.folderLinks.find(link=>link.folderPath==='/');
    if(!root){await this.configureVaultRoot();root=this.settings.folderLinks.find(link=>link.folderPath==='/');}
    if(!root)throw Error('Choose a vault project machine before streaming replies.');
    const environmentId=root.environmentId??this.settings.paired.find(c=>c.id===root!.connectionId)?.environmentId??(!root.connectionId?await this.localInlineEnvironment():undefined);
    if(!environmentId)throw Error('Reconnect the vault project machine before streaming replies.');
    return {environmentId,workspaceRoot:root.workspaceRoot,directory:`${this.app.vault.configDir||'.obsidian'}/t3-code/inline/v1`,...(root.connectionId?{connectionId:root.connectionId}:{})};
  }
  private async prepareHostedInline(job:InlineJob,request:Request){
    const host=await this.inlineHostTarget();
    const threadEnvironmentId=request.connection.environmentId??await this.localInlineEnvironment();
    job.hostTarget=host;this.rememberInlineTarget(host);
    request.inlineHost={version:2,initialOwner:this.inlineActor,id:job.id,vaultId:this.settings.vaultId,host,notePath:job.path,threadId:job.threadId!,messageId:job.messageId!,projectId:request.project.id,threadEnvironmentId,initialHash:job.bodyHash,createdAt:job.createdAt,keepIntermediate:job.keepIntermediate===true};
  }
  private async inlineHostFiles(target:InlineHostTarget):Promise<{files:InlineFiles;close():void}>{
    const adapter=this.app.vault.adapter as {getFullPath?:(path:string)=>string};
    if(!Platform.isMobile&&adapter.getFullPath&&sameWorkspacePath(adapter.getFullPath(''),target.workspaceRoot)&&await this.localInlineEnvironment()===target.environmentId){
      await this.refreshInlineHost();
      return {files:(await import('./hosted-inline-desktop')).localInlineFiles(target.workspaceRoot,target.directory),close:()=>{}};
    }
    const paired=this.settings.paired.find(c=>c.environmentId===target.environmentId&&(c.id===target.connectionId||!target.connectionId))??this.settings.paired.find(c=>c.environmentId===target.environmentId);
    if(!paired)throw Error('Connect the vault project machine on this device before streaming replies.');
    const remote=await connectVaultRemote({transport:'direct',host:'direct',executable:'',url:paired.url,connectionId:paired.id,environmentId:paired.environmentId},await this.sessionFor(paired.id));
    try{
      if(!await remote.matches(target.workspaceRoot,`${this.app.vault.configDir||'.obsidian'}/plugins/${this.manifest?.id||'send-to-t3-code'}/data.json`,this.settings.vaultId))throw Error('The streaming host no longer matches this vault. Reconnect the vault project machine.');
      return {files:{read:path=>remote.readFile(target.workspaceRoot,path),write:(path,contents)=>remote.writeFile(target.workspaceRoot,path,contents)},close:()=>remote.close()};
    }catch(error){remote.close();throw error;}
  }
  private async stopHostedInline(id:string,target?:InlineHostTarget){
    const host=target??await this.inlineHostTarget(),opened=await this.inlineHostFiles(host);
    try{
      const paths=hostedPaths(host.directory,id);
      if(!await opened.files.read(paths.request))throw Error('This response belongs to an older local stream. Stop it on the device that started it.');
      await opened.files.write(paths.stop,JSON.stringify({id,requestedAt:new Date().toISOString()}));
      new Notice('Stop requested on the vault project machine.');
    }finally{opened.close();}
  }
  private async chatTarget(notePath?:string,preferred?:NoteThread,ignorePreviousThread=false,overrideKey?:string):Promise<{project:Project;link:FolderLink}> {
    if(overrideKey===VAULT_PROJECT)return this.vaultTarget();
    if(overrideKey===NEW_FOLDER_PROJECT){if(!notePath?.includes('/'))throw Error('Choose a note inside a folder.');return (await this.folderTarget(notePath,true))!;}
    let link=notePath?folderLinkForPath(this.settings.folderLinks,notePath):this.settings.folderLinks.find(item=>item.folderPath==='/');
    if(overrideKey){const project=[...this.projects(),...this.settings.directProjects,...this.settings.projects].find(item=>projectKey(item)===overrideKey);if(!project)throw Error('The chosen T3 project is unavailable. Choose a project again.');return {project,link:link&&projectKey(project)===`${link.connectionId?link.connectionId+':':''}${link.projectId}`?link:{id:'project-override',folderPath:'/',connectionId:project.connectionId??'',projectId:project.id,projectTitle:project.title,workspaceRoot:project.workspaceRoot,self:false}};}
    const remembered=preferred??(!ignorePreviousThread?this.noteThread(notePath):undefined);
    if(remembered){const project=this.projectForNoteThread(remembered);return {project,link:link??{id:'note-thread',folderPath:'/',connectionId:remembered.connectionId,projectId:remembered.projectId,projectTitle:project.title,workspaceRoot:remembered.workspaceRoot,self:true}};}
    if(this.needsFolderProject(notePath))return (await this.folderTarget(notePath!,true))!;
    if(link){try{return {project:this.projectForLink(link),link};}catch(error){if(link.folderPath!=='/')throw error;}}
    return this.vaultTarget();
  }
  private async vaultTarget():Promise<{project:Project;link:FolderLink}>{
    let link=this.settings.folderLinks.find(item=>item.folderPath==='/');
    if(link){try{return {project:this.projectForLink(link),link};}catch{/* Reconnect a stale root. */}}
    if(Platform.isMobile||this.settings.paired.length||this.nativeAccount){
      const project=await this.configureVaultRoot();
      link=this.settings.folderLinks.find(item=>item.folderPath==='/');
      if(!link)throw Error('Vault setup did not finish. Try again.');
      return {project,link};
    }
    const project=await this.localFolderProject(this.app.vault.getRoot());
    link={id:randomId(),folderPath:'/',connectionId:project.connectionId??'',projectId:project.id,projectTitle:project.title,workspaceRoot:project.workspaceRoot,self:true};
    const previous=this.settings.folderLinks;
    this.settings.folderLinks=upsertFolderLink(previous,link);
    try{await this.save();this.folderIndicators?.refresh();}catch(error){this.settings.folderLinks=previous;throw error;}
    return {project,link};
  }
  private async folderTarget(notePath:string,create:boolean,fromNote=true):Promise<{project:Project;link:FolderLink}|undefined>{
    const folderPath=notePath.slice(0,notePath.lastIndexOf('/'));
    const existing=this.settings.folderLinks.find(link=>link.folderPath===folderPath);
    if(existing&&fromNote)return {project:this.projectForLink(existing),link:existing};
    const root=await this.vaultTarget(),connection=this.connection(root.project);
    let project:Project|undefined;
    if(connection.transport==='direct'){
      const remote=await connectVaultRemote(connection,await this.sessionFor(connection.connectionId??''));
      try{
        if(!await remote.matches(root.project.workspaceRoot,`${this.app.vault.configDir||'.obsidian'}/plugins/${this.manifest?.id||'send-to-t3-code'}/data.json`,this.settings.vaultId))throw Error('The vault project machine no longer matches this vault. Reconnect it in settings.');
        const separator=root.project.workspaceRoot.includes('\\')&&!root.project.workspaceRoot.includes('/')?'\\':'/';
        const workspaceRoot=root.project.workspaceRoot.replace(/[\\/]+$/,'')+separator+folderPath.replace(/\//g,separator);
        const directory=(await remote.browse(workspaceRoot)).parentPath;
        if(!sameWorkspacePath(directory,workspaceRoot))throw Error('This folder has not reached the vault project machine yet. Let Obsidian Sync finish, then try again.');
        project=(await remote.projects()).find(item=>sameWorkspacePath(item.workspaceRoot,workspaceRoot));
        if(!project&&create){
          if(fromNote)await waitForVaultNote(remote,root.project.workspaceRoot,notePath,()=>!this.stopped,()=>new Notice('Waiting for this note to reach the vault project machine…',10000));
          const proposed=vaultRegistration(connection.environmentId!,workspaceRoot,this.settings.vaultId+':'+folderPath,folderPath.split('/').at(-1)!);
          const registration=this.vaultRegistrations[proposed.commandId]??proposed;
          this.vaultRegistrations[proposed.commandId]=registration;await this.save();
          project=await remote.ensureProject(registration);
        }
        if(project)project={...project,connectionId:root.project.connectionId,connectionName:root.project.connectionName};
      }finally{remote.close();}
    }else{
      const folder=this.app.vault.getAbstractFileByPath(folderPath);
      if(!(folder instanceof TFolder))throw Error('This folder no longer exists. Choose a note again.');
      if(create)project=await this.localFolderProject(folder);
      else{
        const workspaceRoot=(this.app.vault.adapter as unknown as {getFullPath:(path:string)=>string}).getFullPath(folderPath);
        project=parseProjects(await runBridge(connection,['projects'])).find(item=>sameWorkspacePath(item.workspaceRoot,workspaceRoot));
      }
    }
    if(!project)return;
    if(this.stopped)throw Error('The plugin was disabled before linking the folder.');
    const link:FolderLink={id:randomId(),folderPath,connectionId:project.connectionId??'',projectId:project.id,projectTitle:project.title,workspaceRoot:project.workspaceRoot,self:true,vaultId:this.settings.vaultId,...(connection.environmentId?{environmentId:connection.environmentId}:{})};
    if(project.connectionId)this.settings.directProjects=[...this.settings.directProjects.filter(item=>projectKey(item)!==projectKey(project!)),project];
    return {project,link};
  }
  private folderLinkIntent(link:FolderLink):{folderLinkIntent?:FolderLink}{
    return link.self&&link.folderPath!=='/'&&!this.settings.folderLinks.some(item=>item.folderPath===link.folderPath)?{folderLinkIntent:link}:{};
  }
  private async existingTarget(notePath?:string,overrideKey?:string){
    if(this.needsFolderProject(notePath)&&(!overrideKey||overrideKey===NEW_FOLDER_PROJECT)&&!this.settings.folderLinks.some(link=>link.folderPath==='/'))return;
    if(notePath&&(overrideKey===NEW_FOLDER_PROJECT||!overrideKey&&this.needsFolderProject(notePath)))return this.folderTarget(notePath,false);
    return this.chatTarget(notePath,undefined,true,overrideKey);
  }
  vaultMachines():VaultMachine[]{
    const remote=this.settings.paired.filter((c,index,list)=>list.findIndex(other=>other.environmentId===c.environmentId)===index).map(c=>({id:c.id,name:c.name,detail:this.machineErrors[c.environmentId]?'Unavailable — retry connection':undefined}));
    const discovered=this.cloudMachines.filter(m=>!this.settings.paired.some(c=>c.environmentId===m.environmentId)).map(m=>({id:'environment:'+m.environmentId,name:m.name,detail:this.machineErrors[m.environmentId]?'Unavailable — retry connection':undefined}));
    return [...(!Platform.isMobile?[{id:'local',name:'This computer',local:true}]:[]),...remote,...discovered];
  }
  async configureVaultRoot():Promise<Project>{
    if(this.vaultSetup)return this.vaultSetup;
    const identity=this.settings.vaultId;
    const settingsPath=`${this.app.vault.configDir||'.obsidian'}/plugins/${this.manifest?.id||'send-to-t3-code'}/data.json`;
    const selected=(machine:VaultMachine)=>{const c=this.settings.paired.find(c=>c.id===machine.id||'environment:'+c.environmentId===machine.id);if(!c)throw Error('This machine connection changed. Refresh machines.');return c;};
    const modal=this.vaultSetupModal=new VaultSetupModal(this.app,{
      vaultId:identity,vaultName:this.app.vault.getName(),settingsPath,
      machines:()=>this.vaultMachines(),
      refresh:async()=>{if(this.nativeAccount)await this.refreshMachines();else if(!this.settings.paired.length)throw Error('Sign in or pair a machine in connection settings, then return here.');},
      connect:async machine=>{if(machine.id.startsWith('environment:')){const cloud=this.cloudMachines.find(m=>'environment:'+m.environmentId===machine.id);if(cloud)await this.connectAccountMachine(cloud);}const c=selected(machine);return connectVaultRemote({transport:'direct',host:'direct',executable:'',url:c.url,environmentId:c.environmentId,connectionId:c.id},await this.sessionFor(c.id));},
      roots:machine=>{const c=selected(machine);return [...this.settings.vaultLocations.filter(l=>l.environmentId===c.environmentId).map(l=>l.workspaceRoot),...this.settings.folderLinks.filter(l=>l.folderPath==='/'&&(l.connectionId===c.id||l.environmentId===c.environmentId)).map(l=>l.workspaceRoot)];},
      link:async(machine,root,remote)=>{
        let project:Project,environmentId:string|undefined;
        if(machine.local)project=await this.localFolderProject(this.app.vault.getRoot());
        else {
          const c=selected(machine);environmentId=c.environmentId;
          if(!root||!remote)throw Error('Choose a synced vault folder.');
          const proposed=vaultRegistration(environmentId,root,identity,this.app.vault.getName());
          const registration=this.vaultRegistrations[proposed.commandId]??proposed;
          this.vaultRegistrations[proposed.commandId]=registration;await this.save();
          const created=await remote.ensureProject(registration);
          project={...created,connectionId:c.id,connectionName:c.name};
        }
        if(this.stopped||modal.isClosed)throw new VaultSetupCancelled();
        if(this.settings.vaultId!==identity)throw Error('Vault settings changed during setup. Open Connect vault again.');
        const before={folderLinks:this.settings.folderLinks,directProjects:this.settings.directProjects,vaultLocations:this.settings.vaultLocations};
        const existing=this.settings.folderLinks.find(l=>l.folderPath==='/');
        this.settings.folderLinks=upsertFolderLink(this.settings.folderLinks,{id:existing?.id??randomId(),folderPath:'/',projectId:project.id,projectTitle:project.title,workspaceRoot:project.workspaceRoot,connectionId:project.connectionId??'',self:true,vaultId:identity,...(environmentId?{environmentId}:{})});
        if(environmentId){
          this.settings.vaultLocations=[...this.settings.vaultLocations.filter(l=>l.environmentId!==environmentId),{environmentId,workspaceRoot:project.workspaceRoot}];
          this.settings.directProjects=[...this.settings.directProjects.filter(p=>projectKey(p)!==projectKey(project)),project];
        }
        try{await this.save();}catch(error){Object.assign(this.settings,before);throw error;}
        this.refreshFolderIndicators();return project;
      },
    });
    const promise=modal.wait();this.vaultSetup=promise;
    try{return await promise;}finally{if(this.vaultSetup===promise){this.vaultSetup=undefined;this.vaultSetupModal=undefined;}}
  }
  private destinationNotePath(note:{path:string;absolutePath?:string},project:Project,link:FolderLink):string|undefined {
    if(link.id==='note-thread')return note.absolutePath;
    if((link.projectId!==project.id||link.connectionId!==(project.connectionId??''))&&!sameWorkspacePath(link.workspaceRoot,project.workspaceRoot))return note.absolutePath;
    const relative=link.folderPath==='/'?note.path:note.path.slice(link.folderPath.length+1);
    let root:string|undefined,path:string;
    if(!project.connectionId&&note.absolutePath)return note.absolutePath;
    if(link.self||link.folderPath==='/'){root=project.workspaceRoot;path=relative;}
    else{
      const vaultRoot=this.settings.folderLinks.find(item=>item.folderPath==='/'&&item.connectionId===(project.connectionId??''));
      const environmentId=this.settings.paired.find(c=>c.id===project.connectionId)?.environmentId;
      root=vaultRoot?.workspaceRoot??this.settings.vaultLocations.find(location=>location.environmentId===environmentId)?.workspaceRoot;
      if(!root)return;path=note.path;
    }
    const separator=root.includes('\\')&&!root.includes('/')?'\\':'/';
    return root.replace(/[\\/]+$/,'')+separator+path.replace(/[\\/]+/g,separator);
  }
  private messageFooter(destination:string):string {
    return `\n\nSent from Obsidian.\nObsidian vault: ${JSON.stringify(this.app.vault.getName())}\nDestination note path: ${JSON.stringify(destination)}`;
  }
  private async prepareImages(markdown:string,sourcePath:string,resolveReferences=false){
    let definitions='';
    if(resolveReferences&&sourcePath&&/!\[(?!\[)[^\]\n]*\](?!\()/.test(markdown)){
      const view=this.app.workspace.getLeavesOfType('markdown').map(leaf=>leaf.view as MarkdownView).find(view=>view.file?.path===sourcePath);
      const file=this.app.vault.getFileByPath(sourcePath);
      const source=view?.editor?.getValue()??(file?await this.app.vault.read(file):'');
      definitions=imageReferenceDefinitions(source);
    }
    return collectImages(markdown, async embed => {
      if (/^https?:/i.test(embed.link)) return {bytes:await downloadImage(embed.link),name:new URL(embed.link).pathname.split('/').pop() || 'remote-image'};
      if (/^data:/i.test(embed.link)) {
        const match=/^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/=\r\n]+)$/i.exec(embed.link);
        if(!match || match[2].length > 14_000_000) throw new Error('Invalid or oversized inline image data.');
        return {bytes:Buffer.from(match[2],'base64'),name:`inline.${match[1]}`};
      }
      if (/^[a-z][a-z0-9+.-]*:/i.test(embed.link)) throw new Error('Use a vault image, HTTPS URL, or image data URL.');
      let link=embed.link.split('#')[0]; try{link=decodeURIComponent(link);}catch{throw new Error('Invalid percent encoding in image path.');}
      const target=this.app.metadataCache.getFirstLinkpathDest(link,sourcePath);
      if(!target) throw new Error(`Embedded image not found: ${link}`);
      if(target.stat.size > MAX_IMAGE_BYTES) throw new Error('Image exceeds 10 MiB.');
      return {bytes:Buffer.from(await this.app.vault.readBinary(target)),name:target.name};
    },definitions);
  }
  async sendChat(prompt:string,note?:{path:string;absolutePath?:string},options?:{threadId?:string;newThread?:boolean;expectedProjectKey?:string;projectOverrideKey?:string;requestId?:string;barePrompt?:boolean;onPrepared?:(request:Request)=>void|Promise<void>}):Promise<void> {
    if(this.busy)throw Error('Another send is in progress. Wait for it to finish.');
    if(!prompt.trim())throw Error('Enter a message before sending.');
    if(this.stopped)throw Error('The plugin has been disabled. Re-enable it before sending.');
    this.busy=true;
    let saved=false;
    try{
      const images=options?.barePrompt?undefined:await this.prepareImages(prompt,note?.path??'',true);
      if((images?.markdown??prompt).length+(options?.barePrompt?0:this.messageFooter(note?.absolutePath??note?.path??'(no note open)').length)>120_000)throw Error('The message and note path exceed T3’s 120,000-character limit. Shorten the message before sending.');
      const historical=note&&options?.threadId&&!options.expectedProjectKey?this.previousNoteThread(note.path,options.threadId):undefined;
      let {project,link}=await this.chatTarget(note?.path,historical,Boolean(options?.newThread||options?.expectedProjectKey),options?.projectOverrideKey);
      if(options?.expectedProjectKey&&projectKey(project)!==options.expectedProjectKey)throw Error('The note’s linked project changed. Choose a thread again.');
      const readiness=this.projectReadinessError(project);if(readiness)throw Error(readiness);
      let text=images?.markdown??prompt;
      if(options?.barePrompt){
        text=prompt;
      }else if(note){
        const destination=this.destinationNotePath(note,project,link);
        text+=this.messageFooter(destination??note.absolutePath??'(unmapped on destination)');
      }else{
        text+=this.messageFooter('(no note open)');
      }
      if(!options?.barePrompt)text=applyOrchestration(text,this.settings.orchestration);
      if(text.length>120_000)throw Error('The message and note path exceed T3’s 120,000-character limit. Shorten the message before sending.');
      const connection=this.connection(project);
      if(connection.transport==='direct'){
        const session=await this.sessionFor(connection.connectionId??'');
        if(!session||session.expiresAt<=Date.now())throw Error('Sign in or pair this connection on this device before sending.');
        const vaultLink=this.settings.folderLinks.find(l=>l.folderPath==='/'&&l.vaultId===this.settings.vaultId&&(l.connectionId===project.connectionId||l.environmentId===connection.environmentId));
        const vaultRoot=vaultLink?.workspaceRoot??this.settings.vaultLocations.find(location=>location.environmentId===connection.environmentId)?.workspaceRoot;
        if(note&&vaultRoot&&!options?.onPrepared){
          const remote=await connectVaultRemote(connection,session);
          try{
            if(!await remote.matches(vaultRoot,`${this.app.vault.configDir||'.obsidian'}/plugins/${this.manifest?.id||'send-to-t3-code'}/data.json`,this.settings.vaultId))throw Error('The chosen vault folder no longer matches this vault. Use Change machine in settings to reconnect it.');
            await waitForVaultNote(remote,vaultRoot,note.path,()=>!this.stopped,()=>new Notice('Waiting for this note to reach the selected machine through Obsidian Sync…',10000));
          }finally{remote.close();}
        }
      }
      if(this.stopped)throw Error('The plugin was disabled before sending.');
      const title=prompt.trim().split(/\r?\n/)[0].replace(/\s+/g,' ').trim().slice(0,160);
      const active=this.noteThread(note?.path);
      const threadId=options?.threadId??(!options?.newThread&&active&&project.id===active.projectId&&(project.connectionId??'')===active.connectionId?active.threadId:undefined);
      const request:Request={id:options?.requestId??randomId(),project:{...project},title,prompt:text,connection,...(images?.attachments.length?{attachments:images.attachments,context:images.context}:{}),...(threadId?{threadId}:{}),...(note?{noteThread:this.noteThreadIntent(note.path,project,connection)}:{}),...this.folderLinkIntent(link)};
      await options?.onPrepared?.(request);
      this.settings.pending.push(request);
      try{await this.save();saved=true;}catch(e){this.settings.pending=this.settings.pending.filter(r=>r!==request);throw e;}
      await this.dispatch(request);
      const draft=this.app.loadLocalStorage(this.chatDraftKey);
      if(typeof draft==='string'&&draft&&(draft===prompt||[THREAD_REPLY_INSTRUCTION,INLINE_REPLY_INSTRUCTION].some(instruction=>prompt===`${draft}\n\n${instruction}`||prompt.endsWith(`\n\nQuestion:\n${draft}\n\n${instruction}`))))this.app.saveLocalStorage(this.chatDraftKey,'');
    }catch(e){throw new RequestDeliveryError(`${message(e)} ${saved?'Check Unconfirmed requests in settings before sending again.':'No thread was created.'}`,saved);}
    finally{this.busy=false;}
  }
  projects(){return this.mode==='direct'?this.settings.directProjects:this.settings.projects;}
  selected(){return this.mode==='direct'?this.settings.directSelected:this.settings.selected;}
  async select(project:Project,enabled:boolean){const key=projectKey(project);const selected=this.selected().filter(id=>id!==key);if(enabled)selected.push(key);if(this.mode==='direct')this.settings.directSelected=selected;else this.settings.selected=selected;await this.save();}
  connection(project?:Project):Connection {if(project?!!project.connectionId:this.mode==='direct'){const c=this.settings.paired.find(c=>c.id===(project?.connectionId??this.settings.directScanId));if(!c)throw Error('Pair a T3 connection in settings first.');return {transport:'direct',url:c.url,connectionId:c.id,environmentId:c.environmentId,host:'direct',executable:''};}return {...this.settings.connection,host:'local',transport:'desktop'};}
  async pairConnection(name:string,address:string,code:string,expectedEnvironmentId?:string){
    const result=await pair(address,code,undefined,expectedEnvironmentId);
    const existing=this.settings.paired.find(c=>c.environmentId===result.descriptor.environmentId&&c.url===result.session.url);
    const c:PairedConnection=existing??{id:randomId(),name:name.trim()||result.descriptor.label,url:result.session.url,environmentId:result.descriptor.environmentId};
    if(!existing)this.settings.paired.push(c);
    this.pairedSessions[c.id]=result.session;this.settings.directScanId=c.id;this.mode='direct';await this.save();
    await this.scan();
  }
  pairingStatus(c:PairedConnection){const s=this.pairedSessions[c.id];return !s?'Pair on this device':s.expiresAt<=Date.now()?'Pairing expired':`Paired on this device until ${new Date(s.expiresAt).toLocaleDateString()}`;}
  async startEmailSignIn(email:string){
    this.cancelCloudLogin();this.emailLogin=null;this.cloudError='';const generation=this.cloudGeneration;
    const login=await beginEmailLogin(email,nativeAccountFetch);
    if(this.stopped||generation!==this.cloudGeneration)return;
    this.emailLogin=login;this.cloudChanged?.();
  }
  async finishEmailSignIn(code:string){
    const login=this.emailLogin;if(!login)throw Error('Request a T3 email code first.');const generation=this.cloudGeneration;
    const account=await verifyEmailLogin(login,code,nativeAccountFetch);
    if(this.stopped||generation!==this.cloudGeneration){void revokeNativeAccount(account,nativeAccountFetch).catch(()=>{});return;}
    this.nativeAccount=account;this.nativeToken=undefined;this.emailLogin=null;this.cloudAccount=null;
    this.mode='direct';await this.save();await this.refreshMachines();
  }
  async nativeCredential():Promise<CloudAccount>{
    const account=this.nativeAccount;if(!account)throw Error('Sign in to T3 on this device first.');
    if(this.nativeToken&&this.nativeToken.expiresAt>Date.now()+10000)return this.nativeToken;
    if(this.nativeRefreshing)return this.nativeRefreshing;
    const generation=this.cloudGeneration;
    const active=()=>!this.stopped&&this.nativeAccount===account&&generation===this.cloudGeneration;
    const work=(async()=>{const token=await nativeRelayAccount(account,async()=>{if(!active())throw Error('Sign-in cancelled.');await this.save();},nativeAccountFetch);if(!active())throw Error('Sign-in cancelled.');this.nativeToken=token;return token;})();
    this.nativeRefreshing=work;try{return await work;}finally{if(this.nativeRefreshing===work)this.nativeRefreshing=undefined;}
  }
  async sessionFor(id:string):Promise<PairedSession|undefined>{
    const session=this.pairedSessions[id];const c=this.settings.paired.find(c=>c.id===id);
    if(session?.accountId&&session.accountId!==this.nativeAccount?.userId)throw Error('Sign in to the T3 account that owns this connection.');
    if(session&&session.expiresAt>Date.now()+60000)return session;
    if(!c?.managed||!this.nativeAccount)return session;
    const existing=this.sessionRefreshing.get(id);if(existing)return existing;
    const account=this.nativeAccount;const generation=this.cloudGeneration;
    const work=(async()=>{
      const credential=await this.nativeCredential();const machines=await discoverMachines(credential);
      const m=machines.find(m=>m.environmentId===c.environmentId&&m.url===c.url);
      if(!m)throw Error('This T3 connection is no longer available to your account. Refresh connections.');
      const next=await connectMachine(await this.nativeCredential(),m,this.deviceId+':'+account.userId);
      if(this.stopped||this.nativeAccount!==account||generation!==this.cloudGeneration||!this.settings.paired.includes(c))throw Error('Connection cancelled.');
      next.accountId=account.userId;this.pairedSessions[id]=next;await this.save();return next;
    })();this.sessionRefreshing.set(id,work);try{return await work;}finally{if(this.sessionRefreshing.get(id)===work)this.sessionRefreshing.delete(id);}
  }
  async connectAccountMachine(m:CloudMachine){
    const account=this.nativeAccount;if(!account)throw Error('Sign in with your T3 email first.');const generation=this.cloudGeneration;
    const session=await connectMachine(await this.nativeCredential(),m,this.deviceId+':'+account.userId);
    if(this.stopped||this.nativeAccount!==account||generation!==this.cloudGeneration)throw Error('Connection cancelled.');
    const c=this.settings.paired.find(c=>c.environmentId===m.environmentId&&c.url===m.url)??{id:randomId(),name:m.name,url:m.url,environmentId:m.environmentId};
    if(!this.settings.paired.includes(c))this.settings.paired.push(c);
    c.managed=true;c.name=m.name;session.accountId=account.userId;this.pairedSessions[c.id]=session;
    if(!this.settings.directScanId)this.settings.directScanId=c.id;this.mode='direct';await this.save();
    const projects=parseProjects(await readDirect({transport:'direct',host:'direct',executable:'',url:c.url,environmentId:c.environmentId,connectionId:c.id},['projects'],session));
    if(this.stopped||this.nativeAccount!==account||generation!==this.cloudGeneration||!this.settings.paired.includes(c))return;
    this.settings.directProjects=[...this.settings.directProjects.filter(p=>p.connectionId!==c.id),...projects.map(p=>({...p,connectionId:c.id,connectionName:c.name}))];
    delete this.machineErrors[m.environmentId];await this.save();
  }
  async startCloudLogin(){
    this.cancelCloudLogin();const generation=this.cloudGeneration;this.cloudError='';
    const login=await beginLogin();if(this.stopped||generation!==this.cloudGeneration)return;
    this.cloudLogin=login;this.cloudChanged?.();this.scheduleCloudPoll();
  }
  cancelCloudLogin(){this.cloudGeneration++;this.refreshRun++;this.connecting=false;if(this.cloudTimer)clearTimeout(this.cloudTimer);this.cloudLogin=null;this.emailLogin=null;this.cloudChanged?.();}
  private scheduleCloudPoll(){
    const login=this.cloudLogin;if(!login||this.stopped)return;const generation=this.cloudGeneration;
    this.cloudTimer=setTimeout(async()=>{try{
      const account=await pollLogin(login);if(this.stopped||generation!==this.cloudGeneration)return;
      if(account){this.cloudAccount=account;this.cloudLogin=null;await this.save();await this.refreshMachines();}
      else this.scheduleCloudPoll();
    }catch(e){if(generation!==this.cloudGeneration)return;this.cloudError=message(e);this.cloudLogin=null;}this.cloudChanged?.();},Math.max(1000,login.nextPollAt-Date.now()));
  }
  async currentCloudAccount():Promise<CloudAccount>{
    if(!this.cloudAccount)throw Error('Sign in to T3 Connect on this device first.');
    if(this.cloudRefreshing)return this.cloudRefreshing;
    const generation=this.cloudGeneration;const old=this.cloudAccount;
    const work=(async()=>{const next=await refreshAccount(old);if(generation!==this.cloudGeneration||this.stopped)throw Error('T3 sign-in was cancelled.');this.cloudAccount=next;if(next!==old)await this.save();return next;})();
    this.cloudRefreshing=work;try{return await work;}finally{if(this.cloudRefreshing===work)this.cloudRefreshing=undefined;}
  }
  async refreshMachines(){
    if(this.machineRefreshing)return this.machineRefreshing;
    const generation=this.cloudGeneration;const run=++this.refreshRun;this.connecting=true;this.connectionSyncComplete=false;this.cloudError='';this.cloudChanged?.();
    const work=(async()=>{let discovered=false;try{
      const list=await discoverMachines(this.nativeAccount?await this.nativeCredential():await this.currentCloudAccount());
      if(generation!==this.cloudGeneration||this.stopped)return;this.cloudMachines=list;this.machineErrors={};discovered=true;this.cloudChanged?.();
      if(this.nativeAccount)for(const m of list){
        if(generation!==this.cloudGeneration||this.stopped)return;
        try{await this.connectAccountMachine(m);}catch(e){if(generation===this.cloudGeneration)this.machineErrors[m.environmentId]=message(e);}
        if(generation===this.cloudGeneration)this.cloudChanged?.();
      }
    }finally{if(run===this.refreshRun){this.connecting=false;this.connectionSyncComplete=discovered;}if(generation===this.cloudGeneration)this.cloudChanged?.();}})();
    this.machineRefreshing=work;try{await work;}finally{if(this.machineRefreshing===work)this.machineRefreshing=undefined;}
  }
  directAccountReady(){
    if(!this.nativeAccount||this.connecting||!this.connectionSyncComplete||!this.cloudMachines.length)return false;
    return this.cloudMachines.some(machine=>!this.machineErrors[machine.environmentId]&&this.settings.paired.some(connection=>connection.managed&&connection.environmentId===machine.environmentId&&connection.url===machine.url));
  }
  async linkFolder(folder:TFolder,project:Project,self:boolean){
    new FolderLinkModal(this.app,this,folder,project,self).open();
  }
  async saveFolderLink(folder:TFolder,project:Project,self:boolean){
    if(this.app.vault.getAbstractFileByPath(folder.path)!==folder)throw Error('This folder no longer exists. Choose a folder again.');
    const previous=this.settings.folderLinks;
    const existing=previous.find(link=>link.folderPath===folder.path&&link.projectId===project.id&&link.connectionId===(project.connectionId??''));
    this.settings.folderLinks=upsertFolderLink(previous,{id:existing?.id??randomId(),folderPath:folder.path,connectionId:project.connectionId??'',projectId:project.id,projectTitle:project.title,workspaceRoot:project.workspaceRoot,self});
    try{await this.save();this.refreshFolderIndicators();}catch(error){this.settings.folderLinks=previous;throw error;}
    new Notice(`${folder.path} linked to ${projectLabel(project)}.`);
  }
  private async localFolderProject(folder:TFolder):Promise<Project>{
    if(Platform.isMobile)throw Error('Link to self is available when Obsidian and T3 Code run on the same desktop computer.');
    const adapter=this.app.vault.adapter as {getFullPath?:(path:string)=>string};
    if(typeof adapter.getFullPath!=='function')throw Error('This vault does not expose a local filesystem path.');
    const workspaceRoot=adapter.getFullPath(folder.path==='/'?'':folder.path);
    const localConnection={...this.settings.connection,host:'local',transport:'desktop' as const};
    // Discover first: another client may already have registered this directory.
    this.settings.projects=parseProjects(await runBridge(localConnection,['projects']));
    let project=this.settings.projects.find(item=>sameWorkspacePath(item.workspaceRoot,workspaceRoot));
    if(!project){
      const id=await (await import('./desktop')).addDesktopProject(localConnection,workspaceRoot,folder.path==='/'?this.app.vault.getName():folder.name);
      this.settings.projects=parseProjects(await runBridge(localConnection,['projects']));
      project=this.settings.projects.find(item=>item.id===id);
    }
    if(!project)throw Error('T3 created the project, but it was not returned by project discovery.');
    if(!this.settings.selected.includes(project.id))this.settings.selected.push(project.id);
    return project;
  }
  async linkFolderToSelf(folder:TFolder){
    try{const target=folder.path==='/'?await this.vaultTarget():await this.folderTarget(`${folder.path}/placeholder.md`,true,false);await this.linkFolder(folder,target!.project,true);}
    catch(e){new Notice(`Send to T3 Code: ${message(e)}`,12000);}
  }
  async signOutCloud(){
    const old=this.nativeAccount;this.cancelCloudLogin();this.nativeAccount=null;this.nativeToken=undefined;this.nativeRefreshing=undefined;this.sessionRefreshing.clear();
    for(const [id,s] of Object.entries(this.pairedSessions))if(s.accountId)delete this.pairedSessions[id];
    this.cloudAccount=null;this.cloudMachines=[];this.cloudError='';this.machineErrors={};this.connectionSyncComplete=false;this.machineRefreshing=undefined;this.cloudRefreshing=undefined;await this.save();this.cloudChanged?.();
    if(old)try{await revokeNativeAccount(old,nativeAccountFetch);}catch{new Notice('Signed out on this device. T3 could not be reached to revoke the account session; you can revoke it in your T3 account.');}
  }
  async forgetPairing(id:string){delete this.pairedSessions[id];await this.save();}
  async removeConnection(id:string){
    if(this.settings.pending.some(r=>r.connection.connectionId===id)||this.settings.completionJobs.some(j=>j.connection.connectionId===id&&j.status==='watching')||this.settings.settlementJobs.some(j=>j.connection.connectionId===id))throw Error('This connection has an unconfirmed request or completion check. Resolve or stop it before removing the connection.');
    this.settings.paired=this.settings.paired.filter(c=>c.id!==id);this.settings.directProjects=this.settings.directProjects.filter(p=>p.connectionId!==id);this.settings.directSelected=this.settings.directSelected.filter(k=>!k.startsWith(id+':'));delete this.pairedSessions[id];if(this.settings.directScanId===id)this.settings.directScanId=this.settings.paired[0]?.id??'';await this.save();
  }
  private saveDeviceState(state?:unknown) {
    this.app.saveLocalStorage(this.localKey,JSON.parse(JSON.stringify({deviceId:this.deviceId,automationStreamId:this.streamId,coordinatorAssignmentId:this.coordinatorAssignmentId,mode:this.mode,connection:this.settings.connection,pairedSessions:this.pairedSessions,cloudAccount:this.cloudAccount,nativeAccount:this.nativeAccount,vaultRegistrations:this.vaultRegistrations})));
    return deviceState(this.deviceId,state??JSON.parse(JSON.stringify({pending:this.settings.pending,completionJobs:this.settings.completionJobs,settlementJobs:this.settings.settlementJobs})));
  }
  private sharedSnapshot(){const {pending,completionJobs,settlementJobs,connection,...shared}=this.settings;return JSON.parse(JSON.stringify(shared));}
  save(forceShared=false) {
    this.refreshFolderIndicators();
    const {pending,completionJobs,settlementJobs,connection}=this.settings,snapshot=this.sharedSnapshot(),intendedDrafts=JSON.stringify(this.settings.automationDrafts),intendedAutomation=JSON.stringify(this.settings.automation),intendedEdits=JSON.stringify(this.settings.workflowEditRequests),intendedThreads=JSON.stringify(this.settings.noteThreads);
    const writeShared=forceShared||JSON.stringify(snapshot)!==this.sharedBaseline;
    const state=JSON.parse(JSON.stringify({pending,completionJobs,settlementJobs}));
    this.app.saveLocalStorage(this.localKey,JSON.parse(JSON.stringify({deviceId:this.deviceId,automationStreamId:this.streamId,coordinatorAssignmentId:this.coordinatorAssignmentId,mode:this.mode,connection,pairedSessions:this.pairedSessions,cloudAccount:this.cloudAccount,nativeAccount:this.nativeAccount,vaultRegistrations:this.vaultRegistrations})));
    this.saving=this.saving.catch(()=>{}).then(async()=>{
      await deviceState(this.deviceId,state);
      if(!writeShared)return;
      const baseline=JSON.parse(this.sharedBaseline) as Settings;
      const current=await this.loadData();
      const externalDrafts:WorkflowIR[]=[];
      for(const candidate of Array.isArray(current?.automationDrafts)?current.automationDrafts:[])try{externalDrafts.push(validateWorkflowIR(candidate));}catch{/* Invalid definitions stay inert. */}
      snapshot.automationDrafts=mergeWorkflowDrafts(baseline.automationDrafts??[],externalDrafts,snapshot.automationDrafts);
      snapshot.workflowEditRequests=mergeWorkflowEditRequests(baseline.workflowEditRequests??[],loadWorkflowEditRequests(current?.workflowEditRequests),snapshot.workflowEditRequests);
      snapshot.noteThreads=mergeNoteThreads(loadNoteThreads(current?.noteThreads),snapshot.noteThreads);
      if(JSON.stringify(snapshot.automation)===JSON.stringify(baseline.automation)&&current?.automation)snapshot.automation={destinationId:current.automation.destinationId??'qlo2-vps',coordinatorDeviceId:current.automation.coordinatorDeviceId??''};
      await this.saveData(snapshot);
      this.lastDiskSnapshot=JSON.stringify(snapshot);
      if(JSON.stringify(this.settings.automationDrafts)===intendedDrafts)this.settings.automationDrafts=snapshot.automationDrafts;
      if(JSON.stringify(this.settings.automation)===intendedAutomation)this.settings.automation=snapshot.automation;
      if(JSON.stringify(this.settings.workflowEditRequests)===intendedEdits)this.settings.workflowEditRequests=snapshot.workflowEditRequests;
      if(JSON.stringify(this.settings.noteThreads)===intendedThreads)this.settings.noteThreads=snapshot.noteThreads;
      this.sharedBaseline=JSON.stringify(snapshot);
    });return this.saving;
  }
  async scan() {
    try {
      const connection = this.connection();
      const result=await runBridge(connection,['projects']);
      const projects = parseProjects(result);
      if (JSON.stringify(connection) !== JSON.stringify(this.connection())) return;
      if(connection.transport==='direct'){const c=this.settings.paired.find(c=>c.id===connection.connectionId)!;this.settings.directProjects=[...this.settings.directProjects.filter(p=>p.connectionId!==c.id),...projects.map(p=>({...p,connectionId:c.id,connectionName:c.name}))];}
      else this.settings.projects=projects;
      this.scanError=result.cached?(result.warning??'Destination offline. Showing saved projects; sending requires a connection.') : '';await this.save();
    } catch(e) {this.scanError = message(e); throw e;}
  }
  async send(file:TFile, project:Project, options?:{id?:string;quiet?:boolean;throwOnError?:boolean;threadId?:string;newThread?:boolean;projectOverrideKey?:string;folderPicker?:boolean;folderLink?:FolderLink;prepared?:PreparedNote}) {
    if (this.busy) return;
    this.busy = true;
    let saved = false;
    let inlineJob:ReturnType<InlineChatManager['reserveAtEnd']>|undefined;
    const orchestration = {...this.settings.orchestration};
    const completion = {...this.settings.completion};
    try {
      const savedThread=this.noteThread(file.path);
      const remembered=!options?.newThread&&!options?.threadId&&!options?.folderPicker&&(!options?.projectOverrideKey||savedThread&&`${savedThread.connectionId?savedThread.connectionId+':':''}${savedThread.projectId}`===options.projectOverrideKey)?savedThread:undefined;
      const historical=options?.threadId&&!options.folderPicker&&!options.projectOverrideKey?this.previousNoteThread(file.path,options.threadId):undefined;
      if(remembered||historical)project=this.projectForNoteThread((historical??remembered)!);
      const threadId=options?.threadId??remembered?.threadId;
      const connection=this.connection(project);
      const inlineView=!options?.quiet&&this.settings.inlineStreaming.enabled?await this.editorForNoteSend(file):undefined;
      const content = inlineView?inlineView.editor.getValue():await this.app.vault.read(file);
      if (!content.trim()) {new Notice('This note is empty. Add Markdown before sending.'); return;}
      if(!options?.quiet)new Notice('Preparing note and embedded images…');
      if(options?.prepared&&options.prepared.content!==content)throw Error('The note changed while preparing its project. Try again with the current text.');
      const images = options?.prepared?.images??await this.prepareImages(content,file.path);
      if(inlineView&&inlineView.editor.getValue()!==content)throw Error('The note changed while preparing the send. Try again with the current text.');
      const note=this.noteContext(file),link=options?.folderLink??folderLinkForPath(this.settings.folderLinks,file.path)??{id:'manual',folderPath:'/',connectionId:project.connectionId??'',projectId:project.id,projectTitle:project.title,workspaceRoot:project.workspaceRoot,self:true};
      const destination=this.destinationNotePath(note,project,link)??note.absolutePath??'(unmapped on destination)';
      const request:Request = {id:options?.id??randomId(),project:{...project},title:file.basename.slice(0,160),prompt:applyOrchestration(images.markdown+(inlineView?`\n\n${INLINE_REPLY_INSTRUCTION}`:'')+this.messageFooter(destination),orchestration),attachments:images.attachments,context:images.context,...(threadId?{threadId}:{}),completion:{notePath:file.path,contentHash:contentHash(content),ctime:file.stat.ctime,...completion,action:'keep'},connection,noteThread:this.noteThreadIntent(file.path,project,connection),...this.folderLinkIntent(link)};
      if(request.prompt.length>120_000) throw new Error('The note and image context exceed T3’s 120,000-character limit. Split the note before sending.');
      if(inlineView){
        const manager=this.inlineChat;if(!manager)throw Error('Inline T3 streaming is unavailable. Reload the plugin.');
        inlineJob=manager.reserveAtEnd(inlineView.editor,inlineView,request.id,file.path);
        await manager.prepare(inlineJob,request);
      }
      this.settings.pending.push(request); await this.save(); saved = true;
      const sentThreadId=await this.dispatch(request,options?.quiet);
      if(inlineJob)this.inlineChat?.start(inlineJob);
      return {threadId:sentThreadId,request};
    } catch(e) {if(inlineJob)this.inlineChat?.deliveryFailed(inlineJob,saved);if(options?.throwOnError)throw e;new Notice(`Send to T3 Code: ${message(e)} ${saved ? "See settings for saved requests." : "No thread was created."}`,12000);}
    finally {this.busy = false;}
  }
  private async sendV2Plan(plan:ImmutablePlan):Promise<string>{
    if(this.stopped||this.settings.automation.coordinatorDeviceId!==this.deviceId||!observationInterest(this.settings.automationDrafts).active)throw Error('The workflow coordinator is not active on this device.');
    if(plan.actionType!=='t3.startThread'||!plan.notePath||!plan.projectId)throw Error('This v2 action has no supported T3 destination.');
    const file=this.app.vault.getAbstractFileByPath(plan.notePath);
    if(!(file instanceof TFile)||exactHash(await this.app.vault.read(file))!==plan.inputHash)throw Error('The workflow note changed before dispatch. Review this run before retrying.');
    const link=folderLinkForPath(this.settings.folderLinks,file.path);
    if(!link||link.projectId!==plan.projectId||(plan.connectionId&&link.connectionId!==plan.connectionId))throw Error('The folder destination changed. Review this workflow before sending.');
    const project=this.projectForLink(link),readiness=this.projectReadinessError(project);if(readiness)throw Error(readiness);
    const adapter=this.app.vault.adapter as {getFullPath?:(path:string)=>string};
    const destination=this.destinationNotePath({path:file.path,...(typeof adapter.getFullPath==='function'?{absolutePath:adapter.getFullPath(file.path)}:{})},project,link);
    if(!destination)throw Error('The destination machine has no safe filesystem mapping for this vault. Connect the vault to that machine first.');
    const connection=this.connection(project);
    if(connection.transport==='direct'){
      const session=await this.sessionFor(connection.connectionId??'');if(!session||session.expiresAt<=Date.now())throw Error('Sign in or pair this connection on this device before sending.');
      const vaultLink=this.settings.folderLinks.find(item=>item.folderPath==='/'&&item.vaultId===this.settings.vaultId&&(item.connectionId===project.connectionId||item.environmentId===connection.environmentId));
      const vaultRoot=vaultLink?.workspaceRoot??this.settings.vaultLocations.find(location=>location.environmentId===connection.environmentId)?.workspaceRoot;
      if(vaultRoot){const remote=await connectVaultRemote(connection,session);try{if(!await remote.matches(vaultRoot,`${this.app.vault.configDir||'.obsidian'}/plugins/${this.manifest?.id||'send-to-t3-code'}/data.json`,this.settings.vaultId))throw Error('The destination vault mapping no longer matches this vault. Reconnect it in settings.');await waitForVaultNote(remote,vaultRoot,file.path,()=>!this.stopped,()=>new Notice('Waiting for this workflow note to reach the selected machine through Obsidian Sync…',10000));}finally{remote.close();}}
    }
    if(exactHash(await this.app.vault.read(file))!==plan.inputHash)throw Error('The note changed while preparing the destination; no thread was started.');
    const prompt=applyOrchestration(`${plan.prompt}${this.messageFooter(destination)}`,this.settings.orchestration);
    if(prompt.length>120_000)throw Error('The workflow task and note exceed T3’s 120,000-character limit.');
    let request=this.settings.pending.find(item=>item.id===plan.requestId);
    if(request&&request.prompt!==prompt)throw Error('The saved v2 request does not match its immutable execution plan.');
    if(!request){request={id:plan.requestId,project:{...project},title:plan.title,prompt,connection};this.settings.pending.push(request);await this.save();}
    const result=await sendRequest(request);
    this.settings.pending=this.settings.pending.filter(item=>item.id!==request!.id);
    this.rememberSettlement(request,result.threadId);
    await this.save();
    return result.threadId;
  }
  private async pollV2Plan(plan:ImmutablePlan,threadId:string):Promise<{state:'wait'|'complete'|'failed';result?:unknown;detail?:string}>{
    if(!plan.notePath||!plan.projectId)return {state:'failed',detail:'The v2 plan has no linked project.'};
    const link=folderLinkForPath(this.settings.folderLinks,plan.notePath);
    if(!link||link.projectId!==plan.projectId)return {state:'failed',detail:'The linked project changed while this workflow was running.'};
    const project=this.projectForLink(link),connection=this.connection(project),result=await runBridge(connection,['threads','--project',project.id]);
    const thread=Array.isArray(result?.threads)?result.threads.find((item:any)=>item.id===threadId):undefined;
    if(!thread)return {state:'wait'};
    const job:any={threadId,projectId:project.id,requestId:plan.requestId},state=completionState(thread,job);
    if(state==='wait')return {state:'wait'};
    if(state==='keep')return {state:'failed',detail:'The T3 turn failed or was interrupted.'};
    const full=await runBridge(connection,['read',threadId]);
    if(!isOriginalCompletedTurn(full,job))return {state:'failed',detail:'The original T3 turn could not be verified.'};
    const file=this.app.vault.getAbstractFileByPath(plan.notePath);
    return {state:'complete',result:{threadId,outputHash:file instanceof TFile?exactHash(await this.app.vault.read(file)):null}};
  }
  async v2Executions():Promise<ExecutionEntry[]>{return (await this.observationEngine?.store.executions()??[]).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));}
  async retryV2Execution(runId:string){
    const store=this.observationEngine?.store;if(!store)throw Error('The v2 journal is not ready.');
    const entry=(await store.executions()).find(item=>item.runId===runId);
    if(!entry||entry.state!=='delivery_unknown')throw Error('Only an uncertain delivery can be retried with its original request ID.');
    await store.putExecution({...entry,state:'planned',detail:'Manually retried with the original request ID.',updatedAt:new Date().toISOString()});
    await this.coordinatorService?.scan();
  }
  private rememberSettlement(request:Request,threadId:string){
    this.settings.settlementJobs=this.settings.settlementJobs.filter(job=>job.threadId!==threadId||job.connection.environmentId!==request.connection.environmentId||job.connection.host!==request.connection.host);
    if(!this.settings.autoSettleThreads)return;
    const inlineJobId=request.inlineSteering?.jobId??request.inlineFollow?.jobId??(request.inlineHost||this.inlineChat?.find(request.id)?request.id:undefined);
    const inlineHost=request.inlineSteering?.host??request.inlineFollow?.host??request.inlineHost?.host;
    this.settings.settlementJobs.push({requestId:request.id,messageId:commandId(request.id,'message'),threadId,projectId:request.project.id,connection:{...request.connection},
      ...(inlineJobId?{inlineJobId}:{}),...(inlineHost?{inlineHost,inlineVersion:(request.inlineHost?.version??2) as 1|2}:{})});
  }
  rememberStarted(request:Request,threadId:string) {
    if(request.folderLinkIntent&&!this.settings.folderLinks.some(link=>link.folderPath===request.folderLinkIntent!.folderPath))this.settings.folderLinks=upsertFolderLink(this.settings.folderLinks,request.folderLinkIntent);
    const remembered=request.noteThread??request.noteLink; // Resume requests saved before the terminology change.
    if(remembered){
      const entry:NoteThread={...remembered,threadId,selectedAt:new Date().toISOString()};
      this.settings.noteThreads=mergeNoteThreads(this.settings.noteThreads,[entry]);
    }
    if(request.completion){
      this.settings.completionJobs=this.settings.completionJobs.filter(j=>j.notePath!==request.completion!.notePath);
      if(request.completion.action!=='keep')this.settings.completionJobs.push({...request.completion,requestId:request.id,threadId,projectId:request.project.id,connection:{...request.connection},status:'watching'});
    }
    this.rememberSettlement(request,threadId);
  }
  async dispatch(request:Request,quiet=false) {
    if(request.inlineSteering){
      const steering=request.inlineSteering;
      if(steering.input.messageId!==commandId(request.id,'message')||!request.threadId)throw Error('Invalid saved steering request.');
      if(steering.host){if(!this.deviceInline)throw Error('Response ownership is unavailable. Reload the plugin.');await this.deviceInline.steer(steering.host,steering.jobId,steering.input);}
      else {const job=this.inlineChat?.find(steering.jobId)??this.inlineChat?.steeringJob(steering.jobId,steering.input.messageId);if(!job||job.threadId!==request.threadId)throw Error('The original response is unavailable on this device.');this.inlineChat!.steer(job,steering.input);}
    }
    if(request.inlineFollow){
      const follow=request.inlineFollow;
      if(follow.messageId!==commandId(request.id,'message')||!request.threadId)throw Error('Invalid saved continuation request.');
      if(follow.host){if(!this.deviceInline)throw Error('Response ownership is unavailable. Reload the plugin.');await this.deviceInline.follow(follow.host,follow.jobId,follow.previousMessageId,follow.messageId,follow.notePath);}
      else {const job=this.inlineChat?.find(follow.jobId);if(!job||job.threadId!==request.threadId)throw Error('The original response is unavailable on this device.');this.inlineChat!.follow(job,follow.messageId);}
    }
    if(request.inlineHost?.version===2){
      if(!this.deviceInline)throw Error('Response ownership is unavailable. Reload the plugin.');
      await this.deviceInline.register(request.inlineHost);
    }else if(request.inlineHost){
      if(!quiet)new Notice('Handing the response to the vault project machine…');
      const opened=await this.inlineHostFiles(request.inlineHost.host);
      try{await handoffInline(opened.files,request.inlineHost,()=>!this.stopped);}finally{opened.close();}
    }
    if(!quiet)new Notice(`Sending to ${projectLabel(request.project)}…`);
    const result=await sendRequest(request);
    const before={jobs:this.settings.completionJobs,settlementJobs:this.settings.settlementJobs,pending:this.settings.pending,noteThreads:this.settings.noteThreads,folderLinks:this.settings.folderLinks};
    this.rememberStarted(request,result.threadId);
    this.settings.pending=this.settings.pending.filter(r=>r.id!==request.id);
    try{await this.save();}catch(e){this.settings.pending=before.pending;this.settings.completionJobs=before.jobs;this.settings.settlementJobs=before.settlementJobs;this.settings.noteThreads=before.noteThreads;this.settings.folderLinks=before.folderLinks;throw e;}
    if(!quiet)new Notice(`${request.threadId?'Sent to thread':'Thread created'} in ${projectLabel(request.project)}: ${result.threadId}`,12000);return result.threadId;
  }
  onunload(){this.stopped=true;this.questionModal?.close();this.questions?.dispose();this.deviceInline?.dispose();this.inlineHostService?.dispose();this.mobileSelectionAction?.dispose();this.inlineChat?.dispose();this.vaultSetupModal?.close();this.paletteChat?.dispose();this.folderIndicators?.dispose();this.coordinatorService?.stop();if(this.coordinatorTimer!==undefined)window.clearInterval(this.coordinatorTimer);this.observationEngine?.stop();this.remoteJournal?.close();this.cancelCloudLogin();this.cloudChanged=undefined;}
  async monitorCompletions() {
    if(this.monitoring || this.stopped || this.busy) return;
    this.monitoring=true;
    const snapshots=new Map<string,any>();
    try {
      for(const job of [...this.settings.completionJobs]) {
        const active=()=>!this.stopped && !this.busy && this.settings.completionJobs.includes(job) && job.status==='watching';
        if(!active()) continue;
        try {
          const key=JSON.stringify([job.connection,job.projectId]);
          if(!snapshots.has(key)) snapshots.set(key,await runBridge(job.connection,['threads','--project',job.projectId]));
          if(!active())continue;
          const threads=snapshots.get(key)?.threads;
          if(!Array.isArray(threads))throw new Error('Invalid T3 thread status response.');
          const thread=threads.find((t:any)=>t.id===job.threadId);
          if(!thread)throw new Error('Thread unavailable. Note will be kept until its status can be checked.');
          const state=completionState(thread,job);
          if(state==='wait'){if(job.detail){delete job.detail;await this.save();}continue;}
          if(state==='keep'){job.status='kept';job.detail='Kept note: thread failed or was interrupted.';await this.save();continue;}
          const full=await runBridge(job.connection,['read',job.threadId]);
          if(!active())continue;
          if(!isOriginalCompletedTurn(full,job)) {
            if(full.latestTurn?.state!=='completed' || full.session?.activeTurnId)continue;
            job.status='kept';job.detail='Kept note: the thread advanced or its original completed turn could not be verified.';await this.save();continue;
          }
          // Do not clean up while another send for this note is unresolved.
          if(this.settings.pending.some(r=>r.completion?.notePath===job.notePath))continue;
          const fileAt=(path:string)=>{const f=this.app.vault.getAbstractFileByPath(path);return f instanceof TFile?f:null;};
          const detail=await cleanCompletedNote(job,{
            find:path=>{const f=fileAt(path);return f?{path:f.path,ctime:f.stat.ctime}:null;},
            read:async f=>{const file=fileAt(f.path);if(!file || file.stat.ctime!==f.ctime)throw new Error('Note moved or replaced.');return this.app.vault.read(file);},
            hasUnsavedChanges:(f,hash)=>this.app.workspace.getLeavesOfType('markdown').some(leaf=>leaf.view instanceof MarkdownView && leaf.view.file?.path===f.path && contentHash(leaf.view.editor.getValue())!==hash),
            exists:path=>this.app.vault.getAbstractFileByPath(path)!==null,
            mkdir:async path=>{await this.app.vault.createFolder(path);},
            move:async(f,path)=>{const file=fileAt(f.path);if(!file || file.stat.ctime!==f.ctime)throw new Error('Note moved or replaced.');await this.app.fileManager.renameFile(file,path);},
            trash:async f=>{const file=fileAt(f.path);if(!file || file.stat.ctime!==f.ctime)throw new Error('Note moved or replaced.');await this.app.vault.trash(file,false);},
            save:()=>this.save(),active,
          });
          if(this.stopped)continue;
          job.status='kept';job.detail=detail;await this.save();
          new Notice(`Send to T3 Code: ${detail}`,10000);
        }catch(e){if(!this.stopped && job.detail!==message(e)){job.detail=message(e);try{await this.save();}catch{ /* Try again next poll. */ }}}
      }
      await this.monitorSettlements();
    } finally {this.monitoring=false;}
  }
  private async inlineSettlementStatus(job:ThreadSettlementJob):Promise<'wait'|'ready'|'discard'>{
    if(!job.inlineJobId)return 'ready';
    if(!job.inlineHost)return this.inlineChat?.settlementStatus(job.inlineJobId)??'wait';
    const opened=await this.inlineHostFiles(job.inlineHost);
    try{
      const path=job.inlineVersion===1?hostedPaths(job.inlineHost.directory,job.inlineJobId).state:leasePaths(job.inlineHost.directory,job.inlineJobId).record;
      const raw=await opened.files.read(path);
      if(!raw)return 'wait';
      const stored=JSON.parse(raw),state=job.inlineVersion===1?stored:stored.state;
      if(['conflict','interrupted','error'].includes(state?.status))return 'discard';
      if(state?.status!=='complete'||!state.finalDocumentHash)return 'wait';
      if(state.messageId&&state.messageId!==job.messageId)return 'discard';
      return 'ready';
    }finally{opened.close();}
  }
  private async monitorSettlements(){
    if(!this.settings.autoSettleThreads||!this.settings.settlementJobs.length)return;
    for(const job of [...this.settings.settlementJobs]){
      if(this.stopped||this.busy)return;
      if(!this.settings.settlementJobs.includes(job))continue;
      try{
        if(this.settings.pending.some(request=>request.threadId===job.threadId&&request.connection.environmentId===job.connection.environmentId))continue;
        const shell=await runBridge(job.connection,['threads','--project',job.projectId]);
        const summary=shell?.threads?.find((thread:any)=>thread.id===job.threadId);
        if(!summary)continue;
        const full=await runBridge(job.connection,['read',job.threadId]);
        if(this.stopped||this.busy)continue;
        if(!this.settings.autoSettleThreads||!this.settings.settlementJobs.includes(job))continue;
        const state=settlementState({...full,backgroundLiveness:summary.backgroundLiveness??full.backgroundLiveness,hasPendingApprovals:summary.hasPendingApprovals??full.hasPendingApprovals,hasPendingUserInput:summary.hasPendingUserInput??full.hasPendingUserInput,settledOverride:summary.settledOverride??full.settledOverride,archivedAt:summary.archivedAt??full.archivedAt,deletedAt:summary.deletedAt??full.deletedAt},job);
        if(state==='wait')continue;
        if(state==='settle'){
          const inline=await this.inlineSettlementStatus(job);
          if(inline==='wait')continue;
          if(inline==='ready'&&this.settings.autoSettleThreads&&this.settings.settlementJobs.includes(job)){
            const access=job.connection.transport==='direct'
              ?{api:await environmentApi(job.connection,await this.sessionFor(job.connection.connectionId??'')),close:()=>{}}
              :await (await import('./desktop')).desktopThreadAccess(job.connection);
            try{await access.api('/api/orchestration/dispatch',{type:'thread.settle',commandId:commandId(job.requestId,'settle'),threadId:job.threadId});}
            finally{await access.close?.();}
          }
        }
        this.settings.settlementJobs=this.settings.settlementJobs.filter(item=>item!==job);
        await this.save();
      }catch{/* Keep the job for a later check after the connection or client recovers. */}
    }
  }
  async retry(request:Request) {
    if (this.busy) return;
    this.busy = true;
    try {await this.dispatch(request);} catch(e) {new Notice(message(e),12000);} finally {this.busy=false;}
  }
}
function randomId():string {
  const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const hex=Buffer.from(bytes).toString('hex');return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
function message(e:unknown) {return e instanceof Error ? e.message : String(e);}
function projectsUI(container:HTMLElement, plugin:SendToT3, redraw:()=>void) {
  if(plugin.mode==='direct')new Setting(container).setName('Connection to scan').addDropdown(d=>{for(const c of plugin.settings.paired)d.addOption(c.id,c.name);d.setValue(plugin.settings.directScanId).onChange(async id=>{plugin.settings.directScanId=id;await plugin.save();});});
  new Setting(container).setName('Available T3 Code projects').setDesc('Scan the configured T3 environment, then select projects for the Files menu.').addButton(b=>b.setButtonText('Scan projects').onClick(async()=>{
    b.setDisabled(true).setButtonText('Scanning…');
    try {await plugin.scan();} catch(e) {new Notice(message(e),10000);} finally {redraw();}
  }));
  if (plugin.scanError) container.createEl('p',{text:`${plugin.scanError}`,cls:'t3-error'});
  if (!plugin.projects().length) container.createEl('p',{text:'No projects discovered. Start T3 Code, register a project there, and scan again.'});
  for(const p of plugin.projects())new Setting(container).setName(projectLabel(p)).setDesc(p.workspaceRoot).addToggle(t=>t.setValue(plugin.selected().includes(projectKey(p))).onChange(async enabled=>{await plugin.select(p,enabled);}));
  const missing=plugin.selected().filter(id=>!plugin.projects().some(p=>projectKey(p)===id));
  if (missing.length) container.createEl('p',{text:`${missing.length} selected project(s) are unavailable. They will reappear if discovered again.`});
}
class ProjectModal extends Modal {
  constructor(app:App,private plugin:SendToT3){super(app);}
  onOpen(){this.contentEl.empty(); this.titleEl.setText('Send to T3 Code projects'); projectsUI(this.contentEl,this.plugin,()=>this.onOpen());}
}
class ExistingThreadModal extends FuzzySuggestModal<ThreadChoice>{
  constructor(app:App,private threads:ThreadChoice[],private choose:(thread:ThreadChoice)=>Promise<void>,placeholder='Send note to an existing thread',empty='No existing threads in this linked project. Use Send to new thread.'){super(app);this.setPlaceholder(placeholder);this.emptyStateText=empty;}
  getItems(){return this.threads;}
  getItemText(thread:ThreadChoice){return `${thread.title} · ${thread.status} · ${thread.id.slice(0,8)}`;}
  onChooseItem(thread:ThreadChoice){return this.choose(thread);}
}
class PreviousNoteThreadModal extends FuzzySuggestModal<NoteThread>{
  constructor(app:App,private threads:NoteThread[],private choose:(thread:NoteThread)=>Promise<void>){super(app);this.setPlaceholder('Send to a previous thread for this note');this.emptyStateText='No recorded threads for this note.';}
  getItems(){return this.threads;}
  getItemText(thread:NoteThread){return `${thread.projectId} · ${thread.threadId.slice(0,8)} · ${thread.selectedAt}`;}
  onChooseItem(thread:NoteThread){void this.choose(thread);}
}
type FolderLinkChoice=Project|{self:true;title:string};
class FolderLinkProjectModal extends FuzzySuggestModal<FolderLinkChoice>{
  constructor(app:App,private plugin:SendToT3,private folder:TFolder){super(app);this.setPlaceholder('Choose a T3 Code project');}
  getItems(){return [...this.plugin.projects().filter(p=>this.plugin.selected().includes(projectKey(p))),{self:true as const,title:'Self (create this folder as a T3 project)'}];}
  getItemText(choice:FolderLinkChoice){return 'self' in choice?choice.title:`Link to ${projectLabel(choice)}`;}
  onChooseItem(choice:FolderLinkChoice){if('self' in choice)void this.plugin.linkFolderToSelf(this.folder);else void this.plugin.linkFolder(this.folder,choice,false);}
}
class FolderLinkModal extends Modal{
  constructor(app:App,private plugin:SendToT3,private folder:TFolder,private project:Project,private self:boolean){super(app);}
  onOpen(){
    const el=this.contentEl;el.empty();this.titleEl.setText(`Link ${this.folder.name} to ${this.project.title}`);
    el.createEl('p',{text:`${this.folder.path} → ${projectLabel(this.project)}`});
    const actions=new Setting(el).addButton(b=>b.setButtonText('Cancel').onClick(()=>this.close())).addButton(b=>b.setButtonText('Link').setCta().onClick(async()=>{
      actions.setDisabled(true);try{await this.plugin.saveFolderLink(this.folder,this.project,this.self);this.close();}catch(error){new Notice(message(error));actions.setDisabled(false);}
    }));
  }
}
class V2FolderWorkflowModal extends Modal{
  constructor(app:App,private plugin:SendToT3,private folder:TFolder,private link:FolderLink,private existing?:WorkflowIR){super(app);}
  onOpen(){
    const el=this.contentEl;el.empty();this.titleEl.setText(`${this.existing?'Edit':'Create'} T3 workflow for ${this.folder.name}`);
    const current=this.existing;
    let description='',saving=false;
    const workflowId=current?.workflowId??randomId();
    el.createEl('p',{text:`Workflow folder: ${this.folder.path==='/'?'Vault root (/)':this.folder.path}`});
    el.createEl('p',{text:`Destination: ${this.link.projectTitle} · ${this.link.workspaceRoot}`});
    el.createEl('p',{text:current?'Ask for a change to this workflow. Your request will go to its original setup thread.':'Describe when this should run and what T3 should do. A T3 thread will set up the workflow.'});
    new Setting(el).setName(current?'Change request':'Description').addTextArea(text=>{text.inputEl.rows=10;text.inputEl.cols=48;text.setValue('').setPlaceholder(current?'Change this workflow so that…':'When I finish a gym note, summarize the session and update my training log.').onChange(value=>description=value);});
    const actions=new Setting(el);
    if(current)actions.addButton(button=>button.setButtonText('Delete workflow').onClick(async()=>{if(saving)return;saving=true;actions.setDisabled(true);try{await this.plugin.removeV2Workflow(current);this.close();new Notice(`Workflow “${current.name??current.workflowId}” deleted.`);}catch(error){new Notice(message(error),10000);actions.setDisabled(false);saving=false;}}));
    if(current&&this.plugin.settings.workflowEditRequests.some(item=>item.workflowId===current.workflowId))actions.addButton(button=>button.setButtonText('Cancel pending change').onClick(async()=>{if(saving)return;saving=true;actions.setDisabled(true);try{await this.plugin.cancelV2WorkflowEdit(current);this.close();new Notice('Pending workflow change cancelled.');}catch(error){new Notice(message(error),10000);actions.setDisabled(false);saving=false;}}));
    actions.addButton(button=>button.setButtonText('Cancel').onClick(()=>this.close())).addButton(button=>button.setButtonText(current?'Save changes':'Create workflow').setCta().onClick(async()=>{
      if(saving)return;saving=true;actions.setDisabled(true);
      try{const threadId=current?await this.plugin.editV2Workflow(this.folder,this.link,current,description):await this.plugin.setupV2Workflow(this.folder,this.link,description,workflowId);this.close();new Notice(current?`Workflow change sent to T3 thread ${threadId}.`:`Workflow setup started in T3 thread ${threadId}.`,12000);}
      catch(error){this.existing=this.plugin.settings.automationDrafts.find(ir=>ir.workflowId===workflowId)??this.existing;new Notice(message(error),12000);actions.setDisabled(false);saving=false;}
    }));
  }
}
class T3Settings extends PluginSettingTab {
  constructor(app:App,private plugin:SendToT3){super(app,plugin);}
  private selectedMachine:CloudMachine|null=null;
  cloudUI(el:HTMLElement){
    const p=this.plugin;p.cloudChanged=()=>this.display();
    el.createEl('h3',{text:p.nativeAccount?'T3 connection on this device':'Sign in on this device'});
    el.createEl('p',{text:p.nativeAccount?'Your account is stored only on this device. Projects and saved folder links appear after T3 finishes connecting your computers.':'This device is not signed in to T3. Verify your T3 email here, or use advanced manual pairing below.'});
    if(p.nativeAccount){
      new Setting(el).setName(p.nativeAccount.identity).setDesc(p.connecting?'Connecting computers and discovering projects…':'Signed in. Connections renew automatically.').addButton(b=>b.setButtonText('Refresh connections').setDisabled(p.connecting).onClick(async()=>{try{await p.refreshMachines();}catch(e){p.cloudError=message(e);}this.display();})).addButton(b=>b.setButtonText('Sign out').onClick(async()=>{await p.signOutCloud();this.display();}));
      if(p.connecting)el.createEl('p',{text:'Connecting to T3 and syncing project information…'});
      else if(!p.connectionSyncComplete)el.createEl('p',{text:'Connection setup has not completed. Refresh connections to try again.'});
      else if(!p.cloudMachines.length)el.createEl('p',{text:'No T3 computers are available yet. Enable T3 Connect on a computer, then refresh.'});
      else if(Object.keys(p.machineErrors).length)el.createEl('p',{text:'T3 could not finish connecting all computers. Refresh connections to retry.',cls:'t3-error'});
      if(p.directAccountReady())for(const m of p.cloudMachines){
        const c=p.settings.paired.find(c=>c.environmentId===m.environmentId&&c.url===m.url);
        const count=p.settings.directProjects.filter(project=>project.connectionId===c?.id).length;
        new Setting(el).setName(m.name).setDesc(p.machineErrors[m.environmentId]??(c?`${count} projects discovered`:'Connecting…'));
      }
    }else if(p.emailLogin){
      el.createEl('p',{text:`Enter the six-digit verification code sent by T3 to ${p.emailLogin.email}.`});
      let code='';new Setting(el).setName('Email verification code').addText(t=>{t.inputEl.type='password';t.inputEl.inputMode='numeric';t.inputEl.autocomplete='one-time-code';t.inputEl.maxLength=6;t.setPlaceholder('6-digit code').onChange(v=>code=v);});
      new Setting(el).addButton(b=>b.setButtonText('Verify and connect').setCta().onClick(async()=>{b.setDisabled(true);try{await p.finishEmailSignIn(code);}catch(e){p.cloudError=message(e);}this.display();})).addButton(b=>b.setButtonText('Cancel').onClick(()=>p.cancelCloudLogin()));
    }else{
      if(p.cloudAccount)el.createEl('p',{text:'Verify your email once to upgrade from address discovery to automatic connections. Existing manual pairings keep working.'});
      let email=p.cloudAccount?.identity.includes('@')?p.cloudAccount.identity:'';
      new Setting(el).setName('T3 account email').setDesc('Uses T3’s sign-in service. No password or per-computer pairing code is needed.').addText(t=>{t.inputEl.type='email';t.inputEl.autocomplete='email';t.setPlaceholder('you@example.com').setValue(email).onChange(v=>email=v);});
      new Setting(el).addButton(b=>b.setButtonText('Send sign-in code').setCta().onClick(async()=>{b.setDisabled(true);try{await p.startEmailSignIn(email);}catch(e){p.cloudError=message(e);}this.display();}));
    }
    if(p.cloudError)el.createEl('p',{text:p.cloudError,cls:'t3-error'});
  }
  display(){
    const el=this.containerEl; el.empty();
    el.createEl('p',{text:'Send full Markdown notes and embedded images to your T3 projects. Sending starts a turn using the project’s model and permission defaults.'});
    new Setting(el).setName('Connection on this device').setDesc('T3 Connect works on desktop and mobile. This computer only is available for local desktop use.').addDropdown(d=>{d.addOptions({...(!Platform.isMobile?{desktop:'This computer only (advanced)'}:{}),direct:'T3 Connect (recommended)'});d.setValue(this.plugin.mode).onChange(async value=>{this.plugin.mode=value as 'desktop'|'direct';this.plugin.scanError='';await this.plugin.save();this.display();});});
    if(this.plugin.mode==='direct'){
      this.cloudUI(el);
      const advanced=el.createEl('details');advanced.createEl('summary',{text:'Advanced: manual pairing'});
      advanced.createEl('p',{text:'In T3 Settings → Connections, create a fresh pairing link using an HTTPS address this device can reach. Paste it below. This connects to T3 itself, with no companion, Python, SSH, or Tailscale requirement in the plugin.'});
      let name=this.selectedMachine?.name??'',address=this.selectedMachine?.url??'',code='';
      new Setting(advanced).setName('Connection name').addText(t=>t.setPlaceholder('My laptop').setValue(name).onChange(v=>name=v));
      new Setting(advanced).setName('T3 address or pairing link').setDesc('Not the old companion URL. Pairing links contain a one-time secret and are never synced or retained.').addText(t=>{t.inputEl.type='password';t.inputEl.autocomplete='off';t.setValue(address).onChange(v=>address=v);});
      new Setting(advanced).setName('Pairing code (if separate)').addText(t=>{t.inputEl.type='password';t.inputEl.autocomplete='off';t.onChange(v=>code=v);});
      new Setting(advanced).addButton(b=>b.setButtonText('Pair and discover projects').setCta().onClick(async()=>{b.setDisabled(true);try{await this.plugin.pairConnection(name,address,code,this.selectedMachine?.environmentId);this.selectedMachine=null;new Notice('Paired directly with T3. Select projects below.');this.display();}catch(e){new Notice(message(e),12000);b.setDisabled(false);}}));
      for(const c of this.plugin.settings.paired){
        const status=c.managed&&this.plugin.nativeAccount?'T3 account connection · renews automatically':this.plugin.pairingStatus(c);
        const setting=new Setting(el).setName(c.name).setDesc(status);
        if(!c.managed)setting.addButton(b=>b.setButtonText('Forget pairing').onClick(async()=>{await this.plugin.forgetPairing(c.id);this.display();}));
        setting.addButton(b=>b.setButtonText('Remove connection').onClick(async()=>{try{await this.plugin.removeConnection(c.id);this.display();}catch(e){new Notice(message(e));}}));
      }
      el.createEl('p',{text:'Project choices sync. Sign in once on each device; credentials stay on that device. Computers must be online to receive a note. Unconfirmed sends require manual retry.'});
    } else {
    new Setting(el).setName('Official T3 executable').setDesc('Leave blank to discover t3 automatically. Otherwise enter the full path to the official T3 CLI executable, not a Fleet adapter or shell command.').addText(t=>t.setValue(this.plugin.settings.connection.executable).onChange(async value=>{this.plugin.settings.connection.executable=value.trim();await this.plugin.save();}));
    new Setting(el).setName('T3 data directory').setDesc('Usually your home directory followed by .t3. Must match the running T3 installation.').addText(t=>t.setValue(this.plugin.settings.connection.baseDir??'').onChange(async value=>{this.plugin.settings.connection.baseDir=value.trim();await this.plugin.save();}));

    }
    el.createEl('h3',{text:'Threads'});
    new Setting(el).setName('Settle completed threads').setDesc('Move Obsidian threads out of T3 Code’s active list after a successful turn and its inline reply finish. Sending to a settled thread wakes it again. Checks run while Obsidian is open.').addToggle(t=>t.setValue(this.plugin.settings.autoSettleThreads).onChange(async enabled=>{this.plugin.settings.autoSettleThreads=enabled;if(!enabled)this.plugin.settings.settlementJobs=[];await this.plugin.save();}));
    new Setting(el).setName('Command palette').setDesc(this.plugin.paletteChatStatus()==='active'?'Use the first T3 Code row to send the current note or ask a question about it.':'The live T3 Code row is unavailable in this Obsidian version or the core Command palette is disabled.');
    el.createEl('p',{text:'Sending includes the current note and its embedded images. Asking sends the question and note location. A selected passage and its embedded images are included with the question.'});
    el.createEl('h3',{text:'Inline responses'});
    new Setting(el).setName('Stream replies into the editor').setDesc('For every manual Send or Ask, insert the reply into the note. Selection questions appear below the selection; other replies appear at the end.').addToggle(t=>t.setValue(this.plugin.settings.inlineStreaming.enabled).onChange(async enabled=>{this.plugin.settings.inlineStreaming.enabled=enabled;await this.plugin.save();}));
    new Setting(el).setName('Keep intermediate agent responses').setDesc('Keep the agent’s progress paragraphs alongside its final answer after an editor response finishes. Off by default. Applies to new responses.').addToggle(t=>t.setValue(this.plugin.settings.inlineStreaming.keepIntermediate).onChange(async enabled=>{this.plugin.settings.inlineStreaming.keepIntermediate=enabled;await this.plugin.save();}));
    el.createEl('h3',{text:'Orchestration'});
    new Setting(el).setName('Wait for other threads').setDesc('Prepend an instruction to wait for all other active T3 Code threads in the destination project to finish before starting work.').addToggle(t=>t.setValue(this.plugin.settings.orchestration.waitForOtherThreads).onChange(async enabled=>{this.plugin.settings.orchestration.waitForOtherThreads=enabled;await this.plugin.save();}));
    el.createEl('h3',{text:'Durable automation journal'});
    el.createEl('p',{text:'Enabled workflows automatically record only their selected note events in their folder scope. Pausing the last workflow stops capture. This device coordinates workflows it creates.'});
    el.createEl('h4',{text:'Workflows'});
    if(!this.plugin.settings.automationDrafts.length)el.createEl('p',{text:'No workflows. Long press or right-click a linked folder and choose Setup T3 workflow.'});
    for(const ir of this.plugin.settings.automationDrafts){
      const row=new Setting(el).setName(ir.name??ir.workflowId).setDesc(`${ir.scope.path.glob} → ${ir.destinationId} · ${ir.enabled?'enabled':'paused'}`);
      if(ir.folderPath)row.addButton(b=>b.setButtonText('Edit').onClick(()=>{const folder=this.plugin.app.vault.getAbstractFileByPath(ir.folderPath!);if(folder instanceof TFolder)this.plugin.openV2WorkflowSetup(folder,ir);else new Notice('The workflow folder is unavailable.');}));
      row.addButton(b=>b.setButtonText(ir.enabled?'Pause':'Enable').onClick(async()=>{try{await this.plugin.saveV2Workflow({...ir,revision:ir.revision+1,enabled:!ir.enabled});this.display();}catch(error){new Notice(message(error),10000);}}));
      row.addButton(b=>b.setButtonText('Remove').onClick(async()=>{try{await this.plugin.removeV2Workflow(ir);this.display();}catch(error){new Notice(message(error),10000);}}));
    }
    const runs=el.createDiv();runs.createEl('h4',{text:'Recent v2 runs'});
    void this.plugin.v2Executions().then(entries=>{
      if(!runs.isConnected)return;
      if(!entries.length){runs.createEl('p',{text:'No v2 runs yet.'});return;}
      for(const entry of entries.slice(0,20)){
        const row=new Setting(runs).setName(`${entry.plan.workflowId} · ${entry.state}`).setDesc(`${entry.plan.notePath??entry.plan.title}${entry.detail?` · ${entry.detail}`:''}`);
        if(entry.state==='delivery_unknown')row.addButton(b=>b.setButtonText('Retry same request').onClick(async()=>{try{await this.plugin.retryV2Execution(entry.runId);this.display();}catch(error){new Notice(message(error),10000);}}));
      }
    }).catch(error=>{if(runs.isConnected)runs.createEl('p',{text:`Run history unavailable: ${message(error)}`});});
    new Setting(el).setName('When task completes').setDesc('After T3 reports the original turn completed successfully. Changed or renamed notes are kept. Applies to notes sent to new threads. Questions and sends to existing threads keep the note.').addDropdown(d=>d.addOptions({keep:'Keep note',archive:'Archive note',delete:'Delete note (vault trash)'}).setValue(this.plugin.settings.completion.action).onChange(async value=>{this.plugin.settings.completion.action=value as CompletionAction;await this.plugin.save();this.display();}));
    if(this.plugin.settings.completion.action==='archive') new Setting(el).setName('Archive folder').setDesc('Folder inside this vault. Original subfolders are preserved; existing notes are never overwritten.').addText(t=>t.setValue(this.plugin.settings.completion.archiveFolder).onChange(async value=>{this.plugin.settings.completion.archiveFolder=value;await this.plugin.save();}));
    el.createEl('h3',{text:'Linked folders'});
    el.createEl('p',{text:'Folder links route questions and manual note sends. Link to self registers a local T3 project.'});
    const root=this.plugin.settings.folderLinks.find(l=>l.folderPath==='/');
    const machine=root?.connectionId?this.plugin.settings.paired.find(c=>c.id===root.connectionId)?.name:undefined;
    new Setting(el).setName('Vault project machine').setDesc(root?`${machine??(Platform.isMobile?'Linked computer':'This computer')} · ${root.workspaceRoot} · Hosts new note responses; keep Obsidian open there.`:'Choose the default T3 destination and response-writing host. Keep Obsidian and this plugin running there.').addButton(b=>b.setButtonText(root?'Change machine':'Connect vault').onClick(async()=>{try{await this.plugin.configureVaultRoot();this.display();}catch(e){if(!(e instanceof VaultSetupCancelled))new Notice(message(e),10000);}}));
    if(!this.plugin.settings.folderLinks.length)el.createEl('p',{text:'No folders are linked.'});
    for(const link of this.plugin.settings.folderLinks){
      new Setting(el).setName(link.folderPath==='/'?'Vault root':link.folderPath).setDesc(`${link.self?'Self · ':''}${link.projectTitle} · ${link.workspaceRoot}`).addButton(b=>b.setButtonText('Unlink').onClick(async()=>{this.plugin.settings.folderLinks=this.plugin.settings.folderLinks.filter(item=>item!==link);for(const workflow of this.plugin.settings.automationDrafts)if(workflow.projectId===link.projectId&&workflow.connectionId===link.connectionId)workflow.enabled=false;await this.plugin.save();this.plugin.refreshFolderIndicators();this.display();}));
    }
    if(this.plugin.settings.completionJobs.length){
      el.createEl('h3',{text:'Task completion monitoring'});
      el.createEl('p',{text:'Checks every 30 seconds while Obsidian is active and resumes after restart or reopening on this device. Mobile background checks are not guaranteed. A completed T3 turn is the completion signal; this does not judge whether the answer fully solved the task.'});
      for(const job of this.plugin.settings.completionJobs) new Setting(el).setName(job.notePath).setDesc(`${job.action} · ${job.threadId} · ${job.detail || 'Waiting for successful completion'}`).addButton(b=>b.setButtonText(job.status==='watching'?'Stop monitoring':'Dismiss').onClick(async()=>{this.plugin.settings.completionJobs=this.plugin.settings.completionJobs.filter(j=>j!==job);await this.plugin.save();this.display();}));
      new Setting(el).addButton(b=>b.setButtonText('Check now').onClick(async()=>{b.setDisabled(true);await this.plugin.monitorCompletions();this.display();}));
    }
    el.createEl('h3',{text:'Projects'});
    projectsUI(el,this.plugin,()=>this.display());
    if(this.plugin.settings.pending.length) {
      el.createEl('h3',{text:'Unconfirmed requests'});
      el.createEl('p',{text:'T3 may already have started this request. Retry uses the same saved content and ID to avoid duplicates. Discard forgets local retry data; it does not cancel a T3 thread.'});
      for(const request of this.plugin.settings.pending) new Setting(el).setName(`${request.title} → ${request.project.title}`).setDesc(retiredConnection(request.connection)?RETIRED_MESSAGE+' Request: '+request.id:request.id).addButton(b=>b.setButtonText('Retry').setDisabled(this.plugin.busy||retiredConnection(request.connection)).onClick(async()=>{b.setDisabled(true);await this.plugin.retry(request);this.display();})).addButton(b=>b.setButtonText('Discard').onClick(async()=>{this.plugin.settings.pending=this.plugin.settings.pending.filter(r=>r.id!==request.id);await this.plugin.save();this.display();}));
    }
  }
}
