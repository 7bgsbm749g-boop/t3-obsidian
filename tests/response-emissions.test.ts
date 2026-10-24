import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeV2Snapshot,normalizeV2StreamItem} from '../orchestration-v2';
import {applyThreadItem,renderInlineTurn,turnPhase} from '../inline-thread';
import {unified} from 'unified';
import remarkParse from 'remark-parse';
import {stoppedResponseBody} from '../response-stop';
import {responseEmissions} from '../response-emissions';

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

test('consecutive public thoughts share one closed group, timestamp and stable streaming identity',()=>{
  let state=fixture([{id:'one',type:'reasoning',text:'**First summary**',streaming:false,startedAt:at(2)},
    {id:'two',type:'reasoning',text:'**Second summary**',streaming:true,startedAt:at(3)}]);
  const read=()=>responseEmissions(state,['run'],text=>text).filter(item=>item.kind==='reasoning');
  const [group]=read();assert.equal(read().length,1);
  assert.match(group.body,/\[!t3-thought\]- Thought \(×2\)/);
  assert.match(group.body,/data-t3-thought-at="2000"/);
  assert.ok(group.body.indexOf('First summary')<group.body.indexOf('Second summary'));
  const identity=/data-t3-fold="([^"]+)"/.exec(group.body)![1];
  state=applyThreadItem(state,normalizeV2StreamItem({kind:'event',sequence:2,event:{type:'turn-item.updated',payload:{id:'two',runId:'run',ordinal:2,type:'reasoning',text:'**Second summary extended**',streaming:false,startedAt:at(3),updatedAt:at(5)}}})).state;
  assert.equal(read().length,1);assert.match(read()[0].body,/Second summary extended/);
  assert.equal(/data-t3-fold="([^"]+)"/.exec(read()[0].body)![1],identity);
  for(const mode of ['keep','collapse','remove'] as const)assert.match(renderInlineTurn(state,'run','thread','running',mode),/Thought \(×2\)/);
  assert.equal(turnPhase(state,'run'),'running');
});

test('tools, prose, input, plans and different runs split thought groups',()=>{
  for(const boundary of ['tool','prose','user','plan','run']){
    const items:any[]=[{id:'one',type:'reasoning',text:'Before',streaming:false,startedAt:at(2)},
      {id:'two',type:'reasoning',text:'After',streaming:false,startedAt:at(6),...(boundary==='run'?{runId:'next'}:{})}];
    if(boundary==='tool')items.push({id:'tool',type:'command_execution',input:'pwd',startedAt:at(3)});
    if(boundary==='plan')items.push({id:'plan',type:'proposed_plan',text:'Plan',startedAt:at(3)});
    const state=fixture(items);state.messages=state.messages.filter(message=>message.id!=='prose');
    if(boundary==='prose'||boundary==='user')state.messages.push({id:'boundary',role:boundary==='prose'?'assistant':'user',turnId:'run',text:'Boundary',streaming:false,createdAt:at(3)});
    assert.equal(responseEmissions(state,['run','next'],text=>text).filter(item=>item.kind==='reasoning').length,2,boundary);
  }
});

test('canonical ordinals order same-time thought and tool boundaries',()=>{
  const state=fixture([{id:'two',type:'reasoning',text:'Second',streaming:false,ordinal:3,startedAt:at(2)},
    {id:'one',type:'reasoning',text:'First',streaming:false,ordinal:1,startedAt:at(2)},
    {id:'tool',type:'command_execution',input:'pwd',ordinal:2,startedAt:at(2)}]);
  const groups=responseEmissions(state,['run'],text=>text).filter(item=>item.kind==='reasoning');
  assert.equal(groups.length,2);assert.match(groups[0].body,/First/);assert.match(groups[1].body,/Second/);
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

test('terminal replies and Stop clear compaction activity when its terminal record is missing',()=>{
  const state=fixture([{id:'compact',type:'compaction',status:'running',startedAt:at(5)}]);
  for(const mode of ['remove','keep','collapse'] as const){
    for(const phase of ['complete','interrupted','cancelled','error'] as const){
      assert.doesNotMatch(renderInlineTurn(state,'run','thread',phase,mode),/inline-spinner|Compacting context/);
    }
    const live=renderInlineTurn(state,'run','thread','running',mode);
    const stopped=stoppedResponseBody(live);
    assert.doesNotMatch(stopped,/inline-spinner|Compacting context/);
    assert.match(stopped,/Context compaction stopped/);
    const example='```html\n'+live+'\n```';assert.equal(stoppedResponseBody(example),example);
  }
});

test('compaction retained from an earlier turn cannot animate in the current turn history',()=>{
  const state=fixture([{id:'compact',type:'compaction',status:'running',startedAt:at(5)}]);
  const older={...state,activities:state.activities.map(activity=>({...activity,turnId:'older'}))};
  const [history]=responseEmissions(older,['older','run'],text=>text,'run');
  assert.equal(history.active,false);assert.match(history.body,/Context compaction/);assert.doesNotMatch(history.body,/inline-spinner|Compacting context/);
});

test('unrelated run emissions are excluded and completed errors are visible without live controls',()=>{
  const state=fixture([{id:'other',type:'reasoning',runId:'other-run',text:'Unrelated',streaming:false},{id:'error',type:'error',status:'failed',failure:{message:'The tool failed.'}}]);
  const body=renderInlineTurn(state,'run','thread','running','collapse');
  assert.doesNotMatch(body,/Unrelated|Running error/);assert.match(body,/\[!t3-notification\] Error/);assert.match(body,/The tool failed\./);
});
test('a plan after prose is a separate native quote block and following prose stays outside it',()=>{
 const state=fixture([{id:'plan',type:'todo_list',startedAt:at(5),steps:[{step:'Check display',status:'in_progress'}]}]);
 state.messages.push({id:'after',role:'assistant',turnId:'run',text:'Following commentary.',streaming:false,createdAt:at(6)});
 const body=renderInlineTurn(state,'run','thread','running','collapse'),tree:any=unified().use(remarkParse).parse(body);
 const quotes:any[]=[];const visit=(node:any)=>{if(node.type==='blockquote')quotes.push(node);for(const child of node.children??[])visit(child);};visit(tree);
 const text=(node:any):string=>node.value??(node.children??[]).map(text).join('');
 const plans=quotes.filter(quote=>text(quote.children[0]).startsWith('[!t3-plan]'));
 assert.equal(plans.length,1);assert.match(text(plans[0]),/Check display/);assert.doesNotMatch(text(plans[0]),/Checking\.|Following commentary/);
 assert.equal(state.messages.find(message=>message.id==='prose')?.text,'Checking.');
});
