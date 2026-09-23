import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {FolderWorkflow} from '../workflow';
import {loadWorkflowReplica,mergeWorkflowReplicas,workflowChanges} from '../workflow-sync';

const rule=(id:string,name=id):FolderWorkflow=>({id,name,folderPath:'Notes',includeSubfolders:true,events:['create'],task:'Format it.',connectionId:'c',projectId:'p',deviceId:'device',enabled:true});
const data=(replica:ReturnType<typeof loadWorkflowReplica>)=>({folderWorkflows:replica.workflows,workflowSync:replica.sync});

test('a stale device cannot resurrect a workflow deleted on another device',()=>{
  const original=loadWorkflowReplica({folderWorkflows:[rule('gym')]});
  const deleted=mergeWorkflowReplicas(original,original,workflowChanges(original,[]),'phone',100);
  assert.deepEqual(deleted.workflows,[]);assert.ok(deleted.sync.tombstones.gym);

  // The laptop still has the old in-memory list and is saving an unrelated setting.
  const staleSave=mergeWorkflowReplicas(original,loadWorkflowReplica(data(deleted)),workflowChanges(original,original.workflows),'laptop',200);
  assert.deepEqual(staleSave.workflows,[]);
  assert.deepEqual(staleSave.sync.tombstones.gym,deleted.sync.tombstones.gym);
});

test('concurrent additions merge and tombstones survive future edits',()=>{
  const empty=loadWorkflowReplica({});
  const phoneDesired=[rule('phone')],laptopDesired=[rule('laptop')];
  const phone=mergeWorkflowReplicas(empty,empty,workflowChanges(empty,phoneDesired),'phone',100);
  const laptop=mergeWorkflowReplicas(empty,loadWorkflowReplica(data(phone)),workflowChanges(empty,laptopDesired),'laptop',100);
  assert.deepEqual(new Set(laptop.workflows.map(item=>item.id)),new Set(['phone','laptop']));

  const withoutPhone=laptop.workflows.filter(item=>item.id!=='phone');
  const deleted=mergeWorkflowReplicas(laptop,laptop,workflowChanges(laptop,withoutPhone),'phone',200);
  const editedDesired=originalOrder(laptop).map(item=>item.id==='laptop'?rule('laptop','Renamed'):item);
  const staleEdit=mergeWorkflowReplicas(laptop,loadWorkflowReplica(data(deleted)),workflowChanges(laptop,editedDesired),'laptop',300);
  assert.deepEqual(staleEdit.workflows.map(item=>item.id),['laptop']);
  assert.equal(staleEdit.workflows[0].name,'Renamed');
  assert.ok(staleEdit.sync.tombstones.phone);
});

test('the freshly read disk value wins tied legacy records',()=>{
  const memory=loadWorkflowReplica({folderWorkflows:[rule('gym','Old')]});
  const disk=loadWorkflowReplica({folderWorkflows:[rule('gym','New')]});
  const merged=mergeWorkflowReplicas(memory,disk,workflowChanges(memory,memory.workflows),'device',100);
  assert.equal(merged.workflows[0].name,'New');
});

function originalOrder(replica:ReturnType<typeof loadWorkflowReplica>){return replica.workflows.map(item=>({...item}));}
