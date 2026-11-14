import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {webcrypto,randomUUID} from 'node:crypto';
import {build} from './build-fixture';
import {runInNewContext} from './obsidian-context';
import {combinedAsks} from '../src/conversations/ask-queue';

const require=createRequire(import.meta.url);
const compiled=build({stdin:{contents:"export {default} from './src/app/main'; export {InlineChatManager} from './src/conversations/inline-chat';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',external:['obsidian'],write:false});
async function fixture(){
  const modals:any[]=[],storage=new Map<string,unknown>();
  class Base{}
  class Modal{constructor(public app:unknown){}open(){modals.push(this);}}
  const api={Plugin:Base,MarkdownView:Base,Modal,FuzzySuggestModal:Base,EditorSuggest:Base,ItemView:Base,PluginSettingTab:Base,Notice:Base,Platform:{isMobile:false}};
  const module={exports:{} as any};
  runInNewContext((await compiled).outputFiles[0].text,{module,exports:module.exports,require:(id:string)=>id==='obsidian'?api:require(id),process,Buffer,Uint8Array,console,TextEncoder,TextDecoder,crypto:webcrypto,URL,setTimeout,clearTimeout,setInterval,clearInterval,performance,AbortController});
  let document='Unrelated note content.\n';
  const file={path:'Note.md',extension:'md'},editor={getValue:()=>document,getCursor:()=>0,posToOffset:(n:number)=>n,offsetToPos:(n:number)=>n,replaceRange:(text:string,from:number,to=from)=>{document=document.slice(0,from)+text+document.slice(to);}};
  const view={file,editor},app={loadLocalStorage:(key:string)=>structuredClone(storage.get(key)),saveLocalStorage:(key:string,value:unknown)=>storage.set(key,structuredClone(value)),workspace:{getLeavesOfType:()=>[{view}]},vault:{getName:()=> 'Synthetic',adapter:{getFullPath:()=>'/synthetic/Note.md'}}};
  const plugin=new module.exports.default();plugin.app=app;plugin.settings={vaultId:'synthetic',inlineStreaming:{enabled:true},noteThreads:[]};plugin.editorForNoteSend=async()=>view;
  const items=[{id:'one',notePath:file.path,selection:'First selected passage.',question:'Why?'},{id:'two',notePath:file.path,selection:'Second selected passage.',question:'How?'}];
  const key=plugin.askQueueKey();app.saveLocalStorage(key,items);plugin.openAskQueue(file);
  return {plugin,app,view,editor,file,items,key,modal:modals[0],exports:module.exports,value:()=>document,append:(text:string)=>{document+=text;},queue:()=>app.loadLocalStorage(key) as typeof items};
}

test('Ask Queue sends only reviewed snapshots, uses the chooser, and retains cancelled or failed sends',async()=>{
  const h=await fixture(),prompt=combinedAsks(h.items);let captured:any;
  h.plugin.openChatWithNote=async(note:any,text:string,context:any,answerOnly:boolean,choose:boolean)=>{captured={note,text,context,answerOnly,choose};};
  await h.modal.send(prompt,h.items.map(item=>item.id));
  assert.equal(captured.text,prompt);assert.equal(captured.text.includes('Unrelated note content'),false);
  assert.equal(captured.context.queueSend,true);assert.equal(captured.context.smartDocument,undefined);assert.equal(captured.choose,true);
  assert.equal(h.queue().length,2,'Opening or cancelling the destination chooser does not consume entries');
  h.plugin.performResolvedChat=async()=>{throw Error('Delivery failed');};
  await assert.rejects(h.plugin.sendResolvedChat(prompt,captured.note,captured.context,true,{newThread:true}),/Delivery failed/);
  assert.equal(h.queue().length,2);
  h.app.saveLocalStorage(h.key,[{...h.items[0],question:'Edited while choosing.'},h.items[1],{...h.items[0],id:'later',question:'Added later.'}]);
  h.plugin.performResolvedChat=async()=>{};
  await h.plugin.sendResolvedChat(prompt,captured.note,captured.context,true,{newThread:true});
  assert.deepEqual(h.queue().map(item=>item.id),['one','later'],'Successful delivery removes only unchanged entries from that send');
});

test('a queued send reserves one reply after edits made while choosing a destination',async()=>{
  const h=await fixture(),manager=new h.exports.InlineChatManager(h.app,'queue-lab',async()=>undefined);
  manager.prepare=async()=>{};manager.start=()=>{};h.plugin.inlineChat=manager;
  let captured:any;h.plugin.openChatWithNote=async(_note:any,_text:string,context:any)=>{captured=context;};
  await h.modal.send(combinedAsks(h.items),h.items.map(item=>item.id));
  h.append('\nNew paragraph written while choosing.\n');
  h.plugin.sendChat=async(_prompt:any,_note:any,options:any)=>options.onPrepared({id:randomUUID(),title:'Combined answer'});
  try{
    await h.plugin.sendInlineChat(combinedAsks(h.items),h.file,captured,{newThread:true});
    assert.equal(h.value().split('<!-- t3-inline:start:').length-1,1);
    assert.ok(h.value().indexOf('t3-inline:start:')>h.value().indexOf('New paragraph written'));
  }finally{manager.dispose();}
});
