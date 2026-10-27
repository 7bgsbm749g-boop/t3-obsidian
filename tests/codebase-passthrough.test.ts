import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {runInNewContext} from 'node:vm';
import {catalogCodebases,virtualPath} from '../codebase-core';
const scope={environmentId:'env',projectId:'scratch',root:'/machine/scratch',title:'No project'},workspace={...scope,root:'/machine/thread-folder',threadId:'thread'};
const bundled=build({entryPoints:['codebase-native.ts'],bundle:true,write:false,platform:'browser',format:'cjs',external:['obsidian','@codemirror/state','@codemirror/view','@codemirror/language','@codemirror/commands','@codemirror/autocomplete','@lezer/common','@lezer/lr','@lezer/highlight']});
async function fixture(){
  class Base{}class File{constructor(public vault:any,public path:string){}}
  let environments=['env'],catalogs=0,resources=0,opened:any,postprocess:any;const local=new Map<string,any>(),physical={path:'Assets/chart.png'};
  const app:any={loadLocalStorage:(key:string)=>local.get(key),saveLocalStorage:(key:string,value:any)=>local.set(key,value),vault:{configDir:'.obsidian',adapter:{read:async()=>{throw Error('missing');},getResourcePath:()=> 'capacitor://localhost/_capacitor_file_/private/vault'},getFileByPath:(path:string)=>path===physical.path?physical:null,getAbstractFileByPath:()=>null,read:async()=> 'physical',getFiles:()=>[physical]},metadataCache:{getFirstLinkpathDest:(path:string)=>path===physical.path?physical:null,getCache:()=>null},workspace:{openLinkText:async()=>{},on:()=>({}),onLayoutReady:()=>{},getLeavesOfType:()=>[],getLeaf:()=>({})}};
  const plugin={registerView:()=>{},registerInterval:()=>{},registerEditorSuggest:()=>{},registerEvent:()=>{},addCommand:()=>{},registerMarkdownPostProcessor:(handler:any)=>{postprocess=handler;}};
  const io:any={catalog:async(environmentId:string)=>{assert.equal(environmentId,'env');catalogs++;return [scope,workspace];},resource:async()=>{resources++;return {url:'https://signed.example/api/assets/chart',expiresAt:Date.now()+300000};},read:async()=> 'remote'};
  const module={exports:{} as any};runInNewContext((await bundled).outputFiles[0].text,{module,exports:module.exports,require:()=>({EditorSuggest:Base,ItemView:Base,MarkdownView:Base,FuzzySuggestModal:Base,TFile:File,TFolder:File,Notice:Base}),window:{setInterval:()=>0},document:{createElement:()=>({innerHTML:'',get textContent(){return this.innerHTML;}})},TextEncoder,URL,setTimeout,clearTimeout,performance});
  const bridge=new module.exports.CodebaseBridge(app,plugin,io,()=>[],'passthrough',{environments:()=>environments,load:()=>undefined,save:async()=>{}});await bridge.install();bridge.open=async(item:any)=>{opened=item;};
  function image(src:string){const attrs:Record<string,string>={src,alt:'chart'};return {attrs,getAttribute:(key:string)=>attrs[key]??null,setAttribute:(key:string,value:string)=>{attrs[key]=value;},closest:()=>null};}
  const render=async(img:any)=>postprocess({querySelectorAll:(selector:string)=>selector==='img'?[img]:[]},{sourcePath:'Unlinked/Note.md'});
  return {bridge,app,io,image,render,physical,get opened(){return opened;},get catalogs(){return catalogs;},get resources(){return resources;},disconnect:()=>{environments=[];}};
}

test('authenticated unlinked projects and per-thread folders open without changing native vault wiki links',async()=>{
  const f=await fixture();try{
    await f.app.workspace.openLinkText('/machine/thread-folder/report.md','Unlinked/Note.md',false);
    assert.equal(f.opened.file.path,virtualPath(workspace,'report.md'));assert.equal(f.catalogs,1);
    assert.equal(f.app.metadataCache.getFirstLinkpathDest('Assets/chart.png','Unlinked/Note.md'),f.physical);
    f.disconnect();await assert.rejects(f.app.vault.read(f.opened.file),/disconnected|unavailable|no longer linked/);
  }finally{f.bridge.dispose();}
});

test('cold mobile images load through signed URLs with no folder links, while native vault images stay native',async()=>{
  const f=await fixture();try{
    const image=f.image('capacitor://localhost/_capacitor_file_/private/vault/machine/thread-folder/chart.png');await f.render(image);
    assert.equal(image.attrs.src,'https://signed.example/api/assets/chart');assert.equal(f.resources,1);
    await f.render(image);assert.equal(f.resources,1,'Own signed src changes cannot cause a fetch loop');
    const physical=f.image('capacitor://localhost/_capacitor_file_/private/vault/Assets/chart.png');await f.render(physical);
    assert.equal(physical.attrs.src,'capacitor://localhost/_capacitor_file_/private/vault/Assets/chart.png');assert.equal(f.resources,1);
  }finally{f.bridge.dispose();}
});

test('Live Preview hydrates an image with no src from its original Markdown target',async()=>{
  const f=await fixture();try{
    const image=f.image('');delete image.attrs.src;
    await f.bridge.renderMedia({querySelectorAll:(selector:string)=>selector==='img'?[image]:[]},'Unlinked/Note.md',()=>'/machine/thread-folder/chart.png');
    assert.equal(image.attrs.src,'https://signed.example/api/assets/chart');
  }finally{f.bridge.dispose();}
});

test('an in-flight mobile image cannot update a recycled node or a disconnected environment',async()=>{
  const f=await fixture();try{
    let finish!:(value:any)=>void;f.io.resource=async()=>new Promise(resolve=>{finish=resolve;});
    const image=f.image('capacitor://localhost/_capacitor_file_/machine/scratch/chart.png'),work=f.render(image);
    for(let i=0;i<100&&!finish;i++)await new Promise(resolve=>setTimeout(resolve,1));assert.ok(finish);image.attrs.src='https://ordinary.example/other.png';
    finish({url:'https://signed.example/late',expiresAt:Date.now()+300000});await work;assert.equal(image.attrs.src,'https://ordinary.example/other.png');
    const before=finish,other=f.image('capacitor://localhost/_capacitor_file_/machine/scratch/other.png'),next=f.render(other);
    for(let i=0;i<100&&finish===before;i++)await new Promise(resolve=>setTimeout(resolve,1));assert.notEqual(finish,before);f.disconnect();
    finish({url:'https://signed.example/late',expiresAt:Date.now()+300000});await next;assert.match(other.attrs.src,/capacitor:/);
  }finally{f.bridge.dispose();}
});

test('authenticated catalog scopes reject invalid roots and thread/project mismatches',()=>{
  const scopes=catalogCodebases('env',{projects:[{id:'scratch',workspaceRoot:'/machine/scratch'},{id:'bad',workspaceRoot:'/machine/../etc'}],threads:[{id:'thread',projectId:'scratch',worktreePath:'/machine/thread-folder'},{id:'wrong',projectId:'missing',worktreePath:'/etc'},{id:'bad-thread',projectId:'scratch',worktreePath:'relative'}]});
  assert.deepEqual(scopes.map(item=>[item.projectId,item.threadId,item.root]),[['scratch',undefined,'/machine/scratch'],['scratch','thread','/machine/thread-folder']]);
});
