import {isRecord} from '../shared/values';
import {MarkdownView,TextFileView,Keymap,Notice,type App,type MarkdownPreviewView,type ViewState,type ViewStateResult,type Menu,type TFile,type WorkspaceLeaf} from 'obsidian';
import {EditorState,Compartment,Prec,type Extension,type Transaction} from '@codemirror/state';
import {EditorView,keymap,lineNumbers} from '@codemirror/view';
import {language,syntaxHighlighting,HighlightStyle,indentOnInput,foldGutter,type LanguageSupport} from '@codemirror/language';
import {insertNewlineAndIndent,indentMore,indentLess} from '@codemirror/commands';
import {tags} from '@lezer/highlight';
import {codeLanguage,codeReadingFence,plainTransfer,rawCodeChange,codeTabSize,MAX_CODE_PARSE_LENGTH,type CodeViewType} from './code-language';
import type {NativeLanguageViews} from './language-views';
import {codePlaintext} from './language-plaintext';

interface NativeLanguageApp extends App {vault:App['vault']&{getConfig(name:string):unknown}}
interface NativeEditMode {
  app:NativeLanguageApp;cm:EditorView;cmInit:boolean;sourceMode:boolean;localExtensions:Extension|null;
  set(text:string,clear?:boolean):void;getLocalExtensions():Extension[];getDynamicExtensions():Extension[];updateOptions():void;
}
interface CodeEphemeralState extends Record<string,unknown>{scroll?:number;line?:number;match?:{content:string;matches:Array<[number,number]>}}
interface NativeReadingMode extends MarkdownPreviewView {
  getFoldInfo():{folds:unknown[];lines:number};applyFoldInfo():void;
  setEphemeralState(state:CodeEphemeralState):void;onResize():void;
}
const clipboardHooks=EditorView as typeof EditorView&{clipboardCopyHook?:unknown;clipboardPasteHook?:unknown};
function nativeEdit(view:MarkdownView):NativeEditMode{
  const value:unknown=Reflect.get(view,'editMode');if(!isRecord(value))throw Error('Native editor mode is unavailable.');return value as unknown as NativeEditMode;
}
/** Only loaded by a named code factory. No global Markdown method is changed. */
class NativeCodeView extends MarkdownView {
  declare scroll:number|null|undefined;
  private compartment=new Compartment();
  private support?:LanguageSupport;
  private rawPreview='';
  private generation=0;
  private closed=false;
  private rawLength=0;
  private codeExtensions:Extension;
  constructor(leaf:WorkspaceLeaf,readonly type:CodeViewType,private registry:NativeLanguageViews){
    super(leaf);
    const edit=nativeEdit(this),preview=this.previewMode as NativeReadingMode;
    this.contentEl.classList.add('t3-code-language-view');
    const roots=(name:string)=>{const methods:Array<(this:NativeEditMode)=>Extension[]>=[];for(let prototype:unknown=Object.getPrototypeOf(edit);isRecord(prototype);prototype=Object.getPrototypeOf(prototype) as unknown){const member:unknown=Reflect.get(prototype,name);if(Object.hasOwn(prototype,name)&&typeof member==='function')methods.push(member as (this:NativeEditMode)=>Extension[]);}return methods;};
    const local=roots('buildLocalExtensions'),dynamic=roots('getDynamicExtensions');
    if(local.length<2||dynamic.length<2||typeof edit.set!=='function'||typeof edit.getLocalExtensions!=='function'||typeof edit.updateOptions!=='function'||typeof preview.set!=='function'||typeof preview.clear!=='function'||typeof preview.get!=='function'||(['getScroll','applyScroll','setEphemeralState','onResize'] as const).some(method=>typeof preview[method]!=='function')||!clipboardHooks.clipboardCopyHook||!clipboardHooks.clipboardPasteHook)throw Error('Required per-instance native editor methods are absent');
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
    const generic=genericLocal.call(edit).filter(provider=>{const value:unknown=provider;return !isRecord(value)||value.facet!==clipboardHooks.clipboardCopyHook&&value.facet!==clipboardHooks.clipboardPasteHook;});
    edit.getLocalExtensions=()=>[generic,this.codeExtensions,this.compartment.of(this.syntaxExtensions()),syntaxHighlighting(colors)];
    edit.localExtensions=null;
    const normalApp=edit.app;
    const tabSize=()=>{const size=codeTabSize(normalApp.vault.getConfig('tabSize'));this.contentEl.style.setProperty('--t3-code-language-tab-size',String(size));return size;};
    tabSize();
    const vaultProxy=new Proxy(normalApp.vault,{get:(target,key):unknown=>{if(key==='getConfig')return (name:string)=>['autoPairMarkdown','smartIndentList','livePreview','spellcheck'].includes(name)?false:target.getConfig(name);const member:unknown=Reflect.get(target,key,target);return typeof member==='function'?member.bind(target) as unknown:member;}});
    const codeApp=Object.assign(Object.create(normalApp) as NativeLanguageApp,{vault:vaultProxy});
    edit.getDynamicExtensions=()=>{edit.sourceMode=true;edit.app=codeApp;try{const extensions=genericDynamic.call(edit);extensions.push(Prec.highest(EditorState.tabSize.of(tabSize())));if(normalApp.vault.getConfig('showLineNumber'))extensions.push(lineNumbers());return extensions;}finally{edit.app=normalApp;}};
    // Core's incremental setter splits on /\r?\n/ and drops CR bytes. Keep its
    // initialization lifecycle, but apply exact raw changes on this code instance.
    const nativeEditSet=edit.set.bind(edit);
    edit.set=(text:string,clear=false)=>{if(clear||!edit.cmInit)return nativeEditSet(text,clear);const change=rawCodeChange(edit.cm.state.doc.toString(),text);if(change)edit.cm.dispatch({changes:change,userEvent:'set'});};
    edit.sourceMode=true;
    // Presentation text never enters getViewData, native data, or lastSavedData.
    const nativeSet=preview.set.bind(preview),nativeClear=preview.clear.bind(preview);
    preview.get=()=>this.rawPreview;
    preview.clear=()=>{this.rawPreview='';nativeClear();};
    preview.set=(text:string,clear=false)=>{tabSize();if(clear)preview.clear();this.rawPreview=text;const grammar=text.length<=MAX_CODE_PARSE_LENGTH?codeLanguage(this.file?.extension??'')?.grammar:undefined;nativeSet(codeReadingFence(text,grammar),false);};
    preview.getFoldInfo=()=>({folds:[],lines:this.rawPreview.split('\n').length});preview.applyFoldInfo=()=>{};
    // Native Reading sees one presentation-only line before the raw code.
    const nativeScroll=preview.getScroll.bind(preview),nativeApplyScroll=preview.applyScroll.bind(preview),nativeState=preview.setEphemeralState.bind(preview),nativeResize=preview.onResize.bind(preview);
    preview.getScroll=()=>{const scroll=nativeScroll();return scroll==null?scroll:Math.max(0,scroll-1);};
    preview.applyScroll=(scroll:number)=>nativeApplyScroll(scroll+1);
    preview.setEphemeralState=(state:CodeEphemeralState)=>nativeState({...state,...(typeof state.scroll==='number'?{scroll:state.scroll+1}:{}),...(typeof state.line==='number'&&state.line>=0?{line:state.line+1}:{}),...(state.match?{match:{...state.match,content:'\n'+state.match.content,matches:state.match.matches.map(([from,to]:[number,number])=>[from+1,to+1])}}:{})});
    preview.onResize=()=>{const scroll=this.scroll;this.scroll=scroll==null?scroll:scroll+1;try{nativeResize();}finally{this.scroll=scroll;}};
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
  private configure(){const edit=nativeEdit(this);if(!edit.cmInit||!this.live())return;edit.cm.dispatch({effects:this.compartment.reconfigure(this.syntaxExtensions(edit.cm.state.doc.length))});}
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
  async setState(state:unknown,result:ViewStateResult){return super.setState({...isRecord(state)?state:{},source:true},result);}
  canAcceptExtension(extension:string){return codeLanguage(extension)?.type===this.type;}
  canShowProperties(){return false;}
  loadFrontmatter(_text:string){}
  handlePaste(_event:ClipboardEvent){}
  async onSwitchView(event:MouseEvent|KeyboardEvent){
    event.preventDefault();const state=this.getState();state.mode=this.getMode()==='preview'?'source':'preview';let leaf=this.leaf;
    const next:ViewState={type:this.getViewType(),state:{...state,source:true}};
    if(Keymap.isModEvent(event)){leaf=this.app.workspace.createLeafBySplit(this.leaf);next.active=true;next.group=this.leaf;}
    await leaf.setViewState(next,{focus:true});
  }
  async toggleBacklinks(){const state=this.getState();state.backlinks=!state.backlinks;await this.leaf.setViewState({type:this.getViewType(),state:{...state,source:true}});this.app.workspace.requestSaveLayout();}
  onPaneMenu(menu:Menu,source:string){
    TextFileView.prototype.onPaneMenu.call(this,menu,source);
    menu.addItem(item=>item.setTitle('Reading view').setIcon('book-open').setChecked(this.getMode()==='preview').onClick(event=>void this.onSwitchView(event)));
    menu.addItem(item=>item.setTitle('Find…').setIcon('file-search').onClick(()=>this.showSearch()));
    menu.addItem(item=>item.setTitle('Replace…').setIcon('file-search').setDisabled(this.getMode()!=='source').onClick(()=>this.showSearch(true)));
  }
}
export function createNativeLanguageView(leaf:WorkspaceLeaf,type:CodeViewType,registry:NativeLanguageViews):MarkdownView {
  // The native base constructor can call getViewType before subclass fields exist.
  return new (class extends NativeCodeView {getViewType(){return type;}})(leaf,type,registry);
}
