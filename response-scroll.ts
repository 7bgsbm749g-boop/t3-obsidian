import type {MarkdownView} from 'obsidian';
import type {ResponseProjection} from './native-response-projection';

/** Follow intent belongs to one pane and is acquired only by a real click.
 * Scroll position, selection, rendering and programmatic clicks cannot arm it. */
export class ResponseScroll {
  private following?:{id:string;body:string;mode:string};
  private frame?:number;
  private stopListeners?:()=>void;
  constructor(private view:MarkdownView,private projection:()=>ResponseProjection){
    const window=view.contentEl?.ownerDocument.defaultView;if(!window)return;
    const click=(event:MouseEvent)=>{
      if(!event.isTrusted)return;
      this.stop();
      if(event.button!==0||event.ctrlKey||event.metaKey||event.altKey||event.shiftKey)return;
      const element=(event.target as Node)?.nodeType===1?event.target as Element:(event.target as Node)?.parentElement;
      if(!element||!view.contentEl.contains(element))return;
      if(element.closest('a, button, input, textarea, select, summary, [role="button"], audio, video, .embed-actions'))return;
      const selection=window.getSelection();if(selection&&!selection.isCollapsed)return;
      const projection=this.projection();
      const fold=element.closest('.callout[data-callout="t3-progress"]');
      const key=fold?.querySelector<HTMLElement>(':scope > .callout-title .send-to-t3-fold-key')?.dataset.t3Fold;
      // Reading and Live Preview share the exact generated fold identity.
      // Never infer identity from a title or from proximity to another reply.
      let range=key?projection.ranges.find(range=>projection.display.slice(range.displayFrom,range.displayTo).includes(`data-t3-fold="${key}"`)):undefined;
      if(!range&&view.getMode()!=='preview'){
        const cm=(view.editor as any)?.cm;
        if(cm?.contentDOM?.contains(element)){
          const position=cm.posAtCoords({x:event.clientX,y:event.clientY});
          if(position!=null)range=projection.ranges.find(range=>position>range.displayFrom&&position<range.displayTo);
        }
      }
      if(range)this.following={id:range.id,body:projection.display.slice(range.displayFrom,range.displayTo),mode:this.mode()};
    };
    const manual=(event:Event)=>{if(event.isTrusted&&view.contentEl.contains(event.target as Node))this.stop();};
    const key=(event:KeyboardEvent)=>{if(['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' ','Escape'].includes(event.key))manual(event);};
    // Window capture precedes the document listeners that protect generated
    // callouts from Obsidian's source-cursor handling.
    window.addEventListener('click',click,true);
    window.addEventListener('wheel',manual,{capture:true,passive:true});
    window.addEventListener('touchmove',manual,{capture:true,passive:true});
    window.addEventListener('keydown',key,true);
    const pointer=(event:PointerEvent)=>{
      if(!event.isTrusted)return;
      if(!view.contentEl.contains(event.target as Node)||event.target===(view.editor as any)?.cm?.scrollDOM||event.target===this.readingScroller())this.stop();
    };
    window.addEventListener('pointerdown',pointer,true);
    this.stopListeners=()=>{window.removeEventListener('click',click,true);window.removeEventListener('wheel',manual,true);window.removeEventListener('touchmove',manual,true);window.removeEventListener('keydown',key,true);window.removeEventListener('pointerdown',pointer,true);};
  }
  private mode(){return this.view.getMode()+':'+!!this.view.contentEl?.querySelector('.markdown-source-view.is-live-preview');}
  private readingScroller(){return this.view.contentEl?.querySelector<HTMLElement>('.markdown-preview-view');}
  private stop(){
    this.following=undefined;
    if(this.frame!==undefined){this.view.contentEl.ownerDocument.defaultView?.cancelAnimationFrame(this.frame);this.frame=undefined;}
  }
  suspend(){this.stop();}
  /** Called after the native projection is updated, including completion. */
  updated(){
    const following=this.following;if(!following)return;
    const projection=this.projection(),range=projection.ranges.find(range=>range.id===following.id);
    if(!range||this.mode()!==following.mode){this.stop();return;}
    const body=projection.display.slice(range.displayFrom,range.displayTo);
    if(body===following.body)return;
    following.body=body;
    const window=this.view.contentEl.ownerDocument.defaultView;
    if(!window||this.frame!==undefined)return;
    this.frame=window.requestAnimationFrame(()=>{
      this.frame=undefined;if(this.following!==following||!this.view.contentEl.isConnected)return;
      if(window.getSelection()&&!window.getSelection()!.isCollapsed){this.stop();return;}
      const latest=this.projection(),range=latest.ranges.find(range=>range.id===following.id);if(!range){this.stop();return;}
      if(this.view.getMode()!=='preview'){
        const cm=(this.view.editor as any)?.cm;if(!cm)return;
        if(cm.state.selection.ranges.some((range:{empty:boolean})=>!range.empty)){this.stop();return;}
        // The end marker is on its own line. Follow the last response line,
        // without moving the cursor or touching the user's selection/history.
        const end=latest.display.lastIndexOf('\n',range.displayTo-1);
        const {EditorView}=require('@codemirror/view') as typeof import('@codemirror/view');
        cm.dispatch({effects:EditorView.scrollIntoView(Math.max(range.displayFrom,end-1),{y:'end',yMargin:32})});
      }else{
        const body=latest.display.slice(range.displayFrom,range.displayTo);
        const key=/data-t3-fold="([^"]+)"/.exec(body)?.[1],scroller=this.readingScroller();
        const fold=scroller&&Array.from(scroller.querySelectorAll<HTMLElement>('.callout[data-callout="t3-progress"]')).find(fold=>fold.querySelector<HTMLElement>(':scope > .callout-title .send-to-t3-fold-key')?.dataset.t3Fold===key);
        if(fold&&scroller){const delta=fold.getBoundingClientRect().bottom-scroller.getBoundingClientRect().bottom+32;scroller.scrollTop+=delta;}
      }
    });
  }
  dispose(){this.stop();this.stopListeners?.();this.stopListeners=undefined;}
}
