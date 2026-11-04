import {micromark} from 'micromark';

const html=(text:string)=>text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
type TaskState='pending'|'in_progress'|'completed';
const stateLabel={pending:'Pending',in_progress:'In progress',completed:'Completed'};
function task(text:string,state:TaskState){
  // No inputs, task-list classes or data-task attributes: third-party checkbox
  // renderers must not change these agent-owned, read-only status indicators.
  return `<div class="send-to-t3-task" role="listitem" data-t3-task-state="${state}"><span class="send-to-t3-task-mark" role="img" aria-label="${stateLabel[state]}"></span><div class="send-to-t3-task-text">${micromark(text)}</div></div>`;
}
export function renderResponseTasks(id:string,payload:{text?:string;steps?:any[]}):string {
  let body='';
  if(Array.isArray(payload.steps)&&payload.steps.length){
    body=payload.steps.map(step=>task(String(step.step??step.text??step.content??'').replace(/[\r\n]+/g,' '),step.status==='completed'?'completed':step.status==='in_progress'?'in_progress':'pending')).join('');
  }else{
    let prose:string[]=[],fence='';
    const flush=()=>{if(prose.length)body+=micromark(prose.join('\n'));prose=[];};
    for(const line of (payload.text??'').split(/\r\n?|\n/)){
      const marker=/^\s*(`{3,}|~{3,})/.exec(line)?.[1];
      if(marker){if(!fence)fence=marker;else if(marker[0]===fence[0]&&marker.length>=fence.length)fence='';prose.push(line);continue;}
      const item=!fence?/^\s*(?:[-+*]|\d+[.)])\s+(?:\[([ xX/])\]\s+)?(.+)$/.exec(line):null;
      if(item){flush();body+=task(item[2],item[1]==='/'?'in_progress':item[1]?.toLowerCase()==='x'?'completed':'pending');}else prose.push(line);
    }
    flush();
  }
  if(!body.trim())return '';
  return `<details class="send-to-t3-tasks" data-t3-tasks-id="${html(id)}"><summary><span data-t3-tool-icon="list-checks" aria-hidden="true"></span><span>Tasks</span></summary><div class="send-to-t3-tasks-content" role="list">${body}</div></details>`.replace(/\r\n?|\n/g,'&#10;');
}
