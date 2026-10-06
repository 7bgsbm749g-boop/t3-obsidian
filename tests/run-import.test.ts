import {test} from 'node:test';
import assert from 'node:assert/strict';
import {importRuns,importBindingId,importFollowId} from '../run-import';
import {applyThreadItem,restoreInlineBindings,type InlineThreadState} from '../inline-thread';
const old='2026-10-06T10:00:00Z',recent='2026-10-06T11:00:00Z';
function history():InlineThreadState{return applyThreadItem({messages:[],activities:[]},{kind:'snapshot',snapshot:{thread:{messages:[
  {id:'old',role:'user',text:'Old prompt',createdAt:old,turnId:null,streaming:false},
  {id:'old-answer',role:'assistant',text:'Old answer',createdAt:old,turnId:'old-turn',streaming:false},
  {id:'new',role:'user',text:'New prompt',createdAt:recent,turnId:null,streaming:false},
  {id:'new-answer',role:'assistant',text:'Live answer',createdAt:recent,turnId:'new-turn',streaming:true}],activities:[],latestTurn:{turnId:'new-turn',requestedAt:recent,state:'running'},session:{status:'running',activeTurnId:'new-turn'}}}}).state;}
test('complete transcript exposes missing old associations while the exact active run is importable',()=>{
  const runs=importRuns(history());assert.equal(runs[0].messageId,'new');assert.equal(runs[0].status,'Running');assert.equal(runs[0].turn?.messageId,'new');assert.equal(runs[1].status,'Unavailable');assert.match(runs[1].unavailable!,/prompt-to-run/);
});
test('saved exact bindings recover a completed old response without adopting the newer run',()=>{
  const state=restoreInlineBindings(history(),{bindings:{old:{turnId:'old-turn',kind:'explicit'}},turns:{'old-turn':{turnId:'old-turn',messageId:'old',requestedAt:old,state:'completed'}}});
  const run=importRuns(state).find(run=>run.messageId==='old')!;assert.equal(run.status,'Completed');assert.equal(run.turn?.turnId,'old-turn');assert.equal(run.unavailable,undefined);
});
test('same-turn steering is not offered as a second imported response',()=>{
  const state=history();state.messages.push({id:'steer',role:'user',text:'Steering',createdAt:recent,turnId:'new-turn',streaming:false});
  assert.match(importRuns(state).find(run=>run.messageId==='steer')!.unavailable!,/first prompt/);
});
test('partial snapshots and unverifiable old completion states cannot create an import',()=>{
  const state=history();state.historyComplete=false;assert.ok(importRuns(state).every(run=>run.unavailable));
  state.historyComplete=true;state.bindings={old:{turnId:'old-turn',kind:'explicit'}};state.messages[1].streaming=true;
  assert.match(importRuns(state).find(run=>run.messageId==='old')!.unavailable!,/completion record/);
});
test('completed, failed, and interrupted latest runs keep their exact lifecycle',()=>{
  for(const [status,label] of [['completed','Completed'],['error','Failed'],['interrupted','Interrupted']] as const){
    const state=history();state.latestTurn!.state=status;state.session={status:'ready',activeTurnId:null};state.messages.at(-1)!.streaming=false;
    assert.equal(importRuns(state)[0].status,label);assert.equal(importRuns(state)[0].turn!.state,status);
  }
});
test('repeated imports use one identity; machines, source runs and destination notes stay independent',()=>{
  const source={environmentId:'machine',projectId:'project',threadId:'thread'};
  const first=importBindingId(source,'message','A.md');assert.equal(importBindingId(source,'message','A.md'),first);
  assert.notEqual(importBindingId({...source,environmentId:'other'},'message','A.md'),first);
  assert.notEqual(importBindingId(source,'other','A.md'),first);assert.notEqual(importBindingId(source,'message','B.md'),first);
  assert.notEqual(importFollowId(source,'A.md'),first);
});
