import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from './build-fixture';
import {runInNewContext} from './obsidian-context';
import {createRequire} from 'node:module';
import type {RunImportResult} from '../src/conversations/run-import';

const bundle=build({stdin:{contents:"export {ImportRunModal,RunImportPicker,openRunImport} from './src/conversations/run-import-ui';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',write:false,external:['obsidian']});
const drain=()=>new Promise<void>(resolve=>setImmediate(resolve));
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(error:Error)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
async function fixture(attach:(follow:boolean)=>Promise<RunImportResult>){
  const buttons:any[]=[],toggles:any[]=[],notices:Array<{text:string;duration:number}>=[];
  class Element {children:any[]=[];setText(){}empty(){this.children=[];}createEl(_tag:string,value:any){this.children.push(value);}createDiv(options:any={}){return Reflect.apply(this.createEl,this,['div',options]);}createSpan(options:any={}){return Reflect.apply(this.createEl,this,['span',options]);}}
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
 const base={messageId:'first',turnId:'turn',turn:{turnId:'turn',state:'completed'},status:'Completed',prompt:'A searchable title '.repeat(30)+'Unique search suffix',createdAt:'2026-11-04'};
 const late=deferred<void>(),requests:any[]=[],picked:any[]=[];
 const picker=new module.exports.RunImportPicker({},[base,{...base,messageId:'second'},{...base,status:'Unavailable'},{...base,unavailable:'New reason'}],(run:any)=>picked.push(run),async(run:any,el:any,child:any,signal:any)=>{requests.push({run,el,child,signal});if(requests.length===1)await late.promise;});
 picker.onOpen();assert.equal(picker.getItems().length,2);assert.equal(picker.getItemText(base),base.prompt.trimEnd());
 const first=new Element(),second=new Element();first.ownerDocument=second.ownerDocument=modal.ownerDocument;picker.renderSuggestion({item:base},first);picker.renderSuggestion({item:{...base,messageId:'second'}},second);
 assert.equal(first.children[0].children[1].text.length,360);assert.ok(first.children[0].children[1].text.endsWith('…'));
 assert.ok(picker.getItemText(base).endsWith('Unique search suffix'),'search retains text beyond the visible title');
 const changed={...base,prompt:'Old prompt'};assert.equal(picker.getItemText(changed),'Old prompt');changed.prompt='New\n prompt';assert.equal(picker.getItemText(changed),'New prompt');
 const emoji={...base,prompt:'a'.repeat(358)+'😀 tail'},emojiRow=new Element();emojiRow.ownerDocument=modal.ownerDocument;picker.renderSuggestion({item:emoji},emojiRow);assert.equal(emojiRow.children[0].children[1].text,'a'.repeat(358)+'…','short titles never split a surrogate pair');
 first.events.pointerenter();assert.equal(requests.length,1);assert.equal(first.classes.has('is-previewing'),false);
 second.events.pointerenter();assert.equal(requests.length,2);assert.equal(requests[0].signal.aborted,true);assert.equal(unloads,1);
 for(const callback of [...timers.values()])callback();assert.equal(first.classes.has('is-previewing'),false);assert.equal(second.classes.has('is-previewing'),true);
 late.resolve();await drain();assert.equal(first.classes.has('is-previewing'),false);
 keyEvents.keydown({key:'ArrowDown'});await drain();first.events.pointerenter();assert.equal(requests.length,2,'layout hover cannot replace keyboard selection');
 first.events.pointermove({movementX:2,movementY:0});assert.equal(requests.length,3,'actual pointer movement restores hover control');
 picker.onChooseItem({...base,unavailable:'Late failure'});assert.equal(picked.length,0);
 picker.onClose();assert.equal(requests[2].signal.aborted,true);assert.equal(unloads,3);assert.equal(second.classes.has('is-previewing'),false);assert.equal(timers.size,0);assert.equal(keyEvents.keydown,undefined);
});

test('native close-before-choose keeps selection alive while cancelled and replaced flows stop',async()=>{
 const opened:any[]=[],signals:AbortSignal[]=[],module={exports:{} as any},realRequire=createRequire(import.meta.url);
 class Modal {modalEl={ownerDocument:{defaultView:{clearTimeout(){},removeEventListener(){}}}};open(){opened.push(this);}close(){this.onClose();}onClose(){}}
 class Suggest extends Modal {placeholder='';setPlaceholder(value:string){this.placeholder=value;}select(item:unknown){this.close();(this as any).onChooseItem(item);}}
 runInNewContext((await bundle).outputFiles[0].text,{module,exports:module.exports,require:(id:string)=>id==='obsidian'?{FuzzySuggestModal:Suggest,Modal,Notice:class{}}:realRequire(id),AbortController,queueMicrotask});
 const app={},project={id:'project'},thread={id:'thread',projectId:'project'},run={messageId:'prompt',turnId:'run',turn:{turnId:'run',state:'completed'},status:'Completed',prompt:'Synthetic',createdAt:'2026-11-07'};
 const pending=deferred<any[]>();let calls=0;
 const host={projects:()=>[project],projectLabel:()=>'',threads:async(_project:unknown,signal:AbortSignal)=>{signals.push(signal);return ++calls===1?[thread]:pending.promise;},runs:async()=>[run],attach:async()=>{throw Error('No import was requested.');}};
 module.exports.openRunImport(app,'Synthetic.md',host);opened.at(-1).select(project);await drain();
 assert.equal(signals[0].aborted,false);assert.equal(opened.at(-1).placeholder,'Choose the source T3 thread');
 opened.at(-1).select(thread);await drain();assert.equal(opened.at(-1).placeholder,'Choose a T3 response');
 opened.at(-1).select(run);await drain();assert.equal(opened.at(-1).constructor.name,'ImportRunModal');assert.equal(signals[0].aborted,true);
 module.exports.openRunImport(app,'Synthetic.md',host);opened.at(-1).select(project);await drain();
 module.exports.openRunImport(app,'Synthetic.md',host);const replacement=opened.at(-1);assert.equal(signals[1].aborted,true);
 pending.resolve([thread]);await drain();assert.equal(opened.at(-1),replacement,'late results cannot reopen an old flow');
 replacement.close();await drain();replacement.select(project);await drain();assert.equal(signals.at(-1)?.aborted,true);assert.equal(opened.at(-1),replacement);
});

test('a thread picker receives fresh rows without losing its filter or choosing a source, and stops watching on close',async()=>{
 const opened:any[]=[],inputEvents:any[]=[],module={exports:{} as any},realRequire=createRequire(import.meta.url);let update!:(items:any[])=>void,stops=0,runs=0;
 class Modal {open(){opened.push(this);this.onOpen();}close(){this.onClose();}onOpen(){}onClose(){}}
 class Suggest extends Modal {placeholder='';inputEl={value:'typed filter',dispatchEvent(event:Event){inputEvents.push({type:event.type,value:this.value});}};setPlaceholder(value:string){this.placeholder=value;}select(item:unknown){this.close();(this as any).onChooseItem(item);}}
 runInNewContext((await bundle).outputFiles[0].text,{module,exports:module.exports,require:(id:string)=>id==='obsidian'?{FuzzySuggestModal:Suggest,Modal,Notice:class{}}:realRequire(id),AbortController,Event,queueMicrotask});
 const app={},project={id:'project'},thread={id:'old',projectId:'project',title:'Old',status:'Idle'},fresh={...thread,id:'new',title:'New'};
 const host={projects:()=>[project],projectLabel:()=>'',threads:async()=>[thread],watchThreads:(_project:unknown,changed:(items:any[])=>void)=>{update=changed;return ()=>{stops++;};},runs:async()=>{runs++;return [];},attach:async()=>{throw Error('No import requested');}};
 module.exports.openRunImport(app,'Synthetic.md',host);opened.at(-1).select(project);await drain();const picker=opened.at(-1);
 update([thread,fresh]);assert.deepEqual(picker.getItems().map((item:any)=>item.id),['old','new']);assert.equal(picker.inputEl.value,'typed filter');assert.deepEqual(inputEvents,[{type:'input',value:'typed filter'}]);assert.equal(runs,0);
 picker.close();await drain();assert.equal(stops,1);update([fresh]);assert.equal(inputEvents.length,1);
 module.exports.openRunImport(app,'Synthetic.md',host);opened.at(-1).select(project);await drain();const abandoned=opened.at(-1),late=update;
 module.exports.openRunImport(app,'Synthetic.md',host);assert.equal(stops,2);late([fresh]);assert.equal(inputEvents.length,1);assert.equal(abandoned.inputEl.value,'typed filter');
});

test('a unique typed thread match prepares one cancellable run read that selection joins',async()=>{
 const opened:any[]=[],notices:string[]=[],reads:Array<{thread:string;signal:AbortSignal}>=[],pending=new Map<string,ReturnType<typeof deferred<any[]>>>(),module={exports:{} as any},realRequire=createRequire(import.meta.url);
 class Modal {open(){opened.push(this);}close(){this.onClose();}onClose(){}}
 class Suggest extends Modal {
  placeholder='';setPlaceholder(value:string){this.placeholder=value;}
  getSuggestions(query:string){return (this as any).getItems().filter((item:any)=>item.id.includes(query)).map((item:any)=>({item}));}
  select(item:unknown){this.close();(this as any).onChooseItem(item);}
 }
 runInNewContext((await bundle).outputFiles[0].text,{module,exports:module.exports,require:(id:string)=>id==='obsidian'?{FuzzySuggestModal:Suggest,Modal,Notice:class{constructor(text:string){notices.push(text);}}}:realRequire(id),AbortController,queueMicrotask});
 const app={},project={id:'project'},first={id:'first-thread',projectId:'project'},second={id:'second-thread',projectId:'project'};
 const host={projects:()=>[project],projectLabel:()=>'',threads:async()=>[first,second],runs:async(_project:unknown,thread:typeof first,signal:AbortSignal)=>{reads.push({thread:thread.id,signal});const work=deferred<any[]>();pending.set(thread.id,work);return work.promise;},attach:async()=>{throw Error('No import requested');}};
 module.exports.openRunImport(app,'Synthetic.md',host);opened.at(-1).select(project);await drain();const picker=opened.at(-1);
 picker.getSuggestions('');picker.getSuggestions('thread');await drain();assert.equal(reads.length,0,'empty and ambiguous filters do no history work');
 picker.getSuggestions('first');await drain();picker.getSuggestions('first-thread');await drain();assert.equal(reads.length,1);assert.equal(reads[0].signal.aborted,false);
 picker.getSuggestions('second');await drain();assert.equal(reads[0].signal.aborted,true);assert.equal(reads.length,2);
 pending.get(first.id)!.resolve([]);await drain();assert.equal(opened.at(-1),picker,'an obsolete result cannot open a picker');
 pending.get(second.id)!.resolve([]);await drain();assert.equal(opened.at(-1),picker,'preparation alone cannot select a thread');
 picker.select(second);await drain();assert.equal(reads.length,2,'selection joins the completed read');assert.equal(opened.at(-1).placeholder,'Choose a T3 response');
 assert.ok(!notices.some(text=>text.startsWith('Import T3 run:')));
 module.exports.openRunImport(app,'Synthetic.md',host);opened.at(-1).select(project);await drain();const cancelled=opened.at(-1);cancelled.getSuggestions('first');await drain();cancelled.close();await drain();assert.equal(reads.at(-1)!.signal.aborted,true);pending.get(first.id)!.reject(Error('Cancelled obsolete read'));await drain();assert.ok(!notices.some(text=>text.startsWith('Import T3 run:')));
});
