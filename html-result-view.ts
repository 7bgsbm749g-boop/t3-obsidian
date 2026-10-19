import {App,MarkdownRenderChild,Modal,Plugin,editorLivePreviewField,setIcon} from 'obsidian';
import type {Extension,EditorState} from '@codemirror/state';
import {HtmlResultError,HtmlResultStore} from './html-result-store';
import {HTML_RESULT_LANGUAGE,htmlResultFrameHeight,htmlResultKey,parseHtmlResult,type HtmlResultReference} from './html-results';
import {HtmlResultIndex} from './html-result-index';

interface Theme {appearance:'dark'|'light';variables:Record<string,string>}
interface Mounted {root:HTMLElement;reference:HtmlResultReference;refreshTheme():void;recover():Promise<void>;dispose():void}
export interface HtmlResultViewOptions {
  /** Open the host's sign-in UI. The host calls recover after access returns. */
  onSignIn?:(environmentId:string)=>Promise<void>|void;
}
const variables:Record<string,string>={
  '--background':'--background-primary','--foreground':'--text-normal','--muted':'--background-secondary','--muted-foreground':'--text-muted',
  '--card':'--background-secondary','--card-foreground':'--text-normal','--popover':'--background-secondary','--popover-foreground':'--text-normal',
  '--secondary':'--background-modifier-hover','--secondary-foreground':'--text-normal','--border':'--background-modifier-border','--input':'--background-modifier-border',
  '--ring':'--interactive-accent','--primary':'--interactive-accent','--primary-foreground':'--text-on-accent','--accent':'--interactive-accent',
  '--accent-foreground':'--text-accent','--accent-surface':'--background-modifier-hover','--accent-surface-foreground':'--text-normal',
  '--destructive':'--text-error','--destructive-foreground':'--text-error','--destructive-surface':'--background-modifier-error',
  '--warning':'--text-warning','--warning-foreground':'--text-warning','--warning-surface':'--background-secondary',
  '--success':'--color-green','--success-foreground':'--color-green','--info':'--color-blue','--info-foreground':'--color-blue',
  '--code-background':'--code-background','--code-foreground':'--code-normal','--font-sans':'--font-text','--font-mono':'--font-monospace',
  '--chart-1':'--interactive-accent','--chart-2':'--color-green','--chart-3':'--color-orange','--chart-4':'--color-purple','--chart-5':'--color-red','--chart-6':'--color-cyan','--radius':'--radius-m',
};
function themeFor(doc:Document):Theme {
  const style=doc.defaultView!.getComputedStyle(doc.body),values:Record<string,string>={};
  for(const [target,source] of Object.entries(variables)){const value=style.getPropertyValue(source).trim();if(value)values[target]=value;}
  values['--font-sans']=style.fontFamily;values['--font-mono']=style.getPropertyValue('--font-monospace').trim()||'monospace';
  return {appearance:doc.body.classList.contains('theme-dark')?'dark':'light',variables:values};
}
const themeMessage=(theme:Theme)=>({jsonrpc:'2.0',method:'ui/notifications/host-context-changed',params:{theme:theme.appearance,styles:{variables:theme.variables}}});

/** Adds only a bounded Escape bridge. The stored T3 bootstrap owns document
 * sizing, theme and link messages. No Obsidian API is exposed inside the page. */
function viewerDocument(html:string,doc:Document):string {
  const parsed=new (doc.defaultView! as Window&typeof globalThis).DOMParser().parseFromString(html,'text/html');
  // A blob document has no vault-relative base. Keep its own hash links while
  // excluding Obsidian/file protocols from subresource and form requests.
  const policy=parsed.createElement('meta');policy.httpEquiv='Content-Security-Policy';policy.content="default-src http: https: data: blob:; script-src http: https: data: blob: 'unsafe-inline' 'unsafe-eval'; style-src http: https: data: blob: 'unsafe-inline'; connect-src http: https: ws: wss:; base-uri http: https:; form-action http: https:";
  const bridge=parsed.createElement('script');bridge.textContent='window.addEventListener("keydown",function(e){if(e.isTrusted&&e.key==="Escape"&&!e.defaultPrevented){window.parent.postMessage({jsonrpc:"2.0",method:"t3/notifications/escape"},"*");}},false);';
  parsed.head.prepend(policy,bridge);
  return '<!doctype html>\n'+parsed.documentElement.outerHTML;
}

export class HtmlResultViews {
  private mounted=new Set<Mounted>();private stopped=false;
  constructor(private app:App,private store:HtmlResultStore,private options:HtmlResultViewOptions={}){}
  install(plugin:Plugin){
    plugin.registerMarkdownCodeBlockProcessor(HTML_RESULT_LANGUAGE,(source,el,ctx)=>{
      const reference=parseHtmlResult(source);if(!reference){el.createEl('p',{text:'Invalid T3 HTML reference.'});return;}
      const mounted=this.mount(reference,el.ownerDocument);el.append(mounted.root);
      const child=new MarkdownRenderChild(el);child.register(mounted.dispose);ctx.addChild(child);
    });
    plugin.registerEditorExtension(this.extension());
    plugin.registerEvent(this.app.workspace.on('css-change',()=>this.refreshTheme()));
    plugin.register(()=>this.dispose());
  }
  refreshTheme(){for(const mounted of this.mounted)mounted.refreshTheme();}
  /** One attempt per recoverable failure after a successful host access
   * transition, including a pending request that subsequently fails. */
  async recover(environmentId?:string):Promise<void>{
    if(this.stopped)return;
    await Promise.all([...this.mounted].filter(mounted=>!environmentId||mounted.reference.environmentId===environmentId).map(mounted=>mounted.recover()));
  }
  mount(reference:HtmlResultReference,doc:Document,expanded=false,onEscape?:()=>void):Mounted {
    const win=doc.defaultView! as Window&typeof globalThis,root=doc.createElement('div');root.className='send-to-t3-html-result';root.dataset.t3HtmlKey=htmlResultKey(reference);root.setAttribute('aria-label',reference.title);
    const surface=root.createDiv({cls:'send-to-t3-html-surface'}),controls=root.createDiv({cls:'send-to-t3-html-controls'});
    let disposed=false,generation=0,frame:HTMLIFrameElement|undefined,blob:string|undefined,reported:number|undefined;
    let state:'loading'|'ready'|'failed'='loading',failure:HtmlResultError|undefined,loading:Promise<void>|undefined,recovery:Promise<void>|undefined;
    const height=()=>{root.style.height=state!=='ready'?'auto':expanded?'100%':htmlResultFrameHeight(reference,root.clientWidth||728,reported)+'px';};
    const showState=(next:typeof state)=>{state=next;root.dataset.t3HtmlState=next;root.setAttribute('aria-busy',String(next==='loading'));controls.hidden=next!=='ready';height();};showState('loading');
    if(!expanded){const expand=controls.createEl('button',{attr:{'aria-label':'Expand HTML','title':'Expand HTML'}});setIcon(expand,'maximize-2');expand.addEventListener('click',()=>new HtmlResultModal(this.app,this,reference).open());}
    const postTheme=()=>frame?.contentWindow?.postMessage(themeMessage(themeFor(doc)),'*');
    const receive=(event:MessageEvent)=>{
      if(disposed||!frame||event.source!==frame.contentWindow||!event.data||event.data.jsonrpc!=='2.0')return;
      const {method,params,id}=event.data;
      if(method==='ui/notifications/size-changed'&&typeof params?.height==='number'&&Number.isFinite(params.height)&&params.height>0){reported=params.height;height();return;}
      if(doc.activeElement!==frame||win.navigator.userActivation?.isActive===false)return;
      if(method==='t3/notifications/escape'){if(onEscape)onEscape();else {frame.blur();root.closest<HTMLElement>('.cm-editor')?.querySelector<HTMLElement>('.cm-content')?.focus();}return;}
      if(method==='ui/open-link'&&typeof params?.url==='string'&&/^https?:\/\//i.test(params.url)&&(typeof id==='string'||typeof id==='number')){
        try{const url=new URL(params.url);if(url.username||url.password)return;win.open(url.href,'_blank','noopener,noreferrer');frame.contentWindow?.postMessage({jsonrpc:'2.0',id,result:{}},'*');}catch{/* Invalid page links do not enter the app. */}
      }
    };
    win.addEventListener('message',receive);
    const resize=new win.ResizeObserver(height);resize.observe(root);
    const load=():Promise<void>=>{
      if(disposed||this.stopped)return Promise.resolve();
      if(loading)return loading;
      const current=++generation;failure=undefined;delete root.dataset.t3HtmlError;showState('loading');surface.empty();surface.createDiv({cls:'send-to-t3-html-loading',text:'Loading HTML on this device…',attr:{role:'status'}});
      loading=(async()=>{
      try{
        const html=await this.store.get(reference);if(disposed||this.stopped||current!==generation)return;
        const next=doc.createElement('iframe');next.title=reference.title;next.setAttribute('sandbox','allow-scripts allow-forms');next.referrerPolicy='no-referrer';next.loading='lazy';next.className='send-to-t3-html-frame';
        const theme=themeFor(doc);next.style.colorScheme=theme.appearance;
        blob=win.URL.createObjectURL(new win.Blob([viewerDocument(html,doc)],{type:'text/html;charset=utf-8'}));
        next.src=blob+'#t3-theme='+encodeURIComponent(JSON.stringify(theme));next.addEventListener('load',postTheme);frame=next;surface.replaceChildren(next);showState('ready');
      }catch(error){
        if(disposed||this.stopped||current!==generation)return;
        if(blob)win.URL.revokeObjectURL(blob);blob=undefined;frame=undefined;
        failure=error instanceof HtmlResultError?error:new HtmlResultError('unavailable','reference');
        root.dataset.t3HtmlError=failure.code;showState('failed');
        surface.empty();const status=surface.createDiv({cls:'send-to-t3-html-loading',attr:{role:'status'}});status.createSpan({text:failure.message});
        if(failure.code==='sign-in'&&this.options.onSignIn){
          const signIn=status.createEl('button',{text:'Sign in'});signIn.addEventListener('click',()=>{
            if(signIn.disabled||disposed||this.stopped)return;signIn.disabled=true;
            void Promise.resolve().then(()=>this.options.onSignIn?.(reference.environmentId)).catch(()=>{/* Keep the safe sign-in state if the dialog fails or is canceled. */}).finally(()=>{signIn.disabled=false;});
          });
        }
        const retry=status.createEl('button',{text:'Retry'});retry.addEventListener('click',()=>void load());
      }
      })().finally(()=>{loading=undefined;});return loading;
    };
    const recover=():Promise<void>=>{
      if(disposed||this.stopped||state==='ready')return Promise.resolve();
      if(recovery)return recovery;
      // Keep a transition received before the old request fails. Consume it
      // once, after that request settles; duplicate calls share the same work.
      recovery=(loading?loading.then(()=>{if(failure?.recoverable)return load();}):failure?.recoverable?load():Promise.resolve()).finally(()=>{recovery=undefined;});
      return recovery;
    };
    const mounted:Mounted={root,reference,refreshTheme:postTheme,recover,dispose:()=>{if(disposed)return;disposed=true;generation++;resize.disconnect();win.removeEventListener('message',receive);frame?.remove();if(blob)win.URL.revokeObjectURL(blob);this.mounted.delete(mounted);}};
    this.mounted.add(mounted);if(!this.stopped)void load();else mounted.dispose();return mounted;
  }
  private extension():Extension {
    const owner=this,{StateField,Prec}=require('@codemirror/state') as typeof import('@codemirror/state');
    const {Decoration,EditorView,WidgetType}=require('@codemirror/view') as typeof import('@codemirror/view');
    const roots=new WeakMap<HTMLElement,Mounted>();
    class HtmlWidget extends WidgetType {
      constructor(readonly reference:HtmlResultReference){super();}
      eq(other:HtmlWidget){return JSON.stringify(this.reference)===JSON.stringify(other.reference);}
      toDOM(view:import('@codemirror/view').EditorView){const mounted=owner.mount(this.reference,view.dom.ownerDocument);mounted.root.dataset.t3HtmlEditorWidget='true';roots.set(mounted.root,mounted);return mounted.root;}
      destroy(dom:HTMLElement){roots.get(dom)?.dispose();roots.delete(dom);}
      ignoreEvent(){return true;}
      get estimatedHeight(){return 80;}
    }
    const live=(state:EditorState)=>state.field(editorLivePreviewField,false)===true;
    const decorations=(index?:HtmlResultIndex)=>!index?Decoration.none:Decoration.set(index.blocks.map(block=>Decoration.replace({widget:new HtmlWidget(block.reference),block:true}).range(block.from,block.to)),true);
    const create=(state:EditorState)=>{const index=live(state)?HtmlResultIndex.create(state.doc):undefined;return {index,decorations:decorations(index)};};
    const field=StateField.define<{index?:HtmlResultIndex;decorations:import('@codemirror/view').DecorationSet}>({create,update:(value,tr)=>{
      if(live(tr.startState)!==live(tr.state))return create(tr.state);
      if(!tr.docChanged||!live(tr.state))return value;
      const index=value.index!.update(tr.changes,tr.state.doc);
      return {index,decorations:decorations(index)};
    },provide:field=>EditorView.decorations.from(field,value=>value.decorations)});
    return [Prec.highest(field),EditorView.atomicRanges.of(view=>view.state.field(field).decorations)];
  }
  dispose(){this.stopped=true;for(const mounted of [...this.mounted])mounted.dispose();this.store.dispose();}
}

class HtmlResultModal extends Modal {
  private mounted?:Mounted;private zoom=1;
  constructor(app:App,private views:HtmlResultViews,private reference:HtmlResultReference){super(app);}
  onOpen(){
    this.setTitle(this.reference.title);this.modalEl.addClass('send-to-t3-html-modal');
    const toolbar=this.contentEl.createDiv({cls:'send-to-t3-html-zoom'}),value=toolbar.createSpan({text:'100%'});
    const adjust=(text:string,label:string,amount:number)=>{const button=toolbar.createEl('button',{text,attr:{'aria-label':label}});button.addEventListener('click',()=>{this.zoom=Math.min(2,Math.max(.5,this.zoom+amount));value.textContent=Math.round(this.zoom*100)+'%';if(this.mounted)this.mounted.root.style.setProperty('zoom',String(this.zoom));});};
    adjust('−','Zoom out',-.25);adjust('+','Zoom in',.25);
    const area=this.contentEl.createDiv({cls:'send-to-t3-html-expanded'});this.mounted=this.views.mount(this.reference,this.contentEl.ownerDocument,true,()=>this.close());area.append(this.mounted.root);
  }
  onClose(){this.mounted?.dispose();this.contentEl.empty();}
}
