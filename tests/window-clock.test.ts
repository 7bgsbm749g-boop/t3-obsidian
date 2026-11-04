import {test} from 'node:test';
import assert from 'node:assert/strict';
import {clockForDocument} from '../src/shared/clock';

test('two windows can share timer IDs and still cancel only their own timer',()=>{
  function owner(){
    const calls:string[]=[];const tasks=new Map<number,()=>void>();
    const window={setTimeout(callback:()=>void){calls.push('timeout');tasks.set(1,callback);return 1;},clearTimeout(id:number){calls.push('clear-timeout');tasks.delete(id);},setInterval(callback:()=>void){calls.push('interval');tasks.set(2,callback);return 2;},clearInterval(id:number){calls.push('clear-interval');tasks.delete(id);}};
    const document={defaultView:window} as unknown as Document;
    return {clock:clockForDocument(document),tasks,calls};
  }
  const first=owner(),second=owner();let firstRan=0,secondRan=0;
  const a=first.clock.setTimeout(()=>firstRan++,0),b=second.clock.setTimeout(()=>secondRan++,0);
  assert.equal(a,b);first.clock.clearTimeout(a);assert.equal(first.tasks.size,0);
  second.tasks.get(1)!();assert.equal(firstRan,0);assert.equal(secondRan,1);
  const repeat=second.clock.setInterval(()=>secondRan++,1000);second.clock.clearInterval(repeat);
  assert.deepEqual(first.calls,['timeout','clear-timeout']);assert.deepEqual(second.calls,['timeout','interval','clear-interval']);
});
