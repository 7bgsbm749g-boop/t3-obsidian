import {contentHash} from './completion';

export type WorkflowEvent = 'create'|'modify';
export type WorkflowRunState = 'queued'|'running'|'settling'|'completed'|'failed'|'conflicted';

export interface FolderWorkflow {
  id:string;
  name:string;
  folderPath:string;
  includeSubfolders:boolean;
  events:WorkflowEvent[];
  task:string;
  connectionId:string;
  projectId:string;
  deviceId:string;
  enabled:boolean;
}

export interface WorkflowRun {
  id:string;
  workflowId:string;
  notePath:string;
  inputHash:string;
  requestId:string;
  state:WorkflowRunState;
  createdAt:number;
  updatedAt:number;
  threadId?:string;
  outputHash?:string;
  detail?:string;
  observedHashes?:string[];
  /** Runs created by one file event share a batch and execute in sequence order. */
  batchId?:string;
  sequence?:number;
}

export interface WorkflowNote {path:string;content:string;mtime:number}
export interface WorkflowHost {
  deviceId:string;
  getWorkflows():FolderWorkflow[];
  getRuns():WorkflowRun[];
  read(path:string):Promise<WorkflowNote|undefined>;
  save():Promise<void>;
  send(note:WorkflowNote,workflow:FolderWorkflow,requestId:string,inputHash:string):Promise<{threadId:string}>;
  status(run:WorkflowRun):Promise<'wait'|'complete'|'failed'>;
  isStopped():boolean;
  report(message:string):void;
  now?():number;
  id?():string;
}

const clean=(path:string)=>path.replace(/\\/g,'/').replace(/^\/+|\/+$/g,'');

export function normalizeWorkflow(value:FolderWorkflow):FolderWorkflow {
  const folderPath=value.folderPath==='/'?'/':clean(value.folderPath);
  const events=[...new Set((value.events??[]).filter((event):event is WorkflowEvent=>event==='create'||event==='modify'))];
  const workflow:FolderWorkflow={id:value.id?.trim(),name:value.name?.trim(),folderPath,includeSubfolders:value.includeSubfolders===true,events,task:value.task?.trim(),connectionId:value.connectionId?.trim(),projectId:value.projectId?.trim(),deviceId:value.deviceId?.trim(),enabled:value.enabled===true};
  if(!workflow.id||!workflow.name||!workflow.folderPath||(workflow.folderPath!=='/'&&workflow.folderPath.split('/').some(part=>!part||part==='.'||part==='..'))||!workflow.task||!workflow.projectId||!workflow.deviceId||!workflow.events.length)throw Error('Complete the workflow name, trigger, task, destination, and device.');
  return workflow;
}

export function loadWorkflows(data:any):FolderWorkflow[]{
  const result:FolderWorkflow[]=[];
  for(const item of Array.isArray(data?.folderWorkflows)?data.folderWorkflows:[])try{result.push(normalizeWorkflow(item));}catch{/* Malformed synced rules stay inert. */}
  return result;
}

/** Reorder only this folder's slots, without changing workflow definitions. */
export function reorderFolderWorkflows(workflows:FolderWorkflow[],folderPath:string,ids:string[],previous:string[]):FolderWorkflow[]{
  const current=workflows.filter(workflow=>workflow.folderPath===folderPath);
  if(current.length!==previous.length||current.some((workflow,index)=>workflow.id!==previous[index]))throw Error('The workflows changed while this menu was open. Reopen the menu and try again.');
  const byId=new Map(current.map(workflow=>[workflow.id,workflow]));
  if(ids.length!==current.length||new Set(ids).size!==ids.length||ids.some(id=>!byId.has(id)))throw Error('The workflow order is invalid. Reopen the menu and try again.');
  let index=0;return workflows.map(workflow=>workflow.folderPath===folderPath?byId.get(ids[index++])!:workflow);
}

export function workflowsForPath(workflows:FolderWorkflow[],path:string,event:WorkflowEvent,deviceId:string):FolderWorkflow[] {
  const candidates=workflows.filter(workflow=>{
    if(workflow.folderPath==='/')return workflow.includeSubfolders||!path.includes('/');
    const parent=path.split('/').slice(0,-1).join('/');
    return parent===workflow.folderPath||(workflow.includeSubfolders&&path.startsWith(workflow.folderPath+'/'));
  });
  const ownerPath=candidates.sort((a,b)=>b.folderPath.length-a.folderPath.length)[0]?.folderPath;
  if(!ownerPath)return [];
  return candidates.filter(workflow=>workflow.folderPath===ownerPath&&workflow.enabled&&workflow.deviceId===deviceId&&workflow.events.includes(event));
}

/** Compatibility helper for callers that only need the first workflow. */
export function workflowForPath(workflows:FolderWorkflow[],path:string,event:WorkflowEvent,deviceId:string):FolderWorkflow|undefined {
  return workflowsForPath(workflows,path,event,deviceId)[0];
}

function randomId(){
  const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const hex=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

/** Event-driven workflow runner. It never scans, and uncertain sends remain durable for review. */
export class FolderWorkflowService {
  private timers=new Map<string,ReturnType<typeof setTimeout>>();
  private pendingEvents=new Map<string,WorkflowEvent>();
  private settling=new Map<string,ReturnType<typeof setTimeout>>();
  private stopped=false;
  private processing=new Set<string>();
  constructor(private host:WorkflowHost,private debounceMs=90_000,private settleMs=5_000){}

  schedule(path:string,event:WorkflowEvent,immediate=false):void {
    if(this.inactive()||!path.toLowerCase().endsWith('.md'))return;
    const active=this.host.getRuns().find(run=>run.notePath===path&&(run.state==='running'||run.state==='settling'));
    if(active){void this.observe(active,path);return;}
    if(this.host.getRuns().some(run=>run.notePath===path&&run.state==='queued'))return;
    const previous=this.pendingEvents.get(path);
    const selected=event==='modify'&&previous==='create'?'create':event;
    if(!previous&&!workflowsForPath(this.host.getWorkflows(),path,selected,this.host.deviceId).length)return;
    this.pendingEvents.set(path,selected);clearTimeout(this.timers.get(path));
    this.timers.set(path,setTimeout(()=>{this.timers.delete(path);const pending=this.pendingEvents.get(path)??selected;this.pendingEvents.delete(path);void this.processBatch(path,pending);},immediate?0:this.debounceMs));
  }

  runNow(path:string,workflowId:string):boolean {
    const workflow=this.host.getWorkflows().find(item=>item.id===workflowId&&item.enabled&&item.deviceId===this.host.deviceId);
    if(!workflow||!this.covers(workflow,path))return false;
    const event=workflow.events.includes('create')?'create':'modify';
    if(this.host.getRuns().some(run=>run.notePath===path&&['queued','running','settling'].includes(run.state)))return false;
    clearTimeout(this.timers.get(path));this.pendingEvents.delete(path);
    this.timers.set(path,setTimeout(()=>{this.timers.delete(path);void this.processBatch(path,event,[workflow],true);},0));
    return true;
  }

  async rename(oldPath:string,newPath:string):Promise<void>{
    const moved=(path:string)=>path===oldPath||path.startsWith(oldPath+'/');let changed=false;
    for(const [path,timer] of [...this.timers])if(moved(path)){const event=this.pendingEvents.get(path)??'modify';clearTimeout(timer);this.timers.delete(path);this.pendingEvents.delete(path);this.schedule(newPath+path.slice(oldPath.length),event);}
    for(const run of this.host.getRuns())if(moved(run.notePath)){run.notePath=newPath+run.notePath.slice(oldPath.length);changed=true;}
    if(changed)await this.host.save();
  }

  delete(path:string):void {
    for(const [pending,timer] of [...this.timers])if(pending===path||pending.startsWith(path+'/')){clearTimeout(timer);this.timers.delete(pending);this.pendingEvents.delete(pending);}
  }

  async poll():Promise<void>{
    for(const run of [...this.host.getRuns()])if(run.state==='running')try{
      const status=await this.host.status(run);if(status==='wait'||this.inactive())continue;
      if(status==='failed'){run.state='failed';run.detail='The T3 thread failed or was interrupted.';run.updatedAt=this.now();this.blockLaterRuns(run);await this.host.save();continue;}
      run.state='settling';run.updatedAt=this.now();await this.host.save();this.beginSettle(run);
    }catch(error){const detail=error instanceof Error?error.message:String(error);if(run.detail!==detail){run.detail=detail;await this.host.save();}}
  }

  async retry(run:WorkflowRun):Promise<void>{
    if(!['queued','failed','conflicted'].includes(run.state)||this.inactive())return;
    if(this.host.getRuns().some(item=>item!==run&&item.notePath===run.notePath&&(item.state==='running'||item.state==='settling')))throw Error('Another workflow is still running for this note.');
    if(run.batchId&&this.host.getRuns().some(item=>item.batchId===run.batchId&&(item.sequence??0)<(run.sequence??0)&&item.state!=='completed'))throw Error('Resolve the earlier workflow in this batch first.');
    const workflow=this.host.getWorkflows().find(item=>item.id===run.workflowId);const note=await this.host.read(run.notePath);
    if(!workflow||!note)throw Error('The workflow or note no longer exists.');
    const hash=contentHash(note.content);run.inputHash=hash;if(run.state!=='queued')run.requestId=this.makeId();run.state='queued';run.createdAt=run.updatedAt=this.now();delete run.detail;delete run.threadId;delete run.outputHash;run.observedHashes=[];
    await this.host.save();await this.dispatch(run,note,workflow);
  }

  stop(){this.stopped=true;for(const timer of [...this.timers.values(),...this.settling.values()])clearTimeout(timer);this.timers.clear();this.pendingEvents.clear();this.settling.clear();}
  private inactive(){return this.stopped||this.host.isStopped();}
  private now(){return this.host.now?.()??Date.now();}
  private makeId(){return this.host.id?.()??randomId();}
  private key(workflowId:string,path:string){return `${workflowId}\0${path}`;}
  private covers(workflow:FolderWorkflow,path:string){const parent=path.split('/').slice(0,-1).join('/');return workflow.folderPath==='/'?(workflow.includeSubfolders||!parent):parent===workflow.folderPath||(workflow.includeSubfolders&&path.startsWith(workflow.folderPath+'/'));}

  private async observe(run:WorkflowRun,path:string){
    const note=await this.host.read(path);if(!note)return;const hash=contentHash(note.content);
    if(hash!==run.inputHash&&!run.observedHashes?.includes(hash)){(run.observedHashes??=[]).push(hash);run.updatedAt=this.now();await this.host.save();}
    if(run.state==='settling')this.beginSettle(run);
  }

  private async processBatch(path:string,event:WorkflowEvent,explicit?:FolderWorkflow[],manual=false){
    if(this.processing.has(path)||this.inactive())return;this.processing.add(path);
    try{
      const note=await this.host.read(path);if(!note||!note.content.trim())return;const hash=contentHash(note.content);
      const available=(explicit??workflowsForPath(this.host.getWorkflows(),path,event,this.host.deviceId)).filter(workflow=>workflow.enabled&&workflow.deviceId===this.host.deviceId&&(manual||workflow.events.includes(event))&&this.covers(workflow,path));
      const workflows=available.filter(workflow=>!this.host.getRuns().some(run=>run.workflowId===workflow.id&&run.notePath===path&&run.state==='completed'&&(run.inputHash===hash||run.outputHash===hash)));
      const accepted:FolderWorkflow[]=[];
      for(const workflow of workflows){
        const recent=this.host.getRuns().filter(run=>run.workflowId===workflow.id&&run.notePath===path&&run.createdAt>=this.now()-600_000);
        if(recent.length>=3){const latest=recent.sort((a,b)=>b.createdAt-a.createdAt)[0];latest.state='failed';latest.detail='Circuit breaker: three runs started for this note within ten minutes. Dismiss a run before trying again.';latest.updatedAt=this.now();this.host.report(`${workflow.name}: ${latest.detail}`);}
        else accepted.push(workflow);
      }
      if(!accepted.length){await this.host.save();return;}
      const batchId=this.makeId(),createdAt=this.now();
      const runs=accepted.map((workflow,sequence):WorkflowRun=>({id:this.makeId(),workflowId:workflow.id,notePath:path,inputHash:hash,requestId:this.makeId(),state:'queued',createdAt,updatedAt:createdAt,observedHashes:[],batchId,sequence,...(sequence?{detail:'Waiting for the previous workflow in this batch.'}:{})}));
      this.host.getRuns().push(...runs);await this.host.save();
      const latest=await this.host.read(path);
      if(!latest||contentHash(latest.content)!==hash){for(const run of runs){run.state='failed';run.detail='The note changed before dispatch; no thread was started.';run.updatedAt=this.now();}await this.host.save();this.schedule(path,event);return;}
      await this.dispatch(runs[0],latest,accepted[0]);
    }catch(error){this.host.report(`Folder workflow: ${error instanceof Error?error.message:String(error)}`);}
    finally{this.processing.delete(path);}
  }

  private async dispatch(run:WorkflowRun,note:WorkflowNote,workflow:FolderWorkflow){
    try{const result=await this.host.send(note,workflow,run.requestId,run.inputHash);run.threadId=result.threadId;run.state='running';run.updatedAt=this.now();delete run.detail;}
    catch(error){run.state='failed';run.detail=error instanceof Error?error.message:String(error);run.updatedAt=this.now();this.blockLaterRuns(run);this.host.report(`${workflow.name} for ${run.notePath}: ${run.detail}`);}
    await this.host.save();
  }

  private beginSettle(run:WorkflowRun){
    const key=this.key(run.workflowId,run.notePath);clearTimeout(this.settling.get(key));
    this.settling.set(key,setTimeout(()=>{this.settling.delete(key);void this.finish(run);},this.settleMs));
  }

  private async finish(run:WorkflowRun){
    if(this.inactive()||run.state!=='settling')return;const note=await this.host.read(run.notePath);
    if(!note){run.state='failed';run.detail='The note was deleted before the workflow settled.';}
    else {const output=contentHash(note.content);run.outputHash=output;run.updatedAt=this.now();if((run.observedHashes?.length??0)>1){run.state='conflicted';run.detail='The note changed more than once while T3 was working. Review it before running again.';}else{run.state='completed';delete run.detail;}}
    if(run.state!=='completed'){this.blockLaterRuns(run);await this.host.save();return;}
    await this.host.save();await this.advanceBatch(run,note!);
  }

  private blockLaterRuns(run:WorkflowRun){
    if(!run.batchId)return;
    for(const later of this.host.getRuns())if(later.batchId===run.batchId&&(later.sequence??0)>(run.sequence??0)&&later.state==='queued')later.detail='Waiting for an earlier failed or conflicted workflow in this batch.';
  }

  private async advanceBatch(run:WorkflowRun,note:WorkflowNote){
    if(!run.batchId)return;
    const batch=this.host.getRuns().filter(item=>item.batchId===run.batchId).sort((a,b)=>(a.sequence??0)-(b.sequence??0));
    const next=batch.find(item=>(item.sequence??0)>(run.sequence??0)&&item.state==='queued');
    if(!next){const finalHash=contentHash(note.content);for(const item of batch)if(item.state==='completed')item.outputHash=finalHash;await this.host.save();return;}
    const workflow=this.host.getWorkflows().find(item=>item.id===next.workflowId);
    if(!workflow||!workflow.enabled||workflow.deviceId!==this.host.deviceId){next.state='failed';next.detail='This workflow was removed, paused, or moved to another device before its turn.';next.updatedAt=this.now();this.blockLaterRuns(next);await this.host.save();return;}
    next.inputHash=contentHash(note.content);next.updatedAt=this.now();next.observedHashes=[];delete next.detail;await this.host.save();
    const latest=await this.host.read(next.notePath);
    if(!latest||contentHash(latest.content)!==next.inputHash){next.state='conflicted';next.detail='The note changed between workflows. Review it before continuing the batch.';next.updatedAt=this.now();this.blockLaterRuns(next);await this.host.save();return;}
    await this.dispatch(next,latest,workflow);
  }
}
