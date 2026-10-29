import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {indexedDB,IDBObjectStore} from 'fake-indexeddb';
import {NativeResponseManager} from '../native-response-manager';
import {responseAnchor} from '../native-response-projection';
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

test('index lookup, selective restore, and closed-note rename never read unrelated bodies',async()=>{
  const h=fixture(),other={...h.stop,id:randomUUID(),path:'Other.md',body:'Other frozen output'};
  await h.store.write(h.stop);await h.store.write(other);
  await deviceState(h.bodyKey,'Corrupt unrelated historical body');
  assert.deepEqual((await h.store.list!()).map(stop=>stop.id).sort(),[h.stop.id,other.id].sort());
  assert.deepEqual(await h.store.readAll([other.id]),[other]);
  await h.store.relocate!('Other.md','Moved/Other.md');
  assert.equal((await h.store.list!()).find(stop=>stop.id===other.id)!.path,'Moved/Other.md');
  assert.deepEqual(await h.store.readAll([other.id]),[{...other,path:'Moved/Other.md'}]);
  await assert.rejects(h.store.readAll([h.stop.id]),/body needs recovery/);
});

test('the manager loads only open stopped anchors and releases bodies on close, completion, deletion, and unload',async()=>{
  const h=fixture(),other={...h.stop,id:randomUUID(),path:'Other.md',body:'Historical closed reply'};
  await h.store.write(h.stop);await h.store.write(other);
  let leaves:any[]=[];const makeView=(stop:typeof h.stop)=>{let text=responseAnchor(stop.id);return {file:{path:stop.path},getMode:()=> 'preview',getViewData:()=>text,setViewData:(value:string)=>{text=value;},requestSave(){},save:async()=>{}};};
  const existing=new Set([h.stop.path,other.path]),app:any={loadLocalStorage:()=>undefined,saveLocalStorage(){},workspace:{getLeavesOfType:()=>leaves},vault:{getFileByPath:(path:string)=>existing.has(path)?{path}:null}};
  const reads:string[][]=[],store={...h.store,readAll:async(ids?:readonly string[])=>{reads.push([...(ids??[])]);return h.store.readAll(ids);}};
  const manager=new NativeResponseManager(app);manager.configurePreviewCache(h.vault,undefined,async()=>{});await manager.configureStoppedStore(store);
  assert.deepEqual(reads,[]);assert.equal(manager.stoppedBody(h.stop.id),undefined);assert.equal(manager.stoppedBody(other.id),undefined);
  const view=makeView(h.stop);leaves=[{view}];manager.refresh();for(let n=0;n<12;n++)await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(reads,[[h.stop.id]]);assert.equal(manager.stoppedBody(h.stop.id),h.stop.body);
  leaves=[];manager.refresh();assert.equal(manager.stoppedBody(h.stop.id),undefined);
  const nextView=makeView(h.stop);leaves=[{view:nextView}];manager.refresh();for(let n=0;n<12;n++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(manager.stoppedBody(h.stop.id),h.stop.body);
  nextView.setViewData('Verified frozen text');manager.localCompleted(h.stop.id,h.stop.path);assert.equal(manager.stoppedBody(h.stop.id),undefined);
  const deletedView=makeView(other);leaves=[{view:deletedView}];existing.delete(other.path);manager.deleted(other.path);manager.refresh();for(let n=0;n<12;n++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(manager.stoppedBody(other.id),undefined,'a stale pane cannot reload a deleted note body');assert.deepEqual(reads,[[h.stop.id],[h.stop.id]]);
  manager.dispose();assert.equal(manager.stoppedBody(other.id),undefined);
  assert.equal((await h.store.readAll([h.stop.id]))[0].body,h.stop.body,'durable recovery text survives memory cleanup');
});
