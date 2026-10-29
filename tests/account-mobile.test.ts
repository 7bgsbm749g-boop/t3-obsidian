import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {settingsSocket} from './rpc-fixture';
import {webcrypto} from 'node:crypto';
import {indexedDB} from 'fake-indexeddb';
import {PLUGIN_PERMISSIONS,PLUGIN_SCOPE} from '../environment-permissions';

test('mobile account sign-in connects all machines, preserves selections, survives restart, renews, and signs out without replay',async()=>{
 let local:any={deviceId:'account-mobile-device',mode:'direct',pairedSessions:{manual:{url:'https://manual.example',environmentId:'manual',token:'manual-private',expiresAt:Date.now()+600000}}};
 const initial={paired:[{id:'a-connection',environmentId:'a',url:'https://a.example',name:'Laptop'},{id:'manual',environmentId:'manual',url:'https://manual.example',name:'Manual'}],directSelected:['a-connection:p-a'],directProjects:[{id:'p-a',title:'Project a',workspaceRoot:'/',connectionId:'a-connection',connectionName:'Laptop'}],directScanId:'a-connection'};
 const shared:any[]=[];let verified=false,offline=true,connects=0,revoked=0,nativeOffline=false;const dispatches:any[]=[];
 let delayed=false,release:((r:any)=>void)|undefined;
 const session={id:'sess-native',status:'active',user:{id:'user-native'}};
 const jwt='header.'+Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+600})).toString('base64url')+'.signature';
 const nativeResponse=(value:any,status=200)=>({status,headers:{authorization:'native-client-secret'},text:JSON.stringify(value)});
 const requestUrl=async(o:any)=>{
  if(nativeOffline)throw Error('Synthetic temporary network failure');
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
  if(url.startsWith('https://manual.example')){if(url.endsWith('/environment'))return response({environmentId:'manual',label:'Manual',orchestrationProtocolVersion:2});assert.equal(o.headers.Authorization,'Bearer manual-private');return response({projects:[],threads:[]});}
  const id=new URL(url).hostname[0];
  if(url.endsWith('/environment'))return response({environmentId:id,label:id,orchestrationProtocolVersion:2});
  if(url.endsWith('/oauth/token')){const form=new URLSearchParams(o.body);assert.equal(form.get('scope'),PLUGIN_SCOPE);const manual=form.get('subject_token')==='synthetic-code';return response({token_type:manual?'Bearer':'DPoP',access_token:manual?'manual-private-'+id:'environment-private-'+id,expires_in:600,scope:PLUGIN_SCOPE});}
  if(o.headers.Authorization!=='Bearer manual-private-'+id){assert.equal(o.headers.Authorization,'DPoP environment-private-'+id);assert.ok(o.headers.DPoP);}
  if(url.endsWith('/websocket-ticket'))return response({ticket:'ephemeral'});
  if(url.endsWith('/shell'))return response({projects:[{id:'p-'+id,title:'Project '+id,workspaceRoot:'/',defaultModelSelection:{instanceId:'codex',model:'default'}}],threads:[]});
  dispatches.push(JSON.parse(o.body));return response({});
 };
 class Base{};class File{path='account-test.md';basename='account-test';name='account-test.md';extension='md';stat={ctime:1,size:10};}
 let settingsTab:any;const ui:{text:string[];buttons:Array<{text:string;run?:()=>Promise<void>}>;inputs:string[]}={text:[],buttons:[],inputs:[]};
 const element={createEl:(_tag:string,options:any)=>{ui.text.push(options.text);return element;}};
 class Setting{
  constructor(_el:any){}setName(text:string){ui.text.push(text);return this;}setDesc(text:string){ui.text.push(text);return this;}setHeading(){return this;}
  addText(callback:any){callback({inputEl:{},setPlaceholder(){return this;},setValue(text:string){ui.inputs.push(text);return this;},onChange(){return this;}});return this;}
  addButton(callback:any){const button:any={text:'',setButtonText(text:string){this.text=text;return this;},setCta(){return this;},setDisabled(){return this;},onClick(run:any){this.run=run;return this;}};callback(button);ui.buttons.push(button);return this;}
 }
 class Plugin{
  app={loadLocalStorage:()=>local,saveLocalStorage:(_:string,v:any)=>{local=v;},workspace:{getLeavesOfType:()=>[],onLayoutReady:()=>{},on:()=>{}},vault:{read:async()=> 'Account connection test',getMarkdownFiles:()=>[],getName:()=> 'Notes'},metadataCache:{}};
  async loadData(){return shared.at(-1)??initial;}async saveData(d:any){shared.push(d);}addSettingTab(tab:any){settingsTab=tab;}registerEvent(){}addCommand(){}
 }
 const api={Plugin,Setting,Platform:{isMobile:true},TFile:File,Modal:Base,FuzzySuggestModal:Base,EditorSuggest:Base,ItemView:Base,PluginSettingTab:Base,Notice:Base,requestUrl};
 const module={exports:{} as any};
 runInNewContext(await readFile('dist/main.js','utf8'),{module,exports:module.exports,require:(name:string)=>{assert.equal(name,'obsidian','Mobile must never load Node APIs');return api;},indexedDB,document:{createElement:()=>({innerHTML:'',get textContent(){return this.innerHTML;}})},fetch:fetcher,WebSocket:settingsSocket(undefined,undefined,(tag,payload)=>{assert.equal(tag,'orchestration.dispatchCommand');dispatches.push(payload);return {}; }),Headers,Response,AbortController,URLSearchParams,URL,TextEncoder,TextDecoder,crypto:webcrypto,setTimeout,clearTimeout,console},{timeout:5000});
 const p=new module.exports.default();await p.onload();await p.startEmailSignIn('user@example.com');
 await assert.rejects(p.finishEmailSignIn('000000'),/incorrect/);assert.equal(p.nativeAccount,null);assert.equal(connects,0);
 await p.finishEmailSignIn('123456');assert.equal(p.nativeAccount.userId,'user-native');assert.ok(p.machineErrors.b);assert.equal(p.directAccountReady(),true,'completed discovery unlocks settings when at least one computer connected');assert.equal(p.settings.paired.length,2);assert.equal(p.settings.directSelected[0],'a-connection:p-a');
 offline=false;await p.refreshMachines();assert.equal(p.settings.paired.length,3);assert.equal(p.settings.directProjects.length,2);assert.equal(Object.keys(p.machineErrors).length,0);assert.equal(p.directAccountReady(),true);
 const c=p.settings.paired.find((c:any)=>c.environmentId==='a');assert.equal(c.id,'a-connection');assert.equal(c.managed,true);
 for(const legacyPermissions of [undefined,['orchestration:read','orchestration:operate'],['orchestration:read','orchestration:operate','filesystem:read']]){
  const before:number=connects;p.pairedSessions[c.id].permissions=legacyPermissions;
  assert.ok(p.pairedSessions[c.id].expiresAt>Date.now()+60000,'Migration must not wait for expiry');
  const [first,second]=await Promise.all([p.sessionFor(c.id),p.sessionFor(c.id)]);
  assert.equal(connects,before+1,'Legacy permission upgrade is coalesced');assert.equal(first,second);assert.deepEqual(Array.from(first.permissions),Array.from(PLUGIN_PERMISSIONS));
  assert.equal(await p.sessionFor(c.id),first);assert.equal(connects,before+1,'Complete grants reuse the same valid session');
 }
 assert.equal((await p.sessionFor('manual')).token,'manual-private','An unmanaged pairing must not use account credentials');assert.equal(dispatches.length,0,'Permission migration must not replay sends');
 const previousConnects=connects;p.pairedSessions[c.id].expiresAt=0;await Promise.all([p.sessionFor(c.id),p.sessionFor(c.id)]);assert.equal(connects,previousConnects+1,'Renewal is coalesced');
 // A transport failure must not erase a valid device account.
 p.nativeToken=undefined;nativeOffline=true;await assert.rejects(p.nativeCredential(),/Cannot reach T3 sign-in/);assert.equal(p.nativeAccount.userId,'user-native');nativeOffline=false;
 settingsTab.display=()=>{ui.text=[];ui.buttons=[];ui.inputs=[];settingsTab.cloudUI(element);};settingsTab.display();
 // The screenshot's expired account state must become one coherent sign-in UI.
 verified=false;p.nativeToken=undefined;p.pairedSessions[c.id].expiresAt=0;
 await assert.rejects(p.sessionFor(c.id),(error:any)=>error.signInRequired===true);
 assert.equal(p.nativeAccount,null);assert.equal(p.signInExpired,true);assert.equal(p.signInEmail,'user@example.com');
 assert.equal(p.pairedSessions[c.id],undefined);assert.equal(p.pairedSessions.manual.token,'manual-private');assert.equal(revoked,0,'An already expired login must not invoke remote sign-out');
 assert.equal(local.nativeAccount,null);assert.equal(local.signInEmail,'user@example.com');assert.equal(local.signInExpired,true);
 const replacementManual={url:c.url,environmentId:c.environmentId,token:'manual-private',expiresAt:Date.now()+600000};p.pairedSessions[c.id]=replacementManual;
 assert.equal(await p.sessionFor(c.id,true),replacementManual,'A manual session on a shared managed connection works after account expiry');delete p.pairedSessions[c.id];
 assert.ok(ui.buttons.some(button=>button.text==='Refresh authentication'));assert.ok(!ui.buttons.some(button=>['Sign out','Refresh connections'].includes(button.text)));
 assert.deepEqual(ui.inputs,['user@example.com']);assert.match(ui.text.join('\n'),/Each client must sign in separately/);assert.doesNotMatch(ui.text.join('\n'),/Connection setup has not completed|Refresh connections/);
 const manualExpiry=p.pairedSessions.manual.expiresAt;p.pairedSessions.manual.expiresAt=0;assert.match(p.chatReadinessError(),/Refresh authentication/);p.pairedSessions.manual.expiresAt=manualExpiry;
 const deviceInline=p.deviceInline,htmlResults=p.htmlResults;let reconnects=0;const recoveredEnvironments:string[]=[];
 p.deviceInline={reconnect:()=>{reconnects++;}};p.htmlResults={recover:async(environmentId:string)=>{recoveredEnvironments.push(environmentId);}};
 await assert.rejects(p.pairConnection('Manual laptop','https://a.example/pair#token=synthetic-code','','other-environment'),/no longer matches the selected T3 machine/);
 assert.equal(reconnects,0);assert.deepEqual(recoveredEnvironments,[],'Rejected pairing cannot trigger recovery');
 await p.pairConnection('Manual laptop','https://a.example/pair#token=synthetic-code','','a');
 assert.equal(p.nativeAccount,null);assert.equal((await p.sessionFor(c.id,true)).accountId,undefined);
 assert.equal(reconnects,1);assert.deepEqual(recoveredEnvironments,['a'],'Successful manual pairing wakes paused replies and failed HTML on that environment');assert.equal(dispatches.length,0);
 p.deviceInline=deviceInline;p.htmlResults=htmlResults;delete p.pairedSessions[c.id];
 await ui.buttons.find(button=>button.text==='Refresh authentication')!.run!();assert.equal(p.emailLogin.email,'user@example.com');
 await p.finishEmailSignIn('123456');assert.equal(p.nativeAccount.userId,'user-native');assert.equal(p.signInExpired,false);assert.equal(p.directAccountReady(),true);assert.equal(dispatches.length,0,'Reauthentication must not resend any prompt');
 const project=p.settings.directProjects.find((p:any)=>p.id==='p-a');await p.send(new File(),project);assert.equal(dispatches.length,2);assert.ok(dispatches[1].text.startsWith('Account connection test'));assert.doesNotMatch(dispatches[1].text,/T3 EVENT HISTORY CAPABILITY/);assert.equal(p.settings.pending.length,0);p.onunload();
 const q=new module.exports.default();await q.onload();assert.equal(q.nativeAccount.userId,'user-native');assert.equal(q.directAccountReady(),false,'reload stays gated until this device refreshes its connections');assert.equal(dispatches.length,2,'Reload must not send work');
 const sessions=q.pairedSessions;q.pairedSessions={};assert.doesNotMatch(q.chatReadinessError()??'',/Refresh connections/);q.pairedSessions=sessions;
 await q.signOutCloud();assert.equal(q.nativeAccount,null);assert.equal(q.directAccountReady(),false);assert.equal(q.pairedSessions[c.id],undefined);assert.equal(q.pairedSessions.manual.token,'manual-private');assert.equal(revoked,1);
 await q.startEmailSignIn('user@example.com');delayed=true;const verify=q.finishEmailSignIn('123456');await new Promise(r=>setImmediate(r));assert.ok(release);q.cancelCloudLogin();release!({});await verify;assert.equal(q.nativeAccount,null,'Cancelled verification must not restore account');
 for(const s of shared)assert.doesNotMatch(JSON.stringify(s),/native-client-secret|bootstrap-private|environment-private|relay-private|manual-private|123456|privateKey|sessionId/);
 q.onunload();
});
