import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {runInNewContext} from 'node:vm';
import {createRequire} from 'node:module';
import type {RunImportResult} from '../run-import';

const bundle=build({stdin:{contents:"export {ImportRunModal,RunImportPicker} from './run-import-ui';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',write:false,external:['obsidian']});
const drain=async()=>{for(let i=0;i<4;i++)await Promise.resolve();};
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(error:Error)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
async function fixture(attach:(follow:boolean)=>Promise<RunImportResult>){
  const buttons:any[]=[],toggles:any[]=[],notices:Array<{text:string;duration:number}>=[];
  class Element {children:any[]=[];setText(){}empty(){this.children=[];}createEl(_tag:string,value:any){this.children.push(value);}}
  class Modal {contentEl=new Element();titleEl=new Element();isOpen=false;closed=0;open(){this.isOpen=true;(this as any).onOpen();}close(){this.isOpen=false;this.closed++;(this as any).onClose();}}
  class Control {
    text='';disabled=false;value=false;handler:Function=()=>{};
    setButtonText(text:string){this.text=text;return this;}setCta(){return this;}setDisabled(value:boolean){this.disabled=value;return this;}
    setValue(value:boolean){this.value=value;return this;}onChange(handler:Function){this.handler=handler;return this;}onClick(handler:Function){this.handler=handler;return this;}
  }
  class Setting {
    setName(){return this;}setDesc(){return this;}
    addButton(setup:Function){const button=new Control();buttons.push(button);setup(button);return this;}
    addToggle(setup:Function){const toggle=new Control();toggles.push(toggle);setup(toggle);return this;}
  }
  const module={exports:{} as any},realRequire=createRequire(import.meta.url);
  class Notice {constructor(text:string,duration:number){notices.push({text,duration});}}
  runInNewContext((await bundle).outputFiles[0].text,{module,exports:module.exports,require:(name:string)=>{
    return name==='obsidian'?{Modal,FuzzySuggestModal:Modal,Setting,Notice}:realRequire(name);
  }});
  const modal=new module.exports.ImportRunModal({},'Import.md',{title:'Source thread'},{status:'Completed',createdAt:'2026-10-23T00:00:00Z',prompt:'Source prompt'},attach);modal.open();
  return {modal,notices,confirm:buttons.find(button=>button.text==='Import response'),cancel:buttons.find(button=>button.text==='Cancel'),follow:toggles[0]};
}

for(const follow of [false,true])test(`confirmation closes before delayed save/follow work finishes (follow=${follow})`,async()=>{
  const result=deferred<RunImportResult>();let calls=0,selected:boolean|undefined;
  const h=await fixture(value=>{calls++;selected=value;assert.equal(h.modal.isOpen,false,'close before starting import work');return result.promise;});
  h.follow.handler(follow);const staleClick=h.confirm.handler;staleClick();
  assert.equal(h.modal.isOpen,false);assert.equal(h.modal.closed,1);assert.equal(calls,1);assert.equal(selected,follow);
  assert.deepEqual(h.notices.map(notice=>notice.text),['Importing T3 response…']);
  staleClick();assert.equal(calls,1,'a queued second activation cannot start another import');
  result.resolve({duplicate:false,following:follow,saveState:'saved'});await drain();
  assert.equal(h.modal.closed,1);assert.match(h.notices.at(-1)!.text,/Response imported and saved/);
});
test('a pending final save remains pending after the dialog closes',async()=>{
  const result=deferred<RunImportResult>(),h=await fixture(()=>result.promise);h.confirm.handler();
  result.resolve({duplicate:false,following:false,saveState:'pending',pendingReason:'sync'});await drain();
  assert.equal(h.modal.isOpen,false);assert.equal(h.modal.closed,1);assert.match(h.notices.at(-1)!.text,/not saved yet.*Sync/);assert.equal(h.notices.at(-1)!.duration,10000);
  assert.ok(!h.notices.some(notice=>notice.text.includes('imported and saved')));
});
for(const synchronous of [false,true])test(`import errors remain visible after automatic close (synchronous=${synchronous})`,async()=>{
  const result=deferred<RunImportResult>(),h=await fixture(()=>{if(synchronous)throw Error('Follow host unavailable');return result.promise;});
  h.confirm.handler();if(!synchronous)result.reject(Error('Follow host unavailable'));await drain();
  assert.equal(h.modal.isOpen,false);assert.equal(h.modal.closed,1);assert.match(h.notices.at(-1)!.text,/Import T3 run:.*Follow host unavailable/);
});
test('cancel closes without starting an import',async()=>{
  let calls=0;const h=await fixture(async()=>{calls++;return {duplicate:false,following:false,saveState:'saved'};});h.cancel.handler();await drain();
  assert.equal(h.modal.isOpen,false);assert.equal(calls,0);assert.deepEqual(h.notices,[]);
});


test('run preview dwell, stale work, search names and modal cleanup share one lifecycle',async()=>{
 const timers=new Map<number,()=>void>();let timer=0,unloads=0;
 class Element {
  children:Element[]=[];events:Record<string,Function>={};dataset:Record<string,string>={};classes=new Set<string>();isConnected=true;clientHeight=440;scrollTop=0;nextElementSibling?:Element;
  attrs:Record<string,string>={};style={setProperty(){}};text='';ownerDocument:any;
  setText(text:string){this.text=text;}setAttribute(k:string,v:string){this.attrs[k]=v;}removeAttribute(k:string){delete this.attrs[k];}
  addClass(name:string){this.classes.add(name);}removeClass(name:string){this.classes.delete(name);}
  addEventListener(k:string,v:Function){this.events[k]=v;}removeEventListener(k:string){delete this.events[k];}
  createDiv(options:any={}){const el=new Element();el.ownerDocument=this.ownerDocument;el.text=options.text??'';this.children.push(el);return el;}
  createSpan(options:any={}){return this.createDiv(options);}remove(){this.isConnected=false;}
  getBoundingClientRect(){return {top:0,bottom:440,height:44};}querySelector(){return undefined;}
 }
 class Component {load(){}unload(){unloads++;}}
 const panel=new Element(),modal=new Element() as any;
 const keyEvents:Record<string,Function>={};
 modal.ownerDocument={defaultView:{MutationObserver:class{observe(){}disconnect(){}},addEventListener:(key:string,callback:Function)=>{keyEvents[key]=callback;},removeEventListener:(key:string)=>{delete keyEvents[key];},setTimeout:(callback:()=>void)=>{timers.set(++timer,callback);return timer;},clearTimeout:(id:number)=>timers.delete(id)}};modal.querySelector=()=>panel;
 class Suggest {modalEl=modal;inputEl=new Element();emptyStateText='';setPlaceholder(){}onOpen(){}onClose(){}}
 const module={exports:{} as any},realRequire=createRequire(import.meta.url);
 runInNewContext((await bundle).outputFiles[0].text,{module,exports:module.exports,require:(id:string)=>id==='obsidian'?{Component,FuzzySuggestModal:Suggest,Modal:Suggest,setIcon(){}}:realRequire(id),AbortController,queueMicrotask,
  setTimeout:(callback:()=>void)=>{timers.set(++timer,callback);return timer;},clearTimeout:(id:number)=>timers.delete(id)});
 const base={messageId:'first',turnId:'turn',turn:{turnId:'turn',state:'completed'},status:'Completed',prompt:'A searchable title '.repeat(30),createdAt:'2026-11-04'};
 const late=deferred<void>(),requests:any[]=[],picked:any[]=[];
 const picker=new module.exports.RunImportPicker({},[base,{...base,messageId:'second'},{...base,status:'Unavailable'},{...base,unavailable:'New reason'}],(run:any)=>picked.push(run),async(run:any,el:any,child:any,signal:any)=>{requests.push({run,el,child,signal});if(requests.length===1)await late.promise;});
 picker.onOpen();assert.equal(picker.getItems().length,2);assert.equal(picker.getItemText(base),base.prompt.trimEnd());
 const first=new Element(),second=new Element();first.ownerDocument=second.ownerDocument=modal.ownerDocument;picker.renderSuggestion({item:base},first);picker.renderSuggestion({item:{...base,messageId:'second'}},second);
 first.events.pointerenter();assert.equal(requests.length,1);assert.equal(first.classes.has('is-previewing'),false);
 second.events.pointerenter();assert.equal(requests.length,2);assert.equal(requests[0].signal.aborted,true);assert.equal(unloads,1);
 for(const callback of [...timers.values()])callback();assert.equal(first.classes.has('is-previewing'),false);assert.equal(second.classes.has('is-previewing'),true);
 late.resolve();await drain();assert.equal(first.classes.has('is-previewing'),false);
 keyEvents.keydown({key:'ArrowDown'});await drain();first.events.pointerenter();assert.equal(requests.length,2,'layout hover cannot replace keyboard selection');
 first.events.pointermove({movementX:2,movementY:0});assert.equal(requests.length,3,'actual pointer movement restores hover control');
 picker.onChooseItem({...base,unavailable:'Late failure'});assert.equal(picked.length,0);
 picker.onClose();assert.equal(requests[2].signal.aborted,true);assert.equal(unloads,3);assert.equal(second.classes.has('is-previewing'),false);assert.equal(timers.size,0);assert.equal(keyEvents.keydown,undefined);
});
