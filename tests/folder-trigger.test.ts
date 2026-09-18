import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isPathInFolder,loadFolderTriggerState,makeTriggerReceipt,matchFolderTriggers,normalizeFolderTrigger,normalizeTriggerTag,triggerReceiptKey,type FolderTrigger} from '../folder-trigger-model';

const trigger:FolderTrigger={id:'one',folderPath:'Tasks/Ready',connectionId:'laptop',projectId:'project',tag:'#Build',enabled:true};

test('folder matching includes descendants but not similarly prefixed folders',()=>{
  assert.equal(isPathInFolder('Tasks/Ready/a.md','Tasks/Ready'),true);
  assert.equal(isPathInFolder('Tasks/Ready/Nested/a.md','Tasks\\Ready'),true);
  assert.equal(isPathInFolder('Tasks/Readying/a.md','Tasks/Ready'),false);
  assert.equal(isPathInFolder('Tasks/Ready','Tasks/Ready'),false);
});

test('folder trigger waits for its tag and can fire on create, move, scan, or a later edit',()=>{
  const base={path:'Tasks/Ready/a.md',noteId:'123'};
  assert.equal(matchFolderTriggers({...base,kind:'create',tags:['idea']},[trigger],new Set()).length,0);
  assert.equal(matchFolderTriggers({...base,kind:'create',tags:['#BUILD']},[trigger],new Set()).length,1);
  assert.equal(matchFolderTriggers({...base,kind:'scan',tags:['build']},[trigger],new Set()).length,1);
  assert.equal(matchFolderTriggers({...base,kind:'rename',previousPath:'Drafts/a.md',tags:['build']},[trigger],new Set()).length,1);
  assert.equal(matchFolderTriggers({...base,kind:'rename',previousPath:'Tasks/Ready/old.md',tags:['build']},[trigger],new Set()).length,0);
  assert.equal(matchFolderTriggers({...base,kind:'modify',tags:['parent/child','#build']},[trigger],new Set()).length,1);
});

test('persistent receipts suppress duplicate events and survive renames',()=>{
  const event={kind:'create' as const,path:'Tasks/Ready/a.md',noteId:'1700000000000',tags:['build']};
  const [match]=matchFolderTriggers(event,[trigger],new Set());
  const receipt=makeTriggerReceipt(match,event,42);
  assert.deepEqual(receipt,{key:triggerReceiptKey('one',event.noteId),triggerId:'one',noteId:event.noteId,path:event.path,sentAt:42});
  assert.equal(matchFolderTriggers({...event,kind:'rename',path:'Tasks/Ready/b.md',previousPath:event.path},[trigger],new Set([receipt.key])).length,0);
  assert.equal(matchFolderTriggers({...event,kind:'scan'},[trigger],new Set([receipt.key])).length,0);
});

test('different folder triggers may each send the same matching note once',()=>{
  const child={...trigger,id:'child',folderPath:'Tasks/Ready/Nested'};
  const event={kind:'create' as const,path:'Tasks/Ready/Nested/a.md',noteId:'n',tags:['build']};
  assert.deepEqual(matchFolderTriggers(event,[trigger,child],new Set()).map(x=>x.trigger.id),['one','child']);
});

test('normalization rejects unsafe folders and malformed tags',()=>{
  for(const path of ['','../Tasks','Tasks/../Ready'])assert.throws(()=>normalizeFolderTrigger({...trigger,folderPath:path}));
  for(const tag of ['','two tags','a#b','a,b'])assert.throws(()=>normalizeTriggerTag(tag));
  assert.equal(normalizeTriggerTag(' ##Ready/Nested '),'ready/nested');
  assert.equal(normalizeFolderTrigger(trigger).tag,'build');
  assert.equal(matchFolderTriggers({kind:'create',path:'Tasks/Ready/a.png',noteId:'n',tags:['build']},[trigger],new Set()).length,0);
  assert.equal(matchFolderTriggers({kind:'create',path:'Tasks/Ready/a.md',noteId:'n',tags:['build']},[{...trigger,enabled:false}],new Set()).length,0);
});

test('migration keeps tag rules and removes obsolete workflow modes and orphan receipts',()=>{
  const data={workflowLinks:[{...trigger,mode:'trigger'},{...trigger,id:'old',mode:'instant'}],workflowReceipts:[{key:'one:n',linkId:'one',noteId:'n',path:'Tasks/Ready/a.md',sentAt:1},{key:'old:n',linkId:'old',noteId:'n',path:'x.md',sentAt:1}]};
  assert.deepEqual(loadFolderTriggerState(data),{triggers:[{...trigger,tag:'build'}],receipts:[{key:'one:n',triggerId:'one',noteId:'n',path:'Tasks/Ready/a.md',sentAt:1}]});
});
