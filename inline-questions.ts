import {turnForMessage,turnPhase,type InlineThreadState,type InlineMessage} from './inline-thread';
import {incomingLabel,mergeProse,steeringBoundary,type InlineSteering} from './inline-steering';
import {pendingQuestions,staleQuestionFailure,type Question} from './questions';
import {submittedAnswers} from './response-answers';
import {delegatedTurnIds,delegatedWork} from './inline-delegation';

export interface InlineQuestionFollow {requestId:string;turnId:string|null;answered?:boolean;dismissed?:boolean;detached?:boolean;replyTurnId?:string;completed?:boolean;responseMode?:'message'|'native';input?:InlineSteering;questions?:Question[]}
/** Exact run ownership wins; timestamps only distinguish answers inside a
 * known source lifecycle from answers submitted after its terminal boundary. */
export function lateQuestionAnswer(state:InlineThreadState,sourceTurnId:string|null,reply:InlineMessage):boolean|undefined {
  if(!sourceTurnId)return;
  const bound=turnForMessage(state,reply.id);if(bound)return bound!==sourceTurnId;
  const turn=state.latestTurn?.turnId===sourceTurnId?state.latestTurn:state.turns?.[sourceTurnId];
  const end=Date.parse(turn?.completedAt??state.checkpoints?.find(item=>item.turnId===sourceTurnId)?.completedAt??''),at=Date.parse(reply.createdAt??'');
  if(Number.isFinite(end)&&Number.isFinite(at))return at>=end;
  if(turnPhase(state,sourceTurnId)==='running'&&state.session?.activeTurnId===sourceTurnId)return false;
}
/** Follow only T3's exact async-answer message, never an unrelated latest turn.
 * Keep the request binding durable when recent snapshots omit older activities. */
export function followInlineQuestions(state:InlineThreadState,turnIds:string[],saved:InlineQuestionFollow[]=[],prose:InlineMessage[]=[],followLate=true):{follows:InlineQuestionFollow[];turnIds:string[];turnId:string|undefined;waiting:boolean;continued:boolean}{
  const follows=saved.map(item=>({...item,...(item.input?{input:{...item.input}}:{})})),turns=delegatedTurnIds(state,turnIds);
  for(const activity of state.activities){
    if(activity.kind!=='user-input.requested'||!activity.payload||typeof activity.payload.requestId!=='string'||activity.turnId!==null&&!turns.includes(activity.turnId))continue;
    if(!follows.some(item=>item.requestId===activity.payload!.requestId))follows.push({requestId:activity.payload.requestId,turnId:activity.turnId,responseMode:activity.payload.responseMode==='message'?'message':'native'});
    const item=follows.find(item=>item.requestId===activity.payload!.requestId)!;
    item.questions??=pendingQuestions([activity])[0]?.questions;
  }
  for(const item of follows){
    if(item.turnId&&turnPhase(state,item.turnId)==='complete')item.completed=true;
    const resolution=state.activities.find(a=>a.kind==='user-input.resolved'&&a.payload?.requestId===item.requestId);
    if(resolution){if(resolution.payload?.answers)item.answered=true;else item.dismissed=true;}
    if(state.activities.some(a=>a.payload?.requestId===item.requestId&&staleQuestionFailure(a)))item.dismissed=true;
    if(item.dismissed)continue;
    const reply=state.messages.find(m=>m.role==='user'&&m.id===`async-answer:${item.requestId}`);
    if(!followLate&&item.responseMode==='message'&&reply&&lateQuestionAnswer(state,item.turnId,reply)===true){item.detached=true;delete item.input;continue;}
    if(reply){item.answered=true;item.replyTurnId??=turnForMessage(state,reply.id)??completedQuestionSteeringTurn(state,item,reply);}
    if(!item.input&&(resolution?.payload?.answers||reply)){
      const answers=submittedAnswers(resolution?.payload?.answers);
      const text=answers&&typeof answers==='object'?Object.values(answers).map(answer=>Array.isArray(answer)?answer.join(', '):typeof answer==='string'?answer:'').filter(Boolean).join('\n\n'):reply?.text??'';
      if(text.trim()){
        const index=reply?state.messages.findIndex(m=>m.id===reply.id):-1,at=reply?.createdAt??resolution?.createdAt;
        const before=(message:InlineMessage)=>!at||!message.createdAt||message.createdAt<=at;
        const previous=index>=0?state.messages.slice(0,index):state.messages.filter(before);
        const savedBefore=prose.filter(before).filter(message=>!reply||message.turnId!==item.replyTurnId);
        const history=reply?mergeProse(savedBefore,previous,turns):savedBefore.length?savedBefore:mergeProse([],previous,turns);
        item.input={messageId:reply?.id??`${item.responseMode==='native'?'question-answer':'async-answer'}:${item.requestId}`,text,before:steeringBoundary(history),confirmed:true,createdAt:at};
      }
    }
    if(item.input){
      item.input.label=reply?incomingLabel(reply):'User';
      item.input.createdAt??=reply?.createdAt??resolution?.createdAt;
      item.input.answer={requestId:item.requestId,questions:item.questions??item.input.answer?.questions??[],answers:submittedAnswers(resolution?.payload?.answers)??item.input.answer?.answers};
    }
    if(item.replyTurnId&&!turns.includes(item.replyTurnId))turns.push(item.replyTurnId);
  }
  if(turns.length>turnIds.length)return followInlineQuestions(state,turns,follows,prose,followLate);
  return {follows,turnIds:turns,turnId:turns.at(-1),waiting:follows.some(item=>!item.dismissed&&!item.detached&&item.responseMode!=='native'&&!item.replyTurnId),continued:follows.some(item=>!item.detached&&(item.replyTurnId&&item.replyTurnId!==item.turnId||pendingQuestionReply(item)))};
}
/** An async answer can steer its question's existing turn. T3 leaves that
 * user message's turnId null and retains the original requestedAt, so the
 * normal new-turn lookup cannot bind it. Bind an exact answer inside the
 * source turn's completed lifecycle, never from the session's latest status.
 * For older turns without requestedAt, source prose must bracket the answer.
 * A late answer, an unrelated turn, or incomplete evidence still waits for
 * the exact async-answer turn to be projected. Persist the proven binding. */
function completedQuestionSteeringTurn(state:InlineThreadState,item:InlineQuestionFollow,reply:InlineMessage):string|undefined {
  if(!item.turnId||item.responseMode!=='message'||turnPhase(state,item.turnId)!=='complete')return;
  const turn=state.latestTurn?.turnId===item.turnId?state.latestTurn:state.turns?.[item.turnId];
  const checkpoint=state.checkpoints?.find(c=>c.turnId===item.turnId&&c.status==='ready'&&c.checkpointRef?.startsWith('refs/t3/checkpoints/'));
  const answeredAt=Date.parse(reply.createdAt??''),completedAt=Date.parse(turn?.completedAt??checkpoint?.completedAt??'');
  if(!Number.isFinite(answeredAt)||!Number.isFinite(completedAt)||completedAt<=answeredAt)return;
  const requestedAt=Date.parse(turn?.requestedAt??'');
  if(Number.isFinite(requestedAt))return requestedAt<answeredAt?item.turnId:undefined;
  const index=state.messages.findIndex(m=>m.id===reply.id);
  const source=(message:InlineMessage)=>message.role==='assistant'&&message.turnId===item.turnId&&!message.streaming;
  if(!state.messages.slice(0,index).some(m=>source(m)&&Date.parse(m.createdAt??'')<answeredAt))return;
  if(!state.messages.slice(index+1).some(m=>source(m)&&Date.parse(m.createdAt??'')>answeredAt&&Date.parse(m.createdAt??'')<=completedAt))return;
  return item.turnId;
}
function pendingQuestionReply(item:InlineQuestionFollow):boolean {
  return !!(item.completed&&item.answered&&!item.dismissed&&!item.detached&&item.responseMode==='message'&&!item.replyTurnId);
}
export function inlineQuestionPhase(state:InlineThreadState,turnId:string,follows:InlineQuestionFollow[]=[]){
  const observed=turnPhase(state,turnId);
  const delegated=delegatedWork(state,[turnId]);
  if(observed==='complete'&&(delegated.waiting||delegated.running))return 'running';
  const phase=observed==='running'&&state.session?.activeTurnId!==turnId&&follows.some(item=>item.turnId===turnId&&item.completed)?'complete':observed;
  // Resolution precedes projection of the new async-answer turn. Show that
  // accepted follow-up as working while retaining the exact-message binding.
  if(phase==='complete'&&follows.some(item=>item.turnId===turnId&&pendingQuestionReply(item)))return 'running';
  return phase;
}

/** Question quotes share the steering renderer but retain their native identities.
 * Order against T3's user messages, falling back to durable paragraph boundaries. */
export function questionConversationInputs(state:InlineThreadState,steering:InlineSteering[],follows:InlineQuestionFollow[],prose:InlineMessage[]):InlineSteering[]{
  const answers=follows.flatMap(item=>!item.dismissed&&!item.detached&&item.input?[item.input]:[]);
  const inputs=[...steering.map(input=>{const answer=answers.find(answer=>answer.messageId===input.messageId);return answer?{...input,...answer,before:input.before}:input;}),...answers];
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
