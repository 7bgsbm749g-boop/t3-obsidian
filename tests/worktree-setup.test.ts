import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyThreadItem,inlineBindingCheckpoint,renderInlineTurn,restoreInlineBindings,type InlineThreadState} from '../inline-thread';
import {normalizeV2Snapshot,normalizeV2StreamItem} from '../orchestration-v2';
import {responseTools} from '../response-tools';
import {renderWorktreeSetup,readWorktreeSetup,setupDuration} from '../worktree-setup';
import {stoppedResponseBody} from '../response-stop';
import {completedSetup,preparationItem,setupAt} from './fixtures/worktree-setup';
const empty=():InlineThreadState=>({messages:[],activities:[]});
const snapshot=(item=preparationItem)=>normalizeV2Snapshot({snapshotSequence:20,projection:{thread:{id:'fixture-thread',projectId:'project'},messages:[{id:'prompt',role:'user',runId:'run',text:'Task',streaming:false,createdAt:setupAt}],runs:[{id:'run',ordinal:1,userMessageId:'prompt',status:'running',requestedAt:setupAt}],turnItems:[item],runtimeRequests:[]}});
const setup=(state:InlineThreadState,value=completedSetup)=>applyThreadItem(state,{kind:'event',event:{type:'thread.worktree-setup',aggregateId:'fixture-thread',payload:value}}).state;

test('canonical preparation becomes one visible setup panel, never a shell command group',()=>{
 const state=setup(applyThreadItem(empty(),{kind:'snapshot',snapshot:snapshot()}).state),body=renderInlineTurn(state,'run','fixture-thread','running','collapse');
 assert.equal(responseTools(state,['run']).length,0);assert.doesNotMatch(body,/Ran 1 command|Ran Preparing|Exit code/);
 for(const text of ['Fetch base branch','Check out files','Run setup script','Start agent','756ms','1.1s','54ms','skipped','Details'])assert.ok(body.includes(text),text);
 assert.equal((body.match(/data-t3-worktree-setup=/g)??[]).length,1);
 assert.match(body,/data-worktree-setup-phase="done"/);assert.doesNotMatch(body,/setup-details[^>]* open/);
 const ordinary={...preparationItem,id:'ordinary',input:'Preparing workspace'};
 assert.equal(responseTools(applyThreadItem(empty(),{kind:'snapshot',snapshot:snapshot(ordinary)}).state,['run']).length,1,'Labels alone cannot hide a real command');
});
test('setup updates use a separate cursor and survive canonical polls and restart checkpoints',()=>{
 let state=setup(applyThreadItem(empty(),{kind:'snapshot',snapshot:snapshot()}).state);
 assert.equal(state.sequence,20);assert.equal(state.worktreeSetup?.sequence,8);
 assert.equal(setup(state,{...completedSetup,sequence:7,phase:'running'}),state);
 assert.equal(setup(state,{...completedSetup,threadId:'other',sequence:9}),state);
 state=applyThreadItem(state,{kind:'snapshot',snapshot:{...snapshot(),snapshotSequence:21}}).state;
 assert.equal(state.worktreeSetup?.sequence,8);assert.deepEqual(restoreInlineBindings(empty(),inlineBindingCheckpoint(state)).worktreeSetup,completedSetup);
 const event=normalizeV2StreamItem({kind:'event',sequence:22,event:{type:'turn-item.updated',payload:{...preparationItem,status:'running'}}});
 assert.equal(applyThreadItem(state,event).state.activities[0].kind,'response.worktree-setup');
});
test('live checkout progress, script output and failures are escaped, bounded and never invented',()=>{
 const activity={id:'setup',turnId:'run',kind:'response.worktree-setup',summary:'Setup',createdAt:setupAt,payload:{status:'inProgress'}};
 const running={...completedSetup,phase:'running' as const,endedAt:null,setupScript:{name:'Install <deps>',command:'npm ci',terminalId:'terminal'},stages:completedSetup.stages.map(s=>s.id==='checkout'?{...s,status:'running' as const,endedAt:null,percent:42}:s)};
 const body=renderWorktreeSetup(activity,running,true);assert.match(body,/Setting up worktree…/);assert.match(body,/42%/);assert.match(body,/Install &lt;deps&gt;/);assert.match(body,/data-worktree-setup-status="running"/);
 assert.doesNotMatch(renderWorktreeSetup(activity,undefined,true),/Fetch base branch|skipped|54ms/);
 const failed={...running,phase:'failed' as const,error:'<script>bad</script>',stages:running.stages.map(s=>s.id==='setup-script'?{...s,status:'failed' as const,tail:['<script>literal</script>']}:s)};
 const result=renderWorktreeSetup(activity,failed,true);assert.match(result,/Worktree setup failed/);assert.match(result,/&lt;script&gt;literal/);assert.doesNotMatch(result,/<script>/);
 assert.equal(readWorktreeSetup({...completedSetup,stages:[completedSetup.stages[0],completedSetup.stages[0]]},'fixture-thread'),undefined);
 assert.equal(readWorktreeSetup({...completedSetup,setupScript:{name:{}}},'fixture-thread'),undefined);
 assert.equal(setupDuration(756),'756ms');assert.equal(setupDuration(1100),'1.1s');assert.equal(setupDuration(-1),'0ms');
});
test('terminal rendering and Stop freeze stage clocks and remove all live animation',()=>{
 const activity={id:'setup',turnId:'run',kind:'response.worktree-setup',summary:'Setup',createdAt:setupAt,payload:{status:'inProgress'}};
 const running={...completedSetup,phase:'running' as const,endedAt:null,stages:completedSetup.stages.map(s=>({...s,status:'running' as const,endedAt:null}))};
 const live=renderWorktreeSetup(activity,running,true),stopped=stoppedResponseBody(live);
 assert.match(stopped,/Worktree setup stopped/);assert.doesNotMatch(stopped,/data-worktree-setup-status="running"|inline-spinner/);
 assert.match(stopped,/data-t3-setup-end=/);assert.equal(stoppedResponseBody('```html\n'+live+'\n```'),'```html\n'+live+'\n```');
 assert.doesNotMatch(renderWorktreeSetup(activity,running,false),/data-worktree-setup-status="running"|inline-spinner/);
});
