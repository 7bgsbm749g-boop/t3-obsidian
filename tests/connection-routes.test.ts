import {test} from 'node:test';
import assert from 'node:assert/strict';
import {routeGroups,routePairing,localRoute,orderedRoutes} from '../src/connection/routes';
import {environmentAccess} from '../src/connection/environment-access';
import {environmentApi,type PairedConnection} from '../src/connection/direct';
const local:PairedConnection={id:'local',name:'Computer',url:'http://127.0.0.1:3773',environmentId:'same',routeKind:'local'};
const https:PairedConnection={...local,id:'https',url:'https://computer.tailnet.ts.net',routeKind:'https'};
const ssh:PairedConnection={...local,id:'ssh',url:'http://127.0.0.1:8899',routeKind:'ssh'};
test('one environment groups multiple routes without merging different T3 environments',()=>{
 const groups=routeGroups([local,https,ssh,{...https,id:'other',environmentId:'other'}]);
 assert.equal(groups.length,2);assert.deepEqual(groups[0].routes.map(r=>r.id),['local','https','ssh']);
 assert.equal(localRoute(local),true);assert.equal(localRoute(ssh),false,'A forwarded remote server is never treated as this computer');
 assert.deepEqual(orderedRoutes([local,https,ssh],['https','ssh','local']).map(r=>r.id),['https','ssh','local']);
});
test('local and SSH setup refuse non-loopback destinations; HTTPS pairing preserves one-time codes',()=>{
 assert.deepEqual(routePairing('local','http://127.0.0.1:3773/pair#token=once',''),{url:local.url,code:'once'});
 assert.deepEqual(routePairing('https',https.url+'/pair#token=once',''),{url:https.url,code:'once'});
 assert.throws(()=>routePairing('local',https.url,'once'),/localhost/);
 assert.throws(()=>routePairing('ssh',https.url,'once'),/localhost/);
 assert.throws(()=>routePairing('https',local.url,'once'),/HTTPS/);
});
test('fallback reaches only the same environment and never replays a caller mutation',async()=>{
 const calls:string[]=[],sent:unknown[]=[],routes=[local,https,{...ssh,environmentId:'wrong'}];
 const access=await environmentAccess('same',{paired:orderedRoutes(routes,['local','https']),openPaired:async route=>{
  calls.push(route.id);if(route.id==='local')throw Error('T3 is offline');
  return {origin:route.url,api:async(path,input)=>{sent.push({path,input});throw Error('Reply lost after acceptance');}};
 }});
 assert.deepEqual(calls,['local','https']);await assert.rejects(access.api('/api/orchestration/dispatch',{commandId:'unchanged-id'}),/Reply lost/);assert.equal(sent.length,1);assert.deepEqual(calls,['local','https']);
});
test('local and remote API access share authorization and environment-identity protections without account state',async()=>{
 for(const route of [local,https,ssh]){
  const calls:string[]=[];const session={token:'device-secret',url:route.url,environmentId:'same',expiresAt:Date.now()+60000};
  const fetcher:typeof fetch=async input=>{const url=String(input);calls.push(url);return new Response(JSON.stringify(url.endsWith('/environment')?{environmentId:'same',label:'Computer',orchestrationProtocolVersion:2}:{ready:true}),{status:200});};
  const api=await environmentApi({host:'direct',executable:'',transport:'direct',...route},session,fetcher);
  assert.deepEqual(await api('/api/test'),{ready:true});assert.deepEqual(calls,[route.url+'/.well-known/t3/environment',route.url+'/api/test']);
  await assert.rejects(environmentApi({host:'direct',executable:'',transport:'direct',...route},{...session,environmentId:'another'},fetcher),/Pair this connection/);
 }
});
