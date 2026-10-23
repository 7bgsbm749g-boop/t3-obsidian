import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {runInNewContext} from 'node:vm';
import {createRequire} from 'node:module';
import type {RunImportResult} from '../run-import';

const bundle=build({stdin:{contents:"export {ImportRunModal} from './run-import-ui';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',write:false,external:['obsidian']});
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
