import {validateWorkflowIR,type WorkflowIR} from './automation-ir';
import {runnableFolderWorkflow} from './v2-folder-workflow';

export const WORKFLOW_SETUP_FOLDER='T3 Workflow Setup';

export function workflowSetupPath(draft:WorkflowIR):string{
  if(!draft.setupRequestId)throw Error('Workflow setup request is missing.');
  return `${WORKFLOW_SETUP_FOLDER}/${draft.workflowId}-${draft.setupRequestId}.json`;
}

export function workflowSetupRequestPath(draft:WorkflowIR):string{
  return workflowSetupPath(draft).replace(/\.json$/,'.request.json');
}

export function workflowSetupPrompt(input:{intent:string;folderPath:string;requestPath:string}):string{
  const intent=input.intent.trim();
  if(!intent||intent.length>100_000)throw Error('Describe the workflow in 100,000 characters or fewer.');
  if(!input.requestPath.trim())throw Error('Workflow setup instructions are missing.');
  const folder=input.folderPath==='/'?'Vault root (/)':input.folderPath;
  return `${intent}\n\nWorkflow folder: ${folder}\nSetup instructions: ${input.requestPath}\nRead that file to configure the workflow. Ask me here if anything is unclear.`;
}

export function workflowSetupRequest(input:{vaultRoot:string;folderPath:string;proposalPath:string;draft:WorkflowIR}):string{
  const draft=validateWorkflowIR(input.draft);
  if(draft.enabled||draft.folderPath!==input.folderPath||!draft.setupRequestId)throw Error('Workflow setup must start from a disabled draft in the selected folder.');
  return JSON.stringify({schemaVersion:1,vaultRoot:input.vaultRoot,selectedFolderPath:input.folderPath,proposalPath:input.proposalPath,draft,instructions:'Configure the workflow from draft.setupIntent. Use your judgment to choose the exact note events, predicates, scope, timing, and T3 action. Ask the user in the thread if the behavior is ambiguous. Do not create a broad event recorder. Write one UTF-8 JSON object to proposalPath with keys workflowId, setupRequestId, and ir. Base ir on draft; keep workflowId, projectId, connectionId, destinationId, setupIntent, and setupRequestId fixed. Keep ir.folderPath inside selectedFolderPath; if the description points to a more specific folder, set ir.folderPath to that folder and scope to its notes. Use a direct trigger with exact eventTypes (note.created, note.changed, note.renamed, or note.deleted) and an optional predicate; sequence and schedule triggers are not supported. Use exactly one t3.startThread action with a prompt matching the description. Increment revision by one and set enabled true. The plugin validates the setup result, sets activation time, saves the workflow, and deletes both temporary setup files. Do not edit plugin data.json, create executable code, or create observation files. If the request cannot be represented safely, do not write a setup result; explain the limitation in the thread.'});
}

export function validateWorkflowSetupProposal(value:unknown,draft:WorkflowIR):WorkflowIR{
  if(!value||typeof value!=='object')throw Error('Workflow setup result must be a JSON object.');
  const proposal=value as {workflowId?:unknown;setupRequestId?:unknown;ir?:unknown};
  if(proposal.workflowId!==draft.workflowId||proposal.setupRequestId!==draft.setupRequestId)throw Error('Workflow setup result targets another draft.');
  const ir=validateWorkflowIR(proposal.ir);
  if(ir.workflowId!==draft.workflowId||ir.revision!==draft.revision+1||ir.projectId!==draft.projectId||ir.connectionId!==draft.connectionId||ir.destinationId!==draft.destinationId||ir.setupIntent!==draft.setupIntent||ir.setupRequestId!==draft.setupRequestId)throw Error('Workflow setup result changed its fixed identity, destination, or description.');
  if(typeof ir.folderPath!=='string')throw Error('Workflow setup result is missing its folder.');
  if(ir.folderPath!=='/'&&(ir.folderPath.startsWith('/')||ir.folderPath.endsWith('/')||ir.folderPath.includes('//')||/[?*]/.test(ir.folderPath)))throw Error('Workflow setup selected an invalid folder.');
  if(draft.folderPath!=='/'&&ir.folderPath!==draft.folderPath&&!ir.folderPath.startsWith(`${draft.folderPath}/`))throw Error('Workflow setup selected a folder outside the original selection.');
  if(!runnableFolderWorkflow(ir)||!ir.trigger.eventTypes)throw Error('Workflow setup requires one supported T3 action and a direct event trigger.');
  if(ir.trigger.eventTypes.some(type=>!['note.created','note.changed','note.renamed','note.deleted'].includes(type)))throw Error('Workflow setup selected an unsupported event type.');
  const root=ir.folderPath==='/'?'':`${ir.folderPath}/`;
  if(!ir.scope.path.glob.startsWith(root))throw Error('Workflow setup scope extends outside its selected folder.');
  return ir;
}
