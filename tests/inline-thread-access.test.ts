import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from './obsidian-context';
import {webcrypto} from 'node:crypto';
async function fixture(mobile=false){
 const requests:Array<{url:string;method:string;token?:string}>=[],sessions:string[]=[];let rejectDispatch=false;
 class Base{}
 const module={exports:{} as any},api={Plugin:Base,Modal:Base,FuzzySuggestModal:Base,EditorSuggest:Base,ItemView:Base,PluginSettingTab:Base,Notice:Base,Platform:{isMobile:mobile}};
 runInNewContext(await readFile('dist/main.js','utf8'),{module,exports:module.exports,require:(name:string)=>{assert.equal(name,'obsidian','No native connection module may load');return api;},
 fetch:async(url:string,options:any)=>{const origin=new URL(url).origin,token=options?.headers?.Authorization;requests.push({url,method:options?.method??'GET',token});
  if(url.endsWith('/.well-known/t3/environment'))return new Response(JSON.stringify({environmentId:origin.includes('other')?'other':'target',label:'Synthetic',orchestrationProtocolVersion:2}));
  if(token==='Bearer revoked'||rejectDispatch&&options?.method==='POST')return new Response('{}',{status:401});
  if(url.endsWith('/shell'))return new Response(JSON.stringify({projects:[],threads:[]}));
  return new Response(JSON.stringify({thread:{id:'thread',projectId:'project',messages:[{role:'assistant',text:'Remote reply'}]}}));
 },document:{createElement:()=>({innerHTML:'',get textContent(){return this.innerHTML;}})},URL,URLSearchParams,Headers,Response,AbortController,TextEncoder,TextDecoder,crypto:webcrypto,setTimeout,clearTimeout,console});
 const plugin=new module.exports.default(),remote={id:'remote',environmentId:'target',name:'Target',url:'https://remote.example'},tokens:Record<string,string>={remote:'valid'};
 plugin.settings={paired:[remote],folderLinks:[],connection:{}};
 plugin.sessionFor=async(id:string)=>{sessions.push(id);const connection=plugin.settings.paired.find((value:any)=>value.id===id);return tokens[id]?{token:tokens[id],expiresAt:Date.now()+600_000,environmentId:connection.environmentId,url:connection.url}:undefined;};
 return {plugin,requests,sessions,remote,tokens,failDispatch:()=>rejectDispatch=true};
}
for(const mobile of [false,true])test(`${mobile?'mobile':'desktop without a local T3 process'} uses authenticated remote access`,async()=>{
 const f=await fixture(mobile),access=await f.plugin.inlineThreadAccess('target'),result=await access.api('/api/orchestration/threads/thread?turnLimit=20');assert.equal(result.thread.messages[0].text,'Remote reply');assert.equal(access.origin,f.remote.url);assert.ok(f.requests.some(request=>request.url.endsWith('/shell')),'authorization must be checked before exposing the route');assert.deepEqual(f.sessions,['remote']);
});
test('an authenticated loopback endpoint wins without CLI access; stale credentials fall back only to the same machine',async()=>{
 for(const token of ['valid','revoked']){const f=await fixture();f.plugin.settings.paired.push({...f.remote,id:'local',url:'http://127.0.0.1:3773'});f.tokens.local=token;
  const access=await f.plugin.inlineThreadAccess('target');assert.equal(access.origin,token==='valid'?'http://127.0.0.1:3773':f.remote.url);assert.deepEqual(f.sessions,token==='valid'?['local']:['local','remote']);
 }
});
test('unpaired or changed environment identities cannot reach another machine',async()=>{
 const f=await fixture();await assert.rejects(f.plugin.inlineThreadAccess('unpaired'),/Connect this device/);assert.equal(f.requests.length,0);f.plugin.settings.paired=[{...f.remote,url:'https://other.example'}];await assert.rejects(f.plugin.inlineThreadAccess('target'),/different T3 environment/);assert.ok(f.requests.every(request=>request.url.endsWith('/.well-known/t3/environment')));
});
test('a lost or rejected mutation is never rerouted or replayed',async()=>{
 const f=await fixture();f.plugin.settings.paired.push({...f.remote,id:'spare',url:'https://spare.example'});f.tokens.spare='valid';const access=await f.plugin.inlineThreadAccess('target');f.failDispatch();await assert.rejects(access.api('/api/orchestration/dispatch',{type:'thread.turn.interrupt'}));assert.equal(f.requests.filter(request=>request.method==='POST').length,1);assert.deepEqual(f.sessions,['remote']);
});
test('catalog credentials select the same endpoint for reply access before discovery',async()=>{
 const f=await fixture();f.plugin.settings.paired.unshift({...f.remote,id:'stale',url:'https://stale.example'});f.tokens.stale='revoked';f.plugin.pairedSessions.remote={token:'valid',expiresAt:Date.now()+600_000,environmentId:'target',url:f.remote.url};assert.equal((await f.plugin.inlineThreadAccess('target')).origin,f.remote.url);assert.deepEqual(f.sessions,['remote']);
});
test('an offline command host does not hold up polling a ready paired client',async()=>{
 const f=await fixture();let release!:()=>void,readyTicks=0;const pending=new Promise<void>(resolve=>{release=resolve;});
 f.plugin.commandHosts.set('offline',{host:{tick:()=>pending}});f.plugin.commandHosts.set('ready',{host:{tick:async()=>{readyTicks++;}}});
 f.plugin.tickCommandHosts();await Promise.resolve();f.plugin.tickCommandHosts();await Promise.resolve();f.plugin.tickCommandHosts();await Promise.resolve();
 assert.equal(readyTicks,3);release();f.plugin.commandHosts.clear();
});
