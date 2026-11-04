import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {runInNewContext} from 'node:vm';
import {createRequire} from 'node:module';
import {EditorState} from '@codemirror/state';
import {history,undo,redo} from '@codemirror/commands';

const require=createRequire(import.meta.url);
const bundled=build({stdin:{contents:`
  export {CodebaseBridge} from './src/projects/codebase-native';
  export {NativeResponseView} from './src/responses/native-response-view';
  export {responseAnchor} from './src/responses/native-response-projection';
  export {removeStreamBlockFromEditor} from './src/responses/stream-block-edit';
  export {interruptedHistoryFixture} from './tests/fixtures/stream-history';
  export {renderResponseToolGroup} from './src/responses/response-tools';
`,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'browser',format:'cjs',external:['obsidian','@codemirror/state','@codemirror/view','@codemirror/language','@codemirror/commands','@codemirror/autocomplete','@lezer/common','@lezer/lr','@lezer/highlight']});
const scope={environmentId:'env',projectId:'project',root:'/synthetic',title:'Synthetic'};
const id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
async function fixture(){
  class Base{}class File{constructor(public vault:unknown,public path:string){}}
  const callbacks=new Map<string,Function>(),local=new Map<string,any>(),leaves:any[]=[],notices:string[]=[];
  const app:any={loadLocalStorage:(key:string)=>local.get(key),saveLocalStorage:(key:string,value:unknown)=>local.set(key,value),vault:{configDir:'.obsidian',adapter:{read:async()=>{throw Error('missing');}},read:async()=>'',modify:async()=>assert.fail('No physical vault write'),process:async()=>{},getFileByPath:()=>null,getAbstractFileByPath:()=>null},metadataCache:{getFirstLinkpathDest:()=>null,getCache:()=>null},workspace:{on:(name:string,callback:Function)=>{callbacks.set(name,callback);return {};},onLayoutReady(){},getLeavesOfType:(type:string)=>type==='markdown'?leaves:[],openLinkText:async()=>{}}};
  const plugin={registerEvent(){},registerView(){},registerInterval(){},registerEditorSuggest(){},addCommand(){}};
  const module={exports:{} as any};
  runInNewContext((await bundled).outputFiles[0].text,{module,exports:module.exports,require:(name:string)=>name==='obsidian'?{EditorSuggest:Base,ItemView:Base,MarkdownView:Base,TFile:File,TFolder:File,FuzzySuggestModal:Base,Notice:class{constructor(text:string){notices.push(text);}}}:require(name),window:{setInterval:()=>0},document:{createElement:()=>({innerHTML:'',get textContent(){return this.innerHTML;}})},TextEncoder,URL,console,setTimeout,clearTimeout,performance,queueMicrotask});
  const {CodebaseBridge,NativeResponseView,responseAnchor,removeStreamBlockFromEditor,interruptedHistoryFixture,renderResponseToolGroup}=module.exports;
  const interrupted=interruptedHistoryFixture();
  const tool=renderResponseToolGroup({id:'tool',turnId:'turn',tools:[{id:'command',turnId:'turn',key:'command',status:'completed',label:'Ran command',activeLabel:'Running command',icon:'terminal',action:'command',sequence:1,output:'Full retained output. '.repeat(500)}]});
  const body=interrupted.body.replace('\n>\n','\n>\n> '+tool+'\n>\n');
  const before='Before\n\n'+responseAnchor(id)+'\n\nAfter\n',after=before.replace(responseAnchor(id),body);
  let remote=before,writes=0;
  const io={read:async()=>remote,write:async(_scope:unknown,_path:string,text:string)=>{writes++;remote=text;}};
  const bridge=new CodebaseBridge(app,plugin,io,()=>[],'response-save',{environments:()=>['env'],load:()=>undefined,save:async()=>{}});await bridge.install();
  const item=bridge.register(scope,'response.md');let value=await app.vault.read(item.file);
  const view:any={file:item.file,data:value,lastSavedData:value,saving:false,getMode:()=> 'source',getState:()=>({source:false}),getViewData:()=>cm?cm.state.doc.toString():value,setViewData:(text:string)=>{value=text;},requestSave(){},save:async()=>{
    const text=view.getViewData();view.data=view.lastSavedData=text;view.saving=true;
    try{await app.vault.modify(view.file,text);}finally{view.saving=false;}
  }};
  let cm:any;view.editor={getValue:()=>view.getViewData()};leaves.push({view});callbacks.get('file-open')!(item.file);
  const adapter=new NativeResponseView(view,before,()=>{},async()=>app.vault.read(view.file));
  cm={state:EditorState.create({doc:value,extensions:[adapter.extension(),history()]}),dispatch:(spec:any)=>{
    const transaction=spec.startState?spec:cm.state.update(spec);cm.state=transaction.state;
    if(transaction.docChanged)callbacks.get('editor-change')!(view.editor,view);
  }};
  view.editor={cm,getValue:()=>cm.state.doc.toString(),offsetToPos:(offset:number)=>{const line=cm.state.doc.lineAt(offset);return {line:line.number-1,ch:offset-line.from};},replaceRange:(text:string,from:{line:number;ch:number},to:{line:number;ch:number})=>cm.dispatch({changes:{from:cm.state.doc.line(from.line+1).from+from.ch,to:cm.state.doc.line(to.line+1).from+to.ch,insert:text}})};
  const preview=()=>adapter.setResponses([{id,body,followable:false}]);
  const commit=async()=>{adapter.prepareMaterialization(before,after,[id]);await app.vault.process(item.file,()=>after);assert.equal(adapter.acceptCommitted(after,[id]),true);adapter.cancelMaterialization();};
  return {app,bridge,item,view,adapter,cm,body,before,after,preview,commit,notices,io,callbacks,local,key:interrupted.key,close:()=>removeStreamBlockFromEditor(view,interrupted.key,adapter.saved()),remote:()=>remote,writes:()=>writes,setRemote:(text:string)=>{remote=text;},dispose:()=>{adapter.dispose();bridge.dispose();}};
}
test('stream previews and compact tools never become project recovery edits',async()=>{
  const h=await fixture();try{
    h.preview();assert.ok(h.view.editor.getValue().includes('data-t3-tool-ref='));
    assert.equal(h.adapter.saved(),h.before);assert.equal(h.item.document.draft,undefined);
    assert.equal(h.local.get('t3-codebase-drafts:response-save')?.[h.item.file.path],undefined);assert.equal(h.item.document.uncertain,false);
    h.cm.dispatch({changes:{from:0,to:6,insert:'Typed before'}});
    assert.equal(h.item.document.draft,h.before.replace('Before','Typed before'));
    assert.ok(!h.item.document.draft.includes('data-t3-tool-ref='));assert.ok(!h.item.document.draft.includes(h.body));
  }finally{h.dispose();}
});
test('an interrupted project result can close, autosave, undo, redo and reopen with exact canonical bytes',async()=>{
  const h=await fixture();try{
    h.preview();await h.commit();assert.equal(h.remote(),h.after);assert.equal(h.adapter.saved(),h.after);
    assert.equal(h.close(),true);await h.view.save();const closed=h.remote();
    assert.ok(!closed.includes('[!t3-progress]'));assert.ok(closed.startsWith('Before\n'));assert.ok(closed.endsWith('After\n'));
    assert.equal(h.item.document.uncertain,false);assert.equal(h.item.document.draft,undefined);assert.deepEqual(h.notices,[]);
    assert.equal(undo(h.cm),true);await h.view.save();assert.equal(h.remote(),h.after);
    assert.equal(redo(h.cm),true);await h.view.save();assert.equal(h.remote(),closed);
    h.adapter.dispose();assert.equal(await h.app.vault.read(h.item.file),closed);assert.equal(h.writes(),4);
  }finally{h.dispose();}
});
test('a fresh project read adopts saved output without mistaking its preview for dirty typing',async()=>{
  const h=await fixture();try{
    h.preview();h.setRemote(h.after);(h.item.document as any).readAt=0;
    h.adapter.registerLocalBindings([id]);await h.bridge.refresh();
    assert.equal(h.adapter.saved(),h.after);assert.equal(h.adapter.scrollControl(h.key),undefined);
    assert.equal(h.close(),true);await h.view.save();assert.equal(h.item.document.uncertain,false);assert.deepEqual(h.notices,[]);
  }finally{h.dispose();}
});
test('close cannot overwrite a competing project edit and keeps the canonical local removal',async()=>{
  const h=await fixture();try{
    h.preview();await h.commit();assert.equal(h.close(),true);
    const local=h.adapter.saved(),changed=h.after.replace('After','External edit');h.setRemote(changed);
    await assert.rejects(h.view.save(),/project file changed/);assert.equal(h.remote(),changed);
    assert.equal(h.item.document.draft,local);assert.ok(!local.includes('data-t3-tool-ref='));assert.equal(h.writes(),1);
  }finally{h.dispose();}
});
test('an unconfirmed transport write stays uncertain and retains the local edit',async()=>{
  const h=await fixture();try{
    h.preview();await h.commit();assert.equal(h.close(),true);const local=h.adapter.saved();
    h.io.write=async()=>{throw Error('Lost acknowledgement');};await assert.rejects(h.view.save(),/Lost acknowledgement/);
    assert.equal(h.item.document.uncertain,true);assert.equal(h.item.document.draft,local);
    await assert.rejects(h.app.vault.modify(h.item.file,local),/last save is not confirmed/);assert.equal(h.remote(),h.after);
  }finally{h.dispose();}
});
