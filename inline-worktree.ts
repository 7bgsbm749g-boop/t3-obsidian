import {contentHash} from './completion';
import type {InlineThreadState} from './inline-thread';

/** The installed T3 protocol exposes the canonical handoff tool and its
 * machine-created continuation message. Keep only their compact identities;
 * never checkpoint the (potentially large) continuation instructions. */
export interface InlineWorktreeHandoff {
  id:string;sourceTurnId:string;promptHash:string;startedAt:string;completedAt?:string;
  status:'pending'|'scheduled'|'interrupted'|'failed'|'skipped';messageId?:string;turnId?:string;
}
const machineMessage=/^message:mcp:[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}:worktree-continuation:[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const handoffTool=/^(?:t3-code\.|mcp__t3[_-]code__)?t3_worktree_handoff$/;
const date=(value:unknown):value is string=>typeof value==='string'&&Number.isFinite(Date.parse(value));
function object(value:any):any {if(typeof value==='string')try{return JSON.parse(value);}catch{return undefined;}return value;}

export function worktreeHandoff(item:any):InlineWorktreeHandoff|undefined {
  if(item?.type!=='dynamic_tool'||!handoffTool.test(item.toolName??'')||typeof item.id!=='string'||typeof item.runId!=='string'||!date(item.startedAt))return;
  const input=object(item.input),prompt=input?.continuationPrompt;
  if(typeof prompt!=='string'||!prompt.trim())return;
  const raw=object(item.output),output=Array.isArray(raw?.content)&&raw.content.length===1&&raw.content[0]?.type==='text'?object(raw.content[0].text):raw,continuation=output?.continuation;
  const successful=item.status==='completed'&&typeof output?.worktreePath==='string'&&output.branch===input.branch;
  const completedAt=date(item.completedAt)?item.completedAt:item.status==='completed'&&date(item.updatedAt)?item.updatedAt:undefined;
  const status=successful&&completedAt&&continuation?.status==='scheduled'?'scheduled':successful&&continuation?.status==='skipped'?'skipped':
    ['failed','cancelled'].includes(item.status)||continuation?.status==='failed'?'failed':item.status==='interrupted'?'interrupted':'pending';
  return {id:item.id,sourceTurnId:item.runId,promptHash:contentHash(prompt),startedAt:item.startedAt,
    ...(completedAt?{completedAt}:{}),status};
}

/** Match all independent evidence, not a thread's newest run or message text
 * alone. The namespace and attribution are supplied by T3, not prompt text.
 * Multiple matching candidates deliberately remain unbound. */
export function resolveWorktreeHandoffs(state:InlineThreadState):InlineThreadState {
  if(!Object.keys(state.worktreeHandoffs??{}).length)return state;
  const handoffs={...state.worktreeHandoffs};
  for(const [id,handoff] of Object.entries(handoffs)){
    if(handoff.status!=='scheduled'&&handoff.status!=='interrupted')continue;
    const source=state.turns?.[handoff.sourceTurnId];
    // Moving the workspace can detach the provider before its tool result is
    // saved. In that case T3's exact machine message and immediate next run
    // must prove dispatch inside the interrupted source's lifecycle. Message
    // projection can finish after detachment, so use the run's request time.
    const interrupted=handoff.status==='interrupted';
    if(interrupted&&(source?.state!=='interrupted'||!Number.isInteger(source.ordinal)||!date(source.completedAt)))continue;
    if(handoff.messageId){
      const run=Object.values(state.turns??{}).find(turn=>turn.messageId===handoff.messageId);
      if(run&&run.turnId!==handoff.sourceTurnId)handoffs[id]={...handoff,turnId:run.turnId};
      continue;
    }
    const candidates=state.messages.filter(message=>message.role==='user'&&message.createdBy==='agent'&&message.creationSource==='mcp'&&machineMessage.test(message.id)&&
      date(message.createdAt)&&Date.parse(message.createdAt)>=Date.parse(handoff.startedAt)&&
      (interrupted||!handoff.completedAt||Date.parse(message.createdAt)<=Date.parse(handoff.completedAt))&&
      message.turnId!==handoff.sourceTurnId&&contentHash(message.text)===handoff.promptHash).filter(message=>{
        if(!interrupted)return true;
        const run=Object.values(state.turns??{}).find(turn=>turn.messageId===message.id);
        return run&&run.turnId===message.turnId&&run.ordinal===source!.ordinal!+1&&date(run.requestedAt)&&
          Date.parse(run.requestedAt)>=Date.parse(handoff.startedAt)&&Date.parse(run.requestedAt)<=Date.parse(source!.completedAt!)&&
          !Object.values(handoffs).some(other=>other.id!==id&&other.sourceTurnId===handoff.sourceTurnId&&other.startedAt>handoff.startedAt&&Date.parse(other.startedAt)<=Date.parse(run.requestedAt!));
      });
    if(candidates.length!==1)continue;
    const message=candidates[0],turnId=message.turnId??Object.values(state.turns??{}).find(turn=>turn.messageId===message.id)?.turnId;
    handoffs[id]={...handoff,status:'scheduled',messageId:message.id,...(turnId?{turnId}:{})};
  }
  return {...state,worktreeHandoffs:handoffs};
}

export function mergeWorktreeHandoffs(...sources:(Record<string,InlineWorktreeHandoff>|undefined)[]){
  const result:Record<string,InlineWorktreeHandoff>={};
  for(const source of sources)for(const [id,next] of Object.entries(source??{})){
    const old=result[id];
    // Bounded snapshots can omit tool output. Such a placeholder must not
    // downgrade a verified scheduled/failed result or discard resolved IDs.
    result[id]={...old,...next,...(old&&(next.status==='pending'&&old.status!=='pending'||next.status==='interrupted'&&old.status==='scheduled'&&old.messageId)?{status:old.status}:{}),
      ...(old?.messageId&&!next.messageId?{messageId:old.messageId}:{}),...(old?.turnId&&!next.turnId?{turnId:old.turnId}:{})};
  }
  return result;
}

export function worktreeWork(state:InlineThreadState,tracked:string[]){
  const latest=new Map<string,InlineWorktreeHandoff>();
  for(const item of Object.values(state.worktreeHandoffs??{}).filter(item=>tracked.includes(item.sourceTurnId))){
    const old=latest.get(item.sourceTurnId);if(!old||item.startedAt>old.startedAt)latest.set(item.sourceTurnId,item);
  }
  const handoffs=[...latest.values()];
  const pending=handoffs.filter(item=>item.status==='pending'||item.status==='scheduled'&&(!item.turnId||!state.turns?.[item.turnId]||state.turns[item.turnId].state==='queued'));
  return {waiting:pending.length>0,failed:handoffs.some(item=>['failed','interrupted'].includes(item.status)&&state.turns?.[item.sourceTurnId]?.state==='interrupted'),
    messageIds:pending.flatMap(item=>item.messageId?[item.messageId]:[])};
}
