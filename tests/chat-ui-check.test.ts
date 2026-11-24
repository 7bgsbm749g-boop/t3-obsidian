import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {build} from './build-fixture';
import {runInNewContext} from './obsidian-context';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const compiled=build({stdin:{contents:"export * from './src/conversations/chat-ui'; export {ProjectCreationCancelled} from './src/projects/project-create-ui';",resolveDir:process.cwd(),sourcefile:'chat-ui-fixture.ts'},bundle:true,platform:'node',format:'cjs',external:['obsidian'],write:false});
interface FixtureOptions {automatic?:boolean;remembered?:boolean;steering?:boolean;busy?:boolean;confirmed?:boolean;restriction?:string;prompt?:string}
async function fixture({automatic=false,remembered=false,steering=false,busy=false,confirmed=remembered,restriction='',prompt=''}:FixtureOptions={}){
 const {document,window}=parseHTML('<html><body></body></html>'),modals:any[]=[],menus:any[]=[],notices:string[]=[],sent:any[]=[],checks:any[]=[],previews:string[]=[],preparing:string[]=[],drafts:string[]=[];
 const proto=window.HTMLElement.prototype as any;
 proto.createEl=function(tag:string,o:any={}){const el=document.createElement(tag);el.textContent=o.text??'';el.className=o.cls??'';for(const [k,v] of Object.entries(o.attr??{}))el.setAttribute(k,String(v));this.appendChild(el);return el;};proto.createSvg=function(tag:string,o:any={}){const el=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v] of Object.entries(o.attr??{}))el.setAttribute(k,String(v));this.appendChild(el);return el;};proto.createDiv=function(o:any){return this.createEl('div',o);};proto.createSpan=function(o:any){return this.createEl('span',o);};proto.empty=function(){this.replaceChildren();};proto.setText=function(t:string){this.textContent=t;};
 class Modal{titleEl=document.createElement('h2');contentEl=document.createElement('div');modalEl=document.createElement('div');constructor(public app:any){this.modalEl.className='modal';this.contentEl.className='modal-content';this.modalEl.append(this.titleEl,this.contentEl);}open(){modals.push(this);document.body.append(this.modalEl);(this as any).onOpen?.();}close(){this.modalEl.remove();(this as any).onClose?.();}setPlaceholder(){}}
 class Menu{items:any[]=[];constructor(){menus.push(this);}addItem(f:any){const item:any={setTitle(t:string){this.title=t;return this;},setIcon(){return this;},setChecked(){return this;},onClick(fn:any){this.click=fn;return this;}};f(item);this.items.push(item);return this;}showAtPosition(){}}
 class Component{
  private listeners:Array<()=>void>=[];
  load(){}
  unload(){for(const dispose of this.listeners)dispose();}
  registerDomEvent(target:EventTarget,event:string,listener:EventListener){target.addEventListener(event,listener);this.listeners.push(()=>target.removeEventListener(event,listener));}
 }
 proto.setCssProps=function(props:Record<string,string>){for(const [name,value] of Object.entries(props))this.style.setProperty(name,value);};
 const module={exports:{} as any};runInNewContext((await compiled).outputFiles[0].text,{module,exports:module.exports,require:(id:string)=>id==='obsidian'?{Modal,FuzzySuggestModal:Modal,Component,Platform:{isMacOS:false},Menu,setIcon:(el:any,icon:string)=>{el.setAttribute('data-icon',icon);},Notice:class{constructor(t:string){notices.push(t);}}}:require(id),document,window,HTMLElement:window.HTMLElement,Event:window.Event,setTimeout,clearTimeout,performance,AbortController,DOMException,URL,URLSearchParams,Buffer,structuredClone,crypto:globalThis.crypto});
 const listeners=new Set<()=>void>();let pick:any,fail=false;
 const host:any={steering,get busy(){return busy;},onBusyChange:(f:any)=>{listeners.add(f);return ()=>listeners.delete(f);},getThreadChoiceRestriction:()=>restriction||undefined,hasConfirmedNoteSend:()=>confirmed,getNotePath:()=> 'Synthetic.md',getDefaultProjectKey:()=> 'project',getProjectName:(key:string)=>key??'Synthetic',getTargetDescription:()=> 'Synthetic',getProjectChoices:()=>[{key:'other',label:'Other'}],getDefaultThread:()=>remembered?'previous':undefined,getAlternativeProjectKey:()=> 'project',getDefaultDestination:(key:string,signal:AbortSignal)=>new Promise(resolve=>{checks.push({key,signal,resolve});}),beginPreparing:()=>{preparing.push('show');return ()=>preparing.push('clear');},beginSend:()=>{previews.push('show');return ()=>previews.push('clear');},getInlineDefaults:()=>({enabled:true}),draftChanged:(text:string)=>drafts.push(text),chooseExisting:async(_key:any,choose:any,back:any)=>{pick={choose,back};},getModels:async()=>({selection:{instanceId:'provider',model:'model'},models:[{selection:{instanceId:'provider',model:'model'},label:'Model',provider:'Provider',driver:'codex',options:[{id:'reasoning',label:'Reasoning',type:'select',options:[{id:'low',label:'Low',isDefault:true},{id:'high',label:'High'}]}],commands:[{name:'compact',description:'Compact context'}],skills:[{name:'review',path:'/skills/review/SKILL.md',description:'Review the changes'}]}]}),sendChat:async(text:string,key:string,resolve:any,_back:any,destination:any)=>{sent.push({text,key,destination,options:resolve(),target:'existing'});if(fail)throw Error('Synthetic failure');},sendToNew:async(text:string,key:string,resolve:any)=>{sent.push({text,key,options:resolve(),target:'new'});if(fail)throw Error('Synthetic failure');}};
 window.SVGElement.prototype.createSvg=proto.createSvg;
 const app={workspace:{getLeavesOfType:()=>[],getActiveViewOfType:()=>undefined}};
 const opening=automatic?module.exports.openNoteSendFlow(app,host):Promise.resolve(new module.exports.SendComposer(app,host,prompt).open());await Promise.resolve();
 const modal=modals.at(-1);const button=(label:string)=>Array.from(modal.contentEl.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find(el=>(el.getAttribute('aria-label')??document.getElementById(el.getAttribute('aria-labelledby')??'')?.textContent)===label)!;
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
 const h=await fixture();const stream=h.button('Stream replies into the editor');assert.equal(stream.querySelector('span')?.textContent,'Stream replies into note: On');h.button('Final answer format: Quoted Markdown').click();stream.click();assert.equal(stream.querySelector('span')?.textContent,'Stream replies into note: Off');assert.equal(h.button('Final answer format: Raw Markdown').disabled,true);stream.click();await h.modal.choose();assert.equal(h.sent[0].options.inline.finalAnswerFormat,'raw-markdown');assert.equal(h.sent[0].options.inline.enabled,true);assert.equal(h.host.getInlineDefaults().enabled,true);
});
test('format switch keeps its accessible name without an Obsidian hover tooltip',async()=>{
 const h=await fixture();const format=h.button('Final answer format: Quoted Markdown');assert.ok(format);assert.equal(format.hasAttribute('aria-label'),false);assert.equal(format.hasAttribute('title'),false);format.click();assert.equal(h.button('Final answer format: Raw Markdown'),format);
 assert.equal(h.modal.modalEl.hasAttribute('aria-label'),false);assert.equal(h.document.getElementById(h.modal.modalEl.getAttribute('aria-labelledby'))?.textContent,'Send composer');assert.equal(h.modal.field.hasAttribute('aria-label'),false);assert.equal(h.document.getElementById(h.modal.field.getAttribute('aria-labelledby'))?.textContent,'Ask about this note or selection');const stream=h.button('Stream replies into the editor');assert.equal(stream.hasAttribute('aria-label'),false);assert.equal(stream.hasAttribute('title'),false);h.modal.close();
});
test('format icons identify quoted and raw Markdown before hover and retain the label while typing',async()=>{
 const h=await fixture();const format=h.button('Final answer format: Quoted Markdown');assert.equal(format.getAttribute('data-icon'),'quote');format.click();assert.equal(format.getAttribute('data-icon'),'code');assert.equal(format.querySelector('span')?.textContent,'Raw Markdown');const label=format.querySelector('span');h.type('Keep typing');assert.equal(format.querySelector('span'),label);format.click();assert.equal(format.getAttribute('data-icon'),'quote');assert.equal(format.querySelector('span')?.textContent,'Quoted Markdown');h.modal.close();
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
test('a first explicit note or selection send dispatches without opening the composer',async()=>{
 const h=await fixture({automatic:true});await h.opening;assert.equal(h.modals.length,0);assert.equal(h.sent.length,1);await h.exports.openChatFlow(h.app,h.host,'Captured selection');assert.equal(h.modals.length,0);assert.equal(h.sent.at(-1).text,'Captured selection');
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
 const h=await fixture();h.type('Keep this question');
 const anchor=h.button('Choose model');await h.modal.chooseModel(anchor);
 const picker=h.document.querySelector('[aria-label="Model for this send"]')!;
 assert.ok(picker.querySelector('[aria-label="Search models"]'));
 const high=picker.querySelector<HTMLButtonElement>('[aria-label="High"]')!;
 high.click();await Promise.resolve();
 assert.equal(h.modal.field.value,'Keep this question');assert.equal(h.sent.length,0);
 assert.match(anchor.textContent!,/High/);
 await h.modal.choose();
 assert.equal(h.sent[0].options.modelSelection.instanceId,'provider');
 assert.equal(h.sent[0].options.modelSelection.options[0].value,'high');
 assert.equal(picker.isConnected,false);
});
test('reset uses the destination model and changing thread closes its picker',async()=>{
 const h=await fixture();h.modal.overrides.modelSelection={instanceId:'other',model:'changed'};
 await h.modal.chooseModel(h.button('Choose model'));
 const picker=h.document.querySelector('[aria-label="Model for this send"]')!;
 picker.querySelector<HTMLButtonElement>('[aria-label="Use destination default"]')!.click();await Promise.resolve();
 assert.equal(h.modal.overrides.modelSelection,undefined);
 assert.match(h.button('Choose model').textContent!,/^Model/);
 await h.modal.pickExisting();assert.equal(picker.isConnected,false);
 h.pick().choose(continuation);await h.modal.choose();
 assert.equal(h.sent[0].options.modelSelection.model,'model');
});
test('a model override can be cleared when the destination model is unknown',async()=>{
 const h=await fixture(),{models}=await h.host.getModels();
 h.host.getModels=async()=>({models});
 h.modal.modelLoadKey=undefined;h.modal.onOpen();await h.modal.modelReady;
 h.host.getModels=async()=>{throw Error('Temporarily offline');};
 await h.modal.chooseModel(h.button('Choose model'));
 const picker=h.document.querySelector('[aria-label="Model for this send"]')!;
 picker.querySelector<HTMLButtonElement>('.t3-model-picker-model')!.click();await Promise.resolve();
 assert.equal(h.modal.overrides.modelSelection.model,'model');
 picker.querySelector<HTMLButtonElement>('[aria-label="Use destination default"]')!.click();await Promise.resolve();
 assert.equal(h.modal.overrides.modelSelection,undefined);
 assert.equal(h.sent.length,0);h.modal.close();
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
 assert.equal(h.button('Stream replies into the editor').disabled,true);assert.equal(h.button('Final answer format: Quoted Markdown').disabled,true);assert.match(h.button('Stream replies into the editor').getAttribute('aria-description')??'',/keeps its streaming choices/);h.modal.close();
});

test('a response-derived project updates the visible selector without losing its draft',async()=>{
 const h=await fixture({steering:true});h.type('Keep the active response context');h.modal.projectKey=undefined;
 h.checks[0].resolve({...continuation,projectKey:'response-project'});await h.modal.ready;
 assert.equal(h.modal.projectKey,'response-project');assert.match(h.button('Change project').textContent!,/response-project/);assert.equal(h.modal.field.value,'Keep the active response context');h.modal.close();
});

test('opening resolves the actual default model and renders its provider glyph without opening a picker',async()=>{
 const h=await fixture();await h.modal.modelReady;
 assert.match(h.button('Choose model').textContent!,/Model/);assert.doesNotMatch(h.button('Choose model').textContent!,/T3 default|Thread model/);
 assert.ok(h.button('Choose model').querySelector('svg path'));assert.equal(h.button('Choose model').querySelector('[data-icon="sparkles"]'),null);
});
test('thread state stays on its control and ordinary selection adds no status footer',async()=>{
 const h=await fixture();await h.modal.pickExisting();h.pick().choose({...continuation,status:'Running'});await h.modal.modelReady;
 assert.equal(h.button('Choose thread').dataset.state,'running');assert.match(h.button('Choose thread').title,/Running/);
 assert.equal(h.modal.contentEl.querySelector('.t3-send-detail').hidden,true);
});
test('suggestion Enter chooses a real catalog skill without dispatch; submission freezes its context',async()=>{
 const h=await fixture();await h.modal.modelReady;
 const input=h.modal.field;input.setRangeText=(text:string,start:number,end:number)=>{input.value=input.value.slice(0,start)+text+input.value.slice(end);input.selectionStart=start+text.length;};
 h.type('$rev');await new Promise(resolve=>setImmediate(resolve));
 assert.equal(input.getAttribute('aria-expanded'),'true');assert.match(h.modal.contentEl.textContent!,/Review the changes/);
 const event=new h.window.Event('keydown');Object.defineProperty(event,'key',{value:'Enter'});input.dispatchEvent(event);
 assert.equal(input.value,'$review ');assert.equal(h.sent.length,0);await h.modal.choose();
 assert.equal(h.sent[0].options.context.records[0].kind,'skill');assert.equal(h.sent[0].options.context.records[0].path,'/skills/review/SKILL.md');
});
test('file suggestions search the chosen project and ignore a result after close',async()=>{
 const h=await fixture();await h.modal.modelReady;let resolve!: (files:string[])=>void;let key:string|undefined;
 h.host.searchFiles=(_query:string,projectKey:string)=>{key=projectKey;return new Promise<string[]>(done=>{resolve=done;});};
 h.type('@read');await new Promise(done=>setImmediate(done));assert.equal(key,'project');h.modal.close();resolve(['README.md']);await new Promise(done=>setImmediate(done));
 assert.equal(h.modal.contentEl.querySelector('.t3-send-suggestions'),null);assert.equal(h.sent.length,0);
});
test('a late model catalog from a previous project cannot relabel the current project',async()=>{
 const h=await fixture();await h.modal.modelReady;let release!: (result:any)=>void;
 h.host.getModels=(key:string)=>key==='old'?new Promise(done=>{release=done;}):Promise.resolve({selection:{instanceId:'p',model:'current'},models:[{selection:{instanceId:'p',model:'current'},label:'Current model',options:[]}]});
 h.modal.projectKey='old';h.modal.onOpen();h.modal.projectKey='current';h.modal.onOpen();await h.modal.modelReady;
 release({selection:{instanceId:'p',model:'stale'},models:[]});await new Promise(done=>setImmediate(done));assert.match(h.button('Choose model').textContent!,/Current model/);
});
test('slash model opens the actual model picker and does not send the command',async()=>{
 const h=await fixture();await h.modal.modelReady;const input=h.modal.field;
 input.setRangeText=(text:string,start:number,end:number)=>{input.value=input.value.slice(0,start)+text+input.value.slice(end);};
 h.type('/model');await new Promise(done=>setImmediate(done));const event=new h.window.Event('keydown');Object.defineProperty(event,'key',{value:'Enter'});input.dispatchEvent(event);await new Promise(done=>setImmediate(done));
 assert.equal(h.sent.length,0);assert.equal(input.value,'');assert.ok(h.document.querySelector('[aria-label="Model for this send"]'));
});
test('a selected file context is removed when its token is deleted',async()=>{
 const h=await fixture();await h.modal.modelReady;h.host.searchFiles=async()=>['README.md'];const input=h.modal.field;
 input.setRangeText=(text:string,start:number,end:number)=>{input.value=input.value.slice(0,start)+text+input.value.slice(end);};
 h.type('@README');await new Promise(done=>setImmediate(done));const event=new h.window.Event('keydown');Object.defineProperty(event,'key',{value:'Enter'});input.dispatchEvent(event);
 assert.equal(h.modal.overrides.context.records[0].path,'README.md');h.type('@README.md-old');assert.equal(h.modal.overrides.context,undefined);h.type('A different question');assert.equal(h.modal.overrides.context,undefined);await h.modal.choose();assert.equal(h.sent[0].options.context,undefined);
});
test('menus use T3 fuzzy matching and /skill: filters the list to skills',async()=>{
 const h=await fixture();await h.modal.modelReady;
 h.type('/mdl');await new Promise(done=>setImmediate(done));assert.match(h.modal.contentEl.querySelector('.t3-send-suggestions').textContent!,/\/model/);
 h.type('/skill:');await new Promise(done=>setImmediate(done));const list=h.modal.contentEl.querySelector('.t3-send-suggestions');assert.match(list.textContent!,/\/skill:review/);assert.doesNotMatch(list.textContent!,/\/model|\/compact/);assert.equal(list.getAttribute('aria-label'),'Commands');
});
test('an explicit model click retries a failed catalog read',async()=>{
 const h=await fixture();await h.modal.modelReady;h.host.getModels=async()=>{throw Error('Temporarily offline');};h.modal.modelLoadKey=undefined;h.modal.onOpen();await h.modal.modelReady;assert.match(h.button('Choose model').textContent!,/unavailable/);
 h.host.getModels=async()=>({selection:{instanceId:'p',model:'restored'},models:[{selection:{instanceId:'p',model:'restored'},label:'Restored',provider:'P',options:[],commands:[],skills:[]}]});await h.modal.chooseModel(h.button('Choose model'));assert.ok(h.document.querySelector('[aria-label="Model for this send"]'));assert.match(h.button('Choose model').textContent!,/Restored/);
});

test('changing projects drops selected file and skill records before rebuilding suggestions',async()=>{
 const h=await fixture();await h.modal.modelReady;h.host.searchFiles=async()=>['README.md'];
 const select=async(text:string)=>{const input=h.modal.field;input.setRangeText=(value:string,start:number,end:number)=>{input.value=input.value.slice(0,start)+value+input.value.slice(end);input.selectionStart=start+value.length;};input.selectionStart=text.length;h.type(text);await new Promise(done=>setImmediate(done));const event=new h.window.Event('keydown');Object.assign(event,{key:'Enter'});input.dispatchEvent(event);};
 await select('@README');await select(h.modal.field.value+'$rev');assert.equal(h.modal.overrides.context.records.length,2);
 const draft=h.modal.field.value;h.button('Change project').click();await h.modals.at(-1).onChooseItem({key:'other',label:'Other'});
 assert.equal(h.modal.field.value,draft);assert.equal(h.modal.overrides.context,undefined);
 h.modal.onOpen();await h.modal.choose();assert.equal(h.sent[0].key,'other');assert.equal(h.sent[0].options.context,undefined);
});

test('Enter cannot submit while file suggestions load, and selects only after results arrive',async()=>{
 const h=await fixture();await h.modal.modelReady;let release!:(files:string[])=>void;
 h.host.searchFiles=()=>new Promise<string[]>(resolve=>{release=resolve;});const input=h.modal.field;
 input.setRangeText=(value:string,start:number,end:number)=>{input.value=input.value.slice(0,start)+value+input.value.slice(end);};
 h.type('@read');const enter=()=>{const event=new h.window.Event('keydown',{cancelable:true});Object.assign(event,{key:'Enter'});input.dispatchEvent(event);return event;};
 assert.equal(enter().defaultPrevented,true);await new Promise(done=>setImmediate(done));assert.equal(h.sent.length,0);
 release(['README.md']);await new Promise(done=>setImmediate(done));enter();assert.equal(input.value,'@README.md ');assert.equal(h.sent.length,0);assert.equal(h.modal.overrides.context.records[0].path,'README.md');
 await h.modal.choose();assert.equal(h.sent.length,1);
});

for(const result of ['empty','error'])test(`Enter does not send from an open ${result} suggestion list`,async()=>{
 const h=await fixture();await h.modal.modelReady;h.host.searchFiles=async()=>{if(result==='error')throw Error('Offline workspace');return [];};
 h.type('@missing');await new Promise(done=>setImmediate(done));const key=(key:string)=>{const event=new h.window.Event('keydown',{cancelable:true});Object.assign(event,{key});h.modal.field.dispatchEvent(event);};
 key('Enter');await new Promise(done=>setImmediate(done));assert.equal(h.sent.length,0);key('Escape');key('Enter');await new Promise(done=>setImmediate(done));assert.equal(h.sent.length,1);
});

test('new project waits for its machine choice and then loads and submits only that catalog',async()=>{
 const h=await fixture();await h.modal.modelReady;let choose!:(key:string)=>void;
 h.host.chooseProject=()=>new Promise<string>(resolve=>{choose=resolve;});
 const loads:string[]=[];h.host.getModels=async(key:string)=>{loads.push(key);assert.equal(key,'folder:new:other-machine');return {selection:{instanceId:'other-provider',model:'other-model'},models:[{selection:{instanceId:'other-provider',model:'other-model'},label:'Other model',options:[],commands:[],skills:[]}]};};
 h.type('Keep this ask');const picking=h.modal.changeProject('folder:new');
 assert.equal(h.button('Send ask').disabled,true);assert.equal(loads.length,0);assert.equal(h.sent.length,0);
 choose('folder:new:other-machine');await picking;await h.modal.modelReady;assert.match(h.button('Choose model').textContent!,/Other model/);
 await h.modal.choose();assert.equal(h.sent[0].key,'folder:new:other-machine');assert.equal(h.sent[0].options.modelSelection.instanceId,'other-provider');assert.equal(h.sent[0].text,'Keep this ask');
});

test('cancelled machine selection retains the previous project, model and draft',async()=>{
 const h=await fixture();await h.modal.modelReady;h.type('Keep this');h.modal.overrides.modelSelection={instanceId:'old',model:'old-model'};
 h.host.chooseProject=async()=>{throw new h.exports.ProjectCreationCancelled();};await h.modal.changeProject('folder:new');
 assert.equal(h.modal.projectKey,'project');assert.equal(h.modal.field.value,'Keep this');assert.equal(h.modal.overrides.modelSelection.model,'old-model');assert.equal(h.sent.length,0);h.modal.close();
});

test('cancelling the workspace picker reopens the same composer with its draft, machine and options',async()=>{
 const h=await fixture();await h.modal.modelReady;h.modal.projectKey='folder:new:vps';h.type('Keep this unsent question');h.modal.overrides.modelSelection={instanceId:'vps-provider',model:'chosen-model'};h.modal.overrides.inline={enabled:false,finalAnswerFormat:'raw-markdown'};
 h.host.sendToNew=async()=>{throw new h.exports.ProjectCreationCancelled();};await h.modal.choose();
 assert.equal(h.modal.opened,true);assert.equal(h.modals.at(-1),h.modal);assert.equal(h.modal.field.value,'Keep this unsent question');assert.equal(h.modal.projectKey,'folder:new:vps');assert.equal(h.modal.overrides.modelSelection.model,'chosen-model');assert.equal(h.modal.overrides.inline.enabled,false);assert.equal(h.modal.overrides.inline.finalAnswerFormat,'raw-markdown');assert.equal(h.notices.length,0);assert.equal(h.sent.length,0);assert.equal(h.button('Send ask').disabled,false);h.modal.close();
});

test('advertised commands retain command routing after whitespace accepted by the suggestion trigger',async()=>{
 const h=await fixture();await h.modal.modelReady;h.modal.models[0].commands.push({name:'feedback'});h.type(' \n /feedback A test report');await h.modal.choose();
 assert.equal(h.sent.length,1);assert.equal(h.sent[0].options.providerCommand,'feedback');h.modal.close();
});
