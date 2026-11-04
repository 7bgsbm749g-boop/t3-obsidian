import {isRecord} from '../shared/values';
import type {InlineActivity,InlineMessage,InlineThreadState} from '../conversations/inline-thread';
import type {WorktreeSetup} from '../projects/worktree-setup';
import type {WireRun,WireRuntimeRequest,WireTurnItem} from './wire-types';

type Payloads={
  'thread.run-updated':WireRun;
  'v2.turn-item.updated':WireTurnItem;
  'v2.runtime-request.updated':WireRuntimeRequest;
  'v2.subagent.updated':import('../conversations/inline-thread').InlineSubagent;
  'thread.metadata-updated':{title?:string};
  'thread.turn-start-requested':{messageId:string;createdAt:string};
  'thread.message-sent':Omit<Partial<InlineMessage>,'id'>&{messageId:string;role:string;text:string;replace?:boolean};
  'thread.activity-appended':{activity:InlineActivity};
  'thread.session-set':{session:NonNullable<InlineThreadState['session']>&{updatedAt?:string}};
  'thread.turn-diff-completed':NonNullable<InlineThreadState['checkpoints']>[number];
  'v2.unknown':Record<string,unknown>;
};
export type ThreadEvent={ [K in keyof Payloads]:{type:K;payload:Payloads[K];sequence:number;occurredAt?:string;aggregateId?:string} }[keyof Payloads]
  |{type:'thread.worktree-setup';payload:WorktreeSetup;aggregateId:string;sequence?:number;occurredAt?:string};
const names=new Set<string>(['thread.run-updated','v2.turn-item.updated','v2.runtime-request.updated','v2.subagent.updated','thread.metadata-updated','thread.turn-start-requested','thread.message-sent','thread.activity-appended','thread.session-set','thread.turn-diff-completed','thread.worktree-setup','v2.unknown']);
/** The versioned event envelope selects its DTO. Consumers retain their field
 * guards; an unknown event still advances the server cursor. */
export function readThreadEvent(value:unknown):ThreadEvent{
  if(!isRecord(value)||typeof value.type!=='string')throw Error('T3 returned an invalid thread event.');
  if(!names.has(value.type))return {type:'v2.unknown',payload:{},sequence:value.sequence as number};
  if(!isRecord(value.payload))throw Error('T3 returned an invalid thread event payload.');
  return value as unknown as ThreadEvent;
}
export interface InlineSnapshot {snapshotSequence?:number;page?:{hasMore:boolean};thread:Omit<InlineThreadState,'activities'>&{activities?:InlineActivity[];id?:string;projectId?:string}}
export type ThreadStreamItem={kind:'snapshot';snapshot:InlineSnapshot}|{kind:'event';event:ThreadEvent}|{kind:'synchronized'};
export function readThreadStreamItem(value:unknown):ThreadStreamItem{
  if(!isRecord(value))throw Error('T3 returned an invalid stream item.');
  if(value.kind==='synchronized')return {kind:'synchronized'};
  if(value.kind==='event')return {kind:'event',event:readThreadEvent(value.event)};
  if(value.kind==='snapshot'&&isRecord(value.snapshot)&&isRecord(value.snapshot.thread)&&Array.isArray(value.snapshot.thread.messages))return value as unknown as ThreadStreamItem;
  throw Error('T3 returned an invalid thread snapshot.');
}
