import type {InlineActivity,InlineMessage,InlineThreadState,InlineTurn} from './inline-thread';

export const T3_PROTOCOL_VERSION=2;
export const T3_PROTOCOL_HEADER='x-t3-orchestration-protocol';
const array=(value:any):any[]=>Array.isArray(value)?value:[];
const active=(status:string)=>['preparing','starting','running','waiting'].includes(status);
const terminal=(status:string)=>['completed','failed','interrupted','cancelled','rolled_back','expired'].includes(status);
const runState=(status:string)=>status==='failed'?'error':['cancelled','rolled_back'].includes(status)?'interrupted':active(status)?'running':status;

/** The response model's historical `turnId` field now contains a T3 app run ID.
 * Provider turns and child nodes must never settle an app run. */
export function responseRun(run:any,messages:InlineMessage[]=[]):InlineTurn {
  return {turnId:run.id,state:runState(run.status),messageId:run.userMessageId,
    requestedAt:run.requestedAt,completedAt:run.completedAt,ordinal:run.ordinal,
    assistantMessageId:messages.filter(m=>m.role==='assistant'&&m.turnId===run.id).at(-1)?.id};
}
function sessionFor(run:any,runtimeMode?:string,lastError?:string){
  return {status:!run?'ready':active(run.status)?'running':run.status==='failed'?'error':['interrupted','cancelled','rolled_back'].includes(run.status)?'stopped':'ready',
    activeTurnId:run&&active(run.status)?run.id:null,runtimeMode,lastError:lastError??null};
}
export function normalizeV2ShellThread(thread:any){
  if(!Object.hasOwn(thread,'activeRunId'))return thread; // Internal fixtures / persisted display data.
  const request=thread.pendingRuntimeRequest;
  return {...thread,session:sessionFor(thread.activeRunId?{id:thread.activeRunId,status:thread.activityRunStatus??thread.status}:null,thread.runtimeMode,thread.lastError),
    latestTurn:thread.latestRunId?{turnId:thread.latestRunId,state:runState(thread.status),requestedAt:thread.latestRunRequestedAt,completedAt:thread.latestRunCompletedAt}:undefined,
    hasPendingApprovals:!!request&&!['user_input','user-input'].includes(request.kind),
    hasPendingUserInput:!!request&&['user_input','user-input'].includes(request.kind),backgroundLiveness:array(thread.pendingBackgroundTasks).length>0};
}

export function itemActivities(item:any,requests:Record<string,any>={}):InlineActivity[]{
  const at=item.startedAt??item.updatedAt,base={turnId:item.runId??null,createdAt:at,sequence:item.ordinal};
  if(item.type==='user_input_request'||item.type==='approval_request'){
    const request=requests[item.requestId],question=item.type==='user_input_request';
    if(!request)return []; // Controls need an authoritative response capability.
    const mode=item.responseMode==='message'||request?.responseCapability?.type==='message'?'message':undefined;
    const resumable=request?.responseCapability?.type!=='not_resumable';
    const pending=resumable&&(request?request.status==='pending':!terminal(item.status));
    const kind=question?'user-input':'approval';
    const payload={requestId:item.requestId,questions:item.questions??[],requestKind:item.requestKind,
      responseMode:mode,detail:item.prompt,options:item.options,appName:item.appName,decision:request.decision,answers:item.questionAnswer?.answers??request?.answers};
    const result:InlineActivity[]=[{...base,id:`v2:${item.id}:requested`,kind:`${kind}.requested`,summary:question?'Answer needed':'Approval needed',payload}];
    if(!pending)result.push({...base,createdAt:request?.resolvedAt??item.completedAt??item.updatedAt,id:`v2:${item.id}:resolved`,kind:`${kind}.resolved`,summary:'Request closed',payload});
    return result;
  }
  if(['user_message','assistant_message','reasoning','checkpoint'].includes(item.type))return [];
  const status=terminal(item.status)?item.status==='failed'?'failed':item.status==='interrupted'||item.status==='cancelled'?'stopped':'completed':'inProgress';
  if(['compaction','proposed_plan','todo_list','notification','error'].includes(item.type))return [{...base,id:`v2:${item.id}`,
    kind:item.type==='compaction'?'context-compaction':['proposed_plan','todo_list'].includes(item.type)?'response.plan':'response.notification',
    summary:item.title??item.type.replace(/_/g,' '),payload:{status,text:item.text??item.summary??item.failure?.message,steps:item.steps,error:item.type==='error'}}];
  return [{...base,id:`v2:${item.id}`,kind:terminal(item.status)?'tool.completed':'tool.updated',summary:item.title??item.toolName??item.type.replace(/_/g,' '),
    payload:{toolCallId:item.id,itemType:item.type,status,title:item.title??item.toolName,
      files:item.fileName?[item.fileName]:undefined,data:{toolName:item.toolName??item.type,kind:item.type,
        input:item.type==='command_execution'?{command:item.input}:item.input,
        command:item.type==='command_execution'?item.input:undefined,
        output:item.output??(item.outputOmitted?'Output details are not available yet.':undefined),exitCode:item.exitCode,path:item.fileName??item.viewedImagePath,
        item:{aggregatedOutput:item.output,exitCode:item.exitCode}}}}];
}

export function normalizeV2Snapshot(snapshot:any){
  if(!snapshot?.projection){
    return Array.isArray(snapshot?.threads)?{...snapshot,threads:snapshot.threads.map(normalizeV2ShellThread)}:snapshot;
  }
  const p=snapshot.projection;
  if(!p.thread?.id||!Array.isArray(p.messages)||!Array.isArray(p.runs))throw Error('T3 returned an invalid v2 thread projection.');
  const messages:InlineMessage[]=p.messages.map((m:any)=>({...m,turnId:m.runId??null}));
  for(const item of array(p.turnItems))if(item.type==='reasoning')messages.push({id:`reasoning:${item.id}`,role:'reasoning',turnId:item.runId??null,text:item.text,streaming:item.streaming,createdAt:item.startedAt??item.updatedAt});
  const runs=[...p.runs].sort((a,b)=>a.ordinal-b.ordinal),current=runs.filter(r=>r.status!=='queued').at(-1)??runs.at(-1);
  const running=runs.filter(r=>active(r.status)).at(-1);
  const requests=Object.fromEntries(array(p.runtimeRequests).map(r=>[r.id,r]));
  const items=array(p.turnItems),controls=items.filter(i=>['user_input_request','approval_request'].includes(i.type));
  const activities=items.flatMap(i=>itemActivities(i,requests));
  const pending=controls.filter(i=>itemActivities(i,requests).length===1);
  const failure=items.filter(i=>i.type==='error'&&i.runId===current?.id).at(-1)?.failure;
  const backgroundLiveness=items.some(i=>['subagent','background_task','background_command','monitor'].includes(i.type)&&!terminal(i.status));
  return {snapshotSequence:snapshot.snapshotSequence,page:{hasMore:snapshot.hasMoreHistory===true},
    thread:{...p.thread,protocolVersion:2,messages,activities,
      turns:Object.fromEntries(runs.map(r=>[r.id,responseRun(r,messages)])),latestTurn:current?responseRun(current,messages):undefined,
      session:sessionFor(running??current,p.thread.runtimeMode,failure?.message),
      hasPendingApprovals:pending.some(i=>i.type==='approval_request'),hasPendingUserInput:pending.some(i=>i.type==='user_input_request'),backgroundLiveness,
      v2Requests:requests,v2Controls:Object.fromEntries(controls.map(i=>[i.id,i])),
      legacyMessageIds:p.thread.historyOrigin==='v1_import'?p.messages.filter((m:any)=>m.runId===null).map((m:any)=>m.id):[],
      checkpoints:[]}};
}

/** Normalize only wire envelopes and full-value events. Keep server sequence
 * numbers for unknown events, too, so reconnect never replays a stale cursor. */
export function normalizeV2StreamItem(item:any):any {
  if(item?.kind==='snapshot'&&item.projection)return {kind:'snapshot',snapshot:normalizeV2Snapshot(item)};
  if(item?.kind==='unknown-event')return {kind:'event',event:{sequence:item.sequence,type:'v2.unknown',payload:{}}};
  if(item?.kind!=='event'||item.sequence===undefined)return item;
  const event={...item.event,sequence:item.sequence},p=event.payload;
  if(event.type==='thread.updated')return {kind:'event',event:{...event,type:'thread.metadata-updated'}};
  if(event.type==='message.updated')return {kind:'event',event:{...event,type:'thread.message-sent',payload:{...p,messageId:p.id,turnId:p.runId??null,replace:true}}};
  if(event.type==='run.created'||event.type==='run.updated')return {kind:'event',event:{...event,type:'thread.run-updated'}};
  if(event.type==='turn-item.updated'||event.type==='runtime-request.updated')return {kind:'event',event:{...event,type:`v2.${event.type}`}};
  return {kind:'event',event};
}

/** Updates requiring both a turn item and its runtime capability are joined by
 * app IDs. Either event may arrive first; closed requests stay closed. */
export function applyV2ControlEvent(state:InlineThreadState,event:any):InlineThreadState {
  const p=event.payload,requests={...state.v2Requests},controls={...state.v2Controls};
  if(event.type==='v2.runtime-request.updated')requests[p.id]=p;
  else if(['user_input_request','approval_request'].includes(p.type))controls[p.id]=p;
  if(event.type==='v2.turn-item.updated'&&p.type==='reasoning'){
    const message:InlineMessage={id:`reasoning:${p.id}`,role:'reasoning',turnId:p.runId??null,text:p.text,streaming:p.streaming,createdAt:p.startedAt??p.updatedAt};
    return {...state,messages:state.messages.some(m=>m.id===message.id)?state.messages.map(m=>m.id===message.id?message:m):[...state.messages,message]};
  }
  const items=event.type==='v2.runtime-request.updated'?Object.values(controls).filter(i=>i.requestId===p.id):[p];
  const updates=items.flatMap(i=>itemActivities(i,requests)),ids=new Set(updates.map(i=>i.id));
  return {...state,v2Requests:requests,v2Controls:controls,activities:[...state.activities.filter(a=>!ids.has(a.id)),...updates]};
}

/** Convert saved v1 command vocabulary at the transport boundary. No provider
 * ID lookup or permission override is inferred during this conversion. */
export function v2Command(command:any):any {
  const {createdAt:_createdAt,...c}=command;
  if(c.type==='thread.create')return {...c,createdBy:c.createdBy??'user',creationSource:c.creationSource??'web'};
  if(c.type==='thread.turn.start'){
    const {message,runtimeMode:_runtimeMode,interactionMode:_interactionMode,...rest}=c;
    return {...rest,type:'message.dispatch',messageId:message.messageId,text:message.text,attachments:message.attachments??[],
      ...(message.context?{context:message.context}:{}),createdBy:'user',creationSource:'web',deliveryIntent:'auto',dispatchMode:{type:'start_immediately'}};
  }
  if(c.type==='thread.turn.interrupt'){
    const {turnId,...rest}=c;return {...rest,type:'run.interrupt',runId:turnId,holdQueue:true};
  }
  if(c.type==='thread.approval.respond'||c.type==='thread.user-input.respond')return {...c,type:'runtime-request.respond'};
  if(c.type==='project.meta.update')return {...c,type:'project.update'};
  return c;
}
