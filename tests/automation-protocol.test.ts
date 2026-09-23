import {test,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {advanceAcknowledgement,createRecord,observationPath,validateRecord,workflowRequestId,type ObservationPayload} from '../automation-protocol';
import {AutomationStore} from '../automation-store';

beforeEach(()=>{globalThis.indexedDB=new IDBFactory();});
const payload:ObservationPayload={observationId:'o',source:'vault.modify',note:{noteId:'n',incarnationId:'i',pathBefore:'A.md',pathAfter:'A.md'},revisionContext:{id:'r',parentIds:[],beforeHash:null,afterHash:'sha256:a',hashProfile:'utf8-exact-v1'},provenance:{attribution:'unknown',causedByOperationId:null},historyComplete:false};
test('protocol records are canonical, validated, and immutable-path safe',()=>{
  const record=createRecord({recordId:'record',recordType:'observation' as const,vaultId:'vault',writer:{deviceId:'device',streamId:'stream',sequence:1,previousRecordHash:null},recordedAt:'2026-01-01T00:00:00.000Z',payload});
  assert.equal(validateRecord(JSON.parse(JSON.stringify(record))).recordId,'record');assert.match(observationPath(record),/^T3 Automation\/observations\/device\/stream\/0+1-record\.json$/);
  assert.throws(()=>validateRecord({...record,payload:{...payload,historyComplete:true}}),/hash mismatch/);
  assert.throws(()=>observationPath({...record,writer:{...record.writer,deviceId:'../escape'}}),/Unsafe/);
});
test('acknowledgements retain gaps and advance only through contiguous records',()=>{
  assert.deepEqual(advanceAcknowledgement({through:2,gaps:[]},[5,3]),{through:3,gaps:[5]});
  assert.deepEqual(advanceAcknowledgement({through:3,gaps:[5]},[4]),{through:5,gaps:[]});
});
test('workflow request identity is stable across retries and changes for deliberate reruns',()=>{
  const parts=['v','d','o','w','sha256:r','step'] as const,a=workflowRequestId(...parts,0);assert.equal(a,workflowRequestId(...parts,0));assert.notEqual(a,workflowRequestId(...parts,1));
});
test('sequence allocation, record insertion, and outbox insertion are one transaction',async()=>{
  const store=new AutomationStore('vault','device','stream'),ids=['record-1','record-2'];
  const a=await store.appendObservation({...payload,observationId:'one'},observationPath,'2026-01-01T00:00:00.000Z',()=>ids.shift()!);
  const b=await store.appendObservation({...payload,observationId:'two'},observationPath,'2026-01-01T00:00:01.000Z',()=>ids.shift()!);
  assert.equal(a.writer.sequence,1);assert.equal(b.writer.sequence,2);assert.ok(b.writer.previousRecordHash);assert.deepEqual((await store.outbox()).map(x=>x.recordId),['record-1','record-2']);
});
