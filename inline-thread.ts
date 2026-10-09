import {escapeReplyHtml,markdownCodeRanges} from './reply-html';
import {contentHash} from './completion';
import {pendingQuestions,renderQuestion} from './questions';
import {pendingApprovals,renderApproval} from './approvals';
import {intermediateMode,runTimer,type IntermediateMode,type RunTiming,type FinalAnswerFormat} from './response-presentation';
import {steeringSegments,type InlineSteering} from './inline-steering';
import {responseActivityLabel,responseActivityRow} from './response-activity';
import {visibleInlineInput} from './input-presentation';
import {responseToolGroups,currentResponseToolGroup,renderResponseToolGroup} from './response-tools';
import {applyV2ControlEvent,responseRun} from './orchestration-v2';
import {responseEmissions} from './response-emissions';

export interface SelectionAnchor {text:string;start:number;end:number;before:string;after:string}
export interface InlineMessage {id:string;role:string;text:string;turnId:string|null;streaming:boolean;createdAt?:string;context?:unknown}
export interface InlineActivity {id:string;kind:string;summary:string;turnId:string|null;createdAt?:string;sequence?:number;payload?:Record<string,any>}
export interface InlineTurn {turnId:string;state:string;messageId?:string;requestedAt?:string;completedAt?:string|null;assistantMessageId?:string|null;ordinal?:number}
export interface InlineStartRequest {messageId:string;requestedAt:string;sequence:number;activeTurnId?:string;turnId?:string;failed?:boolean}
export interface InlineBinding {turnId:string;kind:'explicit'|'timestamp'|'start'|'steer';sequence?:number}
export interface InlineBindingCheckpoint {protocolVersion?:2;bindings?:Record<string,InlineBinding>;starts?:Record<string,InlineStartRequest>;turns?:Record<string,InlineTurn>;sequence?:number;inputBoundaries?:Record<string,InlineMessage[]>;inputTurns?:Record<string,string>;session?:{status:string;activeTurnId:string|null;lastError?:string|null};latestTurn?:InlineTurn}
export interface InlineThreadState extends InlineBindingCheckpoint {title?:string;messages:InlineMessage[];activities:InlineActivity[];session?:{status:string;activeTurnId:string|null;lastError?:string|null};latestTurn?:InlineTurn;turns?:Record<string,InlineTurn>;historyComplete?:boolean;legacyMessageIds?:string[];v2Requests?:Record<string,any>;v2Controls?:Record<string,any>;checkpoints?:Array<{turnId:string;status:string;checkpointRef:string;assistantMessageId?:string|null;completedAt?:string}>}

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
  return [...document.matchAll(/<!-- t3-inline:start:([0-9a-f-]{36}) -->/gi)].map(match=>match[1]).filter(id=>/^(?:> \[!t3-progress\][+-] )?\*\*[^\n]+ · (?:Sending…|Working|Reconnecting)\*\*/m.test(regionBody(document,id)?.body??''));
}
export function failedInlineIds(document:string):string[]{
  return [...document.matchAll(/<!-- t3-inline:start:([0-9a-f-]{36}) -->/gi)].map(match=>match[1]).filter(id=>/^(?:> \[!t3-progress\][+-] )?\*\*[^\n]+ · Error\*\*/m.test(regionBody(document,id)?.body??''));
}
export interface InitialInlineInput {messageId:string;text:string;label?:string}

/** The same neutral user quote is used for initial questions and steering. */
export function renderInlineInput(text:string,label='You',position?:'live'|'recovered'):string {
  const heading=label.replace(/[\r\n\t]+/g,' ').replace(/[\\`*_{}\[\]()#+.!>|]/g,'\\$&').slice(0,200);
  return `> [!t3-steering] ${heading}${position==='recovered'?' · Recovered (paragraph position approximate)':''}\n${closeOpenFence(visibleInlineInput(text)).split('\n').map(line=>line?`> ${line}`:'>').join('\n')}`;
}

export function initialRegion(id:string,initialInput?:InitialInlineInput,threadTitle?:string,mode:IntermediateMode='remove',timing?:RunTiming):{text:string;bodyHash:string} {
  const status=`${mode==='collapse'?'> [!t3-progress]+ ':''}**${inlineThreadLabel(threadTitle)} · Working**${timing?' '+runTimer(timing):''} <span class="send-to-t3-inline-spinner" aria-label="Loading"></span>`;
  const body=(initialInput?`${renderInlineInput(initialInput.text,initialInput.label)}\n\n${status}`:status)+(mode==='collapse'?'\n>\n> ':'\n\n')+responseActivityRow();
  // The final blank line also closes the quote in Obsidian Live Preview when
  // this response is the last block in the note.
  return {text:`\n${startMarker(id)}\n${body}\n${endMarker(id)}\n\n`,bodyHash:contentHash(body)};
}

/** Update a waiting header without rebuilding an unbound response's contents. */
export function renameInlineHeader(body:string,title:string):string {
  return body.replace(/^((?:> \[!t3-progress\][+-] )?\*\*)[^\n]*( · (?:Working|Reconnecting)\*\*)/m,(_match,prefix,suffix)=>`${prefix}${inlineThreadLabel(title)}${suffix}`);
}

export function regionBody(document:string,id:string):{from:number;to:number;body:string}|null {
  return trackedRegion(document,id,'t3-inline');
}

function markerLines(document:string,prefix:'t3-inline'|'t3-response') {
  const matches=[...document.matchAll(new RegExp(`<!-- ${prefix}:(start|end):([a-z0-9-]+) -->`,'g'))];
  if(!matches.length)return [];
  const code=markdownCodeRanges(document);
  return matches
    .filter(match=>!code.some(([from,to])=>match.index!>=from&&match.index!<to));
}
function trackedRegion(document:string,id:string,prefix:'t3-inline'|'t3-response'):{from:number;to:number;body:string}|null {
  // An absent exact boundary cannot form a valid region. Avoid parsing an
  // unrelated historical response's whole Markdown document in this case.
  if(!document.includes(`<!-- ${prefix}:start:${id} -->`)||!document.includes(`<!-- ${prefix}:end:${id} -->`))return null;
  const lines=markerLines(document,prefix).filter(match=>match[2]===id);
  if(lines.length!==2||lines[0][1]!=='start'||lines[1][1]!=='end')return null;
  const from=lines[0].index!+lines[0][0].length+1,to=lines[1].index!-1;
  return to>=from?{from,to,body:document.slice(from,to)}:null;
}

export function replaceRegion(document:string,id:string,expectedHash:string,next:string):{from:number;to:number;text:string;hash:string}|null {
  const found=regionBody(document,id);
  if(!found||contentHash(found.body)!==expectedHash)return null;
  return {from:found.from,to:found.to,text:next,hash:contentHash(next)};
}

/** Remove a completed reply's tracking lines with the final body in one edit. */
export function finalizeRegion(document:string,id:string,expectedHash:string,finalBody:string):{from:number;to:number;text:string}|null {
  const found=regionBody(document,id);
  if(!found||contentHash(found.body)!==expectedHash||markerLines(found.body,'t3-inline').length)return null;
  const start=startMarker(id),end=endMarker(id);
  const from=found.from-start.length-1,endFrom=found.to+1;
  if(document.slice(from,from+start.length)!==start||document.slice(endFrom,endFrom+end.length)!==end)return null;
  // The hidden start marker occupies a line in Live Preview. Keep that line
  // empty when finalizing so the reply does not jump up after it disappears.
  return {from,to:endFrom+end.length,text:`\n${finalBody.replace(/\n+$/,'')}`};
}

/** Keep exact prompt evidence independently of a snapshot's recent transcript. */
export function inlineBindingCheckpoint(state:InlineThreadState):InlineBindingCheckpoint {
  return {protocolVersion:state.protocolVersion,bindings:state.bindings,starts:state.starts,turns:{...state.turns,...(state.latestTurn?{[state.latestTurn.turnId]:state.latestTurn}:{})},sequence:state.sequence,inputBoundaries:state.inputBoundaries,inputTurns:state.inputTurns,session:state.session?{status:state.session.status,activeTurnId:state.session.activeTurnId}:undefined,latestTurn:state.latestTurn};
}
function retiredV1Turn(turn:InlineTurn):InlineTurn {
  return ['preparing','starting','running','waiting','queued'].includes(turn.state)?{...turn,state:'interrupted'}:turn;
}
function legacyMessages(state:InlineThreadState,turns:Record<string,InlineTurn>,bindings?:Record<string,InlineBinding>){
  const imported=new Set(state.legacyMessageIds);
  return state.messages.map(message=>{
    if(message.turnId||!imported.has(message.id))return message;
    const ids=message.role==='user'&&bindings?.[message.id]?[bindings[message.id].turnId]:message.role==='assistant'?Object.values(turns).filter(turn=>turn.assistantMessageId===message.id).map(turn=>turn.turnId):[];
    return ids.length===1?{...message,turnId:ids[0]}:message;
  });
}
export function restoreInlineBindings(state:InlineThreadState,saved?:InlineBindingCheckpoint):InlineThreadState {
  if(state.protocolVersion===2&&saved&&saved.protocolVersion!==2)saved={...saved,sequence:undefined,starts:undefined,session:undefined,latestTurn:undefined};
  if(saved?.sequence!==undefined&&state.sequence!==undefined&&saved.sequence>state.sequence)return {...saved,messages:[],activities:[],historyComplete:false};
  const turns={...saved?.turns};
  for(const [id,turn] of Object.entries({...state.turns,...(state.latestTurn?{[state.latestTurn.turnId]:state.latestTurn}:{})}))turns[id]={...turns[id],...turn,...(turns[id]?.messageId?{messageId:turns[id].messageId,requestedAt:turns[id].requestedAt}:{})};
  for(const [messageId,binding] of Object.entries(saved?.bindings??{}))if(state.legacyMessageIds?.includes(messageId)&&!state.turns?.[binding.turnId]&&turns[binding.turnId])turns[binding.turnId]=retiredV1Turn(turns[binding.turnId]);
  const latestTurn=state.latestTurn??saved?.latestTurn;
  const bindings={...saved?.bindings,...state.bindings};
  return establishBindings({...state,messages:legacyMessages(state,turns,bindings),session:state.session??saved?.session,inputBoundaries:{...saved?.inputBoundaries,...state.inputBoundaries},inputTurns:{...saved?.inputTurns,...state.inputTurns},sequence:state.sequence??saved?.sequence,latestTurn:latestTurn?turns[latestTurn.turnId]??latestTurn:undefined,turns,bindings,starts:{...saved?.starts,...state.starts}});
}
function establishBindings(state:InlineThreadState):InlineThreadState {
  const bindings={...state.bindings},turns={...state.turns},starts={...state.starts};
  if(state.latestTurn)turns[state.latestTurn.turnId]={...turns[state.latestTurn.turnId],...state.latestTurn};
  // Canonical recovery can confirm observed steering even when the feed stops
  // before its next output. Require the saved exact request and active run,
  // output created afterwards, and no authoritative newer primary association.
  for(const [id,request] of Object.entries(starts))if(!request.failed&&!request.turnId&&request.activeTurnId){
    const turn=turns[request.activeTurnId],created=Date.parse(request.requestedAt);
    const crossed=Object.values(turns).some(t=>t.turnId!==request.activeTurnId&&t.requestedAt===request.requestedAt);
    const active=state.session?.activeTurnId===request.activeTurnId||turn?.state==='completed'&&Date.parse(turn.completedAt??'')>=created;
    if(!crossed&&active&&state.messages.some(m=>m.role==='assistant'&&m.turnId===request.activeTurnId&&Date.parse(m.createdAt??'')>=created))starts[id]={...request,turnId:request.activeTurnId};
  }
  for(const message of state.messages.filter(m=>m.role==='user')){
    const request=starts[message.id];
    if(request?.failed)continue;
    if(message.turnId){bindings[message.id]={turnId:message.turnId,kind:'explicit'};const turn=turns[message.turnId];if(turn&&!turn.messageId&&(!message.createdAt||turn.requestedAt===message.createdAt))turns[message.turnId]={...turn,messageId:message.id};continue;}
    const matches=Object.values(turns).filter(t=>t.messageId===message.id||!t.messageId&&message.createdAt&&t.requestedAt===message.createdAt&&state.messages.filter(m=>m.role==='user'&&m.createdAt===message.createdAt).length===1);
    // A provider turn shared by steering must not steal the primary timestamp.
    if(matches.length===1){
      const turnId=matches[0].turnId,kind=matches[0].messageId===message.id?'start':'timestamp',previous=bindings[message.id];
      turns[turnId]={...matches[0],messageId:message.id};
      // This sequence marks when the association was first observed, not the
      // global watermark of every later snapshot. Exact start event sequences
      // remain in starts and are never replaced by this inferred evidence.
      bindings[message.id]={turnId,kind,sequence:previous?.turnId===turnId&&previous.kind===kind?previous.sequence:state.sequence};continue;
    }
    if(request?.turnId&&!bindings[message.id])bindings[message.id]={turnId:request.turnId,kind:request.activeTurnId===request.turnId?'steer':'start',sequence:state.sequence};
  }
  for(const [id,binding] of Object.entries(bindings)){
    const request=starts[id],turn=turns[binding.turnId];
    // Canonical latestTurn.requestedAt may be the provider's session-start
    // timestamp. Once the exact primary message is proven, retain its actual
    // start request timestamp independently of that provider clock.
    if(request&&!request.failed&&binding.kind!=='steer'&&turn?.messageId===id){
      turns[binding.turnId]={...turn,requestedAt:request.requestedAt};
      starts[id]={...request,turnId:binding.turnId};
    }
  }
  return {...state,bindings,starts,turns,latestTurn:state.latestTurn?turns[state.latestTurn.turnId]:undefined};
}

export function applyThreadItem(previous:InlineThreadState,item:any):{state:InlineThreadState;sequence?:number} {
  if(item?.kind==='snapshot'&&item.snapshot?.thread?.protocolVersion===2&&previous.protocolVersion!==2)previous={...previous,sequence:undefined};
  const sequence=item?.kind==='snapshot'?item.snapshot?.snapshotSequence:item?.kind==='event'?item.event?.sequence:undefined;
  if(sequence!==undefined&&(!Number.isSafeInteger(sequence)||sequence<0))return {state:previous};
  if(previous.sequence!==undefined&&sequence!==undefined&&(sequence<previous.sequence||item.kind==='event'&&sequence===previous.sequence))return {state:previous};
  let state=sequence===undefined?previous:{...previous,sequence};
  const finish=(next:InlineThreadState)=>({state:establishBindings(next),sequence});
  if(item?.kind==='snapshot'){
    const thread=item.snapshot?.thread;
    if(!thread||!Array.isArray(thread.messages))throw Error('T3 returned an invalid thread snapshot.');
    const turns={...state.turns,...(state.latestTurn?{[state.latestTurn.turnId]:state.latestTurn}:{}),...thread.turns};
    let latestTurn=thread.latestTurn??undefined;
    if(latestTurn){
      const saved=turns[latestTurn.turnId];
      latestTurn={...saved,...latestTurn,...(saved?.messageId?{messageId:saved.messageId,requestedAt:saved.requestedAt}:{})};
      turns[latestTurn.turnId]=latestTurn;
    }
    // V1 import preserves transcript IDs but removes provider runs. Retained
    // old response bindings are terminal; never attach them to a new app run.
    if(thread.protocolVersion===2)for(const [messageId,binding] of Object.entries(state.bindings??{})){
      if(thread.legacyMessageIds?.includes(messageId)&&!thread.turns?.[binding.turnId]&&turns[binding.turnId])turns[binding.turnId]=retiredV1Turn(turns[binding.turnId]);
    }
    const messages=legacyMessages({...state,messages:thread.messages.filter(validMessage),legacyMessageIds:thread.legacyMessageIds},turns,state.bindings);
    return finish({...state,protocolVersion:thread.protocolVersion,legacyMessageIds:thread.legacyMessageIds,title:typeof thread.title==='string'?thread.title:state.title,messages,activities:Array.isArray(thread.activities)?thread.activities.filter(validActivity):[],session:thread.session??undefined,latestTurn,turns,v2Requests:thread.v2Requests,v2Controls:thread.v2Controls,historyComplete:!item.snapshot.page?.hasMore,checkpoints:Array.isArray(thread.checkpoints)?thread.checkpoints:[]});
  }
  if(item?.kind!=='event')return {state:previous};
  const event=item.event,p=event?.payload;
  if(event.type==='thread.run-updated'&&typeof p?.id==='string'){
    const turn=responseRun(p,state.messages),turns:Record<string,InlineTurn>={...state.turns,[p.id]:turn};
    const queued=p.status==='queued',newest=!queued&&(!state.latestTurn||p.ordinal>=(state.latestTurn.ordinal??0));
    const latestTurn=newest?turn:state.latestTurn;
    const ownsActive=state.session?.activeTurnId===p.id;
    const active=Object.values(turns).filter(t=>t.state==='running').sort((a,b)=>(a.ordinal??0)-(b.ordinal??0)).at(-1);
    const session=active?{status:'running',activeTurnId:active.turnId}:newest||ownsActive?{status:turn.state==='error'?'error':turn.state==='interrupted'?'stopped':'ready',activeTurnId:null}:state.session;
    return finish({...state,turns,latestTurn,session});
  }
  if(event.type==='v2.turn-item.updated'||event.type==='v2.runtime-request.updated')return finish(applyV2ControlEvent(state,event));
  if(event.type==='thread.metadata-updated'&&typeof p?.title==='string')return finish({...state,title:p.title});
  if(event.type==='thread.turn-start-requested'&&typeof p?.messageId==='string'&&typeof p.createdAt==='string'){
    const existing=state.starts?.[p.messageId];
    if(existing)return finish(state);
    const activeTurnId=state.session?.status==='running'?state.session.activeTurnId??undefined:undefined;
    return finish({...state,starts:{...state.starts,[p.messageId]:{messageId:p.messageId,requestedAt:p.createdAt,sequence:event.sequence,activeTurnId}}});
  }
  if(event.type==='thread.message-sent'&&p&&typeof p.messageId==='string'&&typeof p.text==='string'&&typeof p.role==='string'){
    const old=state.messages.find(m=>m.id===p.messageId);
    const message:InlineMessage={id:p.messageId,role:p.role,turnId:p.turnId??null,streaming:p.streaming===true,text:old&&!p.replace?(p.streaming?old.text+p.text:p.text||old.text):p.text,createdAt:old?.createdAt??p.createdAt,context:p.context??old?.context};
    const latestTurn=p.role==='assistant'&&p.turnId&&state.latestTurn&&state.latestTurn.turnId===p.turnId?{...state.latestTurn,assistantMessageId:p.messageId}:state.latestTurn;
    const starts={...state.starts};
    // T3's detail stream omits turn-start-requested. A message-mode question
    // resolution and its exact async-answer message carry the same accepted
    // start identity; retain it for the subsequent provider lifecycle. Native
    // answers, bare appended messages and mismatched timestamps prove no start.
    if(p.role==='user'&&p.messageId.startsWith('async-answer:')&&typeof p.createdAt==='string'&&Number.isFinite(Date.parse(p.createdAt))&&!starts[p.messageId]){
      const requestId=p.messageId.slice('async-answer:'.length);
      const resolved=state.activities.find(activity=>activity.kind==='user-input.resolved'&&activity.payload?.requestId===requestId&&activity.payload?.responseMode==='message'&&activity.payload?.answers&&activity.createdAt===p.createdAt);
      if(resolved)starts[p.messageId]={messageId:p.messageId,requestedAt:p.createdAt,sequence:event.sequence,activeTurnId:state.session?.status==='running'?state.session.activeTurnId??undefined:undefined};
    }
    // A projected prompt plus its start request while the same primary run is
    // active can follow that run's subsequent output. Never use a late prior
    // run, a bare user append, or output created before the request.
    if(p.role==='assistant'&&p.turnId&&state.session?.status==='running'&&state.session.activeTurnId===p.turnId){
      for(const [id,request] of Object.entries(starts))if(!request.failed&&!request.turnId&&request.activeTurnId===p.turnId&&event.sequence>request.sequence&&Date.parse(p.createdAt)>=Date.parse(request.requestedAt))starts[id]={...request,turnId:p.turnId};
    }
    const inputBoundaries=p.role==='user'&&!old&&!state.inputBoundaries?.[message.id]?{...state.inputBoundaries,[message.id]:state.messages.filter(m=>m.role==='assistant'&&m.turnId===state.session?.activeTurnId).map(m=>({...m}))}:state.inputBoundaries;
    const inputTurns=p.role==='user'&&!old&&state.session?.status==='running'&&state.session.activeTurnId?{...state.inputTurns,[message.id]:state.session.activeTurnId}:state.inputTurns;
    return finish({...state,inputTurns,inputBoundaries,starts,latestTurn,messages:old?state.messages.map(m=>m.id===message.id?message:m):[...state.messages,message]});
  }
  if(event.type==='thread.activity-appended'&&validActivity(p?.activity)){
    const activity=p.activity,activities=state.activities.some(a=>a.id===activity.id)?state.activities:[...state.activities,activity];
    const starts={...state.starts},bindings={...state.bindings};
    const failedId=activity.kind==='provider.turn.start.failed'?activity.payload?.requestId:undefined;
    if(failedId&&starts[failedId]){starts[failedId]={...starts[failedId],failed:true};delete bindings[failedId];}
    return finish({...state,activities,starts,bindings});
  }
  if(event.type==='thread.session-set'&&p?.session&&typeof p.session.status==='string'){
    const session=p.session,starts={...state.starts},turns={...state.turns};
    let latestTurn=state.latestTurn;
    if(session.status==='running'&&typeof session.activeTurnId==='string'){
      const id=session.activeTurnId,saved=turns[id]??(latestTurn?.turnId===id?latestTurn:undefined);
      latestTurn={...saved,turnId:id,state:'running',completedAt:null};
      const pending=Object.values(starts).filter(r=>!r.failed&&!r.turnId&&r.sequence<event.sequence);
      // Multiple outstanding starts are ambiguous. An old active run cannot
      // accept a new primary request just because a status event arrived late.
      if(pending.length===1){
        const request=pending[0],same=request.activeTurnId===id;
        const newPrimary=!saved&&!request.activeTurnId;
        const racedPrimary=!saved&&request.activeTurnId!==id&&state.session?.activeTurnId!==id;
        if((same||newPrimary||racedPrimary)&&Date.parse(session.updatedAt??event.occurredAt)>=Date.parse(request.requestedAt)){
          starts[request.messageId]={...request,turnId:id};
          if(!same)latestTurn={...latestTurn,messageId:request.messageId,requestedAt:request.requestedAt};
        }
      }
    }else if(latestTurn?.state==='running'&&['ready','stopped','interrupted','error'].includes(session.status)){
      latestTurn={...latestTurn,state:session.status==='error'?'error':session.status==='interrupted'||session.status==='stopped'?'interrupted':'completed',completedAt:session.updatedAt??event.occurredAt};
      // A start that never acquired a provider turn remains unavailable. Do
      // not let a later unrelated session resurrect that interrupted request.
      for(const [id,r] of Object.entries(starts))if(!r.turnId&&!r.activeTurnId)starts[id]={...r,failed:true};
    }else if(['stopped','interrupted','error'].includes(session.status)){
      for(const [id,r] of Object.entries(starts))if(!r.turnId)starts[id]={...r,failed:true};
    }
    if(state.latestTurn)turns[state.latestTurn.turnId]=state.latestTurn;
    if(latestTurn)turns[latestTurn.turnId]=latestTurn;
    return finish({...state,session,latestTurn,turns,starts});
  }
  if(event.type==='thread.turn-diff-completed'&&typeof p?.turnId==='string')return finish({...state,checkpoints:[...(state.checkpoints??[]).filter(c=>c.turnId!==p.turnId),p]});
  return finish(state);
}
function validMessage(value:any):value is InlineMessage{return value&&typeof value.id==='string'&&typeof value.role==='string'&&typeof value.text==='string'&&typeof value.streaming==='boolean';}
function validActivity(value:any):value is InlineActivity{return value&&typeof value.id==='string'&&typeof value.kind==='string'&&typeof value.summary==='string';}

/** Bind only exact projected IDs, start-request evidence, or unique primary
 * timestamps. A transcript interval alone cannot exclude unrelated/late runs. */
export function turnForMessage(state:InlineThreadState,messageId:string):string|undefined {
  const message=state.messages.find(m=>m.id===messageId&&m.role==='user');
  if(state.starts?.[messageId]?.failed)return;
  if(message?.turnId)return message.turnId;
  if(state.bindings?.[messageId])return state.bindings[messageId].turnId;
  if(!message)return;
  const turns={...state.turns,...(state.latestTurn?{[state.latestTurn.turnId]:state.latestTurn}:{})};
  const matches=Object.values(turns).filter(t=>t.messageId===messageId||!t.messageId&&message.createdAt&&t.requestedAt===message.createdAt&&state.messages.filter(m=>m.role==='user'&&m.createdAt===message.createdAt).length===1);
  return matches.length===1?matches[0].turnId:undefined;
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

/** Completed blocks use normal Markdown. The growing tail stays literal until
 * a blank-line boundary outside a fence, so incomplete syntax cannot repeatedly
 * turn an existing paragraph into a table, heading, or code widget. */
function quoteStreamingResponse(text:string):string {
  let boundary=0,offset=0,fence:string|undefined;
  for(const line of text.split('\n')){
    const match=/^ {0,3}(`{3,}|~{3,})/.exec(line);
    if(match){if(!fence)fence=match[1];else if(match[1][0]===fence[0]&&match[1].length>=fence.length&&line.slice(match[0].length).trim()==='')fence=undefined;}
    if(!fence&&!line.trim()&&offset<text.length)boundary=offset+line.length+1;
    offset+=line.length+1;
  }
  const prefix=text.slice(0,boundary).trimEnd(),tail=text.slice(boundary);
  const escaped=tail.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/\n/g,'&#10;');
  return (prefix?quoteResponse(prefix)+(tail?'\n>\n':''):'')+(tail?`> <span class="send-to-t3-stream-tail">${escaped}</span>`:'');
}

/** Select the completed turn's prose consistently for rendering and assets. */
export function inlineTurnMessages(state:InlineThreadState,turnId:string,keepIntermediate=false):InlineMessage[] {
  const messages=state.messages.filter(m=>m.turnId===turnId&&m.role==='assistant');
  const finalId=state.latestTurn?.turnId===turnId?state.latestTurn.assistantMessageId:state.checkpoints?.find(c=>c.turnId===turnId&&c.checkpointRef?.startsWith('refs/t3/checkpoints/'))?.assistantMessageId??state.turns?.[turnId]?.assistantMessageId;
  let final=messages.find(m=>m.id===finalId)??messages.at(-1);
  // Some providers seal a checkpoint against the last commentary paragraph
  // just before delivering final prose. Arrival order cannot repair that ID:
  // use only finalized messages created strictly later and before completion.
  const turn=state.latestTurn?.turnId===turnId?state.latestTurn:state.turns?.[turnId];
  const completed=Date.parse(turn?.completedAt??state.checkpoints?.find(c=>c.turnId===turnId&&c.status==='ready')?.completedAt??'');
  let latest=Date.parse(final?.createdAt??'');
  if(Number.isFinite(completed)&&Number.isFinite(latest))for(const message of messages){
    const created=Date.parse(message.createdAt??'');
    if(!message.streaming&&created>latest&&created<=completed){final=message;latest=created;}
  }
  return keepIntermediate?messages:final?[final]:[];
}

/** Keep terminal turn evidence when later snapshots omit older metadata.
 * Failed partial output must not become a final answer during continuation. */
export function rememberInlineTurns(state:InlineThreadState,turnIds:string[],saved:Record<string,InlineTurn>={}):Record<string,InlineTurn> {
  const result={...saved};
  for(const turnId of turnIds){
    const phase=turnPhase(state,turnId),turn=state.latestTurn?.turnId===turnId?state.latestTurn:state.turns?.[turnId];
    if(phase==='error'||phase==='interrupted')result[turnId]={...turn,turnId,state:phase};
    else if(phase==='complete'){
      const final=inlineTurnMessages(state,turnId).at(-1);
      if(final&&!final.streaming)result[turnId]={...turn,turnId,state:'completed',assistantMessageId:final.id};
    }
  }
  return result;
}

export function renderInlineTurn(state:InlineThreadState,turnId:string,threadId:string,phase:'sending'|'running'|'reconnecting'|'complete'|'interrupted'|'error'|'cancelled'='running',keepIntermediate:boolean|IntermediateMode=false,environmentId?:string,conversation?:{messages:InlineMessage[];steering:InlineSteering[];preserveHistory?:boolean},initialInput?:InitialInlineInput,threadTitle?:string,timing?:RunTiming,format:FinalAnswerFormat='formatted'):string {
  const mode=intermediateMode(keepIntermediate),retain=mode!=='remove';
  // Completion and final-message delivery can arrive separately. Keep terminal
  // controls terminal, but close history only after the final text is present.
  const completedFinal=phase==='complete'?inlineTurnMessages(state,turnId).at(-1):undefined;
  const finalReady=!!completedFinal&&!completedFinal.streaming;
  const messages=inlineTurnMessages(state,turnId,phase!=='complete'||retain);
  const answer=messages.map(m=>m.text.replace(/\n+$/,'')).filter(Boolean).join('\n\n');
  // A continuation uses the same transcript as steering, even before the first
  // steer. Keep the final-only preference for unsteered completed responses.
  const transcript=conversation&&(phase!=='complete'||retain||conversation.steering.length||conversation.preserveHistory)?conversation:undefined;
  const segments=transcript?steeringSegments(transcript.messages,transcript.steering.filter(input=>input.confirmed)):[];
  const all=conversation?.messages??inlineTurnMessages(state,turnId,true);
  const finalIds=new Set<string>();
  // Never guess which live paragraph is the final answer. Completed earlier
  // turns remain identifiable while a continuation or question answer runs.
  for(const turn of new Set(all.map(message=>message.turnId).filter((id):id is string=>!!id))){
    if(turnPhase(state,turn)==='complete'){
      const final=inlineTurnMessages({...state,messages:all},turn).at(-1);if(final)finalIds.add(final.id);
    }
  }
  const rawFinal=(id?:string)=>format==='raw-markdown'&&!!id&&finalIds.has(id);
  const growing=(id?:string)=>phase==='running'&&!!all.find(message=>message.id===id)?.streaming;
  const assistant=(text:string,id?:string)=>rawFinal(id)?escapeReplyHtml(closeOpenFence(text.replace(/\n+$/,''))):growing(id)?quoteStreamingResponse(text):quoteResponse(closeOpenFence(text.trim()));
  const answerBlocks:string[]=[];let progressMessages:string[]=[];
  const flushProgress=()=>{if(progressMessages.length)answerBlocks.push(quoteResponse(closeOpenFence(progressMessages.join('\n\n'))));progressMessages=[];};
  if(format==='raw-markdown')for(const message of messages){
    const text=message.text.replace(/\n+$/,'');if(!text)continue;
    if(rawFinal(message.id)){flushProgress();answerBlocks.push(assistant(text,message.id));}else progressMessages.push(text);
  }
  flushProgress();
  const label=inlineThreadLabel(state.title??threadTitle);
  const heading=`**${label} · ${phase==='running'||phase==='sending'?'Working':phase==='reconnecting'?'Reconnecting':phase==='cancelled'?'Stopped':phase==='interrupted'?'Interrupted':'Error'}**`;
  const timer=timing?' '+runTimer(timing):'';
  const spinner=['running','sending','reconnecting'].includes(phase)?' <span class="send-to-t3-inline-spinner" aria-label="Loading"></span>':'';
  const displayedTurns=[...new Set([turnId,...all.map(message=>message.turnId).filter((id):id is string=>!!id)])];
  const toolGroups=responseToolGroups(state,displayedTurns);
  const emissions=responseEmissions(state,displayedTurns,text=>quoteResponse(closeOpenFence(text.trim())));
  let currentTool=phase==='running'?currentResponseToolGroup(state,turnId,toolGroups):undefined;
  const latestEmission=phase==='running'?emissions.at(-1):undefined;
  const currentEmission=latestEmission?.active&&latestEmission.turnId===turnId&&
    !state.messages.some(message=>message.turnId===turnId&&Date.parse(message.createdAt??'')>Date.parse(latestEmission.createdAt??''))&&
    (!currentTool||Date.parse(currentTool.tool.createdAt??'')<=Date.parse(latestEmission.createdAt??''))?latestEmission:undefined;
  if(currentEmission)currentTool=undefined;
  const historyGroups=toolGroups.filter(group=>group!==currentTool?.group);
  const historyRows=[...historyGroups.map(group=>({createdAt:group.createdAt,sequence:group.tools[0].sequence,body:renderResponseToolGroup(group)})),
    ...emissions.filter(item=>item!==currentEmission)].sort((a,b)=>(Date.parse(a.createdAt??'')||0)-(Date.parse(b.createdAt??'')||0)||a.sequence-b.sequence);
  const bottom=spinner?`\n\n${currentEmission?.body??(currentTool?renderResponseToolGroup(currentTool.group,currentTool):responseActivityRow(phase==='running'?responseActivityLabel(state,turnId):'Thinking'))}`:'';
  // A late answer resumes below the completed transcript. Keep its indicator
  // beside the most recent input, including before any follow-up prose arrives.
  const followupIndex=phase!=='complete'&&transcript?.preserveHistory?segments.reduce((last,segment,index)=>segment.role==='user'?index:last,-1):-1;
  let previousRole:string|undefined;
  const prose=transcript?segments.reduce((body,segment,index)=>{
    const rendered=segment.role==='user'?renderInlineInput(segment.text,segment.label,segment.position):assistant(segment.text,segment.messageId);
    // Only adjacent assistant quote blocks share a quoted blank line. Callouts
    // and raw Markdown blocks need a real boundary to avoid swallowing prose.
    const separator=body&&previousRole==='assistant'&&segment.role==='assistant'&&!rawFinal(segment.messageId)&&!rawFinal(segments[index-1]?.messageId)&&/^>/.test(body.split('\n').at(-1)??'')&&/^>/.test(rendered)?'\n>\n':'\n\n';
    previousRole=segment.role;
    const next=body?body+separator+rendered:rendered;
    return index===followupIndex?`${next}\n\n${heading}${timer}${spinner}`:next;
  },''):messages.some(message=>growing(message.id))?messages.map(message=>assistant(message.text,message.id)).filter(Boolean).join('\n\n'):format==='raw-markdown'?answerBlocks.join('\n\n'):answer?quoteResponse(closeOpenFence(answer)):'';
  // Separate the quote from the inline end marker. Without the blank line,
  // Obsidian treats the marker as a lazy continuation of the last paragraph.
  const questions=environmentId?pendingQuestions(state.activities).filter(request=>request.turnId===turnId||request.turnId===null||conversation?.messages.some(m=>m.turnId===request.turnId)).map(request=>renderQuestion(request,{environmentId,threadId,requestId:request.requestId})).join('\n\n'):'';
  const approvals=!['complete','interrupted','cancelled'].includes(phase)?pendingApprovals(state.activities).filter(request=>request.turnId===turnId).map(request=>environmentId&&request.kind==='command'?renderApproval(request,{environmentId,threadId,requestId:request.requestId}):'Action needed in T3: '+safeStatus(request.summary)).join('\n\n'):'';
  const input=initialInput?`${renderInlineInput(initialInput.text,initialInput.label)}\n\n`:'';
  if(mode==='collapse'){
    const pieces=steeringSegments(all,conversation?.steering.filter(item=>item.confirmed)??[]);
    const title=phase==='complete'?`**${label} · ${finalReady?'Completed':'Working'}**`:heading;
    // One native callout owns the entire chronological history, including
    // steering and earlier completed turns. Only the current completed turn's
    // last final-message piece stays outside. Frozen prefixes of that same
    // message still belong before their steering input inside the history.
    const finalId=finalReady?inlineTurnMessages({...state,messages:all},turnId).at(-1)?.id:undefined;
    const finalIndex=finalId?pieces.reduce((last,piece,index)=>piece.role==='assistant'&&piece.messageId===finalId?index:last,-1):-1;
    const history:string[]=[];let final='';
    let toolIndex=0;
    const toolsBefore=(at=Infinity)=>{while(toolIndex<historyRows.length&&(Date.parse(historyRows[toolIndex].createdAt??'')||0)<=at)history.push(historyRows[toolIndex++].body);};
    for(const [index,piece] of pieces.entries()){
      const message=state.messages.find(message=>message.id===piece.messageId)??all.find(message=>message.id===piece.messageId);if(message?.createdAt)toolsBefore(Date.parse(message.createdAt));
      if(index===finalIndex)final=assistant(piece.text,piece.messageId);
      else if(piece.role==='user')history.push(renderInlineInput(piece.text,piece.label,piece.position));
      else if(piece.text.trim())history.push(growing(piece.messageId)?quoteStreamingResponse(piece.text):quoteResponse(closeOpenFence(piece.text.trim())));
    }
    toolsBefore();
    if(bottom)history.push(bottom.trim());
    // Completion starts a new fold default, independent of live user choices.
    const key=encodeURIComponent(`${threadId}:${timing?.startedAt??turnId}:0`)+(finalReady?':complete':':active');
    const fold=`> [!t3-progress]${finalReady?'-':'+'} ${title}${timer}${spinner} <span class="send-to-t3-fold-key" data-t3-fold="${key}"></span>`+(history.length?'\n>\n'+history.join('\n\n').split('\n').map(line=>line?`> ${line}`:'>').join('\n'):'');
    const status=phase==='error'&&state.session?.lastError&&(!state.latestTurn||state.latestTurn.turnId===turnId)?safeStatus(state.session.lastError):approvals;
    return input+fold+(final?'\n\n'+final:'')+(status?'\n\n'+status:'')+(questions?'\n\n'+questions:'')+'\n';
  }
  const toolHistory=(retain?historyRows:phase!=='complete'?emissions.filter(item=>item!==currentEmission):[]).map(item=>item.body).join('\n\n');
  if(phase==='complete')return input+(prose?`${prose}\n`:'')+(toolHistory?'\n'+toolHistory+'\n':'')+(questions?`\n${questions}\n`:'');
  const status=phase==='error'&&state.session?.lastError&&(!state.latestTurn||state.latestTurn.turnId===turnId)?'\n\n'+safeStatus(state.session.lastError):approvals?'\n\n'+approvals:'';
  const body=prose?`\n\n${prose}\n`:'';
  return `${input}${followupIndex<0?heading+timer+spinner:''}${status}${body}${toolHistory?'\n\n'+toolHistory:''}${questions?`\n\n${questions}\n`:''}${bottom}${bottom?'\n':''}`;
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

/** Generated selections are context, including selections crossing markers. */
export function selectionOverlapsInlineResponse(document:string,range:{start:number;end:number}):boolean {
  return [...document.matchAll(/<!-- t3-inline:start:([0-9a-f-]{36}) -->/gi)].some(match=>{
    const region=regionBody(document,match[1]);
    return !!region&&range.end>match.index!&&range.start<region.to+1+endMarker(match[1]).length;
  });
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
export function hasCompletionProof(document:string,id:string,body:string){return trackedRegion(document,id,'t3-response')?.body===body;}
export function hasResponseMarkers(document:string,id:string){return ['t3-inline','t3-response'].some(prefix=>markerLines(document,prefix as 't3-inline'|'t3-response').some(match=>match[2]===id));}
/** Remove only our completed boundary lines, preserving even edited prose. */
export function removeCompletionProof(document:string,id:string):string|null {
  const region=trackedRegion(document,id,'t3-response');
  if(!region||markerLines(region.body,'t3-inline').length||markerLines(region.body,'t3-response').length)return null;
  const start=`<!-- t3-response:start:${id} -->`,end=`<!-- t3-response:end:${id} -->`;
  return document.slice(0,region.from-start.length-1)+region.body.replace(/\n+$/,'')+document.slice(region.to+1+end.length);
}

/** Thread titles are plain display text, never executable Markdown or HTML. */
export function inlineThreadLabel(title?:string){
  const text=(title??'').replace(/[\r\n\t]+/g,' ').trim().slice(0,160);
  return text?text.replace(/[\\`*_{}\[\]()#!|]/g,'\\$&').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'):'T3';
}
