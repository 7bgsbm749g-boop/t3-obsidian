import type {InlineActivity,InlineThreadState} from './inline-thread';
export type ToolAction='command'|'edit'|'read'|'browser'|'device'|'search'|'code-search'|'thread'|'link-pr'|'unlink-pr'|'list-prs'|'other';
export interface ResponseTool {id:string;turnId:string;key:string;status:string;label:string;activeLabel:string;icon:string;action:ToolAction;createdAt?:string;sequence:number;command?:string;cwd?:string;output?:string;exitCode?:number;durationMs?:number;files?:string[]}
export interface ResponseToolGroup {id:string;turnId:string;createdAt?:string;tools:ResponseTool[]}
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
function changedFiles(value:any,depth=0,result=new Set<string>()):Set<string> {
  if(depth>4)return result;
  if(Array.isArray(value)){for(const item of value)changedFiles(item,depth+1,result);return result;}
  const record=object(value);
  for(const key of ['path','filePath','relativePath','filename','newPath','oldPath'])if(string(record[key]))result.add(string(record[key]));
  for(const key of ['item','result','input','data','changes','files','edits','patch','patches','operations'])if(record[key])changedFiles(record[key],depth+1,result);
  return result;
}
function fields(activity:InlineActivity){
  const p=object(activity.payload),data=object(p.data),item=object(data.item),input=object(item.input??data.input??object(data.state).input),result=object(item.result??data.result??data.output);
  const command=string(item.command)||string(input.command)||string(result.command)||string(data.command);
  const name=string(data.toolName)||[string(data.server),string(data.tool)].filter(Boolean).join('.')||string(p.title)||string(activity.summary).replace(/ started$/i,'');
  const rawInput=item.input??data.input;let structuredInput=object(rawInput);
  if(typeof rawInput==='string'){try{structuredInput=object(JSON.parse(rawInput));}catch{/* Provider summaries may be plain text. */}}
  const path=string(input.path??input.file_path??data.path??item.path);
  const rawOutput=content(item.aggregatedOutput)||content(result.content)||content(data.content)||content(item.content)||content(result.output)||content(data.output)||string(p.detail);
  const exitCode=item.exitCode??result.exitCode??data.exitCode,durationMs=item.durationMs??result.durationMs??data.durationMs;
  const status=string(p.status)||(activity.kind==='tool.completed'?'completed':'inProgress');
  const files=changedFiles(data);for(const file of [...(Array.isArray(p.files)?p.files:[]),...(Array.isArray(data.files)?data.files:[])])if(string(typeof file==='string'?file:file?.path))files.add(string(typeof file==='string'?file:file?.path));
  const query=string(structuredInput.query??structuredInput.q??structuredInput.search_query?.[0]?.q);
  const threadId=string(structuredInput.threadId)||(/['"]threadId['"]\s*:\s*['"]([\w:-]+)['"]/.exec(typeof rawInput==='string'?rawInput:'')?.[1]??'');
  return {status,name:/^(?:Tool|Tool updated)$/i.test(name)?undefined:name||undefined,path:path||undefined,kind:data.kind,itemType:p.itemType,requestKind:p.requestKind,query:query||undefined,threadId:threadId||undefined,
    command:command||undefined,cwd:string(item.cwd??input.workdir??data.cwd)||undefined,output:rawOutput&&rawOutput!==command?rawOutput:undefined,
    exitCode:typeof exitCode==='number'?exitCode:undefined,durationMs:typeof durationMs==='number'?durationMs:undefined,
    files:files.size?[...files]:undefined};
}
function toolAction(info:ReturnType<typeof fields>):ToolAction {
  const name=info.name??'',clean=name.replace(/^mcp__t3_code__|^mcp__t3-code__|^(?:t3-code|t3_code)[.·] */,'');
  const t3=/^(?:mcp__(?:t3_code|t3-code)__|(?:t3-code|t3_code)[.·] *)/.test(name);
  if(t3){if(clean==='link_pull_request')return 'link-pr';if(clean==='unlink_pull_request')return 'unlink-pr';if(clean==='list_thread_pull_requests')return 'list-prs';if(clean.startsWith('preview_'))return 'browser';if(clean.startsWith('device_'))return 'device';if(clean.startsWith('t3_thread_'))return 'thread';}
  if(info.requestKind==='file-read'||info.itemType==='image_view'||info.kind==='read'||/^(?:Read|Read file|Reading file)$/i.test(name)||/read.?file|view.?image/i.test(name))return 'read';
  if(info.requestKind==='file-change'||info.itemType==='file_change'||info.kind==='edit'||/apply.?patch|edit|write.?file/i.test(name)||info.files?.length)return 'edit';
  if(info.command||info.itemType==='command_execution'||info.requestKind==='command')return 'command';
  if(info.itemType==='web_search'||/^(?:web[._]run|mcp__web__run)$/.test(name))return /grep/i.test(name)?'code-search':'search';
  return 'other';
}
function presentation(info:ReturnType<typeof fields>){
  const {command,path,status}=info,name=info.name??'';
  const clean=name.replace(/^mcp__t3_code__|^mcp__[^_]+__|^functions[._]/,'').split('.').at(-1)??name;
  let target=command?commandProgram(command):compact(clean).replace(/_/g,' '),icon=command?'terminal':'wrench',action='run';
  if(info.itemType==='web_search'||/^(?:web[._]run|mcp__web__run)$/.test(name)){action='search';target=info.query?`“${compact(info.query)}”`:'web';icon='search';}
  else if(/^(?:mcp__t3_code__|mcp__t3-code__|t3-code[.]|t3_code[.])t3_thread_read$/.test(name)){action='read';target=info.threadId?`thread ${info.threadId.slice(0,8)}`:'thread';icon='messages-square';}
  else if(/view.?image|image.?view/i.test(clean)){action='view';target=path?.split(/[\\/]/).at(-1)||'image';icon='image';}
  else if(/read.?file|^read$|^reading file$|file.?read/i.test(clean)||info.kind==='read'){action='read';target=path?.split(/[\\/]/).at(-1)||'file';icon='file-text';}
  else if(/search|^rg$|^grep$/.test(command?target:clean)){action='search';icon='search';}
  else if(/apply.?patch|edit|write.?file/i.test(clean)){action='edit';icon='pencil';}
  else if(/preview|browser|fetch|web/i.test(clean)){action='view';icon='globe';}
  if(info.itemType==='file_change'||info.requestKind==='file-change'){
    action='edit';icon='pencil';target=info.files?.length===1?info.files[0].split(/[\\/]/).at(-1)!:info.files?.length?`${info.files.length} files`:'files';
  }
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
    const key=JSON.stringify([a.turnId,id]);const group=groups.get(key)??[];group.push(a);groups.set(key,group);
  }
  return [...groups].map(([key,items])=>{
    const [turnId,id]=JSON.parse(key) as [string,string];
    const order=(a:InlineActivity)=>a.sequence??(Date.parse(a.createdAt??'')||0);
    items.sort((a,b)=>order(a)-order(b));let info=fields(items[0]),position=items[0];
    for(const a of items.slice(1)){
      const next=fields(a),terminal=done(info.status);
      if(!terminal||done(next.status))position=a;
      if(info.files?.length||next.files?.length)next.files=[...new Set([...(info.files??[]),...(next.files??[])])];
      info={...info,...Object.fromEntries(Object.entries(next).filter(([k,v])=>v!==undefined&&!(k==='status'&&terminal&&!done(next.status))&&(!terminal||done(next.status)||info[k as keyof typeof info]===undefined)))};
    }
    if(info.exitCode!==undefined&&info.exitCode!==0&&done(info.status))info.status='failed';
    return {id,key,turnId,createdAt:position.createdAt,sequence:order(items[0]),...info,...presentation(info),action:toolAction(info),activeLabel:presentation({...info,status:['failed','declined','stopped'].includes(info.status)?info.status:'inProgress'}).label};
  }).sort((a,b)=>(Number.isFinite(Date.parse(a.createdAt??''))&&Number.isFinite(Date.parse(b.createdAt??''))?Date.parse(a.createdAt!)-Date.parse(b.createdAt!):0)||a.sequence-b.sequence);
}

/** Like T3's timeline, prose, reasoning, user input and turn boundaries split
 * consecutive calls. The latest canonical lifecycle entry supplies its position. */
export function responseToolGroups(state:InlineThreadState,turns:string[]):ResponseToolGroup[] {
  const boundaries=[...state.messages.filter(m=>['assistant','reasoning','user'].includes(m.role)&&m.text.trim()).map(m=>({turnId:m.turnId,at:Date.parse(m.createdAt??'')})),
    ...state.activities.filter(a=>['user-input.requested','approval.requested','context-compaction'].includes(a.kind)).map(a=>({turnId:a.turnId,at:Date.parse(a.createdAt??'')}))].filter(b=>Number.isFinite(b.at));
  const result:ResponseToolGroup[]=[];let previousSlot='';
  for(const tool of responseTools(state,turns)){
    const at=Date.parse(tool.createdAt??'');
    const slot=JSON.stringify([tool.turnId,boundaries.filter(b=>(b.turnId===tool.turnId||b.turnId===null)&&b.at<=at).length]);
    const last=result.at(-1);
    if(last&&slot===previousSlot)last.tools.push(tool);
    else result.push({id:encodeURIComponent(tool.key),turnId:tool.turnId,createdAt:tool.createdAt,tools:[tool]});
    previousSlot=slot;
  }
  // Concurrent calls can finish out of order. Their first identity keeps the
  // same dropdown while its current label and detail order change.
  for(const group of result)group.id=encodeURIComponent(group.tools.reduce((first,tool)=>tool.sequence<first.sequence?tool:first).key);
  return result;
}

/** The latest successful call keeps the activity row live while the turn runs.
 * Actual results remain completed. A new timeline entry replaces that label. */
export function currentResponseToolGroup(state:InlineThreadState,turnId:string,groups=responseToolGroups(state,[turnId])):{group:ResponseToolGroup;tool:ResponseTool;active:boolean}|undefined {
  const group=groups.filter(g=>g.turnId===turnId).at(-1);if(!group)return;
  const latest=group.tools.at(-1)!;
  const at=Date.parse(latest.createdAt??'');
  if(Number.isFinite(at)&&(state.messages.some(m=>(m.turnId===turnId||m.turnId===null)&&m.text.trim()&&Date.parse(m.createdAt??'')>at)||state.activities.some(a=>a.turnId===turnId&&['user-input.requested','approval.requested','context-compaction'].includes(a.kind)&&Date.parse(a.createdAt??'')>at)))return;
  const tool=group.tools.filter(t=>t.status==='inProgress').at(-1)??latest;
  if(tool.status==='failed')return;
  return {group,tool,active:tool.status==='inProgress'||tool.status==='completed'};
}

export function renderResponseToolGroup(group:ResponseToolGroup,current?:{tool:ResponseTool;active:boolean}):string {
  const failures=group.tools.filter(t=>t.status==='failed').length,stopped=group.tools.filter(t=>t.status==='stopped'||t.status==='declined').length;
  const label=current?(current.active?current.tool.activeLabel:current.tool.label):`${summarizeResponseTools(group.tools)}${failures?` · ${failures} failed`:''}${stopped?` · ${stopped} stopped or declined`:''}`;
  const summary=`<span data-t3-tool-icon="${html(current?.tool.icon??'hammer')}" aria-hidden="true"></span><span>${html(label)}</span>`+(current?.active?' <span class="send-to-t3-inline-spinner" aria-label="Loading"></span>':'');
  return `<details class="${current?'send-to-t3-response-activity':'send-to-t3-tool-group'}" data-t3-tool-group="${html(group.id)}" data-t3-tool-summary="${html(summarizeResponseTools(group.tools))}"${current?' data-t3-live-tool="true"':''}><summary>${summary}</summary><div class="send-to-t3-tool-group-content">${group.tools.map(renderResponseTool).join('')}</div></details>`;
}

/** T3's first-seen action order, distinct changed-file count and sentence form. */
export function summarizeResponseTools(tools:ResponseTool[]):string {
  const actions=new Map<ToolAction,ResponseTool[]>();
  for(const tool of tools){const entries=actions.get(tool.action)??[];entries.push(tool);actions.set(tool.action,entries);}
  const labels=[...actions].map(([action,entries])=>{
    const count=action==='edit'?new Set(entries.flatMap(t=>t.files??[])).size+entries.filter(t=>!t.files?.length).length:entries.length;
    const plural=(singular:string,plural=singular+'s')=>count===1?singular:plural;
    switch(action){
      case 'command':return `Ran ${count} ${plural('command')}`;
      case 'edit':return `Changed ${count} ${plural('file')}`;
      case 'read':return `Read ${count} ${plural('file')}`;
      case 'browser':return `Used browser ${count} ${plural('time')}`;
      case 'device':return `Used device controls ${count} ${plural('time')}`;
      case 'search':return `Searched the web ${count} ${plural('time')}`;
      case 'code-search':return `Searched code ${count} ${plural('time')}`;
      case 'thread':return `Used T3 thread controls ${count} ${plural('time')}`;
      case 'link-pr':return `Linked ${count} ${plural('pull request')}`;
      case 'unlink-pr':return `Unlinked ${count} ${plural('pull request')}`;
      case 'list-prs':return count===1?'Checked linked pull requests':`Checked linked pull requests ${count} times`;
      default:return `Used ${count} ${plural('tool')}`;
    }
  }).map((label,index)=>index?label.charAt(0).toLowerCase()+label.slice(1):label);
  return labels.length<2?labels[0]??'':labels.length===2?labels.join(' and '):`${labels.slice(0,-1).join(', ')}, and ${labels.at(-1)}`;
}
export function renderResponseTool(tool:ResponseTool):string {
  const details=[tool.cwd?`<p>Directory: <code>${html(tool.cwd)}</code></p>`:'',tool.files?.length?`<p>Files: ${tool.files.map(file=>`<code>${html(file)}</code>`).join(', ')}</p>`:'',tool.command?`<pre><code>${html(tool.command)}</code></pre>`:'',tool.exitCode!==undefined?`<p>Exit code: ${tool.exitCode}</p>`:'',tool.durationMs!==undefined?`<p>Duration: ${(tool.durationMs/1000).toFixed(1)} s</p>`:'',tool.output?`<pre class="send-to-t3-tool-output"><code>${html(tool.output.slice(0,20000))}${tool.output.length>20000?'&#10;[Output shortened for display]':''}</code></pre>`:''].filter(Boolean).join('');
  return `<details class="send-to-t3-tool" data-t3-tool-id="${html(tool.id)}" data-t3-tool-key="${html(tool.key)}" data-t3-tool-status="${html(tool.status)}"><summary><span data-t3-tool-icon="${html(tool.icon)}" aria-hidden="true"></span><span>${html(tool.label)}</span></summary>${details}</details>`;
}
