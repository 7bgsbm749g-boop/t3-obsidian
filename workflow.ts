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

export function workflowForPath(workflows:FolderWorkflow[],path:string,event:WorkflowEvent,deviceId:string):FolderWorkflow|undefined {
  const candidates=workflows.filter(workflow=>{
    if(workflow.folderPath==='/')return workflow.includeSubfolders||!path.includes('/');
    const parent=path.split('/').slice(0,-1).join('/');
    return parent===workflow.folderPath||(workflow.includeSubfolders&&path.startsWith(workflow.folderPath+'/'));
  });
  const owner=candidates.sort((a,b)=>b.folderPath.length-a.folderPath.length)[0];
  return owner?.enabled&&owner.deviceId===deviceId&&owner.events.includes(event)?owner:undefined;
}

function randomId(){
  const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const hex=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

/** Event-driven workflow runner. It never scans, and uncertain sends remain durable for review. */
export class FolderWorkflowService {
  private timers=new Map<string,ReturnType<typeof setTimeout>>();
  private settling=new Map<string,ReturnType<typeof setTimeout>>();
  private stopped=false;
  private processing=new Set<string>();
  constructor(private host:WorkflowHost,private debounceMs=90_000,private settleMs=5_000){}

  schedule(path:string,event:WorkflowEvent,immediate=false):void {
    if(this.inactive()||!path.toLowerCase().endsWith('.md'))return;
    const anyActive=this.host.getRuns().find(run=>run.notePath===path&&['queued','running','settling'].includes(run.state));
    if(anyActive){void this.observe(anyActive,path);return;}
    if(event==='modify')for(const [key,timer] of [...this.timers])if(key.endsWith(`\0${path}`)){
      const workflowId=key.slice(0,key.indexOf('\0'));clearTimeout(timer);
      this.timers.set(key,setTimeout(()=>{this.timers.delete(key);void this.process(path,'create',workflowId);},immediate?0:this.debounceMs));return;
    }
    const workflow=workflowForPath(this.host.getWorkflows(),path,event,this.host.deviceId);if(!workflow)return;
    const key=this.key(workflow.id,path);
    clearTimeout(this.timers.get(key));
    this.timers.set(key,setTimeout(()=>{this.timers.delete(key);void this.process(path,event,workflow.id);},immediate?0:this.debounceMs));
  }

  runNow(path:string,workflowId:string):boolean {
    const workflow=this.host.getWorkflows().find(item=>item.id===workflowId&&item.enabled&&item.deviceId===this.host.deviceId);
    if(!workflow||!this.covers(workflow,path))return false;
    const event=workflow.events.includes('create')?'create':'modify';
    const key=this.key(workflow.id,path);clearTimeout(this.timers.get(key));
    this.timers.set(key,setTimeout(()=>{this.timers.delete(key);void this.process(path,event,workflow.id,true);},0));
    return true;
  }

  async rename(oldPath:string,newPath:string):Promise<void>{
    const moved=(path:string)=>path===oldPath||path.startsWith(oldPath+'/');let changed=false;
    for(const [key,timer] of [...this.timers]){const split=key.indexOf('\0'),path=key.slice(split+1);if(moved(path)){clearTimeout(timer);this.timers.delete(key);const destination=newPath+path.slice(oldPath.length);this.schedule(destination,'create');this.schedule(destination,'modify');}}
    for(const run of this.host.getRuns())if(moved(run.notePath)){run.notePath=newPath+run.notePath.slice(oldPath.length);changed=true;}
    if(changed)await this.host.save();
  }

  delete(path:string):void {
    for(const [key,timer] of [...this.timers])if(key.endsWith(`\0${path}`)||key.includes(`\0${path}/`)){clearTimeout(timer);this.timers.delete(key);}
  }

  async poll():Promise<void>{
    for(const run of [...this.host.getRuns()])if(run.state==='running')try{
      const status=await this.host.status(run);if(status==='wait'||this.inactive())continue;
      if(status==='failed'){run.state='failed';run.detail='The T3 thread failed or was interrupted.';run.updatedAt=this.now();await this.host.save();continue;}
      run.state='settling';run.updatedAt=this.now();await this.host.save();this.beginSettle(run);
    }catch(error){const detail=error instanceof Error?error.message:String(error);if(run.detail!==detail){run.detail=detail;await this.host.save();}}
  }

  async retry(run:WorkflowRun):Promise<void>{
    if(!['queued','failed','conflicted'].includes(run.state)||this.inactive())return;
    const workflow=this.host.getWorkflows().find(item=>item.id===run.workflowId);const note=await this.host.read(run.notePath);
    if(!workflow||!note)throw Error('The workflow or note no longer exists.');
    const hash=contentHash(note.content);run.inputHash=hash;if(run.state!=='queued')run.requestId=this.makeId();run.state='queued';run.createdAt=run.updatedAt=this.now();delete run.detail;delete run.threadId;delete run.outputHash;run.observedHashes=[];
    await this.host.save();await this.dispatch(run,note,workflow);
  }

  stop(){this.stopped=true;for(const timer of [...this.timers.values(),...this.settling.values()])clearTimeout(timer);this.timers.clear();this.settling.clear();}
  private inactive(){return this.stopped||this.host.isStopped();}
  private now(){return this.host.now?.()??Date.now();}
  private makeId(){return this.host.id?.()??randomId();}
  private key(workflowId:string,path:string){return `${workflowId}\0${path}`;}
  private covers(workflow:FolderWorkflow,path:string){const parent=path.split('/').slice(0,-1).join('/');return workflow.folderPath==='/'?(workflow.includeSubfolders||!parent):parent===workflow.folderPath||(workflow.includeSubfolders&&path.startsWith(workflow.folderPath+'/'));}
  private active(workflowId:string,path:string){return this.host.getRuns().find(run=>run.workflowId===workflowId&&run.notePath===path&&['queued','running','settling'].includes(run.state));}

  private async observe(run:WorkflowRun,path:string){
    const note=await this.host.read(path);if(!note)return;const hash=contentHash(note.content);
    if(hash!==run.inputHash&&!run.observedHashes?.includes(hash)){(run.observedHashes??=[]).push(hash);run.updatedAt=this.now();await this.host.save();}
    if(run.state==='settling')this.beginSettle(run);
  }

  private async process(path:string,event:WorkflowEvent,workflowId:string,manual=false){
    const key=this.key(workflowId,path);if(this.processing.has(key)||this.inactive())return;this.processing.add(key);
    try{
      const workflow=this.host.getWorkflows().find(item=>item.id===workflowId);
      if(!workflow||!workflow.enabled||workflow.deviceId!==this.host.deviceId||(!manual&&!workflow.events.includes(event))||!this.covers(workflow,path))return;
      const note=await this.host.read(path);if(!note||!note.content.trim())return;const hash=contentHash(note.content);
      if(this.host.getRuns().some(run=>run.workflowId===workflow.id&&run.notePath===path&&run.state==='completed'&&(run.inputHash===hash||run.outputHash===hash)))return;
      const recent=this.host.getRuns().filter(run=>run.workflowId===workflow.id&&run.notePath===path&&run.createdAt>=this.now()-600_000);
      if(recent.length>=3){const latest=recent.sort((a,b)=>b.createdAt-a.createdAt)[0];latest.state='failed';latest.detail='Circuit breaker: three runs started for this note within ten minutes. Dismiss a run before trying again.';latest.updatedAt=this.now();await this.host.save();this.host.report(`${workflow.name}: ${latest.detail}`);return;}
      const run:WorkflowRun={id:this.makeId(),workflowId:workflow.id,notePath:path,inputHash:hash,requestId:this.makeId(),state:'queued',createdAt:this.now(),updatedAt:this.now(),observedHashes:[]};
      this.host.getRuns().push(run);await this.host.save();
      const latest=await this.host.read(path);
      if(!latest||contentHash(latest.content)!==hash){run.state='failed';run.detail='The note changed before dispatch; no thread was started.';run.updatedAt=this.now();await this.host.save();this.schedule(path,event);return;}
      await this.dispatch(run,latest,workflow);
    }catch(error){this.host.report(`Folder workflow: ${error instanceof Error?error.message:String(error)}`);}
    finally{this.processing.delete(key);}
  }

  private async dispatch(run:WorkflowRun,note:WorkflowNote,workflow:FolderWorkflow){
    try{const result=await this.host.send(note,workflow,run.requestId,run.inputHash);run.threadId=result.threadId;run.state='running';run.updatedAt=this.now();delete run.detail;}
    catch(error){run.state='failed';run.detail=error instanceof Error?error.message:String(error);run.updatedAt=this.now();this.host.report(`${workflow.name} for ${run.notePath}: ${run.detail}`);}
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
    await this.host.save();
  }
}
