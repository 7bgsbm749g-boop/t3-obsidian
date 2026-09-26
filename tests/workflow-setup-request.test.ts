import {test} from 'node:test';
import assert from 'node:assert/strict';
import {folderWorkflowIR} from '../v2-folder-workflow';
import {workflowSetupPath,workflowSetupRequestPath,workflowSetupPrompt,workflowSetupRequest,validateWorkflowSetupProposal} from '../workflow-setup-request';

test('setup thread shows the user request once while the separate file carries the protocol',()=>{
  const draft={...folderWorkflowIR({id:'draft',name:'Draft',folderPath:'Gym',includeSubfolders:true,events:['create','modify'],task:'Summarize the session.',destinationId:'qlo2-vps',projectId:'project',enabled:false,order:0}),setupIntent:'After I finish a gym note, summarize it.',setupRequestId:'request'};
  const prompt=workflowSetupPrompt({intent:draft.setupIntent,folderPath:'Gym',requestPath:`/vault/${workflowSetupRequestPath(draft)}`});
  assert.equal(prompt.split(draft.setupIntent).length-1,1);
  assert.match(prompt,/Workflow folder: Gym/);
  assert.match(prompt,/T3 Workflow Setup\/draft-request.request.json/);
  assert.doesNotMatch(prompt,/disabled draft|Workflow ID|setupRequestId|irVersion|eventTypes|plugin data.json/);
  const request=JSON.parse(workflowSetupRequest({vaultRoot:'/vault',folderPath:'Gym',proposalPath:`/vault/${workflowSetupPath(draft)}`,draft}));
  assert.equal(request.draft.workflowId,'draft');
  assert.match(request.instructions,/Do not edit plugin data.json/);
  assert.throws(()=>workflowSetupRequest({vaultRoot:'/vault',folderPath:'Other',proposalPath:'/vault/proposal.json',draft}),/disabled draft/);
  const configured={...draft,revision:2,enabled:true,trigger:{eventTypes:['note.changed' as const],unknown:'hold-for-review' as const}};
  assert.equal(validateWorkflowSetupProposal({workflowId:'draft',setupRequestId:'request',ir:configured},draft).enabled,true);
  const child={...configured,folderPath:'Gym/Tracker',scope:{...configured.scope,path:{glob:'Gym/Tracker/*.md',case:'sensitive' as const}}};
  assert.equal(validateWorkflowSetupProposal({workflowId:'draft',setupRequestId:'request',ir:child},draft).folderPath,'Gym/Tracker');
  assert.throws(()=>validateWorkflowSetupProposal({workflowId:'draft',setupRequestId:'request',ir:{...child,folderPath:'Other'}},draft),/outside the original selection/);
  assert.throws(()=>validateWorkflowSetupProposal({workflowId:'draft',setupRequestId:'request',ir:{...configured,scope:{...configured.scope,path:{glob:'**/*.md',case:'sensitive'}}}},draft),/outside/);
  assert.throws(()=>validateWorkflowSetupProposal({workflowId:'draft',setupRequestId:'wrong',ir:configured},draft),/another draft/);
});
