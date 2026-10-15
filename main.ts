import {retainedLocalFinal,restoredLocalFinal} from './local-final-cache';
import {hasResponseMarkers} from './inline-thread';
import {interruptStoppedResponse} from './response-stop';
import {localResponseBindings,responseBindingComment} from './local-response-binding';
import {localStagedDraft,localStageCommand} from './local-response-staging';
import {localSyncReady} from './local-sync-state';
import {rewriteReplyReferences} from './reply-assets';
import {prepareEventAction,executeEventAction,type ActionIO,type ActionPlan} from './event-actions';
import {isClientCommand} from './client-command';
import {markdownCodeCacheStatus} from './reply-html';
import {readResponseBindings} from './response-bindings';
import pluginManifest from './manifest.json';
import {appendSendFailure,sendFailureLog,type SendFailure} from './send-failures';
import {ConnectionRecovery,type ConnectionReloadState} from './connection-recovery';
import {hasPluginPermissions} from './environment-permissions';
import {mergeSharedSettings} from './shared-settings';
import {noteThreadTitle,threadTitleGeneration,type ThreadTitleGeneration} from './thread-title';
import {ResponseLocationModal} from './response-location-ui';
import {stagedNoteInstruction} from './staged-note-instruction';
import {isResponseCommand,validateResponseCommand} from './response-command';
import {installStreamBlockControls} from './stream-block-controls';
import {incomingLabel} from './inline-steering';
import {ProjectDiscovery,type ProjectSource,type ProjectSnapshot} from './project-discovery';
import {resolveJobOptions,type ResolvedJobOptions} from './job-options';
import {intermediateMode,installResponsePresentation,finalAnswerFormat,type FinalAnswerFormat,type IntermediateMode} from './response-presentation';
import {installActivityShine} from './activity-shine';
import {activityLeafPath,decorateActivityTabs,decorateMobileActivityTabs,type ActivityLeaf} from './activity-titles';
import {applyThreadItem} from './inline-thread';
import {readInlineSnapshot,watchThread,type ThreadAccess} from './thread-stream';
import {isRecoveryCommand,validateRecoveryCommand} from './recovery-command';
import {abortableRead,requestAborted} from './t3-api';
import {mountToolGroups} from './response-tool-presentation';
import {importRuns,importBindingId,importFollowId,type ImportRun} from './run-import';
import {findRunImport,runImportReceipt} from './run-import-receipt';
import {openRunImport,ImportStreamsModal} from './run-import-ui';
import {type InlineThreadState} from './inline-thread';
import {nativeResponses} from './native-response-manager';
import {editorStream} from './editor-stream';
import {validateNoteCommand,isEventCommand,type NoteCommand,type NoteCommandResult} from './note-command';
import {isFolderCommand,executeFolderCommand,type FolderCommand} from './folder-command';
import {configureDiagnostics,logEvent,logFailure,type EventJournal} from './diagnostics';
import {clearVaultDiagnostics} from './disabled-diagnostics';
import {beginLogin,pollLogin,refreshAccount,discoverMachines,connectMachine,type CloudAccount,type DeviceLogin,type CloudMachine} from './cloud';
import {beginEmailLogin,verifyEmailLogin,nativeRelayAccount,revokeNativeAccount,type NativeAccount,type EmailLogin} from './native-account';
import {pair,readDirect,commandId,environmentApi,endpoint,type PairedConnection,type PairedSession} from './direct';
import { setIcon, App, Menu, MenuItem, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder, MarkdownView, Platform, FuzzySuggestModal, type TAbstractFile, type Editor, type MarkdownFileInfo, MarkdownRenderChild, MarkdownRenderer, parseYaml, stringifyYaml } from 'obsidian';
import { Buffer } from 'buffer';
import { deviceState,clearDeviceDiagnostics } from './device-state';
import {nativeStoppedStore} from './native-stop-store';
import { downloadImage,nativeAccountFetch } from './network';
import {ensureVaultIdentityRecord} from './vault-identity';
import { collectImages, imageReferenceDefinitions, MAX_IMAGE_BYTES } from './images';
import { applyOrchestration, OrchestrationSettings } from './orchestration';
import { CompletionSettings, CompletionJob, CompletionAction, archiveFolder, contentHash, completionState, isOriginalCompletedTurn, cleanCompletedNote } from './completion';
import { Connection, Project, Request, RequestDeliveryError, acceptedRequestThread, parseProjects, runBridge, sendRequest, configureBridge, retiredConnection, RETIRED_MESSAGE, projectKey, projectLabel } from './bridge';
import {loadFolderLinks,upsertFolderLink,folderLinkForPath,sameWorkspacePath,type FolderLink} from './folder-link';
import {loadFolderLinkChanges,mergeFolderLinkChanges,applyFolderLinkChanges,changedFolderLinks,mergeLegacyFolderLinks,type FolderLinkChange} from './folder-link-sync';
import {installPaletteChat,type PaletteChatController} from './palette-chat';
import {SendGesture} from './send-gesture';
import {openChatFlow,openNoteSendFlow,type ChatHost,type ChatDestination} from './chat-ui';
import {selectionRange} from './inline-steering';
import {projectThreads,type ThreadChoice} from './thread-target';
import {lastUsedNoteThread,loadNoteThreads,mergeNoteThreads,mutateNoteThreads,previousNoteThreads,type NoteThread} from './note-threads';
import {noteIndicators,explorerResponsePath,loadExplorerResponses} from './explorer-responses';
import {folderNotePath,type FolderNotesSettings} from './folder-note-adapter';
import {installFolderIndicators,type FolderIndicatorController} from './folder-indicator';
import {connectVaultRemote,loadVaultLocations,vaultIdentity,vaultRegistration,waitForVaultNote,type VaultLocation,type VaultRegistration} from './vault-connection';
import {ProjectCreateModal,ProjectCreationCancelled,workspaceInsideVault,type ProjectLocation} from './project-create-ui';
import {workspaceChildPath} from './workspace-picker';
import {VaultSetupModal,VaultSetupCancelled,type VaultMachine} from './vault-setup-ui';
import {EventSubscriptions,type EventTarget,type NoteEventSnapshot,notificationPrompt,inEventScope,observedPropertyEquals} from './event-subscriptions';
import {existingThreadTurn,threadIsActive,responseOwnsActiveTurn} from './thread-target';
import {DeviceInlineManager} from './leased-inline';
import {deviceNoteIO,deviceFinalNoteIO} from './inline-note-io';
import {DeviceResponseCompletion,deviceCompletionStore} from './device-response-completion';
import {privateStorageResolver} from './private-storage';
import {projectReplyReference as resolveReplyReference} from './project-reference';
import {type CodebaseState,CodebaseBridge} from './codebase-native';
import {codebaseTransport} from './codebase-transport';
import {changeCodebaseProjectLinks} from './codebase-core';
import {loadReplyFolders,type ReplyFolders} from './reply-locations';
import {InlineChatManager,captureEditorSelection,type InlineJob} from './inline-chat';
import {handoffInline,hostedPaths,type HostedInlineRequest,type InlineHostTarget,type InlineFiles} from './hosted-inline';
import {leasePaths,type LeaseRecord} from './inline-lease';
import {installMobileSelectionAction} from './mobile-selection-action';
import {hiddenInlineMarkerExtension,hideResponseContainerBoundaries} from './inline-markers';
import {activeInlineIds,inlineTargetAt,inlineSteeringTarget,selectionOverlapsInlineResponse,selectionAnchor,initialRegion,endInsertionOffset,endMarker,failedInlineIds,regionBody,finalizeRegion,startMarker,type SelectionAnchor} from './inline-thread';
import {QuestionController} from './question-controller';
import {closeNoteTabPanel} from './note-tab-panel';
import {prepareSendGuard,updateSendGuard} from './send-response-guard';
import {QuestionModal,questionButton,questionEditorExtension} from './question-ui';
import {questionTargets,parseQuestionToken,clearResolvedQuestion,removeDismissedQuestions,type QuestionTarget} from './questions';
import {ApprovalController} from './approval-controller';
import {approvalButton,approvalEditorExtension} from './approval-ui';
import {approvalTargets,parseApprovalUrl,clearApprovalControls,type ApprovalTarget} from './approvals';
import {settlementState,type ThreadSettlementJob} from './thread-settlement';
import {INLINE_REPLY_INSTRUCTION,THREAD_REPLY_INSTRUCTION} from './input-presentation';
type EditorChatContext={editor:Editor;view:MarkdownView|MarkdownFileInfo;anchor?:SelectionAnchor;canonicalAnchor?:SelectionAnchor;referenceSelection?:boolean;initialQuestion?:string;responseId?:string;snapshot?:string};
const NEW_FOLDER_PROJECT='folder:new';
const VAULT_PROJECT='vault:root';
interface InlineStreamingSettings {enabled:boolean;keepIntermediate:boolean;intermediateMode?:IntermediateMode;finalAnswerFormat?:FinalAnswerFormat}
type PreparedNote={content:string;images:Awaited<ReturnType<typeof collectImages>>};
interface Settings {codebase?:CodebaseState; replyFolders:ReplyFolders;threadTitleGeneration:ThreadTitleGeneration; paired:PairedConnection[];directProjects:Project[];directSelected:string[];directScanId:string; connection: Connection; projects: Project[]; selected: string[]; pending: Request[]; orchestration: OrchestrationSettings; inlineStreaming:InlineStreamingSettings; completion: CompletionSettings; completionJobs: CompletionJob[]; settlementJobs:ThreadSettlementJob[];autoSettleThreads:boolean; folderLinks:FolderLink[];folderLinkChanges:FolderLinkChange[];noteThreads:NoteThread[];vaultId:string;vaultLocations:VaultLocation[] }
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
  private projectDiscovery?:ProjectDiscovery;
  private catalogScope='';
  private accountCandidates=new Map<string,PairedConnection>();
  private registryNextAttempt=0;
  private registryFailures=0;
  private codebase?:CodebaseBridge;
  private projectListeners=new Set<()=>void>();
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
  private sending = false;
  private defaultSending=false;
  private sendGesture=new SendGesture();
  private busyListeners=new Set<()=>void>();
  get busy(){return this.sending;}
  set busy(value:boolean){
    if(this.sending===value)return;
    this.sending=value;
    for(const listener of this.busyListeners)try{listener();}catch(error){logFailure('ui.destination.busy-update',error);}
  }
  private monitoring = false;
  private stopped = false;
  private projectCreateModal?:ProjectCreateModal;
  private noteCommandServer?:import('./note-command-desktop').NoteCommandServer;
  private clientMaintenance?:import('./client-maintenance-desktop').DesktopClientMaintenance;
  private saving = Promise.resolve();
  private sharedBaseline='';
  private lastDiskSnapshot='';
  private queuedSharedSnapshot?:string;
  private folderLinkReplica:FolderLinkChange[]=[];
  private folderLinkClock=0;
  private checkingExternalSettings=false;
  private recentFolderGesture?:{path:string;at:number};
  private paletteChat?:PaletteChatController;
  private folderIndicators?:FolderIndicatorController;
  private vaultSetup?:Promise<Project>;
  private vaultSetupModal?:VaultSetupModal;
  private vaultRegistrations:Record<string,VaultRegistration>={};
  private eventSubscriptions?:EventSubscriptions;
  private eventHostServer?:import('./event-host-desktop').EventHostServer;
  private eventHostOpening?:Promise<void>;
  private inlineChat?:InlineChatManager;
  private questions?:QuestionController;
  private approvals?:ApprovalController;
  private questionModal?:QuestionModal;
  private questionPaths=new Set<string>();
  private toolRenderings=new Map<HTMLDetailsElement,{ref:string;child:MarkdownRenderChild;dispose:()=>void}>();
  private refreshingQuestions=false;
  private deviceInline?:DeviceInlineManager;
  private deviceCompletion?:DeviceResponseCompletion;
  private inlineActor=randomId();
  private inlineTargets:InlineHostTarget[]=[];
  private destinationRoutes=new Map<string,{record:LeaseRecord;host:InlineHostTarget;at:number}>();
  private inlineHostService?:import('./hosted-inline-desktop').DesktopInlineHost;
  private inlineHostKey='';
  private inlineHostRefresh?:Promise<void>;
  private noteCommandOpening?:Promise<void>;
  private inlineEnvironment?:Promise<string>;
  private eventLocalEnvironmentId?:string;
  private mobileSelectionAction?:{dispose():void};
  diagnostics?:EventJournal;
  private failedRequests=new WeakSet<Request>();
  private connectionRecovery?:ConnectionRecovery;
  private connectionRecoveryTarget(target:InlineHostTarget){return JSON.stringify([target.environmentId,target.workspaceRoot,target.directory]);}
  private failureKey(){return `t3-send-failures-v1:${this.settings.vaultId}`;}
  private recordSendFailure(request:Request|undefined,error:unknown,stage:string,startedAt:number){
    const derived=(part:string)=>{try{return request?commandId(request.id,part):undefined;}catch{return undefined;}};
    const failure:SendFailure={at:new Date().toISOString(),stage,elapsedMs:Math.max(0,Date.now()-startedAt),delivery:acceptedRequestThread(request)||request?.directPlan?.delivery||['delivery-evidence','local-confirmation'].includes(stage)?'accepted':['dispatch','startup-recovery'].includes(stage)?'unconfirmed':'not-started',...(request?{requestId:request.id,threadId:acceptedRequestThread(request)??request.threadId??derived('thread'),messageId:derived('message'),environmentId:request.connection.environmentId,bindingIds:(request.inlineBindings??(request.inlineHost?[request.inlineHost]:[])).map(binding=>binding.id)}:{}),error};
    try{this.app.saveLocalStorage(this.failureKey(),appendSendFailure(this.app.loadLocalStorage(this.failureKey()),failure));}catch{new Notice('The send failed. The device could not save its failure log.',10000);}
  }
  private async failRequest(request:Request,error:unknown,stage:string,startedAt:number){
    if(this.failedRequests.has(request))return;this.failedRequests.add(request);
    this.recordSendFailure(request,error,stage,startedAt);
    this.settings.pending=this.settings.pending.filter(item=>item.id!==request.id);
    const accepted=acceptedRequestThread(request);
    if(accepted){
      // Local rendering cannot revoke an acknowledged T3 message. Retain its
      // registered response and note/thread link; recovery never sends again.
      this.rememberStarted(request,accepted);
      try{this.persistAgentCommand(request,accepted);}catch(saveError){this.recordSendFailure(request,saveError,'accepted-command-receipt',startedAt);}
      try{await this.save();}catch(saveError){this.recordSendFailure(request,saveError,'accepted-local-save',startedAt);}
      return;
    }
    if(request.agentCommand)this.app.saveLocalStorage(`${this.localKey}-note-command-${request.agentCommand.id}`,{command:request.agentCommand,discarded:true});
    const bindings=request.inlineBindings??(request.inlineHost?[request.inlineHost]:[]);
    for(const binding of bindings)try{await this.responseGuard(binding,'failed',stage==='dispatch'||stage==='startup-recovery');}catch(cleanupError){this.recordSendFailure(request,cleanupError,'durable-response-cleanup',startedAt);}
    // Lost delivery acknowledgements need an exact server check. The durable
    // background guard makes that check without dispatching another prompt.
    if(bindings.length&&(stage==='dispatch'||stage==='startup-recovery')){try{await this.save();}catch(saveError){this.recordSendFailure(request,saveError,'failure-save',startedAt);}return;}
    for(const binding of bindings){
      if(binding.nativeProjection)try{await nativeResponses(this.app).stop(binding.id,binding.notePath,true);}catch(cleanupError){this.recordSendFailure(request,cleanupError,'local-response-cleanup',startedAt);}
      else try{await deviceNoteIO(this.app).updateNote(binding.notePath,document=>{const region=regionBody(document,binding.id);if(!region)return document;const change=finalizeRegion(document,binding.id,contentHash(region.body),'');return change?document.slice(0,change.from)+change.text+document.slice(change.to):document;},()=>!this.stopped);}catch(cleanupError){this.recordSendFailure(request,cleanupError,'local-response-cleanup',startedAt);}
      this.deviceInline?.stopLocally(binding.id);
      if(this.deviceInline&&[2,3,4].includes(binding.version))void this.deviceInline.failResponse(binding.host,binding.id).catch(cleanupError=>this.recordSendFailure(request,cleanupError,'failure-cleanup',startedAt));
      else void this.stopHostedInline(binding.id,binding.host).catch(cleanupError=>this.recordSendFailure(request,cleanupError,'failure-cleanup',startedAt));
    }
    const attached=request.inlineSteering??request.inlineFollow;
    if(attached){const existing=this.inlineChat?.find(attached.jobId);if(existing)await this.inlineChat!.stop(existing);else{await nativeResponses(this.app).stop(attached.jobId,request.inlineFollow?.notePath??request.noteThread?.notePath);this.deviceInline?.stopLocally(attached.jobId);if(attached.host)void this.stopHostedInline(attached.jobId,attached.host).catch(cleanupError=>this.recordSendFailure(request,cleanupError,'failure-cleanup',startedAt));}}
    const job=this.inlineChat?.find(request.id);if(job)await this.inlineChat!.deliveryFailed(job);
    // Save cleanup independently of the network. A cleanup failure never
    // recreates a request or schedules another prompt dispatch.
    try{await this.save();}catch(saveError){this.recordSendFailure(request,saveError,'failure-save',startedAt);}
  }
  private stopContentHash?:()=>void;
  async onload() {
    if(!Platform.isMobile)this.stopContentHash=(await import('./content-hash-desktop')).installDesktopContentHash();
    if(typeof this.registerDomEvent==='function')this.registerDomEvent(document,'t3-review-response-location' as any,(event:Event)=>{const id=(event as CustomEvent).detail?.bindingId;if(typeof id==='string')new ResponseLocationModal(this.app,id,command=>this.executeAgentCommand(command)).open();});
    if(typeof this.registerDomEvent==='function'){
      this.registerDomEvent(document,'toggle' as any,(event:Event)=>{
        const details=event.target as HTMLDetailsElement;if(!details?.matches?.('details[data-t3-tool-ref]')||!details.open)return;
        const ref=details.getAttribute('data-t3-tool-ref')!,old=this.toolRenderings.get(details);if(old?.ref===ref)return;
        if(old){old.dispose();this.removeChild(old.child);this.toolRenderings.delete(details);}
        const child=new MarkdownRenderChild(details);this.addChild(child);
        const dispose=mountToolGroups(details,value=>nativeResponses(this.app).toolGroup(details,value),(html,target)=>MarkdownRenderer.render(this.app,html,target,this.app.workspace.getActiveFile()?.path??'',child),error=>new Notice(`T3 Code: ${message(error)}`));
        child.register(dispose);this.toolRenderings.set(details,{ref,child,dispose});
      },true);
      const observer=new MutationObserver(()=>{for(const [details,rendering] of this.toolRenderings)if(!details.isConnected){rendering.dispose();this.removeChild(rendering.child);this.toolRenderings.delete(details);}});
      observer.observe(document,{subtree:true,childList:true});this.register(()=>{observer.disconnect();for(const rendering of this.toolRenderings.values()){rendering.dispose();this.removeChild(rendering.child);}this.toolRenderings.clear();});
    }
    const data = await this.loadData();
    this.lastDiskSnapshot=JSON.stringify(data);
    const local = this.app.loadLocalStorage(this.localKey);
    this.deviceId=local?.deviceId??randomId();
    this.compactNoteCommandReceipts();
    const state=await deviceState(this.deviceId);
    const defaults:Connection = Platform.isMobile ? {executable:'',host:'local'} : (await import('./desktop')).desktopDefaults();
    this.mode=Platform.isMobile||local?.mode!=='desktop'?'direct':'desktop';
    this.pairedSessions=local?.pairedSessions??{};
    this.cloudAccount=local?.cloudAccount??null;
    this.nativeAccount=local?.nativeAccount??null;
    this.vaultRegistrations=local?.vaultRegistrations??{};
    this.settings = {codebase:data?.codebase,replyFolders:loadReplyFolders(data?.replyFolders),threadTitleGeneration:threadTitleGeneration(data?.threadTitleGeneration),paired:data?.paired??[],directProjects:data?.directProjects??[],directSelected:data?.directSelected??[],directScanId:data?.directScanId??'',connection:local?.connection??data?.connection??defaults,projects:data?.projects??[],selected:data?.selected??[],pending:state?.pending??(!Platform.isMobile?data?.pending:[])??[],orchestration:{waitForOtherThreads:data?.orchestration?.waitForOtherThreads === true},inlineStreaming:{finalAnswerFormat:finalAnswerFormat(data?.inlineStreaming?.finalAnswerFormat),enabled:data?.inlineStreaming?.enabled??(data?.inlineStreaming?.askT3!==false&&data?.inlineStreaming?.sendToT3!==false),keepIntermediate:data?.inlineStreaming?.keepIntermediate===true,...(data?.inlineStreaming?.intermediateMode?{intermediateMode:intermediateMode(data.inlineStreaming.intermediateMode,data.inlineStreaming.keepIntermediate)}:{})},completion:{action:['archive','delete'].includes(data?.completion?.action)?data.completion.action:'keep',archiveFolder:data?.completion?.archiveFolder ?? 'Archive/T3 Code'},completionJobs:state?.completionJobs??(!Platform.isMobile?data?.completionJobs:[])??[],settlementJobs:Array.isArray(state?.settlementJobs)?state.settlementJobs:[],autoSettleThreads:data?.autoSettleThreads!==false,folderLinks:loadFolderLinks(data),folderLinkChanges:loadFolderLinkChanges(data?.folderLinkChanges),noteThreads:loadNoteThreads(data?.noteThreads),vaultId:vaultIdentity(data)??randomId(),vaultLocations:loadVaultLocations(data)};
    if(!Platform.isMobile){
      const key=`t3-connection-recovery-v1:${this.settings.vaultId}`;
      this.connectionRecovery=new ConnectionRecovery({
        load:()=>{const value=this.app.loadLocalStorage(key);return value&&typeof value==='object'?value as ConnectionReloadState:{};},
        save:value=>this.app.saveLocalStorage(key,value),
        reload:beforeDispatch=>this.reloadForConnection(beforeDispatch),
        failure:()=>{/* Retry only if Obsidian itself could not invoke the reload. */},
      });
      this.app.workspace.onLayoutReady(()=>this.registerInlineInterval(()=>this.connectionRecovery?.tick(),1000));
    }
    this.folderLinkReplica=mergeFolderLinkChanges(this.settings.folderLinkChanges,loadFolderLinkChanges(await deviceState(`folder-links:${this.deviceId}:${this.settings.vaultId}`)));
    this.settings.folderLinkChanges=this.folderLinkReplica;
    this.settings.folderLinks=applyFolderLinkChanges(this.settings.folderLinks,this.folderLinkReplica);
    const restoreFolderLinks=JSON.stringify(loadFolderLinks(data))!==JSON.stringify(this.settings.folderLinks)||JSON.stringify(loadFolderLinkChanges(data?.folderLinkChanges))!==JSON.stringify(this.folderLinkReplica);
    // General logging is disabled for the performance isolation trial. Do not create
    // a journal, operation wrappers, diagnostic listeners or flush timers.
    configureDiagnostics();
    try{await clearDeviceDiagnostics(this.settings.vaultId);}catch(error){new Notice(message(error));}
    const adapter=this.app.vault?.adapter;
    if(adapter&&typeof adapter.exists==='function'&&typeof adapter.remove==='function'){
      try{await clearVaultDiagnostics(adapter,this.app.vault.configDir||'.obsidian');}catch(error){new Notice(`Could not clear plugin logs: ${message(error)}`);}
    }
    this.addCommand({id:'export-diagnostics',name:'Export send failure log…',callback:()=>void this.exportDiagnostics().catch(error=>new Notice(message(error)))});
    if(typeof window!=='undefined'&&typeof window.addEventListener==='function'){
      const watch=(win:Window)=>this.register(this.sendGesture.watch(win));
      watch(window);
      const windows=new Set<Window>([window]);
      for(const leaf of this.app.workspace.getLeavesOfType('markdown')){const win=leaf.view.containerEl?.ownerDocument.defaultView;if(win&&!windows.has(win)){windows.add(win);watch(win);}}
      this.registerEvent(this.app.workspace.on('window-open',(_workspace,win)=>{if(!windows.has(win)){windows.add(win);watch(win);}}));
    }
    this.addCommand({id:'send-or-ask',name:'Send to T3 Code',editorCheckCallback:(checking,editor,view)=>{
      const file=view.file;
      if(this.stopped||this.busy||this.defaultSending||!file||file.extension.toLowerCase()!=='md')return false;
      if(!checking)void this.openManualAction(file,'',editor.getSelection(),{editor,view},this.commandSendSelector(view)).catch(error=>new Notice(`T3 Code: ${message(error)}`,10000));
      return true;
    }});
    this.addCommand({id:'send-or-ask-choose',name:'Send or Ask T3 Code: choose destination…',editorCheckCallback:(checking,editor,view)=>{
      const file=view.file;
      if(this.stopped||this.busy||this.defaultSending||!file||file.extension.toLowerCase()!=='md')return false;
      if(!checking)void this.openManualAction(file,'',editor.getSelection(),{editor,view},true).catch(error=>new Notice(`T3 Code: ${message(error)}`,10000));
      return true;
    }});
    let migratedNoteThreads=false;
    for(const job of this.settings.completionJobs){
      if(this.noteThread(job.notePath)||typeof this.app.vault?.getAbstractFileByPath!=='function'||!(this.app.vault.getAbstractFileByPath(job.notePath) instanceof TFile))continue;
      const project=[...this.settings.directProjects,...this.settings.projects].find(item=>item.id===job.projectId&&(item.connectionId??'')===(job.connection.connectionId??''));
      if(!project)continue;
      this.settings.noteThreads.push({notePath:job.notePath,threadId:job.threadId,projectId:project.id,workspaceRoot:project.workspaceRoot,connectionId:project.connectionId??'',...(job.connection.environmentId?{environmentId:job.connection.environmentId}:{}),selectedAt:new Date().toISOString()});
      migratedNoteThreads=true;
    }
    this.inlineChat=new InlineChatManager(this.app,`${this.localKey}-inline-${this.settings.vaultId}`,id=>this.sessionFor(id),{prepare:(job,request)=>this.prepareHostedInline(job,request),stop:job=>job.localOnly?this.stopLocalInline(job):this.stopHostedInline(job.id,job.hostTarget,job.remoteStopOperationId),status:job=>this.deviceInline?.responseStatus(job.id)},()=>'collapse',()=>finalAnswerFormat(this.settings.inlineStreaming.finalAnswerFormat));
    const storedTargets=this.app.loadLocalStorage(`${this.localKey}-inline-hosts-${this.settings.vaultId}`);
    if(Array.isArray(storedTargets))this.inlineTargets=storedTargets.filter(target=>target&&typeof target.environmentId==='string'&&typeof target.workspaceRoot==='string'&&typeof target.directory==='string');
    if(typeof this.registerEditorExtension==='function'){const {EditorState}=require('@codemirror/state') as typeof import('@codemirror/state');this.registerEditorExtension(EditorState.transactionFilter.of(transaction=>nativeResponses(this.app).filter(transaction)));}
    const previewKey=`native-preview:${this.deviceId}:${this.settings.vaultId}`;
    let savedPreviews:unknown;try{savedPreviews=await deviceState(previewKey);}catch(error){logFailure('note.preview.cache-load',error);}
    nativeResponses(this.app).configurePreviewCache(this.settings.vaultId,savedPreviews,async snapshot=>{await deviceState(previewKey,snapshot);});
    try{await nativeResponses(this.app).configureStoppedStore(nativeStoppedStore(this.deviceId,this.settings.vaultId));}catch(error){logFailure('note.stop.cache-restore',error);new Notice('T3 Code: Frozen response recovery is waiting for device storage. Saved recovery text is retained.',10000);}
    const completionStorage=deviceCompletionStore(this.deviceId,this.settings.vaultId);
    let restoringCompletions=true;
    const deviceCompletion=this.deviceCompletion=new DeviceResponseCompletion(this.deviceId,completionStorage.store,deviceFinalNoteIO(this.app,()=>!this.stopped),(path,proof)=>nativeResponses(this.app).deviceCommitted(path,proof,!restoringCompletions),record=>{
      const conflict=record.conflicts.at(-1);if(!conflict)return;
      nativeResponses(this.app).completionConflict(record.notePath,conflict.original,conflict.latest,conflict.proposed??conflict.latest,conflict.reason);
    },receipt=>nativeResponses(this.app).retiredCommitted(receipt));
    try{let cursor=0;do{const batch=await completionStorage.restorePending(cursor);for(const record of batch.records){deviceCompletion.restorePending(record);this.rememberInlineTarget(record.request.host);}cursor=batch.next;}while(cursor);const restored=await completionStorage.restore();for(const record of restored)deviceCompletion.restore(record);const receipts=await completionStorage.restoreReceipts();for(const record of receipts)deviceCompletion.restoreReceipt(record);if(restored.length||receipts.length)nativeResponses(this.app).refresh();}catch(error){logFailure('response.device-completion.restore',error);new Notice(message(error),10000);}finally{restoringCompletions=false;}
    if(typeof this.registerView==='function'){
    this.codebase=new CodebaseBridge(this.app,this,codebaseTransport(async(environmentId,reason)=>{
      if(!Platform.isMobile){try{if(environmentId===await this.localInlineEnvironment())return (await import('./desktop')).desktopThreadAccess({...this.settings.connection,host:'local'});}catch{/* Remote paired access remains available when local discovery fails. */}}
      return this.inlineThreadAccess(environmentId,reason==='auth-rejected');
    }),()=>this.settings.folderLinks.map(link=>({...link,environmentId:link.environmentId??this.settings.paired.find(c=>c.id===link.connectionId)?.environmentId??this.eventLocalEnvironmentId})),this.settings.vaultId,{load:()=>this.settings.codebase,save:async state=>{this.settings.codebase=state;await this.save();},projectChanged:async(scope,change)=>{await this.updateCodebaseProjectLinks(scope,change);}});
    await this.codebase.install();
    }
    this.deviceInline=new DeviceInlineManager(this.inlineActor,this.settings.vaultId,{...deviceNoteIO(this.app),localFinalNotes:deviceFinalNoteIO(this.app,()=>!this.stopped),allowLocalMigration:(id,path)=>nativeResponses(this.app).allowLocalBinding(id,path),retainLocalFinal:async update=>{await deviceState(`local-final:${this.deviceId}:${this.settings.vaultId}:${update.request.id}`,retainedLocalFinal(update));},loadLocalFinal:async request=>restoredLocalFinal(await deviceState(`local-final:${this.deviceId}:${this.settings.vaultId}:${request.id}`),request),localFinalDraft:async(document,request)=>{if(!request.localStage)return document;const opened=await this.inlineHostFiles(request.host,false);try{return await localStagedDraft(document,request,opened.files);}finally{opened.close();}},syncReady:()=>localSyncReady(this.app),openedNotes:()=>this.app.workspace.getLeavesOfType('markdown').map(leaf=>leaf.view as MarkdownView).filter(view=>view.file&&typeof view.getViewData==='function').map(view=>({path:view.file!.path,document:nativeResponses(this.app).view(view)?.saved()??view.getViewData()})),saveLocalNote:async path=>{for(const leaf of this.app.workspace.getLeavesOfType('markdown')){const view=leaf.view as MarkdownView;if(view.file?.path===path&&typeof view.save==='function')await view.save();}},localCompleted:(id,path)=>{nativeResponses(this.app).localCompleted(id,path);void deviceState(`local-final:${this.deviceId}:${this.settings.vaultId}:${id}`,null).catch(error=>logFailure('response.local.final-cache-cleanup',error));this.inlineChat?.flushAvailable();},localQuestions:update=>{if(update.questionActivities)this.questions?.observe(update.request.threadEnvironmentId,update.request.threadId,update.questionActivities,update.sequence);},localFinalBody:async update=>rewriteReplyReferences(update.body,async reference=>{try{return await resolveReplyReference(this.app,reference,update.request,await this.inlineThreadAccess(update.request.threadEnvironmentId));}catch{return undefined;}}),connectionTimeout:(target,error)=>{if(this.connectionRecovery?.failed(this.connectionRecoveryTarget(target),error))this.recordSendFailure(undefined,error,'connection-timeout',Date.now()-error.elapsedMs);},connectionRecovered:target=>this.connectionRecovery?.recovered(this.connectionRecoveryTarget(target)),completionActor:this.deviceId,completionAcknowledged:record=>deviceCompletion.acknowledged(record),completeResponse:(record,original,staged,prepare,abort)=>deviceCompletion.complete(record,original,staged,prepare,abort),completionFailed:error=>new Notice(`T3 Code: ${message(error)}`,10000),loadStops:()=>this.app.loadLocalStorage(`t3-stopped-responses:${this.settings.vaultId}`)??[],saveStops:ids=>this.app.saveLocalStorage(`t3-stopped-responses:${this.settings.vaultId}`,ids),loadRenames:()=>this.app.loadLocalStorage('t3-pending-response-renames')??[],saveRenames:renames=>this.app.saveLocalStorage('t3-pending-response-renames',renames),receiveCoordinated:(record,proof)=>{this.codebase?.observeSource(record.request,record.state?.notePath??record.request.notePath);return nativeResponses(this.app).receive(record,proof);},receiveDirect:update=>{this.inlineChat?.observeLocal(update);this.codebase?.observeSource(update.request);if(update.questionActivities)this.questions?.observe(update.request.threadEnvironmentId,update.request.threadId,update.questionActivities,update.sequence);return nativeResponses(this.app).stream(update);},receiveThreadTitle:(id,title)=>nativeResponses(this.app).title(id,title),readSaved:async path=>{const file=this.app.vault.getFileByPath(path);return file?this.app.vault.read(file):undefined;},access:(environmentId,reason)=>this.inlineThreadAccess(environmentId,reason==='auth-rejected'),resolveReplyReference:(reference,request,access)=>resolveReplyReference(this.app,reference,request,access)},target=>this.inlineHostFiles(target,false),undefined,undefined,Platform.isMobile?undefined:async milliseconds=>(await import('./desktop-timers')).desktopPause(milliseconds));
    let completionCleanupCursor=0,completionCleanupBusy=false,lastProofCleanup=0;
    this.app.workspace.onLayoutReady(()=>this.registerInlineInterval(()=>{
      if(completionCleanupBusy||this.stopped)return;completionCleanupBusy=true;
      void (async()=>{if(Date.now()-lastProofCleanup>=60_000){await completionStorage.pruneProofs();lastProofCleanup=Date.now();}return completionStorage.candidates(completionCleanupCursor);})().then(batch=>{
        completionCleanupCursor=batch.next;for(const record of batch.records)this.rememberInlineTarget(record.host);
        this.deviceInline?.discover(this.inlineTargets,batch.records.map(record=>record.id));
      }).catch(error=>logFailure('response.completion-cleanup.discovery',error)).finally(()=>{completionCleanupBusy=false;});
    },5000));
    this.addCommand({id:'stop-all-responses',name:'Stop all T3 responses in current note',editorCheckCallback:(checking,editor,view)=>{
      const file=view.file;if(this.stopped||!file||file.extension.toLowerCase()!=='md')return false;
      if(!checking)void this.inlineChat!.stopAllAt(editor,view,this.deviceInline?.stoppableResponses(file.path)).then(count=>new Notice(count?`Stopped ${count} T3 response${count===1?'':'s'} in this note.`:'No active or failed T3 responses in this note.')).catch(error=>new Notice(`T3: ${message(error)}`,10000));
      return true;
    }});
    if(!Platform.isMobile)this.app.workspace.onLayoutReady(()=>{
      const refresh=()=>{void this.refreshNoteCommandHost().catch(()=>{});void this.refreshEventHost().catch(()=>{});};
      refresh();this.registerInlineInterval(refresh,5000);
    });
    this.addCommand({id:'send-note-to-multiple-notes',name:'Send note with streaming destinations…',checkCallback:checking=>{
      const file=this.app.workspace.getActiveViewOfType(MarkdownView)?.file;if(!file||this.busy)return false;
      if(!checking)new StreamDestinationsModal(this.app,file.path,command=>this.executeNoteCommand(command)).open();return true;
    }});
    this.addCommand({id:'import-t3-run',name:'Import T3 run into this note…',checkCallback:checking=>{
      const file=this.app.workspace.getActiveViewOfType(MarkdownView)?.file;if(this.stopped||this.busy||!file||file.extension.toLowerCase()!=='md')return false;
      if(!checking)this.openRunImport(file);return true;
    }});
    this.addCommand({id:'manage-note-t3-streams',name:'Manage T3 streams in this note…',checkCallback:checking=>{
      const file=this.app.workspace.getActiveViewOfType(MarkdownView)?.file;if(this.stopped||this.busy||!file||file.extension.toLowerCase()!=='md')return false;
      if(!checking)void this.openImportStreams(file).catch(error=>new Notice(`T3 streams: ${message(error)}`,10000));return true;
    }});
    if(typeof document.querySelectorAll==='function')this.register(installResponsePresentation(document,setIcon));
    const shineDocuments=new Map<Document,()=>void>();
    const watchShine=(root:Document)=>{if(root.body&&!shineDocuments.has(root))shineDocuments.set(root,installActivityShine(root));};
    if(typeof document.querySelectorAll==='function'){
      watchShine(document);
      this.register(()=>{for(const dispose of shineDocuments.values())dispose();shineDocuments.clear();});
      this.registerEvent(this.app.workspace.on('window-open',(_win,window)=>watchShine(window.document)));
      this.registerEvent(this.app.workspace.on('window-close',(_win,window)=>{shineDocuments.get(window.document)?.();shineDocuments.delete(window.document);}));
    }
    if(typeof document.querySelectorAll==='function')this.register(installStreamBlockControls(this.app,document,setIcon,error=>new Notice(`T3: ${message(error)}`,10000)));
    const questionStorage=`${this.localKey}-questions-${this.settings.vaultId}`;
    this.questions=new QuestionController(environmentId=>this.inlineThreadAccess(environmentId),{load:()=>{const saved=this.app.loadLocalStorage(questionStorage);return Array.isArray(saved)?saved:[];},save:records=>this.app.saveLocalStorage(questionStorage,records)},randomId);
    const approvalStorage=`${this.localKey}-approvals-${this.settings.vaultId}`;
    this.approvals=new ApprovalController(environmentId=>this.inlineThreadAccess(environmentId),{load:()=>{const saved=this.app.loadLocalStorage(approvalStorage);return Array.isArray(saved)?saved:[];},save:records=>this.app.saveLocalStorage(approvalStorage,records)},randomId);
    const questionPaths=this.app.loadLocalStorage(`${questionStorage}-paths`);if(Array.isArray(questionPaths))for(const path of questionPaths)if(typeof path==='string')this.questionPaths.add(path);
    let dismissalRevision=this.questions.dismissalRevision;
    this.questions.subscribe(()=>{if(dismissalRevision===this.questions!.dismissalRevision)return;dismissalRevision=this.questions!.dismissalRevision;void this.cleanDismissedQuestions();});
    if(typeof window!=='undefined'&&typeof window.addEventListener==='function')this.registerDomEvent(window,'pagehide',()=>{try{this.questions?.flushDrafts();}catch(error){logFailure('question.draft.flush',error);}});
    if(typeof this.registerEditorExtension==='function'){this.registerEditorExtension(hiddenInlineMarkerExtension());this.registerEditorExtension(questionEditorExtension(this.questions,target=>this.openQuestion(target)));this.registerEditorExtension(approvalEditorExtension(this.approvals));}
    if(typeof this.registerMarkdownPostProcessor==='function')this.registerMarkdownPostProcessor((element,ctx)=>{
      hideResponseContainerBoundaries(element,ctx);
      for(const link of Array.from(element.querySelectorAll<HTMLAnchorElement>('a[href^="t3-question:"]'))){
        const target=parseQuestionToken((link.getAttribute('href')??'').slice('t3-question:'.length));if(!target)continue;
        const control=questionButton(this.questions!,target,value=>this.openQuestion(value));link.replaceWith(control.button);
        const quote=control.button.closest('blockquote');if(quote)quote.hidden=this.questions!.isDismissed(target);
        const child=new MarkdownRenderChild(control.button);child.register(control.unsubscribe);ctx.addChild(child);
        this.questionPaths.add(ctx.sourcePath);
      }
      for(const link of Array.from(element.querySelectorAll<HTMLAnchorElement>('a[href^="t3-approval:"]'))){
        const parsed=parseApprovalUrl(link.getAttribute('href')??'');if(!parsed||link.closest('pre,code'))continue;
        const control=approvalButton(this.approvals!,parsed.target,parsed.decision);link.replaceWith(control.button);
        const child=new MarkdownRenderChild(control.button);child.register(control.unsubscribe);ctx.addChild(child);
        this.questionPaths.add(ctx.sourcePath);
      }
    });
    this.addCommand({id:'answer-t3-question',name:'Answer T3 question…',checkCallback:checking=>{
      const view=this.app.workspace.getActiveViewOfType(MarkdownView);const targets=view?questionTargets(view.editor?.getValue()??'').filter(target=>!this.questions!.isDismissed(target)&&this.questions!.view(target).status!=='resolved'):[];
      if(!targets.length)return false;if(!checking)this.openQuestion(targets[0]);return true;
    }});
    this.app.workspace.onLayoutReady(()=>{
      void this.refreshQuestions();
      this.registerInterval(window.setInterval(()=>{
        // Control polling must not wait for a note's filesystem save queue.
        void this.questions?.refresh(this.questions.watchedTargets(),1000);
        void this.refreshQuestions();
      },1500));
    });
    if(Platform.isMobile&&typeof document.addEventListener==='function'){
      this.mobileSelectionAction=installMobileSelectionAction(this.app,()=>this.app.workspace.getActiveViewOfType(MarkdownView),()=>!this.busy&&!this.defaultSending,captureEditorSelection,({editor,view,text,anchor,showSelector})=>this.openEditorChat(text,view.file!,{editor,view,anchor},showSelector));
    }
    this.sharedBaseline=JSON.stringify(this.sharedSnapshot());
    for(const request of [...this.settings.pending])await this.failRequest(request,Error('The previous send ended without a local confirmation.'),'startup-recovery',Date.now());
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
    await this.initializeProjectCatalog();
    configureBridge({mobile:Platform.isMobile,pairedSession:id=>this.sessionFor(id),saveRequest:async request=>{if(!this.settings.pending.includes(request))throw Error('Saved request is missing. Nothing was sent.');this.persistAgentCommand(request);await this.save();}});
    // Migrate unfinished desktop requests once, but do not rewrite the shared
    // settings file merely because this device started. Credentials and jobs
    // are device-local.
    await this.saveDeviceState();
    // A new vault must publish its stable identity before another device can
    // verify the same vault root. This is a one-time migration, not an
    // unconditional startup snapshot write, and uses the conflict-safe path.
    if(typeof data?.vaultId!=='string'||!data.vaultId)await this.save(true);
    else if(migratedNoteThreads||restoreFolderLinks)await this.save(true);
    await this.publishVaultIdentity();
    this.addSettingTab(new T3Settings(this.app,this));
    this.app.workspace.onLayoutReady(()=>{
      if(this.stopped)return;
      if(Platform.isMobile&&typeof document!=='undefined'&&typeof this.registerDomEvent==='function'){
        const remember=(event:Event)=>{const target=event.target,title=target instanceof Element?target.closest('.nav-folder-title[data-path]'):null,path=title?.getAttribute('data-path');this.recentFolderGesture=path?{path,at:Date.now()}:undefined;};
        this.registerDomEvent(document,'pointerdown',remember,true);
        this.registerDomEvent(document,'touchstart',remember,true);
      }
      this.paletteChat=installPaletteChat(this.app,(prompt,selection,showSelector)=>this.openPaletteAction(prompt,selection,showSelector),{onError:error=>new Notice(`T3 Code: ${message(error)}`,10000),getDraft:()=>this.app.loadLocalStorage(this.chatDraftKey)??'',saveDraft:draft=>this.app.saveLocalStorage(this.chatDraftKey,draft),getSelection:()=>this.app.workspace.getActiveViewOfType(MarkdownView)?.editor?.getSelection()??''});
      this.registerInterval(window.setInterval(()=>this.paletteChat?.reconcile(),2000));
      if(typeof document!=='undefined'&&document.body&&typeof MutationObserver!=='undefined'){
        this.folderIndicators=installFolderIndicators(document.body,()=>this.settings.folderLinks,()=>{
          const responses=this.deviceInline?.explorerResponses()??[],known=new Set(responses.map(r=>r.id));
          return noteIndicators([...responses,...(this.inlineChat?.explorerResponses()??[]).filter(r=>!known.has(r.id))],path=>this.app.vault.getAbstractFileByPath(path) instanceof TFile);
        },title=>{
          const plugin=(this.app as App&{plugins?:{plugins?:Record<string,{settings?:FolderNotesSettings}>}}).plugins?.plugins?.['folder-notes'];
          if(!plugin||!title.classList.contains('has-folder-note'))return;
          return folderNotePath(title.getAttribute('data-path')??'',plugin.settings,path=>this.app.vault.getAbstractFileByPath(path) instanceof TFile);
        },notes=>{
          const tabs:Parameters<typeof decorateActivityTabs>[0]=[];
          this.app.workspace.iterateAllLeaves(leaf=>{
            const header=(leaf as typeof leaf&{tabHeaderEl?:HTMLElement}).tabHeaderEl;
            if(header)watchShine(header.ownerDocument);
            tabs.push({path:activityLeafPath(leaf as typeof leaf&ActivityLeaf),title:header?.querySelector<HTMLElement>('.workspace-tab-header-inner-title')??null});
          });
          decorateActivityTabs(tabs,notes);
          const mobile=(this.app as App&{plugins?:{plugins?:Record<string,{
            tabs?:()=>ActivityLeaf[];
            activeTab?:(tabs:ActivityLeaf[])=>ActivityLeaf|null;
            settings?:{wrap?:boolean};
          }>}}).plugins?.plugins?.['mobile-tab-bar'];
          const mobileTabs=mobile?.tabs?.()??[];
          decorateMobileActivityTabs(document,mobileTabs.map(activityLeafPath),mobileTabs.indexOf(mobile?.activeTab?.(mobileTabs) as typeof mobileTabs[number]),!!mobile?.settings?.wrap,notes);
        });
        this.registerInterval(window.setInterval(()=>this.folderIndicators?.refresh(),1000));
        this.registerEvent(this.app.workspace.on('layout-change',()=>this.folderIndicators?.refresh()));
      }
      this.registerInterval(window.setInterval(()=>void this.checkExternalSettings().catch(error=>new Notice(`T3 settings: ${message(error)}`,12000)),5000));
    });
    this.app.workspace.onLayoutReady(()=>{if(!this.stopped){this.refreshProjectsInBackground(true);void this.monitorCompletions();this.registerInterval(window.setInterval(()=>{void this.monitorCompletions();},30_000));}});
    this.app.workspace.onLayoutReady(()=>{
      this.registerInterval(window.setInterval(()=>this.refreshProjectsInBackground(),15_000));
      if(typeof document.addEventListener==='function')this.registerDomEvent(document,'visibilitychange',()=>{if(!document.hidden)this.refreshProjectsInBackground();});
      if(typeof window.addEventListener==='function'){this.registerDomEvent(window,'focus',()=>this.refreshProjectsInBackground());this.registerDomEvent(window,'online',()=>this.refreshProjectsInBackground(true));}
      this.inlineChat?.resume();
    });
    this.app.workspace.onLayoutReady(()=>{
      let nextNativeRefresh=0,queued=false;
      const refreshNative=()=>{
        if(this.stopped)return;
        const manager=nativeResponses(this.app);manager.refresh();
        // Recovery discovery reads every open native document. The host
        // catalog already polls at three seconds; compute current anchor IDs
        // with the one-second view pass, and immediately on workspace events.
        this.deviceInline?.discover(this.inlineTargets,manager.reconnectingResponseIds());
        nextNativeRefresh=performance.now()+1000;
      };
      // Stream/lease changes already refresh their native projection directly.
      // Keep the 150 ms device/legacy writer cadence, but avoid rebuilding every
      // unchanged native view at that rate. Workspace changes remain immediate.
      const queueNative=()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;refreshNative();});};
      this.registerEvent(this.app.workspace.on('layout-change',queueNative));
      this.registerEvent(this.app.workspace.on('file-open',queueNative));
      let lastResume=-Infinity,lastTick=Date.now();
      const resume=()=>{
        if(this.stopped||document.hidden)return;
        const now=performance.now();if(now-lastResume<250)return;lastResume=now;
        refreshNative();this.deviceInline?.resume(this.inlineTargets,nativeResponses(this.app).reconnectingResponseIds());
      };
      if(typeof document.addEventListener==='function')this.registerDomEvent(document,'visibilitychange',()=>{if(!document.hidden)resume();});
      if(typeof window.addEventListener==='function'){this.registerDomEvent(window,'focus',resume);this.registerDomEvent(window,'online',resume);}
      const tick=()=>{
        const now=Date.now();if(now-lastTick>2000)resume();lastTick=now;
        if(performance.now()>=nextNativeRefresh)refreshNative();this.deviceInline?.tick();
      };
      tick();this.registerInlineInterval(tick,150);
      const remember=()=>{if(this.settings.folderLinks.some(link=>link.folderPath==='/'))void this.inlineHostTarget().then(target=>this.rememberInlineTarget(target)).catch(()=>{});};
      remember();this.registerInterval(window.setInterval(remember,5000));
    });
    if(!Platform.isMobile)this.app.workspace.onLayoutReady(()=>{
      const tick=()=>void this.refreshInlineHost().then(()=>this.inlineHostService?.tick()).catch(()=>{/* The durable job retries after the host reconnects. */});
      tick();this.registerInlineInterval(tick,1500);
    });
    this.registerEvent(this.app.workspace.on('file-open',()=>this.inlineChat?.flushAvailable()));
    this.registerEvent(this.app.workspace.on('layout-change',()=>this.inlineChat?.flushAvailable()));
    if(typeof this.app.vault?.on==='function'){
      for(const name of ['create','modify'] as const)this.registerEvent(this.app.vault.on(name as any,(file:TAbstractFile)=>{this.deviceCompletion?.changed(file.path);this.deviceInline?.changed(file.path);void nativeResponses(this.app).changed(file.path).catch(error=>logFailure('note.projection.file-update',error,{notePath:file.path}));}));
      this.registerEvent(this.app.vault.on('delete',file=>{this.deviceInline?.deleted(file.path);nativeResponses(this.app).deleted(file.path);this.inlineHostService?.deleted(file.path);this.folderIndicators?.refresh();}));
      this.registerEvent(this.app.vault.on('rename',(file,oldPath)=>this.inlineChat?.renamed(oldPath,file.path)));
      this.registerEvent(this.app.vault.on('rename',(file,oldPath)=>{if(file instanceof TFolder)void this.renameLinkedFolder(oldPath,file.path).catch(error=>new Notice(`T3 folder links: ${message(error)}`,10000));}));
      this.registerEvent(this.app.vault.on('rename',(file,oldPath)=>{nativeResponses(this.app).renamed(oldPath,file.path);this.inlineHostService?.renamed(oldPath,file.path);void deviceCompletion.renamed(oldPath,file.path).catch(error=>logFailure('response.device-completion.rename',error));this.deviceInline?.renamed(oldPath,file.path);}));
      this.registerEvent(this.app.vault.on('delete',file=>{this.inlineChat?.deleted(file.path);this.questionPaths.delete(file.path);}));
      this.registerEvent(this.app.vault.on('modify',file=>{if(file instanceof TFile&&file.extension==='md')void this.app.vault.read(file).then(text=>{if(questionTargets(text).length||approvalTargets(text).length)this.questionPaths.add(file.path);}).catch(()=>{});}));
      this.registerEvent(this.app.vault.on('rename',(file,oldPath)=>{for(const path of [...this.questionPaths])if(path===oldPath||path.startsWith(oldPath+'/')){this.questionPaths.delete(path);this.questionPaths.add(file.path+path.slice(oldPath.length));}}));
      this.registerEvent(this.app.vault.on('rename',(file,oldPath)=>{void (async()=>{const moved=this.settings.noteThreads.filter(entry=>!entry.deletedAt&&(entry.notePath===oldPath||file instanceof TFolder&&entry.notePath.startsWith(oldPath+'/')));if(!moved.length)return;this.settings.noteThreads=mutateNoteThreads(this.settings.noteThreads,oldPath,file.path,file instanceof TFolder);await this.save();})().catch(error=>new Notice(`T3 thread history: ${message(error)}`,10000));}));
      this.registerEvent(this.app.vault.on('delete',file=>{void (async()=>{const affected=this.settings.noteThreads.filter(entry=>entry.notePath===file.path||file instanceof TFolder&&entry.notePath.startsWith(file.path+'/'));if(!affected.length)return;this.settings.noteThreads=mutateNoteThreads(this.settings.noteThreads,file.path,undefined,file instanceof TFolder);await this.save();})().catch(error=>new Notice(`T3 thread history: ${message(error)}`,10000));}));
    }
    this.registerEvent(this.app.workspace.on('file-menu',(menu,file,source) => {
      if(file instanceof TFolder){
        const folder=this.folderForMenu(file);
        menu.addItem(item=>{item.setTitle('Link to T3 Code').setIcon('link');const submenu=(item as MenuItem&{setSubmenu?:()=>Menu}).setSubmenu?.();if(!submenu){item.onClick(()=>new FolderLinkProjectModal(this.app,this,folder).open());return;}const projects=this.projects();for(const project of projects)submenu.addItem(i=>i.setTitle(`Link to ${this.projectChoiceLabel(project)}`).onClick(()=>void this.linkFolder(folder,project,false)));submenu.addSeparator();submenu.addItem(i=>i.setTitle('Create T3 project…').onClick(()=>void this.createFolderProject(folder)));if(!projects.length)submenu.addItem(i=>i.setTitle(this.connecting?'Discovering projects…':'No projects found. Connect T3 to discover projects.').setDisabled(true));});
        return;
      }
      if (!(file instanceof TFile) || file.extension.toLowerCase() !== 'md' || (!Platform.isMobile && source !== 'file-explorer-context-menu')) return;
      menu.addItem(item => {
        item.setTitle('Open in T3 Code').setIcon('send');
        item.setDisabled(this.busy||this.defaultSending).onClick(event=>this.openNoteSend(file,Boolean(event?.ctrlKey)));
      });
      if(Platform.isMobile)menu.addItem(item=>item.setTitle('Open in T3 Code: choose destination…').setIcon('send').setDisabled(this.busy||this.defaultSending).onClick(()=>this.openNoteSend(file,true)));
    }));
    this.registerEvent(this.app.workspace.on('editor-menu',(menu,editor,view)=>{
      const selection=editor.getSelection();
      const file=view.file;
      if(!file||file.extension.toLowerCase()!=='md')return;
      menu.addItem(item=>item.setTitle('Import T3 run into this note…').setIcon('download').setDisabled(this.busy).onClick(()=>this.openRunImport(file)));
      menu.addItem(item=>item.setTitle('Manage T3 streams in this note…').setIcon('list').setDisabled(this.busy).onClick(()=>void this.openImportStreams(file).catch(error=>new Notice(`T3 streams: ${message(error)}`,10000))));
      const targets=questionTargets(editor.getValue()).filter(target=>!this.questions?.isDismissed(target));
      if(targets.length)menu.addItem(item=>item.setTitle('Answer T3 question…').setIcon('message-circle-question').onClick(()=>this.openQuestion(targets[0])));
      const active=this.inlineChat?.activeFor(file.path)??[];
      const ids=[...new Set([...active.map(job=>job.id),...activeInlineIds(editor.getValue()),...failedInlineIds(editor.getValue())])].filter(id=>!this.deviceInline?.responseStatus(id)?.runTerminal);
      const cursorId=inlineTargetAt(editor.getValue(),editor.posToOffset(editor.getCursor()));
      let captured:Pick<EditorChatContext,'anchor'|'canonicalAnchor'|'referenceSelection'|'snapshot'>|undefined;
      if(selection.trim())try{captured=this.canonicalChatContext({editor,view,anchor:captureEditorSelection(editor)});}catch{}
      for(const id of cursorId?[cursorId]:ids){
        if(this.deviceInline?.responseStatus(id)?.runTerminal)continue;
        const failed=active.find(job=>job.id===id)?.phase==='error'||failedInlineIds(editor.getValue()).includes(id);
        const label=/^(?:> \[!t3-progress\][+-] )?\*\*(.+) · (?:Working|Reconnecting|Error)\*\*/m.exec(regionBody(editor.getValue(),id)?.body??'')?.[1];
        const suffix=ids.length>1?` (${label&&label!=='T3'?label+' · ':''}${id.slice(0,8)})`:'';
        if(failed){
          menu.addItem(item=>item.setTitle('Continue T3 response'+suffix).setIcon('rotate-cw').setDisabled(this.busy).onClick(()=>this.continueInline(id,file.path).catch(error=>new Notice(`T3: ${message(error)}`,10000))));
          menu.addItem(item=>item.setTitle('Attach latest T3 continuation'+suffix).setIcon('link').setDisabled(this.busy).onClick(()=>{void this.attachInline(id,file.path).catch(error=>new Notice(`T3: ${message(error)}`,10000));}));
        }else {if(captured)menu.addItem(item=>item.setTitle('Ask T3 in this response'+suffix).setIcon('message-circle').onClick(event=>this.openEditorChat(selection,file,{editor,view,...captured,responseId:id},Boolean(event?.ctrlKey))));}
        menu.addItem(item=>item.setTitle('Stop T3 response'+suffix).setIcon('square').onClick(()=>{void this.inlineChat!.stopAt(id,editor,view).catch(error=>new Notice(`T3: ${message(error)}`,10000));}));
      }
      if(!captured)return;
      menu.addItem(item=>item.setTitle('Ask T3 Code').setIcon('message-circle').setDisabled(this.busy||this.defaultSending).onClick(event=>this.openEditorChat(selection,file,{editor,view,...captured},Boolean(event?.ctrlKey))));
      if(Platform.isMobile)menu.addItem(item=>item.setTitle('Ask T3 Code: choose destination…').setIcon('message-circle').setDisabled(this.busy||this.defaultSending).onClick(()=>this.openEditorChat(selection,file,{editor,view,...captured},true)));
    }));
  }
  private async renameLinkedFolder(before:string,after:string){
    const previous=this.settings.folderLinks;
    const links=previous.map(link=>link.folderPath===before||link.folderPath.startsWith(before+'/')?{...link,folderPath:after+link.folderPath.slice(before.length)}:link);
    const changes=changedFolderLinks(previous,links,this.folderLinkReplica,randomId,Math.max(Date.now(),this.folderLinkClock+1));
    if(!changes.length)return;
    // Journal each observed move before awaiting an earlier queued save. A
    // rapid reverse move must supersede its tombstone even before disk catches up.
    this.folderLinkClock=Date.parse(changes[0].at);
    this.folderLinkReplica=mergeFolderLinkChanges(this.folderLinkReplica,changes);
    this.settings.folderLinkChanges=this.folderLinkReplica;this.settings.folderLinks=links;
    await this.save();
  }
  private openQuestion(target:QuestionTarget){
    if(!this.questions||this.questions.isDismissed(target))return;
    this.questionModal?.close();this.questionModal=new QuestionModal(this.app,this.questions,target);this.questionModal.open();
  }
  private cleaningDismissedQuestions=false;
  private dismissedCleanup=new Map<string,{hash:string;revision:number}>();
  private async cleanDismissedQuestions(){
    if(this.stopped||!this.questions?.hasDismissals()||this.cleaningDismissedQuestions)return;
    this.cleaningDismissedQuestions=true;
    try{
      const paths=new Set([...this.questionPaths,...this.app.workspace.getLeavesOfType('markdown').map(leaf=>(leaf.view as MarkdownView).file?.path).filter((path):path is string=>!!path)]);
      const io=deviceNoteIO(this.app);
      for(const path of paths)try{await io.updateNote(path,current=>{
        const previous=this.dismissedCleanup.get(path),revision=this.questions!.dismissalRevision;
        if(previous?.revision===revision&&previous.hash===contentHash(current))return current;
        const next=removeDismissedQuestions(current,target=>this.questions!.isDismissed(target));
        this.dismissedCleanup.set(path,{hash:contentHash(next),revision});
        if(this.dismissedCleanup.size>32)this.dismissedCleanup.delete(this.dismissedCleanup.keys().next().value!);
        return next;
      },()=>!this.stopped);}catch{/* Saved cleanup retries; editor decorations already hide the question. */}
    }finally{this.cleaningDismissedQuestions=false;}
  }
  private async refreshQuestions(){
    if(this.stopped||this.refreshingQuestions||!this.questions||!this.approvals)return;this.refreshingQuestions=true;
    try{
      await this.cleanDismissedQuestions();
      for(const leaf of this.app.workspace.getLeavesOfType('markdown')){const view=leaf.view as MarkdownView;if(view.file)this.questionPaths.add(view.file.path);}
      const io=deviceNoteIO(this.app),notes=new Map<string,QuestionTarget[]>(),approvalNotes=new Map<string,ApprovalTarget[]>();
      const openViews=this.app.workspace.getLeavesOfType('markdown').map(leaf=>leaf.view as MarkdownView);
      for(const path of this.questionPaths){
        const text=await io.readNote(path),displayed=openViews.filter(view=>view.file?.path===path).map(view=>view.editor?.getValue()??'').join('\n');
        const targets=questionTargets((text??'')+'\n'+displayed),approvals=approvalTargets((text??'')+'\n'+displayed);
        if(targets.length)notes.set(path,targets);if(approvals.length)approvalNotes.set(path,approvals);if(!targets.length&&!approvals.length)this.questionPaths.delete(path);
      }
      await Promise.all([this.questions.refresh([...notes.values()].flat(),1000),this.approvals.refresh([...approvalNotes.values()].flat().concat(this.approvals.watchedTargets()))]);
      this.questions.retryDismissals();
      for(const [path,targets] of notes){
        const resolved=targets.filter(target=>this.questions!.view(target).status==='resolved'&&!this.questions!.isDismissed(target));
        if(resolved.length)await io.updateNote(path,current=>resolved.reduce((text,target)=>clearResolvedQuestion(text,target),current),()=>!this.stopped);
      }
      for(const [path,targets] of approvalNotes){
        const resolved=targets.filter(target=>this.approvals!.view(target).status==='resolved');
        if(resolved.length)await io.updateNote(path,current=>resolved.reduce((text,target)=>clearApprovalControls(text,target),current),()=>!this.stopped);
      }
      this.app.saveLocalStorage(`${this.localKey}-questions-${this.settings.vaultId}-paths`,[...this.questionPaths]);
    }catch{/* Notes, authentication, and Sync are retried on the next refresh. */}finally{this.refreshingQuestions=false;}
  }
  private async eventSnapshot(path:string,content:string):Promise<NoteEventSnapshot> {
    let properties:Record<string,unknown>|null={};
    const frontmatter=/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
    if(frontmatter)try{const parsed=parseYaml(frontmatter[1]);if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))properties=parsed;}catch{properties=null;/* Invalid YAML is not a trustworthy property transition. */}
    return {path,content:await this.inlineHostService?.eventContent(path,content)??content,properties};
  }
  private async eventThread(target:EventTarget){
    return (await this.eventThreadSnapshot(target)).thread;
  }
  private async eventThreadSnapshot(target:EventTarget){
    const access=await this.inlineThreadAccess(target.environmentId);
    try{
      const snapshot=await readInlineSnapshot(access,target.threadId,target.projectId,undefined,true),thread=snapshot.thread;
      if(!thread||thread.id!==target.threadId||thread.projectId!==target.projectId||thread.deletedAt||thread.archivedAt)throw Error('The subscribing thread is unavailable in its original project.');
      return snapshot;
    }finally{await access.close?.();}
  }
  private async eventHostTarget(){
    const root=this.settings.folderLinks.find(link=>link.folderPath==='/');
    if(!root)throw Error('Choose a vault project machine before creating subscriptions.');
    const localRoot=!Platform.isMobile?(this.app.vault.adapter as {getFullPath?:(path:string)=>string}).getFullPath?.(''):undefined;
    const environmentId=root.environmentId??this.settings.paired.find(c=>c.id===root.connectionId)?.environmentId??(!root.connectionId&&localRoot&&sameWorkspacePath(localRoot,root.workspaceRoot)?await this.localInlineEnvironment():undefined);
    if(!environmentId)throw Error('Reconnect the vault project machine before creating subscriptions.');
    return {host:{vaultId:this.settings.vaultId,environmentId,workspaceRoot:root.workspaceRoot,directory:`${this.app.vault.configDir||'.obsidian'}/t3-code/events/v1`},connectionId:root.connectionId};
  }
  private eventHostCurrent(host:import('./event-host').EventHostIdentity){
    const root=this.settings.folderLinks.find(link=>link.folderPath==='/');
    const environmentId=root?.environmentId??this.settings.paired.find(c=>c.id===root?.connectionId)?.environmentId??this.eventLocalEnvironmentId;
    return !this.stopped&&host.vaultId===this.settings.vaultId&&environmentId===host.environmentId&&Boolean(root&&sameWorkspacePath(root.workspaceRoot,host.workspaceRoot));
  }
  private refreshEventHost():Promise<void>{
    if(this.eventHostOpening)return this.eventHostOpening;
    const work=this.openEventHost();this.eventHostOpening=work;void work.finally(()=>{this.eventHostOpening=undefined;}).catch(()=>{});return work;
  }
  private async openEventHost(){
    if(this.stopped||Platform.isMobile)return;
    if(this.eventHostServer&&!this.eventHostCurrent(this.eventHostServer.identity)){
      const server=this.eventHostServer;this.eventHostServer=undefined;await server.dispose();
    }
    if(this.eventHostServer)return;
    const {host}=await this.eventHostTarget();
    const root=(this.app.vault.adapter as {getFullPath?:(path:string)=>string}).getFullPath?.('');
    if(!root||!sameWorkspacePath(root,host.workspaceRoot))return;
    this.eventLocalEnvironmentId=await this.localInlineEnvironment();
    if(this.eventLocalEnvironmentId!==host.environmentId)return;
    const {EventHostServer}=await import('./event-host-desktop');
    const server=await EventHostServer.open(host,command=>{
      if(!this.eventSubscriptions||!this.eventHostCurrent(host))throw Error('Subscription host is not ready.');
      return this.eventSubscriptions.command(command);
    },()=>this.eventHostCurrent(host),()=>{this.eventSubscriptions?.stop();this.eventSubscriptions=undefined;this.eventHostServer=undefined;});
    this.eventHostServer=server;
    try{await this.startEventSubscriptions(server);server.activate();}catch(error){this.eventHostServer=undefined;await server.dispose();throw error;}
  }
  private async eventHostFiles(route:{host:import('./event-host').EventHostIdentity;connectionId?:string}):Promise<{files:import('./event-host').EventHostFiles;close():void}>{
    const {host}=route;
    const root=(this.app.vault.adapter as {getFullPath?:(path:string)=>string}).getFullPath?.('');
    if(!Platform.isMobile&&root&&sameWorkspacePath(root,host.workspaceRoot)&&await this.localInlineEnvironment()===host.environmentId)return {files:(await import('./hosted-inline-desktop')).localInlineFiles(host.workspaceRoot,host.directory),close:()=>{}};
    const paired=this.settings.paired.find(c=>c.environmentId===host.environmentId&&c.id===route.connectionId)??this.settings.paired.find(c=>c.environmentId===host.environmentId);
    if(!paired)throw Error('Connect the vault project machine before managing subscriptions.');
    const remote=await connectVaultRemote({transport:'direct',host:'direct',executable:'',url:paired.url,connectionId:paired.id,environmentId:paired.environmentId},await this.sessionFor(paired.id));
    try{
      if(!await remote.matches(host.workspaceRoot,`${this.app.vault.configDir||'.obsidian'}/plugins/${this.manifest.id}/data.json`,host.vaultId))throw Error('The subscription host no longer matches this vault.');
      const storage=privateStorageResolver(path=>remote.readFile(host.workspaceRoot,path),host.workspaceRoot,this.app.vault.configDir||'.obsidian');
      return {files:{read:async path=>remote.readFile(await storage(),path),write:async(path,value)=>remote.writeFile(await storage(),path,value),remove:async path=>remote.deleteFile(await storage(),path)},close:()=>remote.close()};
    }catch(error){remote.close();throw error;}
  }
  private eventActionIO():ActionIO {
    const file=(path:string)=>{const value=this.app.vault.getAbstractFileByPath(path);return value instanceof TFile?value:undefined;};
    const checkEditor=(path:string,expected:string)=>{
      for(const leaf of this.app.workspace.getLeavesOfType('markdown')){
        const view=leaf.view as MarkdownView;
        if(view.file?.path===path&&view.getMode()==='source'&&(nativeResponses(this.app).view(view)?.saved()??view.editor.getValue())!==expected)throw Error('Action note has unsaved editor changes.');
      }
    };
    return {
      read:async path=>{const value=file(path);return value?this.app.vault.read(value):undefined;},
      parse:parseYaml,stringify:stringifyYaml,
      write:async(path,expected,content)=>{const value=file(path);if(!value)throw Error('Action note is unavailable.');checkEditor(path,expected);await this.app.vault.process(value,current=>{if(current!==expected)throw Error('Action note changed after preparation.');return content;});},
      move:async(path,destination,expected)=>{
        const value=file(path);if(!value)throw Error('Action note is unavailable.');checkEditor(path,expected);
        const parts=destination.split('/').slice(0,-1);let folder='';
        for(const part of parts){folder=folder?folder+'/'+part:part;const existing=this.app.vault.getAbstractFileByPath(folder);if(existing&&!(existing instanceof TFolder))throw Error('Action folder conflicts with a file.');if(!existing)await this.app.vault.createFolder(folder);}
        if(await this.app.vault.read(value)!==expected)throw Error('Action note changed after preparation.');
        checkEditor(path,expected);if(this.app.vault.getAbstractFileByPath(destination))throw Error('Action destination already exists.');
        await this.app.vault.rename(value,destination);
      },
    };
  }
  private async startEventSubscriptions(server:import('./event-host-desktop').EventHostServer){
    if(this.eventSubscriptions||this.stopped||Platform.isMobile)return;
    await this.refreshInlineHost();
    if(!this.inlineHostService)throw Error('Response coordination must be available before seeding subscriptions.');
    await this.inlineHostService.tick();
    const key=`events:${this.settings.vaultId}:${this.deviceId}`;
    const service=new EventSubscriptions({
      load:async()=>{const saved=await server.load();if(saved)return saved;return await deviceState(key);},save:state=>server.save(state),now:()=>Date.now(),id:randomId,
      notes:async scope=>{
        const files=this.app.vault.getMarkdownFiles().filter(file=>inEventScope(scope,file.path));
        return Promise.all(files.map(async file=>this.eventSnapshot(file.path,await this.app.vault.read(file))));
      },
      validateTarget:async target=>{await this.eventThread(target);},
      isBusy:async target=>threadIsActive(await this.eventThread(target)),
      prepare:async notification=>existingThreadTurn(await this.eventThread(notification.target!),notification.target!,commandId(notification.id,'turn'),{messageId:commandId(notification.id,'message'),role:'user',text:notificationPrompt(notification,this.app.vault.getName()),attachments:[]}),
      deliver:async notification=>{
        if(!this.eventHostCurrent(server.identity))throw Error('Subscription host ownership changed.');
        const thread=await this.eventThread(notification.target!);
        if(thread.messages?.some((entry:any)=>entry.id===commandId(notification.id,'message')&&entry.role==='user'))return 'delivered';
        if(threadIsActive(thread))return 'busy';
        const access=await this.inlineThreadAccess(notification.target!.environmentId);
        try{if(!this.eventHostCurrent(server.identity))throw Error('Subscription host ownership changed.');await access.api('/api/orchestration/dispatch',notification.command);return 'delivered';}finally{await access.close?.();}
      },
      prepareAction:notification=>{const event=notification.events.at(-1)!;return prepareEventAction(notification.action!,event.kind==='job'?undefined:event.path,this.eventActionIO(),event.kind==='property'?{property:event.property!,after:event.after,matches:value=>observedPropertyEquals(value,event.after)}:undefined);},
      deliverAction:async notification=>{if(!this.eventHostCurrent(server.identity))throw Error('Subscription host ownership changed.');await executeEventAction(notification.command as ActionPlan,this.eventActionIO());},
      readThread:async target=>{
        const snapshot=await this.eventThreadSnapshot(target);
        const state=applyThreadItem({messages:[],activities:[]},{kind:'snapshot',snapshot:{thread:snapshot.thread}}).state;
        // Keep the canonical watermark without stamping unrelated global clock
        // changes into every timestamp-derived message binding.
        return {...state,...(Number.isSafeInteger(snapshot.snapshotSequence)&&snapshot.snapshotSequence>=0?{sequence:snapshot.snapshotSequence}:{})};
      },
      watchThread:(target,item,sequence)=>{
        return watchThread(target.threadId,()=>this.inlineThreadAccess(target.environmentId),{item:value=>{if(value.kind==='snapshot'&&value.snapshot?.thread?.projectId!==target.projectId)return;item(value);},reconnecting:error=>logFailure('subscriptions.thread.reconnecting',error,{...target})},undefined,undefined,{afterSequence:sequence,pollSnapshots:false});
      },
      displayHost:{
        validateDestination:async path=>{const text=await deviceNoteIO(this.app).readNote(path);if(text===undefined)throw Error(`Destination note unavailable: ${path}`);endInsertionOffset(text);},
        responseBindings:target=>this.displayResponseBindings(target),
        prepareDisplay:async(display,destination,input)=>{
          const host=await this.inlineHostTarget(),id=commandId(display.id,`response:${input.id}:${destination.id}`);
          return {...await this.coordinatedHostFormat(host),destinationSection:destination.section,version:4,finalAnswerFormat:finalAnswerFormat(this.settings.inlineStreaming.finalAnswerFormat),independent:true,id,initialInput:{messageId:input.id,text:input.text,label:incomingLabel(input)},initialOwner:this.inlineActor,vaultId:this.settings.vaultId,host,notePath:destination.path,threadId:display.threadId,messageId:input.id,projectId:display.projectId,threadEnvironmentId:display.environmentId,initialHash:initialRegion(id,{messageId:input.id,text:input.text,label:incomingLabel(input)},undefined,'collapse',{startedAt:input.createdAt??display.createdAt}).bodyHash,createdAt:input.createdAt??display.createdAt,keepIntermediate:true,intermediateMode:'collapse'};
        },
        attachDisplay:async(request,path)=>{
          if(this.stopped||!this.eventHostCurrent(server.identity)||!this.deviceInline)throw Error('Streaming host ownership changed.');
          const io=deviceNoteIO(this.app),opened=await this.inlineHostFiles(request.host);
          try{
            const raw=await opened.files.read(leasePaths(request.host.directory,request.id).record);
            if(raw){const record:LeaseRecord=JSON.parse(raw);if(record.state?.finalSaved||['complete','interrupted'].includes(record.state?.status??''))return;await this.deviceInline.register(record.request);return;}
            const current={...request,notePath:path};
            await editorStream(current,path,io,()=>!this.stopped&&this.eventHostCurrent(server.identity),request.id);
            await this.deviceInline.register(current);
          }finally{opened.close();}
        },
      },
      recording:active=>logEvent('subscriptions.monitoring',{active}),
    });
    try{await service.initialize();await server.save(service.snapshot);}catch(error){service.stop();throw error;}if(this.stopped||!this.eventHostCurrent(server.identity)){service.stop();return;}this.eventSubscriptions=service;
    let captureWork=Promise.resolve();
    const observe=(kind:'create'|'modify'|'rename'|'delete',file:TAbstractFile,oldPath?:string)=>{
      if(this.eventSubscriptions!==service||!this.eventHostCurrent(server.identity))return;
      if(file instanceof TFolder){
        if(kind==='rename')captureWork=captureWork.catch(()=>{}).then(()=>this.renameEventFolder(file,oldPath!,service));
        if(kind==='delete')captureWork=captureWork.catch(()=>{}).then(()=>service.deleteFolder(file.path)).then(()=>{});
        void captureWork.catch(error=>new Notice(`T3 events: ${message(error)}`,10000));return;
      }
      if(!(file instanceof TFile)||!service.interested(file.path,oldPath))return;
      const path=file.path;captureWork=captureWork.catch(()=>{}).then(async()=>{if(this.stopped||this.eventSubscriptions!==service||!this.eventHostCurrent(server.identity))return;const note=kind==='delete'?undefined:await this.eventSnapshot(path,await this.app.vault.read(file));await service.observe(kind,path,note,oldPath);});
      void captureWork.catch(error=>new Notice(`T3 events: ${message(error)}`,10000));
    };
    for(const kind of ['create','modify','rename','delete'] as const)this.registerEvent(this.app.vault.on(kind as any,(file:TAbstractFile,oldPath?:string)=>observe(kind,file,oldPath)));
    // Node timers continue polling in background desktop windows.
    this.registerInlineInterval(()=>{if(this.eventSubscriptions===service&&this.eventHostCurrent(server.identity)&&service.active)void service.tick().catch(error=>new Notice(`T3 event delivery: ${message(error)}`,10000));},1000);
  }
  private async displayResponseBindings(target:EventTarget){
    const host=await this.inlineHostTarget();
    await this.refreshInlineHost();
    if(this.inlineHostService?.active&&this.inlineHostService.matchesTarget(host))return this.inlineHostService.responseBindings(target);
    const files=(await import('./hosted-inline-desktop')).localInlineFiles(host.workspaceRoot,host.directory);
    try{return await readResponseBindings(files,host.directory,target);}finally{await files.close?.();}
  }
  private async renameEventFolder(folder:TFolder,oldPath:string,service:EventSubscriptions){
    if(!service.interestedFolder(folder.path,oldPath))return;
    const notes=await Promise.all(this.app.vault.getMarkdownFiles().filter(file=>file.path.startsWith(folder.path+'/')).map(async file=>this.eventSnapshot(file.path,await this.app.vault.read(file))));
    await service.renameFolder(oldPath,folder.path,notes);
  }
  async executeAgentCommand(input:import('./note-command').AgentCommand){
    if(isRecoveryCommand(input)){
      const command=validateRecoveryCommand(input);
      if(this.stopped||this.busy||!this.deviceCompletion||!this.deviceInline)throw Error('Device response recovery is unavailable.');
      if(command.kind==='response-recovery-info')return {id:command.id,ok:true,recovery:await this.deviceCompletion.previewRecovery(command.bindingId)};
      const record=await this.deviceCompletion.reviewRecovery(command.bindingId,command.hash!,(proof,evidence)=>this.deviceInline!.abortFinalAttempt(command.bindingId,proof,evidence));
      this.deviceInline.tick();return {id:command.id,ok:true,status:record.status};
    }
    if(isClientCommand(input)){
      await this.refreshNoteCommandHost();
      if(!this.clientMaintenance||this.stopped)throw Error('Desktop client maintenance is unavailable.');
      const result=await this.clientMaintenance.execute(input);
      if(input.kind==='archive-reply-imports'){
        if(Platform.isMobile||!this.codebase)throw Error('Move old reply imports from a desktop client.');
        if(input.environmentId!==await this.localInlineEnvironment())throw Error('Choose a linked project on this desktop computer.');
        const {archiveLegacyReplyImports}=await import('./legacy-reply-imports-desktop');
        return {...result,replyImports:await this.codebase.archiveReplyImports(input.environmentId!,input.projectId!,input.archiveDirectory!,archiveLegacyReplyImports)};
      }
      if(input.kind==='send-failure-log')return {...result,failureLog:sendFailureLog(this.app.loadLocalStorage(this.failureKey()),result.client!.loadedVersion,this.deviceId,input.since)};
      return input.kind==='client-status'?{...result,responseHostOpening:!!this.inlineHostRefresh,commandServer:this.noteCommandServer?.status(),connectionRecovery:this.connectionRecovery?.status(),codeRangeCache:markdownCodeCacheStatus(),...(this.inlineHostService?{responseHost:this.inlineHostService.status()}: {})}:result;
    }
    if(isResponseCommand(input)){
      const command=validateResponseCommand(input);
      if(command.kind==='response-import-records'||command.kind==='response-import-info')return this.executeImportRead(command,await this.inlineHostTarget());
      if(command.kind==='stage-note-edit'||command.kind==='submit-note-edit'){
        for(const file of this.app.vault.getMarkdownFiles?.()??[]){
          const document=await deviceNoteIO(this.app).readNote(file.path);if(document===undefined)continue;
          const binding=localResponseBindings(document).find(binding=>binding.id===command.bindingId&&binding.vaultId===this.settings.vaultId);if(!binding)continue;
          if(Platform.isMobile)throw Error('Run the note staging command on the desktop plugin host.');
          const request={...binding,notePath:file.path},opened=await this.inlineHostFiles(request.host,false);
          try{
            const result=await localStageCommand(command.kind,request,document,opened.files,command.hash);
            if('request' in result&&result.request){
              const stagedRequest=result.request,io=deviceNoteIO(this.app),saved=await io.updateNote(file.path,current=>{if(!localResponseBindings(current).some(value=>value.id===request.id))throw Error('The response completed before staging.');return current.replace(responseBindingComment(binding),responseBindingComment(stagedRequest));},()=>!this.stopped);
              if(saved===undefined)throw Error('Save the note before submitting the staged edit.');
              for(const leaf of this.app.workspace.getLeavesOfType('markdown')){const view=leaf.view as MarkdownView;if(view.file?.path===file.path)await view.save();}
              this.deviceInline?.resume(this.inlineTargets);
            }
            const {request:_request,...receipt}=result as any;return {id:command.id,ok:true,...receipt};
          }finally{opened.close();}
        }
      }

      await this.refreshInlineHost();
      if(!this.inlineHostService)throw Error('Run legacy response maintenance on its desktop host.');
      return {id:command.id,ok:true,...await this.inlineHostService.responseCommand(command.kind,command.kind==='close-stream-block'?command.foldKey:command.bindingId,command.hash,command.notePath)};
    }
    if(isFolderCommand(input)){
      if(this.stopped||this.busy)throw Error('Obsidian is unavailable or sending another request.');
      this.busy=true;
      try{return await executeFolderCommand(input,{
        vaultId:this.settings.vaultId,links:()=>this.settings.folderLinks,
        validateFolder:path=>{this.commandFolder(path);},refresh:()=>this.checkExternalSettings(),
        resolve:command=>this.folderCommandProject(command),
        read:id=>deviceState(`folder-command:${this.deviceId}:${this.settings.vaultId}:${id}`),
        write:async(id,journal)=>{await deviceState(`folder-command:${this.deviceId}:${this.settings.vaultId}:${id}`,journal);},
        save:async(link,project)=>{
          const previous=project.connectionId?this.settings.directProjects:this.settings.projects;
          if(project.connectionId)this.settings.directProjects=[...previous.filter(p=>projectKey(p)!==projectKey(project)),project];
          else this.settings.projects=[...previous.filter(p=>p.id!==project.id),project];
          try{await this.saveFolderLink(this.commandFolder(link.folderPath),project,link.self,link);}
          catch(error){if(project.connectionId)this.settings.directProjects=previous;else this.settings.projects=previous;throw error;}
        },
        unlink:path=>this.unlinkFolder(path),
      });}finally{this.busy=false;}
    }
    if(isEventCommand(input)){
      const {forwardEventCommand,eventCanonical}=await import('./event-host');
      const key=`event-route:${this.settings.vaultId}:${input.id}`;
      const previous=await deviceState(key) as {input:string;host:import('./event-host').EventHostIdentity;connectionId?:string}|undefined;
      if(previous&&previous.input!==eventCanonical(input))throw Error('This request ID already belongs to different input.');
      const route=previous??{input:eventCanonical(input),...await this.eventHostTarget()};
      if(!previous)await deviceState(key,route);
      const current=await this.eventHostTarget();
      if(eventCanonical(current.host)!==eventCanonical(route.host))throw Error('This command belongs to the previous vault project machine. Restore that host to retry, or use a new request ID.');
      await this.refreshEventHost();
      const opened=await this.eventHostFiles(route);
      try{return await forwardEventCommand(route.host,input,opened.files,async ms=>(await import('./desktop-timers')).desktopPause(ms));}finally{opened.close();}
    }
    return this.executeNoteCommand(input);
  }
  private commandFolder(path:string):TFolder {
    if(this.stopped)throw Error('The plugin was disabled before linking the folder.');
    const folder=path==='/'?this.app.vault.getRoot():this.app.vault.getAbstractFileByPath(path);
    if(!(folder instanceof TFolder))throw Error('Folder not found in the requested vault.');
    return folder;
  }
  private async folderCommandProject(command:Extract<FolderCommand,{kind:'link-folder'}>):Promise<Project>{
    const local=command.connectionId==='local';
    const paired=local?undefined:this.settings.paired.find(connection=>connection.id===command.connectionId);
    if(!local&&(!paired||paired.environmentId!==command.environmentId))throw Error('The explicit connection and environment do not identify an available destination.');
    if(local&&Platform.isMobile)throw Error('Local folder linking requires a desktop client.');
    const connection:Connection=local?{...this.settings.connection,host:'local',transport:'desktop'}:{transport:'direct',host:'direct',executable:'',url:paired!.url,connectionId:paired!.id,environmentId:paired!.environmentId};
    let reply:any;
    if(local){
      const access=await (await import('./desktop')).desktopThreadAccess(connection);
      try{
        const environment=await access.api('/.well-known/t3/environment');
        if(environment.environmentId!==command.environmentId||environment.orchestrationProtocolVersion!==2)throw Error('The requested environment is not this desktop’s T3 v2 machine.');
        reply=await access.api('/api/orchestration/shell');
      }finally{await access.close?.();}
    }else reply=await runBridge(connection,['projects']);
    if(reply.cached)throw Error('The destination is offline. Linking requires verified live project metadata.');
    const project=parseProjects(reply).find(project=>project.id===command.projectId);
    if(!project||!project.workspaceRoot.trim())throw Error('The requested project is unavailable on that connection and environment.');
    if(command.mode==='self'){
      let workspaceRoot:string;
      if(local){
        const adapter=this.app.vault.adapter as {getFullPath?:(path:string)=>string};
        if(!adapter.getFullPath)throw Error('This vault does not expose a local filesystem path.');
        workspaceRoot=adapter.getFullPath(command.folderPath==='/'?'':command.folderPath);
      }else{
        const root=this.settings.folderLinks.find(link=>link.folderPath==='/');
        const rootEnvironment=root?.environmentId??this.settings.paired.find(c=>c.id===root?.connectionId)?.environmentId;
        if(!root||rootEnvironment!==command.environmentId)throw Error('Self mode requires the selected machine to be the verified vault project machine.');
        const remote=await connectVaultRemote(connection,await this.sessionFor(paired!.id));
        try{
          if(!await remote.matches(root.workspaceRoot,`${this.app.vault.configDir||'.obsidian'}/plugins/${this.manifest?.id||'send-to-t3-code'}/data.json`,this.settings.vaultId))throw Error('The destination vault no longer matches the requested vault.');
          const separator=root.workspaceRoot.includes('\\')&&!root.workspaceRoot.includes('/')?'\\':'/';
          workspaceRoot=command.folderPath==='/'?root.workspaceRoot:root.workspaceRoot.replace(/[\\/]+$/,'')+separator+command.folderPath.replace(/\//g,separator);
          if(!sameWorkspacePath((await remote.browse(workspaceRoot)).parentPath,workspaceRoot))throw Error('The folder has not reached the vault project machine. Let Sync finish before retrying.');
        }finally{remote.close();}
      }
      if(!sameWorkspacePath(project.workspaceRoot,workspaceRoot))throw Error('Self mode requires an existing project rooted at this exact vault folder. No project was created.');
    }
    return {...project,...(paired?{connectionId:paired.id,connectionName:paired.name}:{})};
  }
  private folderForMenu(file:TFolder):TFolder{
    const gesture=this.recentFolderGesture;
    if(!Platform.isMobile||file.path!=='/'||!gesture||Date.now()-gesture.at>3000)return file;
    const folder=this.app.vault.getAbstractFileByPath(gesture.path);
    return folder instanceof TFolder?folder:file;
  }
  paletteChatStatus(){return this.paletteChat?.status??'unavailable';}
  refreshFolderIndicators(){this.folderIndicators?.refresh();this.codebase?.reconcileLinks();}
  private async checkExternalSettings(){
    if(this.stopped||this.checkingExternalSettings)return;
    this.checkingExternalSettings=true;
    try{await this.saving.catch(()=>{});const data=await this.loadData(),serialized=JSON.stringify(data);if(serialized!==this.lastDiskSnapshot)await this.onExternalSettingsChange();}
    finally{this.checkingExternalSettings=false;}
  }
  async onExternalSettingsChange(loaded?:any){
    await this.saving.catch(()=>{});
    const data=loaded??await this.loadData();if(this.stopped||!data)return;
    this.lastDiskSnapshot=JSON.stringify(data);
    const baseline=JSON.parse(this.sharedBaseline),remote=this.sharedData(data);
    const adopted=mergeSharedSettings(baseline,remote,this.sharedSnapshot());
    for(const key of ['inlineStreaming','orchestration','completion','threadTitleGeneration','replyFolders','codebase'] as const)this.settings[key]=adopted[key];
    const diskLinks=loadFolderLinks(data),diskChanges=loadFolderLinkChanges(data.folderLinkChanges);
    this.folderLinkReplica=mergeFolderLinkChanges(this.folderLinkReplica,diskChanges);
    this.settings.folderLinkChanges=this.folderLinkReplica;
    this.settings.folderLinks=applyFolderLinkChanges(diskLinks,this.folderLinkReplica);
    this.codebase?.adopt(this.settings.codebase);
    const restoreFolderLinks=JSON.stringify(diskLinks)!==JSON.stringify(this.settings.folderLinks)||JSON.stringify(diskChanges)!==JSON.stringify(this.folderLinkReplica);
    await deviceState(`folder-links:${this.deviceId}:${this.settings.vaultId}`,this.folderLinkReplica);
    const remoteThreads=loadNoteThreads(data.noteThreads);
    const mergedThreads=mergeNoteThreads(remoteThreads,this.settings.noteThreads);
    this.settings.noteThreads=remoteThreads;
    this.settings.autoSettleThreads=adopted.autoSettleThreads;
    if(!this.settings.autoSettleThreads&&this.settings.settlementJobs.length){this.settings.settlementJobs=[];await this.saveDeviceState();}
    this.settings.vaultId=vaultIdentity(data)??this.settings.vaultId;
    await this.publishVaultIdentity();
    this.settings.vaultLocations=adopted.vaultLocations;
    const connectionsChanged=JSON.stringify(adopted.paired)!==JSON.stringify(this.settings.paired);
    if(connectionsChanged)this.settings.paired=adopted.paired.map((c:PairedConnection)=>this.settings.paired.find(existing=>JSON.stringify(existing)===JSON.stringify(c))??c);
    this.syncProjectSources();if(connectionsChanged)this.refreshProjectsInBackground(true);
    remote.folderLinks=this.settings.folderLinks;remote.folderLinkChanges=this.folderLinkReplica;
    this.sharedBaseline=JSON.stringify(remote);
    this.settings.noteThreads=mergedThreads;
    if(restoreFolderLinks||JSON.stringify(mergedThreads)!==JSON.stringify(remoteThreads))await this.save(restoreFolderLinks);
    this.refreshFolderIndicators();
  }
  private async publishVaultIdentity():Promise<void>{
    const files=this.app.vault?.adapter;
    if(!files||typeof files.exists!=='function'||typeof files.read!=='function'||typeof files.mkdir!=='function'||typeof files.write!=='function')return;
    try{await ensureVaultIdentityRecord(files,this.app.vault.configDir||'.obsidian',this.settings.vaultId);}
    catch(error){new Notice(`Could not publish the T3 vault identity: ${message(error)}`,10000);}
  }
  openSettings(){
    const settings=(this.app as App & {setting?:{open():void;openTabById(id:string):void}}).setting;
    if(settings){settings.open();settings.openTabById(this.manifest.id);}
    else new Notice('Open Settings → Send to T3 Code to sign in.');
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
    throw Error('The linked T3 project is unavailable on this device. Reconnect its machine or relink the folder.');
  }
  private projectReadinessError(project:Project):string|undefined {
    if(this.stopped)return 'The plugin has been disabled. Re-enable it before sending.';
    if(!project.connectionId)return Platform.isMobile?'This folder is linked to a local desktop project. Link it to a connected computer first.':undefined;
    return this.chatReadinessError();
  }
  openNoteSend(file:TFile,showSelector=false){
    const host:ChatHost=this.withSendAvailability({...this.destinationContext(this.noteContext(file)),
      sendChat:(_text,key,resolve,_back,destination)=>this.sendNote(file,destination?.threadId,destination?.projectKey,false,key,resolve?.()),
      sendToNew:(_text,key,resolve)=>this.sendNote(file,undefined,undefined,true,key,resolve?.()),
      sendToExisting:(_text,key,resolve,back)=>this.openNoteThreads(file,key,resolve,back),
    });
    return openNoteSendFlow(this.app,host,showSelector);
  }
  async openNoteThreads(file:TFile,overrideKey?:string,resolve?:()=>ResolvedJobOptions,back?:()=>void){
    if(this.busy)return;
    try{
      const target=await this.existingTarget(file.path,overrideKey);
      if(!target){new ExistingThreadModal(this.app,[],async()=>{},'Existing threads','No project exists for this folder yet. Use New thread.',back).open();return;}
      const {project}=target;
      const readiness=this.projectReadinessError(project);if(readiness)throw Error(readiness);
      new Notice('Loading threads…',2000);
      const threads=projectThreads(await runBridge(this.connection(project),['threads','--project',project.id]),project.id);
      if(this.stopped)return;
      new ExistingThreadModal(this.app,threads,thread=>this.sendNote(file,thread.id,projectKey(project),false,overrideKey,resolve?.()),undefined,undefined,back).open();
    }catch(error){if(back)throw error;new Notice(`Send to T3 Code: ${message(error)}`,10000);}
  }
  openRunImport(file:TFile){
    if(this.stopped||this.busy)return;
    openRunImport(this.app,file.path,{
      projects:()=>this.projects(),projectLabel:project=>this.projectChoiceLabel(project),
      threads:async project=>projectThreads(await runBridge(this.connection(project),['threads','--project',project.id]),project.id),
      runs:async(project,thread)=>importRuns((await this.readImportHistory(project,thread.id)).state),
      attach:(project,thread,run,follow)=>this.importRun(file.path,project,thread.id,run.messageId,follow),
    });
  }
  async openImportStreams(file:TFile){
    const result=await this.executeAgentCommand({version:1,id:randomId(),kind:'thread-streams'}) as import('./event-subscriptions').EventCommandResult;
    const displays=(result.displays??[]).filter(display=>!display.cancelled&&display.destinations.some(destination=>destination.path===file.path&&!destination.removed));
    const labelled=await Promise.all(displays.map(async display=>({...display,title:await this.eventThread(display).then(thread=>String(thread.title)).catch(()=>`Unavailable thread · ${display.threadId.slice(0,8)}`)})));
    if(this.stopped)return;
    new ImportStreamsModal(this.app,file.path,labelled,async(display,kind)=>{
      const changed=await this.executeAgentCommand({version:1,id:randomId(),kind,subscriptionId:display.id,...(kind==='remove-stream-destination'?{destination:file.path}:{})}) as import('./event-subscriptions').EventCommandResult;
      return changed.display!;
    }).open();
  }
  private async followImportedThread(source:{threadId:string;projectId:string;environmentId:string},notePath:string){
    const result=await this.executeAgentCommand({version:1,id:randomId(),kind:'thread-streams'}) as import('./event-subscriptions').EventCommandResult;
    const history=(result.displays??[]).filter(display=>display.threadId===source.threadId&&display.projectId===source.projectId&&display.environmentId===source.environmentId&&display.destinations.some(destination=>destination.path===notePath));
    const matches=history.filter(display=>display.destinations.some(destination=>destination.path===notePath&&!destination.removed));
    if(matches.some(display=>display.enabled&&!display.cancelled))return;
    const paused=matches.find(display=>!display.cancelled);
    if(paused)await this.executeAgentCommand({version:1,id:randomId(),kind:'resume-thread-stream',subscriptionId:paused.id});
    else await this.executeAgentCommand({version:1,id:history.length?randomId():importFollowId(source,notePath),kind:'stream-thread',scope:'thread',source,destinations:[notePath],start:'future'});
  }
  private async importedLegacyRun(notePath:string,source:import('./response-command').ImportSource,messageId:string,runId:string){
    // Legacy duplicate detection reads only the small destination index and
    // exact routes. It never enumerates or parses historical response bodies.
    const root=this.settings.folderLinks.find(link=>link.folderPath==='/');
    if(!root)return false;
    const host=await this.inlineHostTarget(),opened=await this.inlineHostFiles(host,false);
    try{
      const raw=await opened.files.read(explorerResponsePath(host.directory));
      const entries=loadExplorerResponses(raw?JSON.parse(raw):[]).filter(row=>row.notePath===notePath&&!row.deleted);
      for(const entry of entries){
        const raw=await opened.files.read(leasePaths(host.directory,entry.id).route);if(!raw)continue;
        const route=JSON.parse(raw);
        if(route.id===entry.id&&route.vaultId===this.settings.vaultId&&route.notePath===notePath&&route.threadId===source.threadId&&route.projectId===source.projectId&&route.threadEnvironmentId===source.environmentId&&(route.messageId===messageId||route.turnId===runId||route.turnIds?.includes(runId)))return true;
      }
      return false;
    }finally{opened.close();}
  }
  private async executeImportRead(command:import('./response-command').ResponseCommand,target:InlineHostTarget){
    if(command.kind!=='response-import-records'&&command.kind!=='response-import-info')throw Error('Choose a read-only import command.');
    const adapter=this.app.vault.adapter as {getFullPath?:(path:string)=>string};
    // A desktop service can exist on the importing device while the selected
    // vault response host is on another machine. Bind both identity and root.
    if(!Platform.isMobile&&adapter.getFullPath&&sameWorkspacePath(adapter.getFullPath(''),target.workspaceRoot)&&await this.localInlineEnvironment()===target.environmentId){
      await this.refreshInlineHost();
      if(this.inlineHostService)return {id:command.id,ok:true,...await this.inlineHostService.responseCommand(command.kind,command.kind==='response-import-records'?command.id:command.bindingId,undefined,undefined,command.kind==='response-import-records'?command:undefined)};
    }
    throw Error('Run legacy response maintenance on its desktop host. Imports read T3 directly.');
  }
  private async readImportHistory(project:Project,threadId:string){
    if(this.stopped)throw Error('The plugin is disabled.');
    const connection=this.connection(project),environmentId=connection.environmentId??await this.localInlineEnvironment();
    const source={threadId,projectId:project.id,environmentId},access=await this.inlineThreadAccess(environmentId);
    let snapshot:any;
    try{snapshot=await readInlineSnapshot(access,threadId,project.id,undefined,true,true);}finally{await access.close?.();}
    if(snapshot.thread.deletedAt||snapshot.thread.archivedAt)throw Error('This source thread is no longer available.');
    const state:InlineThreadState=applyThreadItem({messages:[],activities:[]},{kind:'snapshot',snapshot}).state;
    return {source,state,title:String(snapshot.thread.title??'T3 response').slice(0,200)};
  }
  /** Import is independent of note routing. The selected source never receives input. */
  async importRun(notePath:string,project:Project,threadId:string,messageId:string,follow=false):Promise<{duplicate:boolean;following:boolean}>{
    if(this.stopped||this.busy||!this.deviceInline)throw Error('Obsidian is unavailable or sending another request.');
    this.busy=true;
    try{
      const history=await this.readImportHistory(project,threadId),run=importRuns(history.state).find(run=>run.messageId===messageId);
      if(!run||run.unavailable||!run.turnId||!run.turn)throw Error(run?.unavailable??'This response is no longer in the T3 history.');
      const document=await deviceNoteIO(this.app).readNote(notePath);if(document===undefined)throw Error('Destination note not found.');
      const previous=findRunImport(document,history.source,messageId);
      const binding=previous&&localResponseBindings(document).find(request=>request.id===previous.bindingId&&request.vaultId===this.settings.vaultId);
      let duplicate=!!previous;
      if(binding)await this.deviceInline.register({...binding,notePath});
      if(!duplicate)duplicate=await this.importedLegacyRun(notePath,history.source,messageId,run.turnId);
      if(!duplicate){
        const id=importBindingId(history.source,messageId,notePath),host=await this.localResponseTarget({project,connection:this.connection(project)} as Request);
        const policy=resolveJobOptions(this.settings.inlineStreaming).inline;
        const prompt=history.state.messages.find(message=>message.id===messageId)!;
        const request:HostedInlineRequest={version:4,id,localOnly:true,nativeProjection:true,responseContainer:true,initialOwner:this.inlineActor,vaultId:this.settings.vaultId,host,notePath,threadId,messageId,projectId:project.id,threadEnvironmentId:history.source.environmentId,createdAt:run.createdAt,threadTitle:history.title,independent:true,importTurn:run.turn,initialInput:/^[0-9a-f-]{36}$/i.test(messageId)?{messageId,text:prompt.text,label:incomingLabel(prompt)}:undefined,initialHash:initialRegion(id).bodyHash,keepIntermediate:policy.intermediateMode!=='remove',intermediateMode:policy.intermediateMode,finalAnswerFormat:policy.finalAnswerFormat};
        const io=deviceNoteIO(this.app),receipt=runImportReceipt({version:1,bindingId:id,...history.source,messageId,runId:run.turnId});
        const inserted=await editorStream(request,notePath,{...io,updateNote:(path,change,allowed)=>io.updateNote(path,current=>{const next=change(current);return findRunImport(next,history.source,messageId)?next:next+(next.endsWith('\n')?'':'\n')+receipt+'\n';},allowed)},()=>!this.stopped,id);
        await this.deviceInline.register(inserted);
      }
      if(follow)await this.followImportedThread(history.source,notePath);
      return {duplicate,following:follow};
    }finally{this.busy=false;}
  }
  async sendNote(file:TFile,threadId?:string,expectedProjectKey?:string,newThread=false,overrideKey?:string,jobOptions?:ResolvedJobOptions){
    if(this.busy)return;
    jobOptions??=resolveJobOptions(this.settings.inlineStreaming);
    try{
      const active=this.app.workspace.getActiveViewOfType(MarkdownView);
      const content=active?.file?.path===file.path&&active.editor?this.notePromptDocument(active):await this.app.vault.read(file);
      if(!content.trim()){new Notice('This note is empty. Add Markdown before sending.');return;}
      const images=await this.prepareImages(content,file.path);
      if(images.markdown.length+this.messageFooter(this.noteContext(file).absolutePath??file.path).length+(jobOptions.inline.enabled?INLINE_REPLY_INSTRUCTION.length+2:0)>120_000)throw Error('The note and image context exceed T3’s 120,000-character limit. Split the note before sending.');
      const saved=this.noteThread(file.path);
      const chosen=expectedProjectKey?undefined:threadId?this.previousNoteThread(file.path,threadId):!newThread?saved:undefined;
      const {project,link}=await this.chatTarget(file.path,chosen,Boolean(newThread||expectedProjectKey),overrideKey??expectedProjectKey);
      if(expectedProjectKey&&projectKey(project)!==expectedProjectKey)throw Error('The folder’s linked project changed. Choose a thread again.');
      const readiness=this.projectReadinessError(project);if(readiness)throw Error(readiness);
      await this.send(file,project,{threadId,newThread,projectOverrideKey:overrideKey,folderPicker:Boolean(expectedProjectKey),folderLink:link,prepared:{content,images},jobOptions,throwOnError:true});
    }catch(error){throw error;}
  }
  openChat(prompt?:string,showSelector=false){
    const view=this.app.workspace.getActiveViewOfType(MarkdownView);
    return this.openChatWithNote(this.chatNote(),prompt,view?.file&&view.editor?{view,editor:view.editor}:undefined,false,showSelector);
  }
  private async openPaletteAction(prompt:string,selection:string,showSelector=false){
    const file=this.app.workspace.getActiveFile();
    if(!file||file.extension.toLowerCase()!=='md')throw Error('Open a Markdown note before using T3 Code from the command palette.');
    return this.openManualAction(file,prompt,selection,undefined,showSelector);
  }
  private async openManualAction(file:TFile,prompt:string,selection:string,captured?:EditorChatContext,showSelector=false){
    if(!prompt.trim()&&!selection.trim()){
      return this.openNoteSend(file,showSelector);
    }
    const active=this.app.workspace.getActiveViewOfType(MarkdownView);
    const view=captured?.view??(active?.file?.path===file.path?active:undefined);
    const editor=captured?.editor??view?.editor;
    const selected=selection.trim();
    let context:EditorChatContext|undefined;
    if(view?.file?.path===file.path&&editor){
      context={...captured,editor,view,...(prompt.trim()?{initialQuestion:prompt}:{})};
      if(selected&&!context.anchor&&editor.getSelection()===selection){try{context.anchor=captureEditorSelection(editor);}catch(error){if(captured)throw error;/* Append when selection changed while palette was open. */}}
    }
    if(context?.anchor)context=this.canonicalChatContext(context);
    const canonicalSelected=context?.canonicalAnchor?.text??selection;
    const question=selected&&prompt.trim()?`Selected text:\n${canonicalSelected}\n\nQuestion:\n${prompt}`:selected?canonicalSelected:prompt;
    return this.openChatWithNote(this.noteContext(file),question,context,true,showSelector);
  }
  private openEditorChat(selection:string,file:TFile,context:EditorChatContext,showSelector=false){
    context=this.canonicalChatContext(context);
    return this.openChatWithNote(this.noteContext(file),context.canonicalAnchor?.text??selection,context,true,showSelector);
  }
  private notePromptDocument(view:MarkdownView|MarkdownFileInfo){return nativeResponses(this.app).view(view as MarkdownView)?.canonicalDisplayed()??view.editor?.getValue()??'';}
  private canonicalChatContext(context:EditorChatContext):EditorChatContext {
    if(!context.anchor||context.canonicalAnchor&&context.snapshot!==undefined)return context;
    const display=context.editor.getValue(),range=selectionRange(display,context.anchor);
    if(!range)throw Error('The selected text changed. Select it again before asking T3.');
    const adapter=nativeResponses(this.app).view(context.view as MarkdownView),mapped=adapter?.canonicalSelection(range.from,range.to);
    const snapshot=mapped?.document??context.snapshot??display;
    const canonicalAnchor=mapped?selectionAnchor(snapshot,mapped.text,mapped.start,mapped.end):context.anchor;
    return {...context,snapshot,canonicalAnchor,referenceSelection:Boolean(context.referenceSelection||mapped?.reference||selectionOverlapsInlineResponse(display,context.anchor))};
  }
  private needsFolderProject(notePath?:string):boolean {
    return Boolean(notePath?.includes('/')&&!folderLinkForPath(this.settings.folderLinks.filter(link=>link.folderPath!=='/'),notePath));
  }
  private responseProjectKey(id:string){
    const cached=this.deviceInline?.cachedResponse(id)??this.destinationRoutes.get(id),job=this.inlineChat?.find(id),request=cached?.record.request;
    const projectId=request?.projectId??job?.projectId,environment=request?.threadEnvironmentId??job?.connection?.environmentId;
    const project=[...this.projects(),...this.settings.directProjects,...this.settings.projects].find(project=>project.id===projectId&&(job?.connection?.connectionId?project.connectionId===job.connection.connectionId:environment?project.connectionId?this.settings.paired.find(connection=>connection.id===project.connectionId)?.environmentId===environment:this.eventLocalEnvironmentId===environment:!cached&&!!job?.connection&&!job.connection.connectionId&&!project.connectionId));
    return project&&projectKey(project);
  }
  private destinationContext(note?:{path:string;absolutePath?:string},inline?:EditorChatContext):Pick<ChatHost,'getInlineDefaults'|'steering'|'getNotePath'|'getProjectName'|'getDefaultProjectKey'|'getTargetDescription'|'getProjectChoices'|'getDefaultThread'|'getDefaultDestination'|'getAlternativeProjectKey'|'onProjectChange'>{
    // Capture the destination once. A later editor update must not redirect a send.
    const responseId=inline&&inlineSteeringTarget(inline.editor.getValue(),inline.editor.posToOffset(inline.editor.getCursor()),inline.responseId);
    const remembered=this.noteThread(note?.path);
    const link=note?folderLinkForPath(this.settings.folderLinks,note.path):this.settings.folderLinks.find(item=>item.folderPath==='/');
    const linkKey=(link:FolderLink)=>`${link.connectionId?link.connectionId+':':''}${link.projectId}`;
    const rememberedKey=remembered?`${remembered.connectionId?remembered.connectionId+':':''}${remembered.projectId}`:undefined;
    const selectedKey=rememberedKey??(link?linkKey(link):VAULT_PROJECT);
    const canonicalKey=(key?:string)=>key===VAULT_PROJECT?this.settings.folderLinks.find(item=>item.folderPath==='/')&&linkKey(this.settings.folderLinks.find(item=>item.folderPath==='/')!):key;
    const projectName=(key?:string)=>{
      const link=note?folderLinkForPath(this.settings.folderLinks,note.path):this.settings.folderLinks.find(item=>item.folderPath==='/');
      if(key===VAULT_PROJECT)return this.settings.folderLinks.find(item=>item.folderPath==='/')?.projectTitle??this.app.vault.getName();
      if(key===NEW_FOLDER_PROJECT)return `New project: ${note!.path.split('/').at(-2)}`;
      if(key)return [...this.projects(),...this.settings.directProjects,...this.settings.projects].find(project=>projectKey(project)===key)?.title??'Unavailable project';
      const remembered=this.noteThread(note?.path);
      if(remembered)return [...this.settings.directProjects,...this.settings.projects].find(project=>project.id===remembered.projectId&&sameWorkspacePath(project.workspaceRoot,remembered.workspaceRoot))?.title??`T3 project ${remembered.projectId.slice(0,8)}`;
      return link?.projectTitle??this.app.vault.getName();
    };
    return {
      getInlineDefaults:()=>({...this.settings.inlineStreaming}),
      steering:!!responseId,
      getNotePath:()=>note?.path??'No note open',
      getProjectName:projectName,
      getDefaultProjectKey:()=>responseId&&!remembered?undefined:selectedKey,
      getTargetDescription:key=>`${note?.path??'No note open'} → ${projectName(key)}`,
      onProjectChange:listener=>this.watchProjects(listener),
      getProjectChoices:()=>{
        const root=this.settings.folderLinks.find(item=>item.folderPath==='/');
        return [...(this.needsFolderProject(note?.path)?[{key:NEW_FOLDER_PROJECT,label:`New project: ${note!.path.split('/').at(-2)}`}]:[]),{key:VAULT_PROJECT,label:`Vault project: ${root?.projectTitle??this.app.vault.getName()}`},...this.projects().filter(project=>!root||project.id!==root.projectId||(project.connectionId??'')!==root.connectionId||!sameWorkspacePath(project.workspaceRoot,root.workspaceRoot)).map(project=>({key:projectKey(project),label:this.projectChoiceLabel(project)}))];
      },
      getDefaultThread:key=>!key||canonicalKey(key)===rememberedKey?remembered?.threadId:undefined,
      getAlternativeProjectKey:key=>key??(responseId?rememberedKey??this.responseProjectKey(responseId):selectedKey),
      getDefaultDestination:async(key,signal)=>{
        try{
          const hosted=responseId?await this.steeringDestination(responseId,signal):undefined;
          const job=responseId?this.inlineChat?.find(responseId):undefined;
          const source=hosted?.record.request??job;
          if(responseId&&(!source||job?.hosted&&!hosted))throw Error('This response is unavailable. Reconnect its host or choose another thread.');
          const responsePath=hosted?.record.state?.notePath??hosted?.record.request.notePath??job?.path;
          if(hosted&&responsePath!==note?.path)await abortableRead(this.checkResponseNote(responseId!,responsePath!,note?.path),signal);
          if(job&&!hosted&&job.path!==note?.path)throw Error('The local response is no longer attached to this editor. Reopen the note before sending.');
          const threadId=source?.threadId??remembered?.threadId;
          if(!threadId)throw Error('This response has not reached a T3 thread. Choose New thread or Existing thread…');
          const project=source?await abortableRead(this.recoveryProject(source.projectId!,hosted?.record.request.threadEnvironmentId??job?.connection?.environmentId),signal):this.projectForNoteThread(remembered!);
          requestAborted(signal);
          if(key&&canonicalKey(key)!==projectKey(project))throw Error('This conversation belongs to another project. Choose New thread or Existing thread…');
          const thread=await this.readChatThread(this.connection(project),project,threadId,signal);
          const active=threadIsActive(thread);
          if(thread.hasPendingApprovals||thread.hasPendingUserInput)throw Error('This conversation is waiting for approval or input. Resolve it in T3 before sending.');
          if(active&&responseId&&!responseOwnsActiveTurn(thread,hosted?.record.state??job)){this.destinationRoutes.delete(responseId);throw Error('The selected response is not bound to the current active turn. Wait for its checkpoint or explicitly choose a thread.');}
          return {threadId,projectKey:projectKey(project),...(active&&responseId?{responseId}:{}),label:active?'Send to running thread':'Continue thread',detail:`${typeof thread.title==='string'?thread.title:'T3 thread'} · ${threadId.slice(0,8)}${active&&responseId?' · Keeps this response’s streaming choices.':''}`} satisfies ChatDestination;
        }catch(error){return {label:'Thread unavailable',unavailable:true,detail:`${unsavedMessage(error)} No message was sent. Use New thread or Existing thread…`};}
      },
    };
  }
  private openChatWithNote(note:{path:string;absolutePath?:string}|undefined,prompt?:string,inline?:EditorChatContext,answerOnly=false,showSelector=false){
    // Generated text is captured context, never a source to move. Classify it
    // before the chooser/network waits: streaming may replace its surroundings.
    if(inline?.anchor)inline=this.canonicalChatContext(inline);
    const send=(text:string,options:{threadId?:string;responseId?:string;newThread?:boolean;expectedProjectKey?:string;projectOverrideKey?:string;jobOptions?:ResolvedJobOptions})=>this.sendResolvedChat(text,note,inline,answerOnly,options);
    const host:ChatHost=this.withSendAvailability({...this.destinationContext(note,inline),
      sendChat:(text,key,resolve,_back,destination)=>send(text,{threadId:destination?.threadId,responseId:destination?.responseId,expectedProjectKey:destination?.projectKey,projectOverrideKey:key,jobOptions:resolve?.()}),
      sendToNew:(text,key,resolve)=>send(text,{newThread:true,projectOverrideKey:key??VAULT_PROJECT,jobOptions:resolve?.()}),
      sendToExisting:(text,key,resolve,back)=>this.openChatThreads(text,note,inline,answerOnly,key,resolve,back),
    });
    return openChatFlow(this.app,host,prompt,showSelector);
  }
  private commandSendSelector(view:MarkdownView|MarkdownFileInfo){
    const app=this.app as App&{hotkeyManager?:{customKeys?:Record<string,import('obsidian').Hotkey[]>;getHotkeys?:(id:string)=>import('obsidian').Hotkey[]}};
    const id='send-to-t3-code:send-or-ask';
    const hotkeys=app.hotkeyManager?.customKeys?.[id]??app.hotkeyManager?.getHotkeys?.(id)??[];
    const win=(view as MarkdownView).containerEl?.ownerDocument.defaultView??(typeof window!=='undefined'?window:undefined);
    return this.sendGesture.selector(win,hotkeys,Platform.isMacOS);
  }
  private withSendAvailability(host:ChatHost):ChatHost{
    const plugin=this;
    Object.defineProperty(host,'busy',{get:()=>plugin.busy||plugin.defaultSending});
    host.runDefaultSend=async send=>{
      if(this.busy||this.defaultSending||this.stopped)throw new RequestDeliveryError('Another send is in progress or the plugin is disabled.',false);
      this.defaultSending=true;
      const refresh=()=>{for(const listener of this.busyListeners)try{listener();}catch(error){logFailure('ui.destination.busy-update',error);}};
      try{refresh();await send();}finally{this.defaultSending=false;refresh();}
    };
    host.onBusyChange=listener=>{this.busyListeners.add(listener);return ()=>this.busyListeners.delete(listener);};
    return host;
  }
  private async openChatThreads(prompt:string,note?:{path:string;absolutePath?:string},inline?:EditorChatContext,answerOnly=false,overrideKey?:string,resolve?:()=>ResolvedJobOptions,back?:()=>void){
    const target=await this.existingTarget(note?.path,overrideKey);
    if(!target){new ExistingThreadModal(this.app,[],async()=>{},'Existing threads','No project exists for this folder yet. Use New thread.',back).open();return;}
    const {project}=target;
    const readiness=this.projectReadinessError(project);if(readiness)throw Error(readiness);
    new Notice('Loading threads…',2000);
    const threads=projectThreads(await runBridge(this.connection(project),['threads','--project',project.id]),project.id);
    if(this.stopped)return;
    new ExistingThreadModal(this.app,threads,thread=>this.sendResolvedChat(prompt,note,inline,answerOnly,{threadId:thread.id,expectedProjectKey:projectKey(project),projectOverrideKey:overrideKey,jobOptions:resolve?.()}),'Ask in an existing thread','No existing threads in this project. Use New thread.',back).open();
  }
  private async sendResolvedChat(prompt:string,note:{path:string;absolutePath?:string}|undefined,context:EditorChatContext|undefined,answerOnly:boolean,options:{threadId?:string;responseId?:string;newThread?:boolean;expectedProjectKey?:string;projectOverrideKey?:string;jobOptions?:ResolvedJobOptions}){
    const jobOptions=options.jobOptions??resolveJobOptions(this.settings.inlineStreaming);
    // Steering extends the existing response, even when this draft says Off.
    const activeId=options.responseId??(!options.threadId&&context?inlineSteeringTarget(context.editor.getValue(),context.editor.posToOffset(context.editor.getCursor()),context.responseId):undefined);
    if(context&&note&&activeId&&!options.newThread)return this.sendInlineSteering(activeId,prompt,note,context,options);
    if(jobOptions.inline.enabled&&note&&(context||typeof this.app.workspace.getLeaf==='function')){
      if(!context){const file=this.app.vault.getFileByPath(note.path);if(!file)throw Error('The original note is unavailable.');const view=await this.editorForNoteSend(file);if(!view)throw Error('A Markdown editor is required for inline streaming.');context={view,editor:view.editor};}
      return this.sendInlineChat(prompt,note,context,{...options,jobOptions});
    }
    return this.sendChat(answerOnly?`${prompt}\n\n${THREAD_REPLY_INSTRUCTION}`:prompt,note,{...options,jobOptions:{...jobOptions,inline:{...jobOptions.inline,enabled:false}},sourceContext:context});
  }
  private async sendInlineChat(prompt:string,note:{path:string;absolutePath?:string},context:EditorChatContext,options?:{threadId?:string;newThread?:boolean;expectedProjectKey?:string;projectOverrideKey?:string;jobOptions?:ResolvedJobOptions}){
    const manager=this.inlineChat;if(!manager)throw Error('Inline T3 response is unavailable. Reload the plugin.');
    if(context.view.file?.path!==note.path)throw Error('The original note is no longer open. Reopen it before asking T3.');
    const activeId=inlineSteeringTarget(context.editor.getValue(),context.editor.posToOffset(context.editor.getCursor()),context.responseId);
    if(activeId&&!options?.newThread&&!options?.threadId)return this.sendInlineSteering(activeId,prompt,note,context,options);
    const jobOptions=options?.jobOptions??resolveJobOptions(this.settings.inlineStreaming);
    const requestId=randomId(),initialInput=context.initialQuestion?{messageId:commandId(requestId,'message'),text:context.initialQuestion}:undefined;
    let job:InlineJob|undefined,delivered=false;
    try{
      await this.sendChat(`${prompt}\n\n${INLINE_REPLY_INSTRUCTION}`,note,{...options,jobOptions,requestId,sourceContext:context,onPrepared:async request=>{
        // Package images before mutating the note.

        job=context.anchor&&!context.referenceSelection&&!activeId?manager.reserve(context.editor,context.view,context.anchor,requestId,note.path,initialInput,request.title,jobOptions):manager.reserveAtEnd(context.editor,context.view,requestId,note.path,initialInput,request.title,jobOptions);
        await manager.prepare(job,request);
      }});delivered=true;if(job)manager.start(job);
    }catch(error){if(job)await manager.deliveryFailed(job,delivered||(error instanceof RequestDeliveryError&&(error.requestSaved||error.terminal)));throw error;}
  }

  private async steeringRecord(id:string):Promise<{record:LeaseRecord;host:InlineHostTarget}|undefined>{
    const local=this.deviceInline?.cachedResponse(id);if(local?.record.request.localOnly)return local;
    const job=this.inlineChat?.find(id);
    const targets=[job?.hostTarget,...this.inlineTargets].filter((value):value is InlineHostTarget=>!!value);
    if(!job||job.hosted)try{const current=await this.inlineHostTarget();if(!targets.some(target=>JSON.stringify(target)===JSON.stringify(current)))targets.push(current);}catch{}
    for(const host of targets){
      let opened:{files:InlineFiles;close():void};try{opened=await this.inlineHostFiles(host);}catch{continue;}
      try{const raw=await opened.files.read(leasePaths(host.directory,id).record);if(raw){const record:LeaseRecord=JSON.parse(raw);if(record.request.id===id&&record.request.vaultId===this.settings.vaultId)return {record,host};}}finally{opened.close();}
    }
  }
  /** A cold client reads routing metadata, never tool history. Legacy hosts
   * supply one retained record until their coordinator publishes this index. */
  private async steeringDestination(id:string,signal?:AbortSignal){
    const live=this.deviceInline?.cachedResponse(id),cached=this.destinationRoutes.get(id);if(live)return live;if(cached&&Date.now()-cached.at<5000)return cached;if(cached)this.destinationRoutes.delete(id);
    const job=this.inlineChat?.find(id),targets=[job?.hostTarget,...this.inlineTargets].filter((value):value is InlineHostTarget=>!!value);
    if(!job||job.hosted)try{const current=await abortableRead(this.inlineHostTarget(),signal);if(!targets.some(target=>JSON.stringify(target)===JSON.stringify(current)))targets.push(current);}catch(error){requestAborted(signal);}
    for(const host of targets){
      requestAborted(signal);const work=this.inlineHostFiles(host);void work.then(opened=>{if(signal?.aborted)opened.close();},()=>{});
      let opened:Awaited<ReturnType<SendToT3['inlineHostFiles']>>;try{opened=await abortableRead(work,signal);}catch(error){requestAborted(signal);continue;}
      const close=()=>opened.close();signal?.addEventListener('abort',close,{once:true});
      try{
        const raw=await abortableRead(opened.files.read(`${host.directory}/routes/${id}.json`),signal);
        let record:LeaseRecord;
        if(raw){const route=JSON.parse(raw);if(route.version!==1||route.id!==id||route.vaultId!==this.settings.vaultId||route.host?.environmentId!==host.environmentId||typeof route.notePath!=='string'||typeof route.threadId!=='string'||typeof route.projectId!=='string'||typeof route.threadEnvironmentId!=='string')continue;record={request:{...route,id,notePath:route.notePath},state:{...route,notePath:route.notePath}} as LeaseRecord;}
        else {const legacy=await abortableRead(opened.files.read(leasePaths(host.directory,id).record),signal);if(!legacy)continue;const full:LeaseRecord=JSON.parse(legacy);if(full.request?.id!==id||full.request.vaultId!==this.settings.vaultId)continue;const request=full.request,state=full.state;record={request:{id:request.id,vaultId:request.vaultId,notePath:request.notePath,threadId:request.threadId,projectId:request.projectId,threadEnvironmentId:request.threadEnvironmentId,messageId:request.messageId,host:request.host},state:state?{notePath:state.notePath,turnId:state.turnId,turnIds:state.turnIds,status:state.status}:undefined} as LeaseRecord;}
        const destination={record,host,at:Date.now()};this.destinationRoutes.delete(id);this.destinationRoutes.set(id,destination);while(this.destinationRoutes.size>128)this.destinationRoutes.delete(this.destinationRoutes.keys().next().value!);return destination;
      }finally{signal?.removeEventListener('abort',close);opened.close();}
    }
  }
  private async sendInlineSteering(id:string,prompt:string,note:{path:string;absolutePath?:string},context:EditorChatContext,options?:{threadId?:string;expectedProjectKey?:string;projectOverrideKey?:string}){
    logEvent('steering.requested',{jobId:id,notePath:note.path,promptHash:contentHash(prompt),promptLength:prompt.length,selectionHash:context.anchor?contentHash(JSON.stringify(context.anchor)):undefined});
    const job=this.inlineChat?.find(id);let hosted=await this.steeringRecord(id);
    if(job?.hosted&&!hosted||!hosted&&!job)throw Error('The active response is unavailable. Reconnect its vault project machine.');
    const threadId=hosted?.record.request.threadId??job?.threadId,projectId=hosted?.record.request.projectId??job?.projectId,environmentId=hosted?.record.request.threadEnvironmentId??job?.connection?.environmentId;
    if(!threadId||!projectId)throw Error('Wait for the first message to reach T3 before steering.');
    if(options?.threadId&&options.threadId!==threadId)throw Error('This note has a running response in another thread. Finish or stop it first.');
    const responsePath=hosted?.record.state?.notePath??hosted?.record.request.notePath;
    if(hosted&&responsePath!==note.path)await this.checkResponseNote(id,responsePath!,note.path);
    await this.checkRecoveryBlock(id,note.path);
    let selection=context.referenceSelection?undefined:context.canonicalAnchor??context.anchor;
    if(selection){const document=this.notePromptDocument(context.view),range=selectionRange(document,selection);if(!range)throw Error('The selected text changed. Select it again.');if(selectionOverlapsInlineResponse(document,{start:range.from,end:range.to}))selection=undefined;}
    const project=await this.recoveryProject(projectId,environmentId),key=projectKey(project);
    if(options?.expectedProjectKey&&options.expectedProjectKey!==key||options?.projectOverrideKey&&options.projectOverrideKey!==key)throw Error('Steering must use the running thread’s project.');
    const current=await this.readChatThread(this.connection(project),project,threadId);
    if(!threadIsActive(current)||!responseOwnsActiveTurn(current,hosted?.record.state??job))throw Error('This response no longer owns the active turn. Reopen the chooser or explicitly choose a thread. No message was sent.');
    if(hosted&&responsePath!==note.path){
      if(!this.deviceInline)throw Error('Response ownership is unavailable. Reload the plugin.');
      hosted={...hosted,record:await this.deviceInline.relocateResponse(hosted.host,hosted.record,note.path)};
      this.destinationRoutes.delete(id);
    }
    const policy=hosted?.record.request??job!;
    const jobOptions=resolveJobOptions({enabled:true,intermediateMode:policy.intermediateMode,keepIntermediate:policy.keepIntermediate,finalAnswerFormat:policy.finalAnswerFormat});
    await this.sendChat(`${prompt}\n\n${INLINE_REPLY_INSTRUCTION}`,note,{threadId,projectOverrideKey:key,jobOptions,sourceContext:context,onPrepared:request=>{
      logEvent('steering.prepared',{jobId:id,requestId:request.id,messageId:commandId(request.id,'message'),threadId,projectId});
      request.inlineSteering={jobId:id,...(hosted?{host:hosted.host}:{}),input:{messageId:commandId(request.id,'message'),text:prompt,...(selection?{selection}:{})}};
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
          await this.checkRecoveryBlock(id,path);
        }
        return {record,host};
      }finally{opened.close();}
    }
  }
  private async checkRecoveryBlock(id:string,path:string){
    const leaf=this.app.workspace.getLeavesOfType('markdown').find(leaf=>(leaf.view as MarkdownView).file?.path===path);
    const file=this.app.vault.getFileByPath(path);
    if(!file)throw Error('The original note is no longer available.');
    const document=leaf?(leaf.view as MarkdownView).editor.getValue():await this.app.vault.read(file);
    const block=regionBody(document,id);
    if(!block)throw Error('The response markers were removed or malformed. Restore them or continue in the T3 thread.');
  }
  /** A host path can lag a rename received on another device. The exact local
   * response anchor, rather than that routing hint, establishes the note. */
  private async checkResponseNote(id:string,previous:string,path?:string){
    if(!path)throw Error('Open the response note before sending.');
    await this.checkRecoveryBlock(id,path);
    const io=deviceNoteIO(this.app),original=await io.readNote(previous);
    if(original&&regionBody(original,id))throw Error('This response appears in both the previous note and this note. Remove the duplicate response before sending.');
    if(await io.locateNote(id,path)!==path)throw Error('The response note changed. Reopen the chooser before sending.');
    await this.checkRecoveryBlock(id,path);
  }
  private async recoveryProject(projectId:string,environmentId?:string){
    for(const project of [...this.settings.directProjects,...this.settings.projects]){
      if(project.id!==projectId)continue;
      try{
        const connection=this.connection(project),selected=connection.environmentId??(!Platform.isMobile?await this.localInlineEnvironment():undefined);
        if(!environmentId||selected===environmentId)return project;
      }catch{}
    }
    throw Error('The original T3 project is unavailable on this device. Reconnect its machine.');
  }
  private async continueInline(id:string,path:string){
    const hosted=await this.recoveryRecord(id,path),job=hosted?undefined:this.inlineChat?.find(id);
    if(!hosted&&(!job||job.hosted||job.path!==path||job.phase!=='error'||!job.threadId||!job.projectId||!job.messageId))throw Error('The streaming host is unavailable or this response is no longer waiting for a continuation.');
    await this.checkRecoveryBlock(id,path);
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
    await this.checkRecoveryBlock(id,path);
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
  private async inlineThreadAccess(environmentId:string,forceRefresh=false):Promise<ThreadAccess>{
    const paired=this.settings.paired.find(connection=>connection.environmentId===environmentId);
    // A known connection is sufficient, even when this desktop's T3 server
    // is stopped. Local discovery is only needed for an unpaired local thread.
    if(!paired&&!Platform.isMobile&&environmentId===await this.localInlineEnvironment())return (await import('./desktop')).desktopThreadAccess({...this.settings.connection,host:'local'});
    if(!paired)throw Error('Connect this device to the thread machine to take over responses.');
    const connection:Connection={transport:'direct',host:'direct',executable:'',url:paired.url,environmentId,connectionId:paired.id};
    const session=await this.sessionFor(paired.id,forceRefresh);
    return {origin:endpoint(paired.url),expiresAt:session?.expiresAt,api:await environmentApi(connection,session)};
  }
  private localInlineEnvironment():Promise<string>{
    if(Platform.isMobile)return Promise.reject(Error('A phone cannot host vault responses.'));
    return this.inlineEnvironment??=import('./desktop').then(d=>d.desktopEnvironment(this.settings.connection)).catch(error=>{this.inlineEnvironment=undefined;throw error;});
  }
  private registerInlineInterval(callback:()=>void,milliseconds:number){
    if(Platform.isMobile){this.registerInterval(window.setInterval(callback,milliseconds));return;}
    void import('./desktop-timers').then(({desktopInterval})=>{
      if(!this.stopped)this.register(desktopInterval(callback,milliseconds));
    });
  }
  private async refreshNoteCommandHost():Promise<void>{
    if(Platform.isMobile||this.stopped)return;
    if(this.noteCommandOpening)return this.noteCommandOpening;
    const work=(async()=>{
      if(this.noteCommandServer?.active)return;
      const root=(this.app.vault.adapter as {getFullPath?:(path:string)=>string}).getFullPath?.('');
      if(!root)return;
      const {NoteCommandServer}=await import('./note-command-desktop');
      const configDir=this.app.vault.configDir||'.obsidian';
      this.clientMaintenance??=new (await import('./client-maintenance-desktop')).DesktopClientMaintenance(this.app,root,configDir,pluginManifest.version);
      const server=await NoteCommandServer.open(root,configDir,command=>this.executeAgentCommand(command),()=>!this.stopped,undefined,async(command,result)=>isClientCommand(command)?this.clientMaintenance!.acknowledged(command,result):false);
      if(this.stopped){await server.dispose();return;}this.noteCommandServer=server;
    })();
    this.noteCommandOpening=work;try{await work;}finally{if(this.noteCommandOpening===work)this.noteCommandOpening=undefined;}
  }
  private async reloadForConnection(beforeDispatch:()=>boolean){
    if(this.stopped||Platform.isMobile)return false;
    const dispatch=()=>{if(!beforeDispatch())return false;new Notice('T3 Code: The connection stopped responding. Reloading Obsidian.',10000);return true;};
    if(this.clientMaintenance)return this.clientMaintenance.reloadCurrent(dispatch);
    if(!dispatch())return false;
    if(!(this.app as any).commands.executeCommandById('app:reload'))throw Error('Obsidian refused the native reload command.');
    return true;
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
      if(this.inlineHostService&&(!this.inlineHostService.active||this.inlineHostKey!==key)){
        const previous=this.inlineHostService;this.inlineHostService=undefined;this.inlineHostKey='';
        await previous.dispose().catch(()=>{});
      }
      if(!key||!localRoot||this.inlineHostService)return;
      const environmentId=await this.localInlineEnvironment();
      if(this.stopped)return;
      const {DesktopInlineHost}=await import('./hosted-inline-desktop');
      const host=await DesktopInlineHost.open(this.app,{vaultId:this.settings.vaultId,environmentId,workspaceRoot:localRoot,directory:`${this.app.vault.configDir||'.obsidian'}/t3-code/inline/v1`},async(target,reason)=>{
        if(target===environmentId)return (await import('./desktop')).desktopThreadAccess({...this.settings.connection,host:'local'},'response-host');
        const paired=this.settings.paired.find(c=>c.environmentId===target);
        if(!paired)throw Error('Connect the thread machine in the streaming host’s T3 settings.');
        const connection:Connection={transport:'direct',host:'direct',executable:'',url:paired.url,environmentId:paired.environmentId,connectionId:paired.id};
        const session=await this.sessionFor(paired.id,reason==='auth-rejected');
        return {origin:endpoint(paired.url),expiresAt:session?.expiresAt,api:await environmentApi(connection,session)};
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
  private async localResponseTarget(request:Request):Promise<InlineHostTarget>{
    const root=this.settings.folderLinks.find(link=>link.folderPath==='/');
    const environmentId=root?.environmentId??this.settings.paired.find(connection=>connection.id===root?.connectionId)?.environmentId??request.connection.environmentId??await this.localInlineEnvironment();
    return {environmentId,workspaceRoot:root?.workspaceRoot??request.project.workspaceRoot,directory:`${this.app.vault.configDir||'.obsidian'}/t3-code/inline/v1`,...(root?.connectionId?{connectionId:root.connectionId}:{})};
  }
  private async prepareHostedInline(job:InlineJob,request:Request){
    const host=await this.localResponseTarget(request);
    const threadEnvironmentId=request.connection.environmentId??await this.localInlineEnvironment();
    job.hostTarget=host;this.rememberInlineTarget(host);
    request.inlineHost={localOnly:true,nativeProjection:true,responseContainer:true,version:4,finalAnswerFormat:finalAnswerFormat(job.finalAnswerFormat),independent:true,threadTitle:request.title,initialOwner:this.inlineActor,id:job.id,vaultId:this.settings.vaultId,host,notePath:job.path,threadId:job.threadId!,messageId:job.messageId!,projectId:request.project.id,threadEnvironmentId,initialHash:job.bodyHash,createdAt:job.createdAt,keepIntermediate:job.keepIntermediate===true,intermediateMode:intermediateMode(job.intermediateMode,job.keepIntermediate),...(job.initialInput?{initialInput:job.initialInput}:{})};
    request.prompt+=stagedNoteInstruction([request.inlineHost]);if(request.prompt.length>120_000)throw Error('The note and staged-edit context exceed T3’s prompt limit.');

  }
  private async coordinatedHostFormat(target:InlineHostTarget){
    const opened=await this.inlineHostFiles(target);
    try{const raw=await opened.files.read(`${target.directory}/coordinated-capabilities.json`),capabilities=raw?JSON.parse(raw):{};return {nativeProjection:capabilities.nativeProjection===true,responseContainer:capabilities.nativeProjection===true&&capabilities.responseContainers===1};}catch{return {nativeProjection:false,responseContainer:false};}finally{opened.close();}
  }
  private async inlineHostFiles(target:InlineHostTarget,waitForHost=true):Promise<{files:InlineFiles;readonly closed:boolean;close():void}>{
    const adapter=this.app.vault.adapter as {getFullPath?:(path:string)=>string};
    if(!Platform.isMobile&&adapter.getFullPath&&sameWorkspacePath(adapter.getFullPath(''),target.workspaceRoot)&&await this.localInlineEnvironment()===target.environmentId){
      if(waitForHost)await this.refreshInlineHost();
      else void this.refreshInlineHost().catch(error=>logFailure('ownership.coordinator.reader-start',error));
      const files=(await import('./inline-host-storage-desktop')).localInlineFiles(target.workspaceRoot,target.directory);
      // Existing records are readable while the writer starts or releases its
      // old lock. Mailbox writes retain the host-readiness requirement.
      return {closed:false,files:{read:files.read,write:async(path,contents)=>{await this.refreshInlineHost();await files.write(path,contents);},dispatch:async command=>{
        await this.refreshInlineHost();
        const host=this.inlineHostService;
        if(!host?.matchesTarget(target))throw Error('The local response host changed before command dispatch.');
        await host.dispatch(command);
      }},close:()=>{}};
    }
    const paired=this.settings.paired.find(c=>c.environmentId===target.environmentId&&(c.id===target.connectionId||!target.connectionId))??this.settings.paired.find(c=>c.environmentId===target.environmentId);
    if(!paired)throw Error('Connect the vault project machine on this device before streaming replies.');
    const remote=await connectVaultRemote({transport:'direct',host:'direct',executable:'',url:paired.url,connectionId:paired.id,environmentId:paired.environmentId},await this.sessionFor(paired.id));
    try{
      if(!await remote.matches(target.workspaceRoot,`${this.app.vault.configDir||'.obsidian'}/plugins/${this.manifest?.id||'send-to-t3-code'}/data.json`,this.settings.vaultId))throw Error('The streaming host no longer matches this vault. Reconnect the vault project machine.');
      const storage=privateStorageResolver(path=>remote.readFile(target.workspaceRoot,path),target.workspaceRoot,this.app.vault.configDir||'.obsidian');
      return {get closed(){return remote.closed;},files:{read:async path=>remote.readFile(await storage(),path),write:async(path,contents)=>remote.writeFile(await storage(),path,contents)},close:()=>remote.close()};
    }catch(error){remote.close();throw error;}
  }
  private async stopLocalInline(job:InlineJob){
    const current=this.deviceInline?.localResponse(job.id);
    if(current)return this.deviceInline!.stopResponse(current.host,job.id,nativeResponses(this.app).stoppedBody(job.id),job.remoteStopOperationId);
    if(!job.threadId||!job.threadEnvironmentId)throw Error('The saved local response has no T3 routing identity.');
    await interruptStoppedResponse(()=>this.inlineThreadAccess(job.threadEnvironmentId!),job.remoteStopOperationId??job.id,job.threadId,job.turnId,10_000,job.messageId,job.projectId,job.createdAt,job.stopRunTerminal);
    return {version:1 as const,bindingId:job.id,commandId:job.remoteStopOperationId??'',epoch:1,revision:1,hostRecorded:true,runTerminal:!!job.stopRunTerminal,finalSaved:true,finalWriterPending:false};
  }
  private async stopHostedInline(id:string,target?:InlineHostTarget,operationId?:string){
    this.deviceInline?.stopLocally(id);
    const host=target??await this.inlineHostTarget();
    const local=this.deviceInline?.responseStatus(id);if(this.deviceInline?.localResponse(id))return this.deviceInline.stopResponse(host,id,nativeResponses(this.app).stoppedBody(id),operationId);
    const opened=await this.inlineHostFiles(host);
    try{
      const paths=hostedPaths(host.directory,id);
      const request=await opened.files.read(paths.request);
      if(!request){new Notice('Response finished in this note. No remote response binding was found.');return;}
      if(this.deviceInline&&[2,3,4].includes(JSON.parse(request).version)){const receipt=await this.deviceInline.stopResponse(host,id,nativeResponses(this.app).stoppedBody(id),operationId);new Notice(receipt.runTerminal?'Response finished. The host recorded the stop.':'Response finished; remote stop requested.');return receipt;}
      await opened.files.write(paths.stop,JSON.stringify({id,requestedAt:new Date().toISOString(),stoppedBody:nativeResponses(this.app).stoppedBody(id)}));
      new Notice('Response finished; remote stop requested.');
    }finally{opened.close();}
  }
  private async chatTarget(notePath?:string,preferred?:NoteThread,ignorePreviousThread=false,overrideKey?:string,interactive=true):Promise<{project:Project;link:FolderLink}> {
    if(overrideKey===VAULT_PROJECT)return this.vaultTarget();
    if(overrideKey===NEW_FOLDER_PROJECT){if(!notePath?.includes('/'))throw Error('Choose a note inside a folder.');return (await this.folderTarget(notePath,true,interactive))!;}
    let link=notePath?folderLinkForPath(this.settings.folderLinks,notePath):this.settings.folderLinks.find(item=>item.folderPath==='/');
    if(overrideKey){const project=[...this.projects(),...this.settings.directProjects,...this.settings.projects].find(item=>projectKey(item)===overrideKey);if(!project)throw Error('The chosen T3 project is unavailable. Choose a project again.');return {project,link:link&&projectKey(project)===`${link.connectionId?link.connectionId+':':''}${link.projectId}`?link:{id:'project-override',folderPath:'/',connectionId:project.connectionId??'',projectId:project.id,projectTitle:project.title,workspaceRoot:project.workspaceRoot,self:false}};}
    const remembered=preferred??(!ignorePreviousThread?this.noteThread(notePath):undefined);
    if(remembered){const project=this.projectForNoteThread(remembered);return {project,link:link??{id:'note-thread',folderPath:'/',connectionId:remembered.connectionId,projectId:remembered.projectId,projectTitle:project.title,workspaceRoot:remembered.workspaceRoot,self:true}};}
    if(this.needsFolderProject(notePath))return (await this.folderTarget(notePath!,true,interactive))!;
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
    try{await this.save();this.refreshFolderIndicators();}catch(error){this.settings.folderLinks=previous;throw error;}
    return {project,link};
  }
  private async folderTarget(notePath:string,create:boolean,interactive=true):Promise<{project:Project;link:FolderLink}|undefined>{
    const folderPath=notePath.slice(0,notePath.lastIndexOf('/'));
    const existing=folderLinkForPath(this.settings.folderLinks.filter(link=>link.folderPath!=='/'),notePath);
    if(existing)return {project:this.projectForLink(existing),link:existing};
    if(!create)return;
    if(!interactive)throw Error('Link this note’s folder to an existing T3 project with link-folder before sending. New projects require the workspace picker.');
    const project=await this.pickFolderProject(folderPath,folderPath.split('/').at(-1)!);
    if(!project)throw new ProjectCreationCancelled();
    if(this.stopped)throw Error('The plugin was disabled before sending.');
    const connection=this.connection(project);
    if(project.connectionId)this.settings.directProjects=[...this.settings.directProjects.filter(item=>projectKey(item)!==projectKey(project)),project];
    else this.settings.projects=[...this.settings.projects.filter(item=>item.id!==project.id),project];
    const link:FolderLink={id:randomId(),folderPath,connectionId:project.connectionId??'',projectId:project.id,projectTitle:project.title,workspaceRoot:project.workspaceRoot,self:false,vaultId:this.settings.vaultId,...(connection.environmentId?{environmentId:connection.environmentId}:{})};
    return {project,link};
  }
  private folderLinkIntent(link:FolderLink):{folderLinkIntent?:FolderLink}{
    return link.folderPath!=='/'&&!this.settings.folderLinks.some(item=>item.folderPath===link.folderPath)?{folderLinkIntent:link}:{};
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
  private async prepareImages(markdown:string,sourcePath:string,resolveReferences=false,snapshot?:string){
    let definitions='';
    if(resolveReferences&&sourcePath&&/!\[(?!\[)[^\]\n]*\](?!\()/.test(markdown)){
      const view=this.app.workspace.getLeavesOfType('markdown').map(leaf=>leaf.view as MarkdownView).find(view=>view.file?.path===sourcePath);
      const file=this.app.vault.getFileByPath(sourcePath);
      const source=snapshot??(view?this.notePromptDocument(view):file?await this.app.vault.read(file):'');
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
  private async readChatThread(connection:Connection,project:Project,threadId:string,signal?:AbortSignal){
    let thread:any;
    try{thread=await runBridge(connection,['read',threadId],'',{signal,control:true});}
    catch(error){if(/HTTP 404\b/.test(message(error)))throw Error('The selected T3 thread does not exist. Choose another thread.');throw error;}
    if(thread?.id!==threadId||thread.projectId!==project.id||thread.archivedAt||thread.deletedAt)throw Error('The selected T3 thread is unavailable in this project.');
    return thread;
  }
  private async requestTitle(connection:Connection,project:Project,threadId:string|undefined,notePath:string|undefined){
    if(!threadId)return noteThreadTitle(notePath,this.settings.threadTitleGeneration);
    const thread=await this.readChatThread(connection,project,threadId);
    return typeof thread.title==='string'&&thread.title.trim()?thread.title.slice(0,160):'T3 thread';
  }
  async sendChat(prompt:string,note?:{path:string;absolutePath?:string},options?:{threadId?:string;newThread?:boolean;expectedProjectKey?:string;projectOverrideKey?:string;requestId?:string;jobOptions?:ResolvedJobOptions;barePrompt?:boolean;sourceContext?:EditorChatContext;onPrepared?:(request:Request)=>void|Promise<void>}):Promise<void> {
    if(this.busy)throw Error('Another send is in progress. Wait for it to finish.');
    if(!prompt.trim())throw Error('Enter a message before sending.');
    if(this.stopped)throw Error('The plugin has been disabled. Re-enable it before sending.');
    this.busy=true;
    const startedAt=Date.now();let request:Request|undefined;
    try{
      const initialImages=options?.barePrompt||options?.sourceContext?.anchor?undefined:await this.prepareImages(prompt,note?.path??'',true);
      if((initialImages||!/!\[/.test(prompt))&&(initialImages?.markdown??prompt).length+(options?.barePrompt?0:this.messageFooter(note?.absolutePath??note?.path??'(no note open)').length)>120_000)throw Error('The message and note path exceed T3’s 120,000-character limit. Shorten the message before sending.');
      const historical=note&&options?.threadId&&!options.expectedProjectKey?this.previousNoteThread(note.path,options.threadId):undefined;
      let {project,link}=await this.chatTarget(note?.path,historical,Boolean(options?.newThread||options?.expectedProjectKey),options?.projectOverrideKey??options?.expectedProjectKey);
      if(options?.expectedProjectKey&&projectKey(project)!==options.expectedProjectKey)throw Error('The note’s linked project changed. Choose a thread again.');
      const readiness=this.projectReadinessError(project);if(readiness)throw Error(readiness);
      const connection=this.connection(project);
      const active=this.noteThread(note?.path);
      const threadId=options?.threadId??(!options?.newThread&&active&&project.id===active.projectId&&(project.connectionId??'')===active.connectionId?active.threadId:undefined);
      const images=options?.barePrompt?undefined:initialImages??await this.prepareImages(prompt,note?.path??'',true,options?.sourceContext?.snapshot);
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
      const title=await this.requestTitle(connection,project,threadId,note?.path);
      request={...(options?.jobOptions?{jobOptions:options.jobOptions}:{}),id:options?.requestId??randomId(),project:{...project},title,prompt:text,connection,...(images?.attachments.length?{attachments:images.attachments,context:images.context}:{}),...(threadId?{threadId}:{}),...(note?{noteThread:this.noteThreadIntent(note.path,project,connection)}:{}),...this.folderLinkIntent(link)};
      await options?.onPrepared?.(request);
      logEvent('request.prepared',{requestId:request.id,threadId:request.threadId,projectId:request.project.id,notePath:note?.path,promptHash:contentHash(request.prompt),promptLength:request.prompt.length});
      this.settings.pending.push(request);
      try{await this.save();logEvent('request.saved',{requestId:request.id});}catch(e){this.settings.pending=this.settings.pending.filter(r=>r!==request);throw e;}
      await this.dispatch(request);
      const draft=this.app.loadLocalStorage(this.chatDraftKey);
      if(typeof draft==='string'&&draft&&(draft===prompt||[THREAD_REPLY_INSTRUCTION,INLINE_REPLY_INSTRUCTION].some(instruction=>prompt===`${draft}\n\n${instruction}`||prompt.endsWith(`\n\nQuestion:\n${draft}\n\n${instruction}`))))this.app.saveLocalStorage(this.chatDraftKey,'');
    }catch(e){if(request)await this.failRequest(request,e,'preparation',startedAt);else if(!(e instanceof ProjectCreationCancelled))this.recordSendFailure(undefined,e,'preparation',startedAt);if(e instanceof ProjectCreationCancelled)throw e;throw new RequestDeliveryError(`${unsavedMessage(e)} ${request?'The send failed. Its response was removed. See the send failure log.':'No message was sent or queued.'}`,false,Boolean(request));}
    finally{this.busy=false;}
  }
  async exportDiagnostics(){
    const modal=new Modal(this.app);modal.titleEl.setText('Send failure log');
    const log=sendFailureLog(this.app.loadLocalStorage(this.failureKey()),pluginManifest.version,this.deviceId);
    modal.contentEl.createEl('p',{text:'The last 64 send failures on this device. Message text and credentials are excluded.'});
    const field=modal.contentEl.createEl('textarea');field.readOnly=true;field.value=JSON.stringify(log,null,2);field.style.width='100%';field.style.height='320px';
    new Setting(modal.contentEl).addButton(button=>button.setButtonText('Copy log').onClick(()=>{field.select();document.execCommand('copy');}));modal.open();
  }

  projects(){
    if(this.mode==='desktop')return this.settings.projects;
    const catalog=new Map<string,{project:Project;score:number}>();
    for(const project of this.settings.directProjects){
      const c=this.settings.paired.find(c=>c.id===project.connectionId);
      const key=JSON.stringify([c?.environmentId??project.connectionId,project.id]);
      const score=(this.projectDiscovery?.status(this.sourceKey(c))==='available'?4:0)+(this.cloudMachines.some(m=>m.environmentId===c?.environmentId&&m.url===c.url)?2:0);
      if(!catalog.has(key)||score>catalog.get(key)!.score)catalog.set(key,{project,score});
    }
    return [...catalog.values()].map(entry=>entry.project);
  }
  connection(project:Project):Connection {if(project.connectionId){const c=this.settings.paired.find(c=>c.id===project.connectionId);if(!c)throw Error('Pair a T3 connection in settings first.');return {transport:'direct',url:c.url,connectionId:c.id,environmentId:c.environmentId,host:'direct',executable:''};}return {...this.settings.connection,host:'local',transport:'desktop'};}
  async pairConnection(name:string,address:string,code:string,expectedEnvironmentId?:string){
    const result=await pair(address,code,undefined,expectedEnvironmentId);
    const existing=this.settings.paired.find(c=>c.environmentId===result.descriptor.environmentId&&c.url===result.session.url);
    const c:PairedConnection=existing??{id:randomId(),name:name.trim()||result.descriptor.label,url:result.session.url,environmentId:result.descriptor.environmentId};
    if(!existing)this.settings.paired.push(c);
    this.pairedSessions[c.id]=result.session;this.settings.directScanId=c.id;this.mode='direct';await this.save();
    this.syncProjectSources();await this.projectDiscovery?.refresh(true);
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
  async sessionFor(id:string,forceRefresh=false):Promise<PairedSession|undefined>{
    const session=this.pairedSessions[id];const c=this.settings.paired.find(c=>c.id===id);
    if(session?.accountId&&session.accountId!==this.nativeAccount?.userId)throw Error('Sign in to the T3 account that owns this connection.');
    // Pre-v2 account sessions requested only the two orchestration scopes.
    // Refresh them before any remote vault check; token expiry is not enough.
    if(session&&session.expiresAt>Date.now()+60000&&!forceRefresh&&(!c?.managed||hasPluginPermissions(session)))return session;
    if(!c?.managed||!this.nativeAccount)return session;
    const existing=this.sessionRefreshing.get(id);if(existing)return existing;
    const account=this.nativeAccount;const generation=this.cloudGeneration;
    const work=(async()=>{
      const credential=await this.nativeCredential();const machines=await discoverMachines(credential);
      const m=machines.find(m=>m.environmentId===c.environmentId&&m.url===c.url);
      if(!m)throw Error('This T3 connection is no longer available to your account. Reconnect its machine.');
      const next=await connectMachine(await this.nativeCredential(),m,this.deviceId+':'+account.userId);
      if(this.stopped||this.nativeAccount!==account||generation!==this.cloudGeneration||!this.settings.paired.includes(c))throw Error('Connection cancelled.');
      next.accountId=account.userId;this.pairedSessions[id]=next;await this.save();return next;
    })();this.sessionRefreshing.set(id,work);try{return await work;}finally{if(this.sessionRefreshing.get(id)===work)this.sessionRefreshing.delete(id);}
  }
  async connectAccountMachine(m:CloudMachine,candidate?:PairedConnection){
    const account=this.nativeAccount;if(!account)throw Error('Sign in with your T3 email first.');const generation=this.cloudGeneration;
    const existing=this.settings.paired.find(c=>c.environmentId===m.environmentId&&c.url===m.url);
    const c=existing??candidate??{id:randomId(),name:m.name,url:m.url,environmentId:m.environmentId};
    const active=()=>!this.stopped&&this.nativeAccount===account&&generation===this.cloudGeneration&&(!existing||this.settings.paired.includes(existing))&&(!candidate||this.accountCandidates.get(this.machineKey(m))===candidate||this.settings.paired.includes(candidate));
    const session=await connectMachine(await this.nativeCredential(),m,this.deviceId+':'+account.userId);
    if(!active())throw Error('Connection cancelled.');
    const changed=!existing||!c.managed||c.name!==m.name;
    if(!this.settings.paired.includes(c))this.settings.paired.push(c);
    c.managed=true;c.name=m.name;session.accountId=account.userId;this.pairedSessions[c.id]=session;
    if(changed)await this.save();else await this.saveDeviceState();
    return c;
  }
  async startCloudLogin(){
    this.cancelCloudLogin();const generation=this.cloudGeneration;this.cloudError='';
    const login=await beginLogin();if(this.stopped||generation!==this.cloudGeneration)return;
    this.cloudLogin=login;this.cloudChanged?.();this.scheduleCloudPoll();
  }
  cancelCloudLogin(){this.projectDiscovery?.invalidate();this.cloudGeneration++;this.refreshRun++;this.connecting=false;if(this.cloudTimer)clearTimeout(this.cloudTimer);this.cloudLogin=null;this.emailLogin=null;this.cloudChanged?.();}
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
  private machineKey(m:{environmentId:string;url:string}){return JSON.stringify([m.environmentId,m.url]);}
  private sourceKey(c?:PairedConnection){return c?JSON.stringify(['remote',c.id,c.environmentId,c.url]):JSON.stringify(['local',this.settings.connection.executable,this.settings.connection.baseDir??'']);}
  private async initializeProjectCatalog(){
    const scope=`project-catalog:${this.deviceId}:${this.settings.vaultId}:${this.nativeAccount?.userId??this.cloudAccount?.identity??'manual'}`;
    if(this.projectDiscovery&&scope===this.catalogScope)return;
    this.projectDiscovery?.dispose();this.catalogScope=scope;
    const seedLocal=this.settings.projects,seedDirect=this.settings.directProjects;
    const discovery=new ProjectDiscovery(async snapshots=>{await deviceState(scope,snapshots);},()=>{this.publishProjectCatalog();});
    this.projectDiscovery=discovery;
    const saved=await deviceState(scope);
    if(this.stopped||this.projectDiscovery!==discovery)return;
    if(Array.isArray(saved))discovery.restore(saved as ProjectSnapshot[]);
    else {
      discovery.replace(this.sourceKey(),seedLocal);
      for(const c of this.settings.paired)discovery.replace(this.sourceKey(c),seedDirect.filter(p=>p.connectionId===c.id));
      await discovery.save();
    }
    this.syncProjectSources();this.publishProjectCatalog();
  }
  private publishProjectCatalog(){
    if(!this.projectDiscovery)return;
    const projects=this.projectDiscovery.all();
    this.settings.directProjects=projects.filter(p=>!!p.connectionId);this.settings.projects=projects.filter(p=>!p.connectionId);
    for(const listener of this.projectListeners)listener();if(this.nativeAccount)this.cloudChanged?.();
  }
  watchProjects(listener:()=>void){this.projectListeners.add(listener);return ()=>{this.projectListeners.delete(listener);};}
  projectChoiceLabel(project:Project){
    const c=project.connectionId?this.settings.paired.find(c=>c.id===project.connectionId):undefined;
    const status=this.projectDiscovery?.status(this.sourceKey(c));
    return projectLabel(project)+(status==='offline'?' · Offline (cached)':status==='unverified'||status==='checking'?' · Cached; checking connection':'');
  }
  private syncProjectSources(){
    if(!this.projectDiscovery)return;
    const generation=this.cloudGeneration;
    const connections=new Map([...this.accountCandidates.values(),...this.settings.paired].map(c=>[c.id,c]));
    const sources:ProjectSource[]=[{key:this.sourceKey(),enabled:!Platform.isMobile&&this.mode==='desktop',read:async()=>{
      const result=await runBridge({...this.settings.connection,host:'local',transport:'desktop'},['projects']);
      if(result.cached)throw Error(result.warning??'Local T3 is offline.');return parseProjects(result);
    }}];
    for(const c of connections.values())sources.push({key:this.sourceKey(c),enabled:this.mode==='direct',read:async()=>{
      const active=()=>!this.stopped&&generation===this.cloudGeneration&&(this.settings.paired.includes(c)||this.accountCandidates.get(this.machineKey(c))===c);
      if(!active())throw Error('Connection cancelled.');
      const m=this.cloudMachines.find(m=>m.environmentId===c.environmentId&&m.url===c.url);
      let session:PairedSession|undefined=this.pairedSessions[c.id];
      if(m&&this.nativeAccount&&(!session||session.expiresAt<=Date.now()+60_000||session.accountId!==this.nativeAccount.userId)){
        await this.connectAccountMachine(m,c);session=this.pairedSessions[c.id];
      }else session=await this.sessionFor(c.id);
      if(!active())throw Error('Connection cancelled.');
      const projects=parseProjects(await readDirect({transport:'direct',host:'direct',executable:'',url:c.url,environmentId:c.environmentId,connectionId:c.id},['projects'],session));
      if(!active())throw Error('Connection cancelled.');
      return projects.map(p=>({...p,connectionId:c.id,connectionName:c.name}));
    }});
    this.projectDiscovery.setSources(sources);
  }
  private rememberProjectViews(){
    if(!this.projectDiscovery)return;
    const local=this.settings.projects,direct=this.settings.directProjects;
    let changed=this.projectDiscovery.replace(this.sourceKey(),local);
    for(const c of this.settings.paired)changed=this.projectDiscovery.replace(this.sourceKey(c),direct.filter(p=>p.connectionId===c.id))||changed;
    if(changed)void this.projectDiscovery.save().catch(error=>{this.cloudError=`Project cache: ${message(error)}`;});
  }
  private refreshProjectsInBackground(force=false){
    if(this.stopped)return;
    this.syncProjectSources();
    void this.refreshMachines(force).catch(error=>{this.cloudError=message(error);this.cloudChanged?.();});
  }
  async refreshMachines(force=true){
    if(this.machineRefreshing)return this.machineRefreshing;
    if(!force&&this.projectDiscovery&&!this.projectDiscovery.due()&&(!(this.nativeAccount||this.cloudAccount)||Date.now()<this.registryNextAttempt))return;
    const generation=this.cloudGeneration;const run=++this.refreshRun;this.connecting=true;if(this.nativeAccount||this.cloudAccount)this.cloudChanged?.();
    const work=(async()=>{try{
      await this.initializeProjectCatalog();if(generation!==this.cloudGeneration||this.stopped)return;
      if((this.nativeAccount||this.cloudAccount)&&(force||Date.now()>=this.registryNextAttempt)){
        try{
          const list=await discoverMachines(this.nativeAccount?await this.nativeCredential():await this.currentCloudAccount());
          if(generation!==this.cloudGeneration||this.stopped)return;
          this.cloudMachines=list;this.registryFailures=0;this.registryNextAttempt=Date.now()+300_000;this.cloudError='';this.connectionSyncComplete=true;
          this.accountCandidates.clear();
          if(this.nativeAccount)for(const m of list){const c=this.settings.paired.find(c=>c.environmentId===m.environmentId&&c.url===m.url)??{id:randomId(),name:m.name,url:m.url,environmentId:m.environmentId};this.accountCandidates.set(this.machineKey(m),c);}
        }catch(error){if(generation!==this.cloudGeneration||this.stopped)return;this.cloudError=message(error);this.registryNextAttempt=Date.now()+Math.min(300_000,15_000*2**Math.min(this.registryFailures++,5));}
      }
      this.syncProjectSources();await this.projectDiscovery?.refresh(force);
      if(generation!==this.cloudGeneration||this.stopped)return;
      this.machineErrors={};for(const c of [...this.accountCandidates.values(),...this.settings.paired]){const error=this.projectDiscovery?.error(this.sourceKey(c));if(error)this.machineErrors[c.environmentId]=error;}
    }finally{if(run===this.refreshRun)this.connecting=false;if(generation===this.cloudGeneration&&(this.nativeAccount||this.cloudAccount))this.cloudChanged?.();}})();
    this.machineRefreshing=work;try{await work;}finally{if(this.machineRefreshing===work)this.machineRefreshing=undefined;}
  }
  directAccountReady(){
    if(!this.nativeAccount||this.connecting||!this.connectionSyncComplete||!this.cloudMachines.length)return false;
    return this.cloudMachines.some(machine=>!this.machineErrors[machine.environmentId]&&this.settings.paired.some(connection=>connection.managed&&connection.environmentId===machine.environmentId&&connection.url===machine.url));
  }
  async linkFolder(folder:TFolder,project:Project,self:boolean){
    new FolderLinkModal(this.app,this,folder,project,self).open();
  }
  async saveFolderLink(folder:TFolder,project:Project,self:boolean,verified?:FolderLink){
    if((folder.path==='/'?this.app.vault.getRoot():this.app.vault.getAbstractFileByPath(folder.path))!==folder)throw Error('This folder no longer exists. Choose a folder again.');
    const previous=this.settings.folderLinks;
    const existing=previous.find(link=>link.folderPath===folder.path&&link.projectId===project.id&&link.connectionId===(project.connectionId??''));
    this.settings.folderLinks=upsertFolderLink(previous,verified??{id:existing?.id??randomId(),folderPath:folder.path,connectionId:project.connectionId??'',projectId:project.id,projectTitle:project.title,workspaceRoot:project.workspaceRoot,self,environmentId:this.connection(project).environmentId??await this.localInlineEnvironment(),vaultId:this.settings.vaultId,...(existing?.replyFolders?{replyFolders:existing.replyFolders}:{})});
    try{await this.save();this.refreshFolderIndicators();}catch(error){this.settings.folderLinks=previous;this.refreshFolderIndicators();throw error;}
    new Notice(`${folder.path} linked to ${projectLabel(project)}.`);
  }
  private async updateCodebaseProjectLinks(scope:import('./codebase-core').CodebaseScope,change:{title?:string;deleted?:boolean}){
    if(!this.eventLocalEnvironmentId&&!Platform.isMobile)this.eventLocalEnvironmentId=await this.localInlineEnvironment();
    const previous=this.settings.folderLinks;
    this.settings.folderLinks=changeCodebaseProjectLinks(previous,scope,change,link=>link.environmentId??this.settings.paired.find(c=>c.id===link.connectionId)?.environmentId??(!link.connectionId||link.connectionId==='local'?this.eventLocalEnvironmentId:undefined));
    try{await this.save();this.refreshFolderIndicators();this.refreshProjectsInBackground(true);}catch(error){this.settings.folderLinks=previous;this.refreshFolderIndicators();throw Error('The project changed in T3, but its folder links could not be saved. The link update will be tried again after reload.');}
  }
  async unlinkFolder(path:string){
    const previous=this.settings.folderLinks;
    this.settings.folderLinks=previous.filter(link=>link.folderPath!==path);
    try{await this.save();this.refreshFolderIndicators();}catch(error){this.settings.folderLinks=previous;this.refreshFolderIndicators();throw error;}
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
  private pickFolderProject(folderPath:string,name:string,onChosen?:(project:Project)=>Promise<void>):Promise<Project|undefined>{
    if(this.projectCreateModal)throw Error('Choose or cancel the open project workspace first.');
    return new Promise(resolve=>{
      this.projectCreateModal=new ProjectCreateModal(this.app,name,{
        machines:()=>this.vaultMachines(),connect:machine=>this.projectLocation(machine),
        configure:el=>{el.createEl('p',{text:'Project files remain in the T3 workspace and appear in Codebase view.'});},
        link:async project=>{if(this.stopped)throw Error('The plugin was disabled before creating the project.');await onChosen?.(project);resolve(project);},
        closed:()=>{this.projectCreateModal=undefined;resolve(undefined);},
      });
      this.projectCreateModal.open();
    });
  }
  async createFolderProject(folder:TFolder){
    await this.pickFolderProject(folder.path,folder.path==='/'?this.app.vault.getName():folder.name,async project=>{
      if(project.connectionId)this.settings.directProjects=[...this.settings.directProjects.filter(p=>projectKey(p)!==projectKey(project)),project];
      else this.settings.projects=[...this.settings.projects.filter(p=>p.id!==project.id),project];
      await this.saveFolderLink(folder,project,false);
    });
  }
  private checkProjectWorkspace(machine:VaultMachine,path:string){
    const c=this.settings.paired.find(c=>c.id===machine.id||'environment:'+c.environmentId===machine.id);
    const roots=this.settings.vaultLocations.filter(location=>location.environmentId===c?.environmentId).map(location=>location.workspaceRoot);
    roots.push(...this.settings.folderLinks.filter(link=>link.folderPath==='/'&&(machine.local?!link.connectionId:link.connectionId===c?.id||!!c&&link.environmentId===c.environmentId)).map(link=>link.workspaceRoot));
    if(machine.local){const adapter=this.app.vault.adapter as {getFullPath?:(path:string)=>string};if(adapter.getFullPath)roots.push(adapter.getFullPath(''));}
    if(roots.some(root=>workspaceInsideVault(path,root)))throw Error('Choose a workspace outside the Obsidian vault.');
  }
  async projectLocation(machine:VaultMachine):Promise<ProjectLocation>{
    if(machine.local){
      const desktop=await import('./desktop');
      const connection={...this.settings.connection,host:'local',transport:'desktop' as const};
      const createdFolders=new Set<string>();
      return {
        browse:desktop.browseDesktopFolder,
        create:async(root,title,newFolder)=>{
          if(newFolder&&!sameWorkspacePath(root,workspaceChildPath(newFolder.parentPath,newFolder.name)))throw Error('The new workspace folder does not match its parent.');
          this.checkProjectWorkspace(machine,root);
          let project=parseProjects(await runBridge(connection,['projects'])).find(p=>sameWorkspacePath(p.workspaceRoot,root));
          if(newFolder&&!project&&!createdFolders.has(root)){
            const parent=(await desktop.browseDesktopFolder(newFolder.parentPath)).parentPath;
            const canonical=workspaceChildPath(parent,newFolder.name);
            if(!sameWorkspacePath(root,canonical))throw Error('The parent folder changed. Choose the new folder again.');
            this.checkProjectWorkspace(machine,canonical);
            await desktop.createDesktopFolder(parent,newFolder.name);createdFolders.add(root);
          }
          if(!project){const id=await desktop.addDesktopProject(connection,root,title);project=parseProjects(await runBridge(connection,['projects'])).find(p=>p.id===id);}
          if(!project)throw Error('T3 created the project, but discovery has not returned it yet. Try again.');
          return project;
        },close:()=>{},
      };
    }
    if(machine.id.startsWith('environment:')){const cloud=this.cloudMachines.find(m=>'environment:'+m.environmentId===machine.id);if(cloud)await this.connectAccountMachine(cloud);}
    const c=this.settings.paired.find(c=>c.id===machine.id||'environment:'+c.environmentId===machine.id);
    if(!c)throw Error('This machine connection changed. Open the dialog again.');
    const remote=await connectVaultRemote({transport:'direct',host:'direct',executable:'',url:c.url,environmentId:c.environmentId,connectionId:c.id},await this.sessionFor(c.id));
    return {browse:path=>remote.browse(path),close:()=>remote.close(),create:async(root,title,newFolder)=>{
      this.checkProjectWorkspace(machine,root);
      const proposed=vaultRegistration(c.environmentId,root,this.settings.vaultId+':workspace',title);
      const registration=this.vaultRegistrations[proposed.commandId]??proposed;
      this.vaultRegistrations[proposed.commandId]=registration;await this.save();
      return {...await remote.ensureProject(registration,newFolder),connectionId:c.id,connectionName:c.name};
    }};
  }
  async signOutCloud(){
    const old=this.nativeAccount;this.cancelCloudLogin();this.nativeAccount=null;this.nativeToken=undefined;this.nativeRefreshing=undefined;this.sessionRefreshing.clear();
    for(const [id,s] of Object.entries(this.pairedSessions))if(s.accountId)delete this.pairedSessions[id];
    this.cloudAccount=null;this.cloudMachines=[];this.accountCandidates.clear();this.registryNextAttempt=0;this.cloudError='';this.machineErrors={};this.connectionSyncComplete=false;this.machineRefreshing=undefined;this.cloudRefreshing=undefined;await this.initializeProjectCatalog();await this.save();this.cloudChanged?.();
    if(old)try{await revokeNativeAccount(old,nativeAccountFetch);}catch{new Notice('Signed out on this device. T3 could not be reached to revoke the account session; you can revoke it in your T3 account.');}
  }
  async forgetPairing(id:string){delete this.pairedSessions[id];this.projectDiscovery?.invalidate();await this.save();this.refreshProjectsInBackground(true);}
  async removeConnection(id:string){
    if(this.settings.pending.some(r=>r.connection.connectionId===id)||this.settings.completionJobs.some(j=>j.connection.connectionId===id&&j.status==='watching')||this.settings.settlementJobs.some(j=>j.connection.connectionId===id))throw Error('This connection has an unconfirmed request or completion check. Resolve or stop it before removing the connection.');
    this.projectDiscovery?.invalidate();for(const [key,c] of this.accountCandidates)if(c.id===id)this.accountCandidates.delete(key);
    this.settings.paired=this.settings.paired.filter(c=>c.id!==id);this.settings.directProjects=this.settings.directProjects.filter(p=>p.connectionId!==id);this.settings.directSelected=this.settings.directSelected.filter(k=>!k.startsWith(id+':'));delete this.pairedSessions[id];if(this.settings.directScanId===id)this.settings.directScanId=this.settings.paired[0]?.id??'';this.syncProjectSources();await this.save();
  }
  private saveDeviceState(state?:unknown) {
    this.app.saveLocalStorage(this.localKey,JSON.parse(JSON.stringify({deviceId:this.deviceId,mode:this.mode,connection:this.settings.connection,pairedSessions:this.pairedSessions,cloudAccount:this.cloudAccount,nativeAccount:this.nativeAccount,vaultRegistrations:this.vaultRegistrations})));
    return deviceState(this.deviceId,state??JSON.parse(JSON.stringify({pending:this.settings.pending,completionJobs:this.settings.completionJobs,settlementJobs:this.settings.settlementJobs})));
  }
  private sharedSnapshot(){const {pending,completionJobs,settlementJobs,connection,projects,directProjects,selected,directSelected,directScanId,...shared}=this.settings;return JSON.parse(JSON.stringify(shared));}
  private sharedData(data:any){
    return {...this.sharedSnapshot(),codebase:data?.codebase,replyFolders:loadReplyFolders(data?.replyFolders),threadTitleGeneration:threadTitleGeneration(data?.threadTitleGeneration),paired:data?.paired??[],folderLinks:loadFolderLinks(data),folderLinkChanges:loadFolderLinkChanges(data?.folderLinkChanges),noteThreads:loadNoteThreads(data?.noteThreads),vaultId:vaultIdentity(data)??this.settings.vaultId,vaultLocations:loadVaultLocations(data),autoSettleThreads:data?.autoSettleThreads!==false,
      orchestration:{waitForOtherThreads:data?.orchestration?.waitForOtherThreads===true},
      inlineStreaming:{finalAnswerFormat:finalAnswerFormat(data?.inlineStreaming?.finalAnswerFormat),enabled:data?.inlineStreaming?.enabled??(data?.inlineStreaming?.askT3!==false&&data?.inlineStreaming?.sendToT3!==false),keepIntermediate:data?.inlineStreaming?.keepIntermediate===true,...(data?.inlineStreaming?.intermediateMode?{intermediateMode:intermediateMode(data.inlineStreaming.intermediateMode,data.inlineStreaming.keepIntermediate)}:{})},
      completion:{action:['archive','delete'].includes(data?.completion?.action)?data.completion.action:'keep',archiveFolder:data?.completion?.archiveFolder??'Archive/T3 Code'}};
  }
  save(forceShared=false) {
    this.rememberProjectViews();
    this.refreshFolderIndicators();
    const {pending,completionJobs,settlementJobs,connection}=this.settings,intended=this.sharedSnapshot(),intendedThreads=JSON.stringify(this.settings.noteThreads),intendedLinks=JSON.stringify(this.settings.folderLinks);
    const baseline=JSON.parse(this.queuedSharedSnapshot??this.sharedBaseline) as Settings;
    let snapshot=intended;
    const changes=changedFolderLinks(loadFolderLinks(baseline),snapshot.folderLinks,mergeFolderLinkChanges(this.folderLinkReplica,snapshot.folderLinkChanges),randomId,Math.max(Date.now(),this.folderLinkClock+1));
    if(changes.length)this.folderLinkClock=Date.parse(changes[0].at);
    snapshot.folderLinkChanges=mergeFolderLinkChanges(snapshot.folderLinkChanges,changes);
    const writeShared=forceShared||JSON.stringify(snapshot)!==JSON.stringify(baseline);
    if(writeShared)this.queuedSharedSnapshot=JSON.stringify(snapshot);
    const state=JSON.parse(JSON.stringify({pending,completionJobs,settlementJobs}));
    this.app.saveLocalStorage(this.localKey,JSON.parse(JSON.stringify({deviceId:this.deviceId,mode:this.mode,connection,pairedSessions:this.pairedSessions,cloudAccount:this.cloudAccount,nativeAccount:this.nativeAccount,vaultRegistrations:this.vaultRegistrations})));
    this.saving=this.saving.catch(()=>{}).then(async()=>{
      await deviceState(this.deviceId,state);
      if(!writeShared)return;
      const current=await this.loadData();
      snapshot=mergeSharedSettings(baseline,this.sharedData(current),intended);
      snapshot.folderLinkChanges=mergeFolderLinkChanges(this.folderLinkReplica,loadFolderLinkChanges(current?.folderLinkChanges),intended.folderLinkChanges);
      snapshot.folderLinks=applyFolderLinkChanges(mergeLegacyFolderLinks(loadFolderLinks(baseline),loadFolderLinks(current),intended.folderLinks),snapshot.folderLinkChanges);
      snapshot.noteThreads=mergeNoteThreads(loadNoteThreads(current?.noteThreads),intended.noteThreads);
      await this.saveData(snapshot);
      this.folderLinkReplica=snapshot.folderLinkChanges;
      await deviceState(`folder-links:${this.deviceId}:${this.settings.vaultId}`,this.folderLinkReplica);
      this.settings.folderLinkChanges=this.folderLinkReplica;
      if(JSON.stringify(this.settings.folderLinks)===intendedLinks)this.settings.folderLinks=snapshot.folderLinks;
      this.refreshFolderIndicators();
      this.lastDiskSnapshot=JSON.stringify(snapshot);
      if(JSON.stringify(this.settings.noteThreads)===intendedThreads)this.settings.noteThreads=snapshot.noteThreads;
      for(const key of ['inlineStreaming','orchestration','completion','threadTitleGeneration','autoSettleThreads','paired','vaultLocations','codebase'] as const)if(JSON.stringify(this.settings[key])===JSON.stringify(intended[key]))(this.settings as any)[key]=snapshot[key];
      this.codebase?.adopt(this.settings.codebase);
      this.sharedBaseline=JSON.stringify(snapshot);
    });
    const work=this.saving;void work.finally(()=>{if(this.saving===work)this.queuedSharedSnapshot=undefined;}).catch(()=>{});return work;
  }
  async send(file:TFile, project:Project, options?:{id?:string;quiet?:boolean;throwOnError?:boolean;threadId?:string;newThread?:boolean;projectOverrideKey?:string;folderPicker?:boolean;folderLink?:FolderLink;prepared?:PreparedNote;streamReply?:boolean;jobOptions?:ResolvedJobOptions;destinations?:string[];destinationSection?:string;onPrepared?:(request:Request)=>Promise<void>}) {
    if (this.busy) {if(options?.throwOnError)throw Error('Obsidian is sending another request. Retry shortly.');return;}
    this.busy = true;
    const startedAt=Date.now();let request:Request|undefined;
    const orchestration = {...this.settings.orchestration};
    const completion = {...this.settings.completion};
    try {
      const savedThread=this.noteThread(file.path);
      const remembered=!options?.newThread&&!options?.threadId&&!options?.folderPicker&&(!options?.projectOverrideKey||savedThread&&`${savedThread.connectionId?savedThread.connectionId+':':''}${savedThread.projectId}`===options.projectOverrideKey)?savedThread:undefined;
      const historical=options?.threadId&&!options.folderPicker&&!options.projectOverrideKey?this.previousNoteThread(file.path,options.threadId):undefined;
      if(remembered||historical)project=this.projectForNoteThread((historical??remembered)!);
      const threadId=options?.threadId??remembered?.threadId;
      const connection=this.connection(project);
      const jobOptions=options?.jobOptions??resolveJobOptions({...this.settings.inlineStreaming,enabled:options?.streamReply??(!options?.quiet&&this.settings.inlineStreaming.enabled)});
      const streaming=jobOptions.inline.enabled;
      const inlineView=streaming?await this.editorForNoteSend(file):undefined;
      if(options?.streamReply===true&&!inlineView)throw Error('A Markdown editor is required to prepare this streaming send.');
      const content = inlineView?this.notePromptDocument(inlineView):await this.app.vault.read(file);
      if (!content.trim()) {if(options?.throwOnError)throw Error('This note is empty. Add Markdown before sending.');new Notice('This note is empty. Add Markdown before sending.'); return;}
      if(!options?.quiet)new Notice('Preparing note and embedded images…');
      if(options?.prepared&&options.prepared.content!==content)throw Error('The note changed while preparing its project. Try again with the current text.');
      const images = options?.prepared?.images??await this.prepareImages(content,file.path);
      if(inlineView&&this.notePromptDocument(inlineView)!==content)throw Error('The note changed while preparing the send. Try again with the current text.');
      const note=this.noteContext(file),link=options?.folderLink??folderLinkForPath(this.settings.folderLinks,file.path)??{id:'manual',folderPath:'/',connectionId:project.connectionId??'',projectId:project.id,projectTitle:project.title,workspaceRoot:project.workspaceRoot,self:true};
      const destination=this.destinationNotePath(note,project,link)??note.absolutePath??'(unmapped on destination)';
      request = {jobOptions,id:options?.id??randomId(),project:{...project},title:await this.requestTitle(connection,project,threadId,file.path),prompt:applyOrchestration(images.markdown+(inlineView?`\n\n${INLINE_REPLY_INSTRUCTION}`:'')+this.messageFooter(destination),orchestration),attachments:images.attachments,context:images.context,...(threadId?{threadId}:{}),completion:{notePath:file.path,contentHash:contentHash(content),ctime:file.stat.ctime,...completion,action:'keep'},connection,noteThread:this.noteThreadIntent(file.path,project,connection),...this.folderLinkIntent(link)};
      if(request.prompt.length>120_000) throw new Error('The note and image context exceed T3’s 120,000-character limit. Split the note before sending.');
      if(streaming&&inlineView)await this.prepareStreamBindings(request,options?.destinations?.length?options.destinations:[file.path],undefined,options?.destinationSection);
      await options?.onPrepared?.(request);
      this.settings.pending.push(request); await this.save();
      const sentThreadId=await this.dispatch(request,options?.quiet);
      return {threadId:sentThreadId,request};
    } catch(e) {if(request)await this.failRequest(request,e,'preparation',startedAt);else this.recordSendFailure(undefined,e,'preparation',startedAt);const detail=`${unsavedMessage(e)} The send failed. See the send failure log.`;if(options?.throwOnError)throw new RequestDeliveryError(detail,false,Boolean(request));new Notice(`Send to T3 Code: ${detail}`,12000);}
    finally {this.busy = false;}
  }
  private async prepareStreamBindings(request:Request,destinations:string[],startedAt?:string,destinationSection?:string,sourcePath?:string){
    const policy=request.jobOptions?.inline??resolveJobOptions(this.settings.inlineStreaming).inline;
    const io=deviceNoteIO(this.app),host=await this.localResponseTarget(request);
    for(const path of destinations){const document=await io.readNote(path);if(document===undefined)throw Error(`Destination note unavailable: ${path}`);endInsertionOffset(document);}
    const source:HostedInlineRequest={destinationSection,localOnly:true,nativeProjection:true,responseContainer:true,version:4,finalAnswerFormat:policy.finalAnswerFormat,independent:true,threadTitle:request.title,id:request.id,initialOwner:this.inlineActor,vaultId:this.settings.vaultId,host,notePath:destinations[0],threadId:request.threadId??commandId(request.id,'thread'),messageId:commandId(request.id,'message'),projectId:request.project.id,threadEnvironmentId:request.connection.environmentId??await this.localInlineEnvironment(),initialHash:initialRegion(request.id).bodyHash,createdAt:startedAt??new Date().toISOString(),keepIntermediate:policy.intermediateMode!=='remove',intermediateMode:policy.intermediateMode};
    request.inlineBindings=[];this.rememberInlineTarget(host);
    for(const path of destinations)request.inlineBindings.push(await editorStream(source,path,io,()=>!this.stopped));
    request.inlineHost=request.inlineBindings[0];
    request.prompt+=stagedNoteInstruction(request.inlineBindings);if(request.prompt.length>120_000)throw Error('The note and staged-edit context exceed T3’s prompt limit.');
  }
  private async responseGuard(binding:HostedInlineRequest,status:'prepared'|'accepted'|'failed',uncertain=false){
    if(binding.localOnly)return;
    const opened=await this.inlineHostFiles(binding.host);
    try{if(status==='prepared')await prepareSendGuard(opened.files,binding);else await updateSendGuard(opened.files,binding,status,uncertain);}finally{opened.close();}
  }
  private persistAgentCommand(request:Request,threadId?:string){
    const command=request.agentCommand;if(!command)return;
    const result:NoteCommandResult|undefined=threadId?{id:command.id,ok:true,threadId,messageId:commandId(request.id,'message'),bindingIds:request.inlineBindings?.map(binding=>binding.id)??[]}:undefined;
    this.app.saveLocalStorage(`${this.localKey}-note-command-${command.id}`,JSON.parse(JSON.stringify(result?{command,result}:{command,request})));
  }
  private compactNoteCommandReceipts(){
    // Obsidian prefixes these keys by vault. Resolve through its API so another
    // vault's records are never read or changed. Pending payloads stay intact.
    try{
      for(let i=0;i<window.localStorage.length;i++){
        const id=/send-to-t3-code-device-v1-note-command-([0-9a-f-]{36})$/i.exec(window.localStorage.key(i)??'')?.[1];
        if(!id)continue;
        const key=`${this.localKey}-note-command-${id}`,stored=this.app.loadLocalStorage(key);
        if(stored?.command&&(stored.result||stored.discarded))this.app.saveLocalStorage(key,{command:stored.command,...(stored.result?{result:stored.result}:{discarded:true})});
      }
    }catch{/* Storage unavailable: terminal records compact on their next replay. */}
  }
  /** Agent and palette entry point; durable prepared sends replay the same bytes. */
  async executeNoteCommand(input:NoteCommand):Promise<NoteCommandResult>{
    const command=validateNoteCommand(input);
    if(this.stopped||this.busy)throw Error('Obsidian is unavailable or sending another request.');
    const key=`${this.localKey}-note-command-${command.id}`,stored=this.app.loadLocalStorage(key) as {command?:NoteCommand;request?:Request;result?:NoteCommandResult;discarded?:boolean}|undefined;
    if(stored?.command&&JSON.stringify(stored.command)!==JSON.stringify(command))throw Error('This command ID already belongs to different input.');
    if(stored?.discarded)throw Error('This send failed and cannot be retried. Check its original T3 thread and the send failure log.');
    if(stored?.result){this.app.saveLocalStorage(key,{command,result:stored.result});return stored.result;}
    const persist=(value:{request?:Request;result?:NoteCommandResult})=>this.app.saveLocalStorage(key,JSON.parse(JSON.stringify(value.result?{command,result:value.result}:{command,...value})));
    let request=stored?.request,threadId:string;
    if(command.kind==='attach-response'){
      const file=this.app.vault.getFileByPath(command.notePath);if(!file)throw Error('Source note not found.');
      if(!request){
        const {project}=await this.chatTarget(file.path,undefined,true,undefined,false);
        const thread=await runBridge(this.connection(project),['read',command.threadId!]);
        if(thread.id!==command.threadId||thread.projectId!==project.id||!thread.messages?.some((item:any)=>item.role==='user'&&item.id===command.messageId))throw Error('The source response is not in this note’s linked T3 project.');
        request={id:command.id,project,connection:this.connection(project),title:thread.title??'T3 response',prompt:'',threadId:command.threadId};
        await this.prepareStreamBindings(request,command.destinations.length?command.destinations:[command.notePath],thread.messages.find((item:any)=>item.role==='user'&&item.id===command.messageId)?.createdAt,command.destinationSection,command.notePath);
        for(const binding of request.inlineBindings!)binding.messageId=command.messageId!;
        persist({request});
      }
      for(const binding of request.inlineBindings!){if(!this.deviceInline)throw Error('Streaming is unavailable.');await this.deviceInline.register(binding);}
      threadId=command.threadId!;
    }else if(request){
      request=this.settings.pending.find(item=>item.id===request!.id)??request;
      this.busy=true;
      try{if(!this.settings.pending.some(item=>item.id===request!.id)){this.settings.pending.push(request);await this.save();}threadId=await this.dispatch(request,true);}finally{this.busy=false;}
    }else{
      const file=this.app.vault.getFileByPath(command.notePath);if(!file)throw Error('Source note not found.');
      const {project,link}=await this.chatTarget(file.path,undefined,true,undefined,false);
      const sent=await this.send(file,project,{id:command.id,newThread:!command.threadId,threadId:command.threadId,folderLink:link,throwOnError:true,streamReply:command.streamReply,destinations:command.destinations,destinationSection:command.destinationSection,onPrepared:async prepared=>{prepared.agentCommand=command;request=prepared;persist({request:prepared});}});
      if(!sent)throw Error('The note was not sent.');threadId=sent.threadId;request=sent.request;
    }
    const result:NoteCommandResult={id:command.id,ok:true,threadId,messageId:command.kind==='attach-response'?command.messageId:commandId(command.id,'message'),bindingIds:request?.inlineBindings?.map(binding=>binding.id)??[]};
    persist({request,result});return result;
  }
  private rememberSettlement(request:Request,threadId:string){
    this.settings.settlementJobs=this.settings.settlementJobs.filter(job=>job.threadId!==threadId||job.connection.environmentId!==request.connection.environmentId||job.connection.host!==request.connection.host);
    if(!this.settings.autoSettleThreads)return;
    const inlineJobId=request.inlineSteering?.jobId??request.inlineFollow?.jobId??(request.inlineHost||this.inlineChat?.find(request.id)?request.id:undefined);
    const inlineHost=request.inlineSteering?.host??request.inlineFollow?.host??request.inlineHost?.host;
    this.settings.settlementJobs.push({requestId:request.id,messageId:commandId(request.id,'message'),threadId,projectId:request.project.id,connection:{...request.connection},
      ...(request.inlineHost?.localOnly?{inlineLocal:true as const,inlineNotePath:request.inlineHost.notePath}:{}),...(inlineJobId?{inlineJobId:request.inlineHost?.id??inlineJobId}:{}),...(request.inlineBindings?{inlineBindings:request.inlineBindings.map(binding=>({id:binding.id,host:binding.host,notePath:binding.notePath}))}:{}),...(inlineHost?{inlineHost,inlineVersion:(request.inlineHost?.version??2) as 1|2|3}:{})});
  }
  rememberStarted(request:Request,threadId:string) {
    if(request.folderLinkIntent&&!this.settings.folderLinks.some(link=>link.folderPath===request.folderLinkIntent!.folderPath))this.settings.folderLinks=upsertFolderLink(this.settings.folderLinks,request.folderLinkIntent);
    const remembered=request.noteThread??request.noteLink; // Resume requests saved before the terminology change.
    if(remembered){
      const selectedAt=new Date().toISOString(),updatedAt=new Date(Math.max(Date.now(),...this.settings.noteThreads.map(entry=>Date.parse(entry.updatedAt??entry.deletedAt??entry.selectedAt)+1).filter(Number.isFinite))).toISOString();
      const entry:NoteThread={...remembered,threadId,selectedAt,updatedAt};
      this.settings.noteThreads=mergeNoteThreads(this.settings.noteThreads,[entry]);
    }
    if(request.completion){
      this.settings.completionJobs=this.settings.completionJobs.filter(j=>j.notePath!==request.completion!.notePath);
      if(request.completion.action!=='keep')this.settings.completionJobs.push({...request.completion,requestId:request.id,threadId,projectId:request.project.id,connection:{...request.connection},status:'watching'});
    }
    this.rememberSettlement(request,threadId);
  }
  async dispatch(request:Request,quiet=false) {
    const startedAt=Date.now();let stage='response-registration';
    logEvent('request.dispatch.started',{requestId:request.id,threadId:request.threadId,projectId:request.project.id,jobId:request.inlineSteering?.jobId,kind:request.inlineSteering?'steering':request.inlineFollow?'continuation':'send'});
    try{
    if(request.inlineSteering){
      const steering=request.inlineSteering;
      if(steering.input.messageId!==commandId(request.id,'message')||!request.threadId)throw Error('Invalid saved steering request.');
      if(steering.host){if(!this.deviceInline)throw Error('Response ownership is unavailable. Reload the plugin.');await this.deviceInline.steer(steering.host,steering.jobId,steering.input);}
      else {const job=this.inlineChat?.find(steering.jobId)??this.inlineChat?.steeringJob(steering.jobId,steering.input.messageId);if(!job||job.threadId!==request.threadId)throw Error('The original response is unavailable on this device.');this.inlineChat!.steer(job,steering.input);}
    }
    if(request.inlineSteering)logEvent('steering.reserved',{requestId:request.id,jobId:request.inlineSteering.jobId,messageId:request.inlineSteering.input.messageId,threadId:request.threadId});
    if(request.inlineFollow){
      const follow=request.inlineFollow;
      if(follow.messageId!==commandId(request.id,'message')||!request.threadId)throw Error('Invalid saved continuation request.');
      if(follow.host){if(!this.deviceInline)throw Error('Response ownership is unavailable. Reload the plugin.');await this.deviceInline.follow(follow.host,follow.jobId,follow.previousMessageId,follow.messageId,follow.notePath);}
      else {const job=this.inlineChat?.find(follow.jobId);if(!job||job.threadId!==request.threadId)throw Error('The original response is unavailable on this device.');this.inlineChat!.follow(job,follow.messageId);}
    }
    if(request.inlineHost&&[2,3,4].includes(request.inlineHost.version)){
      if(!this.deviceInline)throw Error('Response ownership is unavailable. Reload the plugin.');
      for(const binding of request.inlineBindings??[request.inlineHost])await this.deviceInline.register(binding);
    }else if(request.inlineHost){
      if(!quiet)new Notice('Handing the response to the vault project machine…');
      const opened=await this.inlineHostFiles(request.inlineHost.host);
      try{await handoffInline(opened.files,request.inlineHost,()=>!this.stopped);}finally{opened.close();}
    }
    if(!quiet)new Notice(`Working in ${projectLabel(request.project)}…`);
    stage='dispatch';const result=await sendRequest(request);
    for(const binding of request.inlineBindings??(request.inlineHost?[request.inlineHost]:[]))await this.responseGuard(binding,'accepted');
    stage='delivery-evidence';
    // Keep the acknowledged exact start even when the renderer/event feed
    // missed it. This is orchestration delivery, not a guessed provider turn.
    const delivery=request.directPlan?.delivery;
    if(delivery&&this.deviceInline){
      const bindings=request.inlineBindings??(request.inlineHost?[request.inlineHost]:[]);
      for(const binding of bindings)if([2,3,4].includes(binding.version))await this.deviceInline.delivered(binding.host,binding.id,delivery);
      if(request.inlineSteering?.host)await this.deviceInline.delivered(request.inlineSteering.host,request.inlineSteering.jobId,delivery);
      if(request.inlineFollow?.host)await this.deviceInline.delivered(request.inlineFollow.host,request.inlineFollow.jobId,delivery);
    }
    stage='local-confirmation';this.persistAgentCommand(request,result.threadId);
    logEvent('request.dispatch.acknowledged',{requestId:request.id,threadId:result.threadId,jobId:request.inlineSteering?.jobId,messageId:commandId(request.id,'message')});
    const before={jobs:this.settings.completionJobs,settlementJobs:this.settings.settlementJobs,pending:this.settings.pending,noteThreads:this.settings.noteThreads,folderLinks:this.settings.folderLinks};
    this.rememberStarted(request,result.threadId);
    this.settings.pending=this.settings.pending.filter(r=>r.id!==request.id);
    try{await this.save();}catch(e){this.settings.pending=before.pending;this.settings.completionJobs=before.jobs;this.settings.settlementJobs=before.settlementJobs;this.settings.noteThreads=before.noteThreads;this.settings.folderLinks=before.folderLinks;throw e;}
    if(!quiet)new Notice(`${request.threadId?'Sent to thread':'Thread created'} in ${projectLabel(request.project)}: ${result.threadId}`,12000);return result.threadId;
    }catch(error){
      logFailure('request.dispatch.failed',error,{requestId:request.id,threadId:request.threadId,jobId:request.inlineSteering?.jobId});await this.failRequest(request,error,stage,startedAt);
      const accepted=acceptedRequestThread(request);
      if(accepted){new Notice(`T3 received your message in thread ${accepted.slice(0,8)}. The local response needs recovery. See the send failure log.`,12000);return accepted;}
      throw error;
    }
  }
  onunload(){closeNoteTabPanel(this.app);this.dismissedCleanup.clear();this.connectionRecovery?.dispose();this.stopContentHash?.();this.codebase?.dispose();configureDiagnostics();this.stopped=true;this.projectDiscovery?.dispose();this.projectListeners.clear();this.projectCreateModal?.close();this.questionModal?.close();this.questions?.dispose();this.approvals?.dispose();this.noteCommandServer?.dispose();this.eventHostServer?.dispose();this.deviceInline?.dispose();this.inlineHostService?.dispose();this.mobileSelectionAction?.dispose();this.inlineChat?.dispose();nativeResponses(this.app).dispose();this.vaultSetupModal?.close();this.paletteChat?.dispose();this.folderIndicators?.dispose();this.eventSubscriptions?.stop();this.cancelCloudLogin();this.cloudChanged=undefined;}
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
            hasUnsavedChanges:(f,hash)=>this.app.workspace.getLeavesOfType('markdown').some(leaf=>leaf.view instanceof MarkdownView && leaf.view.file?.path===f.path && contentHash(nativeResponses(this.app).view(leaf.view)?.saved()??leaf.view.editor.getValue())!==hash),
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
  async discardRequest(request:Request){
    if(request.agentCommand)this.app.saveLocalStorage(`${this.localKey}-note-command-${request.agentCommand.id}`,{command:request.agentCommand,discarded:true});
    this.settings.pending=this.settings.pending.filter(r=>r.id!==request.id);await this.save();
  }
  private async inlineSettlementStatus(job:ThreadSettlementJob):Promise<'wait'|'ready'|'discard'>{
    if(job.inlineBindings?.length){for(const binding of job.inlineBindings){const status=await this.inlineSettlementStatus({...job,inlineBindings:undefined,inlineJobId:binding.id,inlineHost:binding.host,inlineNotePath:binding.notePath,inlineVersion:2});if(status!=='ready')return status;}return 'ready';}
    if(!job.inlineJobId)return 'ready';
    const local=this.deviceInline?.localResponse(job.inlineJobId);
    if(local){const status=this.deviceInline!.responseStatus(job.inlineJobId);return status?.finalSaved?'ready':status?.hostRecorded?'discard':'wait';}
    if(job.inlineLocal){const file=job.inlineNotePath&&this.app.vault.getFileByPath(job.inlineNotePath);if(!file)return 'discard';return hasResponseMarkers(await this.app.vault.read(file),job.inlineJobId)?'wait':'ready';}
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

}
function randomId():string {
  const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const hex=Buffer.from(bytes).toString('hex');return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
function message(e:unknown) {return e instanceof Error ? e.message : String(e);}
function unsavedMessage(e:unknown){return message(e).replace(/\s*Retry the saved request(?: if sending| with its original ID)?\./g,'');}
class ExistingThreadModal extends FuzzySuggestModal<ThreadChoice>{
  constructor(app:App,private threads:ThreadChoice[],private choose:(thread:ThreadChoice)=>Promise<void>,placeholder='Send note to an existing thread',empty='No existing threads in this linked project. Use Send to new thread.',private back?:()=>void){super(app);this.setPlaceholder(placeholder);this.emptyStateText=empty;}
  private selected=false;
  onClose(){super.onClose?.();if(this.back)setTimeout(()=>{if(!this.selected)this.back?.();},0);}
  getItems(){return this.threads;}
  getItemText(thread:ThreadChoice){return `${thread.title} · ${thread.status} · ${thread.id.slice(0,8)}`;}
  async onChooseItem(thread:ThreadChoice){this.selected=true;try{await this.choose(thread);}catch(error){new Notice(`T3 Code: ${message(error)}`,10000);if(!(error instanceof RequestDeliveryError&&(error.requestSaved||error.terminal)))this.back?.();}}
}
type FolderLinkChoice=Project|{create:true;title:string};
class FolderLinkProjectModal extends FuzzySuggestModal<FolderLinkChoice>{
  constructor(app:App,private plugin:SendToT3,private folder:TFolder){super(app);this.setPlaceholder('Choose a T3 Code project');}
  private unwatch?:()=>void;
  onOpen(){super.onOpen?.();this.unwatch=this.plugin.watchProjects(()=>this.inputEl?.dispatchEvent(new Event('input')));}
  onClose(){this.unwatch?.();super.onClose?.();}
  getItems(){return [...this.plugin.projects(),{create:true as const,title:'Create T3 project…'}];}
  getItemText(choice:FolderLinkChoice){return 'create' in choice?choice.title:`Link to ${this.plugin.projectChoiceLabel(choice)}`;}
  onChooseItem(choice:FolderLinkChoice){if('create' in choice)void this.plugin.createFolderProject(this.folder);else void this.plugin.linkFolder(this.folder,choice,false);}
}
class FolderLinkModal extends Modal{
  constructor(app:App,private plugin:SendToT3,private folder:TFolder,private project:Project,private self:boolean){super(app);}
  onOpen(){
    const el=this.contentEl;el.empty();this.titleEl.setText(`Link ${this.folder.name} to ${this.project.title}`);
    el.createEl('p',{text:`${this.folder.path} → ${projectLabel(this.project)}`});
    el.createEl('p',{text:'Project files remain in the T3 workspace. Open them from Codebase view.'});
    const actions=new Setting(el).addButton(b=>b.setButtonText('Cancel').onClick(()=>this.close())).addButton(b=>b.setButtonText('Link').setCta().onClick(async()=>{
      actions.setDisabled(true);try{await this.plugin.saveFolderLink(this.folder,this.project,this.self);this.close();}catch(error){new Notice(message(error));actions.setDisabled(false);}
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
    new Setting(el).setName('Connection on this device').setDesc('T3 Connect works on desktop and mobile. This computer only is available for local desktop use.').addDropdown(d=>{d.addOptions({...(!Platform.isMobile?{desktop:'This computer only (advanced)'}:{}),direct:'T3 Connect (recommended)'});d.setValue(this.plugin.mode).onChange(async value=>{this.plugin.mode=value as 'desktop'|'direct';await this.plugin.save();this.plugin.refreshMachines().catch(error=>new Notice(message(error)));this.display();});});
    if(this.plugin.mode==='direct'){
      this.cloudUI(el);
      const advanced=el.createEl('details');advanced.createEl('summary',{text:'Advanced: manual pairing'});
      advanced.createEl('p',{text:'In T3 Settings → Connections, create a fresh pairing link using an HTTPS address this device can reach. Paste it below. This connects to T3 itself, with no companion, Python, SSH, or Tailscale requirement in the plugin.'});
      let name=this.selectedMachine?.name??'',address=this.selectedMachine?.url??'',code='';
      new Setting(advanced).setName('Connection name').addText(t=>t.setPlaceholder('My laptop').setValue(name).onChange(v=>name=v));
      new Setting(advanced).setName('T3 address or pairing link').setDesc('Not the old companion URL. Pairing links contain a one-time secret and are never synced or retained.').addText(t=>{t.inputEl.type='password';t.inputEl.autocomplete='off';t.setValue(address).onChange(v=>address=v);});
      new Setting(advanced).setName('Pairing code (if separate)').addText(t=>{t.inputEl.type='password';t.inputEl.autocomplete='off';t.onChange(v=>code=v);});
      new Setting(advanced).addButton(b=>b.setButtonText('Pair and discover projects').setCta().onClick(async()=>{b.setDisabled(true);try{await this.plugin.pairConnection(name,address,code,this.selectedMachine?.environmentId);this.selectedMachine=null;new Notice('Paired directly with T3. Projects appear automatically.');this.display();}catch(e){new Notice(message(e),12000);b.setDisabled(false);}}));
      for(const c of this.plugin.settings.paired){
        const status=c.managed&&this.plugin.nativeAccount?'T3 account connection · renews automatically':this.plugin.pairingStatus(c);
        const setting=new Setting(el).setName(c.name).setDesc(status);
        if(!c.managed)setting.addButton(b=>b.setButtonText('Forget pairing').onClick(async()=>{await this.plugin.forgetPairing(c.id);this.display();}));
        setting.addButton(b=>b.setButtonText('Remove connection').onClick(async()=>{try{await this.plugin.removeConnection(c.id);this.display();}catch(e){new Notice(message(e));}}));
      }
      el.createEl('p',{text:'Projects are discovered automatically on this device. Sign in once on each device; credentials stay on that device. Computers must be online to receive a note. Unconfirmed sends require manual retry.'});
    } else {
    new Setting(el).setName('Official T3 executable').setDesc('Leave blank to discover t3 automatically. Otherwise enter the full path to the official T3 CLI executable, not a Fleet adapter or shell command.').addText(t=>t.setValue(this.plugin.settings.connection.executable).onChange(async value=>{this.plugin.settings.connection.executable=value.trim();await this.plugin.save();}));
    new Setting(el).setName('T3 data directory').setDesc('Usually your home directory followed by .t3. Must match the running T3 installation.').addText(t=>t.setValue(this.plugin.settings.connection.baseDir??'').onChange(async value=>{this.plugin.settings.connection.baseDir=value.trim();await this.plugin.save();}));

    }
    el.createEl('h3',{text:'Threads'});
    new Setting(el).setName('Thread title generation').setDesc('Send and Ask use the note title by default. Let T3 name untitled notes, or generate titles for every new thread. Existing threads keep their titles.').addDropdown(d=>d.addOption('untitled-only','Only for untitled notes').addOption('always','Always use T3').setValue(this.plugin.settings.threadTitleGeneration).onChange(async value=>{this.plugin.settings.threadTitleGeneration=threadTitleGeneration(value);await this.plugin.save();}));
    new Setting(el).setName('Settle completed threads').setDesc('Move Obsidian threads out of T3 Code’s active list after a successful turn and its inline reply finish. Sending to a settled thread wakes it again. Checks run while Obsidian is open.').addToggle(t=>t.setValue(this.plugin.settings.autoSettleThreads).onChange(async enabled=>{this.plugin.settings.autoSettleThreads=enabled;if(!enabled)this.plugin.settings.settlementJobs=[];await this.plugin.save();}));
    new Setting(el).setName('Command palette').setDesc(this.plugin.paletteChatStatus()==='active'?'Use the first T3 Code row to send the current note or ask a question about it.':'The live T3 Code row is unavailable in this Obsidian version or the core Command palette is disabled.');
    el.createEl('p',{text:'Sending includes the current note and its embedded images. Asking sends the question and note location. A selected passage and its embedded images are included with the question.'});
    el.createEl('h3',{text:'Inline responses'});
    new Setting(el).setName('Stream replies into the editor').setDesc('For every manual Send or Ask, insert the reply into the note. Selection questions appear below the selection; other replies appear at the end.').addToggle(t=>t.setValue(this.plugin.settings.inlineStreaming.enabled).onChange(async enabled=>{this.plugin.settings.inlineStreaming.enabled=enabled;await this.plugin.save();}));
    new Setting(el).setName('Final answer format').setDesc('Choose how the completed final answer appears. Intermediate responses keep their formatting in the progress box. Images and files are handled in both formats. Applies to new responses.').addDropdown(dropdown=>dropdown.addOptions({formatted:'Current formatting','raw-markdown':'Raw Markdown'}).setValue(finalAnswerFormat(this.plugin.settings.inlineStreaming.finalAnswerFormat)).onChange(async value=>{this.plugin.settings.inlineStreaming.finalAnswerFormat=finalAnswerFormat(value);await this.plugin.save();}));
    new Setting(el).setName('Intermediate agent responses').setDesc('Progress stays in an open box while the agent works. The box closes when the final answer is complete. Click the header to open or close it.');
    el.createEl('h3',{text:'Project files'});
    el.createEl('p',{text:'Project files stay in their T3 workspaces. Codebase view opens them in Obsidian. Reply attachments are not copied into the vault.'});
    new Setting(el).setName('Codebase view').addButton(b=>b.setButtonText('Open').onClick(()=>{void (this.app as any).commands.executeCommandById('send-to-t3-code:codebase-view');}));
    el.createEl('h3',{text:'Orchestration'});
    new Setting(el).setName('Wait for other threads').setDesc('Prepend an instruction to wait for all other active T3 Code threads in the destination project to finish before starting work.').addToggle(t=>t.setValue(this.plugin.settings.orchestration.waitForOtherThreads).onChange(async enabled=>{this.plugin.settings.orchestration.waitForOtherThreads=enabled;await this.plugin.save();}));
    new Setting(el).setName('Legacy cleanup defaults').setDesc('Applies only to previously queued cleanup jobs. Manual sends and questions always keep their notes. Changed or renamed notes are kept.').addDropdown(d=>d.addOptions({keep:'Keep note',archive:'Archive note',delete:'Delete note (vault trash)'}).setValue(this.plugin.settings.completion.action).onChange(async value=>{this.plugin.settings.completion.action=value as CompletionAction;await this.plugin.save();this.display();}));
    if(this.plugin.settings.completion.action==='archive') new Setting(el).setName('Archive folder').setDesc('Folder inside this vault. Original subfolders are preserved; existing notes are never overwritten.').addText(t=>t.setValue(this.plugin.settings.completion.archiveFolder).onChange(async value=>{this.plugin.settings.completion.archiveFolder=value;await this.plugin.save();}));
    el.createEl('h3',{text:'Linked folders'});
    el.createEl('p',{text:'Folder links route questions and manual note sends. Create T3 project lets you choose its workspace location.'});
    const root=this.plugin.settings.folderLinks.find(l=>l.folderPath==='/');
    const machine=root?.connectionId?this.plugin.settings.paired.find(c=>c.id===root.connectionId)?.name:undefined;
    new Setting(el).setName('Vault project machine').setDesc(root?`${machine??(Platform.isMobile?'Linked computer':'This computer')} · ${root.workspaceRoot} · Hosts new note responses; keep Obsidian open there.`:'Choose the default T3 destination and response-writing host. Keep Obsidian and this plugin running there.').addButton(b=>b.setButtonText(root?'Change machine':'Connect vault').onClick(async()=>{try{await this.plugin.configureVaultRoot();this.display();}catch(e){if(!(e instanceof VaultSetupCancelled))new Notice(message(e),10000);}}));
    if(!this.plugin.settings.folderLinks.length)el.createEl('p',{text:'No folders are linked.'});
    for(const link of this.plugin.settings.folderLinks){
      const setting=new Setting(el).setName(link.folderPath==='/'?'Vault root':link.folderPath).setDesc(`${link.self?'Self · ':''}${link.projectTitle} · ${link.workspaceRoot}`);

      setting.addButton(b=>b.setButtonText('Unlink').onClick(async()=>{await this.plugin.unlinkFolder(link.folderPath);this.display();}));
    }
    if(this.plugin.settings.completionJobs.length){
      el.createEl('h3',{text:'Task completion monitoring'});
      el.createEl('p',{text:'Checks every 30 seconds while Obsidian is active and resumes after restart or reopening on this device. Mobile background checks are not guaranteed. A completed T3 turn is the completion signal; this does not judge whether the answer fully solved the task.'});
      for(const job of this.plugin.settings.completionJobs) new Setting(el).setName(job.notePath).setDesc(`${job.action} · ${job.threadId} · ${job.detail || 'Waiting for successful completion'}`).addButton(b=>b.setButtonText(job.status==='watching'?'Stop monitoring':'Dismiss').onClick(async()=>{this.plugin.settings.completionJobs=this.plugin.settings.completionJobs.filter(j=>j!==job);await this.plugin.save();this.display();}));
      new Setting(el).addButton(b=>b.setButtonText('Check now').onClick(async()=>{b.setDisabled(true);await this.plugin.monitorCompletions();this.display();}));
    }
    new Setting(el).setName('Send failure log').setDesc('Failed sends end immediately. No requests are queued for Retry.').addButton(button=>button.setButtonText('View log').onClick(()=>this.plugin.exportDiagnostics()));
  }
}

class StreamDestinationsModal extends Modal {
  constructor(app:App,private notePath:string,private execute:(command:NoteCommand)=>Promise<NoteCommandResult>){super(app);}
  onOpen(){
    this.contentEl.createEl('h2',{text:'Send note with streaming destinations'});
    this.contentEl.createEl('p',{text:'Create one new T3 thread from this note. Its answer streams into each destination. Other threads can stream into separate blocks in the same notes.'});
    let paths=this.notePath;
    new Setting(this.contentEl).setName('Destination notes').setDesc('Vault-relative Markdown paths, one per line. Notes must already exist.').addTextArea(input=>input.setValue(paths).onChange(value=>{paths=value;}));
    new Setting(this.contentEl).addButton(button=>button.setButtonText('Send to new thread').setCta().onClick(async()=>{
      button.setDisabled(true);
      try{const result=await this.execute({version:1,id:randomId(),kind:'send-note',notePath:this.notePath,destinations:[...new Set(paths.split(/\r?\n/).map(path=>path.trim()).filter(Boolean))],streamReply:true});new Notice(`T3 thread created: ${result.threadId}`);this.close();}
      catch(error){new Notice(message(error),10000);button.setDisabled(false);}
    }));
  }
}
