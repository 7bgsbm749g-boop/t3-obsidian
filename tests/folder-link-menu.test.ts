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
  let shownMenu:any,threadsReply:any[]|undefined;
  let fileMenu:(...args:any[])=>void=()=>{},failSave=false,networkRequests=0;
  class Element {
    text='';settings:any[]=[];children:Element[]=[];
    empty(){this.settings=[];this.children=[];}
    setText(value:string){this.text=value;}
    createEl(_tag:string,options?:{text?:string}){const child=new Element();child.text=options?.text??'';this.children.push(child);return child;}
  }
  class Control {
    value:any;disabled=false;text='';handler:(value?:any)=>any=()=>{};
    inputEl:any={rows:0};
    setValue(value:any){this.value=value;return this;}
    setPlaceholder(_value:string){return this;}
    addOptions(_value:Record<string,string>){return this;}
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
    close(){this.closed=true;}
    setPlaceholder(_value:string){return this;}
  }
  class Base {}
  class Folder {path='Notes';name='Notes';}
  class File {extension='md';constructor(public path:string){}}
  const folder=new Folder();
  class Plugin {
    app={loadLocalStorage:()=>local,saveLocalStorage:(_:string,value:any)=>{local=value;},
      workspace:{onLayoutReady:()=>{},on:(name:string,callback:(...args:any[])=>void)=>{if(name==='file-menu')fileMenu=callback;}},
      vault:{getAbstractFileByPath:(path:string)=>path===folder.path?folder:undefined},
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
  const api={Plugin,Menu,Platform:{isMobile:true},TFolder:Folder,TFile:File,Modal,FuzzySuggestModal:Modal,PluginSettingTab:Base,Setting,Notice:class{constructor(text:string){notices.push(text);}}};
  const module={exports:{} as any};
  runInNewContext(await readFile('dist/main.js','utf8'),{
    module,exports:module.exports,window:{innerWidth:1000,innerHeight:700},require:(name:string)=>{assert.equal(name,'obsidian');return api;},indexedDB,
    document:{createElement:()=>({innerHTML:'',get textContent(){return this.innerHTML;}})},
    fetch:(url:string)=>{networkRequests++;if(threadsReply===undefined)throw Error('Link configuration must not dispatch or scan T3');return new Response(JSON.stringify(url.endsWith('/environment')?{environmentId:'env',label:'Laptop',orchestrationProtocolVersion:1}:{threads:threadsReply}));},
    Headers,Response,AbortController,URLSearchParams,URL,TextEncoder,TextDecoder,crypto:webcrypto,setTimeout,clearTimeout,console,
  },{timeout:5000});
  const plugin=new module.exports.default();await plugin.onload();
  const open=async()=>{
    const menu=new Menu();fileMenu(menu,folder,'file-explorer-context-menu');
    const entry=menu.items.find(item=>item.title==='Link to T3 Code');assert.ok(entry?.submenu);
    const target=entry.submenu.items.find(item=>item.title==='Link to Writing · Laptop');assert.ok(target);
    await target.callback();return modals.at(-1);
  };
  const setting=(modal:Modal,name:string)=>{const item=modal.contentEl.settings.find(item=>item.name===name);assert.ok(item);return item as Setting;};
  const button=(modal:Modal,text:string)=>{const item=modal.contentEl.settings.flatMap(setting=>setting.controls).find(control=>control.text===text);assert.ok(item);return item as Control;};
  return {plugin,open,setting,button,shared,notices,deviceId,project,modals,shownMenu:()=>shownMenu,setThreads:(value:any[])=>{threadsReply=value;},folderMenu:()=>{const menu=new Menu();fileMenu(menu,folder,'file-explorer-context-menu');return menu;},fileMenu:(path:string,mobile:boolean)=>{api.Platform.isMobile=mobile;const menu=new Menu();const file=new File(path);fileMenu(menu,file,'file-explorer-context-menu');return {menu,file};},networkRequests:()=>networkRequests,setFailSave:(value:boolean)=>{failSave=value;}};
}

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

test('v2 folder menu creates and edits a typed workflow without migration or dispatch',async()=>{
  const h=await folderMenuHarness();
  try{
    const link=await h.open();await h.button(link,'Link').click();
    let entry=h.folderMenu().items.find((item:any)=>item.title==='Setup T3 workflow');assert.ok(entry?.submenu);
    assert.equal(entry!.submenu!.items.map((item:any)=>item.title).join(','),'Setup new workflow…');
    await entry!.submenu!.items[0].callback();let modal=h.modals.at(-1);
    assert.equal(h.setting(modal,'Enabled').controls[0].value,false);
    h.setting(modal,'Workflow name').controls[0].change('V2 formatter');
    h.setting(modal,'Task').controls[0].change('Format the note.');
    await h.button(modal,'Create workflow').click();
    assert.equal(modal.closed,true);assert.equal(h.plugin.settings.automationDrafts.length,1);
    const ir=h.plugin.settings.automationDrafts[0];assert.equal(ir.projectId,h.project.id);assert.equal(ir.folderPath,'Notes');assert.equal(ir.enabled,false);
    assert.equal(h.networkRequests(),0);
    entry=h.folderMenu().items.find((item:any)=>item.title==='Setup T3 workflow');
    assert.equal(entry!.submenu!.items[0].title,'V2 formatter');await entry!.submenu!.items[0].callback();modal=h.modals.at(-1);
    h.setting(modal,'Enabled').controls[0].change(true);await h.button(modal,'Save workflow').click();
    assert.equal(h.plugin.settings.automationDrafts[0].enabled,true);
    assert.equal(h.plugin.settings.automationDrafts[0].revision,2);
    assert.equal(h.networkRequests(),0,'setup must not send an existing note');
  }finally{h.plugin.onunload();}
});

for(const mobile of [false,true])test(`linked note menu offers new and existing threads on ${mobile?'mobile':'desktop'}`,async()=>{
  const h=await folderMenuHarness();
  try{
    const nested={...h.project,id:'nested',title:'Nested'};
    h.plugin.settings.directProjects.push(nested);
    h.plugin.settings.directSelected=[];
    h.plugin.settings.folderLinks=[{id:'parent',folderPath:'Notes',projectId:h.project.id,projectTitle:h.project.title,workspaceRoot:h.project.workspaceRoot,connectionId:'c',self:false},
      {id:'inner',folderPath:'Notes/Inner',projectId:nested.id,projectTitle:nested.title,workspaceRoot:nested.workspaceRoot,connectionId:'c',self:false}];
    h.plugin.chatReadinessError=()=>undefined;
    const sent:any[]=[];h.plugin.send=async(file:any,project:any,options:any)=>{sent.push({file,project,options});};
    const {menu,file}=h.fileMenu('Notes/Inner/note.md',mobile);
    const item=menu.items.find(item=>item.title==='Open in T3 Code');assert.ok(item);
    if(mobile)await item.callback();
    const choices=mobile?h.shownMenu():item.submenu;assert.ok(choices);
    assert.deepEqual(choices.items.map((i:any)=>i.title),['Send to new thread','Send to existing thread…']);
    await choices.items[0].callback();
    assert.equal(sent.length,1);assert.equal(sent[0].file,file);assert.equal(sent[0].project.id,'nested');assert.equal(sent[0].options.threadId,undefined);
    h.setThreads([{id:'thread',projectId:'nested',title:'Existing',updatedAt:'2026-09-19',session:{status:'running',activeTurnId:'turn'},latestTurn:{state:'running'}},
      {id:'foreign',projectId:h.project.id,title:'Wrong project',updatedAt:'2026-09-20'},
      {id:'archived',projectId:'nested',title:'Archived',archivedAt:'2026-09-19'}]);
    await choices.items[1].callback();
    const picker=h.modals.at(-1);assert.equal(picker.getItems().length,1);
    assert.equal(picker.getItems()[0].id,'thread');
    assert.match(picker.getItemText(picker.getItems()[0]),/Existing · Active/);
    picker.onChooseItem(picker.getItems()[0]);
    assert.equal(sent.length,2);assert.equal(sent[1].options.threadId,'thread');assert.equal(sent[1].project.id,'nested');
    h.plugin.settings.folderLinks[1].projectId=h.project.id;
    picker.onChooseItem(picker.getItems()[0]);
    assert.equal(sent.length,2,'Changing the link while choosing a thread must not send to a stale target');
    assert.match(h.notices.at(-1)!,/linked project changed/i);
  }finally{h.plugin.onunload();}
});

test('unlinked notes retain project choices and root links cover root-level notes',async()=>{
  const h=await folderMenuHarness();
  try{
    const unlinked=h.fileMenu('Unlinked/note.md',false).menu.items[0].submenu;
    assert.ok(unlinked?.items.some(item=>item.title==='New thread in Writing · Laptop'));
    h.plugin.settings.folderLinks=[{id:'root',folderPath:'/',projectId:h.project.id,projectTitle:h.project.title,workspaceRoot:h.project.workspaceRoot,connectionId:'c',self:false}];
    const submenu=h.fileMenu('note.md',false).menu.items[0].submenu;assert.ok(submenu);
    assert.equal(submenu.items[0].title,'Send to new thread');
    h.plugin.busy=true;
    assert.ok(h.fileMenu('note.md',false).menu.items[0].submenu?.items.every(item=>item.disabled));
  }finally{h.plugin.onunload();}
});
