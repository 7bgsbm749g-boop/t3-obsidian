import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,webcrypto} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {build} from './build-fixture';
import {runInNewContext} from './obsidian-context';
import {noteCatchUpThreads,catchUpRuns} from '../src/conversations/response-catch-up';
import {runImportReceipt} from '../src/conversations/run-import-receipt';
import type {ResponseBindingData} from '../src/responses/response-binding-data';
import type {ImportRun} from '../src/conversations/run-import';

const source={threadId:'thread',projectId:'project',environmentId:'machine'},path='Catch up.md',vaultId='vault';
const at='2026-11-01T00:00:00Z';
function binding(messageId:string,extra:Record<string,unknown>={}){
 const id=randomUUID();
 return {version:1,clock:1,actor:'test',request:{localOnly:true,id,vaultId,notePath:path,threadId:source.threadId,projectId:source.projectId,threadEnvironmentId:source.environmentId,messageId,createdAt:at,threadTitle:'Saved thread',...extra}} as unknown as ResponseBindingData[string];
}
function data(...entries:ReturnType<typeof binding>[]){return Object.fromEntries(entries.map(entry=>[entry.request.id,entry]));}
function runs(ids=['third','second','first']):ImportRun[]{return ids.map((id,index)=>({messageId:id,turnId:'run-'+id,status:'Completed',turn:{turnId:'run-'+id,messageId:id,state:'completed',ordinal:ids.length-index},prompt:id,createdAt:at}));}

test('only a note’s own response bindings or import receipts expose catch-up, with exact machine/project grouping',()=>{
 assert.deepEqual(noteCatchUpThreads(path,vaultId,{}),[]);
 const own=binding('first'),other=binding('second',{notePath:'Other.md'}),foreign=binding('third',{vaultId:'other'});
 const machine=binding('first',{threadEnvironmentId:'other-machine'}),project=binding('first',{projectId:'other-project'});
 const threads=noteCatchUpThreads(path,vaultId,data(own,own,other,foreign,machine,project));
 assert.equal(threads.length,3);assert.deepEqual(threads[0].messageIds,['first']);assert.equal(threads[0].title,'Saved thread');
 const receipt=runImportReceipt({version:1,bindingId:randomUUID(),...source,messageId:'second',runId:'run-second'});
 const restored=noteCatchUpThreads('Renamed.md',vaultId,{},receipt);
 assert.equal(restored.length,1);assert.deepEqual(catchUpRuns(restored[0],runs()).map(run=>run.messageId),['third']);
 assert.deepEqual(noteCatchUpThreads(path,vaultId,{},'<!-- t3-run-import:broken -->'),[]);
});
test('latest exact source run wins over note order, import time, repeated streams, and continued responses',()=>{
 const old=binding('first'),latest=binding('second'),olderImport=binding('first',{createdAt:'2099-01-01T00:00:00Z'});
 let thread=noteCatchUpThreads(path,vaultId,data(latest,old,olderImport))[0];
 assert.deepEqual(catchUpRuns(thread,runs()).map(run=>run.messageId),['third']);
 thread=noteCatchUpThreads(path,vaultId,data(old))[0];assert.deepEqual(catchUpRuns(thread,runs()).map(run=>run.messageId),['second','third']);
 old.completion={identity:'verified',turnId:'run-second',outputHash:'a'.repeat(64)};
 thread=noteCatchUpThreads(path,vaultId,data(old))[0];assert.deepEqual(catchUpRuns(thread,runs()).map(run=>run.messageId),['third']);
 assert.deepEqual(catchUpRuns(thread,runs(['second','first'])),[]);
 assert.throws(()=>catchUpRuns(thread,runs(['missing'])),/last streamed response is missing/);
 const live=noteCatchUpThreads(path,vaultId,data(binding('first')),'',()=>['run-second'])[0];
 assert.deepEqual(catchUpRuns(live,runs()).map(run=>run.messageId),['third']);
});

const uiBundle=build({stdin:{contents:"export {openResponseCatchUp} from './src/conversations/run-import-ui';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',write:false,external:['obsidian']});
async function ui(){
 const opened:any[]=[],buttons:any[]=[],toggles:any[]=[],calls:any[]=[],notices:string[]=[];
 class Element{setText(){}empty(){}createEl(){}}
 class Modal{contentEl=new Element();titleEl=new Element();closed=false;open(){opened.push(this);(this as any).onOpen();}close(){this.closed=true;(this as any).onClose();}}
 class Control{text='';disabled=false;value=false;handler:Function=()=>{};setButtonText(text:string){this.text=text;return this;}setCta(){return this;}setDisabled(value:boolean){this.disabled=value;return this;}setValue(value:boolean){this.value=value;return this;}onChange(handler:Function){this.handler=handler;return this;}onClick(handler:Function){this.handler=handler;return this;}}
 class Setting{setName(){return this;}setDesc(){return this;}addButton(setup:Function){const button=new Control();buttons.push(button);setup(button);return this;}addToggle(setup:Function){const toggle=new Control();toggles.push(toggle);setup(toggle);return this;}}
 const module={exports:{} as any},realRequire=createRequire(import.meta.url);
 runInNewContext((await uiBundle).outputFiles[0].text,{module,exports:module.exports,require:(id:string)=>id==='obsidian'?{Modal,FuzzySuggestModal:Modal,Setting,Notice:class{constructor(text:string){notices.push(text);}}}:realRequire(id)});
 const threads=noteCatchUpThreads(path,vaultId,data(binding('first'),binding('first',{threadId:'second-thread'})));
 return {opened,buttons,toggles,calls,notices,threads,open:(selected=threads,execute=async(items:any[])=>{calls.push(items);})=>module.exports.openResponseCatchUp({},path,selected,execute)};
}
test('one thread catches up immediately; multiple threads can select, deselect, cancel, and submit only once',async()=>{
 const single=await ui();single.open([single.threads[0]]);assert.equal(single.opened.length,0);assert.equal(single.calls.length,1);
 const h=await ui();h.open();assert.equal(h.opened.length,1);assert.equal(h.calls.length,0);assert.ok(h.toggles.every(toggle=>toggle.value));
 const submit=h.buttons.find(button=>button.text==='Catch up on responses');
 h.toggles[0].handler(false);h.toggles[1].handler(false);assert.equal(submit.disabled,true);submit.handler();assert.equal(h.calls.length,0);
 h.toggles[1].handler(true);assert.equal(submit.disabled,false);submit.handler();submit.handler();assert.equal(h.calls.length,1);assert.equal(h.opened[0].closed,true);assert.deepEqual(h.calls[0].map((thread:any)=>thread.threadId),['second-thread']);
 const cancel=await ui();cancel.open();cancel.buttons.find(button=>button.text==='Cancel').handler();assert.equal(cancel.calls.length,0);
 const empty=await ui();empty.open([]);assert.equal(empty.opened.length,0);assert.equal(empty.calls.length,0);
});
test('one-click connection errors remain visible',async()=>{
 const h=await ui();h.open([h.threads[0]],async()=>{throw Error('Machine offline');});await new Promise(resolve=>setImmediate(resolve));assert.match(h.notices[0],/Machine offline/);
});

async function pluginFixture(){
 class Base{}
 const notices:string[]=[],module={exports:{} as any};
 runInNewContext(await readFile('dist/main.js','utf8'),{module,exports:module.exports,require:(id:string)=>{assert.equal(id,'obsidian');return {Plugin:Base,Modal:Base,FuzzySuggestModal:Base,EditorSuggest:Base,ItemView:Base,PluginSettingTab:Base,Platform:{isMobile:true},Notice:class{constructor(text:string){notices.push(text);}}};},crypto:webcrypto,URL,TextEncoder,TextDecoder,console,document:{createElement:()=>({innerHTML:'',get textContent(){return this.innerHTML;}})}});
 const plugin=new module.exports.default(),file={path};
 plugin.settings={vaultId,responseBindings:data(binding('first'))};plugin.deviceInline={cachedResponse:()=>undefined};
 plugin.app={workspace:{getLeavesOfType:()=>[]},vault:{getFileByPath:()=>file,read:async()=>'User text with edits.'}};
 plugin.recoveryProject=async()=>({id:source.projectId});
 let closes=0;const reads:string[]=[],attached:string[]=[];
 const catalog=runs(),projection={thread:{id:source.threadId,projectId:source.projectId,title:'Canonical'},runs:catalog.slice().reverse().map(run=>({id:run.turnId,ordinal:run.turn!.ordinal,userMessageId:run.messageId,status:'completed',requestedAt:at})),messages:catalog.slice().reverse().map(run=>({id:run.messageId,role:'user',runId:run.turnId,text:run.prompt,streaming:false,createdAt:at})),turnItems:[]};
 plugin.inlineThreadAccess=async()=>({origin:'https://synthetic.invalid',api:async(route:string)=>{reads.push(route);return {snapshotSequence:1,hasMoreHistory:false,projection};},close:()=>{closes++;}});
 plugin.attachImportRun=async(notePath:string,_project:any,_threadId:string,messageId:string,follow:boolean,insertion:any,index:any)=>{
  assert.equal(notePath,path);assert.equal(follow,false);assert.equal(insertion,undefined);assert.equal(index.length,3);assert.equal(plugin.busy,true);
  attached.push(messageId);const entry=binding(messageId);plugin.settings.responseBindings[entry.request.id]=entry;
  return {duplicate:false,following:false,saveState:'saved'};
 };
 return {plugin,file,notices,reads,attached,closes:()=>closes,catchUp:()=>plugin.catchUpResponses(file,plugin.noteCatchUpThreads(path))};
}
test('catch-up reads each thread once, imports chronologically without sending/following, and repeated catch-up is a no-op',async()=>{
 const h=await pluginFixture();await h.catchUp();assert.deepEqual(h.attached,['second','third']);assert.equal(h.closes(),1);assert.equal(h.plugin.busy,false);assert.match(h.notices.at(-1)!,/2 responses imported and saved/);
 await h.catchUp();assert.deepEqual(h.attached,['second','third']);assert.equal(h.closes(),2);assert.match(h.notices.at(-1)!,/up to date/);
});
test('catch-up stops on a pending save and reports it without importing later runs',async()=>{
 const h=await pluginFixture();h.plugin.attachImportRun=async(...args:any[])=>{h.attached.push(args[3]);return {saveState:'pending',pendingReason:'sync'};};
 await h.catchUp();assert.deepEqual(h.attached,['second']);assert.equal(h.plugin.busy,false);assert.match(h.notices.at(-1)!,/waiting to save/);assert.match(h.notices.at(-1)!,/Sync/);
});
test('an unavailable selected machine does not stop another selected thread',async()=>{
 const h=await pluginFixture(),entry=binding('first',{threadEnvironmentId:'offline',threadTitle:'Offline thread'});h.plugin.settings.responseBindings[entry.request.id]=entry;
 h.plugin.recoveryProject=async(_id:string,environmentId:string)=>{if(environmentId==='offline')throw Error('Machine offline');return {id:source.projectId};};
 await h.catchUp();assert.deepEqual(h.attached,['second','third']);assert.match(h.notices.at(-1)!,/2 responses imported and saved/);assert.match(h.notices.at(-1)!,/Offline thread: (?:Error: )?Machine offline/);
});
test('concurrent catch-up is refused while one read is active',async()=>{
 const h=await pluginFixture();let resume!:()=>void;h.plugin.recoveryProject=()=>new Promise(resolve=>{resume=()=>resolve({id:source.projectId});});
 const first=h.catchUp();for(let n=0;n<5&&!resume;n++)await new Promise(resolve=>setImmediate(resolve));
 await assert.rejects(h.catchUp(),/another request/);resume();await first;assert.equal(h.plugin.busy,false);
});
test('a subscription that attaches during the catalog read is not imported twice',async()=>{
 const h=await pluginFixture(),read=h.plugin.inlineThreadAccess;
 h.plugin.inlineThreadAccess=async()=>{const access=await read(),api=access.api;access.api=async(route:string)=>{const result=await api(route),entry=binding('second');h.plugin.settings.responseBindings[entry.request.id]=entry;return result;};return access;};
 await h.catchUp();assert.deepEqual(h.attached,['third']);
});
