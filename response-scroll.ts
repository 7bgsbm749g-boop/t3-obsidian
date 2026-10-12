import type {MarkdownView} from 'obsidian';
import type {ResponseProjection} from './native-response-projection';

export type ScrollControl={active:boolean;position:'top'|'bottom';moving:boolean};
export const responseScrollChanged='send-to-t3-scroll-changed';
const duration=420,inset=8;

/** Explicit, pane-local follow intent. DOM geometry, rather than the source
 * line at the end of a large native widget, determines the visible bottom. */
export class ResponseScroll {
  private following?:{id:string;key:string;mode:string;started?:number;progress?:number};
  private positions=new Map<string,'top'|'bottom'>();
  private frame?:number;
  private stopListeners?:()=>void;
  private observer?:MutationObserver;
  private resize?:ResizeObserver;
  private watched=new Set<Element>();
  constructor(private view:MarkdownView,private projection:()=>ResponseProjection,private random=Math.random){
    const window=view.contentEl?.ownerDocument.defaultView;if(!window)return;
    const inside=(event:Event)=>view.contentEl.contains(event.target as Node);
    const button=(event:Event)=>((event.target as Node)?.nodeType===1?event.target as Element:(event.target as Node)?.parentElement)?.closest('.send-to-t3-stream-follow');
    const manual=(event:Event)=>{if(event.isTrusted&&inside(event))this.stop();};
    const click=(event:MouseEvent)=>{if(event.isTrusted&&(!inside(event)||!button(event)))this.stop();};
    const pointer=(event:PointerEvent)=>{if(event.isTrusted&&(!inside(event)||!button(event)))this.stop();};
    const key=(event:KeyboardEvent)=>{if(button(event)&&['Enter',' '].includes(event.key))return;if(!['Control','Shift','Alt','Meta'].includes(event.key))manual(event);};
    const selection=()=>{const selected=window.getSelection();if(selected&&!selected.isCollapsed&&view.contentEl.contains(selected.anchorNode))this.stop();};
    window.addEventListener('click',click,true);
    window.addEventListener('pointerdown',pointer,true);
    window.addEventListener('wheel',manual,{capture:true,passive:true});
    window.addEventListener('touchmove',manual,{capture:true,passive:true});
    window.addEventListener('keydown',key,true);
    view.contentEl.ownerDocument.addEventListener('selectionchange',selection);
    window.addEventListener('resize',this.updated);
    window.visualViewport?.addEventListener('resize',this.updated);
    window.visualViewport?.addEventListener('scroll',this.updated);
    this.stopListeners=()=>{window.removeEventListener('click',click,true);window.removeEventListener('pointerdown',pointer,true);window.removeEventListener('wheel',manual,true);window.removeEventListener('touchmove',manual,true);window.removeEventListener('keydown',key,true);view.contentEl.ownerDocument.removeEventListener('selectionchange',selection);window.removeEventListener('resize',this.updated);window.visualViewport?.removeEventListener('resize',this.updated);window.visualViewport?.removeEventListener('scroll',this.updated);};
    if(window.MutationObserver){this.observer=new window.MutationObserver(this.updated);this.observer.observe(view.contentEl,{childList:true,subtree:true});}
    if(window.ResizeObserver)this.resize=new window.ResizeObserver(this.updated);
  }
  private mode(){return this.view.getMode()+':'+!!this.view.contentEl?.querySelector('.markdown-source-view.is-live-preview');}
  private range(key:string){
    if(!key.endsWith(':active'))return;
    const projection=this.projection(),matches=projection.ranges.filter(range=>projection.display.slice(range.displayFrom,range.displayTo).includes(`data-t3-fold="${key}"`));
    return matches.length===1?matches[0]:undefined;
  }
  control(key:string):ScrollControl|undefined {
    if(!this.range(key))return;
    return {active:this.following?.key===key,position:this.positions.get(key)??'top',moving:this.following?.key===key&&this.following.progress!==1};
  }
  /** Called only by the running block's explicit button, including keyboard
   * activation. Rendering, cursor placement and text clicks never enable it. */
  toggle(key:string){
    if(this.following?.key===key){this.positions.set(key,this.random()<0.5?'top':'bottom');this.stop();return;}
    const range=this.range(key);if(!range)return;
    this.stop();this.positions.set(key,'bottom');
    while(this.positions.size>64)this.positions.delete(this.positions.keys().next().value!);
    this.following={id:range.id,key,mode:this.mode()};this.notify();this.updated();
  }
  private notify(){const window=this.view.contentEl?.ownerDocument.defaultView;if(window)this.view.contentEl.dispatchEvent(new window.Event(responseScrollChanged,{bubbles:true}));}
  private stop(){
    const changed=!!this.following;this.following=undefined;
    const window=this.view.contentEl?.ownerDocument.defaultView;
    if(this.frame!==undefined){window?.cancelAnimationFrame(this.frame);this.frame=undefined;}
    this.resize?.disconnect();this.watched.clear();if(changed)this.notify();
  }
  suspend(){this.stop();}
  /** Projection updates and late native layout changes share one pending frame. */
  updated=()=>{
    const following=this.following;if(!following)return;
    if(this.mode()!==following.mode||this.range(following.key)?.id!==following.id){this.stop();return;}
    const window=this.view.contentEl.ownerDocument.defaultView;
    if(!window||this.frame!==undefined)return;
    this.frame=window.requestAnimationFrame(time=>{
      this.frame=undefined;if(this.following!==following)return;
      if(!this.view.contentEl.isConnected){this.stop();return;}
      const selected=window.getSelection(),cm=(this.view.editor as any)?.cm;
      if(selected&&!selected.isCollapsed||this.view.getMode()!=='preview'&&cm?.state.selection.ranges.some((range:{empty:boolean})=>!range.empty)){this.stop();return;}
      const range=this.range(following.key);if(!range){this.stop();return;}
      const scroller=this.view.getMode()==='preview'?this.view.contentEl.querySelector<HTMLElement>('.markdown-preview-view'):cm?.scrollDOM as HTMLElement|undefined;
      if(!scroller)return;
      const fold=Array.from(scroller.querySelectorAll<HTMLElement>('.callout[data-callout="t3-progress"]')).find(fold=>fold.querySelector<HTMLElement>(':scope > .callout-title .send-to-t3-fold-key')?.dataset.t3Fold===following.key);
      if(!fold){
        // CodeMirror can virtualize a block which was replaced during a stream
        // update. Reveal its source end, then measure the rendered widget.
        if(cm&&this.view.getMode()!=='preview'){
          const {EditorView}=require('@codemirror/view') as typeof import('@codemirror/view');
          cm.dispatch({effects:EditorView.scrollIntoView(Math.max(range.displayFrom,range.displayTo-1),{y:'end',yMargin:inset})});
        }
        return;
      }
      for(const element of [fold,scroller])if(!this.watched.has(element)){this.resize?.observe(element);this.watched.add(element);}
      for(const element of this.watched)if(element!==fold&&element!==scroller){this.resize?.unobserve(element);this.watched.delete(element);}
      const box=scroller.getBoundingClientRect(),pane=this.view.contentEl.getBoundingClientRect(),viewport=window.visualViewport;
      const bottom=Math.min(box.top+scroller.clientTop+scroller.clientHeight,pane.bottom,viewport?viewport.offsetTop+viewport.height:Infinity)-inset;
      const delta=fold.getBoundingClientRect().bottom-bottom;
      if(following.started===undefined)following.started=time;
      const progress=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?1:Math.min(1,(time-following.started)/duration);
      // Re-measure the remaining distance every frame: streaming can change
      // the target during the trip. There is no competing smooth-scroll job.
      const previous=following.progress??0,ease=(t:number)=>1-Math.pow(1-t,3);
      const fraction=progress===1?1:(ease(progress)-ease(previous))/(1-ease(previous));
      following.progress=progress;
      if(Math.abs(delta)>0.5)scroller.scrollTop+=delta*fraction;
      if(progress<1)this.updated();
      else if(previous!==1)this.notify();
    });
  };
  dispose(){this.stop();this.observer?.disconnect();this.stopListeners?.();this.stopListeners=undefined;this.positions.clear();}
}
