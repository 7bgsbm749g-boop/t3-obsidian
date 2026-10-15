import type {ResponseRecord} from './response-record';
import {legacyQuestionReply} from './response-model';
import {responseRunTerminal} from './response-stop-receipt';

/** A read-only projection of response bindings, never a second run lifecycle. */
export interface ExplorerResponse {
  id:string;notePath:string;epoch:number;revision:number;
  active:boolean;input:boolean;complete:boolean;deleted?:boolean;sourceNotePath?:string;
}
export const explorerResponsePath=(directory:string)=>`${directory}/explorer-responses.json`;
export function leaseExplorerResponse(record:ResponseRecord):ExplorerResponse {
  const state=record.state;
  const input=!state?.userStopped&&(legacyQuestionReply(state)||!!state?.questionFollows?.some(q=>!q.answered&&!q.dismissed));
  return {id:record.request.id,notePath:state?.notePath??record.request.notePath,epoch:record.epoch,revision:record.revision,
    ...(record.responseRemovedAt!==undefined?{deleted:true}:{}),
    active:record.responseRemovedAt===undefined&&!record.stopRequestedAt&&!state?.userStopped&&(!responseRunTerminal(record)||!!state?.pendingMessageId)&&(!state?.finishedAt||!!state.pendingMessageId)&&(!state||state.status==='running'||state.status==='waiting'&&!input||!!state.pendingMessageId),
    input:record.responseRemovedAt===undefined&&input,complete:record.responseRemovedAt===undefined&&state?.status==='complete'&&!input&&!state.pendingMessageId&&!state.userStopped};
}
export function loadExplorerResponses(value:unknown):ExplorerResponse[] {
  if(!Array.isArray(value))return [];
  return value.filter((r):r is ExplorerResponse=>!!r&&typeof r.id==='string'&&typeof r.notePath==='string'&&Number.isSafeInteger(r.epoch)&&Number.isSafeInteger(r.revision)&&['active','input','complete'].every(k=>typeof r[k]==='boolean')&&(r.deleted===undefined||typeof r.deleted==='boolean'));
}
export interface NoteIndicator {active:number;input:number;complete:number;total:number}
export function noteIndicators(responses:ExplorerResponse[],exists:(path:string)=>boolean):Map<string,NoteIndicator> {
  const notes=new Map<string,NoteIndicator>();
  for(const response of responses){
    if(response.deleted||!exists(response.notePath))continue;
    const note=notes.get(response.notePath)??{active:0,input:0,complete:0,total:0};
    note.active+=Number(response.active);note.input+=Number(response.input);note.complete+=Number(response.complete);note.total++;
    notes.set(response.notePath,note);
  }
  return notes;
}
export function relocateExplorerResponses(responses:ExplorerResponse[],before:string,after?:string):ExplorerResponse[] {
  return responses.map(r=>r.notePath===before||r.notePath.startsWith(before+'/')?{...r,...(after===undefined?{deleted:true}:{sourceNotePath:r.sourceNotePath??r.notePath,notePath:after+r.notePath.slice(before.length)})}:r);
}
