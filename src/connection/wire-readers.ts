import {isRecord} from '../shared/values';
import {type WireSnapshot,type WireShell,type WireHistory,type WireThread} from './wire-types';

/** Preserve the legacy normalized shape used by saved displays and adapters;
 * live v2 projections must have their canonical identities and collections. */
export function readRawSnapshot(value:unknown):WireSnapshot|MetadataSnapshot{
  if(!isRecord(value))throw Error('T3 returned an invalid thread snapshot.');
  if(!value.projection)return readMetadataSnapshot(value);
  const projection=value.projection;
  if(!isRecord(projection)||!isRecord(projection.thread)||typeof projection.thread.id!=='string'||typeof projection.thread.projectId!=='string'||!Array.isArray(projection.messages)||!Array.isArray(projection.runs))throw Error('T3 returned an invalid v2 thread projection.');
  return value as unknown as WireSnapshot;
}

export function readWireShell(value:unknown):WireShell{
  if(!isRecord(value)||!Array.isArray(value.projects)||!Array.isArray(value.threads))throw Error('T3 returned an invalid project catalog.');
  return value as unknown as WireShell;
}

export function readThreadList(value:unknown):WireThread[]{
  if(!isRecord(value)||!Array.isArray(value.threads))throw Error('T3 returned an invalid thread catalog.');
  const threads:unknown[]=value.threads;
  if(threads.some(thread=>!isRecord(thread)||typeof thread.id!=='string'))throw Error('T3 returned an invalid thread identity.');
  return threads as WireThread[];
}

export function readHistory(value:unknown):WireHistory{
  if(!isRecord(value)||!Array.isArray(value.items)||value.nextCursor!=null&&typeof value.nextCursor!=='string')throw Error('T3 returned an invalid history page.');
  return value as unknown as WireHistory;
}

export interface ControlsSnapshot {
  thread:Pick<import('./wire-types').NormalizedThread,'id'|'activities'|'session'|'latestTurn'|'v2Requests'>;
  snapshotSequence?:number;
}
export function readControlsSnapshot(value:unknown):ControlsSnapshot{
  if(!isRecord(value)||!isRecord(value.thread)||typeof value.thread.id!=='string'||!Array.isArray(value.thread.activities))throw Error('T3 returned an invalid control snapshot.');
  return value as unknown as ControlsSnapshot;
}

/** Catalog consumers need only their own collection. Do not validate an
 * unrelated collection before reading project defaults or existing threads. */
export function readWireProjects(value:unknown):import('./wire-types').WireProject[]{
  if(!isRecord(value)||!Array.isArray(value.projects))throw Error('T3 returned an invalid project catalog.');
  return value.projects as import('./wire-types').WireProject[];
}
export type ThreadMetadata=Partial<import('./wire-types').NormalizedThread>&{id:string;projectId:string;runs?:import('./wire-types').WireRun[]};
export interface MetadataSnapshot {thread:ThreadMetadata;snapshotSequence?:number;page?:{hasMore:boolean}}
export function readMetadataSnapshot(value:unknown):MetadataSnapshot{
  if(!isRecord(value)||!isRecord(value.thread)||typeof value.thread.id!=='string'||typeof value.thread.projectId!=='string')throw Error('T3 returned an invalid thread identity.');
  return value as unknown as MetadataSnapshot;
}
