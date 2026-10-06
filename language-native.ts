import {MarkdownView,TextFileView,Keymap,Notice,type Menu,type TFile,type WorkspaceLeaf} from 'obsidian';
import {EditorState,Compartment,Prec,type Extension,type Transaction} from '@codemirror/state';
import {EditorView,keymap,lineNumbers} from '@codemirror/view';
import {language,syntaxHighlighting,HighlightStyle,indentOnInput,foldGutter,type LanguageSupport} from '@codemirror/language';
import {insertNewlineAndIndent,indentMore,indentLess} from '@codemirror/commands';
import {tags} from '@lezer/highlight';
import {codeLanguage,codeReadingFence,plainTransfer,MAX_CODE_PARSE_LENGTH,type CodeViewType} from './code-language';
import type {NativeLanguageViews} from './language-views';
import {codePlaintext} from './language-plaintext';

/** Only loaded by a named code factory. No global Markdown method is changed. */
class NativeCodeView extends MarkdownView {
  private compartment=new Compartment();
  private support?:LanguageSupport;
  private rawPreview='';
  private generation=0;
  private closed=false;
  private rawLength=0;
  private codeExtensions:Extension;
  constructor(leaf:WorkspaceLeaf,readonly type:CodeViewType,private registry:NativeLanguageViews){
    super(leaf);
    const edit:any=(this as any).editMode,preview:any=this.previewMode;
    const roots=(name:string)=>{const methods:Function[]=[];for(let prototype=Object.getPrototypeOf(edit);prototype;prototype=Object.getPrototypeOf(prototype))if(Object.prototype.hasOwnProperty.call(prototype,name)&&typeof prototype[name]==='function')methods.push(prototype[name]);return methods;};
    const local=roots('buildLocalExtensions'),dynamic=roots('getDynamicExtensions');
    if(local.length<2||dynamic.length<2||typeof edit.getLocalExtensions!=='function'||typeof edit.updateOptions!=='function'||typeof preview.set!=='function'||typeof preview.clear!=='function'||typeof preview.get!=='function'||['getScroll','applyScroll','setEphemeralState','onResize'].some(method=>typeof preview[method]!=='function')||!(EditorView as any).clipboardCopyHook||!(EditorView as any).clipboardPasteHook)throw Error('Required per-instance native editor methods are absent');
    const genericLocal=local[local.length-1],genericDynamic=dynamic[dynamic.length-1];
    const colors=HighlightStyle.define([
      {tag:tags.keyword,color:'var(--color-purple)'},
      {tag:[tags.string,tags.special(tags.string)],color:'var(--color-green)'},
      {tag:[tags.number,tags.bool],color:'var(--color-orange)'},
      {tag:tags.comment,color:'var(--text-muted)'},
      {tag:tags.typeName,color:'var(--color-yellow)'},
    ]);
    const sizePolicy=EditorState.transactionExtender.of(transaction=>this.codeTransaction(transaction));
    const clipboard=Prec.highest(EditorView.domEventHandlers({
      paste:(event,cm)=>{event.preventDefault();const raw=plainTransfer(event.clipboardData);if(raw!==undefined)cm.dispatch({...cm.state.replaceSelection(raw),userEvent:'input.paste',scrollIntoView:true});return true;},
      drop:(event,cm)=>{event.preventDefault();const raw=plainTransfer(event.dataTransfer);if(raw!==undefined&&raw!==''){const position=cm.posAtCoords({x:event.clientX,y:event.clientY})??cm.state.selection.main.from;cm.dispatch({changes:{from:position,insert:raw},userEvent:'input.drop',scrollIntoView:true});}return true;},
    }));
    this.codeExtensions=[EditorState.lineSeparator.of('\n'),clipboard,sizePolicy,Prec.highest(EditorView.contentAttributes.of({spellcheck:'false',autocorrect:'off',autocapitalize:'off'})),Prec.highest(keymap.of([{key:'Enter',run:insertNewlineAndIndent},{key:'Tab',run:indentMore,shift:indentLess}])),EditorView.editorAttributes.of({'data-language-view':type})];
    const generic=genericLocal.call(edit).filter((provider:any)=>provider.facet!==(EditorView as any).clipboardCopyHook&&provider.facet!==(EditorView as any).clipboardPasteHook);
    edit.getLocalExtensions=()=>[generic,this.codeExtensions,this.compartment.of(this.syntaxExtensions()),syntaxHighlighting(colors)];
    edit.localExtensions=null;
    const normalApp=edit.app;
    const vaultProxy=new Proxy(normalApp.vault,{get:(target,key)=>key==='getConfig'?(name:string)=>['autoPairMarkdown','smartIndentList','livePreview','spellcheck'].includes(name)?false:target.getConfig(name):typeof target[key]==='function'?target[key].bind(target):target[key]});
    const codeApp=Object.assign(Object.create(normalApp),{vault:vaultProxy});
    edit.getDynamicExtensions=()=>{edit.sourceMode=true;edit.app=codeApp;try{const extensions=genericDynamic.call(edit);if(normalApp.vault.getConfig('showLineNumber'))extensions.push(lineNumbers());return extensions;}finally{edit.app=normalApp;}};
    edit.sourceMode=true;
    // Presentation text never enters getViewData, native data, or lastSavedData.
    const nativeSet=preview.set.bind(preview),nativeClear=preview.clear.bind(preview);
    preview.get=()=>this.rawPreview;
    preview.clear=()=>{this.rawPreview='';nativeClear();};
    preview.set=(text:string,clear=false)=>{if(clear)preview.clear();this.rawPreview=text;const grammar=text.length<=MAX_CODE_PARSE_LENGTH?codeLanguage(this.file?.extension??'')?.grammar:undefined;nativeSet(codeReadingFence(text,grammar),false);};
    preview.getFoldInfo=()=>({folds:[],lines:this.rawPreview.split('\n').length});preview.applyFoldInfo=()=>{};
    // Native Reading sees one presentation-only line before the raw code.
    const nativeScroll=preview.getScroll.bind(preview),nativeApplyScroll=preview.applyScroll.bind(preview),nativeState=preview.setEphemeralState.bind(preview),nativeResize=preview.onResize.bind(preview);
    preview.getScroll=()=>{const scroll=nativeScroll();return scroll==null?scroll:Math.max(0,scroll-1);};
    preview.applyScroll=(scroll:number)=>nativeApplyScroll(scroll+1);
    preview.setEphemeralState=(state:any)=>nativeState({...state,...(typeof state.scroll==='number'?{scroll:state.scroll+1}:{}),...(typeof state.line==='number'&&state.line>=0?{line:state.line+1}:{}),...(state.match?{match:{...state.match,content:'\n'+state.match.content,matches:state.match.matches.map(([from,to]:[number,number])=>[from+1,to+1])}}:{})});
    preview.onResize=()=>{const view:any=this,scroll=view.scroll;view.scroll=scroll==null?scroll:scroll+1;try{nativeResize();}finally{view.scroll=scroll;}};
    this.register(()=>{this.closed=true;this.generation++;});
  }
  private live(){return !this.closed&&this.registry.active()&&this.leaf.view===this;}
  private syntaxExtensions(length=this.rawLength):Extension {
    return this.support&&length<=MAX_CODE_PARSE_LENGTH?[Prec.highest(this.support),indentOnInput(),foldGutter()]:Prec.highest(codePlaintext);
  }
  private codeTransaction(transaction:Transaction){
    if(!transaction.docChanged)return null;
    const length=transaction.newDoc.length,wanted=this.support&&length<=MAX_CODE_PARSE_LENGTH?this.support.language:codePlaintext;
    if(transaction.startState.facet(language)===wanted)return null;
    return {effects:this.compartment.reconfigure(this.syntaxExtensions(length))};
  }
  private configure(){const edit:any=(this as any).editMode;if(!edit.cmInit||!this.live())return;edit.cm.dispatch({effects:this.compartment.reconfigure(this.syntaxExtensions(edit.cm.state.doc.length))});}
  setViewData(text:string,clear:boolean){this.rawLength=text.length;super.setViewData(text,clear);}
  async onLoadFile(file:TFile){
    if(codeLanguage(file.extension)?.type!==this.type)throw Error('This native code view cannot open this file type.');
    const generation=++this.generation;this.support=undefined;
    // Core keeps file loading, Editor, undo, save, and merge behavior. Pending code is plain text.
    await super.onLoadFile(file);
    const current=()=>this.live()&&generation===this.generation&&this.file===file;
    if(!current())return;this.configure();
    const grammar=codeLanguage(file.extension)?.grammar;
    if(!grammar)return;
    try{const support=await this.registry.grammars.get(grammar);if(!current())return;this.support=support;this.configure();}
    catch(error){if(current())new Notice(`Syntax highlighting is unavailable. The native editor remains plain text: ${error instanceof Error?error.message:String(error)}`,10000);}
  }
  async onUnloadFile(file:TFile){this.generation++;await super.onUnloadFile(file);}
  async setState(state:any,result:any){return super.setState({...state,source:true},result);}
  canAcceptExtension(extension:string){return codeLanguage(extension)?.type===this.type;}
  canShowProperties(){return false;}
  loadFrontmatter(_text:string){}
  handlePaste(_event:ClipboardEvent){}
  async onSwitchView(event:MouseEvent|KeyboardEvent){
    event.preventDefault();const state=this.getState();state.mode=this.getMode()==='preview'?'source':'preview';let leaf=this.leaf;
    const next:any={type:this.getViewType(),state:{...state,source:true}};
    if(Keymap.isModEvent(event)){leaf=this.app.workspace.createLeafBySplit(this.leaf);next.active=true;next.group=this.leaf;}
    await leaf.setViewState(next,{focus:true});
  }
  async toggleBacklinks(){const state=this.getState();state.backlinks=!state.backlinks;await this.leaf.setViewState({type:this.getViewType(),state:{...state,source:true}});this.app.workspace.requestSaveLayout();}
  onPaneMenu(menu:Menu,source:string){
    (TextFileView.prototype as any).onPaneMenu.call(this,menu,source);
    menu.addItem(item=>item.setTitle('Reading view').setIcon('book-open').setChecked(this.getMode()==='preview').onClick(event=>void this.onSwitchView(event)));
    menu.addItem(item=>item.setTitle('Find…').setIcon('file-search').onClick(()=>this.showSearch()));
    menu.addItem(item=>item.setTitle('Replace…').setIcon('file-search').setDisabled(this.getMode()!=='source').onClick(()=>this.showSearch(true)));
  }
}
export function createNativeLanguageView(leaf:WorkspaceLeaf,type:CodeViewType,registry:NativeLanguageViews):MarkdownView {
  // The native base constructor can call getViewType before subclass fields exist.
  return new (class extends NativeCodeView {getViewType(){return type;}})(leaf,type,registry);
}
