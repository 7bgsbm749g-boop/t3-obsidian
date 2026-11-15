import {test} from 'node:test';
import assert from 'node:assert/strict';
import {StreamMemoryDiagnostics,readJSHeap,safeMemoryFields,MEMORY_CHECKPOINTS_PER_INTERVAL} from '../src/app/stream-memory-diagnostics';
import {EventJournal,configureDiagnostics,connectionDiagnosticPolicy,diagnosticCategory,diagnosticPreferences} from '../src/app/diagnostics';
import {validateClientCommand} from '../src/app/client-command';

test('off performs no clock, heap, supplier or emission work; throttle runs before suppliers',()=>{
  let enabled=false,time=0,reads=0;const events:any[]=[];
  const sampler=new StreamMemoryDiagnostics(()=>enabled,event=>events.push(event),()=>{reads++;return time;},()=>{reads++;return {status:'unsupported'};});
  const fields=()=>{reads++;return {bodyLength:123,text:'PRIVATE'};};
  for(let i=0;i<1000;i++)sampler.sample('sample',fields);assert.equal(reads,0);
  enabled=true;assert.equal(sampler.sample('start',fields),true);const before=reads;
  for(let i=0;i<1000;i++)sampler.sample('sample',fields);assert.equal(reads,before+1000);assert.equal(events.length,1);
  time=5000;sampler.sample('sample',fields);assert.equal(events.length,2);assert.equal(events[1].bodyLength,123);assert.equal(events[1].text,undefined);
  enabled=false;const stopped=reads;sampler.sample('dispose',fields);assert.equal(reads,stopped);
});
test('lifecycle bursts are capped independently of stream IDs; reset retains no suppliers',()=>{
  let time=0;const events:any[]=[];const sampler=new StreamMemoryDiagnostics(()=>true,event=>events.push(event),()=>time,()=>({status:'unsupported'}));
  for(let i=0;i<1000;i++)sampler.sample('view-close',()=>({bindingId:String(i),viewCount:0}));
  assert.equal(events.length,MEMORY_CHECKPOINTS_PER_INTERVAL);time=5000;sampler.sample('dispose');assert.equal(events.at(-1).skippedCheckpoints,1000-MEMORY_CHECKPOINTS_PER_INTERVAL);
  sampler.reset();sampler.sample('manual');assert.equal(events.at(-1).checkpoint,'manual');assert.equal(events.at(-1).viewCount,undefined);
});
test('heap API missing, malformed or denied is unsupported, never zero',()=>{
  const descriptor=Object.getOwnPropertyDescriptor(performance,'memory');
  try{
    Object.defineProperty(performance,'memory',{configurable:true,value:undefined});assert.deepEqual(readJSHeap(),{status:'unsupported'});
    Object.defineProperty(performance,'memory',{configurable:true,value:{usedJSHeapSize:0,totalJSHeapSize:100,jsHeapSizeLimit:200}});assert.deepEqual(readJSHeap(),{status:'unsupported'});
    Object.defineProperty(performance,'memory',{configurable:true,value:{usedJSHeapSize:50,totalJSHeapSize:100,jsHeapSizeLimit:200}});assert.equal(readJSHeap().usedBytes,50);
    Object.defineProperty(performance,'memory',{configurable:true,get(){throw Error('denied');}});assert.deepEqual(readJSHeap(),{status:'unsupported'});
  }finally{if(descriptor)Object.defineProperty(performance,'memory',descriptor);else Reflect.deleteProperty(performance,'memory');}
});
test('numeric allowlist and journal bounds exclude content and survive load and disposal',async()=>{
  const preferences=diagnosticPreferences({memory:true});let stored:any;const now=Date.parse('2026-11-08T12:00:00Z');
  const io={id:()=> 'session',now:()=>now,context:{deviceId:'device',pluginVersion:'fixture'},load:async()=>stored,save:async(value:any)=>{stored=structuredClone(value);}};
  const policy={...connectionDiagnosticPolicy,accept:(event:string)=>{const category=diagnosticCategory(event);return !!category&&preferences[category];}};
  const journal=new EventJournal(io,policy);configureDiagnostics(journal);
  try{
    const sampler=new StreamMemoryDiagnostics();
    sampler.sample('manual',()=>({text:'PRIVATE',prompt:'PRIVATE',token:'PRIVATE',passwordLength:20,bodyLength:42,threadId:'fixture',notePath:'PRIVATE',editor:{content:'PRIVATE'}}));
    for(let i=0;i<1000;i++){sampler.reset();sampler.sample('dispose',()=>({viewCount:0}));}
    await journal.close();assert.ok(stored.events.length<=512);assert.ok(Buffer.byteLength(JSON.stringify(stored))<256100);assert.doesNotMatch(JSON.stringify(stored),/PRIVATE/);
    assert.equal(sampler.sample('manual'),false);
    const restored=new EventJournal(io,policy);await restored.load();assert.equal(restored.snapshot().events.length,stored.events.length);await restored.close();
  }finally{configureDiagnostics();}
  assert.deepEqual(safeMemoryFields({bodyLength:42,text:'PRIVATE',token:'PRIVATE',editor:{},badLength:Infinity}),{bodyLength:42});
});
test('checked settings command accepts sparse booleans and rejects invalid categories or other commands',()=>{
 const base={version:1,id:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',kind:'diagnostic-settings'};
 assert.doesNotThrow(()=>validateClientCommand({...base,diagnosticPreferences:{memory:true,response:false}}));
 for(const diagnosticPreferences of [{memory:'true'},{token:true},[],null])assert.throws(()=>validateClientCommand({...base,diagnosticPreferences}));
 assert.throws(()=>validateClientCommand({...base,kind:'client-status',diagnosticPreferences:{memory:true}}));
});
