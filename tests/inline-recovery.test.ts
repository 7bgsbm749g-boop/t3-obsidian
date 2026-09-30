import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyThreadItem,inlineTurnMessages,renderInlineTurn,turnForMessage,turnPhase,type InlineThreadState} from '../inline-thread';
import {readInlineSnapshot,type ThreadAccess} from '../thread-stream';

const message=(id:string,role:string,turnId:string|null,text=id)=>({id,role,turnId,text,streaming:false});
function history():InlineThreadState {
  return applyThreadItem({messages:[],activities:[]},{kind:'snapshot',snapshot:{thread:{
    messages:[message('prompt','user',null),message('final','assistant','original','Original answer'),message('late-progress','assistant','original','Old progress arriving late'),message('later-prompt','user',null),{...message('later-answer','assistant','later'),streaming:true}],
    activities:[],latestTurn:{turnId:'later',state:'running'},session:{status:'running',activeTurnId:'later'},
    checkpoints:[{turnId:'original',status:'ready',checkpointRef:'refs/t3/checkpoints/thread/turn/1',assistantMessageId:'final'}],
  }}}).state;
}

test('canonical history recovers the original prompt after a newer turn has started',()=>{
  const state=history();
  assert.equal(turnForMessage(state,'prompt'),'original');
  assert.equal(turnPhase(state,'original'),'complete');
  assert.deepEqual(inlineTurnMessages(state,'original').map(m=>m.id),['final']);
  assert.equal(renderInlineTurn(state,'original','thread','complete'),'> Original answer\n');
  assert.equal(turnPhase(state,'later'),'running');
});

test('history refuses partial, ambiguous, missing, and crossing-turn prompt associations',()=>{
  const state=history();
  assert.equal(turnForMessage({...state,historyComplete:false},'prompt'),undefined);
  assert.equal(turnForMessage(state,'missing'),undefined);
  assert.equal(turnForMessage({...state,messages:[state.messages[0],message('fanout','assistant','another'),...state.messages.slice(1)]},'prompt'),undefined);
  assert.equal(turnForMessage({...state,messages:[message('earlier','assistant','original'),...state.messages]},'prompt'),undefined);
  assert.equal(turnForMessage({...state,messages:[state.messages[0],...state.messages.slice(3)]},'prompt'),undefined);
});

test('a projected explicit user turn ID and a remembered requestedAt remain authoritative',()=>{
  assert.equal(turnForMessage({...history(),messages:[message('prompt','user','explicit')]},'prompt'),'explicit');
  const requestedAt='2026-09-30T12:00:00.000Z';
  const before={messages:[{...message('prompt','user',null),createdAt:requestedAt}],activities:[],latestTurn:{turnId:'original',state:'completed',requestedAt}};
  const next=applyThreadItem(before,{kind:'snapshot',snapshot:{page:{hasMore:true},thread:{messages:before.messages,latestTurn:{turnId:'later',state:'running'}}}}).state;
  assert.equal(turnForMessage(next,'prompt'),'original');
  assert.equal(turnPhase(next,'original'),'complete');
});

test('historical progress and provider-diff placeholders do not prove completion',()=>{
  const state=history();
  assert.equal(turnPhase({...state,checkpoints:[]},'original'),'running');
  assert.equal(turnPhase({...state,checkpoints:[{...state.checkpoints![0],checkpointRef:'provider-diff:event'}]},'original'),'running');
  assert.equal(turnPhase({...state,messages:state.messages.map(m=>m.id==='final'?{...m,streaming:true}:m)},'original'),'running');
  assert.equal(turnPhase({...state,checkpoints:[{...state.checkpoints![0],assistantMessageId:'not-yet-projected'}]},'original'),'running');
});

test('a later failed session cannot change an earlier completion or supply its error text',()=>{
  const state={...history(),session:{status:'error',activeTurnId:null,lastError:'Unrelated failure'},latestTurn:{turnId:'later',state:'error'}};
  assert.equal(turnPhase(state,'original'),'complete');
  const failed={...state,checkpoints:[{...state.checkpoints![0],status:'error'}]};
  assert.equal(turnPhase(failed,'original'),'error');
  assert.doesNotMatch(renderInlineTurn(failed,'original','thread','error'),/Unrelated failure/);
  assert.equal(turnPhase({...state,checkpoints:[{...state.checkpoints![0],status:'missing'}]},'original'),'interrupted');
});

test('recovery reads beyond the recent 20 prompts and validates the destination',async()=>{
  const state=history(),paths:string[]=[];
  const recent={snapshotSequence:50,page:{hasMore:true},thread:{id:'thread',projectId:'project',...state,messages:state.messages.slice(3)}};
  const full={snapshotSequence:51,thread:{id:'thread',projectId:'project',...state}};
  const access:ThreadAccess={origin:'https://t3.example',api:async path=>{paths.push(path);return path.includes('?')?recent:full;}};
  const snapshot=await readInlineSnapshot(access,'thread','project',{messageIds:['prompt'],turnIds:[]});
  assert.deepEqual(paths,['/api/orchestration/threads/thread?turnLimit=20','/api/orchestration/threads/thread']);
  assert.equal(turnForMessage(applyThreadItem({messages:[],activities:[]},{kind:'snapshot',snapshot}).state,'prompt'),'original');
  await assert.rejects(readInlineSnapshot(access,'thread','wrong-project'),/requested T3 thread/);
});

test('normal polling does not fetch full history for a prompt already bound to the latest turn',async()=>{
  const requestedAt='2026-09-30T12:00:00.000Z',paths:string[]=[];
  const access:ThreadAccess={origin:'https://t3.example',api:async path=>{paths.push(path);return {page:{hasMore:true},thread:{id:'thread',projectId:'project',messages:[{...message('prompt','user',null),createdAt:requestedAt}],latestTurn:{turnId:'original',state:'running',requestedAt}}};}};
  await readInlineSnapshot(access,'thread','project',{messageIds:['prompt'],turnIds:['original']});
  assert.equal(paths.length,1);
});
