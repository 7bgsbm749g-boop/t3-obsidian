import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LeaseRecordCache} from '../lease-record-cache';

const raw=JSON.stringify({request:{id:'one',notePath:'Original.md'},revision:1,state:{body:'reply',hashes:['original'],delivery:{observedBy:['actor']}}});
test('unchanged discovery bytes reuse immutable snapshots; changed bytes bypass even the same revision',()=>{
  const cache=new LeaseRecordCache(),first=cache.read('one',raw);
  for(let i=0;i<100;i++)assert.equal(cache.read('one',raw),first);
  assert.equal(cache.status().parses,1);assert.equal(cache.status().hits,100);
  assert.throws(()=>{first.state!.body='changed';},TypeError);
  assert.throws(()=>{first.state!.delivery!.observedBy.push('other');},TypeError);
  const changed=cache.read('one',raw.replace('reply','fresh reply'));
  assert.equal(changed.revision,1);assert.equal(changed.state!.body,'fresh reply');assert.notEqual(changed,first);
  assert.throws(()=>cache.read('one','{bad'),SyntaxError);
  assert.equal(cache.status().entries,0);assert.equal(cache.read('one',raw).state!.body,'reply');
});
test('discovery snapshots have count, source-size and object bounds and remove absent files',()=>{
  const cache=new LeaseRecordCache(raw.length*2,2,100);
  cache.read('one',raw);cache.read('two',raw);cache.read('three',raw);
  assert.equal(cache.status().entries,2);assert.ok(cache.status().characters<=raw.length*2);
  cache.retain(new Set(['one']));assert.equal(cache.status().entries,1);
  cache.read('huge',JSON.stringify({state:{body:'x'.repeat(raw.length*3)}}));assert.equal(cache.status().entries,1);
  const objects=new LeaseRecordCache(10000,10,3);
  objects.read('nested',JSON.stringify({state:{a:{b:{c:{}}}}}));assert.equal(objects.status().entries,0);
  cache.clear();assert.equal(cache.status().entries,0);assert.equal(cache.status().characters,0);assert.equal(cache.status().objects,0);
});
test('large nested JSON collections remain safe to freeze without argument-stack expansion',()=>{
  const cache=new LeaseRecordCache(),value=cache.read('large',JSON.stringify({state:{hashes:Array(150000).fill('hash')}}));
  assert.equal(value.state!.hashes.length,150000);assert.ok(Object.isFrozen(value.state!.hashes));
});

test('default discovery budget fits 600 large records across repeated directory scans',()=>{
  const cache=new LeaseRecordCache(),rows=Array.from({length:600},(_,i)=>JSON.stringify({request:{id:String(i)},revision:1,state:{body:'Retained response '.repeat(1200)}}));
  for(let scan=0;scan<4;scan++)for(let i=0;i<rows.length;i++)cache.read(String(i),rows[i]);
  assert.equal(cache.status().parses,600);assert.equal(cache.status().hits,1800);assert.equal(cache.status().entries,600);
  assert.ok(cache.status().characters<=cache.status().maxCharacters);assert.ok(cache.status().objects<=cache.status().maxObjects);
  const changed=cache.read('599',rows[599].replace('Retained response','Fresh response'));assert.ok(changed.state!.body!.startsWith('Fresh response'));assert.equal(cache.status().parses,601);
});
test('oversized sequential discovery scans preserve admitted snapshots instead of thrashing every entry',()=>{
  const cache=new LeaseRecordCache(raw.length*2,2,100);const resident=cache.read('resident',raw);cache.read('second',raw);
  for(let scan=0;scan<10;scan++){for(let i=0;i<100;i++)cache.read('cold-'+i,raw);assert.equal(cache.read('resident',raw),resident);}
  assert.equal(cache.status().hits,10);assert.equal(cache.status().entries,2);assert.equal(cache.status().characters,raw.length*2);
  cache.retain(new Set(['resident']));cache.read('new',raw);assert.equal(cache.status().entries,2);assert.equal(cache.read('resident',raw),resident);
});
