import {logEvent,logFailure} from './diagnostics';
import {AutomationStore} from './automation-store';
import {recoverableAction,transition,type ExecutionEntry,type ImmutablePlan} from './execution-journal';

export interface ExecutionHost {
  createThread(plan:ImmutablePlan):Promise<string>;
  startTurn(plan:ImmutablePlan,threadId:string):Promise<void>;
  poll(plan:ImmutablePlan,threadId:string):Promise<{state:'wait'|'complete'|'failed';result?:unknown;detail?:string}>;
  apply(plan:ImmutablePlan,input:unknown):Promise<{applied:boolean;result?:unknown;detail?:string}>;
  emit(plan:ImmutablePlan,input:unknown):Promise<unknown>;
  now():string;
}
const terminal=new Set(['succeeded','conflicted','failed','cancelled']);
export class DurableExecutionDriver {
  constructor(private store:AutomationStore,private host:ExecutionHost){}
  async recover():Promise<void>{const entries=(await this.store.executions()).sort((a,b)=>(a.batchId??'').localeCompare(b.batchId??'')||(a.sequence??0)-(b.sequence??0));for(const entry of entries)await this.advance(entry,entries);}
  private async advance(entry:ExecutionEntry,entries:ExecutionEntry[]){if(terminal.has(entry.state)||entry.state==='blocked'||entry.state==='waiting_evidence'||entry.state==='debouncing'||entry.state==='queued'||entry.state==='retry_wait'||entry.state==='conflicted')return;const predecessor=entry.dependsOnRunId?entries.find(x=>x.runId===entry.dependsOnRunId):undefined;if(predecessor?.state!=='succeeded'&&predecessor){if(terminal.has(predecessor.state))await this.save({...entry,state:'blocked',detail:'An earlier batch step did not succeed.',updatedAt:this.host.now()});return;}
    if(entry.plan.actionType==='event.emit'){if(entry.state==='planned')entry=await this.save(transition(entry,'apply_pending',this.host.now()));if(entry.state==='apply_pending')try{const result=await this.host.emit(entry.plan,predecessor?.result);await this.save({...entry,state:'succeeded',result,updatedAt:this.host.now()});}catch(error){await this.fail(entry,error);}return;}
    if(entry.plan.actionType==='vault.applyValidatedResult'){if(entry.state==='planned')entry=await this.save(transition(entry,'apply_pending',this.host.now()));if(entry.state==='apply_pending')try{const result=await this.host.apply(entry.plan,predecessor?.result);await this.save({...entry,state:result.applied?'succeeded':'conflicted',result:result.result,detail:result.detail,updatedAt:this.host.now()});}catch(error){await this.fail(entry,error);}return;}
    const action=recoverableAction(entry);if(action==='reconcile-delivery'){await this.save({...entry,state:'delivery_unknown',detail:'Delivery may have escaped. Reconcile the stable request ID before retrying.',updatedAt:this.host.now()});return;}
    if(entry.state==='planned'){entry=await this.save(transition(entry,'create_attempted',this.host.now()));try{const threadId=await this.host.createThread(entry.plan);entry=await this.save({...entry,state:'thread_created',threadId,updatedAt:this.host.now()});}catch(error){await this.unknown(entry,error);return;}}
    if(entry.state==='thread_created'){entry=await this.save(transition(entry,'turn_attempted',this.host.now()));try{await this.host.startTurn(entry.plan,entry.threadId!);entry=await this.save({...entry,state:'running',updatedAt:this.host.now()});}catch(error){await this.unknown(entry,error);return;}}
    if(entry.state==='running'||entry.state==='awaiting_result'){try{const status=await this.host.poll(entry.plan,entry.threadId!);if(status.state==='wait'){if(entry.state==='running')await this.save({...entry,state:'awaiting_result',updatedAt:this.host.now()});return;}await this.save({...entry,state:status.state==='complete'?'succeeded':'failed',result:status.result,detail:status.detail,updatedAt:this.host.now()});}catch(error){await this.fail(entry,error);}}
  }
  private async save<T extends ExecutionEntry>(entry:T):Promise<T>{await this.store.putExecution(entry);logEvent('workflow.execution.state',{runId:entry.runId,requestId:entry.plan.requestId,workflowId:entry.plan.workflowId,threadId:entry.threadId,state:entry.state,attempts:entry.attempts},['failed','conflicted','delivery_unknown'].includes(entry.state)?'warning':'info');return entry;}
  private async unknown(entry:ExecutionEntry,error:unknown){logFailure('workflow.delivery.unknown',error,{runId:entry.runId,requestId:entry.plan.requestId});await this.save({...entry,state:'delivery_unknown',detail:error instanceof Error?error.message:String(error),updatedAt:this.host.now()});}
  private async fail(entry:ExecutionEntry,error:unknown){logFailure('workflow.execution.failed',error,{runId:entry.runId,requestId:entry.plan.requestId});await this.save({...entry,state:'failed',detail:error instanceof Error?error.message:String(error),updatedAt:this.host.now()});}
}
