import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from './obsidian-context';
import {webcrypto} from 'node:crypto';

async function fixture(isMobile=false){
  const requests:string[]=[],sessions:string[]=[];
  let localChecks=0;
  class Base{}
  const module={exports:{} as any};
  const api={Plugin:Base,Modal:Base,FuzzySuggestModal:Base,EditorSuggest:Base,ItemView:Base,PluginSettingTab:Base,Notice:Base,Platform:{isMobile}};
  runInNewContext(await readFile('dist/main.js','utf8'),{
    module,exports:module.exports,require:(name:string)=>{
      assert.equal(name,'obsidian','Remote access must not load local desktop dependencies');return api;
    },
    fetch:async(url:string,options:any)=>{
      requests.push(url);
      assert.equal(new URL(url).origin,'https://vps.example');
      if(url.endsWith('/.well-known/t3/environment'))return new Response(JSON.stringify({environmentId:'vps',label:'VPS',orchestrationProtocolVersion:2}));
      assert.equal(options.headers.Authorization,'Bearer device-session');
      return new Response(JSON.stringify({thread:{id:'thread',projectId:'project',messages:[{role:'assistant',text:'Remote reply'}]}}));
    },
    document:{createElement:()=>({innerHTML:'',get textContent(){return this.innerHTML;}})},
    URL,URLSearchParams,Headers,Response,AbortController,TextEncoder,TextDecoder,crypto:webcrypto,setTimeout,clearTimeout,console,
  },{timeout:5000});
  const plugin=new module.exports.default();
  plugin.settings={paired:[{id:'vps-connection',environmentId:'vps',name:'VPS',url:'https://vps.example'}],connection:{host:'local',executable:''}};
  plugin.localNoProjectEnvironment=async()=>{localChecks++;return undefined;};
  plugin.sessionFor=async(id:string)=>{sessions.push(id);return {token:'device-session',expiresAt:Date.now()+600000,environmentId:'vps',url:'https://vps.example'};};
  return {plugin,requests,sessions,localChecks:()=>localChecks};
}

for(const isMobile of [false,true])test(`${isMobile?'mobile':'desktop with local T3 stopped'} reads a connected remote thread`,async()=>{
  const h=await fixture(isMobile),access=await h.plugin.inlineThreadAccess('vps');
  const snapshot=await access.api('/api/orchestration/threads/thread?turnLimit=20');
  assert.equal(access.origin,'https://vps.example');
  assert.equal(snapshot.thread.messages[0].text,'Remote reply');
  assert.equal(h.localChecks(),isMobile?0:1);
  assert.deepEqual(h.sessions,['vps-connection']);
  assert.deepEqual(h.requests,['https://vps.example/.well-known/t3/environment','https://vps.example/api/orchestration/threads/thread/bounded?compactTurnItems=1']);
});

test('a missing remote session cannot use a different local environment',async()=>{
  const h=await fixture();h.plugin.sessionFor=async()=>undefined;
  h.plugin.localNoProjectEnvironment=async()=> 'different-local-environment';
  await assert.rejects(h.plugin.inlineThreadAccess('vps'),/Pair this connection on this device first/);
  assert.equal(h.localChecks(),0);assert.deepEqual(h.requests,[]);
});

test('unpaired desktop threads require the exact local identity',async()=>{
  const h=await fixture();
  await assert.rejects(h.plugin.inlineThreadAccess('unpaired'),/Connect this device to the thread machine/);
  assert.equal(h.localChecks(),1);assert.deepEqual(h.requests,[]);
  h.plugin.localNoProjectEnvironment=async()=> 'local-environment';
  await assert.rejects(h.plugin.inlineThreadAccess('unpaired'),/Connect this device to the thread machine/);
  assert.deepEqual(h.sessions,[]);
});

test('unpaired mobile threads require a device connection without local discovery',async()=>{
  const h=await fixture(true);
  await assert.rejects(h.plugin.inlineThreadAccess('unpaired'),/Connect this device to the thread machine/);
  assert.equal(h.localChecks(),0);assert.deepEqual(h.requests,[]);assert.deepEqual(h.sessions,[]);
});

test('a local send and its replies use local access despite a broken pairing to the same machine',async()=>{
  const h=await fixture();h.plugin.mode='desktop';h.plugin.localNoProjectId='vps';
  h.plugin.localNoProjectEnvironment=async()=> 'vps';
  h.plugin.sessionFor=async()=>{assert.fail('A local reply must not require a paired session');};
  const local={origin:'http://127.0.0.1:3773',api:async()=>({local:true})};
  h.plugin.localThreadAccess=async()=>local;
  const connection=h.plugin.connection({id:'project',title:'Local',workspaceRoot:'/fixture'});
  assert.equal(connection.transport,'desktop');assert.equal(connection.environmentId,'vps');
  assert.equal(await h.plugin.inlineThreadAccess(connection.environmentId),local);
  assert.deepEqual(h.requests,[]);
});

test('paired fallback remains available when local identity discovery fails',async()=>{
  const h=await fixture();h.plugin.localNoProjectEnvironment=async()=>{throw Error('Local runtime unavailable');};
  assert.equal((await h.plugin.inlineThreadAccess('vps')).origin,'https://vps.example');
});

test('reply access chooses the same available endpoint as the project catalog',async()=>{
  const h=await fixture();const current=h.plugin.settings.paired[0];
  h.plugin.settings.paired.unshift({...current,id:'stale',url:'https://stale.example'});
  h.plugin.projectDiscovery={status:(key:string)=>key.includes('vps-connection')?'available':'offline'};
  assert.equal((await h.plugin.inlineThreadAccess('vps')).origin,'https://vps.example');
  assert.deepEqual(h.sessions,['vps-connection']);
});

test('a current device credential wins over a stale pairing before project discovery',async()=>{
  const h=await fixture(),current=h.plugin.settings.paired[0];
  h.plugin.settings.paired.unshift({...current,id:'stale',url:'https://stale.example'});
  h.plugin.pairedSessions[current.id]={token:'device-session',expiresAt:Date.now()+600000,environmentId:current.environmentId,url:current.url};
  assert.equal((await h.plugin.inlineThreadAccess('vps')).origin,current.url);
  assert.deepEqual(h.sessions,[current.id]);
});

test('verified local vault storage stays local when its T3 server is stopped',async()=>{
  const h=await fixture();h.plugin.eventLocalEnvironmentId='local';
  h.plugin.localNoProjectEnvironment=async()=>{assert.fail('Known local files must not need a live server');};
  assert.equal(await h.plugin.isLocalStorageEnvironment('local'),true);
});

test('remote vault storage remains eligible for paired access when local discovery fails',async()=>{
  const h=await fixture();h.plugin.localNoProjectEnvironment=async()=>{throw Error('Local T3 stopped');};
  assert.equal(await h.plugin.isLocalStorageEnvironment('vps'),false);
});
