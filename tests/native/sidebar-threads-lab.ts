/** Native test fixture. Uses the product workspace views with synthetic canonical
 * snapshots; never connects to a provider, imports real notes, or changes Sync. */
import {Plugin,Platform,MarkdownView,type WorkspaceLeaf} from 'obsidian';
import {SidebarThreads,type SidebarHost} from '../../src/conversations/sidebar-thread-view';
import type {SidebarTarget} from '../../src/conversations/sidebar-thread-model';
import type {ThreadStreamCallbacks,watchThread} from '../../src/conversations/thread-stream';
import type {NormalizedThread} from '../../src/connection/wire-types';

declare const SIDEBAR_LAB_REPORT:string;
const project={key:'sidebar-fixture',label:'Sidebar validation',projectId:'sidebar-project',environmentId:'sidebar-environment',workspaceRoot:'/synthetic/sidebar'};
const parent:SidebarTarget={...project,threadId:'sidebar-parent',title:'Plan the documentation',kind:'thread'};
export default class SidebarLab extends Plugin {
  private sidebar!:SidebarThreads;private serial=0;private sequence=1;private watchers=new Map<string,Set<ThreadStreamCallbacks>>();
  private threads=new Map<string,NormalizedThread>();private leaves:WorkspaceLeaf[]=[];private calls:unknown[]=[];
  private readonly note='Sidebar validation.md';
  async onload(){
    this.threads.set(parent.threadId,this.thread(parent.threadId,parent.title,'List the documentation changes for this sidebar.','I will document three views:\n\n- **Thread** — send messages without attaching replies to a note.\n- **Side chat** — explore a separate branch of the current conversation.\n- **Subagent** — inspect a child’s progress and answer.\n\nThe composer stays available while the reply updates.'));
    this.threads.set('sidebar-child',this.thread('sidebar-child','Review the theme styles','Check the sidebar against Obsidian’s theme rules.','I checked the sidebar styles. The views use Obsidian’s text, border, spacing, and background variables.\n\n```css\ncolor: var(--text-muted);\nbackground: var(--background-secondary);\n```\n\nI am checking the message composer and activity controls next.',true));
    this.threads.get(parent.threadId)!.subagents={review:{id:'review',runId:'fixture-run',childThreadId:'sidebar-child',title:'Review the theme styles',status:'running',origin:'app_owned'}};
    const host:SidebarHost={files:async(_target,_cwd,query)=>['src/app.ts','styles.css','README.md'].filter(path=>path.toLowerCase().includes(query.toLowerCase())),catalog:async()=>[{selection:{instanceId:'codex',model:'gpt-6.1-sol'},label:'6.1 Sol',provider:'Codex',options:[{id:'reasoningEffort',label:'Reasoning effort',role:'reasoning',type:'select',options:[{id:'low',label:'Low'},{id:'high',label:'High'},{id:'xhigh',label:'Extra High'}]}],runtimeModes:['approval-required','auto-accept-edits','auto','full-access'],plan:true,commands:[{name:'compact'}],skills:[{name:'example',path:'/synthetic/SKILL.md'}]}],uuid:()=>`sidebar-id-${++this.serial}`,ready:()=>true,projects:()=>[project],threads:async()=>[{id:parent.threadId,projectId:project.projectId,title:parent.title,updatedAt:'2026-11-15',status:'Idle'}],source:()=>parent,
      access:async()=>({origin:'http://synthetic.invalid',api:async(path,body)=>{
        if(path==='/api/orchestration/dispatch'){
          this.calls.push(body);const command=body as Record<string,unknown>;
          if(command.type==='thread.fork'){
            const id=String(command.targetThreadId);this.threads.set(id,this.thread(id,'Explore a sidebar detail','How should the sidebar handle themes?','Use native workspace tabs and theme variables. The side chat keeps its own follow-up messages.\n\nThe **Bring back** action adds a finished side chat to the parent’s next message.'));
          }else if(command.type==='message.dispatch'){
            const thread=this.threads.get(String(command.threadId))!,message=command as unknown as {messageId:string;text:string};const now=new Date().toISOString(),run='fixture-'+(++this.serial);
            thread.messages.push({id:message.messageId,role:'user',text:message.text,turnId:run,streaming:false,createdAt:now});
            thread.messages.push({id:`reply-${++this.serial}`,role:'assistant',text:'Checking the thread state.',turnId:run,streaming:true,createdAt:now});
            thread.session={status:'running',activeTurnId:run};thread.turns={...thread.turns,[run]:{turnId:run,state:'running',startedAt:now}};this.emit(thread.id);
            const timer=window.setTimeout(()=>{if(thread.session?.activeTurnId!==run)return;thread.messages.at(-1)!.streaming=false;thread.messages.push({id:'final-'+this.serial,role:'assistant',text:'OK. The sidebar keeps this conversation separate from the note.',turnId:run,streaming:false,createdAt:new Date().toISOString()});thread.turns![run]={...thread.turns![run],state:'completed',completedAt:new Date().toISOString()};thread.session={status:'ready',activeTurnId:null};this.emit(thread.id);void this.report();},6000);this.register(()=>window.clearTimeout(timer));
          }else if(command.type==='thread.model-selection.set'||command.type==='thread.runtime-mode.set'||command.type==='thread.interaction-mode.set'){
            const thread=this.threads.get(String(command.threadId))!;if(command.modelSelection)thread.modelSelection=command.modelSelection as NormalizedThread['modelSelection'];if(command.runtimeMode)thread.runtimeMode=command.runtimeMode as NormalizedThread['runtimeMode'];if(command.interactionMode)thread.interactionMode=command.interactionMode as NormalizedThread['interactionMode'];this.emit(thread.id);
          }else if(command.type==='thread.delete'){
            this.threads.delete(String(command.threadId));
          }else if(command.type==='run.interrupt'){
            const thread=this.threads.get(String(command.threadId))!;const active=thread.session?.activeTurnId;thread.session={status:'ready',activeTurnId:null};if(active)thread.turns={...thread.turns,[active]:{turnId:active,state:'interrupted'}};this.emit(thread.id);
          }
          await this.report();return {};
        }
        const id=decodeURIComponent(path.split('/').at(-1)!.split('?')[0]);const thread=this.threads.get(id);if(!thread)throw Error('Unknown synthetic thread');return {snapshotSequence:++this.sequence,thread};
      }}),
      create:async(_project,text)=>{const threadId=`new-${++this.serial}`,target:SidebarTarget={...parent,threadId,title:'New sidebar thread'};this.threads.set(threadId,this.thread(threadId,target.title,text,'This is a separate thread. Its reply appears in the sidebar.'));return target;},
    };
    const watch:typeof watchThread=(id,_access,callbacks)=>{
      const listeners=this.watchers.get(id)??new Set();listeners.add(callbacks);this.watchers.set(id,listeners);queueMicrotask(()=>this.emit(id));return {stop:()=>{listeners.delete(callbacks);}};
    };
    this.sidebar=new SidebarThreads(this.app,this,host,watch);this.sidebar.install();
    this.addCommand({id:'lab-regular',name:'Lab: show regular thread',callback:()=>void this.show(parent)});
    this.addCommand({id:'lab-side-chat',name:'Lab: show side chat',callback:()=>void this.sidebar.startSideChat(parent)});
    this.addCommand({id:'lab-subagent',name:'Lab: show subagent',callback:()=>void this.show({...parent,threadId:'sidebar-child',title:'Review the theme styles',kind:'subagent',parent})});
    this.addCommand({id:'lab-finish',name:'Lab: retain results and clean test views',callback:()=>void this.cleanup()});
    this.app.workspace.onLayoutReady(()=>void this.prepare());
  }
  private thread(id:string,title:string,prompt:string,answer:string,running=false):NormalizedThread{const start=new Date(Date.now()-21_000).toISOString(),finish=new Date().toISOString();return {id,projectId:project.projectId,title,modelSelection:{instanceId:'codex',model:'gpt-6.1-sol',options:[{id:'reasoningEffort',value:'xhigh'}]},runtimeMode:'full-access',interactionMode:'default',messages:[{id:'prompt-'+id,role:'user',text:prompt,turnId:'fixture-run',streaming:false,createdAt:start},{id:'progress-'+id,role:'assistant',text:'Checking the shared response presentation.',turnId:'fixture-run',streaming:false,createdAt:start},{id:'answer-'+id,role:'assistant',text:answer,turnId:'fixture-run',streaming:running,createdAt:finish}],activities:[],session:{status:running?'running':'ready',activeTurnId:running?'fixture-run':null},turns:{'fixture-run':{turnId:'fixture-run',state:running?'running':'completed',startedAt:start,completedAt:running?undefined:finish}}};}
  private emit(id:string){const thread=this.threads.get(id);if(!thread)return;for(const listener of this.watchers.get(id)??[])listener.item({kind:'snapshot',snapshot:{snapshotSequence:++this.sequence,thread:structuredClone(thread)}});}
  private async show(target:SidebarTarget){await this.sidebar.open(target);await this.report();}
  private async prepare(){
    if(this.app.vault.getAbstractFileByPath(this.note))throw Error('Test note already exists; do not overwrite.');
    const file=await this.app.vault.create(this.note,'# Sidebar validation\n\nThis synthetic note stays unchanged while messages are sent in the right sidebar.\n\nUse the **T3 sidebar validation** commands to open the regular thread, side chat, and subagent pages.\n\nNo provider is running. The fixture sends canonical snapshots through the product view.\n');
    const leaf=this.app.workspace.getLeaf('tab');this.leaves.push(leaf);await leaf.openFile(file);const view=leaf.view as MarkdownView;await view.setState({...view.getState(),mode:'preview'},{history:false});await this.report();
  }
  private async report(){if(!Platform.isDesktop)return;const fs=await import('node:fs/promises');const file=this.app.vault.getFileByPath(this.note);await fs.writeFile(SIDEBAR_LAB_REPORT,JSON.stringify({fixture:'native Obsidian, synthetic canonical snapshots; no live provider',sourceVersion:this.manifest.version,calls:this.calls,views:['t3-thread','t3-side-chat','t3-subagent'].flatMap(type=>this.app.workspace.getLeavesOfType(type).map(leaf=>({type,state:leaf.view.getState()}))),note:file?await this.app.vault.read(file):null,cleaned:!file},null,2));}
  private async cleanup(){for(const type of ['t3-thread','t3-side-chat','t3-subagent'])for(const leaf of this.app.workspace.getLeavesOfType(type))leaf.detach();for(const leaf of this.leaves)leaf.detach();const file=this.app.vault.getFileByPath(this.note);if(file)await this.app.vault.delete(file);await this.report();}
}
