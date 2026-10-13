import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {runInNewContext} from 'node:vm';

const compiled=build({entryPoints:['note-tab-panel.ts'],bundle:true,platform:'node',format:'cjs',write:false,external:['obsidian']});
async function fixture(){
  const callbacks=new Map<string,Function>(),events=new Map<string,Function>();
  class Element {
    isConnected=true;parentElement?:Element;children:Element[]=[];textContent='Synthetic panel';attributes=new Map<string,string>();focusOptions?:any;
    classList={values:new Set<string>(),add:(name:string)=>this.classList.values.add(name),remove:(name:string)=>this.classList.values.delete(name)};
    style={setProperty:()=>{}};
    ownerDocument:any;
    appendChild(child:Element){child.remove();child.parentElement=this;this.children.push(child);}
    remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(child=>child!==this);this.parentElement=undefined;}
    setAttribute(key:string,value:string){this.attributes.set(key,value);}
    contains(target:Element):boolean{return this===target||this.children.some(child=>child.contains(target));}
    querySelector(){return undefined;}
    focus(options:any){this.focusOptions=options;}
  }
  const doc:any={activeElement:new Element(),defaultView:{HTMLElement:Element,visualViewport:{height:600,addEventListener:()=>{},removeEventListener:()=>{}}},addEventListener:(key:string,callback:Function)=>callbacks.set(key,callback),removeEventListener:(key:string)=>callbacks.delete(key)};
  const host=new Element(),otherHost=new Element();host.ownerDocument=otherHost.ownerDocument=doc;
  const view={file:{path:'Synthetic.md'},containerEl:host},other={file:{path:'Other.md'},containerEl:otherHost};
  const app={workspace:{activeLeaf:{view},getLeavesOfType:()=>[{view},{view:other}],on:(key:string,callback:Function)=>{events.set(key,callback);return key;},offref:(key:string)=>events.delete(key)}};
  let nativeOpen=0,nativeClose=0,opened=0,closed=0;
  class Modal {modalEl=new Element();titleEl=new Element();contentEl=new Element();constructor(public app:any){}open(){nativeOpen++;(this as any).onOpen();}close(){nativeClose++;(this as any).onClose();}}
  const module={exports:{} as any};runInNewContext((await compiled).outputFiles[0].text,{module,exports:module.exports,require:()=>({Modal}),HTMLElement:Element});
  const create=(path='Synthetic.md')=>{const panel=new module.exports.NoteTabPanel(app,path);panel.onOpen=()=>opened++;panel.onClose=()=>closed++;return panel;};
  return {app,host,otherHost,doc,events,callbacks,create,get nativeOpen(){return nativeOpen;},get nativeClose(){return nativeClose;},get opened(){return opened;},get closed(){return closed;}};
}

test('the panel belongs to the captured note tab and closes once without changing other tabs or scroll focus',async()=>{
  const h=await fixture(),panel=h.create();panel.open();
  assert.equal(panel.modalEl.parentElement,h.host);assert.equal(h.otherHost.children.length,0);assert.equal(h.nativeOpen,0);
  assert.equal(panel.modalEl.attributes.get('aria-modal'),'false');
  h.events.get('active-leaf-change')!({view:{file:{path:'Other.md'}}});
  assert.equal(panel.modalEl.parentElement,undefined);assert.equal(h.closed,1);assert.equal(h.callbacks.size,0);assert.equal(h.events.size,0);
  assert.equal(h.doc.activeElement.focusOptions,undefined,'a tab change must keep focus in the new tab');
  panel.close();assert.equal(h.closed,1);assert.equal(h.nativeClose,0);
});

test('Escape outside a panel preserves it and a new panel closes the old panel',async()=>{
  const h=await fixture(),first=h.create();first.open();
  const key=h.callbacks.get('keydown')!;let prevented=0;
  key({key:'Escape',target:h.otherHost,preventDefault:()=>prevented++,stopPropagation:()=>{}});assert.equal(prevented,0);assert.equal(h.closed,0);
  const next=h.create();next.open();assert.equal(h.closed,1);assert.equal(next.modalEl.parentElement,h.host);
  h.callbacks.get('keydown')!({key:'Escape',target:next.modalEl,preventDefault:()=>prevented++,stopPropagation:()=>{}});assert.equal(prevented,1);assert.equal(h.closed,2);
});

test('a workspace with no note tab retains the native modal',async()=>{
  const h=await fixture();h.host.isConnected=false;const panel=h.create();panel.open();assert.equal(h.nativeOpen,1);panel.close();assert.equal(h.nativeClose,1);
});

test('opening gives an enabled panel control keyboard focus without scrolling the note',async()=>{
  const h=await fixture(),panel=h.create(),control=new h.doc.defaultView.HTMLElement();
  panel.modalEl.querySelector=()=>control;panel.open();assert.equal(control.focusOptions.preventScroll,true);panel.close();
});

test('opening another file in the same view closes the old panel without restoring old focus',async()=>{
  const h=await fixture(),panel=h.create();panel.open();
  h.app.workspace.activeLeaf.view.file={path:'Other.md'};h.events.get('file-open')!();
  assert.equal(h.closed,1);assert.equal(panel.modalEl.parentElement,undefined);assert.equal(h.doc.activeElement.focusOptions,undefined);
  assert.equal(h.events.size,0);assert.equal(h.callbacks.size,0);
});
