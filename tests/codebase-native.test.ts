import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {runInNewContext} from 'node:vm';
import {virtualPath,type CodebaseIO} from '../codebase-core';
const scope={environmentId:'env',projectId:'project',root:'/outside',title:'Project'};
test('native bridge leaves vault enumeration and events physical, preserves vault links, and blocks unsafe writes',async()=>{
  const built=await build({entryPoints:['codebase-native.ts'],bundle:true,write:false,platform:'browser',format:'cjs',external:['obsidian']});
  class Base{}class File{constructor(public vault:any,public path:string){}}class Folder extends File{}
  const module={exports:{} as any},native={App:Base,EditorSuggest:Base,ItemView:Base,MarkdownView:Base,Modal:Base,Setting:Base,Notice:Base,TFile:File,TFolder:Folder,FuzzySuggestModal:Base,WorkspaceLeaf:Base};
  runInNewContext(built.outputFiles[0].text,{module,exports:module.exports,require:()=>native,window:{setInterval:()=>0},document:{createElement:()=>({innerHTML:'',get textContent(){return this.innerHTML;}})},TextEncoder,TextDecoder,URL,console});
  let physicalWrites=0,events=0,remote='original';const physical={path:'report.md',name:'report.md'},physicalFiles=[physical],root={path:'/',children:physicalFiles};
  const adapter={read:async()=>{throw Error('missing');},write:async(_path?:string,_text?:string)=>{physicalWrites++;},exists:async()=>false,stat:async()=>null,list:async()=>({files:['report.md'],folders:[]}),remove:async(_path?:string)=>{physicalWrites++;}};
  const app:any={loadLocalStorage:()=>undefined,saveLocalStorage:()=>{},vault:{configDir:'.obsidian',adapter,getFiles:()=>physicalFiles,getAllLoadedFiles:()=>physicalFiles,getRoot:()=>root,getFileByPath:(path:string)=>path==='report.md'?physical:null,getAbstractFileByPath:(path:string)=>path==='report.md'?physical:null,read:async()=> 'physical',cachedRead:async()=> 'physical',modify:async()=>{physicalWrites++;},delete:async()=>{physicalWrites++;},trigger:()=>{events++;}},metadataCache:{getFirstLinkpathDest:(name:string)=>name==='report.md'?physical:null,fileToLinktext:(file:any)=>file.path,getFileCache:()=>null,getCache:()=>null},workspace:{openLinkText:async()=>{},on:()=>({}),onLayoutReady:()=>{},getLeavesOfType:()=>[]}};
  const plugin={registerView:()=>{},registerInterval:()=>{},registerEditorSuggest:()=>{},registerEvent:()=>{},addCommand:()=>{}};
  const io:CodebaseIO={read:async()=>remote,write:async(_scope,_path,text)=>{remote=text;},list:async()=>({entries:[],truncated:false}),search:async()=>[],resource:async()=>({url:'https://example.invalid/preview',expiresAt:Date.now()+60000})};
  const links=[{id:'link',folderPath:'Linked',connectionId:'local',projectId:'project',environmentId:'env',workspaceRoot:'/outside',projectTitle:'Project',self:false}];
  const originals={read:app.vault.read,lookup:app.vault.getFileByPath,list:adapter.list,files:app.vault.getFiles,root:app.vault.getRoot};
  const bridge=new module.exports.CodebaseBridge(app,plugin,io,()=>links,'vault',{load:()=>undefined,save:async()=>{}});await bridge.install();
  const item=bridge.register(scope,'docs/report.md');assert.equal(app.vault.getFileByPath(virtualPath(scope,'docs/report.md')),item.file);
  assert.equal(app.metadataCache.getFirstLinkpathDest('report.md','Linked/Note.md'),physical,'Existing vault links retain their destination');
  assert.equal(await app.vault.read(item.file),'original');await app.vault.modify(item.file,'edited');assert.equal(remote,'edited');assert.equal(physicalWrites,0);assert.equal(events,0);
  assert.equal(app.vault.getFiles,originals.files);assert.equal(app.vault.getRoot,originals.root);assert.equal(adapter.list,originals.list);assert.deepEqual(app.vault.getAllLoadedFiles(),physicalFiles);
  assert.throws(()=>app.vault.delete(item.file),/not supported/);assert.throws(()=>adapter.remove(item.file.path),/not supported/);assert.equal(physicalWrites,0);
  links.length=0;await assert.rejects(app.vault.read(item.file),/no longer linked/);
  bridge.dispose();assert.throws(()=>adapter.write(item.file.path,'late autosave'),/bridge is stopped/);assert.equal(physicalWrites,0);assert.equal(app.vault.read,originals.read);assert.equal(app.vault.getFileByPath,originals.lookup);
});
