import { indexedDB } from 'fake-indexeddb';
import { deviceState } from '../device-state';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {webcrypto,createHash} from 'node:crypto';
import {contentHash,initialMessageId} from '../completion';

test('mobile upgrade removes old credentials and settings, retains uncertain work without replay or cleanup',async()=>{
 globalThis.indexedDB=indexedDB;
 let local:any={mode:'https',deviceId:'retired-device',tokens:{'https://old.example':'old-secret'}};const shared:any[]=[];
 const connection={transport:'https',host:'laptop',url:'https://old.example',executable:''};
 const request={id:'old-id',project:{id:'p',title:'P',workspaceRoot:'/'},title:'Old note',prompt:'Keep me',connection};
 await deviceState(local.deviceId,{pending:[request],completionJobs:[{requestId:'j',threadId:'thread',projectId:'p',connection,status:'watching',notePath:'keep.md',action:'delete'}]});
 class Base{}
 class Plugin{
  app={loadLocalStorage:()=>local,saveLocalStorage:(_:string,v:any)=>{local=v;},workspace:{onLayoutReady:()=>{},on:()=>{}}};
  async loadData(){return {remote:{url:'https://old.example'},remoteProjects:[{id:'p'}],remoteSelected:['laptop:p']};}
  async saveData(d:any){shared.push(d);}addSettingTab(){}registerEvent(){}addCommand(){}
 }
 const api={Plugin,Platform:{isMobile:true},Modal:Base,FuzzySuggestModal:Base,PluginSettingTab:Base,Notice:Base};
 const module={exports:{} as any};runInNewContext(await readFile('main.js','utf8'),{module,exports:module.exports,require:(name:string)=>{assert.equal(name,'obsidian');return api;},indexedDB,document:{createElement:()=>({innerHTML:'',get textContent(){return this.innerHTML;}})},URL,TextEncoder,TextDecoder,crypto:{getRandomValues:webcrypto.getRandomValues.bind(webcrypto)},setTimeout,clearTimeout,console},{timeout:5000});
 const p=new module.exports.default();await p.onload();assert.equal(p.mode,'direct');assert.equal(p.settings.pending.length,1);assert.equal(p.settings.pending[0].id,'old-id');assert.equal(p.settings.completionJobs[0].status,'kept');assert.match(p.settings.completionJobs[0].detail,/companion mode was removed/);
 await p.retry(p.settings.pending[0]);assert.equal(p.settings.pending.length,1,'Retired send remains for manual review');
 assert.ok(!('tokens' in local));for(const d of shared){assert.ok(!('remote' in d));assert.ok(!('remoteProjects' in d));assert.ok(!JSON.stringify(d).includes('old-secret'));}
});

test('portable fingerprints stay compatible with existing desktop jobs',()=>{
 assert.equal(contentHash('café 🧪\r\n'),createHash('sha256').update('café 🧪\r\n').digest('hex'));
 const id='50b38c2e-24bf-47fc-a934-461977de14d1';
 const hash=createHash('sha1').update(Buffer.from(id.replace(/-/g,''),'hex')).update('message').digest().subarray(0,16);
 hash[6]=(hash[6]&15)|80;hash[8]=(hash[8]&63)|128;
 assert.equal(initialMessageId(id).replace(/-/g,''),hash.toString('hex'));
});

test('direct pairing works in mobile bundle, keeps sessions local, and resumes only manual retry with original commands',async()=>{
 let local:any={mode:'direct',pairedSessions:{c:{url:'https://t3.example',environmentId:'env',token:'private-session',expiresAt:Date.now()+600000}}};
 const shared:any[]=[];let lose=true;const commands:any[]=[];
 const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=';
 const markdown='# Mobile 🧪\nBefore\n![[photo.png]]\nAfter\n![same](photo.png)';
 const project={id:'p',title:'P',workspaceRoot:'/',connectionId:'c',connectionName:'Laptop'};
 class Base{};class File{path='direct.md';name='direct.md';basename='direct';extension='md';stat={ctime:123,size:50};};const file=new File();
 class Plugin{
  app={loadLocalStorage:()=>local,saveLocalStorage:(_:string,v:any)=>{local=v;},workspace:{onLayoutReady:()=>{},on:()=>{}},vault:{read:async()=>markdown,readBinary:async()=>Uint8Array.from(Buffer.from(png,'base64')).buffer},metadataCache:{getFirstLinkpathDest:()=>file}};
  async loadData(){return {paired:[{id:'c',name:'Laptop',url:'https://t3.example',environmentId:'env'}],directScanId:'c',directProjects:[project],directSelected:['c:p']};}
  async saveData(d:any){shared.push(d);}addSettingTab(){}registerEvent(){}addCommand(){}
 }
 const api={Plugin,Platform:{isMobile:true},TFile:File,Modal:Base,FuzzySuggestModal:Base,PluginSettingTab:Base,Notice:Base};
 const fetcher=async(url:string,o:any)=>{
  assert.equal(o.redirect,'error');assert.equal(o.credentials,'omit');
  if(url.endsWith('/.well-known/t3/environment'))return new Response(JSON.stringify({environmentId:'env',label:'Laptop',orchestrationProtocolVersion:1}));
  assert.equal(o.headers.Authorization,'Bearer private-session');
  if(url.endsWith('/shell'))return new Response(JSON.stringify({projects:[{...project,defaultModelSelection:{instanceId:'codex',model:'default'}}],threads:[]}));
  const c=JSON.parse(o.body);commands.push(c);if(c.type==='thread.turn.start'&&lose){lose=false;throw Error('lost reply');}return new Response('{}');
 };
 const module={exports:{} as any};runInNewContext(await readFile('main.js','utf8'),{module,exports:module.exports,require:(name:string)=>{assert.equal(name,'obsidian');return api;},indexedDB,document:{createElement:()=>({innerHTML:'',get textContent(){return this.innerHTML;}})},fetch:fetcher,AbortController,URLSearchParams,URL,TextEncoder,TextDecoder,crypto:{getRandomValues:webcrypto.getRandomValues.bind(webcrypto)},setTimeout,clearTimeout,console},{timeout:5000});
 const p=new module.exports.default();await p.onload();assert.equal(p.mode,'direct');assert.equal(p.projects()[0].connectionId,'c');await p.send(file,project);assert.equal(p.settings.pending.length,1);const saved=p.settings.pending[0];assert.equal(saved.title,file.basename);assert.equal(commands[0].title,file.basename);assert.equal(saved.directPlan.phase,'created');assert.equal(saved.attachments.length,1);assert.equal(saved.attachments[0].dataUrl,'data:image/png;base64,'+png);assert.equal(saved.prompt.split('t3-context://').length-1,2);assert.ok(saved.prompt.startsWith('# Mobile 🧪\nBefore\n'));p.onunload();
 const q=new module.exports.default();await q.onload();assert.equal(commands.length,2);await q.retry(q.settings.pending[0]);assert.equal(commands.length,3);assert.deepEqual(commands[1],commands[2]);assert.equal(q.settings.pending.length,0);
 for(const s of shared){assert.ok(!JSON.stringify(s).includes('private-session'));assert.ok(!('pending' in s));}
 assert.ok(local.pairedSessions.c.token);assert.ok(!JSON.stringify(saved).includes('private-session'));
});

test('mobile OAuth sign-in discovers machines, persists credentials locally and ignores a cancelled response',async()=>{
 let local:any={};const shared:any[]=[];const timers=new Map<number,{fn:()=>any;delay:number}>();let next=1;let tokenReply:((r:Response)=>void)|undefined;let delayToken=false;
 class Base{};class Plugin{
  app={loadLocalStorage:()=>local,saveLocalStorage:(_:string,v:any)=>{local=v;},workspace:{onLayoutReady:()=>{},on:()=>{}}};
  async loadData(){return {}; }async saveData(d:any){shared.push(d);}addSettingTab(){}registerEvent(){}addCommand(){}
 }
 const api={Plugin,Platform:{isMobile:true},Modal:Base,FuzzySuggestModal:Base,PluginSettingTab:Base,Notice:Base};
 const result=(v:any)=>new Response(JSON.stringify(v));
 const token=()=>result({access_token:'oauth-private',refresh_token:'refresh-private',expires_in:3600,token_type:'Bearer'});
 const fetcher=async(url:string,o:any)=>{
  assert.equal(o.credentials,'omit');assert.equal(o.redirect,'error');
  if(url.endsWith('/device_authorization'))return result({device_code:'device-private',user_code:'ABCD',verification_uri:'https://accounts.t3.codes/device',expires_in:600,interval:5});
  if(url.endsWith('/oauth/token'))return delayToken?new Promise<Response>(r=>tokenReply=r):token();
  assert.ok(url.endsWith('/v1/environments'));assert.equal(o.headers.Authorization,'Bearer oauth-private');return result({environments:[{environmentId:'env',label:'Laptop',endpoint:{httpBaseUrl:'https://t3.example'}}]});
 };
 const module={exports:{} as any};runInNewContext(await readFile('main.js','utf8'),{module,exports:module.exports,require:(name:string)=>{assert.equal(name,'obsidian');return api;},indexedDB,document:{createElement:()=>({innerHTML:'',get textContent(){return this.innerHTML;}})},fetch:fetcher,AbortController,URLSearchParams,URL,TextEncoder,TextDecoder,crypto:{getRandomValues:webcrypto.getRandomValues.bind(webcrypto)},setTimeout:(fn:()=>any,delay:number)=>{const id=next++;timers.set(id,{fn,delay});return id;},clearTimeout:(id:number)=>timers.delete(id),console},{timeout:5000});
 const p=new module.exports.default();await p.onload();await p.startCloudLogin();assert.equal(p.cloudLogin.userCode,'ABCD');assert.equal(local.cloudAccount,null);p.cloudLogin.nextPollAt=0;
 let poll=[...timers].find(([,t])=>t.delay<30000)!;timers.delete(poll[0]);await poll[1].fn();assert.equal(p.cloudMachines[0].name,'Laptop');assert.equal(local.cloudAccount.refreshToken,'refresh-private');
 for(const d of shared)assert.ok(!JSON.stringify(d).match(/oauth-private|refresh-private|device-private/));
 await p.signOutCloud();assert.equal(local.cloudAccount,null);assert.equal(p.cloudMachines.length,0);
 await p.startCloudLogin();p.cloudLogin.nextPollAt=0;delayToken=true;poll=[...timers].find(([,t])=>t.delay<30000)!;timers.delete(poll[0]);const pending=poll[1].fn();await new Promise(r=>setImmediate(r));await p.signOutCloud();tokenReply!(token());await pending;assert.equal(p.cloudAccount,null);assert.equal(local.cloudAccount,null);p.onunload();
});
