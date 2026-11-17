import {acquireT3UnaryRpc} from '../connection/t3-rpc';
import {delegatedWork} from './inline-delegation';
import {readNewThreadDefaults} from './model-defaults';
import {readComposerModels,type ComposerSettings} from './composer-models';
import type {OutgoingAttachment,OutgoingContext} from '../connection/send-contracts';
import {isRecord} from '../shared/values';
import {readInlineSnapshot,type ThreadAccess} from './thread-stream';
import {existingThreadTurn,threadIsActive} from './thread-target';
import type {ThreadTarget} from './thread-display';
import type {InlineSubagent,InlineThreadState} from './inline-thread';

export interface SidebarProject {key:string;label:string;projectId:string;environmentId:string;workspaceRoot?:string}
export interface SidebarSendOptions extends ComposerSettings {attachments?:OutgoingAttachment[];context?:OutgoingContext;delivery?:{intent:'auto'|'steer';mode:{type:'start_immediately'}|{type:'steer_active';targetRunId:string}}}
export type SidebarKind='thread'|'side-chat'|'subagent';
export interface SidebarTarget extends ThreadTarget {title:string;kind:SidebarKind;parent?:ThreadTarget}
export function sidebarTarget(value:unknown):SidebarTarget|undefined {
  if(!isRecord(value)||!['thread','side-chat','subagent'].includes(String(value.kind))||typeof value.title!=='string'||![value.threadId,value.projectId,value.environmentId].every(id=>typeof id==='string'&&id.length>0&&id.length<=200))return;
  const parent=value.parent;
  if(value.kind!=='thread'&&(!isRecord(parent)||![parent.threadId,parent.projectId,parent.environmentId].every(id=>typeof id==='string'&&id.length>0&&id.length<=200)||value.kind==='side-chat'&&parent.environmentId!==value.environmentId))return;
  return value as unknown as SidebarTarget;
}
export function subagentTarget(parent:ThreadTarget,child:InlineSubagent):SidebarTarget|undefined {
  if(!child.childThreadId||child.remoteChild)return;
  return {...parent,threadId:child.childThreadId,title:child.title||'Subagent',kind:'subagent',parent};
}
export function sidebarRunning(state:InlineThreadState){
  const turns={...state.turns,...(state.latestTurn?{[state.latestTurn.turnId]:state.latestTurn}:{})};
  const work=delegatedWork(state,[...new Set([...Object.keys(turns),...Object.values(state.subagents??{}).map(child=>child.runId)])]);
  return threadIsActive(state)||Object.values(turns).some(turn=>['running','starting','preparing','waiting'].includes(turn.state))||work.waiting||work.running;
}

/** All mutations check fresh canonical identity. This transport has no note IO,
 * response reservations, or stream registrations. */
export class SidebarThreadTransport {
  constructor(private access:(environmentId:string)=>Promise<ThreadAccess>,private uuid:()=>string){}
  private async use<T>(target:ThreadTarget,work:(access:ThreadAccess)=>Promise<T>):Promise<T>{const access=await this.access(target.environmentId);try{return await work(access);}finally{await access.close?.();}}
  private async read(access:ThreadAccess,target:ThreadTarget){
    const snapshot=await readInlineSnapshot(access,target.threadId,target.projectId);
    if(snapshot.thread.archivedAt||snapshot.thread.deletedAt)throw Error('This thread is no longer available.');
    return snapshot;
  }
  snapshot(target:ThreadTarget){return this.use(target,access=>this.read(access,target));}
  async send(target:SidebarTarget,text:string,commandId:string,messageId:string,options:SidebarSendOptions={}){
    if(target.kind==='subagent')throw Error('Subagent threads are read-only. Continue in the parent thread.');
    if(!text.trim()&&!options.attachments?.length||text.length>120_000)throw Error('Enter a message of at most 120,000 characters.');
    return this.use(target,async access=>{
      const {thread}=await this.read(access,target);
      const existing=thread.messages.find(message=>message.id===messageId);if(existing){if(existing.role!=='user'||existing.text!==text)throw Error('This message ID belongs to different content.');return;}
      existingThreadTurn(thread,target,commandId,{messageId,role:'user',text,attachments:[]});
      options.delivery??=thread.session?.activeTurnId?{intent:'steer',mode:{type:'steer_active',targetRunId:thread.session.activeTurnId}}:{intent:'auto',mode:{type:'start_immediately'}};
      await access.api('/api/orchestration/dispatch',{type:'message.dispatch',commandId,threadId:target.threadId,messageId,text,attachments:options.attachments??[],createdBy:'user',creationSource:'web',...(options.context?{context:options.context}:{}),deliveryIntent:options.delivery.intent,dispatchMode:options.delivery.mode,...(options.modelSelection?{modelSelection:options.modelSelection}:{})});
    });
  }
  async defaults(project:SidebarProject){
    const access=await this.access(project.environmentId);try{return await readNewThreadDefaults(access.api,access.origin,{id:project.projectId,workspaceRoot:project.workspaceRoot});}finally{await access.close?.();}
  }
  async catalog(target:ThreadTarget,cwd?:string,refresh=false){return this.use(target,async access=>{
    const rpc=await acquireT3UnaryRpc(access.api,access.origin);
    try{
      return await readComposerModels(rpc,cwd,refresh);
    }finally{rpc.close();}
  });}
  async files(target:ThreadTarget,cwd:string,query:string){return this.use(target,async access=>{const rpc=await acquireT3UnaryRpc(access.api,access.origin);try{const result=await rpc.call('projects.searchEntries',{cwd,query:query.slice(0,256),limit:100,kind:'file'});return isRecord(result)&&Array.isArray(result.entries)?result.entries.flatMap(row=>isRecord(row)&&typeof row.path==='string'?[row.path]:[]):[];}finally{rpc.close();}});}
  async configure(target:SidebarTarget,settings:ComposerSettings){
    if(target.kind==='subagent')throw Error('Subagent threads are read-only.');
    return this.use(target,async access=>{const {thread}=await this.read(access,target);for(const [field,type] of [['modelSelection','thread.model-selection.set'],['runtimeMode','thread.runtime-mode.set'],['interactionMode','thread.interaction-mode.set']] as const)if(settings[field]!==undefined&&JSON.stringify(settings[field])!==JSON.stringify(thread[field]))await access.api('/api/orchestration/dispatch',{type,commandId:this.uuid(),threadId:target.threadId,[field]:settings[field]});});
  }
  async launch(project:SidebarProject,text:string,commandId:string,threadId:string,messageId:string,options:SidebarSendOptions={}):Promise<SidebarTarget>{
    const access=await this.access(project.environmentId);try{
      const shell=await access.api('/api/orchestration/shell');const entries:unknown[]=isRecord(shell)&&Array.isArray(shell.projects)?shell.projects:[];const found=entries.find(row=>isRecord(row)&&row.id===project.projectId);
      if(!isRecord(found)||typeof found.id!=='string')throw Error('This project is no longer available.');
      const defaults=await readNewThreadDefaults(access.api,access.origin,{id:found.id,workspaceRoot:typeof found.workspaceRoot==='string'?found.workspaceRoot:undefined});
      await access.api('/api/orchestration/launch',{commandId,threadId,projectId:project.projectId,title:text.slice(0,80)||'New thread',generateTitle:true,creationSource:'web',modelSelection:options.modelSelection??defaults.modelSelection,runtimeMode:options.runtimeMode??defaults.runtimeMode,interactionMode:options.interactionMode??'default',workspaceStrategy:defaults.workspaceStrategy??{type:'root'},initialMessage:{messageId,role:'user',text,attachments:options.attachments??[],...(options.context?{context:options.context}:{})}});
      return {kind:'thread',threadId,projectId:project.projectId,environmentId:project.environmentId,title:text.slice(0,80)||'New thread'};
    }finally{await access.close?.();}
  }
  async deleteSideChat(target:SidebarTarget){
    if(target.kind!=='side-chat')throw Error('Choose a side chat to delete.');
    return this.use(target,async access=>{await this.read(access,target);await access.api('/api/orchestration/dispatch',{type:'thread.delete',commandId:this.uuid(),threadId:target.threadId});});
  }
  async fork(parent:SidebarTarget):Promise<SidebarTarget>{
    return this.use(parent,async access=>{
      await this.read(access,parent);
      const threadId=this.uuid();
      await access.api('/api/orchestration/dispatch',{type:'thread.fork',commandId:this.uuid(),createdBy:'user',creationSource:'web',sourceThreadId:parent.threadId,targetThreadId:threadId,sourcePoint:{type:'latest_stable'},sideChat:true,title:'Side chat'});
      const target:SidebarTarget={...parent,threadId,title:'Side chat',kind:'side-chat',parent:{threadId:parent.threadId,projectId:parent.projectId,environmentId:parent.environmentId}};
      await this.read(access,target);return target;
    });
  }
  async bringBack(target:SidebarTarget){
    if(target.kind!=='side-chat'||!target.parent)throw Error('Choose a side chat.');
    return this.use(target,async access=>{
      const child=await this.read(access,target),parent=await this.read(access,target.parent!);
      if(sidebarRunning(parent.thread)||sidebarRunning(child.thread))throw Error('Wait for both threads to finish before bringing the side chat back.');
      const run=Object.values({...child.thread.turns,...(child.thread.latestTurn?{[child.thread.latestTurn.turnId]:child.thread.latestTurn}:{})}).filter(turn=>turn.state==='completed').sort((a,b)=>(b.completedAt??'').localeCompare(a.completedAt??''))[0];
      if(!run)throw Error('A finished reply is required to bring this chat back.');
      await access.api('/api/orchestration/dispatch',{type:'thread.merge_back',commandId:this.uuid(),createdBy:'user',creationSource:'web',sourceThreadId:target.threadId,targetThreadId:target.parent!.threadId,sourcePoint:{type:'run',runId:run.turnId}});
    });
  }
  async stop(target:SidebarTarget){
    if(target.kind==='subagent')throw Error('Stop a subagent from its parent thread.');
    return this.use(target,async access=>{
      const {thread}=await this.read(access,target),runId=thread.session?.activeTurnId;
      if(!runId)throw Error('This thread has no active run.');
      await access.api('/api/orchestration/dispatch',{type:'run.interrupt',commandId:this.uuid(),threadId:target.threadId,runId,holdQueue:true});
    });
  }
}
