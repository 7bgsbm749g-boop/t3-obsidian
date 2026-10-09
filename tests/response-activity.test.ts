import {test} from 'node:test';
import assert from 'node:assert/strict';
import {unified} from 'unified';
import remarkParse from 'remark-parse';
import {responseActivityLabel,responseActivityRow} from '../response-activity';
import {applyThreadItem,initialRegion,renderInlineTurn,type InlineActivity,type InlineThreadState} from '../inline-thread';
import {stoppedResponseBody} from '../response-stop';

const activity=(id:string,kind='tool.started',payload:Record<string,any>={},turnId='turn',sequence=1):InlineActivity=>({id,kind,turnId,sequence,summary:'Tool',payload:{toolCallId:id,...payload}});
const state=(activities:InlineActivity[]=[]):InlineThreadState=>({messages:[],activities,session:{status:'running',activeTurnId:'turn'},latestTurn:{turnId:'turn',state:'running'}});

test('canonical tool state gives useful labels; reasoning and unknown state show Thinking',()=>{
  assert.equal(responseActivityLabel(state([activity('read','tool.started',{data:{toolName:'Read'}})]),'turn'),'Reading file');
  for(const data of [{item:{command:'npm test'}},{item:{input:{command:'npm test'}}},{item:{result:{command:'npm test'}}},{command:'npm test'},{input:{command:'npm test'}},{state:{input:{command:'npm test'}}}]){
    assert.equal(responseActivityLabel(state([activity('cmd','tool.started',{itemType:'command_execution',data})]),'turn'),'Running npm');
  }
  assert.equal(responseActivityLabel(state([activity('mcp','tool.started',{data:{tool:'preview_snapshot'}})]),'turn'),'Viewing preview snapshot');
  assert.equal(responseActivityLabel(state([activity('read','tool.started',{title:'Reading file'})]),'turn'),'Reading file');
  const thinking={...state(),messages:[{id:'reasoning',role:'reasoning',turnId:'turn',streaming:true,text:'private reasoning'}]};
  assert.equal(responseActivityLabel(thinking,'turn'),'Thinking');
  thinking.messages[0].streaming=false;assert.equal(responseActivityLabel(thinking,'turn'),'Thinking');
  assert.equal(responseActivityLabel(state(),'turn'),'Thinking');
  assert.equal(responseActivityLabel(state([activity('x')]),''),'Thinking');
});

test('successful completion keeps T3 live presentation while terminal failures and results remain final',()=>{
  const start=activity('a','tool.started',{title:'Reading file'});
  for(const terminal of [activity('done','tool.completed',{toolCallId:'a'}),activity('done','tool.updated',{toolCallId:'a',status:'completed'}),activity('done','tool.updated',{toolCallId:'a',status:'failed'})]){
    assert.equal(responseActivityLabel(state([start,terminal]),'turn'),terminal.payload?.status==='failed'?'Thinking':'Reading file');
    assert.equal(responseActivityLabel(state([terminal,start]),'turn'),terminal.payload?.status==='failed'?'Thinking':'Reading file');
  }
  assert.equal(responseActivityLabel(state([activity('upd','tool.updated',{title:'Reading file',status:'inProgress'})]),'turn'),'Reading file');
  assert.equal(responseActivityLabel(state([activity('only','tool.completed',{title:'Reading file'})]),'turn'),'Reading file');
  const older=activity('old','tool.started',{title:'Reading file'},'turn',3),newer=activity('new','tool.started',{title:'Running rg'},'turn',5);
  assert.equal(responseActivityLabel(state([newer,older]),'turn'),'Running rg');
  assert.equal(responseActivityLabel(state([older,newer,activity('end','tool.completed',{toolCallId:'new'},'turn',6)]),'turn'),'Reading file');
  const idless=[{...start,payload:{title:'Reading file'}},{...activity('end','tool.completed'),payload:{title:'Reading file'}}];
  assert.equal(responseActivityLabel(state(idless),'turn'),'Reading file');
});

test('events and snapshot recovery retain exact-turn isolation across responses and destinations',()=>{
  let current=state();
  for(const a of [activity('a','tool.started',{title:'Reading file'}),activity('b','tool.started',{data:{command:'pwd'}},'other',2)]){
    current=applyThreadItem(current,{kind:'event',event:{sequence:a.sequence,type:'thread.activity-appended',payload:{activity:a}}}).state;
  }
  assert.equal(responseActivityLabel(current,'turn'),'Reading file');assert.equal(responseActivityLabel(current,'other'),'Running pwd');
  const recovered=applyThreadItem(state(),{kind:'snapshot',snapshot:{thread:{...current,activities:[...current.activities,activity('done','tool.completed',{toolCallId:'a'})]}}}).state;
  assert.equal(responseActivityLabel(recovered,'turn'),'Reading file');assert.equal(responseActivityLabel(recovered,'other'),'Running pwd');
  assert.equal(responseActivityLabel(state([{...activity('unbound','tool.started',{title:'Reading file'}),turnId:null}]),'turn'),'Thinking');
});

test('one bottom row inside the collapse fold, outside prose and controls in other modes, absent for every terminal phase',()=>{
  const live={...state([activity('read','tool.started',{data:{toolName:'Read'}})]),messages:[{id:'prose',role:'assistant',turnId:'turn',text:'Progress\n\n```ts\nunfinished',streaming:true}]};
  for(const mode of ['remove','keep','collapse'] as const){
    const text=renderInlineTurn(live,'turn','thread','running',mode);
    assert.equal(text.split('class="send-to-t3-response-activity"').length-1,1);assert.match(text,/<span>Reading file<\/span>/);
    assert.equal(text.split('class="send-to-t3-inline-spinner"').length-1,2);
    const ast=unified().use(remarkParse).parse(text+'\nFOLLOWING USER CONTENT');
    const blocks=ast.children.filter(n=>n.type==='blockquote'||n.type==='code').map(node=>text.slice(node.position!.start.offset!,node.position!.end.offset!));
    if(mode==='collapse'){
      assert.equal(blocks.filter(block=>block.includes('send-to-t3-response-activity')).length,1);
      assert.match(blocks[0],/^> \[!t3-progress\]\+ [\s\S]*> <details class="send-to-t3-response-activity"/);
      assert.doesNotMatch(blocks[0],/FOLLOWING USER CONTENT/);
    }else for(const block of blocks)assert.doesNotMatch(block,/send-to-t3-response-activity/);
    for(const phase of ['complete','interrupted','cancelled','error'] as const){
      const ended=renderInlineTurn(live,'turn','thread',phase,mode);assert.doesNotMatch(ended,/response-activity|spinner/);
    }
    assert.doesNotMatch(stoppedResponseBody(text),/response-activity|spinner|Reading file/);
    const initial=initialRegion('id',undefined,'Title',mode).text;
    assert.match(initial,/response-activity/);
    assert.match(initial,/\*\*Title · Working\*\*/);
    assert.match(initial,/<span data-t3-tool-icon="brain" aria-hidden="true"><\/span><span>Thinking<\/span>/);
    assert.match(initial,mode==='collapse'?/^> <span class="send-to-t3-response-activity"/m:/^<span class="send-to-t3-response-activity"/m);
    assert.doesNotMatch(stoppedResponseBody(initial),/response-activity|spinner/);
    const fallback=renderInlineTurn(state(),'turn','thread','reconnecting',mode);
    assert.match(fallback,/<span data-t3-tool-icon="brain" aria-hidden="true"><\/span><span>Thinking<\/span>/);
    assert.doesNotMatch(stoppedResponseBody(fallback),/response-activity|spinner/);
  }
  assert.match(renderInlineTurn(live,'turn','thread','reconnecting'),/<span>Thinking<\/span>/);
});

test('labels cannot inject HTML; Stop preserves examples and neighboring content',()=>{
  assert.doesNotMatch(responseActivityRow('Running <script>\n& "x"'),/<script>/);
  assert.match(responseActivityRow('Running <script>'),/&lt;script&gt;/);
  const row=responseActivityRow('Reading file'),example='```html\n'+row+'\n```';
  assert.equal(stoppedResponseBody(example+'\n\n'+row+'\n\nUSER CONTENT'),example+'\n\n\nUSER CONTENT');
});
