import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderResponseTasks} from '../response-tasks';
import {renderInlineTurn,type InlineThreadState} from '../inline-thread';

test('structured Tasks has private, read-only pending, in-progress and complete indicators',()=>{
  const body=renderResponseTasks('run', {text:'Summary',steps:[{step:'Pending',status:'pending'},{text:'**Working**',status:'in_progress'},{content:'Done <script>bad</script>',status:'completed'}]});
  for(const state of ['pending','in_progress','completed'])assert.match(body,new RegExp(`data-t3-task-state="${state}"`));
  assert.match(body,/<strong>Working<\/strong>/);assert.match(body,/&lt;script&gt;/);
  assert.match(body,/data-t3-tool-icon="list-checks"/);assert.match(body,/<span>Tasks<\/span>/);
  assert.doesNotMatch(body,/<input|<button|data-task=|task-list-item|<script|[\r\n]/);
  assert.equal(renderResponseTasks('run',{}),'');
});

test('Markdown [/] and ordinary list items use the same private indicators while code stays literal',()=>{
  const body=renderResponseTasks('run', {text:'Task summary\r\n\r\n- [ ] First\r\n- [/] Second\r\n- [X] Third\r\n* Fourth\r\n\r\n```md\r\n- [/] Example\r\n```'});
  assert.equal(body.match(/role="listitem"/g)?.length,4);
  assert.match(body,/aria-label="In progress"/);assert.match(body,/<code class="language-md">- \[\/\] Example/);
  assert.doesNotMatch(body,/<input|data-task=|task-list-item|[\r\n]/);
});

test('only the latest Tasks list appears directly below the title in each live display mode',()=>{
  const state:InlineThreadState={title:'Thread title',messages:[{id:'prose',role:'assistant',turnId:'run',streaming:false,text:'Commentary',createdAt:new Date(3000).toISOString()}],activities:[
    {id:'one',turnId:'run',sequence:1,createdAt:new Date(1000).toISOString(),kind:'response.plan',summary:'',payload:{text:'- [ ] Old task'}},
    {id:'two',turnId:'run',sequence:2,createdAt:new Date(2000).toISOString(),kind:'response.plan',summary:'',payload:{text:'- [/] New task'}},
  ]};
  for(const mode of ['collapse','keep','remove'] as const){
    const body=renderInlineTurn(state,'run','thread','running',mode,undefined,undefined,{messageId:'prompt',text:'Initial input'},undefined);
    assert.equal(body.match(/data-t3-tasks-id=/g)?.length,1);assert.doesNotMatch(body,/Old task/);
    assert.ok(body.indexOf('Thread title')<body.indexOf('New task')&&body.indexOf('New task')<body.indexOf('Initial input')&&body.indexOf('New task')<body.indexOf('Commentary'));
  }
  const live=renderInlineTurn(state,'run','thread','running','collapse');
  const complete=renderInlineTurn(state,'run','thread','complete','collapse');
  assert.equal(/data-t3-tasks-id="([^"]+)"/.exec(live)?.[1],/data-t3-tasks-id="([^"]+)"/.exec(complete)?.[1]);
});
