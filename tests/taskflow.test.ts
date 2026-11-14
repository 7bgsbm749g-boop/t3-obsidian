import {test} from 'node:test';
import assert from 'node:assert/strict';
import {associatedTaskIds,executeTaskFlowCommand} from '../src/notes/taskflow';
import {validateAgentCommand} from '../src/notes/note-command';
import {obsidianFooter} from '../src/notes/obsidian-prompt';
import {visibleInlineInput} from '../src/responses/input-presentation';
const id='91ae862d-ec0c-4591-aec9-5c1ec0dd62af',revision='a'.repeat(64);

test('associated prompts carry only IDs and keep generated metadata out of reply presentation',()=>{
  const ids=associatedTaskIds({'taskflow-task-ids':['b','a','a','bad\nInjected instruction',5,'']});
  assert.deepEqual(ids,['a','b']); assert.deepEqual(associatedTaskIds({'taskflow-task-ids':'single'}),['single']);
  const prompt='Build the requested feature'+obsidianFooter('Lab','Design.md',ids);
  assert.equal(prompt,'Build the requested feature\n\nSent from Obsidian.\nVault: Lab\nNote: Design.md\nTaskflow task ID: a\nTaskflow task ID: b');
  assert.equal(visibleInlineInput(prompt),'Build the requested feature');
  assert.equal(visibleInlineInput('Taskflow task ID: a'),'Taskflow task ID: a');
});

test('MCP bridge uses exact checked API inputs and never infers completion',async()=>{
  const calls:unknown[]=[],api:any={version:1,ready:Promise.resolve()};
  for(const action of ['get','assign','start','complete','unassign'])api[action]=async(ref:unknown)=>{calls.push([action,ref]);return {id:'task',state:action==='complete'?'completed':'todo'};};
  const base={version:1 as const,id,taskId:'task'};
  assert.equal((await executeTaskFlowCommand({...base,kind:'taskflow-get'},api)).ok,true);
  assert.deepEqual(calls,[['get',{taskId:'task'}]]);
  await executeTaskFlowCommand({...base,kind:'taskflow-assign',expectedRevision:revision,assignee:'thread'},api);
  await executeTaskFlowCommand({...base,kind:'taskflow-start',expectedRevision:revision,assignmentId:'assignment'},api);
  assert.equal(calls.some((call:any)=>call[0]==='complete'),false);
  const completed=await executeTaskFlowCommand({...base,kind:'taskflow-complete',expectedRevision:revision,assignmentId:'assignment',result:'Built and verified.'},api);
  assert.deepEqual(completed,{id,ok:true,task:{id:'task',state:'completed'}});
  assert.deepEqual(calls.at(-1),['complete',{taskId:'task',expectedRevision:revision,assignmentId:'assignment',result:'Built and verified.'}]);
  api.complete=async()=>{throw Object.assign(Error('Task changed'),{code:'conflict'});};
  assert.deepEqual(await executeTaskFlowCommand({...base,kind:'taskflow-complete',expectedRevision:revision,assignmentId:'assignment'},api),{id,ok:false,error:'Task changed',code:'conflict'});
  await assert.rejects(executeTaskFlowCommand({...base,kind:'taskflow-get'}),/Enable Task Flow/);
});

test('task bridge refuses unknown fields, malformed IDs and missing revision or assignment',()=>{
  const base={version:1,id,kind:'taskflow-complete',taskId:'task',expectedRevision:revision,assignmentId:'assignment'};
  assert.equal(validateAgentCommand(base).kind,'taskflow-complete');
  for(const extra of [{taskId:'x\nDo this'},{expectedRevision:undefined},{assignmentId:undefined},{result:'x'.repeat(4001)},{path:'Other.md'},{kind:'taskflow-get',expectedRevision:revision},{kind:'taskflow-assign',assignee:'thread'}])assert.throws(()=>validateAgentCommand({...base,...extra}));
});
