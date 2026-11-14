import {hasControlCharacters,isRecord} from '../shared/values';

/** Portable Taskflow note property, also usable when Taskflow is not loaded. */
export function associatedTaskIds(frontmatter: unknown): string[] {
  const value = isRecord(frontmatter) ? frontmatter['taskflow-task-ids'] : undefined;
  const values = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  return [...new Set(values.filter((id): id is string => typeof id === 'string' && /^[\w-]{1,256}$/.test(id)))].sort();
}
export interface TaskFlowCommand {
  version:1; id:string; kind:'taskflow-get'|'taskflow-assign'|'taskflow-unassign'|'taskflow-start'|'taskflow-complete';
  taskId:string; expectedRevision?:string; assignmentId?:string; assignee?:string; result?:string;
}
const KINDS=['taskflow-get','taskflow-assign','taskflow-unassign','taskflow-start','taskflow-complete'];
export function isTaskFlowCommand(value:unknown):value is TaskFlowCommand {return isRecord(value)&&typeof value.kind==='string'&&KINDS.includes(value.kind);}
export function validateTaskFlowCommand(value:unknown):TaskFlowCommand {
  if(!isRecord(value)||value.version!==1||typeof value.id!=='string'||!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value.id)||!isTaskFlowCommand(value)||typeof value.taskId!=='string'||!/^[\w-]{1,256}$/.test(value.taskId))throw Error('Invalid Taskflow command.');
  const keys=['version','id','kind','taskId'];
  if(value.kind!=='taskflow-get'){
    keys.push('expectedRevision');
    if(typeof value.expectedRevision!=='string'||!/^[a-f0-9]{64}$/.test(value.expectedRevision))throw Error('Read the current Taskflow revision first.');
    if(value.kind==='taskflow-assign'){
      keys.push('assignee');
      if(typeof value.assignee!=='string'||!value.assignee.trim()||value.assignee.length>256||hasControlCharacters(value.assignee,true))throw Error('Supply the agent task owner.');
    }else{
      keys.push('assignmentId');
      if(typeof value.assignmentId!=='string'||!/^[\w-]{1,256}$/.test(value.assignmentId))throw Error('Supply the current Taskflow assignment ID.');
    }
  }
  if(value.kind==='taskflow-complete'){
    keys.push('result');
    if(value.result!==undefined&&(typeof value.result!=='string'||value.result.length>4000))throw Error('Taskflow result summaries are limited to 4000 characters.');
  }
  if(Object.keys(value).some(key=>!keys.includes(key)))throw Error('Unexpected Taskflow command field.');
  return value;
}
interface TaskFlowApi {
  version:number; ready:Promise<void>;
  get(ref:{taskId:string}):Promise<unknown>;
  assign(ref:{taskId:string;expectedRevision:string;assignee:string}):Promise<unknown>;
  unassign(ref:{taskId:string;expectedRevision:string;assignmentId:string}):Promise<unknown>;
  start(ref:{taskId:string;expectedRevision:string;assignmentId:string}):Promise<unknown>;
  complete(ref:{taskId:string;expectedRevision:string;assignmentId:string;result?:string}):Promise<unknown>;
}
/** A narrow bridge to Taskflow's checked API; never infer status from a run. */
export async function executeTaskFlowCommand(command:TaskFlowCommand,api?:TaskFlowApi){
  const input=validateTaskFlowCommand(command);
  const unavailable=(error:string)=>({id:input.id,ok:false,error,code:'unavailable',retryable:true});
  if(!api||api.version!==1)return unavailable('Enable Task Flow with API v1 in this Obsidian vault.');
  try{await api.ready;}catch(error){return unavailable(error instanceof Error?error.message:'Task Flow could not become ready.');}
  const {id,version:_version,kind,...ref}=input;
  try {
    const task=kind==='taskflow-get'?await api.get({taskId:ref.taskId}):kind==='taskflow-assign'?await api.assign({taskId:ref.taskId,expectedRevision:ref.expectedRevision!,assignee:ref.assignee!}):await api[kind==='taskflow-start'?'start':kind==='taskflow-complete'?'complete':'unassign']({taskId:ref.taskId,expectedRevision:ref.expectedRevision!,assignmentId:ref.assignmentId!,...(kind==='taskflow-complete'&&ref.result!==undefined?{result:ref.result}:{})});
    return {id,ok:true,task};
  }catch(error){return {id,ok:false,error:error instanceof Error?error.message:'Taskflow request failed.',...(isRecord(error)&&typeof error.code==='string'?{code:error.code}:{})};}
}
