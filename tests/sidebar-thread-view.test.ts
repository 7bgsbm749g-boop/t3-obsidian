import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {build} from './build-fixture';
import {runInNewContext} from './obsidian-context';
const compiled=build({entryPoints:['src/conversations/sidebar-thread-view.ts'],bundle:true,platform:'browser',format:'cjs',write:false});
async function fixture(kind='thread'){
 const {document,window}=parseHTML('<html><body></body></html>');
 const proto=window.HTMLElement.prototype as any;
 proto.createEl=function(tag:string,options:any={}){const el=document.createElement(tag);el.textContent=options.text??'';el.className=options.cls??'';for(const [key,value] of Object.entries(options.attr??{}))el.setAttribute(key,String(value));this.appendChild(el);return el;};
 proto.createDiv=function(options:any){return this.createEl('div',options);};proto.createSpan=function(options:any){return this.createEl('span',options);};proto.empty=function(){this.replaceChildren();};proto.addClass=function(value:string){this.classList.add(value);};proto.setText=function(value:string){this.textContent=value;};proto.toggleClass=function(value:string,on:boolean){this.classList.toggle(value,on);};
 class Component{load(){}unload(){}addChild(){}removeChild(){}register(){}registerDomEvent(){}}
 class ItemView extends Component{app:any;contentEl:any;constructor(leaf:any){super();this.app=app;this.contentEl=leaf.contentEl;}async setState(){}}
 let saves=0;const app:any={workspace:{requestSaveLayout(){saves++;},getActiveViewOfType(){},getLeavesOfType(){return [];}}},module={exports:{} as any},notices:string[]=[],watches:any[]=[],sent:any[]=[];
 runInNewContext((await compiled).outputFiles[0].text,{module,exports:module.exports,require:()=>({ItemView,Component,FuzzySuggestModal:class{},Modal:class{},Setting:class{},setIcon:()=>{},Notice:class{constructor(text:string){notices.push(text);}},MarkdownRenderer:{render:async(_app:any,text:string,el:any)=>{if(text.startsWith('<'))el.innerHTML=text;else el.textContent=text;}}}),console,setTimeout,clearTimeout,performance,URL,URLSearchParams,AbortController,document,FileReader:class{result='data:image/png;base64,c3ludGhldGlj';onload?:()=>void;onloadend?:()=>void;readAsDataURL(){queueMicrotask(()=>{this.onload?.();this.onloadend?.();});}}});
 const contentEl=document.createElement('div');document.body.appendChild(contentEl);
 let serial=0,fail=false;
 const owner:any={host:{uuid:()=>`id-${++serial}`,projects:()=>[]},watch:(_id:any,_access:any,callbacks:any)=>{const entry={id:_id,callbacks,stopped:false};watches.push(entry);return {stop:()=>{entry.stopped=true;}};},transport:{snapshot:async(target:any)=>({thread:{id:target.threadId,projectId:'project',title:'Parent',messages:[],activities:[]}}),send:async(...args:any[])=>{sent.push(args);if(fail)throw Error('Unconfirmed');}},report:(error:Error)=>notices.push(error.message)};
 const view=new module.exports.SidebarThreadView({contentEl},owner,kind);await view.onOpen();
 const target={kind,threadId:'thread',projectId:'project',environmentId:'env',title:'Synthetic',...(kind==='thread'?{}:{parent:{threadId:'parent',projectId:'project',environmentId:'env'}})};
 await view.setState({target},{});
 const snapshot=async(extra:any={})=>{[...watches].reverse().find(watch=>watch.id==='thread').callbacks.item({kind:'snapshot',snapshot:{snapshotSequence:5,thread:{id:'thread',projectId:'project',messages:[{id:'user',role:'user',text:'Question',turnId:'run',streaming:false},{id:'reply',role:'assistant',text:'Answer',turnId:'run',streaming:true}],activities:[],...extra}}});await Promise.resolve();await Promise.resolve();};
 return {exports:module.exports,app,window,view,saves:()=>saves,contentEl,watches,snapshot,sent,notices,setFail:(value:boolean)=>{fail=value;},input:(text:string)=>{const field=contentEl.querySelector('textarea')!;field.value=text;field.dispatchEvent(new window.Event('input'));}};
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
 assert.equal(f.contentEl.querySelector('textarea'),null);assert.match(f.contentEl.textContent!,/Visible child/);assert.match(f.contentEl.textContent!,/No child/);assert.equal(f.contentEl.querySelectorAll('a.send-to-t3-subagent').length,1);await f.view.send();assert.equal(f.sent.length,0);
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


test('side chat follows live parent status, fails closed on reconnect, and releases both subscriptions',async()=>{
 const f=await fixture('side-chat'),parent=f.watches.find(watch=>watch.id==='parent');
 await f.snapshot({messages:[{id:'reply',role:'assistant',text:'Finished',turnId:'run',streaming:false}],turns:{run:{turnId:'run',state:'completed'}}});
 const button=f.contentEl.querySelector<HTMLButtonElement>('[aria-label="Bring back"]')!;
 assert.equal(button.disabled,true);
 const update=(sequence:number,extra:any={})=>parent.callbacks.item({kind:'snapshot',snapshot:{snapshotSequence:sequence,thread:{id:'parent',projectId:'project',messages:[],activities:[],...extra}}});
 update(1,{session:{status:'running',activeTurnId:'parent-run'}});assert.equal(button.disabled,true);
 update(2,{session:{status:'ready',activeTurnId:null}});assert.equal(button.disabled,false);
 update(1,{session:{status:'running',activeTurnId:'stale'}});assert.equal(button.disabled,false);
 parent.callbacks.reconnecting(Error('Offline'));assert.equal(button.disabled,true);
 update(3);assert.equal(button.disabled,false);
 await f.view.onClose();assert.ok(f.watches.every(watch=>watch.stopped));update(4,{title:'Late'});assert.doesNotMatch(f.contentEl.textContent!,/Late/);
});

test('sidebar attachment reads save the layout and survive a pre-send workspace restore',async()=>{
 const f=await fixture();await f.snapshot();f.input('Draft with image');const before=f.saves();
 await f.view.composer.addFiles([{name:'synthetic.png',type:'image/png',size:9}]);assert.ok(f.saves()>before);
 const saved=JSON.parse(JSON.stringify(f.view.getState()));assert.equal(saved.attachments.length,1);assert.equal(saved.pending,undefined);
 await f.view.setState(saved,{});assert.ok(f.contentEl.querySelector('img.t3-composer-thumbnail'));assert.equal(f.view.getState().draft,'Draft with image');
 await f.snapshot();await f.view.send();assert.deepEqual(JSON.parse(JSON.stringify(f.sent[0][4].attachments)),saved.attachments);assert.equal(f.view.getState().attachments.length,0);
});

test('workspace restoration rejects invalid or oversized encoded image drafts',async()=>{
 const f=await fixture(),saved=f.view.getState();
 for(const attachments of [[null],[{id:'image',dataUrl:'https://untrusted.invalid/image.png'}],Array(5).fill({id:'image',dataUrl:'data:image/png;base64,eA=='})]){
  await f.view.setState({...saved,attachments},{});assert.equal(f.view.getState().attachments.length,0);
 }
});


test('generated HTML stays visible outside collapsed work and keeps its DOM node during updates',async()=>{
 const f=await fixture(),activities=[{id:'html',kind:'response.html',summary:'Page',turnId:'run',payload:{itemId:'page',htmlRender:{attachmentId:'synthetic_html',title:'Generated page',height:300}}}];
 await f.snapshot({activities,messages:[{id:'reply',role:'assistant',text:'Final answer',turnId:'run',streaming:false}],turns:{run:{turnId:'run',state:'completed'}}});
 const result=f.contentEl.querySelector('.t3-chat-result')!,work=f.contentEl.querySelector('details') as any;
 assert.ok(result);assert.equal(result.closest('details'),null);assert.match(result.textContent!,/t3-html/);assert.equal(work.open,false);
 assert.ok(result.nextElementSibling?.classList.contains('t3-chat-answer'));
 await f.snapshot({activities,messages:[{id:'reply',role:'assistant',text:'Updated answer',turnId:'run',streaming:false}],turns:{run:{turnId:'run',state:'completed'}}});
 assert.equal(f.contentEl.querySelector('.t3-chat-result'),result);assert.match(result.nextElementSibling!.textContent!,/Updated answer/);
});
