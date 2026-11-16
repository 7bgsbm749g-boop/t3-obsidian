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
 proto.createDiv=function(options:any){return this.createEl('div',options);};proto.createSpan=function(options:any){return this.createEl('span',options);};proto.empty=function(){this.replaceChildren();};proto.addClass=function(value:string){this.classList.add(value);};proto.setText=function(value:string){this.textContent=value;};
 class Component{load(){}unload(){}addChild(){}removeChild(){}}
 class ItemView extends Component{app:any;contentEl:any;constructor(leaf:any){super();this.app=app;this.contentEl=leaf.contentEl;}async setState(){}}
 const app:any={workspace:{requestSaveLayout(){},getActiveViewOfType(){},getLeavesOfType(){return [];}}},module={exports:{} as any},notices:string[]=[],watches:any[]=[],sent:any[]=[];
 runInNewContext((await compiled).outputFiles[0].text,{module,exports:module.exports,require:()=>({ItemView,Component,FuzzySuggestModal:class{},Notice:class{constructor(text:string){notices.push(text);}},MarkdownRenderer:{render:async(_app:any,text:string,el:any)=>{el.textContent=text;}}}),console,setTimeout,clearTimeout,performance,URL,URLSearchParams,AbortController,document});
 const contentEl=document.createElement('div');document.body.appendChild(contentEl);
 let serial=0,fail=false;
 const owner:any={host:{uuid:()=>`id-${++serial}`,projects:()=>[]},watch:(_id:any,_access:any,callbacks:any)=>{const entry={callbacks,stopped:false};watches.push(entry);return {stop:()=>{entry.stopped=true;}};},transport:{send:async(...args:any[])=>{sent.push(args);if(fail)throw Error('Unconfirmed');}},report:(error:Error)=>notices.push(error.message)};
 const view=new module.exports.SidebarThreadView({contentEl},owner,kind);await view.onOpen();
 const target={kind,threadId:'thread',projectId:'project',environmentId:'env',title:'Synthetic',...(kind==='thread'?{}:{parent:{threadId:'parent',projectId:'project',environmentId:'env'}})};
 await view.setState({target},{});
 const snapshot=(extra:any={})=>watches.at(-1).callbacks.item({kind:'snapshot',snapshot:{snapshotSequence:5,thread:{id:'thread',projectId:'project',messages:[{id:'user',role:'user',text:'Question',turnId:'run',streaming:false},{id:'reply',role:'assistant',text:'Answer',turnId:'run',streaming:true}],activities:[],...extra}}});
 return {exports:module.exports,app,view,contentEl,watches,snapshot,sent,notices,setFail:(value:boolean)=>{fail=value;},input:(text:string)=>{const field=contentEl.querySelector('textarea')!;field.value=text;field.dispatchEvent(new window.Event('input'));}};
}
test('native pages share transcript, preserve composer during updates, reject stale/wrong-source data and stop on close',async()=>{
 const f=await fixture();f.snapshot();f.input('Retained draft');const field=f.contentEl.querySelector('textarea');assert.match(f.contentEl.textContent!,/Question.*Answer/s);
 f.snapshot({messages:[{id:'reply',role:'assistant',text:'Updated',turnId:'run',streaming:true}]});assert.equal(f.contentEl.querySelector('textarea'),field);assert.equal(field!.value,'Retained draft');
 f.watches.at(-1).callbacks.item({kind:'snapshot',snapshot:{snapshotSequence:4,thread:{id:'thread',projectId:'project',messages:[],activities:[]}}});assert.match(f.contentEl.textContent!,/Updated/);
 await f.view.onClose();assert.equal(f.watches.at(-1).stopped,true);f.snapshot({title:'Late'});assert.doesNotMatch(f.contentEl.textContent!,/Late/);
});
test('failed send retains draft and exact command IDs; successful retry clears it',async()=>{
 const f=await fixture();f.snapshot();f.input('Retry me');f.setFail(true);await f.view.send();assert.equal(f.view.getState().draft,'Retry me');assert.match(f.notices[0],/Unconfirmed/);f.setFail(false);await f.view.send();assert.deepEqual(f.sent[0],f.sent[1]);assert.equal(f.view.getState().draft,'');
});
test('subagent page has no composer; native child links appear only for available local threads',async()=>{
 const f=await fixture('subagent');f.snapshot({subagents:{one:{id:'one',runId:'run',title:'Visible child',status:'running',childThreadId:'child'},two:{id:'two',runId:'run',title:'No child',status:'running'}}});
 assert.equal(f.contentEl.querySelector('textarea'),null);assert.match(f.contentEl.textContent!,/Visible child/);assert.doesNotMatch(f.contentEl.textContent!,/No child/);await f.view.send();assert.equal(f.sent.length,0);
});
test('wrong project snapshot disables sending and never renders its messages',async()=>{
 const f=await fixture();f.snapshot({projectId:'other'});f.input('Do not send');assert.doesNotMatch(f.contentEl.textContent!,/Question/);assert.equal(f.contentEl.querySelector<HTMLButtonElement>('[aria-label="Send"]')!.disabled,true);await f.view.send();assert.equal(f.sent.length,0);
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
