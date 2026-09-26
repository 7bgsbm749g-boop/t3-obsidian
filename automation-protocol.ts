import {sha1} from '@noble/hashes/sha1';
import {sha256} from '@noble/hashes/sha256';
import {Buffer} from 'buffer';

export const AUTOMATION_FOLDER='.obsidian/t3-code/automation';
export const PROTOCOL_VERSION=1;
export type Attribution='plugin-established'|'reported'|'inferred'|'unknown';
export type ObservationSource='editor'|'vault.create'|'vault.modify'|'vault.rename'|'vault.delete'|'metadata.changed'|'metadata.deleted'|'reconciliation'|'plugin.command';
export type EventType='note.created'|'note.changed'|'note.renamed'|'note.deleted'|'note.reconciled'|'workflow.requested'|'workflow.started'|'workflow.completed'|'workflow.failed'|'note.changeApplied';
export type Disposition='accepted'|'aliased'|'superseded'|'quarantined';

export interface WriterIdentity {deviceId:string;streamId:string;sequence:number;previousRecordHash:string|null}
export interface RecordEnvelope<T extends string,P> {schemaVersion:1;recordId:string;recordType:T;vaultId:string;writer:WriterIdentity;recordedAt:string;payload:P;payloadHash:string}
export interface NoteRef {noteId:string;incarnationId:string;pathBefore:string|null;pathAfter:string|null}
export interface RevisionRef {id:string;parentIds:string[];beforeHash:string|null;afterHash:string|null;hashProfile:'utf8-exact-v1'}
export interface NoteTextChange {profile:'line-splice-v1';beforeKnown:boolean;afterKnown:boolean;startLine:number;removedLines:string[];addedLines:string[];contextBefore:string[];contextAfter:string[]}
export interface ObservationPayload {
  observationId:string;source:ObservationSource;note:NoteRef;revisionContext:RevisionRef;
  facts?:Record<string,unknown>;contentChange?:NoteTextChange|null;provenance:{attribution:Attribution;causedByOperationId:string|null};historyComplete:boolean;
}
export interface CoordinatorRef {destinationId:string;assignmentId:string;epoch:number;sequence:number}
export interface NormalizedEventPayload {
  eventId:string;type:EventType;note:NoteRef;revision:RevisionRef;facts:Record<string,unknown>;
  evidence:{observationIds:string[];captureProfile:string;beforeKnown:boolean;historyComplete:boolean};
  provenance:{attribution:Attribution;causedByOperationId:string|null};
  causality:{rootEventId:string;workflowRunId:string|null};content:{beforeBlob:string|null;afterBlob:string|null;change?:NoteTextChange|null};coordinator:CoordinatorRef;
}
export interface ReceiptPayload {recordId:string;payloadHash:string;disposition:Disposition;coordinator?:CoordinatorRef;detail?:string}
export interface ProtocolManifest {schemaVersion:1;protocol:'t3-automation-journal';vaultId:string;createdAt:string}

export function exactHash(value:string|Uint8Array):string {return `sha256:${Buffer.from(sha256(typeof value==='string'?new TextEncoder().encode(value):value)).toString('hex')}`;}
export function canonical(value:unknown):string {
  if(value===null||typeof value!=='object')return JSON.stringify(value);
  if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
  const object=value as Record<string,unknown>;return `{${Object.keys(object).sort().map(key=>`${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`;
}
export function recordHash(record:Omit<RecordEnvelope<string,unknown>,'payloadHash'>|RecordEnvelope<string,unknown>):string {
  const {payloadHash:_,...body}=record as RecordEnvelope<string,unknown>;return exactHash(canonical(body));
}
export function createRecord<T extends string,P>(input:Omit<RecordEnvelope<T,P>,'schemaVersion'|'payloadHash'>):RecordEnvelope<T,P>{
  const record={schemaVersion:PROTOCOL_VERSION,...input} as Omit<RecordEnvelope<T,P>,'payloadHash'>;
  return {...record,payloadHash:recordHash(record)};
}
export function validateRecord(value:unknown):RecordEnvelope<string,unknown>{
  if(!value||typeof value!=='object')throw Error('Protocol record must be an object.');
  const record=value as RecordEnvelope<string,unknown>;
  if(record.schemaVersion!==1||typeof record.recordId!=='string'||!record.recordId||typeof record.recordType!=='string'||!record.recordType||typeof record.vaultId!=='string'||!record.vaultId)throw Error('Invalid protocol record identity.');
  if(!record.writer||typeof record.writer.deviceId!=='string'||typeof record.writer.streamId!=='string'||!Number.isSafeInteger(record.writer.sequence)||record.writer.sequence<1)throw Error('Invalid protocol writer.');
  if(typeof record.recordedAt!=='string'||!Number.isFinite(Date.parse(record.recordedAt))||typeof record.payloadHash!=='string')throw Error('Invalid protocol record metadata.');
  const expected=recordHash(record);if(record.payloadHash!==expected)throw Error('Protocol record payload hash mismatch.');return record;
}
export function validateNoteTextChange(value:unknown):NoteTextChange {if(!value||typeof value!=='object')throw Error('Invalid note text change.');const change=value as NoteTextChange,lines=(items:unknown)=>Array.isArray(items)&&items.every(line=>typeof line==='string');if(change.profile!=='line-splice-v1'||typeof change.beforeKnown!=='boolean'||typeof change.afterKnown!=='boolean'||!Number.isSafeInteger(change.startLine)||change.startLine<1||!lines(change.removedLines)||!lines(change.addedLines)||!lines(change.contextBefore)||!lines(change.contextAfter)||change.contextBefore.length>32||change.contextAfter.length>32)throw Error('Invalid note text change.');return change;}
export function safeSegment(value:string):string {if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)||value==='.'||value==='..')throw Error('Unsafe protocol path segment.');return value;}
export function observationPath(record:RecordEnvelope<'observation',ObservationPayload>):string {return `${AUTOMATION_FOLDER}/observations/${safeSegment(record.writer.deviceId)}/${safeSegment(record.writer.streamId)}/${String(record.writer.sequence).padStart(16,'0')}-${safeSegment(record.recordId)}.json`;}
export function coordinatorRecordPath(destinationId:string,assignmentId:string,sequence:number,recordId:string):string{return `${AUTOMATION_FOLDER}/coordinators/${safeSegment(destinationId)}/${safeSegment(assignmentId)}/records/${String(sequence).padStart(16,'0')}-${safeSegment(recordId)}.json`;}

const REQUEST_NAMESPACE=Buffer.from('57a86bb874a75ae6955ad44f9e8de59a','hex');
export function deterministicUuid(parts:string[]):string {
  const bytes=Buffer.from(sha1(Buffer.concat([REQUEST_NAMESPACE,Buffer.from(parts.join('\0'),'utf8')]))).subarray(0,16);bytes[6]=(bytes[6]&15)|80;bytes[8]=(bytes[8]&63)|128;
  const h=bytes.toString('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
export function workflowRequestId(vaultId:string,destinationId:string,occurrenceId:string,workflowId:string,releaseHash:string,stepId:string,generation:number):string{
  if(!Number.isSafeInteger(generation)||generation<0)throw Error('Invalid execution generation.');return deterministicUuid([vaultId,destinationId,occurrenceId,workflowId,releaseHash,stepId,String(generation)]);
}

export interface SequenceAck {through:number;gaps:number[]}
export function advanceAcknowledgement(current:SequenceAck,received:number[]):SequenceAck{
  const all=new Set<number>([...current.gaps,...received.filter(Number.isSafeInteger).filter(n=>n>current.through)]);let through=current.through;
  while(all.delete(through+1))through++;
  return {through,gaps:[...all].filter(n=>n>through).sort((a,b)=>a-b)};
}
