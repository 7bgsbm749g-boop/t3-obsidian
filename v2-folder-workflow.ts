import {validateWorkflowIR,type WorkflowIR} from './automation-ir';

export interface FolderWorkflowInput {id:string;name:string;folderPath:string;includeSubfolders:boolean;events:Array<'create'|'modify'>;task:string;destinationId:string;projectId:string;connectionId?:string;enabled:boolean;order:number;existing?:WorkflowIR}

export function folderWorkflowIR(input:FolderWorkflowInput):WorkflowIR {
  const name=input.name.trim(),task=input.task.trim(),folderPath=input.folderPath==='/'?'/':input.folderPath.replace(/\/$/,'');
  if(!name||name.length>160||!task||!input.projectId||!input.events.length||input.events.some(event=>event!=='create'&&event!=='modify')||!folderPath||folderPath.includes('..')||folderPath.includes('\\'))throw Error('Complete the workflow name, task, folder, destination, and trigger.');
  const root=folderPath==='/'?'':`${folderPath}/`;
  const ir:WorkflowIR={
    irVersion:1,semanticsVersion:1,workflowId:input.id,revision:(input.existing?.revision??0)+1,enabled:input.enabled,destinationId:input.destinationId,
    name,folderPath,projectId:input.projectId,...(input.connectionId?{connectionId:input.connectionId}:{}),
    scope:{path:{glob:input.includeSubfolders?`${root}**/*.md`:`${root}*.md`,case:'sensitive'},exclude:[],overlapPolicy:'all-matching'},
    trigger:{eventTypes:input.events.map(event=>event==='create'?'note.created':'note.changed'),unknown:'hold-for-review'},
    timing:{debounce:{key:'noteId',quietMs:5000,maxWaitMs:30000,preserveTransitions:true}},
    execution:{input:'current-validated-revision',concurrencyKey:'noteId',batchOrder:input.order,failurePolicy:'stop-batch',provenance:{ownWorkflowOutputs:'exclude',otherWorkflowOutputs:'explicit-only'}},
    actions:[{id:'edit-note',type:'t3.startThread',promptTemplate:`Execute this Obsidian folder workflow:\n\n${task}\n\nEdit only the named note. Preserve all information unless the task explicitly says otherwise. Before editing, verify that the note's current content matches the supplied input hash; if it does not, report a conflict and do not overwrite the newer edit.\n\nVault-relative note path: {{note.path}}\nExpected input SHA-256: {{note.inputHash}}\n\nCurrent note content:\n\n{{note.content}}`}]
  };
  return validateWorkflowIR(ir);
}

export function folderForWorkflow(ir:WorkflowIR):string|undefined{return ir.folderPath;}
export function runnableFolderWorkflow(ir:WorkflowIR):boolean{return Boolean(ir.enabled&&ir.folderPath&&ir.projectId&&ir.actions.length===1&&ir.actions[0].type==='t3.startThread');}
