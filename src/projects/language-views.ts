import {nativeHost} from '../shared/native-host';
import {isRecord} from '../shared/values';
import {ItemView,apiVersion,type App,type Plugin,type WorkspaceLeaf,type View} from 'obsidian';
import {CODE_VIEW_TYPES,codeLanguage,nativeLanguageVersion,type CodeViewType} from './code-language';
import type {LanguageSupport} from '@codemirror/language';
import {CodeGrammarCache} from './code-language';
/** Factories register synchronously; the native adapter and grammars stay lazy. */
export class NativeLanguageViews {
  private factories=new Map<CodeViewType,(leaf:WorkspaceLeaf)=>View>();
  private stopped=false;
  readonly grammars=new CodeGrammarCache<LanguageSupport>(async grammar=>(await import('./language-grammars')).loadCodeGrammar(grammar));
  constructor(private app:App,private plugin:Plugin){}
  private creator(type:string){return nativeHost(this.app).viewRegistry?.getViewCreatorByType?.(type)??nativeHost(this.app).viewRegistry?.viewByType?.[type];}
  async install(){
    let native:typeof import('./language-native')|undefined,nativeError:unknown;
    if(nativeLanguageVersion(apiVersion)){try{native=await import('./language-native');}catch(error){nativeError=error;}}
    if(this.stopped)return;
    for(const type of CODE_VIEW_TYPES){
      if(this.creator(type))continue;
      const factory=(leaf:WorkspaceLeaf):View=>{
        const unavailable=(message:string)=>new (class extends ItemView {
          private state:Record<string,unknown>={};getViewType(){return type;}getDisplayText(){return 'Project code unavailable';}
          getState(){return this.state;}async setState(state:unknown){this.state=isRecord(state)?state:{};}
          async onOpen(){this.contentEl.createEl('p',{text:message});}
        })(leaf);
        if(this.stopped||!nativeLanguageVersion(apiVersion))return unavailable('This Obsidian version cannot safely open the native code editor. Your project files and saved local edits are retained.');
        try{if(!native)throw nativeError instanceof Error?nativeError:Error('Native editor module did not load.');return native.createNativeLanguageView(leaf,type,this);}catch(error){return unavailable(`The native code editor is unavailable: ${error instanceof Error?error.message:String(error)}. Your project files and saved local edits are retained.`);}
      };
      try{this.plugin.registerView(type,factory);this.factories.set(type,factory);}catch{/* A conflicting plugin owns this view type. */}
    }
  }
  types():CodeViewType[]{return this.stopped?[]:[...this.factories].filter(([type,factory])=>this.creator(type)===factory).map(([type])=>type);}
  type(extension:string):CodeViewType|undefined {
    const profile=codeLanguage(extension);if(!profile)return undefined;
    if(!this.types().includes(profile.type))throw Error(`The ${profile.type} view is unavailable or another plugin owns its name. Your project files and saved local edits are retained.`);
    return profile.type;
  }
  active(){return !this.stopped;}
  dispose(){this.stopped=true;}
}
