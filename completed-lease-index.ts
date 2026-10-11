import type {LeaseRecord} from './inline-lease';
import {legacyQuestionReply} from './hosted-inline';
import type {ResponseBinding} from './response-bindings';

const completedIndex=Symbol('completed response index');
type IndexedLease=LeaseRecord&{[completedIndex]:ResponseBinding};

/** Only retire bodies after the final note save and cleanup. A completed T3
 * turn, pending device save, question or migration still needs its live data. */
export function canCompactLease(record:LeaseRecord){
  const state=record.state;
  return record.responseRemovedAt!==undefined||!record.migrating&&!!state&&state.finalSaved===true&&state.cleanupComplete===true&&
    ['complete','interrupted'].includes(state.status)&&!state.pendingMessageId&&!legacyQuestionReply(state)&&
    !state.questionFollows?.some(question=>!question.answered&&!question.dismissed);
}
export function isCompletedLeaseIndex(record:LeaseRecord):boolean{return completedIndex in record;}
export function responseBinding(record:LeaseRecord):ResponseBinding {
  const indexed=(record as IndexedLease)[completedIndex];
  if(indexed)return {...indexed,path:record.state?.notePath??record.request.notePath,messageIds:[...indexed.messageIds],turnIds:[...indexed.turnIds]};
  return {id:record.request.id,path:record.state?.notePath??record.request.notePath,
    messageIds:[record.request.messageId,...[record.state?.messageId,record.state?.pendingMessageId].filter((value):value is string=>!!value),...record.state?.steering?.map(input=>input.messageId)??[],...record.state?.questionFollows?.flatMap(question=>[`async-answer:${question.requestId}`,...(question.input?[question.input.messageId]:[])])??[]],
    turnIds:[...record.state?.turnIds??[],...(record.state?.turnId?[record.state.turnId]:[]),...record.state?.questionFollows?.flatMap(question=>question.replyTurnId?[question.replyTurnId]:[])??[]]};
}

/** Memory-only routing/delivery projection. Authority mutations and recovery
 * always read the complete durable JSON; this projection is never persisted.
 * A symbol survives local spreads but is excluded from transport JSON. */
export function retainedLease(record:LeaseRecord):LeaseRecord {
  if(isCompletedLeaseIndex(record)||!canCompactLease(record))return record;
  const {request:r,state:s}=record;
  const request={version:r.version,id:r.id,vaultId:r.vaultId,host:{...r.host},notePath:r.notePath,threadId:r.threadId,messageId:r.messageId,
    projectId:r.projectId,threadEnvironmentId:r.threadEnvironmentId,initialHash:r.initialHash,createdAt:r.createdAt,
    initialOwner:r.initialOwner,independent:r.independent,nativeProjection:r.nativeProjection,deviceCompletion:r.deviceCompletion?{...r.deviceCompletion}:undefined};
  const state=s?{requestHash:s.requestHash,accepted:s.accepted,notePath:s.notePath,status:s.status,hashes:[],updatedAt:s.updatedAt,
    messageId:s.messageId,turnId:s.turnId,turnIds:s.turnIds?[...s.turnIds]:undefined,finalSaved:s.finalSaved,cleanupComplete:s.cleanupComplete,
    finalPhase:s.finalPhase,finishedAt:s.finishedAt,finalDocumentHash:s.finalDocumentHash,
    delivery:s.delivery?{...s.delivery,observedBy:[...s.delivery.observedBy]}:undefined}:undefined;
  return {[completedIndex]:responseBinding(record),request,state,owner:record.owner,epoch:record.epoch,revision:record.revision,
    expiresAt:record.expiresAt,coordinated:record.coordinated,migrating:record.migrating,responseRemovedAt:record.responseRemovedAt,
    stopRequestedAt:record.stopRequestedAt,discardResponse:record.discardResponse} as IndexedLease;
}
