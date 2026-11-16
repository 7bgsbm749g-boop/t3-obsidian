import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {build} from './build-fixture';
import {runInNewContext} from './obsidian-context';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const compiled=build({entryPoints:['src/conversations/chat-ui.ts'],bundle:true,platform:'node',format:'cjs',external:['obsidian'],write:false});
interface FixtureOptions {automatic?:boolean;remembered?:boolean;steering?:boolean;busy?:boolean;confirmed?:boolean;restriction?:string;prompt?:string}
async function fixture({automatic=false,remembered=false,steering=false,busy=false,confirmed=remembered,restriction='',prompt=''}:FixtureOptions={}){
 const {document,window}=parseHTML('<html><body></body></html>'),modals:any[]=[],menus:any[]=[],notices:string[]=[],sent:any[]=[],checks:any[]=[],previews:string[]=[],preparing:string[]=[],drafts:string[]=[];
 const proto=window.HTMLElement.prototype as any;
 proto.createEl=function(tag:string,o:any={}){const el=document.createElement(tag);el.textContent=o.text??'';el.className=o.cls??'';for(const [k,v] of Object.entries(o.attr??{}))el.setAttribute(k,String(v));this.appendChild(el);return el;};proto.createDiv=function(o:any){return this.createEl('div',o);};proto.createSpan=function(o:any){return this.createEl('span',o);};proto.empty=function(){this.replaceChildren();};proto.setText=function(t:string){this.textContent=t;};
 class Modal{titleEl=document.createElement('h2');contentEl=document.createElement('div');modalEl=document.createElement('div');constructor(public app:any){this.modalEl.className='modal';this.contentEl.className='modal-content';this.modalEl.append(this.titleEl,this.contentEl);}open(){modals.push(this);document.body.append(this.modalEl);(this as any).onOpen?.();}close(){this.modalEl.remove();(this as any).onClose?.();}setPlaceholder(){}}
 class Menu{items:any[]=[];constructor(){menus.push(this);}addItem(f:any){const item:any={setTitle(t:string){this.title=t;return this;},setIcon(){return this;},setChecked(){return this;},onClick(fn:any){this.click=fn;return this;}};f(item);this.items.push(item);return this;}showAtPosition(){}}
 class Setting{constructor(public el:any){}setName(){return this;}addDropdown(fn:any){const el=this.el.createEl('select');Object.defineProperty(el,'value',{value:'',writable:true});fn({addOption(value:string,label:string){const o=document.createElement('option');o.value=value;o.textContent=label;el.append(o);return this;},setValue(value:string){el.value=value;return this;},onChange(change:any){el.addEventListener('change',()=>change(el.value));return this;}});return this;}addButton(fn:any){const el=this.el.createEl('button'),b:any={setButtonText(t:string){el.textContent=t;return this;},setCta(){return this;},onClick(f:any){el.addEventListener('click',f);return this;}};fn(b);return this;}}
 const module={exports:{} as any};runInNewContext((await compiled).outputFiles[0].text,{module,exports:module.exports,require:(id:string)=>id==='obsidian'?{Modal,FuzzySuggestModal:Modal,Setting,Menu,setIcon:(el:any,icon:string)=>{el.setAttribute('data-icon',icon);},Notice:class{constructor(t:string){notices.push(t);}}}:require(id),document,window,HTMLElement:window.HTMLElement,Event:window.Event,setTimeout,clearTimeout,performance,AbortController,DOMException,URL,URLSearchParams,Buffer,structuredClone});
 const listeners=new Set<()=>void>();let pick:any,fail=false;
 const host:any={steering,get busy(){return busy;},onBusyChange:(f:any)=>{listeners.add(f);return ()=>listeners.delete(f);},getThreadChoiceRestriction:()=>restriction||undefined,hasConfirmedNoteSend:()=>confirmed,getNotePath:()=> 'Synthetic.md',getDefaultProjectKey:()=> 'project',getProjectName:(key:string)=>key??'Synthetic',getTargetDescription:()=> 'Synthetic',getProjectChoices:()=>[{key:'other',label:'Other'}],getDefaultThread:()=>remembered?'previous':undefined,getAlternativeProjectKey:()=> 'project',getDefaultDestination:(key:string,signal:AbortSignal)=>new Promise(resolve=>{checks.push({key,signal,resolve});}),beginPreparing:()=>{preparing.push('show');return ()=>preparing.push('clear');},beginSend:()=>{previews.push('show');return ()=>previews.push('clear');},getInlineDefaults:()=>({enabled:true}),draftChanged:(text:string)=>drafts.push(text),chooseExisting:async(_key:any,choose:any,back:any)=>{pick={choose,back};},getModels:async()=>({models:[{selection:{instanceId:'provider',model:'model'},label:'Model',provider:'Provider',options:[]}]}),sendChat:async(text:string,key:string,resolve:any,_back:any,destination:any)=>{sent.push({text,key,destination,options:resolve(),target:'existing'});if(fail)throw Error('Synthetic failure');},sendToNew:async(text:string,key:string,resolve:any)=>{sent.push({text,key,options:resolve(),target:'new'});if(fail)throw Error('Synthetic failure');}};
 const app={workspace:{getLeavesOfType:()=>[],getActiveViewOfType:()=>undefined}};
 const opening=automatic?module.exports.openNoteSendFlow(app,host):Promise.resolve(new module.exports.SendComposer(app,host,prompt).open());await Promise.resolve();
 const modal=modals.at(-1);const button=(label:string)=>modal.contentEl.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement;
 return {app,exports:module.exports,host,opening,modal,modals,document,window,checks,sent,notices,previews,preparing,drafts,listeners,menus,button,pick:()=>pick,setFail:(v:boolean)=>{fail=v;},setBusy:(v:boolean)=>{busy=v;for(const f of listeners)f();},type:(text:string)=>{modal.field.value=text;modal.field.dispatchEvent(new window.Event('input'));}};
}
const continuation={label:'Previous title',threadId:'checked',projectKey:'project',detail:'Previous title · Idle'};
test('one composer defaults to new thread, has real switches, and can send an empty ask',async()=>{
 const h=await fixture({remembered:true});assert.equal(h.checks.length,0);assert.match(h.button('Choose thread').textContent!,/New thread/);assert.equal(h.modal.contentEl.querySelectorAll('textarea').length,1);assert.doesNotMatch(h.modal.contentEl.textContent!,/Overrides|Intermediate agent/);
 assert.equal(h.button('Stream replies into the editor').getAttribute('aria-checked'),'true');await h.modal.choose();assert.equal(h.sent.length,1);assert.equal(h.sent[0].target,'new');assert.equal(h.sent[0].text,'');assert.deepEqual(h.preparing,['show','clear']);
});
test('picker only selects a destination; submission uses its exact identity and typed ask',async()=>{
 const h=await fixture();h.type('Explain this.');await h.modal.pickExisting();assert.equal(h.sent.length,0);h.pick().choose(continuation);
 assert.match(h.button('Choose thread').textContent!,/Previous title/);assert.equal(h.modal.field.value,'Explain this.');assert.equal(h.sent.length,0);await h.modal.choose();assert.equal(h.sent[0].destination.threadId,'checked');assert.equal(h.sent[0].text,'Explain this.');
});
test('picker cancellation retains the draft, switches, model and destination',async()=>{
 const h=await fixture();h.type('Keep this');h.button('Stream replies into the editor').click();h.modal.overrides.modelSelection={instanceId:'p',model:'m'};await h.modal.pickExisting();h.pick().back();
 assert.equal(h.modal.field.value,'Keep this');assert.equal(h.modal.target,'new');assert.equal(h.sent.length,0);assert.equal(h.modal.overrides.inline.enabled,false);assert.equal(h.modal.overrides.modelSelection.model,'m');
});
test('previous-thread choice checks identity and waits for the selected result only on Send',async()=>{
 const h=await fixture({remembered:true});h.modal.select('default');await Promise.resolve();assert.equal(h.checks.length,1);const work=h.modal.choose();assert.equal(h.sent.length,0);assert.deepEqual(h.previews,['show']);h.checks[0].resolve(continuation);await work;assert.equal(h.sent[0].destination.threadId,'checked');assert.deepEqual(h.previews,['show','clear']);
});
test('new thread does not wait on a previous check and late data cannot change the route',async()=>{
 const h=await fixture({remembered:true});h.modal.select('default');await Promise.resolve();h.modal.select('new');assert.equal(h.checks[0].signal.aborted,true);h.checks[0].resolve(continuation);await h.modal.ready;await h.modal.choose();assert.equal(h.sent[0].target,'new');
});
test('redraw coalesces checks and project changes cancel old identity without losing text',async()=>{
 const h=await fixture({steering:true});h.type('Retain');h.modal.onOpen();await Promise.resolve();assert.equal(h.checks.length,1);h.modal.projectKey='other';h.modal.onOpen();await Promise.resolve();assert.equal(h.checks[0].signal.aborted,true);assert.equal(h.modal.field.value,'Retain');h.checks[1].resolve({...continuation,projectKey:'other'});await h.modal.ready;assert.equal(h.modal.destination.projectKey,'other');h.modal.close();
});
test('close before a deferred check cancels host work and late replies cannot reopen',async()=>{
 const h=await fixture({steering:true});h.modal.close();await h.modal.ready;assert.equal(h.checks[0].signal.aborted,true);h.checks[0].resolve(continuation);await Promise.resolve();assert.equal(h.modal.opened,false);assert.equal(h.sent.length,0);
});
test('busy changes and duplicate submissions cannot dispatch twice or lose a draft',async()=>{
 const h=await fixture({steering:true,busy:true});h.type('Keep');assert.equal(h.button('Send ask').disabled,true);await h.modal.choose();assert.equal(h.sent.length,0);h.setBusy(false);const work=h.modal.choose();await h.modal.choose();h.setBusy(true);h.setBusy(false);assert.equal(h.button('Send ask').disabled,true);h.checks[0].resolve(continuation);await work;assert.equal(h.sent.length,1);assert.equal(h.listeners.size,0);
});
test('unavailable previous thread cannot submit, but New thread is still available',async()=>{
 const h=await fixture({steering:true});h.checks[0].resolve({label:'Unavailable',unavailable:true,detail:'Missing thread'});await h.modal.ready;assert.equal(h.button('Send context').disabled,true);await h.modal.choose();assert.equal(h.sent.length,0);assert.match(h.notices[0],/Missing thread/);h.modal.select('new');await h.modal.choose();assert.equal(h.sent[0].target,'new');
});
test('switches resolve per send, disable formatting when streaming is off, and preserve defaults',async()=>{
 const h=await fixture();h.button('Final answer format: Quoted Markdown').click();h.button('Stream replies into the editor').click();assert.equal(h.button('Final answer format: Raw Markdown').disabled,true);h.button('Stream replies into the editor').click();await h.modal.choose();assert.equal(h.sent[0].options.inline.finalAnswerFormat,'raw-markdown');assert.equal(h.sent[0].options.inline.enabled,true);assert.equal(h.host.getInlineDefaults().enabled,true);
});
test('a model choice is resolved into the submitted request and survives UI redraw',async()=>{
 const h=await fixture();h.type('Question');h.modal.overrides.modelSelection={instanceId:'p',model:'chosen',options:[{id:'effort',value:'high'}]};h.modal.onOpen();assert.match(h.button('Choose model').textContent!,/chosen/);await h.modal.choose();assert.equal(h.sent[0].options.modelSelection.model,'chosen');assert.equal(h.sent[0].text,'Question');
});
test('failed sends restore the exact draft and choices for correction',async()=>{
 const h=await fixture();h.type('Keep me');h.button('Stream replies into the editor').click();h.setFail(true);await h.modal.choose();assert.equal(h.modal.opened,true);assert.equal(h.modal.field.value,'Keep me');assert.equal(h.modal.overrides.inline.enabled,false);assert.match(h.notices[0],/Synthetic failure/);h.modal.close();
});
test('1:1 restrictions keep continuation and inline switches but block destination changes',async()=>{
 const h=await fixture({remembered:true,restriction:'1:1 mode keeps the linked thread.'});assert.equal(h.button('Choose thread').disabled,true);assert.equal(h.button('Change project').disabled,true);assert.equal(h.button('Stream replies into the editor').disabled,false);h.checks[0].resolve(continuation);await h.modal.ready;await h.modal.choose();assert.equal(h.sent[0].destination.threadId,'checked');
});
test('Enter sends once, Shift+Enter and IME composition retain multiline text',async()=>{
 const h=await fixture();h.type('Ask');const key=(shiftKey:boolean,isComposing:boolean)=>{const event=new h.window.Event('keydown',{cancelable:true});Object.assign(event,{key:'Enter',shiftKey,isComposing});h.modal.field.dispatchEvent(event);};key(true,false);key(false,true);assert.equal(h.sent.length,0);key(false,false);await new Promise(resolve=>setImmediate(resolve));assert.equal(h.sent.length,1);
});
test('empty asks still check new content in existing destinations; typed asks can follow unchanged context',async()=>{
 const h=await fixture();h.host.hasNewContent=async()=>false;await h.modal.pickExisting();h.pick().choose(continuation);await h.modal.choose();assert.equal(h.sent.length,0);assert.deepEqual(h.notices,['Nothing new to send.']);h.type('Explain further');await h.modal.choose();assert.equal(h.sent.length,1);
});
test('automatic confirmed sends preserve the previous route and preview before checking',async()=>{
 const h=await fixture({automatic:true,remembered:true});assert.equal(h.modals.length,0);assert.deepEqual(h.previews,['show']);h.checks[0].resolve(continuation);await h.opening;assert.equal(h.sent[0].destination.threadId,'checked');assert.deepEqual(h.previews,['show','clear']);
});
test('a first note or selection opens the composer without dispatch or preview',async()=>{
 const h=await fixture({automatic:true});await h.opening;assert.equal(h.modals.length,1);assert.equal(h.sent.length,0);assert.deepEqual(h.previews,[]);h.modal.close();await h.exports.openChatFlow(h.app,h.host,'Captured selection');assert.equal(h.modals.at(-1).field.value,'Captured selection');assert.equal(h.sent.length,0);
});
test('automatic unavailable targets clear preparing feedback without resending',async()=>{
 const h=await fixture({automatic:true,remembered:true});h.checks[0].resolve({unavailable:true,detail:'Missing'});await h.opening;assert.equal(h.sent.length,0);assert.deepEqual(h.preparing,['show','clear']);assert.deepEqual(h.previews,['show','clear']);
});
test('dialog discards display preparation metadata before a later send',async()=>{
 const h=await fixture({steering:true});h.checks[0].resolve({...continuation,preparation:{thread:{id:'checked',projectId:'p'}}});await h.modal.ready;await h.modal.choose();assert.equal(h.sent[0].destination.preparation,undefined);
});

test('project choice clears the old destination and model while retaining the question',async()=>{
 const h=await fixture();h.type('Retain my question');h.modal.overrides.modelSelection={instanceId:'p',model:'old'};await h.modal.pickExisting();h.pick().choose(continuation);
 h.button('Change project').click();h.modals.at(-1).onChooseItem({key:'other',label:'Other'});
 assert.equal(h.modal.projectKey,'other');assert.equal(h.modal.target,'new');assert.equal(h.modal.overrides.modelSelection,undefined);assert.equal(h.modal.field.value,'Retain my question');assert.equal(h.sent.length,0);
});
test('model picker loads the selected machine catalog and applies a model without sending',async()=>{
 const h=await fixture();await h.modal.chooseModel();const picker=h.modals.at(-1),select=picker.contentEl.querySelector('select');select.value='0';select.dispatchEvent(new h.window.Event('change'));
 const apply=Array.from(picker.contentEl.querySelectorAll('button')).find((el:any)=>el.textContent==='Apply') as HTMLButtonElement;apply.click();assert.equal(h.modal.overrides.modelSelection.model,'model');assert.equal(h.sent.length,0);await h.modal.choose();assert.equal(h.sent[0].options.modelSelection.instanceId,'provider');
});
test('closing during existing-thread discovery aborts its route and ignores a late choice',async()=>{
 const h=await fixture();let signal:AbortSignal|undefined,release!:()=>void,choose:any;
 h.host.chooseExisting=async(_key:any,selected:any,_back:any,selectedSignal:any)=>{signal=selectedSignal;choose=selected;await new Promise<void>(resolve=>{release=resolve;});};
 const picking=h.modal.pickExisting();h.modal.close();assert.equal(signal!.aborted,true);choose(continuation);release();await picking;assert.equal(h.modal.opened,false);assert.equal(h.sent.length,0);
});

test('closing synchronously before the deferred check avoids starting network work',async()=>{
 const h=await fixture();let calls=0;h.host.steering=true;h.host.getDefaultDestination=async()=>{calls++;return continuation;};
 const modal=new h.exports.SendComposer(h.app,h.host);modal.open();modal.close();await modal.ready;assert.equal(calls,0);assert.equal(h.sent.length,0);
});
test('a running response keeps its presentation policy and disables conflicting switches',async()=>{
 const h=await fixture({steering:true});h.checks[0].resolve({...continuation,responseId:'active-response'});await h.modal.ready;
 assert.equal(h.button('Stream replies into the editor').disabled,true);assert.equal(h.button('Final answer format: Quoted Markdown').disabled,true);assert.match(h.button('Stream replies into the editor').title,/keeps its streaming choices/);h.modal.close();
});

test('a response-derived project updates the visible selector without losing its draft',async()=>{
 const h=await fixture({steering:true});h.type('Keep the active response context');h.modal.projectKey=undefined;
 h.checks[0].resolve({...continuation,projectKey:'response-project'});await h.modal.ready;
 assert.equal(h.modal.projectKey,'response-project');assert.match(h.button('Change project').textContent!,/response-project/);assert.equal(h.modal.field.value,'Keep the active response context');h.modal.close();
});
