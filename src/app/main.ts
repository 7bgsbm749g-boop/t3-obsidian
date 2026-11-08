import {RouteStatus} from '../connection/route-status';
import {readImportThreads,readImportRuns,readImportRun,readImportPreview,importHistoryState} from '../conversations/import-source';
import {orderedRoutes,routeGroups,routePairing,routeMethod,localRoute,routeNames,type ConnectionMethod} from '../connection/routes';
import {forEachBounded} from '../shared/bounded-work';
import {AgentSetup,type AgentProvider} from '../agents/setup';
import {agentAssets,agentBundleHash} from '../agents/assets';
import {AgentToolsSettings} from '../agents/settings';
import {ConnectCommandHost,commandBase,type CommandFiles,type CommandRoute} from '../notes/connect-command-host';
import {connectAgentFiles,connectCommandFiles} from '../notes/connect-command-files';
import {CheckedNoteEdits,isNoteEditCommand,checkedStageDraft,type EditSnapshot} from '../notes/checked-note-edits';
import {connectT3Rpc} from '../connection/t3-rpc';
import {ThreadDisplays,isThreadCommand,type ThreadDisplayResult} from '../conversations/thread-displays';
import type {ThreadTarget as EventTarget} from '../conversations/thread-display';
import {readPrivateStorageRoute} from '../storage/private-storage';
import {DesktopClientMaintenance} from './client-maintenance-desktop';
import * as cmState from '@codemirror/state';
import {loadQuestionRecords} from '../interaction/question-controller';
import {loadApprovalRecords} from '../interaction/approval-controller';
import {readThreadList} from '../connection/wire-readers';
import {nativeHost} from '../shared/native-host';
import {readThreadSnapshot,type ThreadSnapshot,type NormalizedThread} from '../connection/wire-types';
import {workspaceDocument,watchWorkspaceDocuments} from '../ui/workspace-documents';
import {isRecord,jsonClone,parseJson} from '../shared/values';
import {scheduleTimeout as setTimeout,cancelTimeout as clearTimeout} from '../shared/clock';
import {SendPreviews} from '../responses/send-preview';
import {savedToDisplay} from '../responses/native-response-projection';
import {loadSmartSend,mergeSmartSend,smartDestination,prepareSmartSend,explicitSelectionText,rememberResponse,rememberNoteEdits,confirmSmartSend,moveSmartNotes,sourceProjection,smartNote,unpackText,type SmartSendData,type SmartCapture,type Span} from '../notes/smart-send';
import {noteIdentity,withNoteIdentity} from '../notes/note-identity';
import {retainedLocalFinal,restoredLocalFinal} from '../responses/local-final-cache';
import {HtmlResultStore} from '../responses/html-result-store';
import {HtmlResultViews} from '../responses/html-result-view';
import {hasResponseMarkers} from '../conversations/inline-thread';
import {responseIds,responseFrame} from '../responses/response-container';
import {noteSteeringTarget} from '../notes/note-steering';
import {interruptStoppedResponse} from '../responses/response-stop';
import {localResponseBindings,localResponseRange} from '../responses/local-response-binding';
import {loadResponseBindingData,mergeResponseBindingData,updateResponseBindingData,responseBindingRequests,type ResponseBindingData} from '../responses/response-binding-data';
import {localSyncReady} from '../storage/local-sync-state';
import {rewriteReplyReferences} from '../responses/reply-assets';
import {isClientCommand} from './client-command';
import {markdownCodeCacheStatus,escapeReplyHtml} from '../responses/reply-html';
import pluginManifest from '../../manifest.json';
import {appendSendFailure,sendFailureLog,type SendFailure} from '../responses/send-failures';
import {ConnectionRecovery} from '../connection/connection-recovery';
import {PLUGIN_PERMISSIONS,AGENT_SETUP_PERMISSIONS,hasPluginPermissions} from '../connection/environment-permissions';
import {REAUTHENTICATE_MESSAGE,SignInRequiredError,signInRequired} from '../connection/sign-in-state';
import {T3HttpError} from '../conversations/thread-access-cache';
import {mergeSharedSettings} from '../storage/shared-settings';
import {noteThreadTitle,threadTitleGeneration,type ThreadTitleGeneration} from '../conversations/thread-title';
import {ResponseLocationModal} from '../responses/response-location-ui';
import {obsidianFooter} from '../notes/obsidian-prompt';
import {isNoteContextCommand,noteContext,mergeNoteContexts,contextBindingIds,type NoteContextRecord} from '../notes/note-context';
import {isResponseCommand,validateResponseCommand} from '../responses/response-command';
import {installStreamBlockControls} from '../responses/stream-block-controls';
import {responseMoveHistory} from '../responses/response-move';
import {incomingLabel} from '../conversations/inline-steering';
import {isT3MessageId} from '../connection/t3-message-id';
import {ProjectDiscovery,type ProjectSource,type ProjectSnapshot} from '../projects/project-discovery';
import {resolveJobOptions,type ResolvedJobOptions} from '../conversations/job-options';
import {intermediateMode,installResponsePresentation,finalAnswerFormat,type FinalAnswerFormat,type IntermediateMode} from '../responses/response-presentation';
import {installActivityShine} from '../ui/activity-shine';
import {activityLeafPath,decorateActivityTabs,decorateMobileActivityTabs,type ActivityLeaf} from '../ui/activity-titles';
import {applyThreadItem,quoteResponse} from '../conversations/inline-thread';
import {readInlineSnapshot,watchThread,type ThreadAccess} from '../conversations/thread-stream';
import {isRecoveryCommand} from '../responses/recovery-command';
import {abortableRead,requestAborted} from '../connection/t3-api';
import {mountToolGroups} from '../responses/response-tool-presentation';
import {importRuns,importBindingId,importFollowId,type RunImportResult,type ImportRun} from '../conversations/run-import';
import {renderRunImportPreview} from '../conversations/run-import-preview';
import {findRunImport,runImportReceipt} from '../conversations/run-import-receipt';
import {openRunImport,ImportStreamsModal} from '../conversations/run-import-ui';
import {type InlineThreadState} from '../conversations/inline-thread';
import {nativeResponses} from '../responses/native-response-manager';
import {editorStream} from '../responses/editor-stream';
import {captureCursorInsertion,resolveCursorInsertion,type CursorInsertion} from '../notes/cursor-insertion';
import {continueQuestionAnswer} from '../interaction/question-continuation';
import {validateNoteCommand,validateAgentCommand,type NoteCommand,type NoteCommandResult} from '../notes/note-command';
import {isFolderCommand,executeFolderCommand,type FolderCommand} from '../projects/folder-command';
import {configureDiagnostics,logEvent,logFailure,type EventJournal} from './diagnostics';
import {clearVaultDiagnostics} from './disabled-diagnostics';
import {beginLogin,pollLogin,refreshAccount,discoverMachines,connectMachine,type CloudAccount,type DeviceLogin,type CloudMachine} from '../connection/cloud';
import {beginEmailLogin,verifyEmailLogin,nativeRelayAccount,revokeNativeAccount,type NativeAccount,type EmailLogin} from '../connection/native-account';
import {pair,readDirect,commandId,environmentApi,endpoint,type PairedConnection,type PairedSession} from '../connection/direct';
import {environmentAccess} from '../connection/environment-access';
import {setIcon, App, FileSystemAdapter, Menu, MenuItem, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder, MarkdownView, Platform, FuzzySuggestModal, type SettingDefinition,type SettingDefinitionItem,type TAbstractFile, type Editor, type MarkdownFileInfo, MarkdownRenderChild, MarkdownRenderer,  requestUrl } from 'obsidian';
import { Buffer } from 'buffer/';
import { deviceState,retainDeviceState,clearDeviceDiagnostics } from '../storage/device-state';
import {nativeStoppedStore} from '../responses/native-stop-store';
import { downloadImage,nativeAccountFetch } from '../connection/network';
import {ensureVaultIdentityRecord} from './vault-identity';
import { collectImages, imageReferenceDefinitions, MAX_IMAGE_BYTES } from '../notes/images';
import {vaultHost,loadVaultHost,mergeVaultHost,type VaultHost} from './vault-host';
import {ensureNoProject,NO_PROJECT,isNoProjectKey,noProjectKey,noProjectMachine} from '../projects/no-project';
import {CompletionSettings,CompletionJob,contentHash} from '../responses/completion';
import {Connection,Project,Request,RequestDeliveryError,acceptedRequestThread,parseProjects,runBridge,sendRequest,configureBridge,retiredConnection,projectKey,projectLabel} from './bridge';
import {loadFolderLinks,upsertFolderLink,folderLinkForPath,sameWorkspacePath,type FolderLink} from '../projects/folder-link';
import {loadFolderLinkChanges,mergeFolderLinkChanges,applyFolderLinkChanges,changedFolderLinks,mergeLegacyFolderLinks,type FolderLinkChange} from '../projects/folder-link-sync';
import {installPaletteChat,type PaletteChatController} from '../conversations/palette-chat';
import {SendGesture} from '../responses/send-gesture';
import {AskComposer,openChatFlow,openNoteSendFlow,type ChatHost,type ChatDestination} from '../conversations/chat-ui';
import {selectionRange} from '../conversations/inline-steering';
import {projectThreads,type ThreadChoice} from '../conversations/thread-target';
import {assertThreadNoteMode,oneToOneNoteThreads,threadNoteMode,type ThreadNoteMode,type ModeThread} from '../conversations/thread-note-mode';
import {lastUsedNoteThread,loadNoteThreads,mergeNoteThreads,mutateNoteThreads,previousNoteThreads,bindNoteThreadIds,resolveNoteThreadPaths,type NoteThread} from '../notes/note-threads';
import {noteIndicators} from '../responses/explorer-responses';
import {CompletionGlow} from '../responses/completion-glow';
import {folderNotePath,type FolderNotesSettings} from '../projects/folder-note-adapter';
import {installFolderIndicators,type FolderIndicatorController} from '../projects/folder-indicator';
import {connectVaultRemote,loadVaultLocations,vaultIdentity,vaultRegistration,waitForVaultNote,type VaultLocation,type VaultRegistration} from '../connection/vault-connection';
import {loadProjectCreationLocations,rememberProjectCreationLocation,projectCreationDefaults,workspaceParentPath,type ProjectCreationLocation} from '../projects/workspace-picker';
import {ProjectCreateModal,ProjectCreationCancelled,workspaceInsideVault,type ProjectLocation} from '../projects/project-create-ui';
import {VaultSetupModal,VaultSetupCancelled,type VaultMachine} from '../connection/vault-setup-ui';
import {threadIsActive,responseOwnsActiveTurn} from '../conversations/thread-target';
import {DeviceResponseManager} from '../responses/device-local-responses';
import {deviceNoteIO,deviceFinalNoteIO} from '../conversations/inline-note-io';
import {projectReplyReference as resolveReplyReference} from '../projects/project-reference';
import {type CodebaseState,CodebaseBridge} from '../projects/codebase-native';
import {codebaseTransport} from '../projects/codebase-transport';
import {changeCodebaseProjectLinks} from '../projects/codebase-core';
import {loadReplyFolders,type ReplyFolders} from '../responses/reply-locations';
import {InlineChatManager,captureEditorSelection,type InlineJob} from '../conversations/inline-chat';
import {type ResponseRequest,type ResponseStorageTarget,} from '../responses/response-model';
import {type ResponseRecord} from '../responses/response-record';
import {hiddenInlineMarkerExtension,hideResponseContainerBoundaries} from '../conversations/inline-markers';
import {activeInlineIds,inlineTargetAt,inlineSteeringTarget,selectionOverlapsInlineResponse,selectionAnchor,initialRegion,insertionOffset,endInsertionOffset,failedInlineIds,regionBody,finalizeRegion,type SelectionAnchor} from '../conversations/inline-thread';
import {QuestionController} from '../interaction/question-controller';
import {closeNoteTabPanel} from '../notes/note-tab-panel';
import {QuestionModal,questionButton,questionEditorExtension,installQuestionLinks} from '../interaction/question-ui';
import {questionTargets,parseQuestionToken,clearResolvedQuestion,removeDismissedQuestions,type QuestionTarget} from '../interaction/questions';
import {ApprovalController} from '../interaction/approval-controller';
import {approvalButton,approvalEditorExtension} from '../interaction/approval-ui';
import {approvalTargets,parseApprovalUrl,clearApprovalControls,type ApprovalTarget} from '../interaction/approvals';
import {settlementState,type ThreadSettlementJob} from '../conversations/thread-settlement';
type EditorChatContext={editor:Editor;view:MarkdownView|MarkdownFileInfo;anchor?:SelectionAnchor;canonicalAnchor?:SelectionAnchor;insertion?:CursorInsertion;referenceSelection?:boolean;initialQuestion?:string;responseId?:string;snapshot?:string;smartDocument?:string;smartScope?:Span;smartQuestion?:string};
type SteeringSource={document:string;ranges:Span[]};
type PaletteActionContext={file:TFile;editor?:EditorChatContext;insertion:CursorInsertion|null};
const NEW_FOLDER_PROJECT='folder:new';
interface InlineStreamingSettings {enabled:boolean;keepIntermediate:boolean;intermediateMode?:IntermediateMode;finalAnswerFormat?:FinalAnswerFormat}
type PreparedNote={content:string;images:Awaited<ReturnType<typeof collectImages>>};
interface Settings {threadNoteMode:ThreadNoteMode;projectCreationLocations:ProjectCreationLocation[];noteContexts?:NoteContextRecord[];smartSend?:SmartSendData;responseBindings?:ResponseBindingData;codebase?:CodebaseState; replyFolders:ReplyFolders;threadTitleGeneration:ThreadTitleGeneration; paired:PairedConnection[];directProjects:Project[];directSelected:string[];directScanId:string; connection: Connection; projects: Project[]; selected: string[]; pending: Request[]; vaultHost?:VaultHost; inlineStreaming:InlineStreamingSettings; completion: CompletionSettings; completionJobs: CompletionJob[]; settlementJobs:ThreadSettlementJob[];autoSettleThreads:boolean; folderLinks:FolderLink[];folderLinkChanges:FolderLinkChange[];noteThreads:NoteThread[];vaultId:string;vaultLocations:VaultLocation[] }
type SharedSettings=Omit<Settings,'pending'|'completionJobs'|'settlementJobs'|'connection'|'projects'|'directProjects'|'selected'|'directSelected'|'directScanId'>;
type StoredSettings=Omit<Partial<Settings>,'inlineStreaming'>&{inlineStreaming?:Partial<InlineStreamingSettings>&{askT3?:boolean;sendToT3?:boolean}};
interface DeviceSettings {connectionMethod?:ConnectionMethod;routeOrder?:string[];deviceId?:string;mode?:'direct'|'desktop';connection?:Connection;pairedSessions?:Record<string,PairedSession>;cloudAccount?:CloudAccount|null;nativeAccount?:NativeAccount|null;signInEmail?:string;signInExpired?:boolean;vaultRegistrations?:Record<string,VaultRegistration>}
function storedSettings(value:unknown):StoredSettings|null{return isRecord(value)?value:null;}
export default class SendToT3 extends Plugin {
  private settingsTab?:T3Settings;
  declare settings: Settings;
  mode: 'desktop'|'direct' = 'desktop';
  connectionMethod:ConnectionMethod='connect';
  routeOrder:string[]=[];
  readonly routeFailures=new Map<string,string>();
  readonly routeStatus=new RouteStatus();
  private smartReplica=loadSmartSend(undefined);
  private smartRecovered=new Set<string>();
  private smartRecovering=new Map<string,Promise<void>>();
  private responseBindingReplica:ResponseBindingData={};
  private pairedSessions:Record<string,PairedSession>={};
  cloudAccount:CloudAccount|null=null;
  nativeAccount:NativeAccount|null=null;
  emailLogin:EmailLogin|null=null;
  signInEmail='';
  signInExpired=false;
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
  private sendPreviews=new SendPreviews();
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
  private commandHosts=new Map<string,{host:ConnectCommandHost;rpc:Awaited<ReturnType<typeof connectT3Rpc>>;files:CommandFiles}>();
  private commandProjects=new Map<string,Project>();
  private verifiedConnections=new Map<string,{work:Promise<void>;until:number}>();
  private commandSerial:Promise<void>=Promise.resolve();
  private noteEdits?:CheckedNoteEdits;
  private threadDisplays?:ThreadDisplays;
  private threadDisplayOpening?:Promise<void>;
  private clientMaintenance?:DesktopClientMaintenance;
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
  private completionGlow?:CompletionGlow;
  private vaultSetup?:Promise<VaultHost>;
  private noProjectProjects=new Map<string,Project>();
  private vaultSetupModal?:VaultSetupModal;
  private vaultRegistrations:Record<string,VaultRegistration>={};
  private inlineChat?:InlineChatManager;
  private questions?:QuestionController;
  private approvals?:ApprovalController;
  private questionModal?:QuestionModal;
  private questionPaths=new Set<string>();
  private toolRenderings=new Map<HTMLDetailsElement,{ref:string;child:MarkdownRenderChild;dispose:()=>void}>();
  private htmlResults?:HtmlResultViews;
  private refreshingQuestions=false;
  private deviceInline?:DeviceResponseManager;

  private inlineActor=randomId();

  private noteCommandOpening?:Promise<void>;
  private eventLocalEnvironmentId?:string;
  diagnostics?:EventJournal;
  private failedRequests=new WeakSet<Request>();
  private connectionRecovery?:ConnectionRecovery;
  private connectionRecoveryTarget(target:ResponseStorageTarget){return JSON.stringify([target.environmentId,target.workspaceRoot,target.directory]);}
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
    // Refusing a new input must not stop the existing response or its T3 turn.
    if(request.inlineSteering&&!['dispatch','startup-recovery'].includes(stage)){
      for(const target of request.inlineSteering.targets??[request.inlineSteering])try{
        if(target.host)await this.deviceInline?.discardSteering(target.jobId,request.inlineSteering.input.messageId);
        else {const job=this.inlineChat?.find(target.jobId);if(job)this.inlineChat!.discardSteering(job,request.inlineSteering.input.messageId);}
      }catch(cleanupError){this.recordSendFailure(request,cleanupError,'steering-input-cleanup',startedAt);}
    }
    const attached=request.inlineFollow;
    if(attached){const existing=this.inlineChat?.find(attached.jobId);if(existing)await this.inlineChat!.stop(existing);else{await nativeResponses(this.app).stop(attached.jobId,request.inlineFollow?.notePath??request.noteThread?.notePath);this.deviceInline?.stopLocally(attached.jobId);if(attached.host)void this.stopHostedInline(attached.jobId,attached.host).catch(cleanupError=>this.recordSendFailure(request,cleanupError,'failure-cleanup',startedAt));}}
    const job=this.inlineChat?.find(request.id);if(job)await this.inlineChat!.deliveryFailed(job);
    // Save cleanup independently of the network. A cleanup failure never
    // recreates a request or schedules another prompt dispatch.
    try{await this.save();}catch(saveError){this.recordSendFailure(request,saveError,'failure-save',startedAt);}
  }
  private async loadSettings():Promise<StoredSettings|null>{return storedSettings(await this.loadData());}
  private localDraft(){const value:unknown=this.app.loadLocalStorage(this.chatDraftKey);return typeof value==='string'?value:'';}
  private stopContentHash?:()=>void;
  async onload() {
    const document=workspaceDocument(this.app);
    if(!Platform.isMobile)this.stopContentHash=await (await import('../connection/content-hash-desktop')).installDesktopContentHash();
    if(typeof this.register==='function'&&MarkdownView?.prototype)this.register(nativeResponses(this.app).installLoading(MarkdownView.prototype));
    if(typeof this.registerDomEvent==='function')this.register(watchWorkspaceDocuments(this.app,root=>{
      const review=(event:Event)=>{const detail=(event as CustomEvent<unknown>).detail;if(isRecord(detail)&&typeof detail.bindingId==='string')new ResponseLocationModal(this.app,detail.bindingId,command=>this.executeAgentCommand(command)).open();};
      const toggle=(event:Event)=>{
        const details=event.target as HTMLDetailsElement;if(!details?.matches?.('details[data-t3-tool-ref]')||!details.open)return;
        const ref=details.getAttribute('data-t3-tool-ref')!,old=this.toolRenderings.get(details);if(old?.ref===ref)return;
        if(old){old.dispose();this.removeChild(old.child);this.toolRenderings.delete(details);}
        const child=new MarkdownRenderChild(details);this.addChild(child);
        const dispose=mountToolGroups(details,value=>nativeResponses(this.app).toolGroup(details,value),(html,target)=>MarkdownRenderer.render(this.app,details.classList.contains('send-to-t3-response-history')?nativeResponses(this.app).renderToolBody(details,html):html,target,this.app.workspace.getActiveFile()?.path??'',child),error=>new Notice(`T3 Code: ${message(error)}`));
        child.register(dispose);this.toolRenderings.set(details,{ref,child,dispose});
      };
      const openHistories=()=>{
        if(this.stopped)return;
        for(const details of Array.from(root.querySelectorAll<HTMLDetailsElement>('details.send-to-t3-response-history[data-t3-tool-ref]:not([open])'))){
          const fold=details.closest('.callout[data-callout="t3-progress"]');if(fold&&!fold.classList.contains('is-collapsed'))details.open=true;
        }
      };
      root.addEventListener('t3-review-response-location',review);root.addEventListener('toggle',toggle,true);
      const observer=new MutationObserver((records=[])=>{for(const [details,rendering] of this.toolRenderings)if(!details.isConnected){rendering.dispose();this.removeChild(rendering.child);this.toolRenderings.delete(details);}if(records.some(record=>record.type==='childList'||(record.target as Element).matches?.('.callout[data-callout="t3-progress"]')))openHistories();});
      observer.observe(root,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});
      return ()=>{root.removeEventListener('t3-review-response-location',review);root.removeEventListener('toggle',toggle,true);observer.disconnect();for(const [details,rendering] of this.toolRenderings)if(details.ownerDocument===root){rendering.dispose();this.removeChild(rendering.child);this.toolRenderings.delete(details);}};
    }));
    const data = await this.loadSettings();
    this.lastDiskSnapshot=JSON.stringify(data);
    const local = this.app.loadLocalStorage(this.localKey) as unknown as DeviceSettings|undefined;
    this.deviceId=local?.deviceId??randomId();
    this.compactNoteCommandReceipts();
    const state=await deviceState<Partial<Pick<Settings,'pending'|'completionJobs'|'settlementJobs'>>&{queued?:Array<Request&{threadId:string;superseded?:boolean}>}>(this.deviceId);
    const defaults:Connection={executable:'',host:'direct',transport:'direct'};
    this.clientMaintenance=new DesktopClientMaintenance(this.app,'','',pluginManifest.version);
    this.mode='direct';
    this.connectionMethod=['connect','local','https','ssh'].includes(local?.connectionMethod??'')?local!.connectionMethod!:'connect';
    this.routeOrder=Array.isArray(local?.routeOrder)?local.routeOrder.filter((id):id is string=>typeof id==='string'):[];
    this.pairedSessions=local?.pairedSessions??{};
    this.cloudAccount=local?.cloudAccount??null;
    this.nativeAccount=local?.nativeAccount??null;
    this.signInEmail=typeof local?.signInEmail==='string'?local.signInEmail:this.nativeAccount?.identity??'';
    this.signInExpired=local?.signInExpired===true&&!this.nativeAccount;
    this.vaultRegistrations=local?.vaultRegistrations??{};
    this.settings = {threadNoteMode:threadNoteMode(data?.threadNoteMode),projectCreationLocations:loadProjectCreationLocations(data?.projectCreationLocations),noteContexts:mergeNoteContexts(data?.noteContexts),codebase:data?.codebase,replyFolders:loadReplyFolders(data?.replyFolders),threadTitleGeneration:threadTitleGeneration(data?.threadTitleGeneration),paired:data?.paired??[],directProjects:data?.directProjects??[],directSelected:data?.directSelected??[],directScanId:data?.directScanId??'',connection:local?.connection??data?.connection??defaults,projects:data?.projects??[],selected:data?.selected??[],pending:state?.pending??(!Platform.isMobile?data?.pending:[])??[],vaultHost:loadVaultHost(data?.vaultHost),inlineStreaming:{finalAnswerFormat:finalAnswerFormat(data?.inlineStreaming?.finalAnswerFormat),enabled:data?.inlineStreaming?.enabled??(data?.inlineStreaming?.askT3!==false&&data?.inlineStreaming?.sendToT3!==false),keepIntermediate:data?.inlineStreaming?.keepIntermediate===true,...(data?.inlineStreaming?.intermediateMode?{intermediateMode:intermediateMode(data.inlineStreaming.intermediateMode,data.inlineStreaming.keepIntermediate)}:{})},completion:{action:'keep',archiveFolder:''},completionJobs:[],settlementJobs:Array.isArray(state?.settlementJobs)?state.settlementJobs:[],autoSettleThreads:data?.autoSettleThreads!==false,folderLinks:loadFolderLinks(data),folderLinkChanges:loadFolderLinkChanges(data?.folderLinkChanges),noteThreads:loadNoteThreads(data?.noteThreads),vaultId:vaultIdentity(data)??randomId(),vaultLocations:loadVaultLocations(data)};
    if(!Platform.isMobile){
      const key=`t3-connection-recovery-v1:${this.settings.vaultId}`;
      this.connectionRecovery=new ConnectionRecovery({
        load:()=>{const value:unknown=this.app.loadLocalStorage(key);return value&&typeof value==='object'?value:{};},
        save:value=>this.app.saveLocalStorage(key,value),
        reload:beforeDispatch=>this.reloadForConnection(beforeDispatch),
        failure:()=>{/* Retry only if Obsidian itself could not invoke the reload. */},
      });
      this.app.workspace.onLayoutReady(()=>this.registerInlineInterval(()=>this.connectionRecovery?.tick(),1000));
    }
    this.responseBindingReplica=mergeResponseBindingData(data?.responseBindings,await deviceState(`response-bindings:${this.deviceId}:${this.settings.vaultId}`));
    this.settings.responseBindings=this.responseBindingReplica;
    const completionKey=`t3-completion-glow:${this.settings.vaultId}`;
    this.completionGlow=new CompletionGlow(this.app.loadLocalStorage(completionKey),receipts=>this.app.saveLocalStorage(completionKey,receipts),{
      access:(environmentId,reason)=>this.inlineThreadAccess(environmentId,reason==='auth-rejected'),
      changed:()=>this.folderIndicators?.refresh(),
    });
    this.smartReplica=mergeSmartSend(data?.smartSend,await deviceState(`smart-send:${this.deviceId}:${this.settings.vaultId}`));this.settings.smartSend=this.smartReplica;
    this.settings.noteThreads=bindNoteThreadIds(this.settings.noteThreads,this.smartReplica.notes);
    this.folderLinkReplica=mergeFolderLinkChanges(this.settings.folderLinkChanges,loadFolderLinkChanges(await deviceState(`folder-links:${this.deviceId}:${this.settings.vaultId}`)));
    this.settings.folderLinkChanges=this.folderLinkReplica;
    this.settings.folderLinks=applyFolderLinkChanges(this.settings.folderLinks,this.folderLinkReplica);
    const restoreResponseBindings=JSON.stringify(loadResponseBindingData(data?.responseBindings))!==JSON.stringify(this.responseBindingReplica);
    const restoreSmartSend=JSON.stringify(loadSmartSend(data?.smartSend))!==JSON.stringify(this.smartReplica);
    const restoreFolderLinks=JSON.stringify(loadFolderLinks(data))!==JSON.stringify(this.settings.folderLinks)||JSON.stringify(loadFolderLinkChanges(data?.folderLinkChanges))!==JSON.stringify(this.folderLinkReplica);
    // General logging is disabled for the performance isolation trial. Do not create
    // a journal, operation wrappers, diagnostic listeners or flush timers.
    configureDiagnostics();
    try{await clearDeviceDiagnostics(this.settings.vaultId);}catch(error){new Notice(message(error));}
    const adapter=this.app.vault?.adapter;
    if(adapter&&typeof adapter.exists==='function'&&typeof adapter.remove==='function'){
      try{await clearVaultDiagnostics(adapter,this.app.vault.configDir);}catch(error){new Notice(`Could not clear plugin logs: ${message(error)}`);}
    }
    this.addCommand({id:'export-diagnostics',name:'Export send failure log…',callback:()=>void this.exportDiagnostics().catch(error=>new Notice(message(error)))});
    if(typeof window!=='undefined'&&typeof window.addEventListener==='function'){
      const watch=(win:Window)=>this.register(this.sendGesture.watch(win));
      watch(window);
      const windows=new Set<Window>([window]);
      for(const leaf of this.app.workspace.getLeavesOfType('markdown')){const win=leaf.view.containerEl?.ownerDocument.defaultView;if(win&&!windows.has(win)){windows.add(win);watch(win);}}
      this.registerEvent(this.app.workspace.on('window-open',(_workspace,win)=>{if(!windows.has(win)){windows.add(win);watch(win);}}));
    }
    this.addCommand({id:'send-or-ask',name:'Send or ask…',editorCheckCallback:(checking,editor,view)=>{
      const file=view.file;
      if(this.stopped||this.busy||this.defaultSending||!file||file.extension.toLowerCase()!=='md')return false;
      if(!checking)void this.openManualAction(file,'',editor.getSelection(),{editor,view},this.commandSendSelector(view)).catch(error=>new Notice(`T3 Code: ${message(error)}`,10000));
      return true;
    }});
    this.addCommand({id:'ask-agent',name:'Ask agent…',editorCheckCallback:(checking,editor,view)=>{if(this.stopped||this.busy||!view.file)return false;if(!checking)this.openAsk(view.file,editor.getSelection(),{editor,view});return true;}});
    this.addCommand({id:'send-or-ask-choose',name:'Send or ask: choose destination…',editorCheckCallback:(checking,editor,view)=>{
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
    this.settings.pending=this.settings.pending.filter(request=>{
      if(request.inlineHost&&!request.inlineHost.localOnly||request.inlineBindings?.some(binding=>!binding.localOnly))return false;
      const continuation=request.inlineSteering??request.inlineFollow;
      return !continuation?.host||responseBindingRequests(this.settings.responseBindings??{}).some(binding=>binding.id===continuation.jobId);
    });
    this.inlineChat=new InlineChatManager(this.app,`${this.localKey}-inline-${this.settings.vaultId}`,id=>this.sessionFor(id),{prepare:(job,request)=>this.prepareHostedInline(job,request),stop:job=>job.localOnly?this.stopLocalInline(job):this.stopHostedInline(job.id,job.hostTarget,job.remoteStopOperationId),status:job=>this.deviceInline?.responseStatus(job.id)},()=>'collapse',()=>finalAnswerFormat(this.settings.inlineStreaming.finalAnswerFormat));
    if(typeof this.registerEditorExtension==='function'){const {EditorState}=cmState;this.registerEditorExtension([EditorState.transactionFilter.of(transaction=>nativeResponses(this.app).filter(transaction)),responseMoveHistory()]);}
    if(typeof this.registerMarkdownCodeBlockProcessor==='function'){
      const prefix=`html-result:v1:${this.settings.vaultId}:`;
      const store=new HtmlResultStore({read:key=>deviceState(prefix+key),write:async(key,value)=>{await deviceState(prefix+key,value);}},environmentId=>this.inlineThreadAccess(environmentId),async url=>{
        const response=await requestUrl({url,headers:{Accept:'text/html'},throw:false});
        return {status:response.status,mimeType:Object.entries(response.headers).find(([key])=>key.toLowerCase()==='content-type')?.[1]??'',bytes:response.arrayBuffer};
      },{isSignInError:signInRequired,onDiagnostic:diagnostic=>logEvent('html.result.failure',diagnostic as unknown as Record<string,unknown>,'warning')});
      this.htmlResults=new HtmlResultViews(this.app,store,{onSignIn:()=>this.openSettings()});this.htmlResults.install(this);
      this.registerDomEvent(window,'online',()=>{this.deviceInline?.reconnect();void this.htmlResults?.recover();});
    }
    const previewKey=`native-preview:${this.deviceId}:${this.settings.vaultId}`;
    let savedPreviews:unknown;try{savedPreviews=await deviceState(previewKey);}catch(error){logFailure('note.preview.cache-load',error);}
    nativeResponses(this.app).configurePreviewCache(this.settings.vaultId,savedPreviews,async snapshot=>{await deviceState(previewKey,snapshot);});
    try{await nativeResponses(this.app).configureStoppedStore(nativeStoppedStore(this.deviceId,this.settings.vaultId));}catch(error){logFailure('note.stop.cache-restore',error);new Notice('T3 Code: Frozen response recovery is waiting for device storage. Saved recovery text is retained.',10000);}
    if(typeof this.registerView==='function'){
    this.codebase=new CodebaseBridge(this.app,this,codebaseTransport((environmentId,reason)=>this.inlineThreadAccess(environmentId,reason==='auth-rejected')),()=>this.settings.folderLinks.map(link=>({...link,environmentId:link.environmentId??this.settings.paired.find(c=>c.id===link.connectionId)?.environmentId??this.eventLocalEnvironmentId})),this.settings.vaultId,{...{environments:()=>[...new Set([...this.settings.paired.map(c=>c.environmentId),...(this.eventLocalEnvironmentId?[this.eventLocalEnvironmentId]:[])])]},load:()=>this.settings.codebase,save:async state=>{this.settings.codebase=state;await this.save();},projectChanged:async(scope,change)=>{await this.updateCodebaseProjectLinks(scope,change);}});
    await this.codebase.install();
    }
    this.deviceInline=new DeviceResponseManager(this.inlineActor,this.settings.vaultId,{
      ...deviceNoteIO(this.app),
      localFinalNotes:deviceFinalNoteIO(this.app,()=>!this.stopped),
      rememberResponse:async(request,body,before,after,offset)=>{if(await rememberResponse(this.smartData(),request.notePath,request.id,body,before,after,offset))await this.save(true);},
      rememberNoteEdits:async(request,before,after)=>{if(await rememberNoteEdits(this.smartData(),request.notePath,request.id,before,after))await this.save(true);},
      localBindings:()=>responseBindingRequests(this.settings.responseBindings??this.responseBindingReplica),
      saveLocalBinding:request=>this.saveResponseBinding(request),
      retainLocalFinal:async update=>{await deviceState(`local-final:${this.deviceId}:${this.settings.vaultId}:${update.request.id}`,retainedLocalFinal(update));},
      loadLocalFinal:async request=>restoredLocalFinal(await deviceState(`local-final:${this.deviceId}:${this.settings.vaultId}:${request.id}`),request),
      localFinalDraft:async(document,request)=>{if(!request.localStage)return document;if(!request.localStage.transport)throw Error('Prepare this old staged edit again through T3 Connect.');return checkedStageDraft(document,request,await this.commandFiles(request.localStage.transport));},
      syncReady:path=>localSyncReady(this.app,path),
      openedNotes:()=>this.app.workspace.getLeavesOfType('markdown').map(leaf=>leaf.view as MarkdownView).filter(view=>view.file&&typeof view.getViewData==='function').map(view=>({path:view.file!.path,document:nativeResponses(this.app).view(view)?.recoveryDocument()??view.getViewData()})),
      saveLocalNote:async path=>{for(const leaf of this.app.workspace.getLeavesOfType('markdown')){const view=leaf.view as MarkdownView;if(view.file?.path===path&&typeof view.save==='function')await view.save();}},
      localEditSaved:async request=>{await this.markEditSaved(request);},
      localCompleted:(id,path)=>{nativeResponses(this.app).localCompleted(id,path);void deviceState(`local-final:${this.deviceId}:${this.settings.vaultId}:${id}`,null).catch(error=>logFailure('response.local.final-cache-cleanup',error));this.inlineChat?.flushAvailable();},
      localConnection:(id,issue)=>nativeResponses(this.app).connection(id,issue),
      localQuestions:update=>{if(update.questionActivities)this.questions?.observe(update.request.threadEnvironmentId,update.request.threadId,update.questionActivities,update.sequence);},
      localFinalBody:async update=>rewriteReplyReferences(update.body,async reference=>{try{return await resolveReplyReference(this.app,reference,update.request,await this.inlineThreadAccess(update.request.threadEnvironmentId));}catch{return undefined;}}),
      connectionTimeout:(target,error)=>{if(this.connectionRecovery?.failed(this.connectionRecoveryTarget(target),error))this.recordSendFailure(undefined,error,'connection-timeout',Date.now()-error.elapsedMs);},
      connectionRecovered:target=>this.connectionRecovery?.recovered(this.connectionRecoveryTarget(target)),
      completionActor:this.deviceId,
      completionFailed:error=>new Notice(`T3 Code: ${message(error)}`,10000),
      loadStops:()=>{const value:unknown=this.app.loadLocalStorage(`t3-stopped-responses:${this.settings.vaultId}`);return Array.isArray(value)?value.filter((id:unknown):id is string=>typeof id==='string'):[];},
      saveStops:ids=>this.app.saveLocalStorage(`t3-stopped-responses:${this.settings.vaultId}`,ids),
      receiveCoordinated:(record,proof)=>{this.codebase?.observeSource(record.request,record.state?.notePath??record.request.notePath);return nativeResponses(this.app).receive(record,proof);},
      receiveDirect:update=>{this.inlineChat?.observeLocal(update);this.codebase?.observeSource(update.request);if(update.questionActivities)this.questions?.observe(update.request.threadEnvironmentId,update.request.threadId,update.questionActivities,update.sequence);return nativeResponses(this.app).stream(update);},
      receiveThreadTitle:(id,title)=>nativeResponses(this.app).title(id,title),
      readSaved:async path=>{const file=this.app.vault.getFileByPath(path);return file?this.app.vault.read(file):undefined;},
      access:(environmentId,reason)=>this.inlineThreadAccess(environmentId,reason==='auth-rejected'),
      resolveReplyReference:(reference,request,access)=>resolveReplyReference(this.app,reference,request,access)
    });
    this.addCommand({id:'stop-all-responses',name:'Stop all T3 responses in current note',editorCheckCallback:(checking,editor,view)=>{
      const file=view.file;if(this.stopped||!file||file.extension.toLowerCase()!=='md')return false;
      if(!checking)void this.inlineChat!.stopAllAt(editor,view,this.deviceInline?.stoppableResponses(file.path)).then(count=>new Notice(count?`Stopped ${count} T3 response${count===1?'':'s'} in this note.`:'No active or failed T3 responses in this note.')).catch(error=>new Notice(`T3: ${message(error)}`,10000));
      return true;
    }});
    this.app.workspace.onLayoutReady(()=>{
      const refresh=()=>{void this.refreshNoteCommandHost().then(()=>this.startThreadDisplays()).catch(error=>logFailure('commands.start',error));};
      refresh();void this.startThreadDisplays().catch(error=>logFailure('reply.follow.start',error));this.registerInlineInterval(refresh,5000);this.registerInlineInterval(()=>{void this.tickCommandHosts();},1000);
    });
    this.addCommand({id:'send-note-to-multiple-notes',name:'Send note with streaming destinations…',checkCallback:checking=>{
      const file=this.app.workspace.getActiveViewOfType(MarkdownView)?.file;if(!file||this.busy||threadNoteMode(this.settings.threadNoteMode)==='one-to-one')return false;
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
    const shineDocuments=new Map<Document,()=>void>();
    const watchShine=(root:Document)=>{if(root.body&&!shineDocuments.has(root))shineDocuments.set(root,installActivityShine(root));};
    if(typeof Reflect.get(document,'querySelectorAll')==='function')this.register(watchWorkspaceDocuments(this.app,root=>{
      const presentation=installResponsePresentation(root,setIcon);watchShine(root);
      const controls=installStreamBlockControls(this.app,root,setIcon,error=>new Notice(`T3: ${message(error)}`,10000),()=>this.openSettings(),async(id,view)=>{
        if(this.stopped||!view.file||this.deviceInline?.responseStatus(id)?.runTerminal)return;
        const hosted=this.deviceInline?.stoppableResponses(view.file.path).find(response=>response.id===id);
        await this.inlineChat!.stopAt(id,view.editor,view,hosted?.hostTarget);
      });
      return ()=>{controls();presentation();shineDocuments.get(root)?.();shineDocuments.delete(root);};
    }));
    this.register(()=>{for(const dispose of shineDocuments.values())dispose();shineDocuments.clear();});
    const questionStorage=`${this.localKey}-questions-${this.settings.vaultId}`;
    const questionResumeWarnings=new Set<string>();
    this.questions=new QuestionController(environmentId=>this.inlineThreadAccess(environmentId),{load:()=>{const saved:unknown=this.app.loadLocalStorage(questionStorage);return loadQuestionRecords(saved);},save:records=>this.app.saveLocalStorage(questionStorage,records)},randomId,()=>new Date().toISOString(),(target,follow)=>continueQuestionAnswer(target,follow,{
      ...deviceNoteIO(this.app),vaultId:this.settings.vaultId,owner:this.inlineActor,
      access:environmentId=>this.inlineThreadAccess(environmentId),bindings:()=>responseBindingRequests(this.settings.responseBindings??{}),
      notePaths:()=>[...this.questionPaths,...this.app.workspace.getLeavesOfType('markdown').map(leaf=>(leaf.view as MarkdownView).file?.path).filter((path):path is string=>!!path)],
      host:()=>this.inlineHostTarget(),policy:()=>resolveJobOptions(this.settings.inlineStreaming).inline,
      savedBodies:async request=>{const data=this.smartData(),bodies:string[]=[];for(const [id,record] of Object.entries(data.responses))if(id.startsWith(request.id+':')&&data.notes[record.noteId]?.path===request.notePath&&data.bodies[record.body])bodies.push(await unpackText(data.bodies[record.body]));return bodies;},
      followed:(request,requestId)=>!!this.deviceInline?.localResponse(request.id)?.record.state?.questionFollows?.some(item=>item.requestId===requestId&&item.replyTurnId),
      ownsQuestion:(request,requestId,turnId)=>!!this.deviceInline?.localResponse(request.id)?.record.state?.questionFollows?.some(item=>item.requestId===requestId&&item.turnId===turnId),
      blocked:(target,detail)=>{const key=JSON.stringify(target);if(!questionResumeWarnings.has(key)){questionResumeWarnings.add(key);new Notice(detail,12000);}},
      register:async request=>{if(!this.deviceInline||this.stopped)throw Error('Question streaming is unavailable.');await this.deviceInline.register(request);},allowed:()=>!this.stopped,
    }));
    const approvalStorage=`${this.localKey}-approvals-${this.settings.vaultId}`;
    this.approvals=new ApprovalController(environmentId=>this.inlineThreadAccess(environmentId),{load:()=>{const saved:unknown=this.app.loadLocalStorage(approvalStorage);return loadApprovalRecords(saved);},save:records=>this.app.saveLocalStorage(approvalStorage,records)},randomId);
    const questionPaths:unknown=this.app.loadLocalStorage(`${questionStorage}-paths`);if(Array.isArray(questionPaths))for(const path of questionPaths)if(typeof path==='string')this.questionPaths.add(path);
    let dismissalRevision=this.questions.dismissalRevision;
    this.questions.subscribe(()=>{if(dismissalRevision===this.questions!.dismissalRevision)return;dismissalRevision=this.questions!.dismissalRevision;void this.cleanDismissedQuestions();});
    if(typeof MutationObserver!=='undefined')this.register(watchWorkspaceDocuments(this.app,root=>installQuestionLinks(root,this.questions!,(target,button)=>{const view=this.app.workspace.getLeavesOfType('markdown').map(leaf=>leaf.view as MarkdownView).find(view=>view.containerEl.contains(button));this.openQuestion(target,view?.file?.path);})));
    if(typeof window!=='undefined'&&typeof window.addEventListener==='function')this.registerDomEvent(window,'pagehide',()=>{try{this.questions?.flushDrafts();}catch(error){logFailure('question.draft.flush',error);}});
    if(typeof this.registerEditorExtension==='function'){this.registerEditorExtension(hiddenInlineMarkerExtension());this.registerEditorExtension(questionEditorExtension(this.questions,(target,path)=>this.openQuestion(target,path)));this.registerEditorExtension(approvalEditorExtension(this.approvals));}
    if(typeof this.registerMarkdownPostProcessor==='function')this.registerMarkdownPostProcessor((element,ctx)=>{
      hideResponseContainerBoundaries(element,ctx);
      for(const link of Array.from(element.querySelectorAll<HTMLAnchorElement>('a[href^="t3-question:"]'))){
        const target=parseQuestionToken((link.getAttribute('href')??'').slice('t3-question:'.length));if(!target)continue;
        const control=questionButton(this.questions!,target,value=>this.openQuestion(value,ctx.sourcePath));link.replaceWith(control.button);
        const row=control.button.closest<HTMLElement>('[data-t3-question], blockquote');if(row)row.hidden=this.questions!.isHidden(target);
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
    this.sharedBaseline=JSON.stringify(this.sharedSnapshot());
    for(const request of [...this.settings.pending])await this.failRequest(request,Error('The previous send ended without a local confirmation.'),'startup-recovery',Date.now());
    const migrateConnection=(c:Connection):Connection=>{if(c.transport==='direct')return c;const paired=this.settings.paired.find(value=>value.environmentId===c.environmentId);return paired?{executable:'',host:'direct',transport:'direct',url:paired.url,connectionId:paired.id,environmentId:paired.environmentId}:c;};
    for(const request of this.settings.pending)request.connection=migrateConnection(request.connection);
    for(const job of this.settings.completionJobs){job.connection=migrateConnection(job.connection);if(retiredConnection(job.connection)&&job.status==='watching'){job.status='kept';job.detail='Kept note: the companion mode was removed. Check the original thread in T3.';}}
    this.settings.settlementJobs=this.settings.settlementJobs.filter(job=>job&&typeof job.requestId==='string'&&typeof job.messageId==='string'&&typeof job.threadId==='string'&&typeof job.projectId==='string'&&job.connection&&!retiredConnection(job.connection)).map(job=>({...job,connection:migrateConnection(job.connection)}));
    await this.initializeProjectCatalog();
    configureBridge({mobile:Platform.isMobile,access:environmentId=>this.inlineThreadAccess(environmentId),pairedSession:id=>this.sessionFor(id),saveRequest:async request=>{if(!this.settings.pending.includes(request))throw Error('Saved request is missing. Nothing was sent.');this.persistAgentCommand(request);await this.save();}});
    // Migrate unfinished desktop requests once, but do not rewrite the shared
    // settings file merely because this device started. Credentials and jobs
    // are device-local.
    await this.saveDeviceState();
    // A new vault must publish its stable identity before another device can
    // verify the same vault root. This is a one-time migration, not an
    // unconditional startup snapshot write, and uses the conflict-safe path.
    if(typeof data?.vaultId!=='string'||!data.vaultId)await this.save(true);
    else if(migratedNoteThreads||restoreFolderLinks||restoreResponseBindings||restoreSmartSend)await this.save(true);
    await this.publishVaultIdentity();
    this.settingsTab=new T3Settings(this.app,this);this.addSettingTab(this.settingsTab);
    this.app.workspace.onLayoutReady(()=>{
      if(this.stopped)return;
      if(Platform.isMobile&&typeof document!=='undefined'&&typeof this.registerDomEvent==='function'){
        const remember=(event:Event)=>{const target=event.target,title=target instanceof Element?target.closest('.nav-folder-title[data-path]'):null,path=title?.getAttribute('data-path');this.recentFolderGesture=path?{path,at:Date.now()}:undefined;};
        this.registerDomEvent(document,'pointerdown',remember,true);
        this.registerDomEvent(document,'touchstart',remember,true);
      }
      this.paletteChat=installPaletteChat(this.app,(prompt,selection,showSelector,source)=>this.openPaletteAction(prompt,selection,showSelector,source),{pluginId:this.manifest.id,onError:error=>new Notice(`T3 Code: ${message(error)}`,10000),getDraft:()=>this.localDraft(),saveDraft:draft=>this.app.saveLocalStorage(this.chatDraftKey,draft),captureSource:()=>this.capturePaletteSource()});
      this.registerInterval(window.setInterval(()=>this.paletteChat?.reconcile(),2000));
      if(typeof document!=='undefined'&&document.body&&typeof MutationObserver!=='undefined'){
        this.folderIndicators=installFolderIndicators(document.body,()=>this.settings.folderLinks,()=>{
          const responses=this.deviceInline?.explorerResponses()??[],known=new Set(responses.map(r=>r.id));
          const all=[...responses,...(this.inlineChat?.explorerResponses()??[]).filter(r=>!known.has(r.id))];
          const exists=(path:string)=>this.app.vault.getAbstractFileByPath(path) instanceof TFile;
          this.completionGlow?.observe(all,responseBindingRequests(this.settings.responseBindings??{}));
          const view=this.app.workspace.getActiveViewOfType(MarkdownView),doc=view?.containerEl.ownerDocument;
          this.completionGlow?.view(view?.file&&doc?.visibilityState==='visible'&&doc.hasFocus()&&view.containerEl.getClientRects().length&&!doc.querySelector('.modal-container')?view.file.path:undefined);
          const notes=noteIndicators(all,exists);
          return this.completionGlow?.project(notes,exists)??notes;
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
        this.registerEvent(this.app.workspace.on('file-open',()=>this.folderIndicators?.refresh()));
        this.registerEvent(this.app.workspace.on('active-leaf-change',()=>this.folderIndicators?.refresh()));
        this.registerDomEvent(document,'visibilitychange',()=>{this.completionGlow?.view(undefined);this.folderIndicators?.refresh();});
        this.registerDomEvent(window,'blur',()=>this.completionGlow?.view(undefined));
        this.registerDomEvent(window,'focus',()=>{this.folderIndicators?.refresh();void this.completionGlow?.refresh(true);});
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
        // Loaded editors reconnect immediately; recorded closed destinations
        // recover through a cached, serial background check.
        this.deviceInline?.resume();
        nextNativeRefresh=performance.now()+1000;
      };
      // Stream changes refresh their native projection directly.
      // Keep the local reply cadence, but avoid rebuilding every
      // unchanged native view at that rate. Workspace changes remain immediate.
      const queueNative=()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;refreshNative();});};
      this.registerEvent(this.app.workspace.on('layout-change',queueNative));
      this.registerEvent(this.app.workspace.on('file-open',queueNative));
      let lastResume=-Infinity,lastTick=Date.now();
      const resume=()=>{
        if(this.stopped||document.hidden)return;
        const now=performance.now();if(now-lastResume<250)return;lastResume=now;
        refreshNative();this.deviceInline?.resume();
      };
      if(typeof document.addEventListener==='function')this.registerDomEvent(document,'visibilitychange',()=>{if(!document.hidden)resume();});
      if(typeof window.addEventListener==='function'){this.registerDomEvent(window,'focus',resume);this.registerDomEvent(window,'online',resume);}
      const tick=()=>{
        const now=Date.now();if(now-lastTick>2000)resume();lastTick=now;
        if(performance.now()>=nextNativeRefresh)refreshNative();this.deviceInline?.tick();
      };
      tick();this.registerInlineInterval(tick,150);
    });
    this.registerEvent(this.app.workspace.on('file-open',()=>this.inlineChat?.flushAvailable()));
    this.registerEvent(this.app.workspace.on('layout-change',()=>this.inlineChat?.flushAvailable()));
    if(typeof this.app.vault?.on==='function'){
      const changed=(file:TAbstractFile)=>{this.deviceInline?.changed(file.path);void nativeResponses(this.app).changed(file.path).catch(error=>logFailure('note.projection.file-update',error,{notePath:file.path}));};
      this.registerEvent(this.app.vault.on('create',changed));this.registerEvent(this.app.vault.on('modify',changed));
      this.registerEvent(this.app.vault.on('delete',file=>{this.completionGlow?.relocate(file.path);this.deviceInline?.deleted(file.path);nativeResponses(this.app).deleted(file.path);this.folderIndicators?.refresh();}));
      this.registerEvent(this.app.vault.on('rename',(file,oldPath)=>this.inlineChat?.renamed(oldPath,file.path)));
      this.registerEvent(this.app.vault.on('rename',(file,oldPath)=>{if(file instanceof TFolder)void this.renameLinkedFolder(oldPath,file.path).catch(error=>new Notice(`T3 folder links: ${message(error)}`,10000));}));
      this.registerEvent(this.app.vault.on('rename',(file,oldPath)=>{this.completionGlow?.relocate(oldPath,file.path);nativeResponses(this.app).renamed(oldPath,file.path);this.deviceInline?.renamed(oldPath,file.path);}));
      this.registerEvent(this.app.vault.on('delete',file=>{this.inlineChat?.deleted(file.path);this.questionPaths.delete(file.path);}));
      this.registerEvent(this.app.vault.on('modify',file=>{if(file instanceof TFile&&file.extension==='md')void this.app.vault.read(file).then(text=>{if(questionTargets(text).length||approvalTargets(text).length)this.questionPaths.add(file.path);}).catch(()=>{});}));
      this.registerEvent(this.app.vault.on('rename',(file,oldPath)=>{for(const path of [...this.questionPaths])if(path===oldPath||path.startsWith(oldPath+'/')){this.questionPaths.delete(path);this.questionPaths.add(file.path+path.slice(oldPath.length));}}));
      this.registerEvent(this.app.vault.on('rename',(file,oldPath)=>{void this.relocateNoteThreads(oldPath,file.path,file instanceof TFolder).catch(error=>new Notice(`T3 thread history: ${message(error)}`,10000));}));
      this.registerEvent(this.app.vault.on('delete',file=>{void this.relocateNoteThreads(file.path,undefined,file instanceof TFolder).catch(error=>new Notice(`T3 thread history: ${message(error)}`,10000));}));
    }
    this.registerEvent(this.app.workspace.on('file-menu',(menu,file,source) => {
      if(file instanceof TFolder){
        const folder=this.folderForMenu(file);
        if(folder.path==='/')return;
        menu.addItem(item=>{
          item.setTitle('Link to T3 Code').setIcon('link');
          const submenu=(item as MenuItem&{setSubmenu?:()=>Menu}).setSubmenu?.();
          if(!submenu){item.onClick(()=>new FolderLinkProjectModal(this.app,this,folder).open());return;}
          const projects=this.projects();
          for(const project of projects)submenu.addItem(i=>i.setTitle(`Link to ${this.projectChoiceLabel(project)}`).onClick(()=>void this.linkFolder(folder,project,false)));
          submenu.addSeparator();
          submenu.addItem(i=>i.setTitle('Create T3 project…').onClick(()=>void this.createFolderProject(folder)));
          submenu.addItem(i=>i.setTitle('Unlink').setIcon('unlink').setDisabled(!this.settings.folderLinks.some(link=>link.folderPath===folder.path)).onClick(async()=>{
            try{await this.unlinkFolder(folder.path);new Notice(`${folder.path} unlinked from T3 Code.`);}
            catch(error){new Notice(`T3 folder links: ${message(error)}`,10000);}
          }));
          if(!projects.length)submenu.addItem(i=>i.setTitle(this.connecting?'Discovering projects…':'No projects found. Connect T3 to discover projects.').setDisabled(true));
        });
        return;
      }
      if (!(file instanceof TFile) || file.extension.toLowerCase() !== 'md' || (!Platform.isMobile && source !== 'file-explorer-context-menu')) return;
      menu.addItem(item => {
        item.setTitle('Send to agent').setIcon('send');
        item.setDisabled(this.busy||this.defaultSending).onClick(event=>this.openNoteSend(file,Boolean(event?.ctrlKey)));
      });
      menu.addItem(item=>item.setTitle('Ask agent…').setIcon('message-circle').setDisabled(this.busy||this.defaultSending).onClick(()=>this.openAsk(file)));
      if(Platform.isMobile)menu.addItem(item=>item.setTitle('Send to agent: choose destination…').setIcon('send').setDisabled(this.busy||this.defaultSending).onClick(()=>this.openNoteSend(file,true)));
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
      if(selection.trim())try{captured=this.canonicalChatContext({editor,view,anchor:captureEditorSelection(editor)});}catch{/* A stale selection leaves the normal note-wide chooser available. */}
      for(const id of cursorId?[cursorId]:ids){
        if(this.deviceInline?.responseStatus(id)?.runTerminal)continue;
        const failed=active.find(job=>job.id===id)?.phase==='error'||failedInlineIds(editor.getValue()).includes(id);
        const label=/^(?:> \[!t3-progress\][+-] )?\*\*(.+) · (?:Sending…?|Working|Reconnecting|Error)\*\*/m.exec(regionBody(editor.getValue(),id)?.body??'')?.[1];
        const suffix=ids.length>1?` (${label&&label!=='T3'?label+' · ':''}${id.slice(0,8)})`:'';
        if(failed){
          menu.addItem(item=>item.setTitle('Continue T3 response'+suffix).setIcon('rotate-cw').setDisabled(this.busy).onClick(()=>this.continueInline(id,file.path).catch(error=>new Notice(`T3: ${message(error)}`,10000))));
          menu.addItem(item=>item.setTitle('Attach latest T3 continuation'+suffix).setIcon('link').setDisabled(this.busy).onClick(()=>{void this.attachInline(id,file.path).catch(error=>new Notice(`T3: ${message(error)}`,10000));}));
        }else {if(captured)menu.addItem(item=>item.setTitle('Ask T3 in this response'+suffix).setIcon('message-circle').onClick(event=>this.openEditorChat(selection,file,{editor,view,...captured,responseId:id},Boolean(event?.ctrlKey))));}
        menu.addItem(item=>item.setTitle('Stop T3 response'+suffix).setIcon('square').onClick(()=>{void this.inlineChat!.stopAt(id,editor,view).catch(error=>new Notice(`T3: ${message(error)}`,10000));}));
      }
      menu.addItem(item=>item.setTitle('Ask agent…').setIcon('message-circle').setDisabled(this.busy||this.defaultSending).onClick(()=>this.openAsk(file,selection,{editor,view,...captured})));
      if(!captured)return;
      menu.addItem(item=>item.setTitle('Send to agent').setIcon('message-circle').setDisabled(this.busy||this.defaultSending).onClick(event=>void this.openManualAction(file,'',selection,{editor,view,...captured},Boolean(event?.ctrlKey))));
      if(Platform.isMobile)menu.addItem(item=>item.setTitle('Send to agent: choose destination…').setIcon('message-circle').setDisabled(this.busy||this.defaultSending).onClick(()=>void this.openManualAction(file,'',selection,{editor,view,...captured},true)));
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
  private openQuestion(target:QuestionTarget,notePath=this.app.workspace.getActiveFile()?.path){
    if(!this.questions||this.questions.isDismissed(target))return;
    this.questionModal?.close();this.questionModal=new QuestionModal(this.app,this.questions,target,notePath);this.questionModal.open();
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
      await this.questions.recoverAnswerStreams();
      for(const [path,targets] of notes){
        const resolved=targets.filter(target=>this.questions!.view(target).status==='resolved'&&!this.questions!.isDismissed(target)&&!this.questions!.record(target).answerFollow);
        if(resolved.length)await io.updateNote(path,current=>resolved.reduce((text,target)=>clearResolvedQuestion(text,target),current),()=>!this.stopped);
      }
      for(const [path,targets] of approvalNotes){
        const resolved=targets.filter(target=>this.approvals!.view(target).status==='resolved');
        if(resolved.length)await io.updateNote(path,current=>resolved.reduce((text,target)=>clearApprovalControls(text,target),current),()=>!this.stopped);
      }
      this.app.saveLocalStorage(`${this.localKey}-questions-${this.settings.vaultId}-paths`,[...this.questionPaths]);
    }catch{/* Notes, authentication, and Sync are retried on the next refresh. */}finally{this.refreshingQuestions=false;}
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


  private async displayResponseBindings(target:EventTarget){
    return responseBindingRequests(this.settings.responseBindings??{}).filter(request=>request.threadId===target.threadId&&request.projectId===target.projectId&&request.threadEnvironmentId===target.environmentId).map(request=>({
      id:request.id,path:request.notePath,messageIds:[request.messageId,...(request.localMessageId?[request.localMessageId]:[]),...request.localSteering?.map(input=>input.messageId)??[]],
      turnIds:[...(request.importTurn?[request.importTurn.turnId]:[]),...this.deviceInline?.cachedResponse(request.id)?.record.state?.turnIds??[]]
    }));
  }

  async executeAgentCommand(raw:unknown,route?:CommandRoute){
    const input=validateAgentCommand(raw);
    if(isNoteEditCommand(input)){if(!route)throw Error('Use the authenticated T3 Connect edit route.');return this.checkedEdits().execute(input,route);}
    if(isNoteContextCommand(input)){
      const latest=await this.loadSettings();
      const root=(this.app.vault.adapter as {getFullPath?:(path:string)=>string}).getFullPath?.('');
      return noteContext(input,mergeNoteContexts(this.settings.noteContexts,latest?.noteContexts),responseBindingRequests(mergeResponseBindingData(this.settings.responseBindings,latest?.responseBindings)),{name:this.app.vault.getName(),id:this.settings.vaultId,...(root?{workspaceRoot:root}:{})});
    }
    if(isRecoveryCommand(input)){
      const binding=responseBindingRequests(this.settings.responseBindings??{}).find(request=>request.id===input.bindingId&&request.localOnly);
      if(!binding||!this.deviceInline)throw Error('This reply is unavailable on this client.');
      const current=await deviceNoteIO(this.app).readNote(binding.notePath);if(current===undefined)throw Error('The response note is unavailable.');
      const frozen=this.deviceInline.frozenBody(binding.id)??nativeResponses(this.app).stoppedBody(binding.id)??(await nativeStoppedStore(this.deviceId,this.settings.vaultId).readAll([binding.id]))[0]?.body;
      if(input.kind==='response-recovery-info'){
        const proposed=frozen??this.deviceInline.cachedResponse(binding.id)?.record.state?.body??'';
        return {id:input.id,ok:true,recovery:{id:binding.id,notePath:binding.notePath,currentHash:contentHash(current),proofHash:contentHash(proposed),proposedHash:binding.localStage?.stagedHash??contentHash(proposed),proposedCharacters:proposed.length}};
      }
      const result=await this.deviceInline.retrySave(binding,input.hash!,frozen);
      return {id:input.id,ok:true,status:result.saved?'saved':'pending',...result};
    }
    if(isClientCommand(input)){
      if(!this.clientMaintenance||this.stopped)throw Error('Client maintenance is unavailable.');
      const result=await this.clientMaintenance.execute(input);
      if(input.kind==='send-failure-log')return {...result,failureLog:sendFailureLog(this.app.loadLocalStorage(this.failureKey()),result.client!.loadedVersion,this.deviceId,input.since)};
      return input.kind==='client-status'?{...result,commandServer:{transport:'t3-connect',connected:this.commandHosts.size},connectionRecovery:this.connectionRecovery?.status(),codeRangeCache:markdownCodeCacheStatus(),legacyRepliesRetired:true}:result;
    }
    if(isResponseCommand(input)){
      const command=validateResponseCommand(input);
      if(command.kind==='response-import-records'||command.kind==='response-import-info')return this.executeImportRead(command,await this.inlineHostTarget());
      if(command.kind==='close-stream-block'){
        const {removeStreamBlock}=await import('../responses/stream-block');
        const io=deviceNoteIO(this.app),result=await io.updateNote(command.notePath,document=>removeStreamBlock(document,command.foldKey,command.hash).text,()=>!this.stopped);
        return {id:command.id,ok:true,closed:result!==undefined};
      }
      const binding=responseBindingRequests(this.settings.responseBindings??{}).find(request=>request.id===command.bindingId);
      if(!binding)throw Error('This legacy reply was cancelled; it cannot resume.');
      if(command.kind==='response-status')return {id:command.id,ok:true,status:this.deviceInline?.responseStatus(binding.id)};
      if(command.kind==='resume-response'){await this.deviceInline!.register(binding);return {id:command.id,ok:true,resumed:true};}
      if(command.kind==='remove-response'){await this.deviceInline!.stopResponse(binding.host,binding.id,'');return {id:command.id,ok:true,removed:true};}
      if(command.kind==='resolve-response-location'){
        const document=await deviceNoteIO(this.app).readNote(command.notePath!);if(document===undefined||contentHash(document)!==command.hash)throw Error('The reviewed note changed.');
        await this.deviceInline!.register({...binding,notePath:command.notePath!});return {id:command.id,ok:true,notePath:command.notePath};
      }
      throw Error('Legacy reply maintenance was retired. Use the local reply or import the T3 run again.');
    }
    if(isFolderCommand(input)){
      if(this.stopped||this.busy)throw Error('Obsidian is unavailable or sending another request.');
      this.busy=true;
      try{return await executeFolderCommand(input,{
        vaultId:this.settings.vaultId,links:()=>this.settings.folderLinks,
        validateFolder:path=>{this.commandFolder(path);},refresh:()=>this.checkExternalSettings(),
        resolve:command=>this.folderCommandProject(command),
        read:id=>deviceState<import('../projects/folder-command').FolderCommandJournal>(`folder-command:${this.deviceId}:${this.settings.vaultId}:${id}`),
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
    if(isThreadCommand(input)){await this.startThreadDisplays();return this.threadDisplays!.command(input);}
    return this.executeNoteCommand(input);
  }
  private commandFolder(path:string):TFolder {
    if(this.stopped)throw Error('The plugin was disabled before linking the folder.');
    const folder=path==='/'?this.app.vault.getRoot():this.app.vault.getAbstractFileByPath(path);
    if(!(folder instanceof TFolder))throw Error('Folder not found in the requested vault.');
    return folder;
  }
  private async folderCommandProject(command:Extract<FolderCommand,{kind:'link-folder'}>):Promise<Project>{
    const paired=this.settings.paired.find(connection=>connection.id===command.connectionId)??this.settings.paired.find(connection=>connection.environmentId===command.environmentId);
    if(!paired||paired.environmentId!==command.environmentId)throw Error('Pair the exact folder destination through T3 Connect.');
    const local=localRoute(paired);
    const connection:Connection={transport:'direct',host:'direct',executable:'',url:paired.url,connectionId:paired.id,environmentId:paired.environmentId};
    const reply=await runBridge(connection,['projects']);
    if(isRecord(reply)&&reply.cached)throw Error('The destination is offline. Linking requires verified live project metadata.');
    const project=parseProjects(reply).find(project=>project.id===command.projectId);
    if(!project||!project.workspaceRoot.trim())throw Error('The requested project is unavailable on that connection and environment.');
    if(command.mode==='self'){
      let workspaceRoot:string;
      if(local){
        const root=this.localVaultPath(command.folderPath==='/'?'':command.folderPath);
        if(!root)throw Error('This vault does not expose a local filesystem path.');
        workspaceRoot=root;
      }else{
        const root=this.vaultConnection();
        const rootEnvironment=root?.environmentId??this.settings.paired.find(c=>c.id===root?.connectionId)?.environmentId;
        if(!root||rootEnvironment!==command.environmentId)throw Error('Self mode requires the selected machine to be the verified vault connection machine.');
        const remote=await connectVaultRemote(connection,await this.sessionFor(paired.id));
        try{
          if(!await remote.matches(root.workspaceRoot,`${this.app.vault.configDir}/plugins/${this.manifest?.id||'send-to-t3-code'}/data.json`,this.settings.vaultId))throw Error('The destination vault no longer matches the requested vault.');
          const separator=root.workspaceRoot.includes('\\')&&!root.workspaceRoot.includes('/')?'\\':'/';
          workspaceRoot=command.folderPath==='/'?root.workspaceRoot:root.workspaceRoot.replace(/[\\/]+$/,'')+separator+command.folderPath.replace(/\//g,separator);
          if(!sameWorkspacePath((await remote.browse(workspaceRoot)).parentPath,workspaceRoot))throw Error('The folder has not reached the vault connection machine. Let Sync finish before retrying.');
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
    try{await this.saving.catch(()=>{});const data=await this.loadSettings(),serialized=JSON.stringify(data);if(serialized!==this.lastDiskSnapshot)await this.onExternalSettingsChange();}
    finally{this.checkingExternalSettings=false;}
  }
  async onExternalSettingsChange(loaded?:unknown){
    await this.saving.catch(()=>{});
    const data=storedSettings(loaded??await this.loadSettings());if(this.stopped||!data)return;
    this.lastDiskSnapshot=JSON.stringify(data);
    const baseline=parseJson(this.sharedBaseline) as SharedSettings,remote=this.sharedData(data);
    const adopted=mergeSharedSettings(baseline,remote,this.sharedSnapshot());
    adopted.vaultHost=mergeVaultHost(baseline.vaultHost,remote.vaultHost,this.settings.vaultHost);
    const incomingBindings=loadResponseBindingData(data.responseBindings);
    const previousBindings=JSON.stringify(this.responseBindingReplica);
    Object.assign(this.smartReplica,mergeSmartSend(this.smartReplica,data.smartSend,this.settings.smartSend));this.settings.smartSend=this.smartReplica;await deviceState(`smart-send:${this.deviceId}:${this.settings.vaultId}`,this.smartReplica);
    this.responseBindingReplica=mergeResponseBindingData(this.responseBindingReplica,incomingBindings);
    this.settings.responseBindings=this.responseBindingReplica;
    this.settings.noteContexts=mergeNoteContexts(this.settings.noteContexts,data.noteContexts);
    const restoreNoteContexts=JSON.stringify(mergeNoteContexts(data.noteContexts))!==JSON.stringify(this.settings.noteContexts);
    const restoreResponseBindings=JSON.stringify(incomingBindings)!==JSON.stringify(this.responseBindingReplica);
    await deviceState(`response-bindings:${this.deviceId}:${this.settings.vaultId}`,this.responseBindingReplica);
    this.settings.threadNoteMode=threadNoteMode(adopted.threadNoteMode);
    const adopt=<K extends keyof SharedSettings>(key:K)=>{const target:SharedSettings=this.settings;target[key]=adopted[key];};
    for(const key of ['inlineStreaming','vaultHost','completion','threadTitleGeneration','replyFolders','codebase','projectCreationLocations'] as const)adopt(key);
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
    if(JSON.stringify(data.smartSend)!==JSON.stringify(this.smartReplica)||restoreFolderLinks||restoreResponseBindings||restoreNoteContexts||JSON.stringify(mergedThreads)!==JSON.stringify(remoteThreads))await this.save(restoreFolderLinks||restoreResponseBindings||restoreNoteContexts);
    if(previousBindings!==JSON.stringify(this.responseBindingReplica))this.deviceInline?.localBindingsChanged();
    this.refreshFolderIndicators();
  }
  private async publishVaultIdentity():Promise<void>{
    const files=this.app.vault?.adapter;
    if(!files||typeof files.exists!=='function'||typeof files.read!=='function'||typeof files.mkdir!=='function'||typeof files.write!=='function')return;
    try{await ensureVaultIdentityRecord(files,this.app.vault.configDir,this.settings.vaultId);}
    catch(error){new Notice(`Could not publish the T3 vault identity: ${message(error)}`,10000);}
  }
  openSettings(){
    const settings=(this.app as App & {setting?:{open():void;openTabById(id:string):void}}).setting;
    if(settings){
      this.settingsTab?.showConnection();settings.open();settings.openTabById(this.manifest.id);
    }
    else new Notice('Open Settings → T3 Code to sign in.');
  }
  chatReadinessError():string|undefined {
    if(this.stopped)return 'The plugin has been disabled. Re-enable it before sending.';
    const hasDeviceSession=this.settings.paired.some(c=>{const session=this.pairedSessions[c.id];return session?.environmentId===c.environmentId&&session.url===c.url&&session.expiresAt>Date.now()+5000;});
    if(hasDeviceSession)return;
    if(this.signInExpired)return REAUTHENTICATE_MESSAGE;
    if(this.connecting)return 'T3 is still connecting your computers. Wait for connection sync to finish.';
    if(this.nativeAccount&&!this.connectionSyncComplete)return 'T3 has not connected on this device. Check the sign-in status in T3 Code settings.';
    if(!this.nativeAccount)return 'Sign in to T3 on this device first. Synced project names do not sign this device in.';
  }
  private chatNote():{path:string;absolutePath?:string}|undefined {
    const file=this.app.workspace.getActiveViewOfType(MarkdownView)?.file??this.app.workspace.getActiveFile();
    if(!file||file.extension.toLowerCase()!=='md')return;
    return this.noteContext(file);
  }
  private localVaultPath(path=''){
    const adapter=this.app.vault.adapter;if(Platform.isMobile||!(adapter instanceof FileSystemAdapter))return;
    const root=adapter.getBasePath(),separator=root.includes('\\')&&!root.includes('/')?'\\':'/';
    return root.replace(/[\\/]+$/,'')+(path?separator+path.replace(/[\\/]+/g,separator):'');
  }
  private noteContext(file:TFile):{path:string;absolutePath?:string} {
    const absolutePath=this.localVaultPath(file.path);return {path:file.path,...(absolutePath?{absolutePath}:{})};
  }
  private modeRelations(localEnvironment=this.eventLocalEnvironmentId){
    return this.noteThreadRelations().map(entry=>({...entry,environmentId:entry.environmentId??(this.settings.paired??[]).find(connection=>connection.id===entry.connectionId)?.environmentId??(!entry.connectionId?localEnvironment:undefined)}));
  }
  private noteThreadRelations(){return resolveNoteThreadPaths(this.settings.noteThreads,this.settings.smartSend?.notes??{}).filter(entry=>entry.noteId||!this.app?.vault?.getFileByPath||!!this.app.vault.getFileByPath(entry.notePath));}
  private async relocateNoteThreads(before:string,after?:string,folder=false){
    const affected=(path:string)=>path===before||folder&&path.startsWith(before+'/'),data=this.smartData();
    if(!this.settings.noteThreads.some(entry=>!entry.deletedAt&&affected(entry.notePath))&&!Object.values(data.notes).some(note=>!note.deleted&&affected(note.path)))return;
    this.settings.noteThreads=bindNoteThreadIds(this.settings.noteThreads,data.notes);
    moveSmartNotes(data,before,after,folder);
    this.settings.noteThreads=mutateNoteThreads(this.settings.noteThreads,before,after,folder);
    await this.save();
  }
  private noteThread(path?:string){return path?lastUsedNoteThread(threadNoteMode(this.settings.threadNoteMode)==='one-to-one'?oneToOneNoteThreads(this.modeRelations()):this.noteThreadRelations(),path):undefined;}
  private async assertNoteMode(notePath:string|undefined,target:ModeThread,destinations:string[]=[]){
    if(threadNoteMode(this.settings.threadNoteMode)!=='one-to-one')return;
    if(!target.environmentId&&!target.connectionId)target={...target,environmentId:await this.localInlineEnvironment()};
    assertThreadNoteMode('one-to-one',this.modeRelations(!target.connectionId?target.environmentId:undefined),notePath,target,destinations);
  }
  private async confirmModeRelation(target:EventTarget,paths:string[]){
    if(threadNoteMode(this.settings.threadNoteMode)!=='one-to-one'||!paths.length)return;
    await this.assertNoteMode(undefined,target,paths);
    if(paths.every(path=>this.noteThread(path)))return;
    if(this.busy)throw Error('A send is in progress. Thread streaming will retry.');
    const project=await this.recoveryProject(target.projectId,target.environmentId);
    await this.assertNoteMode(undefined,target,paths);
    if(this.busy)throw Error('A send is in progress. Thread streaming will retry.');
    for(const path of paths)this.rememberNoteThread(this.noteThreadIntent(path,project,{...this.connection(project),environmentId:target.environmentId}),target.threadId);
    await this.save(true);
  }
  private async assertRequestMode(request:Request){
    const destinations=[...new Set([
      ...(request.inlineBindings??(request.inlineHost?[request.inlineHost]:[])).map(binding=>binding.notePath),
      ...(request.inlineSteering?.targets??[]).map(target=>target.notePath),
      ...(request.inlineFollow?.notePath?[request.inlineFollow.notePath]:[]),
    ])];
    await this.assertNoteMode(request.noteThread?.notePath??request.noteLink?.notePath,{...request.connection,projectId:request.project.id,threadId:request.threadId},destinations);
  }
  private async availableModeThreads(path:string|undefined,project:Project,threads:ThreadChoice[]){
    if(threadNoteMode(this.settings.threadNoteMode)!=='one-to-one')return threads;
    const connection=this.connection(project);
    if(!connection.environmentId&&!connection.connectionId)connection.environmentId=await this.localInlineEnvironment();
    return threads.filter(thread=>{try{assertThreadNoteMode('one-to-one',this.modeRelations(),path,{...connection,projectId:project.id,threadId:thread.id});return true;}catch{return false;}});
  }
  private smartData(){
    if(this.settings.smartSend!==this.smartReplica)Object.assign(this.smartReplica,mergeSmartSend(this.smartReplica,this.settings.smartSend));
    this.settings.smartSend=this.smartReplica;return this.smartReplica;
  }
  private async smartKey(project:Project,connection:Connection,threadId:string){
    if(!connection.environmentId)connection.environmentId=connection.connectionId?this.settings.paired.find(c=>c.id===connection.connectionId)?.environmentId:await this.localInlineEnvironment();
    return smartDestination(connection.environmentId??connection.connectionId??'local',project.id,threadId);
  }
  private hasConfirmedNoteSend(path?:string):boolean {
    if(!path)return true;
    const data=this.smartData();
    return Object.values(data.heads).some(head=>{const note=data.notes[head.noteId];return note?.path===path&&!note.deleted;});
  }
  private async hasSmartContent(file:TFile,destination:ChatDestination,context?:EditorChatContext){
    if(context?.smartQuestion?.trim()||context?.referenceSelection||context?.smartScope&&context.smartScope[1]>context.smartScope[0])return true;
    if(!file)return true;
    const selected=isNoProjectKey(destination.projectKey)?this.noProjectProjects.get(noProjectMachine(destination.projectKey!)??this.defaultNoProjectMachine()??''):undefined;
    const project=selected??[...this.settings.projects,...this.settings.directProjects].find(project=>projectKey(project)===destination.projectKey);
    if(!project)return true;
    const active=this.app.workspace.getActiveViewOfType(MarkdownView);
    const document=context?.smartDocument??(active?.file?.path===file.path?this.notePromptDocument(active):await this.app.vault.read(file));
    await this.recoverSmartReplies(file.path,document);
    return !!(await prepareSmartSend(this.smartData(),file.path,await this.smartKey(project,this.connection(project),destination.threadId??''),document,context?.smartScope)).text.trim();
  }
  private async recoverSmartReplies(path:string,document:string){

    const data=this.smartData(),bindings=responseBindingRequests(this.settings.responseBindings??{}).filter(request=>request.notePath===path&&!hasResponseMarkers(document,request.id)&&!Object.keys(data.responses).some(id=>id.startsWith(request.id+':')));
    const sources=new Map<string,{environment:string;project:string;thread:string}>();
    for(const request of bindings)sources.set(JSON.stringify([request.threadEnvironmentId,request.projectId,request.threadId]),{environment:request.threadEnvironmentId,project:request.projectId,thread:request.threadId});
    if(document.includes('send-to-t3-fold-key'))for(const entry of previousNoteThreads(this.settings.noteThreads,path)){
      if(!document.includes(entry.threadId))continue;
      const environment=entry.environmentId??this.settings.paired.find(c=>c.id===entry.connectionId)?.environmentId??(!entry.connectionId?await this.localInlineEnvironment():undefined);
      if(environment)sources.set(JSON.stringify([environment,entry.projectId,entry.threadId]),{environment,project:entry.projectId,thread:entry.threadId});
    }
    for(const [source,identity] of sources){
      const key=path+'\0'+source;if(this.smartRecovered.has(key))continue;
      let work=this.smartRecovering.get(key);
      if(!work){work=(async()=>{
        const access=await this.inlineThreadAccess(identity.environment);
        try{
          const snapshot=await readInlineSnapshot(access,identity.thread,identity.project,undefined,true);
          const state=applyThreadItem({messages:[],activities:[]},{kind:'snapshot',snapshot}).state;
          let changed=false;
          for(const message of state.messages){
            if(message.role!=='assistant'||message.streaming||!message.text.trim())continue;
            for(const body of new Set([quoteResponse(message.text.trim()),escapeReplyHtml(message.text.replace(/\n+$/,''))])){
              let at=document.indexOf(body);if(at<0)continue;
              // A canonical response must occupy complete lines. Words inside
              // ordinary prose or code examples do not establish provenance.
              if(at>0&&document[at-1]!=='\n'||at+body.length<document.length&&document[at+body.length]!=='\n')continue;
              if(document.indexOf(body,at+body.length)>=0)continue;
              changed=!!await rememberResponse(this.smartData(),path,`history:${identity.thread}:${message.id}`,body,document.slice(0,at),document.slice(at+body.length),at)||changed;
            }
          }
          if(changed)await this.save(true);this.smartRecovered.add(key);
        }finally{await access.close?.();}
      })();this.smartRecovering.set(key,work);void work.finally(()=>this.smartRecovering.delete(key)).catch(()=>{});}
      await work;
    }
  }

  private openAsk(file:TFile,selection='',captured?:EditorChatContext,choose=false){
    const active=this.app.workspace.getActiveViewOfType(MarkdownView);
    const view=captured?.view??(active?.file?.path===file.path?active:undefined);
    if(view?.editor&&!captured)captured={view,editor:view.editor};
    if(captured&&selection.trim()&&!captured.anchor)captured={...captured,anchor:captureEditorSelection(captured.editor)};
    if(captured&&!captured.anchor)captured={...captured,insertion:captured.insertion??captureCursorInsertion(captured.editor.getValue(),captured.editor.posToOffset(captured.editor.getCursor()))};
    const context=captured?this.canonicalChatContext(captured):undefined;
    new AskComposer(this.app,file.path,this.localDraft(),text=>this.app.saveLocalStorage(this.chatDraftKey,text),(question,selected)=>this.openManualAction(file,question,selection,context,choose||selected)).open();
  }
  private previousNoteThread(path:string,threadId:string){return previousNoteThreads(this.noteThreadRelations(),path).find(entry=>entry.threadId===threadId);}
  private projectForNoteThread(entry:NoteThread):Project{
    const candidates=[...this.settings.directProjects,...this.settings.projects].filter(item=>item.id===entry.projectId&&sameWorkspacePath(item.workspaceRoot,entry.workspaceRoot)&&(!Platform.isMobile||Boolean(item.connectionId)));
    const sameConnection=entry.connectionId?candidates.find(item=>item.connectionId===entry.connectionId):undefined;
    const connected=candidates.filter(item=>item.connectionId&&this.settings.paired.some(connection=>connection.id===item.connectionId&&(!entry.environmentId||connection.environmentId===entry.environmentId)));
    const sameEnvironment=entry.environmentId?candidates.find(item=>this.settings.paired.find(connection=>connection.id===item.connectionId)?.environmentId===entry.environmentId):undefined;
    const project=sameConnection??sameEnvironment??(connected.length===1?connected[0]:candidates.length===1?candidates[0]:undefined);
    if(!project)throw Error('The last used thread’s T3 project is unavailable on this device. Reconnect that project or choose another thread.');
    return project;
  }
  private noteThreadIntent(path:string,project:Project,connection:Connection):NonNullable<Request['noteThread']>{
    return {notePath:path,noteId:smartNote(this.smartData(),path,this.noteThread(path)?.noteId),projectId:project.id,workspaceRoot:project.workspaceRoot,connectionId:project.connectionId??'',...(connection.environmentId?{environmentId:connection.environmentId}:{})};
  }
  private rememberNoteThread(remembered:NonNullable<Request['noteThread']>,threadId:string){
    const selectedAt=new Date().toISOString(),updatedAt=new Date(Math.max(Date.now(),...this.settings.noteThreads.map(entry=>Date.parse(entry.updatedAt??entry.deletedAt??entry.selectedAt)+1).filter(Number.isFinite))).toISOString();
    this.settings.noteThreads=mergeNoteThreads(this.settings.noteThreads,[{...remembered,threadId,selectedAt,updatedAt}]);
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
  private noteSendInsertion(file:TFile):CursorInsertion|null {
    const view=this.app.workspace.getActiveViewOfType(MarkdownView);
    if(view?.file?.path!==file.path||!view.editor||view.getMode?.()==='preview')return null;
    const cursor=view.editor.posToOffset(view.editor.getCursor()),adapter=nativeResponses(this.app).view(view);
    if(!adapter)return captureCursorInsertion(view.editor.getValue(),cursor);
    const position=adapter.mapSelection(cursor,cursor).from;
    const offset=position.kind==='saved'?position.offset:adapter.currentProjection().ranges.find(range=>range.id===position.id)?.savedTo;
    if(offset===undefined)throw Error('The response at the send cursor changed. Send again from the desired position.');
    return captureCursorInsertion(adapter.saved(),offset);
  }
  async openNoteSend(file:TFile,showSelector=false,insertion=this.noteSendInsertion(file)){
    const finishPreview=!showSelector&&this.hasConfirmedNoteSend(file.path)?this.previewSend(file.path,undefined,insertion):()=>{};
    try{

    const host:ChatHost=this.withSendAvailability({...this.destinationContext(this.noteContext(file)),
      beginSend:options=>this.previewSend(file.path,undefined,insertion,options.inline.enabled),
      hasNewContent:(destination)=>this.hasSmartContent(file,destination),
      sendChat:(_text,key,resolve,_back,destination)=>this.sendNote(file,destination?.threadId,destination?.projectKey,false,key,resolve?.(),insertion),
      sendToNew:(_text,key,resolve)=>this.sendNote(file,undefined,undefined,true,key,resolve?.(),insertion),
      sendToExisting:(_text,key,resolve,back)=>this.openNoteThreads(file,key,resolve,back,insertion),
    });
    return await openNoteSendFlow(this.app,host,showSelector);
    }catch(error){new Notice(`T3 Code: ${message(error)}`,10000);}finally{finishPreview();}
  }
  async openNoteThreads(file:TFile,overrideKey?:string,resolve?:()=>ResolvedJobOptions,back?:()=>void,insertion=this.noteSendInsertion(file)){
    if(this.busy)return;
    try{
      const target=await this.existingTarget(file.path,overrideKey);
      if(!target){new ExistingThreadModal(this.app,[],async()=>{},'Existing threads','No project exists for this folder yet. Use New thread.',back).open();return;}
      const {project}=target;
      const readiness=this.projectReadinessError(project);if(readiness)throw Error(readiness);
      new Notice('Loading threads…',2000);
      const threads=await this.availableModeThreads(file.path,project,projectThreads(await runBridge(this.connection(project),['threads','--project',project.id]),project.id));
      if(this.stopped)return;
      new ExistingThreadModal(this.app,threads,thread=>this.sendNote(file,thread.id,projectKey(project),false,overrideKey,resolve?.(),insertion),undefined,undefined,back).open();
    }catch(error){if(back)throw error;new Notice(`T3 Code: ${message(error)}`,10000);}
  }
  openRunImport(file:TFile){
    if(this.stopped||this.busy)return;
    const insertion=this.noteSendInsertion(file);
    const catalogs=new WeakMap<ImportRun,ImportRun[]>();
    const read=async<T>(project:Project,operation:(access:ThreadAccess,environmentId:string)=>Promise<T>)=>{
      const environmentId=this.connection(project).environmentId??await this.localInlineEnvironment(),access=await this.inlineThreadAccess(environmentId);
      try{return await operation(access,environmentId);}finally{await access.close?.();}
    };
    openRunImport(this.app,file.path,{
      projects:()=>this.projects(),projectLabel:project=>this.projectChoiceLabel(project),
      threads:(project,signal)=>read(project,async access=>this.availableModeThreads(file.path,project,await readImportThreads(access,project.id,signal))),
      runs:async(project,thread,signal)=>{const runs=await read(project,access=>readImportRuns(access,thread.id,project.id,signal));for(const run of runs)catalogs.set(run,runs);return runs;},
      preview:async(project,thread,run,el,child,signal)=>{
        if(!run.preview&&run.turnId)run.preview=await read(project,(access,environmentId)=>readImportPreview(access,thread.id,project.id,run,environmentId,signal));
        if(!signal.aborted)await renderRunImportPreview(this.app,run,el,child,signal,this.htmlResults);
      },
      attach:(project,thread,run,follow)=>this.importRun(file.path,project,thread.id,run.messageId,follow,insertion,catalogs.get(run)),
    });
  }
  async openImportStreams(file:TFile){
    const result=await this.executeAgentCommand({version:1,id:randomId(),kind:'thread-streams'}) as ThreadDisplayResult;
    const displays=(result.displays??[]).filter(display=>!display.cancelled&&display.destinations.some(destination=>destination.path===file.path&&!destination.removed));
    const labelled=await Promise.all(displays.map(async display=>({...display,title:await this.eventThread(display).then(thread=>String(thread.title)).catch(()=>`Unavailable thread · ${display.threadId.slice(0,8)}`)})));
    if(this.stopped)return;
    new ImportStreamsModal(this.app,file.path,labelled,async(display,kind)=>{
      const changed=await this.executeAgentCommand({version:1,id:randomId(),kind,subscriptionId:display.id,...(kind==='remove-stream-destination'?{destination:file.path}:{})}) as ThreadDisplayResult;
      return changed.display!;
    }).open();
  }
  private async followImportedThread(source:{threadId:string;projectId:string;environmentId:string},notePath:string,messageId:string,state:InlineThreadState){
    const result=await this.executeAgentCommand({version:1,id:randomId(),kind:'thread-streams'}) as ThreadDisplayResult;
    const history=(result.displays??[]).filter(display=>display.threadId===source.threadId&&display.projectId===source.projectId&&display.environmentId===source.environmentId&&display.destinations.some(destination=>destination.path===notePath));
    const matches=history.filter(display=>display.destinations.some(destination=>destination.path===notePath&&!destination.removed));
    const prompts=state.messages.filter(message=>message.role==='user'),selected=prompts.findIndex(message=>message.id===messageId);
    const earlier=new Set(prompts.slice(0,selected+1).map(message=>message.id));
    if(matches.some(display=>display.enabled&&!display.cancelled&&display.boundary.every(id=>earlier.has(id))))return;
    // The host establishes this boundary from fresh history, including responses
    // that finish while the selected response is being attached.
    await this.executeAgentCommand({version:1,id:history.length?randomId():importFollowId(source,notePath),kind:'stream-thread',scope:'thread',source,destinations:[notePath],start:'after',afterMessageId:messageId});
    // Replace only this note's old registration. Existing response bindings keep
    // running and other destination notes keep their original boundaries.
    for(const display of matches.filter(display=>!display.cancelled))await this.executeAgentCommand({version:1,id:randomId(),kind:display.destinations.filter(destination=>!destination.removed).length===1?'cancel-thread-stream':'remove-stream-destination',subscriptionId:display.id,destination:notePath});
  }

  private async executeImportRead(_command:import('../responses/response-command').ResponseCommand,_target:ResponseStorageTarget):Promise<never>{throw Error('Legacy lease imports were retired. Imports read T3 directly.');}
  private async readImportHistory(project:Project,threadId:string,messageId:string,catalog?:ImportRun[]){
    if(this.stopped)throw Error('The plugin is disabled.');
    const connection=this.connection(project),environmentId=connection.environmentId??await this.localInlineEnvironment();
    const source={threadId,projectId:project.id,environmentId},access=await this.inlineThreadAccess(environmentId);
    let snapshot:ThreadSnapshot;
    let index:Awaited<ReturnType<typeof readImportRuns>>;
    try{
      index=catalog??await readImportRuns(access,threadId,project.id);
      const selected=index.find(run=>run.messageId===messageId);
      if(!selected?.turnId)throw Error('This response is no longer in the T3 run index.');
      // Register the exact root and complete answer once. The response feed
      // reuses this snapshot while retrieving the selected history separately.
      snapshot=(await readImportRun(access,threadId,project.id,selected.turnId,{firstPageOnly:true})).snapshot;
      const turn=snapshot.thread.turns?.[selected.turnId]??(snapshot.thread.latestTurn?.turnId===selected.turnId?snapshot.thread.latestTurn:undefined);
      if(typeof turn?.messageId==='string'?turn.messageId!==messageId:!snapshot.thread.messages.some(message=>message.id===messageId&&message.role==='user'&&message.turnId===selected.turnId))throw Error('The selected run no longer belongs to this source prompt.');
    }finally{await access.close?.();}
    if(snapshot.thread.deletedAt||snapshot.thread.archivedAt)throw Error('This source thread is no longer available.');
    const selectedState=applyThreadItem({messages:[],activities:[]},{kind:'snapshot',snapshot}).state;
    return {source,snapshot,...importHistoryState(index,selectedState,messageId),title:String(snapshot.thread.title??'T3 response').slice(0,200)};
  }
  /** Attach without sending input, then use the imported thread for later sends. */
  async importRun(notePath:string,project:Project,threadId:string,messageId:string,follow=false,insertion?:CursorInsertion|null,catalog?:ImportRun[]):Promise<RunImportResult>{
    if(this.stopped||this.busy||!this.deviceInline)throw Error('Obsidian is unavailable or sending another request.');
    this.busy=true;
    try{

      await this.assertNoteMode(notePath,{...this.connection(project),projectId:project.id,threadId});
      const history=await this.readImportHistory(project,threadId,messageId,catalog),run=history.run??importRuns(history.state).find(run=>run.messageId===messageId);
      if(!run||run.unavailable||!run.turnId||!run.turn)throw Error(run?.unavailable??'This response is no longer in the T3 history.');
      const document=await deviceNoteIO(this.app).readNote(notePath);if(document===undefined)throw Error('Destination note not found.');
      const previous=findRunImport(document,history.source,messageId);
      const binding=previous&&localResponseBindings(document,responseBindingRequests(this.settings.responseBindings??{})).find(request=>request.id===previous.bindingId&&request.vaultId===this.settings.vaultId);
      const duplicate=!!previous,pending=!previous||!!responseFrame(document,previous.bindingId);
      let bindingId=binding?.id;
      if(binding)await this.deviceInline.register({...binding,notePath});
      if(pending&&!binding){
        const id=previous?.bindingId??importBindingId(history.source,messageId,notePath),host=await this.localResponseTarget({project,connection:this.connection(project)} as Request);
        const policy=resolveJobOptions(this.settings.inlineStreaming).inline;
        const prompt=history.state.messages.find(message=>message.id===messageId)!;
        const request:ResponseRequest={version:4,id,localOnly:true,nativeProjection:true,responseContainer:true,initialOwner:this.inlineActor,vaultId:this.settings.vaultId,host,notePath,threadId,messageId,projectId:project.id,threadEnvironmentId:history.source.environmentId,createdAt:run.createdAt,threadTitle:history.title,independent:true,importTurn:run.turn,initialInput:isT3MessageId(messageId)?{messageId,text:prompt.text,label:incomingLabel(prompt)}:undefined,initialHash:initialRegion(id).bodyHash,keepIntermediate:policy.intermediateMode!=='remove',intermediateMode:policy.intermediateMode,finalAnswerFormat:policy.finalAnswerFormat};
        const io=deviceNoteIO(this.app),receipt=runImportReceipt({version:1,bindingId:id,...history.source,messageId,runId:run.turnId});
        const inserted=await editorStream(request,notePath,{...io,updateNote:(path,change,allowed)=>io.updateNote(path,current=>{const next=change(current);return findRunImport(next,history.source,messageId)?next:next+(next.endsWith('\n')?'':'\n')+receipt+'\n';},allowed)},()=>!this.stopped,id,insertion??undefined);
        await this.deviceInline.register(inserted,history.snapshot);
        bindingId=id;
      }
      await this.ensureNoteIdentity(notePath);
      this.rememberNoteThread(this.noteThreadIntent(notePath,project,{...this.connection(project),environmentId:history.source.environmentId}),threadId);
      await this.save(true);
      let save:Pick<RunImportResult,'saveState'|'pendingReason'>={saveState:pending?'streaming':'saved'};
      if(pending&&bindingId&&run.status!=='Running'){
        const result=await this.deviceInline.waitForSave(bindingId);
        save=result.saved?{saveState:'saved'}:{saveState:'pending',pendingReason:result.reason};
      }
      if(follow)await this.followImportedThread(history.source,notePath,messageId,history.state);
      return {duplicate,following:follow,...save};
    }finally{this.busy=false;}
  }
  async sendNote(file:TFile,threadId?:string,expectedProjectKey?:string,newThread=false,overrideKey?:string,jobOptions?:ResolvedJobOptions,insertion=this.noteSendInsertion(file)){
    if(this.busy)return;
    jobOptions??=resolveJobOptions(this.settings.inlineStreaming);
    const finishPreview=this.previewSend(file.path,undefined,insertion,jobOptions.inline.enabled);
    try{

      const active=this.app.workspace.getActiveViewOfType(MarkdownView);
      const content=active?.file?.path===file.path&&active.editor?this.notePromptDocument(active):await this.app.vault.read(file);
      if(!content.trim()){new Notice('This note is empty. Add Markdown before sending.');return;}
      const saved=this.noteThread(file.path);
      const chosen=expectedProjectKey?undefined:threadId?this.previousNoteThread(file.path,threadId):!newThread?saved:undefined;
      const {project,link}=await this.chatTarget(file.path,chosen,Boolean(newThread||expectedProjectKey),overrideKey??expectedProjectKey);
      if(expectedProjectKey&&projectKey(project)!==expectedProjectKey)throw Error('The folder’s linked project changed. Choose a thread again.');
      const readiness=this.projectReadinessError(project);if(readiness)throw Error(readiness);
      await this.send(file,project,{threadId,newThread,projectOverrideKey:overrideKey,folderPicker:Boolean(expectedProjectKey),folderLink:link,jobOptions,throwOnError:true,insertion});
    }finally{finishPreview();}
  }
  openChat(prompt?:string,showSelector=false){
    const view=this.app.workspace.getActiveViewOfType(MarkdownView);
    if(view?.file&&view.editor){if(prompt===undefined)return this.openAsk(view.file,view.editor.getSelection(),{view,editor:view.editor},showSelector);return this.openManualAction(view.file,prompt,view.editor.getSelection(),{view,editor:view.editor},showSelector);}
    return this.openChatWithNote(this.chatNote(),prompt,view?.file&&view.editor?{view,editor:view.editor}:undefined,false,showSelector);
  }
  private capturePaletteSource(){
    const file=this.app.workspace.getActiveFile();
    if(!file||file.extension.toLowerCase()!=='md')return;
    const view=this.app.workspace.getActiveViewOfType(MarkdownView);
    let selection='',editor:EditorChatContext|undefined;
    if(view?.file?.path===file.path&&view.editor&&view.getMode()!=='preview'){
      selection=view.editor.getSelection();
      editor=this.canonicalChatContext({view,editor:view.editor,...(selection.trim()?{anchor:captureEditorSelection(view.editor)}:{insertion:captureCursorInsertion(view.editor.getValue(),view.editor.posToOffset(view.editor.getCursor()))})});
    }
    return {selection,context:{file,editor,insertion:this.noteSendInsertion(file)} satisfies PaletteActionContext};
  }
  private async openPaletteAction(prompt:string,selection:string,showSelector=false,source?:PaletteActionContext){
    const file=source?.file??this.app.workspace.getActiveFile();
    if(!file||file.extension.toLowerCase()!=='md')throw Error('Open a Markdown note before using T3 Code from the command palette.');
    if(source&&!prompt.trim()&&!selection.trim())return this.openNoteSend(file,showSelector,source.insertion);
    return this.openManualAction(file,prompt,selection,source?.editor,showSelector);
  }
  private async openManualAction(file:TFile,prompt:string,selection:string,captured?:EditorChatContext,showSelector=false){
    if(!prompt.trim()&&!selection.trim()){
      return this.openNoteSend(file,showSelector,captured?.insertion);
    }
    const active=this.app.workspace.getActiveViewOfType(MarkdownView);
    const view=captured?.view??(active?.file?.path===file.path?active:undefined);
    const editor=captured?.editor??view?.editor;
    const selected=selection.trim();
    let context:EditorChatContext|undefined;
    if(view?.file?.path===file.path&&editor){
      context={...captured,editor,view,...(prompt.trim()?{initialQuestion:prompt}:{})};
      if(!selected)context.insertion??=captureCursorInsertion(editor.getValue(),editor.posToOffset(editor.getCursor()));
      if(selected&&!context.anchor){
        if(editor.getSelection()!==selection)throw Error('The selected text changed. Select it again before sending.');
        context.anchor=captureEditorSelection(editor);
      }
    }
    if(context?.anchor)context=this.canonicalChatContext(context);
    const canonicalSelected=context?.canonicalAnchor?.text??selection;
    const finishPreview=!showSelector&&this.hasConfirmedNoteSend(file.path)?this.previewSend(file.path,context):()=>{};
    try{
      if(view&&editor){
        const document=this.notePromptDocument(view),anchor=context?.canonicalAnchor;
        let scope:Span|undefined=anchor?[anchor.start,anchor.end]:undefined;
        if(selected&&!scope){const from=document.indexOf(selection);if(from<0||document.lastIndexOf(selection)!==from)throw Error('The selected text changed. Select it again before sending.');scope=[from,from+selection.length];}
        context={...context!,smartDocument:document,smartScope:scope,smartQuestion:prompt};
        if(scope&&prompt.trim()&&!context.referenceSelection){
          await this.recoverSmartReplies(file.path,document);
          const data=this.smartData(),projection=await sourceProjection(data,smartNote(data,file.path),document);
          const ordinary=projection.segments.reduce((sum,segment)=>sum+Math.max(0,Math.min(scope[1],segment.rawTo)-Math.max(scope[0],segment.rawFrom)),0);
          if(ordinary<scope[1]-scope[0])context.referenceSelection=true;
        }
      }else if(selected)throw Error('Open the source note before sending its selection.');
      const question=selected&&prompt.trim()?`Selected text:\n${canonicalSelected}\n\n**USER ASKS:**\n${prompt}`:selected?canonicalSelected:prompt;
      return await this.openChatWithNote(this.noteContext(file),question,context,true,showSelector);
    }finally{finishPreview();}
  }
  private openEditorChat(selection:string,file:TFile,context:EditorChatContext,showSelector=false){
    return this.openAsk(file,selection,context,showSelector);
  }
  private previewSend(path?:string,context?:EditorChatContext,insertion?:CursorInsertion|null,enabled=this.settings.inlineStreaming.enabled){
    if(!path||!enabled||this.busy||this.stopped)return ()=>{};
    const view=context?.view??this.app.workspace?.getLeavesOfType?.('markdown').map(leaf=>leaf.view as MarkdownView).find(view=>view.file?.path===path);
    if(!view?.editor||view.file?.path!==path)return ()=>{};
    const document=view.editor.getValue();
    if(context&&inlineSteeringTarget(document,context.editor.posToOffset(context.editor.getCursor()),context.responseId))return ()=>{};
    let offset=endInsertionOffset(document);
    if(context?.anchor)offset=insertionOffset(document,context.anchor);
    else if(context?.insertion)offset=resolveCursorInsertion(document,context.insertion);
    else if(insertion){
      const adapter=nativeResponses(this.app).view(view as MarkdownView);
      offset=adapter?savedToDisplay(adapter.currentProjection(),resolveCursorInsertion(adapter.saved(),insertion)):resolveCursorInsertion(document,insertion);
    }
    return this.sendPreviews.begin(view as MarkdownView,offset);
  }
  private notePromptDocument(view:MarkdownView|MarkdownFileInfo){return nativeResponses(this.app).view(view as MarkdownView)?.canonicalDisplayed()??view.editor?.getValue()??'';}
  private canonicalChatContext(context:EditorChatContext):EditorChatContext {
    if(!context.anchor||context.canonicalAnchor&&context.snapshot!==undefined)return context;
    const display=context.editor.getValue(),range=selectionRange(display,context.anchor);
    if(!range)throw Error('The selected text changed. Select it again before asking T3.');
    const adapter=nativeResponses(this.app).view(context.view as MarkdownView),mapped=adapter?.canonicalSelection(range.from,range.to);
    const snapshot=mapped?.document??context.snapshot??display;
    const canonicalAnchor=mapped?selectionAnchor(snapshot,mapped.text,mapped.start,mapped.end):context.anchor;
    return {...context,snapshot,canonicalAnchor,insertion:context.insertion??captureCursorInsertion(display,range.to),referenceSelection:Boolean(context.referenceSelection||mapped?.reference||selectionOverlapsInlineResponse(display,context.anchor))};
  }
  private needsFolderProject(notePath?:string):boolean {
    return Boolean(notePath?.includes('/')&&!folderLinkForPath(this.settings.folderLinks.filter(link=>link.folderPath!=='/'),notePath));
  }
  private responseProjectKey(id:string){
    const cached=this.deviceInline?.cachedResponse(id),job=this.inlineChat?.find(id),request=cached?.record.request??responseBindingRequests(this.settings.responseBindings??{}).find(request=>request.id===id);
    const projectId=request?.projectId??job?.projectId,environment=request?.threadEnvironmentId??job?.connection?.environmentId;
    const project=[...this.projects(),...this.settings.directProjects,...this.settings.projects].find(project=>project.id===projectId&&(job?.connection?.connectionId?project.connectionId===job.connection.connectionId:environment?project.connectionId?this.settings.paired.find(connection=>connection.id===project.connectionId)?.environmentId===environment:this.eventLocalEnvironmentId===environment:!cached&&!!job?.connection&&!job.connection.connectionId&&!project.connectionId));
    return project&&projectKey(project);
  }
  private destinationContext(note?:{path:string;absolutePath?:string},inline?:EditorChatContext):Pick<ChatHost,'hasConfirmedNoteSend'|'getThreadChoiceRestriction'|'getInlineDefaults'|'steering'|'getNotePath'|'getProjectName'|'getDefaultProjectKey'|'getTargetDescription'|'getProjectChoices'|'getDefaultThread'|'getDefaultDestination'|'getAlternativeProjectKey'|'onProjectChange'>{
    // Capture the destination once. A later editor update must not redirect a send.
    const responseId=inline&&inlineSteeringTarget(inline.editor.getValue(),inline.editor.posToOffset(inline.editor.getCursor()),inline.responseId);
    const remembered=this.noteThread(note?.path);
    const link=note?folderLinkForPath(this.settings.folderLinks.filter(link=>link.folderPath!=='/'),note.path):undefined;
    const linkKey=(link:FolderLink)=>`${link.connectionId?link.connectionId+':':''}${link.projectId}`;
    const rememberedKey=remembered?(()=>{try{return projectKey(this.projectForNoteThread(remembered));}catch{return `${remembered.connectionId?remembered.connectionId+':':''}${remembered.projectId}`;}})():undefined;
    const selectedKey=rememberedKey??(link?linkKey(link):NO_PROJECT);
    const canonicalKey=(key?:string)=>isNoProjectKey(key)?(()=>{const project=this.noProjectProjects.get(noProjectMachine(key!)??this.defaultNoProjectMachine()??'');return project&&projectKey(project);})():key;
    const projectName=(key=selectedKey)=>{
      const link=note?folderLinkForPath(this.settings.folderLinks,note.path):this.settings.folderLinks.find(item=>item.folderPath==='/');
      if(isNoProjectKey(key))return 'No project';
      if(key===NEW_FOLDER_PROJECT)return `New project: ${note!.path.split('/').at(-2)}`;
      if(key)return [...this.projects(),...this.settings.directProjects,...this.settings.projects].find(project=>projectKey(project)===key)?.title??'Unavailable project';
      const remembered=this.noteThread(note?.path);
      if(remembered)return [...this.settings.directProjects,...this.settings.projects].find(project=>project.id===remembered.projectId&&sameWorkspacePath(project.workspaceRoot,remembered.workspaceRoot))?.title??`T3 project ${remembered.projectId.slice(0,8)}`;
      return link?.projectTitle??this.app.vault.getName();
    };
    return {
      hasConfirmedNoteSend:()=>this.hasConfirmedNoteSend(note?.path),
      getThreadChoiceRestriction:()=>threadNoteMode(this.settings.threadNoteMode)==='one-to-one'&&this.noteThread(note?.path)?'1:1 mode keeps this note in its linked thread. Switch to Free mode to choose another.':undefined,
      getInlineDefaults:()=>({...this.settings.inlineStreaming}),
      steering:!!responseId,
      getNotePath:()=>note?.path??'No note open',
      getProjectName:projectName,
      getDefaultProjectKey:()=>responseId&&!remembered?undefined:selectedKey,
      getTargetDescription:key=>`${note?.path??'No note open'} → ${projectName(key)}`,
      onProjectChange:listener=>this.watchProjects(listener),
      getProjectChoices:()=>{
        const machine=this.defaultNoProjectMachine();
        return [...(this.needsFolderProject(note?.path)?[{key:NEW_FOLDER_PROJECT,label:`New project: ${note!.path.split('/').at(-2)}`}]:[]),{key:NO_PROJECT,label:'No project'},...this.vaultMachines().filter(item=>item.id!==machine).map(item=>({key:noProjectKey(item.id),label:`No project · ${item.name}`})),...this.projects().filter(project=>![...this.noProjectProjects.values()].some(item=>projectKey(item)===projectKey(project))).map(project=>({key:projectKey(project),label:this.projectChoiceLabel(project)}))];
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
          if(isNoProjectKey(key)){const selected=await abortableRead(this.noProjectTarget(key),signal);if(projectKey(selected.project)!==projectKey(project))throw Error('This conversation belongs to another project. Choose New thread or Existing thread…');}
          else if(key&&canonicalKey(key)!==projectKey(project))throw Error('This conversation belongs to another project. Choose New thread or Existing thread…');
          await this.assertNoteMode(note?.path,{...this.connection(project),projectId:project.id,threadId});
          const thread=await this.readChatThread(this.connection(project),project,threadId,signal);
          const active=threadIsActive(thread);
          if(thread.hasPendingApprovals||thread.hasPendingUserInput)throw Error('This conversation is waiting for approval or input. Resolve it in T3 before sending.');
          if(active&&responseId&&!responseOwnsActiveTurn(thread,hosted?.record.state??job)){throw Error('The selected response is not bound to the current active turn. Wait for its checkpoint or explicitly choose a thread.');}
          return {threadId,projectKey:projectKey(project),...(active&&responseId?{responseId}:{}),label:active?'Send to running thread':'Continue thread',detail:`${typeof thread.title==='string'?thread.title:'T3 thread'} · ${threadId.slice(0,8)}${active&&responseId?' · Keeps this response’s streaming choices.':''}`} satisfies ChatDestination;
        }catch(error){return {label:'Thread unavailable',unavailable:true,detail:`${unsavedMessage(error)} No message was sent. Use New thread or Existing thread…`};}
      },
    };
  }
  private async openChatWithNote(note:{path:string;absolutePath?:string}|undefined,prompt?:string,inline?:EditorChatContext,answerOnly=false,showSelector=false){
    // Generated text is captured context, never a source to move. Classify it
    // before the chooser/network waits: streaming may replace its surroundings.
    if(inline?.anchor)inline=this.canonicalChatContext(inline);
    const send=(text:string,options:{threadId?:string;responseId?:string;newThread?:boolean;expectedProjectKey?:string;projectOverrideKey?:string;jobOptions?:ResolvedJobOptions})=>this.sendResolvedChat(text,note,inline,answerOnly,options);
    const host:ChatHost=this.withSendAvailability({...this.destinationContext(note,inline),
      beginSend:options=>this.previewSend(note?.path,inline,undefined,options.inline.enabled),
      hasNewContent:note?(destination)=>this.hasSmartContent(this.app.vault.getFileByPath(note.path)!,destination,inline):undefined,
      sendChat:(text,key,resolve,_back,destination)=>send(text,{threadId:destination?.threadId,responseId:destination?.responseId,expectedProjectKey:destination?.projectKey,projectOverrideKey:key,jobOptions:resolve?.()}),
      sendToNew:(text,key,resolve)=>send(text,{newThread:true,projectOverrideKey:key??NO_PROJECT,jobOptions:resolve?.()}),
      sendToExisting:(text,key,resolve,back)=>this.openChatThreads(text,note,inline,answerOnly,key,resolve,back),
    });
    return openChatFlow(this.app,host,prompt,showSelector);
  }
  private commandSendSelector(view:MarkdownView|MarkdownFileInfo){
    const app=this.app as App&{hotkeyManager?:{customKeys?:Record<string,import('obsidian').Hotkey[]>;getHotkeys?:(id:string)=>import('obsidian').Hotkey[]}};
    const id=`${this.manifest?.id??pluginManifest.id}:send-or-ask`;
    const hotkeys=app.hotkeyManager?.customKeys?.[id]??app.hotkeyManager?.getHotkeys?.(id)??[];
    const win=(view as MarkdownView).containerEl?.ownerDocument.defaultView??(typeof window!=='undefined'?window:undefined);
    return this.sendGesture.selector(win,hotkeys,Platform.isMacOS);
  }
  private withSendAvailability(host:ChatHost):ChatHost{
    Object.defineProperty(host,'busy',{get:()=>this.busy||this.defaultSending});
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
    const threads=await this.availableModeThreads(note?.path,project,projectThreads(await runBridge(this.connection(project),['threads','--project',project.id]),project.id));
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
    return this.sendChat(prompt,note,{...options,jobOptions:{...jobOptions,inline:{...jobOptions.inline,enabled:false}},sourceContext:context});
  }
  private async sendInlineChat(prompt:string,note:{path:string;absolutePath?:string},context:EditorChatContext,options?:{threadId?:string;newThread?:boolean;expectedProjectKey?:string;projectOverrideKey?:string;jobOptions?:ResolvedJobOptions}){
    const manager=this.inlineChat;if(!manager)throw Error('Inline T3 response is unavailable. Reload the plugin.');
    if(context.view.file?.path!==note.path)throw Error('The original note is no longer open. Reopen it before asking T3.');
    const activeId=inlineSteeringTarget(context.editor.getValue(),context.editor.posToOffset(context.editor.getCursor()),context.responseId);
    if(activeId&&!options?.newThread&&!options?.threadId)return this.sendInlineSteering(activeId,prompt,note,context,options);
    const jobOptions=options?.jobOptions??resolveJobOptions(this.settings.inlineStreaming);
    const requestId=randomId(),initialInput=context.initialQuestion?{messageId:commandId(requestId,'message'),text:context.initialQuestion}:undefined;
    let job:InlineJob|undefined,delivered=false;
    const finishPreview=this.previewSend(note.path,context,undefined,jobOptions.inline.enabled);
    try{
      await this.sendChat(prompt,note,{...options,jobOptions,requestId,sourceContext:context,onPrepared:async request=>{
        // The pending indicator never enters image or prompt snapshots.
        if(request.inlineSteering)return;

        job=context.anchor&&!context.referenceSelection&&!activeId?manager.reserve(context.editor,context.view,context.anchor,requestId,note.path,initialInput,request.title,jobOptions):context.insertion?manager.reserveAtCursor(context.editor,context.view,context.insertion,requestId,note.path,initialInput,request.title,jobOptions):manager.reserveAtEnd(context.editor,context.view,requestId,note.path,initialInput,request.title,jobOptions);
        this.sendPreviews.hide(context.view as MarkdownView);
        await manager.prepare(job,request);
      }});delivered=true;if(job)manager.start(job);
    }catch(error){if(job)await manager.deliveryFailed(job,delivered||(error instanceof RequestDeliveryError&&(error.requestSaved||error.terminal)));throw error;}finally{finishPreview();}
  }
  private async steeringRecord(id:string):Promise<{record:ResponseRecord;host:ResponseStorageTarget}|undefined>{return this.deviceInline?.cachedResponse(id);}
  private async steeringDestination(id:string,signal?:AbortSignal){
    requestAborted(signal);const live=this.deviceInline?.cachedResponse(id);if(live)return live;
    const request=responseBindingRequests(this.settings.responseBindings??{}).find(request=>request.id===id);if(!request)return;
    return {host:request.host,record:{request,owner:this.inlineActor,epoch:1,revision:1,expiresAt:0,coordinated:true,state:{requestHash:'',accepted:true,notePath:request.notePath,messageId:request.localMessageId??request.messageId,status:'waiting',hashes:[],updatedAt:request.createdAt}} as ResponseRecord};
  }
  private async sendInlineSteering(id:string,prompt:string,note:{path:string;absolutePath?:string},context:EditorChatContext,options?:{threadId?:string;expectedProjectKey?:string;projectOverrideKey?:string}){
    logEvent('steering.requested',{jobId:id,notePath:note.path,promptHash:contentHash(prompt),promptLength:prompt.length,selectionHash:context.anchor?contentHash(JSON.stringify(context.anchor)):undefined});
    const job=this.inlineChat?.find(id);let hosted=await this.steeringRecord(id);
    if(job?.hosted&&!hosted||!hosted&&!job)throw Error('The active response is unavailable. Reconnect its vault connection machine.');
    const threadId=hosted?.record.request.threadId??job?.threadId,projectId=hosted?.record.request.projectId??job?.projectId,environmentId=hosted?.record.request.threadEnvironmentId??job?.connection?.environmentId;
    if(!threadId||!projectId)throw Error('Wait for the first message to reach T3 before steering.');
    if(options?.threadId&&options.threadId!==threadId)throw Error('This note has a running response in another thread. Finish or stop it first.');
    const responsePath=hosted?.record.state?.notePath??hosted?.record.request.notePath;
    if(hosted&&responsePath!==note.path)await this.checkResponseNote(id,responsePath!,note.path);
    await this.checkRecoveryBlock(id,note.path);
    const project=await this.recoveryProject(projectId,environmentId),key=projectKey(project);
    if(options?.expectedProjectKey&&options.expectedProjectKey!==key||options?.projectOverrideKey&&options.projectOverrideKey!==key)throw Error('Steering must use the running thread’s project.');
    const current=await this.readChatThread(this.connection(project),project,threadId);
    if(!threadIsActive(current)||!responseOwnsActiveTurn(current,hosted?.record.state??job))throw Error('This response no longer owns the active turn. Reopen the chooser or explicitly choose a thread. No message was sent.');
    if(hosted&&responsePath!==note.path){
      if(!this.deviceInline)throw Error('Response ownership is unavailable. Reload the plugin.');
      hosted={...hosted,record:await this.deviceInline.relocateResponse(hosted.host,hosted.record,note.path)};

    }
    const policy=hosted?.record.request??job!;
    const jobOptions=resolveJobOptions({enabled:true,intermediateMode:policy.intermediateMode,keepIntermediate:policy.keepIntermediate,finalAnswerFormat:policy.finalAnswerFormat});
    await this.sendChat(prompt,note,{threadId,responseId:id,projectOverrideKey:key,jobOptions,sourceContext:context,onPrepared:(request,input)=>{
      logEvent('steering.prepared',{jobId:id,requestId:request.id,messageId:commandId(request.id,'message'),threadId,projectId});
      if(request.inlineSteering?.jobId!==id)throw Error('This response no longer owns the active turn. Reopen the chooser before sending.');
    }});
  }
  private async recoveryRecord(id:string,_path:string):Promise<{record:ResponseRecord;host:ResponseStorageTarget}|undefined>{return this.deviceInline?.cachedResponse(id);}
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
      }catch{/* Try another saved connection before reporting the project unavailable. */}
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
    let thread:NormalizedThread;
    if(hosted){const access=await this.inlineThreadAccess(hosted.record.request.threadEnvironmentId);try{thread=(await readInlineSnapshot(access,threadId,projectId)).thread;}finally{await access.close?.();}}
    else thread=readThreadSnapshot({thread:await runBridge(job!.connection!,['read',threadId])}).thread;
    const oldTurnId=hosted?.record.state?.turnId??job?.turnId;
    const latest=thread?.latestTurn;
    const user=thread?.messages?.find(item=>item.role==='user'&&item.createdAt===latest?.requestedAt);
    if(thread?.id!==threadId||thread.projectId!==projectId||!latest?.turnId||latest.turnId===oldTurnId||!user?.id)throw Error('No newer T3 turn is available to attach to this response. Continue the thread in T3 first.');
    if(hosted){if(!this.deviceInline)throw Error('Response ownership is unavailable. Reload the plugin.');await this.deviceInline.follow(hosted.host,id,hosted.record.state?.messageId??hosted.record.request.messageId,user.id,path);}
    else this.inlineChat!.follow(job!,user.id);
    new Notice('The latest T3 turn is attached to this response.');
  }
  private async inlineThreadAccess(environmentId:string,forceRefresh=false):Promise<ThreadAccess>{
    return environmentAccess(environmentId,{paired:orderedRoutes(this.settings.paired,this.routeOrder,c=>this.connectionScore(c)),openPaired:async paired=>{try{const access=await this.pairedThreadAccess(paired,forceRefresh);this.routeFailures.delete(paired.id);return access;}catch(error){this.routeFailures.set(paired.id,message(error));throw error;}}});
  }
  private async pairedThreadAccess(paired:PairedConnection,forceRefresh=false):Promise<ThreadAccess>{
    const environmentId=paired.environmentId;
    const connection:Connection={transport:'direct',host:'direct',executable:'',url:paired.url,environmentId,connectionId:paired.id};
    let session=await this.sessionFor(paired.id,forceRefresh),api=await environmentApi(connection,session);
    // Verify authorization before exposing a candidate to sends or writes.
    // A failed open can try another endpoint for the same machine; the caller
    // operation is never part of this fallback.
    const key=JSON.stringify([paired.url,environmentId,session?.token,session?.expiresAt,session?.dpopKeyId]);
    let verified=this.verifiedConnections.get(key);
    if(forceRefresh||!verified||verified.until<=Date.now()){
      const work=this.routeStatus.request(paired.id,()=>api('/api/orchestration/shell')).then(()=>{});verified={work,until:Date.now()+30_000};this.verifiedConnections.set(key,verified);
      while(this.verifiedConnections.size>16)this.verifiedConnections.delete(this.verifiedConnections.keys().next().value!);
      void work.catch(()=>{if(this.verifiedConnections.get(key)?.work===work)this.verifiedConnections.delete(key);});
    }
    await verified.work;
    if(!Platform.isMobile&&localRoute(paired))this.eventLocalEnvironmentId=environmentId;
    let renewing:Promise<void>|undefined;
    const routed:ThreadAccess['api']=async(path,payload,options)=>this.routeStatus.request(paired.id,async()=>{
      try{
        const attemptedApi=api;
        try{return await attemptedApi(path,payload,options);}catch(error){
          // Retrying reads can recover a revoked environment token. Dispatch is
          // never replayed; account expiry is handled by nativeCredential.
          const safe=payload===undefined||['/api/auth/websocket-ticket','/api/orchestration/turn-item','/api/assets/create-url'].includes(path);
          if(!(error instanceof T3HttpError)||error.status!==401||!paired.managed||!safe)throw error;
          if(api===attemptedApi){
            renewing??=(async()=>{session=await this.sessionFor(paired.id,true);api=await environmentApi(connection,session);})().finally(()=>{renewing=undefined;});
            await renewing;
          }
          return await api(path,payload,options);
        }
      }catch(error){this.routeFailures.set(paired.id,message(error));throw error;}
    });
    routed.trackConnection=connection=>this.routeStatus.track(paired.id,connection);
    return {origin:endpoint(paired.url),get expiresAt(){return session?.expiresAt;},api:routed};
  }
  private async localInlineEnvironment():Promise<string>{
    const local=this.settings.paired.find(connection=>localRoute(connection));
    if(!local)throw Error('Pair T3 on this computer from Connection settings before using its local project.');
    await this.pairedThreadAccess(local);return local.environmentId;
  }
  private registerInlineInterval(callback:()=>void,milliseconds:number){
    if(Platform.isMobile){this.registerInterval(window.setInterval(callback,milliseconds));return;}
    void import('../connection/desktop-timers').then(d=>d.desktopTimers()).then(({interval})=>{
      if(!this.stopped)this.register(interval(callback,milliseconds));
    });
  }
  private async refreshNoteCommandHost():Promise<void>{
    if(this.stopped||this.noteCommandOpening)return this.noteCommandOpening;
    const work=(async()=>{
      const environments=[...new Set([...this.settings.paired].sort((a,b)=>this.connectionScore(b)-this.connectionScore(a)).map(connection=>connection.environmentId))].slice(0,16);
      for(const [environmentId,entry] of this.commandHosts)if(!environments.includes(environmentId)||entry.rpc.closed){this.commandHosts.delete(environmentId);await entry.host.dispose();entry.rpc.close();}
      await forEachBounded(environments,4,environmentId=>this.openCommandHost(environmentId));
    })();this.noteCommandOpening=work;try{await work;}finally{if(this.noteCommandOpening===work)this.noteCommandOpening=undefined;}
  }
  private async openCommandHost(environmentId:string){
    if(this.stopped||this.commandHosts.has(environmentId))return;
    let rpc:Awaited<ReturnType<typeof connectT3Rpc>>|undefined,host:ConnectCommandHost|undefined;
    try{
      const access=await this.inlineThreadAccess(environmentId),project=await this.commandProject(environmentId);rpc=await connectT3Rpc(access.api,access.origin);
      const route={environmentId,workspaceRoot:project.workspaceRoot,base:commandBase(this.settings.vaultId,this.deviceId)},files=connectCommandFiles(rpc,project.workspaceRoot);
      host=new ConnectCommandHost({files,route,identity:{vaultId:this.settings.vaultId,vaultName:this.app.vault.getName(),vaultPath:this.localVaultPath(),clientId:this.deviceId,instanceId:this.clientMaintenance!.client.instanceId,loadedVersion:pluginManifest.version},
        serialize:action=>this.serializeCommand(action),
        validate:command=>{validateAgentCommand(command);},
        load:id=>deviceState(`connect-receipt:${this.settings.vaultId}:${this.deviceId}:${id}`),
        save:(id,receipt)=>this.retainCommandReceipt(id,receipt),
        execute:async(command,target)=>{if(this.stopped||!this.settings.paired.some(connection=>connection.environmentId===target.environmentId))throw Error('This T3 machine was disconnected.');const result=await this.executeAgentCommand(command,target);if(!isRecord(result))throw Error('Invalid command result.');return result;},
        acknowledged:async(command,result)=>{if(isClientCommand(command))await this.clientMaintenance!.acknowledged(command,result as unknown as import('./client-command').ClientCommandResult);},
      });
      if(this.stopped||!this.settings.paired.some(connection=>connection.environmentId===environmentId)){await host.dispose();rpc.close();return;}
      this.commandHosts.set(environmentId,{host,rpc,files});await host.tick();
    }catch(error){if(this.commandHosts.get(environmentId)?.rpc===rpc)this.commandHosts.delete(environmentId);await host?.dispose();rpc?.close();logFailure('commands.connect',error,{environmentId});}
  }
  private async commandProject(environmentId:string){
    const cached=this.commandProjects.get(environmentId);if(cached)return cached;
    const access=await this.inlineThreadAccess(environmentId);try{const project=await ensureNoProject(access.api);this.commandProjects.set(environmentId,project);return project;}finally{await access.close?.();}
  }
  agentToolMachines(){return [...new Map(this.settings.paired.map(connection=>[connection.environmentId,{id:connection.environmentId,name:connection.name}])).values()];}
  private async withAgentTools<T>(environmentId:string,action:(setup:AgentSetup)=>Promise<T>,configure=false):Promise<T>{
    if(!this.settings.paired.some(connection=>connection.environmentId===environmentId))throw Error('Connect the selected T3 machine first.');
    const candidates=orderedRoutes(this.settings.paired,this.routeOrder,c=>this.connectionScore(c)).filter(connection=>connection.environmentId===environmentId);
    let access:ThreadAccess|undefined,failure:unknown;
    for(const paired of candidates){
      try{
        if(configure)await this.sessionFor(paired.id,false,AGENT_SETUP_PERMISSIONS);
        access=await this.pairedThreadAccess(paired);this.routeFailures.delete(paired.id);break;
      }catch(error){failure=error;this.routeFailures.set(paired.id,message(error));}
    }
    if(!access)throw failure instanceof Error?failure:Error('No connected route could reach this T3 machine.');
    let rpc:Awaited<ReturnType<typeof connectT3Rpc>>|undefined;
    try{
      const project=await this.commandProject(environmentId);rpc=await connectT3Rpc(access.api,access.origin);
      return await action(new AgentSetup(rpc,connectAgentFiles(rpc,project.workspaceRoot),environmentId,project.workspaceRoot,{files:agentAssets,hash:agentBundleHash}));
    }finally{rpc?.close();await access.close?.();}
  }
  agentToolsPrepare(environmentId:string,runtime:string){return this.withAgentTools(environmentId,setup=>setup.prepare(runtime));}
  agentToolsInspect(environmentId:string){return this.withAgentTools(environmentId,setup=>setup.inspect());}
  agentToolsInstall(environmentId:string,provider:AgentProvider,runtime:string){return this.serializeCommand(()=>this.withAgentTools(environmentId,setup=>setup.install(provider,runtime),true));}
  agentToolsRemove(environmentId:string,provider:AgentProvider){return this.serializeCommand(()=>this.withAgentTools(environmentId,setup=>setup.remove(provider),true));}
  agentToolsStatus(environmentId:string,provider:AgentProvider){return this.withAgentTools(environmentId,setup=>setup.status(provider));}
  private async commandFiles(route:CommandRoute):Promise<CommandFiles>{
    const project=await this.commandProject(route.environmentId);
    if(!sameWorkspacePath(project.workspaceRoot,route.workspaceRoot)||!new RegExp('^\\.t3-obsidian/clients/'+this.settings.vaultId+'/[0-9a-f-]{36}$','i').test(route.base))throw Error('The edit transport belongs to another vault or T3 workspace.');
    const entry=this.commandHosts.get(route.environmentId);if(entry&&!entry.rpc.closed)return entry.files;
    const access=await this.inlineThreadAccess(route.environmentId),rpc=await connectT3Rpc(access.api,access.origin);
    this.register(()=>rpc.close());return connectCommandFiles(rpc,project.workspaceRoot);
  }
  private serializeCommand<T>(action:()=>Promise<T>):Promise<T>{const work=this.commandSerial.catch(()=>{}).then(action);this.commandSerial=work.then(()=>{},()=>{});return work;}
  private async retainCommandReceipt(id:string,receipt:unknown){
    await retainDeviceState(`connect-receipt:${this.settings.vaultId}:${this.deviceId}`,id,receipt,{records:512,bytes:32_000_000,ttl:24*60*60*1000},isRecord(receipt)&&receipt.phase==='executing');
  }
  private saveCheckedEdit(snapshot:EditSnapshot){return retainDeviceState(`checked-edit:${this.settings.vaultId}:${this.deviceId}`,snapshot.editId,snapshot,{records:64,bytes:32_000_000,ttl:24*60*60*1000},snapshot.status==='submitted');}
  private checkedEdits(){
    return this.noteEdits??=new CheckedNoteEdits({
      load:async id=>await deviceState<EditSnapshot>(`checked-edit:${this.settings.vaultId}:${this.deviceId}:${id}`)??undefined,
      save:snapshot=>this.saveCheckedEdit(snapshot),
      read:path=>deviceNoteIO(this.app).readNote(path),binding:id=>responseBindingRequests(this.settings.responseBindings??{}).find(binding=>binding.id===id),
      files:route=>this.commandFiles(route),
      attach:async(binding,stage,attached)=>{
        const release=await nativeResponses(this.app).beginFinalSave(binding.notePath);
        try{
          const current=await deviceNoteIO(this.app).readNote(binding.notePath),latest=responseBindingRequests(this.settings.responseBindings??{}).find(value=>value.id===binding.id);
          if(current===undefined||!responseIds(current).includes(binding.id)||!latest||latest.notePath!==binding.notePath)throw Error('The reply finished or moved before the proposal could be attached.');
          if(latest.localStage&&latest.localStage.editId!==stage.editId)throw Error('Another edit is already waiting for this reply.');
          await this.saveResponseBinding({...latest,localStage:stage});await attached();
        }finally{release();}
        this.deviceInline?.resume();
      },
      detach:async(binding,editId,expectedHash,detached)=>{
        const release=await nativeResponses(this.app).beginFinalSave(binding.notePath);
        try{
          const current=await deviceNoteIO(this.app).readNote(binding.notePath),latest=responseBindingRequests(this.settings.responseBindings??{}).find(value=>value.id===binding.id);
          if(current===undefined||contentHash(current)!==expectedHash||!latest||latest.notePath!==binding.notePath||latest.localStage?.editId!==editId||!responseIds(current).includes(binding.id))throw Error('The reviewed reply changed before its proposal could be withdrawn.');
          await this.saveResponseBinding({...latest,localStage:undefined});await detached();
        }finally{release();}
        this.deviceInline?.resume();
      },
      commit:async(path,before,after)=>{const notes=deviceFinalNoteIO(this.app,()=>!this.stopped);if(await notes.read(path)!==before)return false;return notes.compareAndSet(path,before,after);},
      create:async(path,content)=>{if(this.app.vault.getAbstractFileByPath(path))throw Error('The new note path already exists.');await this.app.vault.create(path,content);},
      rename:async(path,destination,expectedHash)=>{
        const release=await nativeResponses(this.app).beginFinalSave(path);
        try{const file=this.app.vault.getFileByPath(path),current=await deviceNoteIO(this.app).readNote(path);if(!file||current===undefined||contentHash(current)!==expectedHash)throw Error('The note changed before its move. Prepare it again.');if(this.app.vault.getAbstractFileByPath(destination))throw Error('The destination already exists.');await this.app.fileManager.renameFile(file,destination);}finally{release();}
      },
      remember:async(path,id,before,after)=>{if(await rememberNoteEdits(this.smartData(),path,id,before,after))await this.save(true);},
    });
  }
  private async markEditSaved(binding:ResponseRequest){
    const id=binding.localStage?.editId;if(!id)return;
    const key=`checked-edit:${this.settings.vaultId}:${this.deviceId}:${id}`,snapshot=await deviceState<EditSnapshot>(key);
    if(snapshot?.status==='submitted'){snapshot.status='saved';snapshot.notePath=binding.notePath;await this.saveCheckedEdit(snapshot);}
  }
  private tickCommandHosts(){
    this.routeStatus.retain(this.settings.paired.map(route=>route.id));
    this.settingsTab?.refreshRouteStatus();
    // Each host coalesces its own tick. An offline machine must not hold the
    // ready clients behind a global poll promise. The registration cap bounds
    // these independent channels; command dispatch remains serialized.
    for(const [environmentId,entry] of this.commandHosts)void entry.host.tick().catch(async error=>{if(this.commandHosts.get(environmentId)!==entry)return;this.commandHosts.delete(environmentId);logFailure('commands.poll',error,{environmentId});await entry.host.dispose();entry.rpc.close();});
  }
  private async startThreadDisplays(){
    if(this.threadDisplays||this.stopped)return;if(this.threadDisplayOpening)return this.threadDisplayOpening;
    const work=this.openThreadDisplays();this.threadDisplayOpening=work;try{await work;}finally{if(this.threadDisplayOpening===work)this.threadDisplayOpening=undefined;}
  }
  private async legacyReplyDisplays(){
    const root=this.vaultConnection();if(!root)return;
    const environmentId=root.environmentId??this.settings.paired.find(connection=>connection.id===root.connectionId)?.environmentId;if(!environmentId)return;
    const access=await this.inlineThreadAccess(environmentId),rpc=await connectT3Rpc(access.api,access.origin);
    const read=async(cwd:string,path:string)=>{try{const result=await rpc.call('projects.readFile',{cwd,relativePath:path});if(!isRecord(result)||result.truncated||typeof result.contents!=='string')throw Error('The prior reply-following data is incomplete.');return result.contents;}catch(error){if(isRecord(error)&&error.kind==='ProjectReadFileError')return;throw error;}};
    try{
      const configDir=this.app.vault.configDir,route=readPrivateStorageRoute(await read(root.workspaceRoot,`${configDir}/t3-code/storage-route.json`),root.workspaceRoot,configDir);
      const raw=await read(route?.storageRoot??root.workspaceRoot,`${configDir}/t3-code/events/v1/state.json`);if(!raw)return;
      const prior=parseJson(raw);if(!isRecord(prior)||!isRecord(prior.host)||prior.host.vaultId!==this.settings.vaultId||prior.host.environmentId!==environmentId||prior.host.workspaceRoot!==root.workspaceRoot||!isRecord(prior.state))throw Error('The prior reply registrations belong to another vault or machine.');
      return {version:1,displays:prior.state.displays,responseReservations:prior.state.responseReservations};
    }finally{rpc.close();await access.close?.();}
  }
  private async openThreadDisplays(){
    const key=`reply-displays:${this.settings.vaultId}:${this.deviceId}`;
    const service=new ThreadDisplays({load:async()=>await deviceState(key)??await deviceState(`events:${this.settings.vaultId}:${this.deviceId}`)??await this.legacyReplyDisplays(),save:async state=>{await deviceState(key,state);},now:()=>Date.now(),displayHost:{
      validateRelation:(target,paths)=>this.assertNoteMode(undefined,target,paths),confirmRelation:(target,paths)=>this.confirmModeRelation(target,paths),
      validateDestination:async path=>{const text=await deviceNoteIO(this.app).readNote(path);if(text===undefined)throw Error('Destination note unavailable.');endInsertionOffset(text);},
      responseBindings:target=>this.displayResponseBindings(target),
      readThread:async target=>{const snapshot=await this.eventThreadSnapshot(target);return applyThreadItem({messages:[],activities:[]},{kind:'snapshot',snapshot}).state;},
      prepareDisplay:async(display,destination,input)=>{const host=await this.inlineHostTarget(),id=commandId(display.id,`response:${input.id}:${destination.id}`);return {localOnly:true,nativeProjection:true,responseContainer:true,destinationSection:destination.section,version:4,finalAnswerFormat:finalAnswerFormat(this.settings.inlineStreaming.finalAnswerFormat),independent:true,id,initialInput:{messageId:input.id,text:input.text,label:incomingLabel(input)},initialOwner:this.inlineActor,vaultId:this.settings.vaultId,host,notePath:destination.path,threadId:display.threadId,messageId:input.id,projectId:display.projectId,threadEnvironmentId:display.environmentId,initialHash:initialRegion(id,{messageId:input.id,text:input.text,label:incomingLabel(input)},undefined,'collapse',{startedAt:input.createdAt??display.createdAt}).bodyHash,createdAt:input.createdAt??display.createdAt,keepIntermediate:true,intermediateMode:'collapse'};},
      attachDisplay:async(request,path)=>{
        if(this.stopped||!this.deviceInline)throw Error('The reply client is unavailable.');
        await this.confirmModeRelation({threadId:request.threadId,projectId:request.projectId,environmentId:request.threadEnvironmentId},[path]);
        const io=deviceNoteIO(this.app),known=responseBindingRequests(this.settings.responseBindings??{}).find(binding=>binding.id===request.id),document=await io.readNote(path);if(document===undefined)throw Error('The streaming destination is unavailable.');
        if(known){if(localResponseRange(document,request.id,[known]))await this.deviceInline.register({...known,notePath:path});return;}
        await this.assertNoteMode(path,{threadId:request.threadId,projectId:request.projectId,environmentId:request.threadEnvironmentId});
        const current={...request,localOnly:true as const,nativeProjection:true,responseContainer:true,notePath:path};await editorStream(current,path,io,()=>!this.stopped,request.id);await this.deviceInline.register(current);
      },
    },watchThread:(target,item,sequence,reconnecting)=>watchThread(target.threadId,()=>this.inlineThreadAccess(target.environmentId),{item:value=>{if(value.kind==='snapshot'&&value.snapshot?.thread?.projectId!==target.projectId)return;item(value);},reconnecting:()=>reconnecting()},undefined,undefined,{afterSequence:sequence,pollSnapshots:false})});
    await service.initialize();if(this.stopped){service.stop();return;}this.threadDisplays=service;
    this.registerInlineInterval(()=>{if(service.active)void service.tick().catch(error=>logFailure('reply.follow',error));},1000);
    this.registerEvent(this.app.vault.on('rename',(file,oldPath)=>{void service.rename(oldPath,file.path).catch(error=>logFailure('reply.rename',error));}));
  }
  private async reloadForConnection(beforeDispatch:()=>boolean){
    if(this.stopped||Platform.isMobile)return false;
    const dispatch=()=>{if(!beforeDispatch())return false;new Notice('T3 Code: The connection stopped responding. Reloading Obsidian.',10000);return true;};
    if(this.clientMaintenance)return this.clientMaintenance.reloadCurrent(dispatch);
    if(!dispatch())return false;
    if(!nativeHost(this.app).commands.executeCommandById('app:reload'))throw Error('Obsidian refused the native reload command.');
    return true;
  }

  private async inlineHostTarget():Promise<ResponseStorageTarget>{
    const machine=this.defaultNoProjectMachine(),paired=this.settings.paired.find(connection=>connection.id===machine)??this.settings.paired[0];
    if(!paired)throw Error('Connect T3 before streaming replies.');
    const project=await this.commandProject(paired.environmentId);
    return {environmentId:paired.environmentId,workspaceRoot:project.workspaceRoot,directory:`${this.app.vault.configDir}/t3-code/inline/v1`,connectionId:paired.id};
  }
  private async localResponseTarget(request:Request):Promise<ResponseStorageTarget>{
    const connection=this.connection(request.project),environmentId=request.connection.environmentId??connection.environmentId;
    if(!environmentId)throw Error('The reply has no verified T3 environment.');
    return {environmentId,workspaceRoot:request.project.workspaceRoot,directory:`${this.app.vault.configDir}/t3-code/inline/v1`,...(connection.connectionId?{connectionId:connection.connectionId}:{})};
  }
  private async prepareHostedInline(job:InlineJob,request:Request){
    const host=await this.localResponseTarget(request);
    const threadEnvironmentId=request.connection.environmentId??await this.localInlineEnvironment();
    job.hostTarget=host;
    request.inlineHost={localOnly:true,nativeProjection:true,responseContainer:true,version:4,finalAnswerFormat:finalAnswerFormat(job.finalAnswerFormat),independent:true,threadTitle:request.title,initialOwner:this.inlineActor,id:job.id,vaultId:this.settings.vaultId,host,notePath:job.path,threadId:job.threadId!,messageId:job.messageId!,projectId:request.project.id,threadEnvironmentId,initialHash:job.bodyHash,createdAt:job.createdAt,keepIntermediate:job.keepIntermediate===true,intermediateMode:intermediateMode(job.intermediateMode,job.keepIntermediate),...(job.initialInput?{initialInput:job.initialInput}:{})};

  }

  private async stopLocalInline(job:InlineJob){
    const current=this.deviceInline?.localResponse(job.id);
    if(current)return this.deviceInline!.stopResponse(current.host,job.id,nativeResponses(this.app).stoppedBody(job.id),job.remoteStopOperationId);
    if(!job.threadId||!job.threadEnvironmentId)throw Error('The saved local response has no T3 routing identity.');
    await interruptStoppedResponse(()=>this.inlineThreadAccess(job.threadEnvironmentId!),job.remoteStopOperationId??job.id,job.threadId,job.turnId,10_000,job.messageId,job.projectId,job.createdAt,job.stopRunTerminal);
    return {version:1 as const,bindingId:job.id,commandId:job.remoteStopOperationId??'',epoch:1,revision:1,hostRecorded:true,runTerminal:!!job.stopRunTerminal,finalSaved:true,finalWriterPending:false};
  }
  private async stopHostedInline(id:string,_target?:ResponseStorageTarget,operationId?:string){
    const local=this.deviceInline?.localResponse(id);if(!local){this.deviceInline?.stopLocally(id);return;}
    return this.deviceInline!.stopResponse(local.host,id,nativeResponses(this.app).stoppedBody(id),operationId);
  }
  private async chatTarget(notePath?:string,preferred?:NoteThread,ignorePreviousThread=false,overrideKey?:string,interactive=true):Promise<{project:Project;link:FolderLink}> {
    if(isNoProjectKey(overrideKey))return this.noProjectTarget(overrideKey,interactive);
    if(overrideKey===NEW_FOLDER_PROJECT){if(!notePath?.includes('/'))throw Error('Choose a note inside a folder.');return (await this.folderTarget(notePath,true,interactive))!;}
    const link=notePath?folderLinkForPath(this.settings.folderLinks.filter(link=>link.folderPath!=='/'),notePath):undefined;
    if(overrideKey){const project=[...this.projects(),...this.settings.directProjects,...this.settings.projects].find(item=>projectKey(item)===overrideKey);if(!project)throw Error('The chosen T3 project is unavailable. Choose a project again.');return {project,link:link&&projectKey(project)===`${link.connectionId?link.connectionId+':':''}${link.projectId}`?link:{id:'project-override',folderPath:'/',connectionId:project.connectionId??'',projectId:project.id,projectTitle:project.title,workspaceRoot:project.workspaceRoot,self:false}};}
    const remembered=preferred??(!ignorePreviousThread?this.noteThread(notePath):undefined);
    if(remembered){const project=this.projectForNoteThread(remembered);return {project,link:link??{id:'note-thread',folderPath:'/',connectionId:remembered.connectionId,projectId:remembered.projectId,projectTitle:project.title,workspaceRoot:remembered.workspaceRoot,self:true}};}
    if(link)return {project:this.projectForLink(link),link};
    return this.noProjectTarget(NO_PROJECT,interactive);
  }
  vaultConnection():VaultHost|undefined {
    const host=vaultHost(this.settings);if(!host)return;
    const localRoot=this.localVaultPath();
    if(!host.connectionId&&localRoot&&sameWorkspacePath(host.workspaceRoot,localRoot)&&(!host.environmentId||host.environmentId===this.eventLocalEnvironmentId))return host;
    const legacy=!this.settings.vaultHost?this.settings.folderLinks.find(link=>link.folderPath==='/'):undefined;
    const candidates=legacy&&!host.connectionId&&!host.environmentId?this.settings.directProjects.filter(project=>project.connectionId&&sameWorkspacePath(project.workspaceRoot,host.workspaceRoot)&&project.id===legacy.projectId):[];
    const paired=this.settings.paired.find(item=>item.id===host.connectionId&&(!host.environmentId||item.environmentId===host.environmentId))??this.settings.paired.find(item=>item.environmentId===host.environmentId)??(candidates.length===1?this.settings.paired.find(item=>item.id===candidates[0].connectionId):undefined);
    return paired?{...host,connectionId:paired.id,environmentId:paired.environmentId}:host;
  }
  private defaultNoProjectMachine():string|undefined{
    const local=this.settings.paired.find(connection=>localRoute(connection));
    const selected=this.settings.paired.find(connection=>connection.id===this.settings.directScanId);
    return local?.id??this.fallbackNoProjectMachine()??selected?.id;
  }
  private fallbackNoProjectMachine():string|undefined {
    const host=this.vaultConnection();
    if(host?.connectionId)return host.connectionId;
    return this.settings.paired.length===1?this.settings.paired[0].id:undefined;
  }


  private async readNoProjectProject(connection:Connection,signal?:AbortSignal):Promise<Project>{return parseProjects({projects:[await runBridge(connection,['no-project'],'',{signal})]})[0];}
  private async noProjectTarget(key=NO_PROJECT,interactive=true):Promise<{project:Project;link:FolderLink}>{
    let machine=noProjectMachine(key)??this.defaultNoProjectMachine();
    if(machine==='local'){machine=this.settings.paired.find(connection=>localRoute(connection))?.id;if(!machine)throw Error('Pair the selected local T3 machine through T3 Connect.');}
    if(!machine){
      if(!interactive)throw Error('Choose a connected T3 machine before sending.');
      const choices=this.vaultMachines();if(!choices.length){this.openSettings();throw Error('Sign in or pair T3 before sending.');}
      machine=await new Promise<string>((resolve,reject)=>new ConnectedMachineModal(this.app,choices,resolve,reject).open());
    }
    if(machine.startsWith('environment:')){const discovered=this.cloudMachines.find(value=>'environment:'+value.environmentId===machine);if(!discovered)throw Error('Refresh T3 connections.');await this.connectAccountMachine(discovered);machine=this.settings.paired.find(connection=>connection.environmentId===discovered.environmentId)?.id;}
    const paired=this.settings.paired.find(connection=>connection.id===machine);if(!paired)throw Error('Reconnect the selected T3 machine.');
    const connection:Connection={transport:'direct',host:'direct',executable:'',url:paired.url,connectionId:paired.id,environmentId:paired.environmentId};
    const found=await this.readNoProjectProject(connection),project={...found,connectionId:paired.id,connectionName:paired.name};
    this.noProjectProjects.set(paired.id,project);this.settings.directProjects=[...this.settings.directProjects.filter(item=>projectKey(item)!==projectKey(project)),project];
    return {project,link:{id:'no-project',folderPath:'/',connectionId:paired.id,projectId:project.id,projectTitle:project.title,workspaceRoot:project.workspaceRoot,self:false,environmentId:paired.environmentId}};
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
    if(notePath&&overrideKey===NEW_FOLDER_PROJECT)return this.folderTarget(notePath,false);
    return this.chatTarget(notePath,undefined,true,overrideKey);
  }
  vaultMachines():VaultMachine[]{
    const remote=this.settings.paired.filter((c,index,list)=>list.findIndex(other=>other.environmentId===c.environmentId)===index).map(c=>({id:c.id,name:c.name,environmentId:c.environmentId,detail:this.machineErrors[c.environmentId]?'Unavailable — retry connection':undefined}));
    const discovered=this.cloudMachines.filter(m=>!this.settings.paired.some(c=>c.environmentId===m.environmentId)).map(m=>({id:'environment:'+m.environmentId,name:m.name,environmentId:m.environmentId,detail:this.machineErrors[m.environmentId]?'Unavailable — retry connection':undefined}));
    return [...remote,...discovered];
  }
  async configureVaultConnection():Promise<VaultHost>{
    if(this.vaultSetup)return this.vaultSetup;
    const identity=this.settings.vaultId;
    const settingsPath=`${this.app.vault.configDir}/plugins/${this.manifest?.id||'send-to-t3-code'}/data.json`;
    const selected=(machine:VaultMachine)=>{const c=this.settings.paired.find(c=>c.id===machine.id||'environment:'+c.environmentId===machine.id);if(!c)throw Error('This machine connection changed. Refresh machines.');return c;};
    const modal=this.vaultSetupModal=new VaultSetupModal(this.app,{
      vaultId:identity,vaultName:this.app.vault.getName(),settingsPath,
      machines:()=>this.vaultMachines(),
      refresh:async()=>{if(this.nativeAccount)await this.refreshMachines();else if(!this.settings.paired.length)throw Error('Sign in or pair a machine in connection settings, then return here.');},
      connect:async machine=>{if(machine.id.startsWith('environment:')){const cloud=this.cloudMachines.find(m=>'environment:'+m.environmentId===machine.id);if(cloud)await this.connectAccountMachine(cloud);}const c=selected(machine);return connectVaultRemote({transport:'direct',host:'direct',executable:'',url:c.url,environmentId:c.environmentId,connectionId:c.id},await this.sessionFor(c.id));},
      roots:machine=>{const c=selected(machine),host=this.vaultConnection();return [...this.settings.vaultLocations.filter(l=>l.environmentId===c.environmentId).map(l=>l.workspaceRoot),...(host&&(host.connectionId===c.id||host.environmentId===c.environmentId)?[host.workspaceRoot]:[])];},
      link:async(machine,root)=>{
        let host:VaultHost;
        if(machine.local){
          const workspaceRoot=(this.app.vault.adapter as {getFullPath?:(path:string)=>string}).getFullPath?.('');
          if(!workspaceRoot)throw Error('This vault does not expose a local filesystem path.');
          host={connectionId:'',environmentId:await this.localInlineEnvironment(),workspaceRoot};
        }else{
          const c=selected(machine);
          if(!root)throw Error('Choose a synced vault folder.');
          host={connectionId:c.id,environmentId:c.environmentId,workspaceRoot:root};
        }
        if(this.stopped||modal.isClosed)throw new VaultSetupCancelled();
        if(this.settings.vaultId!==identity)throw Error('Vault settings changed during setup. Open Connect vault again.');
        const before={vaultHost:this.settings.vaultHost,vaultLocations:this.settings.vaultLocations};
        this.settings.vaultHost=host;
        this.settings.vaultLocations=[...this.settings.vaultLocations.filter(l=>l.environmentId!==host.environmentId),{environmentId:host.environmentId!,workspaceRoot:host.workspaceRoot}];
        try{await this.save();}catch(error){Object.assign(this.settings,before);throw error;}
        return host;
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
      const host=this.vaultConnection(),vaultRoot=host?.connectionId===(project.connectionId??'')?host:undefined;
      const environmentId=this.settings.paired.find(c=>c.id===project.connectionId)?.environmentId;
      root=vaultRoot?.workspaceRoot??this.settings.vaultLocations.find(location=>location.environmentId===environmentId)?.workspaceRoot;
      if(!root)return;path=note.path;
    }
    const separator=root.includes('\\')&&!root.includes('/')?'\\':'/';
    return root.replace(/[\\/]+$/,'')+separator+path.replace(/[\\/]+/g,separator);
  }
  private messageFooter(destination?:string):string {
    return obsidianFooter(this.app.vault.getName(),destination);
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
    let thread:NormalizedThread;
    try{thread=readThreadSnapshot({thread:await runBridge(connection,['read',threadId],'',{signal,control:true})}).thread;}
    catch(error){if(/HTTP 404\b/.test(message(error)))throw Error('The selected T3 thread does not exist. Choose another thread.');throw error;}
    if(thread?.id!==threadId||thread.projectId!==project.id||thread.archivedAt||thread.deletedAt)throw Error('The selected T3 thread is unavailable in this project.');
    return thread;
  }
  private async requestTitle(connection:Connection,project:Project,threadId:string|undefined,notePath:string|undefined){
    if(!threadId)return noteThreadTitle(notePath,this.settings.threadTitleGeneration);
    const thread=await this.readChatThread(connection,project,threadId);
    return typeof thread.title==='string'&&thread.title.trim()?thread.title.slice(0,160):'T3 thread';
  }
  async sendChat(prompt:string,note?:{path:string;absolutePath?:string},options?:{threadId?:string;responseId?:string;newThread?:boolean;expectedProjectKey?:string;projectOverrideKey?:string;requestId?:string;jobOptions?:ResolvedJobOptions;barePrompt?:boolean;sourceContext?:EditorChatContext;onPrepared?:(request:Request,input:string)=>void|Promise<void>}):Promise<void> {
    if(this.busy)throw Error('Another send is in progress. Wait for it to finish.');
    if(!prompt.trim())throw Error('Enter a message before sending.');
    if(this.stopped)throw Error('The plugin has been disabled. Re-enable it before sending.');
    this.busy=true;
    const startedAt=Date.now();let request:Request|undefined;
    try{

      let smartCapture:SmartCapture|undefined,steeringSource:SteeringSource|undefined;
      let preparedInput=prompt;
      const historical=note&&options?.threadId&&!options.expectedProjectKey?this.previousNoteThread(note.path,options.threadId):undefined;
      let {project,link}=await this.chatTarget(note?.path,historical,Boolean(options?.newThread||options?.expectedProjectKey),options?.projectOverrideKey??options?.expectedProjectKey);
      if(options?.expectedProjectKey&&projectKey(project)!==options.expectedProjectKey)throw Error('The note’s linked project changed. Choose a thread again.');
      const readiness=this.projectReadinessError(project);if(readiness)throw Error(readiness);
      const connection=this.connection(project);
      const active=this.noteThread(note?.path);
      const threadId=options?.threadId??(!options?.newThread&&active&&project.id===active.projectId&&((project.connectionId??'')===active.connectionId||!!connection.environmentId&&connection.environmentId===active.environmentId)?active.threadId:undefined);
      await this.assertNoteMode(note?.path,{...connection,projectId:project.id,threadId});
      if(note&&options?.sourceContext?.smartDocument!==undefined){
        const context=options.sourceContext;
        await this.recoverSmartReplies(note.path,context.smartDocument!);
        const plan=await prepareSmartSend(this.smartData(),note.path,await this.smartKey(project,connection,threadId??''),context.smartDocument!,context.smartScope);
        const question=context.smartQuestion??'';
        const selected=context.smartScope?explicitSelectionText(context.snapshot??context.smartDocument!,context.smartScope):context.canonicalAnchor?.text??context.anchor?.text??'';
        // Explicit selections are deliberate input, including text delivered
        // before. Keep the normal capture/ranges for coverage and safe cleanup.
        const material=context.referenceSelection&&selected?`Selected text:\n${selected}`:context.smartScope?selected:plan.text;
        if(!material.trim()&&!question.trim()){new Notice('Nothing new to send.');return;}
        preparedInput=[material,question.trim()?`**USER ASKS:**\n${question}`:''].filter(Boolean).join('\n\n');
        prompt=preparedInput;smartCapture=plan.capture;
        steeringSource={document:context.smartDocument!,ranges:context.referenceSelection?[]:plan.ranges};
      }
      const images=options?.barePrompt?undefined:await this.prepareImages(prompt,note?.path??'',true,options?.sourceContext?.snapshot);
      let text=images?.markdown??prompt;
      if(options?.barePrompt){
        text=prompt+this.messageFooter(note?.path);
      }else if(note){
        text+=this.messageFooter(note.path);
      }else{
        text+=this.messageFooter();
      }
      if(text.length>120_000)throw Error('The message and note path exceed T3’s 120,000-character limit. Shorten the message before sending.');
      if(connection.transport==='direct'){
        const session=await this.sessionFor(connection.connectionId??'');
        if(!session||session.expiresAt<=Date.now())throw Error('Sign in or pair this connection on this device before sending.');
        const host=this.vaultConnection(),vaultLink=host&&(host.connectionId===project.connectionId||host.environmentId===connection.environmentId)?host:undefined;
        const vaultRoot=vaultLink?.workspaceRoot??this.settings.vaultLocations.find(location=>location.environmentId===connection.environmentId)?.workspaceRoot;
        if(note&&vaultRoot&&!options?.onPrepared){
          const remote=await connectVaultRemote(connection,session);
          try{
            if(!await remote.matches(vaultRoot,`${this.app.vault.configDir}/plugins/${this.manifest?.id||'send-to-t3-code'}/data.json`,this.settings.vaultId))throw Error('The chosen vault folder no longer matches this vault. Use Change machine in settings to reconnect it.');
            await waitForVaultNote(remote,vaultRoot,note.path,()=>!this.stopped,()=>new Notice('Waiting for this note to reach the selected machine through Obsidian Sync…',10000));
          }finally{remote.close();}
        }
      }
      if(this.stopped)throw Error('The plugin was disabled before sending.');
      const title=await this.requestTitle(connection,project,threadId,note?.path);
      request={...(smartCapture?{smartSend:smartCapture}:{}),...(options?.jobOptions?{jobOptions:options.jobOptions}:{}),id:options?.requestId??randomId(),project:{...project},title,prompt:text,connection,...(images?.attachments.length?{attachments:images.attachments,context:images.context}:{}),...(threadId?{threadId}:{}),...(note?{noteThread:this.noteThreadIntent(note.path,project,connection)}:{}),...this.folderLinkIntent(link)};
      if(note&&!options?.barePrompt)await this.prepareNoteSteering(request,note.path,preparedInput,options?.sourceContext,options?.responseId,steeringSource);
      await options?.onPrepared?.(request,preparedInput);
      logEvent('request.prepared',{requestId:request.id,threadId:request.threadId,projectId:request.project.id,notePath:note?.path,promptHash:contentHash(request.prompt),promptLength:request.prompt.length});
      this.settings.pending.push(request);
      try{await this.save();logEvent('request.saved',{requestId:request.id});}catch(e){this.settings.pending=this.settings.pending.filter(r=>r!==request);throw e;}
      await this.dispatch(request);
      if(options?.sourceContext?.smartQuestion)this.app.saveLocalStorage(this.chatDraftKey,'');
      const draft:unknown=this.app.loadLocalStorage(this.chatDraftKey);
      if(typeof draft==='string'&&draft&&(draft===prompt||prompt.endsWith(`\n\n**USER ASKS:**\n${draft}`)))this.app.saveLocalStorage(this.chatDraftKey,'');
    }catch(e){if(request)await this.failRequest(request,e,'preparation',startedAt);else if(!(e instanceof ProjectCreationCancelled))this.recordSendFailure(undefined,e,'preparation',startedAt);if(e instanceof ProjectCreationCancelled)throw e;throw new RequestDeliveryError(`${unsavedMessage(e)} ${request?'The send failed. Its response was removed. See the send failure log.':'No message was sent or queued.'}`,false,Boolean(request));}
    finally{this.busy=false;}
  }
  async exportDiagnostics(){
    const modal=new Modal(this.app);modal.titleEl.setText('Send failure log');
    const log=sendFailureLog(this.app.loadLocalStorage(this.failureKey()),pluginManifest.version,this.deviceId);
    modal.contentEl.createEl('p',{text:'The last 64 send failures on this device. Message text and credentials are excluded.'});
    const field=modal.contentEl.createEl('textarea',{cls:'send-to-t3-failure-log'});field.readOnly=true;field.value=JSON.stringify(log,null,2);
  }

  projects(){
    const catalog=new Map<string,{project:Project;score:number}>();
    for(const project of this.settings.directProjects){
      const c=this.settings.paired.find(c=>c.id===project.connectionId);
      const key=JSON.stringify([c?.environmentId??project.connectionId,project.id]);
      const score=this.connectionScore(c);
      if(!catalog.has(key)||score>catalog.get(key)!.score)catalog.set(key,{project,score});
    }
    return [...catalog.values()].map(entry=>entry.project);
  }
  private connectionScore(connection?:PairedConnection){
    const session=connection&&this.pairedSessions[connection.id];
    const credential=!!session&&session.environmentId===connection?.environmentId&&session.url===connection.url&&session.expiresAt>Date.now()+5000;
    return (this.projectDiscovery?.status(this.sourceKey(connection))==='available'?4:0)+(this.cloudMachines.some(machine=>machine.environmentId===connection?.environmentId&&machine.url===connection.url)?2:0)+(credential?1:0)+(connection&&localRoute(connection)?8:0);
  }
  connection(project:Project):Connection {
    const exact=this.settings.paired.find(connection=>connection.id===project.connectionId);
    if(project.connectionId&&!exact)throw Error('Reconnect the selected project machine through T3 Connect.');
    const environmentId=this.settings.folderLinks.find(link=>link.projectId===project.id&&sameWorkspacePath(link.workspaceRoot,project.workspaceRoot))?.environmentId;
    const catalogs=this.settings.directProjects.filter(item=>item.id===project.id&&sameWorkspacePath(item.workspaceRoot,project.workspaceRoot)).flatMap(item=>this.settings.paired.filter(connection=>connection.id===item.connectionId));
    const environments=[...new Set(catalogs.map(connection=>connection.environmentId))];
    const paired=exact??[...this.settings.paired].sort((a,b)=>this.connectionScore(b)-this.connectionScore(a)).find(connection=>connection.environmentId===(environmentId??(environments.length===1?environments[0]:undefined)));
    if(!paired)throw Error('Connect this project through T3 Connect before sending.');
    return {transport:'direct',host:'direct',executable:'',url:paired.url,connectionId:paired.id,environmentId:paired.environmentId};
  }
  async pairConnection(name:string,address:string,code:string,expectedEnvironmentId?:string,method?:ConnectionMethod){
    const input=method?routePairing(method,address,code):undefined;
    const result=await pair(input?.url??address,input?.code??code,undefined,expectedEnvironmentId,AGENT_SETUP_PERMISSIONS);
    const existing=this.settings.paired.find(c=>c.environmentId===result.descriptor.environmentId&&c.url===result.session.url);
    const c:PairedConnection=existing??{id:randomId(),name:name.trim()||result.descriptor.label,url:result.session.url,environmentId:result.descriptor.environmentId};
    if(!existing)this.settings.paired.push(c);
    if(method&&method!=='connect')c.routeKind=method;
    this.pairedSessions[c.id]=result.session;this.settings.directScanId=c.id;this.mode='direct';await this.save();
    this.syncProjectSources();this.deviceInline?.reconnect();await this.htmlResults?.recover(c.environmentId);
    await this.projectDiscovery?.refresh(true);
  }
  routeDescription(id:string){
    const route=this.settings.paired.find(item=>item.id===id);if(!route)return 'Connection removed';
    const active=this.routeStatus.active(id),failure=this.routeFailures.get(id)??this.routeStatus.failure(id);
    return `${route.url} · ${active?'Active · Connected':this.routeStatus.pending(id)?'Connecting…':failure?'Disconnected · '+failure:'Standby · '+this.pairingStatus(route)}`;
  }
  connectionGroups(){return routeGroups(orderedRoutes(this.settings.paired,this.routeOrder,c=>this.connectionScore(c)));}
  async preferRoute(id:string,direction:number){
    const route=this.settings.paired.find(c=>c.id===id);if(!route)return;
    const routes=orderedRoutes(this.settings.paired.filter(c=>c.environmentId===route.environmentId),this.routeOrder,c=>this.connectionScore(c));
    const index=routes.findIndex(c=>c.id===id),next=index+direction;if(next<0||next>=routes.length)return;
    [routes[index],routes[next]]=[routes[next],routes[index]];const ids=new Set(routes.map(c=>c.id));
    this.routeOrder=[...this.routeOrder.filter(id=>!ids.has(id)),...routes.map(c=>c.id)];await this.saveDeviceState();
  }
  async checkRoute(id:string){const route=this.settings.paired.find(c=>c.id===id);if(!route)throw Error('This route was removed.');try{await this.pairedThreadAccess(route);this.routeFailures.delete(id);}catch(error){this.routeFailures.set(id,message(error));throw error;}}
  async connectionChoice(method:ConnectionMethod){this.connectionMethod=method;await this.saveDeviceState();}
  pairingStatus(c:PairedConnection){const s=this.pairedSessions[c.id];return !s?'Pair on this device':s.expiresAt<=Date.now()?'Pairing expired':`Paired on this device until ${new Date(s.expiresAt).toLocaleDateString()}`;}
  async startEmailSignIn(email:string){
    this.cancelCloudLogin();this.emailLogin=null;this.cloudError='';const generation=this.cloudGeneration;
    this.signInEmail=email.trim();await this.saveDeviceState();
    const login=await beginEmailLogin(email,nativeAccountFetch);
    if(this.stopped||generation!==this.cloudGeneration)return;
    this.emailLogin=login;this.cloudChanged?.();
  }
  async finishEmailSignIn(code:string){
    const login=this.emailLogin;if(!login)throw Error('Request a T3 email code first.');const generation=this.cloudGeneration;
    const account=await verifyEmailLogin(login,code,nativeAccountFetch);
    if(this.stopped||generation!==this.cloudGeneration){void revokeNativeAccount(account,nativeAccountFetch).catch(()=>{});return;}
    this.nativeAccount=account;this.nativeToken=undefined;this.emailLogin=null;this.cloudAccount=null;
    this.signInEmail=account.identity;this.signInExpired=false;
    this.mode='direct';await this.save();await this.refreshMachines();
    if(this.nativeAccount===account){this.deviceInline?.reconnect();await this.htmlResults?.recover();}
  }
  async nativeCredential():Promise<CloudAccount>{
    const account=this.nativeAccount;if(!account)throw new SignInRequiredError(this.signInExpired?REAUTHENTICATE_MESSAGE:'Sign in to T3 on this device to resume replies.');
    if(this.nativeToken&&this.nativeToken.expiresAt>Date.now()+10000)return this.nativeToken;
    if(this.nativeRefreshing)return this.nativeRefreshing;
    const generation=this.cloudGeneration;
    const active=()=>!this.stopped&&this.nativeAccount===account&&generation===this.cloudGeneration;
    const work=(async()=>{try{const token=await nativeRelayAccount(account,async()=>{if(!active())throw Error('Sign-in cancelled.');await this.save();},nativeAccountFetch);if(!active())throw Error('Sign-in cancelled.');this.nativeToken=token;return token;}catch(error){if(active()&&signInRequired(error))await this.clearAccount(true);throw error;}})();
    this.nativeRefreshing=work;try{return await work;}finally{if(this.nativeRefreshing===work)this.nativeRefreshing=undefined;}
  }
  async sessionFor(id:string,forceRefresh=false,permissions:readonly string[]=PLUGIN_PERMISSIONS):Promise<PairedSession|undefined>{
    const session=this.pairedSessions[id];const c=this.settings.paired.find(c=>c.id===id);
    // Managed is shared discovery metadata. A manual credential belongs to
    // this device and remains usable without an account session.
    if(session&&!session.accountId&&session.url===c?.url&&session.environmentId===c.environmentId&&session.expiresAt>Date.now()+5000){if(permissions.some(scope=>!PLUGIN_PERMISSIONS.some(required=>required===scope))&&!permissions.every(scope=>session.permissions?.includes(scope)))throw Error('This pairing does not permit MCP setup. Pair this machine again with agent configuration access, or use your T3 account connection.');return session;}
    if(c?.managed&&!this.nativeAccount)throw new SignInRequiredError(this.signInExpired?REAUTHENTICATE_MESSAGE:'Sign in to T3 on this device to resume replies.');
    if(session?.accountId&&session.accountId!==this.nativeAccount?.userId)throw Error('Sign in to the T3 account that owns this connection.');
    // Pre-v2 account sessions requested only the two orchestration scopes.
    // Refresh them before any remote vault check; token expiry is not enough.
    if(session&&session.expiresAt>Date.now()+60000&&!forceRefresh&&(!c?.managed||hasPluginPermissions(session))&&permissions.every(scope=>session.permissions?.includes(scope)))return session;
    if(!c?.managed||!this.nativeAccount)return session;
    const existing=this.sessionRefreshing.get(id);if(existing){const value=await existing;if(permissions.every(scope=>value.permissions?.includes(scope)))return value;return this.sessionFor(id,true,permissions);}
    const account=this.nativeAccount;const generation=this.cloudGeneration;
    const work=(async()=>{
      const credential=await this.nativeCredential();const machines=await discoverMachines(credential);
      const m=machines.find(m=>m.environmentId===c.environmentId&&m.url===c.url);
      if(!m)throw Error('This T3 connection is no longer available to your account. Reconnect its machine.');
      const next=await connectMachine(await this.nativeCredential(),m,this.deviceId+':'+account.userId,undefined,permissions);
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
    this.cloudTimer=setTimeout(()=>{void this.pollCloudLogin(login,generation).catch(error=>logFailure('connection.account.poll',error));},Math.max(1000,login.nextPollAt-Date.now()));
  }
  private async pollCloudLogin(login:DeviceLogin,generation:number){
    try{
      const account=await pollLogin(login);if(this.stopped||generation!==this.cloudGeneration)return;
      if(account){this.cloudAccount=account;this.cloudLogin=null;await this.save();await this.refreshMachines();}
      else this.scheduleCloudPoll();
    }catch(e){if(generation!==this.cloudGeneration)return;this.cloudError=message(e);this.cloudLogin=null;}
    this.cloudChanged?.();
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
    const sources:ProjectSource[]=[];
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
    if(folder.path==='/')throw Error('The vault root is not a project link. Choose a folder inside the vault.');
    if((folder.path==='/'?this.app.vault.getRoot():this.app.vault.getAbstractFileByPath(folder.path))!==folder)throw Error('This folder no longer exists. Choose a folder again.');
    const previous=this.settings.folderLinks,previousLocations=this.settings.projectCreationLocations;
    const existing=previous.find(link=>link.folderPath===folder.path&&link.projectId===project.id&&link.connectionId===(project.connectionId??''));
    this.settings.folderLinks=upsertFolderLink(previous,verified??{id:existing?.id??randomId(),folderPath:folder.path,connectionId:project.connectionId??'',projectId:project.id,projectTitle:project.title,workspaceRoot:project.workspaceRoot,self,environmentId:this.connection(project).environmentId??await this.localInlineEnvironment(),vaultId:this.settings.vaultId,...(existing?.replyFolders?{replyFolders:existing.replyFolders}:{})});
    if(!self)this.rememberProjectLocation(project,this.settings.folderLinks.find(link=>link.folderPath===folder.path)?.environmentId);
    try{await this.save();this.refreshFolderIndicators();}catch(error){this.settings.folderLinks=previous;this.settings.projectCreationLocations=previousLocations;this.refreshFolderIndicators();throw error;}
    new Notice(`${folder.path} linked to ${projectLabel(project)}.`);
  }
  private async updateCodebaseProjectLinks(scope:import('../projects/codebase-core').CodebaseScope,change:{title?:string;deleted?:boolean}){
    if(!this.eventLocalEnvironmentId&&!Platform.isMobile)this.eventLocalEnvironmentId=await this.localInlineEnvironment();
    const previous=this.settings.folderLinks;
    this.settings.folderLinks=changeCodebaseProjectLinks(previous,scope,change,link=>link.environmentId??this.settings.paired.find(c=>c.id===link.connectionId)?.environmentId??(!link.connectionId||link.connectionId==='local'?this.eventLocalEnvironmentId:undefined));
    try{await this.save();this.refreshFolderIndicators();this.refreshProjectsInBackground(true);}catch{this.settings.folderLinks=previous;this.refreshFolderIndicators();throw Error('The project changed in T3, but its folder links could not be saved. The link update will be tried again after reload.');}
  }
  async unlinkFolder(path:string){
    const previous=this.settings.folderLinks;
    this.settings.folderLinks=previous.filter(link=>link.folderPath!==path);
    try{await this.save();this.refreshFolderIndicators();}catch(error){this.settings.folderLinks=previous;this.refreshFolderIndicators();throw error;}
  }

  private async localFolderProject(folder:TFolder):Promise<Project>{
    const root=this.localVaultPath(folder.path==='/'?'':folder.path);
    if(!root)throw Error('Choose this folder on its connected T3 machine.');
    const environmentId=await this.localInlineEnvironment(),paired=this.settings.paired.find(connection=>connection.environmentId===environmentId)!;
    const remote=await connectVaultRemote({transport:'direct',host:'direct',executable:'',url:paired.url,environmentId,connectionId:paired.id},await this.sessionFor(paired.id));
    try{return {...await remote.ensureProject(vaultRegistration(environmentId,root,this.settings.vaultId,folder.name)),connectionId:paired.id,connectionName:paired.name};}finally{remote.close();}
  }
  private rememberProjectLocation(project:Project,environmentId?:string){
    const c=this.settings.paired.find(c=>c.id===project.connectionId);
    this.settings.projectCreationLocations=rememberProjectCreationLocation(this.settings.projectCreationLocations,{
      connectionId:project.connectionId??'',environmentId:environmentId??c?.environmentId??(!project.connectionId?this.eventLocalEnvironmentId:undefined),
      ...(!project.connectionId?{deviceId:this.deviceId}:{}),parentPath:workspaceParentPath(project.workspaceRoot),selectedAt:new Date().toISOString(),
    });
  }
  private projectWorkspaceDefaults(machineId?:string){
    const locations=[...this.settings.projectCreationLocations];
    // Existing installations can start from their latest external link without a migration write.
    for(const link of [...this.settings.folderLinks].reverse()){
      if(link.self||link.folderPath==='/')continue;
      const c=this.settings.paired.find(c=>c.id===link.connectionId);
      const change=this.settings.folderLinkChanges.find(change=>change.folderPath===link.folderPath&&change.link?.id===link.id);
      const environmentId=link.environmentId??c?.environmentId;
      locations.push({connectionId:link.connectionId,environmentId,...(!link.connectionId&&(!environmentId||environmentId===this.eventLocalEnvironmentId)?{deviceId:this.deviceId}:{}),parentPath:workspaceParentPath(link.workspaceRoot),selectedAt:change?.at??'1970-01-01T00:00:00.000Z'});
    }
    return projectCreationDefaults(locations,this.vaultMachines(),this.deviceId,machineId);
  }
  private pickFolderProject(folderPath:string,name:string,onChosen?:(project:Project)=>Promise<void>):Promise<Project|undefined>{
    if(this.projectCreateModal)throw Error('Choose or cancel the open project workspace first.');
    return new Promise(resolve=>{
      this.projectCreateModal=new ProjectCreateModal(this.app,name,{
        machines:()=>this.vaultMachines(),defaults:machineId=>this.projectWorkspaceDefaults(machineId),connect:machine=>this.projectLocation(machine),
        configure:el=>{el.createEl('p',{text:'Project files remain in the T3 workspace and appear in Codebase view.'});},
        link:async project=>{
          if(this.stopped)throw Error('The plugin was disabled before creating the project.');
          if(onChosen)await onChosen(project);
          else {
            const previous=this.settings.projectCreationLocations;
            this.rememberProjectLocation(project);
            try{await this.save();}catch(error){this.settings.projectCreationLocations=previous;throw error;}
          }
          resolve(project);
        },
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
    const host=this.vaultConnection();if(host&&(machine.local?!host.connectionId:host.connectionId===c?.id||host.environmentId===c?.environmentId))roots.push(host.workspaceRoot);
    if(machine.local||c&&localRoute(c)){const root=this.localVaultPath();if(root)roots.push(root);}
    if(roots.some(root=>workspaceInsideVault(path,root)))throw Error('Choose a workspace outside the Obsidian vault.');
  }
  async projectLocation(machine:VaultMachine):Promise<ProjectLocation>{
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
  private async clearAccount(expired:boolean){
    this.signInEmail=this.nativeAccount?.identity??this.signInEmail;this.signInExpired=expired;
    this.cancelCloudLogin();this.nativeAccount=null;this.nativeToken=undefined;this.nativeRefreshing=undefined;this.sessionRefreshing.clear();
    for(const [id,s] of Object.entries(this.pairedSessions))if(s.accountId)delete this.pairedSessions[id];
    this.cloudAccount=null;this.cloudMachines=[];this.accountCandidates.clear();this.registryNextAttempt=0;this.cloudError='';this.machineErrors={};this.connectionSyncComplete=false;this.machineRefreshing=undefined;this.cloudRefreshing=undefined;
    // Clear only device credentials. Keep synced links, bindings and choices.
    await this.saveDeviceState();this.syncProjectSources();this.cloudChanged?.();
  }
  async signOutCloud(){
    const old=this.nativeAccount;await this.clearAccount(false);
    if(old)try{await revokeNativeAccount(old,nativeAccountFetch);}catch{new Notice('Signed out on this device. T3 could not be reached to revoke the account session; you can revoke it in your T3 account.');}
  }
  async forgetPairing(id:string){delete this.pairedSessions[id];this.projectDiscovery?.invalidate();await this.save();this.refreshProjectsInBackground(true);}
  async removeConnection(id:string){
    if(this.settings.pending.some(r=>r.connection.connectionId===id)||this.settings.completionJobs.some(j=>j.connection.connectionId===id&&j.status==='watching')||this.settings.settlementJobs.some(j=>j.connection.connectionId===id))throw Error('This connection has an unconfirmed request or completion check. Resolve or stop it before removing the connection.');
    this.projectDiscovery?.invalidate();for(const [key,c] of this.accountCandidates)if(c.id===id)this.accountCandidates.delete(key);
    this.settings.paired=this.settings.paired.filter(c=>c.id!==id);this.settings.directProjects=this.settings.directProjects.filter(p=>p.connectionId!==id);this.settings.directSelected=this.settings.directSelected.filter(k=>!k.startsWith(id+':'));delete this.pairedSessions[id];if(this.settings.directScanId===id)this.settings.directScanId=this.settings.paired[0]?.id??'';this.syncProjectSources();await this.save();
  }
  private saveDeviceState(state?:unknown) {
    this.app.saveLocalStorage(this.localKey,jsonClone({deviceId:this.deviceId,mode:this.mode,connectionMethod:this.connectionMethod,routeOrder:this.routeOrder,connection:this.settings.connection,pairedSessions:this.pairedSessions,cloudAccount:this.cloudAccount,nativeAccount:this.nativeAccount,signInEmail:this.signInEmail,signInExpired:this.signInExpired,vaultRegistrations:this.vaultRegistrations}));
    return deviceState(this.deviceId,state??jsonClone({pending:this.settings.pending,completionJobs:this.settings.completionJobs,settlementJobs:this.settings.settlementJobs}));
  }
  private async saveResponseBinding(request:ResponseRequest){
    if(request.vaultId!==this.settings.vaultId)throw Error('This response belongs to another vault.');
    const next=updateResponseBindingData(this.responseBindingReplica,request,this.deviceId);
    const persisted=loadResponseBindingData(this.lastDiskSnapshot?storedSettings(parseJson(this.lastDiskSnapshot))?.responseBindings:undefined);
    if(next===this.responseBindingReplica&&JSON.stringify(persisted[request.id])===JSON.stringify(next[request.id]))return;
    this.responseBindingReplica=next;this.settings.responseBindings=next;
    await this.save(true);
  }
  private sharedSnapshot():SharedSettings{const {pending,completionJobs,settlementJobs,connection,projects,directProjects,selected,directSelected,directScanId,...shared}=this.settings;return jsonClone(shared);}
  private sharedData(input:unknown):SharedSettings{
    const data=storedSettings(input);
    return {...this.sharedSnapshot(),threadNoteMode:threadNoteMode(data?.threadNoteMode),projectCreationLocations:loadProjectCreationLocations(data?.projectCreationLocations),noteContexts:mergeNoteContexts(data?.noteContexts),codebase:data?.codebase,replyFolders:loadReplyFolders(data?.replyFolders),threadTitleGeneration:threadTitleGeneration(data?.threadTitleGeneration),paired:data?.paired??[],folderLinks:loadFolderLinks(data),folderLinkChanges:loadFolderLinkChanges(data?.folderLinkChanges),noteThreads:loadNoteThreads(data?.noteThreads),vaultId:vaultIdentity(data)??this.settings.vaultId,vaultLocations:loadVaultLocations(data),responseBindings:loadResponseBindingData(data?.responseBindings),smartSend:loadSmartSend(data?.smartSend),autoSettleThreads:data?.autoSettleThreads!==false,
      vaultHost:loadVaultHost(data?.vaultHost),
      inlineStreaming:{finalAnswerFormat:finalAnswerFormat(data?.inlineStreaming?.finalAnswerFormat),enabled:data?.inlineStreaming?.enabled??(data?.inlineStreaming?.askT3!==false&&data?.inlineStreaming?.sendToT3!==false),keepIntermediate:data?.inlineStreaming?.keepIntermediate===true,...(data?.inlineStreaming?.intermediateMode?{intermediateMode:intermediateMode(data.inlineStreaming.intermediateMode,data.inlineStreaming.keepIntermediate)}:{})},
      completion:{action:'keep',archiveFolder:''}};
  }
  save(forceShared=false) {
    this.rememberProjectViews();
    this.refreshFolderIndicators();
    const {pending,completionJobs,settlementJobs,connection}=this.settings,intended=this.sharedSnapshot(),intendedThreads=JSON.stringify(this.settings.noteThreads),intendedLinks=JSON.stringify(this.settings.folderLinks);
    const baseline=parseJson(this.queuedSharedSnapshot??this.sharedBaseline) as SharedSettings;
    let snapshot=intended;
    const changes=changedFolderLinks(loadFolderLinks(baseline),snapshot.folderLinks,mergeFolderLinkChanges(this.folderLinkReplica,snapshot.folderLinkChanges),randomId,Math.max(Date.now(),this.folderLinkClock+1));
    if(changes.length)this.folderLinkClock=Date.parse(changes[0].at);
    snapshot.folderLinkChanges=mergeFolderLinkChanges(snapshot.folderLinkChanges,changes);
    const writeShared=forceShared||JSON.stringify(snapshot)!==JSON.stringify(baseline);
    if(writeShared)this.queuedSharedSnapshot=JSON.stringify(snapshot);
    const state=jsonClone({pending,completionJobs,settlementJobs});
    this.app.saveLocalStorage(this.localKey,jsonClone({deviceId:this.deviceId,mode:this.mode,connectionMethod:this.connectionMethod,routeOrder:this.routeOrder,connection,pairedSessions:this.pairedSessions,cloudAccount:this.cloudAccount,nativeAccount:this.nativeAccount,signInEmail:this.signInEmail,signInExpired:this.signInExpired,vaultRegistrations:this.vaultRegistrations}));
    this.saving=this.saving.catch(()=>{}).then(async()=>{
      await deviceState(this.deviceId,state);
      if(!writeShared)return;
      const current=await this.loadSettings();
      const disk=this.sharedData(current);
      snapshot=mergeSharedSettings(baseline,disk,intended);
      snapshot.vaultHost=mergeVaultHost(baseline.vaultHost,disk.vaultHost,intended.vaultHost);
      snapshot.folderLinkChanges=mergeFolderLinkChanges(this.folderLinkReplica,loadFolderLinkChanges(current?.folderLinkChanges),intended.folderLinkChanges);
      snapshot.folderLinks=applyFolderLinkChanges(mergeLegacyFolderLinks(loadFolderLinks(baseline),loadFolderLinks(current),intended.folderLinks),snapshot.folderLinkChanges);
      snapshot.noteThreads=mergeNoteThreads(loadNoteThreads(current?.noteThreads),intended.noteThreads);
      snapshot.noteContexts=mergeNoteContexts(current?.noteContexts,intended.noteContexts,this.settings.noteContexts);
      snapshot.smartSend=mergeSmartSend(this.smartReplica,current?.smartSend,intended.smartSend);
      await deviceState(`smart-send:${this.deviceId}:${this.settings.vaultId}`,snapshot.smartSend);
      snapshot.responseBindings=mergeResponseBindingData(this.responseBindingReplica,current?.responseBindings,intended.responseBindings);
      await deviceState(`response-bindings:${this.deviceId}:${this.settings.vaultId}`,snapshot.responseBindings);
      await this.saveData(snapshot);
      Object.assign(this.smartReplica,mergeSmartSend(snapshot.smartSend,this.smartReplica,this.settings.smartSend));this.settings.smartSend=this.smartReplica;
      this.settings.noteContexts=mergeNoteContexts(snapshot.noteContexts,this.settings.noteContexts);
      this.responseBindingReplica=mergeResponseBindingData(snapshot.responseBindings,this.responseBindingReplica);this.settings.responseBindings=this.responseBindingReplica;
      this.folderLinkReplica=snapshot.folderLinkChanges;
      await deviceState(`folder-links:${this.deviceId}:${this.settings.vaultId}`,this.folderLinkReplica);
      this.settings.folderLinkChanges=this.folderLinkReplica;
      if(JSON.stringify(this.settings.folderLinks)===intendedLinks)this.settings.folderLinks=snapshot.folderLinks;
      this.refreshFolderIndicators();
      this.lastDiskSnapshot=JSON.stringify(snapshot);
      if(JSON.stringify(this.settings.noteThreads)===intendedThreads)this.settings.noteThreads=snapshot.noteThreads;
      const adopt=<K extends keyof SharedSettings>(key:K)=>{if(JSON.stringify(this.settings[key])===JSON.stringify(intended[key])){const target:SharedSettings=this.settings;target[key]=snapshot[key];}};
      for(const key of ['inlineStreaming','vaultHost','completion','threadTitleGeneration','autoSettleThreads','paired','vaultLocations','codebase','projectCreationLocations'] as const)adopt(key);
      this.codebase?.adopt(this.settings.codebase);
      this.sharedBaseline=JSON.stringify(snapshot);
    });
    const work=this.saving;void work.finally(()=>{if(this.saving===work)this.queuedSharedSnapshot=undefined;}).catch(()=>{});return work;
  }
  async send(file:TFile, project:Project, options?:{id?:string;quiet?:boolean;throwOnError?:boolean;threadId?:string;newThread?:boolean;projectOverrideKey?:string;folderPicker?:boolean;folderLink?:FolderLink;prepared?:PreparedNote;streamReply?:boolean;jobOptions?:ResolvedJobOptions;destinations?:string[];destinationSection?:string;insertion?:CursorInsertion|null;onPrepared?:(request:Request)=>Promise<void>}) {
    if (this.busy) {if(options?.throwOnError)throw Error('Obsidian is sending another request. Retry shortly.');return;}
    const finishPreview=this.previewSend(file.path,undefined,options?.destinationSection?null:options?.insertion,options?.jobOptions?.inline.enabled??options?.streamReply??(!options?.quiet&&this.settings.inlineStreaming.enabled));
    this.busy = true;
    const startedAt=Date.now();let request:Request|undefined;
    const completion = {...this.settings.completion};
    try {

      const savedThread=this.noteThread(file.path);
      const remembered=!options?.newThread&&!options?.threadId&&!options?.folderPicker&&(!options?.projectOverrideKey||savedThread&&`${savedThread.connectionId?savedThread.connectionId+':':''}${savedThread.projectId}`===options.projectOverrideKey)?savedThread:undefined;
      const historical=options?.threadId&&!options.folderPicker&&!options.projectOverrideKey?this.previousNoteThread(file.path,options.threadId):undefined;
      if(remembered||historical)project=this.projectForNoteThread((historical??remembered)!);
      const threadId=options?.threadId??remembered?.threadId;
      const connection=this.connection(project);
      await this.assertNoteMode(file.path,{...connection,projectId:project.id,threadId},options?.destinations);
      const jobOptions=options?.jobOptions??resolveJobOptions({...this.settings.inlineStreaming,enabled:options?.streamReply??(!options?.quiet&&this.settings.inlineStreaming.enabled)});
      const streaming=jobOptions.inline.enabled;
      const inlineView=streaming?await this.editorForNoteSend(file):undefined;
      if(options?.streamReply===true&&!inlineView)throw Error('A Markdown editor is required to prepare this streaming send.');
      const content = inlineView?this.notePromptDocument(inlineView):await this.app.vault.read(file);
      if (!content.trim()) {if(options?.throwOnError)throw Error('This note is empty. Add Markdown before sending.');new Notice('This note is empty. Add Markdown before sending.'); return;}
      if(options?.prepared&&options.prepared.content!==content)throw Error('The note changed while preparing its project. Try again with the current text.');
      await this.recoverSmartReplies(file.path,content);
      const smart=await prepareSmartSend(this.smartData(),file.path,await this.smartKey(project,connection,threadId??''),content);
      if(!smart.text.trim()){new Notice('Nothing new to send.');return;}
      const images=await this.prepareImages(smart.text,file.path,true,content);
      if(inlineView&&this.notePromptDocument(inlineView)!==content)throw Error('The note changed while preparing the send. Try again with the current text.');
      const link=options?.folderLink??folderLinkForPath(this.settings.folderLinks,file.path)??{id:'manual',folderPath:'/',connectionId:project.connectionId??'',projectId:project.id,projectTitle:project.title,workspaceRoot:project.workspaceRoot,self:true};
      request = {smartSend:smart.capture,jobOptions,id:options?.id??randomId(),project:{...project},title:await this.requestTitle(connection,project,threadId,file.path),prompt:images.markdown+this.messageFooter(file.path),attachments:images.attachments,context:images.context,...(threadId?{threadId}:{}),completion:{notePath:file.path,contentHash:contentHash(content),ctime:file.stat.ctime,...completion,action:'keep'},connection,noteThread:this.noteThreadIntent(file.path,project,connection),...this.folderLinkIntent(link)};
      if(request.prompt.length>120_000) throw new Error('The note and image context exceed T3’s 120,000-character limit. Split the note before sending.');
      const steeringSource={document:content,ranges:smart.ranges};
      if(streaming&&inlineView)await this.prepareStreamBindings(request,options?.destinations?.length?options.destinations:[file.path],undefined,options?.destinationSection,file.path,smart.text,options?.insertion,steeringSource);
      else await this.prepareNoteSteering(request,file.path,smart.text,undefined,undefined,steeringSource);
      await options?.onPrepared?.(request);
      this.settings.pending.push(request); await this.save();
      const sentThreadId=await this.dispatch(request,options?.quiet);
      return {threadId:sentThreadId,request};
    } catch(e) {if(request)await this.failRequest(request,e,'preparation',startedAt);else this.recordSendFailure(undefined,e,'preparation',startedAt);const detail=`${unsavedMessage(e)} The send failed. See the send failure log.`;if(options?.throwOnError)throw new RequestDeliveryError(detail,false,Boolean(request));new Notice(`T3 Code: ${detail}`,12000);}
    finally {finishPreview();this.busy = false;}
  }
  /** Resolve against the final thread and its provider turn, never the cursor.
   * Reconnecting bindings block a send until ownership is known. */
  private async prepareNoteSteering(request:Request,path:string,input:string,context?:EditorChatContext,preferredId?:string,source?:SteeringSource):Promise<boolean>{
    if(!request.threadId)return false;
    const environment=request.connection.environmentId??await this.localInlineEnvironment();
    const stored=responseBindingRequests(this.settings.responseBindings??{}).filter(binding=>binding.vaultId===this.settings.vaultId&&binding.threadId===request.threadId&&binding.projectId===request.project.id&&binding.threadEnvironmentId===environment);
    const jobs=this.inlineChat?.activeFor?.(path)??[];
    if(!stored.length&&!jobs.length)return false;
    const document=await deviceNoteIO(this.app).readNote(path);
    if(document===undefined)throw Error('Save the response note before sending again.');
    const candidates=responseIds(document).flatMap(id=>{
      const hosted=this.deviceInline?.cachedResponse(id),job=jobs.find(job=>job.id===id),binding=hosted?.record.request??stored.find(binding=>binding.id===id);
      if(!binding&&!job)return [];
      if(!regionBody(document,id))throw Error('The response block is incomplete. Restore it before sending again.');
      return [{id,notePath:path,threadId:binding?.threadId??job?.threadId??'',projectId:binding?.projectId??job?.projectId??'',environmentId:binding?.threadEnvironmentId??job?.threadEnvironmentId??job?.connection?.environmentId??'',state:hosted?.record.state??(job?{...job,status:job.phase}:undefined),hosted,job,binding}];
    });
    if(!candidates.length)return false;
    const thread=await this.readChatThread(request.connection,request.project,request.threadId);
    const target=noteSteeringTarget(thread,{notePath:path,threadId:request.threadId,projectId:request.project.id,environmentId:environment},candidates,preferredId);
    if(!target)return false;
    if(target.binding&&target.binding.vaultId!==this.settings.vaultId)throw Error('This response belongs to another vault.');
    if(!target.hosted&&target.job?.hosted||!target.hosted&&!target.job)throw Error('The active response is reconnecting. Wait before sending again.');
    if(target.hosted&&(target.hosted.record.state?.notePath??target.hosted.record.request.notePath)!==path){
      await this.checkResponseNote(target.id,target.hosted.record.state?.notePath??target.hosted.record.request.notePath,path);
      await this.deviceInline!.relocateResponse(target.hosted.host,target.hosted.record,path);
    }
    const view=context?.view??this.app.workspace.getLeavesOfType('markdown').map(leaf=>leaf.view as MarkdownView).find(view=>view.file?.path===path);
    if(!source&&context&&!context.referenceSelection){
      const anchor=context.canonicalAnchor??context.anchor;
      if(anchor){const current=this.notePromptDocument(context.view),range=selectionRange(current,anchor);if(!range)throw Error('The selected text changed. Select it again.');if(!selectionOverlapsInlineResponse(current,{start:range.from,end:range.to}))source={document:current,ranges:[[range.from,range.to]]};}
    }
    const adapter=view&&nativeResponses(this.app).view(view as MarkdownView);
    let selections:SelectionAnchor[]=[];
    if(source?.ranges.length){
      if(adapter)selections=adapter.sourceSelections(source.document,source.ranges);
      else {if(document!==source.document)throw Error('The source note changed before steering.');selections=source.ranges.map(([from,to])=>selectionAnchor(document,document.slice(from,to),from,to));}
    }
    const policy=target.hosted?.record.request??target.job!;
    request.jobOptions=resolveJobOptions({enabled:true,intermediateMode:policy.intermediateMode,keepIntermediate:policy.keepIntermediate,finalAnswerFormat:policy.finalAnswerFormat});
    const destination={jobId:target.id,...(target.hosted?{host:target.hosted.host}:{}),notePath:path};
    const steering=request.inlineSteering;
    if(steering){
      if(selections.length)steering.input={...steering.input,sourceResponseId:target.id,selection:selections[0],...(selections.length>1?{selections}:{})};
      if(!steering.targets?.some(item=>item.jobId===target.id))steering.targets=[...steering.targets??[{jobId:steering.jobId,host:steering.host,notePath:request.noteThread?.notePath??path}],destination];
    }else request.inlineSteering={...destination,input:{messageId:commandId(request.id,'message'),text:input,...(selections.length?{sourceResponseId:target.id,selection:selections[0],...(selections.length>1?{selections}:{})}:{})},targets:[destination]};
    return true;
  }
  private async prepareStreamBindings(request:Request,destinations:string[],startedAt?:string,destinationSection?:string,sourcePath?:string,input?:string,insertion?:CursorInsertion|null,steeringSource?:SteeringSource){
    await this.assertNoteMode(sourcePath,{...request.connection,projectId:request.project.id,threadId:request.threadId},destinations);
    const policy=request.jobOptions?.inline??resolveJobOptions(this.settings.inlineStreaming).inline;
    const io=deviceNoteIO(this.app),host=await this.localResponseTarget(request);
    for(const path of destinations){const document=await io.readNote(path);if(document===undefined)throw Error(`Destination note unavailable: ${path}`);if(insertion&&path===sourcePath&&!destinationSection)resolveCursorInsertion(document,insertion);else endInsertionOffset(document);}
    const source:ResponseRequest={destinationSection,localOnly:true,nativeProjection:true,responseContainer:true,version:4,finalAnswerFormat:policy.finalAnswerFormat,independent:true,threadTitle:request.title,id:request.id,initialOwner:this.inlineActor,vaultId:this.settings.vaultId,host,notePath:destinations[0],threadId:request.threadId??commandId(request.id,'thread'),messageId:commandId(request.id,'message'),projectId:request.project.id,threadEnvironmentId:request.connection.environmentId??await this.localInlineEnvironment(),initialHash:initialRegion(request.id).bodyHash,createdAt:startedAt??new Date().toISOString(),keepIntermediate:policy.intermediateMode!=='remove',intermediateMode:policy.intermediateMode};
    request.inlineBindings=[];
    const fresh:string[]=[];
    for(const path of destinations)if(input===undefined||!await this.prepareNoteSteering(request,path,input,undefined,undefined,path===sourcePath?steeringSource:undefined))fresh.push(path);
    for(const path of fresh){
      const binding=await editorStream(source,path,io,()=>!this.stopped,undefined,path===sourcePath?insertion??undefined:undefined);
      request.inlineBindings.push(binding);
      for(const leaf of this.app.workspace.getLeavesOfType('markdown')){
        const view=leaf.view as MarkdownView;if(view.file?.path!==path)continue;
        const initial=initialRegion(binding.id,binding.initialInput,view.file.basename,binding.intermediateMode,{startedAt:binding.createdAt},'sending');
        nativeResponses(this.app).preview(view,binding.id,regionBody(initial.text,binding.id)!.body);
      }
    }
    for(const leaf of this.app.workspace.getLeavesOfType('markdown'))if(destinations.includes((leaf.view as MarkdownView).file?.path??''))this.sendPreviews.hide(leaf.view as MarkdownView);
    request.inlineHost=request.inlineBindings[0];
  }
  private async responseGuard(binding:ResponseRequest,_status:'prepared'|'accepted'|'failed',_uncertain=false){if(!binding.localOnly)throw Error('Legacy reply creation was retired.');}
  private requestBindingIds(request:Request){
    return contextBindingIds(request);
  }
  private persistAgentCommand(request:Request,threadId?:string){
    const command=request.agentCommand;if(!command)return;
    const result:NoteCommandResult|undefined=threadId?{id:command.id,ok:true,threadId,messageId:commandId(request.id,'message'),bindingIds:this.requestBindingIds(request)}:undefined;
    this.app.saveLocalStorage(`${this.localKey}-note-command-${command.id}`,jsonClone(result?{command,result}:{command,request}));
  }
  private compactNoteCommandReceipts(){
    // Obsidian prefixes these keys by vault. Resolve through its API so another
    // vault's records are never read or changed. Pending payloads stay intact.
    try{
      for(let i=0;i<window.localStorage.length;i++){
        const id=/send-to-t3-code-device-v1-note-command-([0-9a-f-]{36})$/i.exec(window.localStorage.key(i)??'')?.[1];
        if(!id)continue;
        const key=`${this.localKey}-note-command-${id}`,stored:unknown=this.app.loadLocalStorage(key);
        if(isRecord(stored)&&stored.command&&(stored.result||stored.discarded))this.app.saveLocalStorage(key,{command:stored.command,...(stored.result?{result:stored.result}:{discarded:true})});
      }
    }catch{/* Storage unavailable: terminal records compact on their next replay. */}
  }
  /** Agent and palette entry point; durable prepared sends replay the same bytes. */
  async executeNoteCommand(input:NoteCommand):Promise<NoteCommandResult>{
    const command=validateNoteCommand(input);
    if(this.stopped||this.busy)throw Error('Obsidian is unavailable or sending another request.');
    const key=`${this.localKey}-note-command-${command.id}`,stored=this.app.loadLocalStorage(key) as {command?:NoteCommand;request?:Request;result?:NoteCommandResult;discarded?:boolean}|undefined;
    if(isRecord(stored)&&stored.command&&JSON.stringify(stored.command)!==JSON.stringify(command))throw Error('This command ID already belongs to different input.');
    if(stored?.discarded)throw Error('This send failed and cannot be retried. Check its original T3 thread and the send failure log.');
    if(stored?.result){this.app.saveLocalStorage(key,{command,result:stored.result});return stored.result;}
    const persist=(value:{request?:Request;result?:NoteCommandResult})=>this.app.saveLocalStorage(key,jsonClone(value.result?{command,result:value.result}:{command,...value}));
    let request=stored?.request,threadId:string;
    if(command.kind==='attach-response'){
      const file=this.app.vault.getFileByPath(command.notePath);if(!file)throw Error('Source note not found.');
      if(!request){
        const {project}=await this.chatTarget(file.path,undefined,true,undefined,false);
        const thread=readThreadSnapshot({thread:await runBridge(this.connection(project),['read',command.threadId!])}).thread;
        if(thread.id!==command.threadId||thread.projectId!==project.id||!thread.messages?.some(item=>item.role==='user'&&item.id===command.messageId))throw Error('The source response is not in this note’s linked T3 project.');
        request={id:command.id,project,connection:this.connection(project),noteThread:this.noteThreadIntent(file.path,project,this.connection(project)),title:thread.title??'T3 response',prompt:'',threadId:command.threadId};
        await this.prepareStreamBindings(request,command.destinations.length?command.destinations:[command.notePath],thread.messages.find(item=>item.role==='user'&&item.id===command.messageId)?.createdAt,command.destinationSection,command.notePath);
        for(const binding of request.inlineBindings!)binding.messageId=command.messageId!;
        persist({request});
      }
      await this.assertRequestMode(request);
      for(const binding of request.inlineBindings!){if(!this.deviceInline)throw Error('Streaming is unavailable.');await this.deviceInline.register(binding);}
      threadId=command.threadId!;
      await this.ensureNoteIdentity(file.path,request.noteThread?.noteId);
      this.rememberNoteThread(this.noteThreadIntent(file.path,request.project,request.connection),threadId);await this.save(true);
    }else if(request){
      request=this.settings.pending.find(item=>item.id===request!.id)??request;
      this.busy=true;
      try{if(!this.settings.pending.some(item=>item.id===request!.id)){this.settings.pending.push(request);await this.save();}threadId=await this.dispatch(request,true);}finally{this.busy=false;}
    }else{
      const file=this.app.vault.getFileByPath(command.notePath);if(!file)throw Error('Source note not found.');

      const paired=threadNoteMode(this.settings.threadNoteMode)==='one-to-one'?this.noteThread(file.path):undefined;
      const selected=command.threadId??paired?.threadId;
      const {project,link}=await this.chatTarget(file.path,paired,!paired,undefined,false);
      const sent=await this.send(file,project,{id:command.id,newThread:!selected,threadId:selected,folderLink:link,throwOnError:true,streamReply:command.streamReply,destinations:command.destinations,destinationSection:command.destinationSection,onPrepared:async prepared=>{prepared.agentCommand=command;request=prepared;persist({request:prepared});}});
      if(!sent)throw Error('The note was not sent.');threadId=sent.threadId;request=sent.request;
    }
    const result:NoteCommandResult={id:command.id,ok:true,threadId,messageId:command.kind==='attach-response'?command.messageId:commandId(command.id,'message'),bindingIds:request?this.requestBindingIds(request):[]};
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
    if(request.smartSend){
      const path=request.noteThread?.notePath??request.completion?.notePath;
      const bindings=[...(request.inlineBindings??(request.inlineHost?[request.inlineHost]:[])).filter(binding=>binding.notePath===path).map(binding=>binding.id),
        ...(request.inlineSteering?.targets??(request.inlineSteering?[{jobId:request.inlineSteering.jobId,notePath:path}]:[])).filter(target=>target.notePath===path).map(target=>target.jobId),
        ...(request.inlineFollow&&(!request.inlineFollow.notePath||request.inlineFollow.notePath===path)?[request.inlineFollow.jobId]:[])];
      confirmSmartSend(this.smartData(),request.id,smartDestination(request.connection.environmentId??request.connection.connectionId??'local',request.project.id,threadId),request.smartSend,bindings);
    }
    if(request.folderLinkIntent&&!this.settings.folderLinks.some(link=>link.folderPath===request.folderLinkIntent!.folderPath))this.settings.folderLinks=upsertFolderLink(this.settings.folderLinks,request.folderLinkIntent);
    const remembered=request.noteThread??request.noteLink; // Resume requests saved before the terminology change.
    if(remembered)this.rememberNoteThread(remembered,threadId);
    this.rememberSettlement(request,threadId);
  }
  private async captureNoteContext(request:Request){
    const messageId=commandId(request.id,'message');
    if(!request.prompt)return;
    const noteId=request.smartSend?.noteId??request.noteThread?.noteId;
    await this.ensureNoteIdentity(request.noteThread?.notePath??request.completion?.notePath,noteId);
    if(request.noteThread&&noteId)request.noteThread.noteId=noteId;
    const threadId=request.threadId??commandId(request.id,'thread'),environmentId=request.connection.environmentId??await this.localInlineEnvironment();
    if(this.settings.noteContexts?.some(record=>record.messageId===messageId&&record.threadId===threadId&&record.environmentId===environmentId))return;
    const bindingIds=contextBindingIds(request);
    this.settings.noteContexts=mergeNoteContexts(this.settings.noteContexts,[{messageId,threadId,projectId:request.project.id,environmentId,notePath:request.noteThread?.notePath??request.completion?.notePath,bindingIds,createdAt:new Date().toISOString()}]);
    await this.save();
  }
  private async ensureNoteIdentity(path?:string,id?:string){
    if(!path||!this.app?.vault?.getFileByPath?.(path))return;
    id??=smartNote(this.smartData(),path);
    const io=deviceNoteIO(this.app),document=await io.readNote(path);
    if(document===undefined)throw Error('Save the note before sending so its T3 identity can be retained.');
    const previous=noteIdentity(document);if(previous===id)return;
    if(previous){const original=this.smartData().notes[previous];if(!original||original.path===path)throw Error('The note identity changed while sending. Send again from its current note.');}
    const next=await io.updateNote(path,current=>{if(noteIdentity(current)!==previous)throw Error('The note identity changed while sending. Send again.');return withNoteIdentity(current,id);},()=>!this.stopped);
    if(next===undefined)throw Error('The note changed before its T3 identity was saved. Send again.');
    for(const leaf of this.app.workspace.getLeavesOfType('markdown')){const view=leaf.view as MarkdownView;if(view.file?.path===path&&view.editor&&view.getMode?.()!=='preview')await view.save();}
    const file=this.app.vault.getFileByPath(path);
    if(!file||noteIdentity(await this.app.vault.read(file))!==id)throw Error('The T3 note identity has not been saved. Save the note and send again.');
  }
  private async reserveResponseStreams(request:Request){
    const responses=new Map<string,string>();
    const reserve=(path:string|undefined,bindingId:string)=>{if(!path)throw Error('The reply stream has no destination note.');const prior=responses.get(path);if(prior&&prior!==bindingId)throw Error('Several reply streams target the same note.');responses.set(path,bindingId);};
    for(const binding of request.inlineBindings??(request.inlineHost?[request.inlineHost]:[]))reserve(binding.notePath,binding.id);
    if(request.inlineSteering)for(const target of request.inlineSteering.targets??[{...request.inlineSteering,notePath:request.noteThread?.notePath??request.completion?.notePath}])reserve(target.notePath,target.jobId);
    if(request.inlineFollow)reserve(request.inlineFollow.notePath??request.noteThread?.notePath??request.completion?.notePath,request.inlineFollow.jobId);
    // Without a vault connection machine there can be no future-run watcher.
    if(!responses.size||!this.vaultConnection())return;
    const result=await this.executeAgentCommand({version:1,id:commandId(request.id,'reserve-thread-response'),kind:'reserve-thread-response',source:{threadId:request.threadId??commandId(request.id,'thread'),projectId:request.project.id,environmentId:request.connection.environmentId??await this.localInlineEnvironment()},messageId:commandId(request.id,'message'),responses:[...responses].map(([path,bindingId])=>({path,bindingId}))});
    if(!result.ok)throw Error('error' in result&&typeof result.error==='string'?result.error:'The vault connection machine could not reserve the reply stream.');
  }
  async dispatch(request:Request,quiet=false) {
    const startedAt=Date.now();let stage='response-registration';
    await this.assertRequestMode(request);
    await this.captureNoteContext(request);
    logEvent('request.dispatch.started',{requestId:request.id,threadId:request.threadId,projectId:request.project.id,jobId:request.inlineSteering?.jobId,kind:request.inlineSteering?'steering':request.inlineFollow?'continuation':'send'});
    try{
    if(request.inlineSteering){
      const steering=request.inlineSteering;
      if(steering.input.messageId!==commandId(request.id,'message')||!request.threadId)throw Error('Invalid saved steering request.');
      for(const target of steering.targets??[steering]){
        if(target.host){if(!this.deviceInline)throw Error('Response ownership is unavailable. Reload the plugin.');await this.deviceInline.steer(target.host,target.jobId,steering.input);}
        else {const job=this.inlineChat?.find(target.jobId)??this.inlineChat?.steeringJob(target.jobId,steering.input.messageId);if(!job||job.threadId!==request.threadId)throw Error('The original response is unavailable on this device.');this.inlineChat!.steer(job,steering.input);}
      }
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
    }else if(request.inlineHost)throw Error('This legacy reply was cancelled. Create a new local reply.');
    // The watcher must acknowledge these exact identities before T3 can expose
    // the new message. Synced settings can arrive after the canonical run.
    stage='stream-reservation';await this.reserveResponseStreams(request);
    stage='dispatch';const result=await sendRequest(request);
    for(const binding of request.inlineBindings??(request.inlineHost?[request.inlineHost]:[]))await this.responseGuard(binding,'accepted');
    stage='delivery-evidence';
    // Keep the acknowledged exact start even when the renderer/event feed
    // missed it. This is orchestration delivery, not a guessed provider turn.
    const delivery=request.directPlan?.delivery;
    if(delivery&&this.deviceInline){
      const bindings=request.inlineBindings??(request.inlineHost?[request.inlineHost]:[]);
      for(const binding of bindings)if([2,3,4].includes(binding.version))await this.deviceInline.delivered(binding.host,binding.id,delivery);
      if(request.inlineSteering)for(const target of request.inlineSteering.targets??[request.inlineSteering])if(target.host)await this.deviceInline.delivered(target.host,target.jobId,delivery);
      if(request.inlineFollow?.host)await this.deviceInline.delivered(request.inlineFollow.host,request.inlineFollow.jobId,delivery);
    }
    stage='local-confirmation';this.persistAgentCommand(request,result.threadId);
    logEvent('request.dispatch.acknowledged',{requestId:request.id,threadId:result.threadId,jobId:request.inlineSteering?.jobId,messageId:commandId(request.id,'message')});
    const before={jobs:this.settings.completionJobs,settlementJobs:this.settings.settlementJobs,pending:this.settings.pending,noteThreads:this.settings.noteThreads,folderLinks:this.settings.folderLinks};
    this.rememberStarted(request,result.threadId);
    this.settings.pending=this.settings.pending.filter(r=>r.id!==request.id);
    try{await this.save();}catch(e){this.settings.pending=before.pending;this.settings.completionJobs=before.jobs;this.settings.settlementJobs=before.settlementJobs;this.settings.noteThreads=before.noteThreads;this.settings.folderLinks=before.folderLinks;throw e;}
    if(!quiet)new Notice('Sent successfully.');return result.threadId;
    }catch(error){
      logFailure('request.dispatch.failed',error,{requestId:request.id,threadId:request.threadId,jobId:request.inlineSteering?.jobId});await this.failRequest(request,error,stage,startedAt);
      const accepted=acceptedRequestThread(request);
      if(accepted){new Notice(`T3 received your message in thread ${accepted.slice(0,8)}. The local response needs recovery. See the send failure log.`,12000);return accepted;}
      throw error;
    }
  }
  onunload(){this.sendPreviews.dispose();closeNoteTabPanel(this.app);this.dismissedCleanup.clear();this.connectionRecovery?.dispose();this.stopContentHash?.();this.codebase?.dispose();this.completionGlow?.dispose();configureDiagnostics();this.stopped=true;this.projectDiscovery?.dispose();this.projectListeners.clear();this.projectCreateModal?.close();this.questionModal?.close();this.questions?.dispose();this.approvals?.dispose();for(const entry of this.commandHosts.values()){void entry.host.dispose();entry.rpc.close();}this.commandHosts.clear();this.routeStatus.clear();this.deviceInline?.dispose();this.inlineChat?.dispose();nativeResponses(this.app).dispose();this.vaultSetupModal?.close();this.paletteChat?.dispose();this.folderIndicators?.dispose();this.threadDisplays?.stop();this.cancelCloudLogin();this.cloudChanged=undefined;}
  async monitorCompletions() {
    if(this.monitoring||this.stopped||this.busy)return;
    this.monitoring=true;try{await this.monitorSettlements();}finally{this.monitoring=false;}
  }
  async discardRequest(request:Request){
    if(request.agentCommand)this.app.saveLocalStorage(`${this.localKey}-note-command-${request.agentCommand.id}`,{command:request.agentCommand,discarded:true});
    this.settings.pending=this.settings.pending.filter(r=>r.id!==request.id);await this.save();
  }
  private async inlineSettlementStatus(job:ThreadSettlementJob):Promise<'wait'|'ready'|'discard'>{
    if(job.inlineBindings?.length){for(const binding of job.inlineBindings){const status=await this.inlineSettlementStatus({...job,inlineBindings:undefined,inlineJobId:binding.id,inlineHost:binding.host,inlineNotePath:binding.notePath,inlineLocal:true});if(status!=='ready')return status;}return 'ready';}
    if(!job.inlineJobId)return 'ready';
    const local=this.deviceInline?.localResponse(job.inlineJobId);
    if(local){const status=this.deviceInline!.responseStatus(job.inlineJobId);return status?.finalSaved?'ready':status?.hostRecorded?'discard':'wait';}
    if(job.inlineLocal){const file=job.inlineNotePath&&this.app.vault.getFileByPath(job.inlineNotePath);if(!file)return 'discard';return hasResponseMarkers(await this.app.vault.read(file),job.inlineJobId)?'wait':'ready';}
    return job.inlineHost?'discard':this.inlineChat?.settlementStatus(job.inlineJobId)??'wait';
  }
  private async monitorSettlements(){
    if(!this.settings.autoSettleThreads||!this.settings.settlementJobs.length)return;
    for(const job of [...this.settings.settlementJobs]){
      if(this.stopped||this.busy)return;
      if(!this.settings.settlementJobs.includes(job))continue;
      try{
        if(this.settings.pending.some(request=>request.threadId===job.threadId&&request.connection.environmentId===job.connection.environmentId))continue;
        const shell=await runBridge(job.connection,['threads','--project',job.projectId]);
        const summary=readThreadList(shell).find(thread=>thread.id===job.threadId);
        if(!summary)continue;
        const full=readThreadSnapshot({thread:await runBridge(job.connection,['read',job.threadId])}).thread;
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
              :await this.inlineThreadAccess(job.connection.environmentId??'');
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
  onChooseItem(thread:ThreadChoice){this.selected=true;void this.choose(thread).catch(error=>{new Notice(`T3 Code: ${message(error)}`,10000);if(!(error instanceof RequestDeliveryError&&(error.requestSaved||error.terminal)))this.back?.();});}
}
type FolderLinkChoice=Project|{create:true;title:string};
class FolderLinkProjectModal extends FuzzySuggestModal<FolderLinkChoice>{
  constructor(app:App,private plugin:SendToT3,private folder:TFolder){super(app);this.setPlaceholder('Choose a T3 Code project');}
  private unwatch?:()=>void;
  onOpen(){void super.onOpen?.();this.unwatch=this.plugin.watchProjects(()=>this.inputEl?.dispatchEvent(new Event('input')));}
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

// Plain metadata for native indexed settings.
interface SettingsRow {name:string;desc?:string;aliases?:string[];render:(setting:Setting)=>void}
export class T3Settings extends PluginSettingTab {
  private agentTools?:AgentToolsSettings;
  constructor(app:App,private plugin:SendToT3){super(app,plugin);}
  /** Native indexed settings on supported Obsidian clients. */
  getSettingDefinitions():SettingDefinitionItem[]{
    const block=(name:string,aliases:string[],render:(el:HTMLElement)=>void):SettingDefinition=>({name,aliases,render:setting=>{setting.settingEl.empty();setting.settingEl.removeClass('setting-item');setting.settingEl.addClass('t3-settings-section');render(setting.settingEl);}});
    this.plugin.cloudChanged=()=>this.refresh();
    return [
      {type:'page',name:'Agent tools',items:this.agentDefinitions()},
      {type:'page',name:'Connection',items:this.connectionDefinitions()},
      {type:'page',name:'Replies',items:this.replyPageDefinitions()},
      {type:'page',name:'Projects',items:[block('Linked folders and project files',['Vault connection','Connect vault','Change machine','Unlink','Codebase view','Open project files'],el=>this.projectsUI(el))]},
      {type:'page',name:'Advanced',items:[block('Troubleshooting',['Send failure log'],el=>this.advancedUI(el))]},
    ];
  }
  refresh(){this.update();}
  private agentDefinitions():Array<SettingsRow>{return [
    {name:'Agent tools',aliases:['MCP','Skill','Set up agent','Safe note editing'],render:setting=>{
      setting.settingEl.empty();setting.settingEl.removeClass('setting-item');setting.settingEl.addClass('t3-settings-section');
      this.agentTools??=new AgentToolsSettings({prepare:(id,runtime)=>this.plugin.agentToolsPrepare(id,runtime),machines:()=>this.plugin.agentToolMachines(),inspect:id=>this.plugin.agentToolsInspect(id),install:(id,provider,runtime)=>this.plugin.agentToolsInstall(id,provider,runtime),remove:(id,provider)=>this.plugin.agentToolsRemove(id,provider),status:(id,provider)=>this.plugin.agentToolsStatus(id,provider)});
      this.agentTools.render(setting.settingEl);
    }},
  ];}
  hide(){this.agentTools?.dispose();}
  private connectionDefinitions():Array<SettingsRow>{return [{name:'Connections',aliases:['Sign in','T3 account email','Email verification code','Refresh connections','Sign out'],render:setting=>{setting.settingEl.empty();setting.settingEl.removeClass('setting-item');setting.settingEl.addClass('t3-settings-section');this.connectionUI(setting.settingEl);}}];}
  private selectedMachine:CloudMachine|null=null;
  private readonly expanded=new Set<string>();
  showConnection(){}
  private details(el:HTMLElement,title:string){
    const details=el.createEl('details',{cls:'t3-settings-details'});
    details.open=this.expanded.has(title);
    details.createEl('summary',{text:title});
    details.addEventListener('toggle',()=>{if(details.open)this.expanded.add(title);else this.expanded.delete(title);});
    return details;
  }
  private routeRows=new Map<string,{setting:Setting;description:string}>();
  refreshRouteStatus(){
    for(const [id,row] of this.routeRows){
      if(!row.setting.settingEl.isConnected){this.routeRows.delete(id);continue;}
      const description=this.plugin.routeDescription(id);if(description!==row.description){row.description=description;row.setting.setDesc(description);}
    }
  }
  private pairingDraft={name:'',address:'',code:''};
  private connectionUI(el:HTMLElement){
    const p=this.plugin,method=p.connectionMethod;this.routeRows.clear();
    el.addClass('t3-settings-section');
    new Setting(el).setName('Add a connection').setDesc('Choose a route to a running T3 environment. Existing connections stay available.').addDropdown(dropdown=>dropdown.addOptions({connect:'T3 Connect (recommended)',local:'This computer only',https:'HTTPS / Tailscale',ssh:'Existing SSH tunnel'}).setValue(method).onChange(async value=>{
      this.selectedMachine=null;this.pairingDraft={name:'',address:value==='local'?'http://127.0.0.1:3773':'',code:''};await p.connectionChoice(value as ConnectionMethod);this.refresh();
    }));
    if(method==='connect')this.cloudUI(el);
    else {
      const descriptions={local:'Start T3 on this computer and create a fresh pairing link in T3 Settings → Sharing & access. No T3 account is needed.',https:'Use an HTTPS pairing link from T3 Settings → Sharing & access. For Tailscale, both devices must be connected to your tailnet.',ssh:'Start and maintain the SSH tunnel outside Obsidian. Enter its localhost address and a fresh T3 pairing code. Obsidian does not run SSH.'};
      new Setting(el).setName(routeNames[method]).setDesc(descriptions[method]);
      new Setting(el).setName('Connection name').setDesc(this.selectedMachine?'Adding a route to '+this.selectedMachine.name:'Optional. The T3 environment name is used when blank.').addText(input=>input.setValue(this.pairingDraft.name).onChange(value=>this.pairingDraft.name=value));
      new Setting(el).setName('T3 address or pairing link').setDesc(method==='https'?'A reachable HTTPS address, including Tailscale HTTPS.':'The forwarded or local T3 address on this device.').addText(input=>{input.inputEl.type='password';input.inputEl.autocomplete='off';input.setPlaceholder(method==='local'?'http://127.0.0.1:3773':method==='ssh'?'http://127.0.0.1:PORT':'https://computer.tailnet.ts.net').setValue(this.pairingDraft.address|| (method==='local'?'http://127.0.0.1:3773':'')).onChange(value=>this.pairingDraft.address=value);});
      new Setting(el).setName('Pairing code').setDesc('Leave blank when the pairing link already includes it. Credentials stay on this device.').addText(input=>{input.inputEl.type='password';input.inputEl.autocomplete='off';input.onChange(value=>this.pairingDraft.code=value);});
      new Setting(el).addButton(button=>button.setButtonText('Pair and discover projects').setCta().onClick(async()=>{button.setDisabled(true);try{await p.pairConnection(this.pairingDraft.name,this.pairingDraft.address||(method==='local'?'http://127.0.0.1:3773':''),this.pairingDraft.code,this.selectedMachine?.environmentId,method);this.pairingDraft={name:'',address:'',code:''};this.selectedMachine=null;this.refresh();new Notice('Connected. Projects and agent tools are available.');}catch(error){new Notice(message(error),12000);button.setDisabled(false);}}));
    }
    const groups=p.connectionGroups();
    if(!groups.length){new Setting(el).setName('No connected environments').setDesc('Connect locally, sign in to T3 Connect, or pair a remote address above.');return;}
    new Setting(el).setName('Connected environments').setHeading();
    for(const group of groups){
      const projects=new Set(p.settings.directProjects.filter(project=>group.routes.some(route=>route.id===project.connectionId)).map(project=>project.id));
      new Setting(el).setName(group.name).setDesc(`${projects.size} projects · ${group.routes.length} ${group.routes.length===1?'route':'routes'}. Routes are tried in this device’s preferred order.`).addButton(button=>button.setButtonText('Add route').onClick(async()=>{this.selectedMachine={environmentId:group.environmentId,name:group.name,url:''};this.pairingDraft={name:group.name,address:'',code:''};await p.connectionChoice('https');this.refresh();}));
      for(const [index,route] of group.routes.entries()){
        const description=p.routeDescription(route.id),row=new Setting(el);this.routeRows.set(route.id,{setting:row,description});
        row.setName(routeNames[routeMethod(route)]).setDesc(description).addButton(button=>button.setIcon('arrow-up').setTooltip('Prefer this route').setDisabled(index===0).onClick(async()=>{await p.preferRoute(route.id,-1);this.refresh();})).addButton(button=>button.setIcon('arrow-down').setTooltip('Try this route later').setDisabled(index===group.routes.length-1).onClick(async()=>{await p.preferRoute(route.id,1);this.refresh();})).addButton(button=>button.setButtonText('Check').onClick(async()=>{button.setDisabled(true);try{await p.checkRoute(route.id);new Notice('Connection verified.');}catch(error){new Notice(message(error),12000);}this.refresh();})).addButton(button=>button.setButtonText('Remove').onClick(async()=>{try{await p.removeConnection(route.id);this.refresh();}catch(error){new Notice(message(error),12000);}}));
      }
    }
  }
  cloudUI(el:HTMLElement){
    const p=this.plugin;p.cloudChanged=()=>this.refresh();
    new Setting(el).setName(p.nativeAccount?'T3 account':p.signInExpired?'Refresh authentication':'Sign in to T3').setDesc(p.nativeAccount?'Credentials stay on this device. Directly paired routes do not require this sign-in.':p.signInExpired?REAUTHENTICATE_MESSAGE:'Enable T3 Connect in T3 Code, then sign in here to discover computers.');
    if(p.nativeAccount){
      new Setting(el).setName(p.nativeAccount.identity).setDesc(p.connecting?'Connecting computers and discovering projects…':'Signed in. Connections renew automatically.').addButton(b=>b.setButtonText('Refresh connections').setDisabled(p.connecting).onClick(async()=>{try{await p.refreshMachines();}catch(e){p.cloudError=message(e);}this.refresh();})).addButton(b=>b.setButtonText('Sign out').onClick(async()=>{await p.signOutCloud();this.refresh();}));
      if(p.connecting)new Setting(el).setDesc('Connecting to T3 and syncing project information…');
      else if(!p.connectionSyncComplete)new Setting(el).setDesc('Connection setup has not completed. Refresh connections to try again.');
      else if(!p.cloudMachines.length)new Setting(el).setDesc('No T3 computers are available yet. Enable T3 Connect on a computer, then refresh.');
      else if(Object.keys(p.machineErrors).length)new Setting(el).setDesc('T3 could not finish connecting all computers. Refresh connections to retry.');
    }else if(p.emailLogin){
      new Setting(el).setDesc(`Enter the six-digit verification code sent by T3 to ${p.emailLogin.email}.`);
      let code='';new Setting(el).setName('Email verification code').addText(t=>{t.inputEl.type='password';t.inputEl.inputMode='numeric';t.inputEl.autocomplete='one-time-code';t.inputEl.maxLength=6;t.setPlaceholder('6-digit code').onChange(v=>code=v);});
      new Setting(el).addButton(b=>b.setButtonText('Verify and connect').setCta().onClick(async()=>{b.setDisabled(true);try{await p.finishEmailSignIn(code);}catch(e){p.cloudError=message(e);}this.refresh();})).addButton(b=>b.setButtonText('Cancel').onClick(()=>p.cancelCloudLogin()));
    }else{
      if(p.cloudAccount)new Setting(el).setDesc('Verify your email once to upgrade from address discovery to automatic connections. Existing manual pairings keep working.');
      let email=p.signInEmail||(p.cloudAccount?.identity.includes('@')?p.cloudAccount.identity:'');
      new Setting(el).setName('T3 account email').setDesc(p.signInExpired?'Your saved email is ready. Request a new verification code to resume replies.':'Uses T3’s sign-in service. No password or per-computer pairing code is needed.').addText(t=>{t.inputEl.type='email';t.inputEl.autocomplete='email';t.setPlaceholder('you@example.com').setValue(email).onChange(v=>email=v);});
      new Setting(el).addButton(b=>b.setButtonText(p.signInExpired?'Refresh authentication':'Send sign-in code').setCta().onClick(async()=>{b.setDisabled(true);try{await p.startEmailSignIn(email);}catch(e){p.cloudError=message(e);}this.refresh();}));
    }
    if(p.cloudError)new Setting(el).setDesc(p.cloudError);
  }



  private advancedUI(el:HTMLElement){
    new Setting(el).setName('Troubleshooting').setHeading();
    new Setting(el).setName('Send failure log').setDesc('View failed sends on this device. Failed sends are not queued for retry.').addButton(button=>button.setButtonText('View log').onClick(()=>this.plugin.exportDiagnostics()));
  }

  private replyPageDefinitions():SettingDefinitionItem[]{const fields=this.replyDefinitions();return [...fields.slice(0,-1),{type:'page',name:'Beta',desc:'Optional thread and note behavior.',items:[fields.at(-1)!]}];}
  private replyDefinitions():Array<SettingsRow>{
    return [
      {name:'Stream replies into the editor',desc:'Insert Send and Ask replies into the note. Selection replies appear below the selection; other replies use the captured cursor position or follow its paragraph.',render:setting=>{setting.addToggle(t=>t.setValue(this.plugin.settings.inlineStreaming.enabled).onChange(async enabled=>{this.plugin.settings.inlineStreaming.enabled=enabled;await this.plugin.save();}));}},
      {name:'Final answer format',desc:'Applies to new responses. Both formats support images and files.',render:setting=>{setting.addDropdown(dropdown=>dropdown.addOptions({formatted:'Current formatting','raw-markdown':'Raw Markdown'}).setValue(finalAnswerFormat(this.plugin.settings.inlineStreaming.finalAnswerFormat)).onChange(async value=>{this.plugin.settings.inlineStreaming.finalAnswerFormat=finalAnswerFormat(value);await this.plugin.save();}));}},
      {name:'Thread title generation',desc:'Use note titles by default, or let T3 name every new thread. Existing titles stay the same.',render:setting=>{setting.addDropdown(d=>d.addOption('untitled-only','Only for untitled notes').addOption('always','Always use T3').setValue(this.plugin.settings.threadTitleGeneration).onChange(async value=>{this.plugin.settings.threadTitleGeneration=threadTitleGeneration(value);await this.plugin.save();}));}},
      {name:'Settle completed threads',desc:'Move threads to Settled after a successful turn and saved reply. Sending again wakes the thread. Checks run while Obsidian is open.',render:setting=>{setting.addToggle(t=>t.setValue(this.plugin.settings.autoSettleThreads).onChange(async enabled=>{this.plugin.settings.autoSettleThreads=enabled;if(!enabled)this.plugin.settings.settlementJobs=[];await this.plugin.save();}));}},
      {name:'Thread and note mode',desc:'Free is the default and allows many-to-many links. 1:1 keeps one thread per note and one note per thread. The most recent links select existing 1:1 pairs. Saved replies and link history are kept when you switch.',render:setting=>{setting.addDropdown(d=>d.addOptions({free:'Free · Many-to-many','one-to-one':'1:1 · One thread per note'}).setValue(threadNoteMode(this.plugin.settings.threadNoteMode)).onChange(async value=>{this.plugin.settings.threadNoteMode=threadNoteMode(value);await this.plugin.save();}));}},
    ];
  }


  private projectsUI(el:HTMLElement){
    new Setting(el).setName('Linked folders').setHeading();
    new Setting(el).setName('Folder routing').setDesc('Right-click a folder and choose Link to T3 Code. Notes and questions in that folder use the selected project.');
    const root=this.plugin.vaultConnection();
    const machine=root?.connectionId?this.plugin.settings.paired.find(c=>c.id===root.connectionId)?.name:undefined;
    new Setting(this.details(el,'Synced vault location (optional)')).setName('Project workspace location').setDesc(root?`${machine??(Platform.isMobile?'Linked computer':'This computer')} · ${root.workspaceRoot} · Verified synced vault location.`:'Only needed when a T3 project uses a synced copy of this vault. Agent note editing and ordinary chat do not require it.').addButton(b=>b.setButtonText(root?'Change location':'Choose location').onClick(async()=>{try{await this.plugin.configureVaultConnection();this.refresh();}catch(e){if(!(e instanceof VaultSetupCancelled))new Notice(message(e),10000);}}));
    const links=this.plugin.settings.folderLinks.filter(link=>link.folderPath!=='/');
    if(!links.length)new Setting(el).setName('No linked folders').setDesc('You can send notes without linking a folder. New conversations use No project.');
    for(const link of links){
      const setting=new Setting(el).setName(link.folderPath==='/'?'Vault root':link.folderPath).setDesc(`${link.self?'Self · ':''}${link.projectTitle} · ${link.workspaceRoot}`);

      setting.addButton(b=>b.setButtonText('Unlink').onClick(async()=>{await this.plugin.unlinkFolder(link.folderPath);this.refresh();}));
    }
    new Setting(el).setName('Project files').setHeading();
    new Setting(el).setName('Codebase view').setDesc('Open project files in Obsidian. Files stay in their T3 workspace.').addButton(b=>b.setButtonText('Open').onClick(()=>{void nativeHost(this.app).commands.executeCommandById(`${this.plugin.manifest.id}:codebase-view`);}));
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

class ConnectedMachineModal extends FuzzySuggestModal<VaultMachine>{
  private chosen=false;
  constructor(app:App,private machines:VaultMachine[],private choose:(id:string)=>void,private cancelled:(error:Error)=>void){super(app);this.setPlaceholder('Choose a connected T3 machine');}
  getItems(){return this.machines;}
  getItemText(machine:VaultMachine){return machine.name;}
  onChooseItem(machine:VaultMachine){this.chosen=true;this.choose(machine.id);}
  onClose(){super.onClose();if(!this.chosen)this.cancelled(Error('Machine selection was cancelled.'));}
}
