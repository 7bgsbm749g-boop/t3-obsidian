import {contentHash} from './completion';
import type {ResponseRecord} from './response-record';

export interface StoppedBodyReference {hash:string;length:number}
export interface ResponseStopReceipt {
  version:1;bindingId:string;commandId:string;epoch:number;revision:number;
  hostRecorded:boolean;runTerminal:boolean;finalSaved:boolean;finalWriterPending:boolean;
  stopRequestedAt?:number;
}
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export function stoppedBodyPath(directory:string,id:string,reference:StoppedBodyReference){
  if(!uuid.test(id)||!validStoppedBodyReference(reference))throw Error('Invalid frozen response reference.');
  return `${directory}/stopped-bodies/${id}/${reference.hash}.txt`;
}
export function validStoppedBodyReference(value:unknown):value is StoppedBodyReference {
  const ref=value as StoppedBodyReference|undefined;
  return !!ref&&/^[a-f0-9]{64}$/.test(ref.hash)&&Number.isSafeInteger(ref.length)&&ref.length>=0&&ref.length<=2_000_000;
}
export function stoppedBodyReference(body:string):StoppedBodyReference{return {hash:contentHash(body),length:body.length};}
export function responseRunTerminal(record:ResponseRecord){
  // A permanent final grant contains the exact completed turn even if an
  // older host checkpoint still describes its previous running state.
  if(record.finalWriter)return ['complete','interrupted'].includes(record.finalWriter.phase);
  const state=record.state,turn=state?.bindingCheckpoint?.turns?.[state.turnId??''];
  return !!state&&(['complete','interrupted'].includes(state.status)||!!state.finishedAt&&['complete','interrupted'].includes(state.finalPhase??'')||!!turn&&['completed','interrupted','cancelled','error'].includes(turn.state));
}
export function responseStopReceipt(record:ResponseRecord,commandId=''):ResponseStopReceipt {
  const finalSaved=record.state?.finalSaved===true&&record.state?.cleanupComplete===true;
  return {version:1,bindingId:record.request.id,commandId,epoch:record.epoch,revision:record.revision,hostRecorded:!!record.stopRequestedAt||record.responseRemovedAt!==undefined,runTerminal:responseRunTerminal(record),finalSaved,finalWriterPending:!!record.finalWriter&&!finalSaved,...(record.stopRequestedAt?{stopRequestedAt:record.stopRequestedAt}:{})};
}
export function validResponseStopReceipt(receipt:unknown,id:string,commandId:string):receipt is ResponseStopReceipt {
  const value=receipt as ResponseStopReceipt|undefined;
  return !!value&&value.version===1&&value.bindingId===id&&value.commandId===commandId&&Number.isSafeInteger(value.epoch)&&Number.isSafeInteger(value.revision)&&['hostRecorded','runTerminal','finalSaved','finalWriterPending'].every(key=>typeof (value as unknown as Record<string,unknown>)[key]==='boolean');
}
