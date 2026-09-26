import {test} from 'node:test';
import assert from 'node:assert/strict';
import {folderWorkflowIR} from '../v2-folder-workflow';
import {mergeWorkflowDrafts} from '../workflow-drafts';

function draft(id:string){return folderWorkflowIR({id,name:id,folderPath:'Gym',includeSubfolders:true,events:['create'],task:'Format it.',destinationId:'qlo2-vps',projectId:'project',enabled:false,order:0});}

test('unrelated saves preserve newer remote v2 definitions and deletions',()=>{
  const first=draft('first'),second=draft('second');
  assert.deepEqual(mergeWorkflowDrafts([first],[first,second],[first]),[first,second]);
  assert.deepEqual(mergeWorkflowDrafts([first],[],[first]),[]);
});

test('a stale edit conflicts with a remote change or deletion',()=>{
  const first=draft('first'),edited={...first,revision:2,name:'local'},remote={...first,revision:2,name:'remote'};
  assert.throws(()=>mergeWorkflowDrafts([first],[remote],[edited]),/changed on another device/);
  assert.throws(()=>mergeWorkflowDrafts([first],[],[edited]),/changed on another device/);
  assert.deepEqual(mergeWorkflowDrafts([first],[first],[edited]),[edited]);
});
