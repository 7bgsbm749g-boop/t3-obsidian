import {test} from 'node:test';
import assert from 'node:assert/strict';
import {commandProgram,responseTools,renderResponseTool} from '../response-tools';
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
