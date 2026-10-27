import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {runInNewContext} from 'node:vm';
import {readFile} from 'node:fs/promises';

const editorExternals=['obsidian','@codemirror/state','@codemirror/view','@codemirror/language','@codemirror/commands','@codemirror/autocomplete','@lezer/common','@lezer/lr','@lezer/highlight'];
const bundled=build({entryPoints:['codebase-native.ts'],bundle:true,write:false,platform:'browser',format:'cjs',external:editorExternals});
const scope={environmentId:'env',projectId:'project',root:'/outside',title:'Project'};

test('the isolated native opening lab compiles with the production bridge',async()=>{
  const source=await readFile('validation/codebase-lab.ts','utf8');
  const result=await build({stdin:{contents:source,resolveDir:process.cwd()+'/validation',loader:'ts'},bundle:true,write:false,platform:'browser',format:'cjs',external:['obsidian','node:*','@electron/remote',...editorExternals]});
  assert.ok(result.outputFiles[0].text.includes('runFileOpeningLab'));
});
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(error:Error)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
async function until(check:()=>boolean){for(let i=0;i<100&&!check();i++)await new Promise(resolve=>setImmediate(resolve));assert.ok(check(),'The expected opening stage was not reached');}
async function fixture(){
  class Base{}class File{constructor(public vault:any,public path:string){}}
  class View{file:any;value='';editor={getValue:()=>this.value};getViewData(){return this.value;}setViewData(value:string){this.value=value;}}
  class Notice{
    classes=new Set<string>();attributes:Record<string,string>={};hidden=0;
    messageEl={classList:{add:(value:string)=>this.classes.add(value)},setAttribute:(name:string,value:string)=>{this.attributes[name]=value;}};
    constructor(readonly text:string,readonly duration?:number){notices.push(this);}
    hide(){this.hidden++;}
  }
  const notices:Notice[]=[],nativeLinks:string[]=[],local=new Map<string,unknown>();let click:any;
  const io:any={catalog:async()=>[scope],read:async()=> 'Project text',resource:async()=>({url:'https://signed.example/file',expiresAt:Date.now()+300000})};
  const leaf:any={view:new View(),detach(){},setViewState:async(state:any)=>{leaf.view.file=app.vault.getFileByPath(state.state.file);leaf.view.value=await app.vault.read(leaf.view.file);}};
  const app:any={loadLocalStorage:(key:string)=>local.get(key),saveLocalStorage:(key:string,value:unknown)=>local.set(key,value),
    vault:{configDir:'.obsidian',adapter:{read:async()=>{throw Error('missing');}},getFileByPath:()=>null,getAbstractFileByPath:()=>null,read:async()=>'',cachedRead:async()=>''},
    metadataCache:{getFirstLinkpathDest:()=>null,getCache:()=>null},
    workspace:{openLinkText:async(link:string)=>{nativeLinks.push(link);},getLeaf:()=>leaf,getLeavesOfType:()=>[],iterateAllLeaves:(run:any)=>run({view:{file:{path:'Reference.md'},containerEl:{contains:()=>true}}}),on:()=>({}),onLayoutReady(){}}};
  const plugin={registerView(){},registerInterval(){},registerEditorSuggest(){},registerEvent(){},addCommand(){},registerDomEvent:(_target:any,event:string,handler:any)=>{if(event==='click')click=handler;}};
  const module={exports:{} as any};runInNewContext((await bundled).outputFiles[0].text,{module,exports:module.exports,require:()=>({EditorSuggest:Base,ItemView:Base,MarkdownView:View,TFile:File,TFolder:File,FuzzySuggestModal:Base,Notice}),window:{setInterval:()=>0},document:{addEventListener(){},createElement:()=>({innerHTML:'',get textContent(){return this.innerHTML;}})},TextEncoder,URL,setTimeout,clearTimeout,performance});
  const bridge=new module.exports.CodebaseBridge(app,plugin,io,()=>[],'opening',{environments:()=>['env'],load:()=>undefined,save:async()=>{}});await bridge.install();
  return {bridge,app,io,leaf,notices,nativeLinks,get click(){return click;},progress:()=>notices.filter(notice=>notice.classes.has('send-to-t3-file-opening'))};
}

test('a clicked project link shows progress before discovery and keeps it until the native view opens',async()=>{
  const f=await fixture(),catalog=deferred<any>(),read=deferred<string>(),display=deferred<void>();let reading=false,displaying=false;
  f.io.catalog=()=>catalog.promise;f.io.read=()=>{reading=true;return read.promise;};
  f.leaf.setViewState=async()=>{displaying=true;await display.promise;};
  try{
    const opening=f.app.workspace.openLinkText('/outside/report.md:3#Heading','Reference.md',false);
    assert.equal(f.progress().length,1);const notice=f.progress()[0];assert.equal(notice.text,'Opening report.md…');assert.equal(notice.duration,0);assert.equal(notice.attributes.role,'status');assert.equal(notice.attributes['aria-live'],'polite');assert.equal(notice.hidden,0);
    catalog.resolve([scope]);await until(()=>reading);assert.equal(notice.hidden,0);
    read.resolve('Project text');await until(()=>displaying);assert.equal(notice.hidden,0);
    display.resolve();await opening;assert.equal(notice.hidden,1);
  }finally{f.bridge.dispose();}
});

test('failed discovery and failed reads clear progress while retaining the error notice',async()=>{
  for(const stage of ['catalog','read']){
    const f=await fixture();try{
      f.io[stage]=async()=>{throw Error('Connection failed');};
      await f.app.workspace.openLinkText('/outside/report.md','Reference.md',false);
      assert.equal(f.progress().length,1);assert.equal(f.progress()[0].hidden,1);
      assert.ok(f.notices.some(notice=>!notice.classes.has('send-to-t3-file-opening')&&/unavailable/.test(notice.text)&&!notice.hidden));
    }finally{f.bridge.dispose();}
  }
});

test('a media link keeps progress through preview authorization and native viewer opening',async()=>{
  const f=await fixture(),resource=deferred<any>(),display=deferred<void>();let preparing=false,displaying=false;
  f.io.resource=()=>{preparing=true;return resource.promise;};f.leaf.openFile=async()=>{displaying=true;await display.promise;};
  try{
    const opening=f.app.workspace.openLinkText('/outside/chart.png','Reference.md',false);await until(()=>preparing);assert.equal(f.progress()[0].hidden,0);
    resource.resolve({url:'https://signed.example/chart',expiresAt:Date.now()+300000});await until(()=>displaying);assert.equal(f.progress()[0].hidden,0);
    display.resolve();await opening;assert.equal(f.progress()[0].hidden,1);
  }finally{f.bridge.dispose();}
});

test('native vault links and web links do not show project loading progress',async()=>{
  const f=await fixture();try{
    for(const link of ['Vault Note','Folder/Note.md','https://example.com/report.md'])await f.app.workspace.openLinkText(link,'Reference.md',false);
    assert.equal(f.progress().length,0);assert.deepEqual(f.nativeLinks,['Vault Note','Folder/Note.md','https://example.com/report.md']);
  }finally{f.bridge.dispose();}
});

test('file URL clicks share one notice with nested native project routing',async()=>{
  const f=await fixture(),read=deferred<string>();let reading=false;
  f.io.read=()=>{reading=true;return read.promise;};
  try{
    const anchor={classList:{contains:()=>false},getAttribute:(name:string)=>name==='href'?'file:///outside/report.md':null};
    f.click({target:{closest:()=>anchor},preventDefault(){},stopImmediatePropagation(){}});
    await until(()=>reading);assert.equal(f.progress().length,1);assert.equal(f.progress()[0].hidden,0);
    read.resolve('Project text');await until(()=>f.progress()[0].hidden===1);assert.equal(f.progress().length,1);
  }finally{f.bridge.dispose();}
});

test('overlapping opens keep separate file notices and unload clears all pending notices once',async()=>{
  const f=await fixture(),read=deferred<string>();let reads=0;
  f.io.read=()=>{reads++;return read.promise;};
  const first=f.app.workspace.openLinkText('/outside/a.md','Reference.md',false),same=f.app.workspace.openLinkText('/outside/a.md','Reference.md',false),other=f.app.workspace.openLinkText('/outside/b.md','Reference.md',false);
  await until(()=>reads===2);assert.equal(f.progress().length,2);assert.ok(f.progress().every(notice=>!notice.hidden));
  f.bridge.dispose();assert.ok(f.progress().every(notice=>notice.hidden===1));
  read.resolve('Project text');await Promise.all([first,same,other]);assert.ok(f.progress().every(notice=>notice.hidden===1));
});

test('canceling an ambiguous file choice clears its loading notice',async()=>{
  const f=await fixture();try{
    f.bridge.pathRoute=()=>({owned:true,items:[{},{}]});const choice=deferred<any>();f.bridge.choose=()=>choice.promise;
    const opening=f.app.workspace.openLinkText('/outside/report.md','Reference.md',false);assert.equal(f.progress().length,1);assert.equal(f.progress()[0].hidden,0);
    choice.resolve(undefined);await opening;assert.equal(f.progress()[0].hidden,1);
  }finally{f.bridge.dispose();}
});
