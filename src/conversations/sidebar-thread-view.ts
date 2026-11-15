import {Component,FuzzySuggestModal,ItemView,MarkdownRenderer,Notice,type App,type Plugin,type WorkspaceLeaf} from 'obsidian';
import {applyThreadItem,type InlineThreadState} from './inline-thread';
import {watchThread,type ThreadAccess} from './thread-stream';
import {SidebarThreadTransport,sidebarTarget,sidebarRunning,subagentTarget,type SidebarKind,type SidebarTarget} from './sidebar-thread-model';
import type {ThreadChoice} from './thread-target';
import {responseToolGroups} from '../responses/response-tools';
import {isRecord} from '../shared/values';

const TYPES:Record<SidebarKind,string>={thread:'t3-thread','side-chat':'t3-side-chat',subagent:'t3-subagent'};
const LABELS:Record<SidebarKind,string>={thread:'T3 thread','side-chat':'Side chat',subagent:'Subagent'};
interface ProjectChoice {key:string;label:string;projectId:string;environmentId:string}
export interface SidebarHost {
  access(environmentId:string):Promise<ThreadAccess>;
  projects():ProjectChoice[];
  threads(project:ProjectChoice):Promise<ThreadChoice[]>;
  create(project:ProjectChoice,text:string):Promise<SidebarTarget>;
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
    const leaf=existing??this.app.workspace.getRightLeaf(true);if(!leaf)throw Error('The right sidebar is unavailable.');
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
    const leaf=this.app.workspace.getRightLeaf(true);if(!leaf)return;
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

/** Three native workspace pages share one transcript, activity list and composer. */
export class SidebarThreadView extends ItemView {
  target?:SidebarTarget;
  private project?:ProjectChoice;
  private state:InlineThreadState={messages:[],activities:[]};
  private monitor?:{stop():void};private epoch=0;private closed=true;private sending=false;private online=false;
  private childrenKey='';private sequence=-1;
  private draft='';private pending?:{text:string;commandId:string;messageId:string};
  private transcript?:HTMLElement;private children?:HTMLElement;private status?:HTMLElement;private input?:HTMLTextAreaElement;private sendButton?:HTMLButtonElement;private stopButton?:HTMLButtonElement;private forkButton?:HTMLButtonElement;private backButton?:HTMLButtonElement;private title?:HTMLElement;
  private rendered=new Map<string,{text:string;el:HTMLElement;component:Component}>();
  constructor(leaf:WorkspaceLeaf,readonly owner:SidebarThreads,private kind:SidebarKind){super(leaf);}
  getViewType(){return TYPES[this.kind];}getDisplayText(){return this.target?.title??LABELS[this.kind];}getIcon(){return this.kind==='subagent'?'bot':this.kind==='side-chat'?'messages-square':'message-circle';}
  getState(){return {target:this.target,project:this.project,draft:this.draft,pending:this.pending};}
  async setState(state:Record<string,unknown>,result:import('obsidian').ViewStateResult){
    this.target=sidebarTarget(state.target);if(this.target?.kind!==this.kind)this.target=undefined;
    const project=state.project;this.project=isRecord(project)?this.owner.host.projects().find(choice=>choice.key===project.key):undefined;
    this.draft=typeof state.draft==='string'?state.draft.slice(0,120_000):'';
    this.pending=isRecord(state.pending)&&typeof state.pending.text==='string'&&typeof state.pending.commandId==='string'&&typeof state.pending.messageId==='string'?state.pending as unknown as typeof this.pending:undefined;
    await super.setState(state,result);if(!this.closed){this.layout();this.connect();}
  }
  async onOpen(){this.closed=false;this.layout();this.connect();}
  async onClose(){this.closed=true;this.epoch++;this.monitor?.stop();this.clearMessages();}
  private clearMessages(){for(const item of this.rendered.values()){this.removeChild(item.component);item.component.unload();}this.rendered.clear();}
  private layout(){
    this.clearMessages();this.childrenKey='';this.contentEl.empty();this.contentEl.addClass('t3-sidebar-chat');
    const header=this.contentEl.createDiv({cls:'t3-sidebar-header'});this.title=header.createEl('strong',{text:this.getDisplayText()});
    if(this.target?.parent)this.button(header,'Parent',()=>this.owner.open({...this.target!.parent!,title:'Parent thread',kind:'thread'}));
    if(this.kind==='side-chat')this.backButton=this.button(header,'Bring back',async()=>{await this.owner.transport.bringBack(this.target!);new Notice('Side chat added to the parent’s next message.');});
    if(this.kind!=='subagent')this.forkButton=this.button(header,'Side chat',()=>this.owner.startSideChat(this.target!));
    this.status=this.contentEl.createDiv({cls:'t3-sidebar-status',attr:{role:'status','aria-live':'polite'}});
    this.children=this.contentEl.createDiv({cls:'t3-sidebar-children'});
    this.transcript=this.contentEl.createDiv({cls:'t3-sidebar-transcript',attr:{role:'log','aria-label':`${LABELS[this.kind]} messages`}});
    if(this.kind==='subagent')this.contentEl.createDiv({cls:'t3-sidebar-status',text:'Subagent view · continue in the parent thread.'});
    else{
      const composer=this.contentEl.createDiv({cls:'t3-sidebar-composer'});
      this.input=composer.createEl('textarea',{attr:{'aria-label':'Message T3',placeholder:'Ask a follow-up…',rows:'3'}});this.input.value=this.draft;
      this.input.addEventListener('input',()=>{this.draft=this.input!.value;this.app.workspace.requestSaveLayout();this.updateControls();});
      this.input.addEventListener('keydown',event=>{if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)&&!event.isComposing){event.preventDefault();void this.send();}});
      const actions=composer.createDiv({cls:'t3-sidebar-actions'});actions.createSpan({text:'No note stream added',cls:'t3-sidebar-hint'});
      this.stopButton=this.button(actions,'Stop',()=>this.owner.transport.stop(this.target!));this.sendButton=this.button(actions,'Send',()=>this.send());this.sendButton.addClass('mod-cta');
    }
    this.updateControls();
  }
  private button(parent:HTMLElement,label:string,action:()=>void|Promise<void>){const button=parent.createEl('button',{text:label,attr:{type:'button','aria-label':label}});button.addEventListener('click',()=>{void Promise.resolve().then(action).catch(error=>this.owner.report(error));});return button;}
  private connect(){
    this.monitor?.stop();this.monitor=undefined;const epoch=++this.epoch;this.state={messages:[],activities:[]};this.sequence=-1;this.online=false;
    if(!this.target){this.status?.setText(this.project?'New thread · '+this.project.label:'Choose a thread with the T3 Code sidebar command.');this.updateControls();return;}
    this.status?.setText('Connecting…');const target=this.target;
    this.monitor=this.owner.watch(target.threadId,()=>this.owner.host.access(target.environmentId),{
      item:item=>{
        if(this.closed||epoch!==this.epoch)return;
        if(item.kind==='snapshot'&&(item.snapshot.thread.id!==target.threadId||item.snapshot.thread.projectId!==target.projectId||item.snapshot.thread.archivedAt||item.snapshot.thread.deletedAt)){this.online=false;this.status?.setText('This thread is no longer available.');this.monitor?.stop();this.updateControls();return;}
        const sequence=item.kind==='snapshot'?item.snapshot.snapshotSequence:item.kind==='event'?item.event.sequence:undefined;
        if(typeof sequence==='number'){if(sequence<this.sequence||item.kind==='event'&&sequence===this.sequence)return;this.sequence=sequence;}
        if(item.kind==='snapshot')this.online=true;
        this.state=applyThreadItem(this.state,item).state;this.render();
      },
      reconnecting:error=>{if(!this.closed&&epoch===this.epoch){this.online=false;this.status?.setText('Reconnecting · '+error.message);this.updateControls();}},
      failure:error=>{if(!this.closed&&epoch===this.epoch){this.online=false;this.status?.setText(error.message);this.updateControls();}},
    });
    this.updateControls();
  }
  private render(){
    if(!this.transcript||this.closed)return;
    const pinned=this.transcript.scrollHeight-this.transcript.scrollTop-this.transcript.clientHeight<64;
    const title=this.state.title;if(title&&this.target){this.target.title=title;this.title?.setText(title);}
    this.status?.setText(!this.online?'Reconnecting…':sidebarRunning(this.state)?'Working…':'Ready');
    const keys=new Set<string>();
    for(const message of this.state.messages.filter(message=>message.role==='user'||message.role==='assistant').slice(-200)){
      keys.add(message.id);let row=this.rendered.get(message.id);
      if(!row){const el=this.transcript.createEl('article',{cls:'t3-sidebar-message '+(message.role==='user'?'is-user':'is-assistant')});el.createDiv({cls:'t3-sidebar-message-role',text:message.role==='user'?'You':'Assistant'});const body=el.createDiv({cls:'markdown-rendered'});const component=new Component();this.addChild(component);row={text:'',el:body,component};this.rendered.set(message.id,row);}
      if(row.text!==message.text){row.text=message.text;row.component.unload();row.component.load();row.el.empty();void MarkdownRenderer.render(this.app,message.text,row.el,'',row.component).catch(error=>this.owner.report(error));}
    }
    for(const [key,row] of this.rendered)if(!keys.has(key)){this.removeChild(row.component);row.component.unload();row.el.parentElement?.remove();this.rendered.delete(key);}
    const groups=responseToolGroups(this.state,Object.keys(this.state.turns??{})),latest=groups.at(-1);
    const childrenKey=JSON.stringify([this.state.subagents,latest?.tools]);
    if(childrenKey!==this.childrenKey){this.childrenKey=childrenKey;this.children?.empty();
    for(const child of Object.values(this.state.subagents??{})){
      const target=this.target&&subagentTarget(this.target,child);if(target&&this.children)this.button(this.children,`${child.title||'Subagent'} · ${child.status}`,()=>this.owner.open(target));
    }
    if(latest&&this.children){const details=this.children.createEl('details');details.createEl('summary',{text:`Activity · ${latest.tools.length} tools`});for(const tool of latest.tools)details.createDiv({text:`${tool.label} · ${tool.status}`});}
    }
    if(pinned)this.transcript.scrollTop=this.transcript.scrollHeight;
    this.updateControls();
  }
  private updateControls(){
    const available=!!this.target&&this.online;
    if(this.sendButton)this.sendButton.disabled=this.sending||!this.draft.trim()||!available&&!this.project;
    if(this.stopButton)this.stopButton.disabled=this.sending||!available||!this.state.session?.activeTurnId;
    if(this.forkButton)this.forkButton.disabled=this.sending||!available;
    if(this.backButton)this.backButton.disabled=this.sending||!available||sidebarRunning(this.state)||!Object.values(this.state.turns??{}).some(turn=>turn.state==='completed');
  }
  async send(){
    if(this.sending||!this.draft.trim()||this.kind==='subagent'||!this.target&&!this.project)return;
    this.sending=true;this.updateControls();const text=this.draft;
    try{
      if(this.target){
        if(!this.online)throw Error('Wait for this thread to reconnect.');
        if(this.pending&&this.pending.text!==text)throw Error('The previous send is unconfirmed. Retry its unchanged draft before sending another message.');
        this.pending??={text,commandId:this.owner.host.uuid(),messageId:this.owner.host.uuid()};this.app.workspace.requestSaveLayout();
        await this.owner.transport.send(this.target,text,this.pending.commandId,this.pending.messageId);this.pending=undefined;
      }else{this.target=await this.owner.host.create(this.project!,text);this.project=undefined;this.connect();}
      this.draft='';if(this.input)this.input.value='';this.app.workspace.requestSaveLayout();
    }catch(error){this.owner.report(error);}finally{this.sending=false;this.updateControls();}
  }
}
