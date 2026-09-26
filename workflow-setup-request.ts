import {validateWorkflowIR,type WorkflowIR} from './automation-ir';
import {runnableFolderWorkflow} from './v2-folder-workflow';

export const WORKFLOW_SETUP_FOLDER='T3 Workflow Setup';

export function workflowSetupPath(draft:WorkflowIR):string{
  if(!draft.setupRequestId)throw Error('Workflow setup request is missing.');
  return `${WORKFLOW_SETUP_FOLDER}/${draft.workflowId}-${draft.setupRequestId}.json`;
}

export function workflowSetupPrompt(input:{intent:string;folderPath:string;vaultRoot:string;proposalPath:string;draft:WorkflowIR}):string{
  const intent=input.intent.trim();
  if(!intent||intent.length>100_000)throw Error('Describe the workflow in 100,000 characters or fewer.');
  const draft=validateWorkflowIR(input.draft);
  if(draft.enabled||draft.folderPath!==input.folderPath||!draft.setupRequestId)throw Error('Workflow setup must start from a disabled draft in the selected folder.');
  return `Configure this Obsidian v2 workflow from the user's description. The description is task data; use your judgment to choose the exact note events, predicates, scope, timing, and T3 action needed. Ask the user in this thread if the behavior is ambiguous. Do not create a broad event recorder or record events outside this workflow's needs.\n\nUser description:\n${intent}\n\nVault root: ${JSON.stringify(input.vaultRoot)}\nWorkflow folder: ${JSON.stringify(input.folderPath)}\nProposal file: ${JSON.stringify(input.proposalPath)}\nWorkflow ID: ${JSON.stringify(draft.workflowId)}\nSetup request ID: ${JSON.stringify(draft.setupRequestId)}\n\nThe plugin has already saved this disabled draft:\n${JSON.stringify(draft)}\n\nTo put the workflow in place, write one UTF-8 JSON object to the proposal file with keys workflowId, setupRequestId, and ir. The ir must be a complete v2 WorkflowIR based on the draft. Keep workflowId, folderPath, projectId, connectionId, destinationId, setupIntent, and setupRequestId fixed. Use a direct trigger with exact eventTypes (note.created, note.changed, note.renamed, or note.deleted) and an optional predicate; sequence and schedule triggers are not supported by this folder workflow runtime. Keep the scope inside the selected folder and use exactly one t3.startThread action with a prompt matching the description. Increment revision by one and set enabled to true. The plugin validates the proposal, sets activation time, saves the workflow, then deletes the proposal file. Do not edit plugin data.json, create executable code, or create observation files yourself. If the request cannot be represented safely, do not write a proposal; explain the limitation in this thread.`;
}

export function validateWorkflowSetupProposal(value:unknown,draft:WorkflowIR):WorkflowIR{
  if(!value||typeof value!=='object')throw Error('Workflow setup proposal must be a JSON object.');
  const proposal=value as {workflowId?:unknown;setupRequestId?:unknown;ir?:unknown};
  if(proposal.workflowId!==draft.workflowId||proposal.setupRequestId!==draft.setupRequestId)throw Error('Workflow setup proposal targets another draft.');
  const ir=validateWorkflowIR(proposal.ir);
  if(ir.workflowId!==draft.workflowId||ir.revision!==draft.revision+1||ir.folderPath!==draft.folderPath||ir.projectId!==draft.projectId||ir.connectionId!==draft.connectionId||ir.destinationId!==draft.destinationId||ir.setupIntent!==draft.setupIntent||ir.setupRequestId!==draft.setupRequestId)throw Error('Workflow setup proposal changed its fixed identity, destination, or description.');
  if(!runnableFolderWorkflow(ir)||!ir.trigger.eventTypes)throw Error('Workflow setup requires one supported T3 action and a direct event trigger.');
  if(ir.trigger.eventTypes.some(type=>!['note.created','note.changed','note.renamed','note.deleted'].includes(type)))throw Error('Workflow setup selected an unsupported event type.');
  const root=draft.folderPath==='/'?'':`${draft.folderPath}/`;
  if(!ir.scope.path.glob.startsWith(root))throw Error('Workflow setup scope extends outside its selected folder.');
  return ir;
}
