import {workflowRequestId} from './automation-protocol';

export type ExecutionState='waiting_evidence'|'debouncing'|'queued'|'blocked'|'planned'|'create_attempted'|'thread_created'|'turn_attempted'|'running'|'awaiting_result'|'apply_pending'|'succeeded'|'retry_wait'|'delivery_unknown'|'conflicted'|'failed'|'cancelled';
export interface ImmutablePlan {requestId:string;vaultId:string;destinationId:string;occurrenceId:string;workflowId:string;releaseHash:string;stepId:string;actionType:'t3.startThread'|'vault.applyValidatedResult'|'event.emit';executionGeneration:number;inputHash:string;title:string;prompt:string;attachments:unknown[];environmentId:string;createdAt:string}
export interface ExecutionEntry {runId:string;state:ExecutionState;plan:ImmutablePlan;threadId?:string;detail?:string;attempts:number;updatedAt:string;batchId?:string;sequence?:number;dependsOnRunId?:string;result?:unknown}
const transitions:Record<ExecutionState,ExecutionState[]>= {
  waiting_evidence:['debouncing','blocked','cancelled'],debouncing:['queued','cancelled'],queued:['planned','blocked','conflicted','cancelled'],blocked:['queued','cancelled','failed'],planned:['create_attempted','thread_created','turn_attempted','apply_pending','cancelled'],create_attempted:['thread_created','delivery_unknown'],thread_created:['turn_attempted','cancelled'],turn_attempted:['running','delivery_unknown'],running:['awaiting_result','failed','cancelled'],awaiting_result:['apply_pending','succeeded','failed','conflicted'],apply_pending:['succeeded','conflicted','failed'],succeeded:[],retry_wait:['create_attempted','turn_attempted','blocked','cancelled'],delivery_unknown:['create_attempted','turn_attempted','blocked','failed'],conflicted:['cancelled'],failed:['retry_wait','cancelled'],cancelled:[]
};
export function createPlan(input:Omit<ImmutablePlan,'requestId'>):ImmutablePlan{return {...input,requestId:workflowRequestId(input.vaultId,input.destinationId,input.occurrenceId,input.workflowId,input.releaseHash,input.stepId,input.executionGeneration)};}
export function transition(entry:ExecutionEntry,state:ExecutionState,at=new Date().toISOString(),detail?:string):ExecutionEntry{
  if(entry.state===state)return entry;if(!transitions[entry.state].includes(state))throw Error(`Invalid execution transition: ${entry.state} → ${state}`);return {...entry,state,updatedAt:at,...(detail?{detail}:{detail:undefined}),attempts:state.endsWith('attempted')?entry.attempts+1:entry.attempts};
}
export function assertSamePlan(before:ImmutablePlan,after:ImmutablePlan){if(JSON.stringify(before)!==JSON.stringify(after))throw Error('An execution plan is immutable after persistence.');}
export function recoverableAction(entry:ExecutionEntry):'none'|'dispatch-create'|'dispatch-turn'|'poll'|'reconcile-delivery'|'apply' {
  if(entry.state==='planned')return'dispatch-create';if(entry.state==='thread_created')return'dispatch-turn';if(entry.state==='running'||entry.state==='awaiting_result')return'poll';if(entry.state==='create_attempted'||entry.state==='turn_attempted'||entry.state==='delivery_unknown')return'reconcile-delivery';if(entry.state==='apply_pending')return'apply';return'none';
}
