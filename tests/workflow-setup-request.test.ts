import {test} from 'node:test';
import assert from 'node:assert/strict';
import {folderWorkflowIR} from '../v2-folder-workflow';
import {workflowSetupPath,workflowSetupPrompt,validateWorkflowSetupProposal} from '../workflow-setup-request';

test('setup prompt pins one disabled workflow and its proposal path',()=>{
  const draft={...folderWorkflowIR({id:'draft',name:'Draft',folderPath:'Gym',includeSubfolders:true,events:['create','modify'],task:'Summarize the session.',destinationId:'qlo2-vps',projectId:'project',enabled:false,order:0}),setupIntent:'After I finish a gym note, summarize it.',setupRequestId:'request'};
  const prompt=workflowSetupPrompt({intent:draft.setupIntent,folderPath:'Gym',vaultRoot:'/vault',proposalPath:`/vault/${workflowSetupPath(draft)}`,draft});
  assert.match(prompt,/Workflow ID: "draft"/);
  assert.match(prompt,/T3 Workflow Setup\/draft-request.json/);
  assert.match(prompt,/Do not edit plugin data.json/);
  assert.match(prompt,/After I finish a gym note/);
  assert.throws(()=>workflowSetupPrompt({intent:'x',folderPath:'Other',vaultRoot:'/vault',proposalPath:'/vault/proposal.json',draft}),/disabled draft/);
  const configured={...draft,revision:2,enabled:true,trigger:{eventTypes:['note.changed' as const],unknown:'hold-for-review' as const}};
  assert.equal(validateWorkflowSetupProposal({workflowId:'draft',setupRequestId:'request',ir:configured},draft).enabled,true);
  assert.throws(()=>validateWorkflowSetupProposal({workflowId:'draft',setupRequestId:'request',ir:{...configured,scope:{...configured.scope,path:{glob:'**/*.md',case:'sensitive'}}}},draft),/outside/);
  assert.throws(()=>validateWorkflowSetupProposal({workflowId:'draft',setupRequestId:'wrong',ir:configured},draft),/another draft/);
});
