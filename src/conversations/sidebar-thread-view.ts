import type {OutgoingAttachment,OutgoingContext} from '../connection/send-contracts';
import {FuzzySuggestModal,ItemView,Modal,Notice,Setting,setIcon,type App,type Plugin,type WorkspaceLeaf} from 'obsidian';
import {ChatTranscript} from './chat-transcript';
import {ChatComposer} from './chat-composer';
import {readChatObservations,type ChatObservations} from './chat-observations';
import {readComposerSettings,type ComposerModel,type ComposerSettings} from './composer-models';
import type {SidebarSendOptions,SidebarProject} from './sidebar-thread-model';
import {applyThreadItem,type InlineThreadState} from './inline-thread';
import {watchThread,type ThreadStreamCallbacks,type ThreadAccess} from './thread-stream';
import {SidebarThreadTransport,sidebarTarget,sidebarRunning,subagentTarget,type SidebarKind,type SidebarTarget} from './sidebar-thread-model';
import type {ThreadChoice} from './thread-target';
import {isRecord} from '../shared/values';

const TYPES:Record<SidebarKind,string>={thread:'t3-thread','side-chat':'t3-side-chat',subagent:'t3-subagent'};
const LABELS:Record<SidebarKind,string>={thread:'T3 thread','side-chat':'Side chat',subagent:'Subagent'};
type ProjectChoice=SidebarProject;
function draftImages(value:unknown):OutgoingAttachment[]{
  if(!Array.isArray(value)||value.length>4)return [];
  let total=0,encoded=0;const attachments:OutgoingAttachment[]=[];
  for(const item of value){
    if(!isRecord(item)||typeof item.id!=='string'||!item.id||typeof item.dataUrl!=='string'||item.dataUrl.length>14*1024*1024||
      typeof item.mimeType!=='string'||!['image/png','image/jpeg','image/gif','image/webp'].includes(item.mimeType)||!item.dataUrl.startsWith('data:'+item.mimeType+';base64,')||
      typeof item.sizeBytes!=='number'||!Number.isSafeInteger(item.sizeBytes)||item.sizeBytes<0)return [];
    total+=item.sizeBytes;encoded+=item.dataUrl.length;if(total>10*1024*1024||encoded>14*1024*1024)return [];
    attachments.push({id:item.id,dataUrl:item.dataUrl,type:'image',mimeType:item.mimeType,sizeBytes:item.sizeBytes,...(typeof item.name==='string'?{name:item.name.slice(0,255)}:{})});
  }
  return attachments;
}
export interface SidebarHost {
  watch?(target:SidebarTarget,callbacks:ThreadStreamCallbacks):{stop():void};
  access(environmentId:string):Promise<ThreadAccess>;
  projects():ProjectChoice[];
  threads(project:ProjectChoice):Promise<ThreadChoice[]>;
  create?(project:ProjectChoice,text:string,options?:SidebarSendOptions):Promise<SidebarTarget>;
  catalog?(target:SidebarTarget,refresh?:boolean):Promise<ComposerModel[]>;
  files?(target:SidebarTarget,cwd:string,query:string):Promise<string[]>;
  renderRequests?(element:HTMLElement,target:SidebarTarget,state:InlineThreadState):()=>void;
  created?(target:SidebarTarget):void;
  source():SidebarTarget|undefined;
  ready():boolean;
  uuid():string;
}
class Choice<T> extends FuzzySuggestModal<T>{
  constructor(app:App,private items:T[],private label:(item:T)=>string,private choose:(item:T)=>void,placeholder:string){super(app);this.setPlaceholder(placeholder);}
  getItems(){return this.items;}getItemText(item:T){return this.label(item);}onChooseItem(item:T){this.choose(item);}
}
export class SidebarThreads {
  readonly transport:SidebarThreadTransport;
  private forking=new Set<string>();
  constructor(readonly app:App,private plugin:Plugin,readonly host:SidebarHost,readonly watch:typeof watchThread=watchThread){this.transport=new SidebarThreadTransport(environmentId=>host.access(environmentId),()=>host.uuid());}
  install(){
    for(const kind of Object.keys(TYPES) as SidebarKind[])this.plugin.registerView(TYPES[kind],leaf=>new SidebarThreadView(leaf,this,kind));
    this.plugin.addCommand({id:'sidebar-thread',name:'Open thread in right sidebar…',checkCallback:checking=>{if(!this.host.ready())return false;if(!checking)this.chooseThread();return true;}});
    this.plugin.addCommand({id:'sidebar-side-chat',name:'Start side chat in right sidebar',checkCallback:checking=>{const source=this.source();if(!this.host.ready()||!source)return false;if(!checking)void this.startSideChat(source);return true;}});
    this.plugin.addCommand({id:'sidebar-subagent',name:'View subagent in right sidebar…',checkCallback:checking=>{const source=this.source();if(!this.host.ready()||!source)return false;if(!checking)void this.chooseSubagent(source);return true;}});
  }
  source(){const active=this.app.workspace.getActiveViewOfType(SidebarThreadView);return active?.target??this.host.source();}
  report(error:unknown){new Notice(error instanceof Error?error.message:String(error),10000);}
  async open(target:SidebarTarget){
    const valid=sidebarTarget(target);if(!valid)throw Error('Choose an available T3 thread.');
    const existing=this.app.workspace.getLeavesOfType(TYPES[target.kind]).find(leaf=>{const view=leaf.view;return view instanceof SidebarThreadView&&view.target?.environmentId===target.environmentId&&view.target.threadId===target.threadId;});
    const leaf=existing??this.app.workspace.getRightLeaf(false);if(!leaf)throw Error('The right sidebar is unavailable.');
    if(!existing)await leaf.setViewState({type:TYPES[target.kind],state:{target},active:true});
    await this.app.workspace.revealLeaf(leaf);
  }
  chooseThread(){new Choice(this.app,this.host.projects(),project=>project.label,project=>{void this.chooseProjectThread(project).catch(error=>this.report(error));},'Choose a T3 project').open();}
  private async chooseProjectThread(project:ProjectChoice){
    const threads=(await this.host.threads(project)).filter(thread=>thread.lineage?.relationshipToParent!=='subagent'&&thread.lineage?.sideChat!==true);
    new Choice<ThreadChoice|undefined>(this.app,[undefined,...threads],thread=>thread?`${thread.title} · ${thread.status}`:'New thread (no note stream)',thread=>{
      if(thread)void this.open({kind:'thread',environmentId:project.environmentId,projectId:project.projectId,threadId:thread.id,title:thread.title}).catch(error=>this.report(error));
      else void this.openDraft(project).catch(error=>this.report(error));
    },'Open a thread without note streaming').open();
  }
  private async openDraft(project:ProjectChoice){
    const leaf=this.app.workspace.getRightLeaf(false);if(!leaf)return;
    await leaf.setViewState({type:TYPES.thread,state:{project},active:true});await this.app.workspace.revealLeaf(leaf);
  }
  async startSideChat(source:SidebarTarget){
    const key=JSON.stringify([source.environmentId,source.threadId]);if(this.forking.has(key))return;this.forking.add(key);
    try{await this.open(await this.transport.fork(source));}catch(error){this.report(error);}finally{this.forking.delete(key);}
  }
  async chooseSubagent(source:SidebarTarget){
    try{
      const {thread}=await this.transport.snapshot(source),targets=Object.values(thread.subagents??{}).flatMap(child=>{const target=subagentTarget(source,child);return target?[{target,status:child.status}]:[];});
      if(!targets.length){new Notice('This thread has no subagent thread to open.');return;}
      new Choice(this.app,targets,item=>`${item.target.title} · ${item.status}`,item=>{void this.open(item.target).catch(error=>this.report(error));},'Choose a subagent thread').open();
    }catch(error){this.report(error);}
  }
}

class DeleteSideChat extends Modal {
  constructor(app:App,private remove:()=>Promise<void>){super(app);}
  onOpen(){this.titleEl.setText('Delete side chat?');this.contentEl.createEl('p',{text:'This permanently deletes this side chat and its conversation history.'});new Setting(this.contentEl).addButton(button=>button.setButtonText('Cancel').onClick(()=>this.close())).addButton(button=>button.setButtonText('Delete side chat').setDestructive().onClick(async()=>{button.setDisabled(true);try{await this.remove();this.close();}catch(error){new Notice(error instanceof Error?error.message:String(error));button.setDisabled(false);}}));}
}

/** Native workspace shell; note streams own their own editor/save adapters. */
export class SidebarThreadView extends ItemView {
  target?:SidebarTarget;
  private project?:ProjectChoice;private state:InlineThreadState={messages:[],activities:[]};
  private monitor?:{stop():void};private epoch=0;private closed=true;private sending=false;private online=false;
  private draftContext?:OutgoingContext;private draftAttachments:OutgoingAttachment[]=[];private draft='';private sequence=-1;private settings:ComposerSettings={};private root?:string;
  private pending?:{text:string;commandId:string;messageId:string;threadId:string;options:SidebarSendOptions};
  private transcript?:ChatTranscript;private composer?:ChatComposer;private status?:HTMLElement;private title?:HTMLElement;private backButton?:HTMLButtonElement;private breadcrumb?:HTMLElement;
  private requests?:HTMLElement;private requestKey='';private disposeRequests?:()=>void;
  private observations?:ChatObservations;
  constructor(leaf:WorkspaceLeaf,readonly owner:SidebarThreads,private kind:SidebarKind){super(leaf);}
  getViewType(){return TYPES[this.kind];}getDisplayText(){return this.target?.title??LABELS[this.kind];}getIcon(){return this.kind==='subagent'?'bot':this.kind==='side-chat'?'messages-square':'message-circle';}
  private observationSource(){return JSON.stringify([this.target?.environmentId,this.target?.projectId,this.target?.threadId]);}
  getState(){return {target:this.target,project:this.project,draft:this.draft,pending:this.pending,settings:this.settings,context:this.composer?.options().context??this.draftContext,attachments:this.composer?.options().attachments??this.draftAttachments,observations:this.target?readChatObservations({source:this.observationSource(),inputTurns:this.state.inputTurns,inputBoundaries:this.state.inputBoundaries},this.observationSource()):undefined};}
  async setState(state:Record<string,unknown>,result:import('obsidian').ViewStateResult){
    this.target=sidebarTarget(state.target);if(this.target?.kind!==this.kind)this.target=undefined;
    this.observations=readChatObservations(state.observations,this.observationSource());
    const project=state.project;this.project=isRecord(project)?this.owner.host.projects().find(choice=>choice.key===project.key):undefined;
    this.draft=typeof state.draft==='string'?state.draft.slice(0,120_000):'';
    this.draftAttachments=draftImages(state.attachments);
    this.settings=readComposerSettings(state.settings);this.draftContext=isRecord(state.context)&&Array.isArray(state.context.records)?{version:1,records:state.context.records.filter(isRecord).slice(0,100)}:undefined;
    this.pending=isRecord(state.pending)&&typeof state.pending.text==='string'&&typeof state.pending.commandId==='string'&&typeof state.pending.messageId==='string'?state.pending as unknown as typeof this.pending:undefined;
    await super.setState(state,result);if(!this.closed){this.layout();this.connect();}
  }
  async onOpen(){this.closed=false;this.layout();this.connect();}
  async onClose(){this.closed=true;this.epoch++;this.monitor?.stop();this.clearComponents();}
  private clearComponents(){this.disposeRequests?.();this.disposeRequests=undefined;if(this.transcript)this.removeChild(this.transcript);if(this.composer)this.removeChild(this.composer);this.transcript=undefined;this.composer=undefined;this.requestKey='';}
  private action(parent:HTMLElement,label:string,icon:string|undefined,run:()=>void|Promise<void>){const button=parent.createEl('button',{cls:icon?'clickable-icon t3-chat-icon':'clickable-icon t3-chat-text-action',attr:{type:'button','aria-label':label,title:label}});if(icon)setIcon(button,icon);else button.setText(label);button.addEventListener('click',()=>{void Promise.resolve().then(run).catch(error=>this.owner.report(error));});return button;}
  private layout(){
    this.clearComponents();this.contentEl.empty();this.contentEl.addClass('t3-sidebar-chat');
    const header=this.contentEl.createDiv({cls:'t3-chat-header'});this.title=header.createSpan({cls:'t3-chat-title',text:this.getDisplayText()});
    if(this.kind==='side-chat'){
      this.backButton=this.action(header,'Bring back',undefined,async()=>{await this.owner.transport.bringBack(this.target!);new Notice('Side chat added to the parent’s next message.');});
      this.action(header,'Delete side chat','trash-2',()=>new DeleteSideChat(this.app,async()=>{await this.owner.transport.deleteSideChat(this.target!);this.leaf.detach();}).open());
    }else if(this.kind==='thread')this.action(header,'Start side chat','messages-square',()=>{if(this.target)return this.owner.startSideChat(this.target);});
    this.action(header,'Close '+LABELS[this.kind],'x',()=>this.leaf.detach());
    const body=this.contentEl.createDiv({cls:'t3-chat-body'});
    if(this.target?.parent){const context=body.createDiv({cls:'t3-chat-context'});setIcon(context.createSpan(),'messages-square');this.breadcrumb=this.action(context,'Context from parent thread',undefined,()=>this.owner.open({...this.target!.parent!,title:'Parent thread',kind:'thread'}));}
    this.status=body.createDiv({cls:'t3-chat-status',attr:{role:'status','aria-live':'polite'}});this.status.hidden=true;
    const transcript=body.createDiv({cls:'t3-chat-transcript',attr:{role:'log','aria-label':`${LABELS[this.kind]} messages`}});
    this.transcript=new ChatTranscript(this.app,transcript,error=>this.owner.report(error),child=>{const target=this.target&&subagentTarget(this.target,child);if(target)void this.owner.open(target).catch(error=>this.owner.report(error));});this.addChild(this.transcript);
    this.requests=this.contentEl.createDiv({cls:'t3-chat-requests'});
    if(this.kind!=='subagent'){
      this.composer=new ChatComposer(this.app,this.contentEl.createDiv(),{uuid:()=>this.owner.host.uuid(),changed:text=>{this.draft=text;this.draftAttachments=this.composer?.options().attachments??[];this.draftContext=this.composer?.options().context;this.app.workspace.requestSaveLayout();},send:()=>this.send(),stop:()=>this.owner.transport.stop(this.target!),
        models:async refresh=>{const target=this.target??this.draftTarget();if(!target)return [];return this.owner.host.catalog?this.owner.host.catalog(target,refresh):this.owner.transport.catalog(target,this.root??this.project?.workspaceRoot,refresh);},
        configure:async settings=>{if(this.target)await this.owner.transport.configure(this.target,settings);this.settings=settings;this.app.workspace.requestSaveLayout();},
        files:async query=>{const target=this.target??this.draftTarget(),cwd=this.root??this.project?.workspaceRoot;if(!target||!cwd)return [];return this.owner.host.files?this.owner.host.files(target,cwd,query):this.owner.transport.files(target,cwd,query);},
      },this.draft);this.addChild(this.composer);this.composer.restoreContext(this.pending?.options?.context??this.draftContext);this.composer.restoreAttachments(this.pending?.options?.attachments??this.draftAttachments);
    }
    this.updateControls();
  }
  private draftTarget():SidebarTarget|undefined{return this.project?{kind:'thread',threadId:'draft',environmentId:this.project.environmentId,projectId:this.project.projectId,title:'New thread'}:undefined;}
  private setStatus(text?:string){if(this.status){this.status.hidden=!text;this.status.setText(text??'');}}
  private connect(){
    this.monitor?.stop();this.monitor=undefined;const epoch=++this.epoch;const observed=readChatObservations(this.observations,this.observationSource());this.state={messages:[],activities:[],inputTurns:observed.inputTurns,inputBoundaries:observed.inputBoundaries};this.sequence=-1;this.online=false;
    if(!this.target){this.root=this.project?.workspaceRoot;this.setStatus(this.project?undefined:'Choose a connected T3 thread.');if(this.project&&!this.settings.modelSelection)void this.owner.transport.defaults(this.project).then(defaults=>{if(this.closed||epoch!==this.epoch||this.settings.modelSelection)return;this.settings=defaults;this.updateControls();void this.composer?.refreshModels().catch(()=>{});}).catch(()=>{});this.updateControls();return;}
    this.setStatus('Connecting…');const target=this.target;
    const callbacks:ThreadStreamCallbacks={
      item:item=>{
        if(this.closed||epoch!==this.epoch)return;
        const sequence=item.kind==='snapshot'?item.snapshot.snapshotSequence:item.kind==='event'?item.event.sequence:undefined;
        if(typeof sequence==='number'){if(sequence<this.sequence||item.kind==='event'&&sequence===this.sequence)return;this.sequence=sequence;}
        if(item.kind==='snapshot'){
          const thread=item.snapshot.thread;if(thread.id!==target.threadId||thread.projectId!==target.projectId||thread.archivedAt||thread.deletedAt){this.online=false;this.setStatus('This thread is no longer available.');this.monitor?.stop();this.updateControls();return;}
          const metadata=thread as typeof thread&{worktreePath?:string};this.settings={...this.settings,...readComposerSettings(metadata)};
          this.root=metadata.worktreePath??this.owner.host.projects().find(project=>project.projectId===target.projectId&&project.environmentId===target.environmentId)?.workspaceRoot;
          const first=!this.online;this.online=true;this.setStatus();if(first)void this.composer?.refreshModels().catch(()=>{});
        }
        if(item.kind==='event'&&item.event.type==='thread.metadata-updated')this.settings={...this.settings,...readComposerSettings(item.event.payload)};
        const boundaries=this.state.inputBoundaries;this.state=applyThreadItem(this.state,item).state;this.transcript?.update(this.state,target);
        if(boundaries!==this.state.inputBoundaries)this.app.workspace.requestSaveLayout();
        const key=JSON.stringify(this.state.activities.filter(activity=>/approval|user-input/.test(activity.kind)));if(key!==this.requestKey){this.requestKey=key;this.disposeRequests?.();this.requests?.empty();if(this.requests)this.disposeRequests=this.owner.host.renderRequests?.(this.requests,target,this.state);}
        this.updateControls();
      },
      reconnecting:error=>{if(!this.closed&&epoch===this.epoch){this.online=false;this.setStatus('Reconnecting · '+error.message);this.updateControls();}},
      failure:error=>{if(!this.closed&&epoch===this.epoch){this.online=false;this.setStatus(error.message);this.updateControls();}},
    };
    this.monitor=this.owner.host.watch?this.owner.host.watch(target,callbacks):this.owner.watch(target.threadId,()=>this.owner.host.access(target.environmentId),callbacks);
    if(target.parent)void this.owner.transport.snapshot(target.parent).then(({thread})=>{if(this.closed||epoch!==this.epoch)return;this.breadcrumb?.setText('Context from · '+(thread.title||'Parent thread'));}).catch(()=>{});
    this.updateControls();
  }
  private updateControls(){
    const available=!!this.target&&this.online;
    if(this.state.title&&this.target){this.target.title=this.state.title;this.title?.setText(this.state.title);}
    this.composer?.update(available||!!this.project,sidebarRunning(this.state),this.sending,this.settings,!!this.pending);
    if(this.backButton){this.backButton.disabled=this.sending||!available||sidebarRunning(this.state)||!Object.values({...this.state.turns,...(this.state.latestTurn?{[this.state.latestTurn.turnId]:this.state.latestTurn}:{})}).some(turn=>turn.state==='completed');this.backButton.title='Add a finished side chat to the parent’s next message.';}
  }
  async send(){
    const text=this.draft,options:SidebarSendOptions=this.composer?.options()??this.settings;
    if(this.sending||!text.trim()&&!options.attachments?.length||this.kind==='subagent'||!this.target&&!this.project)return;
    this.sending=true;this.updateControls();
    try{
      if(this.target&&!this.online)throw Error('Wait for this thread to reconnect.');
      if(this.pending&&(this.pending.text!==text||JSON.stringify(this.pending.options?.attachments??[])!==JSON.stringify(options.attachments??[])))throw Error('The previous send is unconfirmed. Retry its unchanged draft before sending another message.');
      this.pending??={text,commandId:this.owner.host.uuid(),messageId:this.owner.host.uuid(),threadId:this.owner.host.uuid(),options};this.app.workspace.requestSaveLayout();
      if(this.target)await this.owner.transport.send(this.target,text,this.pending.commandId,this.pending.messageId,this.pending.options);
      else{this.target=this.owner.host.create?await this.owner.host.create(this.project!,text,options):await this.owner.transport.launch(this.project!,text,this.pending.commandId,this.pending.threadId,this.pending.messageId,this.pending.options);this.project=undefined;this.owner.host.created?.(this.target);this.connect();}
      this.pending=undefined;this.draftContext=undefined;this.draftAttachments=[];this.draft='';this.composer?.clear();this.app.workspace.requestSaveLayout();
    }catch(error){this.owner.report(error);}finally{this.sending=false;this.updateControls();}
  }
}
