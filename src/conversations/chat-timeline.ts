import {turnForMessage,type InlineMessage,type InlineThreadState} from './inline-thread';
import {visibleInlineInput} from '../responses/input-presentation';
import {responseWork} from '../responses/response-work';
import {responseActivityLabel,responseActivityRow} from '../responses/response-activity';
import {delegatedWork} from './inline-delegation';
import type {SubagentSource} from '../responses/response-subagents';

export interface ChatSegment {id:string;turnId:string;input?:InlineMessage;progress:InlineMessage[];final?:InlineMessage;work:string;history?:Array<{id:string;text:string;kind:'prose'|'work';createdAt?:string;sequence:number}>;activity?:string;label:string;active:boolean;steer:boolean;timing?:{startedAt:string;finishedAt?:string}}
/** A workspace view of canonical runs. Uses the stream box's work presentation,
 * never its Markdown response boundaries, note reservations or final writer. */
export function chatTimeline(state:InlineThreadState,source?:SubagentSource):ChatSegment[]{
  const result:ChatSegment[]=[];
  for(const message of state.messages.filter(message=>['user','assistant'].includes(message.role)&&!message.delegatedCompletion).slice(-200)){
    const turnId=message.turnId??turnForMessage(state,message.id)??`input:${message.id}`;
    if(message.role==='user'){
      result.push({id:message.id,turnId,input:{...message,text:visibleInlineInput(message.text)},progress:[],work:'',label:'',active:false,steer:result.some(segment=>segment.turnId===turnId)});
    }else{
      let segment=[...result].reverse().find(segment=>segment.turnId===turnId);
      if(!segment){segment={id:message.id,turnId,progress:[],work:'',label:'',active:false,steer:false};result.push(segment);}
      segment.progress.push(message);
    }
  }
  for(const [index,segment] of result.entries()){
    const turn=state.turns?.[segment.turnId]??(state.latestTurn?.turnId===segment.turnId?state.latestTurn:undefined);
    const next=result.slice(index+1).find(item=>item.turnId===segment.turnId),last=!next;
    const delegated=delegatedWork(state,[segment.turnId]);
    segment.active=last&&(delegated.waiting||delegated.running||state.session?.activeTurnId===segment.turnId||['running','starting','preparing','waiting'].includes(turn?.state??'')||!turn&&segment.progress.some(message=>message.streaming));
    const phase=segment.active?'running':turn?.state==='error'||turn?.state==='failed'?'error':'complete';
    if(last&&phase==='complete'&&(turn?.state==='completed'||!turn)){
      const final=segment.progress.at(-1);if(final&&!final.streaming){segment.final=final;segment.progress=segment.progress.slice(0,-1);}
    }
    const start=segment.input?.createdAt??turn?.startedAt??turn?.requestedAt,end=next?.input?.createdAt??(!segment.active?turn?.completedAt:undefined);
    if(start)segment.timing={startedAt:start,...(end?{finishedAt:end}:{})};
    segment.label=phase==='error'?'Failed':turn?.state==='interrupted'||turn?.state==='cancelled'?'Stopped':segment.active?(delegated.paused?delegated.label:'Working'):segment.steer?'Continued':'Worked';
    const work=responseWork(state,[segment.turnId],segment.turnId,phase,'collapse',delegated.paused,text=>text,source);
    const rows=[...work.historyRows,...work.htmlRows].sort((a,b)=>(Date.parse(a.createdAt??'')||0)-(Date.parse(b.createdAt??'')||0)||a.sequence-b.sequence).filter(row=>{const at=Date.parse(row.createdAt??'');return !Number.isFinite(at)?last:(!start||at>=Date.parse(start))&&(!next?.input?.createdAt||at<Date.parse(next.input.createdAt));});
    segment.history=[...segment.progress.map(message=>({id:message.id,text:message.text,kind:'prose' as const,createdAt:message.createdAt,sequence:message.sequence??0})),...rows.map((row,index)=>({id:'work:'+('groupId' in row?row.groupId:row.id??index),text:row.body,kind:'work' as const,createdAt:row.createdAt,sequence:row.sequence}))].sort((a,b)=>(Date.parse(a.createdAt??'')||0)-(Date.parse(b.createdAt??'')||0)||a.sequence-b.sequence);
    segment.activity=segment.active?(work.currentEmission?.body??responseActivityRow(delegated.paused?delegated.label:responseActivityLabel(state,segment.turnId),work.currentTool?.tool.icon,work.activityGroup?.id)):'';
    segment.work=rows.map(row=>row.body).join('\n\n')+(segment.activity?(rows.length?'\n\n':'')+segment.activity:'');
  }
  return result;
}
