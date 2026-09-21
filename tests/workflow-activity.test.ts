import {test} from 'node:test';
import assert from 'node:assert/strict';
import {workflowActivity} from '../workflow-activity';
import type {FolderWorkflow,WorkflowRun} from '../workflow';

const workflows=[{id:'a',folderPath:'Gym'},{id:'b',folderPath:'Gym'},{id:'c',folderPath:'Other'}] as FolderWorkflow[];
const run=(workflowId:string,state:WorkflowRun['state'],batchId='batch'):WorkflowRun=>({id:workflowId,workflowId,batchId,state,notePath:'Gym/note.md',inputHash:'hash',requestId:workflowId,createdAt:1,updatedAt:1});

test('activity spans queue, execution, settling, and the handoff until the entire batch completes',()=>{
  const runs=[run('a','queued'),run('b','queued')];
  assert.equal(workflowActivity(workflows,runs).folders.get('Gym'),'queued');
  runs[0].state='running';assert.equal(workflowActivity(workflows,runs).steps.get('a'),'running');
  runs[0].state='settling';assert.equal(workflowActivity(workflows,runs).folders.get('Gym'),'running');
  runs[0].state='completed';let activity=workflowActivity(workflows,runs);
  assert.equal(activity.steps.get('a'),'completed');assert.equal(activity.steps.get('b'),'queued');assert.equal(activity.folders.get('Gym'),'queued');
  runs[1].state='running';activity=workflowActivity(workflows,runs);assert.equal(activity.steps.get('a'),'completed');assert.equal(activity.folders.get('Gym'),'running');
  runs[1].state='completed';activity=workflowActivity(workflows,runs);assert.equal(activity.steps.size,0);assert.equal(activity.folders.size,0);
});

test('failed/conflicted batches retain static attention state, and separate running batches take precedence',()=>{
  for(const state of ['failed','conflicted'] as const){
    const runs=[run('a',state),run('b','queued')];let activity=workflowActivity(workflows,runs);
    assert.equal(activity.folders.get('Gym'),'blocked');assert.equal(activity.steps.get('b'),'blocked');
    runs.push(run('a','running','another-note'));activity=workflowActivity(workflows,runs);
    assert.equal(activity.folders.get('Gym'),'running');assert.equal(activity.steps.get('a'),'running');assert.equal(activity.steps.get('b'),'blocked');
  }
  assert.equal(workflowActivity(workflows,[]).folders.size,0);
  assert.equal(workflowActivity(workflows,[run('missing','running')]).folders.size,0);
  assert.equal(workflowActivity(workflows,[run('c','running')]).folders.get('Other'),'running');
});
