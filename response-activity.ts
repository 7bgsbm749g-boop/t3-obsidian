import type {InlineActivity,InlineThreadState} from './inline-thread';

const text=(value:unknown)=>typeof value==='string'?value.replace(/\s+/g,' ').trim().slice(0,120):'';
const record=(value:unknown):Record<string,any>=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
const terminal=(activity:InlineActivity)=>activity.kind==='tool.completed'||['completed','failed','declined','stopped'].includes(activity.payload?.status);
function identity(activity:InlineActivity):string {
  const p=activity.payload??{};
  return text(p.toolCallId)?`id:${p.toolCallId}`:`legacy:${text(p.itemType)}:${text(p.title)||text(activity.summary).replace(/ started$/i,'')}`;
}
function toolLabel(activity:InlineActivity):string {
  const p=activity.payload??{},data=record(p.data),item=record(data.item);
  const name=text(data.toolName)||text(data.tool),title=text(p.title)||text(activity.summary).replace(/ started$/i,'');
  if(p.itemType==='reasoning')return 'Thinking';
  if(data.kind==='read'||/^(?:read|read_file|read file|reading file)$/i.test(name||title))return 'Reading file';
  const command=text(item.command)||text(record(item.input).command)||text(record(item.result).command)||text(data.command)||text(record(data.input).command)||text(record(record(data.state).input).command);
  if(command)return `Running ${command}`;
  if(name)return `Running ${name}`;
  if(p.itemType==='command_execution')return 'Running command';
  if(/^(?:Reading|Running|Searching|Editing|Writing|Viewing|Opening|Fetching)\b/i.test(title))return title;
  return text(p.title)&&!/^(?:Tool|Tool updated)$/i.test(title)?`Running ${title}`:'Working';
}

/** Canonical lifecycle records, never assistant prose or another turn's tools.
 * Snapshots may omit starts or arrive out of order; terminal identities win.
 * Idless legacy records are conservative and can only offer a fallback. */
export function responseActivityLabel(state:InlineThreadState,turnId:string):string {
  if(!turnId)return 'Working';
  const activities=state.activities.filter(a=>a.turnId===turnId&&/^tool\.(?:started|updated|completed)$/.test(a.kind));
  const closed=new Set(activities.filter(terminal).map(identity));
  const latest=new Map<string,InlineActivity>();
  for(const activity of activities){
    const key=identity(activity);if(closed.has(key))continue;
    const previous=latest.get(key);
    const order=(a:InlineActivity)=>a.sequence??(Date.parse(a.createdAt??'')||0);
    if(!previous||order(activity)>=order(previous))latest.set(key,activity);
  }
  const tools=[...latest.values()].filter(a=>a.kind==='tool.started'||a.payload?.status==='inProgress');
  tools.sort((a,b)=>(a.sequence??(Date.parse(a.createdAt??'')||0))-(b.sequence??(Date.parse(b.createdAt??'')||0)));
  const tool=tools.at(-1);if(tool)return toolLabel(tool);
  return state.messages.some(m=>m.turnId===turnId&&m.role==='reasoning'&&m.streaming)?'Thinking':'Working';
}

export function responseActivityRow(label='Working'):string {
  const escaped=text(label).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  return `<span class="send-to-t3-response-activity" role="status" aria-live="polite"><strong>${escaped}</strong> <span class="send-to-t3-inline-spinner" aria-label="Loading"></span></span>`;
}
