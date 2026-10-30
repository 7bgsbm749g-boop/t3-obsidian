import type {InlineThreadState} from './inline-thread';

export interface ResponseEmission {id:string;turnId:string|null;createdAt?:string;sequence:number;body:string;active:boolean;kind:string}
const html=(text:string)=>text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/\n/g,'&#10;');
// Blank lines alone let consecutive Markdown quotes merge. A zero-size HTML
// block makes each native callout a separate block, including inside progress.
const separateCallout=(body:string)=>`<!-- t3-display-block -->\n\n${body}\n\n<!-- t3-display-block -->`;

/** Public timeline emissions are display data, never run completion evidence. */
export function responseEmissions(state:InlineThreadState,turns:string[],markdown:(text:string)=>string,activeTurn?:string):ResponseEmission[] {
  const result:ResponseEmission[]=[];
  for(const activity of state.activities){
    if(!turns.includes(activity.turnId??'')||!['context-compaction','response.plan','response.notification'].includes(activity.kind))continue;
    const p=activity.payload??{};let body:string,active=false;
    if(activity.kind==='context-compaction'){
      const running=p.status==='inProgress';
      active=running&&!!activeTurn&&activity.turnId===activeTurn;
      const label=running?(active?'Compacting context':'Context compaction'):p.status==='failed'?'Context compaction failed':p.status==='stopped'?'Context compaction stopped':'Context compacted';
      body=`<span class="send-to-t3-context" data-t3-emission-id="${html(activity.id)}"><span data-t3-tool-icon="minimize-2" aria-hidden="true"></span><span>${label}</span>${active?' <span class="send-to-t3-inline-spinner" aria-label="Loading"></span>':''}</span>`;
    }else if(activity.kind==='response.plan'){
      const text=typeof p.text==='string'?p.text:(p.steps??[]).map((step:any)=>`- [${step.status==='completed'?'x':' '}] ${String(step.step??step.text??step.content??'').replace(/[\r\n]+/g,' ')}${step.status==='in_progress'?' (In progress)':''}`).join('\n');
      if(!text.trim())continue;
      body=separateCallout(`> [!t3-plan]- Plan\n>\n${markdown(text)}`);
    }else{
      const text=typeof p.text==='string'?p.text:activity.summary;if(!text.trim())continue;
      body=separateCallout(`> [!t3-notification] ${p.error?'Error':'Notice'}\n>\n${markdown(text)}`);
    }
    result.push({id:activity.id,turnId:activity.turnId,createdAt:activity.createdAt,sequence:activity.sequence??0,body,active,kind:activity.kind});
  }
  return result.sort((a,b)=>(Date.parse(a.createdAt??'')||0)-(Date.parse(b.createdAt??'')||0)||a.sequence-b.sequence);
}
