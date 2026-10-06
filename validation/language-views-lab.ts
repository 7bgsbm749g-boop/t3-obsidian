import {Plugin,MarkdownView} from 'obsidian';
import {NativeLanguageViews} from '../language-views';
import {CODE_VIEW_TYPES,MAX_CODE_PARSE_LENGTH} from '../code-language';

import {language,syntaxTree,ensureSyntaxTree} from '@codemirror/language';
import {undo,redo} from '@codemirror/commands';
const fs=require('node:fs'),path=require('node:path');
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
export default class LanguageViewsLab extends Plugin {
  private languages!:NativeLanguageViews;
  private grammarLoads=0;
  private root(){return path.dirname((this.app.vault.adapter as any).getFullPath(''));}
  private evidence(name:string,data:unknown){fs.writeFileSync(path.join(this.root(),name),JSON.stringify(data,null,2)+'\n');}
  async onload(){
    if(!fs.existsSync(path.join(this.root(),'ISOLATED-NATIVE-LAB')))throw Error('An isolated synthetic lab is required.');
    this.languages=new NativeLanguageViews(this.app,this);const cache:any=this.languages.grammars,load=cache.load.bind(cache);cache.load=(grammar:any)=>{this.grammarLoads++;return load(grammar);};this.languages.install();this.register(()=>this.languages.dispose());
    this.app.workspace.onLayoutReady(()=>void this.run().catch(error=>{this.evidence('error.json',{message:error.message,stack:error.stack});console.error(error);}));
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
      'crlf.ts':'const a: number = 1;\r\nconst b = 2;',
    };
    for(const [name,text] of Object.entries(fixtures))if(!this.app.vault.getFileByPath(name))await this.app.vault.create(name,text);
    const ordinary=this.app.workspace.getLeaf(false);await ordinary.openFile(this.app.vault.getFileByPath('Baseline.md')!);await pause(150);
    const md=ordinary.view as MarkdownView,mdcm:any=(md.editor as any).cm,workspace:any=this.app.workspace;
    const before={extensions:workspace.editorExtensions.length,language:mdcm.state.facet(language),local:(md as any).editMode.getLocalExtensions()};
    const bench=()=>{const values:number[]=[];for(let index=0;index<240;index++){const position=mdcm.state.doc.length,start=performance.now();mdcm.dispatch({changes:{from:position,insert:'x'}});mdcm.dispatch({changes:{from:position,to:position+1,insert:''}});values.push(performance.now()-start);}values.sort((a,b)=>a-b);return {pairs:240,medianMs:values[120],p95Ms:values[227],maxMs:values.at(-1)};};
    const baselineTiming=bench();if(this.grammarLoads!==0)throw Error('A grammar initialized before code opened');
    let codeLeaf=this.app.workspace.getLeaf('tab');
    const open=async(name:string,type:string)=>{const started=performance.now();await codeLeaf.setViewState({type,state:{file:name,mode:'source',source:false},active:true});await pause(100);const view=codeLeaf.view as MarkdownView,native:any=view,cm:any=(view.editor as any).cm;ensureSyntaxTree(cm.state,Math.min(cm.state.doc.length,10000),100);if(view.getViewType()!==type||!native.editMode.sourceMode)throw Error('Named code view or forced local source mode was lost');return {view,native,cm,milliseconds:performance.now()-started};};
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
    const large=await open('large.ts','typescript');if(large.cm.state.facet(language).name!=='plaintext'||syntaxTree(large.cm.state).children.length)throw Error('Large file syntax grammar remained enabled');
    const crlf=await open('crlf.ts','typescript');if(crlf.view.editor.getValue()!==fixtures['crlf.ts'])throw Error('Native code loading removed carriage returns');await crlf.view.save();if(fs.readFileSync(path.join(this.root(),'vault/crlf.ts'),'utf8')!==fixtures['crlf.ts'])throw Error('Native code save changed CRLF bytes');
    const state=codeLeaf.getViewState();await crlf.view.save();codeLeaf.detach();codeLeaf=this.app.workspace.getLeaf('tab');await codeLeaf.setViewState(state);await pause(150);if(codeLeaf.view.getViewType()!=='typescript'||(codeLeaf.view as MarkdownView).editor.getValue()!==fixtures['crlf.ts'])throw Error('Saved named workspace state did not restore');
    const hiddenLarge=this.app.workspace.getLeaf('tab');await hiddenLarge.setViewState({type:'typescript',state:{file:'large.ts',mode:'source'},active:true});await pause(100);
    let codeUpdates=0;for(const type of CODE_VIEW_TYPES)for(const leaf of this.app.workspace.getLeavesOfType(type)){const view:any=leaf.view,check=view.codeTransaction.bind(view);view.codeTransaction=(transaction:any)=>{codeUpdates++;return check(transaction);};}
    await ordinary.openFile(this.app.vault.getFileByPath('Baseline.md')!);this.app.workspace.setActiveLeaf(ordinary);await pause(100);const grammarStart=this.grammarLoads,updateStart=codeUpdates,timings=[bench(),bench(),bench()];
    if(ordinary.view!==md||mdcm.state.facet(language)!==before.language||(md as any).editMode.getLocalExtensions()!==before.local||workspace.editorExtensions.length!==before.extensions||this.grammarLoads!==grammarStart||codeUpdates!==updateStart)throw Error('Ordinary Markdown language isolation failed');
    this.evidence('language-markdown-isolation.json',{pairs:720,sameLanguageFacet:true,sameLocalExtensions:true,globalExtensionsBefore:before.extensions,globalExtensionsAfter:workspace.editorExtensions.length,codeUpdatesDuringMarkdown:codeUpdates-updateStart,grammarLoadsDuringMarkdown:this.grammarLoads-grammarStart,baselineTiming,after:timings});
    this.evidence('language-native-behavior.json',{languages,nativeTypeScript:true,sameTypeReuse:true,undoRedo:true,optionUpdates:true,rawReading:true,noFinalNewline:true,noFrontmatter:true,noListContinuation:true,rawUrlPaste:true,plainCopy:true,imagePastePreservesSelection:true,largeFilePlaintext:true,crlfPreserved:true,workspaceStateRestored:true,grammarLoads:this.grammarLoads,firstCodeOpenMs:coldOpenMs});
    const shown=await open('sample.tsx','typescript');try{const image=await require('@electron/remote').getCurrentWebContents().capturePage();fs.writeFileSync(path.join(this.root(),'language-native.png'),image.toPNG());}catch{}
    this.evidence('complete.json',{complete:true,version:require('obsidian').apiVersion,view:shown.view.getViewType(),scope:'Synthetic real native desktop editors. No Sync, no remote T3 delivery, no mobile.'});
  }
}
