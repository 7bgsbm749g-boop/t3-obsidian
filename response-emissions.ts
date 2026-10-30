import type {InlineThreadState} from './inline-thread';
import {renderWorktreeSetup,worktreeSetupPhase} from './worktree-setup';
import {renderResponseTasks} from './response-tasks';

export interface ResponseEmission {id:string;turnId:string|null;createdAt?:string;sequence:number;body:string;active:boolean;kind:string}
const html=(text:string)=>text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/\n/g,'&#10;');
// Blank lines alone let consecutive Markdown quotes merge. A zero-size HTML
// block makes each native callout a separate block, including inside progress.
const separateCallout=(body:string)=>`<!-- t3-display-block -->\n\n${body}\n\n<!-- t3-display-block -->`;

/** Provider messages are plain text, as in T3's timeline, never Markdown/HTML. */
export function renderProviderError(id:string,text:string,createdAt?:string):string {
  const at=Date.parse(createdAt??'');
  const time=Number.isFinite(at)?`<time class="send-to-t3-notification-time" data-t3-notification-at="${at}" datetime="${html(new Date(at).toISOString())}"></time>`:'';
  return `<div class="send-to-t3-provider-error" data-t3-emission-id="${html(id)}"><div class="send-to-t3-provider-error-header"><span data-t3-tool-icon="circle-alert" aria-hidden="true"></span><span>Provider error</span>${time}</div><div class="send-to-t3-provider-error-message">${html(text.replace(/\r\n?/g,'\n'))}</div></div>`;
}

/** Public timeline emissions are display data, never run completion evidence. */
export function responseEmissions(state:InlineThreadState,turns:string[],markdown:(text:string)=>string,activeTurn?:string):ResponseEmission[] {
  const result:ResponseEmission[]=[];
  for(const activity of state.activities){
    if(turns.includes(activity.turnId??'')&&activity.kind==='response.worktree-setup'){
      const active=activity.turnId===activeTurn;
      const phase=worktreeSetupPhase(activity,state.worktreeSetup);
      const turn=state.turns?.[activity.turnId??'']??(state.latestTurn?.turnId===activity.turnId?state.latestTurn:undefined);
      const agentStarted=Number.isFinite(Date.parse(turn?.startedAt??''))&&Date.parse(turn!.startedAt!)>=Date.parse(activity.createdAt??'');
      // Preparation is transient. Keep failures visible, but remove a ready
      // panel from both the live row and saved history when the agent starts.
      if(phase==='done'||agentStarted&&phase==='running')continue;
      const body=renderWorktreeSetup(activity,state.worktreeSetup,active);
      result.push({id:activity.id,turnId:activity.turnId,createdAt:activity.createdAt,sequence:activity.sequence??0,body,active:active&&body.includes('data-worktree-setup-phase="running"'),kind:activity.kind});
      continue;
    }
    if(!turns.includes(activity.turnId??'')||!['context-compaction','response.plan','response.notification'].includes(activity.kind))continue;
    const p=activity.payload??{};let body:string,active=false;
    if(activity.kind==='context-compaction'){
      const running=p.status==='inProgress';
      active=running&&!!activeTurn&&activity.turnId===activeTurn;
      const label=running?(active?'Compacting context':'Context compaction'):p.status==='failed'?'Context compaction failed':p.status==='stopped'?'Context compaction stopped':'Context compacted';
      body=`<span class="send-to-t3-context" data-t3-emission-id="${html(activity.id)}"><span data-t3-tool-icon="minimize-2" aria-hidden="true"></span><span>${label}</span>${active?' <span class="send-to-t3-inline-spinner" aria-label="Loading"></span>':''}</span>`;
    }else if(activity.kind==='response.plan'){
      body=renderResponseTasks(activity.turnId??activity.id,p);
      if(!body)continue;
    }else{
      const text=typeof p.text==='string'?p.text:activity.summary;if(!text.trim())continue;
      body=p.error?renderProviderError(activity.id,text,activity.createdAt):separateCallout(`> [!t3-notification] Notice\n>\n${markdown(text)}`);
    }
    result.push({id:activity.id,turnId:activity.turnId,createdAt:activity.createdAt,sequence:activity.sequence??0,body,active,kind:activity.kind});
  }
  return result.sort((a,b)=>(Date.parse(a.createdAt??'')||0)-(Date.parse(b.createdAt??'')||0)||a.sequence-b.sequence);
}
