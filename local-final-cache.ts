import {contentHash} from './completion';
import type {ResponseRequest} from './response-model';
import type {DirectInlineUpdate} from './direct-inline-preview';
// Device-local recovery data. This is no writer grant or Sync receipt.
export function localFinalIdentity(request:ResponseRequest){return contentHash(JSON.stringify([request.id,request.vaultId,request.threadId,request.projectId,request.threadEnvironmentId,request.messageId,request.localMessageId,request.createdAt,request.initialInput,request.intermediateMode,request.finalAnswerFormat,request.localSteering?.map(({before,...input})=>input)]));}
export function retainedLocalFinal(update:DirectInlineUpdate){return {version:1,identity:localFinalIdentity(update.request),bodyHash:contentHash(update.body),update};}
export function restoredLocalFinal(value:any,request:ResponseRequest):DirectInlineUpdate|undefined{
  const update=value?.update;
  if(value?.version!==1||value.identity!==localFinalIdentity(request)||update?.completionVerified!==true||!['complete','interrupted'].includes(update.phase)||typeof update.body!=='string'||typeof update.turnId!=='string'||value.bodyHash!==contentHash(update.body))return;
  return update;
}
