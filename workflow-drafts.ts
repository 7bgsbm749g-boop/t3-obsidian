import type {WorkflowIR} from './automation-ir';

function same(left:WorkflowIR|undefined,right:WorkflowIR|undefined){return JSON.stringify(left)===JSON.stringify(right);}

/** Preserve external edits unless this device explicitly changed the same definition. */
export function mergeWorkflowDrafts(baseline:WorkflowIR[],external:WorkflowIR[],intended:WorkflowIR[]):WorkflowIR[]{
  const before=new Map(baseline.map(ir=>[ir.workflowId,ir]));
  const remote=new Map(external.map(ir=>[ir.workflowId,ir]));
  const local=new Map(intended.map(ir=>[ir.workflowId,ir]));
  const ids=new Set([...before.keys(),...remote.keys(),...local.keys()]);
  const result:WorkflowIR[]=[];
  for(const id of ids){
    const base=before.get(id),theirs=remote.get(id),ours=local.get(id);
    const localChanged=!same(ours,base),externalChanged=!same(theirs,base);
    if(localChanged&&externalChanged&&!same(ours,theirs))throw Error(`Workflow ${id} changed on another device. Reopen settings and apply your edit again.`);
    const chosen=localChanged?ours:theirs;
    if(chosen)result.push(chosen);
  }
  return result;
}
