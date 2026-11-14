import {isRecord} from '../shared/values';
import type {InlineMessage,InlineSubagent,InlineThreadState,InlineTurn} from '../conversations/inline-thread';
import type {ModelSelection} from '../conversations/model-defaults';

/** Server Orchestrator v2 values. Provider IDs never substitute for app run IDs. */
export interface WireRun {
  id:string;status:string;ordinal:number;userMessageId?:string;requestedAt?:string;
  startedAt?:string|null;completedAt?:string|null;delegatedCompletion?:InlineTurn['delegatedCompletion'];
}
export interface WireRuntimeRequest {
  id:string;kind:string;status:string;responseCapability?:{type:string};
  decision?:unknown;answers?:unknown;resolvedAt?:string;
}
export interface WireTurnItem {
  id:string;type:string;status:string;ordinal:number;updatedAt?:string;runId?:string|null;nodeId?:string;
  startedAt?:string;completedAt?:string;title?:string;summary?:string;text?:string;streaming?:boolean;
  messageId?:string;requestId?:string;toolName?:string;outputOmitted?:boolean;
  toolSource?:unknown;toolIcon?:unknown;
  beforeTokenCount?:number;afterTokenCount?:number;
  markdown?:string;planId?:string;
  input?:unknown;output?:unknown;failure?:{message?:string};steps?:unknown;
  responseMode?:string;questions?:unknown;requestKind?:string;prompt?:string;options?:unknown;appName?:string;
  questionAnswer?:{answers?:unknown};fileName?:string;viewedImagePath?:string;exitCode?:number;
  context?:unknown;attachments?:unknown[];createdBy?:string;creationSource?:string;
  senderThreadId?:string|null;delegatedCompletion?:InlineMessage['delegatedCompletion'];
}
export interface WireMessage extends Omit<InlineMessage,'turnId'> {runId:string|null;threadId?:string;nodeId?:string;attachments?:unknown[]}
export interface WireThread {
  id:string;projectId:string;title?:string;status?:string;deletedAt?:string|null;archivedAt?:string|null;
  runtimeMode?:string;lastError?:string;historyOrigin?:string;protocolVersion?:2;
  activeRunId?:string|null;activityRunStatus?:string;latestRunId?:string|null;
  latestRunRequestedAt?:string;latestRunCompletedAt?:string;pendingRuntimeRequest?:WireRuntimeRequest;
  pendingBackgroundTasks?:unknown[];session?:NormalizedThread['session'];latestTurn?:InlineTurn;hasPendingApprovals?:boolean;hasPendingUserInput?:boolean;backgroundLiveness?:boolean;settledOverride?:string;lastVisitedAt?:string;updatedAt?:string;worktreePath?:string|null;branch?:string|null;
}
export interface WireVisibleItem {sourceThreadId:string;visibility?:string;item:WireTurnItem}
export interface WireProjection {
  thread:WireThread;messages:WireMessage[];runs:WireRun[];turnItems?:WireTurnItem[];
  visibleTurnItems?:WireVisibleItem[];runtimeRequests?:WireRuntimeRequest[];subagents?:InlineSubagent[];
}
export interface WireSnapshot {
  projection:WireProjection;snapshotSequence:number;hasMoreHistory?:boolean;historyCursor?:string|null;turnItemsOmitLocalVisible?:boolean;
}
export interface WireProject {repositoryIdentity?:import('../app/bridge').Project['repositoryIdentity'];id:string;title:string;workspaceRoot:string;deletedAt?:string|null;defaultModelSelection?:ModelSelection|null;defaultThreadEnvMode?:'local'|'worktree'|null}
export interface WireShell {projects:WireProject[];threads:WireThread[];archivedThreads?:WireThread[]}
export interface WireHistory {items:WireVisibleItem[];hasMoreHistory:boolean;nextCursor?:string|null}
export interface NormalizedThread extends InlineThreadState {
  id:string;projectId:string;deletedAt?:string|null;archivedAt?:string|null;
  hasPendingApprovals?:boolean;hasPendingUserInput?:boolean;backgroundLiveness?:boolean;
  runtimeMode?:string;settledOverride?:string;
}
export interface ThreadSnapshot {snapshotSequence?:number;page?:{hasMore:boolean};thread:NormalizedThread}

/** Detail reads must establish thread identity before display or dispatch. */
export function readThreadSnapshot(value:unknown):ThreadSnapshot{
  if(!isRecord(value)||!isRecord(value.thread)||typeof value.thread.id!=='string'||typeof value.thread.projectId!=='string'||!Array.isArray(value.thread.messages))throw Error('T3 returned an invalid thread snapshot.');
  return value as unknown as ThreadSnapshot;
}

export type V2ControlEvent={type:'v2.subagent.updated';payload:import('../conversations/inline-thread').InlineSubagent}|{type:'v2.runtime-request.updated';payload:WireRuntimeRequest}|{type:'v2.turn-item.updated';payload:WireTurnItem};
