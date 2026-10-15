import {commandId} from './direct';
import {turnForMessage,turnPhase,type InlineThreadState,type InlineTurn} from './inline-thread';
import {visibleInlineInput} from './input-presentation';
import type {ResponseRecord} from './response-record';
import type {ResponseState} from './response-model';

export interface ImportRecord {request:ResponseRecord['request'];state?:Pick<ResponseState,'status'|'notePath'|'finalSaved'|'messageId'|'turnId'|'turnIds'|'bindingCheckpoint'>&{steering?:Array<{messageId:string}>;questionFollows?:Array<{requestId:string;input?:{messageId:string}}>}}
/** Read-only import evidence excludes prose, save documents and steering text. */
export function compactImportRecord(record:ResponseRecord):ImportRecord {
  const state=record.state,checkpoint=state?.bindingCheckpoint;
  return {request:record.request,...(state?{state:{status:state.status,notePath:state.notePath,finalSaved:state.finalSaved,messageId:state.messageId,turnId:state.turnId,turnIds:state.turnIds,
    ...(checkpoint?{bindingCheckpoint:{protocolVersion:checkpoint.protocolVersion,sequence:checkpoint.sequence,bindings:checkpoint.bindings,starts:checkpoint.starts,turns:checkpoint.turns}}:{}),
    steering:state.steering?.map(input=>({messageId:input.messageId})),questionFollows:state.questionFollows?.map(input=>({requestId:input.requestId,...(input.input?{input:{messageId:input.input.messageId}}:{})}))}}:{})};
}

export interface ImportRun {
  messageId:string;turnId?:string;prompt:string;createdAt:string;
  status:'Running'|'Completed'|'Interrupted'|'Failed'|'Unavailable';
  unavailable?:string;turn?:InlineTurn;
}
/** Only exact source associations can attach a response; prose is not evidence. */
export function importRuns(state:InlineThreadState):ImportRun[]{
  const roots=new Set<string>();
  return state.messages.filter(message=>message.role==='user').map(message=>{
    const turnId=turnForMessage(state,message.id),createdAt=message.createdAt??'';
    const run:ImportRun={messageId:message.id,turnId,prompt:visibleInlineInput(message.text),createdAt,status:'Unavailable'};
    if(!state.historyComplete)run.unavailable='The complete T3 history is unavailable. Reconnect and try again.';
    else if(!turnId)run.unavailable='T3 has no exact prompt-to-run record for this response. Its text cannot safely be imported as a run.';
    else if(roots.has(turnId))run.unavailable='This message steers another response. Select that run’s first prompt.';
    else if(!Number.isFinite(Date.parse(createdAt)))run.unavailable='T3 has no valid start time for this prompt.';
    else {
      const phase=turnPhase(state,turnId),active=state.session?.activeTurnId===turnId||state.latestTurn?.turnId===turnId&&state.latestTurn.state==='running';
      if(phase==='running'&&!active)run.unavailable='T3 has no completion record for this older response. Its current state cannot be verified.';
      else {
        run.status=phase==='complete'?'Completed':phase==='error'?'Failed':phase==='interrupted'?'Interrupted':'Running';
        const known=state.turns?.[turnId]??(state.latestTurn?.turnId===turnId?state.latestTurn:undefined);
        run.turn={...known,turnId,messageId:message.id,requestedAt:createdAt,state:known?.state??'running'};
      }
    }
    if(turnId)roots.add(turnId);
    return run;
  }).reverse();
}
const IMPORT_NAMESPACE='80c8acde-423d-5c56-86b2-0111455e1959';
export function importBindingId(source:{environmentId:string;projectId:string;threadId:string},messageId:string,notePath:string){
  return commandId(IMPORT_NAMESPACE,JSON.stringify([source.environmentId,source.projectId,source.threadId,messageId,notePath]));
}
export function importFollowId(source:{environmentId:string;projectId:string;threadId:string},notePath:string){
  return commandId(IMPORT_NAMESPACE,JSON.stringify(['follow',source.environmentId,source.projectId,source.threadId,notePath]));
}
