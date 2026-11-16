import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {build} from './build-fixture';
import {runInNewContext} from './obsidian-context';
const compiled=build({entryPoints:['src/conversations/sidebar-thread-view.ts'],bundle:true,platform:'browser',format:'cjs',write:false});
async function fixture(kind='thread',parentRunning=false){
 const {document,window}=parseHTML('<html><body></body></html>');
 const proto=window.HTMLElement.prototype as any;
 proto.createEl=function(tag:string,options:any={}){const el=document.createElement(tag);el.textContent=options.text??'';el.className=options.cls??'';for(const [key,value] of Object.entries(options.attr??{}))el.setAttribute(key,String(value));this.appendChild(el);return el;};
 proto.createDiv=function(options:any){return this.createEl('div',options);};proto.createSpan=function(options:any){return this.createEl('span',options);};proto.empty=function(){this.replaceChildren();};proto.addClass=function(value:string){this.classList.add(value);};proto.setText=function(value:string){this.textContent=value;};proto.toggleClass=function(value:string,on:boolean){this.classList.toggle(value,on);};
 class Component{load(){}unload(){}addChild(){}removeChild(){}register(){}registerDomEvent(){}}
 class ItemView extends Component{app:any;contentEl:any;constructor(leaf:any){super();this.app=app;this.contentEl=leaf.contentEl;}async setState(){}}
 let saves=0;
 const app:any={workspace:{requestSaveLayout(){saves++;},getActiveViewOfType(){},getLeavesOfType(){return [];}}},module={exports:{} as any},notices:string[]=[],watches:any[]=[],sent:any[]=[];
 class FileReader {result='data:image/png;base64,YWJj';onload?:()=>void;onloadend?:()=>void;readAsDataURL(){this.onload?.();this.onloadend?.();}abort(){}}
 runInNewContext((await compiled).outputFiles[0].text,{module,exports:module.exports,require:()=>({ItemView,Component,FuzzySuggestModal:class{},Modal:class{},Setting:class{},setIcon:()=>{},Notice:class{constructor(text:string){notices.push(text);}},MarkdownRenderer:{render:async(_app:any,text:string,el:any)=>{if(text.startsWith('<'))el.innerHTML=text;else el.textContent=text;}}}),console,setTimeout,clearTimeout,performance,URL,URLSearchParams,AbortController,document,FileReader,TextEncoder});
 const contentEl=document.createElement('div');document.body.appendChild(contentEl);
 let serial=0,fail=false;
 const owner:any={host:{uuid:()=>`id-${++serial}`,projects:()=>[]},watch:(_id:any,_access:any,callbacks:any)=>{const entry={callbacks,stopped:false};watches.push(entry);return {stop:()=>{entry.stopped=true;}};},transport:{snapshot:async(target:any)=>({thread:{id:target.threadId,projectId:'project',title:'Parent',messages:[],activities:[],...(parentRunning?{session:{status:'running',activeTurnId:'parent-run'}}:{})}}),send:async(...args:any[])=>{sent.push(args);if(fail)throw Error('Unconfirmed');}},report:(error:Error)=>notices.push(error.message)};
 const view=new module.exports.SidebarThreadView({contentEl},owner,kind);await view.onOpen();
 const target={kind,threadId:'thread',projectId:'project',environmentId:'env',title:'Synthetic',...(kind==='thread'?{}:{parent:{threadId:'parent',projectId:'project',environmentId:'env'}})};
 await view.setState({target},{});
 const snapshot=async(extra:any={})=>{watches.at(-1).callbacks.item({kind:'snapshot',snapshot:{snapshotSequence:5,thread:{id:'thread',projectId:'project',messages:[{id:'user',role:'user',text:'Question',turnId:'run',streaming:false},{id:'reply',role:'assistant',text:'Answer',turnId:'run',streaming:true}],activities:[],...extra}}});await Promise.resolve();await Promise.resolve();};
 return {exports:module.exports,app,window,view,contentEl,watches,snapshot,sent,notices,saves:()=>saves,owner,setFail:(value:boolean)=>{fail=value;},input:(text:string)=>{const field=contentEl.querySelector('textarea')!;field.value=text;field.dispatchEvent(new window.Event('input'));}};
}
test('native pages share transcript, preserve composer during updates, reject stale/wrong-source data and stop on close',async()=>{
 const f=await fixture();await f.snapshot();f.input('Retained draft');const field=f.contentEl.querySelector('textarea');assert.match(f.contentEl.textContent!,/Question.*Answer/s);
 await f.snapshot({messages:[{id:'reply',role:'assistant',text:'Updated',turnId:'run',streaming:true}]});assert.equal(f.contentEl.querySelector('textarea'),field);assert.equal(field!.value,'Retained draft');
 f.watches.at(-1).callbacks.item({kind:'snapshot',snapshot:{snapshotSequence:4,thread:{id:'thread',projectId:'project',messages:[],activities:[]}}});assert.match(f.contentEl.textContent!,/Updated/);
 await f.view.onClose();assert.equal(f.watches.at(-1).stopped,true);await f.snapshot({title:'Late'});assert.doesNotMatch(f.contentEl.textContent!,/Late/);
});
test('failed send retains draft and exact command IDs; successful retry clears it',async()=>{
 const f=await fixture();await f.snapshot();f.input('Retry me');f.setFail(true);await f.view.send();assert.equal(f.view.getState().draft,'Retry me');assert.match(f.notices[0],/Unconfirmed/);f.setFail(false);await f.view.send();assert.deepEqual(f.sent[0],f.sent[1]);assert.equal(f.view.getState().draft,'');
});
test('subagent page has no composer; native child links appear only for available local threads',async()=>{
 const f=await fixture('subagent');await f.snapshot({subagents:{one:{id:'one',runId:'run',title:'Visible child',status:'running',childThreadId:'child'},two:{id:'two',runId:'run',title:'No child',status:'running'}}});
 assert.equal(f.contentEl.querySelector('textarea'),null);assert.match(f.contentEl.textContent!,/Visible child/);assert.doesNotMatch(f.contentEl.textContent!,/No child/);await f.view.send();assert.equal(f.sent.length,0);
});
test('wrong project snapshot disables sending and never renders its messages',async()=>{
 const f=await fixture();await f.snapshot({projectId:'other'});f.input('Do not send');assert.doesNotMatch(f.contentEl.textContent!,/Question/);assert.equal(f.contentEl.querySelector<HTMLButtonElement>('[aria-label="Send message"]')!.disabled,true);await f.view.send();assert.equal(f.sent.length,0);
});
test('native sidebar fixture bundles the product views without runtime Node imports',async()=>{
 const result=await build({entryPoints:['tests/native/sidebar-threads-lab.ts'],bundle:true,platform:'browser',format:'cjs',write:false,external:['node:*'],define:{SIDEBAR_LAB_REPORT:'"synthetic-report.json"'}});assert.ok(result.outputFiles[0].text.includes('t3-side-chat'));
});

test('all sidebar modes and a new-thread draft use tabs in the existing sidebar group',async()=>{
 const f=await fixture(),created:any[]=[],revealed:any[]=[],splits:boolean[]=[];
 f.app.workspace.getRightLeaf=(split:boolean)=>{splits.push(split);const leaf={async setViewState(state:any){created.push(state);}};return leaf;};
 f.app.workspace.revealLeaf=async(leaf:any)=>{revealed.push(leaf);};
 const owner=new f.exports.SidebarThreads(f.app,{},{});
 const parent={threadId:'parent',projectId:'project',environmentId:'env'};
 for(const kind of ['thread','side-chat','subagent'])await owner.open({...parent,threadId:kind,title:kind,kind,...(kind==='thread'?{}:{parent})});
 await owner.openDraft({key:'project',label:'Project',projectId:'project',environmentId:'env'});
 assert.deepEqual(splits,[false,false,false,false]);assert.equal(revealed.length,4);
 assert.deepEqual(created.map(state=>state.type),['t3-thread','t3-side-chat','t3-subagent','t3-thread']);
 assert.equal(created[3].state.project.key,'project');
});
test('opening an existing exact thread selects its tab without creating another sidebar leaf',async()=>{
 const f=await fixture(),leaf={view:f.view},revealed:any[]=[];
 f.app.workspace.getLeavesOfType=()=>[leaf];f.app.workspace.getRightLeaf=()=>assert.fail('must reuse existing tab');f.app.workspace.revealLeaf=async(value:any)=>{revealed.push(value);};
 const owner=new f.exports.SidebarThreads(f.app,{},{});await owner.open(f.view.target);assert.deepEqual(revealed,[leaf]);
});

test('sidebar uses input bubbles, chronological work and bottom activity instead of role headings and top status',async()=>{
 const f=await fixture();await f.snapshot({session:{status:'running',activeTurnId:'run'},turns:{run:{turnId:'run',state:'running',startedAt:'2026-11-16T12:00:00Z'}}});
 assert.equal(f.contentEl.querySelector('.t3-sidebar-message-role'),null);assert.equal(f.contentEl.querySelector<HTMLElement>('.t3-chat-status')!.hidden,true);
 const turn=f.contentEl.querySelector('.t3-chat-turn')!;assert.equal(turn.firstElementChild!.classList.contains('t3-chat-input'),true);assert.ok(turn.querySelector('details.t3-chat-work'));assert.ok(turn.querySelector('.t3-chat-work-content .send-to-t3-response-activity'));
 const field=f.contentEl.querySelector('textarea')!;f.input('Keep this draft');const work=turn.querySelector('details')!;(work as any).open=false;await f.snapshot({session:{status:'running',activeTurnId:'run'},turns:{run:{turnId:'run',state:'running'}}});assert.equal((work as any).open,false);assert.equal(field.value,'Keep this draft');
});
test('side chat header has compact bring-back, delete and close actions with parent context below',async()=>{
 const f=await fixture('side-chat');await f.snapshot();const header=f.contentEl.querySelector('.t3-chat-header')!;
 assert.ok(header.querySelector('[aria-label="Bring back"]'));assert.ok(header.querySelector('[aria-label="Delete side chat"]'));assert.ok(header.querySelector('[aria-label="Close Side chat"]'));assert.equal(header.querySelector('[aria-label="Parent"]'),null);assert.equal(header.querySelector('[aria-label="Side chat"]'),null);
 assert.ok(f.contentEl.querySelector('.t3-chat-context'));assert.ok(f.contentEl.querySelector('[aria-label="Attach images"]'));assert.ok(f.contentEl.querySelector('[aria-label="Choose model and permissions"]'));assert.ok(f.contentEl.querySelector('[aria-label="Voice input"]'));
});
test('Enter sends; Shift+Enter and input composition do not send',async()=>{
 const f=await fixture();await f.snapshot();f.input('Keyboard send');const input=f.contentEl.querySelector('textarea')!;
 const key=(shiftKey:boolean,isComposing:boolean)=>{const event=new f.window.Event('keydown',{bubbles:true,cancelable:true});Object.assign(event,{key:'Enter',shiftKey,isComposing});input.dispatchEvent(event);};
 key(true,false);key(false,true);await Promise.resolve();assert.equal(f.sent.length,0);key(false,false);await Promise.resolve();await Promise.resolve();assert.equal(f.sent.length,1);
});
test('Bring back reaches the fresh transport check after the parent was initially busy',async()=>{
 const f=await fixture('side-chat',true);await f.snapshot({latestTurn:{turnId:'run',state:'completed'},session:{status:'ready',activeTurnId:null}});
 const button=f.contentEl.querySelector<HTMLButtonElement>('[aria-label="Bring back"]')!;assert.equal(button.disabled,false);
 let calls=0;f.owner.transport.bringBack=async()=>{calls++;};button.click();await Promise.resolve();await Promise.resolve();assert.equal(calls,1);
});
test('unsent image drafts request a save, survive view restoration and clear on removal',async()=>{
 const f=await fixture();await f.snapshot();f.input('Keep the image');const before=f.saves();
 await f.view.composer.addFiles([{name:'draft.png',type:'image/png',size:3}]);assert.ok(f.saves()>before);
 const saved=f.view.getState();assert.equal(saved.attachments.length,1);assert.equal(saved.pending,undefined);await f.view.onClose();
 const restored=await fixture();await restored.view.setState(saved,{});await restored.snapshot();
 assert.equal(restored.contentEl.querySelector('textarea')!.value,'Keep the image');assert.ok(restored.contentEl.querySelector('[alt="draft.png"]'));
 restored.contentEl.querySelector<HTMLButtonElement>('[aria-label="Remove draft.png"]')!.click();assert.equal(restored.view.getState().attachments.length,0);
 await restored.view.setState(saved,{});await restored.snapshot();await restored.view.send();assert.equal(restored.sent[0][4].attachments[0].dataUrl,'data:image/png;base64,YWJj');assert.equal(restored.view.getState().attachments.length,0);
});
test('every sidebar mode renders rich results for its validated environment and thread',async()=>{
 for(const kind of ['thread','side-chat','subagent']){
  const f=await fixture(kind);await f.snapshot({activities:[{id:'image',kind:'response.image',turnId:'run',summary:'Image',payload:{itemId:'image-item',imageSources:[{kind:'file',path:'/synthetic/result.png'}]}},{id:'html',kind:'response.html',turnId:'run',summary:'HTML',payload:{itemId:'html-item',htmlRender:{attachmentId:'synthetic',title:'Chart',height:200}}}]});
  assert.match(f.contentEl.textContent!,/```t3-image/);assert.match(f.contentEl.textContent!,/```t3-html/);assert.match(f.contentEl.textContent!,/"environmentId":"env","threadId":"thread"/);
 }
});
