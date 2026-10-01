import {escapeReplyHtml} from './reply-html';
import {contentHash} from './completion';
import {pendingQuestions,renderQuestion} from './questions';
import {steeringSegments,type InlineSteering} from './inline-steering';

export interface SelectionAnchor {text:string;start:number;end:number;before:string;after:string}
export interface InlineMessage {id:string;role:string;text:string;turnId:string|null;streaming:boolean;createdAt?:string}
export interface InlineActivity {id:string;kind:string;summary:string;turnId:string|null;createdAt?:string;payload?:Record<string,any>}
export interface InlineTurn {turnId:string;state:string;requestedAt?:string;assistantMessageId?:string|null}
export interface InlineThreadState {title?:string;messages:InlineMessage[];activities:InlineActivity[];session?:{status:string;activeTurnId:string|null;lastError?:string|null};latestTurn?:InlineTurn;turns?:Record<string,InlineTurn>;historyComplete?:boolean;checkpoints?:Array<{turnId:string;status:string;checkpointRef:string;assistantMessageId?:string|null;completedAt?:string}>}

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
  return [...document.matchAll(/<!-- t3-inline:start:([0-9a-f-]{36}) -->/gi)].map(match=>match[1]).filter(id=>/^\*\*[^\n]+ · (?:Sending…|Working|Reconnecting)\*\*/m.test(regionBody(document,id)?.body??''));
}
export function failedInlineIds(document:string):string[]{
  return [...document.matchAll(/<!-- t3-inline:start:([0-9a-f-]{36}) -->/gi)].map(match=>match[1]).filter(id=>/^\*\*[^\n]+ · Error\*\*/m.test(regionBody(document,id)?.body??''));
}
export interface InitialInlineInput {messageId:string;text:string}

/** The same neutral user quote is used for initial questions and steering. */
export function renderInlineInput(text:string):string {
  return `> [!t3-steering] You\n${text.split('\n').map(line=>line?`> ${line}`:'>').join('\n')}`;
}

export function initialRegion(id:string,initialInput?:InitialInlineInput,threadTitle?:string):{text:string;bodyHash:string} {
  const status=`**${inlineThreadLabel(threadTitle)} · Working** <span class="send-to-t3-inline-spinner" aria-label="Loading"></span>`;
  const body=initialInput?`${renderInlineInput(initialInput.text)}\n\n${status}`:status;
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
    const turns={...state.turns};
    if(state.latestTurn)turns[state.latestTurn.turnId]=state.latestTurn;
    if(thread.latestTurn)turns[thread.latestTurn.turnId]=thread.latestTurn;
    return {state:{title:typeof thread.title==='string'?thread.title:state.title,messages:thread.messages.filter(validMessage),activities:Array.isArray(thread.activities)?thread.activities.filter(validActivity):[],session:thread.session??undefined,latestTurn:thread.latestTurn??undefined,turns,historyComplete:!item.snapshot.page?.hasMore,checkpoints:Array.isArray(thread.checkpoints)?thread.checkpoints:[]},sequence:item.snapshot.snapshotSequence};
  }
  if(item?.kind!=='event')return {state};
  const event=item.event,p=event?.payload;
  if(!Number.isSafeInteger(event?.sequence)||event.sequence<0)return {state};
  if(event.type==='thread.metadata-updated'&&typeof p?.title==='string')return {state:{...state,title:p.title},sequence:event.sequence};
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
    const turns={...state.turns};
    if(state.latestTurn)turns[state.latestTurn.turnId]=state.latestTurn;
    if(latestTurn)turns[latestTurn.turnId]=latestTurn;
    return {state:{...state,session,latestTurn,turns},sequence:event.sequence};
  }
  return {state,sequence:event.sequence};
}
function validMessage(value:any):value is InlineMessage{return value&&typeof value.id==='string'&&typeof value.role==='string'&&typeof value.text==='string'&&typeof value.streaming==='boolean';}
function validActivity(value:any):value is InlineActivity{return value&&typeof value.id==='string'&&typeof value.kind==='string'&&typeof value.summary==='string';}

/** T3 assigns turn IDs when the provider starts; the dispatch command ID is
 * unrelated. The pending user message and projected turn share requestedAt. */
export function turnForMessage(state:InlineThreadState,messageId:string):string|undefined {
  const index=state.messages.findIndex(m=>m.id===messageId&&m.role==='user'),message=state.messages[index];
  if(!message)return;
  if(message.turnId)return message.turnId;
  const turn=state.latestTurn;
  if(message.createdAt&&turn?.requestedAt===message.createdAt)return turn.turnId;
  const known=Object.values(state.turns??{}).filter(t=>message.createdAt&&t.requestedAt===message.createdAt);
  if(known.length===1)return known[0].turnId;
  // Only a complete canonical history can prove this interval. Never adopt
  // the latest turn or a previous turn whose late messages crossed our prompt.
  if(!state.historyComplete)return;
  const next=state.messages.findIndex((m,i)=>i>index&&m.role==='user');
  if(next<0)return;
  const candidates=new Set(state.messages.slice(index+1,next).filter(m=>m.role==='assistant'&&m.turnId).map(m=>m.turnId!));
  if(candidates.size!==1)return;
  const candidate=[...candidates][0];
  if(state.messages.slice(0,index).some(m=>m.turnId===candidate))return;
  const requestedAt=state.turns?.[candidate]?.requestedAt??(turn?.turnId===candidate?turn.requestedAt:undefined);
  if(requestedAt&&message.createdAt&&requestedAt!==message.createdAt)return;
  const completedAt=state.checkpoints?.find(c=>c.turnId===candidate)?.completedAt;
  if(completedAt&&message.createdAt&&Date.parse(completedAt)<Date.parse(message.createdAt))return;
  return candidate;
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
  const lines=escapeReplyHtml(text).split('\n'),modes=responseModes(lines);
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
  const finalId=state.latestTurn?.turnId===turnId?state.latestTurn.assistantMessageId:state.checkpoints?.find(c=>c.turnId===turnId&&c.checkpointRef?.startsWith('refs/t3/checkpoints/'))?.assistantMessageId??state.turns?.[turnId]?.assistantMessageId;
  const final=messages.find(m=>m.id===finalId)??messages.at(-1);
  return keepIntermediate?messages:final?[final]:[];
}

export function renderInlineTurn(state:InlineThreadState,turnId:string,threadId:string,phase:'sending'|'running'|'reconnecting'|'complete'|'interrupted'|'error'|'cancelled'='running',keepIntermediate=false,environmentId?:string,conversation?:{messages:InlineMessage[];steering:InlineSteering[];preserveHistory?:boolean},initialInput?:InitialInlineInput,threadTitle?:string):string {
  const messages=inlineTurnMessages(state,turnId,phase!=='complete'||keepIntermediate);
  const answer=messages.map(m=>m.text.replace(/\n+$/,'')).filter(Boolean).join('\n\n');
  // A continuation uses the same transcript as steering, even before the first
  // steer. Keep the final-only preference for unsteered completed responses.
  const transcript=conversation&&(phase!=='complete'||keepIntermediate||conversation.steering.length||conversation.preserveHistory)?conversation:undefined;
  const segments=transcript?steeringSegments(transcript.messages,transcript.steering.filter(input=>input.confirmed)):[];
  const label=inlineThreadLabel(state.title??threadTitle);
  const heading=`**${label} · ${phase==='running'||phase==='sending'?'Working':phase==='reconnecting'?'Reconnecting':phase==='cancelled'?'Stopped':phase==='interrupted'?'Interrupted':'Error'}**`;
  const spinner=['running','sending','reconnecting'].includes(phase)?' <span class="send-to-t3-inline-spinner" aria-label="Loading"></span>':'';
  // A late answer resumes below the completed transcript. Keep its indicator
  // beside the most recent input, including before any follow-up prose arrives.
  const followupIndex=phase!=='complete'&&transcript?.preserveHistory?segments.reduce((last,segment,index)=>segment.role==='user'?index:last,-1):-1;
  let previousRole:string|undefined;
  const prose=transcript?segments.reduce((body,segment,index)=>{
    const rendered=segment.role==='user'?renderInlineInput(segment.text):quoteResponse(closeOpenFence(segment.text.trim()));
    // Only adjacent assistant quote blocks share a quoted blank line. Callouts
    // and raw Markdown blocks need a real boundary to avoid swallowing prose.
    const separator=body&&previousRole==='assistant'&&segment.role==='assistant'&&/^>/.test(body.split('\n').at(-1)??'')&&/^>/.test(rendered)?'\n>\n':'\n\n';
    previousRole=segment.role;
    const next=body?body+separator+rendered:rendered;
    return index===followupIndex?`${next}\n\n${heading}${spinner}`:next;
  },''):answer?quoteResponse(closeOpenFence(answer)):'';
  // Separate the quote from the inline end marker. Without the blank line,
  // Obsidian treats the marker as a lazy continuation of the last paragraph.
  const questions=environmentId?pendingQuestions(state.activities).filter(request=>request.turnId===turnId||request.turnId===null||conversation?.messages.some(m=>m.turnId===request.turnId)).map(request=>renderQuestion(request,{environmentId,threadId,requestId:request.requestId})).join('\n\n'):'';
  const input=initialInput?`${renderInlineInput(initialInput.text)}\n\n`:'';
  if(phase==='complete')return input+(prose?`${prose}\n`:'')+(questions?`\n${questions}\n`:'');
  const activity=state.activities.filter(a=>a.turnId===turnId&&a.kind==='approval.requested').at(-1);
  const status=phase==='error'&&state.session?.lastError&&(!state.latestTurn||state.latestTurn.turnId===turnId)?'\n\n'+safeStatus(state.session.lastError):activity?'\n\nAction needed in T3: '+safeStatus(activity.summary):'';
  const body=prose?`\n\n${prose}\n`:'';
  return `${input}${followupIndex<0?heading+spinner:''}${status}${body}${questions?`\n\n${questions}\n`:''}`;
}

export function turnPhase(state:InlineThreadState,turnId:string):'running'|'complete'|'interrupted'|'error' {
  if(state.latestTurn?.turnId===turnId&&['completed','interrupted','error'].includes(state.latestTurn.state))return state.latestTurn.state==='completed'?'complete':state.latestTurn.state as 'interrupted'|'error';
  if(state.session?.activeTurnId===turnId)return 'running';
  const messages=state.messages.filter(m=>m.turnId===turnId&&m.role==='assistant');
  // Real completion checkpoints survive later turns; provider-diff placeholders
  // can be emitted mid-turn and are deliberately excluded. Checkpoints also
  // preserve the final message ID when later messages arrived out of order.
  const checkpoint=state.checkpoints?.find(c=>c.turnId===turnId&&c.checkpointRef?.startsWith('refs/t3/checkpoints/'));
  if(checkpoint&&state.latestTurn?.turnId!==turnId){
    if(checkpoint.status==='error')return 'error';
    if(checkpoint.status==='missing')return 'interrupted';
    if(checkpoint.status==='ready')return messages.length&&messages.every(m=>!m.streaming)&&messages.some(m=>m.id===checkpoint.assistantMessageId)?'complete':'running';
  }
  const known=state.turns?.[turnId];
  if(known&&['completed','interrupted','error'].includes(known.state))return known.state==='completed'?'complete':known.state as 'interrupted'|'error';
  // Projects outside Git have no completion checkpoints. In a complete
  // canonical transcript, a newer user-anchored primary turn establishes a
  // boundary: finalized prose entirely before it is no longer streaming.
  // Require timestamps and the actual newer prompt; partial windows, fan-out
  // turns, pending blocking questions and late/streaming messages cannot seal it.
  const boundary=state.latestTurn?.requestedAt,newer=boundary?Date.parse(boundary):NaN;
  if(state.historyComplete&&state.latestTurn?.turnId!==turnId&&Number.isFinite(newer)&&
    state.messages.some(m=>m.role==='user'&&m.createdAt===boundary)&&messages.length&&
    messages.every(m=>!m.streaming&&m.createdAt&&Date.parse(m.createdAt)<newer)&&
    !pendingQuestions(state.activities).some(q=>q.turnId===turnId&&q.responseMode!=='message')){
    const lastMessage=Math.max(...messages.map(m=>Date.parse(m.createdAt!)));
    const errors=state.activities.filter(a=>a.turnId===turnId&&a.kind==='runtime.error');
    if(errors.some(a=>!a.createdAt))return 'running';
    return errors.some(a=>Date.parse(a.createdAt!)>=lastMessage)?'error':'complete';
  }
  // A newer session's error/ready status says nothing about this older turn.
  if(state.latestTurn&&state.latestTurn.turnId!==turnId)return 'running';
  if(messages.length&&messages.every(m=>!m.streaming)&&state.session&&['ready','stopped','interrupted','error'].includes(state.session.status))return state.session.status==='error'?'error':state.session.status==='interrupted'?'interrupted':'complete';
  return 'running';
}

/** Find the response containing the cursor/selection. */
export function inlineTargetAt(document:string,offset:number):string|undefined {
  return [...document.matchAll(/<!-- t3-inline:start:([0-9a-f-]{36}) -->/gi)]
    .map(match=>match[1]).find(id=>{const region=regionBody(document,id);return region&&offset>=region.from&&offset<=region.to;});
}

/** Preserve ordinary follow-up steering when the note has one running reply.
 * Several replies need a cursor-scoped or explicit target. */
export function inlineSteeringTarget(document:string,offset:number,responseId?:string):string|undefined {
  if(responseId)return responseId;
  const active=activeInlineIds(document),cursor=inlineTargetAt(document,offset);
  if(cursor)return active.includes(cursor)?cursor:undefined;
  return active.length===1?active[0]:undefined;
}
export function completionProof(id:string,body:string){return `<!-- t3-response:start:${id} -->\n${body}\n<!-- t3-response:end:${id} -->`;}
export function hasCompletionProof(document:string,id:string,body:string){return document.includes(completionProof(id,body));}

/** Thread titles are plain display text, never executable Markdown or HTML. */
export function inlineThreadLabel(title?:string){
  const text=(title??'').replace(/[\r\n\t]+/g,' ').trim().slice(0,160);
  return text?text.replace(/[\\`*_{}\[\]()#!|]/g,'\\$&').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'):'T3';
}
