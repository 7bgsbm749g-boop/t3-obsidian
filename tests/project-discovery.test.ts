import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ProjectDiscovery,projectFingerprint,type ProjectSource,type ProjectSnapshot} from '../project-discovery';
import type {Project} from '../bridge';
const project=(id:string,connectionId='a',title='Repository'):Project=>({id,title,workspaceRoot:'/work/'+id,connectionId,connectionName:connectionId});
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};}
function fixture(){let now=0,notifications=0;const writes:ProjectSnapshot[][]=[];const discovery=new ProjectDiscovery(async s=>{writes.push(s);},()=>{notifications++;},()=>now);return {discovery,writes,notifications:()=>notifications,advance:(ms:number)=>{now+=ms;}};}

test('bounded concurrency publishes fast machines before a slow one; failures preserve snapshots and empty successes remove them',async()=>{
 const f=fixture(),slow=deferred<Project[]>();let active=0,maxActive=0,offline=true;
 const sources:ProjectSource[]=['a','b','c','d','e'].map(key=>({key,enabled:true,read:async()=>{active++;maxActive=Math.max(maxActive,active);try{await Promise.resolve();if(key==='a')return await slow.promise;if(key==='b'&&offline)throw Error('offline');return key==='c'?[]:[project('same-id',key)];}finally{active--;}}}));
 f.discovery.restore(['a','b','c'].map(key=>({key,projects:[project('old',key)],fingerprint:''})));
 f.discovery.setSources(sources);const refresh=f.discovery.refresh();await new Promise(r=>setImmediate(r));
 assert.ok(f.discovery.all().some(p=>p.connectionId==='e'),'fast machines publish without waiting for slow machine');assert.equal(maxActive,3);assert.equal(f.discovery.status('b'),'offline');assert.ok(f.discovery.all().some(p=>p.connectionId==='b'));assert.ok(!f.discovery.all().some(p=>p.connectionId==='c'));
 slow.resolve([project('new','a')]);await refresh;assert.equal(f.discovery.all().filter(p=>p.id==='same-id').length,2,'identical names and IDs on separate machines remain distinct');
 offline=false;f.advance(15_000);await f.discovery.refresh();assert.equal(f.discovery.status('b'),'available');assert.ok(!f.discovery.all().some(p=>p.connectionId==='b'&&p.id==='old'));
});

test('unchanged sorted snapshots suppress writes and notifications; fresh sources skip reads and failures back off',async()=>{
 const f=fixture();let reads=0,fail=false;const source={key:'a',enabled:true,read:async()=>{reads++;if(fail)throw Error('offline');return reads%2?[project('2'),project('1')]:[project('1'),project('2')];}};
 f.discovery.setSources([source]);await f.discovery.refresh();const writes=f.writes.length,notifications=f.notifications();
 await Promise.all([f.discovery.refresh(),f.discovery.refresh()]);assert.equal(reads,1);await f.discovery.refresh(true);assert.equal(reads,2);assert.equal(f.writes.length,writes);assert.equal(f.notifications(),notifications);
 fail=true;await f.discovery.refresh(true);assert.equal(reads,3);await f.discovery.refresh();assert.equal(reads,3);f.advance(15_000);await f.discovery.refresh();assert.equal(reads,4);f.advance(15_000);await f.discovery.refresh();assert.equal(reads,4);f.advance(15_000);await f.discovery.refresh();assert.equal(reads,5);assert.equal(f.writes.length,writes);
 assert.equal(projectFingerprint([project('1'),project('2')]),projectFingerprint([project('2'),project('1')]));
});

for(const action of ['remove','disable','sign-out','unload'] as const)test(`late discovery cannot repopulate a catalog after ${action}`,async()=>{
 const f=fixture(),pending=deferred<Project[]>();const source={key:'a',enabled:true,read:()=>pending.promise};f.discovery.setSources([source]);
 const refresh=f.discovery.refresh();if(action==='remove')f.discovery.setSources([]);else if(action==='disable')f.discovery.setSources([{...source,enabled:false}]);else if(action==='unload')f.discovery.dispose();else f.discovery.invalidate();
 pending.resolve([project('late')]);await refresh;assert.equal(f.discovery.all().length,0);assert.ok(f.writes.every(s=>s.every(m=>m.projects.length===0)));
});

test('cached results display immediately, requests coalesce, and a restart refreshes without a shared settings write',async()=>{
 const f=fixture(),pending=deferred<Project[]>();let reads=0;f.discovery.restore([{key:'a',projects:[project('cached')],fingerprint:''}]);f.discovery.setSources([{key:'a',enabled:true,read:()=>{reads++;return pending.promise;}}]);
 assert.equal(f.discovery.all()[0].id,'cached');assert.equal(f.discovery.status('a'),'unverified');const a=f.discovery.refresh(),b=f.discovery.refresh();assert.equal(reads,1);pending.resolve([project('fresh')]);await Promise.all([a,b]);assert.equal(f.discovery.all()[0].id,'fresh');assert.equal(f.writes.length,1);
});
