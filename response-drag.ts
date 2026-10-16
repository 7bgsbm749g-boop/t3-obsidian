import type {App,MarkdownView} from 'obsidian';
import {nativeResponses} from './native-response-manager';
import type {NativeResponseView} from './native-response-view';

/** Pointer listeners belong to the document, not a streaming callout node.
 * Replacing rendered tokens cannot lose an in-progress drag or its release. */
export function installResponseDrag(app:App,root:Document,icon:(element:HTMLElement,name:string)=>void,onError:(error:unknown)=>void):()=>void {
  const win=root.defaultView;if(!win)return ()=>{};
  const grips=new Map<HTMLElement,{fold:HTMLElement;key:string;view:MarkdownView;adapter:NativeResponseView;id:string}>();
  type Drag={view:MarkdownView;file:MarkdownView['file'];adapter:NativeResponseView;id:string;key:string;pointer:number;startX:number;startY:number;x:number;y:number;moving:boolean};
  let drag:Drag|undefined,frame:number|undefined,queued=false,disposed=false;
  const marker=root.createElement('div'),ghost=root.createElement('div');
  marker.className='send-to-t3-response-drop';ghost.className='send-to-t3-response-drag-ghost';ghost.textContent='Move response';
  const clear=()=>{
    if(frame!==undefined)win.cancelAnimationFrame(frame);frame=undefined;
    if(drag){try{drag.view.contentEl.releasePointerCapture(drag.pointer);}catch{}drag.view.contentEl.classList.remove('send-to-t3-response-dragging');}
    drag=undefined;marker.remove();ghost.remove();
  };
  const current=(item:Drag)=>!disposed&&item.view.file===item.file&&item.view.getMode()==='source'&&app.workspace.getLeavesOfType('markdown').some(leaf=>leaf.view===item.view)&&nativeResponses(app).view(item.view)===item.adapter&&item.adapter.moveControl(item.key)===item.id;
  const target=(item:Drag)=>{
    const cm=(item.view.editor as any)?.cm,box=cm?.scrollDOM.getBoundingClientRect();
    if(!box||item.x<box.left||item.x>box.right||item.y<box.top||item.y>box.bottom)return;
    let offset=cm.posAtCoords({x:item.x,y:item.y},false);
    if(offset==null){const content=cm.contentDOM.getBoundingClientRect();if(item.y>=content.bottom)offset=cm.state.doc.length;else if(item.y<=content.top)offset=0;else return;}
    const destination=item.adapter.moveTarget(item.key,offset);
    return destination?{offset,destination,cm,box}:undefined;
  };
  const tick=()=>{
    frame=undefined;const item=drag;if(!item)return;
    if(!current(item)){clear();return;}
    if(item.moving){
      try{
        const cm=(item.view.editor as any)?.cm,box=cm.scrollDOM.getBoundingClientRect();
        if(item.x>=box.left&&item.x<=box.right&&item.y>=box.top&&item.y<=box.bottom){
          const edge=32,delta=item.y<box.top+edge?-Math.min(16,(box.top+edge-item.y)/2):item.y>box.bottom-edge?Math.min(16,(item.y-box.bottom+edge)/2):0;
          if(delta)cm.scrollDOM.scrollTop+=delta;
        }
        const drop=target(item);marker.hidden=!drop;
        if(drop){
          const coords=cm.coordsAtPos(drop.destination.display),content=cm.contentDOM.getBoundingClientRect();
          if(coords){const line=cm.state.doc.lineAt(drop.destination.display);marker.style.top=`${drop.destination.display===line.from?coords.top:coords.bottom}px`;marker.style.left=`${Math.max(box.left,content.left)}px`;marker.style.width=`${Math.max(0,Math.min(box.right,content.right)-Math.max(box.left,content.left))}px`;}else marker.hidden=true;
        }
        ghost.style.left=`${item.x+14}px`;ghost.style.top=`${item.y+14}px`;
      }catch{marker.hidden=true;}
    }
    frame=win.requestAnimationFrame(tick);
  };
  const down=(event:PointerEvent)=>{
    const element=(event.target as Element)?.closest?.<HTMLElement>('.send-to-t3-response-drag'),control=element&&grips.get(element);
    if(!control||event.button!==0||event.isPrimary===false||control.adapter.moveControl(control.key)!==control.id)return;
    event.preventDefault();event.stopImmediatePropagation();clear();
    drag={...control,file:control.view.file,pointer:event.pointerId,startX:event.clientX,startY:event.clientY,x:event.clientX,y:event.clientY,moving:false};
    try{control.view.contentEl.setPointerCapture(event.pointerId);}catch{}
    frame=win.requestAnimationFrame(tick);
  };
  const move=(event:PointerEvent)=>{
    const item=drag;if(!item||item.pointer!==event.pointerId)return;
    event.preventDefault();event.stopImmediatePropagation();item.x=event.clientX;item.y=event.clientY;
    if(!item.moving&&Math.hypot(item.x-item.startX,item.y-item.startY)>=5){item.moving=true;item.view.contentEl.classList.add('send-to-t3-response-dragging');root.body.append(marker,ghost);}
  };
  const up=(event:PointerEvent)=>{
    const item=drag;if(!item||item.pointer!==event.pointerId)return;
    event.preventDefault();event.stopImmediatePropagation();item.x=event.clientX;item.y=event.clientY;
    try{const drop=item.moving&&current(item)?target(item):undefined;clear();if(drop)item.adapter.moveResponse(item.key,drop.offset);}catch(error){clear();onError(error);}
  };
  const cancel=(event:PointerEvent)=>{if(drag?.pointer===event.pointerId)clear();};
  const keydown=(event:KeyboardEvent)=>{if(drag&&event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();clear();}};
  const click=(event:MouseEvent)=>{if((event.target as Element)?.closest?.('.send-to-t3-response-drag')){event.preventDefault();event.stopImmediatePropagation();}};
  const refresh=()=>{
    queued=false;if(disposed)return;
    const live=new Set<HTMLElement>();
    for(const fold of Array.from(root.querySelectorAll<HTMLElement>('.markdown-source-view.is-live-preview .callout[data-callout="t3-progress"]'))){
      const widget=fold.closest('.cm-embed-block');if(!widget||widget.querySelector('.callout')!==fold)continue;
      const heading=fold.querySelector<HTMLElement>(':scope > .callout-title'),key=heading?.querySelector<HTMLElement>('.send-to-t3-fold-key')?.dataset.t3Fold;
      const view=app.workspace.getLeavesOfType('markdown').map(leaf=>leaf.view as MarkdownView).find(view=>view.file&&view.contentEl.contains(fold));
      const adapter=view&&nativeResponses(app).view(view),id=key&&adapter?.moveControl(key);
      if(!heading||!view||!adapter||!key||!id)continue;
      let grip=heading.querySelector<HTMLElement>(':scope > .send-to-t3-response-drag');
      if(!grip){grip=root.createElement('span');grip.className='send-to-t3-response-drag';grip.setAttribute('aria-label','Drag active response');grip.setAttribute('title','Drag to move response');icon(grip,'grip-vertical');heading.prepend(grip);}
      live.add(grip);grips.set(grip,{fold,key,view,adapter,id});
    }
    for(const [grip] of grips)if(!live.has(grip)){grip.remove();grips.delete(grip);}
    if(drag&&!current(drag))clear();
  };
  const schedule=()=>{if(!queued&&!disposed){queued=true;queueMicrotask(refresh);}};
  root.addEventListener('pointerdown',down,true);root.addEventListener('pointermove',move,{capture:true,passive:false});root.addEventListener('pointerup',up,true);root.addEventListener('pointercancel',cancel,true);root.addEventListener('keydown',keydown,true);root.addEventListener('click',click,true);win.addEventListener('blur',clear);
  const observer=new win.MutationObserver(schedule);observer.observe(root.body,{childList:true,subtree:true});
  const timer=win.setInterval(refresh,1000);refresh();
  return ()=>{disposed=true;clear();observer.disconnect();win.clearInterval(timer);for(const [grip] of grips)grip.remove();grips.clear();root.removeEventListener('pointerdown',down,true);root.removeEventListener('pointermove',move,true);root.removeEventListener('pointerup',up,true);root.removeEventListener('pointercancel',cancel,true);root.removeEventListener('keydown',keydown,true);root.removeEventListener('click',click,true);win.removeEventListener('blur',clear);};
}
