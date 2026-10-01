import {turnForMessage,turnPhase,type InlineThreadState,type InlineMessage} from './inline-thread';
import {mergeProse,steeringBoundary,type InlineSteering} from './inline-steering';
import {staleQuestionFailure} from './questions';

export interface InlineQuestionFollow {requestId:string;turnId:string|null;answered?:boolean;dismissed?:boolean;replyTurnId?:string;completed?:boolean;responseMode?:'message'|'native';input?:InlineSteering}
/** Follow only T3's exact async-answer message, never an unrelated latest turn.
 * Keep the request binding durable when recent snapshots omit older activities. */
export function followInlineQuestions(state:InlineThreadState,turnIds:string[],saved:InlineQuestionFollow[]=[],prose:InlineMessage[]=[]):{follows:InlineQuestionFollow[];turnIds:string[];turnId:string|undefined;waiting:boolean;continued:boolean}{
  const follows=saved.map(item=>({...item})),turns=[...turnIds];
  for(const activity of state.activities){
    if(activity.kind!=='user-input.requested'||!activity.payload||typeof activity.payload.requestId!=='string'||activity.turnId!==null&&!turns.includes(activity.turnId))continue;
    if(!follows.some(item=>item.requestId===activity.payload!.requestId))follows.push({requestId:activity.payload.requestId,turnId:activity.turnId,responseMode:activity.payload.responseMode==='message'?'message':'native'});
  }
  for(const item of follows){
    if(item.turnId&&turnPhase(state,item.turnId)==='complete')item.completed=true;
    const resolution=state.activities.find(a=>a.kind==='user-input.resolved'&&a.payload?.requestId===item.requestId);
    if(resolution){if(resolution.payload?.answers)item.answered=true;else item.dismissed=true;}
    if(state.activities.some(a=>a.payload?.requestId===item.requestId&&staleQuestionFailure(a)))item.dismissed=true;
    if(item.dismissed)continue;
    const reply=state.messages.find(m=>m.role==='user'&&m.id===`async-answer:${item.requestId}`);
    if(reply){item.answered=true;item.replyTurnId??=turnForMessage(state,reply.id);}
    if(!item.input&&(resolution?.payload?.answers||reply)){
      const answers=resolution?.payload?.answers;
      const text=answers&&typeof answers==='object'?Object.values(answers).map(answer=>Array.isArray(answer)?answer.join(', '):typeof answer==='string'?answer:'').filter(Boolean).join('\n\n'):reply?.text??'';
      if(text.trim()){
        const index=reply?state.messages.findIndex(m=>m.id===reply.id):-1,at=reply?.createdAt??resolution?.createdAt;
        const before=(message:InlineMessage)=>!at||!message.createdAt||message.createdAt<=at;
        const previous=index>=0?state.messages.slice(0,index):state.messages.filter(before);
        const savedBefore=prose.filter(before).filter(message=>!reply||message.turnId!==item.replyTurnId);
        const history=reply?mergeProse(savedBefore,previous,turns):savedBefore.length?savedBefore:mergeProse([],previous,turns);
        item.input={messageId:reply?.id??`${item.responseMode==='native'?'question-answer':'async-answer'}:${item.requestId}`,text,before:steeringBoundary(history),confirmed:true};
      }
    }
    if(item.replyTurnId&&!turns.includes(item.replyTurnId))turns.push(item.replyTurnId);
  }
  if(turns.length>turnIds.length)return followInlineQuestions(state,turns,follows,prose);
  return {follows,turnIds:turns,turnId:turns.at(-1),waiting:follows.some(item=>!item.dismissed&&item.responseMode!=='native'&&!item.replyTurnId),continued:follows.some(item=>item.replyTurnId&&item.replyTurnId!==item.turnId)};
}
export function inlineQuestionPhase(state:InlineThreadState,turnId:string,follows:InlineQuestionFollow[]=[]){
  const phase=turnPhase(state,turnId);
  return phase==='running'&&state.session?.activeTurnId!==turnId&&follows.some(item=>item.turnId===turnId&&item.completed)?'complete':phase;
}

/** Question quotes share the steering renderer but retain their native identities.
 * Order against T3's user messages, falling back to durable paragraph boundaries. */
export function questionConversationInputs(state:InlineThreadState,steering:InlineSteering[],follows:InlineQuestionFollow[],prose:InlineMessage[]):InlineSteering[]{
  const inputs=[...steering,...follows.flatMap(item=>item.input?[item.input]:[])];
  const positions=new Map(state.messages.map((message,index)=>[message.id,index]));
  const boundary=(input:InlineSteering)=>input.before.reduce((sum,message)=>{
    const index=prose.findIndex(item=>item.id===message.id);
    return index<0?sum:Math.max(sum,prose.slice(0,index).reduce((size,item)=>size+item.text.length,0)+message.text.length);
  },0);
  return inputs.filter((input,index)=>inputs.findIndex(item=>item.messageId===input.messageId)===index).sort((a,b)=>{
    const x=positions.get(a.messageId),y=positions.get(b.messageId);
    return x!==undefined&&y!==undefined?x-y:boundary(a)-boundary(b);
  });
}
