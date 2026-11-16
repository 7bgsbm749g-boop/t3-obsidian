import type {InlineSubagent,InlineThreadState} from '../conversations/inline-thread';
import {isRecord,hasControlCharacters} from '../shared/values';
import {runTimer} from './response-presentation';
import {subagentProviderIcon} from './subagent-provider-icon';

export interface SubagentSource {environmentId:string;threadId:string}
export interface SubagentReference extends SubagentSource {version:1;runId:string;subagentId:string}
const html=(text:string)=>text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/\r?\n/g,'&#10;');
const text=(value:unknown,limit:number)=>typeof value==='string'?value.slice(0,limit):undefined;
const terminal=(status:string)=>['completed','failed','cancelled','interrupted','rolled_back','expired'].includes(status);
const statuses:Record<string,string>={pending:'Queued',queued:'Queued',preparing:'Starting',starting:'Starting',running:'Running',in_progress:'Running',waiting:'Waiting',idle:'Idle · resumable',completed:'Completed',failed:'Failed',error:'Failed',cancelled:'Stopped',interrupted:'Stopped',rolled_back:'Stopped',expired:'Stopped'};

/** Keep bounded display metadata, never a child's full prompt or report. */
export function subagentDisplayFields(item:InlineSubagent){
 const selection=isRecord(item.modelSelection)?item.modelSelection:undefined;
 const options=Array.isArray(selection?.options)?selection.options.filter(isRecord):[];
 const effort=options.find(option=>['reasoningEffort','reasoning_effort','effort'].includes(String(option.id)))?.value;
 const raw=terminal(item.status)?item.result||item.progress:item.progress||item.result;
 const detail=text(raw,1600)?.replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/`/g,'').replace(/^[ \t]*[-*][ \t]+/gm,'').replace(/\s+/g,' ').trim();
 return {createdAt:item.createdAt,startedAt:item.startedAt,completedAt:item.completedAt,updatedAt:item.updatedAt,driver:text(item.driver,80),providerInstanceId:text(item.providerInstanceId,200),model:text(selection?.model??item.model,200),effort:text(effort??item.effort,80),displayDetail:detail&&!/^Child task ended with status\b/i.test(detail)?detail.slice(0,1200):text(item.displayDetail,1200)};
}
export function subagentUrl(reference:SubagentReference){return 't3-subagent:'+encodeURIComponent(JSON.stringify(reference));}
export function parseSubagentUrl(url:string):SubagentReference|undefined {
 if(!url.startsWith('t3-subagent:')||url.length>12000)return;
 try{
  const value:unknown=JSON.parse(decodeURIComponent(url.slice(12)));
  if(!isRecord(value)||value.version!==1||![value.environmentId,value.threadId,value.runId,value.subagentId].every(id=>typeof id==='string'&&id.length>0&&id.length<=2048&&!hasControlCharacters(id)))return;
  return {version:1,environmentId:value.environmentId as string,threadId:value.threadId as string,runId:value.runId as string,subagentId:value.subagentId as string};
 }catch{return;}
}

export function renderSubagent(child:InlineSubagent,source?:SubagentSource,event?:{id?:string;outcome:string;createdAt?:string}):string {
 const position=event?'notice:'+(event.id??event.createdAt??event.outcome):'start';
 const resumed=event&&Date.parse(child.startedAt??'')>Date.parse(event.createdAt??'');
 if(resumed)event=undefined;
 const status=event&&['completed','failed','cancelled'].includes(event.outcome)?event.outcome:child.status;
 const label=event?({completed:'Finished',failed:'Failed',cancelled:'Stopped',updated:'Updated',unknown:'Finished'}[event.outcome]??'Finished'):statuses[status]??'Unknown';
 const title=child.title?.trim()||'Subagent',detail=child.displayDetail?.trim();
 const remote=isRecord(child.remoteChild)?child.remoteChild:undefined;
 const canOpen=!!source&&!!(child.childThreadId||typeof remote?.threadId==='string'&&typeof remote.environmentId==='string');
 const url=source?subagentUrl({...source,version:1,runId:child.runId,subagentId:child.id}):'';
 const timed=event?.createdAt&&Number.isFinite(Date.parse(event.createdAt))?`<time class="send-to-t3-notification-time" data-t3-notification-at="${Date.parse(event.createdAt)}" datetime="${html(event.createdAt)}"></time>`:child.startedAt?runTimer({startedAt:child.startedAt,...(child.completedAt&&terminal(child.status)?{finishedAt:child.completedAt}:{})}):'';
 const tooltip=[title,[child.model,child.effort].filter(Boolean).join(' · '),label,detail].filter(Boolean).join('\n');
 const badge=status==='completed'?'check':status==='failed'||status==='error'?'x':terminal(status)?'square':'ellipsis';
 const contents=`<span class="send-to-t3-subagent-avatar" aria-hidden="true"><span class="send-to-t3-subagent-provider">${subagentProviderIcon(child.driver)}</span><span class="send-to-t3-subagent-badge" data-t3-tool-icon="${badge}"></span></span><span class="send-to-t3-subagent-copy"><span class="send-to-t3-subagent-heading"><span class="send-to-t3-subagent-title">${html(title)}</span>${typeof remote?.label==='string'?`<span class="send-to-t3-subagent-remote">on ${html(remote.label)}</span>`:''}</span><span class="send-to-t3-subagent-detail">${html(detail||label)}</span></span>${detail&&(event||status!=='completed')?`<span class="send-to-t3-subagent-status">${html(label)}</span>`:''}${timed?`<span class="send-to-t3-subagent-time">${timed}</span>`:''}${canOpen?'<span class="send-to-t3-subagent-chevron" data-t3-tool-icon="chevron-right" aria-hidden="true"></span>':''}`;
 const attributes=`class="send-to-t3-subagent" data-t3-subagent-id="${html(child.id)}" data-t3-subagent-key="${html(child.id+':'+position)}" data-t3-subagent-status="${html(status)}" title="${html(tooltip)}" aria-description="${html(label)}"`;
 return canOpen?`<a ${attributes} href="${html(url)}" aria-label="Open ${html(title)}">${contents}</a>`:`<div ${attributes}>${contents}</div>`;
}

export function notificationSubagents(state:InlineThreadState,source:unknown):InlineSubagent[]{
 if(!isRecord(source))return [];
 const children=Object.values(state.subagents??{});
 const taskIds=source.taskIds;
 const child=source.kind==='delegated_task'&&Array.isArray(taskIds)?children.find(child=>taskIds.includes(child.id)):
  (source.kind==='subagent'||source.kind==='background_task'&&source.work==='subagent')&&typeof source.childThreadId==='string'?children.find(child=>child.childThreadId===source.childThreadId):undefined;
 if(child)return [child];
 return [];
}

/** One document listener covers live, saved, reading and pop-out renderers. */
export function installSubagentLinks(root:Document,open:(reference:SubagentReference)=>Promise<void>,failure:(error:unknown)=>void):()=>void {
 const pending=new Set<string>();let stopped=false;
 const click=(event:Event)=>{
  const link=(event.target as Element)?.closest?.<HTMLAnchorElement>('a[href^="t3-subagent:"]');if(!link||link.closest('pre,code'))return;
  event.preventDefault();event.stopPropagation();
  const url=link.getAttribute('href')??'',reference=parseSubagentUrl(url);if(!reference||pending.has(url))return;
  pending.add(url);void Promise.resolve().then(()=>{if(!stopped)return open(reference);}).catch(error=>{if(!stopped)failure(error);}).finally(()=>pending.delete(url));
 };
 root.addEventListener('click',click,true);
 return ()=>{stopped=true;root.removeEventListener('click',click,true);pending.clear();};
}
