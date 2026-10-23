import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {webcrypto,randomUUID} from 'node:crypto';
import {indexedDB} from 'fake-indexeddb';
import {applyThreadItem} from '../inline-thread';
import {eventRequest} from '../event-host';
import {findRunImport} from '../run-import-receipt';
import {responseAnchor} from '../native-response-projection';
import {updateResponseBindingData} from '../response-binding-data';

for(const phase of ['completed','running'])test(`mobile ${phase} import follows future runs after a delayed host reply without loading Node`,async()=>{
  class Base{}
  const api={Plugin:Base,Platform:{isMobile:true},Modal:Base,FuzzySuggestModal:Base,EditorSuggest:Base,ItemView:Base,PluginSettingTab:Base,Notice:Base};
  const host={vaultId:randomUUID(),environmentId:'host',workspaceRoot:'/vault',directory:'.obsidian/t3-code/events/v1'};
  const source={threadId:randomUUID(),projectId:'project',environmentId:'machine'},messageId=randomUUID(),file={path:'Import.md'};
  const store=new Map<string,string>(),commands:any[]=[],registered:any[]=[],displays:any[]=[];
  let pending:{result:string;body:string}|undefined,pauses=0,closed=0,document='Synthetic note.\n';
  const module={exports:{} as any};
  runInNewContext(await readFile('dist/main.js','utf8'),{module,exports:module.exports,require:(id:string)=>{assert.equal(id,'obsidian','mobile import must not load desktop modules');return api;},indexedDB,crypto:webcrypto,URL,TextEncoder,TextDecoder,console,clearTimeout,document:{createElement:()=>({innerHTML:'',get textContent(){return this.innerHTML;}})},
    setTimeout:(callback:()=>void,milliseconds:number)=>{
      assert.equal(milliseconds,250);assert.ok(pending,'host reply must require a polling wait');pauses++;
      store.set(pending.result,pending.body);pending=undefined;
      return setTimeout(callback,0);
    },
  });
  const plugin=new module.exports.default();
  plugin.app={loadLocalStorage:()=>undefined,saveLocalStorage:()=>{},workspace:{getLeavesOfType:()=>[]},vault:{getFileByPath:(path:string)=>path===file.path?file:undefined,read:async()=>document,process:async(_file:any,change:(value:string)=>string)=>document=change(document)}};
  plugin.settings={vaultId:host.vaultId,inlineStreaming:{enabled:true},responseBindings:{},noteThreads:[]};
  plugin.save=async()=>{};
  let finalSaveWaits=0;
  plugin.deviceInline={register:async(request:any)=>{registered.push(request);plugin.settings.responseBindings=updateResponseBindingData(plugin.settings.responseBindings,request,'synthetic');},waitForSave:async()=>{finalSaveWaits++;return {saved:true};}};
  plugin.connection=()=>({environmentId:source.environmentId});
  plugin.localResponseTarget=async()=>({environmentId:host.environmentId,workspaceRoot:host.workspaceRoot,directory:'.obsidian/inline'});
  const state=applyThreadItem({messages:[],activities:[]},{kind:'snapshot',snapshot:{thread:{messages:[
    {id:messageId,role:'user',text:'Synthetic prompt',createdAt:'2026-10-16T00:00:00Z',turnId:null,streaming:false},
    {id:'answer',role:'assistant',text:'Synthetic answer',createdAt:'2026-10-16T00:00:00Z',turnId:'turn',streaming:phase==='running'}],activities:[],latestTurn:{turnId:'turn',requestedAt:'2026-10-16T00:00:00Z',state:phase},session:{status:phase==='running'?'running':'ready',activeTurnId:phase==='running'?'turn':null}}}}).state;
  plugin.readImportHistory=async()=>({source,state,title:'Synthetic run'});
  plugin.eventHostTarget=async()=>({host,connectionId:'connection'});
  plugin.refreshEventHost=async()=>{};
  plugin.eventHostFiles=async()=>({close:()=>{closed++;},files:{read:async(path:string)=>store.get(path),remove:async(path:string)=>{store.delete(path);},write:async(path:string,body:string)=>{
    store.set(path,body);const command=JSON.parse(body).command;commands.push(command);
    assert.ok(['thread-streams','stream-thread'].includes(command.kind),'import must not dispatch a prompt');
    if(command.kind==='stream-thread')displays.push({id:command.id,...source,enabled:true,boundary:[messageId],destinations:[{path:file.path}]});
    const request=eventRequest(host,command);
    pending={result:request.result,body:JSON.stringify({version:1,host,request:request.name,result:{id:command.id,ok:true,displays}})};
  }}});

  assert.deepEqual(JSON.parse(JSON.stringify(await plugin.importRun(file.path,{id:source.projectId},source.threadId,messageId,true))),{duplicate:false,following:true,saveState:phase==='completed'?'saved':'streaming'});
  assert.equal(registered.length,1);assert.equal(pauses,2);assert.equal(closed,2);assert.equal(plugin.busy,false);
  assert.equal(plugin.noteThread(file.path).threadId,source.threadId);assert.equal(plugin.noteThread(file.path).environmentId,source.environmentId);
  assert.deepEqual(commands.map(command=>command.kind),['thread-streams','stream-thread']);
  assert.equal(commands[1].start,'after');assert.equal(commands[1].afterMessageId,messageId);assert.deepEqual(commands[1].destinations,[file.path]);assert.deepEqual(commands[1].source,source);
  const receipt=findRunImport(document,source,messageId);assert.equal(receipt?.bindingId,registered[0].id);assert.ok(document.includes(responseAnchor(registered[0].id)));
  const once=document;
  assert.equal((await plugin.importRun(file.path,{id:source.projectId},source.threadId,messageId,true)).duplicate,true);
  assert.equal(document,once);assert.equal(registered.length,2);assert.equal(registered[0].id,registered[1].id);assert.equal(finalSaveWaits,phase==='completed'?2:0);assert.equal(displays.length,1);assert.equal(pauses,3);assert.equal(closed,3);
});
