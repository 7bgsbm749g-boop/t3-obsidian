import {contentHash} from './completion';

export interface SelectionAnchor {text:string;start:number;end:number;before:string;after:string}
export interface InlineMessage {id:string;role:string;text:string;turnId:string|null;streaming:boolean;createdAt?:string}
export interface InlineActivity {id:string;kind:string;summary:string;turnId:string|null}
export interface InlineThreadState {messages:InlineMessage[];activities:InlineActivity[];session?:{status:string;activeTurnId:string|null};latestTurn?:{turnId:string;state:string;requestedAt?:string}}

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
export function initialRegion(id:string):{text:string;bodyHash:string} {
  const body='**T3 · Sending…**';
  return {text:`\n${startMarker(id)}\n${body}\n${endMarker(id)}\n`,bodyHash:contentHash(body)};
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
    return {state:{...state,messages:old?state.messages.map(m=>m.id===message.id?message:m):[...state.messages,message]},sequence:event.sequence};
  }
  if(event.type==='thread.activity-appended'&&validActivity(p?.activity)){
    const activities=state.activities.some(a=>a.id===p.activity.id)?state.activities:[...state.activities,p.activity];
    return {state:{...state,activities},sequence:event.sequence};
  }
  if(event.type==='thread.session-set'&&p?.session&&typeof p.session.status==='string'){
    const session=p.session;
    let latestTurn=state.latestTurn;
    if(session.status==='running'&&typeof session.activeTurnId==='string')latestTurn={turnId:session.activeTurnId,state:'running'};
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

export function renderInlineTurn(state:InlineThreadState,turnId:string,threadId:string,phase:'sending'|'running'|'reconnecting'|'complete'|'interrupted'|'error'|'cancelled'='running'):string {
  const messages=state.messages.filter(m=>m.turnId===turnId&&m.role==='assistant');
  const answer=messages.map(m=>m.text).filter(Boolean).join('\n\n').replace(/\n+$/,'');
  const activity=state.activities.filter(a=>a.turnId===turnId&&/^(tool\.|approval\.|user-input\.|plan\.)/.test(a.kind)).at(-1);
  const needsResponse=activity&&/^(approval\.requested|user-input\.requested)$/.test(activity.kind);
  const heading=phase==='complete'?'**T3 answer**':`**T3 · ${phase==='running'?'Working':phase==='sending'?'Sending':phase==='reconnecting'?'Reconnecting':phase==='cancelled'?'Stopped':phase==='interrupted'?'Interrupted':'Error'}**`;
  const status=phase==='complete'?'':needsResponse?'\n\n> Action needed in T3: '+safeStatus(activity.summary):activity?'\n\n> '+safeStatus(activity.summary):'';
  // Quote every line to isolate Markdown lists from numbered replies elsewhere
  // in a Live Preview editor. The marker owns the final newline, not the body.
  const body=answer?`\n\n${closeOpenFence(answer).split('\n').map(line=>line?`> ${line}`:'>').join('\n')}`:'';
  return `${heading} · \`${threadId}\`${status}${body}`;
}

export function turnPhase(state:InlineThreadState,turnId:string):'running'|'complete'|'interrupted'|'error' {
  if(state.latestTurn?.turnId===turnId&&['completed','interrupted','error'].includes(state.latestTurn.state))return state.latestTurn.state==='completed'?'complete':state.latestTurn.state as 'interrupted'|'error';
  if(state.session?.activeTurnId===turnId)return 'running';
  const messages=state.messages.filter(m=>m.turnId===turnId&&m.role==='assistant');
  if(messages.length&&messages.every(m=>!m.streaming)&&state.session&&['ready','stopped','interrupted','error'].includes(state.session.status))return state.session.status==='error'?'error':state.session.status==='interrupted'?'interrupted':'complete';
  return 'running';
}
