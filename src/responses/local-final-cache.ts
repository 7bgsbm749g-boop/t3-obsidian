import {isRecord} from '../shared/values';
import {contentHash} from './completion';
import type {ResponseRequest} from './response-model';
import type {DirectInlineUpdate} from './direct-inline-preview';
import {questionTargets} from '../interaction/questions';
// Device-local recovery data. This is no writer grant or Sync receipt.
export function localFinalIdentity(request:ResponseRequest){return contentHash(JSON.stringify([request.id,request.vaultId,request.threadId,request.projectId,request.threadEnvironmentId,request.messageId,request.localMessageId,request.createdAt,request.initialInput,request.intermediateMode,request.finalAnswerFormat,request.localSteering?.map(({before,...input})=>input)]));}
export function retainedLocalFinal(update:DirectInlineUpdate){return {version:1,identity:localFinalIdentity(update.request),bodyHash:contentHash(update.body),update};}
export function restoredLocalFinal(value:unknown,request:ResponseRequest):DirectInlineUpdate|undefined{
  if(!isRecord(value)||!isRecord(value.update))return;
  const update=value.update;
  if(value?.version!==1||value.identity!==localFinalIdentity(request)||update?.completionVerified!==true||(typeof update.phase!=='string'||!['complete','interrupted'].includes(update.phase))||typeof update.body!=='string'||typeof update.turnId!=='string'||value.bodyHash!==contentHash(update.body))return;
  return {...update,questionsPending:update.questionsPending??questionTargets(update.body).length>0} as unknown as DirectInlineUpdate;
}
