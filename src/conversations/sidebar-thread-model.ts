import {isRecord} from '../shared/values';
import {readInlineSnapshot,type ThreadAccess} from './thread-stream';
import {existingThreadTurn,threadIsActive} from './thread-target';
import type {ThreadTarget} from './thread-display';
import type {InlineSubagent,InlineThreadState} from './inline-thread';

export type SidebarKind='thread'|'side-chat'|'subagent';
export interface SidebarTarget extends ThreadTarget {title:string;kind:SidebarKind;parent?:ThreadTarget}
export function sidebarTarget(value:unknown):SidebarTarget|undefined {
  if(!isRecord(value)||!['thread','side-chat','subagent'].includes(String(value.kind))||typeof value.title!=='string'||![value.threadId,value.projectId,value.environmentId].every(id=>typeof id==='string'&&id.length>0&&id.length<=200))return;
  const parent=value.parent;
  if(value.kind!=='thread'&&(!isRecord(parent)||![parent.threadId,parent.projectId,parent.environmentId].every(id=>typeof id==='string'&&id.length>0&&id.length<=200)||parent.environmentId!==value.environmentId))return;
  return value as unknown as SidebarTarget;
}
export function subagentTarget(parent:ThreadTarget,child:InlineSubagent):SidebarTarget|undefined {
  if(!child.childThreadId||child.remoteChild)return;
  return {...parent,threadId:child.childThreadId,title:child.title||'Subagent',kind:'subagent',parent};
}
export function sidebarRunning(state:InlineThreadState){return threadIsActive(state)||Object.values(state.turns??{}).some(turn=>['running','starting','preparing','waiting'].includes(turn.state));}

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
  async send(target:SidebarTarget,text:string,commandId:string,messageId:string){
    if(target.kind==='subagent')throw Error('Subagent threads are read-only. Continue in the parent thread.');
    if(!text.trim()||text.length>120_000)throw Error('Enter a message of at most 120,000 characters.');
    return this.use(target,async access=>{
      const {thread}=await this.read(access,target);
      const command=existingThreadTurn(thread,target,commandId,{messageId,role:'user',text,attachments:[]});
      await access.api('/api/orchestration/dispatch',command);
    });
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
