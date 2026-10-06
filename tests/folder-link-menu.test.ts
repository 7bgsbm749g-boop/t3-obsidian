import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {webcrypto,randomUUID} from 'node:crypto';
import {indexedDB} from 'fake-indexeddb';

async function folderMenuHarness(){
  const deviceId=randomUUID();let local:any={deviceId,mode:'direct',pairedSessions:{c:{url:'https://folder.example',environmentId:'env',token:'test',expiresAt:Date.now()+600000}}};
  const project={id:'project',title:'Writing',workspaceRoot:'/writing',connectionId:'c',connectionName:'Laptop'};
  const shared:any[]=[],modals:any[]=[],notices:string[]=[];
  let shownMenu:any,threadsReply:any[]|undefined,projectsReply:any[]|undefined;
  let fileMenu:(...args:any[])=>void=()=>{},failSave=false,networkRequests=0;
  class Element {
    text='';cls='';settings:any[]=[];children:Element[]=[];
    empty(){this.settings=[];this.children=[];}
    setText(value:string){this.text=value;}
    events:Record<string,Function>={};
    addEventListener(name:string,callback:Function){this.events[name]=callback;}
    click(){return this.events.click?.();}
    createEl(_tag:string,options?:{text?:string;cls?:string}){const child=new Element();child.text=options?.text??'';child.cls=options?.cls??'';this.children.push(child);return child;}
  }
  class Control {
    value:any;disabled=false;text='';handler:(value?:any)=>any=()=>{};
    inputEl:any={rows:0};buttonEl={isConnected:true,focus:()=>{}};
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
    contentEl=new Element();titleEl=new Element();closed=false;
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
    title='';disabled=false;submenu?:Menu;callback:()=>any=()=>{};
    setTitle(title:string){this.title=title;return this;}
    setIcon(_icon:string){return this;}
    setDisabled(value:boolean){this.disabled=value;return this;}
    setSubmenu(){return this.submenu=new Menu();}
    onClick(callback:()=>any){this.callback=callback;return this;}
  }
  class Menu {
    items:MenuItem[]=[];
    addItem(callback:(item:MenuItem)=>void){const item=new MenuItem();this.items.push(item);callback(item);return this;}
    addSeparator(){return this;}
    showAtPosition(){shownMenu=this;return this;}
  }
  const api={Plugin,Menu,Platform:{isMobile:true},TFolder:Folder,TFile:File,Modal,FuzzySuggestModal:Modal,EditorSuggest:Base,ItemView:Base,PluginSettingTab:Base,Setting,Notice:class{constructor(text:string){notices.push(text);}}};
  const module={exports:{} as any};
  runInNewContext(await readFile('dist/main.js','utf8'),{
    module,exports:module.exports,window:{innerWidth:1000,innerHeight:700},require:(name:string)=>{assert.equal(name,'obsidian');return api;},indexedDB,
    document:{createElement:()=>({innerHTML:'',get textContent(){return this.innerHTML;}})},
    fetch:(url:string,options:any)=>{networkRequests++;assert.equal(options?.method??'GET','GET','Folder linking must never dispatch T3 commands');if(threadsReply===undefined&&projectsReply===undefined)throw Error('Link configuration must not dispatch or scan T3');return new Response(JSON.stringify(url.endsWith('/environment')?{environmentId:'env',label:'Laptop',orchestrationProtocolVersion:1}:{threads:threadsReply,projects:projectsReply}));},
    Headers,Response,AbortController,URLSearchParams,URL,TextEncoder,TextDecoder,crypto:webcrypto,setTimeout,clearTimeout,console,
  },{timeout:5000});
  const plugin=new module.exports.default();await plugin.onload();
  const open=async()=>{
    const menu=new Menu();fileMenu(menu,folder,'file-explorer-context-menu');
    const entry=menu.items.find(item=>item.title==='Link to T3 Code');assert.ok(entry?.submenu);
    const target=entry.submenu.items.find(item=>item.title.startsWith('Link to Writing · Laptop'));assert.ok(target);
    await target.callback();return modals.at(-1);
  };
  const setting=(modal:Modal,name:string)=>{const item=modal.contentEl.settings.find(item=>item.name===name);assert.ok(item);return item as Setting;};
  const button=(modal:Modal,text:string)=>{const item=modal.contentEl.settings.flatMap(setting=>setting.controls).find(control=>control.text===text);assert.ok(item);return item as Control;};
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
    const item=menu.items.find(item=>item.title==='Open in T3 Code');assert.ok(item);
    await item.callback();
    const choices=h.modals.at(-1);assert.ok(choices);
    assert.equal(choices.constructor.name,'SendDestinationModal');
    assert.equal(choices.titleEl.text,'Send to T3 Code');
    assert.deepEqual(choices.contentEl.settings.flatMap((setting:any)=>setting.controls.map((control:any)=>control.text)),['New thread','Existing thread…']);
    await h.button(choices,'New thread').click();
    assert.equal(sent.length,1);assert.equal(sent[0].file,file);assert.equal(sent[0].project.id,'nested');assert.equal(sent[0].options.threadId,undefined);
    h.plugin.settings.noteThreads.push({notePath:'Notes/Inner/note.md',threadId:'previous-parent-thread',projectId:h.project.id,workspaceRoot:h.project.workspaceRoot,connectionId:'c',selectedAt:'2026-09-28T00:00:00Z'});
    h.setThreads([{id:'thread',projectId:'nested',title:'Existing',updatedAt:'2026-09-19',session:{status:'running',activeTurnId:'turn'},latestTurn:{state:'running'}},
      {id:'foreign',projectId:h.project.id,title:'Wrong project',updatedAt:'2026-09-20'},
      {id:'archived',projectId:'nested',title:'Archived',archivedAt:'2026-09-19'}]);
    if(mobile){h.plugin.openNoteSend(file);await h.button(h.modals.at(-1),'Existing thread…').click();}
    else {h.plugin.openNoteSend(file);await h.button(h.modals.at(-1),'Existing thread…').click();}
    const picker=h.modals.at(-1);assert.equal(picker.getItems().length,1);
    assert.equal(picker.getItems()[0].id,'thread');
    assert.match(picker.getItemText(picker.getItems()[0]),/Existing · Active/);
    await picker.onChooseItem(picker.getItems()[0]);
    assert.equal(sent.length,2);assert.equal(sent[1].options.threadId,'thread');assert.equal(sent[1].project.id,'nested');
    h.plugin.settings.folderLinks[1].projectId=h.project.id;
    await picker.onChooseItem(picker.getItems()[0]);
    assert.equal(sent.length,2,'Changing the link while choosing a thread must not send to a stale target');
    assert.match(h.notices.at(-1)!,/linked project changed/i);
  }finally{h.plugin.onunload();}
});

test('unlinked and root notes open the project-name destination dialog on desktop',async()=>{
  const h=await folderMenuHarness();
  try{
    await h.fileMenu('Unlinked/note.md',false).menu.items[0].callback();
    let modal=h.modals.at(-1);
    assert.equal(modal.host.getProjectName(),'New project: Unlinked');
    assert.equal(modal.host.getProjectChoices().slice(0,2).map((item:any)=>item.key).join(','),'folder:new,vault:root');
    modal.close();
    h.plugin.settings.folderLinks=[{id:'root',folderPath:'/',projectId:h.project.id,projectTitle:h.project.title,workspaceRoot:h.project.workspaceRoot,connectionId:'c',self:false}];
    await h.fileMenu('note.md',false).menu.items[0].callback();
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
    assert.equal(modal.titleEl.text,'Create T3 project');assert.equal(calls.length,0);
    assert.equal(h.setting(modal,'Project name').controls[0].value,'Notes');
    await h.button(modal,'Home').click();assert.equal(calls.filter(c=>c[0]==='create').length,0);
    await h.button(modal,'Cancel').click();assert.equal(h.plugin.settings.folderLinks.length,0);
    h.plugin.createFolderProject(h.plugin.app.vault.getAbstractFileByPath('Notes'));modal=h.modals.at(-1);
    h.setting(modal,'Workspace location').controls[0].change('/workspaces/app');
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
    h.setting(modal,'Workspace location').controls[0].change('/missing');
    await h.button(modal,'Create and link').click();
    assert.equal(modal.closed,false);assert.equal(creates,0);assert.equal(h.plugin.settings.folderLinks.length,0);
    assert.ok(modal.contentEl.children.some((el:any)=>el.text==='Cannot create this project. Try again.'));
    await h.button(modal,'Cancel').click();
  }finally{h.plugin.onunload();}
});

test('project creation refuses a browser result that falls back to a parent folder',async()=>{
  const h=await folderMenuHarness();
  try{
    let creates=0;
    h.plugin.projectLocation=async()=>({browse:async()=>({parentPath:'/workspaces',entries:[]}),create:async()=>{creates++;},close:()=>{}});
    h.plugin.createFolderProject({path:'Notes',name:'Notes'});const modal=h.modals.at(-1);
    h.setting(modal,'Workspace location').controls[0].change('/workspaces/missing');
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
    h.setting(modal,'Workspace location').controls[0].change('/workspaces/app');
    const pending=h.button(modal,'Create and link').click();
    modal.close();connect({browse:async()=>({parentPath:'/workspaces/app',entries:[]}),create:async()=>{creates++;},close:()=>{closes++;}});
    await pending;assert.equal(creates,0);assert.equal(closes,1);assert.equal(h.plugin.settings.folderLinks.length,0);
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
      h.setting(modal,'Workspace location').controls[0].change('/workspaces/chosen');
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

test('workspace folder search updates only the list and resets on navigation',async()=>{
  const h=await folderMenuHarness();
  try{
    let browses=0;
    h.plugin.projectLocation=async()=>({browse:async(path:string)=>{browses++;return {parentPath:path==='~'?'/work':path,entries:['Alpha','beta','alphabet'].map(name=>({name,fullPath:'/work/'+name}))};},close:()=>{}});
    h.plugin.createFolderProject({path:'Notes',name:'Notes'});const modal=h.modals.at(-1);
    await h.button(modal,'Home').click();
    const search=h.setting(modal,'Search folders').controls[0];
    const list=modal.contentEl.children.find((el:any)=>el.cls==='send-to-t3-workspace-folders');
    assert.deepEqual(list.settings.map((row:any)=>row.name),['Alpha','beta','alphabet']);
    search.change('ALP');
    assert.equal(h.setting(modal,'Search folders').controls[0],search,'Keep the input and its focus while typing');
    assert.deepEqual(list.settings.map((row:any)=>row.name),['Alpha','alphabet']);
    search.change('missing');assert.equal(list.settings.length,0);assert.equal(list.children[0].text,'No matching folders');
    search.change('');assert.equal(list.settings.length,3);assert.equal(browses,1,'Filtering must not make remote requests');
    search.change('beta');await list.settings[0].controls[0].click();
    assert.equal(h.setting(modal,'Search folders').controls[0].value,'');assert.equal(h.setting(modal,'Workspace location').controls[0].value,'/work/beta');
    modal.close();
  }finally{h.plugin.onunload();}
});

for(const cancel of [true,false])test(`new workspace folder is ${cancel?'cancelled without creation':'created only on final confirmation'}`,async()=>{
  const h=await folderMenuHarness();
  try{
    const creates:any[]=[];
    h.plugin.projectLocation=async()=>({browse:async()=>({parentPath:'/work',entries:[{name:'existing',fullPath:'/work/existing'}]}),create:async(path:string,title:string,newFolder:any)=>{creates.push({path,title,newFolder});return {...h.project,workspaceRoot:path};},close:()=>{}});
    h.plugin.createFolderProject(h.plugin.app.vault.getAbstractFileByPath('Notes'));const modal=h.modals.at(-1);
    h.setting(modal,'Project name').controls[0].change('My project');
    await h.button(modal,'New folder').click();
    h.setting(modal,'New folder name').controls[0].change('../escape');await h.button(modal,'Use new folder').click();
    assert.equal(h.setting(modal,'Workspace location').controls[0].value,'/work');assert.equal(creates.length,0);
    h.setting(modal,'New folder name').controls[0].change('existing');await h.button(modal,'Use new folder').click();
    assert.ok(modal.contentEl.children.some((el:any)=>el.text==='A folder with this name already exists.'));
    h.setting(modal,'New folder name').controls[0].change('New workspace');await h.button(modal,'Use new folder').click();
    assert.equal(h.setting(modal,'Workspace location').controls[0].value,'/work/New workspace');assert.equal(creates.length,0);
    if(cancel){await h.button(modal,'Cancel').click();assert.equal(creates.length,0);assert.equal(h.plugin.settings.folderLinks.length,0);}
    else{await h.button(modal,'Create and link').click();assert.deepEqual(JSON.parse(JSON.stringify(creates)),[{path:'/work/New workspace',title:'My project',newFolder:{parentPath:'/work',name:'New workspace'}}]);assert.equal(modal.closed,true);assert.equal(h.plugin.settings.folderLinks[0].workspaceRoot,'/work/New workspace');}
  }finally{h.plugin.onunload();}
});

test('switching machines clears a prepared new folder and search',async()=>{
  const h=await folderMenuHarness();
  try{
    h.plugin.vaultMachines=()=>[{id:'c',name:'Laptop'},{id:'other',name:'Other'}];
    h.plugin.projectLocation=async()=>({browse:async()=>({parentPath:'/work',entries:[]}),close:()=>{}});
    h.plugin.createFolderProject({path:'Notes',name:'Notes'});const modal=h.modals.at(-1);
    await h.button(modal,'New folder').click();await h.button(modal,'Use new folder').click();
    h.setting(modal,'Search folders').controls[0].change('test');h.setting(modal,'Machine').controls[0].change('other');
    assert.equal(h.setting(modal,'Workspace location').controls[0].value,'~');assert.equal(h.setting(modal,'Search folders').controls[0].value,'');
    assert.ok(!modal.contentEl.children.some((el:any)=>el.text==='This folder will be created when you select Create and link.'));modal.close();
  }finally{h.plugin.onunload();}
});
