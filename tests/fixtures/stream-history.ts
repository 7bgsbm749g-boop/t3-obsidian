import {renderInlineTurn} from '../../inline-thread';
export function historyFixture(streaming=false){
  const state:any={title:'History test',messages:[{id:'progress',role:'assistant',turnId:'turn',text:'Checking.\n\n```md\n> [!t3-progress]- Fake\n```',streaming:false},{id:'final',role:'assistant',turnId:'turn',text:'Final answer stays.',streaming}],activities:[],latestTurn:{turnId:'turn',state:'completed',assistantMessageId:'final'}};
  const body=renderInlineTurn(state,'turn','thread','complete','collapse',undefined,undefined,undefined,undefined,{startedAt:'2026-10-06T10:00:00Z'});
  const key=/data-t3-fold="([^"]+)"/.exec(body)![1];return {body,key};
}
