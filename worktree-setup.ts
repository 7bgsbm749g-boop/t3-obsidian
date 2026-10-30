import type {InlineActivity} from './inline-thread';

export interface WorktreeSetupStage {id:'fetch'|'checkout'|'submodules'|'setup-script'|'agent';status:'pending'|'running'|'done'|'skipped'|'warning'|'failed';startedAt:string|null;endedAt:string|null;percent:number|null;detail:string|null;tail:string[]}
export interface WorktreeSetup {threadId:string;phase:'running'|'done'|'failed'|'cancelled';startedAt:string;endedAt:string|null;branch:string|null;baseRef:string|null;worktreePath:string|null;setupScript:{name:string;command:string;terminalId:string}|null;stages:WorktreeSetupStage[];error:string|null;sequence:number}
const labels={fetch:'Fetch base branch',checkout:'Check out files',submodules:'Init submodules','setup-script':'Run setup script',agent:'Start agent'};
const escape=(text:string)=>text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/\r\n?|\n/g,'&#10;');
const date=(value:unknown)=>typeof value==='string'&&Number.isFinite(Date.parse(value));
/** The setup stream has its own sequence, independent of transcript events. */
export function readWorktreeSetup(value:any,threadId:string):WorktreeSetup|undefined {
  if(!value||value.threadId!==threadId||!['running','done','failed','cancelled'].includes(value.phase)||!date(value.startedAt)||!Number.isSafeInteger(value.sequence)||value.sequence<0||!Array.isArray(value.stages)||value.stages.length>5)return;
  if(value.endedAt!==null&&!date(value.endedAt)||value.stages.some((stage:any)=>!stage||!Object.hasOwn(labels,stage.id)||!['pending','running','done','skipped','warning','failed'].includes(stage.status)||stage.startedAt!==null&&!date(stage.startedAt)||stage.endedAt!==null&&!date(stage.endedAt)||stage.percent!==null&&(!Number.isFinite(stage.percent)||stage.percent<0||stage.percent>100)||stage.detail!==null&&typeof stage.detail!=='string'||!Array.isArray(stage.tail)||stage.tail.some((line:any)=>typeof line!=='string')))return;
  if(new Set(value.stages.map((s:any)=>s.id)).size!==value.stages.length)return;
  if(['branch','baseRef','worktreePath'].some(key=>value[key]!==null&&typeof value[key]!=='string')||value.setupScript!==null&&(!value.setupScript||['name','command','terminalId'].some(key=>typeof value.setupScript[key]!=='string')))return;
  return {...value,stages:value.stages.map((s:WorktreeSetupStage)=>({...s,detail:s.detail?.slice(0,200)??null,tail:s.tail.slice(-4).map(line=>line.slice(0,400))})),error:typeof value.error==='string'?value.error.slice(0,1000):null};
}
export function workspacePreparation(item:any):boolean {
  return item?.type==='command_execution'&&typeof item.id==='string'&&/workspace-preparation(?::|%3A)/i.test(item.id)&&item.input==='Preparing workspace';
}
export function setupDuration(ms:number):string {return ms<1000?`${Math.round(Math.max(0,ms))}ms`:`${(ms/1000).toFixed(1)}s`;}
function timer(start:string|null,end:string|null){
  if(!start||!date(start))return '';
  const from=Date.parse(start),to=end&&date(end)?Date.parse(end):undefined;
  return `<span class="send-to-t3-setup-time" data-t3-setup-start="${from}"${to!==undefined?` data-t3-setup-end="${to}"`:''}>${setupDuration((to??from)-from)}</span>`;
}
function matchingSetup(activity:InlineActivity,snapshot:WorktreeSetup|undefined):WorktreeSetup|undefined {
  // A thread can prepare again. A later snapshot must not replace an older run.
  return snapshot&&(!activity.payload?.completedAt||Date.parse(snapshot.startedAt)<=Date.parse(activity.payload.completedAt))&&(!snapshot.endedAt||Date.parse(snapshot.endedAt)>=Date.parse(activity.createdAt??''))?snapshot:undefined;
}
export function worktreeSetupPhase(activity:InlineActivity,snapshot?:WorktreeSetup):WorktreeSetup['phase'] {
  return matchingSetup(activity,snapshot)?.phase??(activity.payload?.status==='inProgress'?'running':activity.payload?.status==='failed'?'failed':activity.payload?.status==='stopped'?'cancelled':'done');
}
/** Keep the complete stage list visible, with only metadata behind Details. */
export function renderWorktreeSetup(activity:InlineActivity,snapshot:WorktreeSetup|undefined,active:boolean):string {
  const p=activity.payload??{},setup=matchingSetup(activity,snapshot),phase=worktreeSetupPhase(activity,snapshot);
  const running=phase==='running'&&active;
  const label=phase==='running'?(running?'Setting up worktree…':'Worktree setup stopped'):phase==='done'?(setup?.stages.some(s=>s.status==='failed')?'Worktree ready, setup script failed':'Worktree ready'):phase==='failed'?'Worktree setup failed':'Worktree setup cancelled';
  const labelSpan=(text:string,live:boolean)=>`<span class="send-to-t3-setup-label">${escape(text)}</span>${live?' <span class="send-to-t3-inline-spinner" aria-label="Loading"></span>':''}`;
  const rows=setup?.stages.map(stage=>{
    const status=stage.status==='running'&&!running?'stopped':stage.status;
    const icon=status==='done'?'check':status==='skipped'?'minus':status==='failed'||status==='stopped'?'x':status==='warning'?'triangle-alert':'circle';
    const detail=stage.status==='pending'?'':stage.status==='skipped'?stage.detail??'skipped':stage.id==='checkout'&&stage.status==='running'&&stage.percent!==null?`${stage.percent}%`:stage.detail??'';
    const time=['skipped','pending'].includes(stage.status)?'':timer(stage.startedAt,stage.endedAt??(!running?setup.endedAt??p.completedAt??stage.startedAt:null));
    const tail=stage.id==='setup-script'&&(stage.status==='failed'||stage.status==='running'&&running)&&stage.tail.length?`<pre class="send-to-t3-setup-tail"><code>${escape(stage.tail.join('\n'))}</code></pre>`:'';
    return `<div class="send-to-t3-setup-stage" data-worktree-setup-stage="${stage.id}" data-worktree-setup-status="${status}"><span class="send-to-t3-setup-icon" data-t3-tool-icon="${icon}" aria-hidden="true"></span>${labelSpan(stage.id==='setup-script'&&setup.setupScript?.name?setup.setupScript.name:labels[stage.id],status==='running')}<span class="send-to-t3-setup-trailing">${detail?`<span>${escape(detail)}</span>`:''}${time}</span></div>${tail}`;
  }).join('')??'';
  const metadata=[['Branch',setup?.branch],['Base',setup?.baseRef],['Path',setup?.worktreePath],['Setup',setup?.setupScript?.command]].filter((pair):pair is [string,string]=>typeof pair[1]==='string'&&!!pair[1]);
  const details=metadata.map(([key,value])=>`<div class="send-to-t3-setup-metadata"><span>${key}</span><code>${escape(value)}</code></div>`).join('')||`<p>${escape(p.output??'Workspace preparation details are not available.')}</p>`;
  return `<div class="send-to-t3-worktree-setup" data-t3-worktree-setup="${escape(activity.id)}" data-worktree-setup-phase="${running?'running':phase==='running'?'cancelled':phase}" aria-label="Worktree setup"><div class="send-to-t3-setup-header">${labelSpan(label,running)}${timer(setup?.startedAt??activity.createdAt??null,setup?.endedAt??(running?null:p.completedAt??setup?.startedAt??activity.createdAt??null))}</div>${rows}${setup?.error?`<p class="send-to-t3-setup-error">${escape(setup.error)}</p>`:''}<details class="send-to-t3-setup-details" data-t3-tool-key="setup:${escape(activity.id)}"><summary>Details</summary>${details}</details></div>`;
}

export function stopWorktreeSetup(line:string,now=Date.now()):string {
  if(!line.includes('class="send-to-t3-worktree-setup"')||!line.includes('data-worktree-setup-phase="running"'))return line;
  return line.replace('data-worktree-setup-phase="running"','data-worktree-setup-phase="cancelled"').replaceAll('data-worktree-setup-status="running"','data-worktree-setup-status="stopped"').replace('Setting up worktree…','Worktree setup stopped').replaceAll(' <span class="send-to-t3-inline-spinner" aria-label="Loading"></span>','').replace(/data-t3-setup-start="(\d+)"(?! data-t3-setup-end)/g,(_match,start)=>`data-t3-setup-start="${start}" data-t3-setup-end="${now}"`);
}
