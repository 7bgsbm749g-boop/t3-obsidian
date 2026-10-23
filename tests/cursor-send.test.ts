import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {runInNewContext} from 'node:vm';
import {createRequire} from 'node:module';
import {webcrypto,randomUUID} from 'node:crypto';
import {captureCursorInsertion,resolveCursorInsertion} from '../cursor-insertion';
import {responseAnchor} from '../native-response-projection';
import {applyThreadItem} from '../inline-thread';

const require=createRequire(import.meta.url);
const compiled=build({stdin:{contents:"export {default} from './main'; export {nativeResponses} from './native-response-manager'; export {InlineChatManager} from './inline-chat';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',external:['obsidian'],write:false});
async function fixture(document='First paragraph.\n\nLater paragraph.'){
  class Base{}
  const api={Plugin:Base,MarkdownView:Base,Modal:Base,FuzzySuggestModal:Base,EditorSuggest:Base,ItemView:Base,PluginSettingTab:Base,Notice:Base,Platform:{isMobile:false}};
  const module={exports:{} as any};
  runInNewContext((await compiled).outputFiles[0].text,{module,exports:module.exports,require:(id:string)=>id==='obsidian'?api:require(id),process,Buffer,Uint8Array,console,TextEncoder,TextDecoder,crypto:webcrypto,URL,setTimeout,clearTimeout,setInterval,clearInterval,performance,AbortController});
  let value=document,disk=document,cursor=document.indexOf('Later')-1,mode='source',active=true;
  const file={path:'Note.md',extension:'md'};
  const editor={getValue:()=>value,getCursor:()=>cursor,getSelection:()=>'',posToOffset:(position:number)=>position,offsetToPos:(offset:number)=>offset,replaceRange:(text:string,from:number,to=from)=>{value=value.slice(0,from)+text+value.slice(to);}};
  const view={file,editor,getViewData:()=>value,setViewData:(text:string)=>{value=text;},getMode:()=>mode,requestSave:()=>{},save:async()=>{disk=view.getViewData();}};
  const app={loadLocalStorage:()=>undefined,saveLocalStorage:()=>{},workspace:{getActiveViewOfType:()=>active?view:undefined,getLeavesOfType:()=>[{view}]},vault:{adapter:{getFullPath:(path:string)=>'/vault/'+path},getName:()=> 'Synthetic',getFileByPath:()=>file,read:async()=>disk}};
  const plugin=new module.exports.default();plugin.app=app;plugin.settings={inlineStreaming:{enabled:true},noteThreads:[]};plugin.save=async()=>{};
  return {plugin,app,view,editor,file,exports:module.exports,value:()=>value,cursor:(offset:number)=>{cursor=offset;},active:(yes:boolean)=>{active=yes;},mode:(next:string)=>{mode=next;}};
}

for(const remembered of [false,true])test(`whole-note ${remembered?'continued':'new'} sends retain the cursor from activation across async routing`,async()=>{
  const h=await fixture(),initial=h.value(),offset=initial.indexOf('Later')-1;
  let ready!:()=>void;const gate=new Promise<void>(resolve=>{ready=resolve;}),sent:any[]=[];
  h.plugin.destinationContext=()=>({getDefaultProjectKey:()=> 'project',getDefaultThread:()=>remembered?'thread':undefined,getNotePath:()=>h.file.path});
  h.plugin.hasSmartContent=async()=>{await gate;return true;};
  h.plugin.sendNote=async(...args:any[])=>{sent.push(args);};
  const sending=h.plugin.openNoteSend(h.file);h.cursor(initial.length);ready();await sending;
  assert.equal(sent.length,1);assert.equal(sent[0][3],!remembered);
  assert.equal(resolveCursorInsertion(initial,sent[0][6]),offset);
});

test('file and reading-view sends have no cursor hint, even if another editor opens later',async()=>{
  const h=await fixture();h.active(false);assert.equal(h.plugin.noteSendInsertion(h.file),null);
  h.active(true);h.mode('preview');assert.equal(h.plugin.noteSendInsertion(h.file),null);
  h.mode('source');assert.equal(h.plugin.noteSendInsertion({...h.file,path:'Other.md'}),null);
  let ready!:()=>void;const gate=new Promise<void>(resolve=>{ready=resolve;}),sent:any[]=[];
  h.active(false);h.plugin.destinationContext=()=>({getDefaultThread:()=>undefined,getNotePath:()=>h.file.path});
  h.plugin.hasSmartContent=async()=>{await gate;return true;};h.plugin.sendNote=async(...args:any[])=>{sent.push(args);};
  const sending=h.plugin.openNoteSend(h.file);h.active(true);ready();await sending;assert.equal(sent[0][6],null);
});

test('whole-note cursor offsets use saved text after a projected response and stay outside its boundaries',async()=>{
  const id=randomUUID(),document='Before\n\n'+responseAnchor(id)+'\n\nLater paragraph.',h=await fixture(document);
  const adapter=h.exports.nativeResponses(h.app).wrap(h.view,document);
  adapter.setResponses([{id,body:'A long streamed response.\n\nMore streamed text.'}]);
  h.cursor(h.value().indexOf('Later')-1);
  const insertion=h.plugin.noteSendInsertion(h.file);
  assert.equal(insertion.document,document);assert.equal(insertion.offset,document.indexOf('Later')-1);
  h.cursor(h.value().indexOf('long streamed'));
  assert.ok(h.plugin.noteSendInsertion(h.file).offset>=document.indexOf(responseAnchor(id))+responseAnchor(id).length);
  h.exports.nativeResponses(h.app).dispose();
});

test('an Ask without selection reserves at its captured cursor, with a separate paragraph on each side',async()=>{
  const h=await fixture(),original=h.value(),insertion=captureCursorInsertion(original,3),id=randomUUID();
  const manager=new h.exports.InlineChatManager(h.app,'jobs',async()=>undefined);
  manager.prepare=async()=>{};manager.start=()=>{};h.plugin.inlineChat=manager;
  h.plugin.sendChat=async(_prompt:any,_note:any,options:any)=>options.onPrepared({id,title:'Synthetic'});
  h.cursor(original.length);
  await h.plugin.sendInlineChat('Explain',{path:h.file.path},{editor:h.editor,view:h.view,insertion},{newThread:true});
  assert.match(h.value(),/^First paragraph\.\n\n<!-- t3-inline:start:/);
  assert.ok(h.value().indexOf('t3-inline:end:')<h.value().indexOf('Later paragraph.'));
  manager.dispose();
});

for(const state of ['completed','running'])for(const cursor of [3,'First paragraph.\n'.length])test(`${state} imports use the captured cursor and replay without moving or duplicating the response (${cursor})`,async()=>{
  const h=await fixture(),original=h.value(),insertion=h.plugin.noteSendInsertion(h.file),messageId=randomUUID(),threadId=randomUUID(),project={id:'project'},registered:any[]=[];
  h.cursor(cursor);const captured=h.plugin.noteSendInsertion(h.file);h.cursor(original.length);
  let ready!:()=>void;const gate=new Promise<void>(resolve=>{ready=resolve;});
  const history=applyThreadItem({messages:[],activities:[]},{kind:'snapshot',snapshot:{thread:{messages:[{id:messageId,role:'user',text:'Synthetic prompt',createdAt:'2026-10-16T00:00:00Z',turnId:null,streaming:false},{id:'answer',role:'assistant',text:'Imported answer',createdAt:'2026-10-16T00:00:00Z',turnId:'turn',streaming:state==='running'}],activities:[],latestTurn:{turnId:'turn',requestedAt:'2026-10-16T00:00:00Z',state},session:{status:state==='running'?'running':'ready',activeTurnId:state==='running'?'turn':null}}}}).state;
  h.plugin.settings.vaultId='synthetic';h.plugin.deviceInline={register:async(request:any)=>{registered.push(request);},waitForSave:async()=>({saved:true})};
  h.plugin.readImportHistory=async()=>{await gate;return {source:{threadId,projectId:project.id,environmentId:'machine'},state:history,title:'Imported run'};};
  h.plugin.connection=()=>({environmentId:'machine'});h.plugin.localResponseTarget=async()=>({environmentId:'machine',workspaceRoot:'/vault',directory:'.obsidian/inline'});
  const importing=h.plugin.importRun(h.file.path,project,threadId,messageId,false,captured);h.cursor(0);ready();
  assert.equal((await importing).duplicate,false);assert.equal(registered.length,1);
  const anchor=responseAnchor(registered[0].id),at=h.value().indexOf(anchor);
  assert.ok(at>h.value().indexOf('First paragraph.'));assert.ok(at<h.value().indexOf('Later paragraph.'));
  const once=h.value();assert.equal((await h.plugin.importRun(h.file.path,project,threadId,messageId,false,insertion)).duplicate,true);
  assert.equal(h.value(),once);assert.equal(registered.length,2);assert.equal(registered[0].id,registered[1].id);
});
