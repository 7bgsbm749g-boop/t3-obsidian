import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from './obsidian-context';
import {webcrypto} from 'node:crypto';

// Exercise the shipped settings tab with Obsidian's small DOM/component surface.
class Element {
  children:Element[]=[];attrs:Record<string,string>={};text='';tabIndex=0;open=false;
  listeners:Record<string,(event:any)=>void>={};controls:any[]=[];focused=false;
  constructor(readonly tag='div'){}
  createEl(tag:string,options:any={}){const el=new Element(tag);el.text=options.text??'';el.attrs={...options.attr};this.children.push(el);return el;}
  createDiv(options:any={}){return this.createEl('div',options);}
  addClass(){}removeClass(){}empty(){this.children=[];this.controls=[];}
  setAttribute(name:string,value:string){this.attrs[name]=value;}
  addEventListener(name:string,callback:any){this.listeners[name]=callback;}
  focus(){this.focused=true;}
  all():Element[]{return [this,...this.children.flatMap(child=>child.all())];}
  fire(name:string,event:any={}){this.listeners[name]?.(event);}createSpan(options:any={}){return Reflect.apply(this.createEl,this,['span',options]);}
}
async function harness(mobile=false){
  let updates=0;
  class Base{}
  class Tab{containerEl=new Element();constructor(public app:any){}}
  Object.defineProperty(Tab.prototype,'update',{value(){updates++;}});
  class Setting {
    el:Element;get settingEl(){return this.el;}
    constructor(parent:Element){this.el=parent.createEl('setting');}
    description='';setName(text:string){this.el.text=text;return this;}setDesc(text:string){this.description=text;return this;}setHeading(){return this;}
    add(callback:any){const control:any={inputEl:{},options:{} as Record<string,string>,setPlaceholder(){return this;},setValue(value:any){this.value=value;return this;},setButtonText(text:string){this.text=text;return this;},setCta(){return this;},setDisabled(){return this;},addOption(key:string,value:string){this.options[key]=value;return this;},addOptions(options:any){Object.assign(this.options,options);return this;},onChange(run:any){this.change=run;return this;},onClick(run:any){this.click=run;return this;}};callback(control);this.el.controls.push(control);return this;}
    addText(callback:any){return this.add(callback);}addDropdown(callback:any){return this.add(callback);}
    addButton(callback:any){return this.add(callback);}addToggle(callback:any){return this.add(callback);}
  }
  const api={Plugin:Base,PluginSettingTab:Tab,Setting,Platform:{isMobile:mobile},Modal:Base,FuzzySuggestModal:Base,EditorSuggest:Base,ItemView:Base};
  const module={exports:{} as any};
  runInNewContext(await readFile('dist/main.js','utf8'),{module,exports:module.exports,require:(name:string)=>{assert.equal(name,'obsidian');return api;},crypto:webcrypto,TextEncoder,TextDecoder,document:{createElement:()=>({innerHTML:'',get textContent(){return this.innerHTML;}})},console},{timeout:5000});
  let saves=0,refreshes=0;
  const plugin:any={mode:'direct',manifest:{id:'t-three-code'},settings:{connection:{executable:'',baseDir:''},paired:[],folderLinks:[],completion:{action:'keep',archiveFolder:'Archive/T3 Code'},completionJobs:[],inlineStreaming:{enabled:true,finalAnswerFormat:'formatted'},threadTitleGeneration:'untitled-only',autoSettleThreads:true,settlementJobs:[{id:'pending'}]},save:async()=>{saves++;},refreshMachines:async()=>{refreshes++;},vaultConnection:()=>undefined,paletteChatStatus:()=> 'active'};
  const tab=new module.exports.T3Settings({},plugin);
  return {tab,plugin,Setting,updates:()=>updates,saves:()=>saves,refreshes:()=>refreshes};
}
test('native settings definitions expose the supported pages without credential writes or legacy renderers',async()=>{
 const h=await harness(),pages=h.tab.getSettingDefinitions();assert.deepEqual(Array.from(pages,(page:any)=>page.name),['Agent tools','Connection','Replies','Projects','Advanced']);
 const names:string[]=[],aliases:string[]=[];const scan=(items:any[])=>{for(const item of items){names.push(item.name);aliases.push(...item.aliases??[]);if(item.items)scan(item.items);}};scan(pages);
 for(const name of ['Connections','Stream replies into the editor','Final answer format','Thread title generation','Settle completed threads','Beta','Thread and note mode'])assert.ok(names.includes(name),name);
 assert.equal(names.includes('Connect with'),false);assert.equal(aliases.includes('Archive folder'),false);assert.equal(h.saves(),0);assert.equal(h.refreshes(),0);assert.equal(Object.hasOwn(Object.getPrototypeOf(h.tab),'display'),false);
});
test('native controls save their values and refresh through the supported index API',async()=>{
 const h=await harness(),pages=h.tab.getSettingDefinitions(),replies=pages.find((page:any)=>page.name==='Replies').items;
 const format=replies.find((row:any)=>row.name==='Final answer format'),setting=new h.Setting(new Element());format.render(setting);await setting.el.controls[0].change('raw-markdown');assert.equal(h.plugin.settings.inlineStreaming.finalAnswerFormat,'raw-markdown');assert.equal(h.saves(),1);
 h.plugin.cloudChanged();assert.equal(h.updates(),1);assert.equal(h.plugin.nativeAccount,undefined);
 const settle=replies.find((row:any)=>row.name==='Settle completed threads'),toggle=new h.Setting(new Element());settle.render(toggle);await toggle.el.controls[0].change(false);assert.equal(h.plugin.settings.settlementJobs.length,0);
});
test('thread and note mode changes preserve links and reply streaming',async()=>{
 const h=await harness(true);h.plugin.settings.noteThreads=[{notePath:'A.md',threadId:'thread'}];const before=JSON.stringify(h.plugin.settings.noteThreads),pages=h.tab.getSettingDefinitions(),beta=pages.find((page:any)=>page.name==='Replies').items.find((item:any)=>item.name==='Beta');
 const setting=new h.Setting(new Element());beta.items[0].render(setting);assert.equal(setting.el.controls[0].value,'free');await setting.el.controls[0].change('one-to-one');assert.equal(h.plugin.settings.threadNoteMode,'one-to-one');assert.equal(JSON.stringify(h.plugin.settings.noteThreads),before);assert.equal(h.plugin.settings.inlineStreaming.enabled,true);
});

test('route text updates in place and detached rows stop receiving updates',async()=>{
 const h=await harness(),root=new Element(),setting=new h.Setting(root);let text='Active · Connected';
 const input=root.createEl('input');input.focus();Object.assign(setting.settingEl,{isConnected:true});
 h.plugin.routeDescription=()=>text;h.tab.routeRows.set('route',{setting,description:text});
 text='Disconnected · machine offline';h.tab.refreshRouteStatus();assert.equal(setting.description,text);assert.equal(input.focused,true);assert.equal(h.updates(),0);
 Object.assign(setting.settingEl,{isConnected:false});text='Active · Connected';h.tab.refreshRouteStatus();assert.equal(setting.description,'Disconnected · machine offline');assert.equal(h.tab.routeRows.size,0);
});
