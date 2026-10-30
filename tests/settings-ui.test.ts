import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {webcrypto} from 'node:crypto';

// Exercise the shipped settings tab with Obsidian's small DOM/component surface.
class Element {
  children:Element[]=[];attrs:Record<string,string>={};text='';tabIndex=0;open=false;
  listeners:Record<string,(event:any)=>void>={};controls:any[]=[];focused=false;
  constructor(readonly tag='div'){}
  createEl(tag:string,options:any={}){const el=new Element(tag);el.text=options.text??'';el.attrs={...options.attr};this.children.push(el);return el;}
  createDiv(options:any={}){return this.createEl('div',options);}
  addClass(){}empty(){this.children=[];this.controls=[];}
  setAttribute(name:string,value:string){this.attrs[name]=value;}
  addEventListener(name:string,callback:any){this.listeners[name]=callback;}
  focus(){this.focused=true;}
  all():Element[]{return [this,...this.children.flatMap(child=>child.all())];}
  fire(name:string,event:any={}){this.listeners[name]?.(event);}
}
async function harness(mobile=false){
  class Base{}
  class Tab{containerEl=new Element();constructor(public app:any){}}
  class Setting {
    el:Element;
    constructor(parent:Element){this.el=parent.createEl('setting');}
    setName(text:string){this.el.text=text;return this;}setDesc(){return this;}setHeading(){return this;}
    add(callback:any){const control:any={inputEl:{},options:{} as Record<string,string>,setPlaceholder(){return this;},setValue(value:any){this.value=value;return this;},setButtonText(text:string){this.text=text;return this;},setCta(){return this;},setDisabled(){return this;},addOption(key:string,value:string){this.options[key]=value;return this;},addOptions(options:any){Object.assign(this.options,options);return this;},onChange(run:any){this.change=run;return this;},onClick(run:any){this.click=run;return this;}};callback(control);this.el.controls.push(control);return this;}
    addText(callback:any){return this.add(callback);}addDropdown(callback:any){return this.add(callback);}
    addButton(callback:any){return this.add(callback);}addToggle(callback:any){return this.add(callback);}
  }
  const api={Plugin:Base,PluginSettingTab:Tab,Setting,Platform:{isMobile:mobile},Modal:Base,FuzzySuggestModal:Base,EditorSuggest:Base,ItemView:Base};
  const module={exports:{} as any};
  runInNewContext(await readFile('dist/main.js','utf8'),{module,exports:module.exports,require:(name:string)=>{assert.equal(name,'obsidian');return api;},crypto:webcrypto,TextEncoder,TextDecoder,document:{createElement:()=>({innerHTML:'',get textContent(){return this.innerHTML;}})},console},{timeout:5000});
  let saves=0,refreshes=0;
  const plugin:any={mode:'direct',manifest:{id:'t-three-code'},settings:{connection:{executable:'',baseDir:''},paired:[],folderLinks:[],completion:{action:'keep',archiveFolder:'Archive/T3 Code'},completionJobs:[],inlineStreaming:{enabled:true,finalAnswerFormat:'formatted'},threadTitleGeneration:'untitled-only',autoSettleThreads:true,settlementJobs:[{id:'pending'}]},save:async()=>{saves++;},refreshMachines:async()=>{refreshes++;},vaultConnection:()=>undefined,paletteChatStatus:()=> 'active'};
  const tab=new module.exports.T3Settings({},plugin);tab.display();
  const root=tab.containerEl as Element;
  const tabs=()=>root.all().filter(el=>el.attrs.role==='tab');
  const panel=()=>root.all().find(el=>el.attrs.role==='tabpanel')!;
  const row=(name:string)=>panel().all().find(el=>el.tag==='setting'&&el.text===name)!;
  const select=(name:string)=>tabs().find(el=>el.text===name)!.fire('click');
  return {tab,plugin,root,tabs,panel,row,select,saves:()=>saves,refreshes:()=>refreshes};
}

test('settings pages isolate maintenance controls and support keyboard tab navigation',async()=>{
  const h=await harness();
  assert.deepEqual(h.tabs().map(el=>el.text),['Connection','Replies','Projects','Advanced']);
  assert.ok(h.row('T3 account email'));assert.equal(h.row('Legacy cleanup defaults'),undefined);
  const first=h.tabs()[0];let prevented=false;
  first.fire('keydown',{key:'ArrowRight',preventDefault(){prevented=true;}});
  assert.equal(prevented,true);assert.equal(h.tabs()[1].focused,true);assert.equal(h.tabs()[1].attrs['aria-selected'],'true');
  assert.deepEqual(h.tabs().map(el=>el.tabIndex),[-1,0,-1,-1]);
  assert.equal(h.panel().attrs['aria-labelledby'],h.tabs()[1].attrs.id);assert.ok(h.row('Final answer format'));
  h.tabs()[1].fire('keydown',{key:'End',preventDefault(){}});assert.ok(h.row('Send failure log'));
  assert.ok(h.panel().all().filter(el=>el.tag==='details').every(el=>!el.open));
  h.tabs()[3].fire('keydown',{key:'ArrowRight',preventDefault(){}});assert.ok(h.row('T3 account email'));
  h.tabs()[0].fire('keydown',{key:'ArrowLeft',preventDefault(){}});assert.ok(h.row('Legacy cleanup defaults'));
  h.tabs()[3].fire('keydown',{key:'Home',preventDefault(){}});assert.ok(h.row('T3 account email'));
  assert.equal(h.saves(),0);assert.equal(h.refreshes(),0,'Opening settings must not start network discovery');
});

test('settings controls still save and keep their page through account updates and dependent fields',async()=>{
  const h=await harness();h.select('Replies');
  await h.row('Final answer format').controls[0].change('raw-markdown');
  await h.row('Settle completed threads').controls[0].change(false);
  assert.equal(h.plugin.settings.inlineStreaming.finalAnswerFormat,'raw-markdown');assert.equal(h.plugin.settings.settlementJobs.length,0);
  h.plugin.cloudChanged();assert.ok(h.row('Final answer format'));assert.equal(h.tabs()[1].attrs['aria-selected'],'true');
  h.select('Advanced');const legacy=h.panel().all().find(el=>el.tag==='details'&&el.children[0]?.text==='Legacy cleanup')!;
  legacy.open=true;legacy.fire('toggle');await h.row('Legacy cleanup defaults').controls[0].change('archive');
  assert.ok(h.row('Archive folder'));assert.equal(h.panel().all().find(el=>el.tag==='details'&&el.children[0]?.text==='Legacy cleanup')!.open,true);
  h.tab.showConnection();h.tab.display();assert.ok(h.row('T3 account email'));assert.equal(h.saves(),3);
});

test('projects omit legacy vault-root links and mobile offers only T3 Connect',async()=>{
  const h=await harness(true);assert.deepEqual(Object.keys(h.row('Connect with').controls[0].options),['direct']);
  h.plugin.settings.folderLinks=[{folderPath:'/',projectTitle:'Old root',workspaceRoot:'/old'}];h.select('Projects');
  assert.ok(h.row('Vault connection'));assert.ok(h.row('Codebase view'));assert.equal(h.row('Vault root'),undefined);
  assert.ok(h.panel().all().some(el=>el.text.startsWith('No folders are linked.')));
});

test('thread/note modes default to Free inside collapsed Beta and preserve links when changed',async()=>{
  const h=await harness();h.plugin.settings.noteThreads=[{notePath:'A.md',threadId:'one'}];
  const before=JSON.stringify(h.plugin.settings.noteThreads);h.select('Replies');
  const beta=()=>h.panel().all().find(el=>el.tag==='details'&&el.children[0]?.text==='Beta')!;
  assert.equal(beta().open,false);assert.ok(beta().all().includes(h.row('Thread and note mode')));
  assert.equal(h.saves(),0,'Opening Beta settings must not change the saved mode');
  beta().open=true;beta().fire('toggle');
  const control=h.row('Thread and note mode').controls[0];
  assert.equal(control.value,'free');assert.deepEqual(Object.keys(control.options),['free','one-to-one']);
  await control.change('one-to-one');assert.equal(h.plugin.settings.threadNoteMode,'one-to-one');
  h.plugin.cloudChanged();assert.equal(h.row('Thread and note mode').controls[0].value,'one-to-one');
  assert.equal(beta().open,true,'Account updates keep Beta open while changing the mode');
  beta().open=false;beta().fire('toggle');h.plugin.cloudChanged();assert.equal(beta().open,false);
  assert.equal(h.row('Thread and note mode').controls[0].value,'one-to-one','Collapsing Beta preserves an existing choice');
  await h.row('Thread and note mode').controls[0].change('free');
  assert.equal(h.saves(),2);assert.equal(JSON.stringify(h.plugin.settings.noteThreads),before);
  assert.equal(h.plugin.settings.inlineStreaming.enabled,true);
});
