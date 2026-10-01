import {turnForMessage,turnPhase,type InlineThreadState} from './inline-thread';
import {staleQuestionFailure} from './questions';

export interface InlineQuestionFollow {requestId:string;turnId:string|null;answered?:boolean;dismissed?:boolean;replyTurnId?:string;completed?:boolean}
/** Follow only T3's exact async-answer message, never an unrelated latest turn.
 * Keep the request binding durable when recent snapshots omit older activities. */
export function followInlineQuestions(state:InlineThreadState,turnIds:string[],saved:InlineQuestionFollow[]=[]):{follows:InlineQuestionFollow[];turnIds:string[];turnId:string|undefined;waiting:boolean;continued:boolean}{
  const follows=saved.map(item=>({...item})),turns=[...turnIds];
  for(const activity of state.activities){
    if(activity.kind!=='user-input.requested'||activity.payload?.responseMode!=='message'||typeof activity.payload.requestId!=='string'||activity.turnId!==null&&!turns.includes(activity.turnId))continue;
    if(!follows.some(item=>item.requestId===activity.payload!.requestId))follows.push({requestId:activity.payload.requestId,turnId:activity.turnId});
  }
  for(const item of follows){
    if(item.turnId&&turnPhase(state,item.turnId)==='complete')item.completed=true;
    const resolution=state.activities.find(a=>a.kind==='user-input.resolved'&&a.payload?.requestId===item.requestId);
    if(resolution){if(resolution.payload?.answers)item.answered=true;else item.dismissed=true;}
    if(state.activities.some(a=>a.payload?.requestId===item.requestId&&staleQuestionFailure(a)))item.dismissed=true;
    if(item.dismissed)continue;
    const reply=state.messages.find(m=>m.role==='user'&&m.id===`async-answer:${item.requestId}`);
    if(reply){item.answered=true;item.replyTurnId??=turnForMessage(state,reply.id);}
    if(item.replyTurnId&&!turns.includes(item.replyTurnId))turns.push(item.replyTurnId);
  }
  if(turns.length>turnIds.length)return followInlineQuestions(state,turns,follows);
  return {follows,turnIds:turns,turnId:turns.at(-1),waiting:follows.some(item=>!item.dismissed&&!item.replyTurnId),continued:follows.some(item=>item.replyTurnId&&item.replyTurnId!==item.turnId)};
}
export function inlineQuestionPhase(state:InlineThreadState,turnId:string,follows:InlineQuestionFollow[]=[]){
  const phase=turnPhase(state,turnId);
  return phase==='running'&&state.session?.activeTurnId!==turnId&&follows.some(item=>item.turnId===turnId&&item.completed)?'complete':phase;
}
