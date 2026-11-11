import {readThreadStreamItem,type ThreadStreamItem} from './thread-events';
import {outgoingMessage} from './send-contracts';
import {isRecord} from '../shared/values';
import type {WireRun,WireRuntimeRequest,WireTurnItem,WireThread,WireSnapshot,ThreadSnapshot,V2ControlEvent} from './wire-types';
import type {InlineActivity,InlineMessage,InlineThreadState,InlineTurn,InlineSubagent} from '../conversations/inline-thread';
import {htmlRenderFromToolItem} from '../responses/html-results';
import {worktreeHandoff,mergeWorktreeHandoffs} from '../conversations/inline-worktree';
import {workspacePreparation} from '../projects/worktree-setup';

export const T3_PROTOCOL_VERSION=2;
export const T3_PROTOCOL_HEADER='x-t3-orchestration-protocol';
const array=<T>(value:readonly T[]|null|undefined):T[]=>Array.isArray(value)?value as T[]:[];
/** Restore the public dedupeBodies wire format before reducers see it. Only
 * equal bodies are omitted by T3; missing source records remain an error. */
function restoreSnapshotBodies(snapshot:WireSnapshot):WireSnapshot {
 const p=snapshot.projection;if(!p)return snapshot;
 const messages=new Map(p.messages.map(message=>[message.id,message.text]));
 const extra=p as typeof p&Record<string,unknown>;
 const checkpoints=Array.isArray(extra.checkpoints)?extra.checkpoints:[];
 const mapped=new Map<WireTurnItem,WireTurnItem>();
 const restore=(item:WireTurnItem)=>{
  const cached=mapped.get(item);if(cached)return cached;
  const value=item as WireTurnItem&Record<string,unknown>,next={...value};let changed=false;
  const copy=(marker:string,field:string,body:unknown)=>{
   if(value[marker]!==true)return;
   if(body===undefined)throw Error('T3 omitted a response body without its source record.');
   next[field]=body;delete next[marker];changed=true;
  };
  if(['user_message','assistant_message'].includes(item.type))copy('textOmitted','text',messages.get(item.messageId??''));
  if(item.type==='checkpoint'){
   const source:unknown=checkpoints.find((entry:unknown)=>isRecord(entry)&&entry.id===value.checkpointId);
   copy('filesOmitted','files',isRecord(source)?source.files:undefined);
  }
  if(item.type==='subagent'){
   const source=array(p.subagents).find(entry=>entry.id===value.subagentId);
   copy('promptOmitted','prompt',isRecord(source)&&source.promptOmitted!==true?source.prompt:undefined);
   copy('resultOmitted','result',isRecord(source)&&source.resultOmitted!==true?source.result:undefined);
  }
  const result=changed?next:item;mapped.set(item,result);return result;
 };
 return {...snapshot,projection:{...p,turnItems:array(p.turnItems).map(restore),visibleTurnItems:array(p.visibleTurnItems).map(row=>row.visibility==='local'||row.sourceThreadId===p.thread.id?{...row,item:restore(row.item)}:row)}};
}
/** Compact snapshots omit duplicate local entries, not their contents. Restore
 * the same item references before hydration, reducers or display consume them. */
export function restoreCompactSnapshot(snapshot:WireSnapshot):WireSnapshot {
 snapshot=restoreSnapshotBodies(snapshot);
  if(snapshot?.turnItemsOmitLocalVisible!==true||!snapshot.projection)return snapshot;
  const p=snapshot.projection,local=array(p.visibleTurnItems).filter(row=>row.visibility==='local'||row.sourceThreadId===p.thread?.id).map(row=>row.item);
  const items=[...new Map([...local,...array(p.turnItems)].map(item=>[item.id,item])).values()];
  return {...snapshot,turnItemsOmitLocalVisible:undefined,projection:{...p,turnItems:items}};
}
const active=(status:string)=>['preparing','starting','running','waiting'].includes(status);
const terminal=(status:string)=>['completed','failed','interrupted','cancelled','rolled_back','expired'].includes(status);
const runState=(status:string)=>status==='failed'?'error':['cancelled','rolled_back'].includes(status)?'interrupted':active(status)?'running':status;

/** The response model's historical `turnId` field now contains a T3 app run ID.
 * Provider turns and child nodes must never settle an app run. */
export function responseRun(run:WireRun,messages:InlineMessage[]=[]):InlineTurn {
  const parent=messages.find(m=>m.id===run.userMessageId)?.delegatedCompletion?.parentRunId;
  return {turnId:run.id,state:runState(run.status),messageId:run.userMessageId,
    requestedAt:run.requestedAt,startedAt:run.startedAt,completedAt:run.completedAt,ordinal:run.ordinal,
    ...(parent?{delegatedParentRunId:parent}:{}),...(Object.hasOwn(run,'delegatedCompletion')?{delegatedCompletion:run.delegatedCompletion}:{}),
    assistantMessageId:messages.filter(m=>m.role==='assistant'&&m.turnId===run.id).at(-1)?.id};
}
/** Retain lifecycle evidence without copying child prompts or results. */
export function responseSubagent(item:InlineSubagent):InlineSubagent {
  return {id:item.id,runId:item.runId,title:item.title,status:item.status,origin:item.origin,completionWake:item.completionWake,
    ...(item.completionDelivery?{completionDelivery:{state:item.completionDelivery.state,observedByRunId:item.completionDelivery.observedByRunId}}:{})};
}
function sessionFor(run:Pick<WireRun,'id'|'status'>|null|undefined,runtimeMode?:string,lastError?:string){
  return {status:!run?'ready':active(run.status)?'running':run.status==='failed'?'error':['interrupted','cancelled','rolled_back'].includes(run.status)?'stopped':'ready',
    activeTurnId:run&&active(run.status)?run.id:null,runtimeMode,lastError:lastError??null};
}
export function normalizeV2ShellThread(thread:WireThread){
  if(!Object.hasOwn(thread,'activeRunId'))return thread; // Internal fixtures / persisted display data.
  const request=thread.pendingRuntimeRequest;
  return {...thread,session:sessionFor(thread.activeRunId?{id:thread.activeRunId,status:thread.activityRunStatus??thread.status??''}:null,thread.runtimeMode,thread.lastError),
    latestTurn:thread.latestRunId?{turnId:thread.latestRunId,state:runState(thread.status??''),requestedAt:thread.latestRunRequestedAt,completedAt:thread.latestRunCompletedAt}:undefined,
    hasPendingApprovals:!!request&&!['user_input','user-input'].includes(request.kind),
    hasPendingUserInput:!!request&&['user_input','user-input'].includes(request.kind),backgroundLiveness:array(thread.pendingBackgroundTasks).length>0};
}

export function itemActivities(item:WireTurnItem,requests:Record<string,WireRuntimeRequest>={}):InlineActivity[]{
  const at=item.startedAt??item.updatedAt,base={turnId:item.runId??null,createdAt:at,sequence:item.ordinal};
  if(workspacePreparation(item))return [{...base,id:`v2:${item.id}`,kind:'response.worktree-setup',summary:'Worktree setup',payload:{status:terminal(item.status)?item.status==='completed'?'completed':item.status==='failed'?'failed':'stopped':'inProgress',completedAt:item.completedAt,output:item.output}}];
  const htmlRender=htmlRenderFromToolItem(item);
  if(htmlRender)return [{...base,id:`v2:${item.id}`,kind:'response.html',summary:htmlRender.title,payload:{itemId:item.id,revision:item.updatedAt,htmlRender}}];
  if(item.type==='user_input_request'||item.type==='approval_request'){
    const request=item.requestId?requests[item.requestId]:undefined,question=item.type==='user_input_request';
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
    summary:item.title??item.type.replace(/_/g,' '),payload:{status,completedAt:item.completedAt,beforeTokenCount:item.beforeTokenCount,afterTokenCount:item.afterTokenCount,text:item.text??item.summary??item.failure?.message,steps:item.steps,error:item.type==='error'}}];
  return [{...base,id:`v2:${item.id}`,kind:terminal(item.status)?'tool.completed':'tool.updated',summary:item.title??item.toolName??item.type.replace(/_/g,' '),
    payload:{toolCallId:item.id,itemType:item.type,status,title:item.title??item.toolName,
      files:item.fileName?[item.fileName]:undefined,data:{toolSource:item.toolSource,toolIcon:item.toolIcon,toolName:item.toolName??item.type,kind:item.type,
        input:item.type==='command_execution'?{command:item.input}:item.input,
        command:item.type==='command_execution'?item.input:undefined,
        output:item.output??(item.outputOmitted?'Output details are not available yet.':undefined),exitCode:item.exitCode,path:item.fileName??item.viewedImagePath,
        item:{aggregatedOutput:item.output,exitCode:item.exitCode}}}}];
}

export function normalizeV2Snapshot(snapshot:WireSnapshot):ThreadSnapshot;
export function normalizeV2Snapshot(snapshot:unknown):unknown;
export function normalizeV2Snapshot(input:unknown):unknown{
  if(!isRecord(input))return input;
  const snapshot=input;
  if(!snapshot?.projection){
    return Array.isArray(snapshot.threads)?{...snapshot,threads:snapshot.threads.map((thread:unknown)=>{if(!isRecord(thread))throw Error('Invalid T3 thread catalog.');return normalizeV2ShellThread(thread as unknown as WireThread);})}:snapshot;
  }
  if(!isRecord(snapshot.projection)||!isRecord(snapshot.projection.thread)||typeof snapshot.projection.thread.id!=='string'||!Array.isArray(snapshot.projection.messages)||!Array.isArray(snapshot.projection.runs))throw Error('T3 returned an invalid v2 thread projection.');
  const p=restoreCompactSnapshot(snapshot as unknown as WireSnapshot).projection;
  if(!p.thread?.id||!Array.isArray(p.messages)||!Array.isArray(p.runs))throw Error('T3 returned an invalid v2 thread projection.');
  const messageItems=new Map<string,WireTurnItem>(array(p.turnItems).filter(item=>item.type==='assistant_message').map(item=>[item.messageId!,item]));
  const messages:InlineMessage[]=p.messages.map(m=>{const item=messageItems.get(m.id);return {...m,turnId:m.runId??null,...(item?{itemId:item.id,updatedAt:item.updatedAt}:{})};});
  for(const item of array(p.turnItems))if(item.type==='reasoning')messages.push({id:`reasoning:${item.id}`,role:'reasoning',turnId:item.runId??null,text:item.text??'',streaming:item.streaming===true,sequence:item.ordinal,createdAt:item.startedAt??item.updatedAt});
  const runs=[...p.runs].sort((a,b)=>a.ordinal-b.ordinal),current=runs.filter(r=>r.status!=='queued').at(-1)??runs.at(-1);
  const running=runs.filter(r=>active(r.status)).at(-1);
  const requests=Object.fromEntries(array(p.runtimeRequests).map(r=>[r.id,r]));
  const items=array(p.turnItems),controls=items.filter(i=>['user_input_request','approval_request'].includes(i.type));
  const activities=items.flatMap(i=>itemActivities(i,requests));
  const pending=controls.filter(i=>itemActivities(i,requests).length===1);
  const failure=items.filter(i=>i.type==='error'&&i.runId===current?.id).at(-1)?.failure;
  const subagents:Record<string,InlineSubagent>=Object.fromEntries(array(p.subagents).map(item=>[item.id,responseSubagent(item)]));
  const backgroundLiveness=items.some(i=>['subagent','background_task','background_command','monitor'].includes(i.type)&&!terminal(i.status))||Object.values(subagents).some(i=>i.completionWake==='always'&&(!terminal(i.status)||i.completionDelivery?.state==='pending'));
  return {snapshotSequence:snapshot.snapshotSequence,page:{hasMore:snapshot.hasMoreHistory===true},
    thread:{...p.thread,protocolVersion:2,messages,activities,
      turns:Object.fromEntries(runs.map(r=>[r.id,responseRun(r,messages)])),subagents,
      worktreeHandoffs:Object.fromEntries(items.flatMap(item=>{const handoff=worktreeHandoff(item);return handoff?[[handoff.id,handoff]]:[];})),latestTurn:current?responseRun(current,messages):undefined,
      session:sessionFor(running??current,p.thread.runtimeMode,failure?.message),
      hasPendingApprovals:pending.some(i=>i.type==='approval_request'),hasPendingUserInput:pending.some(i=>i.type==='user_input_request'),backgroundLiveness,
      v2Requests:requests,v2Controls:Object.fromEntries(controls.map(i=>[i.id,i])),
      legacyMessageIds:p.thread.historyOrigin==='v1_import'?p.messages.filter(m=>m.runId===null).map(m=>m.id):[],
      checkpoints:[]}};
}

/** Normalize only wire envelopes and full-value events. Keep server sequence
 * numbers for unknown events, too, so reconnect never replays a stale cursor. */
export function normalizeV2StreamItem(input:unknown):ThreadStreamItem {
  if(!isRecord(input))throw Error('T3 returned an invalid stream item.');
  const item=input;
  if(item?.kind==='snapshot'&&item.projection)return readThreadStreamItem({kind:'snapshot',snapshot:normalizeV2Snapshot(item)});
  if(item.kind==='unknown-event')return readThreadStreamItem({kind:'event',event:{sequence:item.sequence,type:'v2.unknown',payload:{}}});
  if(item.kind!=='event'||item.sequence===undefined)return readThreadStreamItem(item);
  if(!isRecord(item.event))throw Error('T3 returned an invalid thread event.');
  const event:Record<string,unknown>={...item.event,sequence:item.sequence},p=isRecord(item.event.payload)?item.event.payload:{};
  if(event.type==='thread.updated')return readThreadStreamItem({kind:'event',event:{...event,type:'thread.metadata-updated'}});
  if(event.type==='message.updated')return readThreadStreamItem({kind:'event',event:{...event,type:'thread.message-sent',payload:{...p,messageId:p.id,turnId:p.runId??null,replace:true}}});
  if(event.type==='run.created'||event.type==='run.updated')return readThreadStreamItem({kind:'event',event:{...event,type:'thread.run-updated'}});
  if(event.type==='turn-item.updated'&&p?.type==='assistant_message')return readThreadStreamItem({kind:'event',event:{...event,type:'thread.message-sent',payload:{...p,id:p.messageId,messageId:p.messageId,itemId:p.id,role:'assistant',turnId:p.runId??null,createdAt:p.startedAt??p.updatedAt,replace:true}}});
  if(event.type==='turn-item.updated'||event.type==='runtime-request.updated'||event.type==='subagent.updated')return readThreadStreamItem({kind:'event',event:{...event,type:`v2.${event.type}`}});
  return readThreadStreamItem({kind:'event',event});
}

/** A title listener needs identity, title and cursor only. Do not normalize or
 * retain its duplicate transcript, tool output, runs or request controls. */
export function normalizeV2TitleItem(input:{kind:'event'|'unknown-event';[key:string]:unknown}):Extract<ThreadStreamItem,{kind:'event'}>;
export function normalizeV2TitleItem(input:{kind:'snapshot';[key:string]:unknown}):Extract<ThreadStreamItem,{kind:'snapshot'}>;
export function normalizeV2TitleItem(input:unknown):ThreadStreamItem;
export function normalizeV2TitleItem(input:unknown):ThreadStreamItem {
  if(!isRecord(input))throw Error('T3 returned an invalid title stream item.');
  const item=input;
  if(item?.kind==='snapshot'){
    const snapshot=item.projection?item:item.snapshot;
    if(!isRecord(snapshot))throw Error('T3 returned an invalid title snapshot.');
    const projection=isRecord(snapshot.projection)?snapshot.projection:undefined,thread=projection?.thread??snapshot.thread;
    if(!isRecord(thread)||typeof thread.id!=='string'||typeof thread.projectId!=='string')throw Error('T3 returned an invalid title snapshot.');
    return readThreadStreamItem({kind:'snapshot',snapshot:{snapshotSequence:snapshot.snapshotSequence,thread:{id:thread.id,projectId:thread.projectId,title:thread.title,protocolVersion:snapshot.projection?2:thread.protocolVersion,messages:[]}}});
  }
  if(item?.kind==='event'||item?.kind==='unknown-event'){
    const event=isRecord(item.event)?item.event:undefined,sequence=item.sequence??event?.sequence;
    const title=event?.type==='thread.updated'||event?.type==='thread.metadata-updated';
    return readThreadStreamItem({kind:'event',event:{sequence,type:title?'thread.metadata-updated':'v2.unknown',payload:title&&isRecord(event?.payload)?{title:event.payload.title}:{}}});
  }
  return readThreadStreamItem(item);
}

/** Updates requiring both a turn item and its runtime capability are joined by
 * app IDs. Either event may arrive first; closed requests stay closed. */
export function applyV2ControlEvent(state:InlineThreadState,input:unknown):InlineThreadState {
  if(!isRecord(input)||!isRecord(input.payload)||typeof input.payload.id!=='string'||typeof input.type!=='string'||!['v2.subagent.updated','v2.runtime-request.updated','v2.turn-item.updated'].includes(input.type))return state;
  const event=input as unknown as V2ControlEvent;
  if(event.type==='v2.subagent.updated')return {...state,subagents:{...state.subagents,[event.payload.id]:responseSubagent(event.payload)}};
  const requests={...state.v2Requests},controls={...state.v2Controls};
  let items:WireTurnItem[];
  if(event.type==='v2.runtime-request.updated'){
    const request=event.payload;requests[request.id]=request;items=Object.values(controls).filter(item=>item.requestId===request.id);
  }else{
    const item=event.payload,handoff=worktreeHandoff(item);
    if(handoff)state={...state,worktreeHandoffs:mergeWorktreeHandoffs(state.worktreeHandoffs,{[handoff.id]:handoff})};
    if(['user_input_request','approval_request'].includes(item.type))controls[item.id]=item;
    if(item.type==='reasoning'){
      const message:InlineMessage={id:`reasoning:${item.id}`,role:'reasoning',turnId:item.runId??null,text:item.text??'',streaming:item.streaming===true,sequence:item.ordinal,createdAt:item.startedAt??item.updatedAt};
      return {...state,messages:state.messages.some(m=>m.id===message.id)?state.messages.map(m=>m.id===message.id?message:m):[...state.messages,message]};
    }
    items=[item];
  }
  const updates=items.flatMap(item=>itemActivities(item,requests)),ids=new Set(updates.map(item=>item.id));
  return {...state,v2Requests:requests,v2Controls:controls,activities:[...state.activities.filter(activity=>!ids.has(activity.id)),...updates]};
}

/** Convert saved v1 command vocabulary at the transport boundary. No provider
 * ID lookup or permission override is inferred during this conversion. */
export function v2Command(command:unknown):Record<string,unknown>&{type:string} {
  if(!isRecord(command)||typeof command.type!=='string')throw Error('Invalid saved T3 command.');
  const {createdAt:_createdAt,...saved}=command;const c:Record<string,unknown>&{type:string}={...saved,type:command.type};
  if(c.type==='thread.create')return {...c,createdBy:c.createdBy??'user',creationSource:c.creationSource??'web'};
  if(c.type==='thread.turn.start'){
    const {message:input,runtimeMode:_runtimeMode,interactionMode:_interactionMode,...rest}=c;const message=outgoingMessage(input);
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
