import {renderInlineTurn} from '../../inline-thread';
export function historyFixture(streaming=false){
  const state:any={title:'History test',messages:[{id:'progress',role:'assistant',turnId:'turn',text:'Checking.\n\n```md\n> [!t3-progress]- Fake\n```',streaming:false},{id:'final',role:'assistant',turnId:'turn',text:'Final answer stays.',streaming}],activities:[],latestTurn:{turnId:'turn',state:'completed',assistantMessageId:'final'}};
  const body=renderInlineTurn(state,'turn','thread','complete','collapse',undefined,undefined,undefined,undefined,{startedAt:'2026-10-06T10:00:00Z'});
  const key=/data-t3-fold="([^"]+)"/.exec(body)![1];return {body,key};
}
export function interruptedHistoryFixture(title='Interrupted history'){
  const state:any={title,messages:[{id:'partial',role:'assistant',turnId:'interrupted-turn',text:'Retained interrupted output.',streaming:false}],activities:[],latestTurn:{turnId:'interrupted-turn',state:'interrupted'}};
  const body=renderInlineTurn(state,'interrupted-turn','interrupted-thread','interrupted','collapse',undefined,undefined,undefined,undefined,{startedAt:'2026-10-24T10:00:00Z',finishedAt:'2026-10-24T10:00:27Z'});
  const key=/data-t3-fold="([^"]+)"/.exec(body)![1];return {body,key};
}
