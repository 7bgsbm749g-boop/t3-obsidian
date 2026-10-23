import {rememberResponse} from '../smart-send';
import {moveSmartNotes} from '../smart-send';
import {commandId} from '../direct';
import {applyThreadItem} from '../inline-thread';
import {responseAnchor} from '../native-response-projection';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {webcrypto,randomUUID} from 'node:crypto';
import {indexedDB} from 'fake-indexeddb';

async function folderMenuHarness(initial?:any){
  const deviceId=randomUUID();let local:any={deviceId,mode:'direct',pairedSessions:{c:{url:'https://folder.example',environmentId:'env',token:'test',expiresAt:Date.now()+600000}}};
  const project={id:'project',title:'Writing',workspaceRoot:'/writing',connectionId:'c',connectionName:'Laptop'};
  const shared:any[]=initial?[initial]:[],modals:any[]=[],notices:string[]=[];
  let shownMenu:any,threadsReply:any[]|undefined,projectsReply:any[]|undefined;
  let fileMenu:(...args:any[])=>void=()=>{},failSave=false,networkRequests=0;
  class Element {
    text='';cls='';tag='';settings:any[]=[];children:Element[]=[];disabled=false;onclick?:()=>any;oninput?:()=>any;value='';
    addClass(){}setAttribute(){}
    createDiv(options?:any){return this.createEl('div',options);}
    querySelector(tag:string):Element|undefined{return this.children.find(child=>child.tag===tag)??this.children.map(child=>child.querySelector(tag)).find(Boolean);}
    empty(){this.settings=[];this.children=[];}
    setText(value:string){this.text=value;}
    events:Record<string,Function>={};
    addEventListener(name:string,callback:Function){this.events[name]=callback;}
    click(){if(!this.disabled)return this.onclick?.()??this.events.click?.();}
    createEl(_tag:string,options?:{text?:string;cls?:string}){const child=new Element();child.tag=_tag;child.text=options?.text??'';child.cls=options?.cls??'';this.children.push(child);return child;}
  }
  class Control {
    value:any;disabled=false;text='';handler:(value?:any)=>any=()=>{};
    inputEl:any={rows:0,addEventListener:()=>{}};buttonEl={isConnected:true,focus:()=>{}};
    setValue(value:any){this.value=value;return this;}
    setPlaceholder(_value:string){return this;}
    addOptions(_value:Record<string,string>){return this;}
    addOption(_key:string,_value:string){return this;}
    setDisabled(value:boolean){this.disabled=value;return this;}
    setButtonText(text:string){this.text=text;return this;}
    setCta(){return this;}
    onChange(handler:(value:any)=>any){this.handler=handler;return this;}
    onClick(handler:()=>any){this.handler=handler;return this;}
    change(value:any){this.value=value;return this.handler(value);}
    async click(){if(!this.disabled)await this.handler();}
  }
  class Setting {
    name='';description='';disabled=false;controls:Control[]=[];
    constructor(element:Element){element.settings.push(this);}
    setClass(_value:string){return this;}
    setName(name:string){this.name=name;return this;}
    setDesc(value:string){this.description=value;return this;}
    setDisabled(value:boolean){this.disabled=value;for(const control of this.controls)control.disabled=value;return this;}
    private add(callback:(control:Control)=>void){const control=new Control();this.controls.push(control);callback(control);return this;}
    addToggle(callback:(control:Control)=>void){return this.add(callback);}
    addText(callback:(control:Control)=>void){return this.add(callback);}
    addTextArea(callback:(control:Control)=>void){return this.add(callback);}
    addDropdown(callback:(control:Control)=>void){return this.add(callback);}
    addButton(callback:(control:Control)=>void){return this.add(callback);}
  }
  class Modal {
    contentEl=new Element();titleEl=new Element();modalEl=new Element();closed=false;
    constructor(public app:any){}
    open(){modals.push(this);(this as any).onOpen?.();}
    close(){this.closed=true;(this as any).onClose?.();}
    setPlaceholder(_value:string){return this;}
  }
  class Base {}
  class Folder {path='Notes';name='Notes';}
  class File {extension='md';constructor(public path:string){}}
  const folder=new Folder();
  class Plugin {
    app={loadLocalStorage:()=>local,saveLocalStorage:(_:string,value:any)=>{local=value;},
      workspace:{getActiveViewOfType:()=>undefined,onLayoutReady:()=>{},on:(name:string,callback:(...args:any[])=>void)=>{if(name==='file-menu')fileMenu=callback;}},
      vault:{getName:()=> 'QLO2',getAbstractFileByPath:(path:string)=>path===folder.path?folder:undefined},
    };
    async loadData(){return {...(shared.at(-1)??{}),paired:[{id:'c',name:'Laptop',url:'https://folder.example',environmentId:'env'}],directScanId:'c',directProjects:[project],directSelected:['c:project']};}
    async saveData(data:any){if(failSave)throw Error('Simulated settings storage failure');shared.push(data);}
    addSettingTab(){}registerEvent(){}addCommand(){}
  }
  class MenuItem {
    title='';disabled=false;submenu?:Menu;callback:(event?:{ctrlKey?:boolean})=>any=()=>{};
    setTitle(title:string){this.title=title;return this;}
    setIcon(_icon:string){return this;}
    setDisabled(value:boolean){this.disabled=value;return this;}
    setSubmenu(){return this.submenu=new Menu();}
    onClick(callback:(event?:{ctrlKey?:boolean})=>any){this.callback=callback;return this;}
  }
  class Menu {
    items:MenuItem[]=[];
    addItem(callback:(item:MenuItem)=>void){const item=new MenuItem();this.items.push(item);callback(item);return this;}
    addSeparator(){return this;}
    showAtPosition(){shownMenu=this;return this;}
  }
  const api={setIcon:()=>{},Plugin,Menu,Platform:{isMobile:true},TFolder:Folder,TFile:File,Modal,FuzzySuggestModal:Modal,EditorSuggest:Base,ItemView:Base,PluginSettingTab:Base,Setting,Notice:class{constructor(text:string){notices.push(text);}}};
  const module={exports:{} as any};
  runInNewContext(await readFile('dist/main.js','utf8'),{
    module,exports:module.exports,window:{innerWidth:1000,innerHeight:700},require:(name:string)=>{assert.equal(name,'obsidian');return api;},indexedDB,
    document:{createElement:()=>({innerHTML:'',get textContent(){return this.innerHTML;}})},
    fetch:async(url:string,options:any)=>{networkRequests++;assert.equal(options?.method??'GET','GET','Folder linking must never dispatch T3 commands');if(threadsReply===undefined&&projectsReply===undefined)throw Error('Link configuration must not dispatch or scan T3');return new Response(JSON.stringify(url.endsWith('/environment')?{environmentId:'env',label:'Laptop',orchestrationProtocolVersion:2}:{threads:threadsReply,projects:projectsReply}));},
    Headers,Response,AbortController,DOMException,URLSearchParams,URL,TextEncoder,TextDecoder,crypto:webcrypto,setTimeout,clearTimeout,console,
  },{timeout:5000});
  const plugin=new module.exports.default();await plugin.onload();
  const open=async()=>{
    const menu=new Menu();fileMenu(menu,folder,'file-explorer-context-menu');
    const entry=menu.items.find(item=>item.title==='Link to T3 Code');assert.ok(entry?.submenu);
    const target=entry.submenu.items.find(item=>item.title.startsWith('Link to Writing · Laptop'));assert.ok(target);
    await target.callback();return modals.at(-1);
  };
  const setting=(modal:Modal,name:string)=>{const all=(el:Element):Setting[]=>[...el.settings,...el.children.flatMap(all)];const item=all(modal.contentEl).find(item=>item.name===name);assert.ok(item);return item as Setting;};
  const button=(modal:Modal,text:string)=>{const all=(el:Element):any[]=>[el,...el.settings.flatMap(setting=>setting.controls),...el.children.flatMap(all)];const item=all(modal.contentEl).find(control=>control.text===text);assert.ok(item);return item as Control;};
  return {plugin,open,setting,button,shared,notices,deviceId,project,modals,shownMenu:()=>shownMenu,setProjects:(value:any[])=>{projectsReply=value;},setThreads:(value:any[])=>{threadsReply=value;},folderMenu:(root=false)=>{const menu=new Menu();const selected=new Folder();if(root){selected.path='/';selected.name='QLO2';}fileMenu(menu,selected,'file-explorer-context-menu');return menu;},fileMenu:(path:string,mobile:boolean)=>{api.Platform.isMobile=mobile;const menu=new Menu();const file=new File(path);fileMenu(menu,file,'file-explorer-context-menu');return {menu,file};},networkRequests:()=>networkRequests,setFailSave:(value:boolean)=>{failSave=value;}};
}

test('agent folder commands use verified metadata, UI persistence, and the subsequent note send route',async()=>{
  const h=await folderMenuHarness();
  try{
    const live={...h.project,title:'Live repository title',workspaceRoot:'/live/repository'};h.setProjects([live]);
    let refreshes=0;h.plugin.folderIndicators={refresh:()=>{refreshes++;},dispose:()=>{}};
    const remembered={notePath:'Notes/A.md',projectId:'previous',threadId:'previous-thread',connectionId:'c',workspaceRoot:'/previous',selectedAt:new Date().toISOString()};
    h.plugin.settings.noteThreads=[remembered];await h.plugin.save();
    const command={version:1,id:randomUUID(),kind:'link-folder',folderPath:'Notes',projectId:'project',connectionId:'c',environmentId:'env',mode:'project',relink:false};
    const result=await h.plugin.executeAgentCommand(command);
    assert.equal(result.directLink.projectTitle,live.title);assert.equal(result.directLink.workspaceRoot,live.workspaceRoot);
    assert.equal(h.shared.at(-1).folderLinks[0].environmentId,'env');assert.ok(refreshes>0);
    assert.equal(h.plugin.settings.pending.length,0);assert.equal(h.modals.length,0);assert.equal(h.plugin.settings.noteThreads[0].threadId,remembered.threadId);
    const requests=h.networkRequests(),saves=h.shared.length;
    assert.equal(JSON.stringify(await h.plugin.executeAgentCommand(command)),JSON.stringify(result));assert.equal(h.networkRequests(),requests);assert.equal(h.shared.length,saves);
    const file={path:'Notes/A.md'};h.plugin.app.vault.getFileByPath=()=>file;
    const sent:any[]=[];h.plugin.send=async(_file:any,project:any,options:any)=>{sent.push({project,options});return {threadId:'new-thread',request:{id:options.id,project}};};
    await h.plugin.executeNoteCommand({version:1,id:randomUUID(),kind:'send-note',notePath:file.path,destinations:[],streamReply:false});
    assert.equal(sent[0].project.workspaceRoot,live.workspaceRoot);assert.equal(sent[0].options.folderLink.id,result.directLink.id);
    assert.equal(h.plugin.settings.noteThreads[0].threadId,remembered.threadId);
    const inspect=await h.plugin.executeAgentCommand({version:1,id:randomUUID(),kind:'inspect-folder',folderPath:'Notes'});assert.equal(inspect.effectiveLink.projectId,'project');
    const unlinked=await h.plugin.executeAgentCommand({version:1,id:randomUUID(),kind:'unlink-folder',folderPath:'Notes'});assert.equal(unlinked.directLink,null);assert.equal(h.shared.at(-1).folderLinks.length,0);
  }finally{h.plugin.onunload();}
});

test('agent failures preserve UI-created links and do not create missing self projects',async()=>{
  const h=await folderMenuHarness();
  try{
    const modal=await h.open();await h.button(modal,'Link').click();const saved=JSON.stringify(h.plugin.settings.folderLinks);
    const make=(extra:any={})=>({version:1,id:randomUUID(),kind:'link-folder',folderPath:'Notes',projectId:'project',connectionId:'c',environmentId:'env',mode:'project',relink:true,...extra});
    await assert.rejects(h.plugin.executeAgentCommand(make({environmentId:'wrong'})),/connection and environment/);assert.equal(JSON.stringify(h.plugin.settings.folderLinks),saved);
    h.setProjects([]);await assert.rejects(h.plugin.executeAgentCommand(make()),/project is unavailable/);assert.equal(JSON.stringify(h.plugin.settings.folderLinks),saved);
    h.setProjects([h.project]);await assert.rejects(h.plugin.executeAgentCommand(make({mode:'self'})),/verified vault project machine/);assert.equal(JSON.stringify(h.plugin.settings.folderLinks),saved);
    h.setProjects([{...h.project,id:'other'}]);h.setFailSave(true);
    const request=make({projectId:'other'});await assert.rejects(h.plugin.executeAgentCommand(request),/storage failure/);assert.equal(JSON.stringify(h.plugin.settings.folderLinks),saved);assert.equal(h.plugin.settings.directProjects[0].id,'project');
    h.setFailSave(false);const result=await h.plugin.executeAgentCommand(request);assert.equal(result.directLink.projectId,'other');
    assert.equal(h.plugin.settings.pending.length,0);assert.equal(h.plugin.settings.noteThreads.length,0);
  }finally{h.plugin.onunload();}
});

test('folder menu opens an inactive link dialog; cancel is inert and Link alone persists',{timeout:5000},async()=>{
  const h=await folderMenuHarness();
  try{
    const saves=h.shared.length;
    const cancelled=await h.open();
    assert.equal(h.plugin.settings.folderLinks.length,0);
    assert.equal(h.shared.length,saves);
    await h.button(cancelled,'Cancel').click();
    assert.equal(cancelled.closed,true);assert.equal(h.shared.length,saves);
    const modal=await h.open();
    await h.button(modal,'Link').click();
    assert.equal(modal.closed,true);
    assert.equal(h.plugin.settings.folderLinks.length,1);
    assert.equal(h.shared.at(-1).folderLinks[0].tagTrigger,undefined);
    assert.equal(h.networkRequests(),0);
  }finally{h.plugin.onunload();}
});

test('link dialog keeps project files external and has no import folder controls',async()=>{
  const h=await folderMenuHarness();
  try{const modal=await h.open();assert.ok(!modal.contentEl.settings.some((s:any)=>s.name==='Image folder'||s.name==='Document and other file folder'));await h.button(modal,'Link').click();assert.equal(modal.closed,true);assert.equal(h.plugin.settings.folderLinks[0].environmentId,'env');assert.equal(h.plugin.settings.folderLinks[0].replyFolders,undefined);}finally{h.plugin.onunload();}
});

test('folder menu exposes project links without a workflow builder',async()=>{
  const h=await folderMenuHarness();
  try{assert.deepEqual(h.folderMenu().items.map((item:any)=>item.title),['Link to T3 Code']);}
  finally{h.plugin.onunload();}
});

for(const mobile of [false,true])test(`note menu in a linked folder offers new and existing threads on ${mobile?'mobile':'desktop'}`,async()=>{
  const h=await folderMenuHarness();
  try{
    const nested={...h.project,id:'nested',title:'Nested'};
    h.plugin.settings.directProjects.push(nested);
    h.plugin.settings.directSelected=[];
    h.plugin.settings.folderLinks=[{id:'parent',folderPath:'Notes',projectId:h.project.id,projectTitle:h.project.title,workspaceRoot:h.project.workspaceRoot,connectionId:'c',self:false},
      {id:'inner',folderPath:'Notes/Inner',projectId:nested.id,projectTitle:nested.title,workspaceRoot:nested.workspaceRoot,connectionId:'c',self:false}];
    h.plugin.chatReadinessError=()=>undefined;
    h.plugin.app.vault.read=async()=> '# Test note';
    const sent:any[]=[];h.plugin.send=async(file:any,project:any,options:any)=>{sent.push({file,project,options});};
    const {menu,file}=h.fileMenu('Notes/Inner/note.md',mobile);
    const item=menu.items.find(item=>item.title==='Send to agent');assert.ok(item);
    await item.callback({ctrlKey:true});
    const choices=h.modals.at(-1);assert.ok(choices);
    assert.equal(choices.constructor.name,'SendDestinationModal');
    assert.equal(choices.titleEl.text,'Send to T3 Code');
    assert.deepEqual(choices.contentEl.settings.flatMap((setting:any)=>setting.controls.map((control:any)=>control.text)),['New thread','Existing thread…']);
    await h.button(choices,'New thread').click();
    assert.equal(sent.length,1);assert.equal(sent[0].file,file);assert.equal(sent[0].project.id,'nested');assert.equal(sent[0].options.threadId,undefined);
    h.plugin.settings.noteThreads.push({notePath:'Notes/Inner/note.md',threadId:'previous-parent-thread',projectId:h.project.id,workspaceRoot:h.project.workspaceRoot,connectionId:'c',selectedAt:'2026-09-28T00:00:00Z'});
    h.setThreads([{id:'thread',projectId:'nested',title:'Existing',updatedAt:'2026-09-19',session:{status:'running',activeTurnId:'turn'},latestTurn:{state:'running'}},
      {id:'foreign',projectId:h.project.id,title:'Remembered project',updatedAt:'2026-09-20'},
      {id:'archived',projectId:'nested',title:'Archived',archivedAt:'2026-09-19'}]);
    if(mobile){h.plugin.openNoteSend(file,true);await h.button(h.modals.at(-1),'Existing thread…').click();}
    else {h.plugin.openNoteSend(file,true);await h.button(h.modals.at(-1),'Existing thread…').click();}
    const picker=h.modals.at(-1);assert.equal(picker.getItems().length,1);
    assert.equal(picker.getItems()[0].id,'foreign');
    assert.match(picker.getItemText(picker.getItems()[0]),/Remembered project · Idle/);
    await picker.onChooseItem(picker.getItems()[0]);
    assert.equal(sent.length,2);assert.equal(sent[1].options.threadId,'foreign');assert.equal(sent[1].project.id,h.project.id);
    h.plugin.settings.folderLinks[1].projectId=h.project.id;
    await picker.onChooseItem(picker.getItems()[0]);
    assert.equal(sent.length,3,'Changing a folder link does not change the displayed project choice');
    assert.equal(sent[2].project.id,h.project.id);
  }finally{h.plugin.onunload();}
});

test('unlinked and root notes open the project-name destination dialog on desktop',async()=>{
  const h=await folderMenuHarness();
  try{
    await h.fileMenu('Unlinked/note.md',false).menu.items[0].callback({ctrlKey:true});
    let modal=h.modals.at(-1);
    assert.equal(modal.host.getProjectName(),'QLO2');
    assert.equal(modal.host.getProjectChoices().slice(0,2).map((item:any)=>item.key).join(','),'folder:new,vault:root');
    modal.close();
    h.plugin.settings.folderLinks=[{id:'root',folderPath:'/',projectId:h.project.id,projectTitle:h.project.title,workspaceRoot:h.project.workspaceRoot,connectionId:'c',self:false}];
    await h.fileMenu('note.md',false).menu.items[0].callback({ctrlKey:true});
    modal=h.modals.at(-1);assert.equal(modal.host.getProjectName(),h.project.title);
    h.plugin.busy=true;assert.equal(h.fileMenu('note.md',false).menu.items[0].disabled,true);
  }finally{h.plugin.onunload();}
});


test('mobile folder menu enables Create T3 project',async()=>{
  const h=await folderMenuHarness();
  try{
    const submenu=h.folderMenu().items.find(item=>item.title==='Link to T3 Code')!.submenu!;
    assert.equal(submenu.items.find(item=>item.title==='Create T3 project…')!.disabled,false);
  }finally{h.plugin.onunload();}
});


for(const mobile of [false,true])test(`folder Unlink follows Create T3 project and removes only the direct link on ${mobile?'mobile':'desktop'}`,async()=>{
  const h=await folderMenuHarness();
  try{
    h.fileMenu('Notes/note.md',mobile);
    const modal=await h.open();await h.button(modal,'Link').click();
    const direct=h.plugin.settings.folderLinks[0];
    const parent={...direct,id:'parent',folderPath:'/'};
    const nested={...direct,id:'nested',folderPath:'Notes/Inner'};
    const unrelated={...direct,id:'unrelated',folderPath:'Other'};
    h.plugin.settings.folderLinks=[parent,direct,nested,unrelated];
    const remembered={notePath:'Notes/note.md',projectId:'project',threadId:'remembered',connectionId:'c',workspaceRoot:'/writing',selectedAt:new Date().toISOString()};
    h.plugin.settings.noteThreads=[remembered];await h.plugin.save();
    let refreshes=0;h.plugin.folderIndicators={refresh:()=>{refreshes++;},dispose:()=>{}};
    h.plugin.projects=()=>[]; // A saved link remains removable while T3 is unavailable.
    const submenu=h.folderMenu().items[0].submenu!;
    const createIndex=submenu.items.findIndex(item=>item.title==='Create T3 project…');
    const unlink=submenu.items[createIndex+1];assert.equal(unlink.title,'Unlink');assert.equal(unlink.disabled,false);
    const requests=h.networkRequests(),modalCount=h.modals.length;
    await unlink.callback();
    assert.equal(h.plugin.settings.folderLinks.map((link:any)=>link.folderPath).join(','),'/,Notes/Inner,Other');
    assert.equal(h.shared.at(-1).folderLinks.map((link:any)=>link.folderPath).join(','),'/,Notes/Inner,Other');
    assert.equal(h.shared.at(-1).folderLinkChanges.find((change:any)=>change.folderPath==='Notes').link,null);
    assert.equal(h.plugin.settings.noteThreads[0].threadId,remembered.threadId);
    assert.equal(h.networkRequests(),requests);assert.equal(h.modals.length,modalCount);assert.ok(refreshes>0);
    assert.equal(h.plugin.settings.pending.length,0);assert.equal(h.notices.at(-1),'Notes unlinked from T3 Code.');
    assert.equal(h.folderMenu().items[0].submenu!.items.find(item=>item.title==='Unlink')!.disabled,true,'An inherited link is not a direct link');
  }finally{h.plugin.onunload();}
});

test('folder Unlink is disabled without a direct link and supports the vault root',async()=>{
  const h=await folderMenuHarness();
  try{
    const unlink=(root=false)=>h.folderMenu(root).items[0].submenu!.items.find(item=>item.title==='Unlink')!;
    assert.equal(unlink().disabled,true);assert.equal(unlink(true).disabled,true);
    const modal=await h.open();await h.button(modal,'Link').click();
    const direct=h.plugin.settings.folderLinks[0];
    h.plugin.settings.folderLinks=[{...direct,id:'root',folderPath:'/'},direct];await h.plugin.save();
    assert.equal(unlink(true).disabled,false);await unlink(true).callback();
    assert.equal(h.plugin.settings.folderLinks.length,1);assert.equal(h.plugin.settings.folderLinks[0].folderPath,'Notes');
    assert.equal(unlink(true).disabled,true);assert.equal(unlink().disabled,false);
    assert.equal(h.networkRequests(),0);
  }finally{h.plugin.onunload();}
});

test('folder Unlink reports a save failure and preserves the link',async()=>{
  const h=await folderMenuHarness();
  try{
    const modal=await h.open();await h.button(modal,'Link').click();
    const before=JSON.stringify(h.plugin.settings.folderLinks),saves=h.shared.length;
    h.setFailSave(true);
    await h.folderMenu().items[0].submenu!.items.find(item=>item.title==='Unlink')!.callback();
    assert.equal(JSON.stringify(h.plugin.settings.folderLinks),before);assert.equal(h.shared.length,saves);
    assert.match(h.notices.at(-1)!,/T3 folder links:.*storage failure/);
    assert.equal(h.folderMenu().items[0].submenu!.items.find(item=>item.title==='Unlink')!.disabled,false);
    assert.equal(h.networkRequests(),0);
  }finally{h.plugin.onunload();}
});

test('Create T3 project browses outside the vault and only links on confirmation',async()=>{
  const h=await folderMenuHarness();
  try{
    const calls:any[]=[];
    h.plugin.projectLocation=async(machine:any)=>({
      browse:async(path:string)=>{calls.push(['browse',machine.id,path]);return {parentPath:path==='~'?'/home/person':path,entries:[]};},
      create:async(path:string,title:string)=>{calls.push(['create',path,title]);return {...h.project,workspaceRoot:path};},
      close:()=>calls.push(['close']),
    });
    const entry=h.folderMenu().items.find(item=>item.title==='Link to T3 Code')!.submenu!.items.find(item=>item.title==='Create T3 project…')!;
    await entry.callback();let modal=h.modals.at(-1);
    assert.equal(modal.titleEl.text,'Create T3 project');await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.filter(c=>c[0]==='create').length,0);
    assert.equal(h.setting(modal,'Project name').controls[0].value,'Notes');
    await h.button(modal,'Home').click();assert.equal(calls.filter(c=>c[0]==='create').length,0);
    await h.button(modal,'Cancel').click();assert.equal(h.plugin.settings.folderLinks.length,0);
    h.plugin.createFolderProject(h.plugin.app.vault.getAbstractFileByPath('Notes'));modal=h.modals.at(-1);
    await new Promise(resolve=>setImmediate(resolve));await h.button(modal,'Existing folder').click();h.setting(modal,'Workspace folder').controls[0].change('/workspaces/app');
    await h.button(modal,'Create and link').click();
    assert.equal(modal.closed,true);
    assert.deepEqual(calls.find(c=>c[0]==='create'),['create','/workspaces/app','Notes']);
    assert.equal(h.plugin.settings.folderLinks[0].folderPath,'Notes');
    assert.equal(h.plugin.settings.folderLinks[0].workspaceRoot,'/workspaces/app');
    assert.equal(h.plugin.settings.folderLinks[0].self,false);
  }finally{h.plugin.onunload();}
});

test('project location errors leave the dialog open without linking',async()=>{
  const h=await folderMenuHarness();
  try{
    let creates=0;
    h.plugin.projectLocation=async()=>({browse:async()=>{throw Error('Folder does not exist');},create:async()=>{creates++;},close:()=>{}});
    h.plugin.createFolderProject({path:'Notes',name:'Notes'});const modal=h.modals.at(-1);
    await new Promise(resolve=>setImmediate(resolve));await h.button(modal,'Existing folder').click();h.setting(modal,'Workspace folder').controls[0].change('/missing');
    await h.button(modal,'Create and link').click();
    assert.equal(modal.closed,false);assert.equal(creates,0);assert.equal(h.plugin.settings.folderLinks.length,0);
    assert.ok(descendants(modal.contentEl).some((el:any)=>el.text==='Cannot create this project. Try again.'));
    await h.button(modal,'Cancel').click();
  }finally{h.plugin.onunload();}
});

test('project creation refuses a browser result that falls back to a parent folder',async()=>{
  const h=await folderMenuHarness();
  try{
    let creates=0;
    h.plugin.projectLocation=async()=>({browse:async()=>({parentPath:'/workspaces',entries:[]}),create:async()=>{creates++;},close:()=>{}});
    h.plugin.createFolderProject({path:'Notes',name:'Notes'});const modal=h.modals.at(-1);
    await new Promise(resolve=>setImmediate(resolve));await h.button(modal,'Existing folder').click();h.setting(modal,'Workspace folder').controls[0].change('/workspaces/missing');
    await h.button(modal,'Create and link').click();
    assert.equal(creates,0);assert.equal(modal.closed,false);assert.equal(h.plugin.settings.folderLinks.length,0);
    await h.button(modal,'Cancel').click();
  }finally{h.plugin.onunload();}
});

test('closing project creation during connection never creates or links',async()=>{
  const h=await folderMenuHarness();
  try{
    let connect!:(value:any)=>void,creates=0,closes=0;
    h.plugin.projectLocation=()=>new Promise(resolve=>{connect=resolve;});
    h.plugin.createFolderProject({path:'Notes',name:'Notes'});const modal=h.modals.at(-1);
    const pending=h.button(modal,'Create and link').click();
    modal.close();connect({browse:async()=>({parentPath:'/workspaces/app',entries:[]}),create:async()=>{creates++;},close:()=>{closes++;}});
    await pending;await new Promise(resolve=>setImmediate(resolve));assert.equal(creates,0);assert.equal(closes,1);assert.equal(h.plugin.settings.folderLinks.length,0);
  }finally{h.plugin.onunload();}
});

for(const cancelled of [true,false])test(`automatic new-project routing ${cancelled?'cancels without sending':'waits for external workspace confirmation'}`,async()=>{
  const h=await folderMenuHarness();
  try{
    const external={...h.project,title:'Chosen workspace',workspaceRoot:'/workspaces/chosen'};
    const creates:any[]=[];
    h.plugin.projectLocation=async()=>({browse:async(path:string)=>({parentPath:path,entries:[]}),create:async(path:string)=>{creates.push(path);return external;},close:()=>{}});
    const pending=h.plugin.chatTarget('Unlinked/note.md',undefined,true);
    const modal=h.modals.at(-1);assert.equal(modal.constructor.name,'ProjectCreateModal');
    assert.equal(h.plugin.settings.pending.length,0);assert.equal(creates.length,0);assert.equal(h.plugin.settings.folderLinks.length,0);
    if(cancelled){
      const rejected=assert.rejects(pending,/Project creation cancelled/);
      await h.button(modal,'Cancel').click();await rejected;
      assert.equal(creates.length,0);assert.equal(h.plugin.settings.folderLinks.length,0);
    }else{
      await new Promise(resolve=>setImmediate(resolve));await h.button(modal,'Existing folder').click();h.setting(modal,'Workspace folder').controls[0].change('/workspaces/chosen');
      await h.button(modal,'Create and link').click();const target=await pending;
      assert.deepEqual(creates,['/workspaces/chosen']);assert.equal(target.link.self,false);assert.equal(target.project.workspaceRoot,external.workspaceRoot);
      assert.equal(h.plugin.settings.folderLinks.length,0,'The send link is saved only after delivery');
      h.plugin.rememberStarted({id:randomUUID(),project:external,connection:{transport:'direct',connectionId:'c'},folderLinkIntent:target.link},'thread');
      assert.equal(h.plugin.settings.folderLinks[0].workspaceRoot,external.workspaceRoot);
    }
  }finally{h.plugin.onunload();}
});

test('agent sends from unlinked folders fail with linking guidance and never open a picker',async()=>{
  const h=await folderMenuHarness();
  try{
    h.plugin.app.vault.getFileByPath=()=>({path:'Unlinked/note.md'});
    await assert.rejects(h.plugin.executeNoteCommand({version:1,id:randomUUID(),kind:'send-note',notePath:'Unlinked/note.md',destinations:[],streamReply:false}),/link-folder.*workspace picker/);
    assert.equal(h.modals.length,0);assert.equal(h.plugin.settings.pending.length,0);
    await assert.rejects(h.plugin.executeNoteCommand({version:1,id:randomUUID(),kind:'attach-response',notePath:'Unlinked/note.md',destinations:[],streamReply:true,threadId:randomUUID(),messageId:randomUUID()}),/link-folder/);
    assert.equal(h.modals.length,0);
  }finally{h.plugin.onunload();}
});

test('workspace exclusion respects Windows case, separators and directory boundaries',async()=>{
  const h=await folderMenuHarness();
  try{
    h.plugin.settings.vaultLocations=[{environmentId:'env',workspaceRoot:'C:\\Users\\Jack\\QLO2'}];
    assert.throws(()=>h.plugin.checkProjectWorkspace({id:'c'},'c:/users/jack/qlo2/Code'),/outside/);
    assert.throws(()=>h.plugin.checkProjectWorkspace({id:'c'},'C:/Users/Jack/Other/../QLO2/Code'),/outside/);
    assert.doesNotThrow(()=>h.plugin.checkProjectWorkspace({id:'c'},'C:/Users/Jack/QLO2-code'));
    assert.doesNotThrow(()=>h.plugin.checkProjectWorkspace({id:'another-machine'},'C:/Users/Jack/QLO2/Code'));
  }finally{h.plugin.onunload();}
});

const descendants=(el:any):any[]=>[el,...el.children.flatMap(descendants)];
const idle=()=>new Promise(resolve=>setImmediate(resolve));

test('linking remembers the parent and machine across restart, browsing and cancellation',async()=>{
  const h=await folderMenuHarness();
  try{
    const project={...h.project,workspaceRoot:'C:\\Projects\\Writing'};
    await h.plugin.saveFolderLink(h.plugin.app.vault.getAbstractFileByPath('Notes'),project,false);
    assert.equal(h.shared.at(-1).projectCreationLocations[0].parentPath,'C:\\Projects');
    const restarted=await folderMenuHarness(h.shared.at(-1));
    try{
      const browsed:any[]=[];
      restarted.plugin.projectLocation=async(machine:any)=>({browse:async(path:string)=>{browsed.push([machine.id,path]);return {parentPath:path,entries:[]};},close:()=>{}});
      restarted.plugin.createFolderProject({path:'Notes',name:'Notes'});let modal=restarted.modals.at(-1);await idle();
      assert.deepEqual(browsed,[['c','C:\\Projects']]);
      const before=JSON.stringify(restarted.plugin.settings.projectCreationLocations);
      await modal.browse('C:\\Elsewhere');modal.close();
      assert.equal(JSON.stringify(restarted.plugin.settings.projectCreationLocations),before);
      restarted.plugin.createFolderProject({path:'Notes',name:'Notes'});modal=restarted.modals.at(-1);await idle();
      assert.equal(restarted.setting(modal,'Parent folder').controls[0].value,'C:\\Projects');modal.close();
    }finally{restarted.plugin.onunload();}
    const previous=JSON.stringify(h.plugin.settings.projectCreationLocations);h.setFailSave(true);
    await assert.rejects(h.plugin.saveFolderLink(h.plugin.app.vault.getAbstractFileByPath('Notes'),{...project,workspaceRoot:'D:\\Other\\Writing'},false),/storage failure/);
    assert.equal(JSON.stringify(h.plugin.settings.projectCreationLocations),previous);
  }finally{h.plugin.onunload();}
});

test('existing external links supply the first default without migration writes',async()=>{
  const h=await folderMenuHarness({vaultId:'existing',folderLinks:[{id:'old',folderPath:'Notes',projectId:'project',projectTitle:'Writing',workspaceRoot:'/projects/writing',connectionId:'c',environmentId:'env',self:false}]});
  try{
    assert.deepEqual(JSON.parse(JSON.stringify(h.plugin.projectWorkspaceDefaults())),{machineId:'c',parentPath:'/projects'});
    assert.equal(h.plugin.settings.projectCreationLocations.length,0);
  }finally{h.plugin.onunload();}
});

test('a failed link retries the created project without making another folder',async()=>{
  const h=await folderMenuHarness();
  try{
    let creates=0;
    h.plugin.projectLocation=async()=>({browse:async()=>({parentPath:'/work',entries:creates?[{name:'Notes',fullPath:'/work/Notes'}]:[]}),create:async(path:string)=>{creates++;return {...h.project,workspaceRoot:path};},close:()=>{}});
    h.plugin.createFolderProject(h.plugin.app.vault.getAbstractFileByPath('Notes'));const modal=h.modals.at(-1);await idle();
    h.setFailSave(true);await h.button(modal,'Create and link').click();
    assert.equal(creates,1);assert.equal(modal.closed,false);assert.equal(h.plugin.settings.projectCreationLocations.length,0);
    h.setFailSave(false);await h.button(modal,'Create and link').click();assert.equal(creates,1);assert.equal(modal.closed,true);
  }finally{h.plugin.onunload();}
});

test('folder search filters compact rows without requests or replacing the search input',async()=>{
  const h=await folderMenuHarness();
  try{
    let browses=0;
    h.plugin.projectLocation=async()=>({browse:async(path:string)=>{browses++;return {parentPath:path==='~'?'/work':path,entries:['Alpha','beta','alphabet','.hidden'].map(name=>({name,fullPath:'/work/'+name}))};},close:()=>{}});
    h.plugin.createFolderProject({path:'Notes',name:'Notes'});const modal=h.modals.at(-1);await idle();
    const search=descendants(modal.contentEl).find(el=>el.tag==='input'&&el.value==='');
    const list=descendants(modal.contentEl).find(el=>el.cls==='send-to-t3-workspace-folders');
    const names=()=>list.children.map((row:any)=>row.children[1]?.text).filter(Boolean);
    assert.deepEqual(names(),['Alpha','alphabet','beta']);
    search.value='ALP';search.oninput();assert.deepEqual(names(),['Alpha','alphabet']);
    assert.ok(descendants(modal.contentEl).includes(search));
    search.value='missing';search.oninput();assert.equal(list.children[0].text,'No matching folders');
    search.value='';search.oninput();assert.equal(browses,1);
    await h.button(modal,'Show hidden').click();assert.ok(names().includes('.hidden'));
    modal.close();
  }finally{h.plugin.onunload();}
});

for(const cancel of [true,false])test(`new workspace folder is ${cancel?'cancelled without creation':'created only on final confirmation'}`,async()=>{
  const h=await folderMenuHarness();
  try{
    const creates:any[]=[];
    h.plugin.projectLocation=async()=>({browse:async()=>({parentPath:'/work',entries:[{name:'existing',fullPath:'/work/existing'}]}),create:async(path:string,title:string,newFolder:any)=>{creates.push({path,title,newFolder});return {...h.project,workspaceRoot:path};},close:()=>{}});
    h.plugin.createFolderProject(h.plugin.app.vault.getAbstractFileByPath('Notes'));const modal=h.modals.at(-1);await idle();
    h.setting(modal,'Project name').controls[0].change('My project');
    const folderInput=()=>descendants(modal.contentEl).find(el=>el.tag==='input'&&el.value==='My project');
    assert.ok(folderInput(),'Folder name follows the project name');
    const firstInput=folderInput();firstInput.value='../escape';firstInput.oninput();await h.button(modal,'Create and link').click();assert.equal(creates.length,0);
    let input=descendants(modal.contentEl).find(el=>el.tag==='input'&&el.value==='../escape');input.value='existing';input.oninput();await h.button(modal,'Create and link').click();assert.equal(creates.length,0);
    assert.ok(descendants(modal.contentEl).some((el:any)=>el.text.includes('already exists')));
    input=descendants(modal.contentEl).find(el=>el.tag==='input'&&el.value==='existing');input.value='New workspace';input.oninput();
    assert.equal(creates.length,0);
    if(cancel){await h.button(modal,'Cancel').click();assert.equal(creates.length,0);assert.equal(h.plugin.settings.folderLinks.length,0);assert.equal(h.plugin.settings.projectCreationLocations.length,0);}
    else{await h.button(modal,'Create and link').click();assert.deepEqual(JSON.parse(JSON.stringify(creates)),[{path:'/work/New workspace',title:'My project',newFolder:{parentPath:'/work',name:'New workspace'}}]);assert.equal(modal.closed,true);assert.equal(h.plugin.settings.folderLinks[0].workspaceRoot,'/work/New workspace');assert.equal(h.plugin.settings.projectCreationLocations[0].parentPath,'/work');}
  }finally{h.plugin.onunload();}
});

test('switching machines restores that machine’s parent and clears the search',async()=>{
  const h=await folderMenuHarness();
  try{
    h.plugin.vaultMachines=()=>[{id:'c',name:'Laptop',environmentId:'env'},{id:'other',name:'Other',environmentId:'other-env'}];
    h.plugin.settings.projectCreationLocations=[{connectionId:'c',environmentId:'env',parentPath:'C:\\Projects',selectedAt:'2026-10-20T12:00:00Z'},{connectionId:'other',environmentId:'other-env',parentPath:'/work',selectedAt:'2026-10-20T11:00:00Z'}];
    const browsed:any[]=[];
    h.plugin.projectLocation=async(machine:any)=>({browse:async(path:string)=>{browsed.push([machine.id,path]);return {parentPath:path,entries:[]};},close:()=>{}});
    h.plugin.createFolderProject({path:'Notes',name:'Notes'});const modal=h.modals.at(-1);await idle();
    assert.equal(h.setting(modal,'Machine').controls[0].value,'c');assert.equal(h.setting(modal,'Parent folder').controls[0].value,'C:\\Projects');
    const search=descendants(modal.contentEl).find(el=>el.tag==='input'&&el.value==='');search.value='test';search.oninput();
    h.setting(modal,'Machine').controls[0].change('other');await idle();
    assert.equal(h.setting(modal,'Parent folder').controls[0].value,'/work');assert.equal(modal.query,'');
    assert.deepEqual(browsed,[['c','C:\\Projects'],['other','/work']]);modal.close();
  }finally{h.plugin.onunload();}
});

test('newly paired machines keep their selection when their discovery ID becomes a connection ID',async()=>{
  const h=await folderMenuHarness();
  try{
    let paired=false;
    h.plugin.vaultMachines=()=>[{id:paired?'new-connection':'environment:new-env',environmentId:'new-env',name:'New machine'}];
    h.plugin.projectLocation=async()=>{paired=true;return {browse:async()=>({parentPath:'/projects',entries:[]}),close:()=>{}};};
    h.plugin.createFolderProject({path:'Notes',name:'Notes'});const modal=h.modals.at(-1);await idle();
    assert.equal(h.setting(modal,'Machine').controls[0].value,'new-connection');
    assert.ok(modal.contentEl.children.some((el:any)=>el.cls==='send-to-t3-project-body'));
    assert.ok(modal.contentEl.settings.some((setting:any)=>setting.controls.some((control:any)=>control.text==='Create and link')),'Actions stay outside the scrolling form');
    modal.close();
  }finally{h.plugin.onunload();}
});

test('whole-note sends, command-bar asks and confirmed receipts use one Smart Send history',async()=>{
 const h=await folderMenuHarness();
 try{
  const {file}=h.fileMenu('Notes/Smart.md',false);Object.assign(file,{basename:'Smart',stat:{ctime:123}});
  let document='First instruction.';const sent:any[]=[];
  h.plugin.app.vault.read=async()=>document;h.plugin.app.vault.getFileByPath=()=>file;
  h.plugin.settings.autoSettleThreads=false;h.plugin.settings.inlineStreaming.enabled=false;
  h.plugin.settings.folderLinks=[{id:'link',folderPath:'Notes',connectionId:'c',environmentId:'env',projectId:h.project.id,projectTitle:h.project.title,workspaceRoot:h.project.workspaceRoot}];
  h.plugin.requestTitle=async()=> 'Smart';
  h.plugin.readChatThread=async()=>({id:'smart-thread',projectId:h.project.id,title:'Smart',session:{status:'ready',activeTurnId:null},latestTurn:{state:'completed'}});
  h.plugin.dispatch=async(request:any)=>{sent.push(request);h.plugin.rememberStarted(request,'smart-thread');await h.plugin.save();return 'smart-thread';};
  await h.plugin.send(file,h.project,{streamReply:false,throwOnError:true});assert.equal(sent.length,1);assert.match(sent[0].prompt,/First instruction/);
  const response='Agent final answer.';await rememberResponse(h.plugin.smartData(),file.path,'reply',response,'First instruction.\n','',19);
  document+='\n'+response+'\nSecond instruction.';
  await h.plugin.send(file,h.project,{streamReply:false,throwOnError:true});assert.equal(sent.length,2);assert.match(sent[1].prompt,/Second instruction/);assert.doesNotMatch(sent[1].prompt,/First instruction|Agent final/);
  await h.plugin.send(file,h.project,{streamReply:false,throwOnError:true});assert.equal(sent.length,2);assert.ok(h.notices.includes('Nothing new to send.'));
  const editor={getValue:()=>document,getSelection:()=>'',getCursor:()=>({line:0,ch:0}),posToOffset:()=>0},view={file,editor};
  h.plugin.app.workspace.getActiveViewOfType=()=>view;
  await h.plugin.openManualAction(file,'Why?', '',{editor,view},false);
  assert.equal(sent.length,3);assert.match(sent[2].prompt,/Question:\nWhy\?/);assert.doesNotMatch(sent[2].prompt,/First instruction|Second instruction|Agent final/);
  const selected='First instruction.',firstAnchor={text:selected,start:0,end:selected.length,before:'',after:document.slice(selected.length,selected.length+80)};
  await h.plugin.openManualAction(file,'Which passage?',selected,{editor,view,anchor:firstAnchor,canonicalAnchor:firstAnchor,snapshot:document},false);
  assert.equal(sent.length,4);assert.match(sent[3].prompt,/Selection reference: First instruction\./);assert.doesNotMatch(sent[3].prompt,/Second instruction|Agent final/);
  const start=document.indexOf(response),replyAnchor={text:response,start,end:start+response.length,before:document.slice(Math.max(0,start-80),start),after:document.slice(start+response.length,start+response.length+80)};
  await h.plugin.openManualAction(file,'Explain this reply.',response,{editor,view,anchor:replyAnchor,canonicalAnchor:replyAnchor,snapshot:document},false);
  assert.equal(sent.length,5);assert.match(sent[4].prompt,/Selected text:\nAgent final answer\./);assert.doesNotMatch(sent[4].prompt,/First instruction|Second instruction/);
 }finally{h.plugin.onunload();}
});

for(const confirmed of [false,true])test(`import selects its source for automatic Smart Send (existing coverage=${confirmed})`,async()=>{
 const h=await folderMenuHarness();
 try{
  const {file}=h.fileMenu('Notes/Import.md',false);Object.assign(file,{basename:'Import',stat:{ctime:123}});
  let document=confirmed?'Earlier instruction.':'';const sent:any[]=[],registered:any[]=[];
  h.plugin.app.vault.read=async()=>document;h.plugin.app.vault.getFileByPath=(path:string)=>path===file.path?file:undefined;
  h.plugin.app.vault.process=async(_file:any,change:(text:string)=>string)=>document=change(document);
  h.plugin.app.workspace.getLeavesOfType=()=>[];
  h.plugin.settings.autoSettleThreads=false;h.plugin.settings.inlineStreaming.enabled=false;
  h.plugin.requestTitle=async()=> 'Import';
  const threadId=randomUUID(),messageId=randomUUID(),source={environmentId:'env',projectId:h.project.id,threadId};
  h.plugin.readChatThread=async()=>({id:threadId,projectId:h.project.id,title:'Imported thread',session:{status:'ready',activeTurnId:null},latestTurn:{state:'completed'}});
  h.plugin.dispatch=async(request:any)=>{sent.push(request);h.plugin.rememberStarted(request,threadId);await h.plugin.save();return threadId;};
  if(confirmed)await h.plugin.send(file,h.project,{threadId,streamReply:false,throwOnError:true});
  h.plugin.rememberNoteThread(h.plugin.noteThreadIntent(file.path,h.project,{environmentId:'env'}),'other-thread');
  const state=applyThreadItem({messages:[],activities:[]},{kind:'snapshot',snapshot:{thread:{messages:[{id:messageId,role:'user',text:'Imported prompt',createdAt:'2026-10-20T00:00:00Z',turnId:'run',streaming:false},{id:'answer',role:'assistant',text:'Imported answer',createdAt:'2026-10-20T00:01:00Z',turnId:'run',streaming:false}],activities:[],latestTurn:{turnId:'run',messageId,requestedAt:'2026-10-20T00:00:00Z',state:'completed'},session:{status:'ready',activeTurnId:null}}}}).state;
  h.plugin.readImportHistory=async()=>({source,state,title:'Imported thread'});
  h.plugin.localResponseTarget=async()=>({environmentId:'env',workspaceRoot:'/vault',directory:'.obsidian/inline'});
  const originalInline=h.plugin.deviceInline;
  h.plugin.deviceInline={register:async(request:any)=>{registered.push(request);},waitForSave:async(id:string)=>{
   const body='Imported prompt\n\nImported answer',at=document.indexOf(responseAnchor(id));
   await rememberResponse(h.plugin.smartData(),file.path,id,body,document.slice(0,at),document.slice(at+responseAnchor(id).length),at);
   document=document.replace(responseAnchor(id),body);return {saved:true};
  },dispose:()=>originalInline?.dispose()};
  const before=sent.length;await h.plugin.importRun(file.path,h.project,threadId,messageId,false);
  assert.equal(sent.length,before,'import must not send input');assert.equal(registered.length,1);
  assert.equal(h.plugin.noteThread(file.path).threadId,threadId);assert.equal(h.plugin.noteThread(file.path).connectionId,'c');
  assert.equal(h.shared.at(-1).noteThreads.find((entry:any)=>entry.threadId===threadId).environmentId,'env');
  document+='\nFresh follow-up.';const modalCount=h.modals.length;
  await h.plugin.openNoteSend(file);
  assert.equal(h.modals.length,modalCount,'automatic continuation must not open the selector');assert.equal(sent.length,before+1);
  assert.equal(sent.at(-1).threadId,threadId);assert.equal(sent.at(-1).project.id,h.project.id);
  assert.match(sent.at(-1).prompt,/Fresh follow-up/);assert.doesNotMatch(sent.at(-1).prompt,/Earlier instruction|Imported prompt|Imported answer|t3-run-import/);
  const heads=JSON.stringify(h.plugin.smartData().heads);
  await h.plugin.importRun(file.path,h.project,threadId,messageId,false);
  assert.equal(JSON.stringify(h.plugin.smartData().heads),heads,'reimport must preserve confirmed coverage');
  document+='\nSecond follow-up.';await h.plugin.openNoteSend(file);
  assert.match(sent.at(-1).prompt,/Second follow-up/);assert.doesNotMatch(sent.at(-1).prompt,/Fresh follow-up|Earlier instruction|Imported prompt|Imported answer/);
 }finally{h.plugin.onunload();}
});

test('bundled Send and Ask recover a source renamed through delete/create before dispatch',async()=>{
 const h=await folderMenuHarness();
 try{
  const original='Notes/Untitled.md',renamed='Notes/Named.md',requestId=randomUUID(),binding=commandId(requestId,`binding:${original}`);
  const {file}=h.fileMenu(original,false);Object.assign(file,{basename:'Untitled',stat:{ctime:123}});
  let document='First instruction.';const sent:any[]=[];
  h.plugin.app.vault.read=async()=>document;h.plugin.app.vault.getFileByPath=(path:string)=>path===file.path?file:undefined;
  h.plugin.app.vault.getAbstractFileByPath=h.plugin.app.vault.getFileByPath;h.plugin.app.vault.getMarkdownFiles=()=>[file];
  h.plugin.app.workspace.getLeavesOfType=()=>[];
  h.plugin.settings.autoSettleThreads=false;h.plugin.settings.inlineStreaming.enabled=false;
  h.plugin.settings.folderLinks=[{id:'link',folderPath:'Notes',connectionId:'c',environmentId:'env',projectId:h.project.id,projectTitle:h.project.title,workspaceRoot:h.project.workspaceRoot}];
  h.plugin.requestTitle=async()=> 'Named';h.plugin.dispatch=async(request:any)=>{sent.push(request);h.plugin.rememberStarted(request,'smart-thread');await h.plugin.save();return 'smart-thread';};
  await h.plugin.send(file,h.project,{id:requestId,streamReply:false,throwOnError:true});
  const oldId=sent[0].smartSend.noteId;
  moveSmartNotes(h.plugin.smartData(),original);file.path=renamed;
  document+=` Added detail.\n:::send-to-t3-response data-t3-response="${binding}"\n\n\n\n:::/send-to-t3-response`;
  // Model discovery on the receiving device before settings catch up.
  await rememberResponse(h.plugin.smartData(),renamed,'unrelated-reply','Other response.','','',0);
  await h.plugin.send(file,h.project,{threadId:'smart-thread',streamReply:false,throwOnError:true});
  assert.equal(sent.length,2);assert.match(sent[1].prompt,/Added detail/);assert.doesNotMatch(sent[1].prompt,/First instruction/);
  assert.equal(h.plugin.smartData().notes[oldId].path,renamed);assert.ok(!h.plugin.smartData().notes[oldId].deleted);
  const editor={getValue:()=>document,getSelection:()=>'',getCursor:()=>({line:0,ch:0}),posToOffset:()=>0},view={file,editor};
  document=document.replace('Added detail.','Added detail. Another detail.');
  await h.plugin.sendChat(document,{path:renamed},{threadId:'smart-thread',sourceContext:{editor,view,smartDocument:document,smartQuestion:'Why?'}});
  assert.match(sent[2].prompt,/Another detail/);assert.match(sent[2].prompt,/Question:\nWhy\?/);assert.doesNotMatch(sent[2].prompt,/First instruction|Added detail/);
 }finally{h.plugin.onunload();}
});

async function runningSmartSendHarness(){
 const h=await folderMenuHarness();
 const {file}=h.fileMenu('Notes/Steering.md',false);Object.assign(file,{basename:'Steering',stat:{ctime:123}});
 let document='First instruction.';const sent:any[]=[];let newBlocks=0;
 const editor={getValue:()=>document,getSelection:()=>'',getCursor:()=>({line:0,ch:0}),posToOffset:(pos:any)=>pos.offset??0,offsetToPos:(offset:number)=>({line:0,ch:0,offset}),replaceRange:(text:string,from:any,to:any)=>{document=document.slice(0,from.offset)+text+document.slice(to.offset);}};
 const view={file,editor,getMode:()=> 'source',getViewData:()=>document,save:async()=>{}};
 h.plugin.app.workspace.getActiveViewOfType=()=>view;h.plugin.app.workspace.getLeavesOfType=()=>[{view}];
 h.plugin.app.vault.read=async()=>document;h.plugin.app.vault.getFileByPath=(path:string)=>path===file.path?file:undefined;
 h.plugin.settings.autoSettleThreads=false;h.plugin.settings.inlineStreaming.enabled=true;
 h.plugin.settings.folderLinks=[{id:'link',folderPath:'Notes',connectionId:'c',environmentId:'env',projectId:h.project.id,projectTitle:h.project.title,workspaceRoot:h.project.workspaceRoot}];
 h.plugin.editorForNoteSend=async()=>view;h.plugin.notePromptDocument=()=>document;h.plugin.recoverSmartReplies=async()=>{};
 h.plugin.requestTitle=async()=> 'Steering';
 let active=true;
 h.plugin.readChatThread=async()=>({id:'smart-thread',projectId:h.project.id,title:'Steering',session:{status:active?'running':'ready',activeTurnId:active?'turn':null},latestTurn:{turnId:'turn',state:active?'running':'completed'}});
 h.plugin.dispatch=async(request:any)=>{sent.push(request);h.plugin.rememberStarted(request,'smart-thread');await h.plugin.save();return 'smart-thread';};
 await h.plugin.send(file,h.project,{newThread:true,streamReply:false,throwOnError:true});
 const id=randomUUID(),host={environmentId:'env',workspaceRoot:'/writing',directory:'.obsidian/t3-code'};
 const binding={version:4,localOnly:true,nativeProjection:true,responseContainer:true,id,vaultId:h.plugin.settings.vaultId,host,notePath:file.path,threadId:'smart-thread',messageId:randomUUID(),projectId:h.project.id,threadEnvironmentId:'env',initialOwner:randomUUID(),initialHash:'a'.repeat(64),createdAt:new Date().toISOString(),keepIntermediate:true,intermediateMode:'collapse',finalAnswerFormat:'raw-markdown'};
 const record={request:binding,state:{turnId:'turn',status:'running',notePath:file.path}};
 h.plugin.settings.responseBindings={[id]:{version:1,clock:1,actor:'test',request:binding}};
 h.plugin.deviceInline={cachedResponse:(target:string)=>target===id?{record,host}:undefined,dispose:()=>{}};
 h.plugin.localResponseTarget=async()=>host;
 const prepare=h.plugin.prepareStreamBindings.bind(h.plugin);
 h.plugin.prepareStreamBindings=async(...args:any[])=>{await prepare(...args);newBlocks+=args[0].inlineBindings?.length??0;};
 const originalInline=h.plugin.inlineChat;
 h.plugin.inlineChat={activeFor:()=>[],find:()=>undefined,reserve:()=>{throw Error('Steering must not reserve a block');},reserveAtEnd:()=>{throw Error('Steering must not reserve a block');},start:()=>{},dispose:()=>originalInline?.dispose()};
 const anchor=`:::send-to-t3-response data-t3-response="${id}"\n\n\n\n:::/send-to-t3-response`;
 document+='\n'+anchor+'\nSecond instruction.';
 return {...h,file,editor,view,id,record,sent,newBlocks:()=>newBlocks,setActive:(value:boolean)=>{active=value;},setDocument:(value:string)=>{document=value;},document:()=>document};
}

test('whole-note Smart Send steers the running response without a new stream',async()=>{
 const h=await runningSmartSendHarness();
 try{
  await h.plugin.openManualAction(h.file,'','',{editor:h.editor,view:h.view},false);
  const request=h.sent.at(-1);assert.equal(h.sent.length,2);assert.equal(request.inlineSteering.jobId,h.id);
  assert.equal(h.newBlocks(),0);assert.equal(request.inlineHost,undefined);assert.equal(request.inlineBindings.length,0);
  assert.match(request.prompt,/Second instruction/);assert.doesNotMatch(request.prompt,/First instruction/);
  assert.match(request.inlineSteering.input.text,/Second instruction/);assert.doesNotMatch(request.inlineSteering.input.text,/First instruction|Sent from Obsidian/);
  assert.equal(request.jobOptions.inline.intermediateMode,'collapse');assert.equal(request.jobOptions.inline.finalAnswerFormat,'raw-markdown');
  assert.deepEqual(Array.from(h.plugin.requestBindingIds(request)),[h.id]);
 }finally{h.plugin.onunload();}
});

for(const enabled of [true,false])test(`explicit existing-thread Ask reuses the stream with draft streaming ${enabled?'on':'off'}`,async()=>{
 const h=await runningSmartSendHarness();
 try{
  const context={editor:h.editor,view:h.view,smartDocument:h.document(),smartQuestion:'Why this change?'};
  await h.plugin.sendResolvedChat('outdated unfiltered draft',{path:h.file.path},context,true,{threadId:'smart-thread',expectedProjectKey:'c:project',jobOptions:{inline:{enabled,intermediateMode:'remove',keepIntermediate:false,finalAnswerFormat:'formatted'}}});
  const request=h.sent.at(-1);assert.equal(h.sent.length,2);assert.equal(h.newBlocks(),0);
  assert.equal(request.inlineSteering.jobId,h.id);assert.equal(request.jobOptions.inline.enabled,true);
  assert.match(request.inlineSteering.input.text,/Second instruction/);assert.match(request.inlineSteering.input.text,/Question:\nWhy this change\?/);
  assert.doesNotMatch(request.inlineSteering.input.text,/First instruction|outdated unfiltered draft/);
 }finally{h.plugin.onunload();}
});

test('selected source uses the same delta in steering and delivery',async()=>{
 const h=await runningSmartSendHarness();
 try{
  const document=h.document(),start=document.indexOf('Second instruction.'),end=start+'Second instruction.'.length;
  const anchor={text:'Second instruction.',start,end,before:document.slice(Math.max(0,start-24),start),after:document.slice(end,end+24)};
  const context={editor:h.editor,view:h.view,anchor,canonicalAnchor:anchor,smartDocument:document,smartScope:[start,end],smartQuestion:''};
  await h.plugin.sendResolvedChat('First instruction.\nSecond instruction.',{path:h.file.path},context,true,{threadId:'smart-thread',expectedProjectKey:'c:project'});
  const request=h.sent.at(-1);assert.equal(request.inlineSteering.jobId,h.id);assert.equal(request.inlineSteering.input.text,'Second instruction.');
  assert.equal(request.inlineSteering.input.selection.text,'Second instruction.');assert.equal(h.newBlocks(),0);
 }finally{h.plugin.onunload();}
});

test('a reloaded unbound response blocks a second stream until its turn is known',async()=>{
 const h=await runningSmartSendHarness();
 try{
  h.record.state.turnId=undefined as any;
  await assert.rejects(h.plugin.send(h.file,h.project,{throwOnError:true}),/reconnecting/);
  assert.equal(h.sent.length,1);assert.equal(h.newBlocks(),0);
  h.record.state.turnId='turn';
  await h.plugin.send(h.file,h.project,{throwOnError:true});
  assert.equal(h.sent.length,2);assert.equal(h.sent.at(-1).inlineSteering.jobId,h.id);
 }finally{h.plugin.onunload();}
});

test('a completed response permits a new stream and explicit New remains independent',async()=>{
 for(const newThread of [false,true]){
  const h=await runningSmartSendHarness();
  try{
   if(!newThread){h.setActive(false);h.setDocument('First instruction.\nSaved final reply.\nSecond instruction.');}
   await h.plugin.send(h.file,h.project,{newThread,throwOnError:true});
   const request=h.sent.at(-1);assert.equal(request.inlineSteering,undefined);assert.equal(h.newBlocks(),1);
   assert.notEqual(request.inlineBindings[0].id,h.id);
  }finally{h.plugin.onunload();}
 }
});

test('mirrored destinations reuse each active stream and only add genuinely new destinations',async()=>{
 const h=await runningSmartSendHarness();
 try{
  const mirror={...h.record.request,id:randomUUID(),notePath:'Notes/Mirror.md'},fresh={path:'Notes/Fresh.md'};
  const mirrorFile={path:mirror.notePath};const docs=new Map([[mirror.notePath,`:::send-to-t3-response data-t3-response="${mirror.id}"\n\n\n\n:::/send-to-t3-response`],[fresh.path,'A fresh destination.']]);
  const host=h.record.request.host;
  h.plugin.settings.responseBindings[mirror.id]={version:1,clock:1,actor:'test',request:mirror};
  h.plugin.deviceInline.cachedResponse=(id:string)=>id===h.id?{record:h.record,host}:id===mirror.id?{record:{request:mirror,state:{turnId:'turn',status:'running',notePath:mirror.notePath}},host}:undefined;
  h.plugin.app.vault.getFileByPath=(path:string)=>path===h.file.path?h.file:path===mirror.notePath?mirrorFile:path===fresh.path?fresh:undefined;
  h.plugin.app.vault.read=async(file:any)=>file.path===h.file.path?h.document():docs.get(file.path);
  h.plugin.app.vault.process=async(file:any,change:Function)=>{const next=change(docs.get(file.path));docs.set(file.path,next);return next;};
  await h.plugin.send(h.file,h.project,{threadId:'smart-thread',destinations:[h.file.path,mirror.notePath,fresh.path],throwOnError:true});
  const request=h.sent.at(-1);assert.equal(h.newBlocks(),1);assert.equal(request.inlineBindings[0].notePath,fresh.path);
  assert.deepEqual(Array.from(request.inlineSteering.targets,(target:any)=>target.jobId),[h.id,mirror.id]);
  assert.deepEqual(Array.from(h.plugin.requestBindingIds(request)),[request.inlineBindings[0].id,h.id,mirror.id]);
  assert.equal((docs.get(mirror.notePath)!.match(/data-t3-response=/g)??[]).length,1);
 }finally{h.plugin.onunload();}
});

test('a failed preparation neither stops the old stream nor confirms its added text',async()=>{
 const h=await runningSmartSendHarness();
 try{
  let discarded=0,stopped=0;
  h.plugin.deviceInline.discardSteering=async()=>{discarded++;};
  h.plugin.deviceInline.stopLocally=()=>{stopped++;};
  const before=h.document();
  await assert.rejects(h.plugin.send(h.file,h.project,{throwOnError:true,onPrepared:async()=>{throw Error('Synthetic preparation failure');}}),/Synthetic preparation failure/);
  assert.equal(discarded,1);assert.equal(stopped,0);assert.equal(h.document(),before);assert.equal(h.sent.length,1);
  await h.plugin.send(h.file,h.project,{throwOnError:true});
  assert.equal(h.sent.length,2);assert.equal(h.sent.at(-1).inlineSteering.jobId,h.id);assert.match(h.sent.at(-1).inlineSteering.input.text,/Second instruction/);
 }finally{h.plugin.onunload();}
});
