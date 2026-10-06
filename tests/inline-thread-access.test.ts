import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
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
      if(url.endsWith('/.well-known/t3/environment'))return new Response(JSON.stringify({environmentId:'vps',label:'VPS',orchestrationProtocolVersion:1}));
      assert.equal(options.headers.Authorization,'Bearer device-session');
      return new Response(JSON.stringify({thread:{id:'thread',messages:[{role:'assistant',text:'Remote reply'}]}}));
    },
    document:{createElement:()=>({innerHTML:'',get textContent(){return this.innerHTML;}})},
    URL,URLSearchParams,Headers,Response,AbortController,TextEncoder,TextDecoder,crypto:webcrypto,setTimeout,clearTimeout,console,
  },{timeout:5000});
  const plugin=new module.exports.default();
  plugin.settings={paired:[{id:'vps-connection',environmentId:'vps',name:'VPS',url:'https://vps.example'}],connection:{host:'local',executable:''}};
  plugin.localInlineEnvironment=async()=>{localChecks++;throw Error('connect ECONNREFUSED 127.0.0.1:3773');};
  plugin.sessionFor=async(id:string)=>{sessions.push(id);return {token:'device-session',expiresAt:Date.now()+600000,environmentId:'vps',url:'https://vps.example'};};
  return {plugin,requests,sessions,localChecks:()=>localChecks};
}

for(const isMobile of [false,true])test(`${isMobile?'mobile':'desktop with local T3 stopped'} reads a connected remote thread without local discovery`,async()=>{
  const h=await fixture(isMobile),access=await h.plugin.inlineThreadAccess('vps');
  const snapshot=await access.api('/api/orchestration/threads/thread?turnLimit=20');
  assert.equal(access.origin,'https://vps.example');
  assert.equal(snapshot.thread.messages[0].text,'Remote reply');
  assert.equal(h.localChecks(),0);
  assert.deepEqual(h.sessions,['vps-connection']);
  assert.deepEqual(h.requests,['https://vps.example/.well-known/t3/environment','https://vps.example/api/orchestration/threads/thread?turnLimit=20']);
});

test('a missing remote session fails without falling back to a local server',async()=>{
  const h=await fixture();h.plugin.sessionFor=async()=>undefined;
  await assert.rejects(h.plugin.inlineThreadAccess('vps'),/Pair this connection on this device first/);
  assert.equal(h.localChecks(),0);assert.deepEqual(h.requests,[]);
});

test('unpaired desktop threads still use local discovery and require local T3',async()=>{
  const h=await fixture();
  await assert.rejects(h.plugin.inlineThreadAccess('unpaired'),/ECONNREFUSED/);
  assert.equal(h.localChecks(),1);assert.deepEqual(h.requests,[]);
  h.plugin.localInlineEnvironment=async()=> 'local-environment';
  await assert.rejects(h.plugin.inlineThreadAccess('unpaired'),/Connect this device to the thread machine/);
  assert.deepEqual(h.sessions,[]);
});

test('unpaired mobile threads require a device connection without local discovery',async()=>{
  const h=await fixture(true);
  await assert.rejects(h.plugin.inlineThreadAccess('unpaired'),/Connect this device to the thread machine/);
  assert.equal(h.localChecks(),0);assert.deepEqual(h.requests,[]);assert.deepEqual(h.sessions,[]);
});
