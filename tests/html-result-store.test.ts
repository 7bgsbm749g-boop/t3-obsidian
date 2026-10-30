import {test} from 'node:test';
import assert from 'node:assert/strict';
import {HtmlResultError,HtmlResultStore,HTML_CACHE_MAX_ENTRIES,type HtmlResultStoreOptions,type HtmlResultDiagnostic} from '../html-result-store';
import {htmlResultKey,htmlResultIdentity,HTML_RESULT_MAX_BYTES} from '../html-results';
import {reference,tool} from './fixtures/html-result';
import {contentHash} from '../completion';
const html='<!doctype html><button>Interactive ✓</button>',bytes=new TextEncoder().encode(html).buffer;
function fixture(){
 const values=new Map<string,any>(),calls:Array<{path:string;payload:any}>=[];let downloads=0,closes=0,online=true,accessError:unknown,apiError:unknown,closeError:unknown,item:any=tool(),signed:any={relativeUrl:'/api/assets/signed/result.html',expiresAt:Date.now()+60_000},response:any={status:200,mimeType:'text/html; charset=utf-8',bytes};
 const storage={read:async(key:string)=>structuredClone(values.get(key)),write:async(key:string,value:any)=>{values.set(key,structuredClone(value));}};
 const create=(options:HtmlResultStoreOptions={})=>new HtmlResultStore(storage,async environmentId=>{assert.equal(environmentId,reference.environmentId);if(accessError)throw accessError;if(!online)throw Error('offline');return {origin:'https://t3.example',api:async(path,payload)=>{calls.push({path,payload});if(apiError)throw apiError;return path==='/api/orchestration/turn-item'?item:signed;},close:()=>{closes++;if(closeError)throw closeError;}};},async url=>{assert.equal(url,'https://t3.example/api/assets/signed/result.html');downloads++;return response;},options);
 return {values,calls,storage,create,get downloads(){return downloads;},get closes(){return closes;},offline(){online=false;},online(){online=true;},accessError(value:unknown){accessError=value;},apiError(value:unknown){apiError=value;},closeError(value:unknown){closeError=value;},item(value:any){item=value;},signed(value:any){signed=value;},response(value:any){response=value;}};
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
 const f=fixture(),store=f.create();await store.get(reference);store.dispose();const key=htmlResultKey(reference),saved=f.values.get(key);f.values.set(key,{...saved,html:'changed'});f.offline();await assert.rejects(f.create().get(reference),/Cannot connect/);
 f.values.set(key,{...saved,identity:'other source'});await assert.rejects(f.create().get(reference),/Cannot connect/);
});
test('cache retention has a bounded index and releases retired payloads',async()=>{
 const f=fixture();const old=Array.from({length:HTML_CACHE_MAX_ENTRIES},(_,index)=>({key:contentHash(String(index)),bytes:1}));f.values.set('index',old);f.values.set(old[0].key,{html:'retired'});await f.create().get(reference);
 assert.equal(f.values.get('index').length,HTML_CACHE_MAX_ENTRIES);assert.equal(f.values.get(old[0].key),null);
});
test('unloaded stores reject new work and do not persist late downloads',async()=>{
 const f=fixture(),store=f.create();store.dispose();await assert.rejects(store.get(reference),/unavailable/);assert.equal(f.calls.length,0);
});

test('a separate receiving device must verify and download the synced reference itself',async()=>{
 const sender=fixture(),receiver=fixture(),sent=sender.create(),received=receiver.create();
 assert.equal(await sent.get(reference),html);assert.equal(sender.downloads,1);assert.equal(receiver.values.size,0);
 receiver.offline();await assert.rejects(received.get(JSON.parse(JSON.stringify(reference))),{code:'connection',stage:'access'});
 assert.equal(receiver.downloads,0);assert.equal(receiver.values.size,0);assert.equal(await sent.get(reference),html);
 receiver.online();assert.deepEqual(await Promise.all([received.get(reference),received.get(reference)]),[html,html]);
 assert.equal(receiver.downloads,1);assert.equal(receiver.calls[0].path,'/api/orchestration/turn-item');
 assert.deepEqual(receiver.calls[0].payload,{threadId:reference.threadId,itemId:reference.itemId,revision:reference.revision});
 assert.notEqual(sender.values,receiver.values);received.dispose();receiver.offline();assert.equal(await receiver.create().get(reference),html);
});

test('cache read, payload write, and index write failures cannot block verified HTML',async()=>{
 for(const operation of ['read','payload','index']){
  const f=fixture(),diagnostics:HtmlResultDiagnostic[]=[];
  if(operation==='read')f.storage.read=async()=>{throw Error('private indexeddb data');};
  else {const write=f.storage.write;f.storage.write=async(key,value)=>{if(operation==='payload'||key==='index')throw Error('private disk data');await write(key,value);};}
  const store=f.create({onDiagnostic:diagnostic=>diagnostics.push(diagnostic)});
  assert.equal(await store.get(reference),html);assert.equal(await store.get(reference),html);assert.equal(f.downloads,1);
  assert.ok(diagnostics.some(row=>row.code=== (operation==='read'?'cache-read':'cache-write')));
  assert.doesNotMatch(JSON.stringify(diagnostics),/private|signed|expiresAt|html>/);
 }
});

test('typed sign-in failures and HTTP status retain safe classification at the failing stage',async()=>{
 class NeedsSignIn extends Error {}
 const diagnostics:HtmlResultDiagnostic[]=[],f=fixture();f.accessError(new NeedsSignIn('Bearer private-token https://private.test/?secret=1'));
 const store=f.create({isSignInError:error=>error instanceof NeedsSignIn,onDiagnostic:diagnostic=>diagnostics.push(diagnostic)});
 await assert.rejects(store.get(reference),(error:unknown)=>error instanceof HtmlResultError&&error.code==='sign-in'&&error.stage==='access'&&error.recoverable&&!/Bearer|private|secret/.test(error.message));
 assert.deepEqual(diagnostics,[{code:'sign-in',stage:'access'}]);
 f.accessError(undefined);f.apiError(Object.assign(Error('secret server body'),{status:401}));
 await assert.rejects(store.get(reference),{code:'sign-in',stage:'verification',status:401});
 f.apiError(undefined);f.response({status:503,mimeType:'text/html',bytes});
 await assert.rejects(store.get(reference),{code:'http',stage:'download',status:503});
 f.response({status:200,mimeType:'text/html',bytes});assert.equal(await store.get(reference),html);
 assert.doesNotMatch(JSON.stringify(diagnostics),/Bearer|private|secret|signed/);
});

test('invalid content and failed verification have non-recoverable classifications',async()=>{
 for(const [response,code] of [[{mimeType:'application/json'},'mime'],[{bytes:new ArrayBuffer(0)},'size'],[{bytes:new Uint8Array([0xff]).buffer},'encoding']] as const){
  const f=fixture();f.response(Object.assign({status:200,mimeType:'text/html',bytes},response));
  await assert.rejects(f.create().get(reference),(error:unknown)=>error instanceof HtmlResultError&&error.code===code&&error.stage==='download'&&!error.recoverable);
 }
 const f=fixture();f.item({...tool(),runId:'other'});await assert.rejects(f.create().get(reference),{code:'verification',stage:'verification'});
});

test('connection cleanup failures preserve both successful bytes and the original failure',async()=>{
 const f=fixture(),diagnostics:HtmlResultDiagnostic[]=[];f.closeError(Error('private cleanup cause'));
 const store=f.create({onDiagnostic:diagnostic=>diagnostics.push(diagnostic)});assert.equal(await store.get(reference),html);
 const other=f.create({onDiagnostic:diagnostic=>diagnostics.push(diagnostic)});f.values.clear();f.item({...tool(),runId:'wrong'});
 await assert.rejects(other.get(reference),{code:'verification',stage:'verification'});
 assert.equal(diagnostics.filter(row=>row.code==='close').length,2);assert.equal(diagnostics.at(-1)?.code,'verification');
});

test('a download that completes after disposal is neither cached nor published',async()=>{
 const f=fixture();let finish!:(value:any)=>void,started!:()=>void;
 const downloading=new Promise<void>(resolve=>{started=resolve;}),store=new HtmlResultStore(f.storage,async()=>({origin:'https://t3.example',api:async path=>path==='/api/orchestration/turn-item'?tool():{relativeUrl:'/api/assets/page',expiresAt:Date.now()+60_000}}),()=>{started();return new Promise(resolve=>{finish=resolve;});});
 const result=store.get(reference);await downloading;store.dispose();finish({status:200,mimeType:'text/html',bytes});
 await assert.rejects(result,{code:'closed',stage:'download'});assert.equal(f.values.size,0);
});

test('scrolling back through twelve verified cards stays in memory',async()=>{
 const refs=Array.from({length:12},(_,i)=>({...reference,itemId:'scroll-card-'+i}));let reads=0;
 const pages=new Map(refs.map(ref=>[htmlResultKey(ref),{version:1,identity:htmlResultIdentity(ref),html,hash:contentHash(html),bytes:new TextEncoder().encode(html).byteLength}]));
 const store=new HtmlResultStore({read:async(key:string)=>{reads++;return pages.get(key);},write:async()=>{}},async()=>assert.fail('Verified local pages need no account access'),async()=>assert.fail('Verified local pages need no download'));
 for(const ref of refs)assert.equal(await store.get(ref),html);
 assert.equal(reads,12);
 for(const ref of [...refs].reverse())assert.equal(await store.get(ref),html);
 assert.equal(reads,12);store.dispose();
});
