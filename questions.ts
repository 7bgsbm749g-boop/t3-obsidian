import {insideResponse} from './response-container';
import type {InlineActivity} from './inline-thread';
import {markdownCodeRanges} from './reply-html';

export interface QuestionOption {label:string;description:string;value?:string}
export interface Question {id:string;header:string;question:string;options:QuestionOption[];multiSelect:boolean;allowCustomAnswer?:boolean}
export interface PendingQuestion {requestId:string;questions:Question[];turnId:string|null;responseMode?:'message';createdAt:string}
export interface QuestionTarget {environmentId:string;threadId:string;requestId:string}
export interface QuestionDraft {selected?:string[];text?:string;mode?:'custom'|'options'}
export type QuestionDrafts=Record<string,QuestionDraft>;
const staleDetails=['stale pending user-input request','unknown pending user-input request','unknown pending user input request','unknown pending codex user input request'];
export function staleQuestionFailure(activity:InlineActivity){return activity.kind==='provider.user-input.respond.failed'&&staleDetails.some(fragment=>String(activity.payload?.detail??'').toLowerCase().includes(fragment));}

/** Request IDs are unique. Resolution remains terminal regardless of activity order. */
export function pendingQuestions(activities:InlineActivity[]):PendingQuestion[]{
  const pending=new Map<string,PendingQuestion>(),closed=new Set<string>();
  for(const activity of activities){
    const p=activity.payload;if(!p||typeof p.requestId!=='string'||!p.requestId.trim())continue;
    if(activity.kind==='user-input.resolved'||staleQuestionFailure(activity)){closed.add(p.requestId);pending.delete(p.requestId);continue;}
    if(activity.kind!=='user-input.requested'||closed.has(p.requestId)||!Array.isArray(p.questions))continue;
    const questions:Question[]=p.questions.flatMap((q:any)=>{
      if(!q||typeof q.id!=='string'||typeof q.header!=='string'||typeof q.question!=='string'||!Array.isArray(q.options))return [];
      const options=q.options.filter((o:any)=>o&&typeof o.label==='string'&&typeof o.description==='string'&&(o.value===undefined||typeof o.value==='string'));
      if(!options.length&&q.allowCustomAnswer===false)return [];
      return [{id:q.id,header:q.header,question:q.question,options,multiSelect:q.multiSelect===true,...(typeof q.allowCustomAnswer==='boolean'?{allowCustomAnswer:q.allowCustomAnswer}:{})}];
    });
    if(questions.length)pending.set(p.requestId,{requestId:p.requestId,questions,turnId:activity.turnId??null,createdAt:activity.createdAt??'',...(p.responseMode==='message'?{responseMode:'message' as const}:{})});
  }
  return [...pending.values()].sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
}
export function questionAnswers(request:PendingQuestion,drafts:QuestionDrafts):Record<string,string|string[]> {
  const entries=request.questions.map(q=>{
    const draft=drafts[q.id],text=q.allowCustomAnswer!==false&&draft?.mode!=='options'?draft?.text?.trim():undefined;
    const selected=[...new Set(draft?.selected??[])].filter(value=>q.options.some(o=>(o.value??o.label)===value));
    const answer=text||(q.multiSelect?(selected.length?selected:undefined):selected[0]);
    if(answer===undefined)throw Error(`Answer “${q.header}” before submitting.`);
    return [q.id,answer] as const;
  });
  return Object.fromEntries(entries);
}
export const questionKey=(target:QuestionTarget)=>JSON.stringify([target.environmentId,target.threadId,target.requestId]);
export function questionToken(target:QuestionTarget){return encodeURIComponent(JSON.stringify(target)).replace(/[!'()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`);}
export function parseQuestionToken(token:string):QuestionTarget|undefined {
  if(token.length>12000)return;
  try{const p=JSON.parse(decodeURIComponent(token));if(p&&[p.environmentId,p.threadId,p.requestId].every(v=>typeof v==='string'&&v.length>0&&v.length<=2000))return {environmentId:p.environmentId,threadId:p.threadId,requestId:p.requestId};}catch{/* Ordinary Markdown links are not question metadata. */}
}
export const questionUrl=(target:QuestionTarget)=>`t3-question:${questionToken(target)}`;
export function questionTargets(document:string):QuestionTarget[]{
  return [...document.matchAll(/^> \[Answer\]\(t3-question:([^\s)]+)\)$/gm)].flatMap(match=>{const target=parseQuestionToken(match[1]);return target?[target]:[];});
}
const markdownText=(value:string)=>value.replace(/[\\`*_{}\[\]()#+.!>|<>]/g,'\\$&').split(/\r?\n/).join('\n> ');
export function renderQuestion(request:PendingQuestion,target:QuestionTarget):string {
  const token=questionToken(target);
  return [`<!-- t3-question:start:${token} -->`,request.responseMode==='message'?'> **T3 · Question pending**':'> **T3 · Answer needed**',...request.questions.flatMap(q=>['>',`> **${markdownText(q.header)}**`, `> ${markdownText(q.question)}`,...(q.options.length?['>']:[]),...q.options.map(o=>`> - ${markdownText(o.label)}${o.description?`: ${markdownText(o.description)}`:''}`)]),'>',`> [Answer](${questionUrl(target)})`,`<!-- t3-question:end:${token} -->`].join('\n');
}
/** Exact generated sections only; examples inside code remain ordinary text. */
export function questionSections(document:string):{from:number;to:number;target:QuestionTarget}[]{
  const candidates=[...document.matchAll(/^<!-- t3-question:(start|end):([^\s]+) -->$/gm)];
  if(!candidates.some(match=>match[1]==='start'))return [];
  const code=markdownCodeRanges(document),sections=[];
  const markers=candidates.filter(match=>!code.some(([from,to])=>match.index!>=from&&match.index!<to));
  for(const match of markers){
    if(match[1]!=='start')continue;
    const from=match.index!,target=parseQuestionToken(match[2]),own=markers.filter(marker=>marker[2]===match[2]);
    if(!target||own.length!==2||own[0]!==match||own[1][1]!=='end')continue;
    const endAt=own[1].index!,to=endAt+own[1][0].length;
    if(markers.some(marker=>marker.index!>from&&marker.index!<endAt))continue;
    sections.push({from,to,target});
  }
  return sections;
}
/** Saved cleanup stays outside live responses, whose hashes belong to a writer. */
export function removeDismissedQuestions(document:string,dismissed:(target:QuestionTarget)=>boolean):string {
  for(const section of questionSections(document).reverse()){
    if(!dismissed(section.target))continue;
    if(insideResponse(document,section.from))continue;
    document=document.slice(0,section.from)+document.slice(section.to);
  }
  return document;
}
/** Only remove a resolved question outside a live response. Never invalidate a writer hash. */
export function clearResolvedQuestion(document:string,target:QuestionTarget):string {
  const token=questionToken(target),start=`<!-- t3-question:start:${token} -->`,end=`<!-- t3-question:end:${token} -->`;
  const from=document.indexOf(start),endAt=document.indexOf(end,from+start.length);
  if(from<0||endAt<0||document.indexOf(start,from+start.length)>=0||document.indexOf(end,endAt+end.length)>=0)return document;
  if(insideResponse(document,from))return document;
  const section=document.slice(from+start.length,endAt).replace(/^> \[Answer\]\(t3-question:[^\s)]+\)\n?/gm,'').replace(/^> \*\*T3 · (?:Question pending|Answer needed)\*\*$/m,'> **T3 · Question answered**');
  return document.slice(0,from)+section.trim()+document.slice(endAt+end.length);
}
