import {test} from 'node:test';
import assert from 'node:assert/strict';
import {subscribeToReleases} from '../src/app/release-stream';

test('reconnect, heartbeat timeout, bounded verification and unload', async t=>{
  const sources:Stream[]=[];
  class Stream {
    closed=false;
    onmessage?:(event:{data:string})=>void;
    onerror?:()=>void;
    constructor(){sources.push(this);}
    addEventListener(_type:string,callback:()=>void){this.heartbeat=callback;}
    heartbeat=()=>{};
    close(){this.closed=true;}
  }
  let job:(()=>void)|undefined;
  let delay=0;
  const timers={
    setTimeout(callback:()=>void,ms:number){assert.equal(job,undefined);job=callback;delay=ms;return 1;},
    clearTimeout(){job=undefined;}
  };
  for(const [key,value] of Object.entries({EventSource:Stream,window:timers})){
    const previous=Object.getOwnPropertyDescriptor(globalThis,key);
    Object.defineProperty(globalThis,key,{configurable:true,value});
    t.after(()=>{if(previous)Object.defineProperty(globalThis,key,previous);else Reflect.deleteProperty(globalThis,key);});
  }
  function fire(){const pending=job;job=undefined;assert.ok(pending);pending();}
  let checks=0,fallback=0;
  const stop=subscribeToReleases(async version=>{checks++;return version==='0.0.2';},()=>{fallback++;});
  sources[0].heartbeat();assert.equal(delay,75000);fire();
  assert.ok(sources[0].closed);assert.equal(fallback,1);fire();
  sources[1].onerror!();assert.equal(fallback,1);fire();
  for(let attempt=0;attempt<3;attempt++){
    sources.at(-1)!.onmessage!({data:'0.0.1'});await Promise.resolve();
    if(attempt<2)fire();
  }
  assert.equal(checks,3);assert.equal(delay,75000);
  sources.at(-1)!.onmessage!({data:'0.0.1'});assert.equal(checks,3);
  sources.at(-1)!.onmessage!({data:'0.0.2'});await Promise.resolve();assert.equal(checks,4);
  sources[0].onerror!();assert.equal(delay,75000);
  sources.at(-1)!.onerror!();assert.ok(delay<2000);stop();assert.equal(job,undefined);
});
