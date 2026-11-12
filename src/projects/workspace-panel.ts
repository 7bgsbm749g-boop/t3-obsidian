import {setIcon,type App} from 'obsidian';
import {NoteTabPanel} from '../notes/note-tab-panel';
import {isRecord,records} from '../shared/values';
import {connectT3Rpc,type T3RpcConnection} from '../connection/t3-rpc';
import type {ThreadAccess} from '../conversations/thread-stream';

export interface WorkspaceTarget {notePath:string;projectId:string;projectTitle:string;workspaceRoot:string;threadId:string;environmentId:string;machine:string}
export interface WorkspaceData {cwd:string;branch:string;isRepo:boolean;insertions:number;deletions:number;files:Record<string,unknown>[];pullRequests:Record<string,unknown>[];relatives:Record<string,unknown>[];warnings:string[]}
export const threadLink=(target:Pick<WorkspaceTarget,'environmentId'|'threadId'>)=>`t3-thread://v2/${encodeURIComponent(target.environmentId)}/${encodeURIComponent(target.threadId)}`;
export function displayText(value:unknown,fallback=''){return typeof value==='string'||typeof value==='number'?String(value):fallback;}
export function safeWebLink(value:unknown):string|undefined{try{if(typeof value!=='string')return;const url=new URL(value);return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password?url.href:undefined;}catch{return;}}
export function workspaceData(target:WorkspaceTarget,shell:unknown,detail:unknown,status:unknown):WorkspaceData{
  const projection=isRecord(detail)&&isRecord(detail.projection)?detail.projection:detail;
  const thread=isRecord(projection)&&isRecord(projection.thread)?projection.thread:undefined;
  if(!thread||thread.id!==target.threadId||thread.projectId!==target.projectId)throw Error('The linked thread is no longer in this project.');
  if(!isRecord(status)||typeof status.isRepo!=='boolean')throw Error('T3 did not return repository status.');
  const working=isRecord(status.workingTree)?status.workingTree:{};
  const lineage=isRecord(thread.lineage)?thread.lineage:{};
  const root=lineage.rootThreadId??thread.id;
  const relatives=isRecord(shell)?records(shell.threads).filter(t=>t.id!==thread.id&&!t.deletedAt&&t.projectId===target.projectId&&isRecord(t.lineage)&&t.lineage.rootThreadId===root).slice(0,40):[];
  return {cwd:typeof thread.worktreePath==='string'?thread.worktreePath:target.workspaceRoot,branch:displayText(status.refName,'Detached HEAD'),isRepo:status.isRepo,insertions:Number(working.insertions??0),deletions:Number(working.deletions??0),files:records(working.files).slice(0,200),pullRequests:records(thread.pullRequests).filter(pr=>pr.source!=='stack-dismissed'),relatives,warnings:[]};
}
export async function readWorkspace(target:WorkspaceTarget,open:()=>Promise<ThreadAccess>):Promise<WorkspaceData>{
  const access=await open();let rpc:T3RpcConnection|undefined;
  try{
    const [shell,detail]=await Promise.all([access.api('/api/orchestration/shell'),access.api(`/api/orchestration/threads/${encodeURIComponent(target.threadId)}?controlOnly=true`)]);
    const projection=isRecord(detail)&&isRecord(detail.projection)?detail.projection:detail;
    const thread=isRecord(projection)&&isRecord(projection.thread)?projection.thread:undefined;
    if(!thread||thread.id!==target.threadId||thread.projectId!==target.projectId)throw Error('The note’s linked thread is unavailable.');
    const cwd=typeof thread.worktreePath==='string'?thread.worktreePath:target.workspaceRoot;
    rpc=await connectT3Rpc(access.api,access.origin);
    return workspaceData(target,shell,detail,await rpc.call('vcs.refreshStatus',{cwd}));
  }finally{rpc?.close();await access.close?.();}
}
export function panelRow(parent:HTMLElement,label:string,icon:string,detail?:string){
  const row=parent.createDiv({cls:'t3-workspace-row'});setIcon(row.createSpan({cls:'t3-workspace-icon'}),icon);row.createSpan({text:label,cls:'t3-workspace-label'});if(detail)row.createSpan({text:detail,cls:'t3-workspace-detail'});return row;
}
export function panelLink(parent:HTMLElement,label:string,href:string){return parent.createEl('a',{text:label,href,cls:'t3-panel-link',attr:{rel:'noopener noreferrer'}});}
export class WorkspacePanel extends NoteTabPanel {
  private revision=0;
  constructor(app:App,private target:WorkspaceTarget,private load:()=>Promise<WorkspaceData>,private openPr:()=>void){super(app,target.notePath,'workspace');}
  onOpen(){this.titleEl.setText('Workspace');this.modalEl.classList.add('t3-workspace-panel');this.contentEl.empty();const revision=++this.revision;
    this.contentEl.createEl('p',{text:'Reading the linked T3 workspace…',attr:{role:'status'}});
    void this.load().then(data=>{if(revision===this.revision)this.render(data);}).catch(error=>{if(revision!==this.revision)return;this.contentEl.empty();this.contentEl.createEl('p',{text:error instanceof Error?error.message:String(error),attr:{role:'alert'}});this.contentEl.createEl('button',{text:'Retry'}).addEventListener('click',()=>this.onOpen());});}
  onClose(){this.revision++;}
  private render(data:WorkspaceData){
    this.contentEl.empty();const top=this.contentEl.createDiv({cls:'t3-workspace-section'});
    panelRow(top,this.target.machine,'cloud');panelLink(top,'Open workspace in T3 ↗',threadLink(this.target));panelLink(top,'Project scripts in T3 ↗',threadLink(this.target));
    const git=this.contentEl.createDiv({cls:'t3-workspace-section'});
    panelRow(git,data.isRepo?data.branch:'No repository','git-branch');
    const pr=git.createEl('button',{cls:'t3-workspace-action'});panelRow(pr,'Pull requests','git-pull-request',String(data.pullRequests.length));pr.addEventListener('click',this.openPr);
    panelLink(git,'Commit in T3 ↗',threadLink(this.target));
    const changes=git.createEl('details');const summary=changes.createEl('summary');panelRow(summary,'Changes','file-diff',`+${data.insertions} −${data.deletions}`);
    if(!data.files.length)changes.createEl('p',{text:'Working tree is clean.',cls:'t3-composer-hint'});
    for(const file of data.files)panelRow(changes,String(file.path),'file',`+${String(file.insertions)} −${String(file.deletions)}`);
    if(data.files.length===200)changes.createEl('p',{text:'Showing the first 200 files. Open T3 for all changes.'});
    const lineage=this.contentEl.createDiv({cls:'t3-workspace-section'});lineage.createEl('h3',{text:'Lineage'});
    const previous=lineage.createEl('details');previous.createEl('summary',{text:`Related agents (${data.relatives.length})`});
    for(const relative of data.relatives){const row=panelRow(previous,displayText(relative.title,'Untitled thread'),'git-fork');panelLink(row,'Open ↗',threadLink({...this.target,threadId:String(relative.id)}));}
    if(!data.relatives.length)previous.createEl('p',{text:'No related agents.',cls:'t3-composer-hint'});
    const footer=this.contentEl.createDiv({cls:'t3-panel-footer'});footer.createEl('button',{text:'Refresh'}).addEventListener('click',()=>this.onOpen());footer.createEl('small',{text:this.target.projectTitle});
  }
}
