import * as cmState from '@codemirror/state';
import * as cmView from '@codemirror/view';
import * as cmLanguage from '@codemirror/language';
import type {MarkdownView} from 'obsidian';
import type {EditorView} from '@codemirror/view';
import type {ChangeDesc} from '@codemirror/state';

export const responseHeightAttribute='data-t3-response-height-guard';
export const responseHeightProperty='--send-to-t3-response-min-height';
const minimumHold=500,quietPeriod=150,interval=50,samplingBudget=5000;
// A private margin tags viewport-only requests across CodeMirror's mapping.
// Their handler must remain effective even after a slow render or cancellation.
const revealMargin=-1748263;
type RevealHandler=Parameters<typeof EditorView.scrollHandler.of>[0];
const revealHandlers=new WeakMap<EditorView,RevealHandler>();

interface HeightGuard {
  cm:EditorView;content:HTMLElement;scroller:HTMLElement;spacer:HTMLElement;window:Window;file:MarkdownView['file'];mode:string;
  keys:string[];floor:number;started:number;changed:number;geometry:string;stable:number;width:number;height:number;
  previousAttribute:string|null;previousValue:string;previousPriority:string;
  anchor:number;lastReveal:number;reveals:number;
}

/** Native widgets can briefly become smaller height estimates during parsing.
 * Keep that temporary shrink from clamping the scroller to a false bottom.
 * This guard never writes a scroll position, selection, or document change. */
export class ResponseHeightGuard {
  private guard?:HeightGuard;
  private frame?:number;
  private timer?:number;
  constructor(private view:MarkdownView,private released:()=>void=()=>{}){}
  isActive(){return !!this.guard;}
  private mode(){return this.view.getMode()+':'+!!this.view.contentEl?.querySelector('.markdown-source-view.is-live-preview');}
  private now(window:Window){return window.performance?.now()??Date.now();}
  private folds(scroller:HTMLElement){return Array.from(scroller.querySelectorAll<HTMLElement>('.callout[data-callout="t3-progress"]'));}
  private key(fold:HTMLElement){return fold.querySelector<HTMLElement>(':scope > .callout-title .send-to-t3-fold-key')?.dataset.t3Fold;}
  begin(display:string,changes?:ChangeDesc){
    const cm=(this.view.editor as {cm?:EditorView})?.cm,window=this.view.contentEl?.ownerDocument.defaultView;
    if(this.view.getMode()==='preview'||!cm?.contentDOM?.style||!cm.scrollDOM?.style||!window){this.clear();return;}
    // Source length is not rendered height: a completed command status or a
    // shorter activity label can remove bytes without removing a single row.
    // Hold through those native redraws too. Real compaction releases its old
    // floor below once the smaller widget is measured and parsing settles;
    // removing the active fold still clears the guard immediately.
    if(this.guard&&(this.guard.cm!==cm||this.guard.file!==this.view.file||this.guard.mode!==this.mode()))this.clear();
    const content=cm.contentDOM,scroller=cm.scrollDOM;
    const keys=(this.guard?.keys??this.folds(scroller).map(fold=>this.key(fold)).filter((key):key is string=>!!key&&key.endsWith(':active')))
      .filter(key=>display.includes(`data-t3-fold="${key}"`));
    if(!keys.length){this.clear();return;}
    const rect=content.getBoundingClientRect(),scale=cm.scaleY||1;
    // Include native titles/properties above content and scroller padding, but
    // never count our own spacer or an empty viewport as new content height.
    const top=(rect.top-scroller.getBoundingClientRect().top)/scale+scroller.scrollTop-scroller.clientTop;
    const padding=Number.parseFloat(window.getComputedStyle(scroller).paddingBottom)||0;
    const floor=Math.ceil(rect.height/scale+Math.max(0,top)+padding);
    if(!Number.isFinite(floor)||floor<=0)return;
    const now=this.now(window);
    if(!this.guard){
      const spacer=scroller.createDiv({cls:'send-to-t3-response-height-spacer',attr:{'aria-hidden':'true'}});
      this.guard={cm,content,scroller,spacer,window,file:this.view.file,mode:this.mode(),keys,floor:Math.max(floor,scroller.scrollHeight),started:now,changed:now,geometry:'',stable:0,width:scroller.clientWidth,height:scroller.clientHeight,anchor:cm.viewport?.from??0,lastReveal:-Infinity,reveals:0,
      previousAttribute:content.getAttribute(responseHeightAttribute),previousValue:scroller.style.getPropertyValue(responseHeightProperty),previousPriority:scroller.style.getPropertyPriority(responseHeightProperty)};
    }
    const guard=this.guard;
    if(cm.viewport&&cm.viewport.from<cm.viewport.to)guard.anchor=cm.viewport.from;
    if(changes)guard.anchor=changes.mapPos(guard.anchor,-1);
    guard.keys=keys;guard.floor=Math.max(guard.floor,floor);guard.started=now;guard.changed=now;guard.stable=0;guard.geometry='';
    guard.reveals=0;
    // A transparent sibling extends scrollable overflow without changing the
    // editable content, its line layout, or CodeMirror's inline sizing.
    scroller.style.setProperty(responseHeightProperty,`${guard.floor}px`);
    content.setAttribute(responseHeightAttribute,'true');
    const {StateEffect,Prec}=cmState;
    const {EditorView}=cmView;
    let handler=revealHandlers.get(cm);
    if(!handler){handler=(_view,_range,options)=>options.y==='nearest'&&options.yMargin===0&&options.xMargin===revealMargin;revealHandlers.set(cm,handler);}
    if(!cm.state.facet(EditorView.scrollHandler).includes(handler))cm.dispatch({effects:StateEffect.appendConfig.of(Prec.highest(EditorView.scrollHandler.of(handler)))});
    this.schedule();
    return this.reveal(guard,changes?.newLength);
  }
  changed(){const guard=this.guard;if(!guard)return;const now=this.now(guard.window);if(now-guard.started>=samplingBudget)guard.started=now;guard.changed=now;guard.stable=0;this.schedule();}
  updated(){if(this.guard)this.schedule();}
  private schedule(delay=0){
    const guard=this.guard;if(!guard||this.frame!==undefined||this.timer!==undefined)return;
    if(delay){this.timer=guard.window.setTimeout(()=>{this.timer=undefined;this.schedule();},delay);return;}
    this.frame=guard.window.requestAnimationFrame(()=>{this.frame=undefined;this.check();});
  }
  private check(){
    const guard=this.guard;if(!guard)return;
    const {cm,content,scroller,window}=guard;
    if(!content.isConnected||this.view.file!==guard.file||this.mode()!==guard.mode||(this.view.editor as {cm?:EditorView})?.cm!==cm||scroller.clientWidth!==guard.width||scroller.clientHeight!==guard.height){this.clear(true);return;}
    const now=this.now(window),folds=this.folds(scroller),rects=guard.keys.map(key=>folds.find(fold=>this.key(fold)===key)?.getBoundingClientRect());
    const rendered=rects.every(rect=>rect&&rect.height>0);
    // Checking the existing parser work does not force a whole-note parse.
    const parsing=typeof cm.plugin==='function'&&cmLanguage.syntaxParserRunning(cm);
    if(!rendered&&cm.viewport?.from===cm.state.doc.length&&!parsing&&now-guard.started>=minimumHold&&now-guard.lastReveal>=250&&guard.reveals<8){
      // Holding DOM height alone can leave CodeMirror's smaller height map
      // looking past the response into an empty end-of-document viewport.
      // Reveal the old viewport's mapped source; our handler consumes only
      // this request's scrolling, so the physical viewport stays user-owned.
      guard.lastReveal=now;guard.reveals++;
      cm.dispatch({effects:this.reveal(guard)});
    }
    const geometry=rendered?rects.map(rect=>Math.round(rect!.height*2)).join(':'):'';
    if(rendered&&!parsing&&now-guard.started>=minimumHold&&now-guard.changed>=quietPeriod){
      guard.stable=geometry===guard.geometry?guard.stable+1:1;guard.geometry=geometry;
      if(guard.stable>=2){this.clear(true);return;}
    }else guard.stable=0;
    // Stop polling a hidden/virtualized block. DOM changes or the next stream
    // update wake the guard again; file/mode changes and disposal always clear it.
    if(now-guard.started<samplingBudget)this.schedule(interval);
  }
  private reveal(guard:HeightGuard,length=guard.cm.state.doc.length){
    // An explicit consumed target also prevents CodeMirror from applying an
    // implicit EOF-anchor correction when another update arrives before the
    // native widget has returned. It never requests a DOM scroll.
    const position=Math.max(0,Math.min(guard.anchor,length));
    const {EditorView}=cmView;
    return EditorView.scrollIntoView(position,{y:'nearest',yMargin:0,xMargin:revealMargin});
  }
  clear(notify=false){
    const guard=this.guard;if(!guard)return;
    this.guard=undefined;
    guard.spacer.remove();
    if(this.frame!==undefined){guard.window.cancelAnimationFrame(this.frame);this.frame=undefined;}
    if(this.timer!==undefined){guard.window.clearTimeout(this.timer);this.timer=undefined;}
    if(guard.content.getAttribute(responseHeightAttribute)==='true'){
      if(guard.previousAttribute===null)guard.content.removeAttribute(responseHeightAttribute);else guard.content.setAttribute(responseHeightAttribute,guard.previousAttribute);
    }
    if(guard.scroller.style.getPropertyValue(responseHeightProperty)===`${guard.floor}px`){
      if(guard.previousValue)guard.scroller.style.setProperty(responseHeightProperty,guard.previousValue,guard.previousPriority);else guard.scroller.style.removeProperty(responseHeightProperty);
    }
    guard.cm.requestMeasure?.();
    if(notify)this.released();
  }
}
