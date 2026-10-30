import type {InlineThreadState,InlineTurn,InlineMessage} from './inline-thread';

export interface FailedContinuation {sourceTurnId:string;turnId:string;messageId:string}

/** An unfinished failed response follows its immediately next human app run.
 * Ordinals and primary-message identity establish the chain; latest/session
 * status and nearby timestamps alone never establish response ownership. */
export function failedContinuations(state:InlineThreadState,owned:string[],prose:InlineMessage[]=[]){
  const turns={...state.turns,...(state.latestTurn?{[state.latestTurn.turnId]:state.latestTurn}:{})};
  const ordinals=new Map<number,InlineTurn[]>();
  for(const turn of Object.values(turns))if(Number.isSafeInteger(turn.ordinal))ordinals.set(turn.ordinal!,[...ordinals.get(turn.ordinal!)??[],turn]);
  const links={...state.failedContinuations},turnIds=owned.slice();
  const next=(sourceId:string):FailedContinuation|undefined=>{
    const source=turns[sourceId];if(source?.state!=='error'||!Number.isSafeInteger(source.ordinal))return;
    const candidates=ordinals.get(source.ordinal!+1);if(candidates?.length!==1)return;
    const target=candidates[0],end=Date.parse(source.completedAt??''),start=Date.parse(target.requestedAt??'');
    if(!target.messageId||target.delegatedParentRunId||!['running','completed','error'].includes(target.state)||!Number.isFinite(end)||!Number.isFinite(start)||start<end)return;
    const messages=state.messages.filter(message=>message.id===target.messageId);
    const saved=links[sourceId],proven=saved?.turnId===target.turnId&&saved.messageId===target.messageId;
    if(messages.length){
      if(messages.length!==1)return;
      const message=messages[0];
      if(message.role!=='user'||message.turnId!==target.turnId||message.createdBy!=='user'||message.senderThreadId||message.delegatedCompletion||!['web','mobile'].includes(message.creationSource??''))return;
    }else if(!proven)return;
    return {sourceTurnId:sourceId,turnId:target.turnId,messageId:target.messageId};
  };
  for(let count=0;count<Object.keys(turns).length;count++){
    const link=next(turnIds.at(-1)??'');if(!link||turnIds.includes(link.turnId))break;
    links[link.sourceTurnId]=link;turnIds.push(link.turnId);
  }
  const messages=new Set<string>(),inputBoundaries={...state.inputBoundaries};
  for(const id of turnIds){const link=next(id);if(link&&turnIds.includes(link.turnId)){
    links[id]=link;messages.add(link.messageId);
    // A new primary arrives while its predecessor has no active session. Its
    // ordinary live-input boundary can therefore be empty or belong to the
    // new run. The proven failed-run chain puts all earlier output before it.
    const prior=turnIds.slice(0,turnIds.indexOf(link.turnId));
    const history=[...new Map([...prose,...state.messages].filter(message=>message.role==='assistant'&&prior.includes(message.turnId??'')).map(message=>[message.id,{...message,streaming:false}])).values()];
    inputBoundaries[link.messageId]=history.sort((a,b)=>a.createdAt&&b.createdAt?a.createdAt.localeCompare(b.createdAt):0);
  }}
  return {state:{...state,failedContinuations:links,inputBoundaries},turnIds,messageIds:messages,continued:messages.size>0};
}
