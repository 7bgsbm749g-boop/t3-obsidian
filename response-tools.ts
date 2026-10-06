import type {InlineActivity,InlineThreadState} from './inline-thread';
export interface ResponseTool {id:string;status:string;label:string;icon:string;createdAt?:string;sequence:number;command?:string;cwd?:string;output?:string;exitCode?:number;durationMs?:number;files?:string[]}
const object=(value:any):Record<string,any>=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
const string=(value:any)=>typeof value==='string'?value.trim():'';
const compact=(value:string)=>value.replace(/\s+/g,' ').slice(0,160);
const html=(value:string)=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/\n/g,'&#10;');
const done=(status:string)=>['completed','failed','declined','stopped'].includes(status);
/** Unwrap shell launchers for the label; keep the exact command in details. */
export function commandProgram(command:string):string {
  let value=command.trim();
  for(let n=0;n<4;n++){
    const wrapped=/^(?:\S*[\\/])?(?:bash|sh|zsh|dash|fish|powershell(?:\.exe)?|pwsh(?:\.exe)?|cmd(?:\.exe)?)\s+(?:-[\w]+\s+)*?(?:-[\w]*c|\/c|-command)\s+([\s\S]+)$/i.exec(value);
    if(!wrapped)break;value=wrapped[1].trim();if((value.startsWith("'")&&value.endsWith("'"))||(value.startsWith('"')&&value.endsWith('"')))value=value.slice(1,-1);
  }
  value=value.replace(/^(?:cd\s+[^;&]+\s*&&\s*|(?:[A-Za-z_][\w]*=\S+\s+)+)/,'');
  const program=/^(?:sudo\s+|env\s+)?([^\s;&|]+)/.exec(value)?.[1]?.replace(/^['"]|['"]$/g,'').split(/[\\/]/).at(-1);
  return program&&/^[\w.+-]+$/.test(program)?program:'command';
}
function content(value:any):string {
  if(typeof value==='string')return value;
  if(Array.isArray(value))return value.map(item=>typeof item?.text==='string'?item.text:'').filter(Boolean).join('\n');
  return '';
}
function fields(activity:InlineActivity){
  const p=object(activity.payload),data=object(p.data),item=object(data.item),input=object(item.input??data.input??object(data.state).input),result=object(item.result??data.result??data.output);
  const command=string(item.command)||string(input.command)||string(result.command)||string(data.command);
  const name=string(data.toolName)||[string(data.server),string(data.tool)].filter(Boolean).join('.')||string(p.title)||string(activity.summary).replace(/ started$/i,'');
  const path=string(input.path??input.file_path??data.path??item.path);
  const rawOutput=content(item.aggregatedOutput)||content(result.content)||content(data.content)||content(item.content)||content(result.output)||content(data.output)||string(p.detail);
  const exitCode=item.exitCode??result.exitCode??data.exitCode,durationMs=item.durationMs??result.durationMs??data.durationMs;
  const status=string(p.status)||(activity.kind==='tool.completed'?'completed':'inProgress');
  return {status,name:/^(?:Tool|Tool updated)$/i.test(name)?undefined:name||undefined,path:path||undefined,kind:data.kind,
    command:command||undefined,cwd:string(item.cwd??input.workdir??data.cwd)||undefined,output:rawOutput&&rawOutput!==command?rawOutput:undefined,
    exitCode:typeof exitCode==='number'?exitCode:undefined,durationMs:typeof durationMs==='number'?durationMs:undefined,
    files:Array.isArray(p.files??data.files)?(p.files??data.files).map((x:any)=>typeof x==='string'?x:string(x?.path)).filter(Boolean):undefined};
}
function presentation(info:ReturnType<typeof fields>){
  const {command,path,status}=info,name=info.name??'';
  const clean=name.replace(/^mcp__t3_code__|^mcp__[^_]+__|^functions[._]/,'').split('.').at(-1)??name;
  let target=command?commandProgram(command):compact(clean).replace(/_/g,' '),icon=command?'terminal':'wrench',action='run';
  if(/view.?image|image.?view/i.test(clean)){action='view';target=path?.split(/[\\/]/).at(-1)||'image';icon='image';}
  else if(/read.?file|^read$|^reading file$|file.?read/i.test(clean)||info.kind==='read'){action='read';target=path?.split(/[\\/]/).at(-1)||'file';icon='file-text';}
  else if(/search|^rg$|^grep$/.test(command?target:clean)){action='search';icon='search';}
  else if(/apply.?patch|edit|write.?file/i.test(clean)){action='edit';icon='pencil';}
  else if(/preview|browser|fetch|web/i.test(clean)){action='view';icon='globe';}
  const verbs:Record<string,[string,string]>={run:['Running','Ran'],read:['Reading','Read'],view:['Viewing','Viewed'],search:['Searching','Searched'],edit:['Editing','Edited']};
  const verb=status==='failed'?'Failed':status==='declined'?'Declined':status==='stopped'?'Stopped':verbs[action][done(status)?1:0];
  const legacy=!command&&/^(?:Running|Searching|Editing|Writing|Viewing|Opening|Fetching)\b/i.test(target);
  return {label:!target?(done(status)?'Tool finished':'Working'):compact(legacy&&!done(status)?target:`${verb} ${target}`),icon};
}
/** Merge exact lifecycle IDs. Sparse and out-of-order starts can add details,
 * but cannot reopen a tool with terminal evidence. */
export function responseTools(state:InlineThreadState,turns:string[]):ResponseTool[] {
  const groups=new Map<string,InlineActivity[]>();
  for(const a of state.activities){
    if(!turns.includes(a.turnId??'')||!/^tool\.(started|updated|completed)$/.test(a.kind)||a.payload?.itemType==='reasoning')continue;
    const p=a.payload??{};if(!p.toolCallId&&!p.title&&!p.data)continue;const id=string(p.toolCallId)||`legacy:${p.itemType??''}:${string(p.title)||string(a.summary).replace(/ started$/i,'')}`;
    const group=groups.get(id)??[];group.push(a);groups.set(id,group);
  }
  return [...groups].map(([id,items])=>{
    const order=(a:InlineActivity)=>a.sequence??(Date.parse(a.createdAt??'')||0);
    items.sort((a,b)=>order(a)-order(b));let info=fields(items[0]);
    for(const a of items.slice(1)){
      const next=fields(a),terminal=done(info.status);
      info={...info,...Object.fromEntries(Object.entries(next).filter(([k,v])=>v!==undefined&&!(k==='status'&&terminal&&!done(next.status))&&(!terminal||done(next.status)||info[k as keyof typeof info]===undefined)))};
    }
    if(info.exitCode!==undefined&&info.exitCode!==0&&done(info.status))info.status='failed';
    return {id,createdAt:items[0].createdAt,sequence:order(items[0]),...info,...presentation(info)};
  }).sort((a,b)=>a.sequence-b.sequence);
}
export function renderResponseTool(tool:ResponseTool):string {
  const details=[tool.cwd?`<p>Directory: <code>${html(tool.cwd)}</code></p>`:'',tool.files?.length?`<p>Files: ${tool.files.map(file=>`<code>${html(file)}</code>`).join(', ')}</p>`:'',tool.command?`<pre><code>${html(tool.command)}</code></pre>`:'',tool.exitCode!==undefined?`<p>Exit code: ${tool.exitCode}</p>`:'',tool.durationMs!==undefined?`<p>Duration: ${(tool.durationMs/1000).toFixed(1)} s</p>`:'',tool.output?`<pre class="send-to-t3-tool-output"><code>${html(tool.output.slice(0,20000))}${tool.output.length>20000?'&#10;[Output shortened for display]':''}</code></pre>`:''].filter(Boolean).join('');
  return `<details class="send-to-t3-tool" data-t3-tool-id="${html(tool.id)}" data-t3-tool-status="${html(tool.status)}"><summary><span data-t3-tool-icon="${html(tool.icon)}" aria-hidden="true"></span><span>${html(tool.label)}</span></summary>${details}</details>`;
}
