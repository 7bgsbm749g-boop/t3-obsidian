import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {settingsSocket} from './rpc-fixture';
import {webcrypto} from 'node:crypto';
import {indexedDB} from 'fake-indexeddb';

test('mobile account sign-in connects all machines, preserves selections, survives restart, renews, and signs out without replay',async()=>{
 let local:any={deviceId:'account-mobile-device',mode:'direct',pairedSessions:{manual:{url:'https://manual.example',environmentId:'manual',token:'manual-private',expiresAt:Date.now()+600000}}};
 const initial={paired:[{id:'a-connection',environmentId:'a',url:'https://a.example',name:'Laptop'},{id:'manual',environmentId:'manual',url:'https://manual.example',name:'Manual'}],directSelected:['a-connection:p-a'],directProjects:[{id:'p-a',title:'Project a',workspaceRoot:'/',connectionId:'a-connection',connectionName:'Laptop'}],directScanId:'a-connection'};
 const shared:any[]=[];let verified=false,offline=true,connects=0,revoked=0;const dispatches:any[]=[];
 let delayed=false,release:((r:any)=>void)|undefined;
 const session={id:'sess-native',status:'active',user:{id:'user-native'}};
 const jwt='header.'+Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+600})).toString('base64url')+'.signature';
 const nativeResponse=(value:any,status=200)=>({status,headers:{authorization:'native-client-secret'},text:JSON.stringify(value)});
 const requestUrl=async(o:any)=>{
  const u=new URL(o.url);assert.equal(u.origin,'https://clerk.t3.codes');assert.equal(o.headers.origin,undefined);assert.equal(o.throw,false);const f=new URLSearchParams(o.body);
  if(u.pathname.endsWith('/sign_ins'))return nativeResponse({response:{id:'sign-native',supported_first_factors:[{strategy:'email_code',email_address_id:'email-native'}]}});
  if(u.pathname.endsWith('/prepare_first_factor'))return nativeResponse({response:{}});
  if(u.pathname.endsWith('/attempt_first_factor')){
    if(f.get('code')!=='123456')return nativeResponse({errors:[{code:'form_code_incorrect',message:'DO_NOT_LEAK'}]},422);
    verified=true;const r=nativeResponse({response:{status:'complete',created_session_id:'sess-native'},client:{sessions:[session]}});
    return delayed?new Promise(resolve=>{release=()=>resolve(r);}):r;
  }
  if(u.pathname.endsWith('/tokens/t3-relay'))return nativeResponse({response:{jwt}});
  if(u.pathname.endsWith('/remove')){revoked++;verified=false;return nativeResponse({response:{}});}
  return nativeResponse({response:{sessions:verified?[session]:[]}});
 };
 const fetcher=async(url:string,o:any)=>{
  assert.equal(o.credentials,'omit');assert.equal(o.redirect,'error');
  const response=(d:any,status=200)=>new Response(JSON.stringify(d),{status});
  if(url.endsWith('/v1/environments'))return response({environments:['a','b'].map(id=>({environmentId:id,label:id==='a'?'Laptop':'VPS',endpoint:{httpBaseUrl:'https://'+id+'.example'}}))});
  if(url.endsWith('/dpop-token'))return response({token_type:'DPoP',access_token:'relay-private',scope:'environment:connect'});
  if(url.endsWith('/connect')){connects++;const id=url.includes('/a/')?'a':'b';if(id==='b'&&offline)return response({error:'environment_endpoint_unavailable'},503);return response({environmentId:id,endpoint:{httpBaseUrl:'https://'+id+'.example'},credential:'bootstrap-private'});}
  const id=new URL(url).hostname[0];
  if(url.endsWith('/environment'))return response({environmentId:id,label:id,orchestrationProtocolVersion:1});
  if(url.endsWith('/oauth/token'))return response({token_type:'DPoP',access_token:'environment-private-'+id,expires_in:600,scope:'orchestration:read orchestration:operate'});
  assert.equal(o.headers.Authorization,'DPoP environment-private-'+id);assert.ok(o.headers.DPoP);
  if(url.endsWith('/websocket-ticket'))return response({ticket:'ephemeral'});
  if(url.endsWith('/shell'))return response({projects:[{id:'p-'+id,title:'Project '+id,workspaceRoot:'/',defaultModelSelection:{instanceId:'codex',model:'default'}}],threads:[]});
  dispatches.push(JSON.parse(o.body));return response({});
 };
 class Base{};class File{path='account-test.md';basename='account-test';name='account-test.md';extension='md';stat={ctime:1,size:10};}
 class Plugin{
  app={loadLocalStorage:()=>local,saveLocalStorage:(_:string,v:any)=>{local=v;},workspace:{onLayoutReady:()=>{},on:()=>{}},vault:{read:async()=> 'Account connection test',getMarkdownFiles:()=>[]},metadataCache:{}};
  async loadData(){return shared.at(-1)??initial;}async saveData(d:any){shared.push(d);}addSettingTab(){}registerEvent(){}addCommand(){}
 }
 const api={Plugin,Platform:{isMobile:true},TFile:File,Modal:Base,FuzzySuggestModal:Base,PluginSettingTab:Base,Notice:Base,requestUrl};
 const module={exports:{} as any};
 runInNewContext(await readFile('main.js','utf8'),{module,exports:module.exports,require:(name:string)=>{assert.equal(name,'obsidian','Mobile must never load Node APIs');return api;},indexedDB,document:{createElement:()=>({innerHTML:'',get textContent(){return this.innerHTML;}})},fetch:fetcher,WebSocket:settingsSocket(),Headers,Response,AbortController,URLSearchParams,URL,TextEncoder,TextDecoder,crypto:webcrypto,setTimeout,clearTimeout,console},{timeout:5000});
 const p=new module.exports.default();await p.onload();await p.startEmailSignIn('user@example.com');
 await assert.rejects(p.finishEmailSignIn('000000'),/incorrect/);assert.equal(p.nativeAccount,null);assert.equal(connects,0);
 await p.finishEmailSignIn('123456');assert.equal(p.nativeAccount.userId,'user-native');assert.ok(p.machineErrors.b);assert.equal(p.directAccountReady(),true,'completed discovery unlocks settings when at least one computer connected');assert.equal(p.settings.paired.length,2);assert.equal(p.settings.directSelected[0],'a-connection:p-a');
 offline=false;await p.refreshMachines();assert.equal(p.settings.paired.length,3);assert.equal(p.settings.directProjects.length,2);assert.equal(Object.keys(p.machineErrors).length,0);assert.equal(p.directAccountReady(),true);
 const c=p.settings.paired.find((c:any)=>c.environmentId==='a');assert.equal(c.id,'a-connection');assert.equal(c.managed,true);
 const previousConnects=connects;p.pairedSessions[c.id].expiresAt=0;await Promise.all([p.sessionFor(c.id),p.sessionFor(c.id)]);assert.equal(connects,previousConnects+1,'Renewal is coalesced');
 const project=p.settings.directProjects.find((p:any)=>p.id==='p-a');await p.send(new File(),project);assert.equal(dispatches.length,2);assert.equal(dispatches[1].message.text,'Account connection test');assert.equal(p.settings.pending.length,0);p.onunload();
 const q=new module.exports.default();await q.onload();assert.equal(q.nativeAccount.userId,'user-native');assert.equal(q.directAccountReady(),false,'reload stays gated until this device refreshes its connections');assert.equal(dispatches.length,2,'Reload must not send work');
 await q.signOutCloud();assert.equal(q.nativeAccount,null);assert.equal(q.directAccountReady(),false);assert.equal(q.pairedSessions[c.id],undefined);assert.equal(q.pairedSessions.manual.token,'manual-private');assert.equal(revoked,1);
 await q.startEmailSignIn('user@example.com');delayed=true;const verify=q.finishEmailSignIn('123456');await new Promise(r=>setImmediate(r));assert.ok(release);q.cancelCloudLogin();release!({});await verify;assert.equal(q.nativeAccount,null,'Cancelled verification must not restore account');
 for(const s of shared)assert.doesNotMatch(JSON.stringify(s),/native-client-secret|bootstrap-private|environment-private|relay-private|manual-private|123456|privateKey|sessionId/);
 q.onunload();
});
