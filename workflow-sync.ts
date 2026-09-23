import {loadWorkflows,type FolderWorkflow} from './workflow';

export interface WorkflowStamp {revision:number;deviceId:string;updatedAt:number}
export interface WorkflowSyncMetadata {
  schema:1;
  clock:number;
  records:Record<string,WorkflowStamp>;
  tombstones:Record<string,WorkflowStamp>;
  order:{ids:string[];stamp:WorkflowStamp};
}
export interface WorkflowReplica {workflows:FolderWorkflow[];sync:WorkflowSyncMetadata}
export interface WorkflowChanges {upserts:FolderWorkflow[];deletes:string[];order?:string[]}

const legacyStamp=():WorkflowStamp=>({revision:0,deviceId:'',updatedAt:0});
const copy=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
const validStamp=(value:any):value is WorkflowStamp=>Number.isSafeInteger(value?.revision)&&value.revision>=0&&typeof value?.deviceId==='string'&&Number.isFinite(value?.updatedAt)&&value.updatedAt>=0;
const compareStamp=(left:WorkflowStamp,right:WorkflowStamp)=>left.revision-right.revision||(left.deviceId<right.deviceId?-1:left.deviceId>right.deviceId?1:0);
const same=(left:unknown,right:unknown)=>JSON.stringify(left)===JSON.stringify(right);

function metadata(value:any):WorkflowSyncMetadata {
  const records:Record<string,WorkflowStamp>={},tombstones:Record<string,WorkflowStamp>={};
  if(value?.schema===1){
    for(const [id,stamp] of Object.entries(value.records??{}))if(id&&validStamp(stamp))records[id]=copy(stamp);
    for(const [id,stamp] of Object.entries(value.tombstones??{}))if(id&&validStamp(stamp))tombstones[id]=copy(stamp);
  }
  const orderStamp=validStamp(value?.order?.stamp)?copy(value.order.stamp):legacyStamp();
  const orderIds:string[]=Array.isArray(value?.order?.ids)?(value.order.ids as unknown[]).filter((id):id is string=>typeof id==='string'&&id.length>0):[];
  const clock=Math.max(Number.isSafeInteger(value?.clock)&&value.clock>=0?value.clock:0,orderStamp.revision,...Object.values(records).map(stamp=>stamp.revision),...Object.values(tombstones).map(stamp=>stamp.revision));
  return {schema:1,clock,records,tombstones,order:{ids:[...new Set(orderIds)],stamp:orderStamp}};
}

/** Load the replicated workflow collection. A tombstone always wins a tied legacy record. */
export function loadWorkflowReplica(data:any):WorkflowReplica {
  const workflows=loadWorkflows(data),sync=metadata(data?.workflowSync),live:FolderWorkflow[]=[];
  for(const workflow of workflows){
    sync.records[workflow.id]??=legacyStamp();
    const deleted=sync.tombstones[workflow.id];
    if(!deleted||compareStamp(sync.records[workflow.id],deleted)>0)live.push(workflow);
  }
  const ids=live.map(workflow=>workflow.id),known=new Set(ids);
  sync.order.ids=[...sync.order.ids.filter(id=>known.has(id)),...ids.filter(id=>!sync.order.ids.includes(id))];
  const byId=new Map(live.map(workflow=>[workflow.id,workflow]));
  return {workflows:sync.order.ids.map(id=>byId.get(id)!).filter(Boolean),sync};
}

/** Determine only the user's actual workflow edits since the last merged replica. */
export function workflowChanges(base:WorkflowReplica,desired:FolderWorkflow[]):WorkflowChanges {
  const before=new Map(base.workflows.map(workflow=>[workflow.id,workflow])),after=new Map(desired.map(workflow=>[workflow.id,workflow]));
  const upserts=desired.filter(workflow=>!before.has(workflow.id)||!same(before.get(workflow.id),workflow));
  const deletes=base.workflows.filter(workflow=>!after.has(workflow.id)).map(workflow=>workflow.id);
  const oldOrder=base.workflows.map(workflow=>workflow.id),newOrder=desired.map(workflow=>workflow.id);
  return {upserts:copy(upserts),deletes,...(!same(oldOrder,newOrder)?{order:[...newOrder]}:{})};
}

function combine(base:WorkflowReplica,external:WorkflowReplica):WorkflowReplica {
  const candidates=new Map<string,{workflow?:FolderWorkflow;stamp:WorkflowStamp;deleted:boolean;external:boolean}>();
  const consider=(id:string,workflow:FolderWorkflow|undefined,stamp:WorkflowStamp,deleted:boolean,isExternal:boolean)=>{
    const current=candidates.get(id),comparison=current?compareStamp(stamp,current.stamp):1;
    // On equal revisions deletion is safest; otherwise the freshly read disk value wins.
    if(!current||comparison>0||(comparison===0&&(deleted&&!current.deleted||deleted===current.deleted&&isExternal)))candidates.set(id,{workflow,stamp,deleted,external:isExternal});
  };
  for(const [isExternal,replica] of [[false,base],[true,external]] as const){
    const byId=new Map(replica.workflows.map(workflow=>[workflow.id,workflow]));
    for(const [id,workflow] of byId)consider(id,workflow,replica.sync.records[id]??legacyStamp(),false,isExternal);
    for(const [id,stamp] of Object.entries(replica.sync.tombstones))consider(id,undefined,stamp,true,isExternal);
  }
  const records:Record<string,WorkflowStamp>={},tombstones:Record<string,WorkflowStamp>={},live=new Map<string,FolderWorkflow>();
  for(const [id,candidate] of candidates){
    if(candidate.deleted)tombstones[id]=copy(candidate.stamp);
    else if(candidate.workflow){records[id]=copy(candidate.stamp);live.set(id,copy(candidate.workflow));}
  }
  const orderSource=compareStamp(external.sync.order.stamp,base.sync.order.stamp)>=0?external:base;
  const preferred=orderSource.sync.order.ids,secondary=orderSource===external?base.sync.order.ids:external.sync.order.ids;
  const ids=[...preferred,...secondary,...live.keys()].filter((id,index,list)=>live.has(id)&&list.indexOf(id)===index);
  const orderStamp=copy(orderSource.sync.order.stamp),clock=Math.max(base.sync.clock,external.sync.clock,orderStamp.revision,...Object.values(records).map(stamp=>stamp.revision),...Object.values(tombstones).map(stamp=>stamp.revision));
  return {workflows:ids.map(id=>live.get(id)!),sync:{schema:1,clock,records,tombstones,order:{ids,stamp:orderStamp}}};
}

/** Merge disk and memory, then apply explicit local edits above the merged logical clock. */
export function mergeWorkflowReplicas(base:WorkflowReplica,external:WorkflowReplica,changes:WorkflowChanges,deviceId:string,now=Date.now()):WorkflowReplica {
  const merged=combine(base,external),live=new Map(merged.workflows.map(workflow=>[workflow.id,workflow]));
  const stamp=():WorkflowStamp=>({revision:++merged.sync.clock,deviceId,updatedAt:now});
  for(const id of changes.deletes){const next=stamp();live.delete(id);delete merged.sync.records[id];merged.sync.tombstones[id]=next;}
  for(const workflow of changes.upserts){const next=stamp();live.set(workflow.id,copy(workflow));merged.sync.records[workflow.id]=next;delete merged.sync.tombstones[workflow.id];}
  let ids=merged.workflows.map(workflow=>workflow.id).filter(id=>live.has(id));
  for(const id of live.keys())if(!ids.includes(id))ids.push(id);
  if(changes.order){const requested=changes.order.filter(id=>live.has(id));ids=[...requested,...ids.filter(id=>!requested.includes(id))];merged.sync.order={ids:[...ids],stamp:stamp()};}
  else merged.sync.order.ids=[...ids];
  merged.workflows=ids.map(id=>live.get(id)!);
  return merged;
}

export function sameWorkflowReplica(left:WorkflowReplica,right:WorkflowReplica):boolean {return same(left,right);}
