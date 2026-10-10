import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {runInNewContext} from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const compiled=build({entryPoints:['chat-ui.ts'],bundle:true,platform:'node',format:'cjs',external:['obsidian'],write:false});
async function fixture(alternative?:string,closeImmediately=false){
 const modals:any[]=[];
 class Element{value='';text='';style:any={};disabled=false;isConnected=true;children:any[]=[];events:any={};empty(){this.children=[];}setText(t:string){this.text=t;}focus(){}addEventListener(n:string,f:any){this.events[n]=f;}createEl(_tag:string,o:any={}){const el=new Element();el.text=o.text??'';this.children.push(el);return el;}}
 class Modal{titleEl=new Element();contentEl=new Element();constructor(public app:any){}open(){modals.push(this);(this as any).onOpen?.();}close(){(this as any).onClose?.();}setPlaceholder(){}}
 class Setting{buttons:any[]=[];constructor(_el:any){}setClass(){return this;}setDisabled(v:boolean){this.buttons.forEach(b=>b.buttonEl.disabled=v);return this;}addButton(f:any){const b:any={buttonEl:new Element(),setButtonText(t:string){this.buttonEl.text=t;return this;},setCta(){return this;},setDisabled(v:boolean){this.buttonEl.disabled=v;return this;},onClick(fn:any){this.click=fn;return this;}};f(b);this.buttons.push(b);return this;}}
 const module:any={exports:{}},notices:string[]=[],calls:Array<{key?:string;signal:AbortSignal;resolve:(v:any)=>void}>=[],sent:any[]=[];
 runInNewContext((await compiled).outputFiles[0].text,{module,exports:module.exports,require:(id:string)=>id==='obsidian'?{Modal,FuzzySuggestModal:Modal,Setting,Notice:class{constructor(t:string){notices.push(t);}}}:require(id),setTimeout:(fn:any,ms:number)=>setTimeout(fn,ms===5000?30:ms),clearTimeout,performance,AbortController,DOMException,Event,URL,URLSearchParams,Buffer});
 const host={steering:true,getNotePath:()=> 'Synthetic.md',getDefaultProjectKey:()=> 'project',getAlternativeProjectKey:()=>alternative,getProjectName:()=> 'Synthetic',getTargetDescription:()=> 'Synthetic',getProjectChoices:()=>[],getDefaultThread:()=> 'thread',getDefaultDestination:(key:string|undefined,signal:AbortSignal)=>new Promise(resolve=>{calls.push({key,signal,resolve});}),sendChat:async(_p:any,key:any,_r:any,_b:any,d:any)=>{sent.push({target:'default',key,d});},sendToNew:async(_p:any,key:any)=>{sent.push({target:'new',key});},sendToExisting:async(_p:any,key:any)=>{sent.push({target:'existing',key});}};
 module.exports.openNoteSendFlow({},host);if(closeImmediately)modals[0].close();await Promise.resolve();
 return {modal:modals[0],calls,sent,notices};
}
test('same project redraw coalesces one pending check and obsolete UI cannot update the new project',async()=>{
 const h=await fixture();h.modal.onOpen();await Promise.resolve();assert.equal(h.calls.length,1);
 h.modal.projectKey='other';h.modal.onOpen();await Promise.resolve();assert.equal(h.calls.length,2);assert.equal(h.calls[0].signal.aborted,true);
 h.calls[0].resolve({label:'Wrong old thread',threadId:'old',projectKey:'project'});
 h.calls[1].resolve({label:'Continue other',threadId:'new',projectKey:'other'});
 const result=await h.modal.ready;assert.equal(result.threadId,'new');assert.equal(h.modal.defaultButton.text,'Continue other');assert.equal(h.modal.projectKey,'other');h.modal.close();assert.equal(h.sent.length,0);
});
test('close cancels a check and late result cannot dispatch or reopen the dialog',async()=>{
 const h=await fixture();const ready=h.modal.ready;h.modal.close();assert.equal(h.calls[0].signal.aborted,true);await ready;
 h.calls[0].resolve({label:'Continue',threadId:'old'});await Promise.resolve();assert.equal(h.modal.opened,false);assert.equal(h.sent.length,0);assert.deepEqual(h.notices,[]);
});
test('deadline resolves stalled check with retry state',async()=>{
 const h=await fixture();const result=await h.modal.ready;assert.equal(result.unavailable,true);assert.equal(h.calls[0].signal.aborted,true);assert.match(result.detail,/took too long/);assert.equal(h.modal.defaultButton.disabled,true);h.modal.close();
});
test('New thread uses captured routing without awaiting old check and refuses unknown routing',async()=>{
 const h=await fixture('captured-project');h.modal.projectKey=undefined;await h.modal.choose('new');assert.equal(h.sent[0].key,'captured-project');assert.equal(h.calls[0].signal.aborted,true);
 const unknown=await fixture();unknown.modal.projectKey=undefined;await unknown.modal.choose('new');assert.equal(unknown.sent.length,0);assert.match(unknown.notices[0],/Choose a project/);unknown.modal.close();
});

test('close before the first deferred check never starts host work',async()=>{
 const h=await fixture(undefined,true);await h.modal.ready;assert.equal(h.calls.length,0);assert.equal(h.sent.length,0);
});
