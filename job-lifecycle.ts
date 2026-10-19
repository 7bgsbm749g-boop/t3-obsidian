import {commandId} from './direct';
import {turnForMessage,turnPhase,type InlineThreadState} from './inline-thread';
import type {EventTarget} from './event-subscriptions';
import {delegatedWork} from './inline-delegation';

export const JOB_STATES=['running','waiting-approval','waiting-input','completed','failed','interrupted','cancelled'] as const;
export type JobStatus=typeof JOB_STATES[number];
/** Correlation metadata, never a task definition or a thread-wide outcome. */
export interface JobWatch extends EventTarget {jobId:string;requestId:string;messageId:string;turnId?:string}
export interface JobEvent {
  kind:'job';path:string;id:string;at:string;job:JobWatch;state:JobStatus;terminal:boolean;
  execution:'t3';delivery:'independent';productDelivery:'unverified';requestId?:string;detail?:string;
}
export interface JobObservation {turnId?:string;seen:string[];terminal?:JobStatus;error?:string}
const identity=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=200&&!/[\x00-\x1f]/.test(v);
export function validateJob(value:any):JobWatch {
  if(!value||![value.jobId,value.requestId,value.messageId,value.threadId,value.projectId,value.environmentId].every(identity)||value.turnId!==undefined&&!identity(value.turnId))throw Error('A job needs job, dispatch request, originating user message, thread, project, and environment IDs.');
  return {...value};
}

/** Transitions retain canonical activity IDs. A newer thread session cannot
 * complete, fail, or unblock an unrelated response. Outages produce no event. */
export function jobEvents(job:JobWatch,state:InlineThreadState,observation:JobObservation):JobEvent[] {
  const matched=turnForMessage(state,job.messageId);
  if(matched&&job.turnId&&matched!==job.turnId)throw Error('The supplied turn does not belong to the job’s originating message.');
  const origin=state.messages.find(message=>message.id===job.messageId&&message.role==='user');
  const supplied=job.turnId===state.latestTurn?.turnId?state.latestTurn:job.turnId?state.turns?.[job.turnId]:undefined;
  if(!matched&&job.turnId&&origin?.createdAt&&supplied?.requestedAt&&origin.createdAt!==supplied.requestedAt)throw Error('The supplied turn does not belong to the job’s originating message.');
  const turnId=job.turnId??observation.turnId??matched;
  if(turnId)observation.turnId=turnId;
  const events:JobEvent[]=[];
  const emit=(status:JobStatus,source:string,at:string,requestId?:string,detail?:string)=>{
    const id=commandId(job.requestId,`job:${job.jobId}:${job.messageId}:${turnId??'pending'}:${source}:${status}`);
    if(observation.seen.includes(id))return;
    const terminal=['completed','failed','interrupted','cancelled'].includes(status);
    events.push({kind:'job',path:job.jobId,id,at,job:{...job,...(turnId?{turnId}:{})},state:status,terminal,execution:'t3',delivery:'independent',productDelivery:'unverified',...(requestId?{requestId}:{}),...(detail?{detail}:{})});
  };
  if(observation.terminal)return events;
  const startFailure=state.activities.find(a=>a.kind==='provider.turn.start.failed'&&a.payload?.requestId===job.messageId);
  if(startFailure){emit('failed',startFailure.id,startFailure.createdAt??'',job.messageId,String(startFailure.payload?.detail??startFailure.summary));return events;}
  if(!turnId||!state.messages.some(m=>m.role==='user'&&m.id===job.messageId))return events;
  const delegated=delegatedWork(state,[turnId]),current=delegated.turnId??turnId;
  const activities=state.activities.filter(a=>!!a.turnId&&delegated.turnIds.includes(a.turnId));
  for(const activity of activities){
    const requestId=activity.payload?.requestId;
    if(activity.kind==='approval.requested'||activity.kind==='user-input.requested')emit(activity.kind==='approval.requested'?'waiting-approval':'waiting-input',activity.id,activity.createdAt??'',requestId,activity.summary);
    if(activity.kind==='approval.resolved'||activity.kind==='user-input.resolved')emit('running',activity.id,activity.createdAt??'',requestId,activity.summary);
  }
  // A transport session error is not an execution failure. Use exact turn
  // state/checkpoints; runtime.error alone may be recovered within the turn.
  const observed=turnPhase(state,current),phase=observed==='complete'&&(delegated.waiting||delegated.running)?'running':observed;
  const turn=state.turns?.[current]??(state.latestTurn?.turnId===current?state.latestTurn:undefined);
  const at=turn?.completedAt??state.checkpoints?.find(c=>c.turnId===turnId)?.completedAt??state.messages.filter(m=>m.turnId===turnId).at(-1)?.createdAt??'';
  const pending=new Map<string,string>();
  for(const a of activities){const id=a.payload?.requestId;if(typeof id!=='string')continue;if(['approval.requested','user-input.requested'].includes(a.kind))pending.set(id,a.kind);if(['approval.resolved','user-input.resolved'].includes(a.kind))pending.delete(id);}
  const checkpoint=state.checkpoints?.find(c=>c.turnId===turnId&&c.checkpointRef?.startsWith('refs/t3/checkpoints/'));
  // A later prompt and finalized prose are enough for display recovery, but
  // cannot distinguish a completed execution from an interrupted one.
  if(!turn||!['completed','error','interrupted','cancelled'].includes(turn.state)){if(!checkpoint)return events;}
  if(turn?.state==='cancelled')emit('cancelled','terminal',at);
  else if(phase==='interrupted')emit('interrupted','terminal',at);
  else if(phase==='error')emit('failed','terminal',at,undefined,activities.filter(a=>a.kind==='runtime.error').at(-1)?.summary);
  else if(phase==='complete'&&!pending.size)emit('completed','terminal',at);
  return events;
}
