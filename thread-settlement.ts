import type {Connection} from './bridge';
import type {InlineHostTarget} from './hosted-inline';

/** One confirmed Obsidian turn, stored on the sending device until it settles or advances. */
export interface ThreadSettlementJob {
  requestId:string;messageId:string;threadId:string;projectId:string;connection:Connection;
  inlineLocal?:true;inlineNotePath?:string;
  inlineBindings?:Array<{id:string;host:InlineHostTarget;notePath?:string}>;
  inlineJobId?:string;inlineHost?:InlineHostTarget;inlineVersion?:1|2|3;
}

export function settlementState(thread:any,job:ThreadSettlementJob):'wait'|'settle'|'discard' {
  if(!thread||thread.id!==job.threadId||thread.projectId!==job.projectId)return 'wait';
  if(thread.archivedAt||thread.deletedAt||thread.settledOverride==='settled')return 'discard';
  const turn=thread.latestTurn;
  const message=thread.messages?.find((item:any)=>item.id===job.messageId&&item.role==='user');
  if(!message||!turn?.requestedAt){
    const latestUser=thread.messages?.filter((item:any)=>item.role==='user').at(-1);
    return latestUser?.id!==job.messageId&&latestUser?.createdAt===turn?.requestedAt?'discard':'wait';
  }
  // T3 gives the user message and its provider turn the same requestedAt.
  // A later turn must never be settled by an older Obsidian completion job.
  if(turn.requestedAt!==message.createdAt)return 'discard';
  if(turn.state==='error'||turn.state==='interrupted')return 'discard';
  if(turn.state!=='completed'||!['ready','stopped'].includes(thread.session?.status)||thread.session?.activeTurnId)return 'wait';
  if(thread.hasPendingApprovals||thread.hasPendingUserInput||thread.backgroundLiveness)return 'wait';
  if(!turn.assistantMessageId||!thread.messages.some((item:any)=>item.id===turn.assistantMessageId&&item.role==='assistant'&&item.streaming===false))return 'wait';
  return 'settle';
}
