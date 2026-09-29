import type {App,Editor,MarkdownView} from 'obsidian';
import type {SelectionAnchor} from './inline-thread';

interface SelectedText {
  editor:Editor;
  view:MarkdownView;
  text:string;
  anchor:SelectionAnchor;
  path:string;
}

/** A small, device-local action beside a selection. It never changes the note. */
export function installMobileSelectionAction(app:App,activeView:()=>MarkdownView|null,canAsk:(path:string)=>boolean,capture:(editor:Editor)=>SelectionAnchor,ask:(selection:SelectedText)=>void):{dispose():void} {
  const button=document.createElement('button');
  button.type='button';
  button.className='send-to-t3-selection-action';
  button.textContent='Ask T3 Code';
  button.setAttribute('aria-label','Ask T3 Code about selected text');
  button.hidden=true;
  document.body.appendChild(button);

  let current:SelectedText|undefined;
  let timer:ReturnType<typeof setTimeout>|undefined;
  let disposed=false;
  let lastPointerActivation=0;

  const hide=()=>{current=undefined;button.hidden=true;};
  const selection=():{value:SelectedText;rect:DOMRect}|undefined=>{
    const view=activeView();
    if(!view?.file||view.file.extension.toLowerCase()!=='md'||view.getMode()==='preview'||!canAsk(view.file.path))return;
    const editor=view.editor,text=editor.getSelection();
    if(!text.trim())return;
    const native=window.getSelection();
    if(!native||native.isCollapsed||!native.anchorNode||!view.contentEl.contains(native.anchorNode)||!native.rangeCount)return;
    const rect=Array.from(native.getRangeAt(0).getClientRects()).find(item=>item.width>0&&item.height>0);
    if(!rect)return;
    const top=(window.visualViewport?.offsetTop??0),bottom=top+(window.visualViewport?.height??window.innerHeight);
    if(rect.bottom<top||rect.top>bottom)return;
    try{return {value:{editor,view,text,anchor:capture(editor),path:view.file.path},rect};}
    catch{return;}
  };
  const refresh=()=>{
    if(disposed)return;
    const found=selection();
    if(!found){hide();return;}
    current=found.value;
    const width=button.offsetWidth||82,height=button.offsetHeight||38;
    const viewport=window.visualViewport;
    const left=Math.max(8,Math.min(found.rect.right-width,window.innerWidth-width-8));
    const upper=(viewport?.offsetTop??0)+8;
    const lower=(viewport?.offsetTop??0)+(viewport?.height??window.innerHeight)-height-8;
    const wanted=found.rect.top-height-8;
    button.style.left=`${left}px`;
    button.style.top=`${Math.max(upper,Math.min(wanted>=upper?wanted:found.rect.bottom+8,lower))}px`;
    button.hidden=false;
  };
  const schedule=()=>{if(timer)clearTimeout(timer);timer=setTimeout(refresh,80);};
  const activate=()=>{
    const value=current;
    hide();
    if(!value||!canAsk(value.path)||activeView()!==value.view||value.view.file?.path!==value.path||value.editor.getSelection()!==value.text)return;
    ask(value);
  };
  // Prevent iOS from collapsing the selection before the existing inline flow
  // captures it. The click handler covers keyboard and accessibility activation.
  const pointerDown=(event:PointerEvent)=>{event.preventDefault();event.stopPropagation();lastPointerActivation=Date.now();activate();};
  const click=(event:MouseEvent)=>{event.preventDefault();event.stopPropagation();if(Date.now()-lastPointerActivation>500)activate();};
  button.addEventListener('pointerdown',pointerDown);
  button.addEventListener('click',click);
  document.addEventListener('selectionchange',schedule);
  document.addEventListener('pointerup',schedule);
  document.addEventListener('touchend',schedule);
  document.addEventListener('keyup',schedule);
  document.addEventListener('scroll',schedule,true);
  window.addEventListener('resize',schedule);
  window.visualViewport?.addEventListener('resize',schedule);
  const leafEvent=app.workspace.on('active-leaf-change',schedule);
  const fileEvent=app.workspace.on('file-open',schedule);
  schedule();
  return {dispose(){
    disposed=true;if(timer)clearTimeout(timer);
    document.removeEventListener('selectionchange',schedule);
    document.removeEventListener('pointerup',schedule);
    document.removeEventListener('touchend',schedule);
    document.removeEventListener('keyup',schedule);
    document.removeEventListener('scroll',schedule,true);
    window.removeEventListener('resize',schedule);
    window.visualViewport?.removeEventListener('resize',schedule);
    app.workspace.offref(leafEvent);
    app.workspace.offref(fileEvent);
    button.remove();
  }};
}
