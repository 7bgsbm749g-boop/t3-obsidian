import {isRecord} from '../shared/values';
import {contentHash} from './completion';
import {inlineTurnMessages,turnPhase,type InlineThreadState} from '../conversations/inline-thread';
import type {ThreadAccess} from '../conversations/thread-stream';
import {logEvent} from '../app/diagnostics';
import {delegatedWork} from '../conversations/inline-delegation';

/** Completion is an exact persisted run, not a ready connection or replay end. */
interface CompletionOptions {historicalImport?:boolean}
export function finalResponseKey(state:InlineThreadState,turnId:string,options:CompletionOptions={}):string|undefined {
  const delegated=delegatedWork(state,[turnId]);
  if(delegated.waiting||delegated.running||delegated.handoffFailed||delegated.turnId!==turnId)return;
  const turn=state.turns?.[turnId]??(state.latestTurn?.turnId===turnId?state.latestTurn:undefined);
  if(turn?.state!=='completed')return;
  const message=inlineTurnMessages(state,turnId).at(-1);
  if(!message||message.streaming||!message.itemId)return;
  let completion:unknown=turn.completedAt;
  if(!completion){
    if(!options.historicalImport||state.historyComplete!==true||state.latestTurn?.turnId===turnId||state.session?.activeTurnId===turnId)return;
    const latest=state.latestTurn,root=state.messages.find(m=>m.id===turn.messageId&&m.role==='user'&&m.turnId===turnId);
    const boundary=latest&&state.messages.find(m=>m.role==='user'&&m.turnId===latest.turnId&&m.createdAt===latest.requestedAt);
    if(!root||!boundary||!message.updatedAt||!Number.isFinite(Date.parse(message.updatedAt)))return;
    // Re-prove the historical boundary without the inferred terminal row.
    // This supplies no invented completion timestamp and never applies to a
    // live response. The exact final item still needs an authoritative read.
    const turns={...state.turns};delete turns[turnId];
    if(turnPhase({...state,turns},turnId)!=='complete')return;
    completion={historyBoundary:[boundary.id,boundary.turnId,boundary.createdAt],rootId:root.id};
  }
  return contentHash(JSON.stringify([turnId,completion,message.id,message.itemId,message.updatedAt,message.text]));
}

/** Read the authoritative final item once. Streamed text is a preview, so a
 * correction replaces it without requiring a second matching download. */
export async function checkFinalResponse(access:ThreadAccess,threadId:string,state:InlineThreadState,turnId:string,options:CompletionOptions={}):Promise<{state:InlineThreadState;verified:boolean}> {
  if(!finalResponseKey(state,turnId,options))return {state,verified:false};
  const message=inlineTurnMessages(state,turnId).at(-1)!,started=Date.now();
  const item=await access.api('/api/orchestration/turn-item',{threadId,itemId:message.itemId,...(message.updatedAt?{revision:message.updatedAt}:{})});
  if(!isRecord(item)||item.updatedAt!==undefined&&typeof item.updatedAt!=='string'||item.id!==message.itemId||item.threadId!==threadId||item.runId!==turnId||item.messageId!==message.id||item.type!=='assistant_message'||item.streaming!==false||item.status!=='completed'||typeof item.text!=='string')throw Error('T3 did not return the final reply for this response.');
  if(message.updatedAt&&(!item.updatedAt||item.updatedAt<message.updatedAt))throw Error('T3 returned an older final reply.');
  logEvent('response.lifecycle.verification',{threadId,turnId,messageId:message.id,itemId:message.itemId,elapsedMs:Date.now()-started,characters:item.text.length,corrected:item.text!==message.text});
  const corrected={...message,text:item.text,updatedAt:typeof item.updatedAt==='string'?item.updatedAt:undefined,streaming:false};
  return {state:{...state,messages:state.messages.map(m=>m.id===message.id?corrected:m)},verified:true};
}
