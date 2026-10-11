import {turnForMessage,type InlineMessage,type InlineThreadState,type SelectionAnchor} from './inline-thread';
import {responseRegion} from './native-response-projection';
import {responseBoundaries} from './response-container';

export function completedSelectionDraft(document:string,id:string,steering:InlineSteering[]=[]){
  for(const input of steering){
    if(!input.confirmed||!input.selection)continue;
    const region=responseRegion(document,id);if(!region)throw Error('The response anchor changed before selection consumption.');
    const range=selectionRange(document,input.selection,region);
    if(range&&!responseBoundaries(document).some(boundary=>boundary.from<range.to&&boundary.to>range.from))document=document.slice(0,range.from)+document.slice(range.to);
  }
  return document;
}

/** Stored with the response checkpoint, never inferred from editable Markdown. */
export interface InlineSteering {
  messageId:string;text:string;before:InlineMessage[];
  selection?:SelectionAnchor;selectionApplied?:boolean;confirmed?:boolean;
  label?:string;createdAt?:string;position?:'live'|'recovered';
}
export interface SteeringInput {messageId:string;text:string;selection?:SelectionAnchor}

export function validSteeringInput(value:any):value is SteeringInput {
  const a=value?.selection;
  return !!value&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value.messageId??'')&&typeof value.text==='string'&&!!value.text.trim()&&value.text.length<=120_000&&
    (!a||typeof a.text==='string'&&!!a.text&&Number.isSafeInteger(a.start)&&a.start>=0&&Number.isSafeInteger(a.end)&&a.end===a.start+a.text.length&&typeof a.before==='string'&&typeof a.after==='string');
}

/** Place input after complete paragraphs; never split a live code fence. */
export function steeringBoundary(messages:InlineMessage[]):InlineMessage[] {
  return messages.map(message=>{
    if(!message.streaming)return {...message};
    let fence:{char:string;size:number}|undefined,last=0,offset=0;
    for(const line of message.text.split('\n')){
      const match=/^ {0,3}(`{3,}|~{3,})/.exec(line);
      if(match){if(!fence)fence={char:match[1][0],size:match[1].length};else if(match[1][0]===fence.char&&match[1].length>=fence.size&&!line.slice(match[0].length).trim())fence=undefined;}
      if(!fence&&!line.trim()&&offset<message.text.length)last=offset+line.length+1;
      offset+=line.length+1;
    }
    return {...message,text:message.text.slice(0,last)};
  });
}

/** Merge snapshots without losing earlier explicitly tracked turns. */
export function mergeProse(saved:InlineMessage[],incoming:InlineMessage[],turns:string[]):InlineMessage[] {
  const result=saved.filter(m=>m.role==='assistant'&&turns.includes(m.turnId??''));
  for(const message of incoming.filter(m=>m.role==='assistant'&&turns.includes(m.turnId??''))){
    const index=result.findIndex(m=>m.id===message.id);
    if(index<0)result.push({...message});else result[index]={...message};
  }
  // A later stream event may arrive before an earlier paragraph recovered by
  // a snapshot. Keep T3's creation order rather than arrival order.
  return result.sort((a,b)=>a.createdAt&&b.createdAt?a.createdAt.localeCompare(b.createdAt):0);
}

export function steeringSegments(messages:InlineMessage[],steering:InlineSteering[]):Array<{role:'assistant'|'user';text:string;messageId?:string;label?:string;position?:'live'|'recovered'}> {
  const result:Array<{role:'assistant'|'user';text:string;messageId?:string;label?:string;position?:'live'|'recovered'}>=[],consumed=new Map<string,string>();
  const append=(items:InlineMessage[])=>{
    for(const message of items){
      const before=consumed.get(message.id)??'';
      const text=message.text.startsWith(before)?message.text.slice(before.length):message.text;
      if(text.trim())result.push({role:'assistant',text,messageId:message.id});
      consumed.set(message.id,message.text);
    }
  };
  for(const input of steering){append(input.before);result.push({role:'user',text:input.text,messageId:input.messageId,label:input.label,position:input.position});}
  append(messages);return result;
}

/** Native v2 sender identity takes precedence. Older fleet messages retain
 * their validated display convention. Neither path changes delivery/bindings. */
export function incomingLabel(message:InlineMessage,local=false):string {
  const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  if(message.createdBy==='agent'&&uuid.test(message.senderThreadId??'')){
    const title=message.senderThreadTitle;
    return `Agent · ${typeof title==='string'&&title.trim()&&title.length<=160?title:message.senderThreadId!.slice(0,8)}`;
  }
  const records=(message.context as any)?.records;
  const senders=Array.isArray(records)?records.filter(record=>record?.kind==='fleet-sender'):[];
  if(senders.length===1){
    const record=senders[0],p=record.payload;
    if(record.version===1&&p?.version===1&&p.kind==='agent'&&uuid.test(p.environmentId??'')&&uuid.test(p.threadId??'')&&typeof p.title==='string'&&p.title.trim()&&p.title.length<=160)return `Agent · ${p.title}`;
  }
  return local?'You':'User';
}

/** A display association never adopts a provider turn or confirms execution.
 * T3's detail feed omits start-request events. Use the observed active session,
 * or a unique canonical source lifecycle when recovering null-turn inputs.
 * An authoritative newer primary always wins over these display observations. */
function displayTurn(state:InlineThreadState,message:InlineMessage,turns:string[]):string|undefined {
  const exact=turnForMessage(state,message.id);if(exact)return exact;
  const observed=state.inputTurns?.[message.id];if(observed)return observed;
  const created=Date.parse(message.createdAt??'');if(!Number.isFinite(created))return;
  const candidates=turns.filter(id=>{
    const turn=state.turns?.[id]??(state.latestTurn?.turnId===id?state.latestTurn:undefined);
    const requested=Date.parse(turn?.requestedAt??'');
    if(!turn||!turn.messageId||!Number.isFinite(requested)||requested>=created)return false;
    const completed=Date.parse(turn.completedAt??'');
    return Number.isFinite(completed)?created<completed:state.session?.status==='running'&&state.session.activeTurnId===id&&created<=Date.now();
  });
  return candidates.length===1?candidates[0]:undefined;
}

/** Canonical display records are separate from local editor removal receipts.
 * Display incoming thread messages within tracked response lifecycles only.
 * This does not change execution bindings or follow later primary turns. */
export function observeIncoming(state:InlineThreadState,turns:string[],saved:InlineSteering[]=[],local:InlineSteering[]=[],excluded:string[]=[]):InlineSteering[]{
  const result=saved.filter(input=>{const turn=turnForMessage(state,input.messageId);return (!excluded.includes(input.messageId)||local.some(item=>item.messageId===input.messageId))&&(!turn||turns.includes(turn)||local.some(item=>item.messageId===input.messageId));}).map(input=>({...input}));
  for(const message of state.messages){
    if(message.role!=='user'||!message.text.trim())continue;
    const reservation=local.find(input=>input.messageId===message.id);
    if(!reservation&&excluded.includes(message.id))continue;
    const turn=displayTurn(state,message,turns);
    if(!reservation&&(!turn||!turns.includes(turn)))continue;
    const old=result.find(input=>input.messageId===message.id);
    const index=state.messages.findIndex(item=>item.id===message.id);
    // Snapshots cannot reconstruct how much a same-id assistant paragraph had
    // grown when the input arrived. Keep canonical message order and disclose
    // that the recovered paragraph position is approximate.
    const preceding=state.messages.slice(0,index).filter(item=>item.role==='assistant'&&turns.includes(item.turnId??'')&&(!message.createdAt||!item.createdAt||item.createdAt<message.createdAt));

    const localOffset=reservation?message.text.indexOf(reservation.text):-1;
    const exactLocal=reservation&&localOffset>=0&&message.text.indexOf(reservation.text,localOffset+1)<0;
    const observed=state.inputBoundaries?.[message.id]?.filter(item=>turns.includes(item.turnId??''));
    const input:InlineSteering={messageId:message.id,text:exactLocal?message.text.slice(localOffset,localOffset+reservation.text.length):message.text,before:old?.before??reservation?.before??(observed?steeringBoundary(observed):steeringBoundary(preceding)),confirmed:true,label:incomingLabel(message,!!reservation),createdAt:message.createdAt,position:old?.position??(reservation||observed?'live':'recovered')};
    if(old)Object.assign(old,input);else result.push(input);
  }
  const positions=new Map(state.messages.map((message,index)=>[message.id,index]));
  return result.sort((a,b)=>a.createdAt&&b.createdAt&&a.createdAt!==b.createdAt?a.createdAt.localeCompare(b.createdAt):(positions.get(a.messageId)??Number.MAX_SAFE_INTEGER)-(positions.get(b.messageId)??Number.MAX_SAFE_INTEGER));
}

export function selectionRange(document:string,anchor:SelectionAnchor,exclude?:{from:number;to:number}):{from:number;to:number}|null {
  const at=(start:number)=>document.slice(start,start+anchor.text.length)===anchor.text&&document.slice(Math.max(0,start-anchor.before.length),start).endsWith(anchor.before)&&document.slice(start+anchor.text.length).startsWith(anchor.after);
  if(exclude){
    // The confirmed You quote is a second copy of the text, not a candidate
    // selection. Recheck the unchanged outside anchor if Sync restores it.
    const matches:number[]=[];
    for(let start=document.indexOf(anchor.text);start>=0;start=document.indexOf(anchor.text,start+1))if((start+anchor.text.length<=exclude.from||start>=exclude.to)&&at(start))matches.push(start);
    return matches.length===1?{from:matches[0],to:matches[0]+anchor.text.length}:null;
  }
  if(at(anchor.start))return {from:anchor.start,to:anchor.start+anchor.text.length};
  const start=document.indexOf(anchor.text);
  return start>=0&&document.indexOf(anchor.text,start+1)<0&&at(start)?{from:start,to:start+anchor.text.length}:null;
}
