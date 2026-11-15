import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {clockForDocument} from '../src/shared/clock';

test('clearing an unstarted browser timer does not invoke a fallback with the wrong receiver',()=>{
  const calls:number[]=[];
  const browser={setTimeout(){return 1;},setInterval(){return 2;},clearTimeout(id:number){assert.equal(this,browser);calls.push(id);},clearInterval(id:number){assert.equal(this,browser);calls.push(id);}};
  const clock=clockForDocument({defaultView:browser} as unknown as Document);
  const timeout=mock.method(globalThis,'clearTimeout',function(){throw new TypeError('Illegal invocation');});
  const interval=mock.method(globalThis,'clearInterval',function(){throw new TypeError('Illegal invocation');});
  try{
    clock.clearTimeout(undefined);clock.clearInterval(undefined);assert.deepEqual(calls,[]);
    clock.clearTimeout(1);clock.clearInterval(2);assert.deepEqual(calls,[1,2]);
  }finally{timeout.mock.restore();interval.mock.restore();}
});

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
