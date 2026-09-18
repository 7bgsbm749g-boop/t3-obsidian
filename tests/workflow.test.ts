import {test} from 'node:test';
import assert from 'node:assert/strict';
import {claimWorkflowDecision, evaluateWorkflowEvent, isPathInFolder, makeWorkflowReceipt, normalizeWorkflowLink, normalizeWorkflowTag, workflowReceiptKey, type FolderWorkflowLink} from '../workflow';

const trigger:FolderWorkflowLink={id:'one',folderPath:'Tasks/Ready',connectionId:'laptop',projectId:'project',mode:'trigger',tag:'#Build',enabled:true};

test('folder matching includes descendants but not similarly prefixed folders',()=>{
  assert.equal(isPathInFolder('Tasks/Ready/a.md','Tasks/Ready'),true);
  assert.equal(isPathInFolder('Tasks/Ready/Nested/a.md','Tasks\\Ready'),true);
  assert.equal(isPathInFolder('Tasks/Readying/a.md','Tasks/Ready'),false);
  assert.equal(isPathInFolder('Tasks/Ready','Tasks/Ready'),false);
});

test('tag workflow waits for its tag and can fire on create, move, scan, or a later edit',()=>{
  const base={path:'Tasks/Ready/a.md',noteId:'123'};
  assert.equal(evaluateWorkflowEvent({...base,kind:'create',tags:['idea']},[trigger],new Set()).length,0);
  assert.equal(evaluateWorkflowEvent({...base,kind:'create',tags:['#BUILD']},[trigger],new Set()).length,1);
  assert.equal(evaluateWorkflowEvent({...base,kind:'scan',tags:['build']},[trigger],new Set()).length,1);
  assert.equal(evaluateWorkflowEvent({...base,kind:'rename',previousPath:'Drafts/a.md',tags:['build']},[trigger],new Set()).length,1);
  assert.equal(evaluateWorkflowEvent({...base,kind:'rename',previousPath:'Tasks/Ready/old.md',tags:['build']},[trigger],new Set()).length,0);
  assert.equal(evaluateWorkflowEvent({...base,kind:'modify',tags:['parent/child','#build']},[trigger],new Set()).length,1);
});

test('persistent receipts suppress duplicate vault events and survive renames',()=>{
  const event={kind:'create' as const,path:'Tasks/Ready/a.md',noteId:'1700000000000',tags:['build']};
  const [decision]=evaluateWorkflowEvent(event,[trigger],new Set());
  const receipt=makeWorkflowReceipt(decision,event,42);
  assert.deepEqual(receipt,{key:workflowReceiptKey('one',event.noteId),linkId:'one',noteId:event.noteId,path:event.path,sentAt:42});
  assert.equal(evaluateWorkflowEvent({...event,kind:'rename',path:'Tasks/Ready/b.md',previousPath:event.path},[trigger],new Set([receipt.key])).length,0);
  assert.equal(evaluateWorkflowEvent({...event,kind:'scan'},[trigger],new Set([receipt.key])).length,0);
});

test('an in-flight reservation prevents concurrent events from sending twice',()=>{
  const event={kind:'create' as const,path:'Tasks/Ready/a.md',noteId:'n',tags:['build']};
  const [decision]=evaluateWorkflowEvent(event,[trigger],new Set());const claimed=new Set<string>();
  assert.equal(claimWorkflowDecision(decision,claimed),true);
  assert.equal(claimWorkflowDecision(decision,claimed),false);
  claimed.delete(decision.receiptKey);
  assert.equal(claimWorkflowDecision(decision,claimed),true,'a failed send may be retried');
});

test('different folder links may each send the same matching note once',()=>{
  const child={...trigger,id:'child',folderPath:'Tasks/Ready/Nested'};
  const event={kind:'create' as const,path:'Tasks/Ready/Nested/a.md',noteId:'n',tags:['build']};
  assert.deepEqual(evaluateWorkflowEvent(event,[trigger,child],new Set()).map(x=>x.link.id),['one','child']);
});

test('normalization allows only tag workflows and rejects unsafe folders or malformed tags',()=>{
  for(const path of ['','../Tasks','Tasks/../Ready']) assert.throws(()=>normalizeWorkflowLink({...trigger,folderPath:path}));
  for(const tag of ['','two tags','a#b','a,b']) assert.throws(()=>normalizeWorkflowTag(tag));
  assert.equal(normalizeWorkflowTag(' ##Ready/Nested '),'ready/nested');
  assert.equal(normalizeWorkflowLink(trigger).tag,'build');
  assert.throws(()=>normalizeWorkflowLink({...trigger,mode:'instant' as any}));
  assert.throws(()=>normalizeWorkflowLink({...trigger,mode:'agent' as any}));
  assert.equal(evaluateWorkflowEvent({kind:'create',path:'Tasks/Ready/a.png',noteId:'n',tags:['build']},[trigger],new Set()).length,0);
  assert.equal(evaluateWorkflowEvent({kind:'create',path:'Tasks/Ready/a.md',noteId:'n',tags:['build']},[{...trigger,enabled:false}],new Set()).length,0);
});
