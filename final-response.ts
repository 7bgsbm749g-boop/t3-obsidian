import {contentHash} from './completion';
import {inlineTurnMessages,type InlineThreadState} from './inline-thread';
import type {ThreadAccess} from './thread-stream';
import {delegatedWork} from './inline-delegation';

/** Completion is an exact persisted run, not a ready connection or replay end. */
export function finalResponseKey(state:InlineThreadState,turnId:string):string|undefined {
  const delegated=delegatedWork(state,[turnId]);
  if(delegated.waiting||delegated.running||delegated.turnId!==turnId)return;
  const turn=state.turns?.[turnId]??(state.latestTurn?.turnId===turnId?state.latestTurn:undefined);
  if(turn?.state!=='completed'||!turn.completedAt)return;
  const message=inlineTurnMessages(state,turnId).at(-1);
  if(!message||message.streaming||!message.itemId)return;
  return contentHash(JSON.stringify([turnId,turn.completedAt,message.id,message.itemId,message.updatedAt,message.text]));
}

/** Read the authoritative final item once. Streamed text is a preview, so a
 * correction replaces it without requiring a second matching download. */
export async function checkFinalResponse(access:ThreadAccess,threadId:string,state:InlineThreadState,turnId:string):Promise<{state:InlineThreadState;verified:boolean}> {
  if(!finalResponseKey(state,turnId))return {state,verified:false};
  const message=inlineTurnMessages(state,turnId).at(-1)!;
  const item=await access.api('/api/orchestration/turn-item',{threadId,itemId:message.itemId,...(message.updatedAt?{revision:message.updatedAt}:{})});
  if(item?.id!==message.itemId||item.threadId!==threadId||item.runId!==turnId||item.messageId!==message.id||item.type!=='assistant_message'||item.streaming!==false||item.status!=='completed'||typeof item.text!=='string')throw Error('T3 did not return the final reply for this response.');
  if(message.updatedAt&&(!item.updatedAt||item.updatedAt<message.updatedAt))throw Error('T3 returned an older final reply.');
  const corrected={...message,text:item.text,updatedAt:item.updatedAt,streaming:false};
  return {state:{...state,messages:state.messages.map(m=>m.id===message.id?corrected:m)},verified:true};
}
