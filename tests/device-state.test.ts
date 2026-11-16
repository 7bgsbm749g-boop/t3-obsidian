import {test} from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {deviceState,writeDeviceStates,deleteDeviceState,retainDeviceState} from '../src/storage/device-state';
import {sharedStateDatabase,closeSharedStateDatabase} from '../src/storage/local-state';

function setup(t:import('node:test').TestContext){
  closeSharedStateDatabase();globalThis.indexedDB=new IDBFactory();
  t.after(()=>closeSharedStateDatabase());
}
test('concurrent device operations reuse one connection and retain independent checkpoints',async t=>{
  setup(t);let opens=0;
  const open=indexedDB.open.bind(indexedDB);t.mock.method(indexedDB,'open',(...args:Parameters<typeof indexedDB.open>)=>{opens++;return open(...args);});
  await Promise.all([deviceState('pending',{phase:'prepared'}),deviceState('other-device',{pending:[]})]);
  assert.equal(opens,1);
  assert.deepEqual(await deviceState('pending'),{phase:'prepared'});
  await deviceState('pending',{phase:'created'});
  closeSharedStateDatabase();
  assert.deepEqual(await deviceState('pending'),{phase:'created'});
  assert.deepEqual(await deviceState('other-device'),{pending:[]});assert.equal(opens,2);
});
test('batched replicas commit together and a clone failure rolls back all earlier puts',async t=>{
  setup(t);
  await writeDeviceStates([['bindings',{destinations:['First.md','Second.md']}],['history',{revision:1}]]);
  await assert.rejects(writeDeviceStates([['bindings',{destinations:[]}],['history',()=>{}]]),/clone|cloned/i);
  closeSharedStateDatabase();
  assert.deepEqual(await deviceState('bindings'),{destinations:['First.md','Second.md']});
  assert.deepEqual(await deviceState('history'),{revision:1});
  await deleteDeviceState('bindings');assert.equal(await deviceState('bindings'),undefined);
});
test('aborted durable checkpoints reject and do not erase the last replayable command',async t=>{
  setup(t);await deviceState('pending',{phase:'prepared',messageId:'stable'});
  const db=await sharedStateDatabase(),transaction=db.transaction.bind(db);
  t.mock.method(db,'transaction',(...args:Parameters<typeof db.transaction>)=>{
    const tx=transaction(...args);queueMicrotask(()=>tx.abort());return tx;
  });
  await assert.rejects(deviceState('pending',{phase:'started'}),/storage|requests/);
  t.mock.restoreAll();closeSharedStateDatabase();
  assert.deepEqual(await deviceState('pending'),{phase:'prepared',messageId:'stable'});
});
test('version changes release the shared connection and failed opens can retry',async t=>{
  setup(t);await deviceState('retained',{id:'same-command'});
  const upgrade=indexedDB.open('send-to-t3-code',4);
  await new Promise<void>((resolve,reject)=>{upgrade.onsuccess=()=>{upgrade.result.close();resolve();};upgrade.onerror=()=>reject(upgrade.error);upgrade.onblocked=()=>reject(Error('Shared connection blocked upgrade'));});
  await assert.rejects(deviceState('retained'),/open local/);
  // Simulate a new installation/renderer after the failed versioned open.
  globalThis.indexedDB=new IDBFactory();
  await deviceState('new',{phase:'prepared'});assert.deepEqual(await deviceState('new'),{phase:'prepared'});
});

test('closing with a live transaction preserves its final save and unrelated opaque settings',async t=>{
  setup(t);const db=await sharedStateDatabase();
  const transaction=db.transaction('devices','readwrite');
  const complete=new Promise<void>((resolve,reject)=>{transaction.oncomplete=()=>resolve();transaction.onabort=()=>reject(transaction.error);});
  transaction.objectStore('devices').put({pending:[],unknown:{nested:['preserve',7]}},'final');
  closeSharedStateDatabase();await complete;
  assert.deepEqual(await deviceState('final'),{pending:[],unknown:{nested:['preserve',7]}});
});

test('shared storage retains bounded private journals without pruning pending work or other owners',async t=>{
  setup(t);const limits={records:1,bytes:4096,ttl:1000};
  await deviceState('other-task',{unknownSetting:{keep:true}});
  await retainDeviceState('journal','pending',{messageId:'same'},limits,true);
  await assert.rejects(retainDeviceState('journal','next',{messageId:'next'},limits),/storage is full/);
  closeSharedStateDatabase();
  assert.deepEqual(await deviceState('journal:pending'),{messageId:'same'});
  assert.equal(await deviceState('journal:next'),undefined);
  assert.deepEqual(await deviceState('other-task'),{unknownSetting:{keep:true}});
});
