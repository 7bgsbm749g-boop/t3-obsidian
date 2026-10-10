import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {indexedDB,IDBObjectStore} from 'fake-indexeddb';
import {nativeStoppedStore} from '../native-stop-store';
import {deviceState} from '../device-state';
import {contentHash} from '../completion';

globalThis.indexedDB=indexedDB;
function fixture(){
  const device=randomUUID(),vault=randomUUID(),id=randomUUID(),prefix=`native-stop:${device}:${vault}:`,stop={id,path:'Synthetic.md',body:'Preserved tool output '.repeat(4000),hidden:false};
  return {device,vault,stop,indexKey:prefix+'index',bodyKey:prefix+`body:${id}:${contentHash(stop.body)}`,store:nativeStoppedStore(device,vault)};
}

test('frozen body and tiny index survive a new store instance and identical body bytes are written only once',async()=>{
  const h=fixture(),put=IDBObjectStore.prototype.put;let bodyWrites=0;
  IDBObjectStore.prototype.put=function(value:any,key?:IDBValidKey){if(key===h.bodyKey)bodyWrites++;return put.call(this,value,key);};
  try{await h.store.write(h.stop);await h.store.write({...h.stop,path:'Moved.md'});}
  finally{IDBObjectStore.prototype.put=put;}
  assert.equal(bodyWrites,1);assert.deepEqual(await nativeStoppedStore(h.device,h.vault).readAll(),[{...h.stop,path:'Moved.md'}]);
  const index=await deviceState(h.indexKey);assert.ok(JSON.stringify(index).length<512);assert.doesNotMatch(JSON.stringify(index),/Preserved tool output/);assert.equal(index.entries[0].hash,contentHash(h.stop.body));assert.equal(index.entries[0].length,h.stop.body.length);
});

test('an index-write failure aborts both the new body and its index, then a retry restores the complete record',async()=>{
  const h=fixture(),put=IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put=function(value:any,key?:IDBValidKey){if(key===h.indexKey)throw Error('Synthetic index write failure');return put.call(this,value,key);};
  try{await assert.rejects(h.store.write(h.stop),/Synthetic index write failure/);}
  finally{IDBObjectStore.prototype.put=put;}
  assert.equal(await deviceState(h.indexKey),undefined);assert.equal(await deviceState(h.bodyKey),undefined);assert.deepEqual(await h.store.readAll(),[]);
  await h.store.write(h.stop);assert.deepEqual(await h.store.readAll(),[h.stop]);
});

test('a missing or changed retained body blocks restore and keeps the index available for recovery',async()=>{
  const h=fixture();await h.store.write(h.stop);const index=await deviceState(h.indexKey);await deviceState(h.bodyKey,'Changed body');
  await assert.rejects(h.store.readAll(),/body needs recovery/);assert.deepEqual(await deviceState(h.indexKey),index);assert.equal(await deviceState(h.bodyKey),'Changed body');
});
