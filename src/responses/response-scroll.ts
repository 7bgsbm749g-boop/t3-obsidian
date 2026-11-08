import * as cmView from '@codemirror/view';
import {editorCM} from '../shared/native-editor';
import type {MarkdownView} from 'obsidian';
import type {ResponseProjection} from './native-response-projection';
import {ResponseHeightGuard} from './response-height';
import type {ChangeDesc} from '@codemirror/state';
import {logEvent} from '../app/diagnostics';

export type ScrollControl={active:boolean;position:'top'|'bottom';moving:boolean};
export type ResponseScrollState={following?:{id:string;key:string;mode?:string};positions:Map<string,'top'|'bottom'>};
export const responseScrollChanged='send-to-t3-scroll-changed';
const duration=420,inset=8;
let scrollControllers=0;

/** Explicit, pane-local follow intent. DOM geometry, rather than the source
 * line at the end of a large native widget, determines the visible bottom. */
export class ResponseScroll {
  private following?:{id:string;key:string;mode:string;started?:number;progress?:number};
  private get positions(){return this.state.positions;}
  private file:MarkdownView['file'];
  private disposed=false;
  private frame?:number;
  private stopListeners?:()=>void;
  private observer?:MutationObserver;
  private resize?:ResizeObserver;
  private watched=new Set<Element>();
  private height:ResponseHeightGuard;
  private diagnosticId=`follow-${++scrollControllers}`;
  private diagnosticState:'off'|'following'|'paused'='off';
  constructor(private view:MarkdownView,private projection:()=>ResponseProjection,private state:ResponseScrollState={positions:new Map()}){
    this.file=view.file;
    this.height=new ResponseHeightGuard(view,()=>this.updated());
    const window=view.contentEl?.ownerDocument.defaultView;if(!window)return;
    const inside=(event:Event)=>view.contentEl.contains(event.target as Node);
    const manual=(event:Event)=>{if(this.state.following&&event.isTrusted&&view.file===this.file&&this.scroller()?.contains(event.target as Node))this.stop(`manual-${event.type}`);};
    const wheel=(event:WheelEvent)=>{if(event.deltaY&&!event.ctrlKey)manual(event);};
    const click=(event:MouseEvent)=>{if(event.isTrusted&&(event.target as Element)?.closest?.('.callout-title, summary'))this.height.clear();};
    const key=(event:KeyboardEvent)=>{
      const target=event.target as Element|null;
      if(['Enter',' '].includes(event.key)&&target?.closest?.('.callout-title, summary'))this.height.clear();
      if(!['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(event.key))return;
      // Space activates the focused Follow button or disclosure, or types text.
      // Input fields and editor caret navigation are not pane scroll commands.
      if(target?.closest?.('input, textarea, select')||event.key===' '&&target?.closest?.('button, [role="button"], summary, .callout-title, [contenteditable="true"]'))return;
      if(!['PageUp','PageDown'].includes(event.key)&&target?.closest?.('[contenteditable="true"]'))return;
      manual(event);
    };
    const pointer=(event:PointerEvent)=>{
      if(!this.state.following||!event.isTrusted||view.file!==this.file)return;
      const scroller=this.scroller();
      if(!scroller||event.target!==scroller||event.button!==0||event.pointerType==='touch')return;
      const box=scroller.getBoundingClientRect(),left=box.left+scroller.clientLeft;
      // A vertical scrollbar lies outside the scroller's client content box.
      if(event.clientX<left||event.clientX>=left+scroller.clientWidth)manual(event);
    };
    const input=(event:Event)=>{if(event.isTrusted&&inside(event))this.height.clear();};
    const scroll=(event:Event)=>{
      const scroller=this.scroller();
      if(!event.isTrusted||view.file!==this.file||!this.following||event.target!==scroller||!scroller)return;
      // Trusted scroll events also come from native anchoring and viewport
      // changes. Only explicit scroll input above cancels the user's choice.
      this.updated();
    };
    window.addEventListener('click',click,true);
    window.addEventListener('scroll',scroll,true);
    window.addEventListener('wheel',wheel,{capture:true,passive:true});
    window.addEventListener('touchmove',manual,{capture:true,passive:true});
    window.addEventListener('keydown',key,true);
    window.addEventListener('pointerdown',pointer,true);
    window.addEventListener('beforeinput',input,true);
    window.addEventListener('resize',this.updated);
    window.visualViewport?.addEventListener('resize',this.updated);
    window.visualViewport?.addEventListener('scroll',this.updated);
    this.stopListeners=()=>{window.removeEventListener('click',click,true);window.removeEventListener('scroll',scroll,true);window.removeEventListener('wheel',wheel,true);window.removeEventListener('touchmove',manual,true);window.removeEventListener('keydown',key,true);window.removeEventListener('pointerdown',pointer,true);window.removeEventListener('beforeinput',input,true);window.removeEventListener('resize',this.updated);window.visualViewport?.removeEventListener('resize',this.updated);window.visualViewport?.removeEventListener('scroll',this.updated);};
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
  private scroller(){return this.view.getMode()==='preview'?this.view.contentEl?.querySelector<HTMLElement>('.markdown-preview-view'):editorCM(this.view.editor)?.scrollDOM;}
  private range(key:string){
    if(!key.endsWith(':active'))return;
    const projection=this.projection(),matches=projection.ranges.filter(range=>projection.display.slice(range.displayFrom,range.displayTo).includes(`data-t3-fold="${key}"`));
    return matches.length===1&&matches[0].followable!==false?matches[0]:undefined;
  }
  private rangeLossReason(following:{id:string;key:string}){const projection=this.projection(),matches=projection.ranges.filter(range=>projection.display.slice(range.displayFrom,range.displayTo).includes(`data-t3-fold="${following.key}"`));return !matches.length?'response-missing':matches.length>1?'response-ambiguous':matches[0].id!==following.id?'response-identity-changed':'response-not-followable';}
  private reportFollow(to:typeof this.diagnosticState,reason:string,choice=this.state.following){
    if(this.diagnosticState===to)return;const from=this.diagnosticState;this.diagnosticState=to;
    logEvent('response.follow.changed',{controllerId:this.diagnosticId,bindingId:choice?.id,foldKey:choice?.key,from,to,reason,retained:!!this.state.following,mode:this.view.getMode(),visibility:this.view.contentEl?.ownerDocument.visibilityState});
  }
  control(key:string):ScrollControl|undefined {
    const range=this.range(key);if(!range)return;
    return {active:this.state.following?.key===key&&this.state.following.id===range.id,position:'bottom',moving:!range.followPaused&&this.following?.key===key&&this.following.progress!==1};
  }
  /** Called only by the running block's explicit button, including keyboard
   * activation. Rendering, cursor placement and text clicks never enable it. */
  toggle(key:string){
    if(this.state.following?.key===key){this.stop('button-off');return;}
    const range=this.range(key);if(!range)return;
    this.stop('another-response');this.positions.set(key,'bottom');
    const mode=this.mode();this.state.following={id:range.id,key,mode};this.following={...this.state.following,mode};this.reportFollow('following','button-on');this.notify();this.updated();
  }
  private notify(){const window=this.view.contentEl?.ownerDocument.defaultView;if(window)this.view.contentEl.dispatchEvent(new window.Event(responseScrollChanged,{bubbles:true}));}
  private stop(reason:string){
    const choice=this.state.following;this.state.following=undefined;this.positions.clear();this.pause(reason);if(choice){this.reportFollow('off',reason,choice);this.notify();}
  }
  private pause(reason:string){
    if(this.state.following)this.reportFollow('paused',reason);
    this.following=undefined;
    const window=this.view.contentEl?.ownerDocument.defaultView;
    if(this.frame!==undefined){window?.cancelAnimationFrame(this.frame);this.frame=undefined;}
    this.resize?.disconnect();this.watched.clear();
  }
  preserveHeight(display:string,changes?:ChangeDesc){return this.height.begin(display,changes);}
  clearHeight(){this.height.clear();}
  suspend(){this.stop('projection-suspended');this.height.clear();}
  /** Projection updates and late native layout changes share one pending frame. */
  updated=()=>{
    if(this.disposed)return;
    const retainedFollow=this.state.following;
    const retainedRange=retainedFollow&&this.range(retainedFollow.key);
    if(retainedFollow&&retainedRange?.id!==retainedFollow.id)this.stop(this.rangeLossReason(retainedFollow));
    // Static retained history has no follow intent or guarded height. Avoid
    // forcing layout on every native viewport mutation in that common case.
    if(!this.following&&!this.state.following&&!this.positions.size&&!this.height.isActive())return;
    // Native note switches replace the adapter. Keep intent in its pane/note
    // state, while detached or hidden editors must not run scroll jobs.
    if(this.view.file!==this.file||this.view.contentEl?.getClientRects?.().length===0){this.pause('view-hidden-or-switched');return;}
    this.height.updated();
    if(retainedFollow?.mode!==undefined&&retainedFollow.mode!==this.mode()){this.stop('mode-changed');return;}
    const retained=this.state.following;
    if(!this.following&&retained&&this.range(retained.key)?.id===retained.id)this.following={...retained,mode:this.mode()};
    const following=this.following;if(!following)return;
    if(this.mode()!==following.mode){this.stop('mode-changed');return;}
    if(this.range(following.key)?.id!==following.id){this.stop(this.rangeLossReason(following));return;}
    const window=this.view.contentEl?.ownerDocument.defaultView;
    if(!window||this.frame!==undefined)return;
    this.frame=window.requestAnimationFrame(time=>{
      this.frame=undefined;if(this.following!==following)return;
      if(this.view.file!==this.file||!this.view.contentEl.isConnected||this.view.contentEl.getClientRects?.().length===0){this.pause('view-detached-or-hidden');return;}
      const cm=editorCM(this.view.editor);
      const range=this.range(following.key);if(!range){this.stop(this.rangeLossReason(following));return;}
      const scroller=this.scroller();
      if(!scroller)return;
      const fold=Array.from(scroller.querySelectorAll<HTMLElement>('.callout[data-callout="t3-progress"]')).find(fold=>fold.querySelector<HTMLElement>(':scope > .callout-title .send-to-t3-fold-key')?.dataset.t3Fold===following.key);
      if(!fold){
        if(range.followPaused){this.pause('reconnecting');return;}
        // CodeMirror can virtualize a block which was replaced during a stream
        // update. Reveal its source end only if its estimated bottom overflows.
        if(cm&&this.view.getMode()!=='preview'){
          const end=Math.max(range.displayFrom,range.displayTo-1),box=scroller.getBoundingClientRect(),viewport=window.visualViewport;
          const bottom=Math.min(box.top+scroller.clientTop+scroller.clientHeight,this.view.contentEl.getBoundingClientRect().bottom,viewport?viewport.offsetTop+viewport.height:Infinity);
          if(cm.documentTop+cm.lineBlockAt(end).bottom*cm.scaleY>bottom-inset){
            const {EditorView}=cmView;
            cm.dispatch({effects:EditorView.scrollIntoView(end,{y:'nearest',yMargin:inset})});
          }
        }
        return;
      }
      // A new native widget can start collapsed. Presentation restores the
      // user's choice in a microtask, before this frame checks its final state.
      if(fold.classList.contains('is-collapsed')){this.stop('block-collapsed');return;}
      // Still honor a collapse while offline, then pause without losing the
      // exact response/fold choice or revealing a virtualized response.
      if(range.followPaused){this.pause('reconnecting');return;}
      this.reportFollow('following','projection-ready');
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
      // Let the stream fill the visible space before following its growth.
      // Shrinking content or a larger viewport must not scroll the reader up.
      const delta=Math.max(0,foldBox.bottom-(bottom-inset));
      const previous=following.progress??0;
      if(delta<=0.5){following.progress=1;if(previous!==1)this.notify();return;}
      if(following.started===undefined)following.started=time;
      const progress=previous===1||window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?1:Math.min(1,(time-following.started)/duration);
      // Re-measure the remaining distance every frame: streaming can change
      // the target during the trip. There is no competing smooth-scroll job.
      const ease=(t:number)=>1-Math.pow(1-t,3);
      const fraction=progress===1?1:(ease(progress)-ease(previous))/(1-ease(previous));
      following.progress=progress;
      scroller.scrollTop+=delta*fraction;
      if(progress<1)this.updated();
      else if(previous!==1)this.notify();
    });
  };
  dispose(){this.disposed=true;this.pause('controller-disposed');this.height.clear();this.observer?.disconnect();this.stopListeners?.();this.stopListeners=undefined;}
}
