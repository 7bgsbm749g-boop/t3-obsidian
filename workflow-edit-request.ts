import {commandId} from './direct';
import {validateWorkflowIR,type WorkflowIR} from './automation-ir';
import {runnableFolderWorkflow} from './v2-folder-workflow';
import {WORKFLOW_SETUP_FOLDER} from './workflow-setup-request';

export interface WorkflowEditRequest {requestId:string;workflowId:string;baseRevision:number;requestedAt:string}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const workflowId=/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function workflowSetupThreadId(ir:WorkflowIR):string|undefined {
  return ir.setupRequestId&&uuid.test(ir.setupRequestId)?commandId(ir.setupRequestId,'thread'):undefined;
}
export function workflowEditPath(request:WorkflowEditRequest):string {
  if(!uuid.test(request.requestId)||!workflowId.test(request.workflowId))throw Error('Invalid workflow edit identity.');
  return `${WORKFLOW_SETUP_FOLDER}/${request.workflowId}-${request.requestId}.json`;
}
export function workflowEditRequestPath(request:WorkflowEditRequest):string{return workflowEditPath(request).replace(/\.json$/,'.request.json');}
export function loadWorkflowEditRequests(value:unknown):WorkflowEditRequest[] {
  if(!Array.isArray(value))return [];
  const seen=new Set<string>();
  return value.filter((item):item is WorkflowEditRequest=>{
    if(!item||!uuid.test(item.requestId)||!workflowId.test(item.workflowId)||!Number.isSafeInteger(item.baseRevision)||item.baseRevision<1||typeof item.requestedAt!=='string'||!Number.isFinite(Date.parse(item.requestedAt))||seen.has(item.requestId))return false;
    seen.add(item.requestId);return true;
  });
}
export function mergeWorkflowEditRequests(baseline:WorkflowEditRequest[],external:WorkflowEditRequest[],intended:WorkflowEditRequest[]):WorkflowEditRequest[] {
  const before=new Map(baseline.map(item=>[item.requestId,item])),remote=new Map(external.map(item=>[item.requestId,item])),local=new Map(intended.map(item=>[item.requestId,item]));
  const result:WorkflowEditRequest[]=[];
  for(const id of new Set([...before.keys(),...remote.keys(),...local.keys()])){
    const base=before.get(id),theirs=remote.get(id),ours=local.get(id);
    const changed=(a:WorkflowEditRequest|undefined,b:WorkflowEditRequest|undefined)=>JSON.stringify(a)!==JSON.stringify(b);
    if(changed(ours,base)&&changed(theirs,base)&&changed(ours,theirs))throw Error(`Workflow edit request ${id} changed on another device.`);
    const chosen=changed(ours,base)?ours:theirs;if(chosen)result.push(chosen);
  }
  const workflows=new Set<string>();
  for(const item of result){if(workflows.has(item.workflowId))throw Error(`Workflow ${item.workflowId} already has a change request. Finish or cancel it before sending another.`);workflows.add(item.workflowId);}
  return result;
}
export function workflowEditPrompt(input:{change:string;folderPath:string;requestPath:string}):string {
  const change=input.change.trim();
  if(!change||change.length>100_000)throw Error('Describe the workflow change in 100,000 characters or fewer.');
  if(!input.requestPath.trim())throw Error('Workflow edit instructions are missing.');
  return `${change}\n\nWorkflow folder: ${input.folderPath==='/'?'Vault root (/)':input.folderPath}\nEdit instructions: ${input.requestPath}\nRead that file and update this workflow. Ask me here if anything is unclear.`;
}
export function workflowEditDocument(input:{vaultRoot:string;folderPath:string;proposalPath:string;current:WorkflowIR;request:WorkflowEditRequest}):string {
  const current=validateWorkflowIR(input.current),request=input.request;
  if(!current.enabled||current.workflowId!==request.workflowId||current.revision!==request.baseRevision||!workflowSetupThreadId(current))throw Error('Workflow edit request does not match an active linked workflow.');
  return JSON.stringify({schemaVersion:1,kind:'workflow.edit',vaultRoot:input.vaultRoot,selectedFolderPath:input.folderPath,proposalPath:input.proposalPath,editRequestId:request.requestId,current,instructions:'Apply the change described in this T3 thread to the current workflow. Ask the user here if the behavior is ambiguous. Write one UTF-8 JSON object to proposalPath with keys workflowId, editRequestId, and ir. Base ir on current; keep workflowId, projectId, connectionId, destinationId, and setupRequestId fixed so the original setup thread remains linked. Increment revision by one and keep enabled true. Keep ir.folderPath inside selectedFolderPath and its scope inside that folder. Use a direct trigger with exact eventTypes (note.created, note.changed, note.renamed, or note.deleted) and an optional predicate; sequence and schedule triggers are not supported. Use exactly one t3.startThread action. The plugin validates the result, activates the revision, and deletes these temporary files. Do not edit plugin data.json, create executable code, or create observation files. If the change cannot be represented safely, do not write a result; explain the limitation in this thread.'});
}
export function validateWorkflowEditProposal(value:unknown,current:WorkflowIR,request:WorkflowEditRequest):WorkflowIR {
  if(!value||typeof value!=='object')throw Error('Workflow edit result must be a JSON object.');
  const proposal=value as {workflowId?:unknown;editRequestId?:unknown;ir?:unknown};
  if(proposal.workflowId!==request.workflowId||proposal.editRequestId!==request.requestId||current.workflowId!==request.workflowId||current.revision!==request.baseRevision)throw Error('Workflow edit result targets another request or revision.');
  const ir=validateWorkflowIR(proposal.ir);
  if(ir.workflowId!==current.workflowId||ir.revision!==current.revision+1||ir.projectId!==current.projectId||ir.connectionId!==current.connectionId||ir.destinationId!==current.destinationId||ir.setupRequestId!==current.setupRequestId)throw Error('Workflow edit changed its fixed identity, destination, or setup thread.');
  if(typeof ir.folderPath!=='string'||ir.folderPath!=='/'&&(ir.folderPath.startsWith('/')||ir.folderPath.endsWith('/')||ir.folderPath.includes('//')||/[?*]/.test(ir.folderPath)))throw Error('Workflow edit selected an invalid folder.');
  if(current.folderPath!=='/'&&ir.folderPath!==current.folderPath&&!ir.folderPath.startsWith(`${current.folderPath}/`))throw Error('Workflow edit selected a folder outside the original selection.');
  if(!runnableFolderWorkflow(ir)||!ir.trigger.eventTypes||ir.trigger.eventTypes.some(type=>!['note.created','note.changed','note.renamed','note.deleted'].includes(type)))throw Error('Workflow edit requires one supported T3 action and a direct event trigger.');
  const root=ir.folderPath==='/'?'':`${ir.folderPath}/`;
  if(!ir.scope.path.glob.startsWith(root))throw Error('Workflow edit scope extends outside its selected folder.');
  return ir;
}
