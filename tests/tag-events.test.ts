import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {webcrypto,randomUUID} from 'node:crypto';
import {indexedDB} from 'fake-indexeddb';
import {deviceState} from '../device-state';

const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check:()=>boolean){
  for(let attempt=0;attempt<100&&!check();attempt++)await wait(25);
  assert.ok(check(),'Expected note delivery did not finish');
}

class Events {
  private listeners=new Map<string,Set<(...args:any[])=>void>>();
  on(name:string,callback:(...args:any[])=>void){
    if(!this.listeners.has(name))this.listeners.set(name,new Set());
    this.listeners.get(name)!.add(callback);
    return {off:()=>this.listeners.get(name)?.delete(callback)};
  }
  emit(name:string,...args:any[]){for(const callback of this.listeners.get(name)??[])callback(...args);}
}

async function eventHarness(enabled:boolean){
  const deviceId=randomUUID(),vaultEvents=new Events(),metadataEvents=new Events();
  let local:any={deviceId,mode:'direct',pairedSessions:{c:{url:'https://tags.example',environmentId:'tags-env',token:'dummy-tag-session',expiresAt:Date.now()+600_000}}};
  const project={id:'tag-project',title:'Tasks',workspaceRoot:'/tasks',connectionId:'c',connectionName:'Laptop'};
  const link={id:'folder-link',folderPath:'Tasks',projectId:project.id,projectTitle:project.title,workspaceRoot:project.workspaceRoot,connectionId:'c',self:false,...(enabled?{tagTrigger:{enabled:true,tag:'#ready',deviceId}}:{})};
  const shared:any[]=[],commands:any[]=[],notices:string[]=[];
  const caches=new Map<File,{tags:string[]}>(),files=new Map<string,File>();
  let reads=0,scans=0;
  class Base {}
  class Folder {constructor(public path:string){}}
  class File {
    extension='md';stat={ctime:Date.now(),size:32};content='#ready\nBuild this task.';
    constructor(public path:string){}
    get name(){return this.path.split('/').at(-1)!;}
    get basename(){return this.name.slice(0,-3);}
  }
  class Plugin {
    private events:Array<{off():void}>=[];
    app={
      loadLocalStorage:()=>local,saveLocalStorage:(_:string,value:any)=>{local=value;},
      workspace:{onLayoutReady:()=>{},on:()=>({off(){}})},
      vault:{
        on:vaultEvents.on.bind(vaultEvents),
        getAbstractFileByPath:(path:string)=>files.get(path),
        read:async(file:File)=>{reads++;return file.content;},
        getMarkdownFiles:()=>{scans++;return [...files.values()];},
      },
      metadataCache:{on:metadataEvents.on.bind(metadataEvents),getFileCache:(file:File)=>caches.get(file)},
    };
    async loadData(){return shared.at(-1)??{paired:[{id:'c',name:'Laptop',url:'https://tags.example',environmentId:'tags-env'}],directScanId:'c',directProjects:[project],directSelected:['c:tag-project'],folderLinks:[link]};}
    async saveData(value:any){shared.push(value);}
    addSettingTab(){} addCommand(){}
    registerEvent(event:{off():void}){this.events.push(event);}
    removeEvents(){for(const event of this.events)event.off();}
  }
  const api={Plugin,Platform:{isMobile:true},TFile:File,TFolder:Folder,Modal:Base,FuzzySuggestModal:Base,PluginSettingTab:Base,Notice:class{constructor(text:string){notices.push(text);}},getAllTags:(cache:{tags:string[]})=>cache.tags};
  const fetcher=async(url:string,options:any)=>{
    assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');
    const response=(value:any)=>new Response(JSON.stringify(value));
    if(url.endsWith('/environment'))return response({environmentId:'tags-env',label:'Laptop',orchestrationProtocolVersion:1});
    assert.equal(options.headers.Authorization,'Bearer dummy-tag-session');
    if(url.endsWith('/shell'))return response({projects:[{...project,defaultModelSelection:{instanceId:'codex',model:'default'}}],threads:[]});
    commands.push(JSON.parse(options.body));return response({});
  };
  const module={exports:{} as any};
  runInNewContext(await readFile('main.js','utf8'),{
    module,exports:module.exports,require:(name:string)=>{assert.equal(name,'obsidian');return api;},indexedDB,
    document:{createElement:()=>({innerHTML:'',get textContent(){return this.innerHTML;}})},fetch:fetcher,
    Headers,Response,AbortController,URLSearchParams,URL,TextEncoder,TextDecoder,crypto:webcrypto,setTimeout,clearTimeout,console,
  },{timeout:5000});
  const plugin=new module.exports.default();await plugin.onload();plugin.startTagTriggers();
  assert.equal(scans,0,'Starting tag triggers must not scan existing notes');
  const add=(path:string)=>{const file=new File(path);files.set(path,file);caches.set(file,{tags:['#ready']});return file;};
  const parsed=(file:File,tags:string[])=>{caches.set(file,{tags});metadataEvents.emit('changed',file,file.content,caches.get(file));};
  return {plugin,deviceId,commands,shared,notices,add,parsed,files,vaultEvents,metadataEvents,folder:(path:string)=>new Folder(path),scans:()=>scans,reads:()=>reads,dispose:()=>{plugin.onunload();plugin.removeEvents();}};
}

test('vault events wait for parsed metadata, inert links stay off, and sent receipts survive reparse and rename',{timeout:8000},async()=>{
  const active=await eventHarness(true),inert=await eventHarness(false);
  try{
    const activeNote=active.add('Tasks/note.md'),inertNote=inert.add('Tasks/note.md');
    active.parsed(activeNote,['#ready']);inert.parsed(inertNote,['#ready']);
    await wait(1100);
    assert.equal(active.commands.length,0,'Startup metadata population must not replay a tagged note');
    assert.equal(inert.commands.length,0);
    active.vaultEvents.emit('create',activeNote);inert.vaultEvents.emit('create',inertNote);
    await wait(1100);
    assert.equal(active.commands.length,0,'A vault event alone cannot authorize reading stale parsed tags');
    active.parsed(activeNote,['#ready']);inert.parsed(inertNote,['#ready']);
    await until(()=>active.plugin.tagReceipts[0]?.state==='sent');
    assert.equal(active.commands.length,2);
    assert.equal(active.commands[0].projectId,'tag-project');
    assert.equal(active.commands[0].title,'note');
    assert.equal(active.commands[1].message.text,activeNote.content);
    assert.equal(inert.commands.length,0,'A saved folder link has no trigger until explicitly enabled');
    for(let i=0;i<3;i++){active.vaultEvents.emit('modify',activeNote);active.parsed(activeNote,['#ready']);}
    const oldPath=activeNote.path;active.files.delete(oldPath);activeNote.path='Tasks/renamed.md';active.files.set(activeNote.path,activeNote);
    active.vaultEvents.emit('rename',activeNote,oldPath);
    await until(()=>active.plugin.tagReceipts[0]?.path===activeNote.path);
    active.parsed(activeNote,['#ready']);
    await wait(1100);
    assert.equal(active.commands.length,2,'Repeated parse, modification and rename events must not duplicate a sent thread');
    globalThis.indexedDB=indexedDB;
    const stored=await deviceState(active.deviceId);
    assert.equal(stored.tagReceipts[0].path,'Tasks/renamed.md');
    assert.equal(stored.tagReceipts[0].state,'sent');
    assert.ok(active.shared.every(snapshot=>!('tagReceipts' in snapshot)),'Delivery receipts stay device-local');
    assert.equal(inert.reads(),0);
  }finally{active.dispose();inert.dispose();}
});

test('removing a tag while its previous parse is scheduled cannot send stale tagged content',{timeout:5000},async()=>{
  const h=await eventHarness(true);
  try{
    const note=h.add('Tasks/no-longer-ready.md');
    h.vaultEvents.emit('create',note);
    h.parsed(note,['#ready']);
    note.content='This task is not ready.';
    h.vaultEvents.emit('modify',note);
    await wait(1100);
    assert.equal(h.commands.length,0,'The prior #ready parse must be ignored while the file is dirty');
    assert.equal(h.plugin.tagReceipts.length,0,'A stale parse must not reserve an unsent receipt');
    h.parsed(note,[]);
    await wait(1100);
    assert.equal(h.commands.length,0);
    assert.equal(h.reads(),0);
  }finally{h.dispose();}
});

test('renaming a linked subtree preserves inactive inner links before scheduling moved notes',{timeout:5000},async()=>{
  const h=await eventHarness(true);
  try{
    const parent=h.plugin.settings.folderLinks[0];
    h.plugin.settings.folderLinks.push({...parent,id:'private',folderPath:'Tasks/Private',tagTrigger:undefined},
      {...parent,id:'nested',folderPath:'Tasks/Private/Inner',tagTrigger:undefined});
    const note=h.add('Tasks/Private/note.md');
    h.files.delete(note.path);note.path='Tasks/Renamed/note.md';h.files.set(note.path,note);
    h.vaultEvents.emit('rename',h.folder('Tasks/Renamed'),'Tasks/Private');
    await until(()=>h.scans()===1);
    assert.equal(h.plugin.settings.folderLinks[1].folderPath,'Tasks/Renamed');
    assert.equal(h.plugin.settings.folderLinks[2].folderPath,'Tasks/Renamed/Inner');
    assert.equal(h.shared.at(-1).folderLinks[1].id,'private');
    assert.equal(h.shared.at(-1).folderLinks[1].folderPath,'Tasks/Renamed');
    await wait(1100);
    assert.equal(h.commands.length,0,'A renamed disabled inner link must continue shielding notes from its active parent');
  }finally{h.dispose();}
});

test('moving a self-linked folder disables its trigger until the T3 workspace is refreshed',{timeout:5000},async()=>{
  const h=await eventHarness(true);
  try{
    const link=h.plugin.settings.folderLinks[0];link.self=true;
    const note=h.add('Tasks/note.md');h.files.delete(note.path);note.path='Moved/note.md';h.files.set(note.path,note);
    h.vaultEvents.emit('rename',h.folder('Moved'),'Tasks');
    await until(()=>h.scans()===1);
    assert.equal(link.id,'folder-link');assert.equal(link.folderPath,'Moved');assert.equal(link.tagTrigger.enabled,false);
    assert.equal(link.workspaceRoot,'/tasks','Moving a vault folder must not pretend to update a T3 project path');
    assert.ok(h.notices.some(text=>text.includes('Relink it to self')));
    await wait(1100);assert.equal(h.commands.length,0);
  }finally{h.dispose();}
});

test('turning a tag trigger off ignores an invalid draft tag and failed saves restore its prior state',async()=>{
  const h=await eventHarness(true);
  try{
    const link=h.plugin.settings.folderLinks[0];
    await h.plugin.configureTagTrigger(link,false,'#');
    assert.equal(link.tagTrigger.enabled,false);assert.equal(link.tagTrigger.tag,'#ready');
    assert.equal(h.shared.at(-1).folderLinks[0].tagTrigger.enabled,false);
    h.plugin.save=async()=>{throw Error('Disk full');};
    await assert.rejects(h.plugin.configureTagTrigger(link,true,'#next'),/Disk full/);
    assert.equal(link.tagTrigger.enabled,false);assert.equal(link.tagTrigger.tag,'#ready');
  }finally{h.dispose();}
});
