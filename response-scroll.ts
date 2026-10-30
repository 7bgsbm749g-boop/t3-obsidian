import type {MarkdownView} from 'obsidian';
import type {ResponseProjection} from './native-response-projection';
import {ResponseHeightGuard} from './response-height';
import type {ChangeDesc} from '@codemirror/state';

export type ScrollControl={active:boolean;position:'top'|'bottom';moving:boolean};
export type ResponseScrollState={following?:{id:string;key:string};positions:Map<string,'top'|'bottom'>};
export const responseScrollChanged='send-to-t3-scroll-changed';
const duration=420,inset=8;

/** Explicit, pane-local follow intent. DOM geometry, rather than the source
 * line at the end of a large native widget, determines the visible bottom. */
export class ResponseScroll {
  private following?:{id:string;key:string;mode:string;started?:number;progress?:number};
  private get positions(){return this.state.positions;}
  private file:MarkdownView['file'];
  private disposed=false;
  private expectedScroll?:{element:HTMLElement;top:number;left:number};
  private revealScroll?:HTMLElement;
  private frame?:number;
  private stopListeners?:()=>void;
  private observer?:MutationObserver;
  private resize?:ResizeObserver;
  private watched=new Set<Element>();
  private height:ResponseHeightGuard;
  constructor(private view:MarkdownView,private projection:()=>ResponseProjection,private state:ResponseScrollState={positions:new Map()}){
    this.file=view.file;
    this.height=new ResponseHeightGuard(view,()=>this.updated());
    const window=view.contentEl?.ownerDocument.defaultView;if(!window)return;
    const inside=(event:Event)=>view.contentEl.contains(event.target as Node);
    const manual=(event:Event)=>{if(event.isTrusted&&view.file===this.file&&inside(event))this.stop();};
    const click=(event:MouseEvent)=>{if(event.isTrusted&&(event.target as Element)?.closest?.('.callout-title, summary'))this.height.clear();};
    const key=(event:KeyboardEvent)=>{if(['Enter',' '].includes(event.key)&&(event.target as Element)?.closest?.('.callout-title, summary'))this.height.clear();};
    const input=(event:Event)=>{if(event.isTrusted&&inside(event))this.height.clear();};
    const scroll=(event:Event)=>{
      const scroller=this.scroller();
      if(!event.isTrusted||view.file!==this.file||!this.following||event.target!==scroller||!scroller)return;
      if(this.revealScroll===scroller){this.revealScroll=undefined;this.expectedScroll={element:scroller,top:scroller.scrollTop,left:scroller.scrollLeft};return;}
      if(this.expectedScroll?.element===scroller&&Math.abs(this.expectedScroll.top-scroller.scrollTop)<1&&Math.abs(this.expectedScroll.left-scroller.scrollLeft)<1)return;
      this.stop();
    };
    window.addEventListener('click',click,true);
    window.addEventListener('scroll',scroll,true);
    window.addEventListener('wheel',manual,{capture:true,passive:true});
    window.addEventListener('touchmove',manual,{capture:true,passive:true});
    window.addEventListener('keydown',key,true);
    window.addEventListener('beforeinput',input,true);
    window.addEventListener('resize',this.updated);
    window.visualViewport?.addEventListener('resize',this.updated);
    window.visualViewport?.addEventListener('scroll',this.updated);
    this.stopListeners=()=>{window.removeEventListener('click',click,true);window.removeEventListener('scroll',scroll,true);window.removeEventListener('wheel',manual,true);window.removeEventListener('touchmove',manual,true);window.removeEventListener('keydown',key,true);window.removeEventListener('beforeinput',input,true);window.removeEventListener('resize',this.updated);window.visualViewport?.removeEventListener('resize',this.updated);window.visualViewport?.removeEventListener('scroll',this.updated);};
    if(window.MutationObserver){
      this.observer=new window.MutationObserver(records=>{
        const content=records.some(record=>record.type==='childList');
        if(content)this.height.changed();
        if(content||records.some(record=>record.type==='attributes'&&(record.target as Element).matches('.callout[data-callout="t3-progress"]')))this.updated();
      });
      this.observer.observe(view.contentEl,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
    }
    if(window.ResizeObserver)this.resize=new window.ResizeObserver(this.updated);
  }
  private mode(){return this.view.getMode()+':'+!!this.view.contentEl?.querySelector('.markdown-source-view.is-live-preview');}
  private scroller(){return this.view.getMode()==='preview'?this.view.contentEl?.querySelector<HTMLElement>('.markdown-preview-view'):(this.view.editor as any)?.cm?.scrollDOM as HTMLElement|undefined;}
  private range(key:string){
    if(!key.endsWith(':active'))return;
    const projection=this.projection(),matches=projection.ranges.filter(range=>projection.display.slice(range.displayFrom,range.displayTo).includes(`data-t3-fold="${key}"`));
    return matches.length===1?matches[0]:undefined;
  }
  control(key:string):ScrollControl|undefined {
    const range=this.range(key);if(!range)return;
    return {active:this.state.following?.key===key&&this.state.following.id===range.id,position:this.positions.get(key)??'top',moving:this.following?.key===key&&this.following.progress!==1};
  }
  /** Called only by the running block's explicit button, including keyboard
   * activation. Rendering, cursor placement and text clicks never enable it. */
  toggle(key:string){
    if(this.state.following?.key===key){this.stop();return;}
    const range=this.range(key);if(!range)return;
    this.stop();this.positions.set(key,'bottom');
    while(this.positions.size>64)this.positions.delete(this.positions.keys().next().value!);
    this.state.following={id:range.id,key};this.following={...this.state.following,mode:this.mode()};this.notify();this.updated();
  }
  private notify(){const window=this.view.contentEl?.ownerDocument.defaultView;if(window)this.view.contentEl.dispatchEvent(new window.Event(responseScrollChanged,{bubbles:true}));}
  private stop(){
    const changed=!!this.state.following;this.state.following=undefined;this.pause();if(changed)this.notify();
  }
  private pause(){
    this.following=undefined;this.expectedScroll=undefined;this.revealScroll=undefined;
    const window=this.view.contentEl?.ownerDocument.defaultView;
    if(this.frame!==undefined){window?.cancelAnimationFrame(this.frame);this.frame=undefined;}
    this.resize?.disconnect();this.watched.clear();
  }
  preserveHeight(display:string,changes?:ChangeDesc){return this.height.begin(display,changes);}
  clearHeight(){this.height.clear();}
  suspend(){this.stop();this.height.clear();}
  /** Projection updates and late native layout changes share one pending frame. */
  updated=()=>{
    if(this.disposed)return;
    // Native note switches replace the adapter. Keep intent in its pane/note
    // state, while detached or hidden editors must not run scroll jobs.
    if(this.view.file!==this.file||this.view.contentEl?.getClientRects?.().length===0){this.pause();return;}
    let reset=false,stop=false;
    for(const fold of Array.from(this.scroller()?.querySelectorAll<HTMLElement>('.callout[data-callout="t3-progress"].is-collapsed')??[])){
      const key=fold.querySelector<HTMLElement>(':scope > .callout-title .send-to-t3-fold-key')?.dataset.t3Fold;
      if(!key)continue;
      reset=this.positions.delete(key)||reset;
      if(this.state.following?.key===key)stop=true;
    }
    if(stop)this.stop();else if(reset)this.notify();
    this.height.updated();
    const retained=this.state.following;
    if(!this.following&&retained&&this.range(retained.key)?.id===retained.id)this.following={...retained,mode:this.mode()};
    const following=this.following;if(!following)return;
    if(this.mode()!==following.mode||this.range(following.key)?.id!==following.id){this.stop();return;}
    const window=this.view.contentEl?.ownerDocument.defaultView;
    if(!window||this.frame!==undefined)return;
    this.frame=window.requestAnimationFrame(time=>{
      this.frame=undefined;if(this.following!==following)return;
      if(this.view.file!==this.file||!this.view.contentEl.isConnected||this.view.contentEl.getClientRects?.().length===0){this.pause();return;}
      const cm=(this.view.editor as any)?.cm;
      const range=this.range(following.key);if(!range){this.stop();return;}
      const scroller=this.scroller();
      if(!scroller)return;
      const fold=Array.from(scroller.querySelectorAll<HTMLElement>('.callout[data-callout="t3-progress"]')).find(fold=>fold.querySelector<HTMLElement>(':scope > .callout-title .send-to-t3-fold-key')?.dataset.t3Fold===following.key);
      if(!fold){
        // CodeMirror can virtualize a block which was replaced during a stream
        // update. Reveal its source end, then measure the rendered widget.
        if(cm&&this.view.getMode()!=='preview'){
          const {EditorView}=require('@codemirror/view') as typeof import('@codemirror/view');
          this.revealScroll=scroller;
          cm.dispatch({effects:EditorView.scrollIntoView(Math.max(range.displayFrom,range.displayTo-1),{y:'end',yMargin:inset})});
        }
        return;
      }
      for(const element of [fold,scroller])if(!this.watched.has(element)){this.resize?.observe(element);this.watched.add(element);}
      for(const element of this.watched)if(element!==fold&&element!==scroller){this.resize?.unobserve(element);this.watched.delete(element);}
      const box=scroller.getBoundingClientRect(),pane=this.view.contentEl.getBoundingClientRect(),viewport=window.visualViewport,foldBox=fold.getBoundingClientRect();
      let bottom=Math.min(box.top+scroller.clientTop+scroller.clientHeight,pane.bottom,viewport?viewport.offsetTop+viewport.height:Infinity);
      // Obsidian can overlay the status bar on the scroll surface. Exclude
      // only a visible bar which overlaps this block in this document/window.
      for(const bar of Array.from(this.view.contentEl.ownerDocument.querySelectorAll<HTMLElement>('.status-bar'))){
        const rect=bar.getBoundingClientRect();
        if(rect.height>0&&rect.width>0&&rect.right>foldBox.left&&rect.left<foldBox.right&&rect.bottom>=bottom&&rect.top>box.top)bottom=Math.min(bottom,rect.top);
      }
      const delta=foldBox.bottom-(bottom-inset);
      if(following.started===undefined)following.started=time;
      const progress=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?1:Math.min(1,(time-following.started)/duration);
      // Re-measure the remaining distance every frame: streaming can change
      // the target during the trip. There is no competing smooth-scroll job.
      const previous=following.progress??0,ease=(t:number)=>1-Math.pow(1-t,3);
      const fraction=progress===1?1:(ease(progress)-ease(previous))/(1-ease(previous));
      following.progress=progress;
      if(Math.abs(delta)>0.5)scroller.scrollTop+=delta*fraction;
      this.expectedScroll={element:scroller,top:scroller.scrollTop,left:scroller.scrollLeft};
      if(progress<1)this.updated();
      else if(previous!==1)this.notify();
    });
  };
  dispose(){this.disposed=true;this.pause();this.height.clear();this.observer?.disconnect();this.stopListeners?.();this.stopListeners=undefined;}
}
