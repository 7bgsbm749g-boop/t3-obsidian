import type {FolderWorkflow,WorkflowRun} from './workflow';

export type WorkflowActivity='running'|'queued'|'completed'|'blocked';
export const WORKFLOW_ACTIVITY_ATTRIBUTE='data-t3-workflow-activity';
const BORDER_CLASS='t3-workflow-progress-border';
export const workflowActivityLabel:Record<WorkflowActivity,string>={running:'Workflow running',queued:'Workflow queued',completed:'Step complete; sequence still active',blocked:'Workflow needs attention'};

/** Completed steps remain outlined until every member of their batch completes. */
export function workflowActivity(workflows:FolderWorkflow[],runs:WorkflowRun[]){
  const folders=new Map<string,WorkflowActivity>(),steps=new Map<string,WorkflowActivity>();
  const definitions=new Map(workflows.map(workflow=>[workflow.id,workflow]));
  const batches=new Map<string,WorkflowRun[]>();
  for(const run of runs){const key=run.batchId??run.id;const batch=batches.get(key)??[];batch.push(run);batches.set(key,batch);}
  const priority={completed:0,queued:1,blocked:2,running:3};
  const merge=(map:Map<string,WorkflowActivity>,key:string,state:WorkflowActivity)=>{const previous=map.get(key);if(!previous||priority[state]>priority[previous])map.set(key,state);};
  for(const batch of batches.values()){
    if(batch.every(run=>run.state==='completed'))continue;
    const running=batch.some(run=>run.state==='running'||run.state==='settling');
    const blocked=batch.some(run=>run.state==='failed'||run.state==='conflicted');
    for(const run of batch){
      const definition=definitions.get(run.workflowId);if(!definition)continue;
      const state:WorkflowActivity=run.state==='running'||run.state==='settling'?'running':run.state==='completed'?'completed':blocked?'blocked':'queued';
      merge(steps,definition.id,state);merge(folders,definition.folderPath,running?'running':blocked?'blocked':'queued');
    }
  }
  return {folders,steps};
}

/** A layout-neutral SVG supplies a real perimeter animation, not a fake percent. */
export function decorateWorkflowActivity(element:HTMLElement,state?:WorkflowActivity){
  let border=element.querySelector<SVGElement>('.'+BORDER_CLASS);
  if(!state){if(element.hasAttribute(WORKFLOW_ACTIVITY_ATTRIBUTE))element.removeAttribute(WORKFLOW_ACTIVITY_ATTRIBUTE);border?.remove();return;}
  if(element.getAttribute(WORKFLOW_ACTIVITY_ATTRIBUTE)!==state)element.setAttribute(WORKFLOW_ACTIVITY_ATTRIBUTE,state);
  if(!border){
    const doc=element.ownerDocument;
    border=doc.createElementNS('http://www.w3.org/2000/svg','svg');border.setAttribute('class',BORDER_CLASS);border.setAttribute('aria-hidden','true');border.setAttribute('focusable','false');
    const rect=doc.createElementNS('http://www.w3.org/2000/svg','rect');
    rect.setAttribute('width','100%');rect.setAttribute('height','100%');rect.setAttribute('rx','4');rect.setAttribute('pathLength','100');border.appendChild(rect);element.appendChild(border);
  }
}
