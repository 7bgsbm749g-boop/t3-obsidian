import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ImageResultStore,IMAGE_CACHE_MAX_ENTRIES} from '../src/responses/image-result-store';
import {MAX_IMAGE_BYTES,imageResultKey,type ImageResultReference} from '../src/responses/image-results';

const reference:ImageResultReference={version:1,environmentId:'env',threadId:'thread',runId:'run',itemId:'tool',revision:'revision',source:{kind:'output',index:0,mimeType:'image/png'}};
const png=Uint8Array.from([137,80,78,71,13,10,26,10,1]).buffer;
function fixture(){
 const values=new Map<string,any>(),calls:any[]=[];let downloads=0,closes=0,online=true;
 let item:any={id:'tool',threadId:'thread',runId:'run',updatedAt:'revision',type:'dynamic_tool',status:'completed',output:[{type:'image',mimeType:'image/png'}]};
 let signed:any={relativeUrl:'/api/assets/signed/image',expiresAt:Date.now()+60000},response:any={bytes:png,mimeType:'image/png',status:200};
 const create=()=>new ImageResultStore({read:async key=>structuredClone(values.get(key)),write:async(key,value)=>{values.set(key,structuredClone(value));}},async environmentId=>{
  assert.equal(environmentId,'env');if(!online)throw Error('private connection failure');
  return {origin:'https://t3.example',api:async(path,payload)=>{calls.push({path,payload});return path.endsWith('/turn-item')?item:signed;},close:()=>{closes++;}};
 },async url=>{assert.equal(url,'https://t3.example/api/assets/signed/image');downloads++;return response;});
 return {values,calls,create,get downloads(){return downloads;},get closes(){return closes;},item:(update:any)=>{item={...item,...update};},signed:(update:any)=>{signed={...signed,...update};},response:(update:any)=>{response={...response,...update};},offline:()=>{online=false;}};
}
test('verifies source before minting an image URL, coalesces loads and reopens offline',async()=>{
 const f=fixture(),store=f.create();const [a,b]=await Promise.all([store.get(reference),store.get(reference)]);
 assert.deepEqual(a,b);assert.equal(f.downloads,1);assert.equal(f.closes,1);
 assert.deepEqual(f.calls,[{path:'/api/orchestration/turn-item',payload:{threadId:'thread',itemId:'tool',revision:'revision'}},{path:'/api/assets/create-url',payload:{resource:{_tag:'tool-output-image',threadId:'thread',itemId:'tool',index:0}}}]);
 assert.doesNotMatch(JSON.stringify(f.values.get(imageResultKey(reference))),/signed|expiresAt/);
 store.dispose();f.offline();assert.deepEqual(await f.create().get(reference),a);
 const receiver=fixture();receiver.offline();await assert.rejects(receiver.create().get(reference),/Check your T3 connection/);
});
test('the view_image path is verified against the canonical tool before file access',async()=>{
 const f=fixture(),source={kind:'file' as const,path:'/evidence/capture.png'};
 f.item({output:undefined,toolName:'view_image',input:{path:source.path}});
 await f.create().get({...reference,source});
 assert.deepEqual(f.calls[1].payload,{resource:{_tag:'media-file',threadId:'thread',path:source.path}});
});
test('mismatched items, runs, revisions and image indexes cannot download bytes',async()=>{
 for(const update of [{id:'other'},{threadId:'other'},{runId:'other'},{updatedAt:'old'},{status:'failed'},{output:[]},{output:[{type:'image',mimeType:'image/jpeg'}]}]){
  const f=fixture();f.item(update);await assert.rejects(f.create().get(reference),/verify/);assert.equal(f.downloads,0);assert.equal(f.closes,1);
 }
});
test('signed URLs must be current image routes on the selected T3 origin',async()=>{
 for(const relativeUrl of ['https://evil.example/api/assets/image','//evil.example/api/assets/image','/api/assets/../../../private','/api/assets/\\evil','/api/assets/image#secret','/other','']){
  const f=fixture();f.signed({relativeUrl});await assert.rejects(f.create().get(reference),/invalid image URL/);assert.equal(f.downloads,0);
 }
 const f=fixture();f.signed({expiresAt:1});await assert.rejects(f.create().get(reference),/invalid image URL/);
});
test('bad MIME, signatures, HTTP errors and oversized images are never cached',async()=>{
 for(const update of [{status:403},{mimeType:'image/svg+xml'},{mimeType:'image/jpeg'},{bytes:new ArrayBuffer(0)},{bytes:new ArrayBuffer(MAX_IMAGE_BYTES+1)},{bytes:new Uint8Array([1,2,3]).buffer}]){
  const f=fixture();f.response(update);await assert.rejects(f.create().get(reference));assert.equal(f.values.has(imageResultKey(reference)),false);
 }
});
test('corrupt cache entries are rejected and cache eviction bounds retained images',async()=>{
 const f=fixture();await f.create().get(reference);const key=imageResultKey(reference);f.values.get(key).hash='corrupt';f.offline();await assert.rejects(f.create().get(reference));
 const g=fixture();const old=Array.from({length:IMAGE_CACHE_MAX_ENTRIES},(_,index)=>({key:index.toString(16).padStart(64,'0'),bytes:1}));g.values.set('index',old);g.values.set(old[0].key,{old:true});await g.create().get(reference);
 assert.equal(g.values.get('index').length,IMAGE_CACHE_MAX_ENTRIES);assert.equal(g.values.get(old[0].key),null);
});
test('dispose prevents downloads and late cache writes',async()=>{
 const f=fixture(),store=f.create();store.dispose();await assert.rejects(store.get(reference),/invalid/);assert.equal(f.downloads,0);
});

test('browser decode rejection evicts the image and index so retry downloads fresh bytes',async()=>{
 const f=fixture(),store=f.create();await store.get(reference);
 assert.equal(f.downloads,1);await store.invalidate(reference);
 assert.equal(f.values.get(imageResultKey(reference)),null);assert.deepEqual(f.values.get('index'),[]);
 await store.get(reference);assert.equal(f.downloads,2);assert.equal(f.values.get('index').length,1);
});

test('retry bypasses rejected cached bytes even if persistent eviction fails',async()=>{
 const values=new Map<string,unknown>();let failWrites=false,downloads=0;
 const store=new ImageResultStore({read:async key=>values.get(key),write:async(key,value)=>{if(failWrites)throw Error('disk unavailable');values.set(key,value);}},async()=>({origin:'https://t3.example',api:async path=>path.endsWith('/turn-item')?{id:'tool',threadId:'thread',runId:'run',updatedAt:'revision',type:'dynamic_tool',status:'completed',output:[{type:'image',mimeType:'image/png'}]}:{relativeUrl:'/api/assets/image',expiresAt:Date.now()+60000}}),async()=>{downloads++;return {bytes:png,mimeType:'image/png',status:200};});
 await store.get(reference);failWrites=true;await assert.rejects(store.invalidate(reference),/disk unavailable/);
 await store.get(reference);assert.equal(downloads,2);store.dispose();
});

test('network fills are limited to two and unload retires queued and in-flight work',async()=>{
 const gates:Array<()=>void>=[],values=new Map<string,unknown>();let active=0,maximum=0,opens=0;
 const store=new ImageResultStore({read:async key=>values.get(key),write:async(key,value)=>{values.set(key,value);}},async()=>{
  opens++;active++;maximum=Math.max(maximum,active);
  return {origin:'https://t3.example',api:async(path,payload:any)=>path.endsWith('/turn-item')?{id:payload.itemId,threadId:'thread',runId:'run',updatedAt:'revision',type:'dynamic_tool',status:'completed',output:[{type:'image',mimeType:'image/png'}]}:{relativeUrl:'/api/assets/image',expiresAt:Date.now()+60000},close:()=>{active--;}};
 },async()=>{await new Promise<void>(resolve=>gates.push(resolve));return {bytes:png,mimeType:'image/png',status:200};});
 const work=Array.from({length:5},(_,index)=>store.get({...reference,itemId:'tool-'+index}));const result=Promise.allSettled(work);
 await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(opens,2);assert.equal(maximum,2);
 gates.shift()!();await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(opens,3);assert.equal(maximum,2);
 store.dispose();for(const resolve of gates)resolve();const settled=await result;
 assert.equal(settled.filter(item=>item.status==='fulfilled').length,1);assert.equal(opens,3);assert.equal(active,0);assert.equal(values.size,2,'Only the image and index saved before unload remain');
});
