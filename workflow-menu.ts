import {setIcon,type Menu,type MenuItem} from 'obsidian';
import {decorateWorkflowActivity,workflowActivityLabel,type WorkflowActivity} from './workflow-activity';

export interface WorkflowMenuEntry {id:string;name:string;item:MenuItem}
export interface WorkflowMenuController {refresh():void;dispose():void}

// Obsidian's public Menu API has no custom-row or reorder API. Keep its DOM
// extension isolated and optional: unsupported menus retain normal editing.
type DOMMenu = Menu & {dom:HTMLElement;items:MenuItem[];sort():void;unselect():void;hideCallback?:()=>void};
type DOMItem = MenuItem & {dom:HTMLElement};

export function installWorkflowMenuOrder(root:Menu,menu:Menu,entries:WorkflowMenuEntry[],save:(ids:string[],previous:string[])=>Promise<void>,report:(error:unknown)=>void,onDispose:()=>void,getActivity:()=>ReadonlyMap<string,WorkflowActivity>=()=>new Map()):WorkflowMenuController|undefined {
  const view=menu as DOMMenu;
  if(!entries.length||!view.dom?.addEventListener||entries.some(entry=>!(entry.item as DOMItem).dom?.addEventListener))return;
  const reorderable=entries.length>1&&Array.isArray(view.items)&&typeof view.sort==='function'&&typeof view.unselect==='function';
  root.setUseNativeMenu(false);menu.setUseNativeMenu(false);
  let rows=entries.map(entry=>({...entry,el:(entry.item as DOMItem).dom,handle:view.dom.ownerDocument.createElement('span'),status:view.dom.ownerDocument.createElement('span'),originalTitle:(entry.item as DOMItem).dom.title}));
  let disposed=false,saving=false,suppressClick=false;
  let active:{row:typeof rows[number];pointerId:number;startX:number;startY:number;moved:boolean;index:number;x:number;y:number}|undefined;
  let detachDrag=()=>{};
  const cleanups:(()=>void)[]=[];
  const listen=(target:EventTarget,type:string,listener:EventListener,options?:AddEventListenerOptions)=>{
    target.addEventListener(type,listener,options);return ()=>target.removeEventListener(type,listener,options);
  };
  const stop=(event:Event)=>{event.preventDefault();event.stopImmediatePropagation();};
  const clearMarkers=()=>{for(const row of rows)row.el.classList.remove('t3-workflow-drop-before','t3-workflow-drop-after');};
  const finish=()=>{
    const drag=active;active=undefined;detachDrag();detachDrag=()=>{};clearMarkers();
    view.dom.classList.remove('t3-workflow-dragging');
    if(drag){drag.row.el.classList.remove('t3-workflow-drag-source');if(drag.row.handle.hasPointerCapture?.(drag.pointerId))drag.row.handle.releasePointerCapture(drag.pointerId);}
    return drag;
  };
  const commit=async(row:typeof rows[number],index:number)=>{
    if(disposed||saving||index<0||rows.indexOf(row)===index)return;
    const previous=rows.map(row=>row.id),next=rows.filter(item=>item!==row);next.splice(index,0,row);
    saving=true;view.dom.setAttribute('aria-busy','true');
    try{
      await save(next.map(row=>row.id),previous);
      if(disposed)return;
      // Keyboard navigation uses Menu.items, so update it together with the DOM.
      view.unselect();let cursor=0;const items=new Set(rows.map(row=>row.item));
      view.items=view.items.map(item=>items.has(item)?next[cursor++].item:item);
      rows=next;view.sort();
    }catch(error){report(error);}
    finally{saving=false;view.dom.removeAttribute('aria-busy');}
  };
  const marker=()=>{
    const drag=active;if(!drag)return;clearMarkers();
    const bounds=view.dom.getBoundingClientRect(),rects=rows.map(row=>row.el.getBoundingClientRect());
    // Dropping outside the workflow list cancels; the setup row is never a target.
    if(drag.x<bounds.left||drag.x>bounds.right||drag.y<Math.max(bounds.top,rects[0].top)-4||drag.y>Math.min(bounds.bottom,rects.at(-1)!.bottom)+4){drag.index=-1;return;}
    const others=rows.filter(row=>row!==drag.row);
    const index=others.findIndex(row=>{const rect=row.el.getBoundingClientRect();return drag.y<rect.top+rect.height/2;});
    drag.index=index<0?others.length:index;
    if(drag.index===rows.indexOf(drag.row))return;
    if(index<0)others.at(-1)!.el.classList.add('t3-workflow-drop-after');else others[index].el.classList.add('t3-workflow-drop-before');
  };
  for(const row of rows){
    row.el.classList.add('t3-workflow-menu-row');
    row.status.className='t3-workflow-status';row.status.setAttribute('role','status');row.el.appendChild(row.status);
    if(!reorderable)continue;
    const handle=row.handle;handle.className='t3-workflow-drag-handle';handle.tabIndex=0;handle.setAttribute('role','button');
    handle.setAttribute('aria-label',`Reorder ${row.name}`);handle.title='Drag to reorder · Alt+↑/↓';setIcon(handle,'grip-vertical');row.el.appendChild(handle);
    // A grip click (including the compatibility click following pointerup) must
    // not reach MenuItem.handleEvent, which always opens the editor and hides.
    cleanups.push(listen(handle,'click',stop,{capture:true}));
    cleanups.push(listen(handle,'keydown',event=>{
      const key=event as KeyboardEvent;
      if(key.altKey&&(key.key==='ArrowUp'||key.key==='ArrowDown')){
        stop(key);const index=rows.indexOf(row)+(key.key==='ArrowUp'?-1:1);
        if(index>=0&&index<rows.length)void commit(row,index).then(()=>{if(!disposed&&handle.isConnected)handle.focus();});
      }else if(key.key==='Enter'||key.key===' ')stop(key);
    },{capture:true}));
    cleanups.push(listen(handle,'pointerdown',event=>{
      const pointer=event as PointerEvent;if(pointer.button!==0||pointer.isPrimary===false)return;
      stop(pointer);if(disposed||saving||active)return;
      suppressClick=false;
      active={row,pointerId:pointer.pointerId,startX:pointer.clientX,startY:pointer.clientY,moved:false,index:rows.indexOf(row),x:pointer.clientX,y:pointer.clientY};
      const doc=handle.ownerDocument,win=doc.defaultView!;
      const listeners:(()=>void)[]=[];let frame=0;
      // Capture outside the menu as well, so leaving it while dragging cannot
      // select another parent item or accidentally open a different submenu.
      for(const type of ['pointerover','mouseover','mousedown','click'])listeners.push(listen(win,type,stop,{capture:true}));
      listeners.push(listen(win,'pointermove',event=>{
        const pointer=event as PointerEvent,drag=active;if(!drag||pointer.pointerId!==drag.pointerId)return;
        stop(pointer);drag.x=pointer.clientX;drag.y=pointer.clientY;
        if(!drag.moved&&Math.hypot(drag.x-drag.startX,drag.y-drag.startY)<4)return;
        drag.moved=true;suppressClick=true;row.el.classList.add('t3-workflow-drag-source');view.dom.classList.add('t3-workflow-dragging');marker();
      },{capture:true,passive:false}));
      listeners.push(listen(win,'pointerup',event=>{
        const pointer=event as PointerEvent;if(pointer.pointerId!==active?.pointerId)return;stop(pointer);
        active.x=pointer.clientX;active.y=pointer.clientY;marker();const drag=finish();if(drag?.moved)void commit(drag.row,drag.index);
      },{capture:true}));
      listeners.push(listen(win,'pointercancel',event=>{if((event as PointerEvent).pointerId===active?.pointerId){stop(event);finish();}},{capture:true}));
      listeners.push(listen(win,'keydown',event=>{stop(event);if((event as KeyboardEvent).key==='Escape')finish();},{capture:true}));
      listeners.push(listen(win,'blur',()=>finish()));
      listeners.push(listen(handle,'lostpointercapture',()=>finish()));
      const scroll=view.dom.querySelector<HTMLElement>('.menu-scroll');
      const tick=()=>{
        if(!active)return;
        if(!handle.isConnected){finish();return;}
        if(active.moved&&scroll){const rect=scroll.getBoundingClientRect();if(active.x>=rect.left&&active.x<=rect.right&&active.y>=rect.top&&active.y<=rect.bottom){const step=active.y<rect.top+24?-6:active.y>rect.bottom-24?6:0;if(step){scroll.scrollTop+=step;marker();}}}
        frame=win.requestAnimationFrame(tick);
      };
      detachDrag=()=>{for(const off of listeners)off();win.cancelAnimationFrame(frame);};
      handle.setPointerCapture?.(pointer.pointerId);frame=win.requestAnimationFrame(tick);
    },{capture:true,passive:false}));
  }
  cleanups.push(listen(view.dom,'pointerdown',()=>{if(!active)suppressClick=false;},{capture:true}));
  cleanups.push(listen(view.dom,'click',event=>{if(saving||suppressClick){stop(event);suppressClick=false;}},{capture:true}));
  const controller:WorkflowMenuController={refresh(){
    if(disposed)return;const activity=getActivity();
    for(const row of rows){const state=activity.get(row.id);decorateWorkflowActivity(row.el,state);const text=state==='running'?'Running':state==='queued'?'Queued':state==='completed'?'Done':state==='blocked'?'Needs attention':'';if(row.status.textContent!==text)row.status.textContent=text;row.el.title=state?workflowActivityLabel[state]:row.originalTitle;}
  },dispose(){
    if(disposed)return;disposed=true;finish();for(const off of cleanups)off();
    for(const row of rows){row.handle.remove();row.status.remove();decorateWorkflowActivity(row.el);row.el.title=row.originalTitle;row.el.classList.remove('t3-workflow-menu-row');}onDispose();
  }};
  const previousHide=(root as DOMMenu).hideCallback;
  root.onHide(()=>{controller.dispose();previousHide?.();});
  controller.refresh();
  return controller;
}
