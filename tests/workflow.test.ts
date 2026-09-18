import {test} from 'node:test';
import assert from 'node:assert/strict';
import {claimWorkflowDecision, evaluateWorkflowEvent, isPathInFolder, makeWorkflowReceipt, normalizeWorkflowLink, normalizeWorkflowTag, workflowReceiptKey, type FolderWorkflowLink} from '../workflow';

const instant:FolderWorkflowLink={id:'one',folderPath:'Tasks/Ready',connectionId:'laptop',projectId:'project',mode:'instant',enabled:true};
const trigger:FolderWorkflowLink={...instant,id:'two',mode:'trigger',tag:'#Build'};

test('folder matching includes descendants but not similarly prefixed folders',()=>{
  assert.equal(isPathInFolder('Tasks/Ready/a.md','Tasks/Ready'),true);
  assert.equal(isPathInFolder('Tasks/Ready/Nested/a.md','Tasks\\Ready'),true);
  assert.equal(isPathInFolder('Tasks/Readying/a.md','Tasks/Ready'),false);
  assert.equal(isPathInFolder('Tasks/Ready','Tasks/Ready'),false);
});

test('instant mode sends creates, moves, scans, or a debounced first edit until receipted',()=>{
  const base={path:'Tasks/Ready/a.md',noteId:'123'};
  for(const kind of ['create','scan'] as const) assert.equal(evaluateWorkflowEvent({...base,kind},[instant],new Set()).length,1);
  assert.equal(evaluateWorkflowEvent({...base,kind:'rename',previousPath:'Drafts/a.md'},[instant],new Set()).length,1);
  assert.equal(evaluateWorkflowEvent({...base,kind:'rename',previousPath:'Tasks/Ready/old.md'},[instant],new Set()).length,0);
  assert.equal(evaluateWorkflowEvent({...base,kind:'modify'},[instant],new Set()).length,1);
});

test('trigger mode waits for its tag and can fire when an edit first adds it',()=>{
  const base={path:'Tasks/Ready/a.md',noteId:'123'};
  assert.equal(evaluateWorkflowEvent({...base,kind:'create',tags:['idea']},[trigger],new Set()).length,0);
  assert.equal(evaluateWorkflowEvent({...base,kind:'modify',tags:['#BUILD']},[trigger],new Set()).length,1);
  assert.equal(evaluateWorkflowEvent({...base,kind:'create',tags:['parent/child','#build']},[trigger],new Set()).length,1);
});

test('persistent receipts suppress duplicate vault events and survive renames',()=>{
  const event={kind:'create' as const,path:'Tasks/Ready/a.md',noteId:'1700000000000'};
  const [decision]=evaluateWorkflowEvent(event,[instant],new Set());
  const receipt=makeWorkflowReceipt(decision,event,42);
  assert.deepEqual(receipt,{key:workflowReceiptKey('one',event.noteId),linkId:'one',noteId:event.noteId,path:event.path,sentAt:42});
  assert.equal(evaluateWorkflowEvent({...event,kind:'rename',path:'Tasks/Ready/b.md',previousPath:event.path},[instant],new Set([receipt.key])).length,0);
  assert.equal(evaluateWorkflowEvent({...event,kind:'scan'},[instant],new Set([receipt.key])).length,0);
});

test('an in-flight reservation prevents concurrent events from sending twice',()=>{
  const event={kind:'create' as const,path:'Tasks/Ready/a.md',noteId:'n'};
  const [decision]=evaluateWorkflowEvent(event,[instant],new Set());const claimed=new Set<string>();
  assert.equal(claimWorkflowDecision(decision,claimed),true);
  assert.equal(claimWorkflowDecision(decision,claimed),false);
  claimed.delete(decision.receiptKey);
  assert.equal(claimWorkflowDecision(decision,claimed),true,'a failed send may be retried');
});

test('different folder links may each send the same note once',()=>{
  const child={...instant,id:'child',folderPath:'Tasks/Ready/Nested'};
  const event={kind:'create' as const,path:'Tasks/Ready/Nested/a.md',noteId:'n'};
  assert.deepEqual(evaluateWorkflowEvent(event,[instant,child],new Set()).map(x=>x.link.id),['one','child']);
});

test('normalization rejects unsafe folders and malformed tags; disabled and non-Markdown files are ignored',()=>{
  for(const path of ['','../Tasks','Tasks/../Ready']) assert.throws(()=>normalizeWorkflowLink({...instant,folderPath:path}));
  for(const tag of ['','two tags','a#b','a,b']) assert.throws(()=>normalizeWorkflowTag(tag));
  assert.equal(normalizeWorkflowTag(' ##Ready/Nested '),'ready/nested');
  assert.equal(normalizeWorkflowLink(trigger).tag,'build');
  assert.throws(()=>normalizeWorkflowLink({...instant,mode:'agent' as any}));
  assert.equal(evaluateWorkflowEvent({kind:'create',path:'Tasks/Ready/a.md',noteId:'n',tags:['bad tag','#build']},[trigger],new Set()).length,1);
  assert.equal(evaluateWorkflowEvent({kind:'create',path:'Tasks/Ready/a.png',noteId:'n'},[instant],new Set()).length,0);
  assert.equal(evaluateWorkflowEvent({kind:'create',path:'Tasks/Ready/a.md',noteId:'n'},[{...instant,enabled:false}],new Set()).length,0);
});
