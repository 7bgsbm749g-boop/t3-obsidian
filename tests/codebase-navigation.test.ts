import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {runInNewContext} from 'node:vm';
const bundled=build({entryPoints:['codebase-native.ts'],bundle:true,write:false,platform:'browser',format:'cjs',external:['obsidian','@codemirror/state','@codemirror/view','@codemirror/language','@codemirror/commands','@codemirror/autocomplete','@lezer/common','@lezer/lr','@lezer/highlight']});
const scope={environmentId:'env',projectId:'project',root:'/outside',title:'Project'};
async function fixture(){
 class Base{}class File{constructor(public vault:any,public path:string){}}
 class View{
  type='markdown';file:any;value='';previewValue='';mode='source';data='';lastSavedData='';saving=false;dirty=false;
  editor={getValue:()=>this.value};getMode(){return this.mode;}getViewData(){return this.mode==='preview'?this.previewValue:this.value;}setViewData(text:string){if(this.mode==='preview')this.previewValue=text;else this.value=text;}
  async unload(){if(this.getViewData()!==this.lastSavedData){await app.vault.modify(this.file,this.getViewData());this.lastSavedData=this.getViewData();}}
 }
 const callbacks=new Map<string,Function>(),local=new Map<string,any>(),leaves:Array<{view:View}>=[],notices:string[]=[];
 const remote=new Map([['a.md','Alpha'],['b.json','Beta'],['code.ts','Code']]);let reads=0,writes=0;
 const io:any={read:async(_s:any,path:string)=>{reads++;return remote.get(path);},write:async(_s:any,path:string,text:string)=>{writes++;remote.set(path,text);},list:async()=>({entries:[],truncated:false}),search:async()=>[],resource:async()=>({url:'',expiresAt:0})};
 const app:any={loadLocalStorage:(k:string)=>local.get(k),saveLocalStorage:(k:string,v:any)=>local.set(k,v),vault:{configDir:'.obsidian',adapter:{read:async()=>{throw Error('missing');}},read:async()=>'',modify:async()=>{},process:async()=>{},getFileByPath:()=>null,getAbstractFileByPath:()=>null},metadataCache:{getFirstLinkpathDest:()=>null,fileToLinktext:()=>'',getFileCache:()=>null,getCache:()=>null},workspace:{on:(name:string,cb:Function)=>{callbacks.set(name,cb);return {};},onLayoutReady:()=>{},getLeavesOfType:(type:string)=>leaves.filter(leaf=>leaf.view.type===type),openLinkText:async()=>{}}};
 const creators=new Map<string,any>();app.viewRegistry={getViewCreatorByType:(type:string)=>creators.get(type)};
 const plugin={registerEvent(){},registerView(type:string,factory:any){creators.set(type,factory);},registerInterval(){},registerEditorSuggest(){},addCommand(){}};
 const module={exports:{} as any};runInNewContext((await bundled).outputFiles[0].text,{module,exports:module.exports,require:()=>({EditorSuggest:Base,ItemView:Base,MarkdownView:View,Notice:class{constructor(text:string){notices.push(text);}},TFile:File,TFolder:File,FuzzySuggestModal:Base}),window:{setInterval:()=>0},document:{createElement:()=>({innerHTML:'',get textContent(){return this.innerHTML;}})},TextEncoder,URL,console,setTimeout,clearTimeout,performance});
 const bridge=new module.exports.CodebaseBridge(app,plugin,io,()=>[{folderPath:'Linked',projectId:'project',environmentId:'env',workspaceRoot:'/outside',projectTitle:'Project'}],'navigation',{load:()=>undefined,save:async()=>{}});await bridge.install();
 const view=new View();leaves.push({view});
 async function load(path:string){await view.unload();const item=bridge.register(scope,path);view.type=path==='b.json'?'json':path==='code.ts'?'typescript':'markdown';view.file=item.file;view.value=view.data=view.lastSavedData=await app.vault.read(item.file);callbacks.get('file-open')!(item.file);return item;}
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
 await assert.rejects(f.app.vault.process(b.file,()=> 'Beta'),/lost acknowledgement/);assert.equal(b.document.draft,'Beta');assert.equal(b.document.uncertain,true);assert.equal(f.remote.get('b.json'),'New Beta');f.bridge.dispose();
});
test('native saved-state compatibility guard leaves an in-flight save and unknown saved data unchanged',async()=>{
 const f=await fixture();await f.load('a.md');f.view.saving=true;f.remote.set('a.md','Agent update');await f.bridge.refresh();assert.equal(f.view.value,'Alpha');assert.equal(f.view.lastSavedData,'Alpha');assert.equal(f.view.data,'Alpha');assert.equal(f.view.saving,true);f.view.saving=false;await f.bridge.refresh();for(const text of [f.view.value,f.view.data,f.view.lastSavedData])assert.equal(text,'Agent update');f.bridge.dispose();
});
test('opening a retained uncertain edit shows the project buffer and keeps recovery text out of autosave',async()=>{
 const f=await fixture();const item=f.bridge.register(scope,'b.json');f.bridge.retain(item.file.path,'Retained recovery edit');item.document.uncertain=true;
 const leaf={view:f.view,setViewState:async(state:any)=>{assert.equal(state.type,'json');f.view.type=state.type;f.view.file=f.app.vault.getFileByPath(state.state.file);f.view.value=f.view.data=f.view.lastSavedData=await f.app.vault.read(f.view.file);}};
 await f.bridge.open(item,leaf);assert.equal(f.view.value,'Beta');assert.equal(f.local.get('t3-codebase-drafts:navigation')[item.file.path],'Retained recovery edit');await f.view.unload();assert.equal(f.writes,0);assert.equal(item.document.uncertain,true);assert.equal(f.notices.length,1);await f.bridge.open(item,leaf);assert.equal(f.notices.length,1);f.bridge.dispose();
});
test('refresh adopts the exact fresh text after a background read advanced the document cache',async()=>{
 const f=await fixture();const item=await f.load('a.md');f.remote.set('a.md','Fresh agent text');await item.document.read(true);
 assert.equal(f.view.value,'Alpha');await f.bridge.refresh();
 for(const text of [f.view.value,f.view.getViewData(),f.view.data,f.view.lastSavedData,item.document.base])assert.equal(text,'Fresh agent text');
 await f.view.unload();assert.equal(f.writes,0);assert.equal(item.document.draft,undefined);f.bridge.dispose();
});
test('a fresh vault read adopts clean native buffers before their unload',async()=>{
 const f=await fixture();const item=await f.load('a.md');f.remote.set('a.md','Fresh passive read');(item.document as any).readAt=0;
 assert.equal(await f.app.vault.read(item.file),'Fresh passive read');
 for(const text of [f.view.value,f.view.data,f.view.lastSavedData])assert.equal(text,'Fresh passive read');
 await f.load('b.json');assert.equal(f.writes,0);assert.deepEqual(f.notices,[]);f.bridge.dispose();
});
test('a filtered or failed native update retains its loaded basis and can retry the same confirmed text',async()=>{
 const f=await fixture();const item=await f.load('a.md');const original=f.view.setViewData;f.view.setViewData=()=>{};f.remote.set('a.md','Retry text');await f.bridge.refresh();
 assert.equal(item.document.base,'Retry text');assert.equal((f.bridge as any).viewBases.get(f.view).text,'Alpha');assert.equal(f.view.lastSavedData,'Alpha');
 f.view.setViewData=()=>{throw Error('Native editor unavailable');};await f.bridge.refresh();assert.equal((f.bridge as any).viewBases.get(f.view).text,'Alpha');
 f.view.setViewData=original;await f.bridge.refresh();
 for(const text of [f.view.value,f.view.data,f.view.lastSavedData,(f.bridge as any).viewBases.get(f.view).text])assert.equal(text,'Retry text');assert.equal(f.writes,0);f.bridge.dispose();
});
test('a dirty native buffer remains intact when the confirmed cache is newer',async()=>{
 const f=await fixture();const item=await f.load('a.md');f.view.value='Unsaved local edit';f.remote.set('a.md','New project text');await item.document.read(true);await f.bridge.refresh();
 assert.equal(f.view.value,'Unsaved local edit');assert.equal(f.view.lastSavedData,'Alpha');f.callbacks.get('editor-change')!(f.view.editor,f.view);
 await assert.rejects(f.app.vault.modify(item.file,f.view.value),/not confirmed/);assert.equal(f.remote.get('a.md'),'New project text');assert.equal(item.document.draft,'Unsaved local edit');assert.equal(item.document.uncertain,true);f.bridge.dispose();
});
test('dispose does not retain an unchanged loaded buffer as a draft after a fresh cache read',async()=>{
 const f=await fixture();const item=await f.load('a.md');f.remote.set('a.md','New project text');await item.document.read(true);
 f.app.workspace.iterateAllLeaves=(cb:Function)=>cb({view:f.view,detach(){}});f.bridge.dispose();
 assert.equal(f.local.get('t3-codebase-drafts:navigation')?.[item.file.path],undefined);assert.equal(f.writes,0);
});
test('a delayed passive read cannot replace a newer confirmed native save',async()=>{
 const f=await fixture();const item=await f.load('a.md');const original=f.io.read;let release!:(text:string)=>void,first=true;
 f.io.read=async(s:any,path:string)=>{if(first){first=false;return new Promise<string>(r=>release=r);}return original(s,path);};(item.document as any).readAt=0;
 const reading=f.app.vault.read(item.file);while(!release)await new Promise<void>(resolve=>setImmediate(resolve));
 f.view.value='Confirmed local text';f.callbacks.get('editor-change')!(f.view.editor,f.view);await f.app.vault.modify(item.file,f.view.value);
 release('Alpha');assert.equal(await reading,'Confirmed local text');
 for(const text of [item.document.base,f.view.value,f.view.lastSavedData])assert.equal(text,'Confirmed local text');assert.equal(f.remote.get('a.md'),'Confirmed local text');assert.equal(f.writes,1);f.bridge.dispose();
});
test('a reading-view refresh updates active text and saved buffers before returning to source mode',async()=>{
 const f=await fixture();const item=await f.load('a.md');f.view.mode='preview';f.view.previewValue='Alpha';f.remote.set('a.md','Reading update');await item.document.read(true);await f.bridge.refresh();
 assert.equal(f.view.value,'Alpha');for(const text of [f.view.getViewData(),f.view.data,f.view.lastSavedData,(f.bridge as any).viewBases.get(f.view).text])assert.equal(text,'Reading update');
 f.callbacks.get('editor-change')!(f.view.editor,f.view);assert.equal(item.document.draft,undefined);
 f.view.mode='source';f.view.value=f.view.data;assert.equal(f.view.getViewData(),'Reading update');await f.view.unload();assert.equal(f.writes,0);assert.deepEqual(f.notices,[]);f.bridge.dispose();
});
test('Reading refresh waits for native saved state and then retries without a source rollback',async()=>{
 const f=await fixture();const item=await f.load('a.md');f.view.mode='preview';f.view.previewValue='Alpha';f.view.saving=true;f.remote.set('a.md','Settled reading update');await f.bridge.refresh();
 for(const text of [f.view.getViewData(),f.view.data,f.view.lastSavedData,(f.bridge as any).viewBases.get(f.view).text])assert.equal(text,'Alpha');
 f.view.saving=false;f.view.lastSavedData='Core save still settling';await f.bridge.refresh();assert.equal(f.view.getViewData(),'Alpha');
 f.view.lastSavedData='Alpha';await f.bridge.refresh();for(const text of [f.view.getViewData(),f.view.data,f.view.lastSavedData])assert.equal(text,'Settled reading update');
 f.view.mode='source';f.view.value=f.view.data;assert.equal(f.view.getViewData(),'Settled reading update');assert.equal(item.document.draft,undefined);assert.equal(f.writes,0);f.bridge.dispose();
});
test('a new native Reading view can retain its confirmed loaded basis while the document cache advances',async()=>{
 const f=await fixture();const item=await f.load('a.md');const reading=new (f.view.constructor as any)();reading.file=item.file;reading.mode='preview';reading.value=reading.previewValue=reading.data=reading.lastSavedData='Alpha';f.app.workspace.getLeavesOfType=()=>[{view:reading}];
 f.remote.set('a.md','New reading text');await item.document.read(true);await f.bridge.refresh();
 for(const text of [reading.getViewData(),reading.data,reading.lastSavedData,(f.bridge as any).viewBases.get(reading).text])assert.equal(text,'New reading text');assert.equal(reading.value,'Alpha');assert.equal(f.writes,0);f.bridge.dispose();
});
test('a passive read that finishes during a native save keeps the loaded base until the save settles',async()=>{
 const f=await fixture();const item=await f.load('a.md');const original=f.io.read;let release!:(text:string)=>void,first=true;
 f.io.read=async(s:any,path:string)=>{if(first){first=false;return new Promise<string>(r=>release=r);}return original(s,path);};(item.document as any).readAt=0;
 const reading=f.app.vault.read(item.file);while(!release)await new Promise<void>(resolve=>setImmediate(resolve));f.view.saving=true;f.remote.set('a.md','Fresh after pending save');release('Fresh after pending save');
 assert.equal(await reading,'Alpha');assert.equal(item.document.base,'Alpha');assert.equal(f.view.value,'Alpha');await f.app.vault.modify(item.file,'Alpha');assert.equal(item.document.draft,undefined);assert.equal(f.writes,0);
 f.view.saving=false;assert.equal(await f.app.vault.read(item.file),'Fresh after pending save');for(const text of [f.view.value,f.view.data,f.view.lastSavedData])assert.equal(text,'Fresh after pending save');assert.equal(f.writes,0);f.bridge.dispose();
});
test('consecutive native saves advance their confirmed basis while core marks the save in flight',async()=>{
 const f=await fixture();const item=await f.load('a.md');
 for(const text of ['First native save','Second native save']){f.view.value=text;f.callbacks.get('editor-change')!(f.view.editor,f.view);f.view.data=f.view.lastSavedData=text;f.view.saving=true;await f.app.vault.modify(item.file,text);assert.equal((f.bridge as any).viewBases.get(f.view).text,text);assert.equal(f.view.saving,true);f.view.saving=false;}
 assert.equal(f.writes,2);assert.equal(item.document.uncertain,false);assert.equal(item.document.draft,undefined);assert.equal(f.remote.get('a.md'),'Second native save');assert.deepEqual(f.notices,[]);f.bridge.dispose();
});
test('typing during a native save preserves the newer draft and advances only that save origin for saveAgain',async()=>{
 const f=await fixture();const item=await f.load('a.md');const original=f.io.write;let release!:()=>void,started!:()=>void;const gate=new Promise<void>(r=>release=r),writing=new Promise<void>(r=>started=r);let first=true;
 f.io.write=async(s:any,path:string,text:string)=>{if(first){first=false;started();await gate;}return original(s,path,text);};
 f.view.value='First overlapping save';f.callbacks.get('editor-change')!(f.view.editor,f.view);f.view.data=f.view.lastSavedData=f.view.value;f.view.saving=true;const saving=f.app.vault.modify(item.file,f.view.value);await writing;
 f.view.value='Second overlapping save';f.callbacks.get('editor-change')!(f.view.editor,f.view);release();await saving;
 assert.equal(f.view.value,'Second overlapping save');assert.equal(item.document.draft,'Second overlapping save');assert.equal((f.bridge as any).viewBases.get(f.view).text,'First overlapping save');assert.equal(f.view.data,'First overlapping save');
 f.view.data=f.view.lastSavedData=f.view.value;await f.app.vault.modify(item.file,f.view.value);f.view.saving=false;
 assert.equal(f.writes,2);assert.equal(f.remote.get('a.md'),'Second overlapping save');assert.equal(item.document.draft,undefined);assert.equal(item.document.uncertain,false);assert.deepEqual(f.notices,[]);f.bridge.dispose();
});
