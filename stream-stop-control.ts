import type {MarkdownView} from 'obsidian';

export interface StreamStopTarget {id:string;key:string;view:MarkdownView}

/** UI state belongs to a response in a pane, never to note Markdown. Resolve
 * again at activation: a retained DOM node can outlive the run it displayed. */
export function installStreamStopControls(root:Document,resolve:(fold:HTMLElement)=>StreamStopTarget|undefined,stop:(target:StreamStopTarget)=>Promise<void>,icon:(element:HTMLElement,name:string)=>void,onError:(error:unknown)=>void):()=>void {
  const controls=new Map<HTMLElement,HTMLButtonElement>(),pending=new Set<string>();
  let active:StreamStopTarget|undefined,disposed=false,queued=false;
  const identity=(target:StreamStopTarget)=>JSON.stringify([target.id,target.key]);
  const same=(a:StreamStopTarget|undefined,b:StreamStopTarget|undefined)=>!!a&&!!b&&a.view===b.view&&identity(a)===identity(b);
  const shown=(target:StreamStopTarget)=>same(active,target);
  const refresh=()=>{
    queued=false;if(disposed)return;
    const live=new Set<HTMLElement>();let activeExists=false;
    for(const fold of Array.from(root.querySelectorAll<HTMLElement>('.callout[data-callout="t3-progress"]'))){
      const target=resolve(fold);if(!target)continue;
      live.add(fold);fold.classList.add('send-to-t3-stream-stoppable');
      let button=controls.get(fold);
      if(!button){
        button=root.createElement('button');button.type='button';button.className='clickable-icon send-to-t3-stream-stop';button.hidden=true;
        button.setAttribute('aria-label','Stop T3 response');button.setAttribute('title','Stop T3 response');icon(button,'square');
        controls.set(fold,button);
        resize?.observe(fold);
      }
      // Native rendering can replace children while retaining the callout.
      if(button.parentElement!==fold)fold.appendChild(button);
      button.hidden=!shown(target);button.disabled=pending.has(target.id);
      activeExists||=!button.hidden;
      button.setAttribute('aria-busy',String(button.disabled));
      const heading=fold.querySelector<HTMLElement>(':scope > .callout-title');
      if(heading){
        const header=heading.getBoundingClientRect(),box=fold.getBoundingClientRect();
        fold.style.setProperty('--send-to-t3-stop-center',`${header.top+header.height/2-box.top-fold.clientTop}px`);
      }
    }
    if(!activeExists)active=undefined;
    for(const [fold,button] of controls)if(!live.has(fold)){button.remove();resize?.unobserve(fold);fold.classList.remove('send-to-t3-stream-stoppable');fold.style.removeProperty('--send-to-t3-stop-center');controls.delete(fold);}
  };
  const schedule=()=>{if(!queued&&!disposed){queued=true;queueMicrotask(refresh);}};
  const find=(target:EventTarget|null)=>{
    const element=target as Element|null;
    let fold=element?.closest?.<HTMLElement>('.callout[data-callout="t3-progress"]');
    while(fold&&!controls.has(fold))fold=fold.parentElement?.closest<HTMLElement>('.callout[data-callout="t3-progress"]')??null;
    if(fold)return fold;
    // Live Preview focuses the containing native widget when its text is
    // clicked. The sibling Follow action belongs to that same response too.
    const embedded=element?.closest?.('.cm-embed-block')?.querySelector<HTMLElement>('.callout[data-callout="t3-progress"]');
    return embedded&&controls.has(embedded)?embedded:undefined;
  };
  const targetAt=(element:EventTarget|null)=>{const fold=find(element);return fold?resolve(fold):undefined;};
  const reveal=(event:Event)=>{
    active=targetAt(event.target);refresh();
  };
  const pointer=(event:Event)=>{if(active&&!same(active,targetAt(event.target))){active=undefined;refresh();}};
  const blur=(event:FocusEvent)=>{
    const leaving=active;if(!leaving||!same(leaving,targetAt(event.target)))return;
    if(event.relatedTarget){if(!same(leaving,targetAt(event.relatedTarget))){active=undefined;refresh();}return;}
    // Native DOM replacement and pointer focus can report a null destination.
    // Wait for the focus transition, without delaying a real outside click.
    queueMicrotask(()=>{if(!disposed&&active===leaving&&!same(leaving,targetAt(root.activeElement))){active=undefined;refresh();}});
  };
  const click=(event:Event)=>{
    const button=(event.target as Element)?.closest?.<HTMLButtonElement>('.send-to-t3-stream-stop');
    if(!button){reveal(event);return;}
    const fold=button.parentElement;if(!fold||controls.get(fold)!==button)return;
    event.preventDefault();event.stopImmediatePropagation();
    const target=resolve(fold);
    if(!target||!shown(target)||button.hidden||pending.has(target.id)){refresh();return;}
    pending.add(target.id);refresh();
    void Promise.resolve().then(()=>{
      const current=resolve(fold);
      if(!disposed&&current&&current.view===target.view&&identity(current)===identity(target))return stop(target);
    }).catch(onError).finally(()=>{pending.delete(target.id);refresh();});
  };
  // Reveal after a tap resolves its target. Inserting a control on pointerdown
  // could turn the first tap at the top right into an accidental Stop.
  // Do not cancel selection, link navigation, title folding or touch scrolling.
  root.addEventListener('pointerdown',pointer,true);root.addEventListener('click',click,true);root.addEventListener('focusin',reveal,true);root.addEventListener('focusout',blur,true);
  const resize=typeof ResizeObserver==='undefined'?undefined:new ResizeObserver(schedule);
  const observer=new MutationObserver(schedule);observer.observe(root.body,{childList:true,subtree:true});
  const timer=setInterval(refresh,1000);refresh();
  return ()=>{disposed=true;observer.disconnect();resize?.disconnect();clearInterval(timer);root.removeEventListener('pointerdown',pointer,true);root.removeEventListener('click',click,true);root.removeEventListener('focusin',reveal,true);root.removeEventListener('focusout',blur,true);for(const [fold,button] of controls){button.remove();fold.classList.remove('send-to-t3-stream-stoppable');fold.style.removeProperty('--send-to-t3-stop-center');}controls.clear();};
}
