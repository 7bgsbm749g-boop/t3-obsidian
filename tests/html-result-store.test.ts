import {test} from 'node:test';
import assert from 'node:assert/strict';
import {HtmlResultStore,HTML_CACHE_MAX_ENTRIES} from '../html-result-store';
import {htmlResultKey,HTML_RESULT_MAX_BYTES} from '../html-results';
import {reference,tool} from './fixtures/html-result';
import {contentHash} from '../completion';
const html='<!doctype html><button>Interactive ✓</button>',bytes=new TextEncoder().encode(html).buffer;
function fixture(){
 const values=new Map<string,any>(),calls:Array<{path:string;payload:any}>=[];let downloads=0,closes=0,online=true,item:any=tool(),signed:any={relativeUrl:'/api/assets/signed/result.html',expiresAt:Date.now()+60_000},response:any={status:200,mimeType:'text/html; charset=utf-8',bytes};
 const storage={read:async(key:string)=>structuredClone(values.get(key)),write:async(key:string,value:any)=>{values.set(key,structuredClone(value));}};
 const create=()=>new HtmlResultStore(storage,async environmentId=>{assert.equal(environmentId,reference.environmentId);if(!online)throw Error('offline');return {origin:'https://t3.example',api:async(path,payload)=>{calls.push({path,payload});return path==='/api/orchestration/turn-item'?item:signed;},close:()=>{closes++;}};},async url=>{assert.equal(url,'https://t3.example/api/assets/signed/result.html');downloads++;return response;});
 return {values,calls,storage,create,get downloads(){return downloads;},get closes(){return closes;},offline(){online=false;},item(value:any){item=value;},signed(value:any){signed=value;},response(value:any){response=value;}};
}
test('coalesces concurrent loads, verifies exact source, and reopens from persistent bytes offline',async()=>{
 const f=fixture(),store=f.create();assert.deepEqual(await Promise.all([store.get(reference),store.get(reference)]),[html,html]);assert.equal(f.downloads,1);assert.equal(f.closes,1);
 assert.deepEqual(f.calls[0].payload,{threadId:reference.threadId,itemId:reference.itemId,revision:reference.revision});assert.equal(f.calls[1].path,'/api/assets/create-url');
 const saved=f.values.get(htmlResultKey(reference));assert.equal(saved.hash,contentHash(html));assert.doesNotMatch(JSON.stringify(saved),/signed\/|expiresAt/);
 store.dispose();f.offline();assert.equal(await f.create().get(reference),html);
});
test('rejects a mismatched run, attachment, item, revision and failed result before download',async()=>{
 for(const update of [{id:'other'},{threadId:'other'},{runId:'other'},{updatedAt:'older'},{status:'failed'},{output:{htmlRender:{...reference,attachmentId:'other-html'}}}]){
  const f=fixture();f.item({...tool(),...update});await assert.rejects(f.create().get(reference),/verify/);assert.equal(f.downloads,0);assert.equal(f.closes,1);
 }
});
test('signed URLs stay on the verified server and must be current attachment routes',async()=>{
 for(const relativeUrl of ['https://evil.example/api/assets/x','//evil.example/api/assets/x','/api/assets/../../../secret','/api/other','']){
  const f=fixture();f.signed({relativeUrl,expiresAt:Date.now()+60_000});await assert.rejects(f.create().get(reference),/invalid HTML/);assert.equal(f.downloads,0);
 }
 const f=fixture();f.signed({relativeUrl:'/api/assets/signed/result.html',expiresAt:1});await assert.rejects(f.create().get(reference),/invalid HTML/);
});
test('rejects HTTP failures, unexpected MIME, empty and oversized bytes',async()=>{
 for(const update of [{status:403},{mimeType:'application/json'},{bytes:new ArrayBuffer(0)},{bytes:new ArrayBuffer(HTML_RESULT_MAX_BYTES+1)}]){
  const f=fixture();f.response({status:200,mimeType:'text/html',bytes,...update});await assert.rejects(f.create().get(reference));assert.equal(f.values.has(htmlResultKey(reference)),false);
 }
});
test('corrupt cached bytes cannot execute offline or substitute for another result',async()=>{
 const f=fixture(),store=f.create();await store.get(reference);store.dispose();const key=htmlResultKey(reference),saved=f.values.get(key);f.values.set(key,{...saved,html:'changed'});f.offline();await assert.rejects(f.create().get(reference),/offline/);
 f.values.set(key,{...saved,identity:'other source'});await assert.rejects(f.create().get(reference),/offline/);
});
test('cache retention has a bounded index and releases retired payloads',async()=>{
 const f=fixture();const old=Array.from({length:HTML_CACHE_MAX_ENTRIES},(_,index)=>({key:contentHash(String(index)),bytes:1}));f.values.set('index',old);f.values.set(old[0].key,{html:'retired'});await f.create().get(reference);
 assert.equal(f.values.get('index').length,HTML_CACHE_MAX_ENTRIES);assert.equal(f.values.get(old[0].key),null);
});
test('unloaded stores reject new work and do not persist late downloads',async()=>{
 const f=fixture(),store=f.create();store.dispose();await assert.rejects(store.get(reference),/unavailable/);assert.equal(f.calls.length,0);
});
