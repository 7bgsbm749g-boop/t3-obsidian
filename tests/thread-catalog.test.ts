import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ThreadCatalogCache} from '../src/connection/thread-catalog';
import {environmentApi} from '../src/connection/direct';
import {readImportThreads} from '../src/conversations/import-source';

const shell={threads:[{id:'source',projectId:'project',title:'Source',updatedAt:'2026-01-01',privateBody:'Do not retain'},{id:'archived',projectId:'project',title:'Old',archivedAt:'2026-01-01'},{id:'other',projectId:'another',title:'Another project'}]};
test('picker metadata excludes archived threads and all unrelated payload fields',()=>{
 const cache=new ThreadCatalogCache(()=>0);cache.remember('credential',shell,1_000_000);
 assert.deepEqual(cache.read('credential','project'),[{id:'source',projectId:'project',title:'Source',updatedAt:'2026-01-01',status:'Idle'}]);
 const rows=cache.read('credential','project')!;rows[0].title='Changed locally';assert.equal(cache.read('credential','project')![0].title,'Source');
 assert.equal(cache.read('different credential','project'),undefined);
});
test('known choices stay available during refresh and retire before their credential expires',()=>{
 let now=0;const cache=new ThreadCatalogCache(()=>now);cache.remember('short',shell,10_000);cache.remember('long',shell,1_000_000);
 now=5000;assert.equal(cache.read('short','project'),undefined);assert.ok(cache.read('long','project'));
 now=300_000;assert.ok(cache.read('long','project'));assert.equal(cache.needsRefresh('long'),true);
 now=995_000;assert.equal(cache.read('long','project'),undefined);
});
test('one background refresh replaces stale choices without withholding the existing list',async()=>{
 let now=0,reads=0,release!:()=>void;const cache=new ThreadCatalogCache(()=>now);cache.remember('credential',shell,1_000_000);
 const notifications:string[][]=[],stop=cache.watch('credential',()=>notifications.push(cache.read('credential','project')!.map(row=>row.id)));
 now=300_000;
 const read=()=>{reads++;return new Promise<void>(resolve=>{release=()=>{cache.remember('credential',{threads:[...shell.threads,{id:'new',projectId:'project',title:'New thread'}]},1_000_000);resolve();};});};
 const first=cache.prepare('credential',read);assert.equal(cache.prepare('credential',read),first);await Promise.resolve();
 assert.equal(reads,1);assert.deepEqual(cache.read('credential','project')!.map(row=>row.id),['source']);
 release();await first;assert.equal(cache.needsRefresh('credential'),false);assert.deepEqual(notifications,[['source','new']]);stop();
 await cache.prepare('credential',read);assert.equal(reads,1,'fresh discovery needs no extra network read');
});
test('import warm-up joins ordinary project discovery already in progress',async()=>{
 const cache=new ThreadCatalogCache(()=>0);let release!:()=>void,duplicates=0;
 const existing=new Promise<void>(resolve=>{release=()=>{cache.remember('credential',shell,1_000_000);resolve();};});cache.observe('credential',existing);
 const warm=cache.prepare('credential',async()=>{duplicates++;});release();await warm;
 assert.equal(duplicates,0);assert.equal(cache.read('credential','project')?.[0].id,'source');
});
test('opaque cache identities survive metadata refresh and change after access revocation',()=>{
 const cache=new ThreadCatalogCache(()=>0),identity=cache.scope('credential');cache.remember('credential',shell,1_000_000);
 assert.equal(cache.scope('credential'),identity);cache.remember('credential',shell,1_000_000);assert.equal(cache.scope('credential'),identity);
 assert.notEqual(cache.scope('another credential'),identity);cache.delete('credential');assert.notEqual(cache.scope('credential'),identity);
});
test('discovery metadata is shared only by the same authenticated transport and identity',async()=>{
 const paths:string[]=[],url='https://catalog.example',session={token:'synthetic-first',url,environmentId:'machine',expiresAt:Date.now()+600_000};
 const fetcher=async(target:RequestInfo|URL)=>{const path=new URL(String(target)).pathname;paths.push(path);return new Response(JSON.stringify(path.endsWith('/environment')?{environmentId:'machine',label:'Fixture',orchestrationProtocolVersion:2}:shell));};
 const connection={transport:'direct' as const,host:'direct',executable:'',url,environmentId:'machine'};
 const discovery=await environmentApi(connection,session,fetcher);await discovery('/api/orchestration/shell');
 const selected=await environmentApi(connection,session,fetcher);assert.equal((await readImportThreads({origin:url,api:selected},'project')).length,1);
 assert.equal(paths.filter(path=>path.endsWith('/shell')).length,1,'a second pane reuses completed discovery metadata');
 const changed=await environmentApi(connection,{...session,token:'synthetic-second'},fetcher);assert.equal(changed.cachedImportThreads?.('project'),undefined);
});
test('a denied authoritative read invalidates cached choices for that credential',async()=>{
 const url='https://catalog-denied.example',session={token:'synthetic',url,environmentId:'machine',expiresAt:Date.now()+600_000};let denied=false;
 const fetcher=async(target:RequestInfo|URL)=>new Response(JSON.stringify(String(target).endsWith('/environment')?{environmentId:'machine',label:'Fixture',orchestrationProtocolVersion:2}:shell),{status:denied?403:200});
 const api=await environmentApi({transport:'direct',host:'direct',executable:'',url,environmentId:'machine'},session,fetcher);await api('/api/orchestration/shell');assert.ok(api.cachedImportThreads?.('project'));
 denied=true;await assert.rejects(api('/api/orchestration/shell'),/access denied/);assert.equal(api.cachedImportThreads?.('project'),undefined);
});
test('native thread watchers publish changed rows and stop after the picker closes',async()=>{
 const url='https://catalog-watch.example',session={token:'synthetic',url,environmentId:'machine',expiresAt:Date.now()+600_000};let rows=shell.threads;
 const fetcher=async(target:RequestInfo|URL)=>new Response(JSON.stringify(String(target).endsWith('/environment')?{environmentId:'machine',label:'Fixture',orchestrationProtocolVersion:2}:{threads:rows}));
 const api=await environmentApi({transport:'direct',host:'direct',executable:'',url,environmentId:'machine'},session,fetcher);await api('/api/orchestration/shell');
 let updates=0;const stop=api.watchImportThreads!('project',()=>{updates++;});await api('/api/orchestration/shell');assert.equal(updates,0);
 rows=[...rows,{id:'new',projectId:'project',title:'New',updatedAt:'2026-01-02',privateBody:'Discard'}];await api('/api/orchestration/shell');assert.equal(updates,1);
 stop();rows=rows.slice(1);await api('/api/orchestration/shell');assert.equal(updates,1);
});
test('application cancellation aborts a background catalog fetch',async()=>{
 const url='https://catalog-cancel.example',session={token:'synthetic',url,environmentId:'machine',expiresAt:Date.now()+600_000};let requestSignal:AbortSignal|undefined;
 const fetcher=async(target:RequestInfo|URL,options?:RequestInit)=>{if(String(target).endsWith('/environment'))return new Response(JSON.stringify({environmentId:'machine',label:'Fixture',orchestrationProtocolVersion:2}));requestSignal=options?.signal??undefined;return new Promise<Response>(()=>{});};
 const api=await environmentApi({transport:'direct',host:'direct',executable:'',url,environmentId:'machine'},session,fetcher),controller=new AbortController(),work=api.prepareImportCatalog!(controller.signal);
 await Promise.resolve();await Promise.resolve();controller.abort(Error('Plugin stopped'));await assert.rejects(work,/Plugin stopped/);assert.equal(requestSignal?.aborted,true);
});

test('a real branch label survives the metadata-only catalog without retaining workspace payloads',()=>{
 const cache=new ThreadCatalogCache(()=>0);cache.remember('credential',{threads:[{...shell.threads[0],branch:'feature/import',privateBody:'Do not retain'}]},1_000_000);
 assert.equal(cache.read('credential','project')![0].branch,'feature/import');assert.equal('privateBody' in cache.read('credential','project')![0],false);
});
