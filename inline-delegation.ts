import type {InlineThreadState,InlineTurn} from './inline-thread';

const terminal=(status:string)=>['completed','failed','interrupted','cancelled','rolled_back','expired'].includes(status);
const turnsFor=(state:InlineThreadState):Record<string,InlineTurn>=>({...state.turns,...(state.latestTurn?{[state.latestTurn.turnId]:state.latestTurn}:{})});

/** T3 supplies exact parent/delivery identities. A newer ordinary thread run
 * or a child's own run is never a continuation of this response. */
export function delegatedTurnIds(state:InlineThreadState,tracked:string[]):string[] {
  const turns=turnsFor(state),ids=new Set(tracked);
  let changed=true;
  while(changed){
    changed=false;
    const add=(id?:string)=>{if(id&&turns[id]&&!ids.has(id)){ids.add(id);changed=true;}};
    for(const turn of Object.values(turns)){
      if(turn.delegatedParentRunId&&ids.has(turn.delegatedParentRunId))add(turn.turnId);
      if(ids.has(turn.turnId)){
        add(turn.delegatedParentRunId);
        const messageId=turn.delegatedCompletion?.delivery?.messageId;
        if(messageId)for(const target of Object.values(turns))if(target.messageId===messageId)add(target.turnId);
      }
    }
    for(const child of Object.values(state.subagents??{})){
      if(child.origin!=='app_owned'||child.completionWake!=='always')continue;
      const observer=child.completionDelivery?.observedByRunId;
      // A later user-authored run can observe old work too. Its independent
      // prompt does not become output owned by the earlier response.
      const input=observer?state.messages.find(message=>message.id===turns[observer]?.messageId):undefined;
      if(input?.createdBy==='user'&&!input.delegatedCompletion)continue;
      if(ids.has(child.runId)&&observer)add(observer);
      if(observer&&ids.has(observer))add(child.runId);
    }
  }
  return [...ids].sort((a,b)=>{
    const x=turns[a],y=turns[b];
    return (x?.ordinal??0)-(y?.ordinal??0);
  });
}

/** The parent can finish between child deliveries. Keep its response live
 * until all waking children are observed and the last parent resume finishes.
 * An open disposition alone is not work: T3 retains it after final completion. */
export function delegatedWork(state:InlineThreadState,tracked:string[]){
  const turnIds=delegatedTurnIds(state,tracked),turns=turnsFor(state);
  const sources=new Set(turnIds.filter(id=>turns[id]?.delegatedCompletion?.disposition==='open'));
  const children=Object.values(state.subagents??{}).filter(child=>sources.has(child.runId)&&child.origin==='app_owned'&&child.completionWake==='always');
  const active=children.filter(child=>!terminal(child.status));
  const unobserved=children.some(child=>terminal(child.status)&&!['acknowledged','suppressed'].includes(child.completionDelivery?.state??''));
  const delivery=turnIds.some(id=>{
    const source=turns[id];if(!sources.has(id)||!source.delegatedCompletion?.delivery)return false;
    const next=Object.values(turns).find(turn=>turn.messageId===source.delegatedCompletion!.delivery!.messageId);
    return !next||next.state==='queued';
  });
  const running=turnIds.some(id=>turns[id]?.state==='running'||turns[id]?.state==='queued');
  const waiting=active.length>0||unobserved||delivery;
  const turnId=turnIds.at(-1);
  return {turnIds,turnId,waiting,running,label:active.length?`Waiting for ${active.length} subagent${active.length===1?'':'s'}`:'Waiting for subagent results',
    paused:waiting&&!running&&!!turnId&&turns[turnId]?.state==='completed'};
}
