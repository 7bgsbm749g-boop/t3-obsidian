import test from 'node:test';
import assert from 'node:assert/strict';
import {installCodebaseAdapter} from '../codebase-adapter';
import {CODEBASE_PREFIX} from '../codebase-core';

test('reloads reuse one guard, release old handlers, and preserve physical adapter calls',()=>{
  const physical:any[]=[],adapter={read(path:string){physical.push({owner:this,path});return 'physical';},write(path:string,text:string){physical.push({owner:this,path,text});}};
  const virtual=CODEBASE_PREFIX+'file.md';let calls=0;
  const first=installCodebaseAdapter(adapter,()=>{calls++;return 'first';}),read=adapter.read,write=adapter.write;
  assert.equal(adapter.read(virtual),'first');first();
  assert.throws(()=>adapter.write(virtual,'late old save'),/stopped/);
  for(let n=0;n<10;n++){
    const release=installCodebaseAdapter(adapter,(method,path,args)=>{calls++;return [method,path,...args].join(':');});
    assert.equal(adapter.read,read);assert.equal(adapter.write,write);
    assert.equal(adapter.read(virtual),'read:'+virtual);
    adapter.write('Physical.md','ordinary');release();
  }
  assert.equal(calls,11);assert.equal(physical.length,10);assert.ok(physical.every(call=>call.owner===adapter));
  assert.equal(adapter.read('Physical.md'),'physical');assert.throws(()=>adapter.read(virtual),/stopped/);
});

test('a late old unload cannot detach a newer installed bridge',()=>{
  const adapter={read:(_path:string)=> 'physical'},first=installCodebaseAdapter(adapter,()=> 'old'),second=installCodebaseAdapter(adapter,()=> 'current');
  first();assert.equal(adapter.read(CODEBASE_PREFIX+'file.md'),'current');second();assert.throws(()=>adapter.read(CODEBASE_PREFIX+'file.md'),/stopped/);
});
