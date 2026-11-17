import {inlineTurnMessages,turnForMessage,type InlineMessage,type InlineThreadState} from './inline-thread';
import {incomingDisplayTurn,observeIncoming,steeringSegments} from './inline-steering';
import {visibleInlineInput} from '../responses/input-presentation';
import {responseWork} from '../responses/response-work';
import {responseActivityLabel,responseActivityRow} from '../responses/response-activity';
import {delegatedWork} from './inline-delegation';
import {imageResultKey,renderImageResult,responseImageResults} from '../responses/image-results';
import {htmlResultKey,renderHtmlResult,responseHtmlResults} from '../responses/html-results';

export interface ChatSegment {id:string;turnId:string;input?:InlineMessage;progress:InlineMessage[];final?:InlineMessage;work:string;history?:Array<{id:string;text:string;kind:'prose'|'work';createdAt?:string;sequence:number}>;activity?:string;label:string;active:boolean;steer:boolean;timing?:{startedAt:string;finishedAt?:string}}
/** A workspace view of canonical runs. Uses the stream box's work presentation,
 * never its Markdown response boundaries, note reservations or final writer. */
export function chatTimeline(state:InlineThreadState,source?:{environmentId:string;threadId:string}):ChatSegment[]{
  const result:ChatSegment[]=[],groups=new Map<string,InlineMessage[]>();
  const messages=state.messages.filter(message=>['user','assistant'].includes(message.role)&&!message.delegatedCompletion).slice(-200)
    .sort((a,b)=>a.createdAt&&b.createdAt?a.createdAt.localeCompare(b.createdAt)||(a.sequence??0)-(b.sequence??0):0);
  const turns=[...new Set([...Object.keys(state.turns??{}),...(state.latestTurn?[state.latestTurn.turnId]:[]),...messages.flatMap(message=>message.turnId?[message.turnId]:[])])];
  for(const message of messages){
    const turnId=message.turnId??turnForMessage(state,message.id)??incomingDisplayTurn(state,message,turns)??`input:${message.id}`;
    const group=groups.get(turnId)??[];group.push(message);groups.set(turnId,group);
  }
  for(const [turnId,group] of groups){
    const observed=observeIncoming({...state,messages},[turnId]);
    const final=inlineTurnMessages(state,turnId).at(-1);
    const inputs=group.filter(message=>message.role==='user').map(message=>{
      const input=observed.find(input=>input.messageId===message.id)??{messageId:message.id,text:message.text,before:[],createdAt:message.createdAt};
      // An unwitnessed snapshot has no exact prefix. Keep text updated after
      // the input, including the completed final message, below that input.
      return input.position==='recovered'?{...input,before:input.before.filter(before=>!before.streaming&&(!input.createdAt||(!before.updatedAt||before.updatedAt<=input.createdAt)&&before.id!==final?.id))}:input;
    });
    let segment:ChatSegment|undefined;
    for(const piece of steeringSegments(group.filter(message=>message.role==='assistant'),inputs)){
      const original=group.find(message=>message.id===piece.messageId);if(!original)continue;
      if(piece.role==='user'||!segment){
        segment={id:original.id,turnId,progress:[],work:'',label:'',active:false,steer:piece.role==='user'&&result.some(row=>row.turnId===turnId)};
        result.push(segment);
      }
      if(piece.role==='user')segment.input={...original,text:visibleInlineInput(piece.text)};
      else segment.progress.push({...original,text:piece.text,createdAt:segment.input?.createdAt&&original.createdAt&&original.createdAt<segment.input.createdAt?segment.input.createdAt:original.createdAt});
    }
  }
  for(const [index,segment] of result.entries()){
    const turn=state.turns?.[segment.turnId]??(state.latestTurn?.turnId===segment.turnId?state.latestTurn:undefined);
    const next=result.slice(index+1).find(item=>item.turnId===segment.turnId),last=!next;
    segment.active=last&&(state.session?.activeTurnId===segment.turnId||['running','starting','preparing','waiting'].includes(turn?.state??'')||!turn&&segment.progress.some(message=>message.streaming));
    const phase=segment.active?'running':turn?.state==='error'||turn?.state==='failed'?'error':'complete';
    if(last&&phase==='complete'&&(turn?.state==='completed'||!turn)){
      const selected=inlineTurnMessages(state,segment.turnId).at(-1);
      // Provider child transcripts can contain completed prose without a run.
      // Its display group has no canonical turn to select an answer from.
      const final=selected?segment.progress.find(message=>message.id===selected.id):!turn?segment.progress.at(-1):undefined;
      if(final&&!final.streaming){segment.final=final;segment.progress=segment.progress.filter(message=>message.id!==final.id);}
    }
    const start=segment.input?.createdAt??turn?.startedAt??turn?.requestedAt,end=next?.input?.createdAt??(!segment.active?turn?.completedAt:undefined);
    if(start)segment.timing={startedAt:start,...(end?{finishedAt:end}:{})};
    segment.label=phase==='error'?'Failed':turn?.state==='interrupted'||turn?.state==='cancelled'?'Stopped':segment.active?'Working':segment.steer?'Continued':'Worked';
    const delegated=delegatedWork(state,[segment.turnId]);
    const images=source?state.activities.filter(activity=>activity.turnId===segment.turnId).flatMap(activity=>responseImageResults(activity,source.environmentId,source.threadId).map(reference=>({id:'image:'+imageResultKey(reference),createdAt:activity.createdAt,sequence:activity.sequence??0,body:renderImageResult(reference)}))):[];
    const html=source?responseHtmlResults(state.activities,[segment.turnId],source.environmentId,source.threadId).map(reference=>{
      const activity=state.activities.find(activity=>activity.kind==='response.html'&&activity.payload?.itemId===reference.itemId);
      return {id:'html:'+htmlResultKey(reference),createdAt:activity?.createdAt,sequence:activity?.sequence??0,body:renderHtmlResult(reference)};
    }):[];
    const work=responseWork(state,[segment.turnId],segment.turnId,phase,'collapse',delegated.paused,text=>text,[...images,...html]);
    const rows=work.historyRows.filter(row=>{const at=Date.parse(row.createdAt??'');return !Number.isFinite(at)?last:(!start||at>=Date.parse(start))&&(!next?.input?.createdAt||at<Date.parse(next.input.createdAt));});
    segment.history=[...segment.progress.map(message=>({id:message.id,text:message.text,kind:'prose' as const,createdAt:message.createdAt,sequence:message.sequence??0})),...rows.map((row,index)=>({id:'work:'+('groupId' in row?row.groupId:row.id??index),text:row.body,kind:'work' as const,createdAt:row.createdAt,sequence:row.sequence}))].sort((a,b)=>(Date.parse(a.createdAt??'')||0)-(Date.parse(b.createdAt??'')||0)||a.sequence-b.sequence);
    segment.activity=segment.active?(work.currentEmission?.body??responseActivityRow(delegated.paused?delegated.label:responseActivityLabel(state,segment.turnId),work.currentTool?.tool.icon,work.activityGroup?.id)):'';
    segment.work=rows.map(row=>row.body).join('\n\n')+(segment.activity?(rows.length?'\n\n':'')+segment.activity:'');
  }
  return result;
}
