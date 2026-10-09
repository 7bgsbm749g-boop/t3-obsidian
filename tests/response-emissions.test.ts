import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeV2Snapshot,normalizeV2StreamItem} from '../orchestration-v2';
import {applyThreadItem,renderInlineTurn,turnPhase} from '../inline-thread';

const at=(n:number)=>new Date(n*1000).toISOString();
function fixture(items:any[]){return applyThreadItem({messages:[],activities:[]},{kind:'snapshot',snapshot:normalizeV2Snapshot({snapshotSequence:1,projection:{
  thread:{id:'thread',projectId:'project'},runs:[{id:'run',ordinal:1,status:'running',userMessageId:'prompt',requestedAt:at(1)}],
  messages:[{id:'prompt',role:'user',runId:'run',text:'Task',streaming:false,createdAt:at(1)},{id:'prose',role:'assistant',runId:'run',text:'Checking.',streaming:false,createdAt:at(4)}],
  runtimeRequests:[],turnItems:items.map((item,index)=>({runId:'run',ordinal:index+1,startedAt:at(index+2),updatedAt:at(index+2),status:'completed',...item}))}})}).state;}

test('public reasoning and plans appear in native folds in timeline order and stay outside final prose',()=>{
  const state=fixture([{id:'thought',type:'reasoning',text:'**Checking the request**\n\nPublic summary with <script>literal</script>.',streaming:false},
    {id:'plan',type:'todo_list',steps:[{step:'Read the contract',status:'completed'},{step:'Verify the result',status:'in_progress'}]}]);
  const body=renderInlineTurn(state,'run','thread','running','collapse');
  assert.match(body,/\[!t3-thought\]- Thought/);assert.match(body,/\*\*Checking the request\*\*/);assert.match(body,/\\<script>/);
  assert.match(body,/\[!t3-plan\]- Plan/);assert.match(body,/- \[x\] Read the contract/);assert.match(body,/- \[ \] Verify the result \(In progress\)/);
  assert.ok(body.indexOf('Public summary')<body.indexOf('Read the contract')&&body.indexOf('Read the contract')<body.indexOf('Checking.'));
  state.messages.push({id:'final',role:'assistant',turnId:'run',text:'Final answer.',streaming:false,createdAt:at(7)});
  state.turns!['run'].state='completed';state.turns!['run'].assistantMessageId='final';state.latestTurn=state.turns!['run'];state.session={status:'ready',activeTurnId:null};
  const completed=renderInlineTurn(state,'run','thread','complete','collapse');
  assert.ok(completed.indexOf('Public summary')<completed.indexOf('\n\n> Final answer.'));
  assert.doesNotMatch(renderInlineTurn(state,'run','thread','complete','remove'),/Public summary|t3-thought|t3-plan/);
});

test('compaction replaces its own display row and cannot complete an app run',()=>{
  let state=fixture([{id:'compact',type:'compaction',status:'running',startedAt:at(5)}]);
  const live=renderInlineTurn(state,'run','thread','running','collapse');
  assert.match(live,/data-t3-tool-icon="minimize-2"/);assert.match(live,/Compacting context/);assert.doesNotMatch(live,/Running compaction|<hr|Thinking/);
  state=applyThreadItem(state,normalizeV2StreamItem({kind:'event',sequence:2,event:{type:'turn-item.updated',payload:{id:'compact',runId:'run',ordinal:1,type:'compaction',status:'completed',startedAt:at(5),updatedAt:at(6)}}})).state;
  const finished=renderInlineTurn(state,'run','thread','running','collapse');
  assert.equal((finished.match(/Context compacted/g)??[]).length,1);assert.doesNotMatch(finished,/Compacting context|Running compaction/);
  assert.equal(turnPhase(state,'run'),'running');
});

test('unrelated run emissions are excluded and completed errors are visible without live controls',()=>{
  const state=fixture([{id:'other',type:'reasoning',runId:'other-run',text:'Unrelated',streaming:false},{id:'error',type:'error',status:'failed',failure:{message:'The tool failed.'}}]);
  const body=renderInlineTurn(state,'run','thread','running','collapse');
  assert.doesNotMatch(body,/Unrelated|Running error/);assert.match(body,/\[!t3-notification\] Error/);assert.match(body,/The tool failed\./);
});
