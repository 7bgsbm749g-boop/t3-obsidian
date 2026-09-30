import {contentHash} from './completion';
import {pendingQuestions,renderQuestion} from './questions';
import {steeringSegments,type InlineSteering} from './inline-steering';

export interface SelectionAnchor {text:string;start:number;end:number;before:string;after:string}
export interface InlineMessage {id:string;role:string;text:string;turnId:string|null;streaming:boolean;createdAt?:string}
export interface InlineActivity {id:string;kind:string;summary:string;turnId:string|null;createdAt?:string;payload?:Record<string,any>}
export interface InlineThreadState {messages:InlineMessage[];activities:InlineActivity[];session?:{status:string;activeTurnId:string|null;lastError?:string|null};latestTurn?:{turnId:string;state:string;requestedAt?:string;assistantMessageId?:string|null}}

export function selectionAnchor(document:string,text:string,start:number,end:number):SelectionAnchor {
  if(!text.trim()||document.slice(start,end)!==text)throw Error('The selected text changed. Select it again before asking T3.');
  return {text,start,end,before:document.slice(Math.max(0,start-24),start),after:document.slice(end,end+24)};
}

export function insertionOffset(document:string,anchor:SelectionAnchor):number {
  let end=anchor.end;
  const matchesAt=(start:number)=>document.slice(start,start+anchor.text.length)===anchor.text&&document.slice(Math.max(0,start-anchor.before.length),start).endsWith(anchor.before)&&document.slice(start+anchor.text.length).startsWith(anchor.after);
  if(!matchesAt(anchor.start)){
    const first=document.indexOf(anchor.text);
    if(first<0||document.indexOf(anchor.text,first+1)>=0||!matchesAt(first))throw Error('The selected text moved or changed. Select it again before asking T3.');
    end=first+anchor.text.length;
  }
  const lineEnd=document.indexOf('\n',end);
  return safeInsertionOffset(document,lineEnd<0?document.length:lineEnd+1);
}

/** Append a response after the note, provided it cannot become code-fence text. */
export function endInsertionOffset(document:string):number {
  return safeInsertionOffset(document,document.length);
}

function safeInsertionOffset(document:string,initialOffset:number):number {
  let offset=initialOffset;
  const lines=document.slice(0,offset).split('\n');
  let fence:{character:string;length:number}|undefined;
  for(const line of lines){
    const match=/^ {0,3}(`{3,}|~{3,})/.exec(line);
    if(!match)continue;
    const character=match[1][0];
    if(!fence)fence={character,length:match[1].length};
    else if(fence.character===character&&match[1].length>=fence.length&&line.slice(match[0].length).trim()==='')fence=undefined;
  }
  if(fence){
    const remaining=document.slice(offset);
    const linesAfter=remaining.split('\n');
    let consumed=0,closed=false;
    for(const line of linesAfter){
      const match=/^ {0,3}(`{3,}|~{3,})/.exec(line);
      consumed+=line.length+(consumed+line.length<remaining.length?1:0);
      if(match&&match[1][0]===fence.character&&match[1].length>=fence.length&&line.slice(match[0].length).trim()===''){closed=true;break;}
    }
    if(!closed)throw Error('The selection is inside an unclosed Markdown code fence. Close the fence and try again.');
    offset+=consumed;
  }
  return offset;
}

export function startMarker(id:string){return `<!-- t3-inline:start:${id} -->`;}
export function endMarker(id:string){return `<!-- t3-inline:end:${id} -->`;}
export function activeInlineIds(document:string):string[]{
  return [...document.matchAll(/<!-- t3-inline:start:([0-9a-f-]{36}) -->/gi)].map(match=>match[1]).filter(id=>/^\*\*T3 · (?:Sending…|Working|Reconnecting)\*\*/.test(regionBody(document,id)?.body??''));
}
export function failedInlineIds(document:string):string[]{
  return [...document.matchAll(/<!-- t3-inline:start:([0-9a-f-]{36}) -->/gi)].map(match=>match[1]).filter(id=>/^\*\*T3 · Error\*\*/.test(regionBody(document,id)?.body??''));
}
export function initialRegion(id:string):{text:string;bodyHash:string} {
  const body='**T3 · Sending…**';
  // The final blank line also closes the quote in Obsidian Live Preview when
  // this response is the last block in the note.
  return {text:`\n${startMarker(id)}\n${body}\n${endMarker(id)}\n\n`,bodyHash:contentHash(body)};
}

export function regionBody(document:string,id:string):{from:number;to:number;body:string}|null {
  const start=startMarker(id),end=endMarker(id),first=document.indexOf(start);
  if(first<0||document.indexOf(start,first+1)>=0)return null;
  const from=first+start.length+1,to=document.indexOf(`\n${end}`,from);
  if(to<0||document.indexOf(end,to+1+end.length)>=0)return null;
  return {from,to,body:document.slice(from,to)};
}

export function replaceRegion(document:string,id:string,expectedHash:string,next:string):{from:number;to:number;text:string;hash:string}|null {
  const found=regionBody(document,id);
  if(!found||contentHash(found.body)!==expectedHash)return null;
  return {from:found.from,to:found.to,text:next,hash:contentHash(next)};
}

/** Remove a completed reply's tracking lines with the final body in one edit. */
export function finalizeRegion(document:string,id:string,expectedHash:string,finalBody:string):{from:number;to:number;text:string}|null {
  const found=regionBody(document,id);
  if(!found||contentHash(found.body)!==expectedHash||/<!-- t3-inline:(?:start|end):/.test(found.body))return null;
  const start=startMarker(id),end=endMarker(id);
  const from=found.from-start.length-1,endFrom=found.to+1;
  if(document.slice(from,from+start.length)!==start||document.slice(endFrom,endFrom+end.length)!==end)return null;
  // The hidden start marker occupies a line in Live Preview. Keep that line
  // empty when finalizing so the reply does not jump up after it disappears.
  return {from,to:endFrom+end.length,text:`\n${finalBody.replace(/\n+$/,'')}`};
}

export function applyThreadItem(state:InlineThreadState,item:any):{state:InlineThreadState;sequence?:number} {
  if(item?.kind==='snapshot'){
    const thread=item.snapshot?.thread;
    if(!thread||!Array.isArray(thread.messages))throw Error('T3 returned an invalid thread snapshot.');
    return {state:{messages:thread.messages.filter(validMessage),activities:Array.isArray(thread.activities)?thread.activities.filter(validActivity):[],session:thread.session??undefined,latestTurn:thread.latestTurn??undefined},sequence:item.snapshot.snapshotSequence};
  }
  if(item?.kind!=='event')return {state};
  const event=item.event,p=event?.payload;
  if(!Number.isSafeInteger(event?.sequence)||event.sequence<0)return {state};
  if(event.type==='thread.message-sent'&&p&&typeof p.messageId==='string'&&typeof p.text==='string'&&typeof p.role==='string'){
    const old=state.messages.find(m=>m.id===p.messageId);
    const message:InlineMessage={id:p.messageId,role:p.role,turnId:p.turnId??null,streaming:p.streaming===true,text:old?(p.streaming?old.text+p.text:p.text||old.text):p.text,createdAt:old?.createdAt??p.createdAt};
    const latestTurn=p.role==='assistant'&&p.turnId&&state.latestTurn&&state.latestTurn.turnId===p.turnId?{...state.latestTurn,assistantMessageId:p.messageId}:state.latestTurn;
    return {state:{...state,latestTurn,messages:old?state.messages.map(m=>m.id===message.id?message:m):[...state.messages,message]},sequence:event.sequence};
  }
  if(event.type==='thread.activity-appended'&&validActivity(p?.activity)){
    const activities=state.activities.some(a=>a.id===p.activity.id)?state.activities:[...state.activities,p.activity];
    return {state:{...state,activities},sequence:event.sequence};
  }
  if(event.type==='thread.session-set'&&p?.session&&typeof p.session.status==='string'){
    const session=p.session;
    let latestTurn=state.latestTurn;
    if(session.status==='running'&&typeof session.activeTurnId==='string')latestTurn={...(latestTurn?.turnId===session.activeTurnId?latestTurn:{}),turnId:session.activeTurnId,state:'running'};
    else if(latestTurn?.state==='running'&&['ready','stopped','interrupted','error'].includes(session.status))latestTurn={...latestTurn,state:session.status==='error'?'error':session.status==='interrupted'?'interrupted':'completed'};
    return {state:{...state,session,latestTurn},sequence:event.sequence};
  }
  return {state,sequence:event.sequence};
}
function validMessage(value:any):value is InlineMessage{return value&&typeof value.id==='string'&&typeof value.role==='string'&&typeof value.text==='string'&&typeof value.streaming==='boolean';}
function validActivity(value:any):value is InlineActivity{return value&&typeof value.id==='string'&&typeof value.kind==='string'&&typeof value.summary==='string';}

/** T3 assigns turn IDs when the provider starts; the dispatch command ID is
 * unrelated. The pending user message and projected turn share requestedAt. */
export function turnForMessage(state:InlineThreadState,messageId:string):string|undefined {
  const message=state.messages.find(m=>m.id===messageId&&m.role==='user');
  const turn=state.latestTurn;
  return message?.createdAt&&turn?.requestedAt===message.createdAt?turn.turnId:undefined;
}

function safeStatus(value:string){return value.replace(/[\r\n\t]+/g,' ').replace(/[\\`*_{}\[\]()#+.!>|]/g,'\\$&').slice(0,180);}
function closeOpenFence(text:string):string {
  let fence:{character:string;length:number}|undefined;
  for(const line of text.split('\n')){
    const match=/^ {0,3}(`{3,}|~{3,})/.exec(line);
    if(!match)continue;
    if(!fence)fence={character:match[1][0],length:match[1].length};
    else if(match[1][0]===fence.character&&match[1].length>=fence.length&&line.slice(match[0].length).trim()==='')fence=undefined;
  }
  return fence?`${text}\n${fence.character.repeat(fence.length)}`:text;
}

function tableCells(line:string):string[]|null {
  if(/^ {4}|^\t|^ {0,3}>/.test(line))return null;
  const cells:string[]=[];
  let cell='',escaped=false,backticks=0,wikiLink=false;
  for(let index=0;index<line.length;index++){
    const char=line[index];
    if(escaped){cell+=char;escaped=false;continue;}
    if(char==='\\'){cell+=char;escaped=true;continue;}
    if(char==='`'){
      let end=index+1;while(line[end]==='`')end++;
      const length=end-index;
      backticks=backticks===length?0:backticks||length;
      cell+=line.slice(index,end);index=end-1;continue;
    }
    if(!backticks&&line.slice(index,index+2)==='[['){wikiLink=true;cell+='[[';index++;continue;}
    if(wikiLink&&line.slice(index,index+2)===']]'){wikiLink=false;cell+=']]';index++;continue;}
    if(char==='|'&&!backticks&&!wikiLink){cells.push(cell);cell='';continue;}
    cell+=char;
  }
  cells.push(cell);
  if(cells.length<2)return null;
  if(!cells[0].trim())cells.shift();
  if(!cells.at(-1)?.trim())cells.pop();
  return cells.length?cells:null;
}

function tableStart(lines:string[],index:number):boolean {
  if(index+1>=lines.length)return false;
  const header=tableCells(lines[index]),delimiter=tableCells(lines[index+1]);
  return !!header&&!!delimiter&&header.length===delimiter.length&&delimiter.every(cell=>/^:?-{2,}:?$/.test(cell.trim()));
}

function headingLine(line:string):boolean {
  return /^ {0,3}#{1,6}(?:[ \t]+|$)/.test(line);
}

/** Keep prose in the visible reply quote, but render blocks that Obsidian Live
 * Preview handles poorly inside quotes at the document's top level. */
function responseModes(lines:string[]):Array<'quote'|'raw'|'table'> {
  const modes:Array<'quote'|'raw'|'table'>=lines.map(()=>'quote');
  for(let index=0;index<lines.length;){
    const fence=/^ {0,3}(`{3,}|~{3,})(.*)$/.exec(lines[index]);
    if(fence&&!(fence[1][0]==='`'&&fence[2].includes('`'))){
      const character=fence[1][0],length=fence[1].length,start=index++;
      while(index<lines.length){
        const closing=/^ {0,3}(`{3,}|~{3,})\s*$/.exec(lines[index++]);
        if(closing&&closing[1][0]===character&&closing[1].length>=length)break;
      }
      for(let line=start;line<index;line++)modes[line]='raw';
      continue;
    }
    if(tableStart(lines,index)){
      const start=index;index+=2;
      const columns=tableCells(lines[start])!.length;
      while(index<lines.length&&lines[index].trim()&&tableCells(lines[index])?.length===columns)index++;
      for(let line=start;line<index;line++)modes[line]='table';
      continue;
    }
    if(headingLine(lines[index])){modes[index]='raw';index++;continue;}
    index++;
  }
  return modes;
}

/** The asset importer uses the same table decision as the streamed renderer,
 * so a wiki-link alias pipe can be escaped only inside a real table cell. */
export function tableRowAt(text:string,offset:number):boolean {
  const lines=text.split('\n'),modes=responseModes(lines);
  let start=0;
  for(let index=0;index<lines.length;index++){
    const end=start+lines[index].length;
    if(offset>=start&&offset<=end)return modes[index]==='table';
    start=end+1;
  }
  return false;
}

function quoteResponse(text:string):string {
  const lines=text.split('\n'),modes=responseModes(lines);
  const segments:Array<{mode:'quote'|'raw'|'table';lines:string[]}>=[];
  for(let index=0;index<lines.length;index++){
    const last=segments.at(-1);
    if(last?.mode===modes[index])last.lines.push(lines[index]);
    else segments.push({mode:modes[index],lines:[lines[index]]});
  }
  if(segments.length===1&&segments[0].mode==='quote')return lines.map(line=>line?`> ${line}`:'>').join('\n');
  return segments.map(segment=>{
    while(segment.lines[0]==='')segment.lines.shift();
    while(segment.lines.at(-1)==='')segment.lines.pop();
    return segment.mode==='quote'?segment.lines.map(line=>line?`> ${line}`:'>').join('\n'):segment.lines.join('\n');
  }).filter(Boolean).join('\n\n');
}

/** Select the completed turn's prose consistently for rendering and assets. */
export function inlineTurnMessages(state:InlineThreadState,turnId:string,keepIntermediate=false):InlineMessage[] {
  const messages=state.messages.filter(m=>m.turnId===turnId&&m.role==='assistant');
  const finalId=state.latestTurn?.turnId===turnId?state.latestTurn.assistantMessageId:undefined;
  const final=messages.find(m=>m.id===finalId)??messages.at(-1);
  return keepIntermediate?messages:final?[final]:[];
}

export function renderInlineTurn(state:InlineThreadState,turnId:string,threadId:string,phase:'sending'|'running'|'reconnecting'|'complete'|'interrupted'|'error'|'cancelled'='running',keepIntermediate=false,environmentId?:string,conversation?:{messages:InlineMessage[];steering:InlineSteering[]}):string {
  const messages=inlineTurnMessages(state,turnId,phase!=='complete'||keepIntermediate);
  const answer=messages.map(m=>m.text.replace(/\n+$/,'')).filter(Boolean).join('\n\n');
  // A continuation uses the same transcript as steering, even before the first
  // steer. Keep the final-only preference for unsteered completed responses.
  const transcript=conversation&&(phase!=='complete'||keepIntermediate||conversation.steering.length)?conversation:undefined;
  const segments=transcript?steeringSegments(transcript.messages,transcript.steering.filter(input=>input.confirmed)):[];
  let previousRole:string|undefined;
  const prose=transcript?segments.reduce((body,segment)=>{
    const rendered=segment.role==='user'?`> [!t3-steering] You\n${segment.text.split('\n').map(line=>line?`> ${line}`:'>').join('\n')}`:quoteResponse(closeOpenFence(segment.text.trim()));
    // Only adjacent assistant quote blocks share a quoted blank line. Callouts
    // and raw Markdown blocks need a real boundary to avoid swallowing prose.
    const separator=body&&previousRole==='assistant'&&segment.role==='assistant'&&/^>/.test(body.split('\n').at(-1)??'')&&/^>/.test(rendered)?'\n>\n':'\n\n';
    previousRole=segment.role;return body?body+separator+rendered:rendered;
  },''):answer?quoteResponse(closeOpenFence(answer)):'';
  // Separate the quote from the inline end marker. Without the blank line,
  // Obsidian treats the marker as a lazy continuation of the last paragraph.
  const questions=environmentId?pendingQuestions(state.activities).filter(request=>request.turnId===turnId||request.turnId===null).map(request=>renderQuestion(request,{environmentId,threadId,requestId:request.requestId})).join('\n\n'):'';
  if(phase==='complete')return (prose?`${prose}\n`:'')+(questions?`\n${questions}\n`:'');
  const activity=state.activities.filter(a=>a.turnId===turnId&&a.kind==='approval.requested').at(-1);
  const heading=`**T3 · ${phase==='running'?'Working':phase==='sending'?'Sending':phase==='reconnecting'?'Reconnecting':phase==='cancelled'?'Stopped':phase==='interrupted'?'Interrupted':'Error'}**`;
  const spinner=['running','sending','reconnecting'].includes(phase)?' <span class="send-to-t3-inline-spinner" aria-label="Loading"></span>':'';
  const status=phase==='error'&&state.session?.lastError?'\n\n'+safeStatus(state.session.lastError):activity?'\n\nAction needed in T3: '+safeStatus(activity.summary):'';
  const body=prose?`\n\n${prose}\n`:'';
  return `${heading}${spinner}${status}${body}${questions?`\n\n${questions}\n`:''}`;
}

export function turnPhase(state:InlineThreadState,turnId:string):'running'|'complete'|'interrupted'|'error' {
  if(state.latestTurn?.turnId===turnId&&['completed','interrupted','error'].includes(state.latestTurn.state))return state.latestTurn.state==='completed'?'complete':state.latestTurn.state as 'interrupted'|'error';
  if(state.session?.activeTurnId===turnId)return 'running';
  const messages=state.messages.filter(m=>m.turnId===turnId&&m.role==='assistant');
  if(messages.length&&messages.every(m=>!m.streaming)&&state.session&&['ready','stopped','interrupted','error'].includes(state.session.status))return state.session.status==='error'?'error':state.session.status==='interrupted'?'interrupted':'complete';
  return 'running';
}
