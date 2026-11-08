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
test('metadata expires before its credential and has a finite retention lifetime',()=>{
 let now=0;const cache=new ThreadCatalogCache(()=>now);cache.remember('short',shell,10_000);cache.remember('long',shell,1_000_000);
 now=5000;assert.equal(cache.read('short','project'),undefined);assert.ok(cache.read('long','project'));
 now=300_000;assert.equal(cache.read('long','project'),undefined);
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
