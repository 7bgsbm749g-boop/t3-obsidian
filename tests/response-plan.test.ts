import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderProposedPlan} from '../src/responses/response-plan';
import {itemActivities,normalizeV2StreamItem} from '../src/connection/orchestration-v2';
import {applyThreadItem,renderInlineTurn,type InlineThreadState} from '../src/conversations/inline-thread';

const plan=(markdown:string)=>itemActivities({id:'plan',planId:'source-plan',type:'proposed_plan',runId:'run',ordinal:2,status:'completed',markdown,startedAt:'2026-11-12T00:00:02Z'})[0];
test('native v2 plans keep public Markdown, identity and streaming updates separate from tasks',()=>{
  const activity=plan('# Release plan\n\n## Summary\n\nRead **the request**.');
  assert.equal(activity.kind,'response.proposed-plan');assert.equal(activity.payload?.planId,'source-plan');
  const state:InlineThreadState={messages:[],activities:[activity]};
  const next=applyThreadItem(state,normalizeV2StreamItem({kind:'event',sequence:2,event:{type:'turn-item.updated',payload:{id:'plan',planId:'source-plan',runId:'run',ordinal:2,type:'proposed_plan',status:'running',markdown:'# Revised\n\nUpdated.',streaming:true}}})).state;
  assert.equal(next.activities.length,1);assert.equal(next.activities[0].payload?.markdown,'# Revised\n\nUpdated.');
  const body=renderInlineTurn(next,'run','thread','running','collapse');
  assert.match(body,/send-to-t3-proposed-plan/);assert.match(body,/Drafting/);assert.doesNotMatch(body,/Release plan|send-to-t3-tasks/);
});
test('short plans show formatted contents without disclosure or executable provider HTML',()=>{
  const body=renderProposedPlan('id" onclick="bad',{markdown:'# Release plan\n\n## Summary\n\nRead **the request**.\n\n<script>bad</script>'});
  assert.match(body,/<strong>Release plan<\/strong>/);assert.match(body,/<strong>the request<\/strong>/);
  assert.doesNotMatch(body,/<details|<h1|<h2|<script| onclick="bad/);assert.match(body,/&lt;script&gt;/);
  assert.equal(renderProposedPlan('empty',{markdown:'  '}),'');
});
test('long plans retain full Markdown and a bounded preview with stable disclosure',()=>{
  const markdown='# Large plan\n\n'+Array.from({length:24},(_,i)=>`- Step ${i+1}: review the result.`).join('\n');
  const body=renderProposedPlan('plan',{markdown});
  assert.match(body,/details data-t3-plan-id="plan"/);assert.match(body,/Expand plan/);assert.match(body,/Collapse plan/);
  assert.match(body,/Step 24/);const preview=body.split('class="send-to-t3-plan-preview"')[1];assert.match(preview,/Step 10/);assert.doesNotMatch(preview,/Step 11/);
});
test('plans remain in chronology with adjacent tasks and survive final-only history preferences',()=>{
  const state:InlineThreadState={messages:[{id:'before',turnId:'run',role:'assistant',text:'Before.',streaming:false,createdAt:'2026-11-12T00:00:01Z'},{id:'final',turnId:'run',role:'assistant',text:'Final.',streaming:false,createdAt:'2026-11-12T00:00:04Z'}],activities:[plan('# Review plan\n\nPublic proposal.'),{id:'todo',turnId:'run',kind:'response.plan',summary:'Tasks',createdAt:'2026-11-12T00:00:03Z',payload:{steps:[{step:'Active task',status:'running'}]}}],latestTurn:{turnId:'run',state:'completed',assistantMessageId:'final'}};
  for(const mode of ['keep','collapse','remove'] as const){
    const body=renderInlineTurn(state,'run','thread','complete',mode);
    assert.equal(body.split('Public proposal.').length-1,1,mode);assert.ok(body.indexOf('Public proposal.')<body.indexOf('Final.'),mode);
    if(mode==='remove')assert.doesNotMatch(body,/Active task/);else assert.ok(body.indexOf('Public proposal.')<body.indexOf('Active task'));
  }
});
