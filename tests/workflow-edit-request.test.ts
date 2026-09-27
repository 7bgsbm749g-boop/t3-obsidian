import {test} from 'node:test';
import assert from 'node:assert/strict';
import {commandId} from '../direct';
import {folderWorkflowIR} from '../v2-folder-workflow';
import {workflowSetupThreadId,workflowEditPath,workflowEditRequestPath,workflowEditPrompt,workflowEditDocument,validateWorkflowEditProposal,mergeWorkflowEditRequests,type WorkflowEditRequest} from '../workflow-edit-request';

const setupRequestId='02f7ea89-5b49-466a-b2a6-daa12a7402b3';
const workflowId='bd2e7b80-c408-4e67-81c6-007a83388272';
const request:WorkflowEditRequest={requestId:'4f08f31b-e90b-4f7d-8e42-dcd47d9b454d',workflowId,baseRevision:2,requestedAt:'2026-09-27T00:00:00Z'};
function current(){return {...folderWorkflowIR({id:workflowId,name:'Workout journal',folderPath:'Gym',includeSubfolders:true,events:['modify'],task:'Summarize workouts.',destinationId:'qlo2-vps',projectId:'project',connectionId:'connection',enabled:true,order:0}),revision:2,setupRequestId,setupIntent:'Summarize workouts.'};}

test('workflow setup request is a stable link to its original T3 thread',()=>{
  assert.equal(workflowSetupThreadId(current()),commandId(setupRequestId,'thread'));
  assert.equal(workflowSetupThreadId(current()),'ac653764-e57d-554d-82ea-a358ad0733fd');
  assert.equal(workflowEditPath(request),`.obsidian/t3-code/setup/${workflowId}-${request.requestId}.json`);
  assert.equal(workflowEditRequestPath(request),`.obsidian/t3-code/setup/${workflowId}-${request.requestId}.request.json`);
});

test('edit request keeps the active workflow and links the proposal to one revision',()=>{
  const ir=current(),change='Only update the journal after a weight increase.';
  const prompt=workflowEditPrompt({change,folderPath:'Gym',requestPath:'/vault/.obsidian/t3-code/setup/request.request.json'});
  assert.equal(prompt.split(change).length-1,1);
  assert.match(prompt,/Workflow folder: Gym/);
  const document=JSON.parse(workflowEditDocument({vaultRoot:'/vault',folderPath:'Gym',proposalPath:'/vault/proposal.json',current:ir,request}));
  assert.equal(document.current.enabled,true);
  assert.equal(document.current.revision,2);
  assert.equal(document.editRequestId,request.requestId);
  const updated={...ir,revision:3,name:'Weight increases only'};
  assert.equal(validateWorkflowEditProposal({workflowId,editRequestId:request.requestId,ir:updated},ir,request).name,'Weight increases only');
  assert.throws(()=>validateWorkflowEditProposal({workflowId,editRequestId:request.requestId,ir:{...updated,setupRequestId:'another'}},ir,request),/setup thread/);
  assert.throws(()=>validateWorkflowEditProposal({workflowId,editRequestId:request.requestId,ir:{...updated,folderPath:'Other',scope:{...updated.scope,path:{...updated.scope.path,glob:'Other\/*.md'}}}},ir,request),/outside the original selection/);
  assert.throws(()=>validateWorkflowEditProposal({workflowId,editRequestId:request.requestId,ir:updated},{...ir,revision:3},request),/another request or revision/);
});

test('concurrent unrelated saves retain pending edits and reject two changes to one workflow',()=>{
  assert.deepEqual(mergeWorkflowEditRequests([], [request], []),[request]);
  assert.deepEqual(mergeWorkflowEditRequests([request],[request],[]),[]);
  assert.throws(()=>mergeWorkflowEditRequests([], [request], [{...request,requestId:'9519c374-2d53-4e4f-a88f-9db5fb9c24e3'}]),/already has a change request/);
});
