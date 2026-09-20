export interface ThreadChoice {id:string;projectId:string;title:string;updatedAt:string;status:'Active'|'Idle'}

export function projectThreads(value:any,projectId:string):ThreadChoice[]{
  if(!Array.isArray(value?.threads))throw Error('T3 returned an invalid thread list.');
  return value.threads.filter((t:any)=>t.projectId===projectId&&!t.archivedAt&&!t.deletedAt&&typeof t.id==='string'&&typeof t.title==='string')
    .sort((a:any,b:any)=>(b.updatedAt??'').localeCompare(a.updatedAt??''))
    .map((t:any)=>({...t,status:threadIsActive(t)?'Active':'Idle'}));
}

export function threadIsActive(thread:any):boolean {
  return Boolean(thread?.session?.activeTurnId)
    || ['running','starting'].includes(thread?.session?.status)
    || ['running','starting'].includes(thread?.latestTurn?.state)
    || thread?.hasPendingApprovals===true || thread?.hasPendingUserInput===true;
}

/** Existing conversations keep their model, permissions, and interaction mode. */
export function existingThreadTurn(thread:any,target:{threadId:string;projectId:string},commandId:string,message:any){
  if(!thread||thread.id!==target.threadId||thread.projectId!==target.projectId||thread.archivedAt||thread.deletedAt)throw Error('The selected thread is no longer available in the linked project. Choose a thread again.');
  if(thread.hasPendingApprovals||thread.hasPendingUserInput)throw Error('This thread is waiting for approval or input. Resolve it in T3 before sending the note.');
  return {type:'thread.turn.start',commandId,threadId:thread.id,message,
    runtimeMode:thread.session?.runtimeMode??thread.runtimeMode??'approval-required',
    interactionMode:thread.interactionMode??'default',createdAt:new Date().toISOString()};
}
