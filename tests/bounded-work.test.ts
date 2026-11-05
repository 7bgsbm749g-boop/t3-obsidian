import {test} from 'node:test';
import assert from 'node:assert/strict';
import {forEachBounded} from '../src/shared/bounded-work';
test('connection setup stays bounded while independent ready machines can finish before a stalled peer',async()=>{
 let release!:()=>void,active=0,max=0;const stalled=new Promise<void>(resolve=>release=resolve),finished:number[]=[];
 const work=forEachBounded([0,1,2,3,4,5],2,async index=>{active++;max=Math.max(max,active);if(index===0)await stalled;else await new Promise(resolve=>setImmediate(resolve));finished.push(index);active--;});
 for(let i=0;i<15;i++)await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(finished,[1,2,3,4,5]);assert.equal(max,2);release();await work;assert.equal(finished.at(-1),0);
});
