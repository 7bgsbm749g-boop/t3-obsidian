import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from './build-fixture';
import {runInNewContext} from './obsidian-context';
import {catalogCodebases,virtualPath} from '../src/projects/codebase-core';
class MockNotice {messageEl={classList:{add(){}},setAttribute(){}};hide(){}}
const scope={environmentId:'env',projectId:'scratch',root:'/machine/scratch',title:'No project'},workspace={...scope,root:'/machine/thread-folder',threadId:'thread'};
const bundled=build({entryPoints:['src/projects/codebase-native.ts'],bundle:true,write:false,platform:'browser',format:'cjs',external:['obsidian','@codemirror/state','@codemirror/view','@codemirror/language','@codemirror/commands','@codemirror/autocomplete','@lezer/common','@lezer/lr','@lezer/highlight']});
async function fixture(){
  class Base{}class File{constructor(public vault:any,public path:string){}}
  let environments=['env'],catalogs=0,resources=0,opened:any,postprocess:any,extension:any,saved:any,remote='remote';const nativeLinks:string[]=[],local=new Map<string,any>(),physical={path:'Assets/chart.png'};
  const app:any={loadLocalStorage:(key:string)=>local.get(key),saveLocalStorage:(key:string,value:any)=>local.set(key,value),vault:{configDir:'.obsidian',adapter:{read:async()=>{throw Error('missing');},getResourcePath:()=> 'capacitor://localhost/_capacitor_file_/private/vault'},getFileByPath:(path:string)=>path===physical.path?physical:null,getAbstractFileByPath:()=>null,read:async()=> 'physical',getFiles:()=>[physical]},metadataCache:{getFirstLinkpathDest:(path:string)=>path===physical.path?physical:null,getCache:()=>null},workspace:{openLinkText:async()=>{},on:()=>({}),onLayoutReady:()=>{},getLeavesOfType:()=>[],getLeaf:()=>({})}};
  const plugin={registerView:()=>{},registerInterval:()=>{},registerEditorSuggest:()=>{},registerEditorExtension:(value:any)=>{extension=value;},registerEvent:()=>{},addCommand:()=>{},registerMarkdownPostProcessor:(handler:any)=>{postprocess=handler;}};
  app.workspace.openLinkText=async(link:string)=>{nativeLinks.push(link);};
  const io:any={catalog:async(environmentId:string)=>{catalogs++;return [scope,workspace].map(value=>({...value,environmentId}));},resource:async()=>{resources++;return {url:'https://signed.example/api/assets/chart',expiresAt:Date.now()+300000};},read:async()=>remote,write:async(_scope:any,_path:string,text:string)=>{remote=text;}};
  const module={exports:{} as any};runInNewContext((await bundled).outputFiles[0].text,{module,exports:module.exports,require:()=>({EditorSuggest:Base,ItemView:Base,MarkdownView:Base,FuzzySuggestModal:Base,TFile:File,TFolder:File,Notice:MockNotice,editorLivePreviewField:'live-preview',Keymap:{isModifier:(event:any,key:string)=>{assert.equal(key,'Mod');return !!(event.ctrlKey||event.metaKey);}}}),window:{setInterval:()=>0},document:{createElement:()=>({innerHTML:'',get textContent(){return this.innerHTML;}})},TextEncoder,URL,setTimeout,clearTimeout,performance,queueMicrotask});
  const bridge=new module.exports.CodebaseBridge(app,plugin,io,()=>[],'passthrough',{environments:()=>environments,load:()=>saved,save:async(state:any)=>{saved=JSON.parse(JSON.stringify(state));}});await bridge.install();bridge.open=async(item:any)=>{opened=item;};
  function image(src:string){const attrs:Record<string,string>={src,alt:'chart'};return {attrs,getAttribute:(key:string)=>attrs[key]??null,setAttribute:(key:string,value:string)=>{attrs[key]=value;},closest:()=>null};}
  const render=async(img:any)=>postprocess({querySelectorAll:(selector:string)=>selector==='img'?[img]:[]},{sourcePath:'Unlinked/Note.md'});
  return {bridge,app,io,image,render,physical,nativeLinks,get extension(){return extension;},get opened(){return opened;},get saved(){return saved;},get catalogs(){return catalogs;},get resources(){return resources;},setEnvironments:(value:string[])=>{environments=value;},disconnect:()=>{environments=[];}};
}

test('saved choices retain an offline machine across restart instead of selecting another machine',async()=>{
  const first=await fixture(),restored=await fixture();try{
    await first.app.workspace.openLinkText('/srv/reports/report.md','Unlinked/Note.md',false);await first.bridge.persist();
    restored.setEnvironments(['other']);restored.bridge.adopt(first.saved);
    await restored.app.workspace.openLinkText('/srv/reports/report.md','Unlinked/Note.md',false);
    assert.equal(restored.opened,undefined);assert.deepEqual(restored.nativeLinks,[]);
    restored.setEnvironments(['env','other']);
    await restored.app.workspace.openLinkText('/srv/reports/report.md','Unlinked/Note.md',false);
    assert.equal(restored.opened.scope.environmentId,'env');
  }finally{first.bridge.dispose();restored.bridge.dispose();}
});

test('colliding response paths retain both filesystem and project machines in either arrival order',async()=>{
  for(const order of [['env','other'],['other','env']]){const f=await fixture();try{
    f.setEnvironments(['env','other']);
    const shell=(environmentId:string)=>({projects:environmentId==='other'?[{id:'scratch',workspaceRoot:'/srv/reports'}]:[],threads:[]});
    f.io.catalog=async(environmentId:string)=>catalogCodebases(environmentId,shell(environmentId));
    for(const environmentId of order)await f.bridge.reply({source:'/srv/reports/report.md',label:'Report',image:false},{id:environmentId,notePath:'Unlinked/Note.md',threadEnvironmentId:environmentId,projectId:'scratch',threadId:'thread'},{api:async()=>shell(environmentId)});
    let choices:any[]=[];f.bridge.choose=async(items:any[])=>{choices=items;return undefined;};
    await f.app.workspace.openLinkText('/srv/reports/report.md','Unlinked/Note.md',false);
    assert.deepEqual(Array.from(choices,item=>item.scope.environmentId).sort(),['env','other']);assert.equal(f.opened,undefined);
    assert.equal(choices.find(item=>item.scope.environmentId==='env').scope.filesystem,true);
    assert.equal(choices.find(item=>item.scope.environmentId==='other').scope.projectId,'scratch');
    f.setEnvironments(['other']);choices=[];
    await f.app.workspace.openLinkText('/srv/reports/report.md','Unlinked/Note.md',false);
    assert.equal(f.opened,undefined,'An unavailable colliding source must not silently select the other file');assert.deepEqual(f.nativeLinks,[]);
    await f.bridge.persist();const restored=await fixture();try{
      restored.setEnvironments(['other']);restored.bridge.adopt(f.saved);
      await restored.app.workspace.openLinkText('/srv/reports/report.md','Unlinked/Note.md',false);assert.equal(restored.opened,undefined);
      restored.setEnvironments(['env','other']);let restoredChoices:any[]=[];restored.bridge.choose=async(items:any[])=>{restoredChoices=items;return undefined;};
      await restored.app.workspace.openLinkText('/srv/reports/report.md','Unlinked/Note.md',false);
      assert.deepEqual(Array.from(restoredChoices,item=>item.scope.environmentId).sort(),['env','other']);assert.equal(restored.opened,undefined);
    }finally{restored.bridge.dispose();}
  }finally{f.bridge.dispose();}}
});

test('native editing keeps plain clicks while rendered Live Preview links retain click-to-open',async()=>{
  const f=await fixture();let instance:any;try{
    const handlers=new Map<string,(event:any)=>void>();class Observer{observe(){}disconnect(){}}
    let livePreview=true,opens=0;const previousOpen=f.bridge.open;f.bridge.open=async(item:any)=>{opens++;return previousOpen(item);};
    const selection={ranges:[{from:2,to:2}]};
    const line='[report](/srv/reports/report.md) end',span={closest:(selector:string)=>selector==='.cm-link'?span:null};
    const view:any={dom:{ownerDocument:{defaultView:{MutationObserver:Observer}},addEventListener:(name:string,handler:any)=>handlers.set(name,handler),removeEventListener:(name:string)=>handlers.delete(name)},contentDOM:{querySelectorAll:()=>[]},state:{field:(key:any)=>key==='live-preview'?livePreview:({file:{path:'Unlinked/Note.md'}}),selection,doc:{lineAt:()=>({from:0,text:line})}},posAtDOM:()=>1};
    instance=f.extension.create(view);
    for(const type of ['mousedown','click']){
      let prevented=false,stopped=false;handlers.get(type)!({type,button:0,target:span,preventDefault(){prevented=true;},stopImmediatePropagation(){stopped=true;}});
      assert.equal(prevented,false,'A plain click must keep native caret handling');assert.equal(stopped,false,'A plain click must reach the editor');
    }
    assert.equal(f.opened,undefined);
    for(const modifier of ['ctrlKey','metaKey'])for(const type of ['mousedown','click']){
      let prevented=false,stopped=false;handlers.get(type)!({type,button:0,target:span,[modifier]:true,preventDefault(){prevented=true;},stopImmediatePropagation(){stopped=true;}});
      assert.equal(prevented,true);assert.equal(stopped,true);await new Promise(resolve=>setTimeout(resolve,0));
    }
    assert.equal(opens,2);
    selection.ranges[0]={from:line.length,to:line.length};
    for(const type of ['mousedown','click']){let prevented=false;handlers.get(type)!({type,button:0,target:span,preventDefault(){prevented=true;},stopImmediatePropagation(){}});assert.equal(prevented,true);}
    await new Promise(resolve=>setTimeout(resolve,0));assert.equal(opens,3,'A rendered link outside the caret keeps native click-to-open');
    livePreview=false;
    for(const type of ['mousedown','click']){let prevented=false;handlers.get(type)!({type,button:0,target:span,preventDefault(){prevented=true;},stopImmediatePropagation(){}});assert.equal(prevented,false,'Source mode always keeps plain-click editing');}
    assert.equal(f.opened.scope.environmentId,'env');assert.equal(f.opened.scope.filesystem,true);assert.deepEqual(f.nativeLinks,[]);
  }finally{instance?.destroy();f.bridge.dispose();}
});

test('absolute files outside every project open, read and save with no folder link or catalog',async()=>{
  for(const path of ['/srv/reports/report.md','file:///srv/reports/a%20b.md:4#Heading','sandbox:/srv/reports/report.md','C:\\Reports\\report.md','/report.md','C:/report.md']){
    const f=await fixture();try{
      f.io.catalog=async()=>{throw Error('No project catalog');};
      await f.app.workspace.openLinkText(path,'Unlinked/Note.md',false);
      const item=f.opened;assert.ok(item,'The file must open without a project');assert.equal(item.scope.filesystem,true);assert.equal(item.scope.environmentId,'env');assert.equal(item.scope.projectId,'');
      assert.equal(await f.app.vault.read(item.file),'remote');await item.document.save('edited');assert.equal(await f.io.read(item.scope,item.path),'edited');
      assert.deepEqual(f.nativeLinks,[]);assert.deepEqual(f.app.vault.getFiles(),[f.physical]);
      f.disconnect();await assert.rejects(f.app.vault.read(item.file),/disconnected|unavailable/);
    }finally{f.bridge.dispose();}
  }
});

test('outside files use their sending machine and stay unavailable when it disconnects',async()=>{
  const f=await fixture();try{
    f.setEnvironments(['env','other']);
    f.bridge.observeSource({id:'reply',notePath:'Unlinked/Note.md',threadEnvironmentId:'other',projectId:'scratch'});
    await f.app.workspace.openLinkText('/srv/reports/report.md','Unlinked/Note.md',false);
    assert.equal(f.opened.scope.environmentId,'other');
    f.setEnvironments(['env']);const previous=f.opened;
    await f.app.workspace.openLinkText('/srv/reports/fresh.md','Unlinked/Note.md',false);
    assert.equal(f.opened,previous,'A disconnected source cannot fall back to another machine');assert.deepEqual(f.nativeLinks,[]);
  }finally{f.bridge.dispose();}
});

test('another machine project cannot claim an outside response path',async()=>{
  for(const multipleProjects of [false,true]){const f=await fixture();try{
    f.setEnvironments(['env','other']);f.io.catalog=async(environmentId:string)=>environmentId==='other'?[{...scope,environmentId,root:'/srv/reports'}]:[];
    f.bridge.observeSource({id:'reply',notePath:'Unlinked/Note.md',threadEnvironmentId:'env',projectId:'scratch'});
    if(multipleProjects)f.bridge.observeSource({id:'second-reply',notePath:'Unlinked/Note.md',threadEnvironmentId:'env',projectId:'another'});
    await f.app.workspace.openLinkText('/srv/reports/report.md','Unlinked/Note.md',false);
    assert.equal(f.opened.scope.environmentId,'env');assert.equal(f.opened.scope.filesystem,true);assert.deepEqual(f.nativeLinks,[]);
  }finally{f.bridge.dispose();}}
});

test('unscoped paths keep machine ambiguity until a choice is made',async()=>{
  const f=await fixture();try{
    f.setEnvironments(['env','other']);let choices:any[]=[];
    f.bridge.choose=async(items:any[])=>{choices=items;return items[1];};
    await f.app.workspace.openLinkText('/srv/reports/report.md','Unlinked/Note.md',false);
    assert.deepEqual(Array.from(choices,item=>item.scope.environmentId),['env','other']);assert.equal(f.opened.scope.environmentId,'other');
    f.bridge.choose=()=>assert.fail('The saved choice must be reused');
    await f.app.workspace.openLinkText('/srv/reports/report.md','Unlinked/Note.md',false);assert.equal(f.opened.scope.environmentId,'other');
  }finally{f.bridge.dispose();}
});

test('a previous file from another note cannot silently select the machine for an unscoped path',async()=>{
  const f=await fixture();try{
    await f.app.workspace.openLinkText('/srv/reports/first.md','First.md',false);
    f.setEnvironments(['env','other']);let choices:any[]=[];
    f.bridge.choose=async(items:any[])=>{choices=items;return undefined;};
    const previous=f.opened;await f.app.workspace.openLinkText('/srv/reports/second.md','Second.md',false);
    assert.equal(choices.length,2);assert.equal(f.opened,previous);assert.deepEqual(f.nativeLinks,[]);
  }finally{f.bridge.dispose();}
});

test('absolute response references register without a project and preserve the original link',async()=>{
  const f=await fixture();try{
    const reference={source:'/srv/reports/report.md',label:'Report',image:false};
    assert.equal(await f.bridge.reply(reference,{id:'reply',notePath:'Unlinked/Note.md',projectId:'scratch',threadId:'thread',threadEnvironmentId:'env'},{api:async()=>({projects:[],threads:[]})}),undefined);
    assert.equal(reference.source,'/srv/reports/report.md');
    await f.app.workspace.openLinkText('report.md','Unlinked/Note.md',false);assert.equal(f.opened.scope.filesystem,true);assert.equal(f.opened.path,'report.md');
  }finally{f.bridge.dispose();}
});

test('saved machine file identities reopen without catalog access or vault copies',async()=>{
  const first=await fixture(),restored=await fixture();try{
    await first.app.workspace.openLinkText('/srv/reports/report.md','Unlinked/Note.md',false);await first.bridge.persist();
    restored.bridge.adopt(first.saved);restored.io.catalog=()=>assert.fail('A saved file needs no catalog');
    await restored.app.workspace.openLinkText('/srv/reports/report.md','Unlinked/Note.md',false);
    assert.equal(restored.opened.file.path,first.opened.file.path);assert.equal(restored.opened.scope.filesystem,true);
    assert.equal(await restored.app.vault.read(restored.opened.file),'remote');assert.deepEqual(restored.app.vault.getFiles(),[restored.physical]);
    assert.equal(JSON.stringify(first.saved).includes('signed.example'),false);assert.equal(JSON.stringify(first.saved).includes('remote'),false);
  }finally{first.bridge.dispose();restored.bridge.dispose();}
});

test('outside project images use signed resources while malformed paths never create vault notes',async()=>{
  const f=await fixture();try{
    const image=f.image('file:///srv/reports/chart.png');await f.render(image);
    assert.equal(image.attrs.src,'https://signed.example/api/assets/chart');assert.equal(f.resources,1);
    for(const path of ['/srv/reports/../secret.md','/elsewhere/a//b.md','/elsewhere/%00.md'])await f.app.workspace.openLinkText(path,'Unlinked/Note.md',false);
    assert.equal(f.opened,undefined);assert.deepEqual(f.nativeLinks,[]);
  }finally{f.bridge.dispose();}
});

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
