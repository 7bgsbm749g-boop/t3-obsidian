import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {EditorState,Facet} from '@codemirror/state';
import {EditorView} from '@codemirror/view';
import {language,syntaxTree} from '@codemirror/language';
import {javascript} from '@codemirror/lang-javascript';
const runtime=createRequire(process.cwd()+'/package.json');
const external=['obsidian','@codemirror/state','@codemirror/view','@codemirror/language','@codemirror/commands','@codemirror/autocomplete','@lezer/common','@lezer/lr','@lezer/highlight'];
const bundled=build({entryPoints:['language-native.ts'],bundle:true,write:false,platform:'browser',format:'cjs',external});
const registryBundle=build({entryPoints:['language-views.ts'],bundle:true,write:false,platform:'browser',format:'cjs',external});
class GenericEdit {buildLocalExtensions(){return [];}getDynamicExtensions(){return [];}getLocalExtensions(){return this.buildLocalExtensions();}updateOptions(){}}
class MarkdownEdit extends GenericEdit {buildLocalExtensions():never{throw Error('Markdown local layer must not run');}getDynamicExtensions():never{throw Error('Markdown dynamic layer must not run');}}
class BaseView {
  leaf:any;app:any;earlyType:string;cleanups:Array<()=>void>=[];contentEl={createEl:()=>{}};restored:any;file:any;
  constructor(leaf:any){this.leaf=leaf;this.app=leaf.app;this.earlyType=this.getViewType();}
  register(callback:()=>void){this.cleanups.push(callback);}getViewType(){return 'markdown';}
  getState(){return {file:this.file?.path,mode:(this as any).getMode(),source:false};}async setState(state:any){this.restored=state;}
}
class NativeMarkdown extends BaseView {
  mode='source';editMode:any;previewMode:any;editor:any;
  constructor(leaf:any){super(leaf);const edit=this.editMode=new MarkdownEdit() as any;edit.app=this.app;edit.cmInit=true;edit.cm={state:EditorState.create(),dispatch(spec:any){this.state=this.state.update(spec).state;}};this.previewMode={rendered:'',set(text:string){this.rendered=text;},get(){return this.rendered;},clear(){this.rendered='';},readingScroll:1,readingState:{} as any,getScroll(){return this.readingScroll;},applyScroll(scroll:number){this.readingScroll=scroll;},setEphemeralState(state:any){this.readingState=state;},onResize(){}};this.editor={getValue:()=>edit.cm.state.doc.toString(),setValue:(text:string)=>edit.cm.dispatch({changes:{from:0,to:edit.cm.state.doc.length,insert:text}})};}
  async onLoadFile(file:any){this.file=file;this.setViewData(file.text,true);}
  setViewData(text:string,_clear:boolean){this.editMode.cm.state=EditorState.create({doc:text,extensions:this.editMode.getLocalExtensions()});}
  async onUnloadFile(){}getMode(){return this.mode;}showSearch(){}
}
const obsidian:any={MarkdownView:NativeMarkdown,TextFileView:BaseView,ItemView:BaseView,Keymap:{isModEvent:()=>false},Notice:class{},apiVersion:'1.14.4'};
// These guarded facets are Obsidian additions to its shared CodeMirror runtime.
(EditorView as any).clipboardCopyHook=Facet.define();(EditorView as any).clipboardPasteHook=Facet.define();
async function evaluate(bundle:typeof bundled,imports:string[]=[]){const code=(await bundle).outputFiles[0].text,module={exports:{} as any};runInNewContext(code,{module,exports:module.exports,require:(name:string)=>{imports.push(name);return name==='obsidian'?obsidian:runtime(name);},queueMicrotask,console,setTimeout,clearTimeout,TextEncoder,URL});return module.exports;}
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
test('native factory type, late grammar switches, local source mode, raw Reading and close lifecycle',async()=>{
  const native=await evaluate(bundled),app={vault:{getConfig:()=>false},workspace:{requestSaveLayout:()=>{}}};
  const pending:Array<{grammar:string;resolve:(support:any)=>void}>=[],registry={active:()=>true,grammars:{get:(grammar:string)=>new Promise(resolve=>pending.push({grammar,resolve}))}};
  const leaf:any={app,setViewState:async(state:any)=>{leaf.state=state;}},view=native.createNativeLanguageView(leaf,'typescript',registry);leaf.view=view;
  assert.equal(view.earlyType,'typescript');assert.equal(view.getViewType(),'typescript');assert.equal(view.canAcceptExtension('tsx'),true);assert.equal(view.canAcceptExtension('md'),false);await assert.rejects(view.onLoadFile({path:'Note.md',extension:'md',text:'# unchanged'}),/cannot open this file type/);
  const first={path:'first.ts',extension:'ts',text:'interface A { name: string }'},second={path:'second.tsx',extension:'tsx',text:'const element = <div />;'};
  const firstLoad=view.onLoadFile(first);await tick();assert.equal(view.editMode.cm.state.facet(language).name,'plaintext');assert.equal(pending[0].grammar,'typescript');
  const secondLoad=view.onLoadFile(second);await tick();assert.equal(pending[1].grammar,'tsx');pending[0].resolve(javascript({typescript:true}));await firstLoad;assert.equal(view.editMode.cm.state.facet(language).name,'plaintext');
  pending[1].resolve(javascript({typescript:true,jsx:true}));await secondLoad;assert.match(syntaxTree(view.editMode.cm.state).toString(),/JSXElement/);
  await view.setState({source:false},{});assert.equal(view.restored.source,true);
  const raw='const raw = "``````";';view.previewMode.set(raw,true);assert.equal(view.previewMode.get(),raw);assert.ok(view.previewMode.rendered.startsWith('```````tsx\n'));assert.equal(view.previewMode.getFoldInfo().lines,1);
  view.previewMode.applyScroll(8);assert.equal(view.previewMode.readingScroll,9);assert.equal(view.previewMode.getScroll(),8);view.previewMode.setEphemeralState({scroll:4,line:3,match:{content:'raw',matches:[[1,2]]}});assert.equal(view.previewMode.readingState.scroll,5);assert.equal(view.previewMode.readingState.line,4);assert.deepEqual(JSON.parse(JSON.stringify(view.previewMode.readingState.match)),{content:'\nraw',matches:[[2,3]]});
  await view.onSwitchView({preventDefault:()=>{}});assert.equal(leaf.state.type,'typescript');assert.equal(leaf.state.state.source,true);
  const closing=view.onLoadFile(first);await tick();view.cleanups.forEach((callback:()=>void)=>callback());pending[2].resolve(javascript({typescript:true}));await closing;assert.equal(view.editMode.cm.state.facet(language).name,'plaintext');
});
test('large code keeps the syntax grammar off and restores it after shrinking',async()=>{
  const native=await evaluate(bundled),app={vault:{getConfig:()=>false}},leaf:any={app},registry={active:()=>true,grammars:{get:async()=>javascript({typescript:true})}},view=native.createNativeLanguageView(leaf,'typescript',registry);leaf.view=view;
  await view.onLoadFile({path:'large.ts',extension:'ts',text:'x'.repeat(300001)});assert.equal(view.editMode.cm.state.facet(language).name,'plaintext');assert.equal(syntaxTree(view.editMode.cm.state).children.length,0);
  view.editor.setValue('const x: number = 1;');assert.equal(view.editMode.cm.state.facet(language).name,'typescript');assert.match(syntaxTree(view.editMode.cm.state).toString(),/TypeAnnotation/);view.editor.setValue('x'.repeat(300001));assert.equal(view.editMode.cm.state.facet(language).name,'plaintext');
});
test('native code loading and Reading preserve carriage-return bytes',async()=>{
  const native=await evaluate(bundled),app={vault:{getConfig:()=>false}},leaf:any={app},registry={active:()=>true,grammars:{get:async()=>javascript({typescript:true})}},view=native.createNativeLanguageView(leaf,'typescript',registry);leaf.view=view;
  for(const text of ['const a: number = 1;\r\nconst b = 2;', 'const a = 1;\rconst b = 2;']){await view.onLoadFile({path:'raw.ts',extension:'ts',text});assert.equal(view.editor.getValue(),text);view.previewMode.set(text,true);assert.equal(view.previewMode.get(),text);}
});
test('factory registration stays lazy and preserves foreign ownership and unsupported workspace state',async()=>{
  const imports:string[]=[],module=await evaluate(registryBundle,imports),owned=new Map<string,any>([['json',()=>{}]]),app={viewRegistry:{getViewCreatorByType:(type:string)=>owned.get(type)}};
  const plugin={registerView:(type:string,factory:any)=>{assert.equal(owned.has(type),false);owned.set(type,factory);}},before=imports.length,views=new module.NativeLanguageViews(app,plugin);views.install();assert.equal(imports.length,before);assert.equal(imports.some(name=>name.startsWith('@codemirror')),false);
  assert.throws(()=>views.type('json'),/another plugin/);assert.equal(views.type('ts'),'typescript');assert.equal(views.type('md'),undefined);owned.set('typescript',()=>{});assert.throws(()=>views.type('ts'),/another plugin/);
  const original=obsidian.apiVersion;obsidian.apiVersion='1.15.0';try{const unavailable=owned.get('python')({app});assert.equal(unavailable.getViewType(),'python');await unavailable.setState({file:'held.py'});assert.equal(unavailable.getState().file,'held.py');}finally{obsidian.apiVersion=original;}
  views.dispose();assert.equal(views.types().length,0);
});
