import {Plugin,MarkdownView} from 'obsidian';
import {NativeLanguageViews} from '../language-views';
import {CODE_VIEW_TYPES,MAX_CODE_PARSE_LENGTH,codeLanguage} from '../code-language';

import {language,syntaxTree,ensureSyntaxTree} from '@codemirror/language';
import {undo,redo} from '@codemirror/commands';
import {highlightTree,classHighlighter} from '@lezer/highlight';
import {languageFixtures} from '../tests/fixtures/languages';
const fs=require('node:fs'),path=require('node:path');
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
export default class LanguageViewsLab extends Plugin {
  private languages!:NativeLanguageViews;
  private grammarLoads=0;
  private ownedPaths=['Reference.md','Virtual.md'];
  private root(){return path.dirname((this.app.vault.adapter as any).getFullPath(''));}
  private evidence(name:string,data:unknown){fs.writeFileSync(path.join(this.root(),name),JSON.stringify(data,null,2)+'\n');}
  async onload(){
    if(!fs.existsSync(path.join(this.root(),'ISOLATED-NATIVE-LAB')))throw Error('An isolated synthetic lab is required.');
    this.languages=new NativeLanguageViews(this.app,this);const cache:any=this.languages.grammars,load=cache.load.bind(cache);cache.load=(grammar:any)=>{this.grammarLoads++;return load(grammar);};this.languages.install();this.register(()=>this.languages.dispose());
    this.app.workspace.onLayoutReady(()=>void this.start().catch(async error=>{this.evidence('error.json',{message:error.message,stack:error.stack});console.error(error);try{await this.cleanup();}catch(cleanup){this.evidence('cleanup-error.json',{error:String(cleanup)});}}));
  }
  private async capture(name:string){const image=await require('@electron/remote').getCurrentWebContents().capturePage();fs.writeFileSync(path.join(this.root(),name),image.toPNG());}
  private async waitFor(check:()=>boolean,label:string){for(let attempt=0;attempt<200;attempt++){if(check())return;await pause(50);}throw Error(label);}
  private async cleanup(){
    // The builder creates a unique unsynced vault. Never use this in a real vault.
    if(!fs.existsSync(path.join(this.root(),'ISOLATED-NATIVE-LAB')))throw Error('Cleanup requires the isolated lab marker');
    this.ownedPaths=[...new Set([...this.ownedPaths,...this.app.vault.getFiles().map(file=>file.path)])];
    for(const type of [...CODE_VIEW_TYPES,'markdown'])for(const leaf of this.app.workspace.getLeavesOfType(type))leaf.detach();
    for(const name of this.ownedPaths){const file=this.app.vault.getFileByPath(name);if(file)await this.app.vault.delete(file);}
    const remaining=this.ownedPaths.filter(name=>this.app.vault.getFileByPath(name)||fs.existsSync(path.join(this.root(),'vault',name)));
    this.evidence('cleanup.json',{ownedPaths:this.ownedPaths,remaining,temporaryThreads:[],pass:remaining.length===0});
    if(remaining.length)throw Error('Lab cleanup left '+remaining.join(', '));
  }
  private async start(){
    if(fs.existsSync(path.join(this.root(),'complete.json')))return;
    const journal=path.join(this.root(),'reload.json');
    if(!fs.existsSync(journal))return this.run();
    const expected=JSON.parse(fs.readFileSync(journal,'utf8'));this.ownedPaths=expected.ownedPaths;
    const leaf=this.app.workspace.getLeavesOfType(expected.type).find(leaf=>(leaf.view as MarkdownView).file?.path===expected.file);
    if(!leaf)throw Error('Native reload did not restore the language workspace state');
    const view=leaf.view as MarkdownView;
    await this.waitFor(()=>view.getMode()==='preview'&&!!view.contentEl.querySelector('pre code .token'),'Native reload did not restore highlighted Reading');
    if(view.getViewData()!==expected.raw||fs.readFileSync(path.join(this.root(),'vault',expected.file),'utf8')!==expected.raw)throw Error('Native reload changed raw code');
    await (view as any).onSwitchView(new MouseEvent('click'));await pause(100);
    if(view.editor.getValue()!==expected.raw)throw Error('Source after native reload changed raw code');
    await this.capture('language-after-reload.png');this.evidence('native-reload.json',{command:'app:reload',restoredType:expected.type,readingHighlighted:true,exactRawBytes:true,sourceReturn:true});
    await this.cleanup();this.evidence('complete.json',{complete:true,version:require('obsidian').apiVersion,formats:26,grammars:languageFixtures.length,nativeReload:true,cleanup:true,scope:'Synthetic real native desktop editors. No Sync, no remote T3 delivery, no mobile.'});
  }
  async run(){
    await pause(500);
    const fixtures:Record<string,string>={
      'Baseline.md':'# Ordinary Markdown\n\n**Native formatting** and [[Reference]].\n\n- List\n',
      'sample.ts':'interface Person { name: string; count: number }\nconst person: Person = { name: "Ada", count: 3 };\n',
      'other.ts':'const other: number = 42;\n',
      'sample.tsx':'const element = <div data-value={1} />;\n',
      'sample.js':'const value = 1;\n',
      'sample.jsx':'const element = <div />;\n',
      'sample.json':'{"name":"Ada","count":3}\n',
      'sample.css':'.box { color: red; width: 12px; }\n',
      'sample.py':'def greet(name: str):\n    return "Hello " + name\n',
      'sample.log':'---\n* raw text\n',
      'large.ts':'const large = "'+'x'.repeat(MAX_CODE_PARSE_LENGTH)+'";\n',
      'crlf.ts':'function example() {\r\n    const spaces: number = 1;\r\n\tconst tabs = 2;\n}',
    };
    for(const fixture of languageFixtures)fixtures['language-'+fixture.grammar+'.'+fixture.extension]=fixture.raw;
    this.ownedPaths.push(...Object.keys(fixtures));
    for(const [name,text] of Object.entries(fixtures))if(!this.app.vault.getFileByPath(name))await this.app.vault.create(name,text);
    const ordinary=this.app.workspace.getLeaf(false);await ordinary.setViewState({type:'markdown',state:{file:'Baseline.md',mode:'source',source:false},active:true});await ordinary.loadIfDeferred();
    await this.waitFor(()=>!!((ordinary.view as MarkdownView).editor as any)?.cm,'Baseline Markdown source editor did not initialize');
    const md=ordinary.view as MarkdownView,mdcm:any=(md.editor as any).cm,workspace:any=this.app.workspace;
    const before={extensions:workspace.editorExtensions.length,language:mdcm.state.facet(language),local:(md as any).editMode.getLocalExtensions()};
    const bench=()=>{const values:number[]=[];for(let index=0;index<240;index++){const position=mdcm.state.doc.length,start=performance.now();mdcm.dispatch({changes:{from:position,insert:'x'}});mdcm.dispatch({changes:{from:position,to:position+1,insert:''}});values.push(performance.now()-start);}values.sort((a,b)=>a-b);return {pairs:240,medianMs:values[120],p95Ms:values[227],maxMs:values.at(-1)};};
    const baselineTiming=bench();if(this.grammarLoads!==0)throw Error('A grammar initialized before code opened');
    let codeLeaf=this.app.workspace.getLeaf('tab');
    const open=async(name:string,type:string)=>{
      const started=performance.now();await codeLeaf.setViewState({type,state:{file:name,mode:'source',source:false},active:true});await codeLeaf.loadIfDeferred();
      await this.waitFor(()=>!!((codeLeaf.view as MarkdownView).editor as any)?.cm,'Code source editor did not initialize for '+name);
      const view=codeLeaf.view as MarkdownView,native:any=view,cm:any=(view.editor as any).cm,grammar=codeLanguage(name.split('.').at(-1)!)?.grammar;
      if(grammar&&cm.state.doc.length<=MAX_CODE_PARSE_LENGTH){const support=await this.languages.grammars.get(grammar);await this.waitFor(()=>cm.state.facet(language)===support.language,'Native grammar did not finish loading for '+name);}
      ensureSyntaxTree(cm.state,Math.min(cm.state.doc.length,10000),5000);
      if(view.getViewType()!==type||!native.editMode.sourceMode)throw Error('Named code view or forced local source mode was lost');
      return {view,native,cm,milliseconds:performance.now()-started};
    };
    let first=await open('sample.ts','typescript');const coldOpenMs=first.milliseconds;if(!syntaxTree(first.cm.state).toString().includes('TypeAnnotation'))throw Error('Actual TypeScript parser absent');
    const initialView=first.view;await open('other.ts','typescript');if(codeLeaf.view!==initialView)throw Error('Native same-type file reuse failed');first=await open('sample.ts','typescript');
    first.native.editMode.updateOptions();if(first.cm.state.facet(language).name!=='typescript')throw Error('Option updates lost code grammar');
    first.cm.dispatch({changes:{from:first.cm.state.doc.length,insert:'const transient = 4;\n'},userEvent:'input'});if(!undo(first.cm)||first.view.editor.getValue().includes('transient')||!redo(first.cm))throw Error('Native code undo/redo failed');undo(first.cm);
    const raw='const raw = "``````";';first.view.editor.setValue(raw);await first.view.save();await first.native.onSwitchView(new MouseEvent('click'));await pause(350);
    if(first.view.getViewType()!=='typescript'||first.view.getMode()!=='preview'||first.view.getViewData()!==raw||first.native.data!==raw||first.native.lastSavedData!==raw||fs.readFileSync(path.join(this.root(),'vault/sample.ts'),'utf8')!==raw)throw Error('Reading changed raw saved code');
    if((first.view.previewMode as any).getFoldInfo().lines!==1)throw Error('Reading fence leaked into fold metadata');await first.native.onSwitchView(new MouseEvent('click'));await pause(100);if(first.view.editor.getValue()!==raw)throw Error('Source return lost raw code');
    first.view.editor.setValue('');for(const character of ['-','-','-']){const position=first.cm.state.doc.length;let handled=false;for(const handler of first.cm.state.facet(require('@codemirror/view').EditorView.inputHandler)){if(handler(first.cm,position,position,character,()=>({changes:{from:position,insert:character}}))){handled=true;break;}}if(!handled)first.cm.dispatch({changes:{from:position,insert:character},userEvent:'input.type'});}if(first.view.editor.getValue()!=='---'||first.native.canShowProperties())throw Error('Code inserted Markdown frontmatter');
    first.view.editor.setValue('* item');first.cm.dispatch({selection:{anchor:first.cm.state.doc.length}});first.cm.contentDOM.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true}));if(first.view.editor.getValue()!=='* item\n')throw Error('Code Enter continued a list');
    first.view.editor.setValue('selected');first.cm.dispatch({selection:{anchor:0,head:8}});const transfer=new DataTransfer();transfer.setData('text/plain','https://example.invalid/raw?q=1');transfer.setData('text/html','<b>Wrong</b>');first.cm.contentDOM.dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}));if(first.view.editor.getValue()!=='https://example.invalid/raw?q=1')throw Error('Code paste converted a URL');
    first.cm.dispatch({selection:{anchor:0,head:first.cm.state.doc.length}});const copied=new DataTransfer();first.cm.contentDOM.dispatchEvent(new ClipboardEvent('copy',{clipboardData:copied,bubbles:true,cancelable:true}));if(copied.getData('text/plain')!==first.view.editor.getValue()||copied.getData('text/html')||copied.getData('text/markdown'))throw Error('Copy emitted Markdown');
    const beforeImage=first.view.editor.getValue(),inventory=this.app.vault.getAllLoadedFiles().map(file=>file.path).sort();const image=new DataTransfer();image.items.add(new File(['synthetic'],'sample.png',{type:'image/png'}));first.cm.contentDOM.dispatchEvent(new ClipboardEvent('paste',{clipboardData:image,bubbles:true,cancelable:true}));await pause(100);if(first.view.editor.getValue()!==beforeImage||JSON.stringify(this.app.vault.getAllLoadedFiles().map(file=>file.path).sort())!==JSON.stringify(inventory))throw Error('Non-text paste erased code or imported an attachment');await first.view.save();
    const languages:any[]=[];for(const [name,type,tree] of [['sample.tsx','typescript','JSXElement'],['sample.js','javascript','VariableDeclaration'],['sample.jsx','javascript','JSXElement'],['sample.json','json','JsonText'],['sample.css','css','StyleSheet'],['sample.py','python','Script'],['sample.log','plaintext','PlainText']]){const result=await open(name,type);const syntax=syntaxTree(result.cm.state).toString();if(!syntax.includes(tree))throw Error(`Wrong parser for ${name}: ${syntax}`);languages.push({name,type,language:result.cm.state.facet(language).name,tree:syntax});}
    const matrix:any[]=[];
    for(const fixture of languageFixtures){
      const file='language-'+fixture.grammar+'.'+fixture.extension,result=await open(file,fixture.type),tree=ensureSyntaxTree(result.cm.state,result.cm.state.doc.length,5000);
      if(!tree)throw Error('Incomplete native grammar for '+fixture.name);
      const classes=new Set<string>();highlightTree(tree,classHighlighter,(_from,_to,value)=>value.split(' ').forEach(kind=>classes.add(kind)));
      const sourceColored=[...result.cm.contentDOM.querySelectorAll('span')].some((span:any)=>getComputedStyle(span).color!==getComputedStyle(result.cm.contentDOM).color);
      this.evidence('language-'+fixture.grammar+'-source.json',{classes:[...classes],tree:tree.toString(),grammar:result.cm.state.facet(language).name,raw:result.view.editor.getValue(),html:result.cm.contentDOM.innerHTML,sourceColored});
      // Obsidian's stream modes can use native legacy token classes rather
      // than Lezer highlight tags. Check the actual visible editor below;
      // the shared parser tests check each bundled grammar's token kinds.
      if(!sourceColored)throw Error(fixture.name+' has no visible Source syntax colors');
      if(result.view.editor.getValue()!==fixture.raw)throw Error(fixture.name+' normalized initial bytes');
      await this.capture('language-'+fixture.grammar+'-source.png');
      const raw=fixture.raw+'\n    \t';result.cm.dispatch({changes:{from:result.cm.state.doc.length,insert:'\n    \t'},userEvent:'input.type'});await result.view.save();
      if(fs.readFileSync(path.join(this.root(),'vault',file),'utf8')!==raw)throw Error(fixture.name+' native edit/save changed bytes');
      await result.native.onSwitchView(new MouseEvent('click'));
      await this.waitFor(()=>!!result.view.contentEl.querySelector('pre code .token'),fixture.name+' has no Reading syntax tokens');
      const readingCode=result.view.contentEl.querySelector('pre code')!,readingTokens=Array.from(readingCode.querySelectorAll('.token'));
      const readingColored=readingTokens.some(token=>getComputedStyle(token).color!==getComputedStyle(readingCode).color);
      if(!readingColored||result.view.getViewData()!==raw||result.native.previewMode.get()!==raw)throw Error(fixture.name+' Reading colors or raw bytes failed');
      await this.capture('language-'+fixture.grammar+'-reading.png');
      await result.native.onSwitchView(new MouseEvent('click'));await pause(50);await result.view.save();
      if(result.view.editor.getValue()!==raw||fs.readFileSync(path.join(this.root(),'vault',file),'utf8')!==raw)throw Error(fixture.name+' Reading round trip changed bytes');
      matrix.push({name:fixture.name,type:fixture.type,grammar:fixture.grammar,file,classes:[...classes],sourceColored,readingColored,readingTokens:readingTokens.length,exactEditSave:true,exactReadingSource:true,sha256:require('node:crypto').createHash('sha256').update(raw).digest('hex')});
      this.evidence('language-matrix.json',{formats:26,grammars:languageFixtures.length,results:matrix});
    }
    const large=await open('large.ts','typescript');if(large.cm.state.facet(language).name!=='plaintext'||syntaxTree(large.cm.state).children.length)throw Error('Large file syntax grammar remained enabled');
    const crlf=await open('crlf.ts','typescript');if(crlf.view.editor.getValue()!==fixtures['crlf.ts'])throw Error('Native code loading removed carriage returns');await crlf.view.save();if(fs.readFileSync(path.join(this.root(),'vault/crlf.ts'),'utf8')!==fixtures['crlf.ts'])throw Error('Native code save changed CRLF bytes');
    const sourceFont=getComputedStyle(crlf.cm.contentDOM).fontFamily,sourceTab=crlf.cm.state.tabSize;
    await crlf.native.onSwitchView(new MouseEvent('click'));await pause(350);
    const readingCode=crlf.view.contentEl.querySelector('pre code');if(!readingCode)throw Error('Native Reading code missing');
    const readingStyle=getComputedStyle(readingCode),readingFont=readingStyle.fontFamily,readingTab=Number(readingStyle.tabSize);
    if(sourceFont!==readingFont||sourceTab!==readingTab||sourceTab!==4)throw Error('Source/Reading indentation display differs');
    await crlf.native.onSwitchView(new MouseEvent('click'));await pause(100);
    if(crlf.view.editor.getValue()!==fixtures['crlf.ts'])throw Error('Reading/Source return changed CRLF or raw indentation');
    crlf.native.editMode.set(fixtures['crlf.ts'].replace('= 1','= 12'));
    if(crlf.view.editor.getValue()!==fixtures['crlf.ts'].replace('= 1','= 12'))throw Error('Incremental native set normalized whitespace');
    crlf.native.editMode.set(fixtures['crlf.ts']);await crlf.view.save();
    if(fs.readFileSync(path.join(this.root(),'vault/crlf.ts'),'utf8')!==fixtures['crlf.ts'])throw Error('Post-cycle native save changed exact whitespace');
    this.evidence('language-whitespace.json',{raw:fixtures['crlf.ts'],sourceFont,readingFont,sourceTab,readingTab,exactIncrementalSet:true,readingSourceRoundTrip:true,mixedLineEndings:true,existingSpacesAndTabs:true});
    const state=codeLeaf.getViewState();await crlf.view.save();codeLeaf.detach();codeLeaf=this.app.workspace.getLeaf('tab');await codeLeaf.setViewState(state);await pause(150);if(codeLeaf.view.getViewType()!=='typescript'||(codeLeaf.view as MarkdownView).editor.getValue()!==fixtures['crlf.ts'])throw Error('Saved named workspace state did not restore');
    const hiddenLarge=this.app.workspace.getLeaf('tab');await hiddenLarge.setViewState({type:'typescript',state:{file:'large.ts',mode:'source'},active:true});await pause(100);
    let codeUpdates=0;for(const type of CODE_VIEW_TYPES)for(const leaf of this.app.workspace.getLeavesOfType(type)){const view:any=leaf.view,check=view.codeTransaction.bind(view);view.codeTransaction=(transaction:any)=>{codeUpdates++;return check(transaction);};}
    await ordinary.openFile(this.app.vault.getFileByPath('Baseline.md')!);this.app.workspace.setActiveLeaf(ordinary);await pause(100);const grammarStart=this.grammarLoads,updateStart=codeUpdates,timings=[bench(),bench(),bench()];
    if(ordinary.view!==md||mdcm.state.facet(language)!==before.language||(md as any).editMode.getLocalExtensions()!==before.local||workspace.editorExtensions.length!==before.extensions||this.grammarLoads!==grammarStart||codeUpdates!==updateStart)throw Error('Ordinary Markdown language isolation failed');
    this.evidence('language-markdown-isolation.json',{pairs:720,sameLanguageFacet:true,sameLocalExtensions:true,globalExtensionsBefore:before.extensions,globalExtensionsAfter:workspace.editorExtensions.length,codeUpdatesDuringMarkdown:codeUpdates-updateStart,grammarLoadsDuringMarkdown:this.grammarLoads-grammarStart,baselineTiming,after:timings});
    this.evidence('language-native-behavior.json',{languages,nativeTypeScript:true,sameTypeReuse:true,undoRedo:true,optionUpdates:true,rawReading:true,noFinalNewline:true,noFrontmatter:true,noListContinuation:true,rawUrlPaste:true,plainCopy:true,imagePastePreservesSelection:true,largeFilePlaintext:true,crlfPreserved:true,workspaceStateRestored:true,grammarLoads:this.grammarLoads,firstCodeOpenMs:coldOpenMs});
    const restoredFile='language-rust.rs',shown=await open(restoredFile,'rust');await shown.native.onSwitchView(new MouseEvent('click'));
    await this.waitFor(()=>!!shown.view.contentEl.querySelector('pre code .token'),'Pre-reload Reading highlighting did not finish');
    await shown.view.save();await this.capture('language-native.png');
    this.evidence('reload.json',{type:'rust',file:restoredFile,raw:shown.view.getViewData(),ownedPaths:this.ownedPaths});
    this.app.workspace.requestSaveLayout();await pause(1500);
    if(!(this.app as any).commands.executeCommandById('app:reload'))throw Error('Native Reload app without saving command was unavailable');
  }
}
