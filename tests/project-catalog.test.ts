import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {randomUUID,webcrypto} from 'node:crypto';
import {indexedDB} from 'fake-indexeddb';

async function harness(){
 const deviceId=randomUUID();const layouts:Function[]=[],events=new Map<string,Function>(),intervals:Function[]=[];let saves=0,reads=0,offline=false,empty=false,release:(()=>void)|undefined,delay=false;
 const local:any={deviceId,mode:'direct',pairedSessions:Object.fromEntries(['a','b'].map(id=>[id,{url:`https://${id}.example`,environmentId:id,token:id,expiresAt:Date.now()+600_000}]))};
 const initial:any={vaultId:deviceId,paired:['a','b'].map(id=>({id,name:id==='a'?'Laptop':'VPS',url:`https://${id}.example`,environmentId:id})),directSelected:[],directProjects:['a','b'].map(connectionId=>({id:'same',title:'Same name',workspaceRoot:'/repo',connectionId,connectionName:connectionId==='a'?'Laptop':'VPS'})),folderLinks:[{id:'route',folderPath:'Notes',projectId:'same',projectTitle:'Same name',workspaceRoot:'/repo',connectionId:'b',environmentId:'b',self:false}],noteThreads:[{notePath:'Notes/Note.md',threadId:'remembered',projectId:'same',workspaceRoot:'/repo',connectionId:'b',environmentId:'b',selectedAt:new Date().toISOString()}]};
 let disk=initial;class Base{};class Folder{path='Notes';name='Notes';}
 class Plugin{
  app={loadLocalStorage:()=>local,saveLocalStorage:(_:string,value:any)=>Object.assign(local,value),workspace:{onLayoutReady:(cb:Function)=>layouts.push(cb),on:(name:string,cb:Function)=>events.set(name,cb)},vault:{getName:()=> 'Catalog test'}};
  async loadData(){return disk;}async saveData(value:any){disk=value;saves++;}addSettingTab(){}registerEvent(){}addCommand(){}registerInterval(){}
 }
 const api={Plugin,Platform:{isMobile:true},TFolder:Folder,Modal:Base,FuzzySuggestModal:Base,EditorSuggest:Base,ItemView:Base,PluginSettingTab:Base,Notice:Base};const module={exports:{} as any};
 const fetcher=async(url:string)=>{
  const response=(value:any,status=200)=>new Response(JSON.stringify(value),{status});const id=new URL(url).hostname[0];
  if(url.endsWith('/environment'))return response({environmentId:id,label:id,orchestrationProtocolVersion:2});
  if(url.endsWith('/shell')){reads++;if(delay&&id==='b')await new Promise<void>(resolve=>{release=resolve;});if(id==='b'&&offline)return response({},503);return response({projects:empty?[]:[{id:'same',title:'Same name',workspaceRoot:'/repo'},{id:'new',title:'Previously unchecked',workspaceRoot:'/new'}]});}
  throw Error('unexpected request');
 };
 runInNewContext(await readFile('dist/main.js','utf8'),{module,exports:module.exports,require:(name:string)=>{assert.equal(name,'obsidian');return api;},indexedDB,document:{createElement:()=>({innerHTML:'',get textContent(){return this.innerHTML;}})},window:{setInterval:(cb:Function)=>{intervals.push(cb);return 1;}},fetch:fetcher,Headers,Response,AbortController,URLSearchParams,URL,TextEncoder,TextDecoder,crypto:webcrypto,setTimeout,clearTimeout,console},{timeout:5000});
 const plugin=new module.exports.default();await plugin.onload();
 return {plugin,Folder,events,layouts,initial,reads:()=>reads,saves:()=>saves,disk:()=>disk,offline:()=>{offline=true;},empty:()=>{empty=true;},delay:()=>{delay=true;},release:()=>release?.()};
}

test('startup shows cached unchecked projects immediately, discovers every connection without settings, preserves routing/history, and never syncs derived cache',async()=>{
 const h=await harness(),p=h.plugin;assert.equal(p.projects().length,2);assert.equal(p.settings.directSelected.length,0);
 const menu:any={items:[],addSeparator(){},addItem(cb:Function){const item:any={setTitle(title:string){this.title=title;return this;},setIcon(){return this;},setSubmenu:()=>menu,setDisabled(){return this;},onClick(){return this;}};cb(item);menu.items.push(item);return menu;}};
 h.events.get('file-menu')!(menu,new h.Folder(),'file-explorer-context-menu');assert.ok(menu.items.some((i:any)=>i.title.startsWith('Link to Same name · Laptop')));assert.ok(menu.items.some((i:any)=>i.title.startsWith('Link to Same name · VPS')));
 const startup=h.layouts.find(cb=>cb.toString().includes('refreshProjectsInBackground(true)'));assert.ok(startup,'startup registers automatic discovery');startup!();await p.refreshMachines();assert.equal(h.reads(),2);assert.equal(p.projects().length,4);assert.equal(h.saves(),0);
 assert.equal(p.projectForLink(p.settings.folderLinks[0]).connectionId,'b');assert.equal(p.projectForNoteThread(p.settings.noteThreads[0]).connectionId,'b');
 const choices=p.destinationContext({path:'Notes/Note.md'}).getProjectChoices();assert.ok(choices.some((c:any)=>c.key==='a:new'));assert.ok(choices.some((c:any)=>c.key==='b:new'));
 await p.refreshMachines();assert.equal(h.saves(),0);const reads=h.reads();await p.refreshMachines(false);assert.equal(h.reads(),reads,'healthy background ticks do not read or rewrite');await p.save();assert.equal(h.saves(),0,'catalog changes are excluded from shared settings baseline');
 p.settings.orchestration.waitForOtherThreads=true;await p.save();assert.equal(h.saves(),1);assert.equal(h.disk().directProjects,undefined);assert.equal(h.disk().projects,undefined);assert.equal(h.disk().directSelected,undefined);
 const history=JSON.stringify(p.settings.noteThreads),links=JSON.stringify(p.settings.folderLinks);h.offline();await p.refreshMachines();assert.equal(p.projects().filter((p:any)=>p.connectionId==='b').length,2);assert.match(p.projectChoiceLabel(p.projects().find((p:any)=>p.connectionId==='b')),/Offline/);assert.equal(JSON.stringify(p.settings.noteThreads),history);assert.equal(JSON.stringify(p.settings.folderLinks),links);
 h.empty();await p.refreshMachines();assert.equal(p.projects().filter((p:any)=>p.connectionId==='a').length,0);assert.equal(p.projects().filter((p:any)=>p.connectionId==='b').length,2);p.onunload();
});

test('removing a connection during discovery rejects its late projects and keeps other machines',async()=>{
 const h=await harness(),p=h.plugin;h.delay();const refresh=p.refreshMachines();await new Promise(r=>setImmediate(r));await p.removeConnection('b');h.release();
 await refresh;assert.ok(!p.projects().some((p:any)=>p.connectionId==='b'));assert.ok(p.projects().some((p:any)=>p.connectionId==='a'));p.onunload();
});

for(const action of ['sign-out','unload'])test(`plugin rejects late machine results after ${action}`,async()=>{
 const h=await harness(),p=h.plugin;h.delay();const refresh=p.refreshMachines();await new Promise(r=>setImmediate(r));
 if(action==='sign-out')await p.signOutCloud();else p.onunload();h.release();await refresh;
 assert.ok(!p.projects().some((project:any)=>project.connectionId==='b'&&project.id==='new'));assert.equal(p.nativeAccount,null);assert.equal(h.saves(),0);p.onunload();
});

test('connection aliases deduplicate machine/project identity while exact saved routing remains available',async()=>{
 const h=await harness(),p=h.plugin;p.settings.paired.push({id:'alias',environmentId:'a',url:'https://alias.example',name:'Laptop alias'});
 p.settings.directProjects.push({...p.settings.directProjects[0],connectionId:'alias',connectionName:'Laptop alias'});
 assert.equal(p.projects().length,2,'same machine/project aliases are one chooser entry; other machines remain separate');
 const link={...p.settings.folderLinks[0],connectionId:'alias',environmentId:'a'};assert.equal(p.projectForLink(link).connectionId,'alias');p.onunload();
});
