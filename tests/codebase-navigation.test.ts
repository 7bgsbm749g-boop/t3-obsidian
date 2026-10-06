import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {runInNewContext} from 'node:vm';
const bundled=build({entryPoints:['codebase-native.ts'],bundle:true,write:false,platform:'browser',format:'cjs',external:['obsidian']});
const scope={environmentId:'env',projectId:'project',root:'/outside',title:'Project'};
async function fixture(){
 class Base{}class File{constructor(public vault:any,public path:string){}}
 class View{
  file:any;value='';data='';lastSavedData='';saving=false;dirty=false;
  editor={getValue:()=>this.value};getViewData(){return this.value;}setViewData(text:string){this.value=text;}
  async unload(){if(this.getViewData()!==this.lastSavedData){await app.vault.modify(this.file,this.getViewData());this.lastSavedData=this.getViewData();}}
 }
 const callbacks=new Map<string,Function>(),local=new Map<string,any>(),leaves:Array<{view:View}>=[],notices:string[]=[];
 const remote=new Map([['a.md','Alpha'],['b.json','Beta'],['code.ts','Code']]);let reads=0,writes=0;
 const io:any={read:async(_s:any,path:string)=>{reads++;return remote.get(path);},write:async(_s:any,path:string,text:string)=>{writes++;remote.set(path,text);},list:async()=>({entries:[],truncated:false}),search:async()=>[],resource:async()=>({url:'',expiresAt:0})};
 const app:any={loadLocalStorage:(k:string)=>local.get(k),saveLocalStorage:(k:string,v:any)=>local.set(k,v),vault:{configDir:'.obsidian',adapter:{read:async()=>{throw Error('missing');}},read:async()=>'',modify:async()=>{},process:async()=>{},getFileByPath:()=>null,getAbstractFileByPath:()=>null},metadataCache:{getFirstLinkpathDest:()=>null,fileToLinktext:()=>'',getFileCache:()=>null,getCache:()=>null},workspace:{on:(name:string,cb:Function)=>{callbacks.set(name,cb);return {};},onLayoutReady:()=>{},getLeavesOfType:()=>leaves,openLinkText:async()=>{}}};
 const plugin={registerEvent(){},registerView(){},registerInterval(){},registerEditorSuggest(){},addCommand(){}};
 const module={exports:{} as any};runInNewContext((await bundled).outputFiles[0].text,{module,exports:module.exports,require:()=>({EditorSuggest:Base,ItemView:Base,MarkdownView:View,Notice:class{constructor(text:string){notices.push(text);}},TFile:File,TFolder:File,FuzzySuggestModal:Base}),window:{setInterval:()=>0},document:{createElement:()=>({innerHTML:'',get textContent(){return this.innerHTML;}})},TextEncoder,URL,console,setTimeout,clearTimeout,performance});
 const bridge=new module.exports.CodebaseBridge(app,plugin,io,()=>[{folderPath:'Linked',projectId:'project',environmentId:'env',workspaceRoot:'/outside',projectTitle:'Project'}],'navigation',{load:()=>undefined,save:async()=>{}});await bridge.install();
 const view=new View();leaves.push({view});
 async function load(path:string){await view.unload();const item=bridge.register(scope,path);view.file=item.file;view.value=view.data=view.lastSavedData=await app.vault.read(item.file);callbacks.get('file-open')!(item.file);return item;}
 return {bridge,app,io,view,callbacks,remote,notices,local,load,get reads(){return reads;},get writes(){return writes;}};
}
test('one native tab can browse different text files without ghost edits, then save a real edit',async()=>{
 const f=await fixture();await f.load('a.md');const b=await f.load('b.json');const before=f.reads;
 await f.app.vault.modify(b.file,f.view.getViewData());assert.equal(f.reads,before);assert.equal(f.writes,0);assert.equal(b.document.uncertain,false);assert.deepEqual(f.notices,[]);
 f.view.value='Edited Beta';f.callbacks.get('editor-change')!(f.view.editor,f.view);await f.app.vault.modify(b.file,f.view.value);
 assert.equal(f.remote.get('b.json'),'Edited Beta');assert.equal(f.writes,1);assert.equal(b.document.uncertain,false);await f.load('code.ts');f.bridge.dispose();
});
test('a clean agent refresh updates the native saved buffer, so unload does not invent a save',async()=>{
 const f=await fixture();await f.load('a.md');f.remote.set('a.md','Agent update');await f.bridge.refresh();
 assert.equal(f.view.value,'Agent update');assert.equal(f.view.data,'Agent update');assert.equal(f.view.lastSavedData,'Agent update');
 f.remote.set('a.md','Second agent update');await f.load('b.json');assert.equal(f.writes,0);assert.equal(f.remote.get('a.md'),'Second agent update');assert.deepEqual(f.notices,[]);f.bridge.dispose();
});
test('a delayed refresh cannot change a reused tab for another file with identical text',async()=>{
 const f=await fixture();const a=await f.load('a.md');f.remote.set('b.json','Alpha');let release!:(text:string)=>void;
 f.io.read=async(_s:any,path:string)=>path==='a.md'?new Promise<string>(r=>release=r):f.remote.get(path);
 const refreshing=f.bridge.refresh();await Promise.resolve();await f.load('b.json');release('Updated A');await refreshing;
 assert.equal(f.view.file.name,'b.json');assert.equal(f.view.value,'Alpha');assert.equal(f.view.data,'Alpha');assert.equal(f.view.lastSavedData,'Alpha');assert.equal(f.writes,0);assert.equal(a.document.draft,undefined);f.bridge.dispose();
});
test('unchanged save preserves real recovery text and explicit stale process edits are not silently dropped',async()=>{
 const f=await fixture();const a=await f.load('a.md');f.io.write=async()=>{throw Error('lost acknowledgement');};
 await assert.rejects(a.document.save('Real edit'),/lost acknowledgement/);await f.app.vault.modify(a.file,'Alpha');assert.equal(a.document.draft,'Real edit');assert.equal(a.document.uncertain,true);assert.equal(f.local.get('t3-codebase-drafts:navigation')[a.file.path],'Real edit');
 const b=await f.load('b.json');f.remote.set('b.json','New Beta');await b.document.read(true);
 await assert.rejects(f.app.vault.process(b.file,()=> 'Beta'),/not confirmed/);assert.equal(f.remote.get('b.json'),'New Beta');f.bridge.dispose();
});
test('native saved-state compatibility guard leaves an in-flight save and unknown saved data unchanged',async()=>{
 const f=await fixture();await f.load('a.md');f.view.saving=true;f.remote.set('a.md','Agent update');await f.bridge.refresh();assert.equal(f.view.value,'Agent update');assert.equal(f.view.lastSavedData,'Alpha');assert.equal(f.view.data,'Alpha');assert.equal(f.view.saving,true);f.bridge.dispose();
});
test('opening a retained uncertain edit shows the project buffer and keeps recovery text out of autosave',async()=>{
 const f=await fixture();const item=f.bridge.register(scope,'b.json');f.bridge.retain(item.file.path,'Retained recovery edit');item.document.uncertain=true;
 const leaf={view:f.view,setViewState:async(state:any)=>{f.view.file=f.app.vault.getFileByPath(state.state.file);f.view.value=f.view.data=f.view.lastSavedData=await f.app.vault.read(f.view.file);}};
 await f.bridge.open(item,leaf);assert.equal(f.view.value,'Beta');assert.equal(f.local.get('t3-codebase-drafts:navigation')[item.file.path],'Retained recovery edit');await f.view.unload();assert.equal(f.writes,0);assert.equal(item.document.uncertain,true);assert.equal(f.notices.length,1);await f.bridge.open(item,leaf);assert.equal(f.notices.length,1);f.bridge.dispose();
});
