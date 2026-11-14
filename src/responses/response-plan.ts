import {micromark} from 'micromark';

const html=(text:string)=>text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

/** Public provider plans are artifacts, distinct from mutable todo steps.
 * Keep the complete Markdown in saved responses; disclosure is display only. */
export function renderProposedPlan(id:string,payload:{markdown?:string;text?:string;streaming?:boolean;status?:string}):string {
  const markdown=payload.markdown??payload.text??'';
  if(!markdown.trim())return '';
  const title=markdown.match(/^\s{0,3}#{1,6}\s+(.+)$/m)?.[1]?.trim()||'Proposed plan';
  const lines=markdown.trimEnd().split(/\r\n?|\n/);
  let start=/^\s{0,3}#{1,6}\s+/.test(lines[0]??'')?1:0;
  while(lines[start]?.trim()==='')start++;
  if(/^\s{0,3}#{1,6}\s+summary\s*$/i.test(lines[start]??''))start++;
  const displayed=lines.slice(start).join('\n').trim();
  const body=micromark(displayed);
  const long=markdown.length>900||lines.length>20;
  const header=`<div class="send-to-t3-plan-header"><span class="send-to-t3-plan-badge">Plan</span><strong>${html(title)}</strong>${payload.streaming?'<span class="send-to-t3-plan-status">Drafting</span>':''}</div>`;
  let contents=`<div class="send-to-t3-plan-content">${body}</div>`;
  if(long){
    let count=0;const preview:string[]=[];
    for(const line of displayed.split('\n')){if(line.trim()&&++count>10)break;preview.push(line);}
    contents=`<details data-t3-plan-id="${html(id)}"><summary><span class="send-to-t3-plan-expand">Expand plan</span><span class="send-to-t3-plan-collapse">Collapse plan</span></summary><div class="send-to-t3-plan-content">${body}</div></details><div class="send-to-t3-plan-preview">${micromark(preview.join('\n'))}</div>`;
  }
  return `<section class="send-to-t3-proposed-plan" data-t3-emission-id="${html(id)}">${header}${contents}</section>`.replace(/\r\n?|\n/g,'&#10;');
}
