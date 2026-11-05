import {test} from 'node:test';
import assert from 'node:assert/strict';
import {indexedDB} from 'fake-indexeddb';
import {randomUUID} from 'node:crypto';
import {deviceState,retainDeviceState} from '../src/storage/device-state';
Object.assign(globalThis,{indexedDB});
test('concurrent private records share one atomic index and storage limits fail without partial writes',async()=>{
 const prefix='retention-'+randomUUID(),limits={records:2,bytes:1000,ttl:100000};await Promise.all(['a','b'].map(id=>retainDeviceState(prefix,id,{id},limits)));
 assert.equal((await deviceState<any[]>(prefix+':index'))?.length,2);await assert.rejects(retainDeviceState(prefix,'c',{},limits),/full/);assert.equal(await deviceState(prefix+':c'),undefined);assert.equal((await deviceState<any[]>(prefix+':index'))?.length,2);
});
test('pending edits survive expiry while completed records make room for new ones',async()=>{
 const prefix='retention-'+randomUUID(),limits={records:2,bytes:1000,ttl:0};await retainDeviceState(prefix,'pending',{status:'submitted'},limits,true);await retainDeviceState(prefix,'finished',{status:'saved'},limits);await new Promise(resolve=>setTimeout(resolve,2));await retainDeviceState(prefix,'new',{},limits);assert.deepEqual(await deviceState(prefix+':pending'),{status:'submitted'});assert.equal(await deviceState(prefix+':finished'),undefined);assert.equal((await deviceState<any[]>(prefix+':index'))?.length,2);
});
