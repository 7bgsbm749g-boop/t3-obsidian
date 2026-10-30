import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {runInNewContext} from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const compiled=build({entryPoints:['chat-ui.ts'],bundle:true,platform:'node',format:'cjs',external:['obsidian'],write:false});
async function fixture(alternative?:string,closeImmediately=false,initialBusy=false,automatic=false,remembered=true,hasContent?:boolean){
 const modals:any[]=[];
 class Element{value='';text='';style:any={};disabled=false;isConnected=true;children:any[]=[];events:any={};empty(){this.children=[];}setText(t:string){this.text=t;}focus(){}addEventListener(n:string,f:any){this.events[n]=f;}createEl(_tag:string,o:any={}){const el=new Element();el.text=o.text??'';this.children.push(el);return el;}}
 class Modal{titleEl=new Element();contentEl=new Element();constructor(public app:any){}open(){modals.push(this);(this as any).onOpen?.();}close(){(this as any).onClose?.();}setPlaceholder(){}}
 class Setting{buttons:any[]=[];constructor(_el:any){}setClass(){return this;}setDisabled(v:boolean){this.buttons.forEach(b=>b.buttonEl.disabled=v);return this;}addButton(f:any){const b:any={buttonEl:new Element(),setButtonText(t:string){this.buttonEl.text=t;return this;},setCta(){return this;},setDisabled(v:boolean){this.buttonEl.disabled=v;return this;},onClick(fn:any){this.click=fn;return this;}};f(b);this.buttons.push(b);return this;}}
 const module:any={exports:{}},notices:string[]=[],calls:Array<{key?:string;signal:AbortSignal;resolve:(v:any)=>void}>=[],sent:any[]=[];
 runInNewContext((await compiled).outputFiles[0].text,{module,exports:module.exports,require:(id:string)=>id==='obsidian'?{Modal,FuzzySuggestModal:Modal,Setting,Notice:class{constructor(t:string){notices.push(t);}}}:require(id),setTimeout:(fn:any,ms:number)=>setTimeout(fn,ms===5000?30:ms),clearTimeout,performance,AbortController,DOMException,Event,URL,URLSearchParams,Buffer});
 let busy=initialBusy;const busyListeners=new Set<()=>void>();
 const host={hasNewContent:hasContent===undefined?undefined:async()=>hasContent,get busy(){return busy;},onBusyChange:(listener:()=>void)=>{busyListeners.add(listener);return ()=>busyListeners.delete(listener);},steering:remembered,getNotePath:()=> 'Synthetic.md',getDefaultProjectKey:()=> 'project',getAlternativeProjectKey:()=>alternative,getProjectName:()=> 'Synthetic',getTargetDescription:()=> 'Synthetic',getProjectChoices:()=>[],getDefaultThread:()=>remembered?'thread':undefined,getDefaultDestination:(key:string|undefined,signal:AbortSignal)=>new Promise(resolve=>{calls.push({key,signal,resolve});}),sendChat:async(_p:any,key:any,_r:any,_b:any,d:any)=>{sent.push({target:'default',key,d});},sendToNew:async(_p:any,key:any)=>{sent.push({target:'new',key});},sendToExisting:async(_p:any,key:any)=>{sent.push({target:'existing',key});}};
 const opening=module.exports.openNoteSendFlow({},host,!automatic);if(closeImmediately)modals[0].close();await Promise.resolve();
 return {exports:module.exports,host,opening,modals,modal:modals[0],calls,sent,notices,busyListeners,setBusy:(value:boolean)=>{busy=value;for(const listener of busyListeners)listener();}};
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

test('the previous-thread action is usable immediately and a click waits for its exact check',async()=>{
 const h=await fixture();assert.equal(h.modal.defaultButton.disabled,false);
 const sending=h.modal.choose('default');assert.equal(h.sent.length,0);assert.equal(h.modal.defaultButton.disabled,true);
 h.calls[0].resolve({label:'Continue thread',threadId:'checked',projectKey:'project'});await sending;
 assert.equal(h.sent.length,1);assert.equal(h.sent[0].d.threadId,'checked');
});

test('an open busy window becomes available without losing its route or restarting its thread check',async()=>{
 const h=await fixture(undefined,false,true),modal=h.modal;
 assert.equal(modal.actions.buttons.every((b:any)=>b.buttonEl.disabled),true);
 const busyDetail=modal.contentEl.children[2];assert.match(busyDetail.text,/Another send/);assert.equal(busyDetail.hidden,false);
 await modal.choose('new');assert.equal(h.sent.length,0);
 h.setBusy(false);
 assert.equal(modal.actions.buttons.every((b:any)=>!b.buttonEl.disabled),true);
 assert.equal(busyDetail.hidden,true);assert.equal(h.calls.length,1);assert.equal(modal.projectKey,'project');
 await modal.choose('new');assert.deepEqual(h.sent,[{target:'new',key:'project'}]);assert.equal(h.busyListeners.size,0);
});

test('busy transitions retain an unavailable default and do not unlock a pending submission',async()=>{
 const h=await fixture();
 h.calls[0].resolve({label:'Thread unavailable',unavailable:true,detail:'Missing thread'});await h.modal.ready;
 h.setBusy(true);h.setBusy(false);
 assert.equal(h.modal.defaultButton.disabled,true);assert.equal(h.modal.actions.buttons[1].buttonEl.disabled,false);
 h.modal.close();assert.equal(h.busyListeners.size,0);
 const sending=await fixture(),work=sending.modal.choose('default');
 sending.setBusy(true);sending.setBusy(false);
 assert.equal(sending.modal.actions.buttons.every((b:any)=>b.buttonEl.disabled),true);
 sending.calls[0].resolve({label:'Continue thread',threadId:'checked',projectKey:'project'});await work;assert.equal(sending.sent.length,1);
});

test('redraw and close release busy listeners and preserve an unsent composer draft',async()=>{
 const h=await fixture();
 h.modal.composing=true;h.modal.onOpen();h.modal.field.value='Keep this message.';
 assert.equal(h.busyListeners.size,1);
 h.setBusy(true);h.setBusy(false);assert.equal(h.modal.field.value,'Keep this message.');
 h.modal.close();assert.equal(h.busyListeners.size,0);h.setBusy(true);assert.equal(h.sent.length,0);
});

test('automatic default checks and sends the exact previous thread without opening a panel',async()=>{
 const h=await fixture(undefined,false,false,true);assert.equal(h.modals.length,0);assert.equal(h.sent.length,0);
 h.calls[0].resolve({label:'Continue thread',threadId:'checked',projectKey:'project'});await h.opening;
 assert.equal(h.modals.length,0);assert.equal(h.sent.length,1);assert.equal(h.sent[0].d.threadId,'checked');
});

test('automatic sending creates a new thread only when no default exists',async()=>{
 const h=await fixture(undefined,false,false,true,false);await h.opening;
 assert.equal(h.modals.length,0);assert.equal(h.calls.length,0);assert.deepEqual(h.sent,[{target:'new',key:'project'}]);
});

test('an unavailable or timed-out automatic default sends nothing and never falls back to New thread',async()=>{
 const unavailable=await fixture(undefined,false,false,true);unavailable.calls[0].resolve({label:'Thread unavailable',unavailable:true,detail:'Missing thread'});await unavailable.opening;
 assert.equal(unavailable.sent.length,0);assert.equal(unavailable.modals.length,0);assert.match(unavailable.notices[0],/Missing thread/);
 const timeout=await fixture(undefined,false,false,true);await timeout.opening;
 assert.equal(timeout.sent.length,0);assert.equal(timeout.calls[0].signal.aborted,true);assert.match(timeout.notices[0],/took too long/);
 timeout.calls[0].resolve({label:'Late thread',threadId:'late'});await Promise.resolve();assert.equal(timeout.sent.length,0);
});


test('an unchanged automatic send opens the selector and removes the previous-thread action',async()=>{
 const h=await fixture(undefined,false,false,true,true,false);
 h.calls[0].resolve({label:'Continue thread',threadId:'checked',projectKey:'project'});await h.opening;
 assert.equal(h.modals.length,1);assert.equal(h.sent.length,0);assert.deepEqual(h.notices,[]);
 h.calls[1].resolve({label:'Continue thread',threadId:'checked',projectKey:'project'});await h.modals[0].ready;
 assert.equal(h.modals[0].defaultButton.hidden,true);
 const buttons=h.modals[0].actions.buttons.filter((button:any)=>!button.buttonEl.hidden).map((button:any)=>button.buttonEl.text);
 assert.deepEqual(Array.from(buttons),['New thread','Existing thread…']);
 await h.modals[0].choose('default');assert.deepEqual(h.notices,['Nothing new to send.']);assert.equal(h.sent.length,0);h.modals[0].close();
});
test('an unchanged selector still allows a new destination and typed Ask retains its draft',async()=>{
 const h=await fixture(undefined,false,false,false,true,false);h.calls[0].resolve({label:'Continue thread',threadId:'checked',projectKey:'project'});await h.modal.ready;
 await h.modal.choose('new');assert.deepEqual(h.sent,[{target:'new',key:'project'}]);
 const saved:string[]=[],submitted:any[]=[];
 const composer=new h.exports.AskComposer({},'Synthetic.md','Saved question',(text:string)=>saved.push(text),async(text:string,choose:boolean)=>{submitted.push({text,choose});});
 composer.open();assert.equal(composer.titleEl.hidden,true);assert.equal(composer.field.value,'Saved question');
 composer.field.value='Another question';composer.field.events.input();await composer.send(true);
 assert.deepEqual(submitted,[{text:'Another question',choose:true}]);assert.ok(saved.includes('Another question'));
});
test('a note with no source also opens only New and Existing when no previous thread exists',async()=>{
 const h=await fixture(undefined,false,false,true,false,false);await h.opening;
 assert.equal(h.modals.length,1);assert.equal(h.calls.length,0);assert.equal(h.sent.length,0);assert.equal(h.modals[0].defaultButton,undefined);h.modals[0].close();
});

test('1:1 linked-note chooser keeps continuation and overrides while blocking new thread and project changes',async()=>{
 const h=await fixture();(h.host as any).getThreadChoiceRestriction=()=> '1:1 mode: continue the linked thread.';
 h.modal.onOpen();await Promise.resolve();
 assert.equal(h.modal.actions.buttons[1].buttonEl.hidden,true);assert.equal(h.modal.actions.buttons[2].buttonEl.hidden,true);
 assert.equal(h.modal.contentEl.children[0].children[0].disabled,true);assert.equal(h.modal.contentEl.children[0].children[1].disabled,false);
 h.setBusy(true);h.setBusy(false);assert.equal(h.modal.actions.buttons[1].buttonEl.disabled,true);
 await h.modal.choose('new');assert.equal(h.sent.length,0);assert.match(h.notices[0],/1:1 mode/);
 h.calls[0].resolve({label:'Continue thread',threadId:'one',projectKey:'project'});await h.modal.ready;
 await h.modal.choose('default');assert.equal(h.sent.length,1);assert.equal(h.sent[0].d.threadId,'one');
});
