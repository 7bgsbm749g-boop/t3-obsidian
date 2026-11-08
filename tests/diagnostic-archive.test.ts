import {test} from 'node:test';
import assert from 'node:assert/strict';
import {indexedDB,IDBKeyRange as Range} from 'fake-indexeddb';
import {DiagnosticArchive} from '../src/app/diagnostic-archive';
import {EventJournal,connectionDiagnosticPolicy,type DiagnosticEvent} from '../src/app/diagnostics';
import {connectDiagnosticFiles} from '../src/notes/connect-command-files';
Object.assign(globalThis,{IDBKeyRange:Range});
async function fixture(){
 const name=crypto.randomUUID();const open=()=>new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open(name,1);request.onupgradeneeded=()=>request.result.createObjectStore('devices');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
 let time=Date.parse('2026-11-08T12:00:00Z'),fail=false,hook:undefined|(()=>void);const data=new Map<string,string>();let writes=0;
 const files=connectDiagnosticFiles({call:async(tag,input:any)=>{assert.equal(tag,'projects.writeFile');if(fail)throw Error('offline');hook?.();hook=undefined;writes++;data.set(input.relativePath,input.contents);return {}; }},'/scratch');
 const target={environmentId:'machine',workspaceRoot:'/scratch',directory:'.t3-obsidian/diagnostics/vault/device'};
 const archive=new DiagnosticArchive('vault','device',open,()=>time);
 const event=(sequence:number):DiagnosticEvent=>({at:new Date(time).toISOString(),sequence,sessionId:'session',deviceId:'device',event:'memory.streaming',level:'info',fields:{bodyLength:sequence,token:'PRIVATE',text:'PRIVATE',heap:{status:'supported',usedBytes:sequence}}});
 return {archive,event,data,files,target,open,advance:()=>time+=5001,fail:(value:boolean)=>fail=value,hook:(value:()=>void)=>hook=value,get writes(){return writes;}};
}
function events(data:Map<string,string>){return [...data].filter(([name])=>name.endsWith('.jsonl')).flatMap(([,text])=>text.trim().split('\n').map(line=>JSON.parse(line)));}
test('retains all history past preview size/age and writes normal JSONL automatically without a snapshot/export',async()=>{
 const f=await fixture();const j=new EventJournal({load:async()=>undefined,save:async()=>{},retain:event=>f.archive.record(event),id:()=> 'session',context:{deviceId:'device'}},connectionDiagnosticPolicy);
 for(let i=0;i<1500;i++)j.record('memory.streaming',{bodyLength:i,token:'PRIVATE',text:'PRIVATE'});
 await f.archive.settle();assert.equal(j.snapshot().events.length,512);assert.equal(f.archive.status().storedEvents,1500);
 for(let i=0;i<15;i++){f.advance();await f.archive.sync(f.files,f.target);}
 const stored=events(f.data);assert.equal(stored.length,1500);assert.equal(new Set(stored.map(event=>event.sequence)).size,1500);assert.doesNotMatch(JSON.stringify(stored),/PRIVATE/);
 const db=await f.open();await new Promise<void>((resolve,reject)=>{const tx=db.transaction('devices','readonly'),read=tx.objectStore('devices').getAll();read.onsuccess=()=>assert.equal(read.result.filter((entry:any)=>Array.isArray(entry?.events)).flatMap((entry:any)=>entry.events).length,1500);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});db.close();
 await j.close();await f.archive.close();
});
test('offline pages survive reload, duplicate migration and ages beyond seven days; transport retries do not erase history',async()=>{
 const f=await fixture();for(let i=1;i<=80;i++)f.archive.record(f.event(i));await f.archive.settle();f.fail(true);await assert.rejects(f.archive.sync(f.files,f.target),/offline/);await f.archive.close();
 const archive=new DiagnosticArchive('vault','device',f.open,()=>Date.parse('2027-01-01T00:00:00Z'));for(let i=1;i<=80;i++)archive.record(f.event(i));await archive.settle();assert.equal(archive.status().storedEvents,80);
 f.fail(false);await archive.sync(f.files,f.target);assert.equal(events(f.data).length,80);assert.equal(archive.status().fileError,'');await archive.close();
});
test('coalesces uploads, throttles file writes, and does not acknowledge a page changed during upload',async()=>{
 const f=await fixture();f.archive.record(f.event(1));await f.archive.settle();f.hook(()=>f.archive.record(f.event(2)));
 const a=f.archive.sync(f.files,f.target),b=f.archive.sync(f.files,f.target);assert.equal(a,b);await a;
 const count=f.writes;await f.archive.sync(f.files,f.target);assert.equal(f.writes,count);
 f.advance();await f.archive.sync(f.files,f.target);assert.deepEqual(events(f.data).map(event=>event.sequence),[1,2]);
 await f.archive.close();f.archive.record(f.event(3));await f.archive.sync(f.files,f.target);assert.equal(f.writes,count+2);
});
test('diagnostic transport writes plain large UTF-8 JSONL and keeps its separate path boundary',async()=>{
 const f=await fixture(),text=JSON.stringify({bodyLength:2,example:'漢'.repeat(12000)})+'\n';await f.files.write(f.target.directory+'/test.jsonl',text);assert.equal(f.data.get(f.target.directory+'/test.jsonl'),text);assert.equal(f.data.size,1);
 for(const path of ['../bad','.t3-obsidian/clients/private','.t3-obsidian/diagnostics/../bad'])await assert.rejects(f.files.write(path,'x'),/path/);
 await f.archive.close();
});
