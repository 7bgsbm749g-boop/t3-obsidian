import {isLogPath} from './synced-event-logs';
import {globMatches,type WorkflowIR} from './automation-ir';
import type {ObservationSource} from './automation-protocol';
import {runnableFolderWorkflow} from './v2-folder-workflow';

const eventForSource:Partial<Record<ObservationSource,string>>={
  'vault.create':'note.created',
  'vault.modify':'note.changed',
  'metadata.changed':'note.changed',
  'plugin.command':'note.changed',
  'vault.rename':'note.renamed',
  'vault.delete':'note.deleted',
};

function eventTypes(ir:WorkflowIR):string[]{
  return ir.trigger.eventTypes??ir.trigger.sequence?.steps.flatMap(step=>step.eventTypes)??[];
}

function inScope(ir:WorkflowIR,path:string):boolean{
  return !isLogPath(path) && globMatches(ir.scope.path.glob,path,ir.scope.path.case)
    && !ir.scope.exclude.some(glob=>globMatches(glob,path,ir.scope.path.case));
}

export function observationInterest(workflows:WorkflowIR[]){
  const active=workflows.filter(ir=>ir.activatedAt&&runnableFolderWorkflow(ir));
  return {
    active:active.length>0,
    baseline:(path:string)=>active.some(ir=>inScope(ir,path)),
    accepts:(source:ObservationSource,path:string,oldPath?:string)=>{
      const event=eventForSource[source];
      return Boolean(event&&active.some(ir=>eventTypes(ir).includes(event)
        && (inScope(ir,path)||(oldPath!==undefined&&inScope(ir,oldPath)))));
    },
  };
}
