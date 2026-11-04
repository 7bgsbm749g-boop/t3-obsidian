import type {TurnStartCommand} from '../connection/send-contracts';
import {isRecord} from '../shared/values';

export interface ThreadChoice {id:string;projectId:string;title:string;updatedAt:string;status:'Active'|'Idle'}
export interface ThreadSummary {
  id:string;projectId:string;title?:string;updatedAt?:string;archivedAt?:string|null;deletedAt?:string|null;
  runtimeMode?:string;interactionMode?:string;hasPendingApprovals?:boolean;hasPendingUserInput?:boolean;
  session?:{activeTurnId?:string|null;status?:string;runtimeMode?:string};
  latestTurn?:{turnId?:string;state?:string};
}
function threadSummary(value:unknown):Partial<ThreadSummary>{
  // Read-only state checks accept absent metadata. Mutation callers verify the
  // exact thread/project identity before they use this contract.
  return isRecord(value)?value:{};
}
export function projectThreads(value:unknown,projectId:string):ThreadChoice[]{
  if(!isRecord(value)||!Array.isArray(value.threads))throw Error('T3 returned an invalid thread list.');
  const candidates:unknown[]=value.threads;
  return candidates.map(threadSummary).filter((thread):thread is ThreadSummary&{title:string}=>thread.projectId===projectId&&!thread.archivedAt&&!thread.deletedAt&&typeof thread.id==='string'&&typeof thread.title==='string')
    .map(thread=>({...thread,updatedAt:typeof thread.updatedAt==='string'?thread.updatedAt:'',status:threadIsActive(thread)?'Active' as const:'Idle' as const}))
    .sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
}
export function threadIsActive(value:unknown):boolean {
  const thread=threadSummary(value);
  return Boolean(thread.session?.activeTurnId)
    || ['running','starting'].includes(thread.session?.status??'')
    || ['running','starting'].includes(thread.latestTurn?.state??'')
    || thread.hasPendingApprovals===true||thread.hasPendingUserInput===true;
}

/** Only exact retained run bindings permit extending the selected response. */
export function responseOwnsActiveTurn(value:unknown,response:{turnId?:string;turnIds?:string[]}|undefined):boolean{
  const thread=threadSummary(value);
  const active=thread.session?.activeTurnId??(['running','starting'].includes(thread.latestTurn?.state??'')?thread.latestTurn?.turnId:undefined);
  return typeof active==='string'&&!!response&&(response.turnId===active||response.turnIds?.includes(active)===true);
}

/** Existing conversations keep their model, permissions, and interaction mode. */
export function existingThreadTurn<M>(value:unknown,target:{threadId:string;projectId:string},commandId:string,message:M):TurnStartCommand<M>{
  const thread=threadSummary(value);
  if(thread.id!==target.threadId||thread.projectId!==target.projectId||thread.archivedAt||thread.deletedAt)throw Error('The selected thread is no longer available in the linked project. Choose a thread again.');
  if(thread.hasPendingApprovals||thread.hasPendingUserInput)throw Error('This thread is waiting for approval or input. Resolve it in T3 before sending the note.');
  return {type:'thread.turn.start',commandId,threadId:thread.id,message,runtimeMode:thread.session?.runtimeMode??thread.runtimeMode??'approval-required',interactionMode:thread.interactionMode??'default',createdAt:new Date().toISOString()};
}
