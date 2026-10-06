import {test} from 'node:test';
import assert from 'node:assert/strict';
import {commandProgram,responseTools,renderResponseTool,responseToolGroups,currentResponseToolGroup,summarizeResponseTools} from '../response-tools';
import {responseActivityLabel} from '../response-activity';
import {stoppedResponseBody} from '../response-stop';
import {renderInlineTurn,type InlineThreadState,type InlineActivity} from '../inline-thread';
const a=(id:string,sequence:number,kind:string,payload:any):InlineActivity=>({id,turnId:'turn',sequence,kind,summary:'Tool',createdAt:new Date(sequence*1000).toISOString(),payload});
test('shell labels match the program while details retain the exact command',()=>{
  const command="/bin/bash -lc 'npm test > /tmp/test.log 2>&1'";assert.equal(commandProgram(command),'npm');assert.equal(commandProgram('cd /tmp && python3 check.py'),'python3');
  const [tool]=responseTools({messages:[],activities:[a('start',1,'tool.started',{toolCallId:'cmd',data:{item:{command,cwd:'/tmp/work'},files:[{path:'/tmp/test.txt'}]}})]},['turn']);
  assert.equal(tool.label,'Running npm');assert.equal(tool.command,command);assert.match(renderResponseTool(tool),/Directory: <code>\/tmp\/work<\/code>/);assert.match(renderResponseTool(tool),/Files: <code>\/tmp\/test.txt<\/code>/);assert.match(renderResponseTool(tool),/2&gt;&amp;1/);
});
test('sparse terminal results retain command data, concurrent identity and terminal status even with a later start',()=>{
  const activities=[a('end',1,'tool.completed',{toolCallId:'one',status:'completed',data:{item:{aggregatedOutput:'<script>bad</script>',exitCode:7,durationMs:1200}}}),a('two',2,'tool.started',{toolCallId:'two',data:{toolName:'Read',input:{path:'/tmp/file.md'}}}),a('late-start',3,'tool.started',{toolCallId:'one',data:{item:{command:'npm test'}}}),a('sparse',4,'tool.updated',{toolCallId:'two',status:'inProgress'})];
  const tools=responseTools({messages:[],activities},['turn']);assert.equal(tools.length,2);assert.equal(tools[0].label,'Failed npm');assert.equal(tools[1].label,'Reading file.md');assert.equal(tools[0].durationMs,1200);assert.match(renderResponseTool(tools[0]),/Exit code: 7/);assert.doesNotMatch(renderResponseTool(tools[0]),/<script>/);assert.match(renderResponseTool(tools[0]),/&lt;script&gt;/);assert.ok(!renderResponseTool({...tools[0],output:'first\nsecond'}).includes('\n'));assert.match(renderResponseTool({...tools[0],output:'first\nsecond'}),/first&#10;second/);
  assert.deepEqual(responseTools({messages:[],activities},['other']),[]);
});
test('history keeps completed tool results while the final prose remains outside the fold',()=>{
  const state:InlineThreadState={messages:[{id:'final',role:'assistant',turnId:'turn',text:'Final answer.',streaming:false}],activities:[a('tool',1,'tool.completed',{toolCallId:'cmd',status:'completed',data:{item:{command:'npm test',exitCode:0,aggregatedOutput:'passed'}}})],latestTurn:{turnId:'turn',state:'completed',assistantMessageId:'final'}};
  const body=renderInlineTurn(state,'turn','thread','complete','collapse');assert.match(body,/> <details[^\n]+Ran npm/);assert.match(body,/\n\n> Final answer\./);assert.match(body,/passed/);
});
test('unfinished Markdown stays literal until a complete block boundary and is formatted when sealed',()=>{
  const message={id:'text',role:'assistant',turnId:'turn',text:'Done.\n\n| A | B |\n| --',streaming:true};
  const state:InlineThreadState={messages:[message],activities:[],latestTurn:{turnId:'turn',state:'running'}};
  const live=renderInlineTurn(state,'turn','thread','running','collapse');assert.match(live,/> > Done\./);assert.match(live,/stream-tail">\| A \| B \|&#10;\| --/);
  message.text='Done.\n\n```ts\n\nconst a = 1;';const fence=renderInlineTurn(state,'turn','thread','running','collapse');assert.match(fence,/stream-tail">```ts&#10;&#10;const/);
  message.streaming=false;assert.doesNotMatch(renderInlineTurn(state,'turn','thread','running','collapse'),/stream-tail/);
});

test('consecutive calls become one collapsed history group; the current batch appears once at the bottom',()=>{
  const message=(id:string,time:number,text:string,role='assistant')=>({id,role,text,turnId:'turn',streaming:false,createdAt:new Date(time*1000).toISOString()});
  const state:InlineThreadState={messages:[message('before',1,'Before.'),message('middle',5,'Between batches.')],activities:[
    a('one',2,'tool.completed',{toolCallId:'one',data:{command:'npm test',output:'first output'}}),
    a('two',3,'tool.completed',{toolCallId:'two',data:{command:'pwd',output:'second output'}}),
    a('three',6,'tool.completed',{toolCallId:'three',data:{command:'npm run build',exitCode:0,output:'build passed'}}),
  ]};
  const groups=responseToolGroups(state,['turn']);assert.deepEqual(groups.map(g=>g.tools.map(t=>t.id)),[['one','two'],['three']]);
  const current=currentResponseToolGroup(state,'turn',groups)!;assert.equal(current.tool.status,'completed');assert.equal(current.tool.label,'Ran npm');assert.equal(current.active,true);
  for(const mode of ['keep','collapse','remove'] as const){
    const body=renderInlineTurn(state,'turn','thread','running',mode);
    assert.equal(body.match(/data-t3-tool-id="three"/g)?.length,1);
    assert.match(body,/<details class="send-to-t3-response-activity"[^\n]+<strong>Running npm<\/strong>/);
    assert.match(body,mode==='collapse'?/^> <details class="send-to-t3-response-activity"/m:/^<details class="send-to-t3-response-activity"/m);
    assert.match(body,/data-t3-tool-id="three"[^>]+data-t3-tool-status="completed"[^\n]+Ran npm/);
    if(mode!=='remove'){assert.match(body,/<details class="send-to-t3-tool-group"[^>]*><summary>[^\n]*<span>Ran 2 commands<\/span><\/summary>/);assert.equal(body.match(/first output/g)?.length,1);}
    const stopped=stoppedResponseBody(body);assert.doesNotMatch(stopped,/data-t3-live-tool|response-activity|inline-spinner/);assert.match(stopped,/build passed/);
  }
  const collapsed=renderInlineTurn(state,'turn','thread','running','collapse');assert.ok(collapsed.indexOf('Before.')<collapsed.indexOf('Ran 2 commands')&&collapsed.indexOf('Ran 2 commands')<collapsed.indexOf('Between batches.'));
  state.messages.push(message('reason',7,'Private reasoning','reasoning'));
  assert.equal(currentResponseToolGroup(state,'turn'),undefined);assert.equal(responseActivityLabel(state,'turn'),'Thinking');
  const advanced=renderInlineTurn(state,'turn','thread','running','collapse');assert.match(advanced,/<span>Ran 1 command<\/span><\/summary>/);assert.doesNotMatch(advanced,/Private reasoning|<strong>Running npm/);
});

test('new prose, user input and turns split groups without merging reused tool IDs or reopening results',()=>{
  const one=a('a',1,'tool.completed',{toolCallId:'same',data:{command:'pwd',output:'one'}});
  const two={...a('b',4,'tool.started',{toolCallId:'same',data:{command:'ls'}}),turnId:'next'};
  const state:InlineThreadState={messages:[],activities:[two,one]};
  const tools=responseTools(state,['turn','next']);assert.equal(tools.length,2);assert.notEqual(tools[0].key,tools[1].key);assert.equal(tools[0].status,'completed');assert.equal(tools[1].status,'inProgress');
  assert.equal(responseToolGroups(state,['turn','next']).length,2);
  state.messages.push({id:'prose',role:'assistant',turnId:'next',text:'New text.',streaming:true,createdAt:new Date(5000).toISOString()});assert.equal(currentResponseToolGroup(state,'next'),undefined);
  state.activities.push({...a('c',6,'tool.started',{toolCallId:'c',data:{command:'npm test'}}),turnId:'next'});
  assert.deepEqual(responseToolGroups(state,['next']).map(g=>g.tools.length),[1,1]);assert.equal(responseActivityLabel(state,'next'),'Running npm');
});

test('failure and stop outcomes stay visible and stop clears every running call in the live dropdown',()=>{
  const state:InlineThreadState={messages:[],activities:[a('one',1,'tool.started',{toolCallId:'one',data:{command:'pwd'}}),a('two',2,'tool.started',{toolCallId:'two',data:{command:'ls'}})]};
  const body=renderInlineTurn(state,'turn','thread','running','collapse'),stopped=stoppedResponseBody(body);
  assert.equal(stopped.match(/data-t3-tool-status="stopped"/g)?.length,2);assert.match(stopped,/Stopped pwd/);assert.match(stopped,/Stopped ls/);assert.doesNotMatch(stopped,/inProgress|Running|inline-spinner/);
  state.activities=state.activities.map(a=>({...a,kind:'tool.completed',payload:{...a.payload,status:'failed'}}));
  const failed=renderInlineTurn(state,'turn','thread','running','collapse');assert.match(failed,/<span>Ran 2 commands · 2 failed/);assert.match(failed,/Failed ls/);assert.doesNotMatch(failed,/data-t3-live-tool/);
  const failedCall=state.activities[1];
  for(const status of ['declined','stopped']){
    state.activities=[{...failedCall,payload:{...failedCall.payload,status}}];
    assert.equal(responseActivityLabel(state,'turn'),`${status==='declined'?'Declined':'Stopped'} ls`);
    const row=renderInlineTurn(state,'turn','thread','running','collapse').split('data-t3-live-tool')[1];assert.doesNotMatch(row,/inline-spinner/);
  }
  const example='```html\n'+body+'\n```';assert.equal(stoppedResponseBody(example),example);
});

test('summary matches T3 sentence and distinct file counts, including sparse file-change results',()=>{
  const commands=Array.from({length:4},(_,i)=>a(`cmd-${i}`,i+1,'tool.completed',{toolCallId:`cmd-${i}`,itemType:'command_execution',data:{item:{command:'pwd'}}}));
  const activities=[...commands,a('patch-start',5,'tool.started',{toolCallId:'patch',itemType:'file_change',data:{item:{changes:[{path:'a.ts'},{path:'b.ts'}]}}}),a('patch-end',6,'tool.completed',{toolCallId:'patch',data:{item:{changes:Array.from({length:7},(_,i)=>({path:`${String.fromCharCode(97+i)}.ts`}))}}})];
  const tools=responseTools({messages:[],activities},['turn']);assert.equal(tools.length,5);assert.equal(summarizeResponseTools(tools),'Ran 4 commands and changed 7 files');
  assert.deepEqual(tools.at(-1)?.files,['a.ts','b.ts','c.ts','d.ts','e.ts','f.ts','g.ts']);
  tools.push({...tools.at(-1)!,id:'again',files:['a.ts']});assert.equal(summarizeResponseTools(tools),'Ran 4 commands and changed 7 files');
  const body=renderInlineTurn({messages:[],activities},'turn','thread','complete','collapse');assert.match(body,/<summary><span data-t3-tool-icon="hammer"[^\n]+<span>Ran 4 commands and changed 7 files<\/span><\/summary>/);
  const browser=responseTools({messages:[],activities:[a('browser',1,'tool.completed',{toolCallId:'browser',data:{server:'t3-code',tool:'preview_snapshot'}})]},['turn']);
  assert.equal(summarizeResponseTools([...browser,...tools.slice(0,1)]),'Used browser 1 time and ran 1 command');
});
