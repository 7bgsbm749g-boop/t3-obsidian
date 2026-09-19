import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {webcrypto,randomUUID} from 'node:crypto';
import {indexedDB} from 'fake-indexeddb';

async function folderMenuHarness(){
  const deviceId=randomUUID();let local:any={deviceId,mode:'direct'};
  const project={id:'project',title:'Writing',workspaceRoot:'/writing',connectionId:'c',connectionName:'Laptop'};
  const shared:any[]=[],modals:any[]=[],notices:string[]=[];
  let fileMenu:(...args:any[])=>void=()=>{},failSave=false,networkRequests=0;
  class Element {
    text='';settings:any[]=[];children:Element[]=[];
    empty(){this.settings=[];this.children=[];}
    setText(value:string){this.text=value;}
    createEl(_tag:string,options?:{text?:string}){const child=new Element();child.text=options?.text??'';this.children.push(child);return child;}
  }
  class Control {
    value:any;disabled=false;text='';handler:(value?:any)=>any=()=>{};
    setValue(value:any){this.value=value;return this;}
    setPlaceholder(_value:string){return this;}
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
    addButton(callback:(control:Control)=>void){return this.add(callback);}
  }
  class Modal {
    contentEl=new Element();titleEl=new Element();closed=false;
    constructor(public app:any){}
    open(){modals.push(this);(this as any).onOpen?.();}
    close(){this.closed=true;}
  }
  class Base {}
  class Folder {path='Notes';name='Notes';}
  const folder=new Folder();
  class Plugin {
    app={loadLocalStorage:()=>local,saveLocalStorage:(_:string,value:any)=>{local=value;},
      workspace:{onLayoutReady:()=>{},on:(name:string,callback:(...args:any[])=>void)=>{if(name==='file-menu')fileMenu=callback;}},
      vault:{getAbstractFileByPath:(path:string)=>path===folder.path?folder:undefined},
    };
    async loadData(){return {paired:[{id:'c',name:'Laptop',url:'https://folder.example',environmentId:'env'}],directScanId:'c',directProjects:[project],directSelected:['c:project']};}
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
  }
  const api={Plugin,Platform:{isMobile:true},TFolder:Folder,TFile:Base,Modal,FuzzySuggestModal:Modal,PluginSettingTab:Base,Setting,Notice:class{constructor(text:string){notices.push(text);}}};
  const module={exports:{} as any};
  runInNewContext(await readFile('main.js','utf8'),{
    module,exports:module.exports,require:(name:string)=>{assert.equal(name,'obsidian');return api;},indexedDB,
    document:{createElement:()=>({innerHTML:'',get textContent(){return this.innerHTML;}})},
    fetch:()=>{networkRequests++;throw Error('Link configuration must not dispatch or scan T3');},
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
  return {plugin,open,setting,button,shared,notices,deviceId,networkRequests:()=>networkRequests,setFailSave:(value:boolean)=>{failSave=value;}};
}

test('folder menu opens an inactive link dialog; cancel is inert and Link alone persists',{timeout:5000},async()=>{
  const h=await folderMenuHarness();
  try{
    const saves=h.shared.length;
    const cancelled=await h.open();
    assert.equal(h.setting(cancelled,'Automatic send on #tag').controls[0].value,false);
    assert.equal(h.setting(cancelled,'Trigger tag').disabled,true);
    assert.equal(h.plugin.settings.folderLinks.length,0);
    assert.equal(h.shared.length,saves);
    await h.button(cancelled,'Cancel').click();
    assert.equal(cancelled.closed,true);assert.equal(h.shared.length,saves);
    const modal=await h.open();
    const toggle=h.setting(modal,'Automatic send on #tag').controls[0];
    toggle.change(true);h.setting(modal,'Trigger tag').controls[0].change('#invalid tag');toggle.change(false);
    assert.equal(h.shared.length,saves,'Draft changes must not save');
    await h.button(modal,'Link').click();
    assert.equal(modal.closed,true);
    assert.equal(h.plugin.settings.folderLinks.length,1);
    assert.equal(h.shared.at(-1).folderLinks[0].tagTrigger.enabled,false);
    assert.equal(h.shared.at(-1).folderLinks[0].tagTrigger.tag,'#ready','A disabled trigger ignores an invalid draft');
    assert.equal(h.networkRequests(),0);
  }finally{h.plugin.onunload();}
});

test('saving an optional tag persists it and reopening preserves the link identity and owner',{timeout:5000},async()=>{
  const h=await folderMenuHarness();
  try{
    const modal=await h.open();
    h.setting(modal,'Automatic send on #tag').controls[0].change(true);
    h.setting(modal,'Trigger tag').controls[0].change(' Tasks/Ready ');
    await h.button(modal,'Link').click();
    const original=h.plugin.settings.folderLinks[0];
    assert.equal(original.tagTrigger.tag,'#tasks/ready');assert.equal(original.tagTrigger.enabled,true);
    assert.equal(original.tagTrigger.deviceId,h.deviceId);
    // A synced trigger owned by another device must remain there when merely reopening and saving.
    original.tagTrigger.deviceId='another-device';await h.plugin.save();
    const reopened=await h.open();
    assert.equal(h.setting(reopened,'Automatic send on #tag').controls[0].value,true);
    assert.equal(h.setting(reopened,'Trigger tag').controls[0].value,'#tasks/ready');
    await h.button(reopened,'Save link').click();
    const saved=h.shared.at(-1).folderLinks[0];
    assert.equal(saved.id,original.id);assert.equal(saved.tagTrigger.deviceId,'another-device');
    assert.equal(saved.tagTrigger.tag,'#tasks/ready');assert.equal(h.networkRequests(),0);
  }finally{h.plugin.onunload();}
});

test('invalid tags and storage failures leave the link dialog open and preserve the existing link',{timeout:5000},async()=>{
  const h=await folderMenuHarness();
  try{
    const initial=await h.open();await h.button(initial,'Link').click();
    const previous=JSON.stringify(h.plugin.settings.folderLinks),saves=h.shared.length;
    const modal=await h.open();
    h.setting(modal,'Automatic send on #tag').controls[0].change(true);
    h.setting(modal,'Trigger tag').controls[0].change('#two #tags');
    await h.button(modal,'Save link').click();
    assert.equal(modal.closed,false);assert.equal(JSON.stringify(h.plugin.settings.folderLinks),previous);
    assert.equal(h.shared.length,saves);assert.match(h.notices.at(-1)!,/one tag/i);
    h.setting(modal,'Trigger tag').controls[0].change('#valid');h.setFailSave(true);
    await h.button(modal,'Save link').click();
    assert.equal(modal.closed,false);assert.equal(JSON.stringify(h.plugin.settings.folderLinks),previous);
    assert.equal(h.shared.length,saves);assert.match(h.notices.at(-1)!,/storage failure/i);
    assert.equal(h.button(modal,'Save link').disabled,false,'A failed save remains retryable');
    h.setFailSave(false);await h.button(modal,'Save link').click();
    assert.equal(modal.closed,true);assert.equal(h.shared.at(-1).folderLinks[0].tagTrigger.tag,'#valid');
    assert.equal(h.networkRequests(),0);
  }finally{h.plugin.onunload();}
});
