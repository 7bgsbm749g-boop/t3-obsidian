import {isRecord,records} from '../shared/values';
import type {Project} from '../app/bridge';
import type {T3Api} from '../connection/t3-rpc';

export const NO_PROJECT='thread:no-project';
export const noProjectKey=(machineId:string)=>`${NO_PROJECT}:${machineId}`;
export function noProjectMachine(key:string):string|undefined {
  return key.startsWith(NO_PROJECT+':')?key.slice(NO_PROJECT.length+1):undefined;
}
export const isNoProjectKey=(key?:string)=>key===NO_PROJECT||!!key?.startsWith(NO_PROJECT+':');

/** Use T3's own backing record; its IDs remain valid for history and replies. */
export async function ensureNoProject(api:T3Api):Promise<Project>{
  const result=await api('/api/orchestration/no-project',{});
  if(!isRecord(result)||typeof result.projectId!=='string'||!result.projectId)throw Error('This T3 machine does not support threads without a project. Update T3 and retry.');
  const shell=await api('/api/orchestration/shell');
  const project=isRecord(shell)?records(shell.projects).find(project=>project.id===result.projectId):undefined;
  if(!project||typeof project.id!=='string'||typeof project.title!=='string'||typeof project.workspaceRoot!=='string'||!project.workspaceRoot)throw Error('T3 has not returned its No project workspace. Try again.');
  return {id:project.id,title:'No project',workspaceRoot:project.workspaceRoot};
}
