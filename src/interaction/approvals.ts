import {records} from '../shared/values';
import {valueText} from '../shared/values';
import {optionalString} from '../shared/values';
import {insideResponse} from '../responses/response-container';
import type {InlineActivity} from '../conversations/inline-thread';
import {parseQuestionToken,questionKey,questionToken,type QuestionTarget} from './questions';
import {markdownCodeRanges} from '../responses/reply-html';

export type ApprovalTarget=QuestionTarget;
export const approvalDecisions=['accept','acceptForSession','acceptAlways','decline','cancel'] as const;
export type ApprovalDecision=typeof approvalDecisions[number];
export interface ApprovalOption {decision:ApprovalDecision;label:string;warning?:string}
export function validApprovalDecision(value:unknown):value is ApprovalDecision{return typeof value==='string'&&approvalDecisions.some(decision=>decision===value);}
export function approvalOptions(value:unknown):ApprovalOption[]{
 if(value===undefined)return [{decision:'cancel',label:'Cancel'},{decision:'decline',label:'Decline'},{decision:'acceptForSession',label:'Always allow this session'},{decision:'accept',label:'Approve'}];
 const seen=new Set<string>();return records(value).flatMap(option=>{
  if(!validApprovalDecision(option.decision)||typeof option.label!=='string'||!option.label.trim()||seen.has(option.decision))return [];
  seen.add(option.decision);return [{decision:option.decision,label:option.label,...(typeof option.warning==='string'?{warning:option.warning}:{})}];
 });
}
export interface PendingApproval {requestId:string;turnId:string|null;kind?:string;summary:string;detail?:string;options?:ApprovalOption[];appName?:string}
export const interactiveApproval=(kind?:string)=>['command','file-change','file-read','app-permission','app-access','mcp-elicitation'].includes(kind??'');
export const approvalKey=questionKey;
export function staleApprovalFailure(activity:InlineActivity){
  return activity.kind==='provider.approval.respond.failed'&&/unknown pending (?:codex )?approval request|stale pending approval request/i.test(valueText(activity.payload?.detail??''));
}
/** Resolution is terminal, including when requests and resolutions arrive out of order. */
export function pendingApprovals(activities:InlineActivity[]):PendingApproval[]{
  const closed=new Set(activities.filter(a=>a.kind==='approval.resolved'||a.kind==='approval.abandoned'||staleApprovalFailure(a)).map(a=>a.payload?.requestId));
  const pending=new Map<string,PendingApproval>();
  for(const a of activities){
    const p=a.payload;
    if(a.kind!=='approval.requested'||typeof p?.requestId!=='string'||!p.requestId.trim()||closed.has(p.requestId))continue;
    pending.set(p.requestId,{requestId:p.requestId,turnId:a.turnId,kind:optionalString(p.requestKind),summary:a.summary,options:approvalOptions(p.options),...(typeof p.appName==='string'?{appName:p.appName}:{}),...(typeof p.detail==='string'?{detail:p.detail}:{})});
  }
  return [...pending.values()];
}
/** A stopped session cannot apply its old decisions, even if T3 retains pending activities. */
export function closedThreadApprovals(thread:{activities:InlineActivity[];session?:{status:string}|null;latestTurn?:{turnId:string;state:string}|null}):Set<string>{
  const stopped=thread.session?.status==='stopped'||thread.session?.status==='interrupted';
  const turn=thread.latestTurn,terminal=turn&&['completed','interrupted','cancelled'].includes(turn.state);
  return new Set(pendingApprovals(thread.activities).filter(request=>stopped||terminal&&request.turnId===turn.turnId).map(request=>request.requestId));
}
export const approvalUrl=(target:ApprovalTarget,decision:ApprovalDecision)=>`t3-approval:${questionToken(target)}/${decision}`;
export function parseApprovalUrl(url:string):{target:ApprovalTarget;decision:ApprovalDecision}|undefined {
  const match=/^t3-approval:([^\s]+)\/(accept|acceptForSession|acceptAlways|decline|cancel)$/.exec(url);
  const target=match&&parseQuestionToken(match[1]);
  return target?{target,decision:match[2] as ApprovalDecision}:undefined;
}
export function approvalTargets(document:string):ApprovalTarget[]{
  if(!document.includes('t3-approval:'))return [];
  const code=markdownCodeRanges(document),targets=new Map<string,ApprovalTarget>();
  for(const match of document.matchAll(/\[[^\]\n]+\]\((t3-approval:[^\s)]+)\)/g)){
    if(code.some(([from,to])=>match.index>=from&&match.index<to))continue;
    const parsed=parseApprovalUrl(match[1]);if(parsed)targets.set(approvalKey(parsed.target),parsed.target);
  }
  return [...targets.values()];
}
export function renderApproval(request:PendingApproval,target:ApprovalTarget):string {
  const token=questionToken(target);
  // Native fenced blocks keep arbitrary commands readable without interpreting their Markdown/HTML.
  const detail=request.detail?.replace(/\r\n?/g,'\n');let fenceLength=3;
  for(const match of (detail??'').matchAll(/`+/g))fenceLength=Math.max(fenceLength,match[0].length+1);
  const fence='`'.repeat(fenceLength);
  const kind=({'command':'Command','file-change':'File change','file-read':'File read','app-permission':'App permission','app-access':'App access','mcp-elicitation':'App access'} as Record<string,string>)[request.kind??'']??'Action';
  const safe=(text:string)=>text.replace(/[\[\]<>`\r\n]/g,' ');
  const options=(request.options??approvalOptions(undefined)).map(option=>`[${safe(option.label)}](${approvalUrl(target,option.decision)})`).join(' ');
  return [`<!-- t3-approval:start:${token} -->`,`Action needed: ${kind} approval requested${request.appName?' for '+safe(request.appName):''} ${options}`,...(detail?['',`${fence}sh`,detail,fence]:[]),`<!-- t3-approval:end:${token} -->`].join('\n');
}
/** Preserve the command as ordinary text when a response is stopped or no longer live. */
export function clearApprovalControls(document:string,target?:ApprovalTarget):string {
  const code=markdownCodeRanges(document);
  for(const match of [...document.matchAll(/^<!-- t3-approval:start:([^\n]+) -->\n([\s\S]*?)\n<!-- t3-approval:end:\1 -->$/gm)].reverse()){
    const parsed=parseQuestionToken(match[1]);if(!parsed||target&&approvalKey(parsed)!==approvalKey(target)||code.some(([from,to])=>match.index>=from&&match.index<to))continue;
    if(target&&insideResponse(document,match.index))continue;
    const body=match[2].replace(/^Action needed: (.+?) approval requested.*$/m,'$1 approval request').replace(/\[[^\]\n]+\]\(t3-approval:[^\s)]+\)/g,'');
    document=document.slice(0,match.index)+body+document.slice(match.index+match[0].length);
  }
  return document;
}
